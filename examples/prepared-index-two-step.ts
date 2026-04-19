/**
 * Large prefixes: list once to NDJSON, then archive from the index (no second `ListObjectsV2`).
 *
 * Environment: `SOURCE_URI`, `INDEX_PATH` (e.g. `./prefix.ndjson`), `OUT_PATH`.
 */
import { S3Client } from "@aws-sdk/client-s3";
import {
  downloadFolderToFileFromPreparedIndex,
  prepareFolderArchiveIndexToFile,
} from "s3flow";

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI;
  const indexPath = process.env.INDEX_PATH ?? "./prefix.ndjson";
  const outPath = process.env.OUT_PATH ?? "./out.zip";
  if (!source) {
    throw new Error("Set SOURCE_URI");
  }

  const client = new S3Client({});

  await prepareFolderArchiveIndexToFile(indexPath, {
    source,
    client,
  });

  const { stats } = await downloadFolderToFileFromPreparedIndex(
    outPath,
    indexPath,
    {
      source,
      format: "zip",
      client,
    },
  );

  console.log("bytesWritten", stats.bytesWritten);
}

void main();
