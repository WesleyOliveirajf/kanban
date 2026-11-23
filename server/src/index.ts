import { bootstrap } from "./bootstrap.js";

const { app, sessions, db, cfg } = await bootstrap({ serveWeb: true });

if (!process.env.VERCEL) {
  setInterval(() => void sessions.purgeExpired().catch(() => {}), 60 * 60 * 1000).unref();
}

const server = app.listen(cfg.port, () => console.log(`Kanban em ${cfg.baseUrl} (porta ${cfg.port})`));
const shutdown = () => server.close(() => void db.close().then(() => process.exit(0)));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
