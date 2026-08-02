import { Fragment, useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { getState, type ProjectSummary } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./ProjectWorkspaceLayout.module.css";

// Catalog (venda direta) projects skip Raio-X/pilares entirely — they have
// no brand strategy to build, just real product photos posted on rotation —
// so those two sections are hidden, and "Ofertas e assuntos" reads as
// "Produtos" since that's what offers actually represent in this mode.
//
// Grouped by workflow phase instead of one flat list — "Visão geral" stands
// alone as the workspace home; the rest cluster into setup (done once, then
// revisited rarely), day-to-day content operations, and account settings.
// See design.md § What pages MUST share.
const SECTIONS = [
  { to: "visao-geral", label: "Visão geral", group: null as string | null },
  { to: "empresa", label: "Empresa / Raio-X", hideForCatalog: true, group: "Configuração" },
  { to: "referencias", label: "Referências e imagem", group: "Configuração" },
  { to: "ofertas", label: "Ofertas e assuntos", catalogLabel: "Produtos", group: "Configuração" },
  { to: "pilares", label: "Pilares", hideForCatalog: true, group: "Configuração" },
  { to: "gerar", label: "Agenda e geração", group: "Conteúdo" },
  { to: "teste", label: "Teste seguro", group: "Conteúdo" },
  { to: "aguardando", label: "Aguardando aprovação", group: "Conteúdo" },
  { to: "calendario", label: "Calendário", group: "Conteúdo" },
  { to: "conta", label: "Conta e token", group: "Conta" },
];

export interface WorkspaceContext {
  project: ProjectSummary;
  refreshProject: () => Promise<void>;
}

export function ProjectWorkspaceLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refreshProject = useCallback(async () => {
    try {
      const state = await getState();
      setProject(state.projects.find((p) => p.projectId === projectId) ?? null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    setProject(undefined);
    refreshProject();
  }, [refreshProject]);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <EmptyState title="Não foi possível carregar o projeto" description={error} />
      </div>
    );
  }

  if (project === undefined) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton height={140} />
      </div>
    );
  }

  if (project === null) {
    return (
      <div style={{ padding: 24 }}>
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
          {SECTIONS.filter((section) => !(section.hideForCatalog && project.projectType === "catalog")).map((section, index, visible) => {
            const showGroupLabel = section.group && section.group !== visible[index - 1]?.group;
            return (
              <Fragment key={section.to}>
                {showGroupLabel && <div className={styles.navGroupLabel}>{section.group}</div>}
                <NavLink
                  to={section.to}
                  className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`.trim()}
                >
                  {project.projectType === "catalog" && section.catalogLabel ? section.catalogLabel : section.label}
                </NavLink>
              </Fragment>
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
