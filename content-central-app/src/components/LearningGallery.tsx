import { useEffect, useState } from "react";
import {
  analyzeLearningImage,
  deleteLearningEntry,
  fileToDataUrl,
  saveLearningEntry,
  type SegmentLearningEntry,
  type SegmentLearningNode,
} from "@/api/client";
import { Button } from "@/components/Button";

type LearningPurpose = "product" | "creative";
type PostType = NonNullable<SegmentLearningEntry["postType"]>;
type Shape = NonNullable<SegmentLearningEntry["shape"]>;

const POST_TYPE_LABELS: Record<PostType, string> = {
  offer: "Oferta direta",
  service: "Servico",
  combo: "Combo / promocao",
  rodizio: "Rodizio",
  delivery: "Delivery",
  product: "Produto destaque",
  orientation: "Post de orientacao",
  desire: "Post de desejo",
  urgency: "Urgencia / hoje tem",
  institutional: "Institucional",
  social_proof: "Prova social",
  special_date: "Data comemorativa",
  ad_creative: "Anuncio pago",
};

const SHAPE_LABELS: Record<Shape, string> = {
  vertical: "Vertical (Stories/Reels)",
  feed: "Feed",
};

function isCreativeStructure(entry: SegmentLearningEntry) {
  return entry.kind === "image" && entry.purpose === "creative";
}

function isProductReference(entry: SegmentLearningEntry) {
  return entry.kind === "image" && entry.purpose === "product";
}

function previewSrc(entry: SegmentLearningEntry) {
  return entry.imagePath ? `/api/learning-assets/${entry.imagePath.split("/").map(encodeURIComponent).join("/")}` : "";
}

function structureTitle(entry: SegmentLearningEntry) {
  return entry.title || "Estrutura sem nome";
}

function emptyTemplate() {
  return { title: "", text: "", postType: "" as PostType | "", shape: "" as Shape | "" };
}

function preferredSegmentNode(nodes: SegmentLearningNode[]) {
  return nodes.find((node) => node.level === "especialidade")
    || nodes.find((node) => node.level === "nicho")
    || nodes.find((node) => node.level === "setor")
    || nodes[nodes.length - 1];
}

export function CreativeStructureGallery({
  scope,
  nodes,
  onNodeEntriesChange,
}: {
  scope: "segment" | "offerType";
  nodes: SegmentLearningNode[];
  onNodeEntriesChange: (path: string, entries: SegmentLearningEntry[]) => void;
}) {
  const [selectedPath, setSelectedPath] = useState("");
  const defaultNode = preferredSegmentNode(nodes);
  const selectedNode = nodes.find((node) => node.path === selectedPath) || defaultNode;

  useEffect(() => {
    if (!nodes.length) return;
    setSelectedPath((current) => (nodes.some((node) => node.path === current) ? current : preferredSegmentNode(nodes)?.path || ""));
  }, [nodes]);

  if (!selectedNode) return null;

  return (
    <div className="stack-md">
      {nodes.length > 1 ? (
        <div>
          <label htmlFor="creative-structure-node">Salvar e editar estruturas em</label>
          <select id="creative-structure-node" value={selectedNode.path} onChange={(event) => setSelectedPath(event.target.value)}>
            {nodes.map((node) => (
              <option key={node.path} value={node.path}>{node.label}</option>
            ))}
          </select>
          <p className="muted" style={{ margin: "var(--space-xs) 0 0", fontSize: "var(--text-sm)" }}>
            Estruturas salvas no Setor valem para todo o ramo; no Nicho ou Especialidade, ficam mais específicas.
          </p>
        </div>
      ) : null}
      <LearningGallery
        scope={scope}
        groupKey={selectedNode.path}
        entries={selectedNode.entries}
        onEntriesChange={(entries) => onNodeEntriesChange(selectedNode.path, entries)}
        splitImagePurposes
        showProductReferences={false}
        showHeading={false}
        onlyCreativeStructures
      />
    </div>
  );
}

