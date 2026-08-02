import { useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { saveToken } from "@/api/client";
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

  const tokenInfo = project.token;

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
      setMessage(`Token validado e salvo: ${tokenExpiryMeta(res.project.token).label}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 16px" }}>Conta e token</h2>

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

      <Card style={{ padding: 20 }}>
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
    </div>
  );
}
