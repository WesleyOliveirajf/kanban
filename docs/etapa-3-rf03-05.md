# Etapa 3 · Quadro e cartões (RF-03 a RF-05)

## 1. Requisitos e aceite
- **RF-03** Criar, editar e excluir cartões (exclusão com confirmação). Título obrigatório; descrição e prazo opcionais. Começa em Ideias, mas aceita outra coluna na criação (inclusive Concluído).
- **RF-04** Colunas Ideias · A fazer · Em andamento · Concluído. Mover por arraste e pelo seletor "Mover para" (toque/teclado). Reordenar dentro da coluna. Coluna e ordem persistem. Concluído pode voltar a coluna de trabalho. Data de conclusão registrada ao concluir e limpa ao reabrir.
- **RF-05** Prazo visível no cartão; prazos vencidos de tarefas abertas destacados, no fuso configurado. Prazo de hoje e cartão concluído sem destaque.

### Decisões
- Colunas na API/BD: `ideas | todo | doing | done`. Rótulos em português só na interface.
- Prazo = data civil `YYYY-MM-DD` (coluna `date`), validada como data real. Fuso: `APP_TIMEZONE` (padrão `America/Sao_Paulo`). O servidor calcula `overdue` (`coluna ≠ done` e `prazo < hoje no fuso`), com relógio injetável nos testes.
- `position` = índice 0-based **na coluna de destino, sem contar o próprio cartão**. Omitido ao trocar de coluna = final da coluna. Posição maior que o tamanho da coluna → 400. Posições são sempre densas (0..n-1) nas colunas afetadas, renumeradas na mesma transação, com o projeto bloqueado (`FOR UPDATE`) para serializar movimentos.
- `completedAt` é definido ao entrar em `done` (inclusive na criação), mantido enquanto permanecer em `done` (reordenar não muda) e limpo ao sair.
- Projeto arquivado: leitura permitida; criar, editar, mover e excluir → 409 `project_archived`. Cartão de projeto de outro proprietário ou inexistente → 404.
- Exclusão é definitiva neste momento (a retenção do registro para remoção na agenda entra na etapa 4).

### Cenários
| # | Cenário | Resultado |
|---|---------|-----------|
| K1 | criar sem coluna | vai para `ideas`, sem prazo, `completedAt` nulo |
| K2 | título vazio/só espaços; prazo inválido (`2026-02-30`); coluna inválida | 400 |
| K3 | criar direto em `done` | `completedAt` preenchido |
| K4 | 3 cartões em Ideias, mover o 3º para índice 0 | ordem 3,1,2 com posições 0,1,2; persiste após novo GET |
| K5 | mover para outra coluna sem posição | vai ao final; coluna de origem recompactada |
| K6 | mover para `done` / voltar a `doing` | `completedAt` definido / nulo; reordenar dentro de `done` mantém a data |
| K7 | posição fora do intervalo | 400, nada muda |
| K8 | `overdue`: ontem aberto = sim; hoje = não; concluído = não; sem prazo = não; virada de dia respeita o fuso | conforme |
| K9 | arquivar projeto | escritas 409, leitura ok; restaurar preserva coluna, posição, `completedAt` |
| K10 | dois projetos | cartões de um não aparecem no outro; projeto/cartão de outro proprietário → 404 |
| K11 | excluir | 204, posições recompactadas, depois 404 |
| K12 | sem sessão | 401 |

## 2. Plano técnico
- Migração `003_cards.sql` (`cards`, FK para `projects`, `CHECK` de coluna/título/posição, índice `(project_id, status, position)`).
- `server/src/cards.ts`: `GET/POST /projects/:id/cards`, `PATCH/DELETE /cards/:id`. `createApp` aceita `now()` injetável; config ganha `timezone`.
- Web: rota por hash (`#/p/:id`), `Board` com 4 colunas (grade no desktop; faixas roláveis com *scroll-snap* no celular), arraste HTML5, seletor "Mover para", botões Subir/Descer, `<dialog>` de criação/edição com exclusão confirmada.

## 3. Tarefas
1. [x] Migração + config + relógio injetável.  2. [x] Rotas de cartões.  3. [x] Testes K1–K12.  4. [x] Quadro na web.  5. [x] Verificação (testes, build, fumaça HTTP).
