import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";
import { REFERENCE_CATEGORIES, REFERENCE_WEIGHTS, roleForCategory, automaticRuleForCategory, buildReferenceStoragePath } from "@/lib/references";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

interface Reference {
  id: string;
  filename: string;
  relativePath: string;
  storagePath?: string;
  mimeType: string;
  bytes: number;
  role: string;
  usageRoles: string[];
  referenceCategory: string;
  weight: string;
  instruction: string;
  automaticRule: string;
  useInNextGeneration: boolean;
  createdAt: string;
  [key: string]: unknown;
}

interface ReferenceDraft {
  id: string;
  referenceCategory: string;
  weight: string;
  instruction: string;
  useInNextGeneration: boolean;
}

function draftFromReference(reference: Reference): ReferenceDraft {
  return {
    id: reference.id,
    referenceCategory: reference.referenceCategory,
    weight: reference.weight,
    instruction: reference.instruction,
    useInNextGeneration: reference.useInNextGeneration,
  };
}

export function References() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [slug, setSlug] = useState<string | null>(null);
  const [brandProfile, setBrandProfile] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const [editDraft, setEditDraft] = useState<ReferenceDraft | null>(null);
  const [newCategory, setNewCategory] = useState("visual_inspiration");
  const [newInstruction, setNewInstruction] = useState("");

  const references: Reference[] = Array.isArray(brandProfile.references) ? (brandProfile.references as Reference[]) : [];

  async function load() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("slug, brand_profile")
      .eq("id", project.id)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setSlug(data.slug);
    setBrandProfile(data.brand_profile && typeof data.brand_profile === "object" ? data.brand_profile : {});
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function ensureSignedUrl(reference: Reference) {
    if (!reference.storagePath || signedUrls[reference.id]) return;
    const { data } = await supabase.storage.from("content-media").createSignedUrl(reference.storagePath, 300);
    if (data) setSignedUrls((prev) => ({ ...prev, [reference.id]: data.signedUrl }));
  }

  useEffect(() => {
    references.forEach((reference) => {
      if (reference.mimeType.startsWith("image/")) ensureSignedUrl(reference);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandProfile]);

  async function persist(nextReferences: Reference[]): Promise<boolean> {
    setBusy(true);
    const nextBrandProfile = { ...brandProfile, references: nextReferences };
    const { error: updateError } = await supabase.from("projects").update({ brand_profile: nextBrandProfile }).eq("id", project.id);
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return false;
    }
    setBrandProfile(nextBrandProfile);
    setBusy(false);
    return true;
  }

  async function addReference(e: FormEvent) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !slug) return;

    setBusy(true);
    const id = crypto.randomUUID();
    const storagePath = buildReferenceStoragePath(slug, id, file.name);
    const { error: uploadError } = await supabase.storage.from("content-media").upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const role = roleForCategory(newCategory);
    const reference: Reference = {
      id,
      filename: file.name,
      relativePath: `assets/references/${file.name}`,
      storagePath,
      mimeType: file.type || "application/octet-stream",
      bytes: file.size,
      role,
      usageRoles: [role],
      referenceCategory: newCategory,
      weight: "medium",
      instruction: newInstruction.trim(),
      automaticRule: automaticRuleForCategory(newCategory),
      useInNextGeneration: true,
      createdAt: new Date().toISOString(),
    };
    const ok = await persist(upsertById(references, reference));
    if (ok) {
      setNewCategory("visual_inspiration");
      setNewInstruction("");
      input.value = "";
    } else {
      const { error: cleanupError } = await supabase.storage.from("content-media").remove([storagePath]);
      if (cleanupError) {
        setError((current) => `${current ? current + " " : ""}(arquivo enviado não pôde ser limpo: ${cleanupError.message})`);
      }
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editDraft) return;
    const original = references.find((r) => r.id === editDraft.id);
    if (!original) return;
    const role = roleForCategory(editDraft.referenceCategory);
    const updated: Reference = {
      ...original,
      referenceCategory: editDraft.referenceCategory,
      role,
      weight: editDraft.weight,
      instruction: editDraft.instruction,
      useInNextGeneration: editDraft.useInNextGeneration,
      automaticRule: automaticRuleForCategory(editDraft.referenceCategory),
    };
    const ok = await persist(upsertById(references, updated));
    if (ok) setEditDraft(null);
  }

  async function deleteReference(reference: Reference) {
    if (!confirm("Apagar esta referência?")) return;
    const ok = await persist(removeById(references, reference.id));
    if (ok && reference.storagePath) {
      const { error: removeError } = await supabase.storage.from("content-media").remove([reference.storagePath]);
      if (removeError) setError(removeError.message);
    }
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded) return <div className="card">Carregando...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ margin: "0 0 var(--space-2xs)" }}>Imagem e identidade visual</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
          Referências visuais usadas para orientar a geração de conteúdo.
        </p>
      </div>

      <Card style={{ padding: 20 }}>
        <div className="reference-gallery">
          {references.map((reference) => (
            <div key={reference.id} className="reference-card">
              <div className="reference-thumb">
                {reference.mimeType.startsWith("image/") && signedUrls[reference.id] ? (
                  <img src={signedUrls[reference.id]} alt={reference.filename} />
                ) : (
                  <span>{reference.storagePath ? reference.filename : "arquivo indisponível"}</span>
                )}
              </div>
              <div className="reference-body">
                <div className="reference-name">{reference.filename}</div>
                <div className="reference-meta">
                  <span className="pill">{reference.referenceCategory}</span>
                  <span className="pill">peso {reference.weight}</span>
                </div>
                <p className="reference-note">{reference.instruction || "Sem observação."}</p>
                <div className="card-actions">
                  <Button onClick={() => setEditDraft(draftFromReference(reference))}>Editar</Button>
                  <Button variant="ghost" onClick={() => deleteReference(reference)} disabled={busy}>Apagar</Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {editDraft ? (
          <form onSubmit={saveEdit} className="reference-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <select value={editDraft.referenceCategory} onChange={(e) => setEditDraft({ ...editDraft, referenceCategory: e.target.value })}>
              {REFERENCE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={editDraft.weight} onChange={(e) => setEditDraft({ ...editDraft, weight: e.target.value })}>
              {REFERENCE_WEIGHTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <textarea placeholder="Instrução" value={editDraft.instruction} onChange={(e) => setEditDraft({ ...editDraft, instruction: e.target.value })} />
            <label>
              <input type="checkbox" checked={editDraft.useInNextGeneration} onChange={(e) => setEditDraft({ ...editDraft, useInNextGeneration: e.target.checked })} /> Usar na próxima geração
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="submit" disabled={busy}>Salvar</Button>
              <Button type="button" variant="secondary" onClick={() => setEditDraft(null)}>Cancelar</Button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card style={{ padding: 20 }}>
        <h2 style={{ margin: 0 }}>Adicionar referência</h2>
        <form onSubmit={addReference} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input type="file" name="file" accept="image/*,.pdf,.txt,.md,.doc,.docx" required />
          <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
            {REFERENCE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="text" placeholder="Observação curta" value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} />
          <Button type="submit" disabled={busy}>Enviar</Button>
        </form>
      </Card>
    </div>
  );
}
