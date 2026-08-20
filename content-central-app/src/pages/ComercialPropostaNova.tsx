import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  fileToDataUrl,
  getCommercialProposal,
  listCommercialCatalog,
  saveCommercialProposal,
  type CommercialCatalogItem,
  type CommercialProposalItem,
  type CommercialProposalSection,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ComercialTabs } from "@/components/ComercialTabs";
import styles from "./ComercialPropostaNova.module.css";

type Mode = "none" | "comparison" | "single";

function toProposalItem(item: CommercialCatalogItem): CommercialProposalItem {
  return {
    catalogItemId: item.id,
    name: item.name,
    description: item.description,
    whatWeDeliver: item.whatWeDeliver,
    whatClientProvides: item.whatClientProvides,
    billingType: item.billingType,
    price: item.price,
    fullPrice: item.fullPrice,
    discountedPrice: item.discountedPrice,
  };
}

export function ComercialPropostaNova() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id?: string }>();
  const isEditing = Boolean(editId);
  const [catalog, setCatalog] = useState<CommercialCatalogItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientLogoDataUrl, setClientLogoDataUrl] = useState<string | null>(null);
  const [categoryModes, setCategoryModes] = useState<Record<string, Mode>>({});
  const [categorySingleId, setCategorySingleId] = useState<Record<string, string>>({});
  const [sectionItems, setSectionItems] = useState<Record<string, CommercialProposalItem[]>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listCommercialCatalog(), editId ? getCommercialProposal(editId) : Promise.resolve(null)])
      .then(([catalogRes, proposalRes]) => {
        setCatalog(catalogRes.items);
        if (!proposalRes) return;
        const proposal = proposalRes.proposal;
        setClientName(proposal.clientName);
        setClientLogoDataUrl(proposal.clientLogoDataUrl);
        const modes: Record<string, Mode> = {};
        const singleIds: Record<string, string> = {};
        const items: Record<string, CommercialProposalItem[]> = {};
        proposal.sections.forEach((section) => {
          modes[section.category] = section.mode;
          items[section.category] = section.items;
          if (section.mode === "single" && section.items[0]?.catalogItemId) {
            singleIds[section.category] = section.items[0].catalogItemId;
          }
        });
        setCategoryModes(modes);
        setCategorySingleId(singleIds);
        setSectionItems(items);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [editId]);

  const categories = useMemo(() => {
    const seen: string[] = [];
    (catalog || []).forEach((item) => {
      if (!seen.includes(item.category)) seen.push(item.category);
    });
    return seen;
  }, [catalog]);

  function itemsForCategory(category: string) {
    return (catalog || []).filter((item) => item.category === category);
  }

  function setMode(category: string, mode: Mode) {
    setCategoryModes((current) => ({ ...current, [category]: mode }));
    if (mode === "comparison") {
      setSectionItems((current) => ({ ...current, [category]: itemsForCategory(category).map(toProposalItem) }));
    } else {
      setSectionItems((current) => {
        const next = { ...current };
        delete next[category];
        return next;
      });
    }
  }

  function selectSingleItem(category: string, itemId: string) {
    setCategorySingleId((current) => ({ ...current, [category]: itemId }));
    const item = itemsForCategory(category).find((entry) => entry.id === itemId);
    setSectionItems((current) => ({ ...current, [category]: item ? [toProposalItem(item)] : [] }));
  }

  function updateItem(category: string, index: number, patch: Partial<CommercialProposalItem>) {
    setSectionItems((current) => ({
      ...current,
      [category]: (current[category] || []).map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  async function handleClientLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setClientLogoDataUrl(await fileToDataUrl(file));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!clientName.trim()) {
      setSaveError("Nome do cliente é obrigatório.");
      return;
    }
    const sections: CommercialProposalSection[] = categories
      .filter((category) => categoryModes[category] && categoryModes[category] !== "none" && (sectionItems[category] || []).length > 0)
      .map((category) => ({
        category,
        mode: categoryModes[category] === "comparison" ? "comparison" : "single",
        items: sectionItems[category],
      }));
    if (!sections.length) {
      setSaveError("Escolha ao menos uma categoria pra incluir na proposta.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveCommercialProposal({ id: editId, clientName, clientLogoDataUrl, sections });
      navigate(`/comercial/propostas/${res.proposal.id}`);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <ComercialTabs />
      <div className="page-head">
        <div>
          <h1>{isEditing ? "Editar proposta" : "Nova proposta"}</h1>
          <p>Escolha o que entra pra esse cliente — comparação de planos, item fechado, ou os dois combinados.</p>
        </div>
      </div>

      {loadError ? <div className="pill bad">{loadError}</div> : null}

      <form onSubmit={handleSubmit} className="stack-lg">
        <Card style={{ padding: "var(--space-lg)" }}>
          <div className="row">
            <div>
              <label htmlFor="proposal-client-name">Nome do cliente</label>
              <input id="proposal-client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="proposal-client-logo">Logo do cliente (opcional)</label>
              <input id="proposal-client-logo" type="file" accept="image/*" onChange={handleClientLogoUpload} />
            </div>
          </div>
        </Card>

        {categories.map((category) => {
          const mode = categoryModes[category] || "none";
          const items = itemsForCategory(category);
          return (
            <Card key={category} style={{ padding: "var(--space-lg)" }}>
              <b>{category}</b>
              <label htmlFor={`proposal-mode-${category}`}>O que incluir</label>
              <select id={`proposal-mode-${category}`} value={mode} onChange={(e) => setMode(category, e.target.value as Mode)}>
                <option value="none">Não incluir</option>
                <option value="comparison">Comparar todos os itens</option>
                <option value="single">Escolher um item</option>
              </select>

              {mode === "single" ? (
                <>
                  <label htmlFor={`proposal-single-${category}`}>Item</label>
                  <select id={`proposal-single-${category}`} value={categorySingleId[category] || ""} onChange={(e) => selectSingleItem(category, e.target.value)}>
                    <option value="">Selecione...</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </>
              ) : null}

              {(sectionItems[category] || []).map((item, index) => (
                <div key={index} className={styles.itemCard}>
                  <label htmlFor={`item-name-${category}-${index}`}>Nome</label>
                  <input id={`item-name-${category}-${index}`} value={item.name} onChange={(e) => updateItem(category, index, { name: e.target.value })} />
                  <label htmlFor={`item-description-${category}-${index}`}>Descrição</label>
                  <textarea id={`item-description-${category}-${index}`} value={item.description} onChange={(e) => updateItem(category, index, { description: e.target.value })} />
                  <label htmlFor={`item-deliver-${category}-${index}`}>O que a gente entrega (1 por linha)</label>
                  <textarea id={`item-deliver-${category}-${index}`} value={item.whatWeDeliver.join("\n")} onChange={(e) => updateItem(category, index, { whatWeDeliver: e.target.value.split("\n") })} />
                  <label htmlFor={`item-provides-${category}-${index}`}>O que depende do cliente (1 por linha)</label>
                  <textarea id={`item-provides-${category}-${index}`} value={item.whatClientProvides.join("\n")} onChange={(e) => updateItem(category, index, { whatClientProvides: e.target.value.split("\n") })} />
                  {item.billingType === "mensal" ? (
                    <>
                      <label htmlFor={`item-price-${category}-${index}`}>Preço mensal (R$)</label>
                      <input id={`item-price-${category}-${index}`} type="number" min="0" value={item.price} onChange={(e) => updateItem(category, index, { price: Number(e.target.value) || 0 })} />
                    </>
                  ) : (
                    <div className="row">
                      <div>
                        <label htmlFor={`item-full-price-${category}-${index}`}>Preço cheio (R$)</label>
                        <input id={`item-full-price-${category}-${index}`} type="number" min="0" value={item.fullPrice} onChange={(e) => updateItem(category, index, { fullPrice: Number(e.target.value) || 0 })} />
                      </div>
                      <div>
                        <label htmlFor={`item-discounted-price-${category}-${index}`}>Preço com desconto (R$)</label>
                        <input id={`item-discounted-price-${category}-${index}`} type="number" min="0" value={item.discountedPrice} onChange={(e) => updateItem(category, index, { discountedPrice: Number(e.target.value) || 0 })} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          );
        })}

        <Button type="submit" className="full-width" disabled={saving || !categories.length}>
          {saving ? "Salvando..." : isEditing ? "Salvar alterações" : "Salvar proposta"}
        </Button>
        {saveError ? <div className="pill bad">{saveError}</div> : null}
      </form>
    </div>
  );
}
