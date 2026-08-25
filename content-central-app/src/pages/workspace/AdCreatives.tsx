import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  AD_OBJECTIVE_LABELS,
  deleteAdCreative,
  generateAdCreative,
  listAdCreatives,
  regenerateAdCreative,
  type AdCreative,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./AdCreatives.module.css";

function imageSource(adCreative: AdCreative): string | null {
  return adCreative.image.url || adCreative.image.previewUrl || adCreative.image.previewDataUrl || null;
}

interface CardActionState {
  busy: boolean;
  error: string | null;
}

const IDLE_CARD_STATE: CardActionState = { busy: false, error: null };

export function AdCreatives() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [adCreatives, setAdCreatives] = useState<AdCreative[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerId, setOfferId] = useState("");
  const [objective, setObjective] = useState("whatsapp");
  const [format, setFormat] = useState<"story" | "feed" | "ambos">("feed");
  const [note, setNote] = useState("");
  const [baseTotal, setBaseTotal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState<Record<string, string>>({});
  const [cardState, setCardState] = useState<Record<string, CardActionState>>({});

  const activeOffers = (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false);

  const refresh = useCallback(async () => {
    try {
      const data = await listAdCreatives(project.projectId);
      setAdCreatives(data.adCreatives);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [project.projectId]);

  useEffect(() => {
    setAdCreatives(null);
    refresh();
  }, [refresh]);

  // Image + copy variations finish generating in the background — poll
  // while any card is still working, same pattern as Calendar/PendingApproval.
  useEffect(() => {
    if (!adCreatives?.some((entry) => entry.image?.generating)) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [adCreatives, refresh]);

  function stateFor(adCreativeId: string): CardActionState {
    return cardState[adCreativeId] || IDLE_CARD_STATE;
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await generateAdCreative(project.projectId, {
        objective,
        offerId: offerId || undefined,
        format,
        note: note.trim() || undefined,
        noteMode: baseTotal ? "base_total" : "recomendacao",
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(adCreativeId: string) {
    if (!confirm("Apagar este criativo de anúncio?")) return;
    setDeletingId(adCreativeId);
    try {
      await deleteAdCreative(project.projectId, adCreativeId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  // No note = "Regenerar só a imagem" (fresh take). A note = "Pedido de
  // alteração" — a targeted edit of the existing image, preserving the rest.
  async function handleRegenerate(adCreativeId: string, editNote?: string) {
    setCardState((current) => ({ ...current, [adCreativeId]: { busy: true, error: null } }));
    try {
      await regenerateAdCreative(project.projectId, adCreativeId, editNote || undefined);
      setEditNotes((current) => ({ ...current, [adCreativeId]: "" }));
      await refresh();
      setCardState((current) => ({ ...current, [adCreativeId]: IDLE_CARD_STATE }));
    } catch (err) {
      setCardState((current) => ({ ...current, [adCreativeId]: { busy: false, error: (err as Error).message } }));
    }
  }

  async function handleCopy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2000);
    } catch {
      // Clipboard access can fail silently (permissions, non-secure
      // context) — the text is still visible on screen to copy by hand.
    }
  }

  if (!adCreatives) {
    return <Skeleton height={200} />;
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-xs)" }}>Criativos de Anúncio</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        Peças pra tráfego pago — separadas da agenda orgânica: sem calendário, sem aprovação. Gera a imagem e 3 variações de
        texto por ângulo (dor, desejo/resultado, urgência) pra você mesmo rodar no Gerenciador de Anúncios.
      </p>

      <Card style={{ padding: 20 }}>
        <div className="row">
          <div>
            <label htmlFor="ad-offer">Oferta vinculada (opcional)</label>
            <select id="ad-offer" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">Nenhuma — anúncio institucional</option>
              {activeOffers.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ad-objective">Objetivo</label>
            <select id="ad-objective" value={objective} onChange={(e) => setObjective(e.target.value)}>
              {Object.entries(AD_OBJECTIVE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor="ad-format">Formato</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }} id="ad-format">
          {([
            ["story", "Story"],
            ["feed", "Feed"],
            ["ambos", "Ambos"],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={format === value ? "primary" : "secondary"}
              onClick={() => setFormat(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        <label htmlFor="ad-note">Sua ideia pra esse anúncio (opcional)</label>
        <textarea
          id="ad-note"
          placeholder="Ex: menos de R$5 por dia você pode movimentar seu Instagram..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={baseTotal} onChange={(e) => setBaseTotal(e.target.checked)} />
          Basear o criativo totalmente nessa ideia (em vez de usar só como recomendação)
        </label>

        <Button type="button" className="full-width" style={{ marginTop: 10 }} disabled={generating} onClick={handleGenerate}>
          {generating ? "Gerando criativo..." : "Gerar criativo de anúncio"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>

      {adCreatives.length === 0 ? (
        <div style={{ marginTop: 20 }}>
          <EmptyState title="Nenhum criativo de anúncio ainda" description="Gere o primeiro usando o formulário acima." />
        </div>
      ) : (
        <div className={styles.list}>
          {adCreatives.map((adCreative) => {
            const src = imageSource(adCreative);
            const state = stateFor(adCreative.adCreativeId);
            const editNote = editNotes[adCreative.adCreativeId] || "";
            return (
              <Card key={adCreative.adCreativeId} className={styles.card}>
                <div className={`${styles.phone} ${adCreative.channel === "instagram_story" ? styles.phoneTall : styles.phoneFeed}`}>
                  {src ? (
                    <img src={src} alt={adCreative.title} loading="lazy" />
                  ) : adCreative.image.generating ? (
                    <span>Gerando imagem com IA...</span>
                  ) : (
                    <span>Sem imagem de prévia ainda</span>
                  )}
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0 }}>{adCreative.title}</h3>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className="pill">{adCreative.objectiveLabel}</span>
                      <span className="pill">{adCreative.formatLabel}</span>
                    </div>
                  </div>
                  {adCreative.imageGenerationError ? (
                    <div className="pill bad" style={{ marginTop: 8 }}>⚠ Imagem: {adCreative.imageGenerationError}</div>
                  ) : null}
                  {adCreative.copyGenerationError ? (
                    <div className="pill bad" style={{ marginTop: 8 }}>⚠ {adCreative.copyGenerationError}</div>
                  ) : null}

                  {adCreative.variations.length > 0 ? (
                    <div className={styles.variations}>
                      {adCreative.variations.map((variation, index) => {
                        const key = `${adCreative.adCreativeId}-${index}`;
                        const fullText = [variation.headline, variation.primaryText, variation.description, variation.cta]
                          .filter(Boolean)
                          .join("\n\n");
                        return (
                          <div key={key} className={styles.variation}>
                            <div className={styles.variationHead}>
                              <span className="pill">{variation.angleLabel}</span>
                              <Button type="button" variant="ghost" onClick={() => handleCopy(key, fullText)}>
                                {copiedKey === key ? "Copiado!" : "Copiar texto"}
                              </Button>
                            </div>
                            <span className={styles.variationLabel}>Título</span>
                            <div className={styles.variationHeadline}>{variation.headline}</div>
                            <span className={styles.variationLabel}>Texto principal</span>
                            <div className={styles.variationText}>{variation.primaryText}</div>
                            {variation.description ? (
                              <>
                                <span className={styles.variationLabel}>Descrição</span>
                                <div className={styles.variationDescription}>{variation.description}</div>
                              </>
                            ) : null}
                            <div className={styles.variationCta}>{variation.cta}</div>
                          </div>
                        );
                      })}
                    </div>
                  ) : !adCreative.copyGenerationError && adCreative.image.generating ? (
                    <p className="muted" style={{ marginTop: 12 }}>Escrevendo as variações de texto...</p>
                  ) : null}

                  <label htmlFor={`edit-${adCreative.adCreativeId}`} style={{ marginTop: 12 }}>
                    Pedido de alteração (opcional)
                  </label>
                  <textarea
                    id={`edit-${adCreative.adCreativeId}`}
                    placeholder="Ex: preço maior, trocar o fundo, deixar o gancho mais direto..."
                    value={editNote}
                    onChange={(e) => setEditNotes((current) => ({ ...current, [adCreative.adCreativeId]: e.target.value }))}
                  />

                  <div className={styles.actions}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={state.busy}
                      onClick={() => handleRegenerate(adCreative.adCreativeId)}
                    >
                      {state.busy ? "Regenerando..." : "Regenerar só a imagem"}
                    </Button>
                    {editNote.trim() ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={state.busy}
                        onClick={() => handleRegenerate(adCreative.adCreativeId, editNote.trim())}
                      >
                        {state.busy ? "Aplicando..." : "Aplicar alteração"}
                      </Button>
                    ) : null}
                    {src ? (
                      <a href={src} download={`${adCreative.adCreativeId}.png`}>
                        <Button type="button" variant="secondary">Baixar imagem</Button>
                      </a>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={deletingId === adCreative.adCreativeId}
                      onClick={() => handleDelete(adCreative.adCreativeId)}
                    >
                      {deletingId === adCreative.adCreativeId ? "Apagando..." : "Apagar"}
                    </Button>
                  </div>
                  {state.error ? <div className="pill bad" style={{ marginTop: 8 }}>{state.error}</div> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
