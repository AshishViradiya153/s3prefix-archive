import type { ThroughputAdaptiveZipLimiter } from "./archive-adaptive-zip-limit.js";
import { S3ArchiveError, type ArchiveErrorContextValue } from "./errors.js";
import type { ArchiveThroughputSampler } from "./archive-throughput.js";
import type { ThroughputAdaptiveZipConcurrencyOptions } from "./types.js";

/**
 * **ZIP experimental:** adjust {@link ThroughputAdaptiveZipLimiter} caps using trailing read throughput vs a
 * target, with **hysteresis** (consecutive samples) to avoid oscillation from noisy `rollingBytesReadPerSecond`.
 *
 * **Model:** Let \(r_t\) be the rolling read rate (bytes/s) from {@link ArchiveThroughputSampler}. With
 * target \(T\), low ratio \(L\) (default 0.65), high ratio \(H\) (default 0.92):
 * - If \(r_t < L \cdot T\) for `breachesToDecrease` consecutive evaluations → decrease cap by 1.
 * - If \(r_t > H \cdot T\) for `samplesToIncrease` consecutive evaluations → increase cap by 1.
 * - Else reset both streaks (dead-band).
 *
 * Evaluations are throttled by {@link ThroughputAdaptiveZipConcurrencyOptions.sampleMinIntervalMs}.
 * **Mutually exclusive** with throttle-based `experimentalAdaptiveZipConcurrency` (enforced in the pump).
 */
export class ThroughputZipAdaptiveController {
  readonly #target: number;
  readonly #lowR: number;
  readonly #highR: number;
  readonly #breachN: number;
  readonly #upN: number;
  readonly #minCap: number;
  readonly #intervalMs: number;
  #lowStreak = 0;
  #highStreak = 0;
  /** Last wall time (ms) an evaluation ran; initialized so the first {@link observe} is not throttled at `nowMs === 0`. */
  #lastEvalAt = 0;

  constructor(cfg: ThroughputAdaptiveZipConcurrencyOptions) {
    if (
      !Number.isFinite(cfg.targetReadBytesPerSecond) ||
      cfg.targetReadBytesPerSecond <= 0
    ) {
      throw new S3ArchiveError(
        "ThroughputZipAdaptiveController: targetReadBytesPerSecond must be a positive finite number.",
        "INVALID_THROUGHPUT_CONFIG",
        {
          phase: "bootstrap",
          context: { targetReadBytesPerSecond: cfg.targetReadBytesPerSecond },
        },
      );
    }
    this.#target = cfg.targetReadBytesPerSecond;
    this.#lowR = cfg.lowWaterMarkRatio ?? 0.65;
    this.#highR = cfg.highWaterMarkRatio ?? 0.92;
    this.#breachN = Math.max(1, cfg.breachesToDecrease ?? 2);
    this.#upN = Math.max(1, cfg.samplesToIncrease ?? 5);
    this.#minCap = Math.max(1, cfg.minCap ?? 1);
    this.#intervalMs = Math.max(50, cfg.sampleMinIntervalMs ?? 500);
    this.#lastEvalAt = -this.#intervalMs;
  }

  observe(params: {
    nowMs: number;
    sampler: ArchiveThroughputSampler;
    limiter: ThroughputAdaptiveZipLimiter;
    log?: {
      debug: (
        obj: Record<string, ArchiveErrorContextValue>,
        msg: string,
      ) => void;
    };
  }): void {
    const { nowMs, sampler, limiter, log } = params;
    if (nowMs - this.#lastEvalAt < this.#intervalMs) return;
    this.#lastEvalAt = nowMs;

    const rate = sampler.snapshot(nowMs).rollingBytesReadPerSecond;
    if (!Number.isFinite(rate) || rate <= 0) return;

    const lowLine = this.#target * this.#lowR;
    const highLine = this.#target * this.#highR;

    if (rate < lowLine) {
      this.#lowStreak += 1;
      this.#highStreak = 0;
      if (this.#lowStreak >= this.#breachN && limiter.getCap() > this.#minCap) {
        limiter.decreaseCapForExternalSignal();
        this.#lowStreak = 0;
        log?.debug(
          {
            adaptive: "throughput-zip",
            cap: limiter.getCap(),
            rate,
            target: this.#target,
          },
          "adaptive zip: lowered GetObject cap (below throughput low line)",
        );
      }
    } else if (rate > highLine) {
      this.#highStreak += 1;
      this.#lowStreak = 0;
      if (
        this.#highStreak >= this.#upN &&
        limiter.getCap() < limiter.getInitialCap()
      ) {
        limiter.increaseCapTowardMax();
        this.#highStreak = 0;
        log?.debug(
          {
            adaptive: "throughput-zip",
            cap: limiter.getCap(),
            rate,
            target: this.#target,
          },
          "adaptive zip: raised GetObject cap (above throughput high line)",
        );
      }
    } else {
      this.#lowStreak = 0;
      this.#highStreak = 0;
    }
  }
}
