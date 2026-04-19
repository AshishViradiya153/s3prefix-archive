/**
 * Any value that may be thrown in JavaScript. Use at API boundaries fed from `catch`
 * (e.g. `describeArchiveFailure(e as CaughtValue)` when `strict` catch typing applies).
 */
export type CaughtValue =
  | undefined
  | null
  | string
  | number
  | boolean
  | bigint
  | symbol
  | object;

/** Plain object values allowed in {@link S3ArchiveError.context} (recursive). */
export interface ArchiveErrorContextRecord {
  readonly [key: string]: ArchiveErrorContextValue;
}

/**
 * JSON-serializable-friendly values for {@link S3ArchiveError.context} (no functions, no `bigint` in JSON output).
 */
export type ArchiveErrorContextValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | bigint
  | readonly ArchiveErrorContextValue[]
  | ArchiveErrorContextRecord;

/**
 * Stable machine-readable codes for {@link S3ArchiveError}. Check `instanceof S3ArchiveError`
 * and read `.code` for branching; use {@link describeArchiveFailure} for user-facing text + hints.
 */
export type S3ArchiveErrorCode =
  | "S3_ARCHIVE_ERROR"
  | "UNSUPPORTED_OPTION"
  | "INVALID_CONFIGURATION"
  | "INVALID_S3_URI"
  | "INVALID_ENTRY_MAPPING"
  | "ENTRY_MAPPING_BUCKET_MISMATCH"
  | "INVALID_ADDITIONAL_SOURCES"
  | "CHECKPOINT_MISMATCH"
  | "CHECKPOINT_DEDUPE_RESUME"
  | "MISSING_CHECKPOINT"
  | "CHECKPOINT_NOT_FOUND"
  | "INVALID_PREPARED_INDEX_LINE"
  | "PREPARED_INDEX_KEY_PREFIX_MISMATCH"
  | "GET_OBJECT_EMPTY_BODY"
  | "GET_OBJECT_BODY_UNSUPPORTED"
  | "GET_OBJECT_ETAG_MISMATCH"
  | "ZIP_ERROR"
  | "PATH_UNSAFE"
  | "REDIS_ADAPTER_INCOMPLETE"
  | "INTERNAL_INVARIANT"
  | "INVALID_THROUGHPUT_CONFIG"
  | "S3_REQUEST_FAILED";

/**
 * Where in the pipeline a failure was classified (best-effort; not every throw sets this).
 */
export type ArchiveErrorPhase =
  | "bootstrap"
  | "checkpoint"
  | "list"
  | "getObject"
  | "archive_write"
  | "prepared_index"
  | "resume"
  | "internal";

export interface S3ArchiveErrorDetails extends Omit<ErrorOptions, "cause"> {
  /** Original failure (AWS SDK, ZIP, etc.). */
  cause?: Error;
  /** Narrow stage for logs and support (optional). */
  phase?: ArchiveErrorPhase;
  /** Small structured payload (keys, option names)—avoid secrets. */
  context?: Readonly<Record<string, ArchiveErrorContextValue>>;
}

const HINTS: Partial<Record<S3ArchiveErrorCode, string>> = {
  UNSUPPORTED_OPTION:
    "Change options to match the stated constraint (format, concurrency, or incompatible feature pairs).",
  INVALID_CONFIGURATION:
    "Fix numeric or experimental options (e.g. positive throughput target, Redis adapter capabilities).",
  INVALID_S3_URI:
    "Use `s3://bucket/prefix/` with a non-empty bucket and valid prefix segment.",
  INVALID_ENTRY_MAPPING:
    "Ensure every `entryMappings` key is non-empty and every value is a non-empty archive path.",
  ENTRY_MAPPING_BUCKET_MISMATCH:
    "Only map keys in buckets allowed for this run (primary + `additionalListSources` when using `s3://` keys).",
  INVALID_ADDITIONAL_SOURCES:
    "Each extra root must be a distinct `s3://` URI and must not duplicate the primary source.",
  CHECKPOINT_MISMATCH:
    "Use the same `source`, `format`, and `additionalListSources` as when the checkpoint was created, or start a new `jobId`.",
  CHECKPOINT_DEDUPE_RESUME:
    "Clear the checkpoint, use a new `jobId`, or disable path/content dedupe for this resume.",
  MISSING_CHECKPOINT:
    "Pass `checkpoint: { jobId, store }` matching the interrupted run.",
  CHECKPOINT_NOT_FOUND:
    "Run at least once with checkpoint enabled before calling resume, or use a fresh archive API.",
  INVALID_PREPARED_INDEX_LINE:
    "Each NDJSON line must be JSON with `key` and `size`; fix the prepared index file or regenerate it.",
  PREPARED_INDEX_KEY_PREFIX_MISMATCH:
    "Every `key` must start with the same prefix as `source`; align index generation with the URI.",
  GET_OBJECT_EMPTY_BODY:
    "S3 returned an object with no body (unusual); verify the key, permissions, and SDK/stream middleware.",
  GET_OBJECT_BODY_UNSUPPORTED:
    "Ensure the AWS SDK returns a Node Readable or web ReadableStream for GetObject Body in this runtime.",
  GET_OBJECT_ETAG_MISMATCH:
    "Streamed bytes MD5 does not match the object ETag (single-part objects only); verify key/version or disable verifyGetObjectMd5Etag.",
  ZIP_ERROR:
    "ZIP encoder failed—check the `cause` chain for the underlying stream or disk error.",
  PATH_UNSAFE:
    "Change `mapEntryName` / `entryMappings` so paths cannot escape the archive (no `..`, no absolute).",
  REDIS_ADAPTER_INCOMPLETE:
    "When using TTL, pass a Redis client that implements `expire` (see RedisCheckpointStoreOptions).",
  INTERNAL_INVARIANT:
    "Internal metering bug—report with reproduction; stage occupancy enter/leave should always pair.",
  INVALID_THROUGHPUT_CONFIG:
    "Set `targetReadBytesPerSecond` to a positive finite number.",
  S3_REQUEST_FAILED:
    "Inspect `context.httpStatusCode` and IAM (403), object existence (404), throttling (429/503), or `cause` for the AWS error name/message.",
};

