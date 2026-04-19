import { Readable } from "node:stream";
import type { ObjectMeta, StorageProvider } from "./types.js";
import { S3ArchiveError } from "./errors.js";

export type MemoryStorageObject = {
  body: Buffer;
  /** Optional ETag string (e.g. quoted MD5) for dedupe / verify tests. */
  etag?: string;
};

/**
 * In-process {@link StorageProvider} for tests and custom pipelines: keys are full S3 object keys,
 * listing is lexicographic by key under the requested prefix.
 */
export class MemoryStorageProvider implements StorageProvider {
  constructor(
    private readonly objects: ReadonlyMap<string, MemoryStorageObject>,
  ) {}

  async *listObjects(
    prefix: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ObjectMeta> {
    const keys = [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const key of keys) {
      options?.signal?.throwIfAborted();
      const o = this.objects.get(key)!;
      yield {
        key,
        size: o.body.length,
        ...(o.etag !== undefined ? { etag: o.etag } : {}),
      };
    }
  }

  async getObjectStream(
    key: string,
    options?: { signal?: AbortSignal; bucket?: string },
  ): Promise<Readable> {
    options?.signal?.throwIfAborted();
    const o = this.objects.get(key);
    if (!o) {
      throw new S3ArchiveError(
        `MemoryStorageProvider: no object for key "${key}"`,
        "S3_REQUEST_FAILED",
        {
          phase: "getObject",
          context: {
            operation: "getObject",
            bucket: options?.bucket ?? "",
            key,
            httpStatusCode: 404,
          },
        },
      );
    }
    const stream = Readable.from(o.body);
    const sig = options?.signal;
    if (sig) {
      const onAbort = () => stream.destroy(sig.reason);
      if (sig.aborted) onAbort();
      else sig.addEventListener("abort", onAbort, { once: true });
    }
    return stream;
  }
}
