import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComercialAgencia } from "./ComercialAgencia";

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

describe("ComercialAgencia", () => {
  it("shows saved agency data and lets you update the contact info", async () => {
    stubFetchSequence([
      { body: { agency: { name: "King Assessoria de Mkt", logoPath: "", contactPhone: "", contactInstagram: "", updatedAt: null } } },
      { body: { agency: { name: "King Assessoria de Mkt", logoPath: "", contactPhone: "(65) 99999-0000", contactInstagram: "", updatedAt: "2026-08-19T00:00:00.000Z" } } },
    ]);
    render(
      <MemoryRouter>
        <ComercialAgencia />
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue("King Assessoria de Mkt")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Telefone"), "(65) 99999-0000");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Dados da agência salvos.")).toBeInTheDocument();
  });

  it("uploads a logo through the real endpoint and shows it", async () => {
    stubFetchSequence([
      { body: { agency: { name: "", logoPath: "", contactPhone: "", contactInstagram: "", updatedAt: null } } },
      { body: { agency: { name: "", logoPath: "logo.png", contactPhone: "", contactInstagram: "", updatedAt: "2026-08-19T00:00:00.000Z" } } },
    ]);
    render(
      <MemoryRouter>
        <ComercialAgencia />
      </MemoryRouter>,
    );
    await screen.findByText("Nenhuma logo enviada ainda.");
    const file = new File(["fake-bytes"], "logo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Logo"), file);
    expect(await screen.findByAltText("Logo da agência")).toHaveAttribute("src", "/api/commercial/assets/logo.png");
  });
});
