import { PassThrough, type Readable } from "node:stream";

/** Minimum allowed `getObjectReadBufferHighWaterMark` (bytes; aligns with validation). */
export const GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES = 1024;

/**
 * Wraps `source` in a {@link PassThrough} with the given `highWaterMark`, so **this leg** of the
 * pipeline applies standard Node backpressure: when unread buffered bytes in the pass-through exceed
 * `highWaterMark`, the upstream `source` is paused until the consumer drains.
 *
 * This bounds **per-object** buffering on the GetObject → archive path; it is **not** a process RSS
 * cap (see also {@link CreateFolderArchiveStreamOptions.maxInFlightReadBytes} for aggregate
 * concurrency-weighted reservation).
 */
export function wrapReadableWithReadBufferHighWaterMark(
  source: Readable,
  highWaterMark: number,
): Readable {
  const pt = new PassThrough({ highWaterMark });
  source.on("error", (err) => {
    pt.destroy(err);
  });
  source.pipe(pt);
  return pt;
}
