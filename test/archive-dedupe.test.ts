import { describe, expect, it } from "vitest";
import { objectContentFingerprint } from "../src/archive-dedupe.js";

describe("objectContentFingerprint", () => {
  it("combines normalized etag and size", () => {
    expect(
      objectContentFingerprint({ key: "a", size: 3, etag: '"abc123"' }),
    ).toBe("abc123:3");
  });

  it("returns undefined without etag", () => {
    expect(objectContentFingerprint({ key: "a", size: 1 })).toBeUndefined();
  });

  it("strips weak prefix then quotes", () => {
    expect(objectContentFingerprint({ key: "a", size: 0, etag: 'W/"x"' })).toBe(
      "x:0",
    );
  });

  it("prefixes fingerprint with bucket when meta.bucket is set", () => {
    expect(
      objectContentFingerprint({
        key: "a",
        size: 1,
        etag: '"z"',
        bucket: "b1",
      }),
    ).toBe("b1\tz:1");
  });
});
