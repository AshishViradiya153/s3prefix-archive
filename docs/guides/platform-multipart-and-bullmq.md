# Guide: platform, multipart upload & BullMQ

## `s3prefix-archive/platform`

Install **`@aws-sdk/lib-storage`**.

- **`runFolderArchiveToS3`** — streams the archive through a **`PassThrough`** into **`Upload`**; multipart upload to **`output.bucket`** / **`output.key`**.
- **`runFolderArchiveToWritable`** — same pump when you already have a **`Writable`** (e.g. file).

Checkpoint and all **`CreateFolderArchiveStreamOptions`** fields apply the same way as the default entrypoint.

Post-upload, you can **`HeadObject`** the destination and compare size to **`stats.bytesWritten`** using **`verifyS3ObjectBytesMatchArchiveStats`** from **`s3prefix-archive`** (not `s3prefix-archive/platform`; grant **`s3:GetObject`** on that object for `HeadObject`).

Examples: [examples/run-multipart-to-s3.ts](../../examples/run-multipart-to-s3.ts), [examples/lambda-archive-to-s3.ts](../../examples/lambda-archive-to-s3.ts).

## `s3prefix-archive/bullmq`

Install **`bullmq`** in worker processes.

- **`enqueueFolderArchiveToS3`** — add jobs with **`FolderArchiveToS3JobData`** (JSON-safe; filters are glob strings, not functions).
- **`createFolderArchiveToS3Processor`** — worker processor; inject **`S3Client`**, optional **`resolveCheckpointStore`**, **`prometheus`**, **`logger`**.

Examples: [examples/bullmq-enqueue-job.ts](../../examples/bullmq-enqueue-job.ts), [examples/bullmq-archive-worker.ts](../../examples/bullmq-archive-worker.ts).

## In-memory job registry

**`InMemoryArchiveJobRegistry`** and related **`ArchiveJob*Error`** classes are exported from **`s3prefix-archive`** and **re-exported** from **`s3prefix-archive/platform`** (see `src/archive-background-jobs.ts`). Use them for lightweight in-process job tracking without Redis; for distributed work, use BullMQ or your own queue.
