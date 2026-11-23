import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Project } from "./api";
import { IconAlert, IconArchive, IconBoard, IconEdit, IconExternal, IconRestore } from "./icons";

const messageFor = (e: unknown) =>
  e instanceof ApiError && e.status === 400
    ? "Confira os dados: o nome é obrigatório (até 120 caracteres) e o repositório precisa ser um endereço http(s)."
    : e instanceof ApiError && e.status === 409
      ? "Projeto arquivado: restaure-o antes de editar."
      : e instanceof ApiError && e.status === 401
        ? "Sessão expirada. Recarregue a página para entrar de novo."
        : "Não foi possível salvar. Tente novamente.";

function ProjectForm(props: {
  initial?: Project;
  submitLabel: string;
  onSubmit: (v: { name: string; description: string; repositoryUrl: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [description, setDescription] = useState(props.initial?.description ?? "");
  const [repositoryUrl, setRepositoryUrl] = useState(props.initial?.repositoryUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Informe o nome do projeto.");
    setBusy(true);
    setError(undefined);
    try {
      await props.onSubmit({ name, description, repositoryUrl });
      if (!props.initial) {
        setName("");
        setDescription("");
        setRepositoryUrl("");
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Nome
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Portfólio" required />
      </label>
      <label>
        <span>Descrição <span className="field-hint">(opcional)</span></span>
        <textarea value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        <span>Repositório <span className="field-hint">(opcional)</span></span>
        <input type="url" value={repositoryUrl} maxLength={500} onChange={(e) => setRepositoryUrl(e.target.value)} placeholder="https://github.com/usuario/repositorio" />
      </label>
      {error && <p role="alert" className="error"><IconAlert /> {error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>{busy ? "Salvando…" : props.submitLabel}</button>
        {props.onCancel && <button type="button" onClick={props.onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}

function ProjectItem({ p, onChange }: { p: Project; onChange: (p: Project) => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const archived = p.archivedAt !== null;

  async function toggleArchive() {
    setError(undefined);
    try {
      onChange(await api.updateProject(p.id, { archived: !archived }));
    } catch (e) {
      setError(messageFor(e));
    }
  }

  if (editing)
    return (
      <li className="pcard">
        <ProjectForm
          initial={p}
          submitLabel="Salvar"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            onChange(await api.updateProject(p.id, { name: v.name, description: v.description || null, repositoryUrl: v.repositoryUrl.trim() || null }));
            setEditing(false);
          }}
        />
      </li>
    );

  return (
    <li className={`pcard${archived ? " archived" : ""}`}>
      <div>
        <h3>
          <a href={`#/p/${p.id}`}>{p.name}</a>
          {archived && <span className="badge">Arquivado</span>}
        </h3>
        {p.description && <p className="desc-p">{p.description}</p>}
      </div>
      {error && <p role="alert" className="error"><IconAlert /> {error}</p>}
      <div className="pcard-foot">
        <span className="row">
          <a className="btn" href={`#/p/${p.id}`}><IconBoard /> Abrir quadro</a>
          {p.repositoryUrl && (
            <a className="btn" href={p.repositoryUrl} target="_blank" rel="noopener noreferrer" title={p.repositoryUrl}>
              <IconExternal /> Repositório
            </a>
          )}
        </span>
        <span className="row">
          {!archived && (
            <button className="ghost icon-btn" onClick={() => setEditing(true)} aria-label={`Editar projeto ${p.name}`} title="Editar">
              <IconEdit />
            </button>
          )}
          <button className="ghost" onClick={toggleArchive}>
            {archived ? <IconRestore /> : <IconArchive />} {archived ? "Restaurar" : "Arquivar"}
          </button>
        </span>
      </div>
    </li>
  );
}

export function Projects() {
  const [projects, setProjects] = useState<Project[]>();
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    api.listProjects().then(setProjects, () => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const replace = (p: Project) => setProjects((cur) => cur?.map((x) => (x.id === p.id ? p : x)));

  const head = (
    <div className="page-head">
      <div>
        <h1>Projetos</h1>
        <p>Cada projeto tem o seu próprio quadro: Ideias, A fazer, Em andamento e Concluído.</p>
      </div>
    </div>
  );

  if (failed)
    return (
      <div>
        {head}
        <p role="alert" className="error"><IconAlert /> Não foi possível carregar os projetos.</p>
        <button onClick={load}>Tentar novamente</button>
      </div>
    );
  if (!projects)
    return (
      <div>
        {head}
        <div className="loading"><div className="spinner" /> Carregando projetos…</div>
      </div>
    );

  const active = projects.filter((p) => !p.archivedAt);
  const archived = projects.filter((p) => p.archivedAt);

  return (
    <div>
      {head}
      <div className="projects-layout">
        <section className="panel" aria-label="Novo projeto">
          <h2>Novo projeto</h2>
          <ProjectForm
            submitLabel="Criar projeto"
            onSubmit={async (v) => {
              const p = await api.createProject({ name: v.name, description: v.description || undefined, repositoryUrl: v.repositoryUrl.trim() || undefined });
              setProjects((cur) => [...(cur ?? []), p]);
            }}
          />
        </section>
        <div>
          <h2 className="section-title">Ativos <span className="count">{active.length}</span></h2>
          {active.length === 0 ? (
            <div className="empty" style={{ marginBottom: 28 }}>
              <strong>Nenhum projeto ativo ainda</strong>
              <span>Crie o primeiro no formulário ao lado.</span>
            </div>
          ) : (
            <ul className="project-grid">{active.map((p) => <ProjectItem key={p.id} p={p} onChange={replace} />)}</ul>
          )}
          {archived.length > 0 && (
            <>
              <h2 className="section-title">Arquivados <span className="count">{archived.length}</span></h2>
              <ul className="project-grid">{archived.map((p) => <ProjectItem key={p.id} p={p} onChange={replace} />)}</ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
