import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

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

  if (error) return <div className="card">Erro ao carregar projetos: {error}</div>;
  if (!projects) return <div className="card">Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Projetos</h1>
        <Link to="/conta">Conta / MFA</Link>
      </div>
      {projects.length === 0 ? <p>Nenhum projeto ainda.</p> : null}
      {projects.map((project) => (
        <div key={project.id} className="card">
          <strong>{project.name}</strong>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Link to={`/projects/${project.id}/aprovacao`}>Aprovação</Link>
            <Link to={`/projects/${project.id}/calendario`}>Calendário</Link>
            <Link to={`/projects/${project.id}/empresa`}>Empresa</Link>
            <Link to={`/projects/${project.id}/ofertas`}>Ofertas e Pilares</Link>
            <Link to={`/projects/${project.id}/referencias`}>Referências</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
