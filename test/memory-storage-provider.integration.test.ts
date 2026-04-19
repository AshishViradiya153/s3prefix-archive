import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ArchiveExplainStep } from "../src/types.js";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("MemoryStorageProvider + storageProvider", () => {
  it("archives from injected map without S3 client", async () => {
    const body = Buffer.from("hello", "utf8");
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    const provider = new MemoryStorageProvider(
      new Map([
        [
          "pre/a.txt",
          {
            body,
            etag,
          },
        ],
      ]),
    );

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://anybucket/pre/",
        format: "zip",
        concurrency: 1,
        storageProvider: provider,
      },
    );

    expect(stats.objectsIncluded).toBe(1);
    expect(stats.bytesRead).toBe(body.length);
    expect(stats.s3ListObjectsV2Requests).toBeUndefined();
    expect(stats.s3GetObjectRequests).toBeUndefined();
  });

  it("explain archive.config marks injectedStorageProvider", async () => {
    const body = Buffer.from("x", "utf8");
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    const provider = new MemoryStorageProvider(
      new Map([["pre/b.txt", { body, etag }]]),
    );

    const { explainTrace } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://anybucket/pre/",
        format: "zip",
        concurrency: 1,
        storageProvider: provider,
        explain: true,
      },
    );

    const cfg = explainTrace?.find((s) => s.kind === "archive.config") as
      | Extract<ArchiveExplainStep, { kind: "archive.config" }>
      | undefined;
    expect(cfg).toBeDefined();
    expect(cfg!.injectedStorageProvider).toBe(true);
    expect(cfg!.maxInFlightReadBytes).toBe(0);
    expect(cfg!.respectDestinationBackpressure).toBe(false);
    expect(cfg!.trackDestinationDrainEvents).toBe(false);
  });
});
