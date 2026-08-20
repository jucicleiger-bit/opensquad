import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { commercialAssetUrl, fileToDataUrl, getCommercialAgency, saveCommercialAgency, saveCommercialAgencyLogo, type CommercialAgency } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ComercialTabs } from "@/components/ComercialTabs";
import styles from "./ComercialAgencia.module.css";

export function ComercialAgencia() {
  const [agency, setAgency] = useState<CommercialAgency | null>(null);
  const [form, setForm] = useState({ name: "", contactPhone: "", contactInstagram: "" });
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getCommercialAgency()
      .then((res) => {
        setAgency(res.agency);
        setForm({ name: res.agency.name, contactPhone: res.agency.contactPhone, contactInstagram: res.agency.contactInstagram });
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await saveCommercialAgency(form);
      setAgency(res.agency);
      setMessage("Dados da agência salvos.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await saveCommercialAgencyLogo({ filename: file.name, dataUrl });
      setAgency(res.agency);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <ComercialTabs />
      <div className="page-head">
        <div>
          <h1>Minha agência</h1>
          <p>Nome, logo e contato usados em toda proposta gerada.</p>
        </div>
      </div>

      <Card style={{ padding: "var(--space-lg)" }}>
        {agency?.logoPath ? (
          <img src={commercialAssetUrl(agency.logoPath)} alt="Logo da agência" className={styles.logoPreview} />
        ) : (
          <p className="muted">Nenhuma logo enviada ainda.</p>
        )}
        <label htmlFor="agency-logo-upload">Logo</label>
        <input id="agency-logo-upload" type="file" accept="image/*" disabled={uploadingLogo} onChange={handleLogoUpload} />

        <form onSubmit={handleSubmit}>
          <label htmlFor="agency-name">Nome da agência</label>
          <input id="agency-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label htmlFor="agency-phone">Telefone</label>
          <input id="agency-phone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          <label htmlFor="agency-instagram">Instagram</label>
          <input id="agency-instagram" value={form.contactInstagram} onChange={(e) => setForm({ ...form, contactInstagram: e.target.value })} />
          <Button type="submit" className="full-width" style={{ marginTop: "var(--space-sm)" }} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </form>
        {message ? <p className="pill ok" style={{ marginTop: "var(--space-sm)" }}>{message}</p> : null}
        {error ? <div className="pill bad" style={{ marginTop: "var(--space-sm)" }}>{error}</div> : null}
      </Card>
    </div>
  );
}
