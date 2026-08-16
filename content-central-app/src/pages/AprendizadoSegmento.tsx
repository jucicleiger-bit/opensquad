import { useState } from "react";
import { SEGMENT_TREE, getSegmentLearningNodes, type SegmentLearningNode } from "@/api/client";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { LearningGallery } from "@/components/LearningGallery";

export function AprendizadoSegmento() {
  const [group, setGroup] = useState("");
  const [category, setCategory] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [nodes, setNodes] = useState<SegmentLearningNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = SEGMENT_TREE.find((item) => item.group === group)?.categories || [];

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
              {SEGMENT_TREE.map((item) => (
                <option key={item.group} value={item.group}>{item.group}</option>
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
          {nodes.map((node) => (
            <Card key={node.path} style={{ padding: 16 }}>
              <b>{node.label}</b>
              <LearningGallery
                scope="segment"
                groupKey={node.path}
                entries={node.entries}
                splitImagePurposes
                onEntriesChange={(entries) => setNodes((current) => (current || []).map((n) => (n.path === node.path ? { ...n, entries } : n)))}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
