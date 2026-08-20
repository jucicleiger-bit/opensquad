import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialPropostaApresentar } from "./ComercialPropostaApresentar";

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

const PROPOSAL = {
  id: "prop-1",
  clientName: "Arthur Frios",
  clientLogoDataUrl: null,
  createdAt: "2026-08-20T12:00:00.000Z",
  sections: [{ category: "Criação de Conteúdo", mode: "single", items: [{ catalogItemId: "profissional", name: "Profissional", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 497, fullPrice: 0, discountedPrice: 0 }] }],
};

describe("ComercialPropostaApresentar", () => {
  it("shows the cover, about, category process/portfolio, and ends with the same pricing block as /imprimir", async () => {
    stubFetchSequence([
      { body: { proposal: PROPOSAL } },
      { body: { agency: { name: "King Assessoria de Mkt", logoPath: "", contactPhone: "(65) 99999-0000", contactInstagram: "@king", about: "A King ajuda negócios locais a vender mais.", updatedAt: null } } },
      { body: { processes: [{ category: "Criação de Conteúdo", text: "Cada peça é feita sob medida pro negócio do cliente." }] } },
      { body: { items: [{ id: "port-1", category: "Criação de Conteúdo", caption: "Post de exemplo", imagePath: "portfolio-port-1.png", createdAt: "2026-08-19T00:00:00.000Z" }] } },
    ]);

    render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1/apresentar"]}>
        <Routes>
          <Route path="/comercial/propostas/:id/apresentar" element={<ComercialPropostaApresentar />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Apresentação" })).toBeInTheDocument();
    expect(screen.getByText("Arthur Frios")).toBeInTheDocument();
    expect(screen.getByText("Sobre a King Assessoria de Mkt")).toBeInTheDocument();
    expect(screen.getByText("A King ajuda negócios locais a vender mais.")).toBeInTheDocument();
    expect(screen.getByText("Cada peça é feita sob medida pro negócio do cliente.")).toBeInTheDocument();
    expect(screen.getByAltText("Post de exemplo")).toHaveAttribute("src", "/api/commercial/assets/portfolio-port-1.png");
    expect(screen.getByText("Profissional")).toBeInTheDocument();
    expect(screen.getByText("Investimento mensal")).toBeInTheDocument();
  });

  it("hides the Sobre section when agency.about is empty, and skips categories with no process text and no portfolio images", async () => {
    stubFetchSequence([
      { body: { proposal: PROPOSAL } },
      { body: { agency: { name: "King", logoPath: "", contactPhone: "", contactInstagram: "", about: "", updatedAt: null } } },
      { body: { processes: [] } },
      { body: { items: [] } },
    ]);

    render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1/apresentar"]}>
        <Routes>
          <Route path="/comercial/propostas/:id/apresentar" element={<ComercialPropostaApresentar />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Apresentação" });
    expect(screen.queryByText(/^Sobre a/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Criação de Conteúdo" })).not.toBeInTheDocument();
  });
});
