import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { commercialAssetUrl, deleteCommercialPortfolioItem, fileToDataUrl, listCommercialPortfolio, saveCommercialPortfolioItem, type CommercialPortfolioItem } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ComercialTabs } from "@/components/ComercialTabs";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./ComercialPortfolio.module.css";

const EMPTY_FORM = { category: "", caption: "" };

export function ComercialPortfolio() {
  const [items, setItems] = useState<CommercialPortfolioItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    listCommercialPortfolio()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0] || null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.category.trim() || !file) {
      setSaveError("Categoria e imagem são obrigatórias.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await saveCommercialPortfolioItem({ category: form.category, caption: form.caption, filename: file.name, dataUrl });
      setForm(EMPTY_FORM);
      setFile(null);
      setShowForm(false);
      load();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar esta arte do portfólio?")) return;
    setDeletingId(id);
    try {
      await deleteCommercialPortfolioItem(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  const grouped = new Map<string, CommercialPortfolioItem[]>();
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
          <h1>Portfólio</h1>
          <p>Artes de exemplo mostradas na Apresentação institucional, por categoria.</p>
        </div>
        <div className="actions-row">
          <Button variant={showForm ? "secondary" : "primary"} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "+ Nova arte"}
          </Button>
        </div>
      </div>

      {showForm ? (
        <Card style={{ padding: "var(--space-lg)", marginBottom: "var(--space-lg)" }}>
          <b>Nova arte</b>
          <form onSubmit={handleSubmit}>
            <label htmlFor="portfolio-category">Categoria</label>
            <input id="portfolio-category" placeholder="Criação de Conteúdo" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <label htmlFor="portfolio-caption">Legenda (opcional)</label>
            <input id="portfolio-caption" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
            <label htmlFor="portfolio-image">Imagem</label>
            <input id="portfolio-image" type="file" accept="image/*" onChange={handleFileChange} />
            <Button type="submit" className="full-width" style={{ marginTop: "var(--space-sm)" }} disabled={saving}>
              {saving ? "Salvando..." : "Adicionar arte"}
            </Button>
          </form>
          {saveError ? <div className="pill bad" style={{ marginTop: "var(--space-sm)" }}>{saveError}</div> : null}
        </Card>
      ) : null}

      {error ? (
        <EmptyState title="Não foi possível carregar o portfólio" description={error} />
      ) : !items ? (
        <Skeleton height={110} />
      ) : items.length === 0 ? (
        <EmptyState title="Portfólio vazio" description='Clique em "+ Nova arte" pra cadastrar seu primeiro exemplo.' />
      ) : (
        <div className="stack-lg">
          {[...grouped.entries()].map(([category, categoryItems]) => (
            <div key={category}>
              <h2 className={styles.categoryTitle}>{category}</h2>
              <div className={styles.grid}>
                {categoryItems.map((item) => (
                  <Card key={item.id} style={{ padding: "var(--space-sm)" }}>
                    <img src={commercialAssetUrl(item.imagePath)} alt={item.caption || category} className={styles.thumb} />
                    {item.caption ? <p className="muted" style={{ margin: "var(--space-xs) 0 0" }}>{item.caption}</p> : null}
                    <Button type="button" variant="secondary" className="full-width" style={{ marginTop: "var(--space-xs)" }} disabled={deletingId === item.id} onClick={() => handleDelete(item.id)}>
                      {deletingId === item.id ? "Apagando..." : "Apagar"}
                    </Button>
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
