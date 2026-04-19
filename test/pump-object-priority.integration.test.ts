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

describe("pumpArchiveToWritable objectPriority (ZIP)", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("starts smaller objects before larger ones in list order when objectPriority favors small", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "pre/huge.bin", Size: 1000, ETag: '"h"' },
        { Key: "pre/tiny.txt", Size: 2, ETag: '"t"' },
        { Key: "pre/mid.txt", Size: 50, ETag: '"m"' },
      ],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).callsFake((input) => {
      const key = input.Key as string;
      const body = key.includes("huge")
        ? "x".repeat(1000)
        : key.includes("tiny")
          ? "ok"
          : "y".repeat(50);
      return {
        Body: sdkStreamMixin(Readable.from(Buffer.from(body, "utf8"))),
      };
    });

    const startKeys: string[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      objectPriority: (m) => -m.size,
      objectPriorityBufferMax: 16,
      onArchiveEntryStart: (c) => startKeys.push(c.meta.key),
    });

    expect(startKeys).toEqual(["pre/tiny.txt", "pre/mid.txt", "pre/huge.bin"]);
  });
});
