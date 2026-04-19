import { describe, expect, it } from "vitest";
import {
  assertSafeArchivePath,
  defaultEntryName,
} from "../src/path-normalize.js";
import { PathUnsafeError } from "../src/errors.js";

describe("assertSafeArchivePath", () => {
  it("accepts normal relative paths", () => {
    expect(assertSafeArchivePath("a/b/c.txt")).toBe("a/b/c.txt");
  });

  it("rejects traversal", () => {
    expect(() => assertSafeArchivePath("../evil")).toThrow(PathUnsafeError);
  });
});

describe("defaultEntryName", () => {
  it("strips list prefix from key", () => {
    expect(
      defaultEntryName(
        { key: "exports/2024/file.csv", size: 1 },
        "exports/2024/",
      ),
    ).toBe("file.csv");
  });

  it("uses meta.listPrefix when set", () => {
    expect(
      defaultEntryName(
        { key: "other/pre/a.txt", size: 1, listPrefix: "other/pre/" },
        "ignored/",
      ),
    ).toBe("a.txt");
  });
});
