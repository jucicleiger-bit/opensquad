import { useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import type { Carousel } from "@/api/client";
import styles from "./CarouselPreview.module.css";

interface CarouselPreviewProps {
  carousel: Carousel;
  handle?: string;
  onClose: () => void;
}

// Simulates the real Instagram feed carousel: one page per slide, native
// horizontal scroll-snap (swipe/drag/arrow-key all just work for free —
// no drag library needed), dot indicator tracking scroll position.
export function CarouselPreview({ carousel, handle, onClose }: CarouselPreviewProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const lastIndex = carousel.slides.length - 1;

  function scrollToIndex(index: number) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: Math.max(0, Math.min(lastIndex, index)) * track.clientWidth, behavior: "smooth" });
  }

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setActiveIndex(Math.round(track.scrollLeft / track.clientWidth));
  }

  return (
    <Dialog onClose={onClose} titleId="carousel-preview-title" overlayClassName={styles.overlay} contentClassName={styles.content}>
      <h2 id="carousel-preview-title" className="sr-only">
        Pré-visualização do carrossel — {carousel.briefing}
      </h2>
      <div className={styles.frame}>
        <div className={styles.header}>
          <span className={styles.avatar} aria-hidden="true" />
          <span className={styles.handle}>{handle || "sua_marca"}</span>
        </div>
        <div className={styles.track} ref={trackRef} onScroll={handleScroll}>
          {carousel.slides.map((slide) => {
            const src = slide.image.url || slide.image.previewUrl;
            return (
              <div className={styles.page} key={slide.slideId}>
                {src ? (
                  <img src={src} alt={slide.slideText || `Slide ${slide.order}`} />
                ) : (
                  <div className={styles.placeholder}>
                    {slide.image.generating ? "Gerando imagem..." : "Sem imagem ainda"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {carousel.slides.length > 1 ? (
          <>
            <button
              type="button"
              className={`${styles.arrow} ${styles.arrowLeft}`}
              onClick={() => scrollToIndex(activeIndex - 1)}
              disabled={activeIndex === 0}
              aria-label="Slide anterior"
            >
              ‹
            </button>
            <button
              type="button"
              className={`${styles.arrow} ${styles.arrowRight}`}
              onClick={() => scrollToIndex(activeIndex + 1)}
              disabled={activeIndex === lastIndex}
              aria-label="Próximo slide"
            >
              ›
            </button>
            <div className={styles.dots}>
              {carousel.slides.map((slide, index) => (
                <span
                  key={slide.slideId}
                  className={`${styles.dot} ${index === activeIndex ? styles.dotActive : ""}`.trim()}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className={styles.toolbar}>
        <span className="muted">
          {activeIndex + 1} / {carousel.slides.length}
        </span>
        <Button type="button" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </Dialog>
  );
}
