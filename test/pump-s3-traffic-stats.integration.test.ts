import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

function httpError(status: number, message = "err") {
  return Object.assign(new Error(message), {
    $metadata: { httpStatusCode: status },
  });
}

describe("ArchiveStats S3 traffic counters", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("counts successful ListObjectsV2 pages and GetObject opens", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/a.txt", Size: 1, ETag: '"a"' }],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("x", "utf8"))),
    });

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/p/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
      },
    );

    expect(stats.s3ListObjectsV2Requests).toBe(1);
    expect(stats.s3GetObjectRequests).toBe(1);
    expect(stats.s3RetriesListObjectsV2).toBe(0);
    expect(stats.s3RetriesGetObject).toBe(0);
    expect(stats.retries).toBe(0);
  });

  it("splits retries by operation and optional recent trace", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/a.txt", Size: 1, ETag: '"a"' }],
      IsTruncated: false,
    });
    s3Mock
      .on(GetObjectCommand)
      .rejectsOnce(httpError(503))
      .resolves({
        Body: sdkStreamMixin(Readable.from(Buffer.from("o", "utf8"))),
      });

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/p/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
        retry: { maxAttempts: 4 },
        statsRecentS3RetriesMax: 8,
      },
    );

    expect(stats.retries).toBe(1);
    expect(stats.s3RetriesGetObject).toBe(1);
    expect(stats.s3RetriesListObjectsV2).toBe(0);
    expect(stats.s3GetObjectRequests).toBe(1);
    expect(stats.recentS3Retries).toHaveLength(1);
    expect(stats.recentS3Retries![0]).toMatchObject({
      operation: "getObject",
      key: "p/a.txt",
    });
  });
});
