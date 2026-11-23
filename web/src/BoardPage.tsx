import { useEffect, useState } from "react";
import { api, type Project } from "./api";
import { Board } from "./Board";
import { IconChevron, IconExternal } from "./icons";

export function BoardPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setProject(undefined);
    setFailed(false);
    api.listProjects().then(
      (list) => setProject(list.find((p) => p.id === projectId) ?? null),
      () => setFailed(true),
    );
  }, [projectId]);

  return (
    <div>
      <nav className="crumbs" aria-label="Navegação">
        <a href="#/">Projetos</a>
        <IconChevron />
        <span>{project?.name ?? "…"}</span>
      </nav>
      {failed ? (
        <p role="alert" className="error">Não foi possível carregar o projeto.</p>
      ) : project === undefined ? (
        <div className="loading"><div className="spinner" /> Carregando…</div>
      ) : project === null ? (
        <div className="empty"><strong>Projeto não encontrado</strong><a href="#/">Voltar para os projetos</a></div>
      ) : (
        <>
          <div className="page-head">
            <div>
              <h1>
                {project.name} {project.archivedAt && <span className="badge">Arquivado</span>}
              </h1>
              {project.description && <p>{project.description}</p>}
            </div>
            {project.repositoryUrl && (
              <a className="btn" href={project.repositoryUrl} target="_blank" rel="noopener noreferrer" title={project.repositoryUrl}>
                <IconExternal /> Repositório
              </a>
            )}
          </div>
          <Board key={project.id} project={project} />
        </>
      )}
    </div>
  );
}
