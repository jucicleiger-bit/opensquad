import { useState } from "react";
import { SEGMENT_TREE, getSegmentLearningNodes, type SegmentLearningNode } from "@/api/client";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { CreativeStructureGallery, LearningGallery, ProductReferenceGallery } from "@/components/LearningGallery";

const SEGMENT_GROUP_OPTIONS = SEGMENT_TREE.map((item) => item.group);
const ALL_SEGMENT_CATEGORY_OPTIONS = [...new Set(SEGMENT_TREE.flatMap((item) => item.categories))];

export function AprendizadoSegmento() {
  const [group, setGroup] = useState("");
  const [category, setCategory] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [nodes, setNodes] = useState<SegmentLearningNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Setor/Nicho are free text (datalist just suggests) — a Nicho typed as
  // new on the Empresa page (Company.tsx's identical combobox pattern)
  // isn't in SEGMENT_TREE, so a strict <select> here could never show it.
  const categoryOptions = SEGMENT_TREE.find((item) => item.group === group)?.categories || ALL_SEGMENT_CATEGORY_OPTIONS;

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
            <input
              id="segmento-setor"
              list="segmento-setor-options"
              placeholder="ex: Engenharia, Alimentício, Negócios locais e lojas"
              value={group}
              onChange={(e) => { setGroup(e.target.value); setCategory(""); }}
            />
            <datalist id="segmento-setor-options">
              {SEGMENT_GROUP_OPTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="segmento-nicho">Nicho</label>
            <input
              id="segmento-nicho"
              list="segmento-nicho-options"
              placeholder="Escolha uma opção ou digite uma nova"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={!group}
            />
            <datalist id="segmento-nicho-options">
              {categoryOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
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
