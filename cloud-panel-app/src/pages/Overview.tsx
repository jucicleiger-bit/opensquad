import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

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
  const { projectId } = useParams<{ projectId: string }>();
  const [stats, setStats] = useState<Stats | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [itemsResult, projectResult] = await Promise.all([
        supabase.from("content_items").select("status").eq("project_id", projectId),
        supabase.from("projects").select("company_profile, content_strategy, brand_profile").eq("id", projectId).single(),
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
  }, [projectId]);

  if (error) return <div className="card">Erro: {error}</div>;
  if (!stats || !checklist) return <div className="card">Carregando...</div>;

  return (
    <section className="card tab-panel active">
      <div className="section-title"><h2>Visão geral</h2><span className="step">comece aqui</span></div>
      <div className="stat-grid">
        <div className="stat-card"><b>{stats.total}</b><span>conteúdos</span></div>
        <div className="stat-card"><b>{stats.draft}</b><span>aguardando aprovação</span></div>
        <div className="stat-card"><b>{stats.approved}</b><span>aprovados</span></div>
      </div>
      <h3 className="section-heading">Checklist do projeto</h3>
      <div className="checklist">
        {checklist.map((item) => (
          <div key={item.label} className={`checklist-item${item.done ? " done" : ""}`}>
            <span className="check-icon">{item.done ? "✓" : "•"}</span>
            <div className="check-label">
              <div className="check-title">{item.label}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
