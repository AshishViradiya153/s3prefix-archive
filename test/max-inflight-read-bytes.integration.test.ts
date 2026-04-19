import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StorageProvider } from "../src/types.js";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

function md5Etag(buf: Buffer): string {
  return `"${createHash("md5").update(buf).digest("hex")}"`;
}

function wrapWithConcurrentGetCount(inner: MemoryStorageProvider): {
  provider: StorageProvider;
  getMaxConcurrent: () => number;
} {
  let concurrent = 0;
  let maxConcurrent = 0;
  const provider: StorageProvider = {
    listObjects: (prefix, opts) => inner.listObjects(prefix, opts),
    async getObjectStream(key, opts) {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const s = await inner.getObjectStream(key, opts);
      const dec = (): void => {
        concurrent -= 1;
      };
      s.on("end", dec);
      s.on("error", dec);
      return s;
    },
  };
  return {
    provider,
    getMaxConcurrent: () => maxConcurrent,
  };
}

describe("maxInFlightReadBytes", () => {
  it("limits overlapping GetObject streams vs ZIP concurrency", async () => {
    const a = Buffer.alloc(100, 1);
    const b = Buffer.alloc(100, 2);
    const inner = new MemoryStorageProvider(
      new Map([
        ["pre/a.bin", { body: a, etag: md5Etag(a) }],
        ["pre/b.bin", { body: b, etag: md5Etag(b) }],
      ]),
    );
    const { provider, getMaxConcurrent } = wrapWithConcurrentGetCount(inner);

    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://any/pre/",
      format: "zip",
      concurrency: 4,
      storageProvider: provider,
      maxInFlightReadBytes: 150,
    });

    expect(getMaxConcurrent()).toBe(1);
  });

  it("allows two concurrent reads when budget fits", async () => {
    const a = Buffer.alloc(100, 1);
    const b = Buffer.alloc(100, 2);
    const inner = new MemoryStorageProvider(
      new Map([
        ["pre/a.bin", { body: a, etag: md5Etag(a) }],
        ["pre/b.bin", { body: b, etag: md5Etag(b) }],
      ]),
    );
    const { provider, getMaxConcurrent } = wrapWithConcurrentGetCount(inner);

    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://any/pre/",
      format: "zip",
      concurrency: 4,
      storageProvider: provider,
      maxInFlightReadBytes: 250,
    });

    expect(getMaxConcurrent()).toBe(2);
  });
});
