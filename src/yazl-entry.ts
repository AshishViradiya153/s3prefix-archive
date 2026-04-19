import { PassThrough, type Readable } from "node:stream";
import { ZipFile } from "yazl";
import { S3ArchiveError } from "./errors.js";

/**
 * yazl runtime fields (see yazl `ZipFile` implementation). Single assertion site — upstream
 * typings omit `entries` / `errored`; `outputStream` is typed as a web `ReadableStream` in `@types/yazl`.
 */
type YazlZipFileInternal = ZipFile & {
  entries: Array<{ state: number }>;
  errored: boolean;
  outputStream: PassThrough;
};

function yazlInternals(zipfile: ZipFile): YazlZipFileInternal {
  return zipfile as YazlZipFileInternal;
}

/** yazl internal `Entry.state` when file data (+ descriptor) is fully written. */
const YAZL_FILE_DATA_DONE = 3;

export function yazlZipOutputStream(zipfile: ZipFile): PassThrough {
  return yazlInternals(zipfile).outputStream;
}

export async function waitYazlLastEntryComplete(
  zipfile: ZipFile,
): Promise<void> {
  const { entries, errored } = yazlInternals(zipfile);
  const entry = entries.at(-1);
  if (!entry) return;
  while (entry.state < YAZL_FILE_DATA_DONE) {
    if (errored) {
      throw new S3ArchiveError(
        "ZIP output failed (see prior error)",
        "ZIP_ERROR",
        {
          phase: "archive_write",
        },
      );
    }
    await new Promise<void>((r) => setImmediate(r));
  }
}

/**
 * Append one deflate/stored entry from a readable S3 body; resolves when yazl has finished
 * encoding that entry (serialized with the rest of the pump).
 */
export async function appendYazlReadStreamEntry(
  zipfile: ZipFile,
  stream: Readable,
  metadataPath: string,
  uncompressedSize: number,
  zipLevel: number,
): Promise<void> {
  const z = yazlInternals(zipfile);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      z.off("error", onZipErr);
      stream.off("error", onStreamErr);
      fn();
    };
    const onZipErr = (e: Error) => finish(() => reject(e));
    const onStreamErr = (e: Error) => finish(() => reject(e));
    z.once("error", onZipErr);
    stream.once("error", onStreamErr);
    z.addReadStream(stream, metadataPath, {
      size: uncompressedSize,
      compress: zipLevel !== 0,
      compressionLevel: zipLevel === 0 ? 0 : zipLevel,
      mtime: new Date(),
    });
    void waitYazlLastEntryComplete(zipfile).then(
      () => finish(() => resolve()),
      (e) => finish(() => reject(e)),
    );
  });
}
