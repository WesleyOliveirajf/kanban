import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/index.js";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export interface Session {
  ownerSub: string;
  email: string;
}

export class SessionStore {
  constructor(
    private db: Db,
    private ttlMs: number,
  ) {}

  async create(ownerSub: string, email: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.db.query(
      "INSERT INTO sessions (token_hash, owner_sub, email, expires_at) VALUES ($1,$2,$3,$4)",
      [hashToken(token), ownerSub, email, expiresAt.toISOString()],
    );
    return { token, expiresAt };
  }

  async get(token: string): Promise<Session | null> {
    const rows = await this.db.query<{ owner_sub: string; email: string }>(
      "SELECT owner_sub, email FROM sessions WHERE token_hash = $1 AND expires_at > now()",
      [hashToken(token)],
    );
    const r = rows[0];
    return r ? { ownerSub: r.owner_sub, email: r.email } : null;
  }

  async destroy(token: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  }

  async purgeExpired(): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE expires_at <= now()");
  }
}

/** Cookie curto assinado (HMAC-SHA256) para o estado do fluxo OIDC. */
export function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
