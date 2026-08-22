import { useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { saveToken, saveWhatsAppInstance } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { tokenExpiryMeta } from "./tokenDisplay";

const TOKEN_STATUS_LABELS: Record<string, string> = {
  valido: "Válido",
  vence_em_breve: "Vence em breve",
  expirado: "Expirado",
};

export function Account() {
  const { project, refreshProject } = useOutletContext<WorkspaceContext>();
  const [token, setToken] = useState("");
  const [handle, setHandle] = useState(project.instagram?.handle || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [instanceUrl, setInstanceUrl] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [whatsappMessage, setWhatsappMessage] = useState<string | null>(null);

  const tokenInfo = project.token;
  const whatsappInfo = project.whatsapp;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setError("Cole o token antes de salvar.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await saveToken(project.projectId, token, handle);
      setToken("");
      await refreshProject();
      const savedMessage = `Token validado e salvo: ${tokenExpiryMeta(res.project.token).label}.`;
      setMessage(
        res.githubSyncWarning
          ? `${savedMessage} Aviso: falha ao sincronizar com o GitHub (${res.githubSyncWarning}).`
          : savedMessage,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWhatsAppSubmit(event: FormEvent) {
    event.preventDefault();
    if (!instanceUrl.trim() || !instanceName.trim() || !apiKey.trim()) {
      setWhatsappError("Preencha URL, nome da instância e apikey antes de salvar.");
      return;
    }
    setWhatsappBusy(true);
    setWhatsappError(null);
    setWhatsappMessage(null);
    try {
      await saveWhatsAppInstance(project.projectId, { instanceUrl, instanceName, apiKey });
      setApiKey("");
      await refreshProject();
      setWhatsappMessage("Instância WhatsApp salva.");
    } catch (err) {
      setWhatsappError((err as Error).message);
    } finally {
      setWhatsappBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Conta e token</h2>

      <Card style={{ padding: 20, marginBottom: 20 }}>
        <b>Status atual</b>
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tokenInfo?.configured ? (
            <>
              <span className="pill ok">{tokenInfo.masked}</span>
              <span className={`pill ${tokenExpiryMeta(tokenInfo).tone}`}>{tokenExpiryMeta(tokenInfo).label}</span>
              <span className={`pill ${tokenInfo.status === "expirado" ? "bad" : tokenInfo.status === "valido" ? "ok" : ""}`}>
                {TOKEN_STATUS_LABELS[tokenInfo.status || ""] || tokenInfo.status}
              </span>
            </>
          ) : (
            <span className="pill">Nenhum token configurado</span>
          )}
        </div>
      </Card>

      <Card style={{ padding: 20, marginBottom: 20 }}>
        <div className="notice">
          <b>Token seguro:</b>
          <br />
          <span className="muted">
            Cole o token apenas neste painel local. O sistema valida os dias de validade usando só o token. Não precisa informar
            data manualmente.
          </span>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="grid" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="token-input">Token Meta</label>
              <input
                id="token-input"
                type="password"
                placeholder="cole o token aqui"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="handle-input">Handle</label>
              <input id="handle-input" placeholder="@cliente" value={handle} onChange={(e) => setHandle(e.target.value)} />
            </div>
          </div>
          <Button type="submit" variant="secondary" className="full-width" style={{ marginTop: 12 }} disabled={busy}>
            {busy ? "Validando..." : "Validar token e salvar"}
          </Button>
        </form>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
        {message ? <div className="pill ok" style={{ marginTop: 12 }}>{message}</div> : null}
      </Card>

      <h2 style={{ margin: "0 0 var(--space-lg)" }}>WhatsApp Status (beta)</h2>

      <Card style={{ padding: 20 }}>
        <div className="notice">
          <b>Canal beta — leia antes de configurar:</b>
          <br />
          <span className="muted">
            Publica via Evolution API (automação não-oficial do WhatsApp Web, não é a API oficial da Meta). Sem SLA — pode
            falhar sem responder ou, em tese, levar ao banimento do número. Configure só se aceitar esse risco.
          </span>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {whatsappInfo?.configured ? (
            <>
              <span className="pill ok">{whatsappInfo.maskedApiKey}</span>
              <span className="pill">{whatsappInfo.instanceUrl}</span>
            </>
          ) : (
            <span className="pill">Instância não configurada</span>
          )}
        </div>
        <form onSubmit={handleWhatsAppSubmit}>
          <div className="grid" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="whatsapp-instance-url">URL da instância Evolution</label>
              <input
                id="whatsapp-instance-url"
                placeholder="https://evolution.seudominio.com"
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="whatsapp-instance-name">Nome da instância</label>
              <input
                id="whatsapp-instance-name"
                placeholder="nome-da-instancia"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="whatsapp-apikey">Apikey</label>
              <input
                id="whatsapp-apikey"
                type="password"
                placeholder="cole a apikey aqui"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit" variant="secondary" className="full-width" style={{ marginTop: 12 }} disabled={whatsappBusy}>
            {whatsappBusy ? "Salvando..." : "Salvar instância"}
          </Button>
        </form>
        {whatsappError ? <div className="pill bad" style={{ marginTop: 12 }}>{whatsappError}</div> : null}
        {whatsappMessage ? <div className="pill ok" style={{ marginTop: 12 }}>{whatsappMessage}</div> : null}
      </Card>
    </div>
  );
}
