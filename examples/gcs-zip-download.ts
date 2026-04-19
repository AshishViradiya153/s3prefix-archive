/**
 * Archive from **Google Cloud Storage** using `GcsStorageProvider`.
 * The `source` URI keeps the `s3://bucket/prefix/` shape for parser compatibility; traffic uses GCS.
 *
 * Install peer: `npm install @google-cloud/storage`
 * Environment: `GCS_BUCKET`, optional `PREFIX` (default `""`), `OUT_PATH`
 */
import { createWriteStream } from "node:fs";
import { Storage } from "@google-cloud/storage";
import { createFolderArchiveStream } from "s3-archive-download";
import { GcsStorageProvider } from "s3-archive-download/gcs";

async function main(): Promise<void> {
  const bucketName = process.env.GCS_BUCKET;
  const prefix = process.env.PREFIX ?? "";
  const outPath = process.env.OUT_PATH ?? "./out-gcs.zip";
  if (!bucketName) {
    throw new Error("Set GCS_BUCKET");
  }

  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const storageProvider = new GcsStorageProvider(bucket);

  const source = `s3://${bucketName}/${prefix}`;
  const out = createWriteStream(outPath);
  const stream = createFolderArchiveStream({
    source,
    format: "zip",
    storageProvider,
  });

  await new Promise<void>((resolve, reject) => {
    out.on("error", reject);
    stream.on("error", reject);
    out.on("finish", () => resolve());
    stream.pipe(out);
  });

  console.log("wrote", outPath);
}

void main();
