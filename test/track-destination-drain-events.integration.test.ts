import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";

function md5Etag(buf: Buffer): string {
  return `"${createHash("md5").update(buf).digest("hex")}"`;
}

describe("trackDestinationDrainEvents", () => {
  it("sets destinationDrainEventCount on ArchiveStats when enabled", async () => {
    const body = Buffer.alloc(4_000, 9);
    const provider = new MemoryStorageProvider(
      new Map([["pre/x.bin", { body, etag: md5Etag(body) }]]),
    );
    const sink = new Writable({
      highWaterMark: 256,
      write(_c, _e, cb) {
        queueMicrotask(cb);
      },
    });

    const { stats } = await pumpArchiveToWritable(sink, {
      source: "s3://any/pre/",
      format: "zip",
      storageProvider: provider,
      trackDestinationDrainEvents: true,
    });

    expect(stats.objectsIncluded).toBe(1);
    expect(stats.destinationDrainEventCount).toBeDefined();
    expect(typeof stats.destinationDrainEventCount).toBe("number");
    expect(stats.destinationDrainEventCount!).toBeGreaterThanOrEqual(0);
  });

  it("omits destinationDrainEventCount when disabled", async () => {
    const body = Buffer.alloc(100, 1);
    const provider = new MemoryStorageProvider(
      new Map([["pre/y.bin", { body, etag: md5Etag(body) }]]),
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

    expect(stats.destinationDrainEventCount).toBeUndefined();
  });
});
