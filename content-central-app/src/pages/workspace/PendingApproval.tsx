import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  animateForReels,
  approveContent,
  deleteContent,
  getProjectContent,
  regenerateContent,
  regenerateContentGroup,
  updateCaption,
  type ContentItem,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Skeleton } from "@/components/Skeleton";
import { ContentPipeline } from "./ContentPipeline";
import { bucketForItem, channelLabel, groupSameCreativeItems, imageSource, isFeedChannel, statusMeta, type ContentGroup } from "./contentDisplay";
import styles from "./PendingApproval.module.css";

type BusyAction = "approve" | "delete" | "creative" | "all" | "caption" | "animate";

interface ActionState {
  busy: boolean;
  busyAction?: BusyAction;
  error: string | null;
  message: string | null;
}

const IDLE_ACTION_STATE: ActionState = { busy: false, error: null, message: null };

// Bulk actions on a group (approve-all, shared-caption-save) get their own
// action-state/draft key so they don't collide with the leader item's own
// per-channel key when the leader also appears in the per-channel list below.
function groupStateKey(group: ContentGroup): string {
  return `group:${group.leader.contentId}`;
}

export function PendingApproval() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, ActionState>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [previewItem, setPreviewItem] = useState<ContentItem | null>(null);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const data = await getProjectContent(project.projectId);
      setItems(data.content);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [project.projectId]);

  useEffect(() => {
    setItems(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!items?.some((item) => item.image?.generating)) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [items, refresh]);

  const pending = (items || []).filter((item) => bucketForItem(item) === "aguardando");
  const groups = groupSameCreativeItems(pending);

  function stateFor(key: string): ActionState {
    return actionState[key] || IDLE_ACTION_STATE;
  }

  async function handleApprove(item: ContentItem) {
    setActionState((s) => ({ ...s, [item.contentId]: { busy: true, busyAction: "approve", error: null, message: null } }));
    try {
      await approveContent(project.projectId, item.contentId, item.batchId);
      await refresh();
    } catch (err) {
      setActionState((s) => ({ ...s, [item.contentId]: { busy: false, error: (err as Error).message, message: null } }));
    }
  }

  // Cards sharing a creative (same day, same image/legend across Story+Reels+
  // Facebook Story or Feed+Facebook Feed) show as one combined card — approve
  // once instead of once per channel.
  async function handleApproveGroup(group: ContentGroup) {
    const key = groupStateKey(group);
    setActionState((s) => ({ ...s, [key]: { busy: true, busyAction: "approve", error: null, message: null } }));
    try {
      for (const member of group.members) {
        await approveContent(project.projectId, member.contentId, member.batchId);
      }
      await refresh();
    } catch (err) {
      setActionState((s) => ({ ...s, [key]: { busy: false, error: (err as Error).message, message: null } }));
    }
  }

  async function handleDelete(item: ContentItem) {
    const reason = prompt(
      "Apagar este conteúdo gerado? Se quiser, diga o motivo (ajuda o sistema a evitar isso nas próximas gerações) — deixe em branco pra apagar sem motivo.",
    );
    if (reason === null) return;
    setActionState((s) => ({ ...s, [item.contentId]: { busy: true, busyAction: "delete", error: null, message: null } }));
    try {
      await deleteContent(project.projectId, item.contentId, item.batchId, reason || undefined);
      await refresh();
    } catch (err) {
      setActionState((s) => ({ ...s, [item.contentId]: { busy: false, error: (err as Error).message, message: null } }));
    }
  }

  async function handleRegenerate(item: ContentItem, mode: "creative" | "all") {
    setActionState((s) => ({ ...s, [item.contentId]: { busy: true, busyAction: mode, error: null, message: null } }));
    try {
      await regenerateContent(project.projectId, item.contentId, {
        regenerate: mode,
        note: notes[item.contentId] || "",
        batchId: item.batchId,
      });
      setActionState((s) => ({
        ...s,
        [item.contentId]: { busy: false, error: null, message: mode === "creative" ? "Imagem regenerada." : "Dia regenerado." },
      }));
      // A fresh AI regeneration should win over whatever the operator was
      // mid-typing in the caption box before clicking this.
      setCaptionDrafts((d) => {
        const next = { ...d };
        delete next[item.contentId];
        return next;
      });
      await refresh();
    } catch (err) {
      setActionState((s) => ({ ...s, [item.contentId]: { busy: false, error: (err as Error).message, message: null } }));
    }
  }

  // Instagram Reels only publishes for real with an actual video — the Meta
  // API rejects a static image for that channel. "Animar para Reels" turns
  // the already-approved creative into a short vertical MP4 (local ffmpeg
  // zoom/pan) so the card has something the publish flow can actually send.
  async function handleAnimateForReels(item: ContentItem) {
    setActionState((s) => ({ ...s, [item.contentId]: { busy: true, busyAction: "animate", error: null, message: null } }));
    try {
      await animateForReels(project.projectId, item.contentId, item.batchId);
      setActionState((s) => ({ ...s, [item.contentId]: { busy: false, error: null, message: "Vídeo gerado." } }));
      await refresh();
    } catch (err) {
      setActionState((s) => ({ ...s, [item.contentId]: { busy: false, error: (err as Error).message, message: null } }));
    }
  }

  // One "Pedido de alteração" and one regenerate action for the whole group
  // instead of one per channel — they're the same creative, so it only needs
  // to be regenerated once and stays shared with every member afterward
  // (regenerateContentGroup, unlike a per-item regenerate, never unlinks).
  async function handleRegenerateGroup(group: ContentGroup, mode: "creative" | "all") {
    const key = groupStateKey(group);
    setActionState((s) => ({ ...s, [key]: { busy: true, busyAction: mode, error: null, message: null } }));
    try {
      await regenerateContentGroup(
        project.projectId,
        group.members.map((member) => member.contentId),
        { regenerate: mode, note: notes[key] || "", batchId: group.leader.batchId },
      );
      setActionState((s) => ({
        ...s,
        [key]: { busy: false, error: null, message: mode === "creative" ? "Imagem regenerada em todos os formatos." : "Dia regenerado em todos os formatos." },
      }));
      setCaptionDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      await refresh();
    } catch (err) {
      setActionState((s) => ({ ...s, [key]: { busy: false, error: (err as Error).message, message: null } }));
    }
  }

  function captionFor(key: string, item: ContentItem): string {
    return captionDrafts[key] ?? item.caption?.text ?? "";
  }

  async function handleSaveCaption(item: ContentItem) {
    const text = captionFor(item.contentId, item).trim();
    if (!text || text === (item.caption?.text || "")) return;
    setActionState((s) => ({ ...s, [item.contentId]: { busy: true, busyAction: "caption", error: null, message: null } }));
    try {
      await updateCaption(project.projectId, item.contentId, text, item.batchId);
      setActionState((s) => ({ ...s, [item.contentId]: { busy: false, error: null, message: "Legenda salva." } }));
      setCaptionDrafts((d) => {
        const next = { ...d };
        delete next[item.contentId];
        return next;
      });
      await refresh();
    } catch (err) {
      setActionState((s) => ({ ...s, [item.contentId]: { busy: false, error: (err as Error).message, message: null } }));
    }
  }

  // Same idea as handleSaveCaption, but writes the shared text to every
  // member of the group — they were generated identical, so editing one
  // should not silently leave the others behind with the old text.
  async function handleSaveGroupCaption(group: ContentGroup) {
    const key = groupStateKey(group);
    const text = captionFor(key, group.leader).trim();
    if (!text || text === (group.leader.caption?.text || "")) return;
    setActionState((s) => ({ ...s, [key]: { busy: true, busyAction: "caption", error: null, message: null } }));
    try {
      for (const member of group.members) {
        await updateCaption(project.projectId, member.contentId, text, member.batchId);
      }
      setActionState((s) => ({ ...s, [key]: { busy: false, error: null, message: "Legenda salva em todos os formatos." } }));
      setCaptionDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      await refresh();
    } catch (err) {
      setActionState((s) => ({ ...s, [key]: { busy: false, error: (err as Error).message, message: null } }));
    }
  }

  if (error) {
    return <EmptyState title="Não foi possível carregar os conteúdos" description={error} />;
  }

  if (!items) {
    return <Skeleton height={200} />;
  }

  // Colored pill matching the pillar's identification color, so the
  // operator can spot the content strategy mix (Ensina/Prova/Posiciona/
  // Convida or a project's custom pillars) at a glance in the approval list.
  function renderPillarPill(item: ContentItem) {
    const pillar = item.contentTopic?.pillar;
    if (!pillar) return null;
    return (
      <span className="pill" style={{ borderColor: pillar.color, color: pillar.color }} title={pillar.objective}>
        {pillar.name}
      </span>
    );
  }

  // Surfaces which segment-learning creative structure (if any) and
  // whether a registered product-reference photo actually reached this
  // generation — so the operator can tell at a glance whether the
  // registered "raio-x" references were used, without digging into logs.
  function renderCreativeReferencePills(item: ContentItem) {
    const structure = item.creativeStructureUsed;
    if (!structure && !item.usedSegmentProductReference) return null;
    return (
      <>
        {structure ? <span className="pill">Estrutura: {structure.title || "sem nome"}</span> : null}
        {item.usedSegmentProductReference ? <span className="pill">Referencia de produto: usada</span> : null}
      </>
    );
  }

  function downloadFileName(item: ContentItem): string {
    const ext = item.image?.mimeType === "image/jpeg" ? "jpg" : "png";
    return `${item.contentId}.${ext}`;
  }

  // Instagram Reels only, since it's the only channel here that actually
  // needs a video before it can publish for real.
  function renderReelsAnimateBlock(item: ContentItem) {
    if (item.channel !== "instagram_reels") return null;
    const state = stateFor(item.contentId);
    return (
      <div style={{ marginTop: 8 }}>
        {item.videoGenerationError && !item.video?.url ? (
          <div className={`${styles.feedback} ${styles.feedbackError}`}>⚠ Vídeo: {item.videoGenerationError}</div>
        ) : null}
        {item.video?.url ? (
          <>
            <video
              src={item.video.url}
              controls
              style={{ width: "100%", maxWidth: 220, aspectRatio: "9 / 16", borderRadius: 12, marginBottom: 6, display: "block", background: "#000" }}
            />
            <div className={styles.actions}>
              <Button variant="secondary" disabled={state.busy} onClick={() => handleAnimateForReels(item)}>
                {state.busy && state.busyAction === "animate" ? "Gerando vídeo..." : "Gerar vídeo de novo"}
              </Button>
              <a href={item.video.url} download>
                <Button type="button" variant="ghost">
                  Baixar vídeo
                </Button>
              </a>
            </div>
          </>
        ) : (
          <Button variant="secondary" disabled={state.busy} onClick={() => handleAnimateForReels(item)}>
            {state.busy && state.busyAction === "animate" ? "Gerando vídeo..." : "Animar para Reels"}
          </Button>
        )}
      </div>
    );
  }

  function renderRegenerateAndDelete(item: ContentItem) {
    const state = stateFor(item.contentId);
    return (
      <div key={item.contentId} className={styles.channelRow}>
        <div className={styles.channelRowHead}>
          <span className="pill">{item.formatLabel || channelLabel(item.channel)}</span>
          <span className="pill">{statusMeta(item).label}</span>
        </div>
        {item.imageGenerationError ? (
          <div className={`${styles.feedback} ${styles.feedbackError}`}>⚠ Imagem: {item.imageGenerationError}</div>
        ) : null}
        {item.captionGenerationError ? (
          <div className={`${styles.feedback} ${styles.feedbackError}`}>⚠ {item.captionGenerationError}</div>
        ) : null}
        {renderReelsAnimateBlock(item)}
        <div className={styles.actions}>
          <Button variant="secondary" disabled={state.busy} onClick={() => handleRegenerate(item, "creative")}>
            {state.busy && state.busyAction === "creative" ? "Gerando imagem..." : "Regenerar só a imagem"}
          </Button>
          <Button variant="secondary" disabled={state.busy} onClick={() => handleRegenerate(item, "all")}>
            {state.busy && state.busyAction === "all" ? "Regenerando..." : "Regenerar dia"}
          </Button>
          <Button variant="ghost" disabled={state.busy} onClick={() => handleDelete(item)}>
            Apagar
          </Button>
        </div>
        {state.error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{state.error}</div> : null}
        {state.message ? <div className={`${styles.feedback} ${styles.feedbackOk}`}>{state.message}</div> : null}
      </div>
    );
  }

  function renderGroupCard(group: ContentGroup) {
    const leader = group.leader;
    const key = groupStateKey(group);
    const state = stateFor(key);
    const draft = captionFor(key, leader);
    const anyImageError = group.members.find((m) => m.imageGenerationError)?.imageGenerationError;
    const anyCaptionError = group.members.find((m) => m.captionGenerationError)?.captionGenerationError;

    return (
      <Card key={key} className={styles.card}>
        <div className={`${styles.phone} ${isFeedChannel(leader.channel) ? styles.phoneFeed : styles.phoneTall}`}>
          {imageSource(leader) ? (
            <>
              <img src={imageSource(leader)} alt={leader.formatLabel || channelLabel(leader.channel)} />
              <button type="button" className={styles.previewButton} onClick={() => setPreviewItem(leader)}>
                Ver maior
              </button>
            </>
          ) : leader.image?.generating ? (
            <span>Gerando imagem com IA...</span>
          ) : (
            <span>Sem imagem de prévia ainda</span>
          )}
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>
              {leader.scheduledDate} · {leader.scheduledTime || ""}
            </h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {renderPillarPill(leader)}
              {renderCreativeReferencePills(leader)}
              {group.members.map((member) => (
                <span key={member.contentId} className="pill">
                  {member.formatLabel || channelLabel(member.channel)}
                </span>
              ))}
            </div>
          </div>
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Mesmo criativo — aprovar aqui publica em {group.members.length} formatos de uma vez.
          </div>
          <ContentPipeline item={leader} />
          {anyImageError ? <div className={`${styles.feedback} ${styles.feedbackError}`} style={{ marginTop: 8 }}>⚠ Imagem: {anyImageError}</div> : null}
          {anyCaptionError ? <div className={`${styles.feedback} ${styles.feedbackError}`} style={{ marginTop: 8 }}>⚠ {anyCaptionError}</div> : null}
          <label htmlFor={`caption-${key}`}>Legenda (compartilhada entre esses formatos)</label>
          <textarea
            id={`caption-${key}`}
            className={styles.caption}
            value={draft}
            onChange={(e) => setCaptionDrafts((d) => ({ ...d, [key]: e.target.value }))}
          />
          {draft.trim() && draft.trim() !== (leader.caption?.text || "") ? (
            <div className={styles.actions} style={{ marginTop: 8 }}>
              <Button variant="secondary" disabled={state.busy} onClick={() => handleSaveGroupCaption(group)}>
                {state.busy && state.busyAction === "caption" ? "Salvando..." : "Salvar legenda em todos"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={state.busy}
                onClick={() =>
                  setCaptionDrafts((d) => {
                    const next = { ...d };
                    delete next[key];
                    return next;
                  })
                }
              >
                Desfazer
              </Button>
            </div>
          ) : null}
          <label htmlFor={`note-${key}`} style={{ marginTop: 12 }}>
            Pedido de alteração (aplica no criativo dos {group.members.length} formatos de uma vez)
          </label>
          <textarea
            id={`note-${key}`}
            placeholder="Ex: preço maior, trocar o fundo, tom mais alegre..."
            value={notes[key] || ""}
            onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))}
          />
          <div className={styles.actions}>
            <Button variant="secondary" disabled={state.busy} onClick={() => handleRegenerateGroup(group, "creative")}>
              {state.busy && state.busyAction === "creative" ? "Gerando imagem..." : "Regenerar só a imagem"}
            </Button>
            <Button variant="secondary" disabled={state.busy} onClick={() => handleRegenerateGroup(group, "all")}>
              {state.busy && state.busyAction === "all" ? "Regenerando..." : "Regenerar dia"}
            </Button>
            <Button disabled={state.busy} onClick={() => handleApproveGroup(group)}>
              {state.busy && state.busyAction === "approve" ? "Aprovando..." : `Aprovar (${group.members.length} formatos)`}
            </Button>
          </div>
          {state.error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{state.error}</div> : null}
          {state.message ? <div className={`${styles.feedback} ${styles.feedbackOk}`}>{state.message}</div> : null}

          <details style={{ marginTop: 14 }}>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Ajustar um formato individualmente (regenerar/apagar só ele, sem afetar os outros)
            </summary>
            <div className={styles.channelList}>{group.members.map(renderRegenerateAndDelete)}</div>
          </details>
        </div>
      </Card>
    );
  }

  function renderSoloCard(item: ContentItem) {
    const state = stateFor(item.contentId);
    const draft = captionFor(item.contentId, item);
    return (
      <Card key={item.contentId} className={styles.card}>
        <div className={`${styles.phone} ${isFeedChannel(item.channel) ? styles.phoneFeed : styles.phoneTall}`}>
          {imageSource(item) ? (
            <>
              <img src={imageSource(item)} alt={item.formatLabel || channelLabel(item.channel)} />
              <button type="button" className={styles.previewButton} onClick={() => setPreviewItem(item)}>
                Ver maior
              </button>
            </>
          ) : item.image?.generating ? (
            <span>Gerando imagem com IA...</span>
          ) : (
            <span>Sem imagem de prévia ainda</span>
          )}
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>
              {item.scheduledDate} · {item.scheduledTime || ""}
            </h3>
            <span className="pill">{item.formatLabel || channelLabel(item.channel)}</span>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className="pill">{statusMeta(item).label}</span>
            {renderPillarPill(item)}
            {renderCreativeReferencePills(item)}
          </div>
          <ContentPipeline item={item} />
          {item.imageGenerationError ? (
            <div className={`${styles.feedback} ${styles.feedbackError}`} style={{ marginTop: 8 }}>⚠ Imagem: {item.imageGenerationError}</div>
          ) : null}
          {item.captionGenerationError ? (
            <div className={`${styles.feedback} ${styles.feedbackError}`} style={{ marginTop: 8 }}>⚠ {item.captionGenerationError}</div>
          ) : null}
          <label htmlFor={`caption-${item.contentId}`}>Legenda</label>
          <textarea
            id={`caption-${item.contentId}`}
            className={styles.caption}
            value={draft}
            onChange={(e) => setCaptionDrafts((d) => ({ ...d, [item.contentId]: e.target.value }))}
          />
          {draft.trim() && draft.trim() !== (item.caption?.text || "") ? (
            <div className={styles.actions} style={{ marginTop: 8 }}>
              <Button variant="secondary" disabled={state.busy} onClick={() => handleSaveCaption(item)}>
                {state.busy && state.busyAction === "caption" ? "Salvando..." : "Salvar legenda"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={state.busy}
                onClick={() =>
                  setCaptionDrafts((d) => {
                    const next = { ...d };
                    delete next[item.contentId];
                    return next;
                  })
                }
              >
                Desfazer
              </Button>
            </div>
          ) : null}
          <label htmlFor={`note-${item.contentId}`} style={{ marginTop: 12 }}>
            Pedido de alteração (opcional)
          </label>
          <textarea
            id={`note-${item.contentId}`}
            placeholder="Ex: preço maior, trocar o fundo, tom mais alegre..."
            value={notes[item.contentId] || ""}
            onChange={(e) => setNotes((n) => ({ ...n, [item.contentId]: e.target.value }))}
          />
          {renderReelsAnimateBlock(item)}
          <div className={styles.actions}>
            <Button variant="secondary" disabled={state.busy} onClick={() => handleRegenerate(item, "creative")}>
              {state.busy && state.busyAction === "creative" ? "Gerando imagem..." : "Regenerar só a imagem"}
            </Button>
            <Button variant="secondary" disabled={state.busy} onClick={() => handleRegenerate(item, "all")}>
              {state.busy && state.busyAction === "all" ? "Regenerando..." : "Regenerar dia"}
            </Button>
            <Button disabled={state.busy} onClick={() => handleApprove(item)}>
              {state.busy && state.busyAction === "approve" ? "Aprovando..." : "Aprovar"}
            </Button>
            <Button variant="ghost" disabled={state.busy} onClick={() => handleDelete(item)}>
              Apagar
            </Button>
          </div>
          {state.error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{state.error}</div> : null}
          {state.message ? <div className={`${styles.feedback} ${styles.feedbackOk}`}>{state.message}</div> : null}
        </div>
      </Card>
    );
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Aguardando aprovação</h2>

      {pending.length > 0 ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          <b>Mostrar para o cliente:</b>
          <br />
          <span className="muted">
            Abre uma página de apresentação com todos os posts aguardando aprovação (imagem + legenda). É só visual — dá pra
            baixar em PDF ou mandar o link, mas a aprovação em si continua sendo feita aqui no painel.
          </span>
          <div style={{ marginTop: 10 }}>
            <a href={`/api/projects/${project.projectId}/briefing`} target="_blank" rel="noopener noreferrer">
              <Button type="button">Abrir apresentação</Button>
            </a>
          </div>
        </div>
      ) : null}

      {pending.length === 0 ? (
        <EmptyState
          title="Nada aguardando aprovação"
          description="Quando você gerar conteúdos novos, eles aparecem aqui até serem aprovados — depois vão para o Calendário."
        />
      ) : (
        <div className={styles.list}>
          {groups.map((group) => (group.members.length > 1 ? renderGroupCard(group) : renderSoloCard(group.leader)))}
        </div>
      )}

      {previewItem && imageSource(previewItem) ? (
        <ImageLightbox
          src={imageSource(previewItem)!}
          alt={previewItem.formatLabel || channelLabel(previewItem.channel)}
          fileName={downloadFileName(previewItem)}
          onClose={() => setPreviewItem(null)}
        />
      ) : null}
    </div>
  );
}
