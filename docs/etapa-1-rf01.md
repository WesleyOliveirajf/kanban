# Etapa 1 · Base e acesso privado (RF-01)

## 1. Requisito e aceite (da especificação)

**RF-01 · Acesso privado.** Entrar com a conta Google autorizada. O servidor valida a sessão e o proprietário em todas as operações.

**Aceite.**
- A1. Sem sessão, a API rejeita o acesso (401).
- A2. Outra conta Google também é impedida de abrir dados ou alterar cartões por URL direta (403 no login; sessão nunca é criada; mesmo uma sessão antiga de outra conta é rejeitada).
- A3. Entregar uma sessão funcional para a conta do proprietário.

### Cenários verificáveis
| # | Dado | Quando | Então |
|---|------|--------|-------|
| C1 | sem cookie | `GET /api/me` | 401 |
| C2 | sem cookie | `GET /api/projects` (rota protegida de exemplo) | 401 |
| C3 | login com a conta do proprietário | callback OIDC | 302 para `/`, cookie de sessão `HttpOnly; SameSite=Lax` (+`Secure` em produção) |
| C4 | sessão do proprietário | `GET /api/me` | 200 com e-mail |
| C5 | login com outra conta Google | callback OIDC | 403, nenhuma sessão criada |
| C6 | sessão gravada para outra conta (ex.: proprietário foi trocado na configuração) | qualquer rota protegida | 401 e a sessão é descartada |
| C7 | `state` inválido ou ausente no callback | callback | 400, nenhuma sessão |
| C8 | sessão do proprietário | `POST /api/auth/logout` | sessão apagada; `GET /api/me` → 401 |
| C9 | sessão expirada | `GET /api/me` | 401 |
| C10 | `POST` com cabeçalho `Origin` de outro site | qualquer escrita autenticada | 403 (proteção CSRF) |

## 2. Plano técnico

- **Monorepo npm workspaces**: `server/` (Node + TypeScript + Express 5) e `web/` (React + TypeScript + Vite). Em produção o servidor serve `web/dist` e a API sob o mesmo domínio (`/api`).
- **Banco**: interface `Db` (`query`, `exec`, `tx`) com duas implementações: `pg` (produção, `DATABASE_URL`) e PGlite (dev/testes, em memória ou em `PGLITE_DIR`). Migrações SQL numeradas em `server/migrations`, aplicadas em transação e registradas em `schema_migrations`.
- **Login**: OpenID Connect com `openid-client` (Authorization Code + PKCE + `state` + `nonce`), escopos `openid email`. `state`/`nonce`/`code_verifier` ficam em cookie curto assinado (HMAC) e `HttpOnly`. A identidade usa o `sub` do Google.
- **Proprietário**: `OWNER_GOOGLE_SUB` no ambiente. Comparado no callback **e** em toda requisição protegida.
- **Sessão**: token aleatório de 256 bits no cookie; no banco fica só o hash SHA-256 (`sessions`). Expira em 30 dias. Logout apaga a linha.
- **Middleware `requireOwner`**: lê cookie → busca sessão não expirada → confere `owner_sub === config.ownerSub` → senão 401. Aplicado a todo `/api` exceto `/api/auth/*` e `/api/health`.
- **CSRF**: cookie `SameSite=Lax` + verificação de `Origin` em métodos não seguros.
- **Testabilidade**: o provedor de identidade é uma interface (`IdentityProvider`); testes injetam um provedor falso que devolve `sub` arbitrário, sem rede.
- **Segredos** só no ambiente (`.env` fora do git). Produção exige `SESSION_SECRET` forte, `BASE_URL` https e cookies `Secure`.

## 3. Tarefas
1. [x] Estrutura do monorepo, TypeScript, scripts.
2. [x] Camada de banco + migração 001 (`sessions`).
3. [x] Config validada com zod.
4. [x] Sessões (criar, validar, apagar) e cookie assinado.
5. [x] `IdentityProvider` (Google OIDC) + rotas `/api/auth/login|callback|logout`.
6. [x] `requireOwner`, `/api/me`, `/api/health` e rota protegida de exemplo.
7. [x] Testes C1–C10.
8. [x] Interface mínima: tela de entrada e área autenticada.
9. [ ] Verificação manual com credenciais Google reais (depende do console Google Cloud do proprietário).

---

## Revisão (2026-11-23): senha única do proprietário

**Decisão do proprietário:** não é necessário entrar com o Google agora. O acesso privado passa a usar **uma senha única do proprietário**; o login Google continua no código como método opcional, ativo só se `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `OWNER_GOOGLE_SUB` estiverem definidos. (A integração com o Google Agenda, etapa 4, segue adiada e é independente do login.)

**RF-01 revisado.** Entrar com a senha do proprietário (ou, se configurado, com a conta Google autorizada). O servidor valida a sessão e o proprietário em todas as operações. Sem sessão, a API rejeita o acesso.

| # | Cenário | Resultado |
|---|---------|-----------|
| S1 | `POST /api/auth/login` com senha correta | 204 + cookie de sessão `HttpOnly; SameSite=Lax` (`Secure` em https) |
| S2 | senha errada / ausente | 401, sem sessão |
| S3 | 5 falhas seguidas do mesmo IP em 15 min | 429 `Retry-After`; senha correta também bloqueada até expirar |
| S4 | login correto zera o contador de falhas | — |
| S5 | `GET /api/auth/methods` | `{password, google}` (público) |
| S6 | sem `OWNER_PASSWORD_HASH` e sem Google completo | servidor recusa subir; Google parcial também |
| S7 | rotas protegidas, logout, expiração, CSRF | inalterados (C1, C4, C8–C10) |

**Plano.** Hash `scrypt` (N=16384, r=8, p=1, sal de 16 bytes) em `OWNER_PASSWORD_HASH`, gerado por `npm run hash-password` (lê a senha de stdin; mínimo de 6 caracteres; avisa se for curta ou só numérica). Comparação em tempo constante. A rota do Google passa a ser `GET /api/auth/google`; o login por senha é `POST /api/auth/login`. O proprietário da sessão é `OWNER_GOOGLE_SUB` se existir, senão `"owner"`.
