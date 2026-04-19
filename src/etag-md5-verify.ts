import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { S3ArchiveError } from "./errors.js";

/**
 * Parse a **single-part** S3 object ETag as a **lowercase hex MD5** string.
 * Multipart uploads use ETags like `"abc…-2"` — returns `null` (caller should not verify MD5).
 */
export function parseS3SinglePartEtagMd5Hex(
  etag: string | undefined,
): string | null {
  if (!etag) return null;
  const t = etag.replaceAll('"', "").trim();
  if (t.includes("-")) return null;
  if (!/^[0-9a-fA-F]{32}$/.test(t)) return null;
  return t.toLowerCase();
}

/**
 * Pass-through stream that MD5-hashes bytes and compares to the expected **single-part** ETag hex
 * in `flush`. Emits an error on mismatch (archive entry may already be partially written — use
 * {@link CreateFolderArchiveStreamOptions.failureMode} accordingly).
 */
export function createEtagMd5VerifyTransform(
  expectedMd5Hex: string,
  context: { key: string },
): Transform {
  const hash = createHash("md5");
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
    flush(cb) {
      const digest = hash.digest("hex");
      if (digest !== expectedMd5Hex) {
        cb(
          new S3ArchiveError(
            `GetObject body MD5 ${digest} does not match ETag ${expectedMd5Hex} (${context.key})`,
            "GET_OBJECT_ETAG_MISMATCH",
            {
              phase: "getObject",
              context: {
                key: context.key,
                expectedMd5Hex,
                actualMd5Hex: digest,
              },
            },
          ),
        );
        return;
      }
      cb();
    },
  });
}

/** Pipe `readable` through an MD5 vs ETag verifier; returns the output readable for the archive sink. */
export function pipeThroughEtagMd5Verifier(
  readable: Readable,
  expectedMd5Hex: string,
  context: { key: string },
): Readable {
  return readable.pipe(createEtagMd5VerifyTransform(expectedMd5Hex, context));
}
