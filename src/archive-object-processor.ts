import { Readable } from "node:stream";
import type { Logger } from "pino";
import { shouldIncludeObject, isDirectoryPlaceholder } from "./filters.js";
import type {
  ArchiveExplainStep,
  ArchiveFormat,
  ArchiveProgress,
  CreateFolderArchiveStreamOptions,
  FailureMode,
  ObjectMeta,
  OmissionRecord,
  StorageProvider,
} from "./types.js";
import {
  GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES,
  wrapReadableWithReadBufferHighWaterMark,
} from "./get-object-read-buffer-cap.js";
import { wrapReadableWithSlowGetObjectMonitor } from "./get-object-stream-telemetry.js";
import { objectContentFingerprint } from "./archive-dedupe.js";
import type { ArchiveCheckpointCoordinator } from "./archive-checkpoint-coordinator.js";
import type { ArchiveThroughputSampler } from "./archive-throughput.js";
import type { ArchiveStageOccupancyMeter } from "./archive-stage-meter.js";
import { createExclusiveRunner } from "./exclusive.js";
import {
  parseS3SinglePartEtagMd5Hex,
  pipeThroughEtagMd5Verifier,
} from "./etag-md5-verify.js";
import { nowMs } from "./now-ms.js";
import type { InFlightReadByteLimiter } from "./in-flight-read-bytes.js";
import { readReservationBytes } from "./in-flight-read-bytes.js";
import type { DestinationDownloadGate } from "./destination-download-gate.js";

export type ArchiveExclusiveRunner = ReturnType<typeof createExclusiveRunner>;

/** Same contract as `p-limit`: bounded parallel async jobs (ZIP GetObject). */
export type ArchiveZipGetObjectLimiter = <T>(
  fn: () => Promise<T>,
) => Promise<T>;

/** Mutable refs filled by the pump before any parallel ZIP work runs. */
export interface ArchiveZipConcurrencyGate {
  limit: ArchiveZipGetObjectLimiter | null;
  exclusive: ArchiveExclusiveRunner | null;
}

export interface ArchiveManifestRow {
  key: string;
  bucket?: string;
  entryName: string;
  size: number;
  etag?: string;
  lastModified?: string;
}

export type ArchiveEntryWriter = {
  appendZip: (
    stream: Readable,
    name: string,
    uncompressedSize: number,
  ) => Promise<void>;
  appendTar: (
    name: string,
    size: number,
    body: Readable | null,
  ) => Promise<void>;
};

export interface ArchiveObjectProcessorDeps {
  options: CreateFolderArchiveStreamOptions;
  format: ArchiveFormat;
  failureMode: FailureMode;
  bucket: string;
  provider: StorageProvider;
  log: Logger;
  explain: { emit: (step: ArchiveExplainStep) => void };
  progress: ArchiveProgress;
  omissions: OmissionRecord[];
  manifestRows: ArchiveManifestRow[];
  manifestMax: number;
  includeManifest: boolean;
  completed: Set<string>;
  doneEntryPaths: Set<string> | null;
  doneContentFp: Set<string> | null;
  wantsContentDedupe: boolean;
  mapName: (meta: ObjectMeta) => string;
  objectTableKey: (meta: ObjectMeta) => string;
  /** Occupancy partitioner for list/download/archive wall time (ZIP-parallel-safe). */
  stageMeter: ArchiveStageOccupancyMeter;
  checkpointCoord: ArchiveCheckpointCoordinator | null;
  zipGate: ArchiveZipConcurrencyGate;
  /** When set, samples progress for rolling throughput on final {@link ArchiveStats}. */
  throughputSampler?: ArchiveThroughputSampler | null;
  /** After each throughput sample, optional ZIP throughput-adaptive cap hook (pump-owned). */
  throughputZipObserve?: () => void;
  /** Pump accumulates per-object pipeline time (GetObject start → archive entry done). */
  recordGetObjectPipelineMs?: (ms: number) => void;
  /** When set, coordinates `maxInFlightReadBytes` across objects. */
  readByteLimiter?: InFlightReadByteLimiter | null;
  /** When set, await destination `drain` before byte budget / `GetObject`. */
  destinationDownloadGate?: DestinationDownloadGate | null;
}

/**
 * Per-listed-object pipeline: skip reasons, GetObject, archive append, checkpoint row,
 * dedupe bookkeeping, hooks, and explain steps. ZIP parallel mode uses {@link ArchiveObjectProcessorDeps.zipGate}.
 */
export class ArchiveObjectProcessor {
  constructor(private readonly deps: ArchiveObjectProcessorDeps) {}

