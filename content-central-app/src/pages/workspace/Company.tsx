import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  AUDIENCE_TYPE_LABELS,
  BRAND_XRAY_STRATEGIC_BLOCK_IDS,
  BRAND_XRAY_BLOCK_LABELS,
  CONTENT_GOAL_LABELS,
  GOAL_WEIGHT_BUCKET_KEYS,
  analyzeBrandXray,
  analyzeSite,
  approveBrandXray,
  saveOffer,
  SEGMENT_TREE,
  type BrandXrayBlockId,
  type BrandXrayFieldSuggestion,
  type BrandXraySuggestionField,
  type SiteOfferCandidate,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

const REQUIRED_MESSAGE = "Preencha nome, segmento e o que a empresa vende/oferece.";

const SEGMENT_GROUP_OPTIONS = SEGMENT_TREE.map((item) => item.group);
const ALL_SEGMENT_CATEGORY_OPTIONS = [...new Set(SEGMENT_TREE.flatMap((item) => item.categories))];

const XRAY_SOURCE_LABELS: Record<string, string> = {
  ai_analysis: "análise por IA",
  structured_fallback: "pré-análise local",
  inferred_hypothesis: "hipótese para confirmar",
  user_input: "informado pela empresa",
};

const XRAY_SUGGESTION_FIELDS = new Set<BrandXraySuggestionField>([
  "audience",
  "description",
  "mainDifferential",
  "positioning",
  "tone",
  "segment",
]);

const XRAY_CONFIDENCE_LABELS: Record<string, string> = {
  high: "confiança alta",
  medium: "confiança média",
  low: "confiança baixa",
};

