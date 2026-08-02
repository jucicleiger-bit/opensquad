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

describe("GenerateContent", () => {
  it("warns when the project has no active offers", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderGenerate();

    expect(await screen.findByText("Nenhum assunto/oferta cadastrado para este projeto.")).toBeInTheDocument();
  });

  it("does not warn when the project has an active offer", async () => {
    stubFetchSequence([{ body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) }]);
    renderGenerate();

    await screen.findByRole("heading", { name: "Agenda e geração" });
    expect(screen.queryByText("Nenhum assunto/oferta cadastrado para este projeto.")).not.toBeInTheDocument();
  });

  it("blocks submission when no format is checked", async () => {
    stubFetchSequence([{ body: projectState() }]);
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
    const generateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    const body = JSON.parse(generateCall[1].body as string);
    expect(body.formats.map((f: { channel: string }) => f.channel)).toEqual(["facebook_feed"]);
  });

  it("generates content through the real endpoint and navigates to the calendar", async () => {
    stubFetchSequence([
      { body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) },
      { body: { batch: { items: [{ contentId: "a" }, { contentId: "b" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await screen.findByRole("heading", { name: "Agenda e geração" });
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
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
