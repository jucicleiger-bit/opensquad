import { useEffect, useState, type FormEvent } from "react";
import { deleteCommercialCatalogItem, listCommercialCatalog, listCommercialProcesses, saveCommercialCatalogItem, saveCommercialProcess, type CommercialCatalogItem } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ComercialTabs } from "@/components/ComercialTabs";
import { Dialog } from "@/components/Dialog";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./ComercialCatalogo.module.css";

const EMPTY_FORM = {
  id: "",
  category: "",
  name: "",
  description: "",
  whatWeDeliver: "",
  whatClientProvides: "",
  billingType: "mensal" as "mensal" | "unica",
  price: "",
  fullPrice: "",
  discountedPrice: "",
};

export function ComercialCatalogo() {
  const [items, setItems] = useState<CommercialCatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [processes, setProcesses] = useState<Record<string, string>>({});
  const [processDrafts, setProcessDrafts] = useState<Record<string, string>>({});
  const [savingProcess, setSavingProcess] = useState<string | null>(null);

  function load() {
    listCommercialCatalog()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    listCommercialProcesses()
      .then((res) => {
        const map: Record<string, string> = {};
        res.processes.forEach((entry) => {
          map[entry.category] = entry.text;
        });
        setProcesses(map);
      })
      .catch(() => {});
  }, []);

  function startCreate() {
    setForm(EMPTY_FORM);
    setSaveError(null);
    setShowForm(true);
  }

  function startEdit(item: CommercialCatalogItem) {
    setForm({
      id: item.id,
      category: item.category,
      name: item.name,
      description: item.description,
      whatWeDeliver: item.whatWeDeliver.join("\n"),
      whatClientProvides: item.whatClientProvides.join("\n"),
      billingType: item.billingType,
      price: String(item.price || ""),
      fullPrice: String(item.fullPrice || ""),
      discountedPrice: String(item.discountedPrice || ""),
    });
    setSaveError(null);
    setShowForm(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.category.trim()) {
      setSaveError("Categoria e nome são obrigatórios.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveCommercialCatalogItem({
        id: form.id || undefined,
        category: form.category,
        name: form.name,
        description: form.description,
        whatWeDeliver: form.whatWeDeliver.split("\n").map((line) => line.trim()).filter(Boolean),
        whatClientProvides: form.whatClientProvides.split("\n").map((line) => line.trim()).filter(Boolean),
        billingType: form.billingType,
        price: Number(form.price) || 0,
        fullPrice: Number(form.fullPrice) || 0,
        discountedPrice: Number(form.discountedPrice) || 0,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar este item do catálogo?")) return;
    setDeletingId(id);
    try {
      await deleteCommercialCatalogItem(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  async function saveProcess(category: string) {
    const text = processDrafts[category] ?? processes[category] ?? "";
    setSavingProcess(category);
    try {
      await saveCommercialProcess({ category, text });
      setProcesses((current) => ({ ...current, [category]: text }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingProcess(null);
    }
  }

  const grouped = new Map<string, CommercialCatalogItem[]>();
  (items || []).forEach((item) => {
    const list = grouped.get(item.category) || [];
    list.push(item);
    grouped.set(item.category, list);
  });

  return (
    <div className={styles.wrap}>
      <ComercialTabs />
      <div className="page-head">
        <div>
          <h1>Catálogo de serviços</h1>
          <p>Planos e serviços que você vende — usados pra montar propostas.</p>
        </div>
        <div className="actions-row">
          <Button variant={showForm ? "secondary" : "primary"} onClick={() => (showForm ? setShowForm(false) : startCreate())}>
            {showForm ? "Cancelar" : "+ Novo item"}
          </Button>
        </div>
      </div>

      {showForm ? (
        <Dialog
          onClose={() => setShowForm(false)}
          titleId="catalog-form-title"
          overlayClassName={styles.formDialogOverlay}
          contentClassName={styles.formDialogContent}
        >
        <Card style={{ padding: "var(--space-lg)" }}>
          <h2 id="catalog-form-title" style={{ marginTop: 0 }}>{form.id ? "Editar item" : "Novo item do catálogo"}</h2>
          <form onSubmit={handleSubmit}>
            <div className="row">
              <div>
                <label htmlFor="catalog-category">Categoria</label>
                <input id="catalog-category" placeholder="Criação de Conteúdo" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div>
                <label htmlFor="catalog-name">Nome</label>
                <input id="catalog-name" placeholder="Profissional" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <label htmlFor="catalog-description">Descrição</label>
            <textarea id="catalog-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label htmlFor="catalog-deliver">O que a gente entrega (1 por linha)</label>
            <textarea id="catalog-deliver" value={form.whatWeDeliver} onChange={(e) => setForm({ ...form, whatWeDeliver: e.target.value })} />
            <label htmlFor="catalog-provides">O que depende do cliente (1 por linha)</label>
            <textarea id="catalog-provides" value={form.whatClientProvides} onChange={(e) => setForm({ ...form, whatClientProvides: e.target.value })} />
            <label htmlFor="catalog-billing">Cobrança</label>
            <select id="catalog-billing" value={form.billingType} onChange={(e) => setForm({ ...form, billingType: e.target.value as "mensal" | "unica" })}>
              <option value="mensal">Mensal</option>
              <option value="unica">Taxa única</option>
            </select>
            {form.billingType === "mensal" ? (
              <>
                <label htmlFor="catalog-price">Preço mensal (R$)</label>
                <input id="catalog-price" type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </>
            ) : (
              <div className="row">
                <div>
                  <label htmlFor="catalog-full-price">Preço cheio (R$)</label>
                  <input id="catalog-full-price" type="number" min="0" value={form.fullPrice} onChange={(e) => setForm({ ...form, fullPrice: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="catalog-discounted-price">Preço com desconto (R$)</label>
                  <input id="catalog-discounted-price" type="number" min="0" value={form.discountedPrice} onChange={(e) => setForm({ ...form, discountedPrice: e.target.value })} />
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : form.id ? "Salvar alterações" : "Adicionar item"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
          {saveError ? <div className="pill bad" style={{ marginTop: "var(--space-sm)" }}>{saveError}</div> : null}
        </Card>
        </Dialog>
      ) : null}

      {error ? (
        <EmptyState title="Não foi possível carregar o catálogo" description={error} />
      ) : !items ? (
        <Skeleton height={110} />
      ) : items.length === 0 ? (
        <EmptyState title="Catálogo vazio" description='Clique em "+ Novo item" pra cadastrar seu primeiro plano ou serviço.' />
      ) : (
        <div className="stack-lg">
          {[...grouped.entries()].map(([category, categoryItems]) => (
            <div key={category}>
              <h2 className={styles.categoryTitle}>{category}</h2>
              <Card style={{ padding: "var(--space-md)", marginBottom: "var(--space-sm)" }}>
                <label htmlFor={`process-${category}`}>Como trabalhamos em {category}</label>
                <textarea
                  id={`process-${category}`}
                  placeholder="Texto usado na Apresentação institucional pra essa categoria."
                  value={processDrafts[category] ?? processes[category] ?? ""}
                  onChange={(e) => setProcessDrafts((current) => ({ ...current, [category]: e.target.value }))}
                />
                <Button type="button" variant="secondary" disabled={savingProcess === category} onClick={() => saveProcess(category)}>
                  {savingProcess === category ? "Salvando..." : "Salvar processo"}
                </Button>
              </Card>
              <div className={styles.grid}>
                {categoryItems.map((item) => (
                  <Card key={item.id} style={{ padding: "var(--space-lg)" }}>
                    <div className={styles.itemHead}>
                      <b>{item.name}</b>
                      <span className="pill">{item.billingType === "mensal" ? "Mensal" : "Taxa única"}</span>
                    </div>
                    <p className="muted" style={{ margin: "var(--space-2xs) 0 var(--space-sm)" }}>{item.description}</p>
                    <p style={{ margin: 0, fontWeight: 700 }}>
                      {item.billingType === "mensal"
                        ? `R$ ${item.price}/mês`
                        : item.discountedPrice < item.fullPrice
                          ? `De R$ ${item.fullPrice} por R$ ${item.discountedPrice}`
                          : `R$ ${item.fullPrice}`}
                    </p>
                    <div className="actions-row" style={{ marginTop: "var(--space-sm)" }}>
                      <Button type="button" variant="secondary" onClick={() => startEdit(item)}>Editar</Button>
                      <Button type="button" variant="secondary" disabled={deletingId === item.id} onClick={() => handleDelete(item.id)}>
                        {deletingId === item.id ? "Apagando..." : "Apagar"}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
