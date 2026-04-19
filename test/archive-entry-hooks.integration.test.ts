import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import type {
  ArchiveEntryEndContext,
  ArchiveEntryStartContext,
} from "../src/types.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("onArchiveEntryStart / onArchiveEntryEnd", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("emits skipped without start for directory placeholder", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "pre/dir/", Size: 0 }],
      IsTruncated: false,
    });

    const starts: ArchiveEntryStartContext[] = [];
    const ends: ArchiveEntryEndContext[] = [];

    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      onArchiveEntryStart: (c) => starts.push(c),
      onArchiveEntryEnd: (c) => ends.push(c),
    });

    expect(starts).toHaveLength(0);
    expect(ends).toEqual([
      expect.objectContaining({
        outcome: "skipped",
        skipReason: "directory-placeholder",
      }),
    ]);
  });

  it("emits start then included for each archived object", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "pre/a.txt", Size: 1, ETag: '"a"' },
        { Key: "pre/b.txt", Size: 1, ETag: '"b"' },
      ],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).callsFake((input) => {
      const key = input.Key as string;
      const body = key.endsWith("a.txt") ? "A" : "B";
      return {
        Body: sdkStreamMixin(Readable.from(Buffer.from(body, "utf8"))),
      };
    });

    const starts: ArchiveEntryStartContext[] = [];
    const ends: ArchiveEntryEndContext[] = [];

    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      onArchiveEntryStart: (c) => starts.push({ ...c }),
      onArchiveEntryEnd: (c) => ends.push({ ...c }),
    });

    expect(starts).toHaveLength(2);
    expect(starts.map((s) => s.entryName).sort()).toEqual(["a.txt", "b.txt"]);
    const included = ends.filter((e) => e.outcome === "included");
    expect(included).toHaveLength(2);
    expect(ends.every((e) => e.outcome === "included")).toBe(true);
  });

  it("emits omitted after start when GetObject fails in best-effort", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "pre/x.txt", Size: 1, ETag: '"x"' }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).rejects(new Error("network"));

    const starts: ArchiveEntryStartContext[] = [];
    const ends: ArchiveEntryEndContext[] = [];

    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      failureMode: "best-effort",
      onArchiveEntryStart: (c) => starts.push(c),
      onArchiveEntryEnd: (c) => ends.push(c),
    });

    expect(starts).toHaveLength(1);
    expect(ends).toEqual([
      expect.objectContaining({
        outcome: "omitted",
        failureKind: "getObject",
        entryName: "x.txt",
      }),
    ]);
  });
});
