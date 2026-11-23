import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { loadConfig, type Config } from "../src/config.js";
import { createDb, type Db } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";
import type { Identity, IdentityProvider } from "../src/auth/identity.js";

const OWNER = "owner-sub-123";
const baseEnv = {
  NODE_ENV: "test",
  BASE_URL: "http://localhost:3000",
  SESSION_SECRET: "x".repeat(40),
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  OWNER_GOOGLE_SUB: OWNER,
};

let db: Db;
let cfg: Config;
let next: Identity; // identidade que o "Google" devolverá no próximo callback

const fakeIdp: IdentityProvider = {
  async start() {
    return { url: "https://accounts.example/auth", checks: { state: "st", nonce: "no", codeVerifier: "cv" } };
  },
  async finish() {
    return next;
  },
};

const build = () => createApp({ cfg, db, idp: fakeIdp });
const cookiesOf = (res: request.Response) => ((res.headers["set-cookie"] as unknown as string[] | undefined) ?? []).map((c) => c.split(";")[0]!);

async function login(app: ReturnType<typeof build>["app"], identity: Identity) {
  next = identity;
  const start = await request(app).get("/api/auth/google");
  const flow = cookiesOf(start).find((c) => c.startsWith("kanban_oidc="))!;
  return request(app).get("/api/auth/callback?code=abc&state=st").set("Cookie", flow);
}

beforeEach(async () => {
  cfg = loadConfig(baseEnv as NodeJS.ProcessEnv);
  db = createDb({});
  await migrate(db);
});
afterEach(() => db.close());

describe("RF-01 acesso privado", () => {
  it("C1/C2: sem sessão a API rejeita", async () => {
    const { app } = build();
    expect((await request(app).get("/api/me")).status).toBe(401);
    expect((await request(app).get("/api/projects")).status).toBe(401);
    expect((await request(app).get("/api/health")).status).toBe(200);
  });

  it("login redireciona ao Google e guarda o estado em cookie HttpOnly", async () => {
    const { app } = build();
    const res = await request(app).get("/api/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://accounts.example/auth");
    expect(res.headers["set-cookie"]![0]).toMatch(/HttpOnly/);
  });

  it("C3/C4: conta do proprietário recebe sessão funcional", async () => {
    const { app } = build();
    const cb = await login(app, { sub: OWNER, email: "dono@example.com" });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe("/");
    const session = cookiesOf(cb).find((c) => c.startsWith("kanban_session="))!;
    expect(session).toBeTruthy();
    expect((cb.headers["set-cookie"] as unknown as string[]).join(";")).toMatch(/HttpOnly; SameSite=Lax/);
    const me = await request(app).get("/api/me").set("Cookie", session);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ email: "dono@example.com" });
    expect((await request(app).get("/api/projects").set("Cookie", session)).status).toBe(200);
  });

  it("não guarda o token da sessão em texto puro no banco", async () => {
    const { app } = build();
    const cb = await login(app, { sub: OWNER, email: "a@b.c" });
    const token = cookiesOf(cb).find((c) => c.startsWith("kanban_session="))!.split("=")[1]!;
    const rows = await db.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);
  });

  it("C5: outra conta Google recebe 403 e nenhuma sessão", async () => {
    const { app } = build();
    const cb = await login(app, { sub: "intruso", email: "x@y.z" });
    expect(cb.status).toBe(403);
    expect(cookiesOf(cb).some((c) => c.startsWith("kanban_session=") && c !== "kanban_session=")).toBe(false);
    expect(await db.query("SELECT 1 FROM sessions")).toHaveLength(0);
  });

  it("C6: sessão de conta que não é a autorizada é rejeitada e descartada", async () => {
    const { app } = build();
    const { token } = await build().sessions.create("outra-conta", "o@o.o");
    const res = await request(app).get("/api/me").set("Cookie", `kanban_session=${token}`);
    expect(res.status).toBe(401);
    expect(await db.query("SELECT 1 FROM sessions")).toHaveLength(0);
  });

  it("C7: state inválido ou ausente derruba o callback", async () => {
    const { app } = build();
    next = { sub: OWNER, email: "a@b.c" };
    const start = await request(app).get("/api/auth/google");
    const flow = cookiesOf(start).find((c) => c.startsWith("kanban_oidc="))!;
    expect((await request(app).get("/api/auth/callback?code=abc&state=outro").set("Cookie", flow)).status).toBe(400);
    expect((await request(app).get("/api/auth/callback?code=abc&state=st")).status).toBe(400);
    const forged = flow.replace(/^(kanban_oidc=[^.]+)\..*$/, "$1.assinaturafalsa");
    expect((await request(app).get("/api/auth/callback?code=abc&state=st").set("Cookie", forged)).status).toBe(400);
    expect(await db.query("SELECT 1 FROM sessions")).toHaveLength(0);
  });

  it("C8: logout encerra a sessão", async () => {
    const { app } = build();
    const cb = await login(app, { sub: OWNER, email: "a@b.c" });
    const session = cookiesOf(cb).find((c) => c.startsWith("kanban_session="))!;
    expect((await request(app).post("/api/auth/logout").set("Cookie", session)).status).toBe(204);
    expect((await request(app).get("/api/me").set("Cookie", session)).status).toBe(401);
  });

  it("C9: sessão expirada é rejeitada", async () => {
    const { app, sessions } = build();
    const { token } = await sessions.create(OWNER, "a@b.c");
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await request(app).get("/api/me").set("Cookie", `kanban_session=${token}`)).status).toBe(401);
  });

  it("C10: escrita com Origin de outro site é bloqueada", async () => {
    const { app } = build();
    const res = await request(app).post("/api/auth/logout").set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("produção exige https e DATABASE_URL", () => {
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/https/);
    expect(() =>
      loadConfig({ ...baseEnv, NODE_ENV: "production", BASE_URL: "https://k.example" } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });
});
