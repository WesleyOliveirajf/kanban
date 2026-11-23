import type { NextFunction, Request, Response } from "express";
import type { Config } from "../config.js";
import { parseCookies, type Session, type SessionStore } from "./sessions.js";

export const SESSION_COOKIE = "kanban_session";

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
  }
}

/** Valida sessão E proprietário em toda requisição protegida. */
export function requireOwner(cfg: Config, sessions: SessionStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = token ? await sessions.get(token) : null;
    if (!token || !session || session.ownerSub !== cfg.ownerSub) {
      if (token && session) await sessions.destroy(token); // sessão de conta que não é mais a autorizada
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    req.session = session;
    next();
  };
}

/** Defesa em profundidade contra CSRF: escritas só com Origin do próprio app. */
export function sameOriginWrites(cfg: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && origin !== new URL(cfg.baseUrl).origin) {
      res.status(403).json({ error: "forbidden_origin" });
      return;
    }
    next();
  };
}
