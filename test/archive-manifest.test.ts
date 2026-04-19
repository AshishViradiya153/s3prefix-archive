import { describe, expect, it } from "vitest";
import { encodeArchiveManifestJsonUtf8 } from "../src/archive-manifest.js";

describe("encodeArchiveManifestJsonUtf8", () => {
  it("includes omissions only in best-effort mode", () => {
    const omissions = [{ key: "k", reason: "r" }];
    const failFast = encodeArchiveManifestJsonUtf8({
      source: "s3://b/p/",
      format: "zip",
      objects: [],
      omissions,
      failureMode: "fail-fast",
    });
    expect(JSON.parse(failFast.toString("utf8"))).not.toHaveProperty(
      "omissions",
    );

    const bestEffort = encodeArchiveManifestJsonUtf8({
      source: "s3://b/p/",
      format: "zip",
      objects: [],
      omissions,
      failureMode: "best-effort",
    });
    expect(JSON.parse(bestEffort.toString("utf8")).omissions).toEqual(
      omissions,
    );
  });
});
