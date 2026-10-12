import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  deleteCarousel,
  draftCarouselCaption,
  generateCarousel,
  generateCarouselImages,
  getCarouselTopicIdeas,
  listCarousels,
  regenerateCarouselSlide,
  replanCarousel,
  scheduleCarousel,
  type Carousel,
  type CarouselSlide,
  type CarouselTopicIdea,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { CarouselPreview } from "@/components/CarouselPreview";
import { EmptyState } from "@/components/EmptyState";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Skeleton } from "@/components/Skeleton";
import styles from "./Carousels.module.css";

const ROLE_LABELS: Record<CarouselSlide["role"], string> = {
  cover: "Capa",
  content: "Conteúdo",
  cta: "CTA",
};

function slideSource(slide: CarouselSlide): string | null {
  return slide.image.url || slide.image.previewUrl || null;
}

interface SlideActionState {
  busy: boolean;
  error: string | null;
}

const IDLE_SLIDE_STATE: SlideActionState = { busy: false, error: null };

function tomorrowIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function paddedPostTime(value: unknown): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "09:00";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function formatScheduleLabel(date: string, time: string): string {
  return `Agendado para ${date.slice(8, 10)}/${date.slice(5, 7)} ${time}`;
}

function carouselIsFinished(carousel: Carousel): boolean {
  return carousel.status === "ready"
    && carousel.slides.length > 0
    && carousel.slides.every((slide) => Boolean(slide.image.url) && !slide.image.generating && !slide.imageGenerationError);
}

interface ScheduleFormState {
  carouselId: string;
  date: string;
  time: string;
  caption: string;
  loadingCaption: boolean;
  saving: boolean;
  error: string | null;
}

