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
      return Promise.resolve({ ok: response.ok !== false, text: async () => JSON.stringify(response.body) });
    }),
  );
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/aprendizado-tipo-oferta"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("AprendizadoTipoOferta", () => {
  it("shows and edits the per-offer-type base instruction and learning gallery", async () => {
    stubFetchSequence([
      {
        body: {
          types: [
            { type: "combo", baseInstruction: "Combo: foco no produto, CTA de delivery claro.", hasOverride: false, entries: [] },
            { type: "offer", baseInstruction: "Criar post de Oferta direta.", hasOverride: false, entries: [] },
          ],
        },
      },
      { body: { type: "combo", baseInstruction: "Combo: sempre mostrar a caixa fechada e aberta lado a lado." } },
    ]);
    renderPage();

    expect(await screen.findByDisplayValue("Combo: foco no produto, CTA de delivery claro.")).toBeInTheDocument();

    const instructionField = screen.getByDisplayValue("Combo: foco no produto, CTA de delivery claro.");
    await userEvent.clear(instructionField);
    await userEvent.type(instructionField, "Combo: sempre mostrar a caixa fechada e aberta lado a lado.");
    await userEvent.click(screen.getAllByRole("button", { name: "Salvar" })[0]);

    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(call[0]).toBe("/api/offer-type-learnings");
    expect(JSON.parse(call[1].body as string).type).toBe("combo");
  });

  it("shows an error pill instead of a silently empty page when loading the per-offer-type learning fails", async () => {
    stubFetchSequence([{ body: { error: "Falha ao carregar aprendizados" }, ok: false }]);
    renderPage();

    expect(await screen.findByText("Falha ao carregar aprendizados")).toBeInTheDocument();
  });
});
