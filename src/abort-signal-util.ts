/**
 * Merge an optional caller {@link AbortSignal} with a wall-clock timeout (Node 18+).
 * When `timeoutMs` is unset or ≤ 0, returns `signal` unchanged.
 */
export function mergeAbortSignalWithTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (timeoutMs == null || timeoutMs <= 0) return signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return AbortSignal.any([signal, timeoutSignal]);
}
