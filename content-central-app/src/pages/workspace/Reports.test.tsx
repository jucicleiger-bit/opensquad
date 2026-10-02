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

const state = {
  projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", instagram: { handle: "@boss" }, token: null }],
  globalRules: {},
};

function renderReports() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/relatorios"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Reports", () => {
  it("lists each month with its state and a link to the report", async () => {
    stubFetchSequence([
      { body: state },
      {
        body: {
          months: [
            { month: "2026-10", label: "Outubro de 2026", publications: 1, status: "parcial" },
            { month: "2026-09", label: "Setembro de 2026", publications: 27, status: "pronto" },
          ],
          insightsEnabled: true,
        },
      },
    ]);
    renderReports();

    expect(await screen.findByText("Setembro de 2026")).toBeInTheDocument();
    expect(screen.getByText("27 publicações")).toBeInTheDocument();
    expect(screen.getByText("1 publicação")).toBeInTheDocument();
    expect(screen.getByText("Pronto")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Abrir relatório" });
    expect(links[1]).toHaveAttribute("href", "/api/projects/boss-pizzaria/report?month=2026-09");
    expect(links[1]).toHaveAttribute("target", "_blank");
    expect(screen.queryByText(/não tem a permissão de alcance/)).not.toBeInTheDocument();
  });

  it("warns when the token cannot read reach, and says so when there is nothing yet", async () => {
    stubFetchSequence([{ body: state }, { body: { months: [], insightsEnabled: false } }]);
    renderReports();

    expect(await screen.findByText("Nenhum relatório ainda")).toBeInTheDocument();
    expect(screen.getByText(/não tem a permissão de alcance/)).toBeInTheDocument();
  });
});
