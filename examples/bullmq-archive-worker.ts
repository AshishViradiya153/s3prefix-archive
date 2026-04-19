/**
 * Example long-running worker: process `s3prefix-archive/bullmq` folder→S3 archive jobs from Redis,
 * then **`HeadObject`**-verify uploaded bytes vs pump `stats.bytesWritten` (same pattern as
 * `examples/lambda-archive-to-s3.ts`).
 *
 * Install: `s3prefix-archive`, `bullmq`, `@aws-sdk/client-s3`, `@aws-sdk/lib-storage` (peer of `s3prefix-archive/platform`).
 * Run beside Redis; enqueue jobs from your API with `Queue` + `enqueueFolderArchiveToS3` from `s3prefix-archive/bullmq`.
 *
 * Environment (illustrative): `REDIS_HOST` (default `127.0.0.1`), `REDIS_PORT` (default `6379`).
 * IAM on workers: `s3:PutObject` (multipart) on the output key plus **`s3:GetObject` on that object** for `HeadObject` verify.
 */
import { S3Client } from "@aws-sdk/client-s3";
import type { Job } from "bullmq";
import { Worker } from "bullmq";
import { verifyS3ObjectBytesMatchArchiveStats } from "s3prefix-archive";
import {
  createFolderArchiveToS3Processor,
  DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME,
  type FolderArchiveToS3JobData,
} from "s3prefix-archive/bullmq";
import type { ArchiveJobResult } from "s3prefix-archive/platform";

function createVerifyingFolderArchiveProcessor(client: S3Client) {
  const inner = createFolderArchiveToS3Processor({ client });
  return async (
    job: Job<FolderArchiveToS3JobData, ArchiveJobResult>,
    token: string | undefined,
    signal?: AbortSignal,
  ): Promise<ArchiveJobResult> => {
    const result = await inner(job, token, signal);
    const verify = await verifyS3ObjectBytesMatchArchiveStats(
      client,
      { bucket: job.data.output.bucket, key: job.data.output.key },
      result.stats,
    );
    if (!verify.ok) {
      throw new Error(verify.reason ?? "S3 archive byte verify failed");
    }
    return result;
  };
}

async function main(): Promise<void> {
  const client = new S3Client({});
  const processor = createVerifyingFolderArchiveProcessor(client);
  const worker = new Worker(DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME, processor, {
    connection: {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  });

  const shutdown = async (): Promise<void> => {
    await worker.close();
  };

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  worker.on("failed", (job, err) => {
    console.error("job failed", job?.id, err);
  });
  worker.on("completed", (job) => {
    console.log("job completed", job.id);
  });
}

void main();
