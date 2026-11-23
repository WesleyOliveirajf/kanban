import { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable } from "./types.js";

type Runner = Pick<PGlite, "query" | "exec">;

function wrap(c: Runner): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const r = await c.query(sql, params);
      return r.rows as T[];
    },
    async exec(sql: string) {
      await c.exec(sql);
    },
  };
}

/** Postgres embarcado para desenvolvimento e testes. `dir` ausente = em memória. */
export function createPgliteDb(dir?: string): Db {
  const db = new PGlite(dir);
  return {
    ...wrap(db),
    tx: (fn) => db.transaction((t) => fn(wrap(t as unknown as Runner))),
    close: () => db.close(),
  };
}
