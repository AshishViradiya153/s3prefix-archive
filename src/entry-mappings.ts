import { S3ArchiveError } from "./errors.js";

export interface BuildEntryMappingLookupOptions {
  /**
   * Buckets allowed in `s3://bucket/key` mapping keys (primary source plus any
   * {@link CreateFolderArchiveStreamOptions.additionalListSources} buckets).
   */
  allowBuckets?: readonly string[];
  /**
   * When true, map keys are `bucket\\tobjectKey` so the same object key in different buckets
   * does not collide.
   */
  compositeMapKeys?: boolean;
}

/**
 * Build a lookup from {@link CreateFolderArchiveStreamOptions.entryMappings} keys to archive paths.
 * Keys may be full object keys (`folder/a.jpg`) or `s3://<bucket>/<key>` when the bucket is allowed.
 */
export function buildEntryMappingLookup(
  raw: Record<string, string>,
  sourceBucket: string,
  options?: BuildEntryMappingLookupOptions,
): Map<string, string> {
  const allowBuckets = options?.allowBuckets;
  const allowedSet = allowBuckets?.length ? new Set(allowBuckets) : null;
  const composite = Boolean(options?.compositeMapKeys);

  const map = new Map<string, string>();
  for (const [k0, v0] of Object.entries(raw)) {
    const k = k0.trim();
    const v = v0.trim();
    if (!k) {
      throw new S3ArchiveError(
        "entryMappings contains an empty key",
        "INVALID_ENTRY_MAPPING",
      );
    }
    if (!v) {
      throw new S3ArchiveError(
        `entryMappings has an empty path for key "${k0}"`,
        "INVALID_ENTRY_MAPPING",
      );
    }
    const uri = /^s3:\/\/([^/]+)\/(.+)$/i.exec(k);
    let objectKey: string;
    let objectBucket = sourceBucket;
    if (uri) {
      objectBucket = uri[1]!;
      objectKey = uri[2]!;
      if (objectBucket !== sourceBucket) {
        if (!allowedSet?.has(objectBucket)) {
          throw new S3ArchiveError(
            `entryMappings key "${k}" uses bucket "${objectBucket}" but that bucket is not allowed for this archive`,
            "ENTRY_MAPPING_BUCKET_MISMATCH",
          );
        }
      }
    } else {
      objectKey = k;
    }
    const mapKey = composite ? `${objectBucket}\t${objectKey}` : objectKey;
    map.set(mapKey, v);
  }
  return map;
}
