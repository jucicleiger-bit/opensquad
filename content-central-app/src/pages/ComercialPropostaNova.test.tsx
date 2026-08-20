import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialPropostaNova } from "./ComercialPropostaNova";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, text: async () => JSON.stringify(body) }),
  );
}

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

const ESSENCIAL = { id: "essencial", category: "Criação de Conteúdo", name: "Essencial", description: "Plano básico", whatWeDeliver: ["2 artes/dia"], whatClientProvides: [], billingType: "mensal", price: 297, fullPrice: 0, discountedPrice: 0, createdAt: "", updatedAt: "" };
const PROFISSIONAL = { id: "profissional", category: "Criação de Conteúdo", name: "Profissional", description: "Plano intermediário", whatWeDeliver: ["3 artes/dia"], whatClientProvides: [], billingType: "mensal", price: 497, fullPrice: 0, discountedPrice: 0, createdAt: "", updatedAt: "" };

describe("ComercialPropostaNova", () => {
  it("builds a proposal with a single chosen item and saves it, navigating to the saved proposal", async () => {
    stubFetchSequence([
      { body: { items: [ESSENCIAL, PROFISSIONAL] } },
      { body: { proposal: { id: "prop-123", clientName: "Arthur Frios", clientLogoDataUrl: null, sections: [], createdAt: "2026-08-19T00:00:00.000Z" } } },
    ]);

    render(
      <MemoryRouter initialEntries={["/comercial/propostas/nova"]}>
        <Routes>
          <Route path="/comercial/propostas/nova" element={<ComercialPropostaNova />} />
          <Route path="/comercial/propostas/:id" element={<div>Proposta salva</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Criação de Conteúdo");
    await userEvent.type(screen.getByLabelText("Nome do cliente"), "Arthur Frios");
    await userEvent.selectOptions(screen.getByLabelText("O que incluir"), "single");
    await userEvent.selectOptions(screen.getByLabelText("Item"), "profissional");

    expect(screen.getByLabelText("Nome")).toHaveValue("Profissional");

    await userEvent.click(screen.getByRole("button", { name: "Salvar proposta" }));

    expect(await screen.findByText("Proposta salva")).toBeInTheDocument();

    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(saveCall[0]).toBe("/api/commercial/proposals");
    const sentBody = JSON.parse(saveCall[1].body as string);
    expect(sentBody.clientName).toBe("Arthur Frios");
    expect(sentBody.sections).toEqual([
      {
        category: "Criação de Conteúdo",
        mode: "single",
        items: [
          { catalogItemId: "profissional", name: "Profissional", description: "Plano intermediário", whatWeDeliver: ["3 artes/dia"], whatClientProvides: [], billingType: "mensal", price: 497, fullPrice: 0, discountedPrice: 0 },
        ],
      },
    ]);
  });

  it("builds a comparison section with every item in the category when comparison mode is chosen", async () => {
    stubFetch({ items: [ESSENCIAL, PROFISSIONAL] });
    render(
      <MemoryRouter>
        <ComercialPropostaNova />
      </MemoryRouter>,
    );
    await screen.findByText("Criação de Conteúdo");
    await userEvent.selectOptions(screen.getByLabelText("O que incluir"), "comparison");
    expect(screen.getAllByLabelText("Nome")).toHaveLength(2);
  });

  it("requires a client name and at least one included category before saving", async () => {
    stubFetch({ items: [ESSENCIAL] });
    render(
      <MemoryRouter>
        <ComercialPropostaNova />
      </MemoryRouter>,
    );
    await screen.findByText("Criação de Conteúdo");
    await userEvent.selectOptions(screen.getByLabelText("O que incluir"), "comparison");
    await userEvent.click(screen.getByRole("button", { name: "Salvar proposta" }));
    expect(await screen.findByText("Nome do cliente é obrigatório.")).toBeInTheDocument();
  });
});
