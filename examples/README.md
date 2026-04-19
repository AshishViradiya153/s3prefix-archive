# s3prefix-archive examples

Runnable sketches aligned with published imports (`s3prefix-archive`, `s3prefix-archive/platform`, …). From a project that depends on `s3prefix-archive`, copy a file and adjust environment variables and ARNs/buckets. Deeper guides live in **[`docs/README.md`](../docs/README.md)**.

| Example                                                                  | What it shows                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| [basic-download-to-file.ts](basic-download-to-file.ts)                   | `downloadFolderToFile` — one await, ZIP to disk                                                                              |
| [stream-pipe-to-file.ts](stream-pipe-to-file.ts)                         | `createFolderArchiveStream` + `pipe` — classic streaming                                                                     |
| [checkpoint-file-resume.ts](checkpoint-file-resume.ts)                   | `FileCheckpointStore` + first run + `resumeFolderArchiveToFile`                                                              |
| [redis-checkpoint-adapter.ts](redis-checkpoint-adapter.ts)               | `RedisCheckpointStore` with a tiny in-memory `RedisCheckpointCommands` adapter (swap for ioredis/node-redis in production)   |
| [sql-checkpoint-adapter.ts](sql-checkpoint-adapter.ts)                   | Adapt `pg.Pool` to `SqlCheckpointClient` for `SqlTableCheckpointStore`                                                       |
| [prepared-index-two-step.ts](prepared-index-two-step.ts)                 | `prepareFolderArchiveIndexToFile` then `downloadFolderToFileFromPreparedIndex`                                               |
| [explicit-keys-prepared-index.ts](explicit-keys-prepared-index.ts)       | **`preparedIndexNdjson`** only—no live list; explicit keys for IAM/catalog-driven exports                                    |
| [additional-sources-multi-prefix.ts](additional-sources-multi-prefix.ts) | **`additionalListSources`** + **`parseAdditionalListSources`** — merge disjoint prefixes / buckets with fail-fast validation |
| [express-zip-response.ts](express-zip-response.ts)                       | `node:http` — ZIP as attachment + `suggestedCacheControlForArchiveDownload`                                                  |
| [run-multipart-to-s3.ts](run-multipart-to-s3.ts)                         | `runFolderArchiveToS3` — stream archive to destination object (needs `@aws-sdk/lib-storage`)                                 |
| [lambda-archive-to-s3.ts](lambda-archive-to-s3.ts)                       | Lambda handler: multipart upload + `verifyS3ObjectBytesMatchArchiveStats`                                                    |
| [bullmq-enqueue-job.ts](bullmq-enqueue-job.ts)                           | Producer: `enqueueFolderArchiveToS3` (pair with worker example)                                                              |
| [bullmq-archive-worker.ts](bullmq-archive-worker.ts)                     | Worker: `createFolderArchiveToS3Processor` + post-upload byte verify                                                         |
| [presigned-batch-sign.ts](presigned-batch-sign.ts)                       | `signGetObjectDownloadUrl` + `recommendArchiveExecutionSurface` for browser flows                                            |
| [gcs-zip-download.ts](gcs-zip-download.ts)                               | `GcsStorageProvider` + synthetic `s3://bucket/prefix/` URI (needs `@google-cloud/storage`)                                   |
| [azure-blob-zip-download.ts](azure-blob-zip-download.ts)                 | `AzureBlobStorageProvider` (needs `@azure/storage-blob`)                                                                     |
| [filters-explain-memory-provider.ts](filters-explain-memory-provider.ts) | `MemoryStorageProvider` — no AWS; `filters`, `explain`, `summarizeArchiveRunClassifications`                                 |
| [prometheus-memory-register.ts](prometheus-memory-register.ts)           | `prometheus: { register }` — completion metrics on a `prom-client` `Registry`                                                |
| [cost-and-strategy-hints-memory.ts](cost-and-strategy-hints-memory.ts)   | `estimateArchiveRunS3Usd` + `suggestArchiveRunStrategyHints` after a run                                                     |

CLI (`npx s3prefix-archive archive`, `npx s3prefix-archive index`, `npx s3prefix-archive benchmark`) is documented in the root [README.md](../README.md).
