import { describe, expect, it } from "vitest";
import {
  classifyArchiveRetryStress,
  classifyArchiveRetryStressFromStats,
  DEFAULT_RETRY_STRESS_LOW_MAX_RATIO,
  DEFAULT_RETRY_STRESS_MODERATE_MAX_RATIO,
} from "../src/archive-retry-profile.js";

describe("classifyArchiveRetryStress", () => {
  it("returns undefined when S3 request counts are both absent", () => {
    expect(classifyArchiveRetryStress({ retries: 5 })).toBeUndefined();
    expect(classifyArchiveRetryStress({ retries: 0 })).toBeUndefined();
  });

  it("classifies low when retry ratio is below default low bound", () => {
    const r = classifyArchiveRetryStress({
      retries: 2,
      s3ListObjectsV2Requests: 100,
      s3GetObjectRequests: 100,
    })!;
    expect(r.profile).toBe("low");
    expect(r.retriesPerSuccessfulS3Request).toBeCloseTo(2 / 200, 10);
  });

  it("classifies moderate between default bounds", () => {
    const r = classifyArchiveRetryStress({
      retries: 10,
      s3ListObjectsV2Requests: 100,
      s3GetObjectRequests: 100,
    })!;
    expect(r.profile).toBe("moderate");
    expect(r.retriesPerSuccessfulS3Request).toBeCloseTo(10 / 200, 10);
  });

  it("classifies high at or above moderate bound", () => {
    const r = classifyArchiveRetryStress({
      retries: 100,
      s3ListObjectsV2Requests: 100,
      s3GetObjectRequests: 100,
    })!;
    expect(r.profile).toBe("high");
  });

  it("uses max(1, nOk) when successful request count is zero", () => {
    const r = classifyArchiveRetryStress({
      retries: 3,
      s3ListObjectsV2Requests: 0,
      s3GetObjectRequests: 0,
    })!;
    expect(r.retriesPerSuccessfulS3Request).toBe(3);
    expect(r.profile).toBe("high");
  });

  it("rejects invalid threshold order", () => {
    expect(() =>
      classifyArchiveRetryStress({
        retries: 0,
        s3GetObjectRequests: 1,
        lowMaxRatio: 0.3,
        moderateMaxRatio: 0.1,
      }),
    ).toThrow(TypeError);
  });

  it("rejects negative retries", () => {
    expect(() =>
      classifyArchiveRetryStress({ retries: -1, s3GetObjectRequests: 1 }),
    ).toThrow(TypeError);
  });
});

describe("classifyArchiveRetryStressFromStats", () => {
  it("delegates to classifyArchiveRetryStress", () => {
    expect(
      classifyArchiveRetryStressFromStats({
        retries: 1,
        s3ListObjectsV2Requests: 100,
        s3GetObjectRequests: undefined,
      })?.profile,
    ).toBe("low");
  });
});

describe("default ratio constants", () => {
  it("default tiers are ordered", () => {
    expect(DEFAULT_RETRY_STRESS_LOW_MAX_RATIO).toBeLessThan(
      DEFAULT_RETRY_STRESS_MODERATE_MAX_RATIO,
    );
  });
});
