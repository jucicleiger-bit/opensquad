import { useEffect, useState } from "react";
import { SEGMENT_TREE, getSegmentLearningNodes, getState, type ProjectSummary, type SegmentLearningNode } from "@/api/client";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { CreativeStructureGallery, LearningGallery, ProductReferenceGallery } from "@/components/LearningGallery";

function nonEmpty(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}

export function AprendizadoSegmento() {
  const [group, setGroup] = useState("");
  const [category, setCategory] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [nodes, setNodes] = useState<SegmentLearningNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    getState().then((result) => setProjects(result.projects)).catch(() => {});
  }, []);

  // Setor/Nicho stay a closed <select>, but the option list is the fixed
  // catalog PLUS whatever a real project has actually registered on the
  // Empresa/Raio-X page (Company.tsx's segmentGroup/segmentCategory) — a
  // Nicho typed as new there (e.g. "Casa de Frios") needs to show up here
  // to register creative structures/product references for it.
  const groupOptions = [...new Set([
    ...SEGMENT_TREE.map((item) => item.group),
    ...projects.map((project) => project.brandInput?.segmentGroup).filter(nonEmpty),
  ])];
  const staticCategoryOptions = SEGMENT_TREE.find((item) => item.group === group)?.categories || [];
  const registeredCategoryOptions = projects
    .filter((project) => project.brandInput?.segmentGroup === group)
    .map((project) => project.brandInput?.segmentCategory)
    .filter(nonEmpty);
  const categoryOptions = [...new Set([...staticCategoryOptions, ...registeredCategoryOptions])];

  async function handleLoad() {
    setLoading(true);
    setError(null);
    try {
      const result = await getSegmentLearningNodes(group, category, specialty);
      setNodes(result.nodes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 var(--space-2xs)" }}>Aprendizado de segmento</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Vale pra todo cliente do mesmo segmento, não só um projeto. Setor vale pra todo o ramo; Nicho e Especialidade valem só pra esse recorte.
      </p>
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div className="row">
          <div>
            <label htmlFor="segmento-setor">Setor</label>
            <select id="segmento-setor" value={group} onChange={(e) => { setGroup(e.target.value); setCategory(""); }}>
              <option value="">Selecione</option>
              {groupOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="segmento-nicho">Nicho</label>
            <select id="segmento-nicho" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!group}>
              <option value="">Selecione</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="segmento-especialidade">Especialidade (opcional)</label>
            <input id="segmento-especialidade" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ex: napolitana" />
          </div>
        </div>
        <Button style={{ marginTop: 12 }} disabled={!group || loading} onClick={handleLoad}>
          {loading ? "Carregando..." : "Ver aprendizado"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
      </Card>

      {nodes === null ? null : nodes.length === 0 ? (
        <EmptyState title="Nenhum nível disponível" description="Escolha pelo menos o Setor." />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <Card style={{ padding: 16 }}>
            <h2>Estruturas de criativo</h2>
            <p className="muted" style={{ margin: "var(--space-2xs) 0 var(--space-md)" }}>
              Cadastre aqui os modelos de layout que a IA pode seguir. Cada estrutura precisa ter nome e tipo de post.
            </p>
            <CreativeStructureGallery
              scope="segment"
              nodes={nodes}
              onNodeEntriesChange={(path, entries) => setNodes((current) => (current || []).map((node) => (node.path === path ? { ...node, entries } : node)))}
            />
          </Card>
          <Card style={{ padding: 16 }}>
            <h2>Referencias de produto</h2>
            <p className="muted" style={{ margin: "var(--space-2xs) 0 var(--space-md)" }}>
              Fotos reais ou guias de produto (textura, montagem, combos). Ajudam a IA a entender como o produto realmente se parece — nao definem layout.
            </p>
            <ProductReferenceGallery
              scope="segment"
              nodes={nodes}
              onNodeEntriesChange={(path, entries) => setNodes((current) => (current || []).map((node) => (node.path === path ? { ...node, entries } : node)))}
            />
          </Card>
          {nodes.map((node) => (
            <Card key={node.path} style={{ padding: 16 }}>
              <b>{node.label}</b>
              <LearningGallery
                scope="segment"
                groupKey={node.path}
                entries={node.entries}
                splitImagePurposes
                showCreativeStructures={false}
                showProductReferences={false}
                onEntriesChange={(entries) => setNodes((current) => (current || []).map((n) => (n.path === node.path ? { ...n, entries } : n)))}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
