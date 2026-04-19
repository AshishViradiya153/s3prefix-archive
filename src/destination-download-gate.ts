import { once } from "node:events";
import type { Writable } from "node:stream";

/**
 * Optional **scheduling** layer on top of Node’s encoder → `destination` `pipeline`: before starting
 * each new object `GetObject`, wait while `destination.writableNeedDrain` is true, then `await
 * once(destination, "drain")`.
 *
 * This reduces the **arrival rate** λ of new download tasks when the sink buffer is over
 * `highWaterMark` (Little’s law: in-flight work L ≈ λ × service time; lowering effective λ caps L
 * from the **source** side). It does not replace `stream/promises.pipeline` backpressure inside the
 * ZIP/tar encoder.
 */
export interface DestinationDownloadGate {
  beforeStartingObjectDownload: () => Promise<void>;
  getDrainWaitCount: () => number;
}

/**
 * @param signal When aborted, pending `drain` waits reject (same as `events.once` with `{ signal }`).
 */
export function createDestinationDownloadGate(
  destination: Writable,
  signal?: AbortSignal,
): DestinationDownloadGate {
  let drainWaits = 0;

  return {
    async beforeStartingObjectDownload(): Promise<void> {
      while (destination.writableNeedDrain) {
        drainWaits += 1;
        await once(destination, "drain", { signal });
      }
    },
    getDrainWaitCount(): number {
      return drainWaits;
    },
  };
}
