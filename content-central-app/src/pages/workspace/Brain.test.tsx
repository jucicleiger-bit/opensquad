import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

const state = {
  projects: [{ projectId: "loja", name: "Loja", contentStrategy: { offers: [{ id: "arroz", name: "Arroz", type: "offer" }] } }],
  globalRules: {},
};

const STORY = { channel: "instagram_story", label: "Instagram Stories", postsPerDay: 1, everyDays: 1, startTime: "09:00", intervalMinutes: 0 };

function brain(overrides: Record<string, unknown> = {}) {
  return {
    chat: { sessionId: "s1", messages: [{ role: "assistant", text: "Montei a semana.", at: "2026-10-03T12:00:00Z" }] },
    plan: null,
    proposals: [],
    notebook: "Sorteio às sextas.",
    ...overrides,
  };
}

// Far in the future, so the "start date already passed" guard never trips
// whatever day the suite runs.
function plan(overrides: Record<string, unknown> = {}, extras: unknown[] = []) {
  return {
    startDate: "2999-10-05",
    days: 1,
    formats: [STORY],
    approvedAt: null,
    updatedAt: "2026-10-03T12:00:00Z",
    plan: {
      projectId: "loja",
      startDate: "2999-10-05",
      days: 1,
      extraCount: extras.length,
      dayPlans: [
        {
          dayNumber: 1,
          date: "2999-10-05",
          regular: [{ id: "2999-10-05-instagram_story-01", date: "2999-10-05", scheduledTime: "09:00", channel: "instagram_story", channelLabel: "Instagram Stories", label: "Venda — Arroz", offerIds: ["arroz"] }],
          extras,
        },
      ],
    },
    ...overrides,
  };
}

type Handler = (init?: RequestInit) => unknown;

