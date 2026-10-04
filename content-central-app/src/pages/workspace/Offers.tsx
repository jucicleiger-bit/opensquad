import { useRef, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  OFFER_TYPE_LABELS,
  OFFER_TYPE_TO_PILLAR_ROLE,
  PILLAR_ROLE_LABELS,
  PRICE_UNIT_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  analyzeSite,
  createOfferDrafts,
  deleteOffer,
  deleteOfferDraft,
  deleteOfferGroup,
  fileToDataUrl,
  saveAsset,
  saveCatalogSettings,
  saveOffer,
  saveOfferGroup,
  suggestOfferDirection,
  type OfferDraft,
  type OfferFlavor,
  type OfferGroup,
  type ProjectOffer,
  type SiteOfferCandidate,
} from "@/api/client";
import { Button } from "@/components/Button";
import { localDateKey, offerUsageText, offerValidityText } from "./offerUsageDisplay";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";

const thumbStyle = {
  width: 64,
  height: 64,
  borderRadius: 8,
  overflow: "hidden",
  flex: "0 0 auto",
  display: "grid",
  placeItems: "center",
  background: "var(--bg-soft)",
  color: "var(--muted)",
  fontSize: 11,
} as const;
const thumbImgStyle = { width: "100%", height: "100%", objectFit: "cover" } as const;
type ProductTreatment = "faithful_enhance" | "faithful_enhance_photo_integration" | "creative_redraw" | "exact_asset";
type BackgroundStyle = "elaborate" | "simple_brand";
type TitleStyle = "clean" | "lettering";
// Mirrors MAX_OFFER_FLAVORS in src/content-central.js.
const MAX_OFFER_FLAVORS = 6;
// `file` is a photo picked in the form but not uploaded yet.
type FlavorRow = OfferFlavor & { file?: File };

const EMPTY_FORM = {
  name: "",
  type: "offer",
  price: "",
  originalPrice: "",
  priceUnit: "",
  items: "",
  cta: "",
  autoGenerateCta: false,
  notes: "",
  pillarId: "",
  groupId: "",
  daysOfWeek: [] as string[],
  validFrom: "",
  validUntil: "",
  sector: "",
  active: true,
  uniqueProposal: false,
  photoReferenceIds: [] as string[],
  flavors: [] as FlavorRow[],
  productTreatment: "faithful_enhance" as ProductTreatment,
  layoutStrength: "strict" as "strict" | "balanced" | "free",
  backgroundStyle: "simple_brand" as BackgroundStyle,
  titleStyle: "lettering" as TitleStyle,
};

