import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

interface Project {
  id: string;
  name: string;
  slug: string;
}

const PROJECT_TABS: Array<[string, string]> = [
  ["visao-geral", "Visão geral"],
  ["empresa", "Empresa / Raio-X"],
  ["referencias", "Referências e imagem"],
  ["ofertas", "Ofertas e assuntos"],
  ["aprovacao", "Conteúdos gerados"],
  ["calendario", "Calendário"],
  ["aprendizado", "Aprendizado"],
];

const GLOBAL_TABS: Array<[string, string]> = [
  ["/aprendizado/tipos-de-oferta", "Tipos de Oferta"],
  ["/aprendizado/templates", "Templates de Segmento"],
  ["/conta", "Conta e token"],
];

export function AppShell() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id, name, slug")
      .order("name")
      .then(({ data }) => setProjects(data || []));
  }, []);

  const selected = projects.find((p) => p.id === projectId);

  return (
    <>
      <header>
        <div className="hero">
          <div className="hero-brand">
            <div className="hero-mark" aria-hidden="true">C</div>
            <div>
              <p className="panel-kicker">Painel nuvem · Opensquad</p>
              <h1>Central de Conteúdo Opensquad</h1>
              <p className="sub">Acompanhe e aprove conteúdo de qualquer lugar — os mesmos dados do painel local.</p>
            </div>
          </div>
          <div className="hero-metrics">
            <div className="metric"><b>{projects.length}</b><span>projetos</span></div>
            <div className="metric"><b>{selected ? selected.name : "--"}</b><span>selecionado</span></div>
            <div className="metric"><b>Nuvem</b><span>sincronizado com o Supabase</span></div>
          </div>
        </div>
      </header>
      <main className="wrap design-shell">
        <aside className="card sidebar">
          <div className="section-title"><h2>Projetos</h2><span className="pill">{projects.length}</span></div>
          <div className="projects">
            {projects.map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}/visao-geral`}
                className={`project${project.id === projectId ? " active" : ""}`}
                style={{ display: "block", textDecoration: "none", color: "inherit" }}
              >
                <strong>{project.name}</strong>
              </Link>
            ))}
            {projects.length === 0 ? <p className="muted">Nenhum projeto ainda.</p> : null}
          </div>
        </aside>
        <nav className="card section-nav" aria-label="Seções do painel">
          {(projectId ? PROJECT_TABS : GLOBAL_TABS).map(([target, label]) => {
            const to = projectId ? `/projects/${projectId}/${target}` : target;
            const active = location.pathname === to;
            return (
              <Link key={to} to={to} className={`tab-button${active ? " active" : ""}`}>
                {label}
              </Link>
            );
          })}
        </nav>
        <section className="workspace-main">
          <Outlet />
        </section>
      </main>
    </>
  );
}
