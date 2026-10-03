import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  generateContent,
  getBrain,
  resolveBrainProposal,
  saveBrainNotebook,
  sendBrainMessage,
  type BrainChange,
  type BrainState,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./Brain.module.css";

const OFFER_FIELD_LABELS: Record<string, string> = {
  validFrom: "vale de",
  validUntil: "vale até",
  sector: "setor",
  active: "ativa",
  groupId: "grupo",
};

function show(value: unknown): string {
  if (value === "" || value === null || value === undefined) return "(vazio)";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, n]) => `${key} ${n}%`).join(", ");
  return String(value);
}

function changeText(change: BrainChange, offerName: (id?: string) => string): string {
  if (change.kind === "notebook") return "Caderno do cliente (texto novo abaixo)";
  if (change.kind === "goalWeights") return `Percentuais do Raio-X: ${show(change.before)} → ${show(change.after)}`;
  return `${offerName(change.offerId)} — ${OFFER_FIELD_LABELS[change.field || ""] || change.field}: ${show(change.before)} → ${show(change.after)}`;
}

const dayLabel = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
};

export function Brain() {
  const { project } = useOutletContext<WorkspaceContext>();
  const projectId = project.projectId;
  const [state, setState] = useState<BrainState | null>(null);
  const [draft, setDraft] = useState("");
  const [notebook, setNotebook] = useState("");
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await getBrain(projectId);
    setState(next);
    setNotebook(next.notebook);
  }, [projectId]);

  useEffect(() => {
    load().catch((err) => setError((err as Error).message));
  }, [load]);

  const offerName = (id?: string) => project.contentStrategy?.offers?.find((offer) => offer.id === id)?.name || id || "Oferta";

  async function handleSend() {
    const text = draft.trim();
    if (!text || thinking) return;
    setThinking(true);
    setError(null);
    setNotice(null);
    try {
      await sendBrainMessage(projectId, text);
      setDraft("");
    } catch {
      // The failure is stored in the chat as an "error" message; reload shows it.
    } finally {
      setThinking(false);
      await load().catch((err) => setError((err as Error).message));
    }
  }

  async function handleProposal(id: string, action: "apply" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const { proposal } = await resolveBrainProposal(projectId, id, action);
      const failed = (proposal.results || []).filter((result) => !result.ok);
      if (failed.length) setError(failed.map((result) => result.error).join(" "));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!state?.plan) return;
    setBusy(true);
    setError(null);
    try {
      await generateContent(projectId, {
        days: String(state.plan.days),
        startDate: state.plan.startDate,
        formats: state.plan.formats,
        contentRules: "",
        approvedPlan: state.plan.plan,
      });
      setNotice("Geração iniciada — acompanhe as artes em Aguardando aprovação.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveNotebook() {
    setBusy(true);
    setError(null);
    try {
      await saveBrainNotebook(projectId, notebook);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return error ? <div className="pill bad">{error}</div> : <Skeleton height={240} />;
  }

  const pending = state.proposals.filter((proposal) => proposal.status === "pending");

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Cérebro</h2>
      {error ? <div className="pill bad" style={{ marginBottom: 12 }}>{error}</div> : null}
      {notice ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          {notice} <Link to="../aguardando">Abrir</Link>
        </div>
      ) : null}

      <div className={styles.layout}>
        <Card className={styles.chat}>
          <div className={styles.messages}>
            {state.chat.messages.length === 0 ? (
              <EmptyState
                title="Converse com o cérebro deste cliente"
                description='Ex.: "Monta a semana a partir de segunda, 1 story às 9h e 1 feed às 18h. O sorteio acaba sexta."'
              />
            ) : (
              state.chat.messages.map((message, index) => (
                <div key={index} className={`${styles.message} ${styles[message.role]}`}>
                  {message.text}
                </div>
              ))
            )}
            {pending.map((proposal) => (
              <div key={proposal.id} className={styles.proposal}>
                <b>{proposal.summary || "Proposta"}</b>
                <ul>
                  {proposal.changes.map((change, index) => (
                    <li key={index}>
                      {changeText(change, offerName)}
                      {change.kind === "notebook" ? <pre className={styles.notebookAfter}>{String(change.after)}</pre> : null}
                    </li>
                  ))}
                </ul>
                <div className="button-row">
                  <Button type="button" disabled={busy} onClick={() => handleProposal(proposal.id, "apply")}>
                    Aplicar
                  </Button>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => handleProposal(proposal.id, "reject")}>
                    Recusar
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <label htmlFor="brain-message" className="sr-only">
            Mensagem para o cérebro
          </label>
          <textarea
            id="brain-message"
            aria-label="Mensagem para o cérebro"
            rows={3}
            value={draft}
            placeholder="Escreva para o cérebro… (Enter envia, Shift+Enter quebra linha)"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          <div className="button-row" style={{ marginTop: 8 }}>
            <Button type="button" disabled={thinking || !draft.trim()} onClick={() => void handleSend()}>
              {thinking ? "Pensando…" : "Enviar"}
            </Button>
          </div>
        </Card>

        <div className={styles.side}>
          <Card>
            <h3 style={{ marginTop: 0 }}>Plano</h3>
            {state.plan ? (
              <>
                {state.plan.plan.dayPlans.map((day) => (
                  <div key={day.date} className={styles.day}>
                    <b>{dayLabel(day.date)}</b>
                    {day.regular.map((slot) => (
                      <div key={slot.id} className={styles.slot}>
                        <span className="muted">
                          {slot.scheduledTime} · {slot.channelLabel}
                        </span>{" "}
                        <span>{slot.label}</span>
                      </div>
                    ))}
                    {day.extras.map((extra) => (
                      <div key={extra.id} className={styles.slot}>
                        <span className="muted">extra</span> <span>{extra.label}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <Button type="button" disabled={busy} onClick={() => void handleApprove()}>
                  Aprovar e gerar
                </Button>
              </>
            ) : (
              <p className="muted">Nenhum plano ainda. Peça ao cérebro para montar a semana.</p>
            )}
          </Card>

          <Card>
            <label htmlFor="brain-notebook">
              <h3 style={{ margin: 0 }}>Caderno do cliente</h3>
            </label>
            <p className="muted" style={{ fontSize: 12 }}>
              O que vale sempre para este cliente. O cérebro lê toda conversa e propõe mudanças aqui.
            </p>
            <textarea
              id="brain-notebook"
              aria-label="Caderno do cliente"
              rows={8}
              value={notebook}
              onChange={(event) => setNotebook(event.target.value)}
            />
            <div className="button-row" style={{ marginTop: 8 }}>
              <Button type="button" variant="secondary" disabled={busy || notebook === state.notebook} onClick={() => void handleSaveNotebook()}>
                Salvar caderno
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
