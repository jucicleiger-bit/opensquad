import { useEffect, useState } from "react";
import {
  analyzeLearningImage,
  deleteLearningEntry,
  fileToDataUrl,
  getCreativeStructureSources,
  importCreativeStructures,
  saveLearningEntry,
  type CreativeStructureSource,
  type SegmentLearningEntry,
  type SegmentLearningNode,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Dialog } from "@/components/Dialog";

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
  const [showImport, setShowImport] = useState(false);
  const [sources, setSources] = useState<CreativeStructureSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const defaultNode = preferredSegmentNode(nodes);
  const selectedNode = nodes.find((node) => node.path === selectedPath) || defaultNode;
  const availableSources = sources.filter((source) => source.path !== selectedNode?.path);
  const currentSource = availableSources.find((source) => source.path === sourcePath) || availableSources[0] || null;

  useEffect(() => {
    if (!nodes.length) return;
    setSelectedPath((current) => (nodes.some((node) => node.path === current) ? current : preferredSegmentNode(nodes)?.path || ""));
  }, [nodes]);

  useEffect(() => {
    if (!showImport || scope !== "segment") return;
    setSourcesLoading(true);
    setImportError(null);
    getCreativeStructureSources()
      .then((result) => {
        setSources(result.sources);
        const first = result.sources.find((source) => source.path !== selectedNode?.path);
        setSourcePath((current) => result.sources.some((source) => source.path === current && source.path !== selectedNode?.path) ? current : first?.path || "");
        setSelectedEntryIds(first?.entries.map((entry) => entry.id) || []);
      })
      .catch((err) => setImportError((err as Error).message))
      .finally(() => setSourcesLoading(false));
  }, [scope, selectedNode?.path, showImport]);

  if (!selectedNode) return null;

  function handleSourceChange(path: string) {
    const source = availableSources.find((item) => item.path === path);
    setSourcePath(path);
    setSelectedEntryIds(source?.entries.map((entry) => entry.id) || []);
    setImportSummary(null);
  }

  function toggleEntry(entryId: string) {
    setSelectedEntryIds((current) => current.includes(entryId)
      ? current.filter((id) => id !== entryId)
      : [...current, entryId]);
    setImportSummary(null);
  }

  async function handleImportStructures() {
    if (!currentSource || !selectedEntryIds.length) return;
    setImportBusy(true);
    setImportError(null);
    setImportSummary(null);
    try {
      const result = await importCreativeStructures({
        sourceGroupKey: currentSource.path,
        targetGroupKey: selectedNode.path,
        entryIds: selectedEntryIds,
      });
      onNodeEntriesChange(selectedNode.path, result.entries);
      setImportSummary(`${result.importedCount} importada(s), ${result.skippedCount} duplicada(s) ignorada(s).`);
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

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
      {scope === "segment" ? (
        <div className="actions-row">
          <Button variant="secondary" disabled={!selectedNode.path} onClick={() => setShowImport(true)}>Importar estruturas prontas</Button>
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
      {showImport ? (
        <Dialog
          onClose={() => setShowImport(false)}
          titleId="import-structures-title"
          overlayStyle={{ background: "rgba(0, 0, 0, 0.72)", padding: "var(--space-lg)" }}
          contentClassName="stack-md"
          contentStyle={{
            width: "min(94vw, 720px)",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-card)",
            padding: "var(--space-md)",
          }}
        >
          <div>
            <h3 id="import-structures-title" style={{ margin: 0 }}>Importar estruturas prontas</h3>
            <p className="muted" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--text-sm)" }}>
              Copie modelos de layout de outro nicho para {selectedNode.label}.
            </p>
          </div>

          {sourcesLoading ? (
            <p className="muted" style={{ margin: 0 }}>Carregando estruturas...</p>
          ) : availableSources.length ? (
            <>
              <div>
                <label htmlFor="creative-structure-source">Nicho de origem</label>
                <select id="creative-structure-source" value={currentSource?.path || ""} onChange={(event) => handleSourceChange(event.target.value)}>
                  {availableSources.map((source) => (
                    <option key={source.path} value={source.path}>{source.label} ({source.count})</option>
                  ))}
                </select>
              </div>

              {currentSource ? (
                <div className="stack-sm">
                  {currentSource.entries.map((entry) => (
                    <label
                      key={entry.id}
                      htmlFor={`import-structure-${entry.id}`}
                      className="field-card"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 72px minmax(0, 1fr)",
                        gap: "var(--space-sm)",
                        alignItems: "center",
                        margin: 0,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        id={`import-structure-${entry.id}`}
                        type="checkbox"
                        checked={selectedEntryIds.includes(entry.id)}
                        onChange={() => toggleEntry(entry.id)}
                        style={{ width: "auto" }}
                      />
                      {entry.imagePath ? (
                        <img src={previewSrc(entry)} alt={structureTitle(entry)} loading="lazy" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: "var(--radius-sm)" }} />
                      ) : (
                        <span />
                      )}
                      <span className="stack-sm" style={{ minWidth: 0 }}>
                        <strong>{structureTitle(entry)}</strong>
                        <span className="actions-row">
                          {entry.postType ? <span className="pill">{POST_TYPE_LABELS[entry.postType]}</span> : null}
                          <span className="pill">{entry.shape ? SHAPE_LABELS[entry.shape] : "Vertical + Feed"}</span>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Nenhum outro nicho com estruturas cadastradas.</p>
          )}

          {importError ? <div className="pill bad">{importError}</div> : null}
          {importSummary ? <div className="pill ok">{importSummary}</div> : null}

          <div className="actions-row" style={{ justifyContent: "flex-end" }}>
            <Button variant="secondary" disabled={importBusy} onClick={() => setShowImport(false)}>Fechar</Button>
            <Button disabled={importBusy || !currentSource || selectedEntryIds.length === 0} onClick={handleImportStructures}>
              {importBusy ? "Importando..." : "Importar selecionadas"}
            </Button>
          </div>
        </Dialog>
      ) : null}
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
  const [showAuto, setShowAuto] = useState(false);

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
                    <img src={previewSrc(entry)} alt={structureTitle(entry)} loading="lazy" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 10 }} />
                  ) : (
                    <div style={{ width: "100%", height: 160, borderRadius: 10, background: "var(--surface-2)" }} />
                  )}
                  <strong>{structureTitle(entry)}</strong>
                  <div className="actions-row">
                    {entry.postType ? <span className="pill">{POST_TYPE_LABELS[entry.postType]}</span> : null}
                    <span className="pill">{entry.shape ? SHAPE_LABELS[entry.shape] : "Vertical + Feed"}</span>
                  </div>
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
              {entry.imagePath ? <img src={previewSrc(entry)} alt={entry.text || "Referencia de produto"} loading="lazy" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 10 }} /> : <span />}
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
          {bucketEntries.some((entry) => entry.source === "auto") ? (
            <Button variant="ghost" onClick={() => setShowAuto((current) => !current)}>
              {showAuto
                ? "Ocultar aprendizados automaticos"
                : `Mostrar aprendizados automaticos (${bucketEntries.filter((entry) => entry.source === "auto").length})`}
            </Button>
          ) : null}
          {buckets.map(({ key, label }) => {
            const currentEntries = bucketEntries.filter((entry) => entry.bucket === key && (showAuto || entry.source !== "auto"));
            if (!currentEntries.length) return null;
            return (
              <section key={key} className="stack-sm">
                <h3>{label}</h3>
                {currentEntries.map((entry) => (
                  <div key={entry.id} style={{ display: "grid", gridTemplateColumns: entry.kind === "image" ? "48px minmax(0, 1fr) auto" : "minmax(0, 1fr) auto", gap: "var(--space-sm)", alignItems: "start", padding: "var(--space-xs) 0", borderBottom: "1px solid var(--line)" }}>
                    {entry.kind === "image" && entry.imagePath ? <img src={previewSrc(entry)} alt={entry.text || "Referencia de aprendizado"} loading="lazy" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 10 }} /> : null}
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
        <Dialog
          onClose={() => setEditingStructureId(null)}
          titleId="edit-structure-title"
          overlayStyle={{ background: "rgba(0, 0, 0, 0.72)", padding: "var(--space-lg)" }}
          contentClassName="stack-sm"
          contentStyle={{
            width: "min(92vw, 480px)",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-card)",
            padding: "var(--space-md)",
          }}
        >
          <h3 id="edit-structure-title" style={{ margin: 0 }}>Editar estrutura</h3>
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
        </Dialog>
      ) : null}
      {error ? <div className="pill bad">{error}</div> : null}
    </div>
  );
}
