import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialPortfolio } from "./ComercialPortfolio";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, text: async () => JSON.stringify(body) }),
  );
}

function stubFetchSequence(responses: Array<{ body: unknown; ok?: boolean }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve({ ok: response.ok !== false, text: async () => JSON.stringify(response.body) });
    }),
  );
}

const PORTFOLIO_ITEM = { id: "port-1", category: "Criação de Conteúdo", caption: "Post de lançamento", imagePath: "portfolio-port-1.png", createdAt: "2026-08-20T00:00:00.000Z" };

describe("ComercialPortfolio", () => {
  it("renders portfolio items grouped by category", async () => {
    stubFetch({ items: [PORTFOLIO_ITEM] });
    render(
      <MemoryRouter>
        <ComercialPortfolio />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Criação de Conteúdo")).toBeInTheDocument();
    expect(screen.getByText("Post de lançamento")).toBeInTheDocument();
    expect(screen.getByAltText("Post de lançamento")).toHaveAttribute("src", "/api/commercial/assets/portfolio-port-1.png");
  });

  it("shows an empty state with no items", async () => {
    stubFetch({ items: [] });
    render(
      <MemoryRouter>
        <ComercialPortfolio />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Portfólio vazio")).toBeInTheDocument();
  });

  it("creates a new portfolio item through the real endpoint", async () => {
    stubFetchSequence([
      { body: { items: [] } },
      { body: { item: PORTFOLIO_ITEM } },
      { body: { items: [PORTFOLIO_ITEM] } },
    ]);
    render(
      <MemoryRouter>
        <ComercialPortfolio />
      </MemoryRouter>,
    );
    await screen.findByText("Portfólio vazio");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova arte" }));
    await userEvent.type(screen.getByLabelText("Categoria"), "Criação de Conteúdo");
    await userEvent.type(screen.getByLabelText("Legenda (opcional)"), "Post de lançamento");
    const file = new File(["fake-bytes"], "arte.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Imagem"), file);
    await userEvent.click(screen.getByRole("button", { name: "Adicionar arte" }));
    expect(await screen.findByText("Post de lançamento")).toBeInTheDocument();
  });

  it("deletes a portfolio item through the real endpoint after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([
      { body: { items: [PORTFOLIO_ITEM] } },
      { body: { id: "port-1", deleted: true } },
      { body: { items: [] } },
    ]);
    render(
      <MemoryRouter>
        <ComercialPortfolio />
      </MemoryRouter>,
    );
    await screen.findByText("Post de lançamento");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText("Portfólio vazio")).toBeInTheDocument();
  });
});
