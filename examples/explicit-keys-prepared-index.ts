/**
 * Archive **only** the object keys you already know—**no `ListObjectsV2`** during the pump
 * when `preparedIndexNdjson` is set.
 *
 * Use when:
 * - IAM grants **`s3:GetObject`** on specific keys but not a broad **`s3:ListBucket`**, or
 * - Your org exposes an allowlist (database, entitlement API, ABAC) instead of listing S3.
 *
 * Each NDJSON line is `{"key":"...","size":n}` (optional `etag`, `lastModified`). Keys must start
 * with the same prefix as **`source`**. Prefer accurate **`size`** (e.g. from `HeadObject`) if you
 * use **`maxInFlightReadBytes`**.
 */
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { pumpArchiveToWritable } from "s3-archive-download";

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI ?? "s3://my-bucket/reports/";
  const outPath = process.env.OUT_PATH ?? "./explicit-keys.zip";

  const ndjsonBody = [
    '{"key":"reports/2024/q1/summary.pdf","size":2048}',
    '{"key":"reports/2024/q1/figures.png","size":50000}',
  ].join("\n");

  const preparedIndexNdjson = Readable.from(
    Buffer.from(`${ndjsonBody}\n`, "utf8"),
  );

  await pumpArchiveToWritable(createWriteStream(outPath), {
    source,
    format: "zip",
    concurrency: 1,
    client: new S3Client({}),
    preparedIndexNdjson,
  });

  console.log("wrote", outPath);
}

void main();
