import { toPng } from "html-to-image";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PROJECT_MODE_LABELS,
  PROJECT_TYPE_LABELS,
  createProject,
  createProspectFromScreenshot,
  deleteProject,
  duplicateProject,
  fileToDataUrl,
  getState,
  improveBio,
  listSegmentTemplates,
  prospectMockupUrl,
  segmentTemplateImageUrl,
  updateProjectSettings,
  type ProjectSummary,
  type SegmentTemplateSummary,
  type SystemAlert,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Dialog } from "@/components/Dialog";
import { EmptyState } from "@/components/EmptyState";
import { InstagramMockup } from "@/components/InstagramMockup";
import { SegmentGridTile, DEFAULT_BRAND_COLOR } from "@/components/SegmentGridTile";
import { Skeleton } from "@/components/Skeleton";
import { tokenExpiryMeta } from "./workspace/tokenDisplay";
import styles from "./Dashboard.module.css";

// "Nova prospecção" taken off the air at the operator's request — flip this
// back to true to bring the entry-point button (and everything behind it)
// straight back, no other changes needed.
const PROSPECTING_ENABLED = false;

const DEFAULT_HIGHLIGHT_LABELS = ["Produtos", "Pedidos", "Sobre"];

const EMPTY_FORM = { projectId: "", name: "", handle: "", approvalEmail: "", mode: "semi_automatic", projectType: "marketing" };
const EMPTY_DUPLICATE_FORM = { projectId: "", name: "" };
const EMPTY_EDIT_FORM = { name: "", handle: "", approvalEmail: "", mode: "semi_automatic" };

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
  const [duplicatingProject, setDuplicatingProject] = useState<ProjectSummary | null>(null);
  const [duplicateForm, setDuplicateForm] = useState(EMPTY_DUPLICATE_FORM);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectSummary | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // "Prospecção": upload a screenshot of a prospect's real Instagram profile
  // -> AI reads it -> instant, live-editable preview (InstagramMockup, no
  // network call per keystroke or per color change). This preview IS the
  // deliverable now — there's no slower "arte real" AI-generation pass
  // anymore, just an optional one-shot AI polish on the bio text.
  const [prospectStep, setProspectStep] = useState<"closed" | "uploading" | "analyzing" | "review">("closed");
  const [prospectError, setProspectError] = useState<string | null>(null);
  const [pendingProspect, setPendingProspect] = useState<{ project: ProjectSummary } | null>(null);
  const [reviewSegment, setReviewSegment] = useState("");
  const [reviewDescription, setReviewDescription] = useState("");
  const [reviewDifferentiators, setReviewDifferentiators] = useState("");
  const [reviewHighlights, setReviewHighlights] = useState<string[]>(DEFAULT_HIGHLIGHT_LABELS);
  const [segmentTemplates, setSegmentTemplates] = useState<SegmentTemplateSummary[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [bioImproving, setBioImproving] = useState(false);
  const [downloadingPng, setDownloadingPng] = useState(false);
  const previewCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const closeMenu = () => setOpenMenuId(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [openMenuId]);

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

  function openDuplicate(event: MouseEvent, project: ProjectSummary) {
    event.preventDefault();
    event.stopPropagation();
    setDuplicatingProject(project);
    setDuplicateForm(EMPTY_DUPLICATE_FORM);
    setDuplicateError(null);
  }

  function closeDuplicate() {
    setDuplicatingProject(null);
  }

  async function handleDuplicateSubmit(event: FormEvent) {
    event.preventDefault();
    if (!duplicatingProject) return;
    if (!duplicateForm.name.trim()) {
      setDuplicateError("Nome do projeto é obrigatório.");
      return;
    }
    setDuplicating(true);
    setDuplicateError(null);
    try {
      const res = await duplicateProject(duplicatingProject.projectId, duplicateForm);
      navigate(`/projects/${res.project.projectId}`);
    } catch (err) {
      setDuplicateError((err as Error).message);
    } finally {
      setDuplicating(false);
    }
  }

  function openEdit(event: MouseEvent, project: ProjectSummary) {
    event.preventDefault();
    event.stopPropagation();
    setEditingProject(project);
    setEditForm({
      name: project.name,
      handle: project.instagram?.handle || "",
      approvalEmail: project.approvalEmail || "",
      mode: project.mode || "semi_automatic",
    });
    setEditError(null);
  }

  function closeEdit() {
    setEditingProject(null);
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editingProject) return;
    if (!editForm.name.trim()) {
      setEditError("Nome do projeto é obrigatório.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await updateProjectSettings(editingProject.projectId, editForm);
      setProjects((current) => (current || []).map((p) => (p.projectId === res.project.projectId ? res.project : p)));
      setEditingProject(null);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  function toggleProspecting() {
    if (prospectStep === "closed") {
      // Fetched once on open, not on every dashboard load or keystroke —
      // this is the fixed art library (see SegmentGridTile), never
      // regenerated per prospect, so one fetch is enough for the whole
      // session.
      listSegmentTemplates()
        .then((res) => {
          const templates = res.templates || [];
          setSegmentTemplates(templates);
          setSelectedSegmentId((current) => current || templates[0]?.segmentId || "");
        })
        .catch(() => {});
      setProspectStep("uploading");
    } else {
      setProspectStep("closed");
    }
  }

  async function handleProspectUpload(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setProspectStep("analyzing");
    setProspectError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await createProspectFromScreenshot(dataUrl);
      setPendingProspect({ project: res.project });
      setReviewSegment(res.extracted?.nicheGuess || "");
      setReviewDescription(res.extracted?.bioText || "");
      setReviewDifferentiators((res.extracted?.differentiators || []).join("; "));
      setReviewHighlights(DEFAULT_HIGHLIGHT_LABELS);
      setSelectedSegmentId((current) => current || segmentTemplates[0]?.segmentId || "");
      setBrandColor(DEFAULT_BRAND_COLOR);
      setProjects((current) => [...(current || []), res.project]);
      setProspectStep("review");
    } catch (err) {
      setProspectError((err as Error).message);
      setProspectStep("uploading");
    }
  }

  async function handleImproveBio() {
    if (!pendingProspect) return;
    setBioImproving(true);
    setProspectError(null);
    try {
      const res = await improveBio(pendingProspect.project.projectId, {
        bio: reviewDescription,
        segment: reviewSegment,
        businessName: pendingProspect.project.name,
      });
      setReviewDescription(res.bio);
    } catch (err) {
      setProspectError((err as Error).message);
    } finally {
      setBioImproving(false);
    }
  }

  async function handleDownloadPng() {
    if (!previewCardRef.current || !pendingProspect) return;
    setDownloadingPng(true);
    setProspectError(null);
    try {
      const dataUrl = await toPng(previewCardRef.current, { pixelRatio: 3, cacheBust: true, backgroundColor: "#ffffff" });
      const safeName = pendingProspect.project.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "prospeccao";
      const link = document.createElement("a");
      link.download = `${safeName}-instagram-mockup.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      setProspectError((err as Error).message);
    } finally {
      setDownloadingPng(false);
    }
  }

  function updateHighlightLabel(index: number, value: string) {
    setReviewHighlights((current) => current.map((label, i) => (i === index ? value : label)));
  }

  const clientProjects = (projects || []).filter((p) => !p.isProspect);
  const prospectProjects = (projects || []).filter((p) => p.isProspect);

  return (
    <div className={styles.wrap}>
      <div className="page-head">
        <div>
          <h1>Seus projetos</h1>
          <p>Escolha um projeto para trabalhar dentro dele.</p>
        </div>
        <div className="actions-row">
          {PROSPECTING_ENABLED ? (
            <Button variant={prospectStep === "closed" ? "secondary" : "primary"} onClick={toggleProspecting}>
              {prospectStep === "closed" ? "+ Nova prospecção" : "Cancelar"}
            </Button>
          ) : null}
          <Link to="/aprendizado-segmento">
            <Button type="button" variant="secondary">
              Aprendizado de segmento
            </Button>
          </Link>
          <Link to="/aprendizado-tipo-oferta">
            <Button type="button" variant="secondary">
              Aprendizado por tipo de oferta
            </Button>
          </Link>
          <Link to="/comercial">
            <Button type="button" variant="secondary">
              Comercial
            </Button>
          </Link>
          <Button variant={showCreateForm ? "secondary" : "primary"} onClick={() => setShowCreateForm((v) => !v)}>
            {showCreateForm ? "Cancelar" : "+ Novo projeto"}
          </Button>
        </div>
      </div>

      {alerts.length > 0 ? (
        <div className="notice" style={{ marginBottom: "var(--space-lg)", borderColor: "rgba(245,158,11,.5)" }}>
          <b>
            {alerts.length} {alerts.length === 1 ? "alerta precisa" : "alertas precisam"} de atenção:
          </b>
          <div className="stack-sm" style={{ marginTop: "var(--space-sm)" }}>
            {alerts.map((alert, index) => (
              <div
                key={`${alert.projectId}-${alert.type}-${index}`}
                style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}
              >
                <span className="muted">
                  <b>{alert.projectName}:</b> {alert.message}
                </span>
                <Link
                  to={`/projects/${alert.projectId}/${
                    alert.type === "publish_failed" || alert.type === "media_upload_failed" ? "calendario" : "conta"
                  }`}
                >
                  <Button type="button" variant="secondary">
                    Resolver
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Gated by PROSPECTING_ENABLED above (currently off) — with the entry
         button hidden, prospectStep can never leave "closed" and this panel
         never renders. */}
      {prospectStep !== "closed" ? (
        <Card style={{ padding: "var(--space-lg)", marginBottom: "var(--space-lg)" }}>
          <b>Nova prospecção</b>
          <p className="muted" style={{ marginTop: "var(--space-2xs)" }}>
            Mande um print do perfil real do Instagram do prospect — a IA lê como uma pessoa rolando o perfil pelo
            celular e monta um mockup mostrando como o Instagram dele poderia ficar. Fica numa área separada dos seus
            clientes, fácil de apagar depois da abordagem.
          </p>

          {prospectStep === "uploading" || prospectStep === "analyzing" ? (
            <>
              <label htmlFor="prospect-screenshot">Print do perfil (Instagram)</label>
              <input
                id="prospect-screenshot"
                type="file"
                accept="image/*"
                disabled={prospectStep === "analyzing"}
                onChange={handleProspectUpload}
              />
              {prospectStep === "analyzing" ? (
                <p className="muted" style={{ marginTop: "var(--space-xs)" }}>Lendo o print...</p>
              ) : null}
            </>
          ) : null}

          {prospectStep === "review" && pendingProspect ? (
            <div className={styles.reviewSplit}>
              <div className={styles.reviewForm}>
                <p className="muted" style={{ marginTop: "var(--space-2xs)" }}>
                  O preview ao lado atualiza na hora — confira o que a IA leu no print e ajuste se algo saiu errado.
                </p>
                <label htmlFor="prospect-segment">Segmento/nicho</label>
                <input id="prospect-segment" value={reviewSegment} onChange={(e) => setReviewSegment(e.target.value)} />

                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-xs)" }}>
                  <label htmlFor="prospect-description" style={{ margin: 0 }}>
                    Bio / descrição
                  </label>
                  <button
                    type="button"
                    className={styles.improveBioButton}
                    disabled={bioImproving || !reviewDescription.trim()}
                    onClick={handleImproveBio}
                  >
                    {bioImproving ? "Melhorando..." : "✦ Melhorar com IA"}
                  </button>
                </div>
                <textarea
                  id="prospect-description"
                  value={reviewDescription}
                  onChange={(e) => setReviewDescription(e.target.value)}
                  disabled={bioImproving}
                />
                <label htmlFor="prospect-differentiators">Diferenciais</label>
                <input
                  id="prospect-differentiators"
                  value={reviewDifferentiators}
                  onChange={(e) => setReviewDifferentiators(e.target.value)}
                />
                <label htmlFor="prospect-highlight-0">Destaques (até 3)</label>
                <div className={styles.highlightInputs}>
                  {reviewHighlights.map((label, index) => (
                    <input
                      key={index}
                      id={`prospect-highlight-${index}`}
                      aria-label={`Destaque ${index + 1}`}
                      value={label}
                      onChange={(e) => updateHighlightLabel(index, e.target.value)}
                    />
                  ))}
                </div>

                {segmentTemplates.length > 0 ? (
                  <>
                    <label htmlFor="prospect-segment-select">Segmento (define os cards da grade)</label>
                    <select
                      id="prospect-segment-select"
                      value={selectedSegmentId}
                      onChange={(e) => setSelectedSegmentId(e.target.value)}
                    >
                      <option value="">Nenhum</option>
                      {segmentTemplates.map((template) => (
                        <option key={template.segmentId} value={template.segmentId}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}

                <label htmlFor="prospect-brand-color">Cor da marca</label>
                <div className={styles.colorRow}>
                  <input
                    id="prospect-brand-color"
                    type="color"
                    className={styles.colorSwatch}
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                  />
                  <input
                    aria-label="Cor da marca (hex)"
                    className={styles.colorHexInput}
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                  />
                </div>
                <p className="muted" style={{ marginTop: "var(--space-2xs)", fontSize: 13 }}>
                  A grade abaixo já é a arte real aprovada pra esse segmento — a cor só recolore tudo na hora, sem
                  gerar nada de novo.
                </p>

                <Button type="button" className="full-width" style={{ marginTop: "var(--space-sm)" }} disabled={downloadingPng} onClick={handleDownloadPng}>
                  {downloadingPng ? "Baixando..." : "Baixar PNG"}
                </Button>
              </div>

              <div className={styles.reviewPreview}>
                {(() => {
                  const template = segmentTemplates.find((t) => t.segmentId === selectedSegmentId) || null;
                  const gridPieces = (template?.pieces || []).filter((piece) => piece.channel !== "instagram_story");
                  const highlightPieces = (template?.pieces || []).filter((piece) => piece.channel === "instagram_story");
                  return (
                    <InstagramMockup
                      ref={previewCardRef}
                      businessName={pendingProspect.project.name}
                      handle={pendingProspect.project.prospectSource?.handle || ""}
                      avatarUrl={
                        pendingProspect.project.brandIdentity?.logoPath
                          ? `/api/projects/${pendingProspect.project.projectId}/assets/${pendingProspect.project.brandIdentity.logoPath}`
                          : undefined
                      }
                      bio={reviewDescription}
                      posts={pendingProspect.project.prospectSource?.realPosts ?? null}
                      followers={pendingProspect.project.prospectSource?.realFollowers ?? null}
                      following={pendingProspect.project.prospectSource?.realFollowing ?? null}
                      highlights={reviewHighlights.filter(Boolean).map((label, index) => {
                        // Matched by label first (so a custom-typed highlight
                        // name still finds the right piece), positional as a
                        // fallback so it never silently shows nothing.
                        const piece =
                          highlightPieces.find((p) => p.label.trim().toLowerCase() === label.trim().toLowerCase()) ||
                          highlightPieces[index];
                        return {
                          label,
                          content:
                            piece && template ? (
                              <SegmentGridTile
                                imageUrl={segmentTemplateImageUrl(template.segmentId, piece.imagePath)}
                                alt={piece.label}
                                accent={brandColor}
                              />
                            ) : undefined,
                        };
                      })}
                      gridItems={
                        template
                          ? gridPieces.map((piece) => (
                              <SegmentGridTile
                                key={piece.key}
                                imageUrl={segmentTemplateImageUrl(template.segmentId, piece.imagePath)}
                                alt={piece.label}
                                accent={brandColor}
                              />
                            ))
                          : []
                      }
                    />
                  );
                })()}
              </div>
            </div>
          ) : null}

          {prospectError ? <div className="pill bad" style={{ marginTop: "var(--space-sm)" }}>{prospectError}</div> : null}
        </Card>
      ) : null}

      {showCreateForm ? (
        <Card style={{ padding: "var(--space-lg)", marginBottom: "var(--space-lg)" }}>
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
            <p className="muted" style={{ margin: "var(--space-2xs) 0 var(--space-sm)", fontSize: 13 }}>
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
            <Button type="submit" className="full-width" style={{ marginTop: "var(--space-sm)" }} disabled={creating}>
              {creating ? "Criando..." : "Criar projeto"}
            </Button>
          </form>
          {createError ? <div className="pill bad" style={{ marginTop: "var(--space-sm)" }}>{createError}</div> : null}
        </Card>
      ) : null}

      {error ? (
        <EmptyState title="Não foi possível carregar os projetos" description={error} />
      ) : !projects ? (
        <div style={{ display: "grid", gap: "var(--space-sm)" }}>
          <Skeleton height={110} />
          <Skeleton height={110} />
        </div>
      ) : clientProjects.length === 0 ? (
        <EmptyState title="Nenhum projeto ainda" description="Clique em “+ Novo projeto” para criar o primeiro." />
      ) : (
        <div className={styles.grid}>
          {clientProjects.map((project) => (
            <Card
              key={project.projectId}
              className={styles.projectCard}
              style={{ padding: "var(--space-lg)", position: "relative", cursor: "pointer" }}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/projects/${project.projectId}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter") navigate(`/projects/${project.projectId}`);
              }}
            >
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.menuButton}
                  title="Mais ações"
                  aria-label="Mais ações"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenMenuId((current) => (current === project.projectId ? null : project.projectId));
                  }}
                >
                  ⋮
                </button>
                {openMenuId === project.projectId ? (
                  <div className={styles.actionMenu} onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.actionMenuItem}
                      onClick={(event) => {
                        openEdit(event, project);
                        setOpenMenuId(null);
                      }}
                    >
                      Editar
                    </button>
                    {project.projectType !== "catalog" ? (
                      <button
                        type="button"
                        className={styles.actionMenuItem}
                        onClick={(event) => {
                          openDuplicate(event, project);
                          setOpenMenuId(null);
                        }}
                      >
                        Duplicar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.actionMenuItem}
                      disabled={deletingId === project.projectId}
                      onClick={(event) => {
                        handleDelete(event, project);
                        setOpenMenuId(null);
                      }}
                    >
                      {deletingId === project.projectId ? "Apagando..." : "Apagar"}
                    </button>
                  </div>
                ) : null}
              </div>
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
          ))}
        </div>
      )}

      {prospectProjects.length > 0 ? (
        <>
          <h2 className={styles.sectionTitle} style={{ marginTop: "var(--space-2xl)" }}>
            Prospecção
          </h2>
          <p className="muted" style={{ marginBottom: "var(--space-lg)" }}>
            Mockups de demonstração pra abordar clientes em potencial — não conta como cliente real, apague quando a
            abordagem terminar.
          </p>
          <div className={styles.grid}>
            {prospectProjects.map((project) => (
              <Card key={project.projectId} style={{ padding: "var(--space-lg)", position: "relative" }}>
                <button
                  type="button"
                  className={styles.deleteButton}
                  disabled={deletingId === project.projectId}
                  onClick={(event) => handleDelete(event, project)}
                  title="Apagar prospecção"
                >
                  {deletingId === project.projectId ? "Apagando..." : "Apagar"}
                </button>
                <div className={styles.projectName}>{project.name}</div>
                <div className={styles.projectId}>{project.prospectSource?.handle || project.projectId}</div>
                <div className={styles.pills} style={{ marginBottom: "var(--space-md)" }}>
                  <span className="pill">Prospecção</span>
                </div>
                <a href={prospectMockupUrl(project.projectId)} target="_blank" rel="noreferrer">
                  <Button type="button" variant="secondary" className="full-width">
                    Ver mockup
                  </Button>
                </a>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {deleteError ? <div className="pill bad" style={{ marginTop: "var(--space-md)" }}>{deleteError}</div> : null}

      {duplicatingProject ? (
        <Dialog
          onClose={closeDuplicate}
          titleId="duplicate-project-title"
          overlayClassName={styles.duplicateDialogOverlay}
          contentClassName={styles.duplicateDialogContent}
        >
          <Card style={{ padding: "var(--space-lg)" }}>
            <h2 id="duplicate-project-title" style={{ marginTop: 0 }}>
              Duplicar "{duplicatingProject.name}"
            </h2>
            <p className="muted" style={{ marginTop: "var(--space-2xs)" }}>
              Cria um projeto novo com o mesmo Raio-X, ofertas e pilares — sem token, Instagram nem conteúdo já gerado.
            </p>
            <form onSubmit={handleDuplicateSubmit}>
              <label htmlFor="duplicate-project-id">ID curto</label>
              <input
                id="duplicate-project-id"
                placeholder="cliente-teste"
                value={duplicateForm.projectId}
                onChange={(e) => setDuplicateForm({ ...duplicateForm, projectId: e.target.value })}
              />
              <label htmlFor="duplicate-project-name">Nome</label>
              <input
                id="duplicate-project-name"
                placeholder="Cliente Teste"
                value={duplicateForm.name}
                onChange={(e) => setDuplicateForm({ ...duplicateForm, name: e.target.value })}
              />
              <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                <Button type="submit" disabled={duplicating}>
                  {duplicating ? "Duplicando..." : "Duplicar projeto"}
                </Button>
                <Button type="button" variant="secondary" onClick={closeDuplicate}>
                  Cancelar
                </Button>
              </div>
            </form>
            {duplicateError ? <div className="pill bad" style={{ marginTop: "var(--space-sm)" }}>{duplicateError}</div> : null}
          </Card>
        </Dialog>
      ) : null}

      {editingProject ? (
        <Dialog
          onClose={closeEdit}
          titleId="edit-project-title"
          overlayClassName={styles.duplicateDialogOverlay}
          contentClassName={styles.duplicateDialogContent}
        >
          <Card style={{ padding: "var(--space-lg)" }}>
            <h2 id="edit-project-title" style={{ marginTop: 0 }}>
              Editar "{editingProject.name}"
            </h2>
            <p className="muted" style={{ marginTop: "var(--space-2xs)" }}>
              ID do projeto ({editingProject.projectId}) não pode ser alterado.
            </p>
            <form onSubmit={handleEditSubmit}>
              <label htmlFor="edit-project-name">Nome</label>
              <input
                id="edit-project-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
              <label htmlFor="edit-project-handle">Instagram (@handle)</label>
              <input
                id="edit-project-handle"
                placeholder="@cliente"
                value={editForm.handle}
                onChange={(e) => setEditForm({ ...editForm, handle: e.target.value })}
              />
              <label htmlFor="edit-project-approval-email">E-mail de aprovação</label>
              <input
                id="edit-project-approval-email"
                type="email"
                value={editForm.approvalEmail}
                onChange={(e) => setEditForm({ ...editForm, approvalEmail: e.target.value })}
              />
              <label htmlFor="edit-project-mode">Modo</label>
              <select
                id="edit-project-mode"
                value={editForm.mode}
                onChange={(e) => setEditForm({ ...editForm, mode: e.target.value })}
              >
                {Object.entries(PROJECT_MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                <Button type="submit" disabled={editSaving}>
                  {editSaving ? "Salvando..." : "Salvar"}
                </Button>
                <Button type="button" variant="secondary" onClick={closeEdit}>
                  Cancelar
                </Button>
              </div>
            </form>
            {editError ? <div className="pill bad" style={{ marginTop: "var(--space-sm)" }}>{editError}</div> : null}
          </Card>
        </Dialog>
      ) : null}
    </div>
  );
}
