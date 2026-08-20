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
  it("shows the capa with the headline, service tags, and the client card", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]));
    expect(await screen.findByText("Marketing sem complicação para negócios locais")).toBeInTheDocument();
    expect(screen.getByText("Apresentação preparada para")).toBeInTheDocument();
    expect(screen.getAllByText("Arthur Frios").length).toBeGreaterThan(0);
  });

  it("shows the fixed 'Quem somos' pillars and closing callout, using agency.about when filled", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]), { ...AGENCY, about: "Texto sobre a King." });
    expect(await screen.findByRole("heading", { name: /A gente cuida da presença digital/ })).toBeInTheDocument();
    expect(screen.getByText("Texto sobre a King.")).toBeInTheDocument();
    expect(screen.getByText("Publicação")).toBeInTheDocument();
    expect(screen.getByText("Presença digital sem ocupar sua rotina.")).toBeInTheDocument();
  });

  it("falls back to the default about text when agency.about is empty", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]), { ...AGENCY, about: "" });
    expect(await screen.findByText(/King Assessoria de Mkt ajuda negócios locais/)).toBeInTheDocument();
  });

  it("always shows the fixed Criação de Conteúdo flow, with a portfolio gallery only when there are images for that category", async () => {
    renderPage(
      proposalWithCategories(["Tráfego Pago"]),
      AGENCY,
      [],
      [{ id: "port-1", category: "Criação de Conteúdo", caption: "Exemplo", imagePath: "portfolio-port-1.png", createdAt: "2026-08-19T00:00:00.000Z" }],
    );
    expect(await screen.findByRole("heading", { name: "Seu conteúdo sem virar mais uma tarefa pra você" })).toBeInTheDocument();
    expect(screen.getByText("Entendemos")).toBeInTheDocument();
    expect(screen.getByText("Você acompanha")).toBeInTheDocument();
    expect(screen.getByAltText("Exemplo")).toHaveAttribute("src", "/api/commercial/assets/portfolio-port-1.png");
  });

  it("always shows the fixed Tráfego Pago page, even when the proposal has no traffic section", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]));
    expect(await screen.findByRole("heading", { name: "Tráfego pago para ampliar seu alcance" })).toBeInTheDocument();
    expect(screen.getByText("Definimos o objetivo")).toBeInTheDocument();
    expect(screen.getByText("Você decide quanto quer investir.")).toBeInTheDocument();
  });

  it("falls back to the saved process text for a category that isn't Criação de Conteúdo or Tráfego Pago", async () => {
    renderPage(
      proposalWithCategories(["Consultoria"]),
      AGENCY,
      [{ category: "Consultoria", text: "Texto salvo pra consultoria." }],
    );
    await screen.findByText("Texto salvo pra consultoria.");
  });

  it("shows the 4-card 'Por que escolher a King?' page, personalized with the client name", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]));
    expect(await screen.findByRole("heading", { name: "Por que escolher a King?" })).toBeInTheDocument();
    expect(screen.getByText("Presença constante")).toBeInTheDocument();
    expect(screen.getByText(/Conteúdo pensado para o negócio da Arthur Frios/)).toBeInTheDocument();
  });

  it("shows the divider page and ends with the reused price block, without repeating 'Por que a King'", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]));
    expect(await screen.findByText("a estratégia para a Arthur Frios.")).toBeInTheDocument();
    expect(screen.getByText("Investimento mensal")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Por que a King/ })).not.toBeInTheDocument();
  });

  it("shows the Tráfego Pago upsell note in the proposal block when the proposal has no traffic section", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo"]));
    expect(await screen.findByText(/Pode ser incluído na proposta conforme o escopo definido/)).toBeInTheDocument();
  });

  it("hides the Tráfego Pago upsell note when the proposal already includes a traffic section", async () => {
    renderPage(proposalWithCategories(["Criação de Conteúdo", "Tráfego Pago"]));
    await screen.findByText("Investimento mensal");
    expect(screen.queryByText(/Pode ser incluído na proposta conforme o escopo definido/)).not.toBeInTheDocument();
  });
});
