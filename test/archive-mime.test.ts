import { describe, expect, it } from "vitest";
import { resolveArchiveContentType } from "../src/archive-mime.js";

describe("resolveArchiveContentType", () => {
  it("uses destination key extension when present", () => {
    expect(resolveArchiveContentType("zip", "path/export.zip")).toMatch(/zip/i);
  });

  it("falls back to format when key has no extension", () => {
    const ct = resolveArchiveContentType(
      "tar.gz",
      "bucket/prefix/no-extension",
    );
    expect(ct).toBeTruthy();
    expect(ct).not.toBe("application/octet-stream");
  });

  it("supports format-only fallback for zip", () => {
    expect(resolveArchiveContentType("zip")).toMatch(/zip/i);
  });
});
