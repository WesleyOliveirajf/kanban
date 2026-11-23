import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { loadConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";
import type { IdentityProvider } from "../src/auth/identity.js";

const OWNER = "owner-sub-123";
let db: Db;
let app: ReturnType<typeof createApp>["app"];
let cookie: string;
let clock = new Date("2026-12-12T15:00:00Z"); // 12/12 12:00 em São Paulo

const idp: IdentityProvider = {
  start: async () => ({ url: "x", checks: { state: "s", nonce: "n", codeVerifier: "v" } }),
  finish: async () => ({ sub: OWNER, email: "a@b.c" }),
};

beforeEach(async () => {
  clock = new Date("2026-12-12T15:00:00Z");
  const cfg = loadConfig({
    NODE_ENV: "test",
    BASE_URL: "http://localhost:3000",
    SESSION_SECRET: "x".repeat(40),
    GOOGLE_CLIENT_ID: "i",
    GOOGLE_CLIENT_SECRET: "s",
    OWNER_GOOGLE_SUB: OWNER,
  } as NodeJS.ProcessEnv);
  db = await createDb({});
  await migrate(db);
  const built = createApp({ cfg, db, idp, now: () => clock });
  app = built.app;
  cookie = `kanban_session=${(await built.sessions.create(OWNER, "a@b.c")).token}`;
});
afterEach(() => db.close());

type M = "get" | "post" | "patch" | "delete";
const api = (m: M, url: string) => request(app)[m](url).set("Cookie", cookie);
const project = async (name = "Portfólio") => (await api("post", "/api/projects").send({ name })).body.id as string;
const card = async (pid: string, body: object) => {
  const r = await api("post", `/api/projects/${pid}/cards`).send(body);
  expect(r.status).toBe(201);
  return r.body as { id: string; column: string; position: number; completedAt: string | null; overdue: boolean };
};
const board = async (pid: string) =>
  (await api("get", `/api/projects/${pid}/cards`)).body as { id: string; title: string; column: string; position: number; completedAt: string | null; overdue: boolean }[];
const titles = async (pid: string, col: string) => (await board(pid)).filter((c) => c.column === col).map((c) => `${c.title}:${c.position}`);

describe("RF-03 cartões", () => {
  it("K1: cria em Ideias por padrão, sem prazo", async () => {
    const pid = await project();
    const c = await card(pid, { title: "  Publicar página de contato " });
    expect(c).toMatchObject({ title: "Publicar página de contato", column: "ideas", position: 0, deadline: null, completedAt: null });
  });

  it("K2: valida título, prazo e coluna", async () => {
    const pid = await project();
    for (const body of [{}, { title: "   " }, { title: "x", deadline: "2026-02-30" }, { title: "x", deadline: "12/12/2026" }, { title: "x", column: "nope" }]) {
      expect((await api("post", `/api/projects/${pid}/cards`).send(body)).status).toBe(400);
    }
    expect(await board(pid)).toHaveLength(0);
  });

  it("K3: cadastra entrega anterior direto em Concluído", async () => {
    const c = await card(await project(), { title: "Feito", column: "done" });
    expect(c.completedAt).not.toBeNull();
  });

  it("edita título, descrição e prazo; deadline null limpa", async () => {
    const pid = await project();
    const c = await card(pid, { title: "A", deadline: "2026-12-20" });
    const r = await api("patch", `/api/cards/${c.id}`).send({ title: "B", description: "d", deadline: null });
    expect(r.body).toMatchObject({ title: "B", description: "d", deadline: null });
    expect((await api("patch", `/api/cards/${c.id}`).send({ title: " " })).status).toBe(400);
    expect((await api("patch", `/api/cards/${c.id}`).send({})).status).toBe(400);
  });

  it("K11: exclui, recompacta posições e depois 404", async () => {
    const pid = await project();
    const [a, b, c] = [await card(pid, { title: "a" }), await card(pid, { title: "b" }), await card(pid, { title: "c" })];
    expect((await api("delete", `/api/cards/${b.id}`)).status).toBe(204);
    expect(await titles(pid, "ideas")).toEqual(["a:0", "c:1"]);
    expect((await api("delete", `/api/cards/${b.id}`)).status).toBe(404);
    expect(a && c).toBeTruthy();
  });
});

describe("RF-04 quadro", () => {
  it("K4: reordena dentro da coluna e persiste", async () => {
    const pid = await project();
    await card(pid, { title: "1" });
    await card(pid, { title: "2" });
    const c3 = await card(pid, { title: "3" });
    expect((await api("patch", `/api/cards/${c3.id}`).send({ position: 0 })).status).toBe(200);
    expect(await titles(pid, "ideas")).toEqual(["3:0", "1:1", "2:2"]);
    expect(await titles(pid, "ideas")).toEqual(["3:0", "1:1", "2:2"]); // novo GET
  });

  it("K5: muda de coluna (ao final ou em posição) e recompacta a origem", async () => {
    const pid = await project();
    const a = await card(pid, { title: "a" });
    await card(pid, { title: "b" });
    await card(pid, { title: "x", column: "todo" });
    await card(pid, { title: "y", column: "todo" });
    await api("patch", `/api/cards/${a.id}`).send({ column: "todo" });
    expect(await titles(pid, "todo")).toEqual(["x:0", "y:1", "a:2"]);
    expect(await titles(pid, "ideas")).toEqual(["b:0"]);
    await api("patch", `/api/cards/${a.id}`).send({ column: "doing", position: 0 });
    expect(await titles(pid, "doing")).toEqual(["a:0"]);
    expect(await titles(pid, "todo")).toEqual(["x:0", "y:1"]);
  });

  it("K6: conclusão registra data, reordenar mantém, reabrir limpa", async () => {
    const pid = await project();
    const a = await card(pid, { title: "a", column: "doing" });
    const done = (await api("patch", `/api/cards/${a.id}`).send({ column: "done" })).body;
    expect(done.completedAt).not.toBeNull();
    await card(pid, { title: "b", column: "done" });
    clock = new Date("2026-12-13T15:00:00Z");
    const re = (await api("patch", `/api/cards/${a.id}`).send({ position: 1 })).body;
    expect(re.completedAt).toBe(done.completedAt);
    const reopened = (await api("patch", `/api/cards/${a.id}`).send({ column: "doing" })).body;
    expect(reopened).toMatchObject({ column: "doing", completedAt: null });
  });

  it("K7: posição fora do intervalo → 400 e nada muda", async () => {
    const pid = await project();
    const a = await card(pid, { title: "a" });
    await card(pid, { title: "b" });
    expect((await api("patch", `/api/cards/${a.id}`).send({ position: 2 })).status).toBe(400);
    expect((await api("patch", `/api/cards/${a.id}`).send({ column: "todo", position: 1 })).status).toBe(400);
    expect((await api("patch", `/api/cards/${a.id}`).send({ position: -1 })).status).toBe(400);
    expect(await titles(pid, "ideas")).toEqual(["a:0", "b:1"]);
  });

  it("movimentos concorrentes deixam posições densas", async () => {
    const pid = await project();
    for (let i = 1; i <= 4; i++) await card(pid, { title: String(i) });
    const all = await board(pid);
    const rs = await Promise.all(all.map((c, i) => api("patch", `/api/cards/${c.id}`).send({ column: i % 2 ? "todo" : "doing" })));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const after = await board(pid);
    for (const col of ["todo", "doing"]) {
      expect(after.filter((c) => c.column === col).map((c) => c.position).sort((a, b) => a - b)).toEqual([0, 1]);
    }
  });
});

describe("RF-05 prazos", () => {
  it("K8: vencido só para tarefa aberta, respeitando o fuso", async () => {
    const pid = await project();
    const ontem = await card(pid, { title: "ontem", deadline: "2026-12-11" });
    const hoje = await card(pid, { title: "hoje", deadline: "2026-12-12" });
    const sem = await card(pid, { title: "sem prazo" });
    const feito = await card(pid, { title: "feito", deadline: "2026-12-01", column: "done" });
    const flags = async () => Object.fromEntries((await board(pid)).map((c) => [c.title, c.overdue]));
    expect(await flags()).toEqual({ ontem: true, hoje: false, "sem prazo": false, feito: false });
    // 12/12 02:00 UTC ainda é 11/12 em São Paulo: "ontem" (11/12) passa a ser hoje
    clock = new Date("2026-12-12T02:00:00Z");
    expect((await flags()).ontem).toBe(false);
    // reabrir cartão com prazo antigo volta a destacar
    await api("patch", `/api/cards/${feito.id}`).send({ column: "todo" });
    expect((await flags()).feito).toBe(true);
    expect([ontem, hoje, sem].length).toBe(3);
  });
});

describe("integridade", () => {
  it("K9: arquivar bloqueia escritas, leitura segue e restaurar preserva tudo", async () => {
    const pid = await project();
    await card(pid, { title: "a" });
    const b = await card(pid, { title: "b", column: "done" });
    const before = await board(pid);
    await api("patch", `/api/projects/${pid}`).send({ archived: true });
    expect(await board(pid)).toEqual(before);
    expect((await api("post", `/api/projects/${pid}/cards`).send({ title: "n" })).status).toBe(409);
    expect((await api("patch", `/api/cards/${b.id}`).send({ column: "todo" })).status).toBe(409);
    expect((await api("delete", `/api/cards/${b.id}`)).status).toBe(409);
    await api("patch", `/api/projects/${pid}`).send({ archived: false });
    expect(await board(pid)).toEqual(before);
    expect((await api("patch", `/api/cards/${b.id}`).send({ title: "b2" })).status).toBe(200);
  });

  it("K10: isolamento entre projetos e proprietários", async () => {
    const p1 = await project("Portfólio");
    const p2 = await project("Curso de React");
    await card(p1, { title: "só no primeiro" });
    expect(await board(p2)).toEqual([]);
    expect(await board(p1)).toHaveLength(1);

    const [other] = await db.query<{ id: string }>("INSERT INTO projects (owner_sub, name) VALUES ('outro','X') RETURNING id");
    const [oc] = await db.query<{ id: string }>("INSERT INTO cards (project_id, title, position) VALUES ($1,'alheio',0) RETURNING id", [other!.id]);
    expect((await api("get", `/api/projects/${other!.id}/cards`)).status).toBe(404);
    expect((await api("post", `/api/projects/${other!.id}/cards`).send({ title: "x" })).status).toBe(404);
    expect((await api("patch", `/api/cards/${oc!.id}`).send({ title: "x" })).status).toBe(404);
    expect((await api("delete", `/api/cards/${oc!.id}`)).status).toBe(404);
    expect((await api("get", "/api/projects/nao-uuid/cards")).status).toBe(404);
    expect((await api("patch", "/api/cards/nao-uuid").send({ title: "x" })).status).toBe(404);
  });

  it("K12: sem sessão → 401", async () => {
    const pid = await project();
    expect((await request(app).get(`/api/projects/${pid}/cards`)).status).toBe(401);
    expect((await request(app).post(`/api/projects/${pid}/cards`).send({ title: "x" })).status).toBe(401);
    expect((await request(app).patch("/api/cards/abc").send({ title: "x" })).status).toBe(401);
    expect((await request(app).delete("/api/cards/abc")).status).toBe(401);
  });
});
