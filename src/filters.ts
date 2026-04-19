import micromatch from "micromatch";
import type {
  CreateFolderArchiveStreamOptions,
  ObjectKeyPattern,
  ObjectMeta,
  SerializableGlobFilters,
} from "./types.js";

const MICROMATCH_OPTS = { dot: true as const };

export function keyMatchesFilterPattern(
  key: string,
  pattern: ObjectKeyPattern,
): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(key);
  }
  if (pattern.length === 0) return false;
  return micromatch.isMatch(key, pattern, MICROMATCH_OPTS);
}

export function shouldIncludeObject(
  meta: ObjectMeta,
  filters: CreateFolderArchiveStreamOptions["filters"],
): boolean {
  if (!filters) return true;
  if (filters.minSizeBytes !== undefined && meta.size < filters.minSizeBytes)
    return false;
  if (filters.maxSizeBytes !== undefined && meta.size > filters.maxSizeBytes)
    return false;
  if (filters.include?.length) {
    if (!filters.include.some((p) => keyMatchesFilterPattern(meta.key, p)))
      return false;
  }
  if (filters.exclude?.length) {
    if (filters.exclude.some((p) => keyMatchesFilterPattern(meta.key, p)))
      return false;
  }
  if (filters.predicate && !filters.predicate(meta)) return false;
  return true;
}

/** S3 "directory" placeholder objects. */
export function isDirectoryPlaceholder(meta: ObjectMeta): boolean {
  return meta.key.endsWith("/") && meta.size === 0;
}

/** Build SerializableGlobFilters include entries as micromatch extension patterns. Strips a leading dot and lowercases. */
export function globFiltersForExtensions(
  extensions: readonly string[],
): SerializableGlobFilters {
  const include = extensions
    .map((raw) => raw.trim().replace(/^\./, "").toLowerCase())
    .filter((e) => e.length > 0)
    .map((ext) => `**/*.${ext}`);
  return { include };
}
