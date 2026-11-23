import { createPgDb } from "./pg.js";
import type { Db } from "./types.js";

export type { Db, Queryable } from "./types.js";

export async function createDb(opts: { databaseUrl?: string; pgliteDir?: string }): Promise<Db> {
  if (opts.databaseUrl) return createPgDb(opts.databaseUrl);
  const { createPgliteDb } = await import("./pglite.js");
  return createPgliteDb(opts.pgliteDir);
}
