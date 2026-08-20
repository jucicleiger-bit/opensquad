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

const AGENCY = { name: "King Assessoria de Mkt", logoPath: "", contactPhone: "(65) 99999-0000", contactInstagram: "@king", about: "", updatedAt: null };

function proposalWithCategories(categories: string[]) {
  return {
    id: "prop-1",
    clientName: "Arthur Frios",
    clientLogoDataUrl: null,
    createdAt: "2026-08-20T12:00:00.000Z",
    sections: categories.map((category, i) => ({
      category,
      mode: "single" as const,
      items: [{ catalogItemId: `item-${i}`, name: `Item ${i}`, description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal" as const, price: 100, fullPrice: 0, discountedPrice: 0 }],
    })),
  };
}

function renderPage(proposal: unknown, agency = AGENCY, processes: unknown[] = [], items: unknown[] = []) {
  stubFetchSequence([
    { body: { proposal } },
    { body: { agency } },
    { body: { processes } },
    { body: { items } },
  ]);
  return render(
    <MemoryRouter initialEntries={["/comercial/propostas/prop-1/apresentar"]}>
      <Routes>
        <Route path="/comercial/propostas/:id/apresentar" element={<ComercialPropostaApresentar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ComercialPropostaApresentar", () => {
  it("shows the capa with the agency name, tagline, and client", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]));
    expect((await screen.findAllByText("King Assessoria de Mkt")).length).toBeGreaterThan(0);
    expect(screen.getByText("Marketing sem complicação para negócios locais")).toBeInTheDocument();
    expect(screen.getByText("Apresentação preparada para")).toBeInTheDocument();
    expect(screen.getAllByText("Arthur Frios").length).toBeGreaterThan(0);
  });

  it("shows the fixed 'Quem somos' pillars, using agency.about when filled", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]), { ...AGENCY, about: "Texto sobre a King." });
    expect(await screen.findByRole("heading", { name: /A gente cuida da presença digital/ })).toBeInTheDocument();
    expect(screen.getByText("Texto sobre a King.")).toBeInTheDocument();
    expect(screen.getByText("Conteúdo")).toBeInTheDocument();
    expect(screen.getByText("Publicação")).toBeInTheDocument();
  });

  it("falls back to the default about text when agency.about is empty", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]), { ...AGENCY, about: "" });
    expect(await screen.findByText(/King Assessoria de Mkt ajuda empresas/)).toBeInTheDocument();
  });

  it("shows the fixed Criação de Conteúdo flow and its portfolio gallery only when that category is in the proposal", async () => {
    renderPage(
      proposalWithCategories(["Criação de Conteúdo"]),
      AGENCY,
      [],
      [{ id: "port-1", category: "Criação de Conteúdo", caption: "Exemplo", imagePath: "portfolio-port-1.png", createdAt: "2026-08-19T00:00:00.000Z" }],
    );
    expect(await screen.findByRole("heading", { name: "Seu conteúdo sem virar mais uma tarefa pra você" })).toBeInTheDocument();
    expect(screen.getByText("Entendemos")).toBeInTheDocument();
    expect(screen.getByText("Você acompanha")).toBeInTheDocument();
    expect(screen.getByAltText("Exemplo")).toHaveAttribute("src", "/api/commercial/assets/portfolio-port-1.png");
    expect(screen.queryByRole("heading", { name: "Alcance as pessoas certas" })).not.toBeInTheDocument();
  });

  it("shows the fixed Tráfego Pago flow only when that category is in the proposta", async () => {
    renderPage(proposalWithCategories(["Tráfego Pago"]));
    expect(await screen.findByRole("heading", { name: "Alcance as pessoas certas" })).toBeInTheDocument();
    expect(screen.getByText("Definimos o objetivo")).toBeInTheDocument();
    expect(screen.getByText(/paga diretamente à Meta/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Seu conteúdo sem virar mais uma tarefa pra você" })).not.toBeInTheDocument();
  });

  it("falls back to the saved process text for a category that isn't Criação de Conteúdo or Tráfego Pago", async () => {
    renderPage(
      proposalWithCategories(["Consultoria"]),
      AGENCY,
      [{ category: "Consultoria", text: "Texto salvo pra consultoria." }],
    );
    await screen.findByText("Texto salvo pra consultoria.");
    expect(screen.queryByText("Entendemos")).not.toBeInTheDocument();
  });

  it("shows the 5-card 'Por que escolher a King?' page, personalized with the client name", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]));
    expect(await screen.findByRole("heading", { name: "Por que escolher a King?" })).toBeInTheDocument();
    expect(screen.getByText("Presença constante")).toBeInTheDocument();
    expect(screen.getByText(/necessidades da Arthur Frios/)).toBeInTheDocument();
  });

  it("shows the divider page and ends with the reused price block, without repeating 'Por que a King'", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]));
    expect(await screen.findByRole("heading", { name: "Uma estratégia pensada para a Arthur Frios" })).toBeInTheDocument();
    expect(screen.getByText("Investimento mensal")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Por que a King/ })).not.toBeInTheDocument();
  });
});
