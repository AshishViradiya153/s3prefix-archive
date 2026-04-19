import { createHash } from "node:crypto";
import { PassThrough, type Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("transformGetObjectBody + pump", () => {
  it("applies transform after GetObject before archive append", async () => {
    const body = Buffer.from("hello-transform", "utf8");
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    const provider = new MemoryStorageProvider(
      new Map([["pre/a.txt", { body, etag }]]),
    );

    let saw = false;
    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://anybucket/pre/",
        format: "zip",
        concurrency: 1,
        storageProvider: provider,
        transformGetObjectBody: (_ctx, stream: Readable) => {
          saw = true;
          const out = new PassThrough();
          stream.pipe(out);
          return out;
        },
      },
    );

    expect(saw).toBe(true);
    expect(stats.objectsIncluded).toBe(1);
    expect(stats.bytesRead).toBe(body.length);
  });
});
