import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ContainerClient } from "@azure/storage-blob";
import type { Bucket } from "@google-cloud/storage";
import { AzureBlobStorageProvider } from "../src/azure-blob-storage-provider.js";
import { GcsStorageProvider } from "../src/gcs-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("GcsStorageProvider", () => {
  it("lists objects and streams bytes for the archive pump", async () => {
    const mockFile = {
      name: "pre/obj.bin",
      metadata: {
        size: "5",
        md5Hash: "rL0Y20zC+Fzt72VPzMSk2A==",
        updated: "2020-01-01T00:00:00.000Z",
      },
      createReadStream: () => Readable.from(Buffer.from("hello")),
    };
    const getFiles = vi.fn(
      async (): Promise<
        [(typeof mockFile)[], { pageToken?: string }, unknown]
      > => [[mockFile], {}, {}],
    );
    const mockBucket = {
      getFiles,
      file: () => mockFile,
    } as unknown as Bucket;

    const p = new GcsStorageProvider(mockBucket, { maxKeys: 100 });
    const rows: { key: string; size: number }[] = [];
    for await (const o of p.listObjects("pre/")) {
      rows.push({ key: o.key, size: o.size });
    }
    expect(getFiles).toHaveBeenCalled();
    expect(rows).toEqual([{ key: "pre/obj.bin", size: 5 }]);

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://gcs-bucket/pre/",
        format: "zip",
        concurrency: 1,
        storageProvider: p,
      },
    );
    expect(stats.objectsIncluded).toBe(1);
    expect(stats.bytesRead).toBe(5);
    expect(stats.s3ListObjectsV2Requests).toBeUndefined();
  });
});

describe("AzureBlobStorageProvider", () => {
  it("lists blobs and streams bytes for the archive pump", async () => {
    const download = vi.fn(async () => ({
      readableStreamBody: Readable.from(
        Buffer.from("hey"),
      ) as NodeJS.ReadableStream,
    }));
    const mockContainer = {
      listBlobsFlat: () => ({
        byPage: () =>
          (async function* () {
            yield {
              segment: {
                blobItems: [
                  {
                    name: "pre/a.txt",
                    properties: {
                      contentLength: 3,
                      etag: '"abc"',
                      lastModified: new Date("2020-01-01"),
                    },
                  },
                ],
              },
            };
          })(),
      }),
      getBlobClient: () => ({
        getBlockBlobClient: () => ({ download }),
      }),
    } as unknown as ContainerClient;

    const p = new AzureBlobStorageProvider(mockContainer, { maxKeys: 50 });
    const keys: string[] = [];
    for await (const o of p.listObjects("pre/")) keys.push(o.key);
    expect(keys).toEqual(["pre/a.txt"]);

    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://my-container/pre/",
        format: "zip",
        concurrency: 1,
        storageProvider: p,
      },
    );
    expect(download).toHaveBeenCalled();
    expect(stats.objectsIncluded).toBe(1);
    expect(stats.bytesRead).toBe(3);
  });
});
