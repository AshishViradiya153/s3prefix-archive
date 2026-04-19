import type { ArchiveStats } from "./types.js";

/**
 * Linear **dimensionless** workload model for S3 API usage (not dollars):
 *
 * \[
 *   W = w_L \cdot N_{\text{List}} + w_G \cdot N_{\text{Get}} + w_R \cdot N_{\text{retry}}
 * \]
 *
 * where \(N_{\text{retry}}\) is the aggregate retry count already tracked on the run
 * ({@link ArchiveStats.retries}). Callers map \(W\) to cost with account-specific pricing
 * (List/Get request prices differ by tier/region).
 *
 * Default weights treat one List and one Get page as equally “heavy” per request; retries are
 * down-weighted because they are attempts, not successful API units (tunable).
 */
export interface S3WorkloadWeights {
  perListObjectsV2Request: number;
  perGetObjectRequest: number;
  /** Applied to {@link ArchiveStats.retries} (total scheduled retry attempts). */
  perRetry: number;
}

export const DEFAULT_S3_WORKLOAD_WEIGHTS: S3WorkloadWeights = {
  perListObjectsV2Request: 1,
  perGetObjectRequest: 1,
  perRetry: 0.25,
};

export function computeS3WorkloadUnits(
  stats: Pick<
    ArchiveStats,
    "s3ListObjectsV2Requests" | "s3GetObjectRequests" | "retries"
  >,
  weights: S3WorkloadWeights = DEFAULT_S3_WORKLOAD_WEIGHTS,
): number | undefined {
  const L = stats.s3ListObjectsV2Requests;
  const G = stats.s3GetObjectRequests;
  if (L == null && G == null) return undefined;
  const nL = L ?? 0;
  const nG = G ?? 0;
  const r = stats.retries ?? 0;
  return (
    weights.perListObjectsV2Request * nL +
    weights.perGetObjectRequest * nG +
    weights.perRetry * r
  );
}

/**
 * Regional **S3 request** prices as **USD per successful API call** (ListObjectsV2 page, GetObject open).
 * AWS quotes are often per 1,000 requests; use {@link usdPerRequestFromPerThousand} to convert.
 *
 * Cost model (same linear structure as {@link computeS3WorkloadUnits}, but in money):
 *
 * \[
 *   C_{\text{req}} = c_L N_L + c_G N_G + c_R N_{\text{retry}}
 * \]
 *
 * Data transfer, KMS, and storage are **not** included—only what you can attribute from
 * {@link ArchiveStats} request and retry counts. For **egress** on `bytesRead`, see
 * `estimateDataTransferOutCostUsd` in `./s3-data-transfer-cost.js`.
 */
export interface S3ApiUsdPricing {
  usdPerListObjectsV2Request: number;
  usdPerGetObjectRequest: number;
  /**
   * Optional charge on each {@link ArchiveStats.retries} increment (scheduled retry attempts).
   * Successful requests are already counted in list/get; set this when you want to approximate
   * “wasted” attempt cost, or leave `0` (default) if only successful requests are billed.
   */
  usdPerRetryAttempt?: number;
}

/**
 * Convert a US-dollar price **per 1,000 requests** (common in AWS pricing pages) to **per request**.
 *
 * \[
 *   c_{\text{per-req}} = \frac{P_{1000}}{1000}
 * \]
 */
export function usdPerRequestFromPerThousand(
  usdPerThousandRequests: number,
): number {
  return usdPerThousandRequests / 1000;
}

/**
 * Estimated **S3 API request** cost in USD from final stats. Returns `undefined` when list and get
 * counts are absent (e.g. when `storageProvider` is injected and S3 traffic stats are omitted).
 */
export function estimateS3ApiRequestCostUsd(
  stats: Pick<
    ArchiveStats,
    "s3ListObjectsV2Requests" | "s3GetObjectRequests" | "retries"
  >,
  pricing: S3ApiUsdPricing,
): number | undefined {
  const L = stats.s3ListObjectsV2Requests;
  const G = stats.s3GetObjectRequests;
  if (L == null && G == null) return undefined;
  const nL = L ?? 0;
  const nG = G ?? 0;
  const r = stats.retries ?? 0;
  const cR = pricing.usdPerRetryAttempt ?? 0;
  return (
    nL * pricing.usdPerListObjectsV2Request +
    nG * pricing.usdPerGetObjectRequest +
    r * cR
  );
}
