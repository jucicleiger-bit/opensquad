import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { Dashboard } from "./Dashboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      text: async () => JSON.stringify(body),
    }),
  );
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

describe("Dashboard", () => {
  it("renders a real project fetched from /api/state as a card", async () => {
    stubFetch({
      projects: [
        {
          projectId: "boss-pizzaria",
          name: "Boss Pizzaria",
          token: { configured: true, expiresAt: new Date(Date.now() + 12 * 86400000).toISOString() },
          brandXray: { status: "approved" },
        },
      ],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Boss Pizzaria")).toBeInTheDocument();
    expect(screen.getByText("boss-pizzaria")).toBeInTheDocument();
    expect(screen.getByText("Expira em 12 dias")).toBeInTheDocument();
    expect(screen.getByText("Raio-X ok")).toBeInTheDocument();
  });

  it("shows a proactive alert banner for an expiring token and links to the account page", async () => {
    stubFetch({
      projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", token: {}, brandXray: { status: "empty" } }],
      globalRules: {},
      alerts: [
        {
          type: "token_expiring",
          projectId: "boss-pizzaria",
          projectName: "Boss Pizzaria",
          message: "Token da Meta vence em 5 dia(s).",
        },
      ],
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("1 alerta precisa de atenção:")).toBeInTheDocument();
    expect(screen.getByText(/Token da Meta vence em 5 dia\(s\)\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resolver" })).toHaveAttribute("href", "/projects/boss-pizzaria/conta");
  });

  it("shows an empty state when there are no projects", async () => {
    stubFetch({ projects: [], globalRules: {} });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Nenhum projeto ainda")).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    stubFetch({ error: "Falha ao carregar" }, false);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Não foi possível carregar os projetos")).toBeInTheDocument();
    expect(screen.getByText("Falha ao carregar")).toBeInTheDocument();
  });

  it("deletes a project through the real endpoint after confirmation, without navigating into it", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([
      {
        body: {
          projects: [
            { projectId: "cliente-antigo", name: "Cliente Antigo", token: {}, brandXray: { status: "empty" } },
          ],
          globalRules: {},
        },
      },
      { body: { projectId: "cliente-antigo", deleted: true } },
    ]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Cliente Antigo");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Cliente Antigo"));
    expect(await screen.findByText("Nenhum projeto ainda")).toBeInTheDocument();

    const deleteCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(deleteCall[0]).toBe("/api/projects/cliente-antigo");
    expect(deleteCall[1].method).toBe("POST");
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    stubFetch({
      projects: [{ projectId: "cliente-antigo", name: "Cliente Antigo", token: {}, brandXray: { status: "empty" } }],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Cliente Antigo");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(screen.getByText("Cliente Antigo")).toBeInTheDocument();
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("creates a new project through the real endpoint and navigates into its workspace", async () => {
    stubFetchSequence([
      { body: { projects: [], globalRules: {} } },
      { body: { project: { projectId: "cliente-teste", name: "Cliente Teste" } } },
      {
        body: {
          projects: [{ projectId: "cliente-teste", name: "Cliente Teste", brandXray: { status: "empty", blocks: {} } }],
          globalRules: {},
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Novo projeto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Cliente Teste");
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto" }));

    expect(await screen.findByRole("heading", { name: "Cliente Teste" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Todos os projetos" })).toBeInTheDocument();
  });

  it("creates a catalog (venda direta) project by sending projectType: catalog to the real endpoint", async () => {
    stubFetchSequence([
      { body: { projects: [], globalRules: {} } },
      { body: { project: { projectId: "loja-celulares", name: "Loja de Celulares", projectType: "catalog" } } },
      {
        body: {
          projects: [{ projectId: "loja-celulares", name: "Loja de Celulares", projectType: "catalog" }],
          globalRules: {},
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Novo projeto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Loja de Celulares");
    await userEvent.selectOptions(screen.getByLabelText("Tipo de projeto"), "catalog");
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto" }));

    expect(await screen.findByRole("heading", { name: "Loja de Celulares" })).toBeInTheDocument();
    const createCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(createCall[1].body as string).projectType).toBe("catalog");
  });

  it("shows a catalog pill instead of Raio-X status for catalog projects", async () => {
    stubFetch({
      projects: [
        { projectId: "loja-celulares", name: "Loja de Celulares", token: {}, projectType: "catalog", brandXray: { status: "empty" } },
      ],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Loja de Celulares")).toBeInTheDocument();
    expect(screen.getByText("Catálogo de produtos")).toBeInTheDocument();
    expect(screen.queryByText("Raio-X pendente")).not.toBeInTheDocument();
  });
});
