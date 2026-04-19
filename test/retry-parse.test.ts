import { describe, expect, it } from "vitest";
import { parseArchiveRetryFromCli } from "../src/retry-parse.js";

describe("parseArchiveRetryFromCli", () => {
  it("returns undefined when all fields absent", () => {
    expect(parseArchiveRetryFromCli({})).toBeUndefined();
  });

  it("maps defined string fields to numbers", () => {
    expect(
      parseArchiveRetryFromCli({
        retryMaxAttempts: "5",
        retryBaseMs: "100",
        retryMaxMs: "2000",
      }),
    ).toEqual({ maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 2000 });
  });
});
