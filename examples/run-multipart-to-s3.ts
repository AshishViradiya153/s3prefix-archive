/**
 * Stream an archive straight to S3 with multipart upload (`@aws-sdk/lib-storage`).
 *
 * Install the peer: `npm install @aws-sdk/lib-storage`
 * Environment: `SOURCE_URI`, `DEST_BUCKET`, `DEST_KEY`
 */
import { S3Client } from "@aws-sdk/client-s3";
import { runFolderArchiveToS3 } from "s3prefix-archive/platform";

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI;
  const bucket = process.env.DEST_BUCKET;
  const key = process.env.DEST_KEY;
  if (!source || !bucket || !key) {
    throw new Error("Set SOURCE_URI, DEST_BUCKET, DEST_KEY");
  }

  const client = new S3Client({});
  const result = await runFolderArchiveToS3({
    client,
    source,
    format: "zip",
    output: { type: "s3-multipart", bucket, key },
  });

  console.log(
    JSON.stringify({
      jobId: result.jobId,
      bytesWritten: result.stats.bytesWritten,
    }),
  );
}

void main();
