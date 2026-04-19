import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("verifyGetObjectMd5Etag", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("accepts body matching single-part ETag and reports pipeline timing", async () => {
    const content = Buffer.from("payload", "utf8");
    const md5hex = createHash("md5").update(content).digest("hex");
    const etag = `"${md5hex}"`;

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "p/a.bin", Size: content.length, ETag: etag }],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(content)),
    });

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/p/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
        verifyGetObjectMd5Etag: true,
      },
    );

    expect(stats.objectsIncluded).toBe(1);
    expect(stats.getObjectPipelineSamples).toBe(1);
    expect(stats.averageGetObjectPipelineMs).toBeDefined();
    expect(stats.averageGetObjectPipelineMs!).toBeGreaterThanOrEqual(0);
  });
});
