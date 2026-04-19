import type { ArchiveFormat, ArchiveStats } from "./types.js";
import {
  type ZipConcurrencyAdvice,
  suggestZipConcurrencyFromCompletedRun,
} from "./archive-concurrency-advice.js";
import {
  type ArchiveRunStrategyHints,
  suggestArchiveRunStrategyHints,
} from "./archive-strategy-hints.js";

/** Read-only snapshot: strategy hints plus optional ZIP concurrency advice and merged notes. */
export interface ArchiveControlPlaneSnapshot {
  strategyHints: ArchiveRunStrategyHints;
  zipConcurrencyAdvice: ZipConcurrencyAdvice | undefined;
  /** Merged deterministic notes (strategy first, then ZIP advice). */
  combinedNotes: readonly string[];
}

export interface SummarizeArchiveControlPlaneSnapshotInput {
  stats: ArchiveStats;
  /** Resolved ZIP concurrency ceiling used for {@link suggestZipConcurrencyFromCompletedRun}. */
  ceiling: number;
  /** When set, overrides format inference for strategy hints. */
  format?: ArchiveFormat;
  highRetryAttemptShare?: number;
  headroomFactor?: number;
}

/**
 * Aggregates {@link suggestArchiveRunStrategyHints} and {@link suggestZipConcurrencyFromCompletedRun}
 * into one snapshot for telemetry or an external autoscaler. **Does not** change runtime options.
 */
export function summarizeArchiveControlPlaneSnapshot(
  input: SummarizeArchiveControlPlaneSnapshotInput,
): ArchiveControlPlaneSnapshot {
  const s = input.stats;
  const strategyHints = suggestArchiveRunStrategyHints({
    objectsIncluded: s.objectsIncluded,
    bytesRead: s.bytesRead,
    retries: s.retries,
    bottleneck: s.bottleneck,
    bytesWritten: s.bytesWritten,
    s3ListObjectsV2Requests: s.s3ListObjectsV2Requests,
    s3GetObjectRequests: s.s3GetObjectRequests,
    stageOccupancyShare: s.stageOccupancyShare,
    throughputRollingPace: s.throughputRollingPace,
    destinationDrainWaits: s.destinationDrainWaits,
    adaptiveZipConcurrencyInitialCap: s.adaptiveZipConcurrencyInitialCap,
    adaptiveZipConcurrencyFinalCap: s.adaptiveZipConcurrencyFinalCap,
    format: input.format,
    highRetryAttemptShare: input.highRetryAttemptShare,
  });

  const zipConcurrencyAdvice = suggestZipConcurrencyFromCompletedRun({
    averageGetObjectPipelineMs: s.averageGetObjectPipelineMs,
    getObjectPipelineSamples: s.getObjectPipelineSamples,
    wallDurationMs: s.wallDurationMs,
    ceiling: input.ceiling,
    headroomFactor: input.headroomFactor,
  });

  const combinedNotes = [
    ...strategyHints.notes,
    ...(zipConcurrencyAdvice?.notes ?? []),
  ];

  return {
    strategyHints,
    zipConcurrencyAdvice,
    combinedNotes,
  };
}
