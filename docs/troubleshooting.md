# Troubleshooting & FAQ

## I get `S3_REQUEST_FAILED` or 403 on List/Get

- Confirm **IAM** allows **`s3:ListBucket`** on the bucket with the right **prefix** conditions, and **`s3:GetObject`** on the object keys you archive.
- For **multi-root** jobs, every **`additionalListSources`** root must be allowed.
- Inspect **`error.cause`** and **`context`** on **`S3ArchiveError`**; use **`describeArchiveFailure`** for operator-facing text. Full code list: [errors.md](errors.md).

## Resume fails with `CHECKPOINT_MISMATCH`

Align **`source`**, **`format`**, **`additionalListSources`** (canonical order), and **`jobId`** with the original run—or start a **new** `jobId`. See [checkpoints guide](guides/checkpoints-and-resume.md).

## Prepared index errors (`INVALID_PREPARED_INDEX_LINE`, `PREPARED_INDEX_KEY_PREFIX_MISMATCH`)

- Regenerate NDJSON; each line must be valid JSON with **`key`** and **`size`**.
- Keys must start with the **`source`** prefix. See [prepared index guide](guides/prepared-index.md).

## ZIP vs tar concurrency errors (`UNSUPPORTED_OPTION`)

- **tar / tar.gz** require **`concurrency: 1`** (or omit). Some ZIP options (adaptive concurrency, object priority) are ZIP-only. Read the error message and [architecture](architecture.md).

## Browser vs server archive

For large exports, prefer **server-side** `s3-archive-download`; for small sets, **presigned GET** URLs and a client-side zip library may suffice. Use **`recommendArchiveExecutionSurface`** for a stable hint. See [presigned-urls.md](presigned-urls.md).

## Where to ask for help

- **Issues:** repository URL in `package.json` **`bugs`**
- **Security:** [SECURITY.md](../SECURITY.md) — do not file public issues for undisclosed vulnerabilities

## Related

- [Errors and codes](errors.md)
- [Getting started](getting-started.md)
