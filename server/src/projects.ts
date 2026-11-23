import { Router } from "express";
import { z } from "zod";
import type { Db } from "./db/index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const description = z
  .string()
  .max(2000)
  .nullable()
  .optional()
  .transform((v) => (v == null || v.trim() === "" ? null : v));

const repositoryUrl = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .refine((v) => {
    if (!v) return true;
    try {
      return ["http:", "https:"].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, "use um endereço http(s)")
  .transform((v) => (v ? v : null));

const createSchema = z.object({ name: z.string().trim().min(1).max(120), description, repositoryUrl });
const patchSchema = z
  .object({ name: z.string().trim().min(1).max(120), description, repositoryUrl, archived: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "nada para alterar");

interface Row {
  id: string;
  name: string;
  description: string | null;
  repository_url: string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}
const iso = (d: Date | string) => new Date(d).toISOString();
const toJson = (r: Row) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  repositoryUrl: r.repository_url,
  archivedAt: r.archived_at ? iso(r.archived_at) : null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const COLS = "id, name, description, repository_url, archived_at, created_at, updated_at";

export function projectRoutes(db: Db) {
  const r = Router();

  r.get("/", async (req, res) => {
    const rows = await db.query<Row>(`SELECT ${COLS} FROM projects WHERE owner_sub = $1 ORDER BY created_at, id`, [
      req.session!.ownerSub,
    ]);
    res.json(rows.map(toJson));
  });

  r.post("/", async (req, res) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: "validation", issues: p.error.issues });
    const [row] = await db.query<Row>(
      `INSERT INTO projects (owner_sub, name, description, repository_url) VALUES ($1,$2,$3,$4) RETURNING ${COLS}`,
      [req.session!.ownerSub, p.data.name, p.data.description, p.data.repositoryUrl ?? null],
    );
    res.status(201).json(toJson(row!));
  });

  r.patch("/:id", async (req, res) => {
    const id = String(req.params.id);
    const p = patchSchema.safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: "validation", issues: p.error.issues });
    if (!UUID.test(id)) return void res.status(404).json({ error: "not_found" });
    const owner = req.session!.ownerSub;

    const out = await db.tx(async (q) => {
      const [cur] = await q.query<Row>(`SELECT ${COLS} FROM projects WHERE id = $1 AND owner_sub = $2 FOR UPDATE`, [id, owner]);
      if (!cur) return { status: 404 as const };
      const willBeArchived = p.data.archived === undefined ? cur.archived_at !== null : p.data.archived;
      const editsData = p.data.name !== undefined || p.data.description !== undefined || p.data.repositoryUrl !== undefined;
      if (willBeArchived && editsData) return { status: 409 as const };

      const name = p.data.name ?? cur.name;
      const desc = p.data.description !== undefined ? p.data.description : cur.description;
      const repo = p.data.repositoryUrl !== undefined ? p.data.repositoryUrl : cur.repository_url;
      const [row] = await q.query<Row>(
        `UPDATE projects SET name = $3, description = $4, repository_url = $6,
           archived_at = CASE WHEN $5::boolean THEN COALESCE(archived_at, now()) ELSE NULL END,
           updated_at = now()
         WHERE id = $1 AND owner_sub = $2 RETURNING ${COLS}`,
        [id, owner, name, desc, willBeArchived, repo],
      );
      return { status: 200 as const, row: row! };
    });

    if (out.status === 404) return void res.status(404).json({ error: "not_found" });
    if (out.status === 409) return void res.status(409).json({ error: "project_archived" });
    res.json(toJson(out.row));
  });

  return r;
}
