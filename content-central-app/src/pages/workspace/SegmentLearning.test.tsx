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
      return Promise.resolve({ ok: response.ok !== false, text: async () => JSON.stringify(response.body) });
    }),
  );
}

function projectState(segmentLearningNodes: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", brand: {}, segmentLearningNodes }],
    globalRules: {},
  };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/aprendizado-segmento"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("SegmentLearning", () => {
  it("renders one panel per hierarchy level with its own entries", async () => {
    stubFetchSequence([{
      body: projectState([
        { path: "alimenticio", label: "Alimentício", level: "setor", entries: [{ id: "e1", bucket: "approved", kind: "text", text: "Não parecer gerado por IA", source: "manual", createdAt: "2026-08-01" }] },
        { path: "alimenticio/pizzaria", label: "Alimentício / Pizzaria", level: "nicho", entries: [] },
      ]),
    }]);
    renderPage();

    expect(await screen.findByText("Alimentício")).toBeInTheDocument();
    expect(screen.getByText("Alimentício / Pizzaria")).toBeInTheDocument();
    expect(screen.getByText("Não parecer gerado por IA")).toBeInTheDocument();
  });

  it("adds a manual text entry to the Nicho panel through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState([{ path: "alimenticio/pizzaria", label: "Alimentício / Pizzaria", level: "nicho", entries: [] }]) },
      { body: { entries: [{ id: "e2", bucket: "approved", kind: "text", text: "Esfiha tem que ser redonda", source: "manual", createdAt: "2026-08-01" }] } },
    ]);
    renderPage();

    await screen.findByText("Alimentício / Pizzaria");
    await userEvent.type(screen.getByLabelText("Novo aprendizado (texto)"), "Esfiha tem que ser redonda");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByText("Esfiha tem que ser redonda")).toBeInTheDocument();
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(call[0]).toBe("/api/projects/boss-pizzaria/segment-learnings/entries");
    expect(JSON.parse(call[1].body as string).groupKey).toBe("alimenticio/pizzaria");
  });
});
