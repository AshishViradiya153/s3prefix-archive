/**
 * One archive from **multiple S3 list roots** (same or different buckets). Each root is listed
 * with `ListObjectsV2`; `GetObject` uses the correct bucket per key (`ObjectMeta.bucket` from listing).
 *
 * **IAM:** grant `s3:ListBucket` + `s3:GetObject` for **every** prefix (and bucket) you include.
 * Organizations often scope `ListBucket` with `Condition` `StringLike` on `s3:prefix`—mirror those
 * prefixes in `SOURCE_URI` and `ADDITIONAL_SOURCES`.
 *
 * **Validation:** `parseAdditionalListSources` rejects duplicates and roots that repeat the primary
 * URI, so misconfiguration fails fast before streaming.
 *
 * Environment:
 * - `SOURCE_URI` — primary `s3://bucket/prefix/`
 * - `ADDITIONAL_SOURCES` — comma-separated extra roots, e.g. `s3://bucket-a/assets/,s3://bucket-b/shared/`
 * - `OUT_PATH` — output zip path (default `./merged-multi-root.zip`)
 */
import { S3Client } from "@aws-sdk/client-s3";
import {
  downloadFolderToFile,
  parseAdditionalListSources,
  parseS3Uri,
} from "s3flow";

function splitSourceUris(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI;
  const outPath = process.env.OUT_PATH ?? "./merged-multi-root.zip";
  if (!source) {
    throw new Error("Set SOURCE_URI (primary s3://bucket/prefix/)");
  }

  const primary = parseS3Uri(source);
  const extraUris = splitSourceUris(process.env.ADDITIONAL_SOURCES);
  parseAdditionalListSources(
    extraUris.length > 0 ? extraUris : undefined,
    primary,
  );

  const client = new S3Client({});
  await downloadFolderToFile(outPath, {
    source,
    format: "zip",
    client,
    concurrency: 1,
    ...(extraUris.length > 0 ? { additionalListSources: extraUris } : {}),
  });

  console.log("wrote", outPath);
}

void main();