export class S3ArchiveError extends Error {
  readonly code: S3ArchiveErrorCode;
  readonly phase?: ArchiveErrorPhase;
  readonly context?: Readonly<Record<string, ArchiveErrorContextValue>>;

  constructor(
    message: string,
    code: S3ArchiveErrorCode = "S3_ARCHIVE_ERROR",
    options?: S3ArchiveErrorDetails,
  ) {
    const { phase, context, cause, ...rest } = options ?? {};
    super(message, { ...rest, ...(cause !== undefined ? { cause } : {}) });
    this.name = "S3ArchiveError";
    this.code = code;
    this.phase = phase;
    this.context = context;
  }
}

export class PathUnsafeError extends S3ArchiveError {
  constructor(message: string, options?: S3ArchiveErrorDetails) {
    super(message, "PATH_UNSAFE", options);
    this.name = "PathUnsafeError";
  }
}

function readCauseChain(err: Error): CaughtValue | undefined {
  const extended = err as Error & { readonly cause?: CaughtValue };
  return extended.cause;
}

export function isS3ArchiveError(err: CaughtValue): err is S3ArchiveError {
  return err instanceof S3ArchiveError;
}

export function isPathUnsafeError(err: CaughtValue): err is PathUnsafeError {
  return err instanceof PathUnsafeError;
}

/** Walk `Error.cause` (ES2022) for logging and support. */
export function summarizeErrorCauses(err: CaughtValue, maxDepth = 8): string[] {
  const out: string[] = [];
  let cur: CaughtValue | undefined = err;
  let d = 0;
  while (cur != null && d < maxDepth) {
    if (cur instanceof Error) {
      const line = cur.message ? `${cur.name}: ${cur.message}` : cur.name;
      out.push(line);
      cur = readCauseChain(cur);
    } else {
      out.push(String(cur));
      break;
    }
    d += 1;
  }
  return out;
}

/**
 * Structured description for UI, CLI, or API responses. Library errors include {@link S3ArchiveError.code}
 * and an optional **hint**; non-library throws are still summarized with {@link summarizeErrorCauses}.
 */
export interface ArchiveFailureDescription {
  /** Top error message (always set). */
  message: string;
  /** True when thrown by this package (`S3ArchiveError` / `PathUnsafeError`). */
  library: boolean;
  /** Machine code when `library` (branch in application code). */
  code?: S3ArchiveErrorCode;
  phase?: ArchiveErrorPhase;
  context?: Readonly<Record<string, ArchiveErrorContextValue>>;
  /** One-line remediation when known. */
  hint?: string;
  /** `cause` chain from the outer error inward. */
  causes: string[];
}

export function describeArchiveFailure(
  err: CaughtValue,
): ArchiveFailureDescription {
  const causes = summarizeErrorCauses(err);
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);

  if (err instanceof PathUnsafeError) {
    return {
      message,
      library: true,
      code: "PATH_UNSAFE",
      phase: err.phase,
      context: err.context,
      hint: HINTS.PATH_UNSAFE,
      causes,
    };
  }
  if (err instanceof S3ArchiveError) {
    return {
      message,
      library: true,
      code: err.code,
      phase: err.phase,
      context: err.context,
      hint: HINTS[err.code],
      causes,
    };
  }
  return {
    message,
    library: false,
    causes,
  };
}
