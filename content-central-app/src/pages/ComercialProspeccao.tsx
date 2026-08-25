import { useEffect, useState, type FormEvent } from "react";
import { deleteCommercialProspect, listCommercialProspects, saveCommercialProspect, type CommercialProspect } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ComercialTabs } from "@/components/ComercialTabs";
import { Dialog } from "@/components/Dialog";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./ComercialProspeccao.module.css";

const STATUS_LABELS: Record<CommercialProspect["status"], string> = {
  nao_contatado: "Não contatado",
  contatado: "Contatado",
  respondeu: "Respondeu",
  fechou: "Fechou",
};

const EMPTY_FORM = { id: "", name: "", googleMapsUrl: "", instagram: "", phone: "" };

export function ComercialProspeccao() {
  const [items, setItems] = useState<CommercialProspect[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    listCommercialProspects()
      .then((res) => {
        setItems(res.items);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  function startCreate() {
    setForm(EMPTY_FORM);
    setSaveError(null);
    setShowForm(true);
  }

  function startEdit(item: CommercialProspect) {
    setForm({ id: item.id, name: item.name, googleMapsUrl: item.googleMapsUrl, instagram: item.instagram, phone: item.phone });
    setSaveError(null);
    setShowForm(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setSaveError("Nome é obrigatório.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const existing = items?.find((item) => item.id === form.id);
      await saveCommercialProspect({
        id: form.id || undefined,
        name: form.name,
        googleMapsUrl: form.googleMapsUrl,
        instagram: form.instagram,
        phone: form.phone,
        status: existing?.status,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(item: CommercialProspect, status: CommercialProspect["status"]) {
    setItems((current) => current?.map((entry) => (entry.id === item.id ? { ...entry, status } : entry)) || current);
    try {
      await saveCommercialProspect({ ...item, status });
    } catch (err) {
      setError((err as Error).message);
      load();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar esta prospecção?")) return;
    setDeletingId(id);
    try {
      await deleteCommercialProspect(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  const list = items || [];
  const counts = {
    total: list.length,
    contatado: list.filter((item) => item.status !== "nao_contatado").length,
    respondeu: list.filter((item) => item.status === "respondeu" || item.status === "fechou").length,
    fechou: list.filter((item) => item.status === "fechou").length,
  };

  return (
    <div className={styles.wrap}>
      <ComercialTabs />
      <div className="page-head">
        <div>
          <h1>Prospecção</h1>
          <p>Controle das empresas que você está prospectando manualmente.</p>
        </div>
        <div className="actions-row">
          <Button variant={showForm ? "secondary" : "primary"} onClick={() => (showForm ? setShowForm(false) : startCreate())}>
            {showForm ? "Cancelar" : "+ Nova prospecção"}
          </Button>
        </div>
      </div>

      {items ? (
        <div className={styles.stats}>
          <Card style={{ padding: "var(--space-md)" }}>
            <p className={styles.statValue}>{counts.total}</p>
            <p className={`muted ${styles.statLabel}`}>Total</p>
          </Card>
          <Card style={{ padding: "var(--space-md)" }}>
            <p className={styles.statValue}>{counts.contatado}</p>
            <p className={`muted ${styles.statLabel}`}>Contatados</p>
          </Card>
          <Card style={{ padding: "var(--space-md)" }}>
            <p className={styles.statValue}>{counts.respondeu}</p>
            <p className={`muted ${styles.statLabel}`}>Responderam</p>
          </Card>
          <Card style={{ padding: "var(--space-md)" }}>
            <p className={styles.statValue}>{counts.fechou}</p>
            <p className={`muted ${styles.statLabel}`}>Fechou</p>
          </Card>
        </div>
      ) : null}

      {showForm ? (
        <Dialog
          onClose={() => setShowForm(false)}
          titleId="prospect-form-title"
          overlayClassName={styles.formDialogOverlay}
          contentClassName={styles.formDialogContent}
        >
          <Card style={{ padding: "var(--space-lg)" }}>
            <h2 id="prospect-form-title" style={{ marginTop: 0 }}>{form.id ? "Editar prospecção" : "Nova prospecção"}</h2>
            <form onSubmit={handleSubmit}>
              <label htmlFor="prospect-name">Nome</label>
              <input id="prospect-name" placeholder="Padaria Bom Pão" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <label htmlFor="prospect-maps">Google Maps</label>
              <input id="prospect-maps" placeholder="https://maps.google.com/..." value={form.googleMapsUrl} onChange={(e) => setForm({ ...form, googleMapsUrl: e.target.value })} />
              <label htmlFor="prospect-instagram">Instagram</label>
              <input id="prospect-instagram" placeholder="@perfil" value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} />
              <label htmlFor="prospect-phone">Telefone</label>
              <input id="prospect-phone" placeholder="11999990000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvando..." : form.id ? "Salvar alterações" : "Adicionar prospecção"}
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
        <EmptyState title="Não foi possível carregar as prospecções" description={error} />
      ) : !items ? (
        <Skeleton height={110} />
      ) : items.length === 0 ? (
        <EmptyState title="Nenhuma prospecção ainda" description='Clique em "+ Nova prospecção" pra cadastrar a primeira.' />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Google Maps</th>
                <th>Instagram</th>
                <th>Telefone</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button type="button" className={styles.nameButton} onClick={() => startEdit(item)}>{item.name}</button>
                  </td>
                  <td>{item.googleMapsUrl ? <a href={item.googleMapsUrl} target="_blank" rel="noreferrer">abrir</a> : "—"}</td>
                  <td>{item.instagram ? <a href={`https://instagram.com/${item.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer">{item.instagram}</a> : "—"}</td>
                  <td>{item.phone || "—"}</td>
                  <td>
                    <label htmlFor={`status-${item.id}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                      {`Status de ${item.name}`}
                    </label>
                    <select id={`status-${item.id}`} value={item.status} onChange={(e) => handleStatusChange(item, e.target.value as CommercialProspect["status"])}>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Button type="button" variant="secondary" disabled={deletingId === item.id} onClick={() => handleDelete(item.id)}>
                      {deletingId === item.id ? "Apagando..." : "Apagar"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
