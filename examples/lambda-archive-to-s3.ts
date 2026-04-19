/**
 * Example AWS Lambda handler: stream an S3 prefix into a ZIP uploaded to another bucket/key,
 * then confirm the written object size matches pump `stats.bytesWritten` via `HeadObject`.
 *
 * Package your function with `s3flow`, `@aws-sdk/client-s3`, and `@aws-sdk/lib-storage` (`Upload`).
 * IAM: `s3:ListBucket` + `s3:GetObject` on the source prefix; `s3:PutObject` (multipart) on the destination;
 * **`s3:GetObject` on the destination object** for `HeadObject` during byte verify (same action as GET).
 *
 * Environment (illustrative): `SOURCE_URI`, `DEST_BUCKET`, `DEST_KEY`.
 */
import { S3Client } from "@aws-sdk/client-s3";
import { verifyS3ObjectBytesMatchArchiveStats } from "s3flow";
import { runFolderArchiveToS3 } from "s3flow/platform";

export async function handler(): Promise<{ statusCode: number; body: string }> {
  const source = process.env.SOURCE_URI;
  const destBucket = process.env.DEST_BUCKET;
  const destKey = process.env.DEST_KEY;
  if (!source || !destBucket || !destKey) {
    throw new Error("Set SOURCE_URI, DEST_BUCKET, and DEST_KEY");
  }

  const client = new S3Client({});
  const result = await runFolderArchiveToS3({
    client,
    source,
    format: "zip",
    concurrency: 4,
    output: { type: "s3-multipart", bucket: destBucket, key: destKey },
  });

  const verify = await verifyS3ObjectBytesMatchArchiveStats(
    client,
    { bucket: destBucket, key: destKey },
    result.stats,
  );
  if (!verify.ok) {
    throw new Error(verify.reason ?? "archive byte verify failed");
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      jobId: result.jobId,
      bytesWritten: result.stats.bytesWritten,
    }),
  };
}
