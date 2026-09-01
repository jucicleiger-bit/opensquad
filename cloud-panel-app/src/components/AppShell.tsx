import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
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

const ACCOUNT_TAB: [string, string] = ["/conta", "Conta e token"];

const GLOBAL_TABS: Array<[string, string]> = [
  ["/aprendizado/tipos-de-oferta", "Tipos de Oferta"],
  ["/aprendizado/templates", "Templates de Segmento"],
  ["/conta", "Conta e token"],
];

export function AppShell() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id, name, slug")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          setProjectsError(error.message);
          return;
        }
        setProjects(data || []);
      });
  }, []);

  const selected = projects?.find((p) => p.id === projectId);

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
            <div className="metric"><b>{projects?.length ?? 0}</b><span>projetos</span></div>
            <div className="metric"><b>{selected ? selected.name : "--"}</b><span>selecionado</span></div>
            <div className="metric"><b>Nuvem</b><span>sincronizado com o Supabase</span></div>
          </div>
        </div>
      </header>
      <main className="wrap design-shell">
        <aside className="card sidebar">
          <div className="section-title"><h2>Projetos</h2><span className="pill">{projects?.length ?? 0}</span></div>
          <div className="projects">
            {(projects || []).map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}/visao-geral`}
                className={`project${project.id === projectId ? " active" : ""}`}
                style={{ display: "block", textDecoration: "none", color: "inherit" }}
              >
                <strong>{project.name}</strong>
              </Link>
            ))}
            {projectsError ? <p className="muted">Erro: {projectsError}</p> : null}
            {!projectsError && projects === null ? <p className="muted">Carregando...</p> : null}
            {!projectsError && projects !== null && projects.length === 0 ? <p className="muted">Nenhum projeto ainda.</p> : null}
          </div>
        </aside>
        <nav className="card section-nav" aria-label="Seções do painel">
          {(projectId ? [...PROJECT_TABS, ACCOUNT_TAB] : GLOBAL_TABS).map(([target, label]) => {
            const to = projectId && !target.startsWith("/") ? `/projects/${projectId}/${target}` : target;
            const active = location.pathname === to;
            return (
              <button
                key={to}
                type="button"
                className={`tab-button${active ? " active" : ""}`}
                onClick={() => navigate(to)}
              >
                {label}
              </button>
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
