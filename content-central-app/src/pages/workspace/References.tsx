import { useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { fileToDataUrl, researchOnline, saveAsset, saveImageRules, suggestBrandVisualSystem } from "@/api/client";
import type { BrandVisualSystem } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

const EMPTY_VISUAL_SYSTEM: BrandVisualSystem = {
  typography: "",
  titleWeight: "",
  bodyWeight: "",
  priceWeight: "",
  colorUsage: "",
  cornerStyle: "",
  shadowStyle: "",
  titleCase: "",
};

const TYPOGRAPHY_OPTIONS = [
  ["", "Sistema decide"],
  ["modern_grotesk", "Grotesca moderna"],
  ["commercial_condensed", "Condensada comercial"],
  ["clean_geometric", "Geométrica limpa"],
  ["editorial_serif", "Serifada editorial"],
  ["friendly_rounded", "Arredondada amigável"],
  ["neutral_system", "Neutra de sistema"],
];

const WEIGHT_OPTIONS = [
  ["", "Sistema decide"],
  ["regular", "Regular"],
  ["medium", "Médio"],
  ["semibold", "Semibold"],
  ["bold", "Bold"],
  ["extra_bold", "Extra bold"],
  ["black", "Black"],
];

const CORNER_OPTIONS = [
  ["", "Sistema decide"],
  ["sharp", "Quase retos"],
  ["slightly_rounded", "Levemente arredondados"],
  ["rounded", "Arredondados"],
];

const SHADOW_OPTIONS = [
  ["", "Sistema decide"],
  ["none", "Sem sombras"],
  ["subtle", "Muito sutis"],
  ["defined", "Definidas"],
];

const TITLECASE_OPTIONS = [
  ["", "Sistema decide"],
  ["normal", "Normal"],
  ["uppercase", "MAIÚSCULAS"],
  ["capitalized", "Capitalizado"],
];

function normalizeVisualSystem(input?: BrandVisualSystem): BrandVisualSystem {
  return { ...EMPTY_VISUAL_SYSTEM, ...(input || {}) };
}

function visualSystemValue(input: BrandVisualSystem, key: keyof BrandVisualSystem) {
  return String(input[key] || "");
}

function selectOptions(options: string[][]) {
  return options.map(([value, label]) => (
    <option key={value || "empty"} value={value}>
      {label}
    </option>
  ));
}

function readableTextColor(hex: string, fallback = "#fff") {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return fallback;
  const rgb = [0, 2, 4].map((start) => parseInt(match[1].slice(start, start + 2), 16) / 255);
  const [r, g, b] = rgb.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.52 ? "#111827" : "#ffffff";
}

export function References() {
  const { project, refreshProject } = useOutletContext<WorkspaceContext>();

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [visualStyle, setVisualStyle] = useState(project.brand?.visualStyle || "");
  const [imageRules, setImageRules] = useState((project.brand?.imageRules || []).join("\n"));
  const [visualSystem, setVisualSystem] = useState<BrandVisualSystem>(() => normalizeVisualSystem(project.brand?.visualSystem));
  const [rulesBusy, setRulesBusy] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesMessage, setRulesMessage] = useState<string | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);

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
      await saveImageRules(project.projectId, visualStyle, imageRules, visualSystem);
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

  async function handleSuggestVisualSystem() {
    setSuggestBusy(true);
    setRulesError(null);
    setRulesMessage(null);
    try {
      const result = await suggestBrandVisualSystem(project.projectId);
      setVisualSystem(normalizeVisualSystem(result.visualSystem));
      setRulesMessage("Sugestão aplicada. Revise e salve para usar nas próximas artes.");
    } catch (err) {
      setRulesError((err as Error).message);
    } finally {
      setSuggestBusy(false);
    }
  }

  function updateVisualSystemField(key: keyof BrandVisualSystem, value: string) {
    setVisualSystem((current) => ({ ...current, [key]: value }));
  }

  const previewColors = colors.length ? colors.slice(0, 3) : ["#f8f7fb", "#facc15", "#17161f"];
  const previewRadius = visualSystem.cornerStyle === "sharp" ? 3 : visualSystem.cornerStyle === "rounded" ? 18 : 8;
  const previewShadow = visualSystem.shadowStyle === "none"
    ? "none"
    : visualSystem.shadowStyle === "defined"
      ? "0 18px 34px rgba(0,0,0,.45)"
      : "0 10px 24px rgba(0,0,0,.28)";
  const previewFontFamily = visualSystem.typography === "editorial_serif"
    ? "Georgia, serif"
    : visualSystem.typography === "neutral_system"
      ? "Arial, sans-serif"
      : "var(--font-display)";
  const previewMainText = readableTextColor(previewColors[0] || "");
  const previewPriceText = readableTextColor(previewColors[1] || "", "#111827");

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

        <Card className="field-card" style={{ padding: 16, gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ marginTop: 0 }}>Sistema visual da marca</h3>
            <Button variant="secondary" disabled={suggestBusy} onClick={handleSuggestVisualSystem}>
              {suggestBusy ? "Analisando..." : "Sugerir sistema visual"}
            </Button>
          </div>

          <div className="row">
            <div>
              <label htmlFor="visual-typography">Tipografia</label>
              <select
                id="visual-typography"
                value={visualSystemValue(visualSystem, "typography")}
                onChange={(e) => updateVisualSystemField("typography", e.target.value)}
              >
                {selectOptions(TYPOGRAPHY_OPTIONS)}
              </select>
            </div>
            <div>
              <label htmlFor="visual-corners">Cantos</label>
              <select
                id="visual-corners"
                value={visualSystemValue(visualSystem, "cornerStyle")}
                onChange={(e) => updateVisualSystemField("cornerStyle", e.target.value)}
              >
                {selectOptions(CORNER_OPTIONS)}
              </select>
            </div>
            <div>
              <label htmlFor="visual-shadows">Sombras</label>
              <select
                id="visual-shadows"
                value={visualSystemValue(visualSystem, "shadowStyle")}
                onChange={(e) => updateVisualSystemField("shadowStyle", e.target.value)}
              >
                {selectOptions(SHADOW_OPTIONS)}
              </select>
            </div>
            <div>
              <label htmlFor="visual-title-case">Caixa do título</label>
              <select
                id="visual-title-case"
                value={visualSystemValue(visualSystem, "titleCase")}
                onChange={(e) => updateVisualSystemField("titleCase", e.target.value)}
              >
                {selectOptions(TITLECASE_OPTIONS)}
              </select>
            </div>
          </div>

          <div className="row">
            <div>
              <label htmlFor="visual-title-weight">Peso do título</label>
              <select
                id="visual-title-weight"
                value={visualSystemValue(visualSystem, "titleWeight")}
                onChange={(e) => updateVisualSystemField("titleWeight", e.target.value)}
              >
                {selectOptions(WEIGHT_OPTIONS)}
              </select>
            </div>
            <div>
              <label htmlFor="visual-body-weight">Peso do texto</label>
              <select
                id="visual-body-weight"
                value={visualSystemValue(visualSystem, "bodyWeight")}
                onChange={(e) => updateVisualSystemField("bodyWeight", e.target.value)}
              >
                {selectOptions(WEIGHT_OPTIONS)}
              </select>
            </div>
            <div>
              <label htmlFor="visual-price-weight">Peso do preço</label>
              <select
                id="visual-price-weight"
                value={visualSystemValue(visualSystem, "priceWeight")}
                onChange={(e) => updateVisualSystemField("priceWeight", e.target.value)}
              >
                {selectOptions(WEIGHT_OPTIONS)}
              </select>
            </div>
          </div>

          <label htmlFor="visual-color-usage">Cores por função</label>
          <textarea
            id="visual-color-usage"
            rows={3}
            placeholder="Ex: vermelho para preço, branco para texto, fundo escuro com alto contraste."
            value={visualSystemValue(visualSystem, "colorUsage")}
            onChange={(e) => updateVisualSystemField("colorUsage", e.target.value)}
          />

          <div
            aria-label="Prévia do sistema visual"
            style={{
              marginTop: 14,
              border: "1px solid var(--line)",
              borderRadius: previewRadius,
              boxShadow: previewShadow,
              overflow: "hidden",
              background: "var(--panel-2)",
            }}
          >
            <div style={{ display: "flex", minHeight: 132 }}>
              <div style={{ flex: "1 1 58%", padding: 16, fontFamily: previewFontFamily, background: previewColors[0] || "var(--panel-2)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: previewColors[1] || "var(--accent-warm)", textTransform: "uppercase" }}>
                  Oferta da semana
                </div>
                <div
                  style={{
                    marginTop: 6,
                    color: previewMainText,
                    fontSize: visualSystem.typography === "commercial_condensed" ? 25 : 22,
                    fontWeight: visualSystem.titleWeight === "black" ? 900 : visualSystem.titleWeight === "extra_bold" ? 800 : 720,
                    lineHeight: 1.05,
                    textTransform: visualSystem.titleCase === "uppercase" ? "uppercase" : visualSystem.titleCase === "capitalized" ? "capitalize" : "none",
                  }}
                >
                  Mussarela fatiada
                </div>
                <div style={{ marginTop: 8, color: previewMainText, opacity: 0.82, fontSize: 13, fontWeight: visualSystem.bodyWeight === "semibold" ? 650 : 500 }}>
                  Produto real em destaque
                </div>
              </div>
              <div
                style={{
                  flex: "0 0 34%",
                  display: "grid",
                  placeItems: "center",
                  background: previewColors[1] || "var(--accent-warm)",
                  color: previewPriceText,
                  fontFamily: previewFontFamily,
                  fontWeight: visualSystem.priceWeight === "black" ? 900 : visualSystem.priceWeight === "extra_bold" ? 800 : 750,
                  fontSize: 24,
                }}
              >
                R$ 9,99
              </div>
            </div>
          </div>
          <Button variant="secondary" className="full-width" style={{ marginTop: 12 }} disabled={rulesBusy} onClick={handleSaveRules}>
            {rulesBusy ? "Salvando..." : "Salvar sistema visual"}
          </Button>
        </Card>
      </div>

    </div>
  );
}
