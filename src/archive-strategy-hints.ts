import type {
  ArchiveBottleneck,
  ArchiveFormat,
  ArchiveStageOccupancyShares,
  ArchiveStats,
} from "./types.js";
import { summarizeArchiveRunClassifications } from "./archive-run-diagnostics.js";

/** Advisory direction for ZIP GetObject parallelism (library does not apply this automatically). */
export type ZipGetObjectConcurrencyHint =
  | "increase"
  | "decrease"
  | "hold"
  | "notApplicable";

/** Hints about coordinating with a slow destination (`respectDestinationBackpressure`). */
export type DestinationBackpressureHint =
  | "enableMayHelp"
  | "coordinationObserved"
  | "neutral";

/** Which stage consumed the largest share of wall time (occupancy) or the pump bottleneck fallback. */
export type DominantDataPlaneHint =
  | "list"
  | "download"
  | "archiveEncoding"
  | "balanced"
  | "unknown";

export type StrategyHintConfidence = "low" | "medium" | "high";

/**
 * Default σ threshold above which we treat retry attempts as a **large** share of all List/Get
 * attempts plus successes (same σ as {@link ArchiveRunClassificationSummary.retryAttemptShare}).
 */
export const DEFAULT_STRATEGY_HINT_HIGH_RETRY_ATTEMPT_SHARE = 0.3;

export interface ArchiveRunStrategyHints {
  zipGetObjectConcurrency: ZipGetObjectConcurrencyHint;
  destinationBackpressure: DestinationBackpressureHint;
  dominantPlane: DominantDataPlaneHint;
  confidence: StrategyHintConfidence;
  /**
   * True when {@link ArchiveStats.adaptiveZipConcurrencyFinalCap} &lt;
   * {@link ArchiveStats.adaptiveZipConcurrencyInitialCap} — adaptive closed-loop already
   * reduced GetObject parallelism during the run.
   */
  adaptiveZipCapReducedDuringRun: boolean;
  /** Short, operator-facing rationale (deterministic ordering). */
  notes: readonly string[];
}

export type SuggestArchiveRunStrategyHintsInput = Pick<
  ArchiveStats,
  | "objectsIncluded"
  | "bytesRead"
  | "retries"
  | "bottleneck"
  | "bytesWritten"
  | "s3ListObjectsV2Requests"
  | "s3GetObjectRequests"
  | "stageOccupancyShare"
  | "throughputRollingPace"
  | "destinationDrainWaits"
  | "adaptiveZipConcurrencyInitialCap"
  | "adaptiveZipConcurrencyFinalCap"
> & {
  /** When omitted, ZIP-oriented hints assume a ZIP run (common case for concurrency tuning). */
  format?: ArchiveFormat;
  /**
   * Override σ cutoff for treating retry volume as high pressure (defaults to
   * {@link DEFAULT_STRATEGY_HINT_HIGH_RETRY_ATTEMPT_SHARE}).
   */
  highRetryAttemptShare?: number;
};

function bottleneckToPlane(b: ArchiveBottleneck): DominantDataPlaneHint {
  switch (b) {
    case "list":
      return "list";
    case "download":
      return "download";
    case "archive-write":
      return "archiveEncoding";
    case "even":
      return "balanced";
    default:
      return "unknown";
  }
}

function dominantPlaneFromOccupancy(
  share: ArchiveStageOccupancyShares,
): DominantDataPlaneHint {
  const { list, download, archiveWrite } = share;
  const m = Math.max(list, download, archiveWrite);
  if (m < 0.2) return "balanced";
  if (list === m) return "list";
  if (download === m) return "download";
  return "archiveEncoding";
}

function resolveDominantPlane(
  input: Pick<ArchiveStats, "bottleneck" | "stageOccupancyShare">,
): DominantDataPlaneHint {
  if (input.stageOccupancyShare) {
    return dominantPlaneFromOccupancy(input.stageOccupancyShare);
  }
  return bottleneckToPlane(input.bottleneck);
}

