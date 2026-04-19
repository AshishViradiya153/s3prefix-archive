import { describe, expect, it } from "vitest";
import { parseS3Uri } from "../src/s3-uri.js";
import { S3ArchiveError } from "../src/errors.js";

describe("parseS3Uri", () => {
  it("parses bucket-only URI", () => {
    expect(parseS3Uri("s3://my-bucket")).toEqual({
      bucket: "my-bucket",
      prefix: "",
    });
  });

  it("parses bucket and prefix", () => {
    expect(parseS3Uri("s3://my-bucket/path/to/folder/")).toEqual({
      bucket: "my-bucket",
      prefix: "path/to/folder/",
    });
  });

  it("trims whitespace", () => {
    expect(parseS3Uri("  s3://b/p  ")).toEqual({ bucket: "b", prefix: "p" });
  });

  it("throws on invalid input", () => {
    expect(() => parseS3Uri("https://example.com")).toThrow(S3ArchiveError);
  });
});
