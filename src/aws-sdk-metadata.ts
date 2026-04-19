import type { CaughtValue } from "./errors.js";

/**
 * Best-effort HTTP status from AWS SDK v3 `$metadata` on errors (List/Get and other `client.send` failures).
 */
export function awsHttpStatusCode(err: CaughtValue): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return typeof meta?.httpStatusCode === "number"
    ? meta.httpStatusCode
    : undefined;
}

/**
 * Small structured fields for {@link S3ArchiveError.context} when wrapping terminal SDK failures
 * (no secrets).
 */
export function awsSdkTerminalErrorContext(err: object): {
  name?: string;
  httpStatusCode?: number;
  requestId?: string;
} {
  const caught = err as CaughtValue;
  const e = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number; requestId?: string };
  };
  return {
    name: typeof e.name === "string" ? e.name : undefined,
    httpStatusCode: awsHttpStatusCode(caught),
    requestId:
      typeof e.$metadata?.requestId === "string"
        ? e.$metadata.requestId
        : undefined,
  };
}
