# Errors and codes (`S3ArchiveError`)

Failures thrown by **this library** are usually instances of **`S3ArchiveError`** (or **`PathUnsafeError`**, a subclass). Always check:

```ts
import {
  S3ArchiveError,
  describeArchiveFailure,
  isS3ArchiveError,
} from "s3-archive-download";

try {
  await pumpArchiveToWritable(dest, options);
} catch (e) {
  if (isS3ArchiveError(e)) {
    console.error(e.code, e.message, e.phase, e.context);
  }
  const user = describeArchiveFailure(e); // { message, code?, hint?, causes[] }
}
```

## Fields

| Field     | Meaning                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `message` | Human-readable explanation (stable enough for logs; may include key/prefix snippets).                                             |
| `code`    | Machine-readable **`S3ArchiveErrorCode`**—use for branching in your app.                                                          |
| `phase`   | Optional pipeline phase: `bootstrap`, `checkpoint`, `list`, `getObject`, `archive_write`, `prepared_index`, `resume`, `internal`. |
| `context` | Small JSON-safe object (e.g. `{ context }` for GetObject)—**never** put secrets here.                                             |
| `cause`   | Standard `Error.cause` when this error wraps another (ZIP, AWS, etc.).                                                            |

## Code reference

| Code                                 | Typical cause                                                           | What to do                                                                |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `UNSUPPORTED_OPTION`                 | Incompatible or invalid options (format vs concurrency, feature pairs). | Adjust options per message (see hint in `describeArchiveFailure`).        |
| `INVALID_CONFIGURATION`              | Reserved for generic config issues (subset of option errors).           | Same as above.                                                            |
| `INVALID_S3_URI`                     | `source` is not `s3://bucket/prefix/`.                                  | Fix URI shape.                                                            |
| `INVALID_ENTRY_MAPPING`              | Empty key or empty path in `entryMappings`.                             | Fix mapping table.                                                        |
| `ENTRY_MAPPING_BUCKET_MISMATCH`      | `s3://` mapping key uses a bucket not in this run.                      | Allow bucket or use primary key form.                                     |
| `INVALID_ADDITIONAL_SOURCES`         | Duplicate or primary-repeated extra list root.                          | Deduplicate `additionalListSources`.                                      |
| `CHECKPOINT_MISMATCH`                | Resume/checkpoint scope does not match current request.                 | Align `source` / `format` / roots or new `jobId`.                         |
| `CHECKPOINT_DEDUPE_RESUME`           | Dedupe resume metadata missing or wrong.                                | New job or disable dedupe for this checkpoint.                            |
| `MISSING_CHECKPOINT`                 | Resume API without checkpoint options.                                  | Pass `checkpoint`.                                                        |
| `CHECKPOINT_NOT_FOUND`               | No state for `jobId`.                                                   | Run a checkpointed job first.                                             |
| `INVALID_PREPARED_INDEX_LINE`        | Bad JSON or schema in NDJSON index.                                     | Regenerate/fix index lines.                                               |
| `PREPARED_INDEX_KEY_PREFIX_MISMATCH` | Object key does not start with listing prefix.                          | Align index with `source` prefix.                                         |
| `GET_OBJECT_EMPTY_BODY`              | S3 `Body` was null/undefined.                                           | Key/version/permission issue or SDK middleware.                           |
| `GET_OBJECT_BODY_UNSUPPORTED`        | Body is not Node Readable or web stream.                                | Runtime/SDK mismatch.                                                     |
| `GET_OBJECT_ETAG_MISMATCH`           | Streamed bytes MD5 ≠ ETag (`verifyGetObjectMd5Etag`; single-part only). | Fix object/corruption or disable verification for multipart keys.         |
| `ZIP_ERROR`                          | yazl encoder entered error state.                                       | Inspect `cause` (stream backpressure, corrupt input).                     |
| `PATH_UNSAFE`                        | Entry path unsafe (`..`, etc.).                                         | Fix naming / mappings.                                                    |
| `REDIS_ADAPTER_INCOMPLETE`           | TTL set but Redis client has no `expire`.                               | Use ioredis/node-redis or implement `expire`.                             |
| `INTERNAL_INVARIANT`                 | Stage meter enter/leave mismatch (should not happen).                   | Report bug with repro.                                                    |
| `INVALID_THROUGHPUT_CONFIG`          | Non-positive throughput target.                                         | Set positive `targetReadBytesPerSecond`.                                  |
| `S3_REQUEST_FAILED`                  | `ListObjectsV2` / `GetObject` failed after retries (wrapped SDK error). | Check `context.httpStatusCode`, IAM, key/prefix, throttling; see `cause`. |
| `S3_ARCHIVE_ERROR`                   | Generic library error (default code).                                   | Read `message` and `causes`.                                              |

**AWS / network errors** from `@aws-sdk` on list/get are surfaced as **`S3ArchiveError`** with **`code: "S3_REQUEST_FAILED"`** and the SDK error as **`cause`** (after retries are exhausted). Other AWS surfaces may still appear as `cause` chains—use `describeArchiveFailure` **and** `summarizeErrorCauses` for full detail.

## See also

- [Documentation hub](README.md) — full docs index.
- [presigned-urls.md](presigned-urls.md) — presigned GET workflow vs server-side archives.
- [Troubleshooting](troubleshooting.md) — common failures and FAQ.
