import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

type Step = "credentials" | "mfa";

export function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError || !aal) {
      setError(aalError?.message ?? "Falha ao verificar nível de autenticação.");
      setBusy(false);
      return;
    }
    if (aal.currentLevel === aal.nextLevel) {
      // No MFA factor enrolled, or already at the required level.
      navigate("/", { replace: true });
      return;
    }
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    const totpFactor = factors?.totp?.[0];
    if (factorsError || !totpFactor) {
      setError(factorsError?.message || "Nenhum fator MFA encontrado para este usuário.");
      setBusy(false);
      return;
    }
    setFactorId(totpFactor.id);
    setStep("mfa");
    setBusy(false);
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setBusy(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setError(challengeError.message);
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) {
      setError(verifyError.message);
      setBusy(false);
      return;
    }
    navigate("/", { replace: true });
  }

  if (step === "mfa") {
    return (
      <form className="card" style={{ maxWidth: 360, margin: "80px auto" }} onSubmit={handleMfa}>
        <h1>Código do autenticador</h1>
        <input
          type="text"
          inputMode="numeric"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Verificando..." : "Confirmar"}
        </button>
      </form>
    );
  }

  return (
    <form className="card" style={{ maxWidth: 360, margin: "80px auto" }} onSubmit={handleCredentials}>
      <h1>Entrar</h1>
      <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input
        type="password"
        placeholder="Senha"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
