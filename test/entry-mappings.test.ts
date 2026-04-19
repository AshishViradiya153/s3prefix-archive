import { describe, expect, it } from "vitest";
import { buildEntryMappingLookup } from "../src/entry-mappings.js";

describe("buildEntryMappingLookup", () => {
  it("normalizes s3://bucket/key to object key", () => {
    const m = buildEntryMappingLookup(
      { "s3://my-bucket/folder/x.bin": "out/x.bin" },
      "my-bucket",
    );
    expect(m.get("folder/x.bin")).toBe("out/x.bin");
  });

  it("accepts plain object keys", () => {
    const m = buildEntryMappingLookup({ "a/b.txt": "docs/b.txt" }, "any");
    expect(m.get("a/b.txt")).toBe("docs/b.txt");
  });

  it("throws ENTRY_MAPPING_BUCKET_MISMATCH", () => {
    expect(() =>
      buildEntryMappingLookup({ "s3://other-bucket/k": "x" }, "my-bucket"),
    ).toThrowError(
      expect.objectContaining({ code: "ENTRY_MAPPING_BUCKET_MISMATCH" }),
    );
  });

  it("allows other buckets when allowBuckets includes them (composite keys)", () => {
    const m = buildEntryMappingLookup(
      { "s3://b-bucket/obj.bin": "out/x.bin", "plain.txt": "p.txt" },
      "a-bucket",
      { allowBuckets: ["a-bucket", "b-bucket"], compositeMapKeys: true },
    );
    expect(m.get("b-bucket\tobj.bin")).toBe("out/x.bin");
    expect(m.get("a-bucket\tplain.txt")).toBe("p.txt");
  });

  it("throws on empty path", () => {
    expect(() => buildEntryMappingLookup({ k: "  " }, "b")).toThrowError(
      expect.objectContaining({ code: "INVALID_ENTRY_MAPPING" }),
    );
  });
});
