import { render, screen } from "@testing-library/react";
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

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const TODAY = toDateKey(new Date());
const TOMORROW = toDateKey(new Date(Date.now() + 86400000));

function renderOverview() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/visao-geral"]}>
      <App />
    </MemoryRouter>,
  );
}

const PROJECT_STATE = {
  projects: [
    {
      projectId: "boss-pizzaria",
      name: "Boss Pizzaria",
      token: { configured: true, expiresAt: new Date(Date.now() + 61 * 86400000).toISOString() },
      brandXray: { status: "approved" },
      brand: { references: [{ id: "r1" }] },
      contentStrategy: { offers: [{ id: "o1" }, { id: "o2" }] },
    },
  ],
  globalRules: {},
};

function item(overrides: Record<string, unknown>) {
  return {
    contentId: "boss-pizzaria-x",
    batchId: "batch-1",
    scheduledDate: TODAY,
    scheduledTime: "09:00",
    channel: "instagram_story",
    formatLabel: "Instagram Stories",
    status: "aguardando_aprovacao",
    caption: { text: "" },
    publish: {},
    ...overrides,
  };
}

describe("Overview dashboard", () => {
  it("shows real stat counts and today's posts", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            item({ contentId: "today-1", scheduledDate: TODAY, scheduledTime: "09:00", status: "aguardando_aprovacao" }),
            item({ contentId: "today-2", scheduledDate: TODAY, scheduledTime: "19:00", status: "aprovado" }),
            item({ contentId: "published-1", scheduledDate: TOMORROW, status: "aprovado", publish: { realPublished: true } }),
          ],
        },
      },
    ]);

    renderOverview();

    expect(await screen.findByText("Pra postar hoje")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // today count
    expect(screen.getAllByText(/09:00|19:00/).length).toBe(2);
    expect(screen.getByText("Já publicados")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is scheduled today and lists upcoming posts separately", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [item({ contentId: "future-1", scheduledDate: TOMORROW, scheduledTime: "12:00" })] } },
    ]);

    renderOverview();

    expect(await screen.findByText("Nada agendado para hoje")).toBeInTheDocument();
    expect(screen.getByText("Próximos posts programados")).toBeInTheDocument();
    expect(screen.getByText("12:00", { exact: false })).toBeInTheDocument();
  });

  it("shows a real, working checklist linking to the right sections", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [] } }]);

    renderOverview();

    const raioXLink = await screen.findByRole("link", { name: /Raio-X da marca/ });
    expect(raioXLink).toHaveTextContent("Aprovado");

    const offersLinks = screen.getAllByRole("link", { name: /Ofertas e assuntos/ });
    const offersChecklistLink = offersLinks.find((link) => link.textContent?.includes("cadastrado"));
    expect(offersChecklistLink).toHaveTextContent("2 cadastrado(s)");

    expect(screen.getByRole("link", { name: /Referências visuais/ })).toHaveTextContent("1 enviada(s)");
  });
});
