/**
 * No AWS credentials: `MemoryStorageProvider` injects list/get for tests and demos.
 * Shows `filters`, `explain`, and post-run `summarizeArchiveRunClassifications`.
 *
 * Writes `./_s3prefix-archive-example-memory.zip` in the current working directory.
 */
import { createWriteStream } from "node:fs";
import {
  MemoryStorageProvider,
  pumpArchiveToWritable,
  summarizeArchiveRunClassifications,
} from "s3prefix-archive";

async function main(): Promise<void> {
  const storageProvider = new MemoryStorageProvider(
    new Map([
      ["docs/readme.txt", { body: Buffer.from("hello") }],
      ["docs/skip.bin", { body: Buffer.from("binary") }],
    ]),
  );

  const outPath = "./_s3prefix-archive-example-memory.zip";
  const { stats } = await pumpArchiveToWritable(createWriteStream(outPath), {
    source: "s3://demo-bucket/docs/",
    format: "zip",
    concurrency: 1,
    storageProvider,
    filters: {
      include: ["**/*.txt"],
    },
    explain: true,
  });

  console.log("bytesWritten", stats.bytesWritten);
  console.log("classifications", summarizeArchiveRunClassifications(stats));
}

void main();
