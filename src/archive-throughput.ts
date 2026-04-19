import type { ThroughputReadWritePace } from "./types.js";

/** Default relative band for {@link classifyThroughputReadWritePace} (`|r−w| ≤ rel × scale`). */
export const DEFAULT_THROUGHPUT_READ_WRITE_RELATIVE_TOLERANCE = 0.05;

/**
 * Floor for the scale term when both read/write rates are ~0 (avoids division-by-zero semantics).
 */
export const DEFAULT_THROUGHPUT_READ_WRITE_ABSOLUTE_FLOOR_BPS = 1e-9;

/** Minimum Δt (seconds) when computing rolling B/s so snapshot never divides by zero. */
export const THROUGHPUT_SAMPLER_MIN_DELTA_SECONDS = 0.001;

type ThroughputSample = { t: number; bytesRead: number; bytesWritten: number };

/**
 * Compare trailing **read** vs **write** throughput (same window as {@link createArchiveThroughputSampler}).
 * Uses a **relative** closeness test so scale-free: when both rates are tiny, `"balanced"` is returned.
 */
export function classifyThroughputReadWritePace(
  rollingBytesReadPerSecond: number,
  rollingBytesWrittenPerSecond: number,
  options?: {
    relativeTolerance?: number;
    absoluteFloorBytesPerSecond?: number;
  },
): ThroughputReadWritePace {
  const rel =
    options?.relativeTolerance ??
    DEFAULT_THROUGHPUT_READ_WRITE_RELATIVE_TOLERANCE;
  const floor =
    options?.absoluteFloorBytesPerSecond ??
    DEFAULT_THROUGHPUT_READ_WRITE_ABSOLUTE_FLOOR_BPS;
  const r = rollingBytesReadPerSecond;
  const w = rollingBytesWrittenPerSecond;
  const scale = Math.max(Math.abs(r), Math.abs(w), floor);
  if (Math.abs(r - w) <= rel * scale) return "balanced";
  return r > w ? "read-faster" : "write-faster";
}

/**
 * Trailing-window throughput from {@link ArchiveProgress} samples (bytes per second).
 * Used when {@link CreateFolderArchiveStreamOptions.statsThroughputRollingWindowMs} is set.
 */
export interface ArchiveThroughputSampler {
  record(t: number, bytesRead: number, bytesWritten: number): void;
  snapshot(t: number): {
    rollingBytesReadPerSecond: number;
    rollingBytesWrittenPerSecond: number;
  };
}

/** Drops samples older than `windowMs` before computing delta bytes / delta time. */
export function createArchiveThroughputSampler(
  windowMs: number,
): ArchiveThroughputSampler {
  const w = Math.max(1, windowMs);
  const samples: ThroughputSample[] = [];
  return {
    record(t, bytesRead, bytesWritten) {
      samples.push({ t, bytesRead, bytesWritten });
      const cutoff = t - w;
      while (samples.length > 0 && samples[0]!.t < cutoff) samples.shift();
    },
    snapshot(t) {
      const cutoff = t - w;
      while (samples.length > 0 && samples[0]!.t < cutoff) samples.shift();
      if (samples.length < 2) {
        return {
          rollingBytesReadPerSecond: 0,
          rollingBytesWrittenPerSecond: 0,
        };
      }
      const oldest = samples[0]!;
      const newest = samples[samples.length - 1]!;
      const dtSec = Math.max(
        THROUGHPUT_SAMPLER_MIN_DELTA_SECONDS,
        (newest.t - oldest.t) / 1000,
      );
      return {
        rollingBytesReadPerSecond:
          (newest.bytesRead - oldest.bytesRead) / dtSec,
        rollingBytesWrittenPerSecond:
          (newest.bytesWritten - oldest.bytesWritten) / dtSec,
      };
    },
  };
}
