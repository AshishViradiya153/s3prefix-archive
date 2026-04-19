import { describe, expect, it } from "vitest";
import { folderArchiveJobDataToRunOptions } from "../src/bullmq.js";
import { shouldIncludeObject } from "../src/filters.js";

describe("folderArchiveJobDataToRunOptions", () => {
  it("maps core fields and output type", () => {
    const opts = folderArchiveJobDataToRunOptions({
      source: "s3://b/prefix/",
      output: { bucket: "out", key: "a.zip", contentType: "application/zip" },
      format: "zip",
    });
    expect(opts.source).toBe("s3://b/prefix/");
    expect(opts.output).toEqual({
      type: "s3-multipart",
      bucket: "out",
      key: "a.zip",
      contentType: "application/zip",
    });
    expect(opts.format).toBe("zip");
  });

  it("passes filter strings as micromatch globs", () => {
    const opts = folderArchiveJobDataToRunOptions({
      source: "s3://b/p/",
      output: { bucket: "out", key: "x.zip" },
      filters: { include: ["**/*.txt"], exclude: ["**/*.tmp"] },
    });
    expect(opts.filters?.include).toEqual(["**/*.txt"]);
    expect(opts.filters?.exclude).toEqual(["**/*.tmp"]);
    expect(shouldIncludeObject({ key: "a/b.txt", size: 1 }, opts.filters)).toBe(
      true,
    );
    expect(shouldIncludeObject({ key: "a/b.tmp", size: 1 }, opts.filters)).toBe(
      false,
    );
  });

  it("drops empty glob strings", () => {
    const opts = folderArchiveJobDataToRunOptions({
      source: "s3://b/p/",
      output: { bucket: "out", key: "x.zip" },
      filters: { include: ["", "**/*.txt"], exclude: [""] },
    });
    expect(opts.filters?.include).toEqual(["**/*.txt"]);
    expect(opts.filters?.exclude).toBeUndefined();
  });

  it("passes additionalListSources when present", () => {
    const opts = folderArchiveJobDataToRunOptions({
      source: "s3://b/p/",
      output: { bucket: "out", key: "x.zip" },
      additionalListSources: ["s3://other/pre/"],
    });
    expect(opts.additionalListSources).toEqual(["s3://other/pre/"]);
  });

  it("passes dedupe flags when present", () => {
    const opts = folderArchiveJobDataToRunOptions({
      source: "s3://b/p/",
      output: { bucket: "out", key: "x.zip" },
      dedupeArchivePaths: true,
      dedupeContentByEtag: true,
    });
    expect(opts.dedupeArchivePaths).toBe(true);
    expect(opts.dedupeContentByEtag).toBe(true);
  });

  it("passes entryMappings when present", () => {
    const opts = folderArchiveJobDataToRunOptions({
      source: "s3://b/p/",
      output: { bucket: "out", key: "x.zip" },
      entryMappings: { "p/x": "y/z.txt" },
    });
    expect(opts.entryMappings).toEqual({ "p/x": "y/z.txt" });
  });

  it("passes experimental adaptive ZIP options when present", () => {
    const opts = folderArchiveJobDataToRunOptions({
      source: "s3://b/p/",
      output: { bucket: "out", key: "x.zip" },
      concurrency: 3,
      experimentalAdaptiveZipConcurrency: true,
      adaptiveZipConcurrencyRecoveryMs: 0,
      adaptiveZipConcurrencyRecoveryQuietMs: 5000,
    });
    expect(opts.experimentalAdaptiveZipConcurrency).toBe(true);
    expect(opts.adaptiveZipConcurrencyRecoveryMs).toBe(0);
    expect(opts.adaptiveZipConcurrencyRecoveryQuietMs).toBe(5000);
  });

  it("passes S3 timeout and retry trace options when present", () => {
    const opts = folderArchiveJobDataToRunOptions({
      source: "s3://b/p/",
      output: { bucket: "out", key: "x.zip" },
      s3RequestTimeoutMs: 60_000,
      statsRecentS3RetriesMax: 12,
    });
    expect(opts.s3RequestTimeoutMs).toBe(60_000);
    expect(opts.statsRecentS3RetriesMax).toBe(12);
  });

  it("merges checkpoint and client from context", () => {
    const store = { load: async () => null, save: async () => {} };
    const ac = new AbortController();
    const client = {} as import("@aws-sdk/client-s3").S3Client;
    const opts = folderArchiveJobDataToRunOptions(
      { source: "s3://b/p/", output: { bucket: "o", key: "k" } },
      { client, signal: ac.signal, checkpoint: { jobId: "j1", store } },
    );
    expect(opts.client).toBe(client);
    expect(opts.signal).toBe(ac.signal);
    expect(opts.checkpoint?.jobId).toBe("j1");
    expect(opts.checkpoint?.store).toBe(store);
  });
});
