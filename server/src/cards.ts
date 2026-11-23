import { Router } from "express";
import { z } from "zod";
import type { Db, Queryable } from "./db/index.js";

export const COLUMNS = ["ideas", "todo", "doing", "done"] as const;
type Column = (typeof COLUMNS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const description = z
  .string()
  .max(5000)
  .nullable()
  .optional()
  .transform((v) => (v == null || v.trim() === "" ? null : v));
const deadline = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "data inválida")
  .nullable()
  .optional();
const title = z.string().trim().min(1).max(200);
const column = z.enum(COLUMNS);

const createSchema = z.object({ title, description, deadline, column: column.default("ideas") });
const patchSchema = z
  .object({ title, description, deadline, column, position: z.number().int().min(0) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "nada para alterar");

interface Row {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: Column;
  position: number;
  deadline: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}
const COLS = `id, project_id, title, description, status, position, to_char(deadline,'YYYY-MM-DD') AS deadline, completed_at, created_at, updated_at`;
const iso = (d: Date | string) => new Date(d).toISOString();

/** Data civil de hoje no fuso configurado (YYYY-MM-DD). */
export function todayIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function cardRoutes(db: Db, tz: string, now: () => Date) {
  const r = Router();

  const toJson = (c: Row, today: string) => ({
    id: c.id,
    projectId: c.project_id,
    title: c.title,
    description: c.description,
    column: c.status,
    position: c.position,
    deadline: c.deadline,
    completedAt: c.completed_at ? iso(c.completed_at) : null,
    overdue: c.status !== "done" && c.deadline !== null && c.deadline < today,
    createdAt: iso(c.created_at),
    updatedAt: iso(c.updated_at),
  });

  /** Trava o projeto (serializa movimentos). */
  async function lockProject(q: Queryable, projectId: string, owner: string) {
    const [p] = await q.query<{ archived_at: unknown }>(
      "SELECT archived_at FROM projects WHERE id = $1 AND owner_sub = $2 FOR UPDATE",
      [projectId, owner],
    );
    return p ? { archived: p.archived_at !== null } : null;
  }

  async function renumber(q: Queryable, ids: string[]) {
    for (const [i, id] of ids.entries()) await q.query("UPDATE cards SET position = $2 WHERE id = $1 AND position <> $2", [id, i]);
  }

  const idsOf = async (q: Queryable, projectId: string, status: Column, except?: string) =>
    (
      await q.query<{ id: string }>(
        "SELECT id FROM cards WHERE project_id = $1 AND status = $2 AND ($3::uuid IS NULL OR id <> $3) ORDER BY position, id",
        [projectId, status, except ?? null],
      )
    ).map((x) => x.id);

  r.get("/projects/:projectId/cards", async (req, res) => {
    const pid = String(req.params.projectId);
    if (!UUID.test(pid)) return void res.status(404).json({ error: "not_found" });
    const [p] = await db.query("SELECT 1 FROM projects WHERE id = $1 AND owner_sub = $2", [pid, req.session!.ownerSub]);
    if (!p) return void res.status(404).json({ error: "not_found" });
    const rows = await db.query<Row>(
      `SELECT ${COLS} FROM cards WHERE project_id = $1 ORDER BY array_position(ARRAY['ideas','todo','doing','done'], status), position, id`,
      [pid],
    );
    const today = todayIn(tz, now());
    res.json(rows.map((c) => toJson(c, today)));
  });

  r.post("/projects/:projectId/cards", async (req, res) => {
    const pid = String(req.params.projectId);
    const p = createSchema.safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: "validation", issues: p.error.issues });
    if (!UUID.test(pid)) return void res.status(404).json({ error: "not_found" });

    const out = await db.tx(async (q) => {
      const proj = await lockProject(q, pid, req.session!.ownerSub);
      if (!proj) return { status: 404 as const };
      if (proj.archived) return { status: 409 as const };
      const [{ n } = { n: 0 }] = await q.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM cards WHERE project_id = $1 AND status = $2",
        [pid, p.data.column],
      );
      const [row] = await q.query<Row>(
        `INSERT INTO cards (project_id, title, description, status, position, deadline, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $4 = 'done' THEN now() END) RETURNING ${COLS}`,
        [pid, p.data.title, p.data.description, p.data.column, n, p.data.deadline ?? null],
      );
      return { status: 201 as const, row: row! };
    });
    if (out.status === 404) return void res.status(404).json({ error: "not_found" });
    if (out.status === 409) return void res.status(409).json({ error: "project_archived" });
    res.status(201).json(toJson(out.row, todayIn(tz, now())));
  });

  /** Localiza o projeto do cartão respeitando o proprietário. */
  async function projectOfCard(id: string, owner: string) {
    if (!UUID.test(id)) return null;
    const [row] = await db.query<{ project_id: string }>(
      "SELECT c.project_id FROM cards c JOIN projects p ON p.id = c.project_id WHERE c.id = $1 AND p.owner_sub = $2",
      [id, owner],
    );
    return row?.project_id ?? null;
  }

  r.patch("/cards/:id", async (req, res) => {
    const id = String(req.params.id);
    const p = patchSchema.safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: "validation", issues: p.error.issues });
    const owner = req.session!.ownerSub;
    const pid = await projectOfCard(id, owner);
    if (!pid) return void res.status(404).json({ error: "not_found" });
    const d = p.data;

    const out = await db.tx(async (q) => {
      const proj = await lockProject(q, pid, owner);
      if (!proj) return { status: 404 as const };
      if (proj.archived) return { status: 409 as const };
      const [cur] = await q.query<Row>(`SELECT ${COLS} FROM cards WHERE id = $1 AND project_id = $2`, [id, pid]);
      if (!cur) return { status: 404 as const };

      const target = d.column ?? cur.status;
      if (d.column !== undefined || d.position !== undefined) {
        const dest = await idsOf(q, pid, target, id);
        const idx = d.position ?? (target !== cur.status ? dest.length : cur.position);
        if (idx > dest.length) return { status: 400 as const };
        dest.splice(idx, 0, id);
        if (target !== cur.status) await renumber(q, await idsOf(q, pid, cur.status, id));
        await renumber(q, dest);
      }

      const [row] = await q.query<Row>(
        `UPDATE cards SET
           title = $2, description = $3, deadline = $4, status = $5,
           completed_at = CASE WHEN $5 <> 'done' THEN NULL WHEN completed_at IS NULL THEN now() ELSE completed_at END,
           updated_at = now()
         WHERE id = $1 RETURNING ${COLS}`,
        [
          id,
          d.title ?? cur.title,
          d.description !== undefined ? d.description : cur.description,
          d.deadline !== undefined ? d.deadline : cur.deadline,
          target,
        ],
      );
      return { status: 200 as const, row: row! };
    });
    if (out.status === 404) return void res.status(404).json({ error: "not_found" });
    if (out.status === 409) return void res.status(409).json({ error: "project_archived" });
    if (out.status === 400) return void res.status(400).json({ error: "invalid_position" });
    res.json(toJson(out.row, todayIn(tz, now())));
  });

  r.delete("/cards/:id", async (req, res) => {
    const id = String(req.params.id);
    const owner = req.session!.ownerSub;
    const pid = await projectOfCard(id, owner);
    if (!pid) return void res.status(404).json({ error: "not_found" });

    const status = await db.tx(async (q) => {
      const proj = await lockProject(q, pid, owner);
      if (!proj) return 404;
      if (proj.archived) return 409;
      const [cur] = await q.query<Row>(`SELECT ${COLS} FROM cards WHERE id = $1`, [id]);
      if (!cur) return 404;
      await q.query("DELETE FROM cards WHERE id = $1", [id]);
      await renumber(q, await idsOf(q, pid, cur.status));
      return 204;
    });
    if (status === 409) return void res.status(409).json({ error: "project_archived" });
    res.status(status).end();
  });

  return r;
}
