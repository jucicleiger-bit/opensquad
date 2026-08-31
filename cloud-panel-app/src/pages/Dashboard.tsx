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
      <h1>Projetos</h1>
      {projects.length === 0 ? <p>Nenhum projeto ainda.</p> : null}
      {projects.map((project) => (
        <Link
          key={project.id}
          to={`/projects/${project.id}/aprovacao`}
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <strong>{project.name}</strong>
        </Link>
      ))}
    </div>
  );
}
