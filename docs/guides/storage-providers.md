# Guide: storage providers (GCS, Azure, custom)

## Built-in

- **`S3StorageProvider`** — default when **`storageProvider`** is omitted: uses your **`S3Client`** and **`source`** URI.
- **`MemoryStorageProvider`** — in-process map of keys → buffers; for tests and demos ([examples/filters-explain-memory-provider.ts](../../examples/filters-explain-memory-provider.ts)).

## Cloud adapters (peer installs)

| Module                  | Class                      | Peer package            |
| ----------------------- | -------------------------- | ----------------------- |
| `s3download/gcs`        | `GcsStorageProvider`       | `@google-cloud/storage` |
| `s3download/azure-blob` | `AzureBlobStorageProvider` | `@azure/storage-blob`   |

**URI shape:** keep **`source: "s3://bucket-or-container/prefix/"`** so the existing URI parser and path logic apply; data is read from GCS/Azure, not AWS.

**ETag / dedupe:** cross-cloud ETag strings may differ from S3 hex MD5—treat **`dedupeContentByEtag`** as best-effort when mixing providers.

Examples: [examples/gcs-zip-download.ts](../../examples/gcs-zip-download.ts), [examples/azure-blob-zip-download.ts](../../examples/azure-blob-zip-download.ts).

## Custom `StorageProvider`

Implement:

- **`listObjects(prefix, { signal })`** → async iterable of **`ObjectMeta`** (`key`, `size`, optional `etag`, …).
- **`getObjectStream(key, { signal, bucket })`** → Node **`Readable`**.

Use this when authorization is driven by your policy engine rather than raw S3 listing. Production code often wraps **`S3Client`** with extra checks.
