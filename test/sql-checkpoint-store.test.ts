import { describe, expect, it } from "vitest";
import type { CheckpointState } from "../src/checkpoint.js";
import type { SqlCheckpointClient } from "../src/sql-checkpoint-store.js";
import { SqlTableCheckpointStore } from "../src/sql-checkpoint-store.js";

function createMemorySqlClient(): SqlCheckpointClient & {
  rows: Map<string, string>;
} {
  const rows = new Map<string, string>();
  return {
    rows,
    async query<T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[],
    ): Promise<T[]> {
      void sql;
      const jobId = params[0] as string;
      const payload = rows.get(jobId);
      if (payload == null) return [];
      return [{ payload }] as unknown as T[];
    },
    async execute(sql: string, params: readonly unknown[]): Promise<void> {
      void sql;
      const jobId = params[0] as string;
      const payload = params[1] as string;
      rows.set(jobId, payload);
    },
  };
}

function createCapturingSqlClient(): SqlCheckpointClient & {
  rows: Map<string, string>;
  lastQuerySql?: string;
  lastExecuteSql?: string;
} {
  const rows = new Map<string, string>();
  const log = {
    lastQuerySql: undefined as string | undefined,
    lastExecuteSql: undefined as string | undefined,
  };
  return {
    rows,
    get lastQuerySql() {
      return log.lastQuerySql;
    },
    get lastExecuteSql() {
      return log.lastExecuteSql;
    },
    async query<T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[],
    ): Promise<T[]> {
      log.lastQuerySql = sql;
      const jobId = params[0] as string;
      const payload = rows.get(jobId);
      if (payload == null) return [];
      return [{ payload }] as unknown as T[];
    },
    async execute(sql: string, params: readonly unknown[]): Promise<void> {
      log.lastExecuteSql = sql;
      const jobId = params[0] as string;
      const payload = params[1] as string;
      rows.set(jobId, payload);
    },
  };
}

describe("SqlTableCheckpointStore", () => {
  const sample = (): CheckpointState => ({
    version: 1,
    bucket: "b",
    prefix: "p/",
    format: "zip",
    completedKeys: ["k1"],
  });

  it("round-trips JSON (postgres dialect)", async () => {
    const mem = createMemorySqlClient();
    const store = new SqlTableCheckpointStore(mem, {
      tableName: "s3_archive_download_checkpoint",
      dialect: "postgres",
    });
    await store.save("job-a", sample());
    expect(await store.load("job-a")).toEqual(sample());
    expect(mem.rows.get("job-a")).toContain("completedKeys");
  });

  it("round-trips JSON (sqlite dialect)", async () => {
    const mem = createMemorySqlClient();
    const store = new SqlTableCheckpointStore(mem, {
      tableName: "chk",
      dialect: "sqlite",
    });
    await store.save("j", sample());
    expect(await store.load("j")).toEqual(sample());
  });

  it("round-trips JSON (mysql dialect)", async () => {
    const mem = createMemorySqlClient();
    const store = new SqlTableCheckpointStore(mem, {
      tableName: "chk",
      dialect: "mysql",
    });
    await store.save("j", sample());
    expect(await store.load("j")).toEqual(sample());
  });

  it("generates postgres-shaped SQL", async () => {
    const mem = createCapturingSqlClient();
    const store = new SqlTableCheckpointStore(mem, {
      tableName: "s3_archive_download_checkpoint",
      dialect: "postgres",
    });
    await store.load("j1");
    expect(mem.lastQuerySql).toBe(
      `SELECT "payload" FROM "s3_archive_download_checkpoint" WHERE "job_id" = $1`,
    );
    await store.save("j1", sample());
    expect(mem.lastExecuteSql).toMatch(
      /^INSERT INTO "s3_archive_download_checkpoint" \("job_id", "payload"\) VALUES \(\$1, \$2\) ON CONFLICT \("job_id"\) DO UPDATE SET "payload" = EXCLUDED\."payload"$/,
    );
  });

  it("generates sqlite-shaped SQL", async () => {
    const mem = createCapturingSqlClient();
    const store = new SqlTableCheckpointStore(mem, {
      tableName: "chk",
      dialect: "sqlite",
    });
    await store.load("x");
    expect(mem.lastQuerySql).toBe(
      `SELECT "payload" FROM "chk" WHERE "job_id" = ?`,
    );
    await store.save("x", sample());
    expect(mem.lastExecuteSql).toBe(
      `INSERT OR REPLACE INTO "chk" ("job_id", "payload") VALUES (?, ?)`,
    );
  });

  it("generates mysql-shaped SQL", async () => {
    const mem = createCapturingSqlClient();
    const store = new SqlTableCheckpointStore(mem, {
      tableName: "chk",
      dialect: "mysql",
    });
    await store.load("x");
    expect(mem.lastQuerySql).toBe(
      "SELECT `payload` FROM `chk` WHERE `job_id` = ?",
    );
    await store.save("x", sample());
    expect(mem.lastExecuteSql).toBe(
      "INSERT INTO `chk` (`job_id`, `payload`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `payload` = VALUES(`payload`)",
    );
  });

  it("returns null when missing", async () => {
    const store = new SqlTableCheckpointStore(createMemorySqlClient(), {
      tableName: "t",
    });
    expect(await store.load("none")).toBeNull();
  });

  it("returns null on invalid JSON payload", async () => {
    const mem = createMemorySqlClient();
    mem.rows.set("bad", "{");
    const store = new SqlTableCheckpointStore(mem, {
      tableName: "t",
      dialect: "sqlite",
    });
    expect(await store.load("bad")).toBeNull();
  });

  it("rejects unsafe table names", () => {
    expect(
      () =>
        new SqlTableCheckpointStore(createMemorySqlClient(), {
          tableName: "oops;drop",
        }),
    ).toThrow();
  });
});
