import { fireEvent, render, screen } from "@testing-library/react";
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
  it("saves and analyzes the B2B/B2C commercial focus in one action, defaulting to unset", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {} } },
      { body: projectState({ brandInput: { audienceType: "b2b" } }) },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    const audienceTypeSelect = screen.getByLabelText("Foco comercial (opcional)") as HTMLSelectElement;
    expect(audienceTypeSelect.value).toBe("");

    fireEvent.change(screen.getByLabelText("Setor principal"), { target: { value: "Engenharia" } });
    fireEvent.change(screen.getByLabelText("Tipo de negócio / nicho"), { target: { value: "Controle tecnológico / concreto / solos / asfalto" } });
    fireEvent.change(screen.getByLabelText("Segmento detalhado"), { target: { value: "Atacado de embalagens" } });
    fireEvent.change(screen.getByLabelText("Especialidade/subsegmento"), { target: { value: "controle tecnológico de concreto" } });
    fireEvent.change(screen.getByLabelText("O que a empresa vende/oferece"), { target: { value: "embalagens e descartáveis para revenda" } });
    await userEvent.selectOptions(audienceTypeSelect, "b2b");
    await userEvent.click(screen.getByRole("button", { name: "Salvar e analisar minha marca" }));

    expect(await screen.findByText("Raio-X da marca gerado.")).toBeInTheDocument();
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(saveCall[0]).toContain("/brand-xray/analyze");
    expect(JSON.parse(saveCall[1].body as string).audienceType).toBe("b2b");
    expect(JSON.parse(saveCall[1].body as string).segmentGroup).toBe("Engenharia");
    expect(JSON.parse(saveCall[1].body as string).segmentCategory).toBe("Controle tecnológico / concreto / solos / asfalto");
    expect(JSON.parse(saveCall[1].body as string).segmentSpecialty).toBe("controle tecnológico de concreto");
  });

  it("allows typing a new business niche when the preset list is not enough", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {} } },
      { body: projectState({ brandInput: { segmentGroup: "Engenharia", segmentCategory: "Geotecnia especial" } }) },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    fireEvent.change(screen.getByLabelText("Setor principal"), { target: { value: "Engenharia" } });
    fireEvent.change(screen.getByLabelText("Tipo de negócio / nicho"), { target: { value: "Geotecnia especial" } });
    fireEvent.change(screen.getByLabelText("Segmento detalhado"), { target: { value: "Engenharia geotécnica" } });
    fireEvent.change(screen.getByLabelText("O que a empresa vende/oferece"), { target: { value: "sondagem, fundações e laudos técnicos" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar e analisar minha marca" }));

    expect(await screen.findByText("Raio-X da marca gerado.")).toBeInTheDocument();
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(saveCall[1].body as string).segmentGroup).toBe("Engenharia");
    expect(JSON.parse(saveCall[1].body as string).segmentCategory).toBe("Geotecnia especial");
  });

  it("keeps the external segment learning out of the Raio-X screen", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    expect(screen.queryByLabelText("Texto técnico para aprendizado")).not.toBeInTheDocument();
    expect(screen.getByText(/O Raio-X usa essa classificação como informação confirmada e não a altera/)).toBeInTheDocument();
  });

  it("blocks analysis until the required fields are filled", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    await userEvent.click(screen.getByRole("button", { name: "Salvar e analisar minha marca" }));

    expect(await screen.findByText("Preencha nome, segmento e o que a empresa vende/oferece.")).toBeInTheDocument();
  });

  it("analyzes the brand through the real endpoint and renders the generated Raio-X blocks", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {}, xray: { status: "generated", blocks: FILLED_BLOCKS } } },
      { body: projectState({ brandXray: { status: "generated", analysisMode: "ai", blocks: FILLED_BLOCKS, generatedAt: "2026-07-23T12:00:00Z" } }) },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    await userEvent.type(screen.getByLabelText("Segmento detalhado"), "Pizzaria");
    await userEvent.type(screen.getByLabelText("O que a empresa vende/oferece"), "Rodízio e delivery de pizzas");
    await userEvent.click(screen.getByRole("button", { name: "Salvar e analisar minha marca" }));

    expect(await screen.findByText("Raio-X da marca gerado.")).toBeInTheDocument();
    expect(await screen.findByLabelText("Resumo da marca")).toHaveValue("Boss Pizzaria é uma pizzaria de bairro.");
    expect(screen.getByText("Análise estratégica feita pela IA.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Identidade visual")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar estratégia da marca" })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "Aprovar estratégia da marca" }));

    expect(await screen.findByText("Estratégia da marca aprovada.")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
  });

  it("lets the operator edit and save only safe AI field suggestions in one batch", async () => {
    const brandInput = {
      brandName: "Boss Pizzaria",
      segmentGroup: "Alimentício",
      segmentCategory: "Pizzaria",
      segmentSpecialty: "Rodízio e delivery",
      segment: "Pizzaria com rodízio",
      productsOrServices: "Rodízio e delivery de pizzas",
      audience: "",
      tone: [],
    };
    const brandXray = {
      status: "generated",
      analysisMode: "ai",
      blocks: FILLED_BLOCKS,
      generatedAt: "2026-07-23T12:00:00Z",
      fieldSuggestions: [
        {
          field: "audience",
          label: "Público-alvo sugerido",
          value: "Famílias e grupos de amigos da região",
          reason: "Inferido a partir do negócio e da região.",
          source: "ai_analysis",
          confidence: "medium",
          requiresConfirmation: true,
        },
        {
          field: "segmentCategory",
          label: "Categoria proibida",
          value: "Tentativa proibida",
          reason: "Este item simula uma resposta insegura do servidor.",
        },
      ],
    };
    stubFetchSequence([
      { body: projectState({ brandInput, brandXray }) },
      { body: { project: {}, xray: { status: "generated", blocks: FILLED_BLOCKS } } },
      {
        body: projectState({
          brandInput: { ...brandInput, audience: "Famílias, casais e grupos de amigos da região" },
          brandXray: { ...brandXray, generatedAt: "2026-07-23T12:01:00Z", fieldSuggestions: [] },
        }),
      },
    ]);
    renderCompany();

    const suggestion = await screen.findByLabelText("Público-alvo sugerido");
    expect(screen.queryByText("Tentativa proibida")).not.toBeInTheDocument();
    fireEvent.change(suggestion, { target: { value: "Famílias, casais e grupos de amigos da região" } });
    await userEvent.click(screen.getByRole("button", { name: "Usar sugestão de Público-alvo sugerido" }));

    expect(screen.getByLabelText("Público-alvo")).toHaveValue("Famílias, casais e grupos de amigos da região");
    expect(screen.getByRole("button", { name: "Aprovar estratégia da marca" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Salvar sugestões escolhidas e atualizar o Raio-X (1)" }));

    expect(await screen.findByText("Sugestões salvas e Raio-X atualizado.")).toBeInTheDocument();
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    const saved = JSON.parse(saveCall[1].body as string);
    expect(saved.audience).toBe("Famílias, casais e grupos de amigos da região");
    expect(saved.segmentGroup).toBe("Alimentício");
    expect(saved.segmentCategory).toBe("Pizzaria");
    expect(saved.segmentSpecialty).toBe("Rodízio e delivery");
  });

  it("restores the previous form value when a selected suggestion is ignored", async () => {
    stubFetchSequence([
      {
        body: projectState({
          brandInput: {
            brandName: "Boss Pizzaria",
            segment: "Pizzaria",
            productsOrServices: "Rodízio e delivery de pizzas",
            audience: "",
          },
          brandXray: {
            status: "generated",
            blocks: FILLED_BLOCKS,
            generatedAt: "2026-07-23T12:00:00Z",
            fieldSuggestions: [
              {
                field: "audience",
                label: "Público-alvo sugerido",
                value: "Famílias da região",
                reason: "Hipótese para confirmação.",
              },
            ],
          },
        }),
      },
    ]);
    renderCompany();

    await screen.findByLabelText("Público-alvo sugerido");
    await userEvent.click(screen.getByRole("button", { name: "Usar sugestão de Público-alvo sugerido" }));
    expect(screen.getByLabelText("Público-alvo")).toHaveValue("Famílias da região");
    await userEvent.click(screen.getByRole("button", { name: "Ignorar sugestão de Público-alvo sugerido" }));

    expect(screen.getByLabelText("Público-alvo")).toHaveValue("");
    expect(screen.queryByLabelText("Público-alvo sugerido")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salvar sugestões escolhidas/ })).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByText("Preencher automaticamente por site ou texto"));
    await userEvent.type(screen.getByLabelText("URL do site ou cardápio"), "https://bosspizzaria.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Analisar site" }));

    expect(await screen.findByText("Nome da empresa")).toBeInTheDocument();
    expect(screen.getByLabelText("Nome da empresa")).toHaveValue("Boss Pizzaria");
    expect(screen.getByLabelText("Segmento detalhado")).toHaveValue("Pizzaria");
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
    await userEvent.click(screen.getByText("Preencher automaticamente por site ou texto"));
    await userEvent.type(screen.getByLabelText("URL do site ou cardápio"), "https://bosspizzaria.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Analisar site" }));

    await screen.findByText("Pizza Grande — R$ 49,90", { exact: false });
    await userEvent.click(screen.getByRole("button", { name: /Adicionar selecionados como ofertas \(2\)/ }));

    expect(await screen.findByText('2 oferta(s) adicionada(s) em "Ofertas e assuntos".')).toBeInTheDocument();
    expect(screen.queryByText("Pizza Grande — R$ 49,90", { exact: false })).not.toBeInTheDocument();
  });

  it("shows a weight editor once 2+ content-goal buckets are active, blocks saving until it sums to 100%, and sends the resolved weights", async () => {
    stubFetchSequence([
      { body: projectState({ contentStrategy: { offers: [{ id: "o1", name: "Produto", type: "offer", active: true }] } }) },
      { body: { project: {} } },
      { body: projectState() },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    fireEvent.change(screen.getByLabelText("Setor principal"), { target: { value: "Loja" } });
    fireEvent.change(screen.getByLabelText("Tipo de negócio / nicho"), { target: { value: "Loja de bairro" } });
    fireEvent.change(screen.getByLabelText("Segmento detalhado"), { target: { value: "Loja" } });
    fireEvent.change(screen.getByLabelText("O que a empresa vende/oferece"), { target: { value: "produtos variados" } });

    // Toggling "Gerar autoridade" on: with an active offer, "Venda" + "Gerar
    // autoridade" makes 2 buckets, so the weight editor appears with a 50/50
    // default (an active offer alone, with zero goals marked, is only 1
    // bucket and shows no editor at all).
    await userEvent.click(screen.getByRole("button", { name: "Gerar autoridade" }));

    const vendaInput = (await screen.findByLabelText("Peso: Venda")) as HTMLInputElement;
    const authorityInput = screen.getByLabelText("Peso: Gerar autoridade") as HTMLInputElement;
    expect(vendaInput.value).toBe("50");
    expect(authorityInput.value).toBe("50");

    fireEvent.change(vendaInput, { target: { value: "90" } });
    fireEvent.change(authorityInput, { target: { value: "5" } });
    expect(screen.getByRole("button", { name: "Salvar e analisar minha marca" })).toBeDisabled();
    expect(screen.getByText(/soma 95%/)).toBeInTheDocument();

    fireEvent.change(authorityInput, { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Salvar e analisar minha marca" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Salvar e analisar minha marca" }));
    await screen.findByText("Raio-X da marca gerado.");

    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(saveCall[1].body as string).contentGoalWeights).toEqual({ sales: 90, authority: 10 });
  });

  it("rebalances the remaining weights to a fresh even split when a goal is toggled off", async () => {
    stubFetchSequence([
      { body: projectState({ contentStrategy: { offers: [{ id: "o1", name: "Produto", type: "offer", active: true }] } }) },
    ]);
    renderCompany();

    await screen.findByRole("heading", { name: "Empresa / Raio-X" });
    await userEvent.click(screen.getByRole("button", { name: "Gerar autoridade" }));
    await userEvent.click(screen.getByRole("button", { name: "Aumentar engajamento" }));

    const vendaInput = (await screen.findByLabelText("Peso: Venda")) as HTMLInputElement;
    const authorityInput = screen.getByLabelText("Peso: Gerar autoridade") as HTMLInputElement;
    const engagementInput = screen.getByLabelText("Peso: Aumentar engajamento") as HTMLInputElement;

    fireEvent.change(vendaInput, { target: { value: "40" } });
    fireEvent.change(authorityInput, { target: { value: "30" } });
    fireEvent.change(engagementInput, { target: { value: "30" } });
    expect(screen.getByRole("button", { name: "Salvar e analisar minha marca" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Aumentar engajamento" }));

    expect(screen.queryByLabelText("Peso: Aumentar engajamento")).not.toBeInTheDocument();
    expect(vendaInput.value).toBe("50");
    expect(authorityInput.value).toBe("50");
    expect(screen.getByRole("button", { name: "Salvar e analisar minha marca" })).toBeEnabled();
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
    await userEvent.click(screen.getByText("Preencher automaticamente por site ou texto"));
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
