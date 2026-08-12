import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import type { SegmentLearningNode } from "@/api/client";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { LearningGallery } from "@/components/LearningGallery";

export function SegmentLearning() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [nodes, setNodes] = useState<SegmentLearningNode[]>(project.segmentLearningNodes || []);

  if (!nodes.length) {
    return (
      <div>
        <h2>Aprendizado de segmento</h2>
        <EmptyState title="Cadastre o segmento em Empresa / Raio-X" description="O aprendizado de segmento aparece aqui depois que Setor e Nicho estiverem preenchidos." />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Aprendizado de segmento</h2>
      <p className="muted">
        Setor vale para todo o ramo; Nicho e Especialidade valem só para esse recorte. Cada nível herda o que está acima dele.
      </p>
      <div style={{ display: "grid", gap: 16 }}>
        {nodes.map((node) => (
          <Card key={node.path} style={{ padding: 16 }}>
            <b>{node.label}</b>
            <LearningGallery
              projectId={project.projectId}
              scope="segment"
              groupKey={node.path}
              entries={node.entries}
              onEntriesChange={(entries) => setNodes((current) => current.map((n) => (n.path === node.path ? { ...n, entries } : n)))}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
