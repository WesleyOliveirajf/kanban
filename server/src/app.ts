import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import type { IdentityProvider } from "./auth/identity.js";
import { SessionStore } from "./auth/sessions.js";
import { requireOwner, sameOriginWrites } from "./auth/middleware.js";
import { authRoutes } from "./auth/routes.js";
import { projectRoutes } from "./projects.js";
import { cardRoutes } from "./cards.js";

export interface AppDeps {
  cfg: Config;
  db: Db;
  /** Provedor Google (opcional). */
  idp?: IdentityProvider;
  webDir?: string;
  /** Relógio injetável (testes). */
  now?: () => Date;
}

export function createApp({ cfg, db, idp, webDir, now = () => new Date() }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "100kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  const sessions = new SessionStore(db, cfg.sessionTtlMs);
  const api = express.Router();
  api.use(sameOriginWrites(cfg));

  api.get("/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Cron da Vercel (Authorization: Bearer $CRON_SECRET). Sem segredo = rota desligada.
  api.get("/cron/purge-sessions", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    await sessions.purgeExpired();
    res.status(204).end();
  });

  api.use("/auth", authRoutes(cfg, idp, sessions));

  // Tudo abaixo exige sessão válida do proprietário.
  api.use(requireOwner(cfg, sessions));
  api.get("/me", (req, res) => void res.json({ email: req.session!.email }));
  api.use("/projects", projectRoutes(db));
  api.use(cardRoutes(db, cfg.timezone, now));

  api.use((_req, res) => void res.status(404).json({ error: "not_found" }));
  app.use("/api", api);

  if (webDir && existsSync(webDir)) {
    app.use(express.static(webDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => void res.sendFile(path.join(webDir, "index.html")));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  };
  app.use(onError);
  return { app, sessions };
}
