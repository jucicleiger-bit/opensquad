import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";

type Stage = "loading" | "no-factor" | "enrolling" | "verified";

export function Account() {
  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (listError) {
        setError(listError.message);
        return;
      }
      const verified = data?.totp?.find((f) => f.status === "verified");
      setStage(verified ? "verified" : "no-factor");
    });
  }, []);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (enrollError || !data) {
      setError(enrollError?.message || "Falha ao iniciar ativação do MFA.");
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStage("enrolling");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setBusy(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    setStage("verified");
  }

  return (
    <div style={{ maxWidth: 480, margin: "40px auto" }} className="card">
      <h1>Autenticação em duas etapas</h1>

      {stage === "loading" ? <p>Carregando...</p> : null}

      {stage === "verified" ? (
        <p>✅ MFA ativado. Todo login exige o código do app autenticador.</p>
      ) : null}

      {stage === "no-factor" ? (
        <>
          <p>Nenhum fator de MFA ativo — hoje o login pede só senha.</p>
          <button type="button" className="primary" onClick={startEnroll} disabled={busy}>
            {busy ? "Gerando..." : "Ativar MFA"}
          </button>
        </>
      ) : null}

      {stage === "enrolling" && qrCode ? (
        <form onSubmit={verify} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p>Escaneie com o app autenticador (Google Authenticator, Authy, etc.):</p>
          <img src={qrCode} alt="QR code do MFA" style={{ maxWidth: 220 }} />
          {secret ? (
            <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
              Não consegue escanear? Cadastre manualmente: <code>{secret}</code>
            </p>
          ) : null}
          <input
            type="text"
            inputMode="numeric"
            placeholder="Código de 6 dígitos"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Confirmando..." : "Confirmar"}
          </button>
        </form>
      ) : null}

      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
    </div>
  );
}
