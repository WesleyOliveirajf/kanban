import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { loadConfig, type Config } from "../src/config.js";
import { createDb, type Db } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

const PASSWORD = "senha-do-dono-123";
let hash: string;
let db: Db;
let cfg: Config;
let app: ReturnType<typeof createApp>["app"];

const env = (extra: Record<string, string> = {}) =>
  ({ NODE_ENV: "test", BASE_URL: "http://localhost:3000", SESSION_SECRET: "x".repeat(40), OWNER_PASSWORD_HASH: hash, ...extra }) as NodeJS.ProcessEnv;
const cookieOf = (res: request.Response) =>
  ((res.headers["set-cookie"] as unknown as string[] | undefined) ?? []).map((c) => c.split(";")[0]!).find((c) => c.startsWith("kanban_session=") && c.length > 16);

beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});
beforeEach(async () => {
  cfg = loadConfig(env());
  db = createDb({});
  await migrate(db);
  app = createApp({ cfg, db }).app;
});
afterEach(() => db.close());

describe("login por senha única", () => {
  it("hash/verify: aceita a senha certa, rejeita errada e hash malformado", async () => {
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "outra")).toBe(false);
    expect(await verifyPassword("lixo", PASSWORD)).toBe(false);
    expect(await hashPassword(PASSWORD)).not.toBe(hash); // sal aleatório
  });

  it("S1: senha correta cria sessão funcional", async () => {
    const res = await request(app).post("/api/auth/login").send({ password: PASSWORD });
    expect(res.status).toBe(204);
    expect((res.headers["set-cookie"] as unknown as string[]).join(";")).toMatch(/HttpOnly; SameSite=Lax/);
    const cookie = cookieOf(res)!;
    expect((await request(app).get("/api/me").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/projects").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(204);
    expect((await request(app).get("/api/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("S2: senha errada, vazia ou de tipo inválido → 401 sem sessão", async () => {
    for (const body of [{ password: "errada" }, { password: "" }, {}, { password: 123 }]) {
      const res = await request(app).post("/api/auth/login").send(body);
      expect(res.status).toBe(401);
      expect(cookieOf(res)).toBeUndefined();
    }
    expect(await db.query("SELECT 1 FROM sessions")).toHaveLength(0);
  });

  it("S3/S4: bloqueia após 5 falhas; sucesso antes disso zera o contador", async () => {
    for (let i = 0; i < 4; i++) await request(app).post("/api/auth/login").send({ password: "x" });
    expect((await request(app).post("/api/auth/login").send({ password: PASSWORD })).status).toBe(204); // zera
    for (let i = 0; i < 5; i++) expect((await request(app).post("/api/auth/login").send({ password: "x" })).status).toBe(401);
    const blocked = await request(app).post("/api/auth/login").send({ password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(cookieOf(blocked)).toBeUndefined();
  });

  it("S5: /auth/methods informa o que está disponível; rotas Google somem sem Google", async () => {
    expect((await request(app).get("/api/auth/methods")).body).toEqual({ password: true, google: false });
    expect((await request(app).get("/api/auth/google")).status).toBe(404);
    expect((await request(app).get("/api/auth/callback?state=x")).status).toBe(404);
  });

  it("S6: configuração inválida recusa subir", () => {
    const { OWNER_PASSWORD_HASH: _omit, ...semSenha } = env() as Record<string, string>;
    expect(() => loadConfig(semSenha as NodeJS.ProcessEnv)).toThrow(/OWNER_PASSWORD_HASH/);
    expect(() => loadConfig(env({ OWNER_PASSWORD_HASH: "texto-puro" }))).toThrow(/inválido/);
    expect(() => loadConfig(env({ GOOGLE_CLIENT_ID: "x" }))).toThrow(/incompleto/);
    expect(loadConfig(env()).ownerSub).toBe("owner");
  });

  it("sem sessão a API continua rejeitando; Origin de outro site é bloqueado no login", async () => {
    expect((await request(app).get("/api/projects")).status).toBe(401);
    const res = await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ password: PASSWORD });
    expect(res.status).toBe(403);
  });
});
