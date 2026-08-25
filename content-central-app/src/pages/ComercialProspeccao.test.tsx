import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialProspeccao } from "./ComercialProspeccao";

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

const PROSPECT = { id: "pros-1", name: "Padaria Bom Pão", googleMapsUrl: "https://maps.google.com/x", instagram: "@padariabompao", phone: "11999990000", status: "nao_contatado", createdAt: "2026-08-24T00:00:00.000Z" };

describe("ComercialProspeccao", () => {
  it("renders prospects and the stage counts", async () => {
    stubFetch({ items: [PROSPECT] });
    render(
      <MemoryRouter>
        <ComercialProspeccao />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Padaria Bom Pão")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("shows an empty state with no prospects", async () => {
    stubFetch({ items: [] });
    render(
      <MemoryRouter>
        <ComercialProspeccao />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Nenhuma prospecção ainda")).toBeInTheDocument();
  });

  it("creates a new prospect through the real endpoint", async () => {
    stubFetchSequence([
      { body: { items: [] } },
      { body: { item: PROSPECT } },
      { body: { items: [PROSPECT] } },
    ]);
    render(
      <MemoryRouter>
        <ComercialProspeccao />
      </MemoryRouter>,
    );
    await screen.findByText("Nenhuma prospecção ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova prospecção" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Padaria Bom Pão");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar prospecção" }));
    expect(await screen.findByText("Padaria Bom Pão")).toBeInTheDocument();
  });

  it("changes the status inline through the real endpoint", async () => {
    stubFetchSequence([
      { body: { items: [PROSPECT] } },
      { body: { item: { ...PROSPECT, status: "respondeu" } } },
    ]);
    render(
      <MemoryRouter>
        <ComercialProspeccao />
      </MemoryRouter>,
    );
    await screen.findByText("Padaria Bom Pão");
    await userEvent.selectOptions(screen.getByLabelText("Status de Padaria Bom Pão"), "respondeu");
    expect(await screen.findByText("Respondeu")).toBeInTheDocument();
  });

  it("deletes a prospect through the real endpoint after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([
      { body: { items: [PROSPECT] } },
      { body: { id: "pros-1", deleted: true } },
      { body: { items: [] } },
    ]);
    render(
      <MemoryRouter>
        <ComercialProspeccao />
      </MemoryRouter>,
    );
    await screen.findByText("Padaria Bom Pão");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText("Nenhuma prospecção ainda")).toBeInTheDocument();
  });
});
