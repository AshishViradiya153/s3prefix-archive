import type {
  ArchiveBottleneck,
  ArchiveStageOccupancyShares,
  ArchiveStageStats,
} from "./types.js";

/**
 * Classify which stage dominated **occupancy-partitioned** wall time (`ArchiveStageOccupancyMeter`).
 * When {@link ArchiveStageStats.stageIdleMs} exceeds all work stages, returns `"even"`.
 */
export function classifyArchiveBottleneck(
  stages: Pick<
    ArchiveStageStats,
    "listMs" | "downloadMs" | "archiveWriteMs"
  > & {
    stageIdleMs?: number;
  },
): ArchiveBottleneck {
  const { listMs, downloadMs, archiveWriteMs, stageIdleMs = 0 } = stages;
  const maxWork = Math.max(listMs, downloadMs, archiveWriteMs);
  /** Trivial empty run. */
  if (maxWork === 0 && stageIdleMs === 0) return "even";
  /** Idle gaps (manifest-only tail, scheduling gaps) dominate vs. any single work stage. */
  if (stageIdleMs > maxWork) return "even";
  /** Here `maxWork > 0`: pick argmax with download tie-breaker, then list over archive-write. */
  if (downloadMs >= listMs && downloadMs >= archiveWriteMs) return "download";
  if (listMs >= archiveWriteMs) return "list";
  return "archive-write";
}

/**
 * Normalize occupancy ms into **shares** that sum to 1 (relative time in each stage + idle).
 * Returns `undefined` when total tracked time is zero (no work and no idle).
 */
export function computeArchiveStageOccupancyShares(
  stages: Pick<
    ArchiveStageStats,
    "listMs" | "downloadMs" | "archiveWriteMs"
  > & {
    stageIdleMs?: number;
  },
): ArchiveStageOccupancyShares | undefined {
  const idle = stages.stageIdleMs ?? 0;
  const total =
    stages.listMs + stages.downloadMs + stages.archiveWriteMs + idle;
  if (total <= 0) return undefined;
  return {
    list: stages.listMs / total,
    download: stages.downloadMs / total,
    archiveWrite: stages.archiveWriteMs / total,
    idle: idle / total,
  };
}
