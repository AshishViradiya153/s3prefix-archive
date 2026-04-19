import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import pino from "pino";
import { S3StorageProvider } from "../src/s3-provider.js";
import { isS3ArchiveError, type CaughtValue } from "../src/errors.js";

function httpError(status: number, message = "err") {
  return Object.assign(new Error(message), {
    $metadata: { httpStatusCode: status },
  });
}

describe("S3StorageProvider terminal S3 failures", () => {
  const s3Mock = mockClient(S3Client);
  const log = pino({ level: "silent" });

  beforeEach(() => {
    s3Mock.reset();
  });

  it("wraps ListObjectsV2 NoSuchBucket (invalid bucket) as S3_REQUEST_FAILED", async () => {
    const err = Object.assign(
      new Error("The specified bucket does not exist"),
      {
        name: "NoSuchBucket",
        $metadata: { httpStatusCode: 404, requestId: "rid-nb" },
      },
    );
    s3Mock.on(ListObjectsV2Command).rejects(err);

    const provider = new S3StorageProvider(
      new S3Client({}),
      "missing-bucket",
      { maxKeys: 1000 },
      { maxAttempts: 1 },
      log,
    );

    try {
      for await (const _ of provider.listObjects("p/")) {
        /* drain */
      }
      expect.fail("expected list to throw");
    } catch (e) {
      const thrown = e as CaughtValue;
      expect(isS3ArchiveError(thrown)).toBe(true);
      if (!isS3ArchiveError(thrown)) return;
      expect(thrown.code).toBe("S3_REQUEST_FAILED");
      expect(thrown.phase).toBe("list");
      expect(thrown.context).toMatchObject({
        operation: "listObjectsV2",
        bucket: "missing-bucket",
        httpStatusCode: 404,
      });
    }
  });

  it("wraps ListObjectsV2 failure as S3_REQUEST_FAILED", async () => {
    s3Mock.on(ListObjectsV2Command).rejects(httpError(403, "Forbidden"));

    const provider = new S3StorageProvider(
      new S3Client({}),
      "bucket",
      { maxKeys: 1000 },
      { maxAttempts: 1 },
      log,
    );

    try {
      for await (const _ of provider.listObjects("p/")) {
        /* drain */
      }
      expect.fail("expected list to throw");
    } catch (e) {
      const thrown = e as CaughtValue;
      expect(isS3ArchiveError(thrown)).toBe(true);
      if (!isS3ArchiveError(thrown)) return;
      expect(thrown.code).toBe("S3_REQUEST_FAILED");
      expect(thrown.phase).toBe("list");
      expect(thrown.context).toMatchObject({
        operation: "listObjectsV2",
        bucket: "bucket",
        prefix: "p/",
        httpStatusCode: 403,
      });
      expect(thrown.cause).toBeDefined();
    }
  });

  it("wraps GetObject failure as S3_REQUEST_FAILED", async () => {
    s3Mock.on(GetObjectCommand).rejects(httpError(404, "Not Found"));

    const provider = new S3StorageProvider(
      new S3Client({}),
      "bucket",
      { maxKeys: 1000 },
      { maxAttempts: 1 },
      log,
    );

    try {
      await provider.getObjectStream("missing.bin");
      expect.fail("expected getObject to throw");
    } catch (e) {
      const thrown = e as CaughtValue;
      expect(isS3ArchiveError(thrown)).toBe(true);
      if (!isS3ArchiveError(thrown)) return;
      expect(thrown.code).toBe("S3_REQUEST_FAILED");
      expect(thrown.phase).toBe("getObject");
      expect(thrown.context).toMatchObject({
        operation: "getObject",
        bucket: "bucket",
        key: "missing.bin",
        httpStatusCode: 404,
      });
    }
  });

  it("does not wrap GetObject body errors from toNodeReadable", async () => {
    const emptyBody = {
      $metadata: {},
      Body: null,
    };
    // @ts-expect-error Mock omits full output shape; Body null excluded from SDK union
    s3Mock.on(GetObjectCommand).resolves(emptyBody);

    const provider = new S3StorageProvider(
      new S3Client({}),
      "bucket",
      { maxKeys: 1000 },
      { maxAttempts: 1 },
      log,
    );

    await expect(provider.getObjectStream("x")).rejects.toMatchObject({
      code: "GET_OBJECT_EMPTY_BODY",
    });
  });

  it("returns stream when GetObject succeeds", async () => {
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("ok"))),
    });

    const provider = new S3StorageProvider(
      new S3Client({}),
      "bucket",
      { maxKeys: 1000 },
      { maxAttempts: 1 },
      log,
    );

    const stream = await provider.getObjectStream("a.txt");
    expect(stream).toBeDefined();
    expect(typeof stream.read).toBe("function");
  });
});
