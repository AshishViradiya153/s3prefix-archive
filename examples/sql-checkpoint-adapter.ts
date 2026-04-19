/**
 * Sketch: adapt **`pg.Pool`** (node-postgres) to s3prefix-archive's **`SqlCheckpointClient`** for
 * **`SqlTableCheckpointStore`**. Install **`pg`** in your application; it is not a dependency of
 * the `s3prefix-archive` package.
 *
 * Create the table once (Postgres):
 *
 * ```sql
 * CREATE TABLE s3prefix_archive_checkpoint (
 *   job_id TEXT PRIMARY KEY,
 *   payload TEXT NOT NULL
 * );
 * ```
 *
 * Then wire `checkpoint.store` with `new SqlTableCheckpointStore(createSqlCheckpointClientFromPgPool(pool), { dialect: "postgres", tableName: "s3prefix_archive_checkpoint" })`.
 */
import type { SqlCheckpointClient } from "s3prefix-archive";

/** Duck type compatible with `pg.Pool#query` result shape. */
export interface PgLikePool {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export function createSqlCheckpointClientFromPgPool(
  pool: PgLikePool,
): SqlCheckpointClient {
  return {
    async query<T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[],
    ): Promise<T[]> {
      const r = await pool.query<T>(sql, [...params]);
      return r.rows;
    },
    async execute(sql: string, params: readonly unknown[]): Promise<void> {
      await pool.query(sql, [...params]);
    },
  };
}
