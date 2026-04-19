import { describe, expect, it } from "vitest";
import { resolveZipEntryLevel } from "../src/archive-zip-level.js";

describe("resolveZipEntryLevel", () => {
  it("uses base level when threshold is unset", () => {
    expect(resolveZipEntryLevel(6, undefined, 1e9)).toBe(6);
  });

  it("uses STORE (0) when size meets threshold", () => {
    expect(resolveZipEntryLevel(6, 8 * 1024 * 1024, 8 * 1024 * 1024)).toBe(0);
  });

  it("uses base level when size is below threshold", () => {
    expect(resolveZipEntryLevel(6, 100, 99)).toBe(6);
  });

  it("ignores invalid threshold", () => {
    expect(resolveZipEntryLevel(6, NaN, 1e9)).toBe(6);
    expect(resolveZipEntryLevel(6, 0, 1e9)).toBe(6);
  });
});
