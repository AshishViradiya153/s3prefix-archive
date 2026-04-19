/**
 * Server-side batch signing for **browser downloads**: your API lists object keys (or receives an
 * allowlisted set from the client), then returns short-lived presigned GET URLs. The browser fetches
 * each URL and can feed bytes into a client-side ZIP library (not shipped with s3prefix-archive).
 *
 * Install: `s3prefix-archive`, `@aws-sdk/client-s3`. IAM on this role: `s3:ListBucket` on the prefix +
 * `s3:GetObject` on objects you sign.
 */
import { S3Client } from "@aws-sdk/client-s3";
import {
  recommendArchiveExecutionSurface,
  signGetObjectDownloadUrl,
} from "s3prefix-archive";

const client = new S3Client({});

/** Example: keys already chosen by your app (e.g. after `ListObjectsV2` on the server). */
export async function presignedUrlsForKeys(
  bucket: string,
  keys: readonly string[],
  expiresInSeconds = 900,
): Promise<{ key: string; url: string }[]> {
  const out: { key: string; url: string }[] = [];
  for (const key of keys) {
    out.push({
      key,
      url: await signGetObjectDownloadUrl(
        client,
        { bucket, key },
        expiresInSeconds,
      ),
    });
  }
  return out;
}

/** Call before committing to a browser-side zip build (no I/O). */
export function shouldUseBrowserZip(
  totalBytesEstimate: number,
  objectCountEstimate: number,
) {
  return recommendArchiveExecutionSurface({
    totalBytesEstimate,
    objectCountEstimate,
  });
}
