import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/Card";

interface Stats {
  total: number;
  draft: number;
  approved: number;
}

interface ChecklistItem {
  label: string;
  done: boolean;
}

export function Overview() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [stats, setStats] = useState<Stats | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [itemsResult, projectResult] = await Promise.all([
        supabase.from("content_items").select("status").eq("project_id", project.id),
        supabase.from("projects").select("company_profile, content_strategy, brand_profile").eq("id", project.id).single(),
      ]);
      if (itemsResult.error) {
        setError(itemsResult.error.message);
        return;
      }
      if (projectResult.error) {
        setError(projectResult.error.message);
        return;
      }
      const rows = itemsResult.data || [];
      setStats({
        total: rows.length,
        draft: rows.filter((r) => r.status === "draft").length,
        approved: rows.filter((r) => r.status === "approved").length,
      });
      const profile = (projectResult.data.company_profile || {}) as Record<string, unknown>;
      const strategy = (projectResult.data.content_strategy || {}) as { offers?: unknown[] };
      const brand = (projectResult.data.brand_profile || {}) as { references?: unknown[] };
      setChecklist([
        { label: "Perfil da empresa preenchido", done: Boolean(profile.segment || profile.description) },
        { label: "Pelo menos 1 oferta cadastrada", done: Array.isArray(strategy.offers) && strategy.offers.length > 0 },
        { label: "Pelo menos 1 referência enviada", done: Array.isArray(brand.references) && brand.references.length > 0 },
      ]);
    }
    load();
  }, [project.id]);

  if (error) return <Card style={{ padding: 20 }}>Erro: {error}</Card>;
  if (!stats || !checklist) return <Card style={{ padding: 20 }}>Carregando...</Card>;

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-2xs)" }}>{project.name}</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>{project.slug}</p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Card style={{ padding: "var(--space-md)" }}>
          <b style={{ display: "block", fontSize: "var(--text-2xl)" }}>{stats.total}</b>
          <span className="muted">conteúdos</span>
        </Card>
        <Card style={{ padding: "var(--space-md)" }}>
          <b style={{ display: "block", fontSize: "var(--text-2xl)" }}>{stats.draft}</b>
          <span className="muted">aguardando aprovação</span>
        </Card>
        <Card style={{ padding: "var(--space-md)" }}>
          <b style={{ display: "block", fontSize: "var(--text-2xl)" }}>{stats.approved}</b>
          <span className="muted">aprovados</span>
        </Card>
      </div>

      <h3 style={{ margin: "var(--space-lg) 0 var(--space-sm)" }}>Checklist do projeto</h3>
      <div style={{ display: "grid", gap: "var(--space-xs)" }}>
        {checklist.map((item) => (
          <div key={item.label} className="field-card" style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <span style={{ width: 20 }}>{item.done ? "✓" : "•"}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
