import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { S3ArchiveError } from "./errors.js";
import type { ObjectMeta } from "./types.js";

/** Parsed JSON value (NDJSON index lines are constrained by validation below). */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | Date
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

function parseMetaLine(line: string, lineNo: number): ObjectMeta {
  let obj: JsonValue;
  try {
    obj = JSON.parse(line) as JsonValue;
  } catch {
    throw new S3ArchiveError(
      `Prepared index line ${lineNo}: invalid JSON (${line.slice(0, 120)}${line.length > 120 ? "…" : ""})`,
      "INVALID_PREPARED_INDEX_LINE",
    );
  }
  if (!obj || typeof obj !== "object") {
    throw new S3ArchiveError(
      `Prepared index line ${lineNo}: expected a JSON object`,
      "INVALID_PREPARED_INDEX_LINE",
    );
  }
  const rec = obj as Record<string, JsonValue>;
  const key = rec.key;
  const size = rec.size;
  if (typeof key !== "string" || key.length === 0) {
    throw new S3ArchiveError(
      `Prepared index line ${lineNo}: missing non-empty string "key"`,
      "INVALID_PREPARED_INDEX_LINE",
    );
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    throw new S3ArchiveError(
      `Prepared index line ${lineNo}: "size" must be a finite number >= 0`,
      "INVALID_PREPARED_INDEX_LINE",
    );
  }
  const etag = rec.etag;
  if (etag !== undefined && typeof etag !== "string") {
    throw new S3ArchiveError(
      `Prepared index line ${lineNo}: "etag" must be a string when present`,
      "INVALID_PREPARED_INDEX_LINE",
    );
  }
  let lastModified: Date | undefined;
  const lm = rec.lastModified;
  if (lm !== undefined && lm !== null) {
    if (typeof lm === "string") {
      const d = new Date(lm);
      if (!Number.isNaN(d.getTime())) lastModified = d;
    } else if (lm instanceof Date && !Number.isNaN(lm.getTime())) {
      lastModified = lm;
    }
  }
  const meta: ObjectMeta = { key, size };
  if (typeof etag === "string") meta.etag = etag;
  if (lastModified) meta.lastModified = lastModified;
  return meta;
}

export interface IteratePreparedIndexNdjsonOptions {
  signal?: AbortSignal;
  /**
   * Same prefix as `source` in {@link parseS3Uri}; each index `key` must start with this string.
   * Empty string disables the check (not recommended for untrusted inputs).
   */
  keyPrefix: string;
}

/**
 * Parse NDJSON produced by {@link streamPrefixIndexNdjson} into {@link ObjectMeta} values.
 */
export async function* iterateObjectMetaFromNdjsonIndex(
  input: Readable,
  options: IteratePreparedIndexNdjsonOptions,
): AsyncGenerator<ObjectMeta, void, undefined> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const raw of rl) {
      options.signal?.throwIfAborted();
      lineNo += 1;
      const line = typeof raw === "string" ? raw.trim() : String(raw).trim();
      if (!line) continue;
      const meta = parseMetaLine(line, lineNo);
      if (options.keyPrefix !== "" && !meta.key.startsWith(options.keyPrefix)) {
        throw new S3ArchiveError(
          `Prepared index line ${lineNo}: key "${meta.key}" does not start with prefix "${options.keyPrefix}"`,
          "PREPARED_INDEX_KEY_PREFIX_MISMATCH",
        );
      }
      yield meta;
    }
  } finally {
    rl.close();
  }
}
