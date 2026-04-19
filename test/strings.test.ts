import { describe, expect, it } from "vitest";
import { compactNonEmptyStrings } from "../src/strings.js";

describe("compactNonEmptyStrings", () => {
  it("returns undefined for empty or missing input", () => {
    expect(compactNonEmptyStrings(undefined)).toBeUndefined();
    expect(compactNonEmptyStrings([])).toBeUndefined();
    expect(compactNonEmptyStrings(["", ""])).toBeUndefined();
  });

  it("drops empty strings and preserves order", () => {
    expect(compactNonEmptyStrings(["a", "", "b"])).toEqual(["a", "b"]);
  });
});
