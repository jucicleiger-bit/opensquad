import { useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { fileToDataUrl, researchOnline, saveAsset, saveImageRules } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export function References() {
  const { project, refreshProject } = useOutletContext<WorkspaceContext>();

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [visualStyle, setVisualStyle] = useState(project.brand?.visualStyle || "");
  const [imageRules, setImageRules] = useState((project.brand?.imageRules || []).join("\n"));
  const [rulesBusy, setRulesBusy] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesMessage, setRulesMessage] = useState<string | null>(null);

  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchMessage, setResearchMessage] = useState<string | null>(null);

  const colors = [...(project.brandIdentity?.editedColors || []), ...(project.brandIdentity?.extractedColors || [])];

  async function handleUploadLogo() {
    const file = logoInputRef.current?.files?.[0];
    if (!file) {
      setLogoError("Escolha um arquivo de logo.");
      return;
    }
    setLogoBusy(true);
    setLogoError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await saveAsset(project.projectId, {
        kind: "logo",
        filename: file.name,
        dataUrl,
        role: "brand_asset",
        usageRoles: ["brand_asset"],
        referenceCategory: "official_asset",
        useInNextGeneration: true,
        instruction: "Logo oficial da marca. Preservar exatamente como enviado.",
      });
      if (logoInputRef.current) logoInputRef.current.value = "";
      await refreshProject();
    } catch (err) {
      setLogoError((err as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleSaveRules() {
    setRulesBusy(true);
    setRulesError(null);
    setRulesMessage(null);
    try {
      await saveImageRules(project.projectId, visualStyle, imageRules);
      await refreshProject();
      setRulesMessage("Direção visual salva.");
    } catch (err) {
      setRulesError((err as Error).message);
    } finally {
      setRulesBusy(false);
    }
  }

  async function handleResearchOnline() {
    setResearchBusy(true);
    setResearchError(null);
    setResearchMessage(null);
    try {
      const result = await researchOnline(project.projectId);
      // Mirror the server's own merge (new findings replace only the
      // previous "[Pesquisa online]" lines, hand-written rules stay) so the
      // textarea reflects reality immediately, without waiting on a project
      // refresh that this component doesn't resync local state from.
      setImageRules((current) => {
        const kept = current
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("[Pesquisa online]"));
        return [...result.findings, ...kept].join("\n");
      });
      await refreshProject();
      setResearchMessage(`Pesquisa concluída — ${result.findings.length} direção(ões) visual(is) adicionada(s) abaixo.`);
    } catch (err) {
      setResearchError((err as Error).message);
    } finally {
      setResearchBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-2xs)" }}>Imagem e identidade visual</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Este é o lugar que define a aparência dos criativos. O Raio-X fornece o contexto estratégico da empresa; logo,
        cores, direção visual e referências são controladas aqui.
      </p>

      <div className="grid">
        <Card className="field-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Ativo oficial principal</h3>
          <label htmlFor="logo-file">Arquivo de logo</label>
          <input ref={logoInputRef} id="logo-file" type="file" accept="image/*" />
          <Button variant="secondary" className="full-width" style={{ marginTop: 8 }} disabled={logoBusy} onClick={handleUploadLogo}>
            {logoBusy ? "Enviando..." : "Enviar logo"}
          </Button>
          {logoError ? <div className="pill bad" style={{ marginTop: 10 }}>{logoError}</div> : null}
          <div className="notice" style={{ marginTop: 12 }}>
            <b>Cores identificadas na logo</b>
            <br />
            <span className="muted">
              {colors.length ? colors.join(", ") : "Envie a logo para identificar as cores automaticamente."}
            </span>
            {project.brand?.logoPath ? <div style={{ marginTop: 6 }}><span className="pill ok">logo enviada</span></div> : null}
          </div>
        </Card>

        <Card className="field-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Direção visual dos criativos</h3>
          <label htmlFor="visual-style">Direção visual usada nas novas imagens</label>
          <textarea id="visual-style" value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} />
          <label htmlFor="image-rules">Regras técnicas extras para o ChatGPT</label>
          <textarea
            id="image-rules"
            placeholder="Use só quando necessário. Ex: texto curto, área segura, não inventar preço."
            value={imageRules}
            onChange={(e) => setImageRules(e.target.value)}
          />
          <Button variant="secondary" className="full-width" style={{ marginTop: 8 }} disabled={rulesBusy} onClick={handleSaveRules}>
            {rulesBusy ? "Salvando..." : "Salvar direção visual"}
          </Button>
          {rulesError ? <div className="pill bad" style={{ marginTop: 10 }}>{rulesError}</div> : null}
          {rulesMessage ? <div className="pill ok" style={{ marginTop: 10 }}>{rulesMessage}</div> : null}

          <div className="notice" style={{ marginTop: 14 }}>
            <b>Pesquisar referências online</b>
            <br />
            <span className="muted">
              Busca na internet tendências visuais atuais para o segmento cadastrado (Empresa/Raio-X) e adiciona como direção
              visual acima — só padrão (cor, composição, tipografia), nunca copiando marca/texto de concorrente. Cada pesquisa
              nova substitui a anterior; regras que você escreveu à mão não são afetadas.
            </span>
          </div>
          <Button variant="secondary" className="full-width" style={{ marginTop: 8 }} disabled={researchBusy} onClick={handleResearchOnline}>
            {researchBusy ? "Pesquisando..." : "Pesquisar referências online"}
          </Button>
          {researchError ? <div className="pill bad" style={{ marginTop: 10 }}>{researchError}</div> : null}
          {researchMessage ? <div className="pill ok" style={{ marginTop: 10 }}>{researchMessage}</div> : null}
        </Card>
      </div>

    </div>
  );
}
