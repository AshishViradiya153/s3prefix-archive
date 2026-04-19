import { describe, expect, it } from "vitest";
import {
  DEFAULT_KMS_USD_PER_10K_REQUESTS,
  estimateKmsRequestCostUsd,
} from "../src/kms-request-cost.js";

describe("estimateKmsRequestCostUsd", () => {
  it("linear 10k scaling", () => {
    expect(estimateKmsRequestCostUsd(10_000, 0.03)).toBeCloseTo(0.03, 10);
    expect(estimateKmsRequestCostUsd(0, DEFAULT_KMS_USD_PER_10K_REQUESTS)).toBe(
      0,
    );
  });

  it("rejects negative count", () => {
    expect(() => estimateKmsRequestCostUsd(-1)).toThrow();
  });
});
