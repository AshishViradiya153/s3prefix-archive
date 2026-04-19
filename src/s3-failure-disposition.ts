import { awsHttpStatusCode } from "./aws-sdk-metadata.js";
import type { CaughtValue, S3ArchiveError } from "./errors.js";
import { isS3ArchiveError } from "./errors.js";
import { classifyAwsS3RetryKind, isRetryableAwsError } from "./retry.js";

/**
 * After retries are exhausted, whether the failure is likely **transient** (worth another job
 * attempt later), a **throttle** (back off / widen concurrency), a **client/permanent** fault
 * (fix IAM, key, or request shape), or **ambiguous**.
 */
export type S3TerminalFailureDisposition =
  | "transient"
  | "throttle"
  | "permanent_client"
  | "ambiguous";

/** Map HTTP status to disposition when it is decisive; otherwise `null` (caller continues classification). */
function dispositionFromHttpStatus(
  status: number | undefined,
): S3TerminalFailureDisposition | null {
  if (status === undefined) return null;
  if (status === 429) return "throttle";
  if (status >= 500 && status <= 599) return "transient";
  if (status === 408) return "transient";
  if (status >= 400 && status < 500) return "permanent_client";
  return null;
}

function httpStatusFromS3RequestFailedContext(
  err: S3ArchiveError,
): number | undefined {
  const c = err.context;
  return c && typeof c["httpStatusCode"] === "number"
    ? (c["httpStatusCode"] as number)
    : undefined;
}

/**
 * Classify a **terminal** S3 List/Get failure for alerting, routing, and backoff policy.
 * Uses HTTP status when present (SDK errors, {@link S3ArchiveError} `S3_REQUEST_FAILED` context),
 * then {@link classifyAwsS3RetryKind} / {@link isRetryableAwsError} as a fallback for live errors.
 */
export function classifyTerminalS3Failure(
  err: CaughtValue,
): S3TerminalFailureDisposition {
  if (isS3ArchiveError(err) && err.code === "S3_REQUEST_FAILED") {
    const d = dispositionFromHttpStatus(
      httpStatusFromS3RequestFailedContext(err),
    );
    return d ?? "ambiguous";
  }

  const fromStatus = dispositionFromHttpStatus(awsHttpStatusCode(err));
  if (fromStatus !== null) return fromStatus;

  const kind = classifyAwsS3RetryKind(err);
  if (kind === "throttle") return "throttle";
  if (kind === "server-error" || kind === "timeout" || kind === "network")
    return "transient";

  if (err instanceof Error && isRetryableAwsError(err)) return "transient";

  if (isS3ArchiveError(err)) return "ambiguous";
  if (err instanceof Error && err.name === "AbortError") return "ambiguous";

  return "ambiguous";
}
