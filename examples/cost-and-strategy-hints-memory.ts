/**
 * Advisory helpers after a run: linear **USD** estimate (`estimateArchiveRunS3Usd`) and
 * `suggestArchiveRunStrategyHints` (ZIP concurrency / destination backpressure — not auto-applied).
 *
 * Uses `MemoryStorageProvider` so it runs without credentials. Real S3 runs populate the same stats fields.
 */
import { createWriteStream } from "node:fs";
import {
  estimateArchiveRunS3Usd,
  MemoryStorageProvider,
  pumpArchiveToWritable,
  suggestArchiveRunStrategyHints,
} from "s3-archive-download";

async function main(): Promise<void> {
  const storageProvider = new MemoryStorageProvider(
    new Map([["x/a.txt", { body: Buffer.from("cost demo") }]]),
  );

  const { stats } = await pumpArchiveToWritable(
    createWriteStream("./_s3-archive-download-cost-example.zip"),
    {
      source: "s3://demo-bucket/x/",
      format: "zip",
      concurrency: 1,
      storageProvider,
    },
  );

  const usd = estimateArchiveRunS3Usd({
    stats,
    apiPricing: {
      usdPerListObjectsV2Request: 0.000_005,
      usdPerGetObjectRequest: 0.000_000_4,
    },
    egressBands: [
      { untilBytesExclusive: Number.POSITIVE_INFINITY, usdPerByte: 9e-11 },
    ],
  });

  const hints = suggestArchiveRunStrategyHints({
    ...stats,
    format: "zip",
  });

  console.log("estimateArchiveRunS3Usd", usd);
  console.log("suggestArchiveRunStrategyHints", hints);
}

void main();
