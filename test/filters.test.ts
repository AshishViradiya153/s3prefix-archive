import { describe, expect, it } from "vitest";
import {
  globFiltersForExtensions,
  keyMatchesFilterPattern,
  shouldIncludeObject,
} from "../src/filters.js";

describe("keyMatchesFilterPattern", () => {
  it("matches micromatch globs with dot: true", () => {
    expect(keyMatchesFilterPattern("exports/a.pdf", "**/*.pdf")).toBe(true);
    expect(keyMatchesFilterPattern("exports/a.PDF", "**/*.pdf")).toBe(false);
    expect(keyMatchesFilterPattern(".hidden/x", "**/*")).toBe(true);
  });

  it("matches RegExp", () => {
    expect(keyMatchesFilterPattern("abc", /^ab/)).toBe(true);
    expect(keyMatchesFilterPattern("xbc", /^ab/)).toBe(false);
  });

  it("treats empty string glob as non-match", () => {
    expect(keyMatchesFilterPattern("a", "")).toBe(false);
  });
});

describe("shouldIncludeObject", () => {
  const meta = (key: string, size = 1) => ({ key, size });

  it("applies include globs (OR)", () => {
    expect(
      shouldIncludeObject(meta("a/b.txt"), {
        include: ["**/*.txt", "**/*.md"],
      }),
    ).toBe(true);
    expect(
      shouldIncludeObject(meta("a/b.zip"), {
        include: ["**/*.txt", "**/*.md"],
      }),
    ).toBe(false);
  });

  it("applies exclude globs", () => {
    expect(shouldIncludeObject(meta("a.tmp"), { exclude: ["**/*.tmp"] })).toBe(
      false,
    );
    expect(shouldIncludeObject(meta("a.txt"), { exclude: ["**/*.tmp"] })).toBe(
      true,
    );
  });

  it("supports mixed glob and RegExp", () => {
    expect(
      shouldIncludeObject(meta("prefix/foo"), {
        include: ["prefix/**", /^other/],
      }),
    ).toBe(true);
    expect(
      shouldIncludeObject(meta("other/foo"), {
        include: ["prefix/**", /^other/],
      }),
    ).toBe(true);
    expect(
      shouldIncludeObject(meta("nope/foo"), {
        include: ["prefix/**", /^other/],
      }),
    ).toBe(false);
  });

  it("applies size bounds", () => {
    expect(shouldIncludeObject(meta("k", 5), { minSizeBytes: 10 })).toBe(false);
    expect(
      shouldIncludeObject(meta("k", 15), {
        minSizeBytes: 10,
        maxSizeBytes: 20,
      }),
    ).toBe(true);
  });
});

describe("globFiltersForExtensions", () => {
  it("builds include globs and strips leading dots", () => {
    const f = globFiltersForExtensions(["pdf", ".JPG", "  ", "."]);
    expect(f.include).toEqual(["**/*.pdf", "**/*.jpg"]);
    expect(shouldIncludeObject({ key: "a/b.PDF", size: 1 }, f)).toBe(false);
    expect(shouldIncludeObject({ key: "a/b.jpg", size: 1 }, f)).toBe(true);
  });
});
