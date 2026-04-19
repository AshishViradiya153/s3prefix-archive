import { S3ArchiveError } from "./errors.js";

/**
 * Partitions **wall clock** among list / download / archive-write using **processor-sharing** occupancy:
 * when stages overlap (e.g. parallel ZIP), each interval \([t,t+dt)\) is split so that stage \(s\) receives
 * \(dt \cdot n_s / \sum_k n_k\), where \(n_s\) is the active ref-count for \(s\). This is a **true partition**
 * of wall time (up to floating-point error); \(\sum_s \text{share}_s = dt\) whenever \(\sum_k n_k > 0\).
 *
 * Replaces residual `listMs = wall − Σ per-object work`, which is **not** a partition under overlap
 * (per-object durations sum can exceed wall time).
 *
 * **Clock:** assumes `nowMs` is non-decreasing between calls; if the host clock steps backward, `dt` is
 * clamped to \(0\) (no negative attribution).
 */
export interface ArchiveStageOccupancySnapshot {
  readonly listMs: number;
  readonly downloadMs: number;
  readonly archiveWriteMs: number;
  readonly stageIdleMs: number;
}

export class ArchiveStageOccupancyMeter {
  #lastNow: number;
  #list = 0;
  #download = 0;
  #archive = 0;
  #listMs = 0;
  #downloadMs = 0;
  #archiveMs = 0;
  #idleMs = 0;

  constructor(wall0Ms: number) {
    this.#lastNow = wall0Ms;
  }

  /**
   * Advance the clock: attribute `dt = nowMs - lastNow` (clamped) to idle if no stage is active,
   * else split among `{list, download, archive}` by ref-count weights.
   */
  #advance(nowMs: number): void {
    const dt = Math.max(0, nowMs - this.#lastNow);
    this.#lastNow = nowMs;
    const weight = this.#list + this.#download + this.#archive;
    if (weight === 0) {
      this.#idleMs += dt;
      return;
    }
    this.#listMs += (dt * this.#list) / weight;
    this.#downloadMs += (dt * this.#download) / weight;
    this.#archiveMs += (dt * this.#archive) / weight;
  }

  enterListWait(nowMs: number = Date.now()): void {
    this.#advance(nowMs);
    this.#list += 1;
  }

  leaveListWait(nowMs: number = Date.now()): void {
    this.#advance(nowMs);
    this.#assertNonNegativeAfterDecrement("list", () => {
      this.#list -= 1;
    });
  }

  enterDownload(nowMs: number = Date.now()): void {
    this.#advance(nowMs);
    this.#download += 1;
  }

  leaveDownload(nowMs: number = Date.now()): void {
    this.#advance(nowMs);
    this.#assertNonNegativeAfterDecrement("download", () => {
      this.#download -= 1;
    });
  }

  enterArchiveWrite(nowMs: number = Date.now()): void {
    this.#advance(nowMs);
    this.#archive += 1;
  }

  leaveArchiveWrite(nowMs: number = Date.now()): void {
    this.#advance(nowMs);
    this.#assertNonNegativeAfterDecrement("archive", () => {
      this.#archive -= 1;
    });
  }

  #assertNonNegativeAfterDecrement(
    kind: "list" | "download" | "archive",
    dec: () => void,
  ): void {
    dec();
    const n =
      kind === "list"
        ? this.#list
        : kind === "download"
          ? this.#download
          : this.#archive;
    if (n < 0) {
      throw new S3ArchiveError(
        `ArchiveStageOccupancyMeter: unbalanced leave (${kind} ref would be ${n})`,
        "INTERNAL_INVARIANT",
        { phase: "internal", context: { stage: kind } },
      );
    }
  }

  /**
   * Finalize the run: advances to `nowMs`, asserts all enter/leave pairs balanced, returns integer ms.
   * Rounding introduces at most ~1 ms per bucket vs. internal floats; `list + download + archive + idle`
   * may differ from `nowMs - wall0` by a few ms total.
   */
  finish(nowMs: number): ArchiveStageOccupancySnapshot {
    this.#advance(nowMs);
    if (this.#list !== 0 || this.#download !== 0 || this.#archive !== 0) {
      throw new S3ArchiveError(
        `ArchiveStageOccupancyMeter.finish: unclosed stages (list=${this.#list}, download=${this.#download}, archive=${this.#archive})`,
        "INTERNAL_INVARIANT",
        {
          phase: "internal",
          context: {
            list: this.#list,
            download: this.#download,
            archive: this.#archive,
          },
        },
      );
    }
    const snap: ArchiveStageOccupancySnapshot = {
      listMs: Math.round(this.#listMs),
      downloadMs: Math.round(this.#downloadMs),
      archiveWriteMs: Math.round(this.#archiveMs),
      stageIdleMs: Math.round(this.#idleMs),
    };
    return snap;
  }
}

/**
 * Wrap an async iterable so time blocked on `await it.next()` accrues to **list** occupancy.
 */
export function wrapAsyncIterableWithListStage<T>(
  meter: ArchiveStageOccupancyMeter,
  source: AsyncIterable<T>,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const inner = source[Symbol.asyncIterator]();
      return {
        async next(): Promise<IteratorResult<T, undefined>> {
          meter.enterListWait();
          try {
            return await inner.next();
          } finally {
            meter.leaveListWait();
          }
        },
      };
    },
  };
}
