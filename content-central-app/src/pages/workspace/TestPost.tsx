import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { testPost, type ContentItem } from "@/api/client";
import { channelFullLabel, channelLabel, imageSource, isFeedChannel } from "./contentDisplay";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import styles from "./TestPost.module.css";

const CHANNEL_OPTIONS = ["instagram_story", "instagram_feed", "instagram_reels"];

export function TestPost() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [channel, setChannel] = useState("instagram_story");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContentItem | null>(null);

  async function handleTestPost() {
    setBusy(true);
    setError(null);
    try {
      const res = await testPost(project.projectId, channel, note);
      setResult(res.content);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const review = result?.creativeReview;
  const attempts = result?.creativeReviewAttempts?.length || 0;

  return (
    <div>
      <h2 style={{ margin: "0 0 16px" }}>Teste rápido antes de programar</h2>

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

      {result ? (
        <Card className={styles.result}>
          <div className={`${styles.phone} ${isFeedChannel(result.channel) ? styles.phoneFeed : styles.phoneTall}`}>
            {imageSource(result) ? (
              <img src={imageSource(result)} alt={result.formatLabel || channelLabel(result.channel)} />
            ) : (
              <span>Sem imagem de prévia ainda</span>
            )}
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>Último teste gerado</h3>
              <span className="pill">{result.formatLabel || channelLabel(result.channel)}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <span className="pill">Fonte: {result.image?.generatedSource === "ai" ? "imagem IA desenhada pelo ChatGPT" : "prévia local"}</span>
              <span className="pill">
                tamanho: {result.image?.dimensions?.width || ""}x{result.image?.dimensions?.height || ""}
              </span>
              <span className="pill">dry-run: {result.publish?.dryRun !== false ? "sim" : "não"}</span>
              <span className="pill">publicado: {result.publish?.realPublished ? "sim" : "não"}</span>
            </div>

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
                  <ul style={{ margin: "8px 0 0 18px", color: "#fecaca" }}>
                    {review.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                {review.warnings?.length ? (
                  <ul style={{ margin: "8px 0 0 18px", color: "#fde68a" }}>
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
      ) : (
        <div className="empty-state" style={{ marginTop: 20 }}>
          <b>Nenhum teste gerado ainda.</b>
          <br />A imagem e a legenda do teste vão aparecer aqui.
        </div>
      )}
    </div>
  );
}
