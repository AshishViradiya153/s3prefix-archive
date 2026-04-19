import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import type { ArchiveEntryEndContext } from "../src/types.js";
import type { CheckpointState, CheckpointStore } from "../src/checkpoint.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("pump dedupe", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("dedupeArchivePaths skips second key that maps to the same entry path", async () => {
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

    const ends: ArchiveEntryEndContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      dedupeArchivePaths: true,
      entryMappings: {
        "pre/a.txt": "out.txt",
        "pre/b.txt": "out.txt",
      },
      onArchiveEntryEnd: (c) => ends.push({ ...c }),
    });

    const included = ends.filter((e) => e.outcome === "included");
    const dup = ends.filter((e) => e.skipReason === "duplicate-entry-path");
    expect(included).toHaveLength(1);
    expect(dup).toHaveLength(1);
    expect(dup[0]?.entryName).toBe("out.txt");
  });

  it("dedupeContentByEtag skips second object with same etag and size", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "pre/one.bin", Size: 4, ETag: '"same"' },
        { Key: "pre/two.bin", Size: 4, ETag: '"same"' },
      ],
      IsTruncated: false,
    });
    let getCount = 0;
    s3Mock.on(GetObjectCommand).callsFake(() => {
      getCount += 1;
      return {
        Body: sdkStreamMixin(Readable.from(Buffer.from("data", "utf8"))),
      };
    });

    const ends: ArchiveEntryEndContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      dedupeContentByEtag: true,
      onArchiveEntryEnd: (c) => ends.push({ ...c }),
    });

    expect(getCount).toBe(1);
    expect(ends.filter((e) => e.outcome === "included")).toHaveLength(1);
    expect(
      ends.filter((e) => e.skipReason === "duplicate-content"),
    ).toHaveLength(1);
  });

  it("checkpoint resume restores path dedupe so a new key mapping to the same entry is skipped", async () => {
    const checkpointRef: { current: CheckpointState | null } = {
      current: null,
    };
    const store: CheckpointStore = {
      load: async () => checkpointRef.current,
      save: async (_id, s) => {
        checkpointRef.current = JSON.parse(
          JSON.stringify(s),
        ) as CheckpointState;
      },
    };

    let listCalls = 0;
    s3Mock.on(ListObjectsV2Command).callsFake(() => {
      listCalls += 1;
      if (listCalls === 1) {
        return {
          Contents: [{ Key: "pre/a.txt", Size: 1, ETag: '"a"' }],
          IsTruncated: false,
        };
      }
      return {
        Contents: [
          { Key: "pre/a.txt", Size: 1, ETag: '"a"' },
          { Key: "pre/b.txt", Size: 1, ETag: '"b"' },
        ],
        IsTruncated: false,
      };
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("x", "utf8"))),
    });

    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      dedupeArchivePaths: true,
      entryMappings: { "pre/a.txt": "out.txt", "pre/b.txt": "out.txt" },
      checkpoint: { jobId: "j1", store },
    });

    const afterFirst = checkpointRef.current;
    if (!afterFirst)
      throw new Error("expected checkpoint state after first pump");
    expect(afterFirst.completedKeys).toEqual(["pre/a.txt"]);
    expect(afterFirst.resumeDedupe?.entries).toEqual([
      { entryName: "out.txt" },
    ]);

    let getCount = 0;
    s3Mock.on(GetObjectCommand).callsFake(() => {
      getCount += 1;
      return {
        Body: sdkStreamMixin(Readable.from(Buffer.from("y", "utf8"))),
      };
    });

    const ends: ArchiveEntryEndContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      dedupeArchivePaths: true,
      entryMappings: { "pre/a.txt": "out.txt", "pre/b.txt": "out.txt" },
      checkpoint: { jobId: "j1", store },
      onArchiveEntryEnd: (c) => ends.push({ ...c }),
    });

    expect(getCount).toBe(0);
    expect(ends.filter((e) => e.skipReason === "checkpoint")).toHaveLength(1);
    expect(
      ends.filter((e) => e.skipReason === "duplicate-entry-path"),
    ).toHaveLength(1);
  });

  it("checkpoint resume restores content dedupe metadata", async () => {
    const checkpointRef: { current: CheckpointState | null } = {
      current: null,
    };
    const store: CheckpointStore = {
      load: async () => checkpointRef.current,
      save: async (_id, s) => {
        checkpointRef.current = JSON.parse(
          JSON.stringify(s),
        ) as CheckpointState;
      },
    };

    let listCalls = 0;
    s3Mock.on(ListObjectsV2Command).callsFake(() => {
      listCalls += 1;
      if (listCalls === 1) {
        return {
          Contents: [{ Key: "pre/one.bin", Size: 4, ETag: '"same"' }],
          IsTruncated: false,
        };
      }
      return {
        Contents: [
          { Key: "pre/one.bin", Size: 4, ETag: '"same"' },
          { Key: "pre/two.bin", Size: 4, ETag: '"same"' },
        ],
        IsTruncated: false,
      };
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("data", "utf8"))),
    });

    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      dedupeContentByEtag: true,
      checkpoint: { jobId: "j2", store },
    });

    const afterFirst = checkpointRef.current;
    if (!afterFirst)
      throw new Error("expected checkpoint state after first pump");
    expect(afterFirst.completedKeys).toEqual(["pre/one.bin"]);
    expect(afterFirst.resumeDedupe?.entries?.[0]?.entryName).toBe("one.bin");
    expect(afterFirst.resumeDedupe?.entries?.[0]?.contentFp).toBeDefined();

    let getCount = 0;
    s3Mock.on(GetObjectCommand).callsFake(() => {
      getCount += 1;
      return {
        Body: sdkStreamMixin(Readable.from(Buffer.from("data", "utf8"))),
      };
    });

    const ends: ArchiveEntryEndContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      dedupeContentByEtag: true,
      checkpoint: { jobId: "j2", store },
      onArchiveEntryEnd: (c) => ends.push({ ...c }),
    });

    expect(getCount).toBe(0);
    expect(ends.filter((e) => e.skipReason === "checkpoint")).toHaveLength(1);
    expect(
      ends.filter((e) => e.skipReason === "duplicate-content"),
    ).toHaveLength(1);
  });

  it("throws CHECKPOINT_DEDUPE_RESUME when checkpoint has keys but no resumeDedupe for dedupe options", async () => {
    const store: CheckpointStore = {
      load: async () => ({
        version: 1,
        bucket: "bucket",
        prefix: "pre/",
        format: "zip",
        completedKeys: ["pre/a.txt"],
      }),
      save: async () => {},
    };

    s3Mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [], IsTruncated: false });

    await expect(
      pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
        source: "s3://bucket/pre/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
        dedupeArchivePaths: true,
        entryMappings: { "pre/a.txt": "out.txt" },
        checkpoint: { jobId: "j", store },
      }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_DEDUPE_RESUME" });
  });
});
