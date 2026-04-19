import type { Writable } from "node:stream";
import { Buffer } from "node:buffer";
import { pipeline } from "node:stream/promises";
import type { Logger } from "pino";
import { ZipFile } from "yazl";
import pLimit from "p-limit";
import { createExclusiveRunner } from "./exclusive.js";
import {
  forEachAsyncIterablePool,
  forEachAsyncIterablePriorityPool,
} from "./async-iterable-pool.js";
import {
  appendYazlReadStreamEntry,
  waitYazlLastEntryComplete,
  yazlZipOutputStream,
} from "./yazl-entry.js";
import { resolveZipEntryLevel } from "./archive-zip-level.js";
import type { ObjectMeta } from "./types.js";
import type {
  ArchiveObjectProcessor,
  ArchiveEntryWriter,
  ArchiveZipConcurrencyGate,
  ArchiveZipGetObjectLimiter,
} from "./archive-object-processor.js";

export interface ZipArchiveSinkRunParams {
  iterable: AsyncIterable<ObjectMeta>;
  zipGate: ArchiveZipConcurrencyGate;
  zipConcurrency: number;
  objectProcessor: ArchiveObjectProcessor;
  /**
   * When set, used as `zipGate.limit` instead of `pLimit(zipConcurrency)` (e.g. adaptive GetObject cap).
   */
  zipGetObjectLimit?: ArchiveZipGetObjectLimiter;
  objectPriority?: (meta: ObjectMeta) => number;
  objectPriorityBufferMax?: number;
  signal?: AbortSignal;
  log: Logger;
}

/**
 * Owns yazl output piping to the destination, the {@link ArchiveEntryWriter}, parallel list iteration,
 * and ZIP manifest buffer append under the exclusive runner.
 *
 * **Backpressure:** `pipeline(yazlZipOutputStream, destination)` connects the ZIP byte stream to the
 * caller’s `Writable`; a slow destination propagates through yazl to each `addReadStream` source.
 */
export class ZipArchiveSink {
  private readonly zipfile: ZipFile;
  private readonly zipOut: ReturnType<typeof yazlZipOutputStream>;
  private readonly pipeDone: Promise<void>;
  readonly writer: ArchiveEntryWriter;

  constructor(
    destination: Writable,
    private readonly baseZipLevel: number,
    private readonly zipStoreMinBytes: number | undefined,
    private readonly onBytesWritten: (n: number) => void,
  ) {
    this.zipfile = new ZipFile();
    this.zipOut = yazlZipOutputStream(this.zipfile);
    this.zipOut.on("data", (c: Buffer) => {
      this.onBytesWritten(c.length);
    });
    this.pipeDone = pipeline(this.zipOut, destination).catch((e) => {
      this.zipOut.destroy(e instanceof Error ? e : new Error(String(e)));
      throw e;
    });
    this.writer = {
      appendZip: (stream, name, size) =>
        appendYazlReadStreamEntry(
          this.zipfile,
          stream,
          name,
          size,
          resolveZipEntryLevel(this.baseZipLevel, this.zipStoreMinBytes, size),
        ),
      appendTar: async () => {
        throw new Error("unreachable");
      },
    };
  }

  async runObjectIteration(params: ZipArchiveSinkRunParams): Promise<void> {
    const {
      iterable,
      zipGate,
      zipConcurrency,
      objectProcessor,
      zipGetObjectLimit,
      objectPriority,
      objectPriorityBufferMax,
      signal,
      log,
    } = params;

    zipGate.limit = zipGetObjectLimit ?? pLimit(zipConcurrency);
    zipGate.exclusive = createExclusiveRunner();

    const runZipObject = async (meta: ObjectMeta): Promise<void> => {
      signal?.throwIfAborted();
      try {
        await objectProcessor.processOne(meta, this.writer);
      } catch (e) {
        log.error({ err: e }, "archive pump failed (zip)");
        this.zipOut.destroy(e instanceof Error ? e : new Error(String(e)));
        await this.pipeDone.catch(() => {});
        throw e;
      }
    };

    if (objectPriority) {
      const bufferMax = objectPriorityBufferMax ?? 256;
      await forEachAsyncIterablePriorityPool(
        iterable,
        zipConcurrency,
        objectPriority,
        bufferMax,
        runZipObject,
        { signal },
      );
    } else {
      await forEachAsyncIterablePool(iterable, zipConcurrency, runZipObject);
    }
  }

  /** Append a buffer entry while holding the ZIP exclusive lock (serialized yazl writes). */
  async addManifestBuffer(
    exclusive: NonNullable<ArchiveZipConcurrencyGate["exclusive"]>,
    manifestName: string,
    buf: Buffer,
  ): Promise<void> {
    await exclusive(async () => {
      this.zipfile.addBuffer(buf, manifestName, {
        compress: this.baseZipLevel !== 0,
        compressionLevel: this.baseZipLevel === 0 ? 0 : this.baseZipLevel,
        mtime: new Date(),
      });
      await waitYazlLastEntryComplete(this.zipfile);
    });
  }

  end(): void {
    this.zipfile.end();
  }

  waitPipeline(): Promise<void> {
    return this.pipeDone;
  }
}