  private recordThroughputSample(): void {
    const { throughputSampler, throughputZipObserve, progress } = this.deps;
    throughputSampler?.record(
      nowMs(),
      progress.bytesRead,
      progress.bytesWritten,
    );
    throughputZipObserve?.();
  }

  private emitProgress(): void {
    const { options, progress } = this.deps;
    this.recordThroughputSample();
    options.onProgress?.({ ...progress });
  }

  private parallelZip(): boolean {
    return (
      this.deps.zipGate.limit != null && this.deps.zipGate.exclusive != null
    );
  }

  /**
   * Raw GetObject stream → optional MD5 verify → optional {@link CreateFolderArchiveStreamOptions.transformGetObjectBody}
   * → optional slow-throughput monitor.
   */
  private wrapGetObjectBodyPipeline(
    body: Readable,
    meta: ObjectMeta,
    entryName: string,
  ): Readable {
    const { options, log } = this.deps;
    const hwm = options.getObjectReadBufferHighWaterMark;
    if (
      hwm != null &&
      Number.isFinite(hwm) &&
      hwm >= GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES
    ) {
      body = wrapReadableWithReadBufferHighWaterMark(body, hwm);
    }
    const md5hex =
      options.verifyGetObjectMd5Etag === true
        ? parseS3SinglePartEtagMd5Hex(meta.etag)
        : null;
    if (md5hex) {
      body = pipeThroughEtagMd5Verifier(body, md5hex, { key: meta.key });
    } else if (options.verifyGetObjectMd5Etag && meta.etag) {
      log.debug(
        { key: meta.key, etag: meta.etag },
        "skip ETag MD5 verify (multipart or non-MD5 ETag shape)",
      );
    }
    if (options.transformGetObjectBody) {
      body = options.transformGetObjectBody(
        { meta, entryName, signal: options.signal },
        body,
      );
    }
    const th = options.slowGetObjectReadBytesPerSecondThreshold;
    if (th != null && th > 0 && options.onSlowGetObjectStream) {
      body = wrapReadableWithSlowGetObjectMonitor(body, {
        thresholdBytesPerSecond: th,
        onSlow: options.onSlowGetObjectStream,
        meta,
        entryName,
      });
    }
    return body;
  }

