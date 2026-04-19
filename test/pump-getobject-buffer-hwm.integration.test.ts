import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES } from "../src/get-object-read-buffer-cap.js";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("getObjectReadBufferHighWaterMark + pump", () => {
  it("archives successfully with a tight per-stream read buffer", async () => {
    const body = Buffer.alloc(120_000, 9);
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    const provider = new MemoryStorageProvider(
      new Map([["pre/big.bin", { body, etag }]]),
    );

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://anybucket/pre/",
        format: "zip",
        concurrency: 1,
        storageProvider: provider,
        getObjectReadBufferHighWaterMark:
          GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES * 8,
      },
    );

    expect(stats.objectsIncluded).toBe(1);
    expect(stats.bytesRead).toBe(body.length);
  });
});
