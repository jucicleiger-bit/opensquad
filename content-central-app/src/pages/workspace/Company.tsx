import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  AUDIENCE_TYPE_LABELS,
  BRAND_XRAY_BLOCK_IDS,
  BRAND_XRAY_BLOCK_LABELS,
  CONTENT_GOAL_LABELS,
  analyzeBrandXray,
  analyzeSite,
  analyzeTechnicalBase,
  approveBrandXray,
  saveBrandInput,
  saveOffer,
  type BrandXrayBlockId,
  type SiteOfferCandidate,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

const REQUIRED_MESSAGE = "Preencha nome, segmento e o que a empresa vende/oferece.";
const SEGMENT_TREE = [
  { group: "Alimentício", categories: ["Hamburgueria", "Pizzaria", "Espetaria", "Restaurante", "Açaí / sorveteria", "Padaria / confeitaria"] },
  { group: "Negócios locais e lojas", categories: ["Casa de embalagem", "Papelaria", "Aviamentos", "Loja de roupas", "Mercado / mercearia", "Material de construção"] },
  { group: "Engenharia", categories: ["Controle tecnológico / concreto / solos / asfalto", "Construção civil / obras", "Geotecnia e fundações", "Projetos e consultoria", "Topografia"] },
  { group: "Saúde e estética", categories: ["Clínica odontológica", "Estética facial/corporal", "Barbearia", "Salão de beleza", "Clínica médica"] },
  { group: "Educação", categories: ["Curso livre", "Escola profissionalizante", "Aulas particulares", "Treinamento corporativo"] },
  { group: "Serviços profissionais", categories: ["Contabilidade", "Advocacia", "Marketing / agência", "Imobiliária", "Consultoria"] },
];

const SEGMENT_GROUP_OPTIONS = SEGMENT_TREE.map((item) => item.group);
const ALL_SEGMENT_CATEGORY_OPTIONS = [...new Set(SEGMENT_TREE.flatMap((item) => item.categories))];