export function ProductReferenceGallery({
  scope,
  nodes,
  onNodeEntriesChange,
}: {
  scope: "segment" | "offerType";
  nodes: SegmentLearningNode[];
  onNodeEntriesChange: (path: string, entries: SegmentLearningEntry[]) => void;
}) {
  const [selectedPath, setSelectedPath] = useState("");
  const defaultNode = preferredSegmentNode(nodes);
  const selectedNode = nodes.find((node) => node.path === selectedPath) || defaultNode;

  useEffect(() => {
    if (!nodes.length) return;
    setSelectedPath((current) => (nodes.some((node) => node.path === current) ? current : preferredSegmentNode(nodes)?.path || ""));
  }, [nodes]);

  if (!selectedNode) return null;

  return (
    <div className="stack-md">
      {nodes.length > 1 ? (
        <div>
          <label htmlFor="product-reference-node">Salvar e editar referencias de produto em</label>
          <select id="product-reference-node" value={selectedNode.path} onChange={(event) => setSelectedPath(event.target.value)}>
            {nodes.map((node) => (
              <option key={node.path} value={node.path}>{node.label}</option>
            ))}
          </select>
          <p className="muted" style={{ margin: "var(--space-xs) 0 0", fontSize: "var(--text-sm)" }}>
            Referencias salvas no Setor valem para todo o ramo; no Nicho ou Especialidade, ficam mais específicas.
          </p>
        </div>
      ) : null}
      <LearningGallery
        scope={scope}
        groupKey={selectedNode.path}
        entries={selectedNode.entries}
        onEntriesChange={(entries) => onNodeEntriesChange(selectedNode.path, entries)}
        splitImagePurposes
        showCreativeStructures={false}
        showHeading={false}
        onlyCreativeStructures
      />
    </div>
  );
}

