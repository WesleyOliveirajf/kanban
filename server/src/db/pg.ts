import pg from "pg";
import type { Db, Queryable } from "./types.js";

function wrap(c: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const r = await c.query(sql, params as unknown[]);
      return r.rows as T[];
    },
    async exec(sql: string) {
      await c.query(sql);
    },
  };
}

export function createPgDb(connectionString: string): Db {
  // Em serverless (Vercel) um pool grande deixa conexões órfãs no Postgres.
  const serverless = Boolean(process.env.VERCEL);
  const pool = new pg.Pool({
    connectionString,
    max: serverless ? 1 : 10,
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
