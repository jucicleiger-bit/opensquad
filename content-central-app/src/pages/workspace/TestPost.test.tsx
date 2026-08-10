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
  });
});
