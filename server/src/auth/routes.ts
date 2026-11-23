import { Router } from "express";
import type { Config } from "../config.js";
import type { IdentityProvider, LoginChecks } from "./identity.js";
import { SESSION_COOKIE } from "./middleware.js";
import { parseCookies, sign, verify, type SessionStore } from "./sessions.js";
import { verifyPassword } from "./password.js";

const FLOW_COOKIE = "kanban_oidc";
const FLOW_TTL_S = 600;

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

export function authRoutes(cfg: Config, idp: IdentityProvider | undefined, sessions: SessionStore, now: () => number = Date.now) {
  const r = Router();
  const redirectUri = `${cfg.baseUrl}/api/auth/callback`;
  const secure = cfg.secureCookies ? "; Secure" : "";

  const sessionCookie = (token: string, expiresAt: Date) =>
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;

  r.get("/methods", (_req, res) => void res.json({ password: Boolean(cfg.passwordHash), google: Boolean(idp) }));

  // --- senha única do proprietário, com limite de tentativas por IP ---
  const failures = new Map<string, { count: number; resetAt: number }>();
  r.post("/login", async (req, res) => {
    if (!cfg.passwordHash) return void res.status(404).json({ error: "not_found" });
    const key = req.ip ?? "?";
    const rec = failures.get(key);
    if (rec && rec.resetAt <= now()) failures.delete(key);
    const cur = failures.get(key);
    if (cur && cur.count >= MAX_FAILURES) {
      res.setHeader("Retry-After", String(Math.ceil((cur.resetAt - now()) / 1000)));
      return void res.status(429).json({ error: "too_many_attempts" });
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || password.length > 200 || !(await verifyPassword(cfg.passwordHash, password))) {
      failures.set(key, { count: (cur?.count ?? 0) + 1, resetAt: cur?.resetAt ?? now() + WINDOW_MS });
      return void res.status(401).json({ error: "invalid_credentials" });
    }
    failures.delete(key);
    const { token, expiresAt } = await sessions.create(cfg.ownerSub, "proprietário");
    res.setHeader("Set-Cookie", sessionCookie(token, expiresAt)).status(204).end();
  });

  // --- Google (opcional) ---
  r.get("/google", async (_req, res) => {
    if (!idp) return void res.status(404).json({ error: "not_found" });
    const { url, checks } = await idp.start(redirectUri);
    const value = sign({ ...checks, exp: Date.now() + FLOW_TTL_S * 1000 }, cfg.sessionSecret);
    res.setHeader(
      "Set-Cookie",
      `${FLOW_COOKIE}=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${FLOW_TTL_S}${secure}`,
    );
    res.redirect(url);
  });

  r.get("/callback", async (req, res) => {
    if (!idp) return void res.status(404).json({ error: "not_found" });
    const flow = verify<LoginChecks & { exp: number }>(parseCookies(req.headers.cookie)[FLOW_COOKIE], cfg.sessionSecret);
    const clearFlow = `${FLOW_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    if (!flow || flow.exp < Date.now() || req.query.state !== flow.state) {
      res.setHeader("Set-Cookie", clearFlow).status(400).json({ error: "invalid_login_state" });
      return;
    }
    let identity;
    try {
      identity = await idp.finish(new URL(req.originalUrl, cfg.baseUrl), flow);
    } catch (e) {
      console.warn("login falhou:", e instanceof Error ? e.message : e);
      res.setHeader("Set-Cookie", clearFlow).status(400).json({ error: "login_failed" });
      return;
    }
    if (identity.sub !== cfg.ownerSub) {
      console.warn(`login negado: conta Google não autorizada (sub=${identity.sub})`);
      res.setHeader("Set-Cookie", clearFlow).status(403).json({ error: "account_not_authorized" });
      return;
    }
    const { token, expiresAt } = await sessions.create(identity.sub, identity.email);
    res.setHeader("Set-Cookie", [clearFlow, sessionCookie(token, expiresAt)]);
    res.redirect("/");
  });

  r.post("/logout", async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await sessions.destroy(token);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    res.status(204).end();
  });

  return r;
}