export function Company() {
  const { project, refreshProject } = useOutletContext<WorkspaceContext>();
  const [form, setForm] = useState(() => ({
    brandName: project.brandInput?.brandName || project.name || "",
    segmentGroup: project.brandInput?.segmentGroup || "",
    segmentCategory: project.brandInput?.segmentCategory || "",
    segmentSpecialty: project.brandInput?.segmentSpecialty || "",
    segment: project.brandInput?.segment || "",
    productsOrServices: project.brandInput?.productsOrServices || "",
    description: project.brandInput?.description || "",
    serviceRegion: project.brandInput?.serviceRegion || "",
    mainDifferential: project.brandInput?.mainDifferential || "",
    contentGoals: project.brandInput?.contentGoals || ([] as string[]),
    audience: project.brandInput?.audience || "",
    audienceType: (project.brandInput?.audienceType || "") as "" | "b2b" | "b2c",
    tone: project.brandInput?.tone || ([] as string[]),
    avoid: project.brandInput?.avoid || "",
    positioning: project.brandInput?.positioning || "",
    brandColors: project.brandInput?.brandColors || "",
    factualConstraints: project.brandInput?.factualConstraints || "",
    websiteOrInstagram: project.brandInput?.websiteOrInstagram || "",
  }));
  const [blockEdits, setBlockEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [technicalText, setTechnicalText] = useState(project.technicalBase?.sourceText || "");
  const [technicalBusy, setTechnicalBusy] = useState(false);

  const [importMode, setImportMode] = useState<"url" | "text">("url");
  const [siteUrl, setSiteUrl] = useState("");
  const [siteText, setSiteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [offerCandidates, setOfferCandidates] = useState<SiteOfferCandidate[] | null>(null);
  const [selectedOffers, setSelectedOffers] = useState<Set<number>>(new Set());
  const [addingOffers, setAddingOffers] = useState(false);

  useEffect(() => {
    const next: Record<string, string> = {};
    BRAND_XRAY_BLOCK_IDS.forEach((id) => {
      next[id] = project.brandXray?.blocks?.[id]?.text || "";
    });
    setBlockEdits(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.projectId, project.brandXray?.generatedAt]);

  function toggleGoal(id: string) {
    setForm((f) => ({
      ...f,
      contentGoals: f.contentGoals.includes(id) ? f.contentGoals.filter((g) => g !== id) : [...f.contentGoals, id],
    }));
  }

  function toggleOfferSelected(index: number) {
    setSelectedOffers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function validateRequired() {
    if (!form.brandName.trim() || !form.segment.trim() || !form.productsOrServices.trim()) {
      setError(REQUIRED_MESSAGE);
      return false;
    }
    return true;
  }

  async function handleImportSite() {
    if (importMode === "url" && !siteUrl.trim()) {
      setImportError("Cole a URL do site.");
      return;
    }
    if (importMode === "text" && !siteText.trim()) {
      setImportError("Cole o texto do site/cardápio.");
      return;
    }
    setImporting(true);
    setImportError(null);
    setMessage(null);
    try {
      const result = await analyzeSite(
        project.projectId,
        importMode === "url" ? { url: siteUrl.trim() } : { text: siteText.trim() },
      );
      setForm((f) => ({
        ...f,
        brandName: result.brandInput.brandName || f.brandName,
        segmentGroup: result.brandInput.segmentGroup || f.segmentGroup,
        segmentCategory: result.brandInput.segmentCategory || f.segmentCategory,
        segmentSpecialty: result.brandInput.segmentSpecialty || f.segmentSpecialty,
        segment: result.brandInput.segment || f.segment,
        productsOrServices: result.brandInput.productsOrServices || f.productsOrServices,
        description: result.brandInput.description || f.description,
        serviceRegion: result.brandInput.serviceRegion || f.serviceRegion,
        mainDifferential: result.brandInput.mainDifferential || f.mainDifferential,
      }));
      setOfferCandidates(result.offers);
      setSelectedOffers(new Set(result.offers.map((_, index) => index)));
      setMessage(
        result.offers.length
          ? `Site analisado — ${result.offers.length} item(ns) de cardápio encontrados, revise abaixo.`
          : "Site analisado e informações preenchidas. Confira os campos antes de salvar.",
      );
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function handleAddOffers() {
    if (!offerCandidates) return;
    setAddingOffers(true);
    setImportError(null);
    try {
      const toAdd = offerCandidates.filter((_, index) => selectedOffers.has(index));
      for (const offer of toAdd) {
        await saveOffer(project.projectId, { name: offer.name, type: "offer", price: offer.price, items: offer.items });
      }
      await refreshProject();
      setOfferCandidates(null);
      setSelectedOffers(new Set());
      setMessage(`${toAdd.length} oferta(s) adicionada(s) em "Ofertas e assuntos".`);
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setAddingOffers(false);
    }
  }

  async function handleSave() {
    if (!validateRequired()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveBrandInput(project.projectId, form);
      await refreshProject();
      setMessage("Informações salvas.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAnalyze() {
    if (!validateRequired()) return;
    setAnalyzing(true);
    setError(null);
    setMessage(null);
    try {
      await analyzeBrandXray(project.projectId, form);
      await refreshProject();
      setMessage("Raio-X da marca gerado.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setError(null);
    setMessage(null);
    try {
      await approveBrandXray(project.projectId, blockEdits as Partial<Record<BrandXrayBlockId, string>>);
      await refreshProject();
      setMessage("Raio-X aprovado e pronto para gerar conteúdos.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApproving(false);
    }
  }

  async function handleAnalyzeTechnicalBase() {
    if (!technicalText.trim()) {
      setError("Cole um texto técnico antes de resumir.");
      return;
    }
    setTechnicalBusy(true);
    setError(null);
    setMessage(null);
    try {
      await analyzeTechnicalBase(project.projectId, technicalText);
      await refreshProject();
      setMessage("Base técnica resumida e salva para este segmento.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTechnicalBusy(false);
    }
  }

  const hasBlocks = Object.keys(project.brandXray?.blocks || {}).length > 0;
  const categoryOptions = SEGMENT_TREE.find((item) => item.group === form.segmentGroup)?.categories || ALL_SEGMENT_CATEGORY_OPTIONS;

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Empresa / Raio-X</h2>

      <Card style={{ padding: 20, marginBottom: 20 }}>
        <b>Importar do site</b>
        <p className="muted" style={{ marginTop: 4 }}>
          Informe o site ou cardápio digital da empresa — a IA lê e preenche os campos abaixo. Quando der pra acessar a URL
          principal, o sistema também segue automaticamente pra páginas internas relevantes (Sobre, Cardápio, Serviços). Se
          encontrar uma lista de produtos/preços, também sugere ofertas prontas para revisar.
        </p>

        <div className="button-row" style={{ marginTop: 10, marginBottom: 4 }}>
          <Button type="button" variant={importMode === "url" ? "primary" : "secondary"} onClick={() => setImportMode("url")}>
            Da URL
          </Button>
          <Button type="button" variant={importMode === "text" ? "primary" : "secondary"} onClick={() => setImportMode("text")}>
            Colar texto
          </Button>
        </div>

        {importMode === "url" ? (
          <div className="row" style={{ alignItems: "end" }}>
            <div>
              <label htmlFor="site-url">URL do site ou cardápio</label>
              <input
                id="site-url"
                placeholder="https://..."
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
              />
            </div>
            <Button variant="secondary" disabled={importing} onClick={handleImportSite}>
              {importing ? "Analisando..." : "Analisar site"}
            </Button>
          </div>
        ) : (
          <div>
            <label htmlFor="site-text">Texto do site/cardápio</label>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              Útil quando o site bloqueia acesso automático (ex: proteção Cloudflare) mas você consegue abrir normalmente —
              abra o site, selecione e copie o conteúdo, e cole aqui.
            </p>
            <textarea
              id="site-text"
              placeholder="Cole aqui o texto copiado do site ou cardápio..."
              value={siteText}
              onChange={(e) => setSiteText(e.target.value)}
              style={{ minHeight: 140 }}
            />
            <Button variant="secondary" className="full-width" style={{ marginTop: 8 }} disabled={importing} onClick={handleImportSite}>
              {importing ? "Analisando..." : "Analisar texto"}
            </Button>
          </div>
        )}
        {importError ? <div className="pill bad" style={{ marginTop: 12 }}>{importError}</div> : null}

        {offerCandidates && offerCandidates.length > 0 ? (
          <div className="field-card" style={{ marginTop: 14 }}>
            <b>Itens encontrados no site</b>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {offerCandidates.map((offer, index) => (
                <label key={`${offer.name}-${index}`} className="pill" style={{ width: "max-content" }}>
                  <input
                    type="checkbox"
                    checked={selectedOffers.has(index)}
                    onChange={() => toggleOfferSelected(index)}
                  />
                  {offer.name}
                  {offer.price ? ` — ${offer.price}` : ""}
                </label>
              ))}
            </div>
            <Button className="full-width" style={{ marginTop: 12 }} disabled={addingOffers || selectedOffers.size === 0} onClick={handleAddOffers}>
              {addingOffers ? "Adicionando..." : `Adicionar selecionados como ofertas (${selectedOffers.size})`}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card style={{ padding: 20 }}>
        <label htmlFor="brand-name">Nome da empresa</label>
        <input id="brand-name" value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} />

        <div className="row">
          <div>
            <label htmlFor="brand-segment-group">Setor principal</label>
            <input
              id="brand-segment-group"
              list="brand-segment-group-options"
              placeholder="ex: Engenharia, Alimentício, Negócios locais e lojas"
              value={form.segmentGroup}
              onChange={(e) => setForm({ ...form, segmentGroup: e.target.value, segmentCategory: "" })}
            />
            <datalist id="brand-segment-group-options">
              {SEGMENT_GROUP_OPTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="brand-segment-category">Tipo de negócio / nicho</label>
            <input
              id="brand-segment-category"
              list="brand-segment-category-options"
              placeholder="Escolha uma opção ou digite uma nova"
              value={form.segmentCategory}
              onChange={(e) => setForm({ ...form, segmentCategory: e.target.value })}
            />
            <datalist id="brand-segment-category-options">
              {categoryOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              Se não existir na lista, digite um novo nicho. Ele fica salvo neste projeto e amarra o aprendizado por segmento.
            </p>
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="brand-segment-specialty">Especialidade/subsegmento</label>
            <input
              id="brand-segment-specialty"
              placeholder="ex: CBR, ensaio de solo, embalagem para delivery, pizza rodízio"
              value={form.segmentSpecialty}
              onChange={(e) => setForm({ ...form, segmentSpecialty: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="brand-segment">Segmento detalhado</label>
            <input id="brand-segment" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="brand-region">Região de atendimento</label>
            <input
              id="brand-region"
              value={form.serviceRegion}
              onChange={(e) => setForm({ ...form, serviceRegion: e.target.value })}
            />
          </div>
        </div>

        <label htmlFor="brand-products">O que a empresa vende/oferece</label>
        <textarea
          id="brand-products"
          value={form.productsOrServices}
          onChange={(e) => setForm({ ...form, productsOrServices: e.target.value })}
        />

        <label htmlFor="brand-description">Descrição livre</label>
        <textarea id="brand-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <label htmlFor="brand-differential">Principal diferencial</label>
        <input
          id="brand-differential"
          value={form.mainDifferential}
          onChange={(e) => setForm({ ...form, mainDifferential: e.target.value })}
        />

        <div className="row">
          <div>
            <label htmlFor="brand-audience-type">Foco comercial (opcional)</label>
            <select
              id="brand-audience-type"
              value={form.audienceType}
              onChange={(e) => setForm({ ...form, audienceType: e.target.value as "" | "b2b" | "b2c" })}
            >
              <option value="">Não definido</option>
              {Object.entries(AUDIENCE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="brand-audience">Público-alvo</label>
            <input
              id="brand-audience"
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}
            />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="brand-tone">Tom de voz (separado por vírgula)</label>
            <input
              id="brand-tone"
              placeholder="ex: descontraído, direto, confiável"
              value={form.tone.join(", ")}
              onChange={(e) =>
                setForm({
                  ...form,
                  tone: e.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        </div>

        <label htmlFor="brand-positioning">Posicionamento desejado</label>
        <input
          id="brand-positioning"
          placeholder="ex: opção premium do bairro, sem concorrer por preço"
          value={form.positioning}
          onChange={(e) => setForm({ ...form, positioning: e.target.value })}
        />

        <label htmlFor="brand-avoid">O que a IA nunca deve mencionar/sugerir</label>
        <textarea
          id="brand-avoid"
          placeholder="ex: não citar concorrentes, não usar humor, não falar de entrega própria"
          value={form.avoid}
          onChange={(e) => setForm({ ...form, avoid: e.target.value })}
        />

        <div className="row">
          <div>
            <label htmlFor="brand-colors-desc">Cores da marca (descrição)</label>
            <input
              id="brand-colors-desc"
              placeholder="ex: vermelho e preto"
              value={form.brandColors}
              onChange={(e) => setForm({ ...form, brandColors: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="brand-website">Site/Instagram</label>
            <input
              id="brand-website"
              placeholder="@usuario ou https://..."
              value={form.websiteOrInstagram}
              onChange={(e) => setForm({ ...form, websiteOrInstagram: e.target.value })}
            />
          </div>
        </div>

        <label htmlFor="brand-facts">Fatos que podem ser citados (preços, prêmios, tempo de mercado etc.)</label>
        <textarea
          id="brand-facts"
          placeholder="ex: fundada em 2015, entrega em até 40 minutos, prêmio Melhor Pizzaria 2025"
          value={form.factualConstraints}
          onChange={(e) => setForm({ ...form, factualConstraints: e.target.value })}
        />

        <label>Objetivos do conteúdo</label>
        <div className="button-row">
          {Object.entries(CONTENT_GOAL_LABELS).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              variant={form.contentGoals.includes(id) ? "primary" : "secondary"}
              onClick={() => toggleGoal(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="button-row" style={{ marginTop: 16 }}>
          <Button variant="secondary" disabled={saving} onClick={handleSave}>
            {saving ? "Salvando..." : "Salvar informações"}
          </Button>
          <Button disabled={analyzing} onClick={handleAnalyze}>
            {analyzing ? "Analisando..." : "Analisar minha marca"}
          </Button>
        </div>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
        {message ? <div className="pill ok" style={{ marginTop: 12 }}>{message}</div> : null}
      </Card>

      <Card style={{ padding: 20, marginTop: 20 }}>
        <b>Base técnica do segmento</b>
        <p className="muted" style={{ marginTop: 4 }}>
          Cole normas, modelos de laudo, lista de ensaios ou explicações do setor. A IA transforma em um resumo prático curto para não precisar reaprender tudo a cada arte.
        </p>
        <textarea
          aria-label="Texto técnico para aprendizado"
          placeholder="Ex: CBR/ISC para pavimentação; limite de liquidez e plasticidade para caracterização de solos; não misturar ensaio de solo com ensaio de concreto..."
          value={technicalText}
          onChange={(e) => setTechnicalText(e.target.value)}
          style={{ minHeight: 150 }}
        />
        <Button className="full-width" style={{ marginTop: 10 }} disabled={technicalBusy} onClick={handleAnalyzeTechnicalBase}>
          {technicalBusy ? "Resumindo..." : "Analisar e salvar resumo prático"}
        </Button>
        {project.technicalBase?.summary ? (
          <div className="field-card" style={{ marginTop: 14 }}>
            <b>Resumo prático salvo</b>
            <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{project.technicalBase.summary}</p>
          </div>
        ) : null}
      </Card>

      {hasBlocks ? (
        <Card style={{ padding: 20, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <b>Raio-X da marca</b>
            <span className="pill">{project.brandXray?.status}</span>
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            {BRAND_XRAY_BLOCK_IDS.map((id) => {
              const block = project.brandXray?.blocks?.[id];
              return (
                <div key={id} className="field-card">
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <b>{BRAND_XRAY_BLOCK_LABELS[id]}</b>
                    <span className="pill">{block?.status || "gerado"}</span>
                  </div>
                  <textarea
                    aria-label={BRAND_XRAY_BLOCK_LABELS[id]}
                    value={blockEdits[id] || ""}
                    onChange={(e) => setBlockEdits({ ...blockEdits, [id]: e.target.value })}
                    style={{ minHeight: 160 }}
                  />
                </div>
              );
            })}
          </div>
          <Button className="full-width" style={{ marginTop: 14 }} disabled={approving} onClick={handleApprove}>
            {approving ? "Aprovando..." : "Usar este Raio-X"}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
