import { createWriteStream } from "node:fs";
import type { Writable } from "node:stream";
import { parseS3Uri } from "./s3-uri.js";
import { assertAdditionalListSourcesMatchCheckpoint } from "./archive-sources.js";
import { S3ArchiveError } from "./errors.js";
import type { CreateFolderArchiveStreamOptions } from "./types.js";
import {
  pumpArchiveToWritable,
  type PumpArchiveResult,
} from "./pump-archive.js";

/**
 * Resume an interrupted run: requires an existing checkpoint for `jobId` on `store`,
 * and the same `source`, `format`, and filters as the original job (bucket/prefix/format
 * are validated against the saved state). Same skip semantics as passing `checkpoint`
 * to {@link pumpArchiveToWritable}; this entrypoint fails fast if there is nothing to resume.
 */
export async function resumeFolderArchiveToWritable(
  destination: Writable,
  options: CreateFolderArchiveStreamOptions,
): Promise<PumpArchiveResult> {
  if (!options.checkpoint) {
    throw new S3ArchiveError(
      "resumeFolderArchiveToWritable requires `options.checkpoint` with the same `jobId` and `store` as the interrupted run.",
      "MISSING_CHECKPOINT",
    );
  }
  const { jobId, store } = options.checkpoint;
  const loaded = await store.load(jobId);
  if (!loaded) {
    throw new S3ArchiveError(
      `No saved checkpoint for jobId "${jobId}". Run with checkpoint enabled first, or use pumpArchiveToWritable / downloadFolderToFile for a fresh job.`,
      "CHECKPOINT_NOT_FOUND",
    );
  }
  const { bucket, prefix } = parseS3Uri(options.source);
  const format = options.format ?? "zip";
  if (
    loaded.bucket !== bucket ||
    loaded.prefix !== prefix ||
    loaded.format !== format
  ) {
    throw new S3ArchiveError(
      `Checkpoint "${jobId}" targets bucket=${loaded.bucket}, prefix=${loaded.prefix}, format=${loaded.format}; does not match this request.`,
      "CHECKPOINT_MISMATCH",
    );
  }
  assertAdditionalListSourcesMatchCheckpoint(
    loaded.additionalListSources,
    options.additionalListSources,
    { bucket, prefix },
    jobId,
  );
  return pumpArchiveToWritable(destination, options);
}

/** Resume to a local file (see {@link resumeFolderArchiveToWritable}). */
export async function resumeFolderArchiveToFile(
  filePath: string,
  options: CreateFolderArchiveStreamOptions,
): Promise<PumpArchiveResult> {
  return resumeFolderArchiveToWritable(createWriteStream(filePath), options);
}
