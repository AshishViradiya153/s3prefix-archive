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

/**
 * Next-queue: **list pagination + full pump** — two ListObjectsV2 pages, then GetObject per key → ZIP.
 */
describe("pumpArchiveToWritable list pagination (e2e mock)", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("archives objects spanning two list pages", async () => {
    s3Mock.on(ListObjectsV2Command).callsFake((input) => {
      if (!input.ContinuationToken) {
        return {
          Contents: [{ Key: "pre/a.txt", Size: 2, ETag: '"a"' }],
          IsTruncated: true,
          NextContinuationToken: "tok-2",
        };
      }
      if (input.ContinuationToken === "tok-2") {
        return {
          Contents: [{ Key: "pre/b.txt", Size: 2, ETag: '"b"' }],
          IsTruncated: false,
        };
      }
      throw new Error("unexpected list token");
    });

    s3Mock.on(GetObjectCommand).callsFake((input) => {
      const body =
        input.Key === "pre/a.txt"
          ? "aa"
          : input.Key === "pre/b.txt"
            ? "bb"
            : "";
      return {
        Body: sdkStreamMixin(Readable.from(Buffer.from(body, "utf8"))),
      };
    });

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/pre/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 2,
      },
    );

    expect(stats.objectsIncluded).toBe(2);
    expect(stats.s3ListObjectsV2Requests).toBe(2);
    expect(stats.s3GetObjectRequests).toBe(2);
  });
});
