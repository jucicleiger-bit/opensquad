import { useEffect, useRef, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { connectWhatsAppInstance, getWhatsAppInstanceStatus, saveToken } from "@/api/client";
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

  const [qrcode, setQrcode] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const tokenInfo = project.token;
  const whatsappInfo = project.whatsapp;

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const status = await getWhatsAppInstanceStatus(project.projectId);
        if (status.connected) {
          setConnected(true);
          setQrcode(null);
          stopPolling();
        }
      } catch {
        // A transient poll failure isn't worth surfacing as an error —
        // the next tick tries again.
      }
    }, 3000);
  }

  // Runs once per project load, not on every whatsappInfo change — a
  // successful connect already updates `connected` itself (see
  // handleConnect/startPolling below), so re-running this on
  // whatsappInfo?.configured flipping true would double-fetch status right
  // on top of the connect flow's own first poll tick. If the project
  // already had a configured instance when this page first loaded (a
  // prior session), this is what tells the operator its real current state
  // instead of assuming "not connected".
  useEffect(() => {
    if (!whatsappInfo?.configured) return;
    let cancelled = false;
    getWhatsAppInstanceStatus(project.projectId)
      .then((status) => {
        if (!cancelled) setConnected(status.connected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.projectId]);

  useEffect(() => stopPolling, []);

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

  async function handleConnect() {
    setConnectBusy(true);
    setConnectError(null);
    try {
      const res = await connectWhatsAppInstance(project.projectId);
      setQrcode(res.qrcode);
      setConnected(false);
      await refreshProject();
      startPolling();
    } catch (err) {
      setConnectError((err as Error).message);
    } finally {
      setConnectBusy(false);
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
          <b>Canal beta — leia antes de conectar:</b>
          <br />
          <span className="muted">
            Publica via Evolution API (automação não-oficial do WhatsApp Web, não é a API oficial da Meta). Sem SLA — pode
            falhar sem responder ou, em tese, levar ao banimento do número. Conecte só se aceitar esse risco.
          </span>
        </div>

        <div style={{ marginTop: 12 }}>
          {connected ? (
            <span className="pill ok">Conectado</span>
          ) : qrcode ? (
            <div>
              <img src={qrcode} alt="QR Code WhatsApp" style={{ maxWidth: 220 }} />
              <p className="muted" style={{ marginTop: 8 }}>Escaneie com o WhatsApp do número que vai postar Status.</p>
            </div>
          ) : (
            <Button type="button" variant="secondary" onClick={handleConnect} disabled={connectBusy}>
              {connectBusy ? "Conectando..." : whatsappInfo?.configured ? "Reconectar / Novo QR" : "Conectar WhatsApp"}
            </Button>
          )}
        </div>
        {connectError ? <div className="pill bad" style={{ marginTop: 12 }}>{connectError}</div> : null}
      </Card>
    </div>
  );
}
