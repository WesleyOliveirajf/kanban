# Etapa 5 · Entrega (parcial — sem Google Agenda)

A etapa 4 (RF-06/RF-07, Google Agenda) foi **adiada por decisão do proprietário**. O que segue vale para RF-01 a RF-05.

## Matriz de aceite
| Critério | Onde é verificado | Estado |
|---|---|---|
| RF-01 sem sessão → API rejeita; login por senha única (S1–S6) | `server/test/password.test.ts`; Chrome (erro, entrada, recarga, sair) | passa |
| RF-01 login Google (opcional) e outra conta impedida | `server/test/auth.test.ts` (C1–C10, IdP simulado) | passa; login real **não testado** (opcional) |
| RF-02 projetos independentes; arquivar/restaurar preserva dados | `projects.test.ts` P1–P9, `cards.test.ts` K9/K10 | passa |
| RF-03 cartão sem prazo; título só com espaços rejeitado; entregue direto em Concluído | `cards.test.ts` K1–K3 | passa |
| RF-04 mover/reordenar persistem; data de conclusão registrada e limpa | `cards.test.ts` K4–K7; navegador (Chrome) arraste, seletor, recarga | passa |
| RF-05 vencido só em tarefa aberta, no fuso | `cards.test.ts` K8; navegador | passa |
| Validação: separação por projeto, histórico, fluxo no celular | K10, K9, navegador em 390px | passa |
| RF-06/RF-07, "Prazo publicado", "Falha e nova tentativa", "Remoção", "Reconexão" | — | **adiado (etapa 4)** |

## Checklist de produção
1. **Banco**: Postgres gerenciado; `DATABASE_URL` no ambiente. Migrações rodam sozinhas ao subir.
2. **Segredos** (somente no ambiente de execução): `SESSION_SECRET` (≥32 caracteres aleatórios) e `OWNER_PASSWORD_HASH` (gere com `read -s -p "Senha: " P; echo; printf %s "$P" | npm run -s hash-password`; mínimo de 6 caracteres; avisa se for curta ou só numérica, use uma senha longa e única). Login Google é opcional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `OWNER_GOOGLE_SUB` (os três ou nenhum). O login por senha limita 5 falhas por IP a cada 15 minutos.
3. **HTTPS**: `BASE_URL=https://seu-dominio`. O servidor recusa subir em produção sem https ou sem `DATABASE_URL`, e só então emite cookies `Secure`. Termine TLS no proxy/plataforma (o app confia em 1 proxy).
4. **Google Cloud** (somente se usar o login Google): cliente OAuth "aplicativo da Web", URI de redirecionamento `https://seu-dominio/api/auth/callback`, escopos `openid email`.
5. **Contêiner**: `docker build -t kanban .` e `docker run -p 3000:3000 --env-file .env kanban` (healthcheck em `/api/health`, que consulta o banco).
6. **Backup** (antes do uso real): agendar `scripts/backup.sh` (ex.: diário via cron/job da plataforma) e **testar a restauração** em um banco vazio com `scripts/restore.sh`. Ative também os backups/PITR do provedor de Postgres.
7. **Fluxo completo em produção** com a senha do proprietário: entrar → criar projeto → criar cartão em Ideias → A fazer → Em andamento → Concluído → arquivar/restaurar.

## Não verificado nesta máquina
Sem Docker e sem Postgres locais: o `Dockerfile` e os scripts de backup/restauração têm só a sintaxe do shell validada. Rode o item 5 e o teste de restauração do item 6 no ambiente de destino antes de confiar neles. A aplicação em si foi exercitada com PGlite (Postgres embarcado), não com um servidor Postgres real.
