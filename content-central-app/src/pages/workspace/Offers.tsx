import { useRef, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  OFFER_TYPE_LABELS,
  OFFER_TYPE_TO_PILLAR_ROLE,
  PILLAR_ROLE_LABELS,
  analyzeSite,
  deleteOffer,
  fileToDataUrl,
  saveAsset,
  saveCatalogSettings,
  saveOffer,
  type ProjectOffer,
  type SiteOfferCandidate,
} from "@/api/client";
import { Button } from "@/components/Button";
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
  background: "#09090b",
  color: "var(--muted)",
  fontSize: 11,
} as const;
const thumbImgStyle = { width: "100%", height: "100%", objectFit: "cover" } as const;

const EMPTY_FORM = {
  name: "",
  type: "offer",
  price: "",
  items: "",
  cta: "",
  autoGenerateCta: false,
  notes: "",
  pillarId: "",
  active: true,
  photoReferenceIds: [] as string[],
};

export function Offers() {
  const { project, refreshProject } = useOutletContext<WorkspaceContext>();
  const isCatalog = project.projectType === "catalog";
  const offers = project.contentStrategy?.offers || [];
  const pillars = project.contentStrategy?.pillars || [];
  const references = project.brand?.references || [];
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formCardRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

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
        await saveOffer(project.projectId, { name: offer.name, type: "offer", price: offer.price, items: offer.items });
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
    const photoFiles = Array.from(photoInputRef.current?.files || []);
    if (isCatalog && !photoFiles.length && !form.photoReferenceIds.length) {
      setError("Cadastre pelo menos uma foto real do produto.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploadedIds: string[] = [];
      for (const photoFile of photoFiles) {
        const uploaded = await saveAsset(project.projectId, {
          kind: "reference",
          filename: photoFile.name,
          dataUrl: await fileToDataUrl(photoFile),
          role: "product_photo",
          usageRoles: ["product_photo"],
          referenceCategory: "real_product",
          useInNextGeneration: true,
          instruction: `Foto real do produto: ${form.name}`,
        });
        if (uploaded.asset.metadata?.id) uploadedIds.push(uploaded.asset.metadata.id);
      }
      const payload = { ...form, photoReferenceIds: [...form.photoReferenceIds, ...uploadedIds] };
      await saveOffer(project.projectId, editingId ? { ...payload, id: editingId } : payload);
      setForm(EMPTY_FORM);
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
    setEditingId(offer.id);
    setForm({
      name: offer.name,
      type: offer.type,
      price: offer.price || "",
      items: offer.items || "",
      cta: offer.cta || "",
      autoGenerateCta: offer.autoGenerateCta || false,
      notes: offer.notes || "",
      pillarId: offer.pillarId || "",
      active: offer.active !== false,
      photoReferenceIds: offer.photoReferenceIds || [],
    });
    setError(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
    // The edit form lives at the bottom of the page, below the offer list —
    // on a long list, clicking "Editar" near the top otherwise looks like it
    // did nothing because the visible area never changes.
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    if (photoInputRef.current) photoInputRef.current.value = "";
    setError(null);
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
      <h2 style={{ margin: "0 0 16px" }}>{isCatalog ? "Produtos" : "Ofertas e assuntos"}</h2>

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

      {!isCatalog ? (
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
          description="Cadastre abaixo o primeiro."
        />
      ) : (
        <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
          {offers.map((offer) => (
            <Card key={offer.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div style={{ display: "flex", gap: 12 }}>
                  {isCatalog ? (
                    (offer.photoReferenceIds?.length || 0) === 0 ? (
                      <div style={thumbStyle}>
                        <span>sem foto</span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4 }}>
                        {(offer.photoReferenceIds || []).slice(0, 3).map((id) => (
                          <div key={id} style={thumbStyle}>
                            {photoPreviewUrl(id) ? <img src={photoPreviewUrl(id)!} alt={offer.name} style={thumbImgStyle} /> : null}
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
                      <span className="pill">{offer.price || "sem preço"}</span>
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
                    </div>
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
      )}

      <div ref={formCardRef}>
      <Card style={{ padding: 20 }}>
        <b>
          {editingId
            ? isCatalog ? "Editar produto" : "Editar oferta / assunto"
            : isCatalog ? "Novo produto" : "Nova oferta / assunto"}
        </b>
        <form onSubmit={handleSubmit}>
          <label htmlFor="offer-name">{isCatalog ? "Nome do produto" : "Nome"}</label>
          <input id="offer-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

          {isCatalog ? (
            <>
              <label htmlFor="offer-photo">Foto(s) real(is) do produto</label>
              <input ref={photoInputRef} id="offer-photo" type="file" accept="image/*" multiple />
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Pode escolher mais de uma foto (ângulos diferentes) — a composição usa a primeira como principal.
              </p>
              {form.photoReferenceIds.length > 0 ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {form.photoReferenceIds.map((id) =>
                    photoPreviewUrl(id) ? (
                      <div key={id} style={{ position: "relative" }}>
                        <div style={{ ...thumbStyle, width: 90, height: 90 }}>
                          <img src={photoPreviewUrl(id)!} alt={form.name || "Foto atual"} style={thumbImgStyle} />
                        </div>
                        <button
                          type="button"
                          onClick={() => removePhoto(id)}
                          title="Remover esta foto"
                          style={{
                            position: "absolute",
                            top: -6,
                            right: -6,
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            border: "none",
                            background: "#ef4444",
                            color: "#fff",
                            cursor: "pointer",
                            lineHeight: "20px",
                            padding: 0,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ) : null,
                  )}
                </div>
              ) : null}
            </>
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
              <label htmlFor="offer-price">Preço</label>
              <input id="offer-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
          </div>

          <label htmlFor="offer-items">{isCatalog ? "Detalhes" : "Itens/detalhes"}</label>
          <input id="offer-items" value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} />

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

          <label htmlFor="offer-notes">Observações</label>
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
    </div>
  );
}
