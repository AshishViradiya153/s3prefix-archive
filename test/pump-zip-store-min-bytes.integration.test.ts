import { createWriteStream } from "node:fs";
import { unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";

const PK_LOCAL = 0x04034b50;
const PK_CENTRAL = 0x02014b50;
const ZIP_STORE = 0;
const ZIP_DEFLATE = 8;

function zipLocalEntryCompressionMethods(buf: Buffer): number[] {
  const methods: number[] = [];
  let i = 0;
  while (i <= buf.length - 30) {
    const sig = buf.readUInt32LE(i);
    if (sig === PK_CENTRAL) break;
    if (sig !== PK_LOCAL) {
      i++;
      continue;
    }
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const headerLen = 30 + nameLen + extraLen;
    methods.push(method);
    i += headerLen + compSize;
  }
  return methods;
}

describe("zipStoreMinBytes (e2e)", () => {
  it("STOREs large objects and deflates small ones when threshold is set", async () => {
    const smallBody = Buffer.alloc(100, 0x41);
    const largeBody = Buffer.alloc(5000, 0x42);
    const provider = new MemoryStorageProvider(
      new Map([
        ["pre/a_small.bin", { body: smallBody }],
        ["pre/b_large.bin", { body: largeBody }],
      ]),
    );

    const outPath = join(
      tmpdir(),
      `s3-archive-download-zip-store-${Date.now()}.zip`,
    );
    const dest = createWriteStream(outPath);
    try {
      const { stats } = await pumpArchiveToWritable(dest, {
        source: "s3://anybucket/pre/",
        format: "zip",
        storageProvider: provider,
        zipLevel: 6,
        zipStoreMinBytes: 4096,
        concurrency: 1,
      });

      expect(stats.objectsIncluded).toBe(2);

      const raw = await readFile(outPath);
      const methods = zipLocalEntryCompressionMethods(raw);
      expect(methods).toEqual([ZIP_DEFLATE, ZIP_STORE]);
    } finally {
      await unlink(outPath).catch(() => {});
    }
  });

  it("deflates all entries when zipStoreMinBytes is omitted", async () => {
    const smallBody = Buffer.alloc(100, 0x41);
    const largeBody = Buffer.alloc(5000, 0x42);
    const provider = new MemoryStorageProvider(
      new Map([
        ["pre/a_small.bin", { body: smallBody }],
        ["pre/b_large.bin", { body: largeBody }],
      ]),
    );

    const outPath = join(
      tmpdir(),
      `s3-archive-download-zip-all-deflate-${Date.now()}.zip`,
    );
    const dest = createWriteStream(outPath);
    try {
      await pumpArchiveToWritable(dest, {
        source: "s3://anybucket/pre/",
        format: "zip",
        storageProvider: provider,
        zipLevel: 6,
        concurrency: 1,
      });

      const raw = await readFile(outPath);
      const methods = zipLocalEntryCompressionMethods(raw);
      expect(methods).toEqual([ZIP_DEFLATE, ZIP_DEFLATE]);
    } finally {
      await unlink(outPath).catch(() => {});
    }
  });
});
