export interface Project {
  id: string;
  name: string;
  description: string | null;
  repositoryUrl: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Column = "ideas" | "todo" | "doing" | "done";
export const COLUMNS: { key: Column; label: string; hint: string }[] = [
  { key: "ideas", label: "Ideias", hint: "a avaliar" },
  { key: "todo", label: "A fazer", hint: "pendente" },
  { key: "doing", label: "Em andamento", hint: "iniciado" },
  { key: "done", label: "Concluído", hint: "entregue" },
];

export interface Card {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  column: Column;
  position: number;
  deadline: string | null;
  completedAt: string | null;
  overdue: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "error";
    throw new ApiError(res.status, code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listProjects: () => call<Project[]>("GET", "/api/projects"),
  createProject: (b: { name: string; description?: string; repositoryUrl?: string }) => call<Project>("POST", "/api/projects", b),
  updateProject: (id: string, b: { name?: string; description?: string | null; repositoryUrl?: string | null; archived?: boolean }) =>
    call<Project>("PATCH", `/api/projects/${id}`, b),
  listCards: (pid: string) => call<Card[]>("GET", `/api/projects/${pid}/cards`),
  createCard: (pid: string, b: { title: string; description?: string; deadline?: string | null; column?: Column }) =>
    call<Card>("POST", `/api/projects/${pid}/cards`, b),
  updateCard: (
    id: string,
    b: { title?: string; description?: string | null; deadline?: string | null; column?: Column; position?: number },
  ) => call<Card>("PATCH", `/api/cards/${id}`, b),
  deleteCard: (id: string) => call<void>("DELETE", `/api/cards/${id}`),
};
