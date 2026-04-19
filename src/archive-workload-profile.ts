/**
 * Default exclusive upper bound on mean bytes/object for **`many-small`** (256 KiB, binary).
 * Must stay **strictly less than** {@link DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES}.
 */
export const DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES = 256 * 1024;

/**
 * Default exclusive lower bound on mean bytes/object for **`few-large`** (16 MiB, binary).
 */
export const DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES = 16 * 1024 * 1024;

/**
 * Coarse **object-size distribution** label from completed run totals (no S3 listing of per-object sizes required).
 * Useful for dashboards and choosing tuning defaults; not a substitute for per-key analytics.
 */
export type ArchiveWorkloadSizeProfile =
  | "empty"
  | "many-small"
  | "balanced"
  | "few-large";

export interface ArchiveWorkloadSizeClassification {
  profile: ArchiveWorkloadSizeProfile;
  /** `bytesRead / objectsIncluded` when `objectsIncluded > 0`; otherwise `0`. */
  meanBytesPerIncludedObject: number;
}

export interface ClassifyArchiveWorkloadSizeInput {
  objectsIncluded: number;
  bytesRead: number;
  /**
   * Upper bound (exclusive) on the mean object size for **`many-small`**.
   * @default {@link DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES}
   */
  smallAvgBytes?: number;
  /**
   * Lower bound (exclusive) on the mean object size for **`few-large`**.
   * @default {@link DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES}
   */
  largeAvgBytes?: number;
}

/**
 * Classify a completed archive run by **mean bytes per included object** using two thresholds.
 * \[
 *   \bar{b} = \frac{B_{\text{read}}}{N_{\text{included}}}
 * \]
 *
 * - `empty`: \(N_{\text{included}} = 0\)
 * - `many-small`: \(\bar{b} < s\)
 * - `few-large`: \(\bar{b} > \ell\)
 * - `balanced`: otherwise (requires \(s < \ell\))
 */
export function classifyArchiveWorkloadSize(
  input: ClassifyArchiveWorkloadSizeInput,
): ArchiveWorkloadSizeClassification {
  const smallAvgBytes =
    input.smallAvgBytes ?? DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES;
  const largeAvgBytes =
    input.largeAvgBytes ?? DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES;
  if (!(smallAvgBytes < largeAvgBytes)) {
    throw new TypeError(
      "classifyArchiveWorkloadSize: smallAvgBytes must be < largeAvgBytes",
    );
  }
  const { objectsIncluded, bytesRead } = input;
  if (!Number.isFinite(objectsIncluded) || objectsIncluded < 0) {
    throw new TypeError(
      "classifyArchiveWorkloadSize: objectsIncluded must be finite and non-negative",
    );
  }
  if (objectsIncluded === 0) {
    return { profile: "empty", meanBytesPerIncludedObject: 0 };
  }
  if (!Number.isFinite(bytesRead) || bytesRead < 0) {
    throw new TypeError(
      "classifyArchiveWorkloadSize: bytesRead must be finite and non-negative",
    );
  }
  const mean = bytesRead / objectsIncluded;
  let profile: ArchiveWorkloadSizeProfile;
  if (mean < smallAvgBytes) profile = "many-small";
  else if (mean > largeAvgBytes) profile = "few-large";
  else profile = "balanced";
  return { profile, meanBytesPerIncludedObject: mean };
}
