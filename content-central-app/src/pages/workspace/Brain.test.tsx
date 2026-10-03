import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

const state = {
  projects: [{ projectId: "loja", name: "Loja", contentStrategy: { offers: [] } }],
  globalRules: {},
};

const STORY = { channel: "instagram_story", label: "Story", postsPerDay: 1, everyDays: 1, startTime: "09:00", intervalMinutes: 0 };

function brain(overrides: Record<string, unknown> = {}) {
  return {
    chat: { sessionId: "s1", messages: [{ role: "assistant", text: "Montei a semana.", at: "2026-10-03T12:00:00Z" }] },
    plan: null,
    proposals: [],
    notebook: "Sorteio às sextas.",
    ...overrides,
  };
}

const PLAN = {
  startDate: "2026-10-05",
  days: 1,
  formats: [STORY],
  updatedAt: "2026-10-03T12:00:00Z",
  plan: {
    projectId: "loja",
    startDate: "2026-10-05",
    days: 1,
    dayPlans: [
      {
        dayNumber: 1,
        date: "2026-10-05",
        regular: [{ id: "2026-10-05-instagram_story-01", date: "2026-10-05", scheduledTime: "09:00", channel: "instagram_story", channelLabel: "Story", label: "Venda — Arroz", offerIds: ["arroz"] }],
        extras: [],
      },
    ],
  },
};

// Routes each request by URL so the order the page fires them doesn't matter.
function stubApi(handlers: Record<string, (init?: RequestInit) => unknown>) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const key = Object.keys(handlers).find((pattern) => url.includes(pattern));
    const body = key ? handlers[key](init) : state;
    if (body instanceof Promise) return body;
    return Promise.resolve({ ok: true, text: async () => JSON.stringify(body) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderBrain() {
  render(
    <MemoryRouter initialEntries={["/projects/loja/cerebro"]}>
      <App />
    </MemoryRouter>,
  );
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, fragment: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment));
}

describe("Brain", () => {
  it("shows the conversation and the notebook, and sends a message", async () => {
    let sent = false;
    const fetchMock = stubApi({
      "/brain/messages": () => {
        sent = true;
        return { chat: { sessionId: "s1", messages: [] } };
      },
      "/brain": () => (sent
        ? brain({ chat: { sessionId: "s1", messages: [{ role: "user", text: "monta a semana", at: "x" }, { role: "assistant", text: "Pronto, veja o plano.", at: "y" }] } })
        : brain()),
    });
    renderBrain();

    expect(await screen.findByText("Montei a semana.")).toBeInTheDocument();
    expect(screen.getByLabelText("Caderno do cliente")).toHaveValue("Sorteio às sextas.");

    await userEvent.type(screen.getByLabelText("Mensagem para o cérebro"), "monta a semana");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("Pronto, veja o plano.")).toBeInTheDocument();
    const [, init] = callsTo(fetchMock, "/brain/messages")[0];
    expect(JSON.parse(init.body as string)).toEqual({ text: "monta a semana" });
  });

  it("shows a pending proposal as before → after and applies it", async () => {
    const proposal = {
      id: "p1",
      summary: "Separar por setor",
      status: "pending",
      createdAt: "x",
      changes: [{ kind: "offer", offerId: "arroz", field: "sector", before: "", after: "Mercearia" }],
    };
    const fetchMock = stubApi({
      "/proposals/p1/apply": () => ({ proposal: { ...proposal, status: "applied" } }),
      "/brain": () => brain({ proposals: [proposal] }),
    });
    renderBrain();

    expect(await screen.findByText("Separar por setor")).toBeInTheDocument();
    expect(screen.getByText(/setor: \(vazio\) → Mercearia/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(callsTo(fetchMock, "/proposals/p1/apply")).toHaveLength(1));
  });

  it("approves the plan by sending it to the existing generation", async () => {
    const fetchMock = stubApi({
      "/generate": () => ({ batch: { items: [] } }),
      "/brain": () => brain({ plan: PLAN }),
    });
    renderBrain();

    expect(await screen.findByText("Venda — Arroz")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aprovar e gerar" }));

    await waitFor(() => expect(callsTo(fetchMock, "/generate")).toHaveLength(1));
    const [, init] = callsTo(fetchMock, "/generate")[0];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ days: "1", startDate: "2026-10-05", formats: [STORY] });
    expect(body.approvedPlan.dayPlans[0].regular[0].offerIds).toEqual(["arroz"]);
    expect(await screen.findByText(/Geração iniciada/)).toBeInTheDocument();
  });

  it("disables sending while the cérebro is thinking", async () => {
    stubApi({
      "/brain/messages": () => new Promise(() => {}),
      "/brain": () => brain(),
    });
    renderBrain();

    await screen.findByText("Montei a semana.");
    await userEvent.type(screen.getByLabelText("Mensagem para o cérebro"), "oi");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByRole("button", { name: "Pensando…" })).toBeDisabled();
  });
});
