import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialPropostaVer } from "./ComercialPropostaVer";

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

const SAVED_PROPOSAL = {
  id: "prop-1",
  clientName: "Arthur Frios",
  clientLogoDataUrl: null,
  createdAt: "2026-08-19T12:00:00.000Z",
  sections: [
    { category: "Criação de Conteúdo", mode: "single", items: [{ catalogItemId: "profissional", name: "Profissional", description: "Plano top", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 497, fullPrice: 0, discountedPrice: 0 }] },
  ],
};

describe("ComercialPropostaVer", () => {
  it("shows the saved proposal's sections/items and links to the print view", async () => {
    stubFetchSequence([{ body: { proposal: SAVED_PROPOSAL } }]);
    render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1"]}>
        <Routes>
          <Route path="/comercial/propostas/:id" element={<ComercialPropostaVer />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Arthur Frios" })).toBeInTheDocument();
    expect(screen.getByText("Profissional")).toBeInTheDocument();
    expect(screen.getByText("R$ 497/mês")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Imprimir / Baixar PDF" })).toHaveAttribute("href", "/comercial/propostas/prop-1/imprimir");
    expect(screen.getByRole("link", { name: "Apresentar" })).toHaveAttribute("href", "/comercial/propostas/prop-1/apresentar");
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute("href", "/comercial/propostas/prop-1/editar");
  });

  it("deletes the proposal through the real endpoint after confirmation and navigates back to the list", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([
      { body: { proposal: SAVED_PROPOSAL } },
      { body: { id: "prop-1", deleted: true } },
    ]);
    render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1"]}>
        <Routes>
          <Route path="/comercial/propostas/:id" element={<ComercialPropostaVer />} />
          <Route path="/comercial/propostas" element={<div>Lista de propostas</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Arthur Frios" });
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText("Lista de propostas")).toBeInTheDocument();
  });
});
