import { describe, expect, it } from "vitest";
import {
  assertAdditionalListSourcesMatchCheckpoint,
  canonicalizeAdditionalListSources,
  parseAdditionalListSources,
} from "../src/archive-sources.js";

describe("parseAdditionalListSources", () => {
  it("returns empty when undefined", () => {
    expect(
      parseAdditionalListSources(undefined, { bucket: "a", prefix: "p/" }),
    ).toEqual([]);
  });

  it("rejects duplicate extra roots", () => {
    expect(() =>
      parseAdditionalListSources(["s3://b/pre/", "s3://b/pre/"], {
        bucket: "a",
        prefix: "p/",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ADDITIONAL_SOURCES" }));
  });

  it("rejects repeating the primary source", () => {
    expect(() =>
      parseAdditionalListSources(["s3://my/p/"], {
        bucket: "my",
        prefix: "p/",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ADDITIONAL_SOURCES" }));
  });
});

describe("canonicalizeAdditionalListSources", () => {
  it("sorts URIs for stable checkpoint comparison", () => {
    expect(
      canonicalizeAdditionalListSources(["s3://z/pre/", "s3://a/other/"], {
        bucket: "p",
        prefix: "q/",
      }),
    ).toEqual(["s3://a/other/", "s3://z/pre/"]);
  });
});

describe("assertAdditionalListSourcesMatchCheckpoint", () => {
  const primary = { bucket: "p", prefix: "q/" };

  it("does nothing when loaded matches requested", () => {
    expect(() =>
      assertAdditionalListSourcesMatchCheckpoint(
        ["s3://a/other/", "s3://z/pre/"],
        ["s3://z/pre/", "s3://a/other/"],
        primary,
        "job-1",
      ),
    ).not.toThrow();
  });

  it("throws CHECKPOINT_MISMATCH when lists differ", () => {
    expect(() =>
      assertAdditionalListSourcesMatchCheckpoint(
        ["s3://a/other/"],
        ["s3://z/pre/", "s3://a/other/"],
        primary,
        "job-1",
      ),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_MISMATCH" }));
  });
});
