import type { CheckpointState, CheckpointStore } from "./checkpoint.js";
import { S3ArchiveError } from "./errors.js";

/**
 * Minimal async key/value surface implemented by **ioredis** `Redis`, **node-redis** `RedisClientType`,
 * or your own adapter.
 */
export interface RedisCheckpointCommands {
  get(key: string): Promise<string | null | undefined>;
  /** Real clients return `'OK'` or a number; callers ignore the value. */
  set(key: string, value: string): Promise<string | number | boolean | void>;
  /** Required when {@link RedisCheckpointStoreOptions.ttlSeconds} is set (ioredis / node-redis both expose `expire`). */
  expire?(key: string, seconds: number): Promise<number | boolean | void>;
}

export interface RedisCheckpointStoreOptions {
  /**
   * Prepended to each checkpoint key (default **`s3-archive-download:checkpoint:`**).
   * Use a dedicated Redis DB or prefix per app/environment.
   */
  keyPrefix?: string;
  /**
   * When set, `SET` with seconds expiry on each {@link CheckpointStore.save} (abandoned job cleanup).
   * Omit to keep keys until explicitly deleted.
   */
  ttlSeconds?: number;
}

/**
 * {@link CheckpointStore} backed by Redis JSON blobs (same schema as {@link FileCheckpointStore} files).
 */
export class RedisCheckpointStore implements CheckpointStore {
  readonly #redis: RedisCheckpointCommands;
  readonly #prefix: string;
  readonly #ttlSeconds?: number;
  readonly #expire?: (
    key: string,
    seconds: number,
  ) => Promise<number | boolean | void>;

  constructor(
    redis: RedisCheckpointCommands,
    options?: RedisCheckpointStoreOptions,
  ) {
    this.#redis = redis;
    this.#prefix = options?.keyPrefix ?? "s3-archive-download:checkpoint:";
    this.#ttlSeconds = options?.ttlSeconds;
    if (this.#ttlSeconds != null && this.#ttlSeconds > 0) {
      if (typeof redis.expire !== "function") {
        throw new S3ArchiveError(
          "RedisCheckpointStore: ttlSeconds requires redis.expire (pass an ioredis or node-redis client, or a custom adapter with expire).",
          "REDIS_ADAPTER_INCOMPLETE",
          { phase: "bootstrap", context: { ttlSeconds: this.#ttlSeconds } },
        );
      }
      this.#expire = redis.expire.bind(redis) as (
        key: string,
        seconds: number,
      ) => Promise<number | boolean | void>;
    }
  }

  #key(jobId: string): string {
    return `${this.#prefix}${encodeURIComponent(jobId)}`;
  }

  async load(jobId: string): Promise<CheckpointState | null> {
    const raw = await this.#redis.get(this.#key(jobId));
    if (raw == null || raw === "") return null;
    try {
      return JSON.parse(raw) as CheckpointState;
    } catch {
      return null;
    }
  }

  async save(jobId: string, state: CheckpointState): Promise<void> {
    const payload = JSON.stringify(state);
    const key = this.#key(jobId);
    await this.#redis.set(key, payload);
    if (this.#expire && this.#ttlSeconds != null && this.#ttlSeconds > 0) {
      await this.#expire(key, this.#ttlSeconds);
    }
  }
}
