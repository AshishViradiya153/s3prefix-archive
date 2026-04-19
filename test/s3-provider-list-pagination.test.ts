import { describe, expect, it, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import pino from "pino";
import { S3StorageProvider } from "../src/s3-provider.js";

describe("S3StorageProvider listObjects pagination", () => {
  const s3Mock = mockClient(S3Client);
  const log = pino({ level: "silent" });

  beforeEach(() => {
    s3Mock.reset();
  });

  it("follows NextContinuationToken until IsTruncated is false", async () => {
    const calls: { ContinuationToken?: string }[] = [];
    s3Mock.on(ListObjectsV2Command).callsFake((input) => {
      calls.push({ ContinuationToken: input.ContinuationToken });
      if (!input.ContinuationToken) {
        return {
          Contents: [{ Key: "p/a.txt", Size: 1, ETag: '"a"' }],
          IsTruncated: true,
          NextContinuationToken: "page2token",
        };
      }
      if (input.ContinuationToken === "page2token") {
        return {
          Contents: [
            { Key: "p/b.txt", Size: 2, ETag: '"b"' },
            { Key: "p/c.txt", Size: 3, ETag: '"c"' },
          ],
          IsTruncated: false,
        };
      }
      throw new Error(
        `unexpected ContinuationToken: ${input.ContinuationToken}`,
      );
    });

    const provider = new S3StorageProvider(
      new S3Client({}),
      "bucket",
      { maxKeys: 1000 },
      { maxAttempts: 1 },
      log,
    );

    const keys: string[] = [];
    for await (const o of provider.listObjects("p/")) {
      keys.push(o.key);
    }

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({});
    expect(calls[1]).toEqual({ ContinuationToken: "page2token" });
    expect(keys.sort()).toEqual(["p/a.txt", "p/b.txt", "p/c.txt"]);
  });
});