function isSafeFieldSuggestion(suggestion: BrandXrayFieldSuggestion) {
  return XRAY_SUGGESTION_FIELDS.has(suggestion.field);
}

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
    contentGoalWeights: project.brandInput?.contentGoalWeights || ({} as Record<string, number>),
    audience: project.brandInput?.audience || "",
    audienceType: (project.brandInput?.audienceType || "") as "" | "b2b" | "b2c" | "mixed",
    tone: project.brandInput?.tone || ([] as string[]),
    avoid: project.brandInput?.avoid || "",
    positioning: project.brandInput?.positioning || "",
    brandColors: project.brandInput?.brandColors || "",
    factualConstraints: project.brandInput?.factualConstraints || "",
    websiteOrInstagram: project.brandInput?.websiteOrInstagram || "",
  }));
  const [blockEdits, setBlockEdits] = useState<Record<string, string>>({});
  const [suggestionEdits, setSuggestionEdits] = useState<Record<string, string>>({});
  const [suggestionOriginalValues, setSuggestionOriginalValues] = useState<Record<string, string>>({});
  const [selectedSuggestionFields, setSelectedSuggestionFields] = useState<Set<BrandXraySuggestionField>>(new Set());
  const [ignoredSuggestionFields, setIgnoredSuggestionFields] = useState<Set<BrandXraySuggestionField>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [savingSuggestions, setSavingSuggestions] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    BRAND_XRAY_STRATEGIC_BLOCK_IDS.forEach((id) => {
      next[id] = project.brandXray?.blocks?.[id]?.text || "";
    });
    setBlockEdits(next);
    const nextSuggestions: Record<string, string> = {};
    (project.brandXray?.fieldSuggestions || []).filter(isSafeFieldSuggestion).forEach((suggestion) => {
      nextSuggestions[suggestion.field] = suggestion.value;
    });
    setSuggestionEdits(nextSuggestions);
    setSuggestionOriginalValues({});
    setSelectedSuggestionFields(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.projectId, project.brandXray?.generatedAt]);

  useEffect(() => {
    setIgnoredSuggestionFields(new Set());
  }, [project.projectId]);

  function toggleGoal(id: string) {
    setForm((f) => ({
      ...f,
      contentGoals: f.contentGoals.includes(id) ? f.contentGoals.filter((g) => g !== id) : [...f.contentGoals, id],
    }));
  }

  function evenSplit(count: number): number[] {
    const base = Math.floor(100 / count);
    const remainder = 100 - base * count;
    return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
  }

  function activeGoalWeightBuckets(): string[] {
    const hasActiveOffers = (project.contentStrategy?.offers || []).some((offer) => offer.active);
    const goalBucketKeys = form.contentGoals.filter((id) => GOAL_WEIGHT_BUCKET_KEYS.includes(id));
    return hasActiveOffers ? ["sales", ...goalBucketKeys] : goalBucketKeys;
  }

  function resolvedGoalWeights(bucketKeys: string[]): Record<string, number> {
    // Once every bucket has an entered value, show/save it as-is (even when
    // it doesn't sum to 100 — that's what lets the UI display and block on
    // an imbalance). Only fall back to an even split while some bucket has
    // never been touched yet.
    const known = bucketKeys.filter((key) => Number.isFinite(form.contentGoalWeights[key]));
    if (known.length === bucketKeys.length) return form.contentGoalWeights;
    const defaults = evenSplit(bucketKeys.length);
    return Object.fromEntries(bucketKeys.map((key, i) => [key, defaults[i]]));
  }

  function setGoalWeight(bucketKeys: string[], key: string, value: number) {
    const resolved = resolvedGoalWeights(bucketKeys);
    setForm((f) => ({ ...f, contentGoalWeights: { ...resolved, [key]: value } }));
  }

  // resolvedGoalWeights trusts whatever is stored once every current bucket
  // has a value — including an invalid sum, so Save can disable on it. But
  // that means it can't tell "same buckets, user typed a bad sum" apart from
  // "the bucket set itself just changed" (a goal was toggled on/off). Only
  // the latter should force a fresh even split, per spec ("toggling a goal
  // off... rebalances the remaining sum back to a valid default"). Track the
  // previous bucket-key set and reset only when it actually changes.
  const bucketKeysKey = activeGoalWeightBuckets().join(",");
  const prevBucketKeysKeyRef = useRef(bucketKeysKey);
  useEffect(() => {
    if (bucketKeysKey === prevBucketKeysKeyRef.current) return;
    prevBucketKeysKeyRef.current = bucketKeysKey;
    if (!bucketKeysKey) return;
    const bucketKeys = bucketKeysKey.split(",");
    const defaults = evenSplit(bucketKeys.length);
    setForm((f) => ({ ...f, contentGoalWeights: Object.fromEntries(bucketKeys.map((key, i) => [key, defaults[i]])) }));
  }, [bucketKeysKey]);

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

  async function handleAnalyze() {
    if (!validateRequired()) return;
    setIgnoredSuggestionFields(new Set());
    setAnalyzing(true);
    setError(null);
    setMessage(null);
    try {
      await analyzeBrandXray(project.projectId, brandPayload);
      await refreshProject();
      setMessage("Raio-X da marca gerado.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleApprove() {
    if (selectedSuggestionFields.size > 0) {
      setError("Salve as sugestões escolhidas antes de aprovar a estratégia.");
      return;
    }
    setApproving(true);
    setError(null);
    setMessage(null);
    try {
      await approveBrandXray(project.projectId, blockEdits as Partial<Record<BrandXrayBlockId, string>>);
      await refreshProject();
      setMessage("Estratégia da marca aprovada.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApproving(false);
    }
  }

  function assignSuggestionToForm(field: BrandXraySuggestionField, value: string) {
    setForm((current) => {
      switch (field) {
        case "audience":
          return { ...current, audience: value };
        case "description":
          return { ...current, description: value };
        case "mainDifferential":
          return { ...current, mainDifferential: value };
        case "positioning":
          return { ...current, positioning: value };
        case "tone":
          return {
            ...current,
            tone: value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          };
        case "segment":
          return { ...current, segment: value };
      }
    });
  }

  function handleUseSuggestion(field: BrandXraySuggestionField) {
    const value = (suggestionEdits[field] || "").trim();
    if (!value) {
      setError("A sugestão precisa ter um texto antes de ser usada.");
      return;
    }
    if (!selectedSuggestionFields.has(field)) {
      const originalValue = field === "tone" ? form.tone.join(", ") : form[field];
      setSuggestionOriginalValues((current) => ({ ...current, [field]: originalValue }));
    }
    assignSuggestionToForm(field, value);
    setSelectedSuggestionFields((current) => new Set(current).add(field));
    setIgnoredSuggestionFields((current) => {
      const next = new Set(current);
      next.delete(field);
      return next;
    });
    setError(null);
    setMessage(null);
  }

  function handleSuggestionEdit(field: BrandXraySuggestionField, value: string) {
    setSuggestionEdits((current) => ({ ...current, [field]: value }));
    if (selectedSuggestionFields.has(field)) assignSuggestionToForm(field, value);
  }

  function handleIgnoreSuggestion(field: BrandXraySuggestionField) {
    if (selectedSuggestionFields.has(field) && Object.prototype.hasOwnProperty.call(suggestionOriginalValues, field)) {
      assignSuggestionToForm(field, suggestionOriginalValues[field]);
    }
    setIgnoredSuggestionFields((current) => new Set(current).add(field));
    setSelectedSuggestionFields((current) => {
      const next = new Set(current);
      next.delete(field);
      return next;
    });
    setSuggestionOriginalValues((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setError(null);
  }

  async function handleSaveSuggestions() {
    if (selectedSuggestionFields.size === 0 || !validateRequired()) return;
    setSavingSuggestions(true);
    setError(null);
    setMessage(null);
    try {
      await analyzeBrandXray(project.projectId, brandPayload);
      await refreshProject();
      setMessage("Sugestões salvas e Raio-X atualizado.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingSuggestions(false);
    }
  }

  const hasBlocks = BRAND_XRAY_STRATEGIC_BLOCK_IDS.some((id) => Boolean(project.brandXray?.blocks?.[id]?.text));
  const categoryOptions = SEGMENT_TREE.find((item) => item.group === form.segmentGroup)?.categories || ALL_SEGMENT_CATEGORY_OPTIONS;
  const visibleSuggestions = (project.brandXray?.fieldSuggestions || [])
    .filter(isSafeFieldSuggestion)
    .filter((suggestion) => !ignoredSuggestionFields.has(suggestion.field));

  // Single source of truth for the goal-weight derivation, reused by both
  // save paths (handleAnalyze and handleSaveSuggestions) and both render
  // spots (the weight editor and the two Save buttons' disabled state) —
  // used to independently recompute this in 4 places, which let
  // handleSaveSuggestions drift and send raw, unvalidated form.contentGoalWeights.
  const weightBuckets = activeGoalWeightBuckets();
  const weightValues = resolvedGoalWeights(weightBuckets);
  const weightSum = weightBuckets.reduce((total, key) => total + (weightValues[key] || 0), 0);
  const weightsInvalid = weightBuckets.length >= 2 && weightSum !== 100;
  const brandPayload = { ...form, contentGoalWeights: weightBuckets.length >= 2 ? weightValues : {} };

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-2xs)" }}>Empresa / Raio-X</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20, maxWidth: 760 }}>
        Cadastre os fatos da empresa, escolha os objetivos e gere a leitura estratégica da marca. A direção visual fica na aba Imagem.
      </p>

      <details className="field-card" style={{ padding: 16, marginBottom: 20 }}>
        <summary style={{ cursor: "pointer", fontWeight: 750 }}>Preencher automaticamente por site ou texto</summary>
        <div style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Recurso opcional para o primeiro cadastro. Você revisa tudo antes de analisar a marca.
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
        </div>
      </details>

      <Card style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Informações da empresa</h3>
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
              onChange={(e) => setForm({ ...form, audienceType: e.target.value as "" | "b2b" | "b2c" | "mixed" })}
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

        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Setor, nicho e especialidade ligam este projeto ao aprendizado externo por segmento. O Raio-X usa essa
          classificação como informação confirmada e não a altera.
        </p>

        <label htmlFor="brand-website">Instagram ou site</label>
        <input
          id="brand-website"
          placeholder="@usuario ou https://..."
          value={form.websiteOrInstagram}
          onChange={(e) => setForm({ ...form, websiteOrInstagram: e.target.value })}
        />
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Informação usada para identificar a marca nos criativos. O Raio-X não acessa nem analisa o perfil automaticamente.
        </p>

        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Orientações avançadas (opcional)</summary>
          <div style={{ marginTop: 12 }}>
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

          <label htmlFor="brand-facts">Fatos que podem ser citados (preços, prêmios, tempo de mercado etc.)</label>
          <textarea
            id="brand-facts"
            placeholder="ex: fundada em 2015, entrega em até 40 minutos, prêmio Melhor Pizzaria 2025"
            value={form.factualConstraints}
            onChange={(e) => setForm({ ...form, factualConstraints: e.target.value })}
          />
        </details>

        <h3 style={{ margin: "24px 0 4px" }}>O que a marca quer publicar</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Esses objetivos entram no planejamento junto das ofertas e assuntos cadastrados.
        </p>
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

        {weightBuckets.length >= 2 ? (
          <div className="field-card" style={{ marginTop: 14 }}>
            <b>Peso de cada meta na geração de conteúdo</b>
            <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
              Controla a proporção entre venda e as demais metas em toda geração (inclusive por grupo de ofertas),
              exceto quando "gerar apenas esse grupo" estiver marcado.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {weightBuckets.map((key) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label htmlFor={`goal-weight-${key}`} style={{ flex: 1 }}>
                    {key === "sales" ? "Venda" : CONTENT_GOAL_LABELS[key]}
                  </label>
                  <input
                    id={`goal-weight-${key}`}
                    aria-label={`Peso: ${key === "sales" ? "Venda" : CONTENT_GOAL_LABELS[key]}`}
                    type="number"
                    min={0}
                    max={100}
                    value={weightValues[key] || 0}
                    onChange={(e) => setGoalWeight(weightBuckets, key, Number(e.target.value) || 0)}
                    style={{ width: 80 }}
                  />
                  <span className="muted">%</span>
                </div>
              ))}
            </div>
            {weightSum !== 100 ? (
              <div className="pill bad" style={{ marginTop: 10 }}>
                O total dos pesos soma {weightSum}%. Ajuste até fechar 100%.
              </div>
            ) : null}
          </div>
        ) : null}

        <Button
          className="full-width"
          style={{ marginTop: 18 }}
          disabled={analyzing || weightsInvalid}
          onClick={handleAnalyze}
        >
          {analyzing ? "Salvando e analisando..." : "Salvar e analisar minha marca"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
        {message ? <div className="pill ok" style={{ marginTop: 12 }}>{message}</div> : null}
      </Card>

      {hasBlocks ? (
        <Card style={{ padding: 20, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <b>Estratégia sugerida pelo Raio-X</b>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Revise as hipóteses abaixo. A identidade visual continua sendo definida na aba Imagem.
              </p>
            </div>
            <span className="pill">{project.brandXray?.status}</span>
          </div>
          <div className={`pill ${project.brandXray?.analysisMode === "ai" ? "ok" : ""}`} style={{ marginBottom: 14 }}>
            {project.brandXray?.analysisMode === "ai"
              ? "Análise estratégica feita pela IA."
              : "Pré-análise local: a IA não respondeu nesta execução. Confirme as hipóteses antes de aprovar."}
          </div>
          {visibleSuggestions.length > 0 ? (
            <section aria-labelledby="xray-suggestions-title" style={{ marginBottom: 22, paddingBottom: 18, borderBottom: "1px solid var(--line)" }}>
              <h3 id="xray-suggestions-title" style={{ margin: "0 0 4px" }}>Campos que a IA sugere completar</h3>
              <p className="muted" style={{ margin: "0 0 14px", fontSize: 13 }}>
                São hipóteses, não fatos. Edite o texto, escolha apenas o que fizer sentido e salve antes de aprovar o Raio-X.
              </p>
              <div style={{ display: "grid", gap: 0 }}>
                {visibleSuggestions.map((suggestion, index) => {
                  const isSelected = selectedSuggestionFields.has(suggestion.field);
                  return (
                    <div
                      key={suggestion.field}
                      style={{ padding: "14px 0", borderTop: index === 0 ? "none" : "1px solid var(--line)" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, marginBottom: 8 }}>
                        <label htmlFor={`xray-suggestion-${suggestion.field}`} style={{ margin: 0 }}>{suggestion.label}</label>
                        <div className="button-row" style={{ margin: 0 }}>
                          <span className="pill">{XRAY_SOURCE_LABELS[suggestion.source || ""] || "sugestão da análise"}</span>
                          <span className="pill">{XRAY_CONFIDENCE_LABELS[suggestion.confidence || ""] || "confirmar"}</span>
                        </div>
                      </div>
                      <textarea
                        id={`xray-suggestion-${suggestion.field}`}
                        value={suggestionEdits[suggestion.field] || ""}
                        onChange={(event) => handleSuggestionEdit(suggestion.field, event.target.value)}
                        style={{ minHeight: 92 }}
                      />
                      <p className="muted" style={{ margin: "6px 0 10px", fontSize: 12 }}>
                        Motivo da sugestão: {suggestion.reason}
                      </p>
                      <div className="button-row" style={{ margin: 0 }}>
                        <Button
                          type="button"
                          variant={isSelected ? "primary" : "secondary"}
                          onClick={() => handleUseSuggestion(suggestion.field)}
                        >
                          {isSelected ? `Selecionada: ${suggestion.label}` : `Usar sugestão de ${suggestion.label}`}
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => handleIgnoreSuggestion(suggestion.field)}>
                          Ignorar sugestão de {suggestion.label}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {selectedSuggestionFields.size > 0 ? (
                <Button
                  type="button"
                  className="full-width"
                  style={{ marginTop: 12 }}
                  disabled={savingSuggestions || weightsInvalid}
                  onClick={handleSaveSuggestions}
                >
                  {savingSuggestions
                    ? "Salvando e atualizando..."
                    : `Salvar sugestões escolhidas e atualizar o Raio-X (${selectedSuggestionFields.size})`}
                </Button>
              ) : null}
            </section>
          ) : null}
          <div style={{ display: "grid", gap: 14 }}>
            {BRAND_XRAY_STRATEGIC_BLOCK_IDS.map((id) => {
              const block = project.brandXray?.blocks?.[id];
              const sources = block?.sources?.length ? block.sources : block?.source ? [block.source] : [];
              return (
                <div key={id} className="field-card">
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <b>{BRAND_XRAY_BLOCK_LABELS[id]}</b>
                    <div className="button-row" style={{ margin: 0 }}>
                      <span className="pill">{block?.status || "gerado"}</span>
                      {sources.map((source) => (
                        <span className="pill" key={source}>
                          {XRAY_SOURCE_LABELS[source] || source}
                        </span>
                      ))}
                    </div>
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
          <Button
            className="full-width"
            style={{ marginTop: 14 }}
            disabled={approving || selectedSuggestionFields.size > 0}
            onClick={handleApprove}
          >
            {approving ? "Aprovando..." : "Aprovar estratégia da marca"}
          </Button>
          {selectedSuggestionFields.size > 0 ? (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12, textAlign: "center" }}>
              Salve as sugestões escolhidas para atualizar a análise antes da aprovação.
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
