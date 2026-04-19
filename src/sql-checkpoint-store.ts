import type { CheckpointState, CheckpointStore } from "./checkpoint.js";
import { S3ArchiveError } from "./errors.js";

/** Supported placeholder styles for generated SQL. */
export type SqlCheckpointDialect = "sqlite" | "postgres" | "mysql";

/**
 * Minimal async SQL surface. Implement with **`better-sqlite3`** (wrap sync calls),
 * **`pg`**.`Pool#query`, **`mysql2`**, Drizzle, Prisma `$queryRaw`, etc.
 */
export interface SqlCheckpointClient {
  /**
   * Run a read; return matching rows (empty if none). Column names should include `payload`.
   */
  query<T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[],
  ): Promise<T[]>;
  /** Run a write (INSERT/UPDATE/DELETE). */
  execute(sql: string, params: readonly unknown[]): Promise<void>;
}

export interface SqlTableCheckpointStoreOptions {
  /**
   * SQL dialect for generated statements (default **`postgres`**).
   * - **`postgres`**: `$1`, `$2`, … and `ON CONFLICT (job_id) DO UPDATE`.
   * - **`sqlite`**: `?` placeholders and `INSERT OR REPLACE`.
   * - **`mysql`**: `?` placeholders, backtick-quoted identifiers, and `ON DUPLICATE KEY UPDATE`.
   */
  dialect?: SqlCheckpointDialect;
  /**
   * Table name (unquoted identifier: `[a-zA-Z_][a-zA-Z0-9_]*`). You must create the table, for example:
   *
   * ```sql
   * -- PostgreSQL
   * CREATE TABLE s3flow_checkpoint (
   *   job_id TEXT PRIMARY KEY,
   *   payload TEXT NOT NULL
   * );
   *
   * -- SQLite
   * CREATE TABLE s3flow_checkpoint (
   *   job_id TEXT PRIMARY KEY,
   *   payload TEXT NOT NULL
   * );
   *
   * -- MySQL (utf8mb4; InnoDB has a 3072-byte index prefix limit—TEXT PK is fine for typical job ids)
   * CREATE TABLE s3flow_checkpoint (
   *   job_id VARCHAR(512) PRIMARY KEY,
   *   payload LONGTEXT NOT NULL
   * );
   * ```
   */
  tableName: string;
}

function assertSafeTableIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new S3ArchiveError(
      `SqlTableCheckpointStore: invalid tableName "${name}" (use [a-zA-Z_][a-zA-Z0-9_]*)`,
      "INVALID_CONFIGURATION",
      { phase: "bootstrap", context: { tableName: name } },
    );
  }
  return name;
}

function quoteIdentPg(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteIdentMysql(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}

/**
 * {@link CheckpointStore} backed by a single SQL table (`job_id` text PK, `payload` JSON text).
 * Same JSON schema as {@link FileCheckpointStore} / {@link RedisCheckpointStore}.
 */
export class SqlTableCheckpointStore implements CheckpointStore {
  readonly #client: SqlCheckpointClient;
  readonly #dialect: SqlCheckpointDialect;
  readonly #tableSql: string;

  constructor(
    client: SqlCheckpointClient,
    options: SqlTableCheckpointStoreOptions,
  ) {
    this.#client = client;
    this.#dialect = options.dialect ?? "postgres";
    const id = assertSafeTableIdentifier(options.tableName);
    this.#tableSql =
      this.#dialect === "mysql" ? quoteIdentMysql(id) : quoteIdentPg(id);
  }

  #ident(name: string): string {
    return this.#dialect === "mysql"
      ? quoteIdentMysql(name)
      : quoteIdentPg(name);
  }

  async load(jobId: string): Promise<CheckpointState | null> {
    const t = this.#tableSql;
    const jobCol = this.#ident("job_id");
    const payloadCol = this.#ident("payload");
    const sql =
      this.#dialect === "postgres"
        ? `SELECT ${payloadCol} FROM ${t} WHERE ${jobCol} = $1`
        : `SELECT ${payloadCol} FROM ${t} WHERE ${jobCol} = ?`;
    const rows = await this.#client.query<{ payload: string }>(sql, [jobId]);
    const raw = rows[0]?.payload;
    if (raw == null || raw === "") return null;
    try {
      return JSON.parse(raw) as CheckpointState;
    } catch {
      return null;
    }
  }

  async save(jobId: string, state: CheckpointState): Promise<void> {
    const payload = JSON.stringify(state);
    const t = this.#tableSql;
    const jobCol = this.#ident("job_id");
    const payloadCol = this.#ident("payload");
    if (this.#dialect === "postgres") {
      const sql = `INSERT INTO ${t} (${jobCol}, ${payloadCol}) VALUES ($1, $2) ON CONFLICT (${jobCol}) DO UPDATE SET ${payloadCol} = EXCLUDED.${payloadCol}`;
      await this.#client.execute(sql, [jobId, payload]);
    } else if (this.#dialect === "mysql") {
      const sql = `INSERT INTO ${t} (${jobCol}, ${payloadCol}) VALUES (?, ?) ON DUPLICATE KEY UPDATE ${payloadCol} = VALUES(${payloadCol})`;
      await this.#client.execute(sql, [jobId, payload]);
    } else {
      const sql = `INSERT OR REPLACE INTO ${t} (${jobCol}, ${payloadCol}) VALUES (?, ?)`;
      await this.#client.execute(sql, [jobId, payload]);
    }
  }
}
