import type { Bucket } from "@google-cloud/storage";
import type { Readable } from "node:stream";
import type { ObjectMeta, StorageProvider } from "./types.js";

export interface GcsStorageProviderOptions {
  /** Page size for `bucket.getFiles` (default `1000`, clamped 1–1000). */
  maxKeys?: number;
  /** Optional GCS list delimiter (see `GetFilesOptions.delimiter`). */
  delimiter?: string;
}

/**
 * {@link StorageProvider} for **Google Cloud Storage** using `@google-cloud/storage`.
 * Use with `createFolderArchiveStream` / `pumpArchiveToWritable` by passing **`storageProvider`**
 * and a synthetic **`source: "s3://&lt;gcs-bucket-name&gt;/prefix/"`** (the URI shape matches the core
 * parser; traffic goes to GCS, not AWS).
 *
 * **ETag / dedupe:** listing exposes `metadata.md5Hash` (base64) as {@link ObjectMeta.etag} when
 * present—this is **not** the same string as S3’s hex ETag; treat `dedupeContentByEtag` as
 * best-effort across clouds.
 *
 * @see https://cloud.google.com/nodejs/docs/reference/storage/latest
 */
export class GcsStorageProvider implements StorageProvider {
  readonly #bucket: Bucket;
  readonly #maxKeys: number;
  readonly #delimiter: string | undefined;

  constructor(bucket: Bucket, options?: GcsStorageProviderOptions) {
    this.#bucket = bucket;
    const mk = options?.maxKeys ?? 1000;
    this.#maxKeys = Math.min(1000, Math.max(1, mk));
    this.#delimiter = options?.delimiter;
  }

  async *listObjects(
    prefix: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ObjectMeta> {
    let pageToken: string | undefined;
    const signal = options?.signal;
    do {
      const [files, nextQuery] = await this.#bucket.getFiles({
        prefix: prefix || undefined,
        maxResults: this.#maxKeys,
        pageToken,
        autoPaginate: false,
        delimiter: this.#delimiter,
      });
      for (const file of files) {
        if (file.name.endsWith("/")) continue;
        const md5 = file.metadata.md5Hash;
        yield {
          key: file.name,
          size: Number(file.metadata.size ?? 0),
          etag: md5,
          lastModified: file.metadata.updated
            ? new Date(file.metadata.updated)
            : undefined,
          listPrefix: prefix,
        };
      }
      pageToken = (nextQuery as { pageToken?: string } | undefined)?.pageToken;
      if (signal?.aborted) break;
    } while (pageToken);
  }

  async getObjectStream(
    key: string,
    options?: { signal?: AbortSignal; bucket?: string },
  ): Promise<Readable> {
    void options?.bucket;
    const file = this.#bucket.file(key);
    const stream = file.createReadStream({ validation: "crc32c" });
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) {
        stream.destroy(
          Object.assign(new Error("Aborted"), { name: "AbortError" }),
        );
        return stream;
      }
      const onAbort = (): void => {
        stream.destroy(
          Object.assign(new Error("Aborted"), { name: "AbortError" }),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      stream.once("close", () => signal.removeEventListener("abort", onAbort));
    }
    return stream;
  }
}
