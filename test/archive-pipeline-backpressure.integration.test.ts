import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";

function md5Etag(buf: Buffer): string {
  return `"${createHash("md5").update(buf).digest("hex")}"`;
}

/**
 * Destination with a **small** internal buffer so `write()` often returns false until `drain`.
 * Confirms the yazl/tar → `pipeline(destination)` path does not deadlock when the consumer is slow.
 */
function createTightHighWaterMarkSink(): Writable {
  return new Writable({
    highWaterMark: 256,
    write(_chunk, _enc, cb) {
      queueMicrotask(cb);
    },
  });
}

describe("archive pipeline ↔ destination backpressure", () => {
  it("ZIP completes with a tight Writable (pipeline propagates pressure)", async () => {
    const a = Buffer.alloc(8_192, 7);
    const b = Buffer.alloc(8_192, 8);
    const provider = new MemoryStorageProvider(
      new Map([
        ["pre/a.bin", { body: a, etag: md5Etag(a) }],
        ["pre/b.bin", { body: b, etag: md5Etag(b) }],
      ]),
    );

    const { stats } = await pumpArchiveToWritable(
      createTightHighWaterMarkSink(),
      {
        source: "s3://any/pre/",
        format: "zip",
        concurrency: 2,
        storageProvider: provider,
      },
    );

    expect(stats.objectsIncluded).toBe(2);
    expect(stats.bytesRead).toBe(a.length + b.length);
  });

  it("tar completes with a tight Writable", async () => {
    const body = Buffer.alloc(4_096, 3);
    const provider = new MemoryStorageProvider(
      new Map([["pre/x.bin", { body, etag: md5Etag(body) }]]),
    );

    const { stats } = await pumpArchiveToWritable(
      createTightHighWaterMarkSink(),
      {
        source: "s3://any/pre/",
        format: "tar",
        storageProvider: provider,
      },
    );

    expect(stats.objectsIncluded).toBe(1);
    expect(stats.bytesRead).toBe(body.length);
  });
});
