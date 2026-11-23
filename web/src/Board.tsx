import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { api, ApiError, COLUMNS, type Card, type Column, type Project } from "./api";
import { IconAlert, IconCalendar, IconCheck, IconClose, IconDown, IconEdit, IconPlus, IconUp } from "./icons";

const fmtDate = (ymd: string) => ymd.split("-").reverse().join("/");
const fmtInstant = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

const messageFor = (e: unknown) =>
  e instanceof ApiError && e.status === 400
    ? "Confira os dados: o título é obrigatório."
    : e instanceof ApiError && e.status === 409
      ? "Este projeto está arquivado. Restaure-o para alterar cartões."
      : e instanceof ApiError && e.status === 401
        ? "Sessão expirada. Recarregue a página para entrar de novo."
        : "Não foi possível salvar. Tente novamente.";

type Dialog = { mode: "create"; column: Column } | { mode: "edit"; card: Card } | null;

function CardDialog({
  dialog,
  onClose,
  onSave,
  onDelete,
}: {
  dialog: NonNullable<Dialog>;
  onClose: () => void;
  onSave: (v: { title: string; description: string; deadline: string; column: Column }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const edit = dialog.mode === "edit" ? dialog.card : undefined;
  const [title, setTitle] = useState(edit?.title ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [deadline, setDeadline] = useState(edit?.deadline ?? "");
  const [column, setColumn] = useState<Column>(dialog.mode === "create" ? dialog.column : dialog.card.column);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(messageFor(e));
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Informe o título do cartão.");
    void run(() => onSave({ title, description, deadline, column }));
  }

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="card-dialog-title">
      <form onSubmit={submit}>
        <div className="dlg-head">
          <h2 id="card-dialog-title">{edit ? "Editar cartão" : "Novo cartão"}</h2>
          <button type="button" className="ghost icon-btn" onClick={() => ref.current?.close()} aria-label="Fechar"><IconClose /></button>
        </div>
        <div className="dlg-body">
          <label>
            Título
            <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus required placeholder="O que precisa ser feito?" />
          </label>
          <label>
            <span>Descrição <span className="field-hint">(opcional)</span></span>
            <textarea value={description} rows={3} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="row" style={{ alignItems: "start" }}>
            <label style={{ flex: 1, minWidth: 160 }}>
              Prazo (opcional)
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
            {!edit && (
              <label style={{ flex: 1, minWidth: 160 }}>
                Coluna
                <select value={column} onChange={(e) => setColumn(e.target.value as Column)}>
                  {COLUMNS.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {error && <p role="alert" className="error"><IconAlert /> {error}</p>}
        </div>
        <div className="dlg-foot">
          {onDelete &&
            (confirming ? (
              <span className="confirm">
                <span>Excluir este cartão?</span>
                <button type="button" className="danger" disabled={busy} onClick={() => void run(onDelete)}>Sim, excluir</button>
                <button type="button" onClick={() => setConfirming(false)}>Não</button>
              </span>
            ) : (
              <button type="button" className="danger" onClick={() => setConfirming(true)}>Excluir</button>
            ))}
          <span className="push row">
            <button type="button" onClick={() => ref.current?.close()}>Cancelar</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
          </span>
        </div>
      </form>
    </dialog>
  );
}

export function Board({ project }: { project: Project }) {
  const [cards, setCards] = useState<Card[]>();
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragId, setDragId] = useState<string>();
  const [overCol, setOverCol] = useState<Column>();
  const readOnly = project.archivedAt !== null;

  const load = useCallback(() => {
    setFailed(false);
    return api.listCards(project.id).then(setCards, () => setFailed(true));
  }, [project.id]);
  useEffect(() => void load(), [load]);

  async function move(card: Card, column: Column, position?: number) {
    setNotice(undefined);
    try {
      await api.updateCard(card.id, { column, ...(position === undefined ? {} : { position }) });
    } catch (e) {
      setNotice(messageFor(e));
    }
    await load();
  }

  function indexAt(list: HTMLElement, y: number, skipId?: string) {
    const els = [...list.querySelectorAll<HTMLElement>("[data-card-id]")].filter((el) => el.dataset.cardId !== skipId);
    return els.filter((el) => {
      const r = el.getBoundingClientRect();
      return y > r.top + r.height / 2;
    }).length;
  }

  function onDrop(e: DragEvent<HTMLElement>, column: Column) {
    e.preventDefault();
    const card = cards?.find((c) => c.id === dragId);
    setDragId(undefined);
    setOverCol(undefined);
    if (!card) return;
    const list = e.currentTarget.querySelector<HTMLElement>("[data-list]")!;
    void move(card, column, indexAt(list, e.clientY, card.id));
  }

  if (failed)
    return (
      <div>
        <p role="alert" className="error"><IconAlert /> Não foi possível carregar o quadro.</p>
        <button onClick={() => void load()}>Tentar novamente</button>
      </div>
    );
  if (!cards) return <div className="loading"><div className="spinner" /> Carregando quadro…</div>;

  return (
    <div className="board-wrap">
      {readOnly && <p className="banner"><IconAlert /> Projeto arquivado: somente consulta. Restaure-o para alterar cartões.</p>}
      {notice && <p role="alert" className="error" style={{ marginBottom: 12 }}><IconAlert /> {notice}</p>}
      {cards.length === 0 && !readOnly && <p className="hint" style={{ margin: "0 0 12px" }}>Quadro vazio. Registre sua primeira ideia em “Ideias”.</p>}
      <div className="board">
        {COLUMNS.map((col) => {
          const list = cards.filter((c) => c.column === col.key);
          return (
            <section
              key={col.key}
              data-col={col.key}
              className={`column${overCol === col.key ? " over" : ""}`}
              aria-label={col.label}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverCol(col.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(undefined);
              }}
              onDrop={(e) => onDrop(e, col.key)}
            >
              <header className="column-head">
                <span className="dot" />
                <h3>{col.label}</h3>
                <span className="count" aria-label={`${list.length} cartões`}>{list.length}</span>
                <span className="hint">{col.hint}</span>
                <span className="spacer" />
                {!readOnly && (
                  <button className="ghost icon-btn" onClick={() => setDialog({ mode: "create", column: col.key })} aria-label={`Novo cartão em ${col.label}`} title="Novo cartão">
                    <IconPlus />
                  </button>
                )}
              </header>
              <ul className="cards" data-list>
                {list.length === 0 && <li className="col-empty" aria-hidden>Nenhum cartão</li>}
                {list.map((c, i) => (
                  <li
                    key={c.id}
                    data-card-id={c.id}
                    className={`kcard${c.overdue ? " overdue" : ""}${dragId === c.id ? " dragging" : ""}`}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.id);
                      setDragId(c.id);
                    }}
                    onDragEnd={() => {
                      setDragId(undefined);
                      setOverCol(undefined);
                    }}
                  >
                    <h4>{c.title}</h4>
                    {c.description && <p className="desc">{c.description}</p>}
                    {(c.deadline || c.completedAt) && (
                      <div className="chips">
                        {c.deadline && (
                          <span className={`chip${c.overdue ? " late" : ""}`}>
                            <IconCalendar /> {fmtDate(c.deadline)}
                            {c.overdue && <b>· Vencido</b>}
                          </span>
                        )}
                        {c.completedAt && (
                          <span className="chip ok"><IconCheck /> Concluído em {fmtInstant(c.completedAt)}</span>
                        )}
                      </div>
                    )}
                    {!readOnly && (
                      <div className="kactions">
                        <label>
                          <span className="sr">Mover “{c.title}” para</span>
                          <select
                            value=""
                            aria-label={`Mover “${c.title}” para`}
                            onChange={(e) => e.target.value && void move(c, e.target.value as Column)}
                          >
                            <option value="">Mover para…</option>
                            {COLUMNS.filter((x) => x.key !== c.column).map((x) => (
                              <option key={x.key} value={x.key}>{x.label}</option>
                            ))}
                          </select>
                        </label>
                        <button className="ghost icon-btn" disabled={i === 0} aria-label={`Subir “${c.title}”`} title="Subir" onClick={() => void move(c, c.column, i - 1)}><IconUp /></button>
                        <button className="ghost icon-btn" disabled={i === list.length - 1} aria-label={`Descer “${c.title}”`} title="Descer" onClick={() => void move(c, c.column, i + 1)}><IconDown /></button>
                        <button className="ghost icon-btn" aria-label={`Editar “${c.title}”`} title="Editar" onClick={() => setDialog({ mode: "edit", card: c })}><IconEdit /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {dialog && (
        <CardDialog
          key={dialog.mode === "edit" ? dialog.card.id : `new-${dialog.column}`}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            if (dialog.mode === "create")
              await api.createCard(project.id, {
                title: v.title,
                description: v.description || undefined,
                deadline: v.deadline || null,
                column: v.column,
              });
            else
              await api.updateCard(dialog.card.id, {
                title: v.title,
                description: v.description || null,
                deadline: v.deadline || null,
              });
            setDialog(null);
            await load();
          }}
          onDelete={
            dialog.mode === "edit"
              ? async () => {
                  await api.deleteCard(dialog.card.id);
                  setDialog(null);
                  await load();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
