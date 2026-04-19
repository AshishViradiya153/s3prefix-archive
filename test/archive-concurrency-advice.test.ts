import { describe, expect, it } from "vitest";
import {
  estimatePipelineOverlapRatio,
  MAX_PIPELINE_OVERLAP_RATIO_CAP,
  suggestZipConcurrencyFromCompletedRun,
} from "../src/archive-concurrency-advice.js";

describe("estimatePipelineOverlapRatio", () => {
  it("returns N·avgPipe / wall", () => {
    expect(
      estimatePipelineOverlapRatio({
        getObjectPipelineSamples: 10,
        averageGetObjectPipelineMs: 500,
        wallDurationMs: 1000,
      }),
    ).toBeCloseTo(5, 6);
  });

  it("returns undefined when samples missing", () => {
    expect(
      estimatePipelineOverlapRatio({
        wallDurationMs: 1000,
        averageGetObjectPipelineMs: 100,
      }),
    ).toBeUndefined();
  });

  it("caps extreme ratios", () => {
    expect(
      estimatePipelineOverlapRatio({
        getObjectPipelineSamples: 1_000_000,
        averageGetObjectPipelineMs: 60_000,
        wallDurationMs: 1,
      }),
    ).toBe(MAX_PIPELINE_OVERLAP_RATIO_CAP);
  });
});

describe("suggestZipConcurrencyFromCompletedRun", () => {
  it("suggests ceil(ρ·headroom) bounded by ceiling", () => {
    const a = suggestZipConcurrencyFromCompletedRun({
      getObjectPipelineSamples: 8,
      averageGetObjectPipelineMs: 250,
      wallDurationMs: 5000,
      ceiling: 16,
      headroomFactor: 1,
    });
    expect(a?.pipelineOverlapRatio).toBeCloseTo(0.4, 6);
    expect(a?.suggestedZipConcurrency).toBe(1);
  });

  it("respects low ceiling", () => {
    const a = suggestZipConcurrencyFromCompletedRun({
      getObjectPipelineSamples: 20,
      averageGetObjectPipelineMs: 1000,
      wallDurationMs: 5000,
      ceiling: 3,
      headroomFactor: 1,
    });
    expect(a?.pipelineOverlapRatio).toBe(4);
    expect(a?.suggestedZipConcurrency).toBe(3);
  });
});
