import { PathUnsafeError } from "./errors.js";
import type { ObjectMeta } from "./types.js";

/** Collapse `.` / `..` segments and reject zip-slip. */
export function assertSafeArchivePath(entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new PathUnsafeError(
      `Refusing empty or trivial archive path: "${entryName}"`,
    );
  }
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new PathUnsafeError(
        `Refusing path traversal in archive entry: "${entryName}"`,
      );
    }
  }
  if (segments.some((s) => s.startsWith(".."))) {
    throw new PathUnsafeError(`Refusing unsafe archive entry: "${entryName}"`);
  }
  return normalized;
}

/**
 * Default mapping: strip optional common prefix so archive root matches "folder" semantics.
 */
export function defaultEntryName(
  meta: ObjectMeta,
  sourcePrefix: string,
): string {
  const prefix = (meta.listPrefix ?? sourcePrefix).replace(/^\/+/, "");
  let key = meta.key;
  if (prefix && key.startsWith(prefix)) {
    key = key.slice(prefix.length);
  }
  key = key.replace(/^\/+/, "");
  if (!key) {
    key = meta.key.split("/").filter(Boolean).pop() ?? "object";
  }
  return assertSafeArchivePath(key);
}
