import type { ArchiveStats } from "./types.js";

/**
 * Maximum overlap ratio accepted when deriving suggestions (guards clock skew or missing list time
 * in wall clock).
 */
export const MAX_PIPELINE_OVERLAP_RATIO_CAP = 64;

export type SuggestZipConcurrencyFromCompletedRunInput = Pick<
  ArchiveStats,
  "averageGetObjectPipelineMs" | "getObjectPipelineSamples" | "wallDurationMs"
> & {
  /**
   * Upper bound for the suggestion (e.g. resolved ZIP concurrency cap, usually ≤ 16).
   */
  ceiling: number;
  /**
   * Multiply {@link estimatePipelineOverlapRatio} before rounding up (default **1.1**).
   * Slight headroom avoids oscillation when ρ sits just below an integer boundary.
   */
  headroomFactor?: number;
};

export interface ZipConcurrencyAdvice {
  /**
   * \(\rho = \frac{N \cdot \bar{t}_{\text{pipe}}}{T_{\text{wall}}}\) — dimensionless “pipeline-ms per
   * wall-ms”. Values **≈1** imply little overlap; **≫1** imply many objects’ pipelines overlapped in
   * wall time (higher effective parallelism).
   */
  pipelineOverlapRatio: number;
  /**
   * Rounded suggestion in \([1, \texttt{ceiling}]\); **advisory only** — the library does not apply it.
   */
  suggestedZipConcurrency: number;
  /** Deterministic human-readable lines (stable ordering). */
  notes: readonly string[];
}

/**
 * Estimates **effective pipeline parallelism** vs wall clock from completed-run stats:
 *
 * \[
 * \rho = \frac{N \cdot \bar{t}_{\text{pipe}}}{T_{\text{wall}}}
 * \]
 *
 * where \(N\) = {@link ArchiveStats.getObjectPipelineSamples},
 * \(\bar{t}_{\text{pipe}}\) = {@link ArchiveStats.averageGetObjectPipelineMs},
 * \(T_{\text{wall}}\) = {@link ArchiveStats.wallDurationMs}.
 *
 * Interpreting \(\rho\): if objects were processed one-after-another with no overlap, \(\rho \approx 1\).
 * With ZIP concurrency &gt; 1, \(\rho\) can exceed 1 (multiple pipeline intervals overlap in wall time).
 *
 * Returns `undefined` when inputs are missing or degenerate.
 */
export function estimatePipelineOverlapRatio(
  stats: Pick<
    ArchiveStats,
    "averageGetObjectPipelineMs" | "getObjectPipelineSamples" | "wallDurationMs"
  >,
): number | undefined {
  const n = stats.getObjectPipelineSamples;
  const avg = stats.averageGetObjectPipelineMs;
  const wall = stats.wallDurationMs;
  if (
    n == null ||
    avg == null ||
    wall == null ||
    n < 1 ||
    !Number.isFinite(avg) ||
    avg <= 0 ||
    !Number.isFinite(wall) ||
    wall <= 0
  ) {
    return undefined;
  }
  const raw = (n * avg) / wall;
  if (!Number.isFinite(raw) || raw < 0) return undefined;
  return Math.min(MAX_PIPELINE_OVERLAP_RATIO_CAP, raw);
}

/**
 * **Advisory** next-run ZIP `concurrency` from one completed archive stats snapshot, using
 * {@link estimatePipelineOverlapRatio} and a small headroom factor. Intended for **cold-start** tuning
 * or external control loops — not a substitute for {@link CreateFolderArchiveStreamOptions.experimentalAdaptiveZipConcurrency}
 * or {@link CreateFolderArchiveStreamOptions.experimentalThroughputAdaptiveZipConcurrency}.
 */
export function suggestZipConcurrencyFromCompletedRun(
  input: SuggestZipConcurrencyFromCompletedRunInput,
): ZipConcurrencyAdvice | undefined {
  const ceiling = input.ceiling;
  if (!Number.isFinite(ceiling) || ceiling < 1) return undefined;

  const ρ = estimatePipelineOverlapRatio(input);
  if (ρ === undefined) return undefined;

  const headroom = input.headroomFactor ?? 1.1;
  if (!Number.isFinite(headroom) || headroom <= 0) return undefined;

  const scaled = ρ * headroom;
  const suggestedZipConcurrency = Math.min(
    Math.floor(ceiling),
    Math.max(1, Math.ceil(scaled)),
  );

  const notes: string[] = [
    `Pipeline overlap ratio ρ ≈ ${ρ.toFixed(3)} (N·avgPipelineMs / wallDurationMs, capped at ${MAX_PIPELINE_OVERLAP_RATIO_CAP}).`,
    `Suggested ZIP concurrency (ceil(ρ×${headroom}) capped to ${ceiling}) = ${suggestedZipConcurrency}.`,
  ];
  if (ρ <= 1.05) {
    notes.push(
      "ρ≈1 suggests little parallel overlap in pipeline time vs wall clock; raising concurrency may help only if the bottleneck is download and S3 limits allow.",
    );
  } else if (ρ >= ceiling - 0.5) {
    notes.push(
      "ρ is near the configured ceiling — you may already be at diminishing returns or limited by archive encoding / destination.",
    );
  }

  return { pipelineOverlapRatio: ρ, suggestedZipConcurrency, notes };
}
