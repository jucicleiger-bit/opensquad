import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  deleteCarousel,
  generateCarousel,
  listCarousels,
  regenerateCarouselSlide,
  type Carousel,
  type CarouselSlide,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
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

export function Carousels() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [carousels, setCarousels] = useState<Carousel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState("");
  const [slideCount, setSlideCount] = useState(6);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [slideState, setSlideState] = useState<Record<string, SlideActionState>>({});
  const [preview, setPreview] = useState<{ src: string; title: string; fileName: string } | null>(null);

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
    if (!carousels?.some((entry) => entry.status === "generating" || entry.slides.some((s) => s.image.generating))) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [carousels, refresh]);

  function stateFor(slideId: string): SlideActionState {
    return slideState[slideId] || IDLE_SLIDE_STATE;
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await generateCarousel(project.projectId, { briefing, slideCount });
      setBriefing("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
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

  async function handleRegenerateSlide(carouselId: string, slideId: string) {
    setSlideState((current) => ({ ...current, [slideId]: { busy: true, error: null } }));
    try {
      await regenerateCarouselSlide(project.projectId, carouselId, slideId);
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
        Carrossel avulso — separado da agenda orgânica: sem calendário, sem aprovação. Escreva o tema e escolha
        quantas folhas; a IA escreve o roteiro e gera 1 imagem por folha.
      </p>

      <Card style={{ padding: 20 }}>
        <label htmlFor="carousel-briefing">Tema do carrossel</label>
        <textarea
          id="carousel-briefing"
          placeholder="Ex: 5 dicas para escolher a pizza certa"
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
        />
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
          onClick={handleGenerate}
        >
          {generating ? "Gerando carrossel..." : "Gerar carrossel"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>

      {carousels.length === 0 ? (
        <div style={{ marginTop: 20 }}>
          <EmptyState title="Nenhum carrossel ainda" description="Gere o primeiro usando o formulário acima." />
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

              <div className={styles.slideGrid}>
                {carousel.slides.map((slide) => {
                  const src = slideSource(slide);
                  const state = stateFor(slide.slideId);
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
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={state.busy || slide.image.generating}
                          onClick={() => handleRegenerateSlide(carousel.carouselId, slide.slideId)}
                        >
                          {state.busy ? "Regenerando..." : "Regenerar esse slide"}
                        </Button>
                        {state.error ? <div className="pill bad">{state.error}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.actions}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={deletingId === carousel.carouselId}
                  onClick={() => handleDelete(carousel.carouselId)}
                >
                  {deletingId === carousel.carouselId ? "Apagando..." : "Apagar"}
                </Button>
              </div>
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
    </div>
  );
}
