import { describe, expect, it } from "vitest";
import {
  computeS3WorkloadUnits,
  DEFAULT_S3_WORKLOAD_WEIGHTS,
  estimateS3ApiRequestCostUsd,
  usdPerRequestFromPerThousand,
} from "../src/s3-workload-units.js";

describe("computeS3WorkloadUnits", () => {
  it("returns undefined when list and get counts are absent", () => {
    expect(computeS3WorkloadUnits({ retries: 3 })).toBeUndefined();
  });

  it("applies default linear weights", () => {
    expect(
      computeS3WorkloadUnits(
        {
          s3ListObjectsV2Requests: 2,
          s3GetObjectRequests: 10,
          retries: 4,
        },
        DEFAULT_S3_WORKLOAD_WEIGHTS,
      ),
    ).toBe(2 * 1 + 10 * 1 + 4 * 0.25);
  });

  it("treats missing list or get as zero when the other is present", () => {
    expect(computeS3WorkloadUnits({ s3GetObjectRequests: 5, retries: 0 })).toBe(
      5,
    );
  });
});

describe("estimateS3ApiRequestCostUsd", () => {
  const pricing = {
    usdPerListObjectsV2Request: 0.0005,
    usdPerGetObjectRequest: 0.0004,
  } as const;

  it("returns undefined when list and get counts are absent", () => {
    expect(
      estimateS3ApiRequestCostUsd({ retries: 2 }, pricing),
    ).toBeUndefined();
  });

  it("computes linear USD from list, get, and optional retry rate", () => {
    expect(
      estimateS3ApiRequestCostUsd(
        {
          s3ListObjectsV2Requests: 2,
          s3GetObjectRequests: 10,
          retries: 4,
        },
        { ...pricing, usdPerRetryAttempt: 0.0001 },
      ),
    ).toBeCloseTo(2 * 0.0005 + 10 * 0.0004 + 4 * 0.0001, 10);
  });

  it("defaults retry charge to zero", () => {
    expect(
      estimateS3ApiRequestCostUsd(
        { s3GetObjectRequests: 1000, retries: 99 },
        pricing,
      ),
    ).toBeCloseTo(1000 * 0.0004, 10);
  });
});

describe("usdPerRequestFromPerThousand", () => {
  it("divides by 1000", () => {
    expect(usdPerRequestFromPerThousand(0.4)).toBe(0.0004);
  });
});
