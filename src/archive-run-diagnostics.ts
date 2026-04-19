import type { ArchiveStats } from "./types.js";
import {
  classifyArchiveRetryStressFromStats,
  type ArchiveRetryStressClassification,
} from "./archive-retry-profile.js";
import {
  classifyArchiveWorkloadSize,
  type ArchiveWorkloadSizeClassification,
} from "./archive-workload-profile.js";

export interface ArchiveRunClassificationSummary {
  /** Mean object-size profile from aggregate `bytesRead` / `objectsIncluded`. */
  workload: ArchiveWorkloadSizeClassification;
  /**
   * Retry pressure vs successful S3 List/Get counts; `null` when those counters are omitted
   * (e.g. injected `storageProvider`).
   */
  retryStress: ArchiveRetryStressClassification | null;
  /**
   * Share of **retry attempts** in all List/Get successes plus retries:
   * \(\sigma = r / (r + N_{\text{ok}})\) for \(N_{\text{ok}} = N_L + N_G\), when \(r + N_{\text{ok}} > 0\).
   * Complements \(\rho = r/\max(1,N_{\text{ok}})\) on {@link ArchiveRetryStressClassification}.
   */
  retryAttemptShare?: number;
}

/**
 * Single pass over final {@link ArchiveStats} for **dashboards / policy hooks**: workload shape,
 * retry stress, and optional \(\sigma\) (undefined when S3 traffic stats are absent).
 */
export function summarizeArchiveRunClassifications(
  stats: Pick<
    ArchiveStats,
    | "objectsIncluded"
    | "bytesRead"
    | "retries"
    | "s3ListObjectsV2Requests"
    | "s3GetObjectRequests"
  >,
): ArchiveRunClassificationSummary {
  const workload = classifyArchiveWorkloadSize({
    objectsIncluded: stats.objectsIncluded,
    bytesRead: stats.bytesRead,
  });
  const retryStress = classifyArchiveRetryStressFromStats(stats) ?? null;

  const L = stats.s3ListObjectsV2Requests;
  const G = stats.s3GetObjectRequests;
  let retryAttemptShare: number | undefined;
  if (L != null || G != null) {
    const nOk = (L ?? 0) + (G ?? 0);
    const r = stats.retries ?? 0;
    const denom = r + nOk;
    if (denom > 0) retryAttemptShare = r / denom;
  }

  return { workload, retryStress, retryAttemptShare };
}
