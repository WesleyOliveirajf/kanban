import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { loadConfig, type Config } from "../src/config.js";
import { createDb, type Db } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";
import type { IdentityProvider } from "../src/auth/identity.js";

const OWNER = "owner-sub-123";
let db: Db;
let cfg: Config;
let app: ReturnType<typeof createApp>["app"];
let cookie: string;

const idp: IdentityProvider = {
  start: async () => ({ url: "x", checks: { state: "s", nonce: "n", codeVerifier: "v" } }),
  finish: async () => ({ sub: OWNER, email: "a@b.c" }),
};

beforeEach(async () => {
  cfg = loadConfig({
    NODE_ENV: "test",
    BASE_URL: "http://localhost:3000",
    SESSION_SECRET: "x".repeat(40),
    GOOGLE_CLIENT_ID: "i",
    GOOGLE_CLIENT_SECRET: "s",
    OWNER_GOOGLE_SUB: OWNER,
  } as NodeJS.ProcessEnv);
  db = await createDb({});
  await migrate(db);
  const built = createApp({ cfg, db, idp });
  app = built.app;
  cookie = `kanban_session=${(await built.sessions.create(OWNER, "a@b.c")).token}`;
});
afterEach(() => db.close());

const api = (m: "get" | "post" | "patch", url: string) => request(app)[m](url).set("Cookie", cookie);
const create = async (name: string, description?: string) => (await api("post", "/api/projects").send({ name, description })).body;

describe("RF-02 projetos", () => {
  it("P1: cria projeto ativo", async () => {
    const res = await api("post", "/api/projects").send({ name: "  Portfólio  ", description: "meu site" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Portfólio", description: "meu site", archivedAt: null });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("P2: valida nome (vazio, só espaços, longo) e descrição vazia vira null", async () => {
    for (const name of [undefined, "", "   ", "a".repeat(121)]) {
      expect((await api("post", "/api/projects").send({ name })).status).toBe(400);
    }
    const ok = await api("post", "/api/projects").send({ name: "X", description: "   " });
    expect(ok.status).toBe(201);
    expect(ok.body.description).toBeNull();
  });

  it("P3: lista projetos independentes e persiste", async () => {
    await create("Portfólio");
    await create("Curso de React");
    const list = (await api("get", "/api/projects")).body;
    expect(list.map((p: { name: string }) => p.name)).toEqual(["Portfólio", "Curso de React"]);
    expect(list[0].id).not.toBe(list[1].id);
  });

  it("P4: edita nome e descrição", async () => {
    const p = await create("Antigo", "d");
    await new Promise((r) => setTimeout(r, 5));
    const res = await api("patch", `/api/projects/${p.id}`).send({ name: "Novo", description: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Novo", description: null });
    expect(res.body.updatedAt > p.updatedAt).toBe(true);
    expect((await api("patch", `/api/projects/${p.id}`).send({ name: "  " })).status).toBe(400);
    expect((await api("patch", `/api/projects/${p.id}`).send({})).status).toBe(400);
  });

  it("P5/P6/P7: arquivar mantém na lista, bloqueia edição e restaurar libera", async () => {
    const p = await create("Portfólio", "d");
    const arch = await api("patch", `/api/projects/${p.id}`).send({ archived: true });
    expect(arch.status).toBe(200);
    expect(arch.body.archivedAt).not.toBeNull();
    expect((await api("get", "/api/projects")).body).toHaveLength(1);

    const blocked = await api("patch", `/api/projects/${p.id}`).send({ name: "x" });
    expect(blocked.status).toBe(409);
    expect((await api("get", "/api/projects")).body[0].name).toBe("Portfólio");
    // arquivar de novo é idempotente e preserva a data
    const again = await api("patch", `/api/projects/${p.id}`).send({ archived: true });
    expect(again.body.archivedAt).toBe(arch.body.archivedAt);

    const rest = await api("patch", `/api/projects/${p.id}`).send({ archived: false });
    expect(rest.body).toMatchObject({ archivedAt: null, name: "Portfólio", description: "d" });
    expect((await api("patch", `/api/projects/${p.id}`).send({ name: "Editado" })).body.name).toBe("Editado");
    // restaurar e editar juntos
    await api("patch", `/api/projects/${p.id}`).send({ archived: true });
    const both = await api("patch", `/api/projects/${p.id}`).send({ archived: false, name: "Combo" });
    expect(both.body).toMatchObject({ name: "Combo", archivedAt: null });
  });

  it("P8: projeto de outro proprietário, inexistente ou id malformado → 404", async () => {
    const [other] = await db.query<{ id: string }>("INSERT INTO projects (owner_sub, name) VALUES ('outro','Segredo') RETURNING id");
    await create("Meu");
    const list = (await api("get", "/api/projects")).body;
    expect(list.map((p: { name: string }) => p.name)).toEqual(["Meu"]);
    for (const id of [other!.id, "00000000-0000-0000-0000-000000000000", "nao-e-uuid"]) {
      expect((await api("patch", `/api/projects/${id}`).send({ name: "x" })).status).toBe(404);
    }
    expect((await db.query<{ name: string }>("SELECT name FROM projects WHERE id = $1", [other!.id]))[0]!.name).toBe("Segredo");
  });

  it("P9: sem sessão → 401", async () => {
    expect((await request(app).get("/api/projects")).status).toBe(401);
    expect((await request(app).post("/api/projects").send({ name: "x" })).status).toBe(401);
    expect((await request(app).patch("/api/projects/abc").send({ name: "x" })).status).toBe(401);
  });

  it("P10/P12: grava, devolve e limpa o link do repositório", async () => {
    const url = "https://github.com/usuario/repo";
    const p = (await api("post", "/api/projects").send({ name: "Com repo", repositoryUrl: `  ${url} ` })).body;
    expect(p.repositoryUrl).toBe(url);
    expect((await api("get", "/api/projects")).body[0].repositoryUrl).toBe(url);
    expect((await create("Sem repo")).repositoryUrl).toBeNull();
    for (const empty of ["", "   ", null]) {
      await api("patch", `/api/projects/${p.id}`).send({ repositoryUrl: url });
      const r = await api("patch", `/api/projects/${p.id}`).send({ repositoryUrl: empty });
      expect(r.status).toBe(200);
      expect(r.body.repositoryUrl).toBeNull();
    }
    const kept = await api("patch", `/api/projects/${p.id}`).send({ name: "Renomeado" });
    expect(kept.body.name).toBe("Renomeado");
  });

  it("P11: rejeita endereços que não são http(s)", async () => {
    for (const bad of ["javascript:alert(1)", "ftp://x.com/r", "abc", "data:text/html,x", `https://x.com/${"a".repeat(500)}`]) {
      expect((await api("post", "/api/projects").send({ name: "x", repositoryUrl: bad })).status).toBe(400);
    }
    const p = await create("ok");
    expect((await api("patch", `/api/projects/${p.id}`).send({ repositoryUrl: "javascript:1" })).status).toBe(400);
  });

  it("P13: projeto arquivado não aceita mudar o link; restaurar libera", async () => {
    const p = await create("Arq");
    await api("patch", `/api/projects/${p.id}`).send({ archived: true });
    expect((await api("patch", `/api/projects/${p.id}`).send({ repositoryUrl: "https://gitlab.com/a/b" })).status).toBe(409);
    const r = await api("patch", `/api/projects/${p.id}`).send({ archived: false, repositoryUrl: "https://gitlab.com/a/b" });
    expect(r.body.repositoryUrl).toBe("https://gitlab.com/a/b");
  });
});
