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

describe("pumpArchiveToWritable entryMappings", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("uses entryMappings for archive paths", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "pre/a.txt", Size: 1, ETag: '"a"' },
        { Key: "pre/b.txt", Size: 1, ETag: '"b"' },
      ],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).callsFake((input) => {
      const key = input.Key as string;
      const body = key.endsWith("a.txt") ? "A" : "B";
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
        concurrency: 1,
        entryMappings: {
          "s3://bucket/pre/a.txt": "renamed/alpha.txt",
          "pre/b.txt": "beta.txt",
        },
      },
    );

    expect(stats.objectsIncluded).toBe(2);
    expect(stats.objectsListed).toBe(2);
  });
});
