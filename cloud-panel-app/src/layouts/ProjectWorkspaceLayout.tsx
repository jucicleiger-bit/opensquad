import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./ProjectWorkspaceLayout.module.css";

interface Project {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceContext {
  project: Project;
  refreshProject: () => Promise<void>;
}

// Mirrors content-central-app/src/layouts/ProjectWorkspaceLayout.tsx's
// SECTIONS — trimmed to what the cloud panel actually has. "Aprendizado"
// has no equivalent in the real local nav (kept grouped under Conteúdo as
// the most sensible placement for a cloud-only addition).
const SECTIONS = [
  { to: "visao-geral", label: "Visão geral", group: null as string | null },
  { to: "empresa", label: "Empresa / Raio-X", group: "Configuração" },
  { to: "referencias", label: "Imagem e identidade visual", group: "Configuração" },
  { to: "ofertas", label: "Ofertas e assuntos", group: "Configuração" },
  { to: "pilares", label: "Pilares", group: "Configuração" },
  { to: "aguardando", label: "Aguardando aprovação", group: "Conteúdo" },
  { to: "calendario", label: "Calendário", group: "Conteúdo" },
  { to: "aprendizado", label: "Aprendizado", group: "Conteúdo" },
];

export function ProjectWorkspaceLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function refreshProject() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("id, name, slug")
      .eq("id", projectId)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setProject(data);
    setError(null);
  }

  useEffect(() => {
    setProject(undefined);
    refreshProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (error) {
    return (
      <div style={{ padding: "var(--space-xl)" }}>
        <EmptyState title="Não foi possível carregar o projeto" description={error} />
      </div>
    );
  }

  if (project === undefined) {
    return (
      <div style={{ padding: "var(--space-xl)" }}>
        <Skeleton height={140} />
      </div>
    );
  }

  if (project === null) {
    return (
      <div style={{ padding: "var(--space-xl)" }}>
        <EmptyState title="Projeto não encontrado" description={`Não existe projeto com o id "${projectId}".`} />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <NavLink to="/" className={styles.back}>
          ← Todos os projetos
        </NavLink>
        <div className={styles.projectName}>{project.name}</div>
        <nav className={styles.nav}>
          {SECTIONS.map((section, index) => {
            const showGroupLabel = section.group && section.group !== SECTIONS[index - 1]?.group;
            return (
              <div key={section.to}>
                {showGroupLabel ? <div className={styles.navGroupLabel}>{section.group}</div> : null}
                <NavLink
                  to={section.to}
                  className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`.trim()}
                >
                  {section.label}
                </NavLink>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className={styles.content}>
        <Outlet context={{ project, refreshProject } satisfies WorkspaceContext} />
      </div>
    </div>
  );
}
