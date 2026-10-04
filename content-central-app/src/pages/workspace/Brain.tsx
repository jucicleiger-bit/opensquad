import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  CONTENT_GOAL_LABELS,
  generateContent,
  generatePlanExtras,
  getBrain,
  markBrainPlanApproved,
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
import { ChatText } from "./ChatText";
import { localDateKey } from "./offerUsageDisplay";
import styles from "./Brain.module.css";

const OFFER_FIELD_LABELS: Record<string, string> = {
  validFrom: "vale de",
  validUntil: "vale até",
  sector: "setor",
  active: "ativa",
  groupId: "grupo",
};

const goalLabel = (key: string) => (key === "sales" ? "Venda (ofertas)" : CONTENT_GOAL_LABELS[key] || key);

function show(value: unknown): string {
  if (value === "" || value === null || value === undefined) return "(vazio)";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, n]) => `${goalLabel(key)} ${n}%`).join(", ");
  }
  return String(value);
}

const dayMonth = (date: string) => date.split("-").reverse().slice(0, 2).join("/");

type PlanLine = { id: string; channel: string; scheduledTime: string; label: string };

const formatOf = (channel: string) => (channel.includes("feed") ? "Feed" : channel.includes("reels") ? "Reels" : "Story");
const networkOf = (channel: string) => (channel.startsWith("facebook") ? "Facebook" : channel.startsWith("whatsapp") ? "WhatsApp" : "Instagram");

// Channels of one format at the same time with the same subject are one art
// (Story on Instagram, Facebook and WhatsApp Status), so they read as one line.
function groupPlanLines<T extends PlanLine>(slots: T[]) {
  const groups = new Map<string, { first: T; networks: string[] }>();
  for (const slot of [...slots].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))) {
    const key = `${slot.scheduledTime}|${formatOf(slot.channel)}|${slot.label}`;
    const group = groups.get(key) || { first: slot, networks: [] };
    group.networks.push(networkOf(slot.channel));
    groups.set(key, group);
  }
  return [...groups.values()].map(({ first, networks }) => ({ ...first, where: `${formatOf(first.channel)} · ${networks.join(", ")}` }));
}

