import { S3ArchiveError } from "./errors.js";

export interface ParsedS3Uri {
  bucket: string;
  /** Normalized prefix (no leading `s3://`, includes trailing slash if user provided path segments). */
  prefix: string;
}

/**
 * Parse `s3://bucket` or `s3://bucket/prefix/parts/`.
 */
export function parseS3Uri(uri: string): ParsedS3Uri {
  const trimmed = uri.trim();
  const m = /^s3:\/\/([^/]+)\/?(.*)$/i.exec(trimmed);
  if (!m?.[1]) {
    throw new S3ArchiveError(`Invalid S3 URI: ${uri}`, "INVALID_S3_URI");
  }
  const bucket = m[1];
  const rest = m[2] ?? "";
  const prefix = rest;
  return { bucket, prefix };
}