export function LearningGallery({
  scope,
  groupKey,
  entries,
  onEntriesChange,
  splitImagePurposes = false,
  showCreativeStructures = true,
  showProductReferences = true,
  showHeading = true,
  onlyCreativeStructures = false,
}: {
  scope: "segment" | "offerType";
  groupKey: string;
  entries: SegmentLearningEntry[];
  onEntriesChange: (entries: SegmentLearningEntry[]) => void;
  splitImagePurposes?: boolean;
  showCreativeStructures?: boolean;
  showProductReferences?: boolean;
  showHeading?: boolean;
  onlyCreativeStructures?: boolean;
}) {
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ imagePath: string; suggestedText: string; purpose?: LearningPurpose } | null>(null);
  const [pendingImageText, setPendingImageText] = useState("");
  const [pendingStructureTitle, setPendingStructureTitle] = useState("");
  const [pendingPostType, setPendingPostType] = useState<PostType | "">("");
  const [pendingShape, setPendingShape] = useState<Shape | "">("");
  const [editingStructureId, setEditingStructureId] = useState<string | null>(null);
  const [editingStructure, setEditingStructure] = useState(emptyTemplate());
  const [error, setError] = useState<string | null>(null);

  const creativeStructures = entries.filter(isCreativeStructure);
  const productReferences = entries.filter(isProductReference);
  const bucketEntries = entries.filter((entry) => !isCreativeStructure(entry) && !isProductReference(entry));
  const canConfirmCreative = pendingImage?.purpose !== "creative" || (pendingStructureTitle.trim() && pendingPostType);
  const canSaveEdit = editingStructure.title.trim() && editingStructure.postType;
  const editingEntry = creativeStructures.find((entry) => entry.id === editingStructureId) || null;

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

  async function handleUploadImage(file: File, purpose?: LearningPurpose) {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const analyzed = await analyzeLearningImage({ scope, groupKey, dataUrl, filename: file.name, purpose });
      setPendingImage({ ...analyzed, purpose });
      setPendingImageText(analyzed.suggestedText);
      setPendingStructureTitle("");
      setPendingPostType("");
      setPendingShape("");
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
        scope,
        groupKey,
        bucket: "approved",
        kind: "image",
        title: pendingImage.purpose === "creative" ? pendingStructureTitle.trim() : undefined,
        text: pendingImageText,
        imagePath: pendingImage.imagePath,
        purpose: pendingImage.purpose,
        ...(pendingImage.purpose === "creative" ? { postType: pendingPostType || undefined, shape: pendingShape } : {}),
      });
      onEntriesChange(result.entries);
      clearPendingImage();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveStructureEdit(entry: SegmentLearningEntry) {
    setBusy(true);
    setError(null);
    try {
      const result = await saveLearningEntry({
        scope,
        groupKey,
        entryId: entry.id,
        bucket: entry.bucket,
        kind: "image",
        imagePath: entry.imagePath,
        purpose: "creative",
        title: editingStructure.title.trim(),
        text: editingStructure.text,
        postType: editingStructure.postType || undefined,
        shape: editingStructure.shape,
      });
      onEntriesChange(result.entries);
      setEditingStructureId(null);
      setEditingStructure(emptyTemplate());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(entryId: string) {
    if (!confirm("Apagar esta referência? Essa ação não pode ser desfeita.")) return;
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

  function beginEditStructure(entry: SegmentLearningEntry) {
    setEditingStructureId(entry.id);
    setEditingStructure({
      title: entry.title || "",
      text: entry.text,
      postType: entry.postType || "",
      shape: entry.shape || "",
    });
  }

  function clearPendingImage() {
    setPendingImage(null);
    setPendingImageText("");
    setPendingStructureTitle("");
    setPendingPostType("");
    setPendingShape("");
  }

  const buckets: { key: SegmentLearningEntry["bucket"]; label: string }[] = [
    { key: "approved", label: "Aprovado" },
    { key: "avoid", label: "Evitar" },
    { key: "technical", label: "Base tecnica" },
  ];

  return (
    <div className="stack-md">
      {splitImagePurposes && showCreativeStructures ? (
        <section className="field-card stack-sm">
          {showHeading ? (
            <div>
              <h3>Estruturas de criativo</h3>
              <p className="muted" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--text-sm)" }}>
                Somente estas referencias entram como modelo de layout na geração. Imagens comuns em Aprovado nao entram mais como estrutura.
              </p>
            </div>
          ) : null}
          {creativeStructures.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "var(--space-sm)" }}>
              {creativeStructures.map((entry) => (
                <div key={entry.id} className="field-card stack-sm">
                  {entry.imagePath ? (
                    <img src={previewSrc(entry)} alt={structureTitle(entry)} style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 10 }} />
                  ) : (
                    <div style={{ width: "100%", height: 160, borderRadius: 10, background: "var(--surface-2)" }} />
                  )}
                  <strong>{structureTitle(entry)}</strong>
                  <div className="actions-row" style={{ justifyContent: "flex-end" }}>
                    <Button variant="secondary" disabled={busy} onClick={() => beginEditStructure(entry)}>Editar</Button>
                    <Button variant="ghost" disabled={busy} onClick={() => handleDelete(entry.id)}>Apagar</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Nenhuma estrutura cadastrada ainda.</p>
          )}
          <div>
            <label htmlFor={`upload-creative-${groupKey}`}>Nova estrutura de criativo</label>
            <input id={`upload-creative-${groupKey}`} type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && handleUploadImage(event.target.files[0], "creative")} />
          </div>
        </section>
      ) : null}

      {splitImagePurposes && showProductReferences ? (
        <section className="field-card stack-sm">
          {showHeading ? (
            <div>
              <h3>Referencias de produto</h3>
              <p className="muted" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--text-sm)" }}>
                Fotos reais ou guias de produto. Elas ajudam o produto, nao definem layout.
              </p>
            </div>
          ) : null}
          {productReferences.map((entry) => (
            <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "48px minmax(0, 1fr) auto", gap: "var(--space-sm)", alignItems: "center", paddingBottom: "var(--space-xs)", borderBottom: "1px solid var(--line)" }}>
              {entry.imagePath ? <img src={previewSrc(entry)} alt={entry.text || "Referencia de produto"} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 10 }} /> : <span />}
              <span>{entry.text}</span>
              <Button variant="ghost" disabled={busy} onClick={() => handleDelete(entry.id)}>Apagar</Button>
            </div>
          ))}
          <div>
            <label htmlFor={`upload-product-${groupKey}`}>Nova referencia de produto</label>
            <input id={`upload-product-${groupKey}`} type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && handleUploadImage(event.target.files[0], "product")} />
          </div>
        </section>
      ) : null}

      {!onlyCreativeStructures ? (
        <>
          {buckets.map(({ key, label }) => {
            const currentEntries = bucketEntries.filter((entry) => entry.bucket === key);
            if (!currentEntries.length) return null;
            return (
              <section key={key} className="stack-sm">
                <h3>{label}</h3>
                {currentEntries.map((entry) => (
                  <div key={entry.id} style={{ display: "grid", gridTemplateColumns: entry.kind === "image" ? "48px minmax(0, 1fr) auto" : "minmax(0, 1fr) auto", gap: "var(--space-sm)", alignItems: "start", padding: "var(--space-xs) 0", borderBottom: "1px solid var(--line)" }}>
                    {entry.kind === "image" && entry.imagePath ? <img src={previewSrc(entry)} alt={entry.text || "Referencia de aprendizado"} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 10 }} /> : null}
                    <span>{entry.text}</span>
                    <Button variant="ghost" disabled={busy} onClick={() => handleDelete(entry.id)}>Apagar</Button>
                  </div>
                ))}
              </section>
            );
          })}

          <div className="actions-row">
            <input
              aria-label="Novo aprendizado em texto"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              placeholder="Ex: nao parecer gerado por IA, ser mais detalhista"
            />
            <Button disabled={busy} onClick={handleAddText}>Adicionar texto</Button>
          </div>
          {!splitImagePurposes ? (
            <div>
              <label htmlFor={`upload-${groupKey}`}>Adicionar imagem de referencia</label>
              <input id={`upload-${groupKey}`} type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && handleUploadImage(event.target.files[0])} />
            </div>
          ) : null}
        </>
      ) : null}

      {pendingImage ? (
        <div className="field-card stack-sm">
          <p className="muted" style={{ margin: 0 }}>A IA descreveu a imagem. Revise antes de salvar.</p>
          {pendingImage.purpose === "creative" ? (
            <div className="row">
              <div>
                <label htmlFor={`pending-title-${groupKey}`}>Nome da estrutura</label>
                <input id={`pending-title-${groupKey}`} value={pendingStructureTitle} onChange={(event) => setPendingStructureTitle(event.target.value)} placeholder="Ex: Oferta vertical com preco na base" />
              </div>
              <div>
                <label htmlFor={`pending-post-type-${groupKey}`}>Modelo do post</label>
                <select id={`pending-post-type-${groupKey}`} value={pendingPostType} onChange={(event) => setPendingPostType(event.target.value as PostType | "")}>
                  <option value="">Selecione</option>
                  {Object.entries(POST_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`pending-shape-${groupKey}`}>Formato</label>
                <select id={`pending-shape-${groupKey}`} value={pendingShape} onChange={(event) => setPendingShape(event.target.value as Shape | "")}>
                  <option value="">Selecione</option>
                  {Object.entries(SHAPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
          ) : null}
          <div>
            <label htmlFor={`pending-text-${groupKey}`}>{pendingImage.purpose === "creative" ? "Descrição da estrutura" : "Descrição da referencia"}</label>
            <textarea id={`pending-text-${groupKey}`} value={pendingImageText} onChange={(event) => setPendingImageText(event.target.value)} />
          </div>
          <div className="actions-row">
            <Button disabled={busy || !canConfirmCreative} onClick={handleConfirmImage}>Salvar referencia</Button>
            <Button variant="secondary" disabled={busy} onClick={clearPendingImage}>Descartar</Button>
          </div>
        </div>
      ) : null}
      {editingEntry ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setEditingStructureId(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.72)", display: "grid", placeItems: "center", zIndex: 1000, padding: "var(--space-lg)" }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="field-card stack-sm"
            style={{ width: "min(92vw, 480px)", maxHeight: "90vh", overflowY: "auto" }}
          >
            <h3 style={{ margin: 0 }}>Editar estrutura</h3>
            <div>
              <label htmlFor="edit-title">Nome da estrutura</label>
              <input id="edit-title" value={editingStructure.title} onChange={(event) => setEditingStructure((current) => ({ ...current, title: event.target.value }))} />
            </div>
            <div className="row">
              <div>
                <label htmlFor="edit-post-type">Modelo do post</label>
                <select id="edit-post-type" value={editingStructure.postType} onChange={(event) => setEditingStructure((current) => ({ ...current, postType: event.target.value as PostType | "" }))}>
                  <option value="">Selecione</option>
                  {Object.entries(POST_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="edit-shape">Formato</label>
                <select id="edit-shape" value={editingStructure.shape} onChange={(event) => setEditingStructure((current) => ({ ...current, shape: event.target.value as Shape | "" }))}>
                  <option value="">Selecione</option>
                  {Object.entries(SHAPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="edit-text">Descrição da estrutura</label>
              <textarea id="edit-text" value={editingStructure.text} onChange={(event) => setEditingStructure((current) => ({ ...current, text: event.target.value }))} />
            </div>
            <div className="actions-row">
              <Button disabled={busy || !canSaveEdit} onClick={() => handleSaveStructureEdit(editingEntry)}>Salvar edição</Button>
              <Button variant="secondary" disabled={busy} onClick={() => setEditingStructureId(null)}>Cancelar</Button>
            </div>
          </div>
        </div>
      ) : null}
      {error ? <div className="pill bad">{error}</div> : null}
    </div>
  );
}
