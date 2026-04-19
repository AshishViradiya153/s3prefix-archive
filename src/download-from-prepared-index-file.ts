import { createReadStream } from "node:fs";
import type { CreateFolderArchiveStreamOptions } from "./types.js";
import { downloadFolderToFile } from "./download-to-file.js";
import type { PumpArchiveResult } from "./pump-archive.js";

export type DownloadFromPreparedIndexFileOptions = Omit<
  CreateFolderArchiveStreamOptions,
  "preparedIndexNdjson"
>;

/**
 * Build an archive from a previously saved NDJSON index file (see {@link prepareFolderArchiveIndexToFile}).
 * `source` must match the same bucket/prefix used when the index was generated.
 */
export async function downloadFolderToFileFromPreparedIndex(
  archiveFilePath: string,
  preparedIndexNdjsonPath: string,
  options: DownloadFromPreparedIndexFileOptions,
): Promise<PumpArchiveResult> {
  return downloadFolderToFile(archiveFilePath, {
    ...options,
    preparedIndexNdjson: createReadStream(preparedIndexNdjsonPath),
  });
}
