import { z } from "zod";
import { isValidHash } from "./auth/password.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  BASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa de ao menos 32 caracteres"),
  /** Hash scrypt da senha única do proprietário (ver `npm run hash-password`). */
  OWNER_PASSWORD_HASH: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Identificador (`sub`) da única conta Google autorizada. */
  OWNER_GOOGLE_SUB: z.string().optional(),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  VERCEL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
});

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  baseUrl: string;
  databaseUrl?: string;
  pgliteDir?: string;
  sessionSecret: string;
  /** Presente só quando o login Google está totalmente configurado. */
  google?: { clientId: string; clientSecret: string };
  passwordHash?: string;
  /** Identidade do proprietário nas sessões (`sub` do Google, ou "owner"). */
  ownerSub: string;
  timezone: string;
  sessionTtlMs: number;
  secureCookies: boolean;
}

function resolveBaseUrl(e: z.infer<typeof schema>): string {
  if (e.BASE_URL) return e.BASE_URL.replace(/\/$/, "");
  if (e.VERCEL_ENV === "production" && e.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${e.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  if (e.VERCEL_URL) return `https://${e.VERCEL_URL.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = schema.parse(env);
  const baseUrl = resolveBaseUrl(e);
  const secureCookies = baseUrl.startsWith("https://");
  const googleVars = [e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET, e.OWNER_GOOGLE_SUB].filter(Boolean).length;
  if (googleVars !== 0 && googleVars !== 3)
    throw new Error("Login Google incompleto: defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e OWNER_GOOGLE_SUB (ou nenhum)");
  if (e.OWNER_PASSWORD_HASH && !isValidHash(e.OWNER_PASSWORD_HASH))
    throw new Error("OWNER_PASSWORD_HASH inválido: gere com `npm run hash-password`");
  if (googleVars === 0 && !e.OWNER_PASSWORD_HASH)
    throw new Error("Defina OWNER_PASSWORD_HASH (senha do proprietário) ou as variáveis do login Google");
  if (e.NODE_ENV === "production") {
    if (!secureCookies) throw new Error("Em produção BASE_URL precisa usar https");
    if (!e.DATABASE_URL) throw new Error("Em produção DATABASE_URL é obrigatório");
  }
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    baseUrl,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    sessionSecret: e.SESSION_SECRET,
    google: googleVars === 3 ? { clientId: e.GOOGLE_CLIENT_ID!, clientSecret: e.GOOGLE_CLIENT_SECRET! } : undefined,
    passwordHash: e.OWNER_PASSWORD_HASH,
    ownerSub: e.OWNER_GOOGLE_SUB ?? "owner",
    timezone: e.APP_TIMEZONE,
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    secureCookies,
  };
}
