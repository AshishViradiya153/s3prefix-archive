/**
 * Minimal production-style download: one function writes a ZIP from an S3 prefix to a file.
 *
 * Environment: `SOURCE_URI` (e.g. `s3://my-bucket/prefix/`), `OUT_PATH` (e.g. `./out.zip`).
 * Credentials: default AWS SDK chain (env, profile, IAM role).
 */
import { S3Client } from "@aws-sdk/client-s3";
import { downloadFolderToFile } from "s3prefix-archive";

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI;
  const outPath = process.env.OUT_PATH ?? "./out.zip";
  if (!source) {
    throw new Error("Set SOURCE_URI, e.g. s3://bucket/prefix/");
  }

  const client = new S3Client({});
  const { stats } = await downloadFolderToFile(outPath, {
    source,
    format: "zip",
    client,
    onProgress: (p) => {
      console.error("progress", p.objectsIncluded, p.bytesWritten);
    },
  });

  console.log("done", stats.bytesWritten, "bytes");
}

void main();
