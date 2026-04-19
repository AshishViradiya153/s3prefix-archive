import { describe, expect, it } from "vitest";
import {
  describeArchiveFailure,
  isS3ArchiveError,
  PathUnsafeError,
  S3ArchiveError,
  summarizeErrorCauses,
} from "../src/errors.js";

describe("S3ArchiveError surface", () => {
  it("preserves code and optional phase/context", () => {
    const e = new S3ArchiveError("bad option", "UNSUPPORTED_OPTION", {
      phase: "bootstrap",
      context: { feature: "zip" },
    });
    expect(e.code).toBe("UNSUPPORTED_OPTION");
    expect(e.phase).toBe("bootstrap");
    expect(e.context).toEqual({ feature: "zip" });
    expect(isS3ArchiveError(e)).toBe(true);
  });

  it("describeArchiveFailure attaches hint for known codes", () => {
    const d = describeArchiveFailure(
      new S3ArchiveError("x", "INVALID_S3_URI", { phase: "bootstrap" }),
    );
    expect(d.library).toBe(true);
    expect(d.code).toBe("INVALID_S3_URI");
    expect(d.hint).toContain("s3://");
    expect(d.causes.length).toBeGreaterThan(0);
  });

  it("PathUnsafeError is library + PATH_UNSAFE", () => {
    const d = describeArchiveFailure(
      new PathUnsafeError('unsafe ".." in path'),
    );
    expect(d.library).toBe(true);
    expect(d.code).toBe("PATH_UNSAFE");
    expect(d.hint).toBeDefined();
  });

  it("describeArchiveFailure handles non-Error throws", () => {
    const d = describeArchiveFailure("string failure");
    expect(d.library).toBe(false);
    expect(d.message).toBe("string failure");
  });

  it("summarizeErrorCauses walks Error.cause", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    const lines = summarizeErrorCauses(outer);
    expect(lines.some((l) => l.includes("outer"))).toBe(true);
    expect(lines.some((l) => l.includes("inner"))).toBe(true);
  });
});
