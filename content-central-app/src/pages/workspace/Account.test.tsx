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
  it("shows the risk notice and an unconfigured state when no instance is saved", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderAccount();
    expect(await screen.findByText("WhatsApp Status (beta)")).toBeInTheDocument();
    expect(screen.getByText("Instância não configurada")).toBeInTheDocument();
  });

  it("shows the configured instance when whatsapp.configured is true", async () => {
    stubFetchSequence([
      { body: projectState({ whatsapp: { configured: true, instanceUrl: "https://evolution.example.com", instanceName: "boss-instance", maskedApiKey: "****9999" } }) },
    ]);
    renderAccount();
    expect(await screen.findByText("****9999")).toBeInTheDocument();
    expect(screen.getByText("https://evolution.example.com")).toBeInTheDocument();
  });

  it("saves a new instance through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: { whatsapp: { configured: true, instanceUrl: "https://evolution.example.com", instanceName: "boss-instance", maskedApiKey: "****abcd" } } } },
      { body: projectState({ whatsapp: { configured: true, instanceUrl: "https://evolution.example.com", instanceName: "boss-instance", maskedApiKey: "****abcd" } }) },
    ]);
    renderAccount();

    await screen.findByText("Instância não configurada");
    await userEvent.type(screen.getByLabelText("URL da instância Evolution"), "https://evolution.example.com");
    await userEvent.type(screen.getByLabelText("Nome da instância"), "boss-instance");
    await userEvent.type(screen.getByLabelText("Apikey"), "evo-secret-abcd");
    await userEvent.click(screen.getByRole("button", { name: "Salvar instância" }));

    expect(await screen.findByText("Instância WhatsApp salva.")).toBeInTheDocument();
    expect(await screen.findByText("****abcd")).toBeInTheDocument();
  });
});
