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
    expect(screen.getByRole("heading", { name: "Proposta para Arthur Frios" })).toBeInTheDocument();
    expect(screen.getByText("Profissional")).toBeInTheDocument();
    expect(container.textContent).toContain("R$ 497");
    expect(container.textContent).toContain("/mês");
    expect(screen.getByText("Investimento")).toBeInTheDocument();
    expect(container.textContent).toContain("R$ 497");
    expect(screen.getByText("Desconto de adesão:")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Por que a King Assessoria de Mkt/ })).toBeInTheDocument();
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
