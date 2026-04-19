import { lookup } from "mime-types";
import type { ArchiveFormat } from "./types.js";

/** Synthetic filenames so `mime-types` can resolve types for each archive format. */
const FORMAT_TO_SYNTHETIC_PATH: Record<ArchiveFormat, string> = {
  zip: "archive.zip",
  tar: "archive.tar",
  "tar.gz": "archive.tar.gz",
};

/**
 * Resolve `Content-Type` for an archive: prefer the destination object key extension,
 * then the archive format, then `application/octet-stream`.
 */
export function resolveArchiveContentType(
  format: ArchiveFormat,
  objectKey?: string,
): string {
  if (objectKey) {
    const fromKey = lookup(objectKey);
    if (fromKey) return fromKey;
  }
  const fromFormat = lookup(FORMAT_TO_SYNTHETIC_PATH[format]);
  if (fromFormat) return fromFormat;
  return "application/octet-stream";
}
