import type { ArchiveStats } from "./types.js";

/**
 * Coarse **retry pressure** relative to successful S3 API calls (dimensionless; not latency).
 */
export type ArchiveRetryStressProfile = "low" | "moderate" | "high";

/**
 * Default exclusive upper bound on \(\rho = r / N_{\text{ok}}\) for **`low`**, where \(r\) is
 * {@link ArchiveStats.retries} and \(N_{\text{ok}} = N_L + N_G\) (successful list + get counts).
 */
export const DEFAULT_RETRY_STRESS_LOW_MAX_RATIO = 0.05;

/**
 * Default exclusive upper bound on \(\rho\) for **`moderate`** (at or above → **`high`**).
 */
export const DEFAULT_RETRY_STRESS_MODERATE_MAX_RATIO = 0.25;

export interface ClassifyArchiveRetryStressInput {
  retries: number;
  s3ListObjectsV2Requests?: number | null;
  s3GetObjectRequests?: number | null;
  lowMaxRatio?: number;
  moderateMaxRatio?: number;
}

export interface ArchiveRetryStressClassification {
  profile: ArchiveRetryStressProfile;
  /**
   * \(\rho = r / \max(1, N_{\text{ok}})\) — retries per successful List/Get “unit” on average.
   */
  retriesPerSuccessfulS3Request: number;
}

/**
 * Classify retry pressure from aggregate stats when **S3 traffic counters** are present (omitted with
 * injected {@link CreateFolderArchiveStreamOptions.storageProvider}). Returns `undefined` when both
 * list and get counts are absent so callers cannot compute \(N_{\text{ok}}\).
 */
export function classifyArchiveRetryStress(
  input: ClassifyArchiveRetryStressInput,
): ArchiveRetryStressClassification | undefined {
  const L = input.s3ListObjectsV2Requests;
  const G = input.s3GetObjectRequests;
  if (L == null && G == null) return undefined;

  const lowR = input.lowMaxRatio ?? DEFAULT_RETRY_STRESS_LOW_MAX_RATIO;
  const modR =
    input.moderateMaxRatio ?? DEFAULT_RETRY_STRESS_MODERATE_MAX_RATIO;
  if (!(lowR < modR)) {
    throw new TypeError(
      "classifyArchiveRetryStress: lowMaxRatio must be < moderateMaxRatio",
    );
  }

  const r = input.retries;
  if (!Number.isFinite(r) || r < 0) {
    throw new TypeError(
      "classifyArchiveRetryStress: retries must be finite and non-negative",
    );
  }

  const nOk = (L ?? 0) + (G ?? 0);
  const rho = r / Math.max(1, nOk);

  let profile: ArchiveRetryStressProfile;
  if (rho < lowR) profile = "low";
  else if (rho < modR) profile = "moderate";
  else profile = "high";

  return { profile, retriesPerSuccessfulS3Request: rho };
}

/**
 * Convenience: {@link classifyArchiveRetryStress} using fields from final {@link ArchiveStats}.
 */
export function classifyArchiveRetryStressFromStats(
  stats: Pick<
    ArchiveStats,
    "retries" | "s3ListObjectsV2Requests" | "s3GetObjectRequests"
  >,
  thresholds?: Pick<
    ClassifyArchiveRetryStressInput,
    "lowMaxRatio" | "moderateMaxRatio"
  >,
): ArchiveRetryStressClassification | undefined {
  return classifyArchiveRetryStress({
    retries: stats.retries,
    s3ListObjectsV2Requests: stats.s3ListObjectsV2Requests,
    s3GetObjectRequests: stats.s3GetObjectRequests,
    ...thresholds,
  });
}
