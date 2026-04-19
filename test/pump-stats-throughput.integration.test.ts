import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import type { ArchiveStats } from "../src/types.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("ArchiveStats throughput fields", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("sets averages and rolling rates when statsThroughputRollingWindowMs is set", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/a.txt", Size: 2, ETag: '"x"' }],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("ok", "utf8"))),
    });

    let stats: ArchiveStats | undefined;
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/p/",
      format: "tar",
      client: new S3Client({}),
      statsThroughputRollingWindowMs: 60_000,
      onStats: (s) => {
        stats = s;
      },
    });

    expect(stats!.wallDurationMs).toBeGreaterThan(0);
    expect(stats!.averageBytesReadPerSecond).toBeGreaterThan(0);
    expect(stats!.averageBytesWrittenPerSecond).toBeGreaterThan(0);
    expect(stats!.statsThroughputRollingWindowMs).toBe(60_000);
    expect(stats!.rollingBytesReadPerSecond).toBeGreaterThanOrEqual(0);
    expect(stats!.rollingBytesWrittenPerSecond).toBeGreaterThanOrEqual(0);
    expect(stats!.throughputRollingReadMinusWriteBytesPerSecond).toBeDefined();
    expect(stats!.throughputRollingReadMinusWriteBytesPerSecond).toBeCloseTo(
      stats!.rollingBytesReadPerSecond! - stats!.rollingBytesWrittenPerSecond!,
      6,
    );
    expect(stats!.throughputRollingPace).toMatch(
      /^(balanced|read-faster|write-faster)$/,
    );
    expect(stats!.stageOccupancyShare).toBeDefined();
    const sh = stats!.stageOccupancyShare!;
    expect(sh.list + sh.download + sh.archiveWrite + sh.idle).toBeCloseTo(
      1,
      10,
    );
  });
});
