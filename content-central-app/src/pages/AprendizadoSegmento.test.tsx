import { render, screen, waitFor } from "@testing-library/react";
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

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/aprendizado-segmento"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("AprendizadoSegmento", () => {
  it("shows one creative-structure panel and one product-reference panel, each with a Setor/Nicho scope selector", async () => {
    stubFetchSequence([
      {
        body: {
          nodes: [
            {
              path: "group:alimenticio/category:pizzaria",
              label: "Alimenticio / Pizzaria",
              level: "nicho",
              entries: [
                { id: "e1", bucket: "approved", kind: "text", text: "Esfiha tem que ser redonda", source: "manual", createdAt: "2026-08-01" },
                { id: "e2", bucket: "approved", kind: "image", imagePath: "segment/group-alimenticio/esfiha.png", text: "Esfiha redonda", source: "manual", createdAt: "2026-08-01" },
              ],
            },
            { path: "group:alimenticio", label: "Alimenticio", level: "setor", entries: [] },
          ],
        },
      },
    ]);
    renderPage();

    await userEvent.selectOptions(await screen.findByLabelText("Setor"), "Alimentício");
    await userEvent.selectOptions(screen.getByLabelText("Nicho"), "Pizzaria");
    await userEvent.click(screen.getByRole("button", { name: "Ver aprendizado" }));

    expect(await screen.findByText("Esfiha tem que ser redonda")).toBeInTheDocument();
    expect(screen.getByAltText("Esfiha redonda")).toHaveAttribute("src", "/api/learning-assets/segment/group-alimenticio/esfiha.png");
    expect(screen.getAllByLabelText("Nova estrutura de criativo")).toHaveLength(1);
    expect(screen.getAllByLabelText("Nova referencia de produto")).toHaveLength(1);
    expect(screen.getByLabelText("Salvar e editar estruturas em")).toBeInTheDocument();
    expect(screen.getByLabelText("Salvar e editar referencias de produto em")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Salvar e editar estruturas em")).toHaveValue("group:alimenticio/category:pizzaria"));
    expect(screen.getByLabelText("Salvar e editar referencias de produto em")).toHaveValue("group:alimenticio/category:pizzaria");
    expect(screen.queryByText("Criativo")).toBeNull();
    expect(screen.getAllByText("Estruturas de criativo")).toHaveLength(1);
    expect(screen.getAllByText("Referencias de produto")).toHaveLength(1);
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(decodeURIComponent(call[0])).toContain("segmentGroup=Alimentício");
  });

  it("sends purpose=creative when analyzing an uploaded creative-structure reference", async () => {
    stubFetchSequence([
      {
        body: {
          nodes: [
            { path: "group:negocios-locais-e-lojas", label: "Negocios locais e lojas", level: "setor", entries: [] },
          ],
        },
      },
      { body: { imagePath: "segment/group-embalagens/modelo.png", suggestedText: "Layout vertical com preco e CTA." } },
    ]);
    renderPage();

    await userEvent.selectOptions(await screen.findByLabelText("Setor"), "Negócios locais e lojas");
    await userEvent.click(screen.getByRole("button", { name: "Ver aprendizado" }));

    const file = new File(["fake-image"], "modelo.png", { type: "image/png" });
    await userEvent.upload(await screen.findByLabelText("Nova estrutura de criativo"), file);
    expect(await screen.findByDisplayValue("Layout vertical com preco e CTA.")).toBeInTheDocument();

    const analyzeCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(analyzeCall[0]).toBe("/api/segment-learnings/analyze-image");
    expect(JSON.parse(String(analyzeCall[1].body))).toMatchObject({
      scope: "segment",
      groupKey: "group:negocios-locais-e-lojas",
      filename: "modelo.png",
      purpose: "creative",
    });
  });
});
