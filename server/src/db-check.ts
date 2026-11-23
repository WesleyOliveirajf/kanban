// Testa a conexão com o Postgres definido em DATABASE_URL, sem imprimir a senha. Não altera nada.
import { createDb } from "./db/index.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não está definido (coloque no .env).");
  process.exit(1);
}
let where = "?";
try {
  const u = new URL(url);
  where = `${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)} (usuário ${decodeURIComponent(u.username)}, ssl=${u.searchParams.get("sslmode") ?? "padrão"})`;
} catch {
  console.error("DATABASE_URL não é uma URL válida. Formato: postgresql://usuario:senha@host:5432/banco (caracteres especiais na senha precisam de %-encoding).");
  process.exit(1);
}
console.log("Conectando em", where);
const db = createDb({ databaseUrl: url });
try {
  const [v] = await db.query<{ v: string }>("SELECT version() AS v");
  console.log("OK:", v?.v);
  const t = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
  console.log("Tabelas no schema public:", t.length ? t.map((r) => r.table_name).join(", ") : "(nenhuma — as migrações criarão ao subir o app)");
} catch (e) {
  const err = e as { code?: string; message: string };
  console.error("FALHOU:", err.code ?? "", err.message);
  const hint: Record<string, string> = {
    ECONNREFUSED: "Porta fechada ou host errado. Libere o acesso remoto/porta 5432 no painel da Hostinger.",
    ETIMEDOUT: "Sem resposta: firewall bloqueando o seu IP. Autorize o seu IP no acesso remoto do banco.",
    ENOTFOUND: "Host não encontrado: confira o endereço.",
    "28P01": "Usuário ou senha incorretos.",
    "3D000": "O banco informado não existe.",
  };
  if (err.code && hint[err.code]) console.error("Dica:", hint[err.code]);
  if (/SSL|TLS/i.test(err.message)) console.error("Dica: tente acrescentar ?sslmode=require (ou sslmode=disable se o servidor não usa SSL) à URL.");
  process.exitCode = 1;
} finally {
  await db.close();
}
