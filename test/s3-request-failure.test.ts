import { describe, expect, it } from "vitest";
import { isS3ArchiveError } from "../src/errors.js";
import { s3RequestFailed } from "../src/s3-request-failure.js";

describe("s3RequestFailed", () => {
  it("wraps list failures with phase list and AWS metadata in context", () => {
    const inner = Object.assign(new Error("AccessDenied"), {
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403, requestId: "rid-1" },
    });
    const e = s3RequestFailed({
      operation: "listObjectsV2",
      bucket: "b",
      prefix: "p/",
      cause: inner,
    });
    expect(isS3ArchiveError(e)).toBe(true);
    expect(e.code).toBe("S3_REQUEST_FAILED");
    expect(e.phase).toBe("list");
    expect(e.context).toMatchObject({
      operation: "listObjectsV2",
      bucket: "b",
      prefix: "p/",
      httpStatusCode: 403,
      requestId: "rid-1",
      name: "AccessDenied",
    });
    expect(e.cause).toBe(inner);
  });

  it("wraps getObject failures with phase getObject", () => {
    const inner = Object.assign(new Error("NotFound"), {
      $metadata: { httpStatusCode: 404 },
    });
    const e = s3RequestFailed({
      operation: "getObject",
      bucket: "b",
      key: "k.bin",
      cause: inner,
    });
    expect(e.phase).toBe("getObject");
    expect(e.context).toMatchObject({
      operation: "getObject",
      bucket: "b",
      key: "k.bin",
      httpStatusCode: 404,
    });
  });
});
