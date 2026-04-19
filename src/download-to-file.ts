import { createWriteStream } from "node:fs";
import type { CreateFolderArchiveStreamOptions } from "./types.js";
import {
  pumpArchiveToWritable,
  type PumpArchiveResult,
} from "./pump-archive.js";

/**
 * Stream a prefix archive directly to a local file path (same semantics as
 * {@link pumpArchiveToWritable}). Resolves when the archive is fully written.
 */
export async function downloadFolderToFile(
  filePath: string,
  options: CreateFolderArchiveStreamOptions,
): Promise<PumpArchiveResult> {
  return pumpArchiveToWritable(createWriteStream(filePath), options);
}

/** @see {@link downloadFolderToFile} */
export const downloadFolderAsArchive = downloadFolderToFile;
