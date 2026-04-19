import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface SignGetObjectDownloadUrlInput {
  bucket: string;
  key: string;
  /** Optional `Content-Disposition` for browser downloads (e.g. `attachment; filename="a.pdf"`). */
  responseContentDisposition?: string;
}

/**
 * Presigned **GET** URL for one object (caller IAM must allow `s3:GetObject`).
 * Typical `expiresIn`: **300–3600** seconds per security policy.
 */
export async function signGetObjectDownloadUrl(
  client: S3Client,
  input: SignGetObjectDownloadUrlInput,
  expiresInSeconds = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    ResponseContentDisposition: input.responseContentDisposition,
  });
  return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds });
}

/** Batch presigned GET URLs (sequential signing; parallelize at the call site if needed). */
export async function signGetObjectDownloadUrls(
  client: S3Client,
  bucket: string,
  keys: readonly string[],
  expiresInSeconds = 3600,
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
