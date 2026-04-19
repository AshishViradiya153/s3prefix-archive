/**
 * Optional entrypoint for long-running / worker-style integrations:
 * multipart upload sink, checkpoint types, and job runner helpers.
 */
import { PassThrough, type Writable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { pumpArchiveToWritable } from "./pump-archive.js";
import type {
  ArchiveJobResult,
  CreateFolderArchiveStreamOptions,
  RunFolderArchiveJobOptions,
} from "./types.js";
import type { PumpArchiveResult } from "./pump-archive.js";
import { resolveArchiveContentType } from "./archive-mime.js";

export { resolveArchiveContentType } from "./archive-mime.js";
export { resolveArchiveLogger, resolveLogger } from "./logger.js";
export type { Logger } from "./logger.js";

export type { CheckpointState, CheckpointStore } from "./checkpoint.js";
export { FileCheckpointStore } from "./checkpoint.js";
export { SqlTableCheckpointStore } from "./sql-checkpoint-store.js";
export type {
  SqlCheckpointClient,
  SqlCheckpointDialect,
  SqlTableCheckpointStoreOptions,
} from "./sql-checkpoint-store.js";

export type { ArchiveJobResult, ArchiveJobStatus } from "./types.js";

/**
 * Stream an archive directly to S3 via multipart upload (`@aws-sdk/lib-storage` `Upload`).
 * Starts the upload consumer before finalizing the archive to avoid deadlocks on slow sinks.
 */
export async function runFolderArchiveToS3(
  options: RunFolderArchiveJobOptions,
): Promise<ArchiveJobResult> {
  const client = options.client ?? new S3Client(options.clientConfig ?? {});
  const body = new PassThrough();
  const upload = new Upload({
    client,
    params: {
      Bucket: options.output.bucket,
      Key: options.output.key,
      Body: body,
      ContentType:
        options.output.contentType ??
        resolveArchiveContentType(options.format ?? "zip", options.output.key),
    },
  });

  const jobId = options.checkpoint?.jobId ?? `job-${Date.now()}`;
  const uploadPromise = upload.done();

  try {
    const r = await pumpArchiveToWritable(body, options);
    await uploadPromise;
    return {
      ...r,
      jobId,
      bucket: options.output.bucket,
      key: options.output.key,
    };
  } catch (e) {
    body.destroy(e instanceof Error ? e : new Error(String(e)));
    await uploadPromise.catch(() => {});
    throw e;
  }
}

/**
 * Minimal job handle for embedding in a queue/worker: run the same pump as `createFolderArchiveStream`
 * but resolve when the destination stream finishes (e.g. after piping to `fs.createWriteStream`).
 */
export async function runFolderArchiveToWritable(
  destination: Writable,
  options: CreateFolderArchiveStreamOptions,
): Promise<PumpArchiveResult> {
  return pumpArchiveToWritable(destination, options);
}

export {
  ArchiveJobIdConflictError,
  ArchiveJobFailedError,
  ArchiveJobNotCompletedError,
  ArchiveJobNotFoundError,
  InMemoryArchiveJobRegistry,
} from "./archive-background-jobs.js";
export type {
  ArchiveBackgroundJobSnapshot,
  ArchiveJobErrorSnapshot,
  CreateArchiveBackgroundJobOptions,
} from "./archive-background-jobs.js";
