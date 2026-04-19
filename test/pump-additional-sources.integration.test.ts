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

describe("pumpArchiveToWritable additionalListSources", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("lists primary and extra buckets and uses correct GetObject buckets", async () => {
    s3Mock.on(ListObjectsV2Command).callsFake((input) => {
      const b = input.Bucket as string;
      if (b === "bucket-a") {
        return {
          Contents: [{ Key: "pre/a.txt", Size: 1, ETag: '"a"' }],
          IsTruncated: false,
        };
      }
      if (b === "bucket-b") {
        return {
          Contents: [{ Key: "other/b.txt", Size: 1, ETag: '"b"' }],
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    const getBuckets: string[] = [];
    s3Mock.on(GetObjectCommand).callsFake((input) => {
      getBuckets.push(input.Bucket as string);
      const key = input.Key as string;
      const body = key.endsWith("a.txt") ? "A" : "B";
      return {
        Body: sdkStreamMixin(Readable.from(Buffer.from(body, "utf8"))),
      };
    });

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket-a/pre/",
        additionalListSources: ["s3://bucket-b/other/"],
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
      },
    );

    expect(stats.objectsIncluded).toBe(2);
    expect(stats.objectsListed).toBe(2);
    expect(getBuckets.sort()).toEqual(["bucket-a", "bucket-b"]);
  });
});
