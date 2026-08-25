import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { deleteContent, getProjectContent, testPost, type ContentItem } from "@/api/client";
import { ContentPipeline } from "./ContentPipeline";
import { channelFullLabel, channelLabel, imageSource, isFeedChannel } from "./contentDisplay";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ImageLightbox } from "@/components/ImageLightbox";
import styles from "./TestPost.module.css";

const CHANNEL_OPTIONS = ["instagram_story", "instagram_feed", "instagram_reels"];

function sortNewestFirst(items: ContentItem[]): ContentItem[] {
  return [...items].sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
}

export function TestPost() {
  const { project } = useOutletContext<WorkspaceContext>();
  const activeOffers = (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false);
  const [channel, setChannel] = useState("instagram_story");
  const [note, setNote] = useState("");
  const [offerId, setOfferId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every test stays here — a new one adds to the list instead of replacing
  // the last, so past tests never look like they "disappeared". Sorted
  // newest first; the operator deletes the ones they no longer need.
  const [results, setResults] = useState<ContentItem[]>([]);
  const [lightboxItem, setLightboxItem] = useState<ContentItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Loads every past test already on the server on mount — the classic HTML
  // panel's renderLatestTestPreview did the same for its one preview slot.
  useEffect(() => {
    let cancelled = false;
    getProjectContent(project.projectId)
      .then((res) => {
        if (cancelled) return;
        setResults(sortNewestFirst(res.content.filter((item) => item.status === "test_post_simulated")));
      })
      .catch(() => {
        // No tests to show yet is not an error worth surfacing — the empty
        // state below already covers it.
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectId]);

  async function handleTestPost() {
    setBusy(true);
    setError(null);
    try {
      const res = await testPost(project.projectId, channel, note, offerId || undefined);
      setResults((current) => [res.content, ...current]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteResult(item: ContentItem) {
    if (!confirm("Apagar este teste gerado?")) return;
    setDeletingId(item.contentId);
    try {
      await deleteContent(project.projectId, item.contentId, item.batchId);
      setResults((current) => current.filter((entry) => entry.contentId !== item.contentId));
      if (lightboxItem?.contentId === item.contentId) setLightboxItem(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Teste rápido antes de programar</h2>

      <Card style={{ padding: 20 }}>
        <div className="notice">
          <b>Não publica de verdade.</b>
          <br />
          <span className="muted">
            Gera um conteúdo e simula a postagem localmente para testar o fluxo antes de programar/publicar.
          </span>
        </div>

        <div className="grid" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="test-channel">Canal do teste</label>
            <select id="test-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNEL_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {channelFullLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="test-offer">Produto/oferta cadastrado (opcional)</label>
            <select id="test-offer" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">Deixar o sistema escolher</option>
              {activeOffers.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="test-note">Ideia/observação do teste</label>
            <textarea
              id="test-note"
              placeholder="Ex: criar um post teste para ver o fluxo antes de programar"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <Button className="full-width" style={{ marginTop: 10 }} disabled={busy} onClick={handleTestPost}>
          {busy ? "Gerando e revisando..." : "Gerar conteúdo + simular postagem"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>

      {results.length > 0 ? (
        <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
          {results.map((result, index) => {
            const review = result.creativeReview;
            const attempts = result.creativeReviewAttempts?.length || 0;
            return (
              <Card key={result.contentId} className={styles.result}>
                <div className={`${styles.phone} ${isFeedChannel(result.channel) ? styles.phoneFeed : styles.phoneTall}`}>
                  {imageSource(result) ? (
                    <img src={imageSource(result)} alt={result.formatLabel || channelLabel(result.channel)} loading="lazy" />
                  ) : (
                    <span>Sem imagem de prévia ainda</span>
                  )}
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0 }}>{index === 0 ? "Último teste gerado" : "Teste anterior"}</h3>
                    <span className="pill">{result.formatLabel || channelLabel(result.channel)}</span>
                  </div>
                  <div className="button-row" style={{ marginTop: 8 }}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!imageSource(result)}
                      onClick={() => setLightboxItem(result)}
                    >
                      Ver maior / baixar
                    </Button>
                    <Button type="button" variant="ghost" disabled={deletingId === result.contentId} onClick={() => handleDeleteResult(result)}>
                      {deletingId === result.contentId ? "Apagando..." : "Apagar"}
                    </Button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <span className="pill">Fonte: {result.image?.generatedSource === "ai" ? "imagem IA desenhada pelo ChatGPT" : "prévia local"}</span>
                    <span className="pill">
                      tamanho: {result.image?.dimensions?.width || ""}x{result.image?.dimensions?.height || ""}
                    </span>
                    <span className="pill">dry-run: {result.publish?.dryRun !== false ? "sim" : "não"}</span>
                    <span className="pill">publicado: {result.publish?.realPublished ? "sim" : "não"}</span>
                    {result.creativeStructureUsed ? (
                      <span className="pill">Estrutura: {result.creativeStructureUsed.title || "sem nome"}</span>
                    ) : null}
                    {result.usedSegmentProductReference ? <span className="pill">Referência de produto: usada</span> : null}
                  </div>
                  <ContentPipeline item={result} />

                  {result.publish?.creativeVariation ? (
                    <div className="notice" style={{ marginTop: 10 }}>
                      <b>Variação deste teste:</b>
                      <br />
                      <span className="muted">{result.publish.creativeVariation}</span>
                    </div>
                  ) : null}

                  {review ? (
                    <div className="notice" style={{ marginTop: 10 }}>
                      <b>Agente Revisor de Criativo:</b>{" "}
                      <span className={`pill ${review.status === "blocked" ? "bad" : review.status === "ok" ? "ok" : ""}`}>
                        {review.status || "warning"}
                      </span>
                      <br />
                      <span className="muted">{review.summary || "Sem resumo"}</span>
                      {attempts > 1 ? (
                        <div className="pill ok" style={{ marginTop: 8 }}>
                          Refeito automaticamente {attempts} tentativa(s) até esta revisão
                        </div>
                      ) : null}
                      {review.errors?.length ? (
                        <ul style={{ margin: "8px 0 0 18px", color: "var(--bad-soft)" }}>
                          {review.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      ) : null}
                      {review.warnings?.length ? (
                        <ul style={{ margin: "8px 0 0 18px", color: "var(--warn-soft)" }}>
                          {review.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : (
                    <div className="notice" style={{ marginTop: 10 }}>
                      <b>Agente Revisor de Criativo:</b>
                      <br />
                      <span className="muted">Ainda sem revisão automática. Revise visualmente antes de aprovar.</span>
                    </div>
                  )}

                  <div className={styles.caption}>{result.caption?.text || "Sem legenda"}</div>
                  <details>
                    <summary>Prompt do criativo</summary>
                    <div className={styles.prompt}>{result.image?.prompt || "Sem prompt"}</div>
                  </details>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 20 }}>
          <b>Nenhum teste gerado ainda.</b>
          <br />A imagem e a legenda do teste vão aparecer aqui.
        </div>
      )}

      {lightboxItem && imageSource(lightboxItem) ? (
        <ImageLightbox
          src={imageSource(lightboxItem)!}
          alt={lightboxItem.formatLabel || channelLabel(lightboxItem.channel)}
          fileName={`${lightboxItem.contentId}.${lightboxItem.image?.mimeType === "image/jpeg" ? "jpg" : "png"}`}
          onClose={() => setLightboxItem(null)}
        />
      ) : null}
    </div>
  );
}
