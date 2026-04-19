/**
 * Lower-level pattern: `createFolderArchiveStream` returns a Node `Readable`; pipe to any `Writable`.
 * Errors surface on the readable stream (`error` event).
 *
 * Environment: `SOURCE_URI`, `OUT_PATH` (see basic-download-to-file.ts).
 */
import { createWriteStream } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { createFolderArchiveStream } from "s3flow";

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI;
  const outPath = process.env.OUT_PATH ?? "./out.zip";
  if (!source) {
    throw new Error("Set SOURCE_URI");
  }

  const client = new S3Client({});
  const out = createWriteStream(outPath);
  const stream = createFolderArchiveStream({
    source,
    format: "tar.gz",
    client,
  });

  await new Promise<void>((resolve, reject) => {
    out.on("error", reject);
    stream.on("error", reject);
    out.on("finish", () => resolve());
    stream.pipe(out);
  });
}

void main();
