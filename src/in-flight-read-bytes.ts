import type { ObjectMeta } from "./types.js";

/**
 * FIFO byte **budget** for overlapping object reads: each active object holds a reservation of
 * {@link readReservationBytes} (truncated sizes, clamped to the cap) until its body is fully consumed
 * into the archive. This bounds **worst-case** simultaneous buffering implied by listing sizes,
 * independent of ZIP {@link CreateFolderArchiveStreamOptions.concurrency}.
 *
 * Not a hard RSS cap (Node stream buffers and compression still apply); tune together with ZIP
 * `concurrency` and stream `highWaterMark` if you need tighter control.
 */
export interface InFlightReadByteLimiter {
  readonly maxBytes: number;
  /**
   * Wait until `min(requested, maxBytes)` bytes fit in the pool, then reserve them.
   * @returns Granted bytes (same as the reservation key for {@link InFlightReadByteLimiter.release}).
   */
  acquire(requested: number): Promise<number>;
  /** Return a prior grant from {@link acquire} when the object pipeline finishes (success or failure). */
  release(granted: number): void;
}

/**
 * Listing-derived reservation for one object: `min(trunc(meta.size), trunc(maxInFlightReadBytes))`
 * for positive finite sizes; zero/invalid sizes reserve nothing (empty objects).
 */
export function readReservationBytes(
  meta: ObjectMeta,
  maxInFlightReadBytes: number,
): number {
  const s = meta.size;
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.min(Math.trunc(s), Math.trunc(maxInFlightReadBytes));
}

/**
 * Create a FIFO limiter: `used + grant <= maxBytes` for all concurrently held grants.
 */
export function createInFlightReadByteLimiter(
  maxBytes: number,
): InFlightReadByteLimiter {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new RangeError(
      "createInFlightReadByteLimiter: maxBytes must be a finite number >= 1",
    );
  }
  let used = 0;
  const q: Array<{ n: number; resolve: () => void }> = [];

  const tryWake = (): void => {
    while (q.length > 0) {
      const next = q[0];
      if (used + next.n > maxBytes) break;
      q.shift()!;
      used += next.n;
      next.resolve();
    }
  };

  return {
    maxBytes,
    async acquire(requested: number): Promise<number> {
      if (!Number.isFinite(requested) || requested <= 0) {
        return 0;
      }
      const n = Math.min(Math.max(0, Math.floor(requested)), maxBytes);
      if (n === 0) return 0;
      if (used + n <= maxBytes) {
        used += n;
        return n;
      }
      await new Promise<void>((resolve) => {
        q.push({ n, resolve });
      });
      return n;
    },
    release(granted: number): void {
      const g = Math.floor(granted);
      if (g <= 0) return;
      used -= g;
      if (used < 0) used = 0;
      tryWake();
    },
  };
}
