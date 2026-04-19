import type { FailedAttemptError } from "p-retry";
import { setTimeout as sleep } from "node:timers/promises";
import { awsHttpStatusCode } from "./aws-sdk-metadata.js";
import type { CaughtValue } from "./errors.js";

function isPlainObject(
  value: CaughtValue,
): value is Record<PropertyKey, CaughtValue> {
  return typeof value === "object" && value !== null;
}

/**
 * Coarse bucket for S3 (or SDK-shaped) errors when deciding observability or backoff policy.
 * Used by {@link ArchiveS3RetryContext.kind} on archive `retry.onRetry`.
 */
export type AwsS3RetryKind =
  | "throttle"
  | "server-error"
  | "timeout"
  | "network"
  | "other";

/**
 * Classify an error from List/Get (same signals as {@link isRetryableAwsError}, split for UX).
 */
export function classifyAwsS3RetryKind(err: CaughtValue): AwsS3RetryKind {
  if (!isPlainObject(err)) return "other";
  const c = awsHttpStatusCode(err);
  if (typeof c === "number") {
    if (c === 429) return "throttle";
    if (c >= 500 && c <= 599) return "server-error";
  }
  const n = typeof err["name"] === "string" ? err["name"] : "";
  if (
    n === "ThrottlingException" ||
    n === "SlowDown" ||
    n === "RequestLimitExceeded" ||
    n === "TooManyRequestsException"
  ) {
    return "throttle";
  }
  if (n === "TimeoutError") return "timeout";
  if (n === "NetworkingError") return "network";
  if (n === "ServiceUnavailable" || n === "InternalError")
    return "server-error";
  return "other";
}

export function isRetryableAwsError(err: CaughtValue): boolean {
  if (!isPlainObject(err)) return false;
  const code = awsHttpStatusCode(err);
  if (typeof code === "number") {
    if (code === 429) return true;
    if (code >= 500) return true;
  }
  const n = typeof err["name"] === "string" ? err["name"] : "";
  return (
    n === "TimeoutError" ||
    n === "NetworkingError" ||
    n === "ThrottlingException" ||
    n === "SlowDown" ||
    n === "RequestLimitExceeded" ||
    n === "TooManyRequestsException" ||
    n === "ServiceUnavailable" ||
    n === "InternalError"
  );
}

/**
 * Build the sorted backoff schedule used by `p-retry` / `retry` (factor 2, randomize).
 * @internal exported for tests
 */
export function buildRetryBackoffTimeouts(
  retries: number,
  factor: number,
  minTimeout: number,
  maxTimeout: number,
  randomize: boolean,
): number[] {
  const timeouts: number[] = [];
  for (let i = 0; i < retries; i++) {
    const random = randomize ? Math.random() + 1 : 1;
    let t = Math.round(random * Math.max(minTimeout, 1) * Math.pow(factor, i));
    t = Math.min(t, maxTimeout);
    timeouts.push(t);
  }
  timeouts.sort((a, b) => a - b);
  return timeouts;
}

function decorateFailedAttempt(
  err: Error,
  attemptNumber: number,
  retriesMax: number,
): void {
  const retriesLeft = retriesMax - (attemptNumber - 1);
  (
    err as FailedAttemptError & { attemptNumber: number; retriesLeft: number }
  ).attemptNumber = attemptNumber;
  (
    err as FailedAttemptError & { attemptNumber: number; retriesLeft: number }
  ).retriesLeft = retriesLeft;
}

export interface WithRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  isRetryable?: (err: Error) => boolean;
  /**
   * Called after a failed attempt, before sleeping until the next attempt (not on terminal failure).
   * `scheduledDelayMs` matches the `retry` package schedule used previously by `p-retry`.
   */
  onRetry?: (error: FailedAttemptError, scheduledDelayMs: number) => void;
}

/**
 * Retry with exponential backoff (same defaults as `p-retry`: factor 2, randomize, sorted delays).
 * Implemented locally so {@link WithRetryOptions.onRetry} receives the **exact** post-backoff delay.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: WithRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 4);
  const retriesMax = Math.max(0, maxAttempts - 1);
  const minTimeout = opts.baseDelayMs ?? 200;
  const maxTimeout = opts.maxDelayMs ?? 10_000;
  const timeouts = buildRetryBackoffTimeouts(
    retriesMax,
    2,
    minTimeout,
    maxTimeout,
    true,
  );
  const isRetryable = opts.isRetryable ?? isRetryableAwsError;

  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (raw) {
      opts.signal?.throwIfAborted();
      if (!(raw instanceof Error)) {
        throw new TypeError(
          `Non-error was thrown: "${String(raw)}". You should only throw errors.`,
        );
      }
      const err = raw;
      lastErr = err;
      decorateFailedAttempt(err, attempt, retriesMax);
      if (!isRetryable(err)) throw err;
      if (attempt >= maxAttempts) throw err;
      const scheduledDelayMs = timeouts[attempt - 1] ?? 0;
      opts.onRetry?.(err as FailedAttemptError, scheduledDelayMs);
      if (scheduledDelayMs > 0) {
        await sleep(scheduledDelayMs, undefined, { signal: opts.signal });
      }
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error(String(lastErr));
}
