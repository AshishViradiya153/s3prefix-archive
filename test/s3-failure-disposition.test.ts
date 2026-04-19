import { describe, expect, it } from "vitest";
import { S3ArchiveError } from "../src/errors.js";
import { classifyTerminalS3Failure } from "../src/s3-failure-disposition.js";

describe("classifyTerminalS3Failure", () => {
  it("classifies S3_REQUEST_FAILED by httpStatusCode", () => {
    expect(
      classifyTerminalS3Failure(
        new S3ArchiveError("x", "S3_REQUEST_FAILED", {
          context: { httpStatusCode: 403 },
        }),
      ),
    ).toBe("permanent_client");
    expect(
      classifyTerminalS3Failure(
        new S3ArchiveError("x", "S3_REQUEST_FAILED", {
          context: { httpStatusCode: 503 },
        }),
      ),
    ).toBe("transient");
    expect(
      classifyTerminalS3Failure(
        new S3ArchiveError("x", "S3_REQUEST_FAILED", {
          context: { httpStatusCode: 429 },
        }),
      ),
    ).toBe("throttle");
  });

  it("classifies raw SDK errors with $metadata", () => {
    const e403 = Object.assign(new Error("Forbidden"), {
      $metadata: { httpStatusCode: 403 },
    });
    expect(classifyTerminalS3Failure(e403)).toBe("permanent_client");
    const e503 = Object.assign(new Error("SlowDown"), {
      $metadata: { httpStatusCode: 503 },
    });
    expect(classifyTerminalS3Failure(e503)).toBe("transient");
  });
});
