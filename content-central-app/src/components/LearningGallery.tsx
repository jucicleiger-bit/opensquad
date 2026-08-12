import { useState } from "react";
import { analyzeLearningImage, deleteLearningEntry, fileToDataUrl, saveLearningEntry, type SegmentLearningEntry } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export function LearningGallery({
  projectId,
  scope,
  groupKey,
  entries,
  onEntriesChange,
}: {
  projectId: string;
  scope: "segment" | "offerType";
  groupKey: string;
  entries: SegmentLearningEntry[];
  onEntriesChange: (entries: SegmentLearningEntry[]) => void;
}) {
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ imagePath: string; suggestedText: string } | null>(null);
  const [pendingImageText, setPendingImageText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAddText() {
    if (!newText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveLearningEntry(projectId, { scope, groupKey, bucket: "approved", kind: "text", text: newText.trim() });
      onEntriesChange(result.entries);
      setNewText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadImage(file: File) {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const analyzed = await analyzeLearningImage(projectId, { scope, groupKey, dataUrl, filename: file.name });
      setPendingImage(analyzed);
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
      const result = await saveLearningEntry(projectId, { scope, groupKey, bucket: "approved", kind: "image", text: pendingImageText, imagePath: pendingImage.imagePath });
      onEntriesChange(result.entries);
      setPendingImage(null);
      setPendingImageText("");
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
      const result = await deleteLearningEntry(projectId, { scope, groupKey, entryId });
      onEntriesChange(result.entries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {entries.map((entry) => (
        <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {entry.kind === "image" && entry.imagePath ? (
              <img
                // Segment/offer-type learning is shared across every project,
                // but the file itself lives under the project it was
                // uploaded from — use that, not the project currently open,
                // or the image 404/500s whenever they differ.
                src={`/api/projects/${encodeURIComponent(entry.sourceProjectId || projectId)}/assets/${entry.imagePath}`}
                alt={entry.text || "Referência de aprendizado"}
                style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, flex: "0 0 auto" }}
              />
            ) : null}
            <span>{entry.text}</span>
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => handleDelete(entry.id)}>Apagar</Button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          aria-label="Novo aprendizado (texto)"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Ex: não parecer gerado por IA, ser mais detalhista"
        />
        <Button disabled={busy} onClick={handleAddText}>Adicionar</Button>
      </div>
      <div style={{ marginTop: 8 }}>
        <label htmlFor={`upload-${groupKey}`}>Adicionar imagem de referência</label>
        <input
          id={`upload-${groupKey}`}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleUploadImage(e.target.files[0])}
        />
      </div>
      {pendingImage ? (
        <Card style={{ padding: 12, marginTop: 8 }}>
          <p className="muted">A IA descreveu: revise antes de confirmar.</p>
          <textarea value={pendingImageText} onChange={(e) => setPendingImageText(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button disabled={busy} onClick={handleConfirmImage}>Confirmar</Button>
            <Button variant="secondary" onClick={() => setPendingImage(null)}>Descartar</Button>
          </div>
        </Card>
      ) : null}
      {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
