/**
 * `RedisCheckpointStore` needs a minimal Redis-like surface (`get` / `set`, optional `expire`).
 * This file uses an **in-memory** map so the example typechecks without Redis; in production pass
 * **ioredis** `Redis` or **node-redis** `createClient()` (both satisfy `RedisCheckpointCommands`).
 *
 * Pair with `downloadFolderToFile` / `resumeFolderArchiveToFile` the same way as `FileCheckpointStore`.
 */
import { S3Client } from "@aws-sdk/client-s3";
import {
  downloadFolderToFile,
  RedisCheckpointStore,
  type RedisCheckpointCommands,
} from "s3-archive-download";

/** Minimal stand-in for demos; replace with a real Redis client. */
class MemoryRedis implements RedisCheckpointCommands {
  readonly #m = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.#m.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.#m.set(key, value);
  }
}

async function main(): Promise<void> {
  const source = process.env.SOURCE_URI;
  const outPath = process.env.OUT_PATH ?? "./out.zip";
  if (!source) {
    throw new Error("Set SOURCE_URI");
  }

  const client = new S3Client({});
  const store = new RedisCheckpointStore(new MemoryRedis(), {
    keyPrefix: "s3-archive-download:example:",
  });
  const checkpoint = { jobId: "redis-example-1", store };

  const { stats } = await downloadFolderToFile(outPath, {
    source,
    format: "zip",
    client,
    checkpoint,
  });

  console.log("bytesWritten", stats.bytesWritten);
}

void main();
