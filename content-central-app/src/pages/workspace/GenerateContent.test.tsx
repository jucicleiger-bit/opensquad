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

function projectState(offers: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers } }],
    globalRules: {},
  };
}

function catalogProjectState(offers: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", projectType: "catalog", contentStrategy: { offers } }],
    globalRules: {},
  };
}

function renderGenerate() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/gerar"]}>
      <App />
    </MemoryRouter>,
  );
}

// "Agenda e geração" (marketing) also loads the commemorative-dates list on
// mount, right after the project itself — every marketing-form fixture
// needs a response for that second call, or the section reads `undefined`
// off it and throws.
const EMPTY_COMMEMORATIVE_DATES = { body: { dates: [] } };

describe("GenerateContent", () => {
  it("warns when the project has no active offers", async () => {
    stubFetchSequence([{ body: projectState() }, EMPTY_COMMEMORATIVE_DATES]);
    renderGenerate();

    expect(await screen.findByText("Nenhum assunto/oferta cadastrado para este projeto.")).toBeInTheDocument();
  });

  it("does not warn when the project has an active offer", async () => {
    stubFetchSequence([
      { body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) },
      EMPTY_COMMEMORATIVE_DATES,
    ]);
    renderGenerate();

    await screen.findByRole("heading", { name: "Agenda e geração" });
    expect(screen.queryByText("Nenhum assunto/oferta cadastrado para este projeto.")).not.toBeInTheDocument();
  });

  it("blocks submission when no format is checked", async () => {
    stubFetchSequence([{ body: projectState() }, EMPTY_COMMEMORATIVE_DATES]);
    renderGenerate();

    const storyCheckbox = await screen.findByRole("checkbox", { name: "Instagram Stories" });
    const feedCheckbox = screen.getByRole("checkbox", { name: "Instagram Feed" });
    await userEvent.click(storyCheckbox);
    await userEvent.click(feedCheckbox);
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByText("Marque pelo menos um formato.")).toBeInTheDocument();
  });

  it("offers Facebook Feed and Story as selectable formats and includes them in the generate request", async () => {
    stubFetchSequence([
      { body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) },
      EMPTY_COMMEMORATIVE_DATES,
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    const fbFeedCheckbox = await screen.findByRole("checkbox", { name: "Facebook Feed" });
    const fbStoryCheckbox = screen.getByRole("checkbox", { name: "Facebook Story" });
    expect(fbFeedCheckbox).not.toBeChecked();
    expect(fbStoryCheckbox).not.toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: "Instagram Stories" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Instagram Feed" }));
    await userEvent.click(fbFeedCheckbox);
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const generateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    const body = JSON.parse(generateCall[1].body as string);
    expect(body.formats.map((f: { channel: string }) => f.channel)).toEqual(["facebook_feed"]);
  });

  it("sends no groupIds by default, and only the checked group's id once one is selected", async () => {
    stubFetchSequence([
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            contentStrategy: {
              offers: [{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }],
              offerGroups: [{ id: "black-friday", name: "Black Friday" }],
            },
          }],
          globalRules: {},
        },
      },
      EMPTY_COMMEMORATIVE_DATES,
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await screen.findByRole("checkbox", { name: "Black Friday" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Black Friday" }));
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const generateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(JSON.parse(generateCall[1].body as string).groupIds).toEqual(["black-friday"]);
  });

  it("only offers the 'sem misturar outros objetivos' checkbox once a group is selected, and sends offersOnly when checked", async () => {
    stubFetchSequence([
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            contentStrategy: {
              offers: [{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }],
              offerGroups: [{ id: "black-friday", name: "Black Friday" }],
            },
          }],
          globalRules: {},
        },
      },
      EMPTY_COMMEMORATIVE_DATES,
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await screen.findByRole("checkbox", { name: "Black Friday" });
    expect(screen.queryByText(/sem misturar outros objetivos/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Black Friday" }));
    const offersOnlyCheckbox = await screen.findByRole("checkbox", { name: /sem misturar outros objetivos/i });
    await userEvent.click(offersOnlyCheckbox);
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const generateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(JSON.parse(generateCall[1].body as string).offersOnly).toBe(true);
  });

  it("previews the planned agenda before generation and can generate approved regular plus commemorative extra cards", async () => {
    stubFetchSequence([
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            contentStrategy: {
              offers: [{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }],
              offerGroups: [{ id: "black-friday", name: "Black Friday" }],
            },
          }],
          globalRules: {},
        },
      },
      EMPTY_COMMEMORATIVE_DATES,
      {
        body: {
          plan: {
            summary: "4 posts normais + 1 extra de data comemorativa.",
            regularCount: 4,
            extraCount: 1,
            dayPlans: [
              {
                dayNumber: 1,
                date: "2026-09-15",
                regular: [{ id: "r1", channelLabel: "Instagram Stories", label: "Venda — Rodízio", kind: "Venda", reason: "Oferta do grupo selecionado" }],
                extras: [{ id: "e1", channel: "instagram_story", channelLabel: "Instagram Stories", specialDateLabel: "Dia do Cliente", label: "Extra — Dia do Cliente" }],
              },
            ],
          },
        },
      },
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { batch: { items: [{ contentId: "extra" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await screen.findByRole("checkbox", { name: "Black Friday" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Black Friday" }));
    await userEvent.click(screen.getByRole("button", { name: "Planejar agenda" }));

    expect(await screen.findByText("Resumo do que será postado")).toBeInTheDocument();
    expect(screen.getByText("4 posts normais + 1 extra de data comemorativa.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Extra — Dia do Cliente")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Editar assunto r1"));
    await userEvent.type(screen.getByLabelText("Editar assunto r1"), "Venda — Rodízio de quarta editado");
    await userEvent.clear(screen.getByLabelText("Editar orientação r1"));
    await userEvent.type(screen.getByLabelText("Editar orientação r1"), "Focar em família no meio da semana.");

    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos aprovados" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const planCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/plan");
    const generateCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/generate");
    const extraCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/generate-special-date");
    expect(planCall).toBeTruthy();
    expect(JSON.parse(planCall![1].body as string).groupIds).toEqual(["black-friday"]);
    expect(generateCall).toBeTruthy();
    expect(JSON.parse(generateCall![1].body as string).approvedPlan.dayPlans[0].regular[0]).toMatchObject({
      label: "Venda — Rodízio de quarta editado",
      reason: "Focar em família no meio da semana.",
    });
    expect(extraCall).toBeTruthy();
    expect(JSON.parse(extraCall![1].body as string)).toMatchObject({ label: "Dia do Cliente", channels: ["instagram_story"] });
  }, 15_000);

  it("generates content through the real endpoint and navigates to the calendar", async () => {
    stubFetchSequence([
      { body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) },
      EMPTY_COMMEMORATIVE_DATES,
      { body: { batch: { items: [{ contentId: "a" }, { contentId: "b" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await screen.findByRole("heading", { name: "Agenda e geração" });
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const generateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(JSON.parse(generateCall[1].body as string).groupIds).toBeUndefined();
  });

  it("lists upcoming commemorative dates and creates a one-off card for the chosen date/channel through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) },
      {
        body: {
          dates: [
            { date: "2026-05-10", label: "Dia das Mães", kind: "commercial" },
            { date: "2026-06-12", label: "Dia dos Namorados", kind: "commercial" },
          ],
        },
      },
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    expect(await screen.findByText("Dia das Mães")).toBeInTheDocument();
    expect(screen.getByText("Dia dos Namorados")).toBeInTheDocument();
    expect(screen.getByText("10 de maio")).toBeInTheDocument();

    // Defaults to Instagram Stories checked — checking Feed too means both
    // formats go out in the same request, so the backend can share one
    // creative across same-shape channels instead of paying for two. Scoped
    // via aria-label since the main "Organizar por formato" section renders
    // a same-named checkbox too.
    await userEvent.click(screen.getByRole("checkbox", { name: "Instagram Feed para Dia das Mães" }));
    // Both dates render an identically-labelled button — the Dia das Mães
    // row comes first (dates are pre-sorted ascending by the API).
    await userEvent.click(screen.getAllByRole("button", { name: "Criar arte pra essa data" })[0]);

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const specialDateCalls = calls.filter(([url]) => url === "/api/projects/boss-pizzaria/generate-special-date");
    expect(specialDateCalls.length).toBe(1);
    const body = JSON.parse(specialDateCalls[0][1].body as string);
    expect([...body.channels].sort()).toEqual(["instagram_feed", "instagram_story"]);
    expect(body.date).toBe("2026-05-10");
    expect(body.label).toBe("Dia das Mães");
  });

  it("lets the operator create an ad hoc special date (regional holiday etc.) not on the automatic list, for any combination of formats", async () => {
    stubFetchSequence([
      { body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) },
      { body: { dates: [] } },
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await screen.findByText("Data personalizada");
    await userEvent.type(screen.getByLabelText("Nome da data"), "Aniversário da cidade");
    await userEvent.type(screen.getByLabelText("Data"), "2026-09-20");
    await userEvent.type(screen.getByLabelText("Horário (opcional)"), "10:00");
    // Default is Story checked only — this test keeps that default (no Feed
    // toggle), so only one card/request should be created.
    await userEvent.click(screen.getByRole("button", { name: "Criar arte pra essa data" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const specialDateCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/generate-special-date");
    expect(specialDateCall).toBeTruthy();
    expect(JSON.parse(specialDateCall![1].body as string)).toEqual({
      date: "2026-09-20",
      label: "Aniversário da cidade",
      channels: ["instagram_story"],
      postTime: "10:00",
    });
  });

  it("shows a simplified agenda (days, stories per day, start time) for catalog projects, with no formats matrix", async () => {
    stubFetchSequence([{ body: catalogProjectState([{ id: "iphone", name: "iPhone 13", active: true }]) }]);
    renderGenerate();

    await screen.findByLabelText("Stories por dia");
    expect(screen.queryByText("Organizar por formato")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Instagram Stories" })).not.toBeInTheDocument();
  });

  it("warns when a catalog project has no active product in stock", async () => {
    stubFetchSequence([{ body: catalogProjectState() }]);
    renderGenerate();

    expect(await screen.findByText("Nenhum produto em estoque cadastrado.")).toBeInTheDocument();
  });

  it("generates catalog content through the real generate-catalog endpoint and navigates to the calendar", async () => {
    stubFetchSequence([
      { body: catalogProjectState([{ id: "iphone", name: "iPhone 13", active: true }]) },
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await screen.findByLabelText("Stories por dia");
    await userEvent.clear(screen.getByLabelText("Stories por dia"));
    await userEvent.type(screen.getByLabelText("Stories por dia"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const generateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(generateCall[0]).toBe("/api/projects/boss-pizzaria/generate-catalog");
    expect(JSON.parse(generateCall[1].body as string).storiesPerDay).toBe("5");
  });
});
