import { describe, expect, it, vi } from "vitest";
import type { ArchiveThroughputSampler } from "../src/archive-throughput.js";
import type { ThroughputAdaptiveZipLimiter } from "../src/archive-adaptive-zip-limit.js";
import { ThroughputZipAdaptiveController } from "../src/archive-throughput-zip-adaptive.js";
import { S3ArchiveError } from "../src/errors.js";

describe("ThroughputZipAdaptiveController", () => {
  it("decreases cap after enough consecutive low-rate samples", () => {
    const sampler = {
      record: vi.fn(),
      snapshot: vi.fn().mockReturnValue({
        rollingBytesReadPerSecond: 40,
        rollingBytesWrittenPerSecond: 0,
      }),
    } satisfies ArchiveThroughputSampler;

    const decreaseCapForExternalSignal = vi.fn();
    const increaseCapTowardMax = vi.fn();
    const limiter: ThroughputAdaptiveZipLimiter = {
      getCap: () => 5,
      getInitialCap: () => 5,
      decreaseCapForExternalSignal,
      increaseCapTowardMax,
    };

    const c = new ThroughputZipAdaptiveController({
      targetReadBytesPerSecond: 100,
      lowWaterMarkRatio: 0.65,
      highWaterMarkRatio: 0.92,
      breachesToDecrease: 2,
      samplesToIncrease: 1,
      sampleMinIntervalMs: 0,
    });

    c.observe({ nowMs: 0, sampler, limiter, log: undefined });
    c.observe({ nowMs: 1000, sampler, limiter, log: undefined });
    expect(decreaseCapForExternalSignal).toHaveBeenCalledTimes(1);
    expect(increaseCapTowardMax).not.toHaveBeenCalled();
  });

  it("increases cap after enough consecutive high-rate samples", () => {
    const sampler = {
      record: vi.fn(),
      snapshot: vi.fn().mockReturnValue({
        rollingBytesReadPerSecond: 95,
        rollingBytesWrittenPerSecond: 0,
      }),
    } satisfies ArchiveThroughputSampler;

    const decreaseCapForExternalSignal = vi.fn();
    const increaseCapTowardMax = vi.fn();
    const limiter: ThroughputAdaptiveZipLimiter = {
      getCap: () => 3,
      getInitialCap: () => 5,
      decreaseCapForExternalSignal,
      increaseCapTowardMax,
    };

    const c = new ThroughputZipAdaptiveController({
      targetReadBytesPerSecond: 100,
      lowWaterMarkRatio: 0.65,
      highWaterMarkRatio: 0.92,
      breachesToDecrease: 1,
      samplesToIncrease: 3,
      sampleMinIntervalMs: 0,
    });

    c.observe({ nowMs: 0, sampler, limiter, log: undefined });
    c.observe({ nowMs: 1000, sampler, limiter, log: undefined });
    c.observe({ nowMs: 2000, sampler, limiter, log: undefined });
    expect(increaseCapTowardMax).toHaveBeenCalledTimes(1);
    expect(decreaseCapForExternalSignal).not.toHaveBeenCalled();
  });

  it("throws on non-positive target", () => {
    expect(
      () =>
        new ThroughputZipAdaptiveController({
          targetReadBytesPerSecond: 0,
        }),
    ).toThrow(S3ArchiveError);
    try {
      new ThroughputZipAdaptiveController({ targetReadBytesPerSecond: 0 });
    } catch (e) {
      expect(e).toMatchObject({ code: "INVALID_THROUGHPUT_CONFIG" });
    }
  });
});
