import { describe, expect, it } from "vitest";
import type { ContentItem } from "@/api/client";
import { contentPipelineSteps } from "./contentDisplay";

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    contentId: "content-1",
    scheduledDate: "2026-07-24",
    channel: "instagram_feed",
    status: "aguardando_aprovacao",
    caption: { text: "Legenda final" },
    image: { prompt: "Briefing visual", previewDataUrl: "data:image/svg+xml;base64,AAAA", generatedSource: "ai" },
    creativeReview: { status: "ok", summary: "Criativo aprovado." },
    ...overrides,
  };
}

describe("contentPipelineSteps", () => {
  it("maps a completed content item to the visible Sofia → Dante → Clara → Imagem → Renata pipeline", () => {
    const steps = contentPipelineSteps(item());

    expect(steps.map((step) => `${step.agent}:${step.label}`)).toEqual([
      "Sofia:Copy",
      "Dante:Direct response",
      "Clara:Direção criativa",
      "Imagem:Arte final",
      "Renata:Revisão",
    ]);
    expect(steps.every((step) => step.tone === "done")).toBe(true);
  });

  it("shows generation/review failures without inventing a completed pipeline", () => {
    const steps = contentPipelineSteps(
      item({
        caption: { text: "" },
        image: { generating: false },
        captionGenerationError: "sem legenda",
        imageGenerationError: "sem imagem",
        creativeReview: { status: "blocked", summary: "Texto cortado", errors: ["texto cortado"] },
      }),
    );

    expect(steps.find((step) => step.id === "copy")?.tone).toBe("blocked");
    expect(steps.find((step) => step.id === "direct_response")?.tone).toBe("blocked");
    expect(steps.find((step) => step.id === "creative_direction")?.tone).toBe("blocked");
    expect(steps.find((step) => step.id === "image")?.tone).toBe("blocked");
    expect(steps.find((step) => step.id === "review")?.detail).toBe("Texto cortado");
  });

  it("does not blame Clara when the visual prompt exists but the image renderer fails", () => {
    const steps = contentPipelineSteps(
      item({
        image: { prompt: "Briefing visual pronto" },
        imageGenerationError: "provedor de imagem fora do ar",
      }),
    );

    expect(steps.find((step) => step.id === "creative_direction")).toMatchObject({
      detail: "Prompt visual pronto",
      tone: "done",
    });
    expect(steps.find((step) => step.id === "image")).toMatchObject({
      detail: "Imagem falhou",
      tone: "blocked",
    });
  });
});
