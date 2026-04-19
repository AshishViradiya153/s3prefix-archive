import { describe, expect, it } from "vitest";
import { ArchivePumpResolvedOptions } from "../src/archive-pump-resolved-options.js";

describe("ArchivePumpResolvedOptions", () => {
  it("rejects dedupe with ZIP concurrency > 1", () => {
    expect(() =>
      ArchivePumpResolvedOptions.from({
        source: "s3://b/p/",
        dedupeArchivePaths: true,
        concurrency: 4,
      }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_OPTION" }));
  });

  it("resolves defaults for zip", () => {
    const r = ArchivePumpResolvedOptions.from({ source: "s3://b/p/" });
    expect(r.format).toBe("zip");
    expect(r.isZip).toBe(true);
    expect(r.zipConcurrency).toBe(2);
    expect(r.wantsPathDedupe).toBe(false);
    expect(r.deterministicOrdering).toBe(false);
  });

  it("deterministicOrdering forces ZIP effective concurrency 1 when omitted", () => {
    const r = ArchivePumpResolvedOptions.from({
      source: "s3://b/p/",
      deterministicOrdering: true,
    });
    expect(r.zipConcurrency).toBe(1);
    expect(r.deterministicOrdering).toBe(true);
  });

  it("rejects deterministicOrdering with ZIP concurrency > 1", () => {
    expect(() =>
      ArchivePumpResolvedOptions.from({
        source: "s3://b/p/",
        deterministicOrdering: true,
        concurrency: 3,
      }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_OPTION" }));
  });

  it("rejects deterministicOrdering with objectPriority", () => {
    expect(() =>
      ArchivePumpResolvedOptions.from({
        source: "s3://b/p/",
        deterministicOrdering: true,
        objectPriority: () => 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_OPTION" }));
  });

  it("rejects invalid zipStoreMinBytes", () => {
    expect(() =>
      ArchivePumpResolvedOptions.from({
        source: "s3://b/p/",
        zipStoreMinBytes: Number.NaN,
      }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_OPTION" }));
  });

  it("accepts zipStoreMinBytes >= 1", () => {
    const r = ArchivePumpResolvedOptions.from({
      source: "s3://b/p/",
      zipStoreMinBytes: 8 * 1024 * 1024,
    });
    expect(r.isZip).toBe(true);
  });
});
