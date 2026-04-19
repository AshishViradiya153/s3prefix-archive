import { S3ArchiveError } from "./errors.js";
import { parseS3Uri } from "./s3-uri.js";

/** One extra `s3://bucket/prefix/` root merged after the primary {@link CreateFolderArchiveStreamOptions.source} listing. */
export interface AdditionalListRoot {
  /** Canonical URI for checkpoint / resume comparison. */
  canonicalUri: string;
  bucket: string;
  prefix: string;
}

/**
 * Parse and validate `additionalListSources` (non-empty S3 URIs, no duplicates, none may equal the primary root).
 */
export function parseAdditionalListSources(
  sources: readonly string[] | undefined,
  primary: { bucket: string; prefix: string },
): AdditionalListRoot[] {
  if (!sources?.length) return [];
  const primaryUri = canonicalRootUri(primary.bucket, primary.prefix);
  const out: AdditionalListRoot[] = [];
  const seen = new Set<string>();
  for (const raw of sources) {
    const { bucket, prefix } = parseS3Uri(raw);
    const canonicalUri = canonicalRootUri(bucket, prefix);
    if (seen.has(canonicalUri)) {
      throw new S3ArchiveError(
        `additionalListSources contains duplicate root "${canonicalUri}"`,
        "INVALID_ADDITIONAL_SOURCES",
      );
    }
    seen.add(canonicalUri);
    if (canonicalUri === primaryUri) {
      throw new S3ArchiveError(
        `additionalListSources must not repeat the primary source "${primaryUri}"`,
        "INVALID_ADDITIONAL_SOURCES",
      );
    }
    out.push({ canonicalUri, bucket, prefix });
  }
  return out;
}

export function canonicalizeAdditionalListSources(
  sources: readonly string[] | undefined,
  primary: { bucket: string; prefix: string },
): string[] {
  return parseAdditionalListSources(sources, primary)
    .map((r) => r.canonicalUri)
    .sort();
}

/** Throws `CHECKPOINT_MISMATCH` when checkpoint `additionalListSources` disagree with the request. */
export function assertAdditionalListSourcesMatchCheckpoint(
  loadedCanonicalRoots: readonly string[] | undefined,
  requestedSources: readonly string[] | undefined,
  primary: { bucket: string; prefix: string },
  jobId: string,
): void {
  const expected = canonicalizeAdditionalListSources(requestedSources, primary);
  const loadedSorted = [...(loadedCanonicalRoots ?? [])].sort();
  if (JSON.stringify(loadedSorted) !== JSON.stringify(expected)) {
    throw new S3ArchiveError(
      `Checkpoint "${jobId}" additionalListSources do not match this request.`,
      "CHECKPOINT_MISMATCH",
    );
  }
}

function canonicalRootUri(bucket: string, prefix: string): string {
  const p = prefix.replace(/^\/+/, "");
  return `s3://${bucket}/${p}`;
}
