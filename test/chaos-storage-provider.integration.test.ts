import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";
import {
  CHAOS_GET_OBJECT_FAIL,
  ChaosMemoryStorageProvider,
} from "./chaos-memory-storage-provider.js";

describe("ChaosMemoryStorageProvider (resilience harness)", () => {
  it("adds latency before the object stream without failing the run", async () => {
    const body = Buffer.from("hello", "utf8");
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    const provider = new ChaosMemoryStorageProvider(
      new Map([["pre/a.txt", { body, etag }]]),
      { getObjectLatencyMs: 25 },
    );

    const t0 = Date.now();
    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://anybucket/pre/",
        format: "zip",
        concurrency: 1,
        storageProvider: provider,
      },
    );
    expect(Date.now() - t0).toBeGreaterThanOrEqual(20);
    expect(stats.objectsIncluded).toBe(1);
    expect(stats.bytesRead).toBe(body.length);
  });

  it("injected getObject failure fails fast by default", async () => {
    const body = Buffer.from("x", "utf8");
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    const provider = new ChaosMemoryStorageProvider(
      new Map([["pre/a.txt", { body, etag }]]),
      { failGetObjectWith: new Error(CHAOS_GET_OBJECT_FAIL) },
    );

    // Use `tar` so GetObject is not wrapped in the ZIP-only inner `p-limit` (nested limiters can
    // surface an extra rejection in Vitest while the pump still fails correctly for `zip`).
    await expect(
      pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
        source: "s3://anybucket/pre/",
        format: "tar",
        concurrency: 1,
        storageProvider: provider,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(CHAOS_GET_OBJECT_FAIL),
    });
  });

  it("injected getObject failure is omitted under best-effort", async () => {
    const body = Buffer.from("x", "utf8");
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    const provider = new ChaosMemoryStorageProvider(
      new Map([["pre/a.txt", { body, etag }]]),
      { failGetObjectWith: new Error(CHAOS_GET_OBJECT_FAIL) },
    );

    const { stats, omissions } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://anybucket/pre/",
        format: "tar",
        concurrency: 1,
        storageProvider: provider,
        failureMode: "best-effort",
      },
    );

    expect(stats.objectsIncluded).toBe(0);
    expect(omissions).toHaveLength(1);
    expect(omissions![0]!.reason).toContain(CHAOS_GET_OBJECT_FAIL);
  });
});
