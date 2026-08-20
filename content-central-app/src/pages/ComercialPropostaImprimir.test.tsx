import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialPropostaImprimir } from "./ComercialPropostaImprimir";

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

describe("ComercialPropostaImprimir", () => {
  it("renders agency + client branding, sections, and the setup-fee discount summary", async () => {
    stubFetchSequence([
      {
        body: {
          proposal: {
            id: "prop-1",
            clientName: "Arthur Frios",
            clientLogoDataUrl: "data:image/png;base64,abc",
            createdAt: "2026-08-19T12:00:00.000Z",
            sections: [
              { category: "Criação de Conteúdo", mode: "single", items: [{ catalogItemId: "profissional", name: "Profissional", description: "Plano top", whatWeDeliver: ["3 artes/dia"], whatClientProvides: [], billingType: "mensal", price: 497, fullPrice: 0, discountedPrice: 0 }] },
              { category: "Tráfego Pago", mode: "single", items: [{ catalogItemId: "setup", name: "Configuração inicial", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "unica", price: 0, fullPrice: 250, discountedPrice: 0 }] },
            ],
          },
        },
      },
      { body: { agency: { name: "King Assessoria de Mkt", logoPath: "logo.png", contactPhone: "(65) 99999-0000", contactInstagram: "@king", updatedAt: null } } },
    ]);

    const { container } = render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1/imprimir"]}>
        <Routes>
          <Route path="/comercial/propostas/:id/imprimir" element={<ComercialPropostaImprimir />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("King Assessoria de Mkt")).toBeInTheDocument();
    expect(screen.getByText("Arthur Frios")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proposta Comercial" })).toBeInTheDocument();
    expect(screen.getByText("Presença digital constante + crescimento real no Instagram")).toBeInTheDocument();
    expect(screen.getByText("Profissional")).toBeInTheDocument();
    expect(container.textContent).toContain("R$ 497");
    expect(container.textContent).toContain("/mês");
    expect(screen.getByText("Investimento mensal")).toBeInTheDocument();
    expect(screen.getByText("Desconto de adesão:")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Por que a King Assessoria de Mkt/ })).toBeInTheDocument();
  });

  it("excludes a comparison section's alternative plans from the investment total — the client picks one, it isn't summed", async () => {
    stubFetchSequence([
      {
        body: {
          proposal: {
            id: "prop-1",
            clientName: "Arthur Frios",
            clientLogoDataUrl: null,
            createdAt: "2026-08-19T12:00:00.000Z",
            sections: [
              {
                category: "Criação de Conteúdo",
                mode: "comparison",
                items: [
                  { catalogItemId: "essencial", name: "Essencial", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 297, fullPrice: 0, discountedPrice: 0 },
                  { catalogItemId: "profissional", name: "Profissional", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 497, fullPrice: 0, discountedPrice: 0 },
                  { catalogItemId: "atacado", name: "Atacado", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 897, fullPrice: 0, discountedPrice: 0 },
                ],
              },
              {
                category: "Tráfego Pago",
                mode: "single",
                items: [{ catalogItemId: "basico", name: "Básico", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 500, fullPrice: 0, discountedPrice: 0 }],
              },
            ],
          },
        },
      },
      { body: { agency: { name: "King", logoPath: "", contactPhone: "", contactInstagram: "", updatedAt: null } } },
    ]);

    const { container } = render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1/imprimir"]}>
        <Routes>
          <Route path="/comercial/propostas/:id/imprimir" element={<ComercialPropostaImprimir />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Investimento mensal");
    // Only the single-mode "Básico" (R$ 500) should count — not the three
    // comparison-mode alternatives (297 + 497 + 897), and never their sum
    // (2191) or the old, actually-observed bug (297+497+897=1691 alone).
    expect(container.textContent).toContain("R$ 500");
    expect(container.textContent).not.toContain("R$ 1691");
    expect(container.textContent).not.toContain("R$ 2191");
  });

  it("shows 'a partir de' the lowest comparison price instead of a blank box when nothing is single-mode yet", async () => {
    stubFetchSequence([
      {
        body: {
          proposal: {
            id: "prop-1",
            clientName: "Arthur Frios",
            clientLogoDataUrl: null,
            createdAt: "2026-08-19T12:00:00.000Z",
            sections: [
              {
                category: "Criação de Conteúdo",
                mode: "comparison",
                items: [
                  { catalogItemId: "essencial", name: "Essencial", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 297, fullPrice: 0, discountedPrice: 0 },
                  { catalogItemId: "profissional", name: "Profissional", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 497, fullPrice: 0, discountedPrice: 0 },
                  { catalogItemId: "atacado", name: "Atacado", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 897, fullPrice: 0, discountedPrice: 0 },
                ],
              },
            ],
          },
        },
      },
      { body: { agency: { name: "King", logoPath: "", contactPhone: "", contactInstagram: "", updatedAt: null } } },
    ]);

    render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1/imprimir"]}>
        <Routes>
          <Route path="/comercial/propostas/:id/imprimir" element={<ComercialPropostaImprimir />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Investimento mensal");
    expect(screen.getByText("A partir de R$ 297", { exact: false })).toBeInTheDocument();
  });

  it("switches to the dark theme and back through the Claro/Escuro toggle", async () => {
    stubFetchSequence([
      {
        body: {
          proposal: {
            id: "prop-1",
            clientName: "Arthur Frios",
            clientLogoDataUrl: null,
            createdAt: "2026-08-19T12:00:00.000Z",
            sections: [{ category: "Tráfego Pago", mode: "single", items: [{ catalogItemId: "basico", name: "Básico", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 500, fullPrice: 0, discountedPrice: 0 }] }],
          },
        },
      },
      { body: { agency: { name: "King", logoPath: "", contactPhone: "", contactInstagram: "", updatedAt: null } } },
    ]);

    const { container } = render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1/imprimir"]}>
        <Routes>
          <Route path="/comercial/propostas/:id/imprimir" element={<ComercialPropostaImprimir />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Investimento mensal");
    const page = container.querySelector('[data-theme]');
    expect(page).toHaveAttribute("data-theme", "light");

    await userEvent.click(screen.getByRole("button", { name: "Escuro" }));
    expect(page).toHaveAttribute("data-theme", "dark");
    expect(screen.getByText(/Gráficos de segundo plano/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Claro" }));
    expect(page).toHaveAttribute("data-theme", "light");
    expect(screen.queryByText(/Gráficos de segundo plano/)).not.toBeInTheDocument();
  });

  it("calls window.print when the print button is clicked", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    stubFetchSequence([
      {
        body: {
          proposal: {
            id: "prop-1",
            clientName: "Arthur Frios",
            clientLogoDataUrl: null,
            createdAt: "2026-08-19T12:00:00.000Z",
            sections: [{ category: "Tráfego Pago", mode: "single", items: [{ catalogItemId: "basico", name: "Básico", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "unica", price: 0, fullPrice: 250, discountedPrice: 0 }] }],
          },
        },
      },
      { body: { agency: { name: "King", logoPath: "", contactPhone: "", contactInstagram: "", updatedAt: null } } },
    ]);
    render(
      <MemoryRouter initialEntries={["/comercial/propostas/prop-1/imprimir"]}>
        <Routes>
          <Route path="/comercial/propostas/:id/imprimir" element={<ComercialPropostaImprimir />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Imprimir / Salvar como PDF" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});
