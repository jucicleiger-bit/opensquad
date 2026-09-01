import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

interface Project {
  id: string;
  name: string;
  slug: string;
}

export function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id, name, slug")
      .order("name")
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message);
        else setProjects(data);
      });
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "var(--space-xl) var(--space-2xl)" }}>
      <div className="page-head">
        <div>
          <h1>Seus projetos</h1>
          <p>Selecione um projeto para acompanhar e aprovar conteúdo.</p>
        </div>
        <div className="actions-row">
          <Link to="/aprendizado/tipos-de-oferta" className="muted" style={{ fontSize: 13 }}>
            Tipos de Oferta
          </Link>
          <Link to="/aprendizado/templates" className="muted" style={{ fontSize: 13 }}>
            Templates de Segmento
          </Link>
        </div>
      </div>

      {error ? <EmptyState title="Não foi possível carregar os projetos" description={error} /> : null}
      {!projects && !error ? <Skeleton height={100} /> : null}
      {projects && projects.length === 0 ? <EmptyState title="Nenhum projeto ainda" /> : null}

      <div style={{ display: "grid", gap: "var(--space-sm)" }}>
        {(projects || []).map((project) => (
          <Link key={project.id} to={`/projects/${project.id}/visao-geral`} style={{ textDecoration: "none", color: "inherit" }}>
            <Card style={{ padding: "var(--space-md)" }}>
              <strong>{project.name}</strong>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
