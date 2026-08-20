import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialPropostas } from "./ComercialPropostas";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, text: async () => JSON.stringify(body) }),
  );
}

describe("ComercialPropostas", () => {
  it("lists saved proposals with their categories and date, linking into each", async () => {
    stubFetch({
      proposals: [{ id: "prop-1", clientName: "Arthur Frios", categories: ["Criação de Conteúdo", "Tráfego Pago"], createdAt: "2026-08-19T12:00:00.000Z" }],
    });
    render(
      <MemoryRouter>
        <ComercialPropostas />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Arthur Frios")).toBeInTheDocument();
    expect(screen.getByText("Criação de Conteúdo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Arthur Frios/ })).toHaveAttribute("href", "/comercial/propostas/prop-1");
  });

  it("shows an empty state with no proposals, with a link to create the first one", async () => {
    stubFetch({ proposals: [] });
    render(
      <MemoryRouter>
        <ComercialPropostas />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Nenhuma proposta ainda")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Nova proposta" })).toHaveAttribute("href", "/comercial/propostas/nova");
  });
});
