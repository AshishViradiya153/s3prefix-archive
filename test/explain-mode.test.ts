import { describe, expect, it, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import type { ArchiveExplainStep } from "../src/types.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("explain mode", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("buffers explainTrace when explain is true without onExplainStep", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "pre/dir/", Size: 0 },
        { Key: "pre/a.txt", Size: 2, ETag: '"a"' },
      ],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("ok", "utf8"))),
    });

    const { explainTrace, stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/pre/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
        explain: true,
      },
    );

    expect(stats.bottleneck).toBeDefined();
    expect(explainTrace).toBeDefined();
    const kinds = explainTrace!.map((s) => s.kind);
    expect(kinds[0]).toBe("archive.config");
    expect(kinds).toContain("archive.finish-object");
    expect(kinds).toContain("archive.begin-object");
    expect(kinds[kinds.length - 1]).toBe("archive.summary");

    const cfg = explainTrace!.find(
      (s) => s.kind === "archive.config",
    ) as Extract<ArchiveExplainStep, { kind: "archive.config" }>;
    expect(cfg.source).toBe("s3://bucket/pre/");
    expect(cfg.format).toBe("zip");
    expect(cfg.listSource).toBe("ListObjectsV2");
    expect(cfg.additionalListRoots).toBe(0);
    expect(cfg.dedupeArchivePaths).toBe(false);
    expect(cfg.dedupeContentByEtag).toBe(false);
    expect(cfg.deltaBaseline).toBe(false);
    expect(cfg.objectPriority).toBe(false);
    expect(cfg.deterministicOrdering).toBe(false);
    expect(cfg.experimentalAdaptiveZipConcurrency).toBe(false);
    expect(cfg.adaptiveZipConcurrencyRecoveryTickMs).toBe(0);
    expect(cfg.adaptiveZipConcurrencyRecoveryQuietMs).toBe(0);
    expect(cfg.experimentalThroughputAdaptiveZipConcurrency).toBe(false);
    expect(cfg.throughputAdaptiveZipTargetReadBytesPerSecond).toBe(0);
    expect(cfg.verifyGetObjectMd5Etag).toBe(false);
    expect(cfg.injectedStorageProvider).toBe(false);
    expect(cfg.maxInFlightReadBytes).toBe(0);
    expect(cfg.respectDestinationBackpressure).toBe(false);
    expect(cfg.trackDestinationDrainEvents).toBe(false);

    const summary = explainTrace!.find(
      (s) => s.kind === "archive.summary",
    ) as Extract<ArchiveExplainStep, { kind: "archive.summary" }>;
    expect(summary.dominant).toBe(stats.bottleneck);
  });

  it("delivers steps to onExplainStep and omits explainTrace", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "pre/x.txt", Size: 1 }],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("x", "utf8"))),
    });

    const steps: ArchiveExplainStep[] = [];
    const result = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://bucket/pre/",
        format: "zip",
        client: new S3Client({}),
        concurrency: 1,
        explain: true,
        onExplainStep: (s) => steps.push(s),
      },
    );

    expect(result.explainTrace).toBeUndefined();
    expect(steps.map((s) => s.kind)).toEqual([
      "archive.config",
      "archive.begin-object",
      "archive.finish-object",
      "archive.summary",
    ]);
  });
});
