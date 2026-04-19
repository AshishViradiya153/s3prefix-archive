import type { ObjectMeta } from "./types.js";

/**
 * Stable fingerprint for {@link CreateFolderArchiveStreamOptions.dedupeContentByEtag}:
 * normalized `etag` + `:` + `size`. Returns `undefined` when `etag` is missing or blank
 * (listing may omit ETag unless object is versioned / certain configs).
 */
export function objectContentFingerprint(meta: ObjectMeta): string | undefined {
  const raw = meta.etag?.trim();
  if (!raw) return undefined;
  let e = raw;
  if (e.startsWith("W/")) e = e.slice(2).trim();
  if (e.startsWith('"') && e.endsWith('"') && e.length >= 2) e = e.slice(1, -1);
  const base = `${e}:${meta.size}`;
  return meta.bucket ? `${meta.bucket}\t${base}` : base;
}
