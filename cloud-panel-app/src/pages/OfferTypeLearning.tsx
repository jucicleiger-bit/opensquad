import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

interface LearningEntry {
  id: string;
  bucket: string;
  kind: "text" | "image";
  text: string;
  title: string;
  storagePath?: string;
  source: string;
  createdAt: string;
  [key: string]: unknown;
}

interface OfferTypeNode { baseInstruction?: string; entries: LearningEntry[] }
interface OfferTypeStore { types: Record<string, OfferTypeNode> }

const EMPTY_STORE: OfferTypeStore = { types: {} };
const BUCKETS: Array<[string, string]> = [["technical", "Técnico"], ["approved", "Aprovado"], ["avoid", "Evitar"]];
const OFFER_TYPES: Array<[string, string]> = [
  ["offer", "Oferta direta"], ["service", "Serviço"], ["combo", "Combo / promoção"],
  ["rodizio", "Rodízio"], ["delivery", "Delivery"], ["product", "Produto destaque"],
  ["orientation", "Post de orientação"], ["desire", "Post de desejo"],
  ["urgency", "Urgência / hoje tem"], ["institutional", "Institucional"],
  ["social_proof", "Prova social"],
];

interface EntryDraft {
  id: string;
  type: string;
  bucket: string;
  kind: "text" | "image";
  text: string;
  title: string;
}

function newDraft(type: string): EntryDraft {
  return { id: crypto.randomUUID(), type, bucket: "approved", kind: "text", text: "", title: "" };
}

