import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PROJECT_MODE_LABELS,
  PROJECT_TYPE_LABELS,
  createProject,
  deleteProject,
  getState,
  type ProjectSummary,
  type SystemAlert,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { tokenExpiryMeta } from "./workspace/tokenDisplay";
import styles from "./Dashboard.module.css";

const EMPTY_FORM = { projectId: "", name: "", handle: "", approvalEmail: "", mode: "semi_automatic", projectType: "marketing" };

export function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getState()
      .then((state) => {
        if (!cancelled) {
          setProjects(state.projects);
          setAlerts(state.alerts || []);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setCreateError("Nome do projeto é obrigatório.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createProject(form);
      navigate(`/projects/${res.project.projectId}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(event: MouseEvent, project: ProjectSummary) {
    event.preventDefault();
    event.stopPropagation();
    if (
      !confirm(
        `Apagar o projeto "${project.name}" (${project.projectId}) para sempre?\n\nIsso remove Raio-X, ofertas, referências, conteúdos gerados e o token salvo. Não tem como desfazer.`,
      )
    ) {
      return;
    }
    setDeletingId(project.projectId);
    setDeleteError(null);
    try {
      await deleteProject(project.projectId);
      setProjects((current) => (current || []).filter((p) => p.projectId !== project.projectId));
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className={styles.title}>Seus projetos</h1>
          <p className={styles.subtitle}>Escolha um projeto para trabalhar dentro dele.</p>
        </div>
        <Button variant={showCreateForm ? "secondary" : "primary"} onClick={() => setShowCreateForm((v) => !v)}>
          {showCreateForm ? "Cancelar" : "+ Novo projeto"}
        </Button>
      </div>

      {alerts.length > 0 ? (
        <div className="notice" style={{ marginTop: 16, marginBottom: 4, borderColor: "rgba(245,158,11,.5)" }}>
          <b>
            {alerts.length} {alerts.length === 1 ? "alerta precisa" : "alertas precisam"} de atenção:
          </b>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {alerts.map((alert, index) => (
              <div
                key={`${alert.projectId}-${alert.type}-${index}`}
                style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}
              >
                <span className="muted">
                  <b>{alert.projectName}:</b> {alert.message}
                </span>
                <Link to={`/projects/${alert.projectId}/${alert.type === "publish_failed" ? "calendario" : "conta"}`}>
                  <Button type="button" variant="secondary">
                    Resolver
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showCreateForm ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Criar novo projeto</b>
          <form onSubmit={handleCreate}>
            <div className="row">
              <div>
                <label htmlFor="new-project-id">ID curto</label>
                <input
                  id="new-project-id"
                  placeholder="cliente-teste"
                  value={form.projectId}
                  onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="new-project-name">Nome</label>
                <input
                  id="new-project-name"
                  placeholder="Cliente Teste"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
            </div>
            <label htmlFor="new-project-type">Tipo de projeto</label>
            <select
              id="new-project-type"
              value={form.projectType}
              onChange={(e) => setForm({ ...form, projectType: e.target.value })}
            >
              {Object.entries(PROJECT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="muted" style={{ margin: "4px 0 12px", fontSize: 13 }}>
              {form.projectType === "catalog"
                ? "Sem Raio-X nem pilares: cadastre produtos com foto e preço e o sistema posta o estoque ativo no Story todo dia."
                : "Fluxo completo de marketing de conteúdo: Raio-X da marca, pilares e artes geradas por IA."}
            </p>
            <div className="row">
              <div>
                <label htmlFor="new-project-handle">Instagram</label>
                <input
                  id="new-project-handle"
                  placeholder="@cliente"
                  value={form.handle}
                  onChange={(e) => setForm({ ...form, handle: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="new-project-email">E-mail de aprovação</label>
                <input
                  id="new-project-email"
                  value={form.approvalEmail}
                  onChange={(e) => setForm({ ...form, approvalEmail: e.target.value })}
                />
              </div>
            </div>
            <label htmlFor="new-project-mode">Modo</label>
            <select id="new-project-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              {Object.entries(PROJECT_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button type="submit" className="full-width" style={{ marginTop: 12 }} disabled={creating}>
              {creating ? "Criando..." : "Criar projeto"}
            </Button>
          </form>
          {createError ? <div className="pill bad" style={{ marginTop: 12 }}>{createError}</div> : null}
        </Card>
      ) : null}

      {error ? (
        <EmptyState title="Não foi possível carregar os projetos" description={error} />
      ) : !projects ? (
        <div style={{ display: "grid", gap: 12 }}>
          <Skeleton height={110} />
          <Skeleton height={110} />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState title="Nenhum projeto ainda" description="Clique em “+ Novo projeto” para criar o primeiro." />
      ) : (
        <div className={styles.grid}>
          {projects.map((project) => (
            <Link key={project.projectId} to={`/projects/${project.projectId}`} className={styles.projectCard}>
              <Card style={{ padding: 20, position: "relative" }}>
                <button
                  type="button"
                  className={styles.deleteButton}
                  disabled={deletingId === project.projectId}
                  onClick={(event) => handleDelete(event, project)}
                  title="Apagar projeto"
                >
                  {deletingId === project.projectId ? "Apagando..." : "Apagar"}
                </button>
                <div className={styles.projectName}>{project.name}</div>
                <div className={styles.projectId}>{project.projectId}</div>
                <div className={styles.pills}>
                  <span className={`pill ${tokenExpiryMeta(project.token).tone}`}>{tokenExpiryMeta(project.token).label}</span>
                  {project.projectType === "catalog" ? (
                    <span className="pill">Catálogo de produtos</span>
                  ) : project.brandXray?.status === "approved" ? (
                    <span className="pill ok">Raio-X ok</span>
                  ) : (
                    <span className="pill">Raio-X pendente</span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {deleteError ? <div className="pill bad" style={{ marginTop: 16 }}>{deleteError}</div> : null}
    </div>
  );
}
