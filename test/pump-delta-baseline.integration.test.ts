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
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("deltaBaseline", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("skips GetObject when deltaBaseline returns true", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "pre/skip.bin", Size: 1, ETag: '"s"' },
        { Key: "pre/keep.txt", Size: 2, ETag: '"k"' },
      ],
      IsTruncated: false,
    });

    let getCount = 0;
    s3Mock.on(GetObjectCommand).callsFake(() => {
      getCount += 1;
      return {
        Body: sdkStreamMixin(Readable.from(Buffer.from("ok", "utf8"))),
      };
    });

    const ends: ArchiveEntryEndContext[] = [];
    await pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      concurrency: 1,
      deltaBaseline: (m) => m.key.endsWith("skip.bin"),
      onArchiveEntryEnd: (c) => ends.push({ ...c }),
    });

    expect(getCount).toBe(1);
    expect(ends.filter((e) => e.skipReason === "delta-baseline")).toHaveLength(
      1,
    );
    expect(ends.filter((e) => e.outcome === "included")).toHaveLength(1);
  });

  it("records deltaBaseline in explain archive.config", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "pre/a.txt", Size: 1 }],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("x", "utf8"))),
    });

    const { explainTrace } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/pre/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
        explain: true,
        deltaBaseline: () => false,
      },
    );

    const cfg = explainTrace!.find((s) => s.kind === "archive.config") as {
      kind: "archive.config";
      deltaBaseline: boolean;
    };
    expect(cfg.deltaBaseline).toBe(true);
  });
});
