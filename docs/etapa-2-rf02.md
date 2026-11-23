# Etapa 2 · Cadastro de projetos (RF-02)

## 1. Requisito e aceite
**RF-02.** Criar, listar, editar, arquivar e restaurar projetos. Nome obrigatório, descrição opcional. Arquivados ficam disponíveis para consulta e voltam a aceitar alterações após a restauração.
**Aceite.** Ao cadastrar Portfólio e Curso de React, cada quadro exibe apenas seus próprios cartões (isolamento por projeto; os cartões chegam na etapa 3, aqui garantimos projetos independentes e isolados por proprietário). Arquivar e restaurar preserva o projeto e seus dados.

### Decisões (derivadas da seção "Regras de integridade")
- Projeto arquivado **rejeita edição de dados** (409 `project_archived`); a única alteração aceita é restaurar. Restaurar e editar na mesma chamada é permitido (o estado final é ativo).
- Nome com só espaços é rejeitado; é gravado sem espaços nas pontas (máx. 120). Descrição máx. 2000; vazia vira `null`.
- Toda consulta filtra por `owner_sub` da sessão; id de outro proprietário ou inexistente → 404.

### Cenários
| # | Dado | Quando | Então |
|---|------|--------|-------|
| P1 | sessão válida | `POST /api/projects {name:"Portfólio"}` | 201, projeto ativo |
| P2 | — | POST sem nome, nome só com espaços, nome > 120 | 400 |
| P3 | dois projetos criados | `GET /api/projects` | ambos listados, com `archivedAt` nulo; persistem entre chamadas |
| P4 | projeto ativo | `PATCH {name, description}` | 200, `updatedAt` avança |
| P5 | projeto ativo | `PATCH {archived:true}` | 200, `archivedAt` preenchido; continua na listagem |
| P6 | projeto arquivado | `PATCH {name:"x"}` | 409, nada muda |
| P7 | projeto arquivado | `PATCH {archived:false}` | 200, `archivedAt` nulo, volta a aceitar edição |
| P8 | projeto de outro proprietário / id inexistente / id malformado | GET/PATCH | 404 |
| P9 | sem sessão | qualquer rota | 401 |

## 2. Plano técnico
- Migração `002_projects.sql`: `projects(id uuid pk, owner_sub, name, description, archived_at, created_at, updated_at)`.
- `server/src/projects.ts`: rotas `GET/POST /projects`, `PATCH /projects/:id` (validação zod; PATCH em transação com `SELECT … FOR UPDATE`).
- Web: lista com seções Ativos/Arquivados, formulário de criação, edição inline, arquivar/restaurar; estados de carregando, vazio e erro.

## 3. Tarefas
1. [x] Migração 002.  2. [x] Rotas e validação.  3. [x] Testes P1–P9.  4. [x] UI de projetos.  5. [x] Verificação (testes, typecheck, build, fumaça HTTP).

---

## Extensão (2026-11-23): link do repositório no projeto
**Pedido do proprietário:** poder ligar o repositório de código ao projeto. Escopo escolhido: **apenas um link** (sem integração com GitHub/GitLab).

- Campo opcional `repositoryUrl` no projeto. Aceita somente `http://` ou `https://` (rejeita `javascript:`, `ftp:`, texto solto), até 500 caracteres; vazio vira `null`.
- Segue a regra do projeto arquivado: alterar o link de projeto arquivado → 409.
- UI: campo "Repositório (opcional)" no formulário; botão **Repositório** (abre em nova aba, `rel="noopener noreferrer"`) no cartão do projeto e no cabeçalho do quadro.

| # | Cenário | Resultado |
|---|---------|-----------|
| P10 | criar/editar com `https://github.com/usuario/repo` | grava e devolve `repositoryUrl` |
| P11 | `javascript:alert(1)`, `ftp://x`, `abc`, > 500 caracteres | 400 |
| P12 | `repositoryUrl: ""` ou `null` | limpa (`null`) |
| P13 | projeto arquivado + mudar link | 409; restaurar libera |
