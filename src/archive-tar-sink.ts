import { Buffer } from "node:buffer";
import type { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack as tarPack } from "tar-stream";
import type { Logger } from "pino";
import type { ArchiveFormat, ArchiveProgress, ObjectMeta } from "./types.js";
import type {
  ArchiveObjectProcessor,
  ArchiveEntryWriter,
} from "./archive-object-processor.js";
import type { ArchiveThroughputSampler } from "./archive-throughput.js";
import { nowMs } from "./now-ms.js";

async function appendTarEntry(
  pack: ReturnType<typeof tarPack>,
  name: string,
  body: Readable | null,
  size: number,
): Promise<void> {
  const header = { name, size, type: "file" as const };
  if (size === 0) {
    await new Promise<void>((resolve, reject) => {
      pack.entry(header, Buffer.alloc(0), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    return;
  }
  if (!body) {
    throw new Error("Missing stream for non-empty tar entry");
  }
  await new Promise<void>((resolve, reject) => {
    const sink = pack.entry(header, (err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
    void pipeline(body, sink).then(undefined, reject);
  });
}

export interface TarArchiveSinkRunParams {
  iterable: AsyncIterable<ObjectMeta>;
  objectProcessor: ArchiveObjectProcessor;
  progress: ArchiveProgress;
  signal?: AbortSignal;
  log: Logger;
  throughputSampler?: ArchiveThroughputSampler | null;
}

/**
 * Owns tar-stream (+ optional gzip) piping to the destination and sequential object pumping.
 *
 * **Backpressure:** `pipeline(pack [, gzip], destination)` applies standard `Writable` pressure to
 * each entry’s `pipeline(body, entry)` read side.
 */
export class TarArchiveSink {
  private readonly pack: ReturnType<typeof tarPack>;
  private readonly gzip: ReturnType<typeof createGzip> | null;
  private readonly pipeDone: Promise<void>;
  readonly writer: ArchiveEntryWriter;

  constructor(
    destination: Writable,
    format: Extract<ArchiveFormat, "tar" | "tar.gz">,
    gzipLevel: number,
    onBytesWritten: (n: number) => void,
  ) {
    this.pack = tarPack();
    this.gzip = format === "tar.gz" ? createGzip({ level: gzipLevel }) : null;

    const counter = (c: Buffer) => {
      onBytesWritten(c.length);
    };
    if (this.gzip) {
      this.gzip.on("data", counter);
    } else {
      this.pack.on("data", counter);
    }

    this.pipeDone = this.gzip
      ? pipeline(this.pack, this.gzip, destination).catch((e) => {
          this.pack.destroy();
          this.gzip!.destroy();
          throw e;
        })
      : pipeline(this.pack, destination).catch((e) => {
          this.pack.destroy();
          throw e;
        });

    this.writer = {
      appendZip: async () => {
        throw new Error("unreachable");
      },
      appendTar: (name, size, data) =>
        appendTarEntry(this.pack, name, data, size),
    };
  }

  async runSequential(params: TarArchiveSinkRunParams): Promise<void> {
    const {
      iterable,
      objectProcessor,
      progress,
      signal,
      log,
      throughputSampler,
    } = params;
    for await (const meta of iterable) {
      signal?.throwIfAborted();
      progress.objectsListed += 1;
      throughputSampler?.record(
        nowMs(),
        progress.bytesRead,
        progress.bytesWritten,
      );
      try {
        await objectProcessor.processOne(meta, this.writer);
      } catch (e) {
        log.error({ err: e }, "archive pump failed (tar)");
        this.pack.destroy(e instanceof Error ? e : new Error(String(e)));
        await this.pipeDone.catch(() => {});
        throw e;
      }
    }
  }

  async addManifestBuffer(manifestName: string, buf: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.pack.entry(
        { name: manifestName, size: buf.length, type: "file" },
        buf,
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  finalize(): void {
    this.pack.finalize();
  }

  waitPipeline(): Promise<void> {
    return this.pipeDone;
  }
}
