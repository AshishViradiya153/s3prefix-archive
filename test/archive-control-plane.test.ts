import { describe, expect, it } from "vitest";
import type { ArchiveStats } from "../src/types.js";
import { summarizeArchiveControlPlaneSnapshot } from "../src/archive-control-plane.js";

describe("summarizeArchiveControlPlaneSnapshot", () => {
  it("merges strategy hints and zip concurrency advice", () => {
    const snap = summarizeArchiveControlPlaneSnapshot({
      stats: {
        objectsListed: 5,
        objectsIncluded: 5,
        objectsSkipped: 0,
        bytesRead: 5000,
        bytesWritten: 4000,
        listMs: 1,
        downloadMs: 100,
        archiveWriteMs: 50,
        retries: 0,
        bottleneck: "download",
        s3ListObjectsV2Requests: 1,
        s3GetObjectRequests: 5,
        averageGetObjectPipelineMs: 100,
        getObjectPipelineSamples: 5,
        wallDurationMs: 500,
      } as ArchiveStats,
      ceiling: 8,
      format: "zip",
    });
    expect(snap.strategyHints.zipGetObjectConcurrency).toBeDefined();
    expect(
      snap.zipConcurrencyAdvice?.suggestedZipConcurrency,
    ).toBeGreaterThanOrEqual(1);
    expect(snap.combinedNotes.length).toBeGreaterThan(0);
  });
});