  async processOne(
    meta: ObjectMeta,
    writer: ArchiveEntryWriter,
  ): Promise<void> {
    const {
      options,
      format,
      failureMode,
      bucket,
      provider,
      log,
      explain,
      progress,
      omissions,
      manifestRows,
      manifestMax,
      includeManifest,
      completed,
      doneEntryPaths,
      doneContentFp,
      wantsContentDedupe,
      mapName,
      objectTableKey,
      stageMeter,
      checkpointCoord,
      zipGate,
    } = this.deps;

    const st = zipGate.exclusive;
    const bumpSkip = async (): Promise<void> => {
      if (st) {
        await st(async () => {
          progress.objectsSkipped += 1;
        });
      } else {
        progress.objectsSkipped += 1;
      }
    };

    if (this.parallelZip()) {
      await st!(async () => {
        progress.objectsListed += 1;
        this.recordThroughputSample();
      });
    }

    if (isDirectoryPlaceholder(meta)) {
      log.debug(
        { key: meta.key, reason: "directory-placeholder" },
        "archive object skip",
      );
      await bumpSkip();
      explain.emit({
        kind: "archive.finish-object",
        key: meta.key,
        outcome: "skipped",
        skipReason: "directory-placeholder",
      });
      options.onArchiveEntryEnd?.({
        meta,
        outcome: "skipped",
        skipReason: "directory-placeholder",
      });
      return;
    }
    if (!shouldIncludeObject(meta, options.filters)) {
      log.debug({ key: meta.key, reason: "filter" }, "archive object skip");
      await bumpSkip();
      explain.emit({
        kind: "archive.finish-object",
        key: meta.key,
        outcome: "skipped",
        skipReason: "filter",
      });
      options.onArchiveEntryEnd?.({
        meta,
        outcome: "skipped",
        skipReason: "filter",
      });
      return;
    }
    if (options.deltaBaseline?.(meta)) {
      log.debug(
        { key: meta.key, reason: "delta-baseline" },
        "archive object skip",
      );
      await bumpSkip();
      explain.emit({
        kind: "archive.finish-object",
        key: meta.key,
        outcome: "skipped",
        skipReason: "delta-baseline",
      });
      options.onArchiveEntryEnd?.({
        meta,
        outcome: "skipped",
        skipReason: "delta-baseline",
      });
      return;
    }
    if (completed.has(objectTableKey(meta))) {
      log.debug({ key: meta.key, reason: "checkpoint" }, "archive object skip");
      await bumpSkip();
      explain.emit({
        kind: "archive.finish-object",
        key: meta.key,
        outcome: "skipped",
        skipReason: "checkpoint",
      });
      options.onArchiveEntryEnd?.({
        meta,
        outcome: "skipped",
        skipReason: "checkpoint",
      });
      return;
    }

    const entryName = mapName(meta);
    const contentFp = wantsContentDedupe
      ? objectContentFingerprint(meta)
      : undefined;

    if (doneEntryPaths?.has(entryName)) {
      log.debug(
        { key: meta.key, entryName, reason: "duplicate-entry-path" },
        "archive object skip",
      );
      await bumpSkip();
      explain.emit({
        kind: "archive.finish-object",
        key: meta.key,
        entryName,
        outcome: "skipped",
        skipReason: "duplicate-entry-path",
      });
      options.onArchiveEntryEnd?.({
        meta,
        entryName,
        outcome: "skipped",
        skipReason: "duplicate-entry-path",
      });
      return;
    }

    if (contentFp && doneContentFp?.has(contentFp)) {
      log.debug(
        { key: meta.key, contentFp, reason: "duplicate-content" },
        "archive object skip",
      );
      await bumpSkip();
      explain.emit({
        kind: "archive.finish-object",
        key: meta.key,
        entryName,
        outcome: "skipped",
        skipReason: "duplicate-content",
      });
      options.onArchiveEntryEnd?.({
        meta,
        entryName,
        outcome: "skipped",
        skipReason: "duplicate-content",
      });
      return;
    }

    explain.emit({ kind: "archive.begin-object", key: meta.key, entryName });
    options.onArchiveEntryStart?.({ meta, entryName });
    log.debug(
      { key: meta.key, size: meta.size, entryName, format },
      "archive object start",
    );
    if (st) {
      await st(async () => {
        progress.currentKey = meta.key;
        this.emitProgress();
      });
    } else {
      progress.currentKey = meta.key;
      this.emitProgress();
    }

    await this.deps.destinationDownloadGate?.beforeStartingObjectDownload();

    const readLimiter = this.deps.readByteLimiter;
    const byteCap = options.maxInFlightReadBytes;
    const reserve =
      readLimiter && byteCap != null && byteCap >= 1
        ? readReservationBytes(meta, byteCap)
        : 0;
    let granted = 0;
    try {
      if (reserve > 0 && readLimiter) {
        granted = await readLimiter.acquire(reserve);
      }

      const tDl0 = nowMs();
      let body: Readable;
      let bytesThisObject = 0;
      try {
        stageMeter.enterDownload();
        try {
          if (this.parallelZip()) {
            body = await zipGate.limit!(async () => {
              const s = await provider.getObjectStream(meta.key, {
                signal: options.signal,
                bucket: meta.bucket,
              });
              return this.wrapGetObjectBodyPipeline(s, meta, entryName);
            });
          } else {
            const raw = await provider.getObjectStream(meta.key, {
              signal: options.signal,
              bucket: meta.bucket,
            });
            body = this.wrapGetObjectBodyPipeline(raw, meta, entryName);
          }
        } finally {
          stageMeter.leaveDownload();
        }
        if (this.parallelZip()) {
          body.pause();
          body.on("data", (chunk: Buffer | string) => {
            bytesThisObject +=
              typeof chunk === "string"
                ? Buffer.byteLength(chunk)
                : chunk.length;
          });
        } else {
          body.on("data", (chunk: Buffer | string) => {
            progress.bytesRead +=
              typeof chunk === "string"
                ? Buffer.byteLength(chunk)
                : chunk.length;
          });
        }
      } catch (err) {
        log.debug(
          {
            key: meta.key,
            err: err instanceof Error ? err.message : String(err),
          },
          "archive object GetObject failed",
        );
        const rec: OmissionRecord = {
          key: meta.key,
          reason: err instanceof Error ? err.message : String(err),
          code:
            err instanceof Error
              ? (err as NodeJS.ErrnoException).code
              : undefined,
        };
        if (failureMode === "best-effort") {
          if (st) {
            await st(async () => {
              omissions.push(rec);
              options.onOmission?.(rec);
              progress.objectsSkipped += 1;
              this.emitProgress();
            });
          } else {
            omissions.push(rec);
            options.onOmission?.(rec);
            progress.objectsSkipped += 1;
          }
          explain.emit({
            kind: "archive.finish-object",
            key: meta.key,
            entryName,
            outcome: "omitted",
            failureKind: "getObject",
          });
          options.onArchiveEntryEnd?.({
            meta,
            entryName,
            outcome: "omitted",
            failureKind: "getObject",
          });
          return;
        }
        explain.emit({
          kind: "archive.finish-object",
          key: meta.key,
          entryName,
          outcome: "failed",
          failureKind: "getObject",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        options.onArchiveEntryEnd?.({
          meta,
          entryName,
          outcome: "failed",
          failureKind: "getObject",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const downloadDelta = nowMs() - tDl0;

      const tAw0 = nowMs();
      try {
        stageMeter.enterArchiveWrite();
        try {
          if (format === "zip") {
            if (this.parallelZip()) {
              await st!(async () => {
                body.resume();
                await writer.appendZip(body, entryName, meta.size);
              });
            } else {
              await writer.appendZip(body, entryName, meta.size);
            }
          } else {
            await writer.appendTar(
              entryName,
              meta.size,
              meta.size === 0 ? null : body,
            );
          }
        } finally {
          stageMeter.leaveArchiveWrite();
        }
      } catch (err) {
        log.debug(
          {
            key: meta.key,
            entryName,
            err: err instanceof Error ? err.message : String(err),
          },
          "archive object append failed",
        );
        const rec: OmissionRecord = {
          key: meta.key,
          reason: err instanceof Error ? err.message : String(err),
        };
        if (failureMode === "best-effort") {
          if (st) {
            await st(async () => {
              omissions.push(rec);
              options.onOmission?.(rec);
              progress.objectsSkipped += 1;
              this.emitProgress();
            });
          } else {
            omissions.push(rec);
            options.onOmission?.(rec);
            progress.objectsSkipped += 1;
          }
          explain.emit({
            kind: "archive.finish-object",
            key: meta.key,
            entryName,
            outcome: "omitted",
            failureKind: "append",
          });
          options.onArchiveEntryEnd?.({
            meta,
            entryName,
            outcome: "omitted",
            failureKind: "append",
            bytesReadThisObject: this.parallelZip()
              ? bytesThisObject
              : meta.size,
          });
          return;
        }
        explain.emit({
          kind: "archive.finish-object",
          key: meta.key,
          entryName,
          outcome: "failed",
          failureKind: "append",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        options.onArchiveEntryEnd?.({
          meta,
          entryName,
          outcome: "failed",
          failureKind: "append",
          errorMessage: err instanceof Error ? err.message : String(err),
          bytesReadThisObject: this.parallelZip() ? bytesThisObject : meta.size,
        });
        throw err;
      }
      const archiveDelta = nowMs() - tAw0;
      const pipelineMs = nowMs() - tDl0;
      this.deps.recordGetObjectPipelineMs?.(pipelineMs);
      log.debug(
        {
          key: meta.key,
          entryName,
          downloadMs: downloadDelta,
          archiveWriteMs: archiveDelta,
          pipelineMs,
        },
        "archive object done",
      );

      if (st) {
        await st(async () => {
          progress.bytesRead += bytesThisObject;
          progress.objectsIncluded += 1;
          if (includeManifest && manifestRows.length < manifestMax) {
            manifestRows.push({
              key: meta.key,
              bucket: meta.bucket ?? bucket,
              entryName,
              size: meta.size,
              etag: meta.etag,
              lastModified: meta.lastModified?.toISOString(),
            });
          }

          if (checkpointCoord) {
            await checkpointCoord.recordSuccessfulInclude(
              objectTableKey(meta),
              entryName,
              contentFp,
            );
          }

          this.emitProgress();
        });
      } else {
        progress.objectsIncluded += 1;
        if (includeManifest && manifestRows.length < manifestMax) {
          manifestRows.push({
            key: meta.key,
            bucket: meta.bucket ?? bucket,
            entryName,
            size: meta.size,
            etag: meta.etag,
            lastModified: meta.lastModified?.toISOString(),
          });
        }

        if (checkpointCoord) {
          await checkpointCoord.recordSuccessfulInclude(
            objectTableKey(meta),
            entryName,
            contentFp,
          );
        }

        this.emitProgress();
      }

      doneEntryPaths?.add(entryName);
      if (contentFp) doneContentFp?.add(contentFp);

      explain.emit({
        kind: "archive.finish-object",
        key: meta.key,
        entryName,
        outcome: "included",
      });
      options.onArchiveEntryEnd?.({
        meta,
        entryName,
        outcome: "included",
        bytesReadThisObject: this.parallelZip() ? bytesThisObject : meta.size,
      });
    } finally {
      if (granted > 0 && readLimiter) {
        readLimiter.release(granted);
      }
    }
  }
}
