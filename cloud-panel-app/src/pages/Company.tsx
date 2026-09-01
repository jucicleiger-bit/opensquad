import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { approveBrandDocument, type BrandDocument } from "@/lib/approveBrandDocument";

interface CompanyProfile {
  segmentGroup: string; segmentCategory: string; segmentSpecialty: string;
  segment: string; description: string; audience: string; audienceType: string;
  location: string; productsOrServices: string; differentiators: string;
  primaryObjective: string; websiteOrInstagram: string; factualConstraints: string;
  tone: string[]; contentGoals: string[]; brandColors: string; avoid: string;
  positioning: string;
}

const EMPTY_PROFILE: CompanyProfile = {
  segmentGroup: "", segmentCategory: "", segmentSpecialty: "", segment: "",
  description: "", audience: "", audienceType: "", location: "",
  productsOrServices: "", differentiators: "", primaryObjective: "",
  websiteOrInstagram: "", factualConstraints: "", tone: [], contentGoals: [],
  brandColors: "", avoid: "", positioning: "",
};

const PROFILE_FIELDS: Array<{ key: keyof CompanyProfile; label: string; multiline?: boolean }> = [
  { key: "segmentGroup", label: "Setor principal" },
  { key: "segmentCategory", label: "Categoria" },
  { key: "segmentSpecialty", label: "Especialidade / subsegmento" },
  { key: "segment", label: "Segmento" },
  { key: "description", label: "Descrição da empresa", multiline: true },
  { key: "audience", label: "Público-alvo", multiline: true },
  { key: "location", label: "Região / cidade" },
  { key: "productsOrServices", label: "O que vende / presta", multiline: true },
  { key: "differentiators", label: "Diferenciais", multiline: true },
  { key: "primaryObjective", label: "Objetivo principal da comunicação" },
  { key: "websiteOrInstagram", label: "Site / Instagram" },
  { key: "factualConstraints", label: "Informações que não podem ser inventadas", multiline: true },
  { key: "brandColors", label: "Cores / identidade desejada" },
  { key: "avoid", label: "Evitar", multiline: true },
  { key: "positioning", label: "Posicionamento desejado", multiline: true },
];

const AUDIENCE_TYPE_OPTIONS = [
  { value: "", label: "Não definido" },
  { value: "b2b", label: "B2B" },
  { value: "b2c", label: "B2C" },
  { value: "mixed", label: "B2B e B2C" },
];

const BRAND_XRAY_BLOCKS: Array<[string, string]> = [
  ["summary", "Resumo da marca"],
  ["communication", "Compradores e comunicação"],
  ["contentStrategy", "Estratégia de conteúdo"],
  ["visualIdentity", "Identidade visual"],
];

const BRAND_BRIEFING_BLOCKS: Array<[string, string]> = [
  ["summary", "Resumo da empresa"],
  ["positioning", "Posicionamento sugerido"],
  ["audience", "Público-alvo sugerido"],
  ["tone", "Tom de voz sugerido"],
  ["personality", "Personalidade da marca"],
  ["contentPillars", "Pilares de conteúdo"],
  ["visualDirection", "Direção visual"],
  ["differentiators", "Diferenciais percebidos"],
  ["avoid", "O que evitar"],
  ["missingInfo", "Informações que ainda estão faltando"],
];

function normalizeBrandDocument(raw: unknown): BrandDocument {
  if (raw && typeof raw === "object" && "blocks" in raw) return raw as BrandDocument;
  return { status: "empty", source: "", blocks: {}, generatedAt: null, approvedAt: null };
}

function BrandDocumentSection({
  title,
  blockDefs,
  doc,
  onApprove,
  busy,
}: {
  title: string;
  blockDefs: Array<[string, string]>;
  doc: BrandDocument;
  onApprove: () => void;
  busy: boolean;
}) {
  const hasContent = Object.keys(doc.blocks).length > 0;
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span style={{ color: "var(--muted)" }}>{doc.status}</span>
      </div>
      {!hasContent ? <p>Ainda não gerado localmente.</p> : null}
      {blockDefs.map(([id, label]) => {
        const block = doc.blocks[id];
        if (!block) return null;
        return (
          <div key={id}>
            <strong>{label}</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{block.text || "(vazio)"}</p>
          </div>
        );
      })}
      {hasContent && doc.status !== "approved" ? (
        <button type="button" className="primary" onClick={onApprove} disabled={busy}>
          Aprovar
        </button>
      ) : null}
    </section>
  );
}