// Routes each request by URL so the order the page fires them doesn't
// matter. A handler returning { __error } answers as a failed request; one
// returning a Promise keeps the request pending.
function stubApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const key = Object.keys(handlers).find((pattern) => url.includes(pattern));
    const body = key ? handlers[key](init) : state;
    if (body instanceof Promise) return body;
    const failed = Boolean(body && typeof body === "object" && "__error" in body);
    return Promise.resolve({
      ok: !failed,
      text: async () => JSON.stringify(failed ? { error: (body as { __error: string }).__error } : body),
    });
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
  it("shows one line per art, naming every channel it goes to", async () => {
    const slot = (channel: string, scheduledTime: string, label: string) => ({ id: `2999-10-05-${channel}-${scheduledTime}`, date: "2999-10-05", scheduledTime, channel, channelLabel: channel, label });
    const stored = plan();
    stored.plan.dayPlans[0].regular = [
      slot("instagram_story", "17:00", "Post de marca"),
      slot("instagram_story", "13:00", "Venda — Café"),
      slot("facebook_story", "13:00", "Venda — Café"),
      slot("whatsapp_status", "13:00", "Venda — Café"),
      slot("instagram_feed", "18:00", "Venda — Omo"),
      slot("facebook_feed", "18:00", "Venda — Omo"),
    ] as never;
    stubApi({ "/brain": () => brain({ plan: stored }) });
    renderBrain();

    expect(await screen.findByText("Story · Instagram, Facebook, WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Story · Instagram")).toBeInTheDocument();
    expect(screen.getByText("Feed · Instagram, Facebook")).toBeInTheDocument();
    // In time order, whatever order the channels came in.
    expect(screen.getAllByText(/^\d\d:\d\d$/).map((node) => node.textContent)).toEqual(["13:00", "17:00", "18:00"]);
    expect(screen.getAllByText("Venda — Café")).toHaveLength(1);
    expect(screen.getByText("2 stories · 1 feed na semana")).toBeInTheDocument();
  });

  it("shows the cérebro's answer formatted, not as raw asterisks and table pipes", async () => {
    const text = "**Atenção:** o Treto está sem preço.\n\n| Dia | Story 13h |\n|---|---|\n| Seg 05 | Café |\n\n**Falta você:**\n1. Cadastrar o preço.\n2. Aprovar.";
    stubApi({ "/brain": () => brain({ chat: { sessionId: "s1", messages: [{ role: "assistant", text, at: "x" }] } }) });
    renderBrain();

    expect(await screen.findByText("Atenção:")).toContainHTML("Atenção:");
    expect(screen.getByText("Atenção:").tagName).toBe("STRONG");
    expect(screen.getByText("Seg 05 · Café")).toBeInTheDocument();
    expect(screen.queryByText(/\|---/)).not.toBeInTheDocument();
    expect(screen.getByText("Cadastrar o preço.").tagName).toBe("LI");
  });

  it("shows the plan warnings before the approve button", async () => {
    const stored = plan();
    (stored.plan as Record<string, unknown>).warnings = ["Treto chocolate está sem preço no post de 2999-10-05 às 09:00."];
    stubApi({ "/brain": () => brain({ plan: stored }) });
    renderBrain();

    expect(await screen.findByText("Treto chocolate está sem preço no post de 2999-10-05 às 09:00.")).toBeInTheDocument();
  });

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

  it("shows the message right away and disables sending while the cérebro is thinking", async () => {
    stubApi({
      "/brain/messages": () => new Promise(() => {}),
      "/brain": () => brain(),
    });
    renderBrain();

    await screen.findByText("Montei a semana.");
    await userEvent.type(screen.getByLabelText("Mensagem para o cérebro"), "oi");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByRole("button", { name: "Pensando…" })).toBeDisabled();
    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem para o cérebro")).toHaveValue("");
  });

  it("keeps thinking when opened mid-turn and shows the answer when it lands", async () => {
    let loads = 0;
    stubApi({
      "/brain": () => {
        loads += 1;
        if (loads < 2) return brain({ thinking: true });
        return brain({ chat: { sessionId: "s1", messages: [{ role: "assistant", text: "Resposta que chegou depois.", at: "2026-10-03T12:00:00Z" }] } });
      },
    });
    renderBrain();

    expect(await screen.findByRole("button", { name: "Pensando…" })).toBeDisabled();
    expect(await screen.findByText("Resposta que chegou depois.", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  }, 10000);

  it("shows why a message was not taken and gives the text back", async () => {
    stubApi({
      "/brain/messages": () => ({ __error: "O cérebro ainda está respondendo." }),
      "/brain": () => brain(),
    });
    renderBrain();

    await screen.findByText("Montei a semana.");
    await userEvent.type(screen.getByLabelText("Mensagem para o cérebro"), "de novo");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("O cérebro ainda está respondendo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem para o cérebro")).toHaveValue("de novo");
  });

  it("shows a pending proposal as before → after and applies it", async () => {
    const proposal = {
      id: "p1",
      summary: "Separar por setor",
      status: "pending",
      createdAt: "x",
      changes: [
        { kind: "offer", offerId: "arroz", field: "sector", before: "", after: "Mercearia" },
        { kind: "goalWeights", before: { sales: 85, authority: 15 }, after: { sales: 70, authority: 30 } },
      ],
    };
    const fetchMock = stubApi({
      "/proposals/p1/apply": () => ({ proposal: { ...proposal, status: "applied", results: [{ index: 0, ok: true }] } }),
      "/brain": () => brain({ proposals: [proposal] }),
    });
    renderBrain();

    expect(await screen.findByText("Separar por setor")).toBeInTheDocument();
    expect(screen.getByText("Arroz — setor: (vazio) → Mercearia")).toBeInTheDocument();
    expect(screen.getByText(/Venda \(ofertas\) 85%, Gerar autoridade 15% → Venda \(ofertas\) 70%, Gerar autoridade 30%/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(callsTo(fetchMock, "/proposals/p1/apply")).toHaveLength(1));
  });

  it("approves the plan by sending it to the existing generation and marks it approved", async () => {
    let approved = false;
    const fetchMock = stubApi({
      "/brain/plan/approved": () => {
        approved = true;
        return plan({ approvedAt: "2026-10-04T10:00:00Z" });
      },
      "/generate": () => ({ batch: { items: [] } }),
      "/brain": () => brain({ plan: approved ? plan({ approvedAt: "2026-10-04T10:00:00Z" }) : plan() }),
    });
    renderBrain();

    expect(await screen.findByText("Venda — Arroz")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aprovar e gerar" }));

    expect(await screen.findByText(/Geração iniciada/)).toBeInTheDocument();
    const [, init] = callsTo(fetchMock, "/generate")[0];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ days: "1", startDate: "2999-10-05", formats: [STORY] });
    expect(body.approvedPlan.dayPlans[0].regular[0].offerIds).toEqual(["arroz"]);
    expect(callsTo(fetchMock, "/brain/plan/approved")).toHaveLength(1);
    expect(await screen.findByText(/Aprovado em 04\/10/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar e gerar" })).toBeDisabled();
  });

  it("also generates the commemorative-date extras the plan shows", async () => {
    const extra = { id: "x1", date: "2999-10-05", scheduledTime: "09:00", channel: "instagram_story", channelLabel: "Instagram Stories", label: "Extra — Dia das Crianças", specialDateLabel: "Dia das Crianças" };
    const fetchMock = stubApi({
      "/generate-special-date": () => ({ batch: { items: [] } }),
      "/brain/plan/approved": () => plan({ approvedAt: "2026-10-04T10:00:00Z" }),
      "/generate": () => ({ batch: { items: [] } }),
      "/brain": () => brain({ plan: plan({}, [extra]) }),
    });
    renderBrain();

    await screen.findByText("Extra — Dia das Crianças");
    await userEvent.click(screen.getByRole("button", { name: "Aprovar e gerar" }));

    await waitFor(() => expect(callsTo(fetchMock, "/generate-special-date")).toHaveLength(1));
    const [, init] = callsTo(fetchMock, "/generate-special-date")[0];
    expect(JSON.parse(init.body as string)).toMatchObject({ date: "2999-10-05", label: "Dia das Crianças", channels: ["instagram_story"] });
  });

  it("won't approve a plan whose first day already passed", async () => {
    const past = plan({ startDate: "2000-01-03" });
    const fetchMock = stubApi({ "/brain": () => brain({ plan: past }) });
    renderBrain();

    expect(await screen.findByText(/que já passou/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar e gerar" })).toBeDisabled();
    expect(callsTo(fetchMock, "/generate")).toHaveLength(0);
  });
});
