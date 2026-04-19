import type { ArchiveStats } from "./types.js";
import { estimateKmsRequestCostUsd } from "./kms-request-cost.js";
import {
  estimateS3DataTransferOutCostUsdFromArchiveBytesRead,
  type CumulativeDataTransferPriceBand,
} from "./s3-data-transfer-cost.js";
import {
  estimateS3ApiRequestCostUsd,
  type S3ApiUsdPricing,
} from "./s3-workload-units.js";

/**
 * Combined **linear** USD model for one completed run:
 *
 * \[
 *   C_{\text{total}} = C_{\text{req}} + C_{\text{eg}} + C_{\text{kms}}
 * \]
 *
 * where \(C_{\text{req}}\) uses {@link estimateS3ApiRequestCostUsd}, \(C_{\text{eg}}\) uses tiered
 * egress on {@link ArchiveStats.bytesRead}, and optional \(C_{\text{kms}}\) uses
 * {@link estimateKmsRequestCostUsd}. Omitted components contribute **0** to the sum.
 */
export interface ArchiveRunS3UsdEstimate {
  /** Present when {@link EstimateArchiveRunS3UsdInput.apiPricing} was passed and list/get stats exist. */
  apiRequestCostUsd?: number;
  /** Always defined when egress bands were supplied (may be `0` for zero bytes). */
  dataTransferOutCostUsd: number;
  /** Optional linear KMS API estimate when {@link EstimateArchiveRunS3UsdInput.kmsDecryptRequestCount} is set. */
  kmsRequestCostUsd?: number;
  totalUsd: number;
}

export interface EstimateArchiveRunS3UsdInput {
  stats: Pick<
    ArchiveStats,
    "bytesRead" | "s3ListObjectsV2Requests" | "s3GetObjectRequests" | "retries"
  >;
  /** When set, compute \(C_{\text{req}}\) (may be `undefined` if list/get counts absent on stats). */
  apiPricing?: S3ApiUsdPricing | null;
  /** When non-empty, compute \(C_{\text{eg}}\) via {@link estimateS3DataTransferOutCostUsdFromArchiveBytesRead}. */
  egressBands?: readonly CumulativeDataTransferPriceBand[] | null;
  /**
   * Optional KMS **Decrypt** (or similar) request count for a linear add-on; pair with
   * {@link kmsUsdPer10000Requests} (see {@link estimateKmsRequestCostUsd}).
   */
  kmsDecryptRequestCount?: number;
  /** USD per 10,000 KMS requests (region-specific; default in {@link estimateKmsRequestCostUsd}). */
  kmsUsdPer10000Requests?: number;
}

/**
 * Estimate request + egress USD for a run. Returns `undefined` only when the caller supplies **neither**
 * API pricing nor egress bands (nothing to price).
 */
export function estimateArchiveRunS3Usd(
  input: EstimateArchiveRunS3UsdInput,
): ArchiveRunS3UsdEstimate | undefined {
  const wantApi = input.apiPricing != null;
  const wantEg = input.egressBands != null && input.egressBands.length > 0;
  const wantKms =
    input.kmsDecryptRequestCount != null &&
    input.kmsUsdPer10000Requests != null;
  if (!wantApi && !wantEg && !wantKms) return undefined;

  const apiUsd = wantApi
    ? estimateS3ApiRequestCostUsd(input.stats, input.apiPricing!)
    : undefined;
  const egressUsd = wantEg
    ? estimateS3DataTransferOutCostUsdFromArchiveBytesRead(
        input.stats,
        input.egressBands!,
      )
    : undefined;
  const kmsUsd = wantKms
    ? estimateKmsRequestCostUsd(
        input.kmsDecryptRequestCount!,
        input.kmsUsdPer10000Requests!,
      )
    : undefined;

  const totalUsd = (apiUsd ?? 0) + (egressUsd ?? 0) + (kmsUsd ?? 0);
  return {
    apiRequestCostUsd: apiUsd,
    dataTransferOutCostUsd: egressUsd ?? 0,
    kmsRequestCostUsd: kmsUsd,
    totalUsd,
  };
}
