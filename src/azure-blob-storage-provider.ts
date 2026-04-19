import type { ContainerClient } from "@azure/storage-blob";
import type { Readable } from "node:stream";
import type { ObjectMeta, StorageProvider } from "./types.js";

export interface AzureBlobStorageProviderOptions {
  /** Page size for `listBlobsFlat` pages (default `1000`, clamped 1–5000). */
  maxKeys?: number;
}

/**
 * {@link StorageProvider} for **Azure Blob Storage** using `@azure/storage-blob`.
 * Use with **`storageProvider`** and **`source: "s3://&lt;container-name&gt;/prefix/"`** as a
 * stand-in bucket segment (parser compatibility only; requests use the given {@link ContainerClient}).
 *
 * @see https://learn.microsoft.com/en-us/javascript/api/@azure/storage-blob/
 */
export class AzureBlobStorageProvider implements StorageProvider {
  readonly #container: ContainerClient;
  readonly #maxPage: number;

  constructor(
    container: ContainerClient,
    options?: AzureBlobStorageProviderOptions,
  ) {
    this.#container = container;
    const mk = options?.maxKeys ?? 1000;
    this.#maxPage = Math.min(5000, Math.max(1, mk));
  }

  async *listObjects(
    prefix: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ObjectMeta> {
    const signal = options?.signal;
    const iter = this.#container
      .listBlobsFlat({
        prefix: prefix || undefined,
        abortSignal: signal,
      })
      .byPage({ maxPageSize: this.#maxPage });
    for await (const page of iter) {
      if (signal?.aborted) break;
      const items = page.segment.blobItems;
      for (const blob of items) {
        if (blob.name.endsWith("/")) continue;
        yield {
          key: blob.name,
          size: blob.properties.contentLength ?? 0,
          etag: blob.properties.etag?.replace(/"/g, ""),
          lastModified: blob.properties.lastModified,
          listPrefix: prefix,
        };
      }
    }
  }

  async getObjectStream(
    key: string,
    options?: { signal?: AbortSignal; bucket?: string },
  ): Promise<Readable> {
    void options?.bucket;
    const blob = this.#container.getBlobClient(key).getBlockBlobClient();
    const res = await blob.download(0, undefined, {
      abortSignal: options?.signal,
    });
    const body = res.readableStreamBody;
    if (!body) {
      throw new Error(`Azure Blob download returned no stream body for ${key}`);
    }
    return body as Readable;
  }
}
