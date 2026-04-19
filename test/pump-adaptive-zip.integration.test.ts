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

describe("experimentalAdaptiveZipConcurrency", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("rejects when format is not zip", async () => {
    await expect(
      pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
        source: "s3://bucket/p/",
        format: "tar",
        client: new S3Client({}),
        experimentalAdaptiveZipConcurrency: true,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
  });

  it("rejects when both throttle- and throughput-adaptive ZIP flags are set", async () => {
    await expect(
      pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
        source: "s3://bucket/p/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 2,
        experimentalAdaptiveZipConcurrency: true,
        experimentalThroughputAdaptiveZipConcurrency: {
          targetReadBytesPerSecond: 1_000_000,
        },
        statsThroughputRollingWindowMs: 1000,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
  });

  it("rejects when ZIP concurrency is 1", async () => {
    await expect(
      pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
        source: "s3://bucket/p/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
        experimentalAdaptiveZipConcurrency: true,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
  });

  it("lowers GetObject cap after throttled GetObject retry and reports stats", async () => {
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
        experimentalAdaptiveZipConcurrency: true,
        adaptiveZipConcurrencyRecoveryMs: 0,
        retry: { maxAttempts: 5 },
      },
    );

    expect(stats.adaptiveZipConcurrencyInitialCap).toBe(4);
    expect(stats.adaptiveZipConcurrencyMinCap).toBe(3);
    expect(stats.adaptiveZipConcurrencyFinalCap).toBe(3);
  });

  it("records adaptive settings in explain archive.config", async () => {
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
        concurrency: 3,
        explain: true,
        experimentalAdaptiveZipConcurrency: true,
        adaptiveZipConcurrencyRecoveryMs: 12_000,
        adaptiveZipConcurrencyRecoveryQuietMs: 9000,
      },
    );

    const cfg = explainTrace!.find(
      (s) => s.kind === "archive.config",
    ) as Extract<ArchiveExplainStep, { kind: "archive.config" }>;
    expect(cfg.experimentalAdaptiveZipConcurrency).toBe(true);
    expect(cfg.adaptiveZipConcurrencyRecoveryTickMs).toBe(12_000);
    expect(cfg.adaptiveZipConcurrencyRecoveryQuietMs).toBe(9000);
  });
});