function suggestProductDirection(name: string, items: string, isCatalog: boolean) {
  const text = `${name} ${items}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/limp|microfibra|pano|esponja|detergente|desinfetante|rodo|vassoura|saco de lixo/.test(text)) {
    return "Direcionamento: produto de limpeza. Tom prático e direto. Chamada sugerida: Mais praticidade na limpeza do dia a dia. Benefícios permitidos: limpeza prática, multiuso, apoio para casa/carro/cozinha/escritório. Não prometer que não risca, antibacteriano ou qualidade superior sem comprovação.";
  }
  if (/food|marmita|pote|copo|talher|prato|guardanapo|delivery|embalagem|isopor|aluminio/.test(text)) {
    return "Direcionamento: produto para food-service/embalagem. Tom profissional e B2B. Chamada sugerida: Mais praticidade para sua operação. Benefícios permitidos: organização do atendimento, reposição fácil, apresentação profissional, apoio ao balcão/delivery. Não inventar certificação, material, capacidade ou uso térmico não cadastrado.";
  }
  return `Direcionamento: ${isCatalog ? "produto" : "oferta"} comercial. Tom claro e direto. Criar 1 chamada de valor baseada apenas no nome/detalhes cadastrados. Benefícios permitidos: usar somente características escritas neste cadastro. Não inventar garantia, desempenho, material, desconto ou prova não informada.`;
}

export function Offers() {
  const { project, refreshProject } = useOutletContext<WorkspaceContext>();
  const isCatalog = project.projectType === "catalog";
  const offers = project.contentStrategy?.offers || [];
  const sectors = [...new Set(offers.map((offer) => offer.sector?.trim()).filter((sector): sector is string => Boolean(sector)))].sort();
  const today = localDateKey(new Date());
  const pillars = project.contentStrategy?.pillars || [];
  const offerGroups = project.contentStrategy?.offerGroups || [];
  // New offers (manual form or paste-text import) default to the first
  // group instead of landing ungrouped — the first group created in a
  // project is the "Geral"/catch-all bucket by convention, so this is what
  // an operator expects when they've already set groups up. Falls back to
  // "" (no group) for a project that has no groups at all yet.
  const defaultGroupId = offerGroups[0]?.id || "";
  const references = [...(project.offerAssets || []), ...(project.brand?.references || [])];
  // The product list is rendered as one card per group (in the order groups
  // were created), each containing that group's offer cards — instead of a
  // flat list with a "grupo: X" pill on every item. Offers with no group
  // land in a trailing "Sem grupo" section instead of disappearing.
  const offerSections = (() => {
    const byGroupId = new Map<string, ProjectOffer[]>();
    const ungrouped: ProjectOffer[] = [];
    for (const offer of offers) {
      if (offer.groupId) {
        const list = byGroupId.get(offer.groupId) || [];
        list.push(offer);
        byGroupId.set(offer.groupId, list);
      } else {
        ungrouped.push(offer);
      }
    }
    const sections = offerGroups
      .map((group) => ({ groupId: group.id as string | null, groupName: group.name, offers: byGroupId.get(group.id) || [] }))
      .filter((section) => section.offers.length > 0);
    if (ungrouped.length) sections.push({ groupId: null, groupName: "Sem grupo", offers: ungrouped });
    return sections;
  })();
  // Groups start collapsed (just the header + count) — clicking one opens
  // it to show its products, closing whichever group was open before, like
  // stepping into that group instead of scrolling through every product of
  // every group at once.
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  function toggleGroupExpanded(key: string) {
    setExpandedGroupKey((current) => (current === key ? null : key));
  }
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, groupId: defaultGroupId }));
  const [busy, setBusy] = useState(false);
  const [suggestingDirection, setSuggestingDirection] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formCardRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // The create/edit form, the paste-text importer and the photo search are
  // all collapsed behind a toolbar button by default — with dozens of
  // products, having all three expanded at once pushed the actual product
  // list way down the page. Editing an offer opens the form on demand.
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // "Adiantar fotos (lista)" (catalog only): one product per line becomes a
  // draft with photos found online. Drafts wait in "Para revisar" until the
  // operator opens one in the normal form, completes it and saves.
  const offerDrafts = project.contentStrategy?.offerDrafts || [];
  const [draftListOpen, setDraftListOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [creatingDrafts, setCreatingDrafts] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [discardingDraftId, setDiscardingDraftId] = useState<string | null>(null);
  // The draft open in the form; `selected` is the candidate index that will be
  // downloaded on save (-1 = none, use only photos attached from disk).
  const [reviewingDraft, setReviewingDraft] = useState<{ draft: OfferDraft; selected: number } | null>(null);

  // Offer groups (e.g. "Geral", "Black Friday") — organize offers so a
  // specific schedule generation can be scoped to just one group later
  // (see GenerateContent.tsx), without touching each offer's `active` flag.
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [savingComboGroupId, setSavingComboGroupId] = useState<string | null>(null);

  const [generalInfo, setGeneralInfo] = useState(project.contentSettings?.catalogGeneralInfo || "");
  const [generalInfoBusy, setGeneralInfoBusy] = useState(false);
  const [generalInfoMessage, setGeneralInfoMessage] = useState<string | null>(null);

  // Dedicated text-to-offers import — reuses the same siteAnalyze endpoint
  // Company.tsx uses for brand+offer import from a site, but scoped only to
  // offers: paste a product list/description, review the AI's suggested
  // offers, pick which ones become real entries. Brand fields are never
  // touched from here.
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SiteOfferCandidate[] | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());
  const [addingCandidates, setAddingCandidates] = useState(false);

  async function handleCreateDrafts() {
    if (!draftText.trim()) {
      setDraftError("Escreva pelo menos um produto, um por linha.");
      return;
    }
    setCreatingDrafts(true);
    setDraftError(null);
    try {
      await createOfferDrafts(project.projectId, draftText);
      setDraftText("");
      setDraftListOpen(false);
      await refreshProject();
    } catch (err) {
      setDraftError((err as Error).message);
    } finally {
      setCreatingDrafts(false);
    }
  }

  function handleReviewDraft(draft: OfferDraft) {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, groupId: defaultGroupId, name: draft.name, price: draft.price });
    setReviewingDraft({ draft, selected: draft.candidates.length ? 0 : -1 });
    setError(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
    setFormOpen(true);
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDiscardDraft(draftId: string) {
    setDiscardingDraftId(draftId);
    setDraftError(null);
    try {
      await deleteOfferDraft(project.projectId, draftId);
      if (reviewingDraft?.draft.id === draftId) setReviewingDraft(null);
      await refreshProject();
    } catch (err) {
      setDraftError((err as Error).message);
    } finally {
      setDiscardingDraftId(null);
    }
  }

  async function handleAnalyzeText() {
    if (!importText.trim()) {
      setImportError("Cole os dados dos produtos/ofertas primeiro.");
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const result = await analyzeSite(project.projectId, { text: importText.trim() });
      setCandidates(result.offers);
      setSelectedCandidates(new Set(result.offers.map((_, index) => index)));
      if (!result.offers.length) setImportError("Não achei nenhum item reconhecível nesse texto — tenta detalhar mais (nome, preço).");
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  function toggleCandidate(index: number) {
    setSelectedCandidates((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleAddCandidates() {
    if (!candidates) return;
    setAddingCandidates(true);
    setImportError(null);
    try {
      const toAdd = candidates.filter((_, index) => selectedCandidates.has(index));
      for (const offer of toAdd) {
        await saveOffer(project.projectId, {
          name: offer.name,
          type: "offer",
          price: offer.price,
          items: offer.items,
          groupId: defaultGroupId || undefined,
        });
      }
      await refreshProject();
      setCandidates(null);
      setSelectedCandidates(new Set());
      setImportText("");
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setAddingCandidates(false);
    }
  }

  function photoPreviewUrl(photoReferenceId: string) {
    return references.find((reference) => reference.id === photoReferenceId)?.previewUrl || null;
  }

  function updateFlavor(index: number, patch: Partial<FlavorRow>) {
    setForm((current) => ({
      ...current,
      flavors: current.flavors.map((flavor, i) => (i === index ? { ...flavor, ...patch } : flavor)),
    }));
  }

  function removePhoto(photoReferenceId: string) {
    setForm((current) => ({ ...current, photoReferenceIds: current.photoReferenceIds.filter((id) => id !== photoReferenceId) }));
  }

  async function handleSaveGeneralInfo() {
    setGeneralInfoBusy(true);
    setGeneralInfoMessage(null);
    try {
      await saveCatalogSettings(project.projectId, { catalogGeneralInfo: generalInfo });
      await refreshProject();
      setGeneralInfoMessage("Informação geral salva — vai aparecer em todo post daqui pra frente.");
    } catch (err) {
      setGeneralInfoMessage((err as Error).message);
    } finally {
      setGeneralInfoBusy(false);
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) {
      setGroupError("Digite um nome pro grupo.");
      return;
    }
    setCreatingGroup(true);
    setGroupError(null);
    try {
      await saveOfferGroup(project.projectId, { name: newGroupName.trim() });
      await refreshProject();
      setNewGroupName("");
    } catch (err) {
      setGroupError((err as Error).message);
    } finally {
      setCreatingGroup(false);
    }
  }

  function handleStartRenameGroup(group: OfferGroup) {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
    setGroupError(null);
  }

  async function handleSaveGroupName(groupId: string) {
    if (!editingGroupName.trim()) {
      setGroupError("O nome do grupo não pode ficar vazio.");
      return;
    }
    setSavingGroupId(groupId);
    setGroupError(null);
    try {
      await saveOfferGroup(project.projectId, { id: groupId, name: editingGroupName.trim() });
      await refreshProject();
      setEditingGroupId(null);
    } catch (err) {
      setGroupError((err as Error).message);
    } finally {
      setSavingGroupId(null);
    }
  }

  async function handleSaveComboChance(group: OfferGroup, rawValue: string) {
    const parsed = Math.max(0, Math.min(100, Math.round(Number(rawValue)) || 0));
    setSavingComboGroupId(group.id);
    setGroupError(null);
    try {
      await saveOfferGroup(project.projectId, { id: group.id, name: group.name, comboChance: parsed });
      await refreshProject();
    } catch (err) {
      setGroupError((err as Error).message);
    } finally {
      setSavingComboGroupId(null);
    }
  }

  async function handleDeleteGroup(group: OfferGroup) {
    if (!confirm(`Apagar o grupo "${group.name}"? Os produtos dele ficam apenas no histórico e não entram mais nas próximas gerações.`)) return;
    setDeletingGroupId(group.id);
    setGroupError(null);
    try {
      await deleteOfferGroup(project.projectId, group.id);
      await refreshProject();
    } catch (err) {
      setGroupError((err as Error).message);
    } finally {
      setDeletingGroupId(null);
    }
  }

  function toggleFormDay(day: string) {
    setForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((d) => d !== day)
        : [...current.daysOfWeek, day],
    }));
  }

  // Which pillar an offer would resolve to automatically (by type) when no
  // pillarId is set explicitly — the real resolution happens server-side at
  // generation time, this just previews it so "auto" doesn't look inert.
  function autoResolvedPillar(offer: ProjectOffer) {
    if (offer.pillarId) return null;
    const role = OFFER_TYPE_TO_PILLAR_ROLE[offer.type];
    if (!role) return null;
    return pillars.find((pillar) => pillar.role === role && pillar.active !== false) || null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError(isCatalog ? "Nome do produto é obrigatório." : "Nome da oferta/assunto é obrigatório.");
      return;
    }
    if (form.validFrom && form.validUntil && form.validFrom > form.validUntil) {
      setError('"Vale de" precisa ser antes de "Vale até" — do jeito que está, nunca entraria na rotação.');
      return;
    }
    const photoFiles = Array.from(photoInputRef.current?.files || []);
    const hasFlavorPhoto = form.flavors.some((flavor) => flavor.file || flavor.photoReferenceId);
    const draftCandidate = reviewingDraft && reviewingDraft.selected >= 0
      ? reviewingDraft.draft.candidates[reviewingDraft.selected]
      : null;
    if (isCatalog && !photoFiles.length && !form.photoReferenceIds.length && !hasFlavorPhoto && !draftCandidate) {
      setError("Cadastre pelo menos uma foto real do produto.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploadedIds: string[] = [];
      if (draftCandidate) {
        const uploaded = await saveAsset(project.projectId, {
          kind: "reference",
          filename: form.name.trim() || "produto",
          sourceUrl: draftCandidate.imageUrl,
          fallbackSourceUrl: draftCandidate.thumbUrl,
          role: "product_photo",
          usageRoles: ["product_photo"],
          referenceCategory: "real_product",
          useInNextGeneration: true,
          scope: "offer",
          instruction: `Foto real do produto: ${form.name}`,
        });
        if (uploaded.asset.metadata?.id) uploadedIds.push(uploaded.asset.metadata.id);
      }
      for (const photoFile of photoFiles) {
        const uploaded = await saveAsset(project.projectId, {
          kind: "reference",
          filename: photoFile.name,
          dataUrl: await fileToDataUrl(photoFile),
          role: "product_photo",
          usageRoles: ["product_photo"],
          referenceCategory: "real_product",
          useInNextGeneration: true,
          scope: "offer",
          instruction: `Foto real do produto: ${form.name}`,
        });
        if (uploaded.asset.metadata?.id) uploadedIds.push(uploaded.asset.metadata.id);
      }
      const flavors: OfferFlavor[] = [];
      for (const { file, ...flavor } of form.flavors) {
        const name = flavor.name.trim();
        if (!name) continue;
        let photoReferenceId = flavor.photoReferenceId;
        if (file) {
          const uploaded = await saveAsset(project.projectId, {
            kind: "reference",
            filename: file.name,
            dataUrl: await fileToDataUrl(file),
            role: "product_photo",
            usageRoles: ["product_photo"],
            referenceCategory: "real_product",
            useInNextGeneration: true,
            scope: "offer",
            instruction: `Foto real do produto: ${form.name} — sabor ${name}`,
          });
          photoReferenceId = uploaded.asset.metadata?.id || photoReferenceId;
        }
        flavors.push({ name, photoReferenceId });
      }
      const payload = { ...form, photoReferenceIds: [...form.photoReferenceIds, ...uploadedIds], flavors };
      await saveOffer(project.projectId, editingId ? { ...payload, id: editingId } : payload);
      if (reviewingDraft) {
        await deleteOfferDraft(project.projectId, reviewingDraft.draft.id);
        setReviewingDraft(null);
      }
      setForm({ ...EMPTY_FORM, groupId: defaultGroupId });
      if (photoInputRef.current) photoInputRef.current.value = "";
      setEditingId(null);
      await refreshProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleEdit(offer: ProjectOffer) {
    setReviewingDraft(null);
    setEditingId(offer.id);
    setForm({
      name: offer.name,
      type: offer.type,
      price: offer.price || "",
      originalPrice: offer.originalPrice || "",
      priceUnit: offer.priceUnit || "",
      items: offer.items || "",
      cta: offer.cta || "",
      autoGenerateCta: offer.autoGenerateCta || false,
      notes: offer.notes || "",
      pillarId: offer.pillarId || "",
      groupId: offer.groupId || "",
      daysOfWeek: offer.daysOfWeek || [],
      validFrom: offer.validFrom || "",
      validUntil: offer.validUntil || "",
      sector: offer.sector || "",
      active: offer.active !== false,
      uniqueProposal: offer.uniqueProposal || false,
      photoReferenceIds: offer.photoReferenceIds || [],
      flavors: (offer.flavors || []).map((flavor) => ({ ...flavor })),
      productTreatment: offer.productTreatment === "exact_asset"
        || offer.productTreatment === "creative_redraw"
        || offer.productTreatment === "faithful_enhance_photo_integration"
        ? offer.productTreatment
        : "faithful_enhance",
      layoutStrength: offer.layoutStrength === "balanced" || offer.layoutStrength === "free" ? offer.layoutStrength : "strict",
      backgroundStyle: offer.backgroundStyle === "elaborate" ? offer.backgroundStyle : "simple_brand",
      titleStyle: offer.titleStyle === "clean" ? offer.titleStyle : "lettering",
    });
    setError(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
    setFormOpen(true);
    // The form is collapsed by default — with many products, "Editar" on an
    // item near the top otherwise looks like it did nothing because the
    // (now open) form appears above the current scroll position.
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleCancelEdit() {
    setReviewingDraft(null);
    setEditingId(null);
    setForm(EMPTY_FORM);
    if (photoInputRef.current) photoInputRef.current.value = "";
    setError(null);
    setFormOpen(false);
  }

  async function handleSuggestDirection() {
    setSuggestingDirection(true);
    setError(null);
    try {
      const firstPhoto = photoInputRef.current?.files?.[0];
      const imageDataUrl = firstPhoto ? await fileToDataUrl(firstPhoto) : undefined;
      const result = await suggestOfferDirection(project.projectId, {
        name: form.name,
        price: form.price,
        items: form.items,
        type: form.type,
        photoReferenceIds: form.photoReferenceIds,
        imageDataUrl,
      });
      const suggestion = result.notes || suggestProductDirection(form.name, form.items, isCatalog);
      setForm((current) => ({
        ...current,
        notes: current.notes.trim() ? `${current.notes.trim()}\n\n${suggestion}` : suggestion,
      }));
    } catch (err) {
      const suggestion = suggestProductDirection(form.name, form.items, isCatalog);
      setForm((current) => ({
        ...current,
        notes: current.notes.trim() ? `${current.notes.trim()}\n\n${suggestion}` : suggestion,
      }));
      setError(`IA indisponível agora; usei sugestão rápida. ${(err as Error).message}`);
    } finally {
      setSuggestingDirection(false);
    }
  }

  async function handleDelete(offer: ProjectOffer) {
    if (!confirm(`Apagar "${offer.name}"? Ela não será usada nas próximas gerações.`)) return;
    setDeletingId(offer.id);
    setError(null);
    try {
      await deleteOffer(project.projectId, offer.id);
      if (editingId === offer.id) handleCancelEdit();
      await refreshProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>{isCatalog ? "Produtos" : "Ofertas e assuntos"}</h2>

      <div className="button-row" style={{ marginBottom: 20 }}>
        <Button type="button" onClick={() => setFormOpen((current) => !current)}>
          {formOpen ? "Fechar formulário" : isCatalog ? "+ Novo produto" : "+ Nova oferta/assunto"}
        </Button>
        {!isCatalog ? (
          <Button type="button" variant="secondary" onClick={() => setImportOpen((current) => !current)}>
            {importOpen ? "Fechar" : "Colar lista de produtos"}
          </Button>
        ) : null}
        {isCatalog ? (
          <Button type="button" variant="secondary" onClick={() => setDraftListOpen((current) => !current)}>
            {draftListOpen ? "Fechar" : "Adiantar fotos (lista)"}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => setGroupsOpen((current) => !current)}>
          {groupsOpen ? "Fechar" : "Grupos de ofertas"}
        </Button>
      </div>

      {isCatalog && draftListOpen ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Adiantar fotos a partir de uma lista</b>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Cada linha vira um rascunho com fotos achadas na internet. Nada entra na geração até você revisar e salvar cada um.
            Até 40 produtos por vez — leva uns 2 segundos por produto.
          </p>
          <label htmlFor="offer-draft-list">Um produto por linha (nome e preço, se tiver)</label>
          <textarea
            id="offer-draft-list"
            placeholder={"Ex:\nCoca-Cola 2L - 9,99\nArroz Tio João 5kg - 27,90\nDetergente Ypê 500ml"}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={8}
          />
          <div className="button-row" style={{ marginTop: 10 }}>
            <Button type="button" disabled={creatingDrafts} onClick={handleCreateDrafts}>
              {creatingDrafts ? "Buscando fotos..." : "Buscar fotos"}
            </Button>
          </div>
          {draftError ? <div className="pill bad" style={{ marginTop: 12 }}>{draftError}</div> : null}
        </Card>
      ) : null}

      {isCatalog && offerDrafts.length ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Para revisar ({offerDrafts.length})</b>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Rascunhos da lista — não entram na geração. Abra cada um, complete o cadastro e salve.
          </p>
          {offerDrafts.map((draft) => (
            <div key={draft.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <div style={thumbStyle}>
                {draft.candidates[0] ? (
                  <img src={draft.candidates[0].thumbUrl} alt="" style={thumbImgStyle} loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span>sem foto</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{draft.name}</div>
                {draft.price ? <div className="muted" style={{ fontSize: 13 }}>{draft.price}</div> : null}
                {!draft.candidates.length ? (
                  <div className="muted" style={{ fontSize: 12 }}>sem foto encontrada — anexe na revisão</div>
                ) : null}
              </div>
              <Button type="button" aria-label={`Revisar ${draft.name}`} onClick={() => handleReviewDraft(draft)}>
                Revisar
              </Button>
              <Button
                type="button"
                variant="secondary"
                aria-label={`Descartar ${draft.name}`}
                disabled={discardingDraftId === draft.id}
                onClick={() => handleDiscardDraft(draft.id)}
              >
                Descartar
              </Button>
            </div>
          ))}
          {draftError && !draftListOpen ? <div className="pill bad" style={{ marginTop: 12 }}>{draftError}</div> : null}
        </Card>
      ) : null}

      {groupsOpen ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Grupos de ofertas</b>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Organize {isCatalog ? "produtos" : "ofertas"} em grupos (ex: "Geral", "Black Friday") — na hora de gerar o
            agendamento, você escolhe quais grupos entram naquela geração, sem precisar desativar nada manualmente.
          </p>
          {offerGroups.length > 0 ? (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              {offerGroups.map((group) => (
                <div key={group.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {editingGroupId === group.id ? (
                    <>
                      <input
                        value={editingGroupName}
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <Button
                        type="button"
                        disabled={savingGroupId === group.id}
                        onClick={() => handleSaveGroupName(group.id)}
                      >
                        {savingGroupId === group.id ? "Salvando..." : "Salvar"}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setEditingGroupId(null)}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="pill" style={{ flex: 1, width: "max-content" }}>{group.name}</span>
                      <label htmlFor={`combo-chance-${group.id}`} className="muted" style={{ fontSize: 12 }}>
                        Combo %
                      </label>
                      <input
                        id={`combo-chance-${group.id}`}
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={group.comboChance ?? 0}
                        disabled={savingComboGroupId === group.id}
                        onBlur={(e) => handleSaveComboChance(group, e.target.value)}
                        style={{ width: 64 }}
                        title="Chance (0-100%) de juntar 2 produtos parecidos deste grupo na mesma arte"
                      />
                      <Button type="button" variant="secondary" onClick={() => handleStartRenameGroup(group)}>
                        Renomear
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={deletingGroupId === group.id}
                        onClick={() => handleDeleteGroup(group)}
                      >
                        {deletingGroupId === group.id ? "Apagando..." : "Apagar"}
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Nenhum grupo criado ainda.</p>
          )}
          <div className="row" style={{ alignItems: "end" }}>
            <div>
              <label htmlFor="new-group-name">Novo grupo</label>
              <input
                id="new-group-name"
                placeholder="Ex: Black Friday"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
            </div>
            <Button type="button" disabled={creatingGroup} onClick={handleCreateGroup}>
              {creatingGroup ? "Criando..." : "Criar grupo"}
            </Button>
          </div>
          {groupError ? <div className="pill bad" style={{ marginTop: 12 }}>{groupError}</div> : null}
        </Card>
      ) : null}

      {formOpen ? (
      <div ref={formCardRef}>
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>
            {editingId
              ? isCatalog ? "Editar produto" : "Editar oferta / assunto"
              : isCatalog ? "Novo produto" : "Nova oferta / assunto"}
          </b>
          <form onSubmit={handleSubmit}>
            <label htmlFor="offer-name">{isCatalog ? "Nome do produto" : "Nome"}</label>
            <input id="offer-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

            <label htmlFor="offer-photo">
              {isCatalog ? "Foto(s) real(is) do produto" : "Foto(s) real(is) do produto (opcional)"}
            </label>
            <input ref={photoInputRef} id="offer-photo" type="file" accept="image/*" multiple />
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {isCatalog
                ? "Pode escolher mais de uma foto (ângulos diferentes) — a composição usa a primeira como principal."
                : "Anexe a foto real deste produto/modelo específico pra IA usar ele de verdade na arte, em vez de inventar um genérico. Ajuda muito quando há vários modelos parecidos (ex: vários celulares)."}
            </p>
            {reviewingDraft ? (
              <div style={{ marginTop: 8 }}>
                {reviewingDraft.draft.candidates.length ? (
                  <>
                    <p className="muted" style={{ margin: "0 0 6px", fontSize: 12 }}>
                      Fotos achadas na internet — a marcada é a que vai ser salva. Clique em outra pra trocar, ou na marcada pra não usar nenhuma.
                    </p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {reviewingDraft.draft.candidates.map((candidate, index) => {
                        const selected = reviewingDraft.selected === index;
                        return (
                          <button
                            key={candidate.imageUrl}
                            type="button"
                            aria-label={`Usar foto ${index + 1}`}
                            aria-pressed={selected}
                            onClick={() => setReviewingDraft({ ...reviewingDraft, selected: selected ? -1 : index })}
                            style={{
                              width: 88,
                              height: 88,
                              padding: 0,
                              borderRadius: 8,
                              overflow: "hidden",
                              cursor: "pointer",
                              background: "var(--bg-soft)",
                              border: selected ? "3px solid var(--accent)" : "1px solid var(--line)",
                            }}
                          >
                            <img src={candidate.thumbUrl} alt="" style={thumbImgStyle} loading="lazy" referrerPolicy="no-referrer" />
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    Nenhuma foto achada na internet pra esse nome — anexe uma do computador.
                  </p>
                )}
              </div>
            ) : null}
            {form.photoReferenceIds.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {form.photoReferenceIds.map((id) =>
                  photoPreviewUrl(id) ? (
                    <div key={id} style={{ position: "relative" }}>
                      <div style={{ ...thumbStyle, width: 90, height: 90 }}>
                        <img src={photoPreviewUrl(id)!} alt={form.name || "Foto atual"} style={thumbImgStyle} loading="lazy" />
                      </div>
                      <button
                        type="button"
                        onClick={() => removePhoto(id)}
                        title="Remover esta foto"
                        aria-label="Remover esta foto"
                        style={{
                          position: "absolute",
                          top: -12,
                          right: -12,
                          width: 44,
                          height: 44,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: "var(--bad)",
                            color: "var(--accent-ink)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </span>
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}

            <label style={{ marginTop: 12 }}>Sabores / variações (opcional)</label>
            <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12 }}>
              Quando o mesmo produto existe em vários sabores, cores ou modelos pelo mesmo preço: cadastre cada um com a
              sua foto e a arte mostra todos juntos, lado a lado. Até {MAX_OFFER_FLAVORS}.
            </p>
            {form.flavors.map((flavor, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                {flavor.photoReferenceId && photoPreviewUrl(flavor.photoReferenceId) ? (
                  <div style={thumbStyle}>
                    <img
                      src={photoPreviewUrl(flavor.photoReferenceId)!}
                      alt={flavor.name || "Foto do sabor"}
                      style={thumbImgStyle}
                      loading="lazy"
                    />
                  </div>
                ) : null}
                <input
                  aria-label={`Nome do sabor ${index + 1}`}
                  placeholder="Ex: Chocolate"
                  value={flavor.name}
                  onChange={(e) => updateFlavor(index, { name: e.target.value })}
                  style={{ flex: "1 1 160px" }}
                />
                <input
                  type="file"
                  accept="image/*"
                  aria-label={`Foto do sabor ${index + 1}`}
                  onChange={(e) => updateFlavor(index, { file: e.target.files?.[0] })}
                  style={{ flex: "1 1 220px" }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remover sabor ${index + 1}`}
                  onClick={() => setForm((current) => ({ ...current, flavors: current.flavors.filter((_, i) => i !== index) }))}
                >
                  Remover
                </Button>
              </div>
            ))}
            {form.flavors.length < MAX_OFFER_FLAVORS ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm((current) => ({ ...current, flavors: [...current.flavors, { name: "", photoReferenceId: null }] }))}
              >
                + Adicionar sabor
              </Button>
            ) : null}

            <div className="row">
              {!isCatalog ? (
                <div>
                  <label htmlFor="offer-type">Tipo</label>
                  <select id="offer-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {Object.entries(OFFER_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label htmlFor="offer-original-price">De (opcional)</label>
                <input
                  id="offer-original-price"
                  placeholder="Preço original, se for oferta"
                  value={form.originalPrice}
                  onChange={(e) => setForm({ ...form, originalPrice: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="offer-price">Preço {form.originalPrice ? "(por)" : ""}</label>
                <input id="offer-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div>
                <label htmlFor="offer-price-unit">Unidade</label>
                <select
                  id="offer-price-unit"
                  value={form.priceUnit}
                  onChange={(e) => setForm({ ...form, priceUnit: e.target.value })}
                >
                  {Object.entries(PRICE_UNIT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="offer-items">{isCatalog ? "Detalhes" : "Itens/detalhes"}</label>
            <input id="offer-items" value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} />

            {!isCatalog ? (
              <div className="row">
                <div>
                  <label htmlFor="offer-product-treatment">Tratamento do produto</label>
                  <select
                    id="offer-product-treatment"
                    value={form.productTreatment}
                    onChange={(e) => setForm({ ...form, productTreatment: e.target.value as ProductTreatment })}
                  >
                    <option value="faithful_enhance">Produto fiel melhorado</option>
                    <option value="faithful_enhance_photo_integration">Produto fiel + recomendação</option>
                    <option value="creative_redraw">Redesenho criativo permitido</option>
                    <option value="exact_asset">Manter foto/embalagem exata</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="offer-layout-strength">Obediência ao modelo</label>
                  <select
                    id="offer-layout-strength"
                    value={form.layoutStrength}
                    onChange={(e) => setForm({ ...form, layoutStrength: e.target.value as "strict" | "balanced" | "free" })}
                  >
                    <option value="strict">Estrita</option>
                    <option value="balanced">Equilibrada</option>
                    <option value="free">Livre/inspiração</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="offer-background-style">Fundo do criativo</label>
                  <select
                    id="offer-background-style"
                    value={form.backgroundStyle}
                    onChange={(e) => setForm({ ...form, backgroundStyle: e.target.value as BackgroundStyle })}
                  >
                    <option value="simple_brand">Simples (cores da marca)</option>
                    <option value="elaborate">Elaborado (cenário/ambientação)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="offer-title-style">Letra do título</label>
                  <select
                    id="offer-title-style"
                    value={form.titleStyle}
                    onChange={(e) => setForm({ ...form, titleStyle: e.target.value as TitleStyle })}
                  >
                    <option value="lettering">Desenhada (padrão)</option>
                    <option value="clean">Limpa (fundo mais liso)</option>
                  </select>
                </div>
              </div>
            ) : null}

            {!isCatalog && pillars.length > 0 ? (
              <>
                <label htmlFor="offer-pillar">Pilar (opcional)</label>
                <select id="offer-pillar" value={form.pillarId} onChange={(e) => setForm({ ...form, pillarId: e.target.value })}>
                  <option value="">Deixar o sistema decidir automaticamente</option>
                  {pillars.map((pillar) => (
                    <option key={pillar.id} value={pillar.id}>
                      {pillar.name} ({PILLAR_ROLE_LABELS[pillar.role] || pillar.role})
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            {offerGroups.length > 0 ? (
              <>
                <label htmlFor="offer-group">Grupo (opcional)</label>
                <select id="offer-group" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                  <option value="">Sem grupo</option>
                  {offerGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            <label>Dias da semana (opcional)</label>
            <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12 }}>
              Deixe tudo desmarcado pra valer todo dia. Marque só os dias em que essa {isCatalog ? "oferta" : "oferta/assunto"} pode
              entrar na rotação — útil pra promoção que muda de valor por dia (ex: rodízio de semana x fim de semana).
            </p>
            <div className="button-row" style={{ marginBottom: 12 }}>
              {WEEKDAY_ORDER.map((day) => (
                <Button
                  key={day}
                  type="button"
                  variant={form.daysOfWeek.includes(day) ? "primary" : "secondary"}
                  onClick={() => toggleFormDay(day)}
                >
                  {WEEKDAY_LABELS[day]}
                </Button>
              ))}
            </div>

            <div className="row">
              <div>
                <label htmlFor="offer-sector">Setor</label>
                <input
                  id="offer-sector"
                  list="offer-sectors"
                  placeholder="Ex.: Hortifruti, Higiene, Mercearia"
                  value={form.sector}
                  onChange={(e) => setForm({ ...form, sector: e.target.value })}
                />
                <datalist id="offer-sectors">
                  {sectors.map((sector) => (
                    <option key={sector} value={sector} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="offer-valid-from">Vale de</label>
                <input id="offer-valid-from" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
              </div>
              <div>
                <label htmlFor="offer-valid-until">Vale até</label>
                <input id="offer-valid-until" type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </div>
            </div>
            <p className="muted" style={{ margin: "4px 0 12px", fontSize: 12 }}>
              Combo só junta {isCatalog ? "produtos" : "ofertas"} do mesmo setor. Datas vazias = vale sempre; fora das datas não entra na rotação.
            </p>

            {!isCatalog ? (
              <div className="row">
                <div>
                  <label htmlFor="offer-cta">CTA</label>
                  <input id="offer-cta" value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 11 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={form.autoGenerateCta}
                      onChange={(e) => setForm({ ...form, autoGenerateCta: e.target.checked })}
                      style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto" }}
                    />
                    IA escolhe o CTA automaticamente
                  </label>
                </div>
              </div>
            ) : null}

            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 0" }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto" }}
              />
              {isCatalog ? "Em estoque (entra na rotação de posts)" : "Ativo (entra nas próximas gerações)"}
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 0" }}>
              <input
                type="checkbox"
                checked={form.uniqueProposal}
                onChange={(e) => setForm({ ...form, uniqueProposal: e.target.checked })}
                style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto" }}
              />
              Proposta única (nunca combinar)
            </label>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginTop: 12 }}>
              <label htmlFor="offer-notes" style={{ margin: 0 }}>Observações</label>
              <Button type="button" variant="secondary" onClick={handleSuggestDirection} disabled={suggestingDirection}>
                {suggestingDirection ? "Analisando..." : "Sugerir direcionamento"}
              </Button>
            </div>
            <textarea id="offer-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button type="submit" className="full-width" disabled={busy}>
                {busy ? "Salvando..." : editingId ? "Salvar edição" : isCatalog ? "Salvar produto" : "Salvar oferta/assunto"}
              </Button>
              {editingId ? (
                <Button type="button" variant="secondary" onClick={handleCancelEdit}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
          {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
        </Card>
      </div>
      ) : null}

      {isCatalog ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Informações gerais do catálogo</b>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Aparece em toda peça gerada, de todo produto — ex: condições de pagamento, entrada facilitada, parcelamento.
          </p>
          <label htmlFor="catalog-general-info">Informação fixa (opcional)</label>
          <textarea
            id="catalog-general-info"
            placeholder="Ex: Entrada facilitada · Parcelamos em até 48x"
            value={generalInfo}
            onChange={(e) => setGeneralInfo(e.target.value)}
          />
          <Button variant="secondary" style={{ marginTop: 8 }} disabled={generalInfoBusy} onClick={handleSaveGeneralInfo}>
            {generalInfoBusy ? "Salvando..." : "Salvar informação geral"}
          </Button>
          {generalInfoMessage ? <div className="pill" style={{ marginTop: 10 }}>{generalInfoMessage}</div> : null}
        </Card>
      ) : null}

      {!isCatalog && importOpen ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Cadastrar a partir de texto</b>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Cole uma lista de produtos/serviços (nome, preço, detalhes) — a IA lê e sugere ofertas prontas pra você revisar antes de adicionar.
          </p>
          <textarea
            placeholder={"Ex:\niPhone 13 128GB - R$ 3.299,99 - novo, lacrado\niPhone 13 256GB - R$ 3.599,99 - novo, lacrado"}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            style={{ minHeight: 100 }}
          />
          <Button variant="secondary" style={{ marginTop: 8 }} disabled={importing} onClick={handleAnalyzeText}>
            {importing ? "Analisando..." : "Analisar e sugerir ofertas"}
          </Button>
          {importError ? <div className="pill bad" style={{ marginTop: 10 }}>{importError}</div> : null}

          {candidates && candidates.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "grid", gap: 8 }}>
                {candidates.map((offer, index) => (
                  <label
                    key={`${offer.name}-${index}`}
                    style={{ display: "flex", gap: 10, alignItems: "start", border: "1px solid var(--line)", borderRadius: 12, padding: 12, cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCandidates.has(index)}
                      onChange={() => toggleCandidate(index)}
                      style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto", marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontWeight: 700 }}>{offer.name}</div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        {offer.price || "sem preço"}
                        {offer.items ? ` · ${offer.items}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <Button style={{ marginTop: 12 }} disabled={addingCandidates || selectedCandidates.size === 0} onClick={handleAddCandidates}>
                {addingCandidates ? "Adicionando..." : `Adicionar ${selectedCandidates.size} selecionada(s)`}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {offers.length === 0 ? (
        <EmptyState
          title={isCatalog ? "Nenhum produto cadastrado ainda" : "Nenhuma oferta/assunto cadastrado ainda"}
          description="Cadastre acima o primeiro."
        />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {offerSections.map((section) => {
            const key = section.groupId ?? "sem-grupo";
            const isExpanded = expandedGroupKey === key;
            return (
            <Card key={key} style={{ padding: 16 }}>
              <button
                type="button"
                onClick={() => toggleGroupExpanded(key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: isExpanded ? 12 : 0,
                }}
              >
                <span style={{ display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
                  ▸
                </span>
                <b style={{ fontSize: 15 }}>{section.groupName}</b>
                <span className="pill">{section.offers.length}</span>
              </button>
              {isExpanded ? (
              <div style={{ display: "grid", gap: 10 }}>
                {section.offers.map((offer) => (
                  <Card key={offer.id} style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                      <div style={{ display: "flex", gap: 12 }}>
                        {isCatalog || (offer.photoReferenceIds?.length || 0) > 0 ? (
                          (offer.photoReferenceIds?.length || 0) === 0 ? (
                            <div style={thumbStyle}>
                              <span>sem foto</span>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 4 }}>
                              {(offer.photoReferenceIds || []).slice(0, 3).map((id) => (
                                <div key={id} style={thumbStyle}>
                                  {photoPreviewUrl(id) ? <img src={photoPreviewUrl(id)!} alt={offer.name} style={thumbImgStyle} loading="lazy" /> : null}
                                </div>
                              ))}
                              {(offer.photoReferenceIds?.length || 0) > 3 ? (
                                <div style={{ ...thumbStyle, width: 32 }}>+{(offer.photoReferenceIds?.length || 0) - 3}</div>
                              ) : null}
                            </div>
                          )
                        ) : null}
                        <div>
                          <div style={{ fontWeight: 800 }}>{offer.name}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                            {!isCatalog ? <span className="pill">{OFFER_TYPE_LABELS[offer.type] || offer.type}</span> : null}
                            <span className="pill">
                              {offer.price
                                ? `${offer.originalPrice ? `de ${offer.originalPrice} por ` : ""}${offer.price}${offer.priceUnit ? ` ${PRICE_UNIT_LABELS[offer.priceUnit] || offer.priceUnit}` : ""}`
                                : "sem preço"}
                            </span>
                            <span className="pill">{offer.active === false ? "inativo" : "ativo"}</span>
                            {!isCatalog && offer.pillarId ? (
                              <span className="pill">
                                pilar: {pillars.find((pillar) => pillar.id === offer.pillarId)?.name || offer.pillarId}
                              </span>
                            ) : !isCatalog && autoResolvedPillar(offer) ? (
                              <span className="pill" style={{ opacity: 0.7, fontStyle: "italic" }}>
                                pilar automático: {autoResolvedPillar(offer)!.name}
                              </span>
                            ) : null}
                            {offer.daysOfWeek?.length ? (
                              <span className="pill">
                                {offer.daysOfWeek.map((day) => WEEKDAY_LABELS[day] || day).join(", ")}
                              </span>
                            ) : null}
                            {offer.uniqueProposal ? <span className="pill">proposta única</span> : null}
                            {offer.sector ? <span className="pill">setor: {offer.sector}</span> : null}
                            {offerValidityText(offer, today) ? <span className="pill">{offerValidityText(offer, today)}</span> : null}
                          </div>
                          {project.offerUsage?.offers?.[offer.id] ? (
                            <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                              {offerUsageText(project.offerUsage.offers[offer.id])}
                            </div>
                          ) : null}
                          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                            {offer.items ? <div>{isCatalog ? "Detalhes" : "Itens"}: {offer.items}</div> : null}
                            {!isCatalog && offer.cta ? <div>CTA: {offer.cta}</div> : null}
                            {offer.notes ? <div>Obs: {offer.notes}</div> : null}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="secondary" onClick={() => handleEdit(offer)}>
                          Editar
                        </Button>
                        <Button variant="ghost" onClick={() => handleDelete(offer)} disabled={deletingId === offer.id}>
                          {deletingId === offer.id ? "Apagando..." : "Apagar"}
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
              ) : null}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
