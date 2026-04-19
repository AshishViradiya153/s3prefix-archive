import { describe, expect, it } from "vitest";
import { estimateArchiveRunS3Usd } from "../src/s3-archive-run-cost.js";

describe("estimateArchiveRunS3Usd", () => {
  const stats = {
    bytesRead: 1000,
    s3ListObjectsV2Requests: 1,
    s3GetObjectRequests: 5,
    retries: 0,
  } as const;

  it("returns undefined when neither API nor egress pricing is provided", () => {
    expect(estimateArchiveRunS3Usd({ stats })).toBeUndefined();
  });

  it("sums API and egress when both provided", () => {
    const bands = [
      { untilBytesExclusive: Number.POSITIVE_INFINITY, usdPerByte: 1e-9 },
    ] as const;
    const r = estimateArchiveRunS3Usd({
      stats,
      apiPricing: {
        usdPerListObjectsV2Request: 0.0005,
        usdPerGetObjectRequest: 0.0004,
      },
      egressBands: bands,
    })!;
    expect(r.apiRequestCostUsd).toBeCloseTo(1 * 0.0005 + 5 * 0.0004, 10);
    expect(r.dataTransferOutCostUsd).toBeCloseTo(1000 * 1e-9, 10);
    expect(r.totalUsd).toBeCloseTo(
      r.apiRequestCostUsd! + r.dataTransferOutCostUsd,
      10,
    );
  });

  it("supports egress-only total when API stats missing", () => {
    const bands = [
      { untilBytesExclusive: Number.POSITIVE_INFINITY, usdPerByte: 2e-9 },
    ] as const;
    const r = estimateArchiveRunS3Usd({
      stats: { bytesRead: 500, retries: 0 },
      egressBands: bands,
    })!;
    expect(r.apiRequestCostUsd).toBeUndefined();
    expect(r.dataTransferOutCostUsd).toBeCloseTo(500 * 2e-9, 10);
    expect(r.totalUsd).toBe(r.dataTransferOutCostUsd);
  });

  it("includes KMS linear estimate when provided", () => {
    const r = estimateArchiveRunS3Usd({
      stats: { bytesRead: 0, retries: 0 },
      kmsDecryptRequestCount: 10_000,
      kmsUsdPer10000Requests: 0.03,
    })!;
    expect(r.kmsRequestCostUsd).toBeCloseTo(0.03, 10);
    expect(r.totalUsd).toBeCloseTo(0.03, 10);
  });
});
