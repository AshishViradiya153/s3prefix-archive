/**
 * **Rough** linear USD model for AWS KMS **API requests** (e.g. Decrypt), not key storage monthly fees.
 * Pricing varies by region and key type — callers should pass account-specific `usdPer10000Requests`.
 */

export const DEFAULT_KMS_USD_PER_10K_REQUESTS = 0.03;

/**
 * Linear estimate: \((N / 10{,}000) \times p_{10k}\).
 */
export function estimateKmsRequestCostUsd(
  requestCount: number,
  usdPer10000Requests: number = DEFAULT_KMS_USD_PER_10K_REQUESTS,
): number {
  if (!Number.isFinite(requestCount) || requestCount < 0) {
    throw new TypeError(
      "estimateKmsRequestCostUsd: requestCount must be finite and non-negative",
    );
  }
  if (!Number.isFinite(usdPer10000Requests) || usdPer10000Requests < 0) {
    throw new TypeError(
      "estimateKmsRequestCostUsd: usdPer10000Requests must be finite and non-negative",
    );
  }
  return (requestCount / 10_000) * usdPer10000Requests;
}
