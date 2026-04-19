/**
 * Heuristic browser vs server archive execution for hybrid UIs.
 * Large byte totals or object counts default to server-side archiving (Node streams, IAM, long runs).
 */

export interface RecommendArchiveExecutionSurfaceInput {
  /** Estimated total uncompressed bytes to read from S3 (upper bound ok). */
  totalBytesEstimate: number;
  /** Estimated object count (upper bound ok). */
  objectCountEstimate: number;
  /** Override defaults (bytes). */
  browserMaxTotalBytes?: number;
  /** Override defaults (count). */
  browserMaxObjectCount?: number;
}

export type ArchiveExecutionSurface = "browser" | "server";

export interface ArchiveExecutionSurfaceRecommendation {
  surface: ArchiveExecutionSurface;
  /** Stable, deterministic rationale lines. */
  reasons: readonly string[];
}

/** Default max total bytes above which we recommend server-side archive (50 MiB). */
export const DEFAULT_BROWSER_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** Default max objects above which we recommend server-side archive. */
export const DEFAULT_BROWSER_MAX_OBJECT_COUNT = 5000;

/**
 * Recommend where to run the archive: browser (presigned fetches + JS zip) vs server
 * (`createFolderArchiveStream` / pump). Does **not** perform I/O.
 */
export function recommendArchiveExecutionSurface(
  input: RecommendArchiveExecutionSurfaceInput,
): ArchiveExecutionSurfaceRecommendation {
  const maxB = input.browserMaxTotalBytes ?? DEFAULT_BROWSER_MAX_TOTAL_BYTES;
  const maxN = input.browserMaxObjectCount ?? DEFAULT_BROWSER_MAX_OBJECT_COUNT;
  const reasons: string[] = [];

  if (
    !Number.isFinite(input.totalBytesEstimate) ||
    !Number.isFinite(input.objectCountEstimate) ||
    input.totalBytesEstimate < 0 ||
    input.objectCountEstimate < 0
  ) {
    return {
      surface: "server",
      reasons: [
        "Non-finite or negative estimates default to server-side execution for safety.",
      ],
    };
  }

  if (input.totalBytesEstimate > maxB) {
    reasons.push(
      `Total bytes (${input.totalBytesEstimate}) exceed browser-oriented threshold (${maxB}); prefer server-side streaming and credentials isolation.`,
    );
  }
  if (input.objectCountEstimate > maxN) {
    reasons.push(
      `Object count (${input.objectCountEstimate}) exceeds browser-oriented threshold (${maxN}); prefer server-side listing + archive pump.`,
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      `Under default thresholds (bytes≤${maxB}, objects≤${maxN}); browser-side presigned batch + client zip may be acceptable if IAM policy allows.`,
    );
    return { surface: "browser", reasons };
  }

  return { surface: "server", reasons };
}
