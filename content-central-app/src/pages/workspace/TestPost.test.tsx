import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchSequence(responses: Array<{ body: unknown; ok?: boolean }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve({
        ok: response.ok !== false,
        text: async () => JSON.stringify(response.body),
      });
    }),
  );
}

const PROJECT_STATE = {
  projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria" }],
  globalRules: {},
};

function renderTestPost() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/teste"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("TestPost", () => {
  it("shows the empty state before any test has been run", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }]);
    renderTestPost();

    expect(await screen.findByText("Nenhum teste gerado ainda.")).toBeInTheDocument();
  });

  it("generates a dry-run test post through the real endpoint and renders the review", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          message: "Simulação criada.",
          content: {
            contentId: "boss-pizzaria-test-1",
            scheduledDate: "2026-07-23",
            channel: "instagram_story",
            formatLabel: "Teste Story",
            status: "test_post_simulated",
            image: { previewDataUrl: "data:image/svg+xml;base64,AAAA", generatedSource: "ai", dimensions: { width: 1080, height: 1920 } },
            caption: { text: "Legenda de teste gerada pela IA" },
            publish: { dryRun: true, realPublished: false },
            creativeReview: { status: "ok", summary: "Enquadramento correto, preço legível.", errors: [], warnings: [] },
            creativeStructureUsed: { title: "Oferta vertical com preço", postType: "offer", shape: "vertical" },
            usedSegmentProductReference: true,
          },
        },
      },
    ]);
    renderTestPost();

    await screen.findByRole("heading", { name: "Teste rápido antes de programar" });
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdo + simular postagem" }));

    expect(await screen.findByText("Legenda de teste gerada pela IA")).toBeInTheDocument();
    expect(screen.getAllByText("Enquadramento correto, preço legível.").length).toBeGreaterThan(0);
    expect(screen.getByText("Pipeline deste criativo")).toBeInTheDocument();
    expect(screen.getByText("Renata")).toBeInTheDocument();
    expect(screen.getByText("dry-run: sim")).toBeInTheDocument();
    expect(screen.getByText("publicado: não")).toBeInTheDocument();
    expect(screen.getByText("Estrutura: Oferta vertical com preço")).toBeInTheDocument();
    expect(screen.getByText("Referência de produto: usada")).toBeInTheDocument();
  });

  it("reloads the last generated test from the server instead of showing empty after a remount", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            {
              contentId: "boss-pizzaria-test-old",
              scheduledDate: "2026-07-20",
              updatedAt: "2026-07-20T10:00:00.000Z",
              channel: "instagram_story",
              status: "test_post_simulated",
              caption: { text: "Teste antigo" },
              image: {},
              publish: { dryRun: true },
            },
            {
              contentId: "boss-pizzaria-test-latest",
              scheduledDate: "2026-07-23",
              updatedAt: "2026-07-23T10:00:00.000Z",
              channel: "instagram_story",
              status: "test_post_simulated",
              caption: { text: "Teste mais recente sobrevive ao reload" },
              image: { previewDataUrl: "data:image/svg+xml;base64,AAAA", generatedSource: "ai" },
              publish: { dryRun: true },
            },
          ],
        },
      },
    ]);
    renderTestPost();

    expect(await screen.findByText("Teste mais recente sobrevive ao reload")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum teste gerado ainda.")).not.toBeInTheDocument();
  });

  it("keeps a previous test visible after generating a new one, instead of the new one replacing it", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            {
              contentId: "boss-pizzaria-test-anterior",
              scheduledDate: "2026-07-20",
              updatedAt: "2026-07-20T10:00:00.000Z",
              channel: "instagram_story",
              status: "test_post_simulated",
              caption: { text: "Teste anterior que não pode sumir" },
              image: {},
              publish: { dryRun: true },
            },
          ],
        },
      },
      {
        body: {
          message: "Simulação criada.",
          content: {
            contentId: "boss-pizzaria-test-novo",
            scheduledDate: "2026-07-23",
            channel: "instagram_story",
            status: "test_post_simulated",
            caption: { text: "Teste novo recém gerado" },
            image: { previewDataUrl: "data:image/svg+xml;base64,AAAA", generatedSource: "ai" },
            publish: { dryRun: true },
          },
        },
      },
    ]);
    renderTestPost();

    await screen.findByText("Teste anterior que não pode sumir");
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdo + simular postagem" }));

    expect(await screen.findByText("Teste novo recém gerado")).toBeInTheDocument();
    expect(screen.getByText("Teste anterior que não pode sumir")).toBeInTheDocument();
  });
});