// "12 stories · 2 feeds na semana", counting arts, not channels.
function planTotals(days: Array<{ regular: PlanLine[] }>) {
  const counts = new Map<string, number>();
  for (const line of days.flatMap((day) => groupPlanLines(day.regular))) {
    const format = formatOf(line.channel);
    counts.set(format, (counts.get(format) || 0) + 1);
  }
  const names: Record<string, [string, string]> = { Story: ["story", "stories"], Feed: ["feed", "feeds"], Reels: ["reels", "reels"] };
  return [...counts].map(([format, n]) => `${n} ${names[format][n === 1 ? 0 : 1]}`).join(" · ") + " na semana";
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
  const messagesRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const next = await getBrain(projectId);
    setState(next);
    setNotebook(next.notebook);
    return next;
  }, [projectId]);

  useEffect(() => {
    load().catch((err) => setError((err as Error).message));
  }, [load]);

  const messageCount = state?.chat.messages.length ?? 0;
  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messageCount, thinking]);

  const offers = project.contentStrategy?.offers || [];
  const groups = project.contentStrategy?.offerGroups || [];
  const offerName = (id?: string) => offers.find((offer) => offer.id === id)?.name || id || "Oferta";

  function changeText(change: BrainChange): string {
    if (change.kind === "notebook") return "Caderno do cliente (texto novo abaixo)";
    if (change.kind === "goalWeights") return `Percentuais do Raio-X: ${show(change.before)} → ${show(change.after)}`;
    const value = (raw: unknown) => (change.field === "groupId" && raw ? groups.find((group) => group.id === raw)?.name || String(raw) : show(raw));
    return `${offerName(change.offerId)} — ${OFFER_FIELD_LABELS[change.field || ""] || change.field}: ${value(change.before)} → ${value(change.after)}`;
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || thinking) return;
    setThinking(true);
    setError(null);
    setNotice(null);
    setDraft("");
    // Shown right away; the reload after the answer replaces it with what the
    // server stored.
    setState((current) => current && {
      ...current,
      chat: { ...current.chat, messages: [...current.chat.messages, { role: "user", text, at: new Date().toISOString() }] },
    });
    let failure: string | null = null;
    try {
      await sendBrainMessage(projectId, text);
    } catch (err) {
      failure = (err as Error).message;
    }
    setThinking(false);
    try {
      const next = await load();
      const last = next.chat.messages.at(-1);
      // A failed answer is already in the chat as an error message; anything
      // else (busy, offline) is not, and the text must come back to the box.
      if (failure && !(last?.role === "error" && last.text === failure)) {
        setError(failure);
        if (last?.role !== "user" || last.text !== text) setDraft(text);
      }
    } catch (err) {
      setError(failure || (err as Error).message);
      setDraft(text);
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
    const stored = state?.plan;
    if (!stored) return;
    setBusy(true);
    setError(null);
    try {
      await generateContent(projectId, {
        days: String(stored.days),
        startDate: stored.startDate,
        formats: stored.formats,
        contentRules: "",
        approvedPlan: stored.plan,
      });
      // Marked before the extras: if one of those fails, the regular posts
      // already exist and must not be generated again by a second click.
      await markBrainPlanApproved(projectId);
      try {
        if (stored.plan.extraCount) await generatePlanExtras(projectId, stored.plan);
        setNotice("Geração iniciada — acompanhe as artes em Aguardando aprovação.");
      } catch (err) {
        setError(`Os posts do plano foram gerados, mas os extras de datas comemorativas falharam: ${(err as Error).message}`);
      }
      await load();
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
  const stored = state.plan;
  const planIsPast = Boolean(stored && stored.startDate < localDateKey(new Date()));

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
          <div className={styles.messages} ref={messagesRef}>
            {state.chat.messages.length === 0 ? (
              <EmptyState
                title="Converse com o cérebro deste cliente"
                description='Ex.: "Monta a semana a partir de segunda, 1 story às 9h e 1 feed às 18h. O sorteio acaba sexta."'
              />
            ) : (
              state.chat.messages.map((message, index) => (
                <div key={index} className={`${styles.message} ${styles[message.role]}`}>
                  {message.role === "assistant" ? <ChatText text={message.text} /> : message.text}
                </div>
              ))
            )}
            {thinking ? <div className={`${styles.message} ${styles.assistant} muted`}>Pensando…</div> : null}
            {pending.map((proposal) => (
              <div key={proposal.id} className={styles.proposal}>
                <b>{proposal.summary || "Proposta"}</b>
                <ul>
                  {proposal.changes.map((change, index) => (
                    <li key={index}>
                      {changeText(change)}
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
          <textarea
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
          <Card className={styles.plan}>
            <h3 style={{ margin: 0 }}>Plano</h3>
            {stored ? (
              <>
                <p className="muted" style={{ margin: "2px 0 12px", fontSize: 13 }}>{planTotals(stored.plan.dayPlans)}</p>
                {stored.plan.dayPlans.filter((day) => day.regular.length || day.extras.length).map((day) => (
                  <div key={day.date} className={styles.day}>
                    <b>{dayLabel(day.date)}</b>
                    {[...groupPlanLines(day.regular), ...groupPlanLines(day.extras).map((extra) => ({ ...extra, scheduledTime: "extra" }))].map((slot) => (
                      <div key={slot.id} className={styles.slot}>
                        <span className={styles.time}>{slot.scheduledTime}</span>
                        <div>
                          <div>{slot.label}</div>
                          <div className={`muted ${styles.where}`}>{slot.where}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                {stored.plan.warnings?.length ? (
                  <div className={styles.warnings}>
                    <b>⚠️ Avisos</b>
                    <ul>
                      {stored.plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}
                {stored.approvedAt ? (
                  <p className="muted">Aprovado em {dayMonth(stored.approvedAt.slice(0, 10))}. Para outra semana, peça um plano novo ao cérebro.</p>
                ) : planIsPast ? (
                  <p className="muted">Este plano começa em {dayMonth(stored.startDate)}, que já passou. Peça ao cérebro para refazer a partir de hoje.</p>
                ) : null}
                <Button type="button" disabled={busy || Boolean(stored.approvedAt) || planIsPast} onClick={() => void handleApprove()}>
                  Aprovar e gerar
                </Button>
              </>
            ) : (
              <p className="muted">Nenhum plano ainda. Peça ao cérebro para montar a semana.</p>
            )}
          </Card>

          <Card>
            <h3 style={{ margin: 0 }}>Caderno do cliente</h3>
            <p className="muted" style={{ fontSize: 12 }}>
              O que vale sempre para este cliente. O cérebro lê toda conversa e propõe mudanças aqui.
            </p>
            <textarea aria-label="Caderno do cliente" rows={8} value={notebook} onChange={(event) => setNotebook(event.target.value)} />
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
