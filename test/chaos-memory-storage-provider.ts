import type { Readable } from "node:stream";
import type { ObjectMeta, StorageProvider } from "../src/types.js";
import {
  MemoryStorageProvider,
  type MemoryStorageObject,
} from "../src/memory-storage-provider.js";

/** Use with {@link ChaosMemoryStorageProviderOptions.failGetObjectWith} in tests. */
export const CHAOS_GET_OBJECT_FAIL = "CHAOS_GET_OBJECT_FAIL";

interface ChaosMemoryStorageProviderOptions {
  /**
   * Artificial delay before returning from {@link StorageProvider.getObjectStream} (simulates slow
   * connection / cold open). Does not delay individual chunks after the stream starts.
   */
  getObjectLatencyMs?: number;
  /**
   * Reject `getObjectStream` with this error after listing succeeds (simulates auth / 5xx / broken
   * open). Use in tests for fail-fast vs `failureMode: 'best-effort'` omissions without mid-body
   * stream faults (those can race the archive encoder).
   */
  failGetObjectWith?: Error;
}

/**
 * Wraps {@link MemoryStorageProvider} for CI resilience checks: optional open latency and injected
 * `getObject` failures. See [test/chaos-storage-provider.integration.test.ts](chaos-storage-provider.integration.test.ts).
 * For **fail-fast / best-effort** assertions on `failGetObjectWith`, prefer **`format: "tar"`** in
 * tests: ZIP uses an inner `p-limit` around `getObjectStream` that can confuse Vitest’s unhandled
 * rejection tracking; behavior is still correct for `zip` in production.
 */
export class ChaosMemoryStorageProvider implements StorageProvider {
  readonly #inner: MemoryStorageProvider;
  readonly #chaos: ChaosMemoryStorageProviderOptions;

  constructor(
    objects: ReadonlyMap<string, MemoryStorageObject>,
    chaos: ChaosMemoryStorageProviderOptions = {},
  ) {
    this.#inner = new MemoryStorageProvider(objects);
    this.#chaos = chaos;
  }

  async *listObjects(
    prefix: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ObjectMeta> {
    yield* this.#inner.listObjects(prefix, options);
  }

  async getObjectStream(
    key: string,
    options?: { signal?: AbortSignal; bucket?: string },
  ): Promise<Readable> {
    const failOpen = this.#chaos.failGetObjectWith;
    if (failOpen) {
      throw failOpen;
    }
    const inner = await this.#inner.getObjectStream(key, options);
    const ms = this.#chaos.getObjectLatencyMs;
    if (ms != null && ms > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        const sig = options?.signal;
        if (sig) {
          const onAbort = (): void => {
            clearTimeout(t);
            reject(sig.reason);
          };
          if (sig.aborted) onAbort();
          else sig.addEventListener("abort", onAbort, { once: true });
        }
      });
      options?.signal?.throwIfAborted();
    }
    return inner;
  }
}
