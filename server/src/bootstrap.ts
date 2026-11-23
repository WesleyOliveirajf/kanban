import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { googleProvider } from "./auth/identity.js";
import { createApp } from "./app.js";

export interface BootstrapOpts {
  /** Em Vercel os estáticos vêm de `public/` (CDN); não use express.static. */
  serveWeb?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Monta config, banco, migrações e o Express app (sem listen). */
export async function bootstrap(opts: BootstrapOpts = {}) {
  const env = opts.env ?? process.env;
  const cfg = loadConfig(env);
  const db = await createDb({
    databaseUrl: cfg.databaseUrl,
    pgliteDir: cfg.pgliteDir ?? (cfg.env === "development" ? ".pglite" : undefined),
  });
  const applied = await migrate(db);
  if (applied.length) console.log("migrações aplicadas:", applied.join(", "));

  const serveWeb = opts.serveWeb ?? !env.VERCEL;
  const webDir = serveWeb
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public")
    : undefined;

  const built = createApp({
    cfg,
    db,
    idp: cfg.google ? googleProvider(cfg.google) : undefined,
    webDir,
  });
  return { ...built, cfg, db };
}
