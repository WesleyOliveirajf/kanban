import { useCallback, useEffect, useState } from "react";
import { Projects } from "./Projects";
import { BoardPage } from "./BoardPage";
import { IconLogout, Logo } from "./icons";
import { Login } from "./Login";

type State = { status: "loading" } | { status: "anon" } | { status: "ok"; email: string } | { status: "error" };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const boardId = /^#\/p\/([0-9a-f-]{36})$/i.exec(hash)?.[1];

  const loadMe = useCallback(() => {
    fetch("/api/me")
      .then(async (r) => {
        if (r.status === 401) return setState({ status: "anon" });
        if (!r.ok) throw new Error(String(r.status));
        setState({ status: "ok", email: ((await r.json()) as { email: string }).email });
      })
      .catch(() => setState({ status: "error" }));
  }, []);
  useEffect(loadMe, [loadMe]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setState({ status: "anon" });
  }

  if (state.status === "loading")
    return (
      <main className="center">
        <div className="spinner" role="status" aria-label="Carregando" />
      </main>
    );
  if (state.status === "error")
    return (
      <main className="center">
        <div className="login-card">
          <p role="alert" className="error">Não foi possível falar com o servidor.</p>
          <button className="primary" onClick={() => location.reload()}>Tentar novamente</button>
        </div>
      </main>
    );
  if (state.status === "anon") return <Login onLoggedIn={loadMe} />;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <Logo /> Kanban
          </a>
          <span className="spacer" />
          <div className="user">
            <span className="avatar" aria-hidden>{state.email.charAt(0) || "?"}</span>
            <span className="email">{state.email}</span>
            <button className="ghost" onClick={logout} aria-label="Sair">
              <IconLogout /> <span>Sair</span>
            </button>
          </div>
        </div>
      </header>
      <main className="page">{boardId ? <BoardPage projectId={boardId} /> : <Projects />}</main>
    </>
  );
}
