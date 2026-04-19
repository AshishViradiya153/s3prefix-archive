import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import type { ArchiveExplainStep } from "../src/types.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

function httpError(status: number, message = "err") {
  return Object.assign(new Error(message), {
    $metadata: { httpStatusCode: status },
  });
}

describe("experimentalThroughputAdaptiveZipConcurrency", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("rejects without statsThroughputRollingWindowMs", async () => {
    await expect(
      pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
        source: "s3://bucket/p/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 2,
        experimentalThroughputAdaptiveZipConcurrency: {
          targetReadBytesPerSecond: 500_000,
        },
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
  });

  it("does not lower GetObject cap on S3 throttle (unlike throttle-adaptive mode)", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/a.txt", Size: 2, ETag: '"e"' }],
      IsTruncated: false,
    });
    s3Mock
      .on(GetObjectCommand)
      .rejectsOnce(httpError(429, "SlowDown"))
      .resolves({
        Body: sdkStreamMixin(Readable.from(Buffer.from("ok", "utf8"))),
      });

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/p/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 4,
        statsThroughputRollingWindowMs: 60_000,
        experimentalThroughputAdaptiveZipConcurrency: {
          targetReadBytesPerSecond: 50_000,
          sampleMinIntervalMs: 50,
        },
        retry: { maxAttempts: 5 },
      },
    );

    expect(stats.throughputAdaptiveZipTargetReadBytesPerSecond).toBe(50_000);
    expect(stats.adaptiveZipConcurrencyFinalCap).toBe(4);
    expect(stats.adaptiveZipConcurrencyMinCap).toBe(4);
    expect(stats.zipGetObjectMaxQueueDepth).toBeDefined();
    expect(stats.zipGetObjectMaxActiveConcurrent).toBeDefined();
  });

  it("records throughput adaptive settings in explain archive.config", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/x.txt", Size: 1 }],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("z", "utf8"))),
    });

    const { explainTrace } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/p/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 2,
        explain: true,
        statsThroughputRollingWindowMs: 10_000,
        experimentalThroughputAdaptiveZipConcurrency: {
          targetReadBytesPerSecond: 1_000_000,
        },
      },
    );

    const cfg = explainTrace!.find(
      (s) => s.kind === "archive.config",
    ) as Extract<ArchiveExplainStep, { kind: "archive.config" }>;
    expect(cfg.experimentalThroughputAdaptiveZipConcurrency).toBe(true);
    expect(cfg.throughputAdaptiveZipTargetReadBytesPerSecond).toBe(1_000_000);
    expect(cfg.experimentalAdaptiveZipConcurrency).toBe(false);
    expect(cfg.adaptiveZipConcurrencyRecoveryTickMs).toBe(0);
    expect(cfg.adaptiveZipConcurrencyRecoveryQuietMs).toBe(0);
  });
});
