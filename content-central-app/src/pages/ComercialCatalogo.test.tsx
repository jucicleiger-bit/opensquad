import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialCatalogo } from "./ComercialCatalogo";

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

const PROFISSIONAL_ITEM = {
  id: "profissional",
  category: "Criação de Conteúdo",
  name: "Profissional",
  description: "3 artes por dia",
  whatWeDeliver: [],
  whatClientProvides: [],
  billingType: "mensal",
  price: 497,
  fullPrice: 0,
  discountedPrice: 0,
  createdAt: "",
  updatedAt: "",
};

describe("ComercialCatalogo", () => {
  it("renders catalog items grouped by category", async () => {
    stubFetch({ items: [PROFISSIONAL_ITEM] });
    render(
      <MemoryRouter>
        <ComercialCatalogo />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Profissional")).toBeInTheDocument();
    expect(screen.getByText("Criação de Conteúdo")).toBeInTheDocument();
    expect(screen.getByText("R$ 497/mês")).toBeInTheDocument();
  });

  it("shows an empty state with no items", async () => {
    stubFetch({ items: [] });
    render(
      <MemoryRouter>
        <ComercialCatalogo />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Catálogo vazio")).toBeInTheDocument();
  });

  it("creates a new catalog item through the real endpoint", async () => {
    stubFetchSequence([
      { body: { items: [] } },
      { body: { item: PROFISSIONAL_ITEM } },
      { body: { items: [PROFISSIONAL_ITEM] } },
    ]);
    render(
      <MemoryRouter>
        <ComercialCatalogo />
      </MemoryRouter>,
    );
    await screen.findByText("Catálogo vazio");
    await userEvent.click(screen.getByRole("button", { name: "+ Novo item" }));
    await userEvent.type(screen.getByLabelText("Categoria"), "Criação de Conteúdo");
    await userEvent.type(screen.getByLabelText("Nome"), "Profissional");
    await userEvent.type(screen.getByLabelText("Preço mensal (R$)"), "497");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar item" }));
    expect(await screen.findByText("Profissional")).toBeInTheDocument();
  });

  it("deletes a catalog item through the real endpoint after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([
      { body: { items: [PROFISSIONAL_ITEM] } },
      { body: { id: "profissional", deleted: true } },
      { body: { items: [] } },
    ]);
    render(
      <MemoryRouter>
        <ComercialCatalogo />
      </MemoryRouter>,
    );
    await screen.findByText("Profissional");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText("Catálogo vazio")).toBeInTheDocument();
  });

  it("saves the per-category process text through the real endpoint", async () => {
    stubFetchSequence([
      { body: { items: [PROFISSIONAL_ITEM] } },
      { body: { processes: [] } },
      { body: { process: { category: "Criação de Conteúdo", text: "Cada peça sob medida." } } },
    ]);
    render(
      <MemoryRouter>
        <ComercialCatalogo />
      </MemoryRouter>,
    );
    await screen.findByText("Profissional");
    await userEvent.type(screen.getByLabelText("Como trabalhamos em Criação de Conteúdo"), "Cada peça sob medida.");
    await userEvent.click(screen.getByRole("button", { name: "Salvar processo" }));

    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(saveCall[0]).toBe("/api/commercial/processes");
    expect(JSON.parse(saveCall[1].body as string)).toEqual({ category: "Criação de Conteúdo", text: "Cada peça sob medida." });
  });
});
