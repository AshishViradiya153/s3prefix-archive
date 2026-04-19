/**
 * Pass a `prom-client` `Registry` via `prometheus` so completion counters/histograms update on success.
 * Runs entirely with `MemoryStorageProvider` (no AWS).
 *
 * Install: `prom-client` is already a dependency of `s3prefix-archive` (metrics); this example prints text exposition.
 */
import { createWriteStream } from "node:fs";
import { Registry } from "prom-client";
import { MemoryStorageProvider, pumpArchiveToWritable } from "s3prefix-archive";

async function main(): Promise<void> {
  const register = new Registry();
  const storageProvider = new MemoryStorageProvider(
    new Map([["p/a.txt", { body: Buffer.from("metrics") }]]),
  );

  await pumpArchiveToWritable(
    createWriteStream("./_s3prefix-archive-prom-example.zip"),
    {
      source: "s3://demo-bucket/p/",
      format: "zip",
      concurrency: 1,
      storageProvider,
      prometheus: { register, prefix: "demo_archive" },
    },
  );

  process.stdout.write(await register.metrics());
}

void main();
