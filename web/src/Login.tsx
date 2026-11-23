import { useEffect, useState, type FormEvent } from "react";
import { GoogleG, Logo } from "./icons";

interface Methods {
  password: boolean;
  google: boolean;
}

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [methods, setMethods] = useState<Methods>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch("/api/auth/methods")
      .then((r) => r.json() as Promise<Methods>)
      .then(setMethods, () => setMethods({ password: true, google: false }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) return onLoggedIn();
      setError(
        res.status === 401
          ? "Senha incorreta."
          : res.status === 429
            ? "Muitas tentativas. Aguarde alguns minutos e tente de novo."
            : "Não foi possível entrar. Tente novamente.",
      );
    } catch {
      setError("Não foi possível falar com o servidor.");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <main className="center">
      <div className="login-card">
        <Logo size={48} />
        <h1>Kanban pessoal</h1>
        <p>Suas ideias, pendências e entregas em um quadro por projeto. Acesso privado.</p>
        {!methods ? (
          <div className="spinner" role="status" aria-label="Carregando" />
        ) : (
          <>
            {methods.password && (
              <form className="form" onSubmit={submit} style={{ width: "100%", textAlign: "left" }}>
                <label>
                  Senha
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
                </label>
                {error && <p role="alert" className="error">{error}</p>}
                <button type="submit" className="primary" disabled={busy || !password} style={{ minHeight: 44 }}>
                  {busy ? "Entrando…" : "Entrar"}
                </button>
              </form>
            )}
            {methods.google && (
              <a className="btn" href="/api/auth/google">
                <GoogleG /> Entrar com Google
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}
