import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { googleProvider } from "./auth/identity.js";
import { createApp } from "./app.js";

const cfg = loadConfig();
const db = createDb({ databaseUrl: cfg.databaseUrl, pgliteDir: cfg.pgliteDir ?? (cfg.env === "development" ? ".pglite" : undefined) });
const applied = await migrate(db);
if (applied.length) console.log("migrações aplicadas:", applied.join(", "));

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const { app, sessions } = createApp({ cfg, db, idp: cfg.google ? googleProvider(cfg.google) : undefined, webDir });
setInterval(() => void sessions.purgeExpired().catch(() => {}), 60 * 60 * 1000).unref();

const server = app.listen(cfg.port, () => console.log(`Kanban em ${cfg.baseUrl} (porta ${cfg.port})`));
const shutdown = () => server.close(() => void db.close().then(() => process.exit(0)));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