export function Carousels() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [carousels, setCarousels] = useState<Carousel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState("");
  const [slideCount, setSlideCount] = useState(6);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [slideState, setSlideState] = useState<Record<string, SlideActionState>>({});
  const [slideNotes, setSlideNotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ src: string; title: string; fileName: string } | null>(null);
  const [feedPreviewId, setFeedPreviewId] = useState<string | null>(null);
  const [offerId, setOfferId] = useState("");
  const [ideas, setIdeas] = useState<CarouselTopicIdea[] | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [replanText, setReplanText] = useState<Record<string, string>>({});
  const [planBusyId, setPlanBusyId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState | null>(null);
  const offers = (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false);

  const refresh = useCallback(async () => {
    try {
      const data = await listCarousels(project.projectId);
      setCarousels(data.carousels);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [project.projectId]);

  useEffect(() => {
    setCarousels(null);
    refresh();
  }, [refresh]);

  // Roteiro + images finish in the background — poll while any carousel is
  // still generating, same pattern as AdCreatives.
  useEffect(() => {
    if (!carousels?.some((entry) => entry.status === "planning" || entry.status === "generating" || entry.slides.some((s) => s.image.generating))) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [carousels, refresh]);

  function stateFor(slideId: string): SlideActionState {
    return slideState[slideId] || IDLE_SLIDE_STATE;
  }

  async function handlePlan() {
    setGenerating(true);
    setError(null);
    try {
      await generateCarousel(project.projectId, { briefing, slideCount, ...(offerId ? { offerId } : {}) });
      setBriefing("");
      setOfferId("");
      setIdeas(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function handlePickOffer(id: string) {
    setOfferId(id);
    const offer = offers.find((entry) => entry.id === id);
    if (offer) setBriefing([offer.name, offer.items].filter(Boolean).join(" — "));
  }

  async function handleTrendingIdeas() {
    setIdeasLoading(true);
    setIdeasError(null);
    try {
      const data = await getCarouselTopicIdeas(project.projectId);
      setIdeas(data.ideas);
    } catch (err) {
      setIdeasError((err as Error).message);
    } finally {
      setIdeasLoading(false);
    }
  }

  function handlePickIdea(idea: CarouselTopicIdea) {
    setOfferId("");
    setBriefing([idea.title, idea.angle].filter(Boolean).join(" — "));
  }

  // Empty message = "Tentar de novo" on a carousel that has no plan yet.
  async function handleReplan(carouselId: string, message: string) {
    setPlanBusyId(carouselId);
    setError(null);
    try {
      await replanCarousel(project.projectId, carouselId, message);
      setReplanText((current) => ({ ...current, [carouselId]: "" }));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlanBusyId(null);
    }
  }

  async function handleGenerateImages(carouselId: string) {
    setPlanBusyId(carouselId);
    setError(null);
    try {
      await generateCarouselImages(project.projectId, carouselId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlanBusyId(null);
    }
  }

  async function openSchedule(carouselId: string) {
    const form: ScheduleFormState = {
      carouselId,
      date: tomorrowIso(),
      time: paddedPostTime(project.contentSettings?.defaultPostTime),
      caption: "",
      loadingCaption: true,
      saving: false,
      error: null,
    };
    setScheduleForm(form);
    try {
      const { caption } = await draftCarouselCaption(project.projectId, carouselId);
      setScheduleForm((current) => (current?.carouselId === carouselId ? { ...current, caption, loadingCaption: false } : current));
    } catch (err) {
      setScheduleForm((current) => (current?.carouselId === carouselId
        ? { ...current, loadingCaption: false, error: `Não consegui escrever a legenda: ${(err as Error).message}` }
        : current));
    }
  }

  async function confirmSchedule() {
    if (!scheduleForm) return;
    setScheduleForm({ ...scheduleForm, saving: true, error: null });
    try {
      await scheduleCarousel(project.projectId, scheduleForm.carouselId, {
        date: scheduleForm.date,
        time: scheduleForm.time,
        caption: scheduleForm.caption.trim(),
      });
      setScheduleForm(null);
      await refresh();
    } catch (err) {
      setScheduleForm((current) => (current ? { ...current, saving: false, error: (err as Error).message } : current));
    }
  }

  async function handleDelete(carouselId: string) {
    if (!confirm("Apagar este carrossel?")) return;
    setDeletingId(carouselId);
    try {
      await deleteCarousel(project.projectId, carouselId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  // No note = "Regenerar esse slide" (fresh take). A note = "Aplicar
  // correção" — a targeted edit of the slide's current image, same
  // distinction AdCreatives already makes.
  async function handleRegenerateSlide(carouselId: string, slideId: string, note?: string) {
    setSlideState((current) => ({ ...current, [slideId]: { busy: true, error: null } }));
    try {
      await regenerateCarouselSlide(project.projectId, carouselId, slideId, note);
      setSlideNotes((current) => ({ ...current, [slideId]: "" }));
      await refresh();
      setSlideState((current) => ({ ...current, [slideId]: IDLE_SLIDE_STATE }));
    } catch (err) {
      setSlideState((current) => ({ ...current, [slideId]: { busy: false, error: (err as Error).message } }));
    }
  }

  if (!carousels) {
    return <Skeleton height={200} />;
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-xs)" }}>Carrossel</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        Carrossel avulso: diga o que você quer, ajuste o plano slide por slide e só então gere as imagens. Pronto, dá
        pra agendar — ele entra no calendário já aprovado.
      </p>

      <Card style={{ padding: 20 }}>
        <label htmlFor="carousel-offer">Puxar de Ofertas e assuntos</label>
        <select id="carousel-offer" value={offerId} onChange={(e) => handlePickOffer(e.target.value)}>
          <option value="">— Nenhum (escrever à mão) —</option>
          {offers.map((offer) => (
            <option key={offer.id} value={offer.id}>{offer.name}</option>
          ))}
        </select>

        <label htmlFor="carousel-briefing" style={{ marginTop: 12 }}>O que você quer neste carrossel?</label>
        <textarea
          id="carousel-briefing"
          placeholder="Ex: carrossel da pizza calabresa, foco no delivery de sexta"
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
        />
        <Button type="button" variant="secondary" style={{ marginTop: 8 }} disabled={ideasLoading} onClick={handleTrendingIdeas}>
          {ideasLoading ? "Pesquisando..." : "Assuntos em alta do segmento"}
        </Button>
        {ideasError ? <div className="pill bad" style={{ marginTop: 8 }}>{ideasError}</div> : null}
        {ideas?.length ? (
          <ul className={styles.ideas}>
            {ideas.map((idea) => (
              <li key={idea.title}>
                <button
                  type="button"
                  className={styles.ideaButton}
                  aria-pressed={briefing === [idea.title, idea.angle].filter(Boolean).join(" — ")}
                  onClick={() => handlePickIdea(idea)}
                >
                  <span className={styles.ideaTitle}>{idea.title}</span>
                  {idea.angle ? <span className={styles.ideaAngle}>{idea.angle}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label htmlFor="carousel-slide-count" style={{ marginTop: 12 }}>
          Quantidade de folhas
        </label>
        <input
          id="carousel-slide-count"
          type="number"
          min={2}
          max={10}
          value={slideCount}
          onChange={(e) => setSlideCount(Number(e.target.value))}
        />

        <Button
          type="button"
          className="full-width"
          style={{ marginTop: 10 }}
          disabled={generating || !briefing.trim()}
          onClick={handlePlan}
        >
          {generating ? "Planejando..." : "Planejar"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>

      {carousels.length === 0 ? (
        <div style={{ marginTop: 20 }}>
          <EmptyState title="Nenhum carrossel ainda" description="Planeje o primeiro usando o formulário acima." />
        </div>
      ) : (
        <div className={styles.list}>
          {carousels.map((carousel) => (
            <Card key={carousel.carouselId} className={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>{carousel.briefing}</h3>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {carousel.format ? <span className="pill">{carousel.format}</span> : null}
                  <span className="pill">{carousel.slideCount} folhas</span>
                </div>
              </div>
              {carousel.outlineGenerationError ? (
                <div className="pill bad" style={{ marginTop: 8 }}>⚠ {carousel.outlineGenerationError}</div>
              ) : null}

              {(() => {
                const inPlanning = carousel.status === "planning" || carousel.status === "plan_ready";
                if (!inPlanning) return null;
                const hasPlan = carousel.slides.length > 0 && carousel.slides.every((slide) => slide.slideText);
                const text = replanText[carousel.carouselId] || "";
                const busy = planBusyId === carousel.carouselId;
                return (
                  <div className={styles.plan}>
                    {carousel.planMessages?.length ? (
                      <ul className={styles.planMessages}>
                        {carousel.planMessages.map((message) => (
                          <li key={message.at}>{message.text}</li>
                        ))}
                      </ul>
                    ) : null}
                    {carousel.status === "planning" ? <p className="muted">Planejando…</p> : null}
                    {hasPlan ? (
                      <ol className={styles.planList}>
                        {carousel.slides.map((slide) => (
                          <li key={slide.slideId}>
                            <span className={styles.slideRole}>{ROLE_LABELS[slide.role]}</span> {slide.slideText}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {carousel.planError ? <div className="pill bad">⚠ {carousel.planError}</div> : null}
                    {carousel.status === "plan_ready" && hasPlan ? (
                      <>
                        <label htmlFor={`replan-${carousel.carouselId}`}>O que mudar?</label>
                        <textarea
                          id={`replan-${carousel.carouselId}`}
                          placeholder="Ex: troca o slide 3 pra falar do tempo de entrega"
                          value={text}
                          onChange={(e) => setReplanText((current) => ({ ...current, [carousel.carouselId]: e.target.value }))}
                        />
                        <div className={styles.actions}>
                          <Button type="button" variant="secondary" disabled={busy || !text.trim()} onClick={() => handleReplan(carousel.carouselId, text.trim())}>
                            Ajustar
                          </Button>
                          <Button type="button" disabled={busy} onClick={() => handleGenerateImages(carousel.carouselId)}>
                            Gerar imagens
                          </Button>
                        </div>
                      </>
                    ) : null}
                    {carousel.status === "plan_ready" && !hasPlan ? (
                      <Button type="button" variant="secondary" disabled={busy} onClick={() => handleReplan(carousel.carouselId, "")}>
                        Tentar de novo
                      </Button>
                    ) : null}
                    <div className={styles.actions}>
                      <Button type="button" variant="ghost" disabled={deletingId === carousel.carouselId || carousel.status === "planning"} onClick={() => handleDelete(carousel.carouselId)}>
                        {deletingId === carousel.carouselId ? "Apagando..." : "Apagar"}
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {carousel.status === "planning" || carousel.status === "plan_ready" ? null : (
                <>
                <div className={styles.slideGrid}>
                  {carousel.slides.map((slide) => {
                    const src = slideSource(slide);
                    const state = stateFor(slide.slideId);
                    const note = slideNotes[slide.slideId] || "";
                    return (
                      <div key={slide.slideId} className={styles.slide}>
                        <div className={styles.slidePhoto}>
                          {src ? (
                            <img
                              src={src}
                              alt={slide.slideText || `Slide ${slide.order}`}
                              loading="lazy"
                              onClick={() => setPreview({ src, title: slide.slideText || `Slide ${slide.order}`, fileName: `${slide.slideId}.png` })}
                            />
                          ) : slide.image.generating ? (
                            <span>Gerando imagem...</span>
                          ) : (
                            <span>Sem imagem ainda</span>
                          )}
                        </div>
                        <div className={styles.slideFooter}>
                          <span className={styles.slideRole}>{ROLE_LABELS[slide.role]}</span>
                          {slide.imageGenerationError ? (
                            <div className="pill bad">⚠ {slide.imageGenerationError}</div>
                          ) : null}
                          <label htmlFor={`slide-edit-${slide.slideId}`} className="muted" style={{ fontSize: 12 }}>
                            Pedido de correção (opcional)
                          </label>
                          <textarea
                            id={`slide-edit-${slide.slideId}`}
                            placeholder="Ex: texto menor, tirar esse ícone, cor mais escura..."
                            value={note}
                            onChange={(e) => setSlideNotes((current) => ({ ...current, [slide.slideId]: e.target.value }))}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={state.busy || slide.image.generating || carousel.status === "generating"}
                            onClick={() => handleRegenerateSlide(carousel.carouselId, slide.slideId)}
                          >
                            {state.busy ? "Regenerando..." : "Regenerar esse slide"}
                          </Button>
                          {note.trim() ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={state.busy || slide.image.generating || carousel.status === "generating"}
                              onClick={() => handleRegenerateSlide(carousel.carouselId, slide.slideId, note.trim())}
                            >
                              {state.busy ? "Aplicando..." : "Aplicar correção"}
                            </Button>
                          ) : null}
                          {state.error ? <div className="pill bad">{state.error}</div> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className={styles.actions}>
                  <Button type="button" disabled={!carouselIsFinished(carousel)} onClick={() => openSchedule(carousel.carouselId)}>
                    Agendar
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!carousel.slides.some((slide) => slide.image.url || slide.image.previewUrl)}
                    onClick={() => setFeedPreviewId(carousel.carouselId)}
                  >
                    Visualizar como no feed
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={deletingId === carousel.carouselId}
                    onClick={() => handleDelete(carousel.carouselId)}
                  >
                    {deletingId === carousel.carouselId ? "Apagando..." : "Apagar"}
                  </Button>
                </div>

                {carousel.schedules?.length ? (
                  <div className={styles.actions}>
                    {carousel.schedules.map((schedule) => (
                      <span key={schedule.contentId} className="pill">{formatScheduleLabel(schedule.date, schedule.time)}</span>
                    ))}
                  </div>
                ) : null}
                {scheduleForm?.carouselId === carousel.carouselId ? (
                  <div className={styles.scheduleForm}>
                    <label htmlFor="schedule-date">Data</label>
                    <input id="schedule-date" type="date" value={scheduleForm.date} onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })} />
                    <label htmlFor="schedule-time">Horário</label>
                    <input id="schedule-time" type="time" value={scheduleForm.time} onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })} />
                    <label htmlFor="schedule-caption">Legenda</label>
                    <textarea
                      id="schedule-caption"
                      rows={6}
                      placeholder={scheduleForm.loadingCaption ? "Escrevendo a legenda..." : "Escreva a legenda do post"}
                      value={scheduleForm.caption}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, caption: e.target.value })}
                    />
                    {scheduleForm.error ? <div className="pill bad">{scheduleForm.error}</div> : null}
                    <p className="muted" style={{ fontSize: 12 }}>
                      Entra no calendário já aprovado. Sai no horário se o PC estiver ligado.
                    </p>
                    <div className={styles.actions}>
                      <Button
                        type="button"
                        disabled={scheduleForm.saving || scheduleForm.loadingCaption || !scheduleForm.caption.trim() || !scheduleForm.date || !scheduleForm.time}
                        onClick={confirmSchedule}
                      >
                        {scheduleForm.saving ? "Agendando..." : "Confirmar agendamento"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setScheduleForm(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : null}
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      {preview ? (
        <ImageLightbox
          src={preview.src}
          alt={preview.title}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {(() => {
        const previewCarousel = carousels.find((entry) => entry.carouselId === feedPreviewId);
        // Guards a carousel getting deleted (by this tab or another) while
        // its feed preview is open — refresh() would otherwise leave
        // feedPreviewId pointing at nothing.
        return previewCarousel ? (
          <CarouselPreview
            carousel={previewCarousel}
            handle={project.instagram?.handle}
            onClose={() => setFeedPreviewId(null)}
          />
        ) : null;
      })()}
    </div>
  );
}
