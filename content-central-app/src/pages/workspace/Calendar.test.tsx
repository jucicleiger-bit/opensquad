import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

const TODAY = new Date();
const SAME_MONTH_DAY = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-15`;

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    contentId: "boss-pizzaria-day-1-instagram_feed-01",
    batchId: "batch-1",
    dayNumber: 1,
    scheduledDate: SAME_MONTH_DAY,
    scheduledTime: "09:00",
    channel: "instagram_feed",
    formatLabel: "Feed 1/1",
    status: "aprovado",
    image: { previewDataUrl: "data:image/svg+xml;base64,AAAA" },
    caption: { text: "Legenda de teste" },
    publish: { publishedAt: null, error: null },
    ...overrides,
  };
}

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

function renderProjectCalendar() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/calendario"]}>
      <App />
    </MemoryRouter>,
  );
}

const PROJECT_STATE = {
  projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", token: { daysRemaining: 61 }, brandXray: { status: "pendente" } }],
  globalRules: {},
};

describe("Calendar", () => {
  it("shows a chip for an approved scheduled item and opens its detail on click", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);

    renderProjectCalendar();

    const chip = await screen.findByRole("button", { name: /Feed/i });
    expect(screen.getByText("Selecione um post no calendário")).toBeInTheDocument();

    await userEvent.click(chip);

    expect(await screen.findByText("Legenda de teste")).toBeInTheDocument();
    expect(screen.getByText("Aprovado")).toBeInTheDocument();
    expect(screen.getByText("Pipeline deste criativo")).toBeInTheDocument();
    expect(screen.getByText("Sofia")).toBeInTheDocument();
    expect(screen.getByText("Dante")).toBeInTheDocument();
    expect(screen.getByText("Clara")).toBeInTheDocument();
    expect(screen.getByText("Renata")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeInTheDocument();
  });

  it("only shows items that are already approved, not ones still awaiting approval", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            baseItem({ contentId: "pending", status: "aguardando_aprovacao" }),
            baseItem({ contentId: "approved", status: "aprovado" }),
          ],
        },
      },
    ]);

    renderProjectCalendar();

    const chips = await screen.findAllByRole("button", { name: /Feed/i });
    expect(chips).toHaveLength(1);
  });

  it("publishes a card through the real endpoint and reflects the refreshed status", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { ok: true } },
      { body: { content: [baseItem({ publish: { realPublished: true } })] } },
    ]);

    renderProjectCalendar();

    const chip = await screen.findByRole("button", { name: /Feed/i });
    await userEvent.click(chip);

    const publishButton = await screen.findByRole("button", { name: "Publicar agora" });
    await userEvent.click(publishButton);

    expect(await screen.findByText("Publicado no Instagram.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publicar agora" })).not.toBeInTheDocument();
  });

  it("marks published calendar chips with the published color class", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem({ publish: { realPublished: true } })] } },
    ]);

    renderProjectCalendar();

    expect((await screen.findByRole("button", { name: /Feed/i })).className).toMatch(/chipPublicado/);
  });

  it("deletes a card through the real endpoint after confirmation and clears the selection", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("");
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { deleted: true } },
      { body: { content: [] } },
    ]);

    renderProjectCalendar();

    const chip = await screen.findByRole("button", { name: /Feed/i });
    await userEvent.click(chip);
    await screen.findByText("Legenda de teste");

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(await screen.findByText("Selecione um post no calendário")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Feed/i })).not.toBeInTheDocument();
  });

  it("navigates between months", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [] } }]);

    renderProjectCalendar();

    await screen.findByText("Selecione um post no calendário");
    const nextButton = screen.getByRole("button", { name: "→" });
    const label = screen.getByText(/\d{4}/);
    const before = label.textContent;

    await userEvent.click(nextButton);

    expect(label.textContent).not.toBe(before);
  });
});
