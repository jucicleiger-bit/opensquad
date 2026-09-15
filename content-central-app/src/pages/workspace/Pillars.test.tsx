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

function projectState(pillars: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [], pillars } }],
    globalRules: {},
  };
}

function renderPillars() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/pilares"]}>
      <App />
    </MemoryRouter>,
  );
}

const PROVA_PILLAR = {
  id: "bastidor-sabor",
  name: "Bastidor & Sabor",
  role: "prova",
  objective: "Mostrar o preparo real.",
  visualTreatment: "cru",
  color: "#C2784A",
  weight: 2,
  requiresEvidence: true,
  active: true,
};

describe("Pillars", () => {
  it("shows an empty state when there are no pillars yet", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderPillars();
    expect(await screen.findByText("Nenhum pilar cadastrado ainda")).toBeInTheDocument();
  });

  it("renders a real pillar with its role, treatment and weight pills", async () => {
    stubFetchSequence([{ body: projectState([PROVA_PILLAR]) }]);
    renderPillars();
    expect(await screen.findByText("Bastidor & Sabor")).toBeInTheDocument();
    expect(screen.getAllByText("Prova").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cru").length).toBeGreaterThan(0);
    expect(screen.getByText("peso 2")).toBeInTheDocument();
    expect(screen.getByText("exige evidência")).toBeInTheDocument();
  });

  it("creates a new pillar through the real endpoint and shows it in the list", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {}, pillar: PROVA_PILLAR } },
      { body: projectState([PROVA_PILLAR]) },
    ]);
    renderPillars();

    await screen.findByText("Nenhum pilar cadastrado ainda");
    await userEvent.type(screen.getByLabelText("Nome"), "Bastidor & Sabor");
    await userEvent.click(screen.getByRole("button", { name: "Salvar pilar" }));

    expect(await screen.findByText("Bastidor & Sabor")).toBeInTheDocument();
  });

  it("deletes a pillar through the real endpoint after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([{ body: projectState([PROVA_PILLAR]) }, { body: { deleted: true } }, { body: projectState() }]);
    renderPillars();

    await screen.findByText("Bastidor & Sabor");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(await screen.findByText("Nenhum pilar cadastrado ainda")).toBeInTheDocument();
  });

  it("edits an existing pillar in place by sending its id to the save endpoint", async () => {
    const updated = { ...PROVA_PILLAR, weight: 5 };
    stubFetchSequence([
      { body: projectState([PROVA_PILLAR]) },
      { body: { project: {}, pillar: updated } },
      { body: projectState([updated]) },
    ]);
    renderPillars();

    await screen.findByText("Bastidor & Sabor");
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByRole("button", { name: "Salvar edição" })).toBeInTheDocument();
    const weightField = screen.getByLabelText("Peso na distribuição") as HTMLInputElement;
    expect(weightField.value).toBe("2");

    await userEvent.clear(weightField);
    await userEvent.type(weightField, "5");
    await userEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    expect(await screen.findByText("peso 5")).toBeInTheDocument();
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(saveCall[1].body as string).id).toBe(PROVA_PILLAR.id);
  });

  it("suggests pillars with AI and applies the selected ones through the real endpoints", async () => {
    const suggestedEnsina = {
      id: "dica-rapida", name: "Dica Rápida", role: "ensina", objective: "Dica prática.",
      visualTreatment: "leve", color: "#2563EB", weight: 3, requiresEvidence: false,
    };
    const suggestedConvida = {
      id: "convite-direto", name: "Convite Direto", role: "convida", objective: "Chamada direta.",
      visualTreatment: "leve", color: "#E63946", weight: 1, requiresEvidence: false,
    };
    stubFetchSequence([
      { body: projectState() },
      { body: { pillars: [suggestedEnsina, suggestedConvida], clarifyingQuestions: [], source: "ai_suggestion" } },
      { body: { project: {}, pillar: suggestedEnsina } },
      { body: { project: {}, pillar: suggestedConvida } },
      { body: projectState([suggestedEnsina, suggestedConvida]) },
    ]);
    renderPillars();

    await screen.findByText("Nenhum pilar cadastrado ainda");
    await userEvent.click(screen.getByRole("button", { name: "Sugerir pilares com IA" }));

    await screen.findByText("Dica Rápida");
    expect(screen.getByText("Convite Direto")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aplicar selecionados (2)" }));

    await screen.findByText("peso 3");
    expect(screen.getByText("peso 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aplicar selecionados/ })).not.toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const [ensinaSave, convidaSave] = [JSON.parse(calls[2][1].body as string), JSON.parse(calls[3][1].body as string)];
    expect(ensinaSave).toMatchObject({ name: "Dica Rápida", role: "ensina" });
    expect(ensinaSave.id).toBeUndefined();
    expect(convidaSave).toMatchObject({ name: "Convite Direto", role: "convida" });
  });

  it("shows the AI's clarifying questions and re-suggests with the operator's extra context", async () => {
    const suggestedProva = {
      id: "bastidor-sabor", name: "Bastidor & Sabor", role: "prova", objective: "Mostrar o preparo real.",
      visualTreatment: "cru", color: "#7A5230", weight: 2, requiresEvidence: true,
    };
    stubFetchSequence([
      { body: projectState() },
      {
        body: {
          pillars: [suggestedProva],
          clarifyingQuestions: ["Você tem algum caso real de cliente pra alimentar o pilar Prova?"],
          source: "ai_suggestion",
        },
      },
      { body: { pillars: [suggestedProva], clarifyingQuestions: [], source: "ai_suggestion" } },
    ]);
    renderPillars();

    await screen.findByText("Nenhum pilar cadastrado ainda");
    await userEvent.click(screen.getByRole("button", { name: "Sugerir pilares com IA" }));

    expect(await screen.findByText("Você tem algum caso real de cliente pra alimentar o pilar Prova?")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Contexto adicional (opcional)"), "Ainda não tenho case fechado.");
    await userEvent.click(screen.getByRole("button", { name: "Sugerir de novo com esse contexto" }));

    await screen.findByText("Bastidor & Sabor");
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(JSON.parse(calls[2][1].body as string).extraContext).toBe("Ainda não tenho case fechado.");
    expect(screen.queryByText("Você tem algum caso real de cliente pra alimentar o pilar Prova?")).not.toBeInTheDocument();
  });
});
