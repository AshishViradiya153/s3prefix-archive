import { awsSdkTerminalErrorContext } from "./aws-sdk-metadata.js";
import { S3ArchiveError } from "./errors.js";

function shortMessage(err: Error): string {
  return err.message;
}

/**
 * Wrap a **terminal** S3 failure (after retries) so callers get {@link S3ArchiveError} with
 * stable {@link S3ArchiveError.code `S3_REQUEST_FAILED`}, {@link S3ArchiveError.phase `phase`},
 * structured {@link S3ArchiveError.context `context`}, and the original error as {@link Error.cause}.
 *
 * Prefer branching on `code === "S3_REQUEST_FAILED"` and `context.httpStatusCode` (e.g. 403, 404)
 * for user messaging; inspect `cause` for full AWS details.
 */
export function s3RequestFailed(params: {
  operation: "listObjectsV2" | "getObject";
  bucket: string;
  prefix?: string;
  key?: string;
  cause: Error;
}): S3ArchiveError {
  const { operation, bucket, prefix, key, cause } = params;
  const meta = awsSdkTerminalErrorContext(cause);
  const loc =
    operation === "listObjectsV2"
      ? `prefix "${prefix ?? ""}"`
      : `key "${key ?? ""}"`;
  const msg = `S3 ${operation} failed for s3://${bucket}/ (${loc}): ${shortMessage(cause)}`;
  const phase: "list" | "getObject" =
    operation === "listObjectsV2" ? "list" : "getObject";
  return new S3ArchiveError(msg, "S3_REQUEST_FAILED", {
    cause,
    phase,
    context: {
      operation,
      bucket,
      ...(prefix !== undefined ? { prefix } : {}),
      ...(key !== undefined ? { key } : {}),
      ...meta,
    },
  });
}
