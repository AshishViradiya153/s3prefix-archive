import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { parseS3Uri } from "./s3-uri.js";
import { S3StorageProvider } from "./s3-provider.js";
import type { PreparedIndexOptions } from "./types.js";
import { resolveArchiveLogger } from "./logger.js";
import { observePreparedIndexLine } from "./prometheus.js";

/**
 * Stream one JSON line per object (`\\n` delimited) for large prefixes without holding the full list in memory.
 */
export async function* streamPrefixIndexNdjson(
  options: PreparedIndexOptions,
): AsyncGenerator<string, void, undefined> {
  const { bucket, prefix } = parseS3Uri(options.source);
  const client = options.client ?? new S3Client(options.clientConfig ?? {});
  const maxKeys = Math.min(1000, Math.max(1, options.maxKeys ?? 1000));
  const log = resolveArchiveLogger({
    logger: options.logger,
    debug: options.debug,
  }).child({ lib: "s3prefix-archive", component: "prepared-index" });
  const provider = new S3StorageProvider(
    client,
    bucket,
    { maxKeys, delimiter: options.delimiter },
    {
      maxAttempts: options.retry?.maxAttempts,
      baseDelayMs: options.retry?.baseDelayMs,
      maxDelayMs: options.retry?.maxDelayMs,
      signal: options.signal,
      onS3Retry: options.retry?.onRetry,
    },
    log.child({ component: "s3-provider" }),
    { requestTimeoutMs: options.s3RequestTimeoutMs },
  );
  let indexLine = 0;
  for await (const meta of provider.listObjects(prefix, {
    signal: options.signal,
  })) {
    indexLine += 1;
    if (
      log.isLevelEnabled("debug") &&
      (indexLine <= 4 || indexLine % 50_000 === 0)
    ) {
      log.debug(
        { preparedIndexLine: indexLine, key: meta.key, size: meta.size },
        "prepared index progress",
      );
    }
    yield `${JSON.stringify(meta)}\n`;
    if (options.prometheus) {
      observePreparedIndexLine(options.prometheus);
    }
  }
}

/** Readable NDJSON index (caller pipes to file, S3 upload, etc.). */
export function createPreparedIndexReadable(
  options: PreparedIndexOptions,
): Readable {
  return Readable.from(streamPrefixIndexNdjson(options), { objectMode: false });
}

/**
 * Phase 1 of a two-step export: write the NDJSON object index to a local file (same lines as
 * {@link streamPrefixIndexNdjson}). Phase 2: pass `createReadStream(path)` as
 * {@link CreateFolderArchiveStreamOptions.preparedIndexNdjson} or use
 * {@link downloadFolderToFileFromPreparedIndex}.
 */
export async function prepareFolderArchiveIndexToFile(
  filePath: string,
  options: PreparedIndexOptions,
): Promise<void> {
  await pipeline(
    createPreparedIndexReadable(options),
    createWriteStream(filePath),
  );
}
