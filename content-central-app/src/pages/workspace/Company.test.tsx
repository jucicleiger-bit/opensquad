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
      return Promise.resolve({
        ok: response.ok !== false,
        text: async () => JSON.stringify(response.body),
      });
    }),
  );
}

function projectState(overrides: Record<string, unknown> = {}) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", brandInput: {}, brandXray: { status: "empty", blocks: {} }, ...overrides }],
    globalRules: {},
  };
}

function renderCompany() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/empresa"]}>
      <App />
    </MemoryRouter>,
  );
}

const FILLED_BLOCKS = {
  summary: { id: "summary", label: "Resumo da marca", text: "Boss Pizzaria é uma pizzaria de bairro.", status: "generated" },
  communication: { id: "communication", label: "Comunicação recomendada", text: "Tom caloroso e direto.", status: "generated" },
  contentStrategy: { id: "contentStrategy", label: "Estratégia de conteúdo", text: "Focar em rodízio e delivery.", status: "generated" },
  visualIdentity: { id: "visualIdentity", label: "Identidade visual", text: "Vermelho e amarelo, tipografia bold.", status: "generated" },
};

describe("Company", () => {
  it("saves the B2B/B2C commercial focus through the real brand-input endpoint, defaulting to unset", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {} } },
      { body: projectState({ brandInput: { audienceType: "b2b" } }) },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    const audienceTypeSelect = screen.getByLabelText("Foco comercial (opcional)") as HTMLSelectElement;
    expect(audienceTypeSelect.value).toBe("");

    await userEvent.type(screen.getByLabelText("Segmento"), "Atacado de embalagens");
    await userEvent.type(screen.getByLabelText("O que a empresa vende/oferece"), "embalagens e descartáveis para revenda");
    await userEvent.selectOptions(audienceTypeSelect, "b2b");
    await userEvent.click(screen.getByRole("button", { name: "Salvar informações" }));

    expect(await screen.findByText("Informações salvas.")).toBeInTheDocument();
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(saveCall[1].body as string).audienceType).toBe("b2b");
  });

  it("blocks analysis until the required fields are filled", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    await userEvent.click(screen.getByRole("button", { name: "Analisar minha marca" }));

    expect(await screen.findByText("Preencha nome, segmento e o que a empresa vende/oferece.")).toBeInTheDocument();
  });

  it("analyzes the brand through the real endpoint and renders the generated Raio-X blocks", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {}, xray: { status: "generated", blocks: FILLED_BLOCKS } } },
      { body: projectState({ brandXray: { status: "generated", blocks: FILLED_BLOCKS, generatedAt: "2026-07-23T12:00:00Z" } }) },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    await userEvent.type(screen.getByLabelText("Segmento"), "Pizzaria");
    await userEvent.type(screen.getByLabelText("O que a empresa vende/oferece"), "Rodízio e delivery de pizzas");
    await userEvent.click(screen.getByRole("button", { name: "Analisar minha marca" }));

    expect(await screen.findByText("Raio-X da marca gerado.")).toBeInTheDocument();
    expect(await screen.findByLabelText("Resumo da marca")).toHaveValue("Boss Pizzaria é uma pizzaria de bairro.");
    expect(screen.getByLabelText("Identidade visual")).toHaveValue("Vermelho e amarelo, tipografia bold.");
    expect(screen.getByRole("button", { name: "Usar este Raio-X" })).toBeInTheDocument();
  });

  it("approves the Raio-X with edited block text through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState({ brandXray: { status: "generated", blocks: FILLED_BLOCKS, generatedAt: "2026-07-23T12:00:00Z" } }) },
      { body: { project: {}, xray: { status: "approved", blocks: FILLED_BLOCKS } } },
      { body: projectState({ brandXray: { status: "approved", blocks: FILLED_BLOCKS, generatedAt: "2026-07-23T12:00:00Z" } }) },
    ]);
    renderCompany();

    const summaryField = await screen.findByLabelText("Resumo da marca");
    await userEvent.clear(summaryField);
    await userEvent.type(summaryField, "Resumo editado pelo operador.");
    await userEvent.click(screen.getByRole("button", { name: "Usar este Raio-X" }));

    expect(await screen.findByText("Raio-X aprovado e pronto para gerar conteúdos.")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
  });

  it("imports company info and offer candidates from a real site analysis", async () => {
    stubFetchSequence([
      { body: projectState() },
      {
        body: {
          brandInput: {
            brandName: "Boss Pizzaria",
            segment: "Pizzaria",
            productsOrServices: "Rodízio de pizzas e delivery",
            description: "",
            serviceRegion: "",
            mainDifferential: "",
          },
          offers: [{ name: "Pizza Grande", price: "R$ 49,90", items: "" }],
        },
      },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    await userEvent.type(screen.getByLabelText("URL do site ou cardápio"), "https://bosspizzaria.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Analisar site" }));

    expect(await screen.findByText("Nome da empresa")).toBeInTheDocument();
    expect(screen.getByLabelText("Nome da empresa")).toHaveValue("Boss Pizzaria");
    expect(screen.getByLabelText("Segmento")).toHaveValue("Pizzaria");
    expect(screen.getByText("Pizza Grande — R$ 49,90", { exact: false })).toBeInTheDocument();
  });

  it("adds selected site offer candidates as real offers", async () => {
    stubFetchSequence([
      { body: projectState() },
      {
        body: {
          brandInput: { brandName: "Boss Pizzaria", segment: "", productsOrServices: "", description: "", serviceRegion: "", mainDifferential: "" },
          offers: [
            { name: "Pizza Grande", price: "R$ 49,90", items: "" },
            { name: "Combo 10 Esfihas", price: "R$ 55,00", items: "" },
          ],
        },
      },
      { body: { project: {}, offer: { id: "pizza-grande" } } },
      { body: { project: {}, offer: { id: "combo-10-esfihas" } } },
      { body: projectState({ contentStrategy: { offers: [{ id: "pizza-grande" }, { id: "combo-10-esfihas" }] } }) },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    await userEvent.type(screen.getByLabelText("URL do site ou cardápio"), "https://bosspizzaria.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Analisar site" }));

    await screen.findByText("Pizza Grande — R$ 49,90", { exact: false });
    await userEvent.click(screen.getByRole("button", { name: /Adicionar selecionados como ofertas \(2\)/ }));

    expect(await screen.findByText('2 oferta(s) adicionada(s) em "Ofertas e assuntos".')).toBeInTheDocument();
    expect(screen.queryByText("Pizza Grande — R$ 49,90", { exact: false })).not.toBeInTheDocument();
  });

  it("imports from pasted text when the site blocks automatic access (Cloudflare, etc.)", async () => {
    stubFetchSequence([
      { body: projectState() },
      {
        body: {
          brandInput: { brandName: "Boss Pizzaria", segment: "Pizzaria", productsOrServices: "", description: "", serviceRegion: "", mainDifferential: "" },
          offers: [{ name: "Pizza Grande", price: "R$ 49,90", items: "" }],
        },
      },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    await userEvent.click(screen.getByRole("button", { name: "Colar texto" }));
    await userEvent.type(
      screen.getByLabelText("Texto do site/cardápio"),
      "Boss Pizzaria — Pizza Grande R$ 49,90",
    );
    await userEvent.click(screen.getByRole("button", { name: "Analisar texto" }));

    expect(await screen.findByLabelText("Nome da empresa")).toHaveValue("Boss Pizzaria");
    expect(screen.getByText("Pizza Grande — R$ 49,90", { exact: false })).toBeInTheDocument();
  });
});
