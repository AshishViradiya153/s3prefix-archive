import { describe, expect, it } from "vitest";
import { suggestedCacheControlForArchiveDownload } from "../src/archive-cdn-hints.js";

describe("suggestedCacheControlForArchiveDownload", () => {
  it("returns private max-age", () => {
    expect(suggestedCacheControlForArchiveDownload({ maxAgeSeconds: 60 })).toBe(
      "private, max-age=60",
    );
  });

  it("adds immutable when requested", () => {
    expect(
      suggestedCacheControlForArchiveDownload({
        maxAgeSeconds: 0,
        immutable: true,
      }),
    ).toBe("private, max-age=0, immutable");
  });
});
