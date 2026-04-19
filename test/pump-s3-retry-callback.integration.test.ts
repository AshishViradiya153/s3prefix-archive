import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import type { ArchiveS3RetryContext } from "../src/types.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

function httpError(status: number, message = "err") {
  return Object.assign(new Error(message), {
    $metadata: { httpStatusCode: status },
  });
}

describe("retry.onRetry (ArchiveS3RetryContext)", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("fires for GetObject retries with key and bucket", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/a.txt", Size: 2, ETag: '"e"' }],
      IsTruncated: false,
    });

    s3Mock
      .on(GetObjectCommand)
      .rejectsOnce(httpError(503))
      .rejectsOnce(httpError(503))
      .resolves({
        Body: sdkStreamMixin(Readable.from(Buffer.from("hi", "utf8"))),
      });

    const events: ArchiveS3RetryContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/p/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      retry: {
        maxAttempts: 5,
        onRetry: (ctx) => events.push({ ...ctx, error: ctx.error }),
      },
    });

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.operation === "getObject")).toBe(true);
    expect(events.every((e) => e.bucket === "bucket")).toBe(true);
    expect(events.every((e) => e.key === "p/a.txt")).toBe(true);
    expect(events.map((e) => e.attemptNumber)).toEqual([1, 2]);
    expect(events.map((e) => e.retriesLeft)).toEqual([4, 3]);
    expect(events.every((e) => e.kind === "server-error")).toBe(true);
    expect(events.every((e) => e.delayMs > 0)).toBe(true);
  });

  it("fires for ListObjectsV2 retries with prefix", async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .rejectsOnce(httpError(503))
      .resolves({
        Contents: [{ Key: "p/x.bin", Size: 1, ETag: '"x"' }],
        IsTruncated: false,
      });

    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("z", "utf8"))),
    });

    const events: ArchiveS3RetryContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/p/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      retry: {
        maxAttempts: 4,
        onRetry: (ctx) => events.push({ ...ctx, error: ctx.error }),
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.operation).toBe("listObjectsV2");
    expect(events[0]!.bucket).toBe("bucket");
    expect(events[0]!.prefix).toBe("p/");
    expect(events[0]!.attemptNumber).toBe(1);
    expect(events[0]!.retriesLeft).toBe(3);
    expect(events[0]!.kind).toBe("server-error");
  });

  it("classifies 429 as throttle on retry", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/r.txt", Size: 2, ETag: '"r"' }],
      IsTruncated: false,
    });
    s3Mock
      .on(GetObjectCommand)
      .rejectsOnce(httpError(429))
      .resolves({
        Body: sdkStreamMixin(Readable.from(Buffer.from("ok", "utf8"))),
      });

    const events: ArchiveS3RetryContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/p/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      retry: { maxAttempts: 3, onRetry: (ctx) => events.push(ctx) },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("throttle");
  });

  it("fires onS3ThrottleRetry only for throttle-classified retries", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/t.txt", Size: 2, ETag: '"t"' }],
      IsTruncated: false,
    });
    s3Mock
      .on(GetObjectCommand)
      .rejectsOnce(httpError(429))
      .resolves({
        Body: sdkStreamMixin(Readable.from(Buffer.from("ok", "utf8"))),
      });

    const throttles: ArchiveS3RetryContext[] = [];
    const all: ArchiveS3RetryContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/p/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      retry: {
        maxAttempts: 3,
        onRetry: (ctx) => all.push(ctx),
        onS3ThrottleRetry: (ctx) => throttles.push(ctx),
      },
    });

    expect(all).toHaveLength(1);
    expect(throttles).toHaveLength(1);
    expect(throttles[0]!.kind).toBe("throttle");
    expect(throttles[0]!.operation).toBe("getObject");
  });
});
