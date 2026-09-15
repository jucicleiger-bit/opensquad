import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

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

describe("ProjectWorkspaceLayout", () => {
  it("shows the section nav and redirects to the real project overview by default", async () => {
    const expiresAt = new Date(Date.now() + 61 * 86400000).toISOString();
    stubFetchSequence([
      {
        body: {
          projects: [
            {
              projectId: "boss-pizzaria",
              name: "Boss Pizzaria",
              token: { configured: true, expiresAt },
              brandXray: { status: "generated" },
            },
          ],
          globalRules: {},
        },
      },
      { body: { content: [] } },
    ]);

    render(
      <MemoryRouter initialEntries={["/projects/boss-pizzaria"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: /Token do Instagram/ })).toHaveTextContent("Expira em 61 dias");
    expect(screen.getByRole("link", { name: /Raio-X da marca/ })).toHaveTextContent("Ainda não aprovado");
    expect(screen.getAllByText("Boss Pizzaria").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Calendário" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Todos os projetos" })).toBeInTheDocument();
  });

  it("hides Empresa/Raio-X and Pilares and relabels Ofertas as Produtos for a catalog project", async () => {
    stubFetchSequence([
      {
        body: {
          projects: [
            {
              projectId: "loja-celulares",
              name: "Loja de Celulares",
              projectType: "catalog",
              token: { configured: true, expiresAt: new Date(Date.now() + 61 * 86400000).toISOString() },
            },
          ],
          globalRules: {},
        },
      },
      { body: { content: [] } },
    ]);

    render(
      <MemoryRouter initialEntries={["/projects/loja-celulares"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "Produtos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Empresa / Raio-X" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pilares" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ofertas e assuntos" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Calendário" })).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown project id", async () => {
    stubFetch({ projects: [], globalRules: {} });

    render(
      <MemoryRouter initialEntries={["/projects/does-not-exist"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Projeto não encontrado")).toBeInTheDocument();
  });
});
