# Kanban pessoal

Aplicação web (React + TypeScript) com API Node + TypeScript e PostgreSQL (Supabase). Especificação por etapas em `docs/`.

## Desenvolvimento
```bash
npm install
cp .env.example .env      # defina OWNER_PASSWORD_HASH e SESSION_SECRET
npm run dev:server        # API em :3000 (PGlite em ./.pglite quando DATABASE_URL está vazio)
npm run dev:web           # interface em :5173 (proxy /api -> :3000)
npm test                  # testes da API
```
Login: senha única do proprietário (`OWNER_PASSWORD_HASH`). O login Google é opcional; se usar em dev, defina `BASE_URL=http://localhost:5173` e registre `http://localhost:5173/api/auth/callback` no console Google Cloud.

## Produção na Vercel
1. Conecte o repositório GitHub `WesleyOliveirajf/kanban` a um projeto Vercel.
2. Variáveis de ambiente (Production + Preview):
   - `DATABASE_URL` — URI do Supabase (preferir **Session pooler**, porta 6543)
   - `SESSION_SECRET` — ≥32 caracteres
   - `OWNER_PASSWORD_HASH` — gerado com `npm run hash-password`
   - `CRON_SECRET` — segredo para o cron horário de purge de sessões
   - `BASE_URL` — opcional; se vazio, usa o domínio da Vercel
3. Deploy: push na `main` ou `vercel --prod`.
4. A UI sai de `public/` (CDN); a API Express é uma Function (`index.ts`).

Teste local do bundle: `npm run build && vercel dev` (com as mesmas env).

## Produção (Docker)
`npm run build && npm start` / `docker build -t kanban .`: exige `BASE_URL` https, `DATABASE_URL`, `SESSION_SECRET` e `OWNER_PASSWORD_HASH`.

## Etapas
- [x] 1. Base e acesso privado (RF-01) — `docs/etapa-1-rf01.md`
- [x] 2. Projetos (RF-02) — `docs/etapa-2-rf02.md`
- [x] 3. Quadro e cartões (RF-03 a RF-05) — `docs/etapa-3-rf03-05.md`
- [ ] 4. Google Agenda (RF-06, RF-07) — **adiada**
- [~] 5. Entrega (produção + backup) — parcial, sem Google Agenda: `docs/etapa-5-entrega.md`
