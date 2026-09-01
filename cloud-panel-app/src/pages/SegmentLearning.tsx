import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";
import { segmentNodesForProject, type SegmentNodeRef, type LearningEntry } from "@/lib/segmentLearning";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

interface SegmentLearningStore {
  nodes: Record<string, { label: string; entries: LearningEntry[] }>;
}

const EMPTY_STORE: SegmentLearningStore = { nodes: {} };
const BUCKETS: Array<[string, string]> = [["technical", "Técnico"], ["approved", "Aprovado"], ["avoid", "Evitar"]];

interface EntryDraft {
  id: string;
  path: string;
  bucket: string;
  kind: "text" | "image";
  text: string;
  title: string;
}

function newDraft(path: string): EntryDraft {
  return { id: crypto.randomUUID(), path, bucket: "approved", kind: "text", text: "", title: "" };
}

function entriesOf(node: { entries?: unknown } | undefined): LearningEntry[] {
  return node && Array.isArray(node.entries) ? (node.entries as LearningEntry[]) : [];
}

export function SegmentLearning() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [nodes, setNodes] = useState<SegmentNodeRef[]>([]);
  const [store, setStore] = useState<SegmentLearningStore>(EMPTY_STORE);
  const [rowId, setRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [draftFile, setDraftFile] = useState<File | null>(null);

  async function load() {
    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select("company_profile")
      .eq("id", project.id)
      .single();
    if (projectError) {
      setError(projectError.message);
      return;
    }
    const profile = (projectData.company_profile || {}) as Record<string, unknown>;
    setNodes(segmentNodesForProject(
      String(profile.segmentGroup || ""),
      String(profile.segmentCategory || ""),
      String(profile.segmentSpecialty || ""),
    ));

    const { data: learning, error: learningError } = await supabase
      .from("global_learning")
      .select("id, segment_learnings")
      .single();
    if (learningError) {
      if (learningError.code !== "PGRST116") {
        setError(learningError.message);
        return;
      }
      setStore(EMPTY_STORE);
      setRowId(null);
    } else {
      const raw = learning.segment_learnings as { nodes?: unknown } | null;
      setStore({ nodes: raw && typeof raw === "object" && raw.nodes && typeof raw.nodes === "object" ? (raw.nodes as SegmentLearningStore["nodes"]) : {} });
      setRowId(learning.id);
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function ensureSignedUrl(entry: LearningEntry) {
    if (!entry.storagePath || signedUrls[entry.id]) return;
    const { data } = await supabase.storage.from("content-media").createSignedUrl(entry.storagePath, 300);
    if (data) setSignedUrls((prev) => ({ ...prev, [entry.id]: data.signedUrl }));
  }

  useEffect(() => {
    Object.values(store.nodes).forEach((node) => {
      entriesOf(node).forEach((entry) => { if (entry.kind === "image") ensureSignedUrl(entry); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  async function persist(nextStore: SegmentLearningStore): Promise<boolean> {
    if (!rowId) {
      setError("Nenhum registro de Aprendizado encontrado — rode a migração primeiro.");
      return false;
    }
    setBusy(true);
    const { error: updateError } = await supabase.from("global_learning").update({ segment_learnings: nextStore }).eq("id", rowId);
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return false;
    }
    setStore(nextStore);
    setBusy(false);
    return true;
  }

  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!draft || !draft.text.trim()) return;
    let storagePath: string | undefined;
    if (draft.kind === "image" && draftFile) {
      const path = `learning/segment/${draft.path.replace(/[^a-z0-9/-]/gi, "-")}/${draft.id}-${draftFile.name}`;
      const { error: uploadError } = await supabase.storage.from("content-media").upload(path, draftFile, {
        contentType: draftFile.type || "application/octet-stream",
      });
      if (uploadError) { setError(uploadError.message); return; }
      storagePath = path;
    }
    const node = store.nodes[draft.path] || { label: nodes.find((n) => n.path === draft.path)?.label || "", entries: [] };
    const entry: LearningEntry = {
      id: draft.id, bucket: draft.bucket, kind: draft.kind,
      text: draft.text.trim(), title: draft.kind === "image" ? draft.title.trim() : "",
      storagePath, source: "manual", createdAt: new Date().toISOString(),
    };
    const nextNode = { ...node, entries: upsertById(entriesOf(node), entry) };
    const ok = await persist({ nodes: { ...store.nodes, [draft.path]: nextNode } });
    if (ok) {
      setDraft(null);
      setDraftFile(null);
    } else if (storagePath) {
      const { error: cleanupError } = await supabase.storage.from("content-media").remove([storagePath]);
      if (cleanupError) {
        setError((current) => `${current ? current + " " : ""}(arquivo enviado não pôde ser limpo: ${cleanupError.message})`);
      }
    }
  }

  async function deleteEntry(path: string, entry: LearningEntry) {
    if (!confirm("Apagar esta entrada?")) return;
    const node = store.nodes[path];
    if (!node) return;
    const ok = await persist({ nodes: { ...store.nodes, [path]: { ...node, entries: removeById(entriesOf(node), entry.id) } } });
    if (ok && entry.storagePath) {
      const { error: removeError } = await supabase.storage.from("content-media").remove([entry.storagePath]);
      if (removeError) setError(removeError.message);
    }
  }

  if (error) return <Card style={{ padding: 20 }}>Erro: {error}</Card>;
  if (!loaded) return <Card style={{ padding: 20 }}>Carregando...</Card>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Aprendizado do Segmento</h2>
      {nodes.length === 0 ? <p>Este projeto ainda não tem Setor/Categoria/Especialidade definidos em Empresa.</p> : null}
      {nodes.map((node) => {
        const entries = entriesOf(store.nodes[node.path]);
        return (
          <Card key={node.path} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ margin: 0 }}>{node.level}: {node.label || "(sem nome)"}</h2>
            {entries.map((entry) => (
              <div key={entry.id} className="field-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                {entry.kind === "image" && signedUrls[entry.id] ? (
                  <img src={signedUrls[entry.id]} alt={entry.title || entry.text} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4 }} />
                ) : null}
                <span style={{ flex: 1 }}>[{entry.bucket}] {entry.text}</span>
                <Button variant="ghost" onClick={() => deleteEntry(node.path, entry)} disabled={busy}>Apagar</Button>
              </div>
            ))}
            {draft?.path === node.path ? (
              <form onSubmit={saveEntry} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={draft.bucket} onChange={(e) => setDraft({ ...draft, bucket: e.target.value })}>
                  {BUCKETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "text" | "image" })}>
                  <option value="text">Texto</option>
                  <option value="image">Imagem</option>
                </select>
                {draft.kind === "image" ? (
                  <>
                    <input type="text" placeholder="Título" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                    <input type="file" accept="image/*" onChange={(e) => setDraftFile(e.target.files?.[0] || null)} required />
                  </>
                ) : null}
                <textarea placeholder="Texto do aprendizado" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} required />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button type="submit" disabled={busy}>Salvar</Button>
                  <Button type="button" variant="ghost" onClick={() => { setDraft(null); setDraftFile(null); }}>Cancelar</Button>
                </div>
              </form>
            ) : (
              <Button variant="ghost" onClick={() => setDraft(newDraft(node.path))} disabled={!rowId}>+ Nova entrada</Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}
