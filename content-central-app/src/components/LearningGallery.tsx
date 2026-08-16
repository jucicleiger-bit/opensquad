import { useState } from "react";
import { analyzeLearningImage, deleteLearningEntry, fileToDataUrl, saveLearningEntry, type SegmentLearningEntry } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export function LearningGallery({
  scope,
  groupKey,
  entries,
  onEntriesChange,
  splitImagePurposes = false,
}: {
  scope: "segment" | "offerType";
  groupKey: string;
  entries: SegmentLearningEntry[];
  onEntriesChange: (entries: SegmentLearningEntry[]) => void;
  splitImagePurposes?: boolean;
}) {
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ imagePath: string; suggestedText: string; purpose?: "product" | "creative" } | null>(null);
  const [pendingImageText, setPendingImageText] = useState("");
  const [pendingPostType, setPendingPostType] = useState<"offer" | "institutional" | "special_date" | "ad_creative" | "">("");
  const [pendingShape, setPendingShape] = useState<"vertical" | "feed" | "">("");
  const [error, setError] = useState<string | null>(null);

  async function handleAddText() {
    if (!newText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveLearningEntry({ scope, groupKey, bucket: "approved", kind: "text", text: newText.trim() });
      onEntriesChange(result.entries);
      setNewText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadImage(file: File, purpose?: "product" | "creative") {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const analyzed = await analyzeLearningImage({ scope, groupKey, dataUrl, filename: file.name, purpose });
      setPendingImage({ ...analyzed, purpose });
      setPendingImageText(analyzed.suggestedText);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmImage() {
    if (!pendingImage) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveLearningEntry({
        scope, groupKey, bucket: "approved", kind: "image", text: pendingImageText, imagePath: pendingImage.imagePath, purpose: pendingImage.purpose,
        ...(pendingImage.purpose === "creative" ? { postType: pendingPostType || undefined, shape: pendingShape || undefined } : {}),
      });
      onEntriesChange(result.entries);
      setPendingImage(null);
      setPendingImageText("");
      setPendingPostType("");
      setPendingShape("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(entryId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteLearningEntry({ scope, groupKey, entryId });
      onEntriesChange(result.entries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const buckets: { key: SegmentLearningEntry["bucket"]; label: string }[] = [
    { key: "approved", label: "Aprovado" },
    { key: "avoid", label: "Evitar" },
    { key: "technical", label: "Base técnica" },
  ];

  return (
    <div>
      {buckets.map(({ key, label }) => {
        const bucketEntries = entries.filter((entry) => entry.bucket === key);
        if (!bucketEntries.length) return null;
        return (
          <div key={key} style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
            {bucketEntries.map((entry) => (
              <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {entry.kind === "image" && entry.imagePath ? (
                    <img
                      src={`/api/learning-assets/${entry.imagePath.split("/").map(encodeURIComponent).join("/")}`}
                      alt={entry.text || "Referência de aprendizado"}
                      style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, flex: "0 0 auto" }}
                    />
                  ) : null}
                  <span>{entry.text}</span>
                  {splitImagePurposes && entry.kind === "image" ? <span className="pill">{entry.purpose === "product" ? "Produto" : "Criativo"}</span> : null}
                </div>
                <Button variant="ghost" disabled={busy} onClick={() => handleDelete(entry.id)}>Apagar</Button>
              </div>
            ))}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          aria-label="Novo aprendizado (texto)"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Ex: não parecer gerado por IA, ser mais detalhista"
        />
        <Button disabled={busy} onClick={handleAddText}>Adicionar</Button>
      </div>
      {!splitImagePurposes && <div style={{ marginTop: 8 }}>
        <label htmlFor={`upload-${groupKey}`}>Adicionar imagem de referência</label>
        <input
          id={`upload-${groupKey}`}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleUploadImage(e.target.files[0])}
        />
      </div>}
      {splitImagePurposes ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 8 }}>
          {[{ purpose: "product" as const, label: "Refer\u00eancia de produto" }, { purpose: "creative" as const, label: "Refer\u00eancia de estrutura de criativo" }].map(({ purpose, label }) => (
            <div key={purpose}>
              <label htmlFor={`upload-${purpose}-${groupKey}`}>{label}</label>
              <input id={`upload-${purpose}-${groupKey}`} type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleUploadImage(e.target.files[0], purpose)} />
            </div>
          ))}
        </div>
      ) : null}
      {pendingImage ? (
        <Card style={{ padding: 12, marginTop: 8 }}>
          <p className="muted">A IA descreveu: revise antes de confirmar.</p>
          <textarea value={pendingImageText} onChange={(e) => setPendingImageText(e.target.value)} />
          {pendingImage.purpose === "creative" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div>
                <label htmlFor="pending-post-type">Tipo de post</label>
                <select id="pending-post-type" value={pendingPostType} onChange={(e) => setPendingPostType(e.target.value as typeof pendingPostType)}>
                  <option value="">Selecione</option>
                  <option value="offer">Oferta</option>
                  <option value="institutional">Institucional</option>
                  <option value="special_date">Data comemorativa</option>
                  <option value="ad_creative">Anúncio pago</option>
                </select>
              </div>
              <div>
                <label htmlFor="pending-shape">Formato</label>
                <select id="pending-shape" value={pendingShape} onChange={(e) => setPendingShape(e.target.value as typeof pendingShape)}>
                  <option value="">Selecione</option>
                  <option value="vertical">Vertical (Stories/Reels)</option>
                  <option value="feed">Feed</option>
                </select>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button disabled={busy} onClick={handleConfirmImage}>Confirmar</Button>
            <Button variant="secondary" onClick={() => { setPendingImage(null); setPendingPostType(""); setPendingShape(""); }}>Descartar</Button>
          </div>
        </Card>
      ) : null}
      {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