/**
 * Advisory hints from a completed run (workload and retry classifiers plus aggregate stats).
 * The library does not apply these automatically—use them in your own dashboards or policies.
 *
 * For a numeric next-run ZIP concurrency seed from pipeline vs wall time, see
 * `suggestZipConcurrencyFromCompletedRun` in `./archive-concurrency-advice.js`.
 */
export function suggestArchiveRunStrategyHints(
  input: SuggestArchiveRunStrategyHintsInput,
): ArchiveRunStrategyHints {
  const summary = summarizeArchiveRunClassifications(input);
  const format = input.format;
  const isZip = format === undefined || format === "zip";
  const sigmaThreshold =
    input.highRetryAttemptShare ??
    DEFAULT_STRATEGY_HINT_HIGH_RETRY_ATTEMPT_SHARE;

  const notes: string[] = [];
  let zip: ZipGetObjectConcurrencyHint = "hold";
  let dest: DestinationBackpressureHint = "neutral";

  const sigma = summary.retryAttemptShare;
  const retryProfile = summary.retryStress?.profile;
  const highRetryPressure =
    retryProfile === "high" || (sigma !== undefined && sigma >= sigmaThreshold);

  if (isZip) {
    if (highRetryPressure) {
      zip = "decrease";
      notes.push(
        "Retry pressure is high (ρ/σ thresholds); consider lowering ZIP GetObject concurrency or backoff limits to reduce S3 throttle contention.",
      );
    } else if (
      retryProfile === "low" &&
      input.bottleneck === "download" &&
      (input.destinationDrainWaits ?? 0) === 0 &&
      input.objectsIncluded >= 2
    ) {
      zip = "increase";
      notes.push(
        "Low retry pressure with a download bottleneck and no destination drain waits; slightly higher ZIP concurrency may improve overlap—validate against account limits.",
      );
    } else if (input.bottleneck === "archive-write") {
      zip = "hold";
      notes.push(
        "Archive encoding dominates; increasing GetObject parallelism rarely helps until the encoder or destination can accept data faster.",
      );
    }
  } else {
    zip = "notApplicable";
    notes.push(
      "Tar formats run downloads sequentially; ZIP GetObject concurrency hints do not apply.",
    );
  }

  const drainWaits = input.destinationDrainWaits ?? 0;
  if (drainWaits > 0) {
    dest = "coordinationObserved";
    notes.push(
      `Destination drain coordination occurred (${drainWaits} wait(s)); reads were gated by writable backpressure.`,
    );
  } else if (
    input.throughputRollingPace === "read-faster" &&
    input.bytesWritten > 0 &&
    input.objectsIncluded > 0
  ) {
    dest = "enableMayHelp";
    notes.push(
      "Trailing read pace exceeded write pace; if the destination is slow, consider respectDestinationBackpressure to limit in-flight bytes.",
    );
  }

  const ic = input.adaptiveZipConcurrencyInitialCap;
  const fc = input.adaptiveZipConcurrencyFinalCap;
  const adaptiveZipCapReducedDuringRun =
    ic !== undefined && fc !== undefined && fc < ic;
  if (adaptiveZipCapReducedDuringRun) {
    notes.push(
      "Adaptive ZIP GetObject cap ended below its initial value—closed-loop tuning already reduced parallelism during this run.",
    );
  }

  let confidence: StrategyHintConfidence = "medium";
  let dominantPlane = resolveDominantPlane(input);
  if (input.objectsIncluded === 0) {
    confidence = "low";
    dominantPlane = "unknown";
    notes.push("No objects included; hints are mostly non-actionable.");
  } else if (summary.retryStress !== null && input.bottleneck !== "even") {
    confidence = "high";
  } else if (summary.retryStress === null) {
    notes.push(
      "S3 List/Get success counts were unavailable; retry-stress tier is omitted from classification.",
    );
  }

  return {
    zipGetObjectConcurrency: zip,
    destinationBackpressure: dest,
    dominantPlane,
    confidence,
    adaptiveZipCapReducedDuringRun,
    notes,
  };
}