export function OfferTypeLearning() {
  const [store, setStore] = useState<OfferTypeStore>(EMPTY_STORE);
  const [rowId, setRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [instructionDrafts, setInstructionDrafts] = useState<Record<string, string>>({});
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [entryDraftFile, setEntryDraftFile] = useState<File | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase.from("global_learning").select("id, offer_type_learnings").single();
    if (queryError) {
      if (queryError.code !== "PGRST116") { setError(queryError.message); return; }
      setStore(EMPTY_STORE);
      setRowId(null);
    } else {
      const raw = data.offer_type_learnings as { types?: unknown } | null;
      const types = raw && typeof raw === "object" && raw.types && typeof raw.types === "object" ? (raw.types as Record<string, unknown>) : {};
      setStore({ types: types as OfferTypeStore["types"] });
      setRowId(data.id);
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, []);

  async function ensureSignedUrl(entry: LearningEntry) {
    if (!entry.storagePath || signedUrls[entry.id]) return;
    const { data } = await supabase.storage.from("content-media").createSignedUrl(entry.storagePath, 300);
    if (data) setSignedUrls((prev) => ({ ...prev, [entry.id]: data.signedUrl }));
  }

  useEffect(() => {
    Object.values(store.types).forEach((node) => {
      const entries = Array.isArray(node?.entries) ? node.entries : [];
      entries.forEach((entry) => { if (entry.kind === "image") ensureSignedUrl(entry); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  async function persist(nextStore: OfferTypeStore): Promise<boolean> {
    if (!rowId) { setError("Nenhum registro de Aprendizado encontrado — rode a migração primeiro."); return false; }
    setBusy(true);
    const { error: updateError } = await supabase.from("global_learning").update({ offer_type_learnings: nextStore }).eq("id", rowId);
    if (updateError) { setError(updateError.message); setBusy(false); return false; }
    setStore(nextStore);
    setBusy(false);
    return true;
  }

  async function saveInstruction(type: string) {
    const text = instructionDrafts[type];
    if (text === undefined) return;
    const node = store.types[type] || { entries: [] };
    const ok = await persist({ types: { ...store.types, [type]: { ...node, baseInstruction: text.trim() } } });
    if (ok) setInstructionDrafts((prev) => { const next = { ...prev }; delete next[type]; return next; });
  }

  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!entryDraft || !entryDraft.text.trim()) return;
    let storagePath: string | undefined;
    if (entryDraft.kind === "image" && entryDraftFile) {
      const path = `learning/offer-type/${entryDraft.type}/${entryDraft.id}-${entryDraftFile.name}`;
      const { error: uploadError } = await supabase.storage.from("content-media").upload(path, entryDraftFile, {
        contentType: entryDraftFile.type || "application/octet-stream",
      });
      if (uploadError) { setError(uploadError.message); return; }
      storagePath = path;
    }
    const node = store.types[entryDraft.type] || { entries: [] };
    const entries = Array.isArray(node?.entries) ? node.entries : [];
    const entry: LearningEntry = {
      id: entryDraft.id, bucket: entryDraft.bucket, kind: entryDraft.kind,
      text: entryDraft.text.trim(), title: entryDraft.kind === "image" ? entryDraft.title.trim() : "",
      storagePath, source: "manual", createdAt: new Date().toISOString(),
    };
    const ok = await persist({ types: { ...store.types, [entryDraft.type]: { ...node, entries: upsertById(entries, entry) } } });
    if (ok) { setEntryDraft(null); setEntryDraftFile(null); } else if (storagePath) {
      const { error: cleanupError } = await supabase.storage.from("content-media").remove([storagePath]);
      if (cleanupError) {
        setError((current) => `${current ? current + " " : ""}(arquivo enviado não pôde ser limpo: ${cleanupError.message})`);
      }
    }
  }

  async function deleteEntry(type: string, entry: LearningEntry) {
    if (!confirm("Apagar esta entrada?")) return;
    const node = store.types[type];
    if (!node) return;
    const entries = Array.isArray(node?.entries) ? node.entries : [];
    const ok = await persist({ types: { ...store.types, [type]: { ...node, entries: removeById(entries, entry.id) } } });
    if (ok && entry.storagePath) {
      const { error: removeError } = await supabase.storage.from("content-media").remove([entry.storagePath]);
      if (removeError) setError(removeError.message);
    }
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded) return <div className="card">Carregando...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Aprendizado por Tipo de Oferta</h2>
      {OFFER_TYPES.map(([type, label]) => {
        const node = store.types[type];
        const entries = Array.isArray(node?.entries) ? node.entries : [];
        return (
          <Card key={type} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ margin: 0 }}>{label}</h2>
            <textarea
              placeholder="Instrução base"
              value={instructionDrafts[type] ?? node?.baseInstruction ?? ""}
              onChange={(e) => setInstructionDrafts((prev) => ({ ...prev, [type]: e.target.value }))}
            />
            <Button onClick={() => saveInstruction(type)} disabled={busy}>Salvar instrução</Button>

            {entries.map((entry) => (
              <div key={entry.id} className="field-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                {entry.kind === "image" && signedUrls[entry.id] ? (
                  <img src={signedUrls[entry.id]} alt={entry.title || entry.text} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4 }} />
                ) : null}
                <span style={{ flex: 1 }}>[{entry.bucket}] {entry.text}</span>
                <Button variant="ghost" onClick={() => deleteEntry(type, entry)} disabled={busy}>Apagar</Button>
              </div>
            ))}
            {entryDraft?.type === type ? (
              <form onSubmit={saveEntry} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={entryDraft.bucket} onChange={(e) => setEntryDraft({ ...entryDraft, bucket: e.target.value })}>
                  {BUCKETS.map(([value, label2]) => <option key={value} value={value}>{label2}</option>)}
                </select>
                <select value={entryDraft.kind} onChange={(e) => setEntryDraft({ ...entryDraft, kind: e.target.value as "text" | "image" })}>
                  <option value="text">Texto</option>
                  <option value="image">Imagem</option>
                </select>
                {entryDraft.kind === "image" ? (
                  <>
                    <input type="text" placeholder="Título" value={entryDraft.title} onChange={(e) => setEntryDraft({ ...entryDraft, title: e.target.value })} />
                    <input type="file" accept="image/*" onChange={(e) => setEntryDraftFile(e.target.files?.[0] || null)} required />
                  </>
                ) : null}
                <textarea placeholder="Texto do aprendizado" value={entryDraft.text} onChange={(e) => setEntryDraft({ ...entryDraft, text: e.target.value })} required />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button type="submit" disabled={busy}>Salvar</Button>
                  <Button type="button" variant="ghost" onClick={() => { setEntryDraft(null); setEntryDraftFile(null); }}>Cancelar</Button>
                </div>
              </form>
            ) : (
              <Button variant="ghost" onClick={() => setEntryDraft(newDraft(type))} disabled={!rowId}>+ Nova entrada</Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}
