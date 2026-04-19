import { Transform, type Readable } from "node:stream";
import type { ArchiveSlowGetObjectStreamInfo, ObjectMeta } from "./types.js";

/** Minimum bytes read before a slow-stream check may fire (reduces startup noise). */
export const SLOW_GET_OBJECT_MIN_BYTES = 32 * 1024;

/** Minimum elapsed ms before a slow-stream check may fire. */
export const SLOW_GET_OBJECT_MIN_ELAPSED_MS = 400;

/**
 * Pass-through transform that may invoke `onSlow` **once** when estimated read rate stays below
 * `thresholdBytesPerSecond` after both {@link SLOW_GET_OBJECT_MIN_BYTES} and
 * {@link SLOW_GET_OBJECT_MIN_ELAPSED_MS} are satisfied.
 */
export function wrapReadableWithSlowGetObjectMonitor(
  source: Readable,
  params: {
    thresholdBytesPerSecond: number;
    onSlow: (info: ArchiveSlowGetObjectStreamInfo) => void;
    meta: ObjectMeta;
    entryName: string;
    minBytes?: number;
    minElapsedMs?: number;
  },
): Readable {
  const minBytes = params.minBytes ?? SLOW_GET_OBJECT_MIN_BYTES;
  const minElapsedMs = params.minElapsedMs ?? SLOW_GET_OBJECT_MIN_ELAPSED_MS;
  let total = 0;
  let tFirst: number | null = null;
  let fired = false;

  const tr = new Transform({
    transform(chunk, enc, callback) {
      if (tFirst === null) tFirst = Date.now();
      total += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk as string, enc as BufferEncoding);
      if (!fired && tFirst !== null) {
        const elapsed = Date.now() - tFirst;
        if (total >= minBytes && elapsed >= minElapsedMs) {
          const bps = total / (elapsed / 1000);
          if (bps < params.thresholdBytesPerSecond) {
            fired = true;
            params.onSlow({
              meta: params.meta,
              entryName: params.entryName,
              bytesReadSoFar: total,
              elapsedMs: elapsed,
              estimatedBytesPerSecond: bps,
            });
          }
        }
      }
      callback(null, chunk);
    },
  });
  source.on("error", (err) => {
    tr.destroy(err);
  });
  return source.pipe(tr);
}
