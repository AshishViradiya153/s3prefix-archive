import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRATEGY_HINT_HIGH_RETRY_ATTEMPT_SHARE,
  suggestArchiveRunStrategyHints,
} from "../src/archive-strategy-hints.js";

const base = {
  objectsIncluded: 10,
  bytesRead: 100_000,
  bytesWritten: 95_000,
  listMs: 1,
  downloadMs: 40,
  archiveWriteMs: 5,
  retries: 0,
  bottleneck: "download" as const,
  s3ListObjectsV2Requests: 2,
  s3GetObjectRequests: 10,
};

describe("suggestArchiveRunStrategyHints", () => {
  it("suggests decreasing ZIP concurrency when retry stress is high", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      retries: 8,
      s3ListObjectsV2Requests: 2,
      s3GetObjectRequests: 8,
      bottleneck: "download",
    });
    expect(h.zipGetObjectConcurrency).toBe("decrease");
    expect(h.confidence).toBe("high");
    expect(h.notes.some((n) => n.includes("Retry pressure"))).toBe(true);
  });

  it("suggests increasing ZIP concurrency when retry pressure is low and download dominates", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      retries: 0,
      bottleneck: "download",
      destinationDrainWaits: 0,
    });
    expect(h.zipGetObjectConcurrency).toBe("increase");
    expect(h.destinationBackpressure).toBe("neutral");
  });

  it("holds ZIP concurrency when archive encoding dominates", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      retries: 0,
      bottleneck: "archive-write",
    });
    expect(h.zipGetObjectConcurrency).toBe("hold");
    expect(h.dominantPlane).toBe("archiveEncoding");
  });

  it("marks tar as not applicable for ZIP concurrency", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      format: "tar",
    });
    expect(h.zipGetObjectConcurrency).toBe("notApplicable");
    expect(h.notes.some((n) => n.includes("Tar formats"))).toBe(true);
  });

  it("flags destination coordination when drain waits occurred", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      destinationDrainWaits: 4,
      throughputRollingPace: "read-faster",
    });
    expect(h.destinationBackpressure).toBe("coordinationObserved");
  });

  it("suggests backpressure when read-faster but no drain waits were recorded", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      destinationDrainWaits: 0,
      throughputRollingPace: "read-faster",
    });
    expect(h.destinationBackpressure).toBe("enableMayHelp");
  });

  it("notes adaptive cap reduction when final < initial", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      adaptiveZipConcurrencyInitialCap: 8,
      adaptiveZipConcurrencyFinalCap: 4,
    });
    expect(h.adaptiveZipCapReducedDuringRun).toBe(true);
    expect(h.notes.some((n) => n.includes("Adaptive ZIP"))).toBe(true);
  });

  it("uses stage occupancy share for dominant plane when present", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      bottleneck: "even",
      stageOccupancyShare: {
        list: 0.55,
        download: 0.2,
        archiveWrite: 0.15,
        idle: 0.1,
      },
    });
    expect(h.dominantPlane).toBe("list");
  });

  it("respects custom high σ threshold", () => {
    const h = suggestArchiveRunStrategyHints({
      ...base,
      retries: 2,
      s3ListObjectsV2Requests: 2,
      s3GetObjectRequests: 8,
      highRetryAttemptShare: 0.5,
    });
    // σ = 2/12 ≈ 0.167 — below 0.5 → not high by σ
    expect(h.zipGetObjectConcurrency).not.toBe("decrease");
  });

  it("exports default σ threshold constant", () => {
    expect(DEFAULT_STRATEGY_HINT_HIGH_RETRY_ATTEMPT_SHARE).toBe(0.3);
  });
});
