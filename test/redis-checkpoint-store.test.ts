import { describe, expect, it } from "vitest";
import type { CheckpointState } from "../src/checkpoint.js";
import {
  RedisCheckpointStore,
  type RedisCheckpointCommands,
} from "../src/redis-checkpoint-store.js";
import { S3ArchiveError } from "../src/errors.js";

function createFakeRedis(): RedisCheckpointCommands & {
  entries: Map<string, string>;
  expiries: Map<string, number>;
} {
  const entries = new Map<string, string>();
  const expiries = new Map<string, number>();
  return {
    entries,
    expiries,
    async get(key: string) {
      return entries.get(key) ?? null;
    },
    async set(key: string, value: string) {
      entries.set(key, value);
    },
    async expire(key: string, seconds: number) {
      expiries.set(key, seconds);
    },
  };
}

describe("RedisCheckpointStore", () => {
  const sampleState = (): CheckpointState => ({
    version: 1,
    bucket: "b",
    prefix: "p/",
    format: "zip",
    completedKeys: ["a.txt"],
  });

  it("round-trips checkpoint JSON", async () => {
    const redis = createFakeRedis();
    const store = new RedisCheckpointStore(redis, { keyPrefix: "test:" });
    await store.save("job-1", sampleState());
    const loaded = await store.load("job-1");
    expect(loaded).toEqual(sampleState());
    expect([...redis.entries.keys()][0]).toBe("test:job-1");
  });

  it("returns null for missing job", async () => {
    const store = new RedisCheckpointStore(createFakeRedis());
    expect(await store.load("nope")).toBeNull();
  });

  it("returns null on invalid JSON", async () => {
    const redis = createFakeRedis();
    await redis.set("s3prefix-archive:checkpoint:bad", "{");
    const store = new RedisCheckpointStore(redis);
    expect(await store.load("bad")).toBeNull();
  });

  it("calls expire when ttlSeconds is set", async () => {
    const redis = createFakeRedis();
    const store = new RedisCheckpointStore(redis, { ttlSeconds: 3600 });
    await store.save("j", sampleState());
    expect(redis.expiries.get("s3prefix-archive:checkpoint:j")).toBe(3600);
  });

  it("throws when ttlSeconds is set but expire is missing", () => {
    expect(
      () =>
        new RedisCheckpointStore(
          {
            get: async () => null,
            set: async () => {},
          },
          { ttlSeconds: 1 },
        ),
    ).toThrow(S3ArchiveError);
    try {
      new RedisCheckpointStore(
        { get: async () => null, set: async () => {} },
        { ttlSeconds: 1 },
      );
    } catch (e) {
      expect(e).toMatchObject({ code: "REDIS_ADAPTER_INCOMPLETE" });
    }
  });
});
