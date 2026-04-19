/**
 * Producer side: enqueue a multipart “folder → S3” job for workers running
 * `createFolderArchiveToS3Processor` (see bullmq-archive-worker.ts).
 *
 * Install: `bullmq`, `s3flow`, `@aws-sdk/client-s3`, `@aws-sdk/lib-storage` on workers.
 * Environment: `SOURCE_URI`, `DEST_BUCKET`, `DEST_KEY`; optional `REDIS_HOST`, `REDIS_PORT`.
 */
import { Queue } from "bullmq";
import {
  DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME,
  enqueueFolderArchiveToS3,
} from "s3flow/bullmq";

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI;
  const bucket = process.env.DEST_BUCKET;
  const key = process.env.DEST_KEY;
  if (!source || !bucket || !key) {
    throw new Error("Set SOURCE_URI, DEST_BUCKET, DEST_KEY");
  }

  const queue = new Queue(DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME, {
    connection: {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  });

  const job = await enqueueFolderArchiveToS3(queue, {
    source,
    output: { bucket, key },
    format: "zip",
  });

  console.log("enqueued job id", job.id);
  await queue.close();
}

void main();
