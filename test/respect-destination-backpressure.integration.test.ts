import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";

function md5Etag(buf: Buffer): string {
  return `"${createHash("md5").update(buf).digest("hex")}"`;
}

describe("respectDestinationBackpressure", () => {
  it("exposes destinationDrainWaits on ArchiveStats when enabled (counter may be 0 if sink never needDrain)", async () => {
    const a = Buffer.alloc(12_000, 1);
    const b = Buffer.alloc(12_000, 2);
    const provider = new MemoryStorageProvider(
      new Map([
        ["pre/a.bin", { body: a, etag: md5Etag(a) }],
        ["pre/b.bin", { body: b, etag: md5Etag(b) }],
      ]),
    );

    const sink = new Writable({
      highWaterMark: 512,
      write(_chunk, _enc, cb) {
        queueMicrotask(cb);
      },
    });

    const { stats } = await pumpArchiveToWritable(sink, {
      source: "s3://any/pre/",
      format: "zip",
      concurrency: 2,
      storageProvider: provider,
      respectDestinationBackpressure: true,
    });

    expect(stats.objectsIncluded).toBe(2);
    expect(stats.destinationDrainWaits).toBeDefined();
    expect(typeof stats.destinationDrainWaits).toBe("number");
    expect(stats.destinationDrainWaits!).toBeGreaterThanOrEqual(0);
  });

  it("does not set destinationDrainWaits when option is off", async () => {
    const body = Buffer.alloc(100, 3);
    const provider = new MemoryStorageProvider(
      new Map([["pre/x.bin", { body, etag: md5Etag(body) }]]),
    );
    const sink = new Writable({
      write(_c, _e, cb) {
        queueMicrotask(cb);
      },
    });

    const { stats } = await pumpArchiveToWritable(sink, {
      source: "s3://any/pre/",
      format: "zip",
      storageProvider: provider,
    });

    expect(stats.destinationDrainWaits).toBeUndefined();
  });
});
