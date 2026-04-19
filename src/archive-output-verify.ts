import { stat } from "node:fs/promises";
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { ArchiveStats } from "./types.js";

/** Result of comparing {@link ArchiveStats.bytesWritten} to a concrete output (file or S3 object). */
export interface ArchiveBytesVerifyResult {
  ok: boolean;
  expectedBytes: number;
  actualBytes: number;
  /** Signed: actual − expected. */
  deltaBytes: number;
  reason?: string;
}

export interface VerifyArchiveBytesOptions {
  /** Allow |actual − expected| ≤ this value (default `0`). */
  toleranceBytes?: number;
}

function compareBytes(
  expectedBytes: number,
  actualBytes: number,
  toleranceBytes: number,
  context: string,
): Pick<ArchiveBytesVerifyResult, "ok" | "deltaBytes" | "reason"> {
  const deltaBytes = actualBytes - expectedBytes;
  if (Math.abs(deltaBytes) <= toleranceBytes) {
    return { ok: true, deltaBytes };
  }
  return {
    ok: false,
    deltaBytes,
    reason: `${context}: expected ${expectedBytes} bytes, got ${actualBytes} (|Δ|=${Math.abs(deltaBytes)}, tolerance=${toleranceBytes})`,
  };
}

/**
 * After `downloadFolderToFile` / `runFolderArchiveToWritable`, confirm the on-disk file size matches
 * {@link ArchiveStats.bytesWritten} from the pump (second pass, no re-read of archive bytes).
 */
export async function verifyLocalArchiveFileBytesMatchStats(
  filePath: string,
  stats: Pick<ArchiveStats, "bytesWritten">,
  options?: VerifyArchiveBytesOptions,
): Promise<ArchiveBytesVerifyResult> {
  const toleranceBytes = options?.toleranceBytes ?? 0;
  const expectedBytes = stats.bytesWritten;
  let st;
  try {
    st = await stat(filePath);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return {
      ok: false,
      expectedBytes,
      actualBytes: 0,
      deltaBytes: -expectedBytes,
      reason: `stat failed: ${err.message}`,
    };
  }
  if (!st.isFile()) {
    return {
      ok: false,
      expectedBytes,
      actualBytes: 0,
      deltaBytes: -expectedBytes,
      reason: `not a regular file: ${filePath}`,
    };
  }
  const actualBytes = st.size;
  const { ok, deltaBytes, reason } = compareBytes(
    expectedBytes,
    actualBytes,
    toleranceBytes,
    "local file size vs ArchiveStats.bytesWritten",
  );
  return { ok, expectedBytes, actualBytes, deltaBytes, reason };
}

/**
 * After {@link runFolderArchiveToS3}, confirm the uploaded object’s `Content-Length` matches
 * {@link ArchiveStats.bytesWritten} (cheap `HeadObject`, no full re-download).
 *
 * **IAM:** `HeadObject` requires **`s3:GetObject`** on `arn:...:object/{bucket}/{key}` (same action class
 * as a full GET). This checks **length consistency** between the pump counter and the stored object;
 * it does **not** cryptographically attest ZIP contents (use object checksums, manifest digests, or
 * a full re-read + hash policy if you need that bar).
 */
export async function verifyS3ObjectBytesMatchArchiveStats(
  client: S3Client,
  location: { bucket: string; key: string },
  stats: Pick<ArchiveStats, "bytesWritten">,
  options?: VerifyArchiveBytesOptions,
): Promise<ArchiveBytesVerifyResult> {
  const toleranceBytes = options?.toleranceBytes ?? 0;
  const expectedBytes = stats.bytesWritten;
  let out;
  try {
    out = await client.send(
      new HeadObjectCommand({ Bucket: location.bucket, Key: location.key }),
    );
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return {
      ok: false,
      expectedBytes,
      actualBytes: 0,
      deltaBytes: -expectedBytes,
      reason: `HeadObject failed: ${err.message}`,
    };
  }
  const len = out.ContentLength;
  if (len == null) {
    return {
      ok: false,
      expectedBytes,
      actualBytes: 0,
      deltaBytes: -expectedBytes,
      reason: "HeadObject ContentLength missing",
    };
  }
  const actualBytes = Number(len);
  if (!Number.isFinite(actualBytes) || actualBytes < 0) {
    return {
      ok: false,
      expectedBytes,
      actualBytes: 0,
      deltaBytes: -expectedBytes,
      reason: `HeadObject ContentLength not a finite non-negative size: ${String(len)}`,
    };
  }
  const { ok, deltaBytes, reason } = compareBytes(
    expectedBytes,
    actualBytes,
    toleranceBytes,
    "S3 ContentLength vs ArchiveStats.bytesWritten",
  );
  return { ok, expectedBytes, actualBytes, deltaBytes, reason };
}
