import type { Writable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "pino";
import { parseS3Uri } from "./s3-uri.js";
import { S3StorageProvider } from "./s3-provider.js";
import { defaultEntryName, assertSafeArchivePath } from "./path-normalize.js";
import type {
  ArchiveFormat,
  ArchiveProgress,
  ArchiveStats,
  ArchiveS3RetryContext,
  ArchiveS3RetryTraceEntry,
  CreateFolderArchiveStreamOptions,
  FailureMode,
  ObjectMeta,
  OmissionRecord,
  PumpArchiveResult,
  StorageProvider,
} from "./types.js";
import { ArchivePumpResolvedOptions } from "./archive-pump-resolved-options.js";
import { ArchiveCheckpointCoordinator } from "./archive-checkpoint-coordinator.js";
import { resolveArchiveLogger } from "./logger.js";
import { observeArchiveCompletion } from "./prometheus.js";
import { iterateObjectMetaFromNdjsonIndex } from "./ndjson-prepared-index.js";
import { buildEntryMappingLookup } from "./entry-mappings.js";
import { parseAdditionalListSources } from "./archive-sources.js";
import {
  createExplainEmitter,
  summarizeFiltersForExplain,
} from "./archive-explain.js";
import {
  classifyArchiveBottleneck,
  computeArchiveStageOccupancyShares,
} from "./archive-bottleneck.js";
import {
  ArchiveObjectProcessor,
  type ArchiveManifestRow,
  type ArchiveZipConcurrencyGate,
} from "./archive-object-processor.js";
import { ZipArchiveSink } from "./archive-zip-sink.js";
import { TarArchiveSink } from "./archive-tar-sink.js";
import { encodeArchiveManifestJsonUtf8 } from "./archive-manifest.js";
import {
  classifyThroughputReadWritePace,
  createArchiveThroughputSampler,
  type ArchiveThroughputSampler,
} from "./archive-throughput.js";
import { AdaptiveZipGetObjectLimit } from "./archive-adaptive-zip-limit.js";
import { ThroughputZipAdaptiveController } from "./archive-throughput-zip-adaptive.js";
import {
  ArchiveStageOccupancyMeter,
  wrapAsyncIterableWithListStage,
} from "./archive-stage-meter.js";
import { computeS3WorkloadUnits } from "./s3-workload-units.js";
import { nowMs } from "./now-ms.js";
import {
  createInFlightReadByteLimiter,
  type InFlightReadByteLimiter,
} from "./in-flight-read-bytes.js";
import {
  createDestinationDownloadGate,
  type DestinationDownloadGate,
} from "./destination-download-gate.js";
import { assertCrossCutArchivePumpOptions } from "./validate-archive-pump-options.js";

/**
 * Flow engine for one **S3 folder → archive bytes** run. Phases: {@link #bootstrapSync} (resolve URI,
 * provider, list source, dedupe sets) → {@link #openCheckpoint} → {@link #buildMappingsAndExplain} →
 * {@link #buildObjectProcessor} → {@link #runDataPlane} (ZIP or tar sink) → {@link #finalize} (stats,
 * metrics, explain summary).
 *
 * {@link pumpArchiveToWritable} is a thin wrapper around `new ArchivePumpFlowEngine(...).run()`.
 *
 * ## Technical invariants (data plane)
 *
 * - **Sink backpressure:** ZIP uses `stream/promises.pipeline(yazl output, #destination)`; tar uses
 *   `pipeline(pack [, gzip], #destination)`. A slow or small-`highWaterMark` `Writable` applies
 *   standard Node backpressure through those pipelines into yazl / tar-stream, which in turn
 *   applies pressure on per-entry source {@link Readable}s. No separate `drain` hook is required
 *   for correctness.
 * - **Parallel ZIP throttles (orthogonal):** {@link CreateFolderArchiveStreamOptions.concurrency}
 *   bounds overlapping **GetObject** tasks; optional {@link CreateFolderArchiveStreamOptions.maxInFlightReadBytes}
 *   bounds overlapping **declared** bytes (`min(ObjectMeta.size, cap)` per active object). Optional
 *   {@link CreateFolderArchiveStreamOptions.respectDestinationBackpressure} awaits `destination` `drain`
 *   before each new download when the `Writable` reports `writableNeedDrain`.
 * - **S3 traffic stats:** When {@link CreateFolderArchiveStreamOptions.storageProvider} is injected,
 *   successful List/Get counters on {@link ArchiveStats} are omitted (no `S3StorageProvider`).
 */
export class ArchivePumpFlowEngine {
  readonly #destination: Writable;
  readonly #options: CreateFolderArchiveStreamOptions;

  #pumpOpts!: ReturnType<typeof ArchivePumpResolvedOptions.from>;
  #format!: ArchiveFormat;
  #zipConcurrency!: number;
  #wantsPathDedupe!: boolean;
  #wantsContentDedupe!: boolean;
  #deterministicOrdering!: boolean;
  #log!: Logger;
  #bucket!: string;
  #prefix!: string;
  #extraRoots!: ReturnType<typeof parseAdditionalListSources>;
  #multiRoot!: boolean;
  #client?: S3Client;
  #maxKeys!: number;
  #failureMode!: FailureMode;
  #omissions!: OmissionRecord[];
  #retries = 0;
  #s3RequestCounters!: {
    listObjectsV2Requests: number;
    getObjectRequests: number;
  };
  #s3RetriesListObjectsV2 = 0;
  #s3RetriesGetObject = 0;
  #recentS3Retries: ArchiveS3RetryTraceEntry[] = [];
  #getObjectPipelineMs = { sum: 0, count: 0 };
  #listDefaults!: { maxKeys: number; delimiter?: string };
  #retryCfg!: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    signal?: AbortSignal;
    onS3Retry?: (ctx: ArchiveS3RetryContext) => void;
  };
  #provider!: StorageProvider;
  #objectSource!: AsyncIterable<ObjectMeta>;
  #doneEntryPaths!: Set<string> | null;
  #doneContentFp!: Set<string> | null;
  #progress!: ArchiveProgress;
  #wall0!: number;
  #stageMeter!: ArchiveStageOccupancyMeter;
  #manifestRows!: ArchiveManifestRow[];
  #manifestMax!: number;
  #includeManifest!: boolean;
  #manifestName!: string;
  #completed!: Set<string>;
  #checkpointCoord: ArchiveCheckpointCoordinator | null = null;
  #entryLookup: Map<string, string> | null = null;
  #explain!: ReturnType<typeof createExplainEmitter>;
  #zipGate!: ArchiveZipConcurrencyGate;
  #objectProcessor!: ArchiveObjectProcessor;
  #throughputSampler: ArchiveThroughputSampler | null = null;
  #adaptiveZipLimit: AdaptiveZipGetObjectLimit | null = null;
  #throughputZipController: ThroughputZipAdaptiveController | null = null;
  #readByteLimiter: InFlightReadByteLimiter | null = null;
  #destinationDownloadGate: DestinationDownloadGate | null = null;
  #destinationDrainEventDetach: (() => void) | null = null;
  #destinationDrainEventCount = 0;

  constructor(
    destination: Writable,
    options: CreateFolderArchiveStreamOptions,
  ) {
    this.#destination = destination;
    this.#options = options;
  }

  /**
   * Passive `drain` listener on `destination` for {@link CreateFolderArchiveStreamOptions.trackDestinationDrainEvents}.
   * Attached after checkpoint open so a failed checkpoint does not leak a listener.
   */
  #attachDestinationDrainEventTracker(): void {
    if (this.#options.trackDestinationDrainEvents !== true) return;
    this.#destinationDrainEventCount = 0;
    const dest = this.#destination;
    const onDrain = (): void => {
      this.#destinationDrainEventCount += 1;
    };
    dest.on("drain", onDrain);
    this.#destinationDrainEventDetach = () => {
      dest.off("drain", onDrain);
      this.#destinationDrainEventDetach = null;
    };
  }

  async run(): Promise<PumpArchiveResult> {
    this.#bootstrapSync();
    await this.#openCheckpoint();
    this.#attachDestinationDrainEventTracker();
    try {
      this.#buildMappingsAndExplain();
      this.#buildObjectProcessor();
      try {
        await this.#runDataPlane();
        return this.#finalize();
      } finally {
        this.#adaptiveZipLimit?.dispose();
        this.#adaptiveZipLimit = null;
        this.#throughputZipController = null;
      }
    } finally {
      this.#destinationDrainEventDetach?.();
    }
  }

  #bootstrapSync(): void {
    this.#pumpOpts = ArchivePumpResolvedOptions.from(this.#options);
    this.#format = this.#pumpOpts.format;
    this.#zipConcurrency = this.#pumpOpts.zipConcurrency;
    this.#wantsPathDedupe = this.#pumpOpts.wantsPathDedupe;
    this.#wantsContentDedupe = this.#pumpOpts.wantsContentDedupe;
    this.#deterministicOrdering = this.#pumpOpts.deterministicOrdering;

    this.#log = resolveArchiveLogger({
      logger: this.#options.logger,
      debug: this.#options.debug,
    }).child({ lib: "s3-archive-download", component: "pump-archive" });

    const { bucket, prefix } = parseS3Uri(this.#options.source);
    this.#bucket = bucket;
    this.#prefix = prefix;
    this.#extraRoots = parseAdditionalListSources(
      this.#options.additionalListSources,
      {
        bucket,
        prefix,
      },
    );
    this.#multiRoot = this.#extraRoots.length > 0;

    assertCrossCutArchivePumpOptions({
      options: this.#options,
      format: this.#format,
      zipConcurrency: this.#zipConcurrency,
      multiRoot: this.#multiRoot,
    });

    const maxInflight = this.#options.maxInFlightReadBytes;
    if (maxInflight != null) {
      this.#readByteLimiter = createInFlightReadByteLimiter(maxInflight);
    } else {
      this.#readByteLimiter = null;
    }

    this.#destinationDownloadGate =
      this.#options.respectDestinationBackpressure === true
        ? createDestinationDownloadGate(this.#destination, this.#options.signal)
        : null;

    if (this.#options.storageProvider == null) {
      this.#client =
        this.#options.client ?? new S3Client(this.#options.clientConfig ?? {});
    }
    this.#maxKeys = Math.min(1000, Math.max(1, this.#options.maxKeys ?? 1000));
    this.#failureMode = this.#options.failureMode ?? "fail-fast";
    this.#omissions = [];
    this.#s3RequestCounters = {
      listObjectsV2Requests: 0,
      getObjectRequests: 0,
    };
    this.#s3RetriesListObjectsV2 = 0;
    this.#s3RetriesGetObject = 0;
    this.#recentS3Retries = [];

    this.#listDefaults = {
      maxKeys: this.#maxKeys,
      delimiter: this.#options.delimiter,
    };

    this.#adaptiveZipLimit = null;
    this.#throughputZipController = null;
    if (
      this.#format === "zip" &&
      this.#options.experimentalAdaptiveZipConcurrency
    ) {
      const tick = this.#options.adaptiveZipConcurrencyRecoveryMs ?? 15_000;
      const quiet =
        this.#options.adaptiveZipConcurrencyRecoveryQuietMs ??
        (tick > 0 ? tick : 0);
      this.#adaptiveZipLimit = new AdaptiveZipGetObjectLimit(
        this.#zipConcurrency,
        tick,
        quiet,
      );
    } else if (
      this.#format === "zip" &&
      this.#options.experimentalThroughputAdaptiveZipConcurrency
    ) {
      this.#adaptiveZipLimit = new AdaptiveZipGetObjectLimit(
        this.#zipConcurrency,
        0,
        0,
      );
      this.#throughputZipController = new ThroughputZipAdaptiveController(
        this.#options.experimentalThroughputAdaptiveZipConcurrency,
      );
    }

    this.#retryCfg = {
      maxAttempts: this.#options.retry?.maxAttempts,
      baseDelayMs: this.#options.retry?.baseDelayMs,
      maxDelayMs: this.#options.retry?.maxDelayMs,
      signal: this.#options.signal,
      onS3Retry: (ctx) => {
        this.#retries += 1;
        if (ctx.operation === "listObjectsV2")
          this.#s3RetriesListObjectsV2 += 1;
        else this.#s3RetriesGetObject += 1;
        const traceCap = this.#options.statsRecentS3RetriesMax;
        if (traceCap != null && traceCap > 0) {
          const max = Math.min(64, traceCap);
          if (this.#recentS3Retries.length >= max)
            this.#recentS3Retries.shift();
          this.#recentS3Retries.push({
            operation: ctx.operation,
            attemptNumber: ctx.attemptNumber,
            kind: ctx.kind,
            key: ctx.key,
            prefix: ctx.prefix,
          });
        }
        if (
          ctx.operation === "getObject" &&
          ctx.kind === "throttle" &&
          this.#adaptiveZipLimit &&
          this.#options.experimentalAdaptiveZipConcurrency
        ) {
          this.#adaptiveZipLimit.onThrottleRetry();
          this.#log.info(
            { adaptiveZipGetObjectCap: this.#adaptiveZipLimit.getCap() },
            "adaptive zip: lowered GetObject concurrency after S3 throttle",
          );
        }
        this.#log.debug(
          {
            retries: this.#retries,
            operation: ctx.operation,
            attemptNumber: ctx.attemptNumber,
            bucket: ctx.bucket,
            key: ctx.key,
            prefix: ctx.prefix,
          },
          "archive pump: S3 retry observed",
        );
        this.#options.retry?.onRetry?.(ctx);
        if (ctx.kind === "throttle") {
          this.#options.retry?.onS3ThrottleRetry?.(ctx);
        }
      },
    };

    const s3Extras = {
      requestCounters: this.#s3RequestCounters,
      requestTimeoutMs: this.#options.s3RequestTimeoutMs,
    };
    if (this.#options.storageProvider != null) {
      this.#provider = this.#options.storageProvider;
    } else {
      this.#provider = new S3StorageProvider(
        this.#client!,
        bucket,
        this.#listDefaults,
        this.#retryCfg,
        this.#log.child({ component: "s3-provider" }),
        s3Extras,
      );
    }

    const objectSourceBase: AsyncIterable<ObjectMeta> = this.#options
      .preparedIndexNdjson
      ? iterateObjectMetaFromNdjsonIndex(this.#options.preparedIndexNdjson, {
          signal: this.#options.signal,
          keyPrefix: prefix,
        })
      : this.#multiRoot
        ? this.#mergedList()
        : this.#provider.listObjects(prefix, { signal: this.#options.signal });

    this.#wall0 = nowMs();
    this.#stageMeter = new ArchiveStageOccupancyMeter(this.#wall0);
    this.#objectSource = wrapAsyncIterableWithListStage(
      this.#stageMeter,
      objectSourceBase,
    );

    this.#log.info(
      {
        bucket,
        prefix,
        format: this.#format,
        zipConcurrency: this.#zipConcurrency,
        failureMode: this.#failureMode,
        preparedIndex: Boolean(this.#options.preparedIndexNdjson),
        additionalListRoots: this.#extraRoots.length,
        dedupeArchivePaths: this.#wantsPathDedupe,
        dedupeContentByEtag: this.#wantsContentDedupe,
        deltaBaseline: Boolean(this.#options.deltaBaseline),
        objectPriority: Boolean(this.#options.objectPriority),
        deterministicOrdering: this.#deterministicOrdering,
        experimentalAdaptiveZipConcurrency: Boolean(
          this.#options.experimentalAdaptiveZipConcurrency,
        ),
        experimentalThroughputAdaptiveZipConcurrency: Boolean(
          this.#options.experimentalThroughputAdaptiveZipConcurrency,
        ),
      },
      "archive pump started",
    );

    this.#doneEntryPaths = this.#wantsPathDedupe ? new Set<string>() : null;
    this.#doneContentFp = this.#wantsContentDedupe ? new Set<string>() : null;

    this.#progress = {
      objectsListed: 0,
      objectsIncluded: 0,
      objectsSkipped: 0,
      bytesRead: 0,
      bytesWritten: 0,
    };
    this.#manifestRows = [];
    this.#manifestMax = this.#options.manifestMaxEntries ?? 100_000;
    this.#includeManifest = this.#options.includeManifest ?? false;
    this.#manifestName = this.#options.manifestName ?? "manifest.json";
    this.#completed = new Set<string>();
    this.#zipGate = { limit: null, exclusive: null };

    const rollMs = this.#options.statsThroughputRollingWindowMs;
    if (rollMs != null && rollMs > 0) {
      this.#throughputSampler = createArchiveThroughputSampler(rollMs);
    }
  }

  #objectTableKey(meta: ObjectMeta): string {
    return this.#multiRoot
      ? `${meta.bucket ?? this.#bucket}\t${meta.key}`
      : meta.key;
  }

  async *#mergedList(): AsyncGenerator<ObjectMeta> {
    for await (const m of this.#provider.listObjects(this.#prefix, {
      signal: this.#options.signal,
    })) {
      if (this.#multiRoot)
        yield { ...m, bucket: this.#bucket, listPrefix: this.#prefix };
      else yield m;
    }
    for (const root of this.#extraRoots) {
      const sub = new S3StorageProvider(
        this.#client!,
        root.bucket,
        this.#listDefaults,
        this.#retryCfg,
        this.#log.child({ component: "s3-provider", extraBucket: root.bucket }),
        {
          requestCounters: this.#s3RequestCounters,
          requestTimeoutMs: this.#options.s3RequestTimeoutMs,
        },
      );
      for await (const m of sub.listObjects(root.prefix, {
        signal: this.#options.signal,
      })) {
        yield { ...m, bucket: root.bucket, listPrefix: root.prefix };
      }
    }
  }

  async #openCheckpoint(): Promise<void> {
    if (!this.#options.checkpoint) return;
    this.#checkpointCoord = await ArchiveCheckpointCoordinator.open(
      this.#options.checkpoint,
      {
        bucket: this.#bucket,
        prefix: this.#prefix,
        format: this.#format,
        multiRoot: this.#multiRoot,
        additionalListSources: this.#options.additionalListSources,
      },
      {
        wantsPathDedupe: this.#wantsPathDedupe,
        wantsContentDedupe: this.#wantsContentDedupe,
        doneEntryPaths: this.#doneEntryPaths,
        doneContentFp: this.#doneContentFp,
      },
    );
    this.#completed = this.#checkpointCoord.completed;
  }

  #buildMappingsAndExplain(): void {
    this.#entryLookup =
      this.#options.entryMappings &&
      Object.keys(this.#options.entryMappings).length > 0
        ? buildEntryMappingLookup(
            this.#options.entryMappings,
            this.#bucket,
            this.#multiRoot
              ? {
                  allowBuckets: [
                    this.#bucket,
                    ...new Set(this.#extraRoots.map((r) => r.bucket)),
                  ],
                  compositeMapKeys: true,
                }
              : undefined,
          )
        : null;
    if (this.#entryLookup && this.#entryLookup.size > 0) {
      this.#log.info(
        { entryMappings: this.#entryLookup.size },
        "archive pump: entryMappings active",
      );
    }

    this.#explain = createExplainEmitter(this.#options);
    const throttleAdaptiveOn = Boolean(
      this.#options.experimentalAdaptiveZipConcurrency,
    );
    const recTick = throttleAdaptiveOn
      ? (this.#options.adaptiveZipConcurrencyRecoveryMs ?? 15_000)
      : 0;
    const recQuiet = throttleAdaptiveOn
      ? (this.#options.adaptiveZipConcurrencyRecoveryQuietMs ??
        (recTick > 0 ? recTick : 0))
      : 0;
    this.#explain.emit({
      kind: "archive.config",
      source: this.#options.source,
      format: this.#format,
      failureMode: this.#failureMode,
      zipConcurrency: this.#zipConcurrency,
      listSource: this.#options.preparedIndexNdjson
        ? "prepared-ndjson"
        : "ListObjectsV2",
      additionalListRoots: this.#extraRoots.length,
      checkpoint: Boolean(this.#options.checkpoint),
      entryMappingsCount: this.#entryLookup?.size ?? 0,
      filters: summarizeFiltersForExplain(this.#options.filters),
      dedupeArchivePaths: this.#wantsPathDedupe,
      dedupeContentByEtag: this.#wantsContentDedupe,
      deltaBaseline: Boolean(this.#options.deltaBaseline),
      objectPriority: Boolean(this.#options.objectPriority),
      deterministicOrdering: this.#deterministicOrdering,
      experimentalAdaptiveZipConcurrency: throttleAdaptiveOn,
      adaptiveZipConcurrencyRecoveryTickMs: recTick,
      adaptiveZipConcurrencyRecoveryQuietMs: recQuiet,
      experimentalThroughputAdaptiveZipConcurrency: Boolean(
        this.#options.experimentalThroughputAdaptiveZipConcurrency,
      ),
      throughputAdaptiveZipTargetReadBytesPerSecond:
        this.#options.experimentalThroughputAdaptiveZipConcurrency
          ?.targetReadBytesPerSecond ?? 0,
      verifyGetObjectMd5Etag: Boolean(this.#options.verifyGetObjectMd5Etag),
      injectedStorageProvider: this.#options.storageProvider != null,
      maxInFlightReadBytes: this.#options.maxInFlightReadBytes ?? 0,
      respectDestinationBackpressure:
        this.#options.respectDestinationBackpressure === true,
      trackDestinationDrainEvents:
        this.#options.trackDestinationDrainEvents === true,
    });
  }

  #mapName(meta: ObjectMeta): string {
    const mapped = this.#entryLookup?.get(
      this.#multiRoot ? this.#objectTableKey(meta) : meta.key,
    );
    const raw =
      mapped ??
      (this.#options.mapEntryName
        ? this.#options.mapEntryName(meta)
        : defaultEntryName(meta, this.#prefix));
    return assertSafeArchivePath(raw);
  }

  #buildObjectProcessor(): void {
    this.#objectProcessor = new ArchiveObjectProcessor({
      options: this.#options,
      format: this.#format,
      failureMode: this.#failureMode,
      bucket: this.#bucket,
      provider: this.#provider,
      log: this.#log,
      explain: this.#explain,
      progress: this.#progress,
      omissions: this.#omissions,
      manifestRows: this.#manifestRows,
      manifestMax: this.#manifestMax,
      includeManifest: this.#includeManifest,
      completed: this.#completed,
      doneEntryPaths: this.#doneEntryPaths,
      doneContentFp: this.#doneContentFp,
      wantsContentDedupe: this.#wantsContentDedupe,
      mapName: (m) => this.#mapName(m),
      objectTableKey: (m) => this.#objectTableKey(m),
      stageMeter: this.#stageMeter,
      checkpointCoord: this.#checkpointCoord,
      zipGate: this.#zipGate,
      throughputSampler: this.#throughputSampler,
      throughputZipObserve:
        this.#throughputZipController &&
        this.#throughputSampler &&
        this.#adaptiveZipLimit
          ? () => {
              this.#throughputZipController!.observe({
                nowMs: nowMs(),
                sampler: this.#throughputSampler!,
                limiter: this.#adaptiveZipLimit!,
                log: this.#log,
              });
            }
          : undefined,
      recordGetObjectPipelineMs: (ms: number) => {
        this.#getObjectPipelineMs.sum += ms;
        this.#getObjectPipelineMs.count += 1;
      },
      readByteLimiter: this.#readByteLimiter,
      destinationDownloadGate: this.#destinationDownloadGate,
    });
  }

  async #runDataPlane(): Promise<void> {
    if (this.#format === "zip") {
      const zipLevel = this.#options.zipLevel ?? 6;
      const zipSink = new ZipArchiveSink(
        this.#destination,
        zipLevel,
        this.#options.zipStoreMinBytes,
        (n) => {
          this.#progress.bytesWritten += n;
        },
      );
      await zipSink.runObjectIteration({
        iterable: this.#objectSource,
        zipGate: this.#zipGate,
        zipConcurrency: this.#zipConcurrency,
        objectProcessor: this.#objectProcessor,
        zipGetObjectLimit: this.#adaptiveZipLimit
          ? this.#adaptiveZipLimit.limit.bind(this.#adaptiveZipLimit)
          : undefined,
        objectPriority: this.#options.objectPriority,
        objectPriorityBufferMax: this.#options.objectPriorityBufferMax,
        signal: this.#options.signal,
        log: this.#log,
      });

      if (
        this.#includeManifest &&
        this.#manifestRows.length <= this.#manifestMax
      ) {
        const buf = encodeArchiveManifestJsonUtf8({
          source: this.#options.source,
          format: this.#format,
          objects: this.#manifestRows,
          omissions: this.#omissions,
          failureMode: this.#failureMode,
        });
        await zipSink.addManifestBuffer(
          this.#zipGate.exclusive!,
          this.#manifestName,
          buf,
        );
      }

      zipSink.end();
      await zipSink.waitPipeline();
      return;
    }

    const tarSink = new TarArchiveSink(
      this.#destination,
      this.#format,
      this.#options.gzipLevel ?? 6,
      (n) => {
        this.#progress.bytesWritten += n;
      },
    );
    await tarSink.runSequential({
      iterable: this.#objectSource,
      objectProcessor: this.#objectProcessor,
      progress: this.#progress,
      signal: this.#options.signal,
      log: this.#log,
      throughputSampler: this.#throughputSampler,
    });

    if (
      this.#includeManifest &&
      this.#manifestRows.length <= this.#manifestMax
    ) {
      const buf = encodeArchiveManifestJsonUtf8({
        source: this.#options.source,
        format: this.#format,
        objects: this.#manifestRows,
        omissions: this.#omissions,
        failureMode: this.#failureMode,
      });
      await tarSink.addManifestBuffer(this.#manifestName, buf);
    }

    tarSink.finalize();
    await tarSink.waitPipeline();
  }

  #finalize(): PumpArchiveResult {
    this.#progress.currentKey = undefined;
    const totalMs = nowMs() - this.#wall0;
    const stage = this.#stageMeter.finish(nowMs());
    const { listMs, downloadMs, archiveWriteMs, stageIdleMs } = stage;
    const bottleneck = classifyArchiveBottleneck({
      listMs,
      downloadMs,
      archiveWriteMs,
      stageIdleMs,
    });
    const stageOccupancyShare = computeArchiveStageOccupancyShares({
      listMs,
      downloadMs,
      archiveWriteMs,
      stageIdleMs,
    });
    const wallDurationMs = totalMs;
    const wallSec = wallDurationMs / 1000;
    const stats: ArchiveStats = {
      ...this.#progress,
      listMs,
      downloadMs,
      archiveWriteMs,
      stageIdleMs,
      retries: this.#retries,
      bottleneck,
      ...(stageOccupancyShare != null ? { stageOccupancyShare } : {}),
      wallDurationMs,
      averageBytesReadPerSecond:
        wallSec > 0 ? this.#progress.bytesRead / wallSec : 0,
      averageBytesWrittenPerSecond:
        wallSec > 0 ? this.#progress.bytesWritten / wallSec : 0,
    };
    if (this.#options.storageProvider == null) {
      stats.s3ListObjectsV2Requests =
        this.#s3RequestCounters.listObjectsV2Requests;
      stats.s3GetObjectRequests = this.#s3RequestCounters.getObjectRequests;
      stats.s3RetriesListObjectsV2 = this.#s3RetriesListObjectsV2;
      stats.s3RetriesGetObject = this.#s3RetriesGetObject;
    }
    if (this.#recentS3Retries.length > 0) {
      stats.recentS3Retries = [...this.#recentS3Retries];
    }
    const rollWin = this.#options.statsThroughputRollingWindowMs;
    if (this.#throughputSampler && rollWin != null && rollWin > 0) {
      const snap = this.#throughputSampler.snapshot(nowMs());
      stats.statsThroughputRollingWindowMs = rollWin;
      stats.rollingBytesReadPerSecond = snap.rollingBytesReadPerSecond;
      stats.rollingBytesWrittenPerSecond = snap.rollingBytesWrittenPerSecond;
      stats.throughputRollingReadMinusWriteBytesPerSecond =
        snap.rollingBytesReadPerSecond - snap.rollingBytesWrittenPerSecond;
      stats.throughputRollingPace = classifyThroughputReadWritePace(
        snap.rollingBytesReadPerSecond,
        snap.rollingBytesWrittenPerSecond,
      );
    }
    if (this.#adaptiveZipLimit) {
      stats.zipGetObjectMaxQueueDepth =
        this.#adaptiveZipLimit.getMaxWaiterQueueDepth();
      stats.zipGetObjectMaxActiveConcurrent =
        this.#adaptiveZipLimit.getMaxActiveConcurrent();
    }
    if (
      this.#options.experimentalAdaptiveZipConcurrency &&
      this.#format === "zip" &&
      this.#adaptiveZipLimit
    ) {
      stats.adaptiveZipConcurrencyInitialCap = this.#zipConcurrency;
      stats.adaptiveZipConcurrencyFinalCap = this.#adaptiveZipLimit.getCap();
      stats.adaptiveZipConcurrencyMinCap =
        this.#adaptiveZipLimit.getMinCapObserved();
    }
    if (
      this.#options.experimentalThroughputAdaptiveZipConcurrency &&
      this.#format === "zip" &&
      this.#adaptiveZipLimit
    ) {
      stats.throughputAdaptiveZipTargetReadBytesPerSecond =
        this.#options.experimentalThroughputAdaptiveZipConcurrency.targetReadBytesPerSecond;
      stats.adaptiveZipConcurrencyInitialCap = this.#zipConcurrency;
      stats.adaptiveZipConcurrencyFinalCap = this.#adaptiveZipLimit.getCap();
      stats.adaptiveZipConcurrencyMinCap =
        this.#adaptiveZipLimit.getMinCapObserved();
    }
    const workload = computeS3WorkloadUnits(stats);
    if (workload != null) {
      stats.s3WorkloadUnits = workload;
    }
    if (this.#getObjectPipelineMs.count > 0) {
      stats.averageGetObjectPipelineMs =
        this.#getObjectPipelineMs.sum / this.#getObjectPipelineMs.count;
      stats.getObjectPipelineSamples = this.#getObjectPipelineMs.count;
    }
    if (this.#destinationDownloadGate) {
      stats.destinationDrainWaits =
        this.#destinationDownloadGate.getDrainWaitCount();
    }
    if (this.#options.trackDestinationDrainEvents === true) {
      stats.destinationDrainEventCount = this.#destinationDrainEventCount;
    }
    if (this.#options.prometheus) {
      observeArchiveCompletion(this.#options.prometheus, {
        format: this.#format,
        failureMode: this.#failureMode,
        stats,
        wallSeconds: totalMs / 1000,
      });
    }
    const dominant = bottleneck;
    this.#log.debug(
      {
        dominant,
        listMs: stats.listMs,
        downloadMs: stats.downloadMs,
        archiveWriteMs: stats.archiveWriteMs,
        retries: stats.retries,
        stageIdleMs,
        note: "Stage ms are occupancy-partitioned wall time (parallel-ZIP-safe).",
      },
      "archive pump stage breakdown",
    );
    this.#explain.emit({
      kind: "archive.summary",
      dominant,
      listMs: stats.listMs,
      downloadMs: stats.downloadMs,
      archiveWriteMs: stats.archiveWriteMs,
      stageIdleMs: stats.stageIdleMs,
      stageOccupancyShare: stats.stageOccupancyShare,
      retries: stats.retries,
      objectsListed: stats.objectsListed,
      objectsIncluded: stats.objectsIncluded,
      objectsSkipped: stats.objectsSkipped,
      bytesRead: stats.bytesRead,
      bytesWritten: stats.bytesWritten,
      omissionsCount: this.#omissions.length,
      s3ListObjectsV2Requests: stats.s3ListObjectsV2Requests,
      s3GetObjectRequests: stats.s3GetObjectRequests,
      s3RetriesListObjectsV2: stats.s3RetriesListObjectsV2,
      s3RetriesGetObject: stats.s3RetriesGetObject,
      destinationDrainWaits: stats.destinationDrainWaits,
      destinationDrainEventCount: stats.destinationDrainEventCount,
      statsThroughputRollingWindowMs: stats.statsThroughputRollingWindowMs,
      rollingBytesReadPerSecond: stats.rollingBytesReadPerSecond,
      rollingBytesWrittenPerSecond: stats.rollingBytesWrittenPerSecond,
      throughputRollingReadMinusWriteBytesPerSecond:
        stats.throughputRollingReadMinusWriteBytesPerSecond,
      throughputRollingPace: stats.throughputRollingPace,
    });
    this.#options.onStats?.(stats);

    if (this.#omissions.length > 0) {
      this.#log.warn(
        {
          omissionCount: this.#omissions.length,
          failureMode: this.#failureMode,
        },
        "archive completed with omitted objects",
      );
    }
    this.#log.info(
      {
        objectsIncluded: stats.objectsIncluded,
        objectsListed: stats.objectsListed,
        objectsSkipped: stats.objectsSkipped,
        bytesWritten: stats.bytesWritten,
        retries: stats.retries,
        listMs: stats.listMs,
        bottleneck: stats.bottleneck,
      },
      "archive pump completed",
    );

    return {
      stats,
      omissions: this.#omissions,
      explainTrace: this.#explain.finishTrace(),
    };
  }
}
