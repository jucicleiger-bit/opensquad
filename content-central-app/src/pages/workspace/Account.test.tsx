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
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", instagram: { handle: "@boss" }, token: null, ...overrides }],
    globalRules: {},
  };
}

function renderAccount() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/conta"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Account", () => {
  it("shows no-token state when the project has none configured", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderAccount();
    expect(await screen.findByText("Nenhum token configurado")).toBeInTheDocument();
  });

  it("shows the real token status when configured", async () => {
    const expiresAt = new Date(Date.now() + 61 * 86400000).toISOString();
    stubFetchSequence([
      { body: projectState({ token: { configured: true, masked: "••••1234", expiresAt, status: "valido" } }) },
    ]);
    renderAccount();
    expect(await screen.findByText("••••1234")).toBeInTheDocument();
    expect(screen.getByText("Expira em 61 dias")).toBeInTheDocument();
    expect(screen.getByText("Válido")).toBeInTheDocument();
  });

  it("saves a new token through the real endpoint and shows the confirmation", async () => {
    const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
    stubFetchSequence([
      { body: projectState() },
      { body: { project: { token: { configured: true, expiresAt } } } },
      { body: projectState({ token: { configured: true, masked: "••••9999", expiresAt, status: "valido" } }) },
    ]);
    renderAccount();

    await screen.findByText("Nenhum token configurado");
    await userEvent.type(screen.getByLabelText("Token Meta"), "meta-token-abc");
    await userEvent.click(screen.getByRole("button", { name: "Validar token e salvar" }));

    expect(await screen.findByText("Token validado e salvo: Expira em 90 dias.")).toBeInTheDocument();
    expect(await screen.findByText("Expira em 90 dias")).toBeInTheDocument();
  });
});

describe("WhatsApp Status (beta)", () => {
  it("shows the risk notice and a Conectar button when no instance is configured", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderAccount();
    expect(await screen.findByText("WhatsApp Status (beta)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar WhatsApp" })).toBeInTheDocument();
  });

  it("shows Reconectar / Novo QR and checks live status when the project already has an instance", async () => {
    stubFetchSequence([
      { body: projectState({ whatsapp: { configured: true, instanceName: "opensquad-boss-pizzaria", maskedApiKey: "****9999" } }) },
      { body: { connected: false, state: "close" } },
    ]);
    renderAccount();
    expect(await screen.findByRole("button", { name: "Reconectar / Novo QR" })).toBeInTheDocument();
  });

  it("shows Conectado instead of a button when the live status reports connected", async () => {
    stubFetchSequence([
      { body: projectState({ whatsapp: { configured: true, instanceName: "opensquad-boss-pizzaria", maskedApiKey: "****9999" } }) },
      { body: { connected: true, state: "open" } },
    ]);
    renderAccount();
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Conectar|Reconectar/ })).not.toBeInTheDocument();
  });

  it("connects, shows the QR code, polls status, and shows Conectado once the mock reports open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Call order: [0] initial mount /api/state (unconfigured — the mount
      // effect above is a no-op here since whatsappInfo.configured is
      // false), [1] the connect POST itself, [2] refreshProject()'s
      // /api/state re-fetch inside handleConnect, [3] the first poll tick,
      // [4] the second poll tick.
      stubFetchSequence([
        { body: projectState() },
        { body: { qrcode: "data:image/png;base64,QRDATA", project: { whatsapp: { configured: true, instanceName: "opensquad-boss-pizzaria", maskedApiKey: "****1234" } } } },
        { body: projectState({ whatsapp: { configured: true, instanceName: "opensquad-boss-pizzaria", maskedApiKey: "****1234" } }) },
        { body: { connected: false, state: "connecting" } },
        { body: { connected: true, state: "open" } },
      ]);
      renderAccount();

      await userEvent.click(await screen.findByRole("button", { name: "Conectar WhatsApp" }));
      expect(await screen.findByAltText("QR Code WhatsApp")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(3000);
      expect(screen.getByAltText("QR Code WhatsApp")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(3000);
      expect(await screen.findByText("Conectado")).toBeInTheDocument();
      expect(screen.queryByAltText("QR Code WhatsApp")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
