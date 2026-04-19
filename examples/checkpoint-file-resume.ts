/**
 * Checkpointed download: same `jobId` + `FileCheckpointStore` lets a later process resume after crash
 * or manual abort (see README “Checkpoints and resume”).
 *
 * Environment: `SOURCE_URI`, `OUT_PATH`, optional `CHECKPOINT_DIR` (default `.checkpoints`).
 */
import { S3Client } from "@aws-sdk/client-s3";
import {
  downloadFolderToFile,
  FileCheckpointStore,
  resumeFolderArchiveToFile,
} from "s3flow";

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI;
  const outPath = process.env.OUT_PATH ?? "./out.zip";
  const dir = process.env.CHECKPOINT_DIR ?? ".checkpoints";
  if (!source) {
    throw new Error("Set SOURCE_URI");
  }

  const client = new S3Client({});
  const store = new FileCheckpointStore(dir);
  const checkpoint = { jobId: "example-export-1", store };

  const first = await downloadFolderToFile(outPath, {
    source,
    format: "zip",
    client,
    checkpoint,
  });
  console.error("first run bytes", first.stats.bytesWritten);

  const second = await resumeFolderArchiveToFile(outPath, {
    source,
    format: "zip",
    client,
    checkpoint,
  });
  console.log("resume run bytes", second.stats.bytesWritten);
}

void main();