export function Company() {
  const { projectId } = useParams<{ projectId: string }>();
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [brandXray, setBrandXray] = useState<BrandDocument | null>(null);
  const [brandBriefing, setBrandBriefing] = useState<BrandDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("company_profile, brand_xray, brand_briefing")
      .eq("id", projectId)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setProfile({ ...EMPTY_PROFILE, ...(data.company_profile || {}) });
    setBrandXray(normalizeBrandDocument(data.brand_xray));
    setBrandBriefing(normalizeBrandDocument(data.brand_briefing));
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function updateField(key: keyof CompanyProfile, value: string) {
    if (key === "tone" || key === "contentGoals") {
      setProfile((prev) => ({ ...prev, [key]: value.split(",").map((v) => v.trim()).filter(Boolean) }));
    } else {
      setProfile((prev) => ({ ...prev, [key]: value }));
    }
  }

  async function saveProfile() {
    setBusy(true);
    const { error: updateError } = await supabase.from("projects").update({ company_profile: profile }).eq("id", projectId);
    if (updateError) setError(updateError.message);
    setBusy(false);
  }

  async function approveXray() {
    if (!brandXray) return;
    setBusy(true);
    const approved = approveBrandDocument(brandXray);
    const { error: updateError } = await supabase.from("projects").update({ brand_xray: approved }).eq("id", projectId);
    if (updateError) {
      setError(updateError.message);
    } else {
      setBrandXray(approved);
    }
    setBusy(false);
  }

  async function approveBriefing() {
    if (!brandBriefing) return;
    setBusy(true);
    const approved = approveBrandDocument(brandBriefing);
    const { error: updateError } = await supabase.from("projects").update({ brand_briefing: approved }).eq("id", projectId);
    if (updateError) {
      setError(updateError.message);
    } else {
      setBrandBriefing(approved);
    }
    setBusy(false);
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded || !brandXray || !brandBriefing) return <div className="card">Carregando...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Empresa</h2>
        <span className="step">coleta rápida</span>
      </div>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Perfil</h2>
        <div>
          <label>Foco comercial</label>
          <select
            value={profile.audienceType}
            onChange={(e) => updateField("audienceType", e.target.value)}
            style={{ width: "100%" }}
          >
            {AUDIENCE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {PROFILE_FIELDS.map(({ key, label, multiline }) => (
          <div key={key}>
            <label htmlFor={`field-${key}`}>{label}</label>
            {multiline ? (
              <textarea
                id={`field-${key}`}
                rows={3}
                value={profile[key] as string}
                onChange={(e) => updateField(key, e.target.value)}
              />
            ) : (
              <input
                id={`field-${key}`}
                type="text"
                value={profile[key] as string}
                onChange={(e) => updateField(key, e.target.value)}
              />
            )}
          </div>
        ))}
        <div>
          <label htmlFor="field-tone">Tom de voz (separado por vírgula)</label>
          <input id="field-tone" type="text" value={profile.tone.join(", ")} onChange={(e) => updateField("tone", e.target.value)} />
        </div>
        <div>
          <label htmlFor="field-contentGoals">Interesses / objetivos das postagens (separado por vírgula)</label>
          <input
            id="field-contentGoals"
            type="text"
            value={profile.contentGoals.join(", ")}
            onChange={(e) => updateField("contentGoals", e.target.value)}
          />
        </div>
        <button type="button" className="primary" onClick={saveProfile} disabled={busy}>
          Salvar perfil
        </button>
      </section>

      <BrandDocumentSection title="Raio-X de marca" blockDefs={BRAND_XRAY_BLOCKS} doc={brandXray} onApprove={approveXray} busy={busy} />
      <BrandDocumentSection title="Briefing" blockDefs={BRAND_BRIEFING_BLOCKS} doc={brandBriefing} onApprove={approveBriefing} busy={busy} />
    </div>
  );
}
