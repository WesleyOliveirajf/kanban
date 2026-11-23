import { createPgDb } from "./pg.js";
import { createPgliteDb } from "./pglite.js";
import type { Db } from "./types.js";

export type { Db, Queryable } from "./types.js";

export function createDb(opts: { databaseUrl?: string; pgliteDir?: string }): Db {
  return opts.databaseUrl ? createPgDb(opts.databaseUrl) : createPgliteDb(opts.pgliteDir);
}
