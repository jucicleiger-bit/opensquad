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
    <MemoryRouter initialEntries={["/aprendizado-segmento"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("AprendizadoSegmento", () => {
  it("lets the operator pick Setor/Nicho/Especialidade and shows that combination's panels", async () => {
    stubFetchSequence([
      {
        body: {
          nodes: [
            { path: "group:alimenticio", label: "Alimentício", level: "setor", entries: [] },
            {
              path: "group:alimenticio/category:pizzaria",
              label: "Alimentício / Pizzaria",
              level: "nicho",
              entries: [
                { id: "e1", bucket: "approved", kind: "text", text: "Esfiha tem que ser redonda", source: "manual", createdAt: "2026-08-01" },
                { id: "e2", bucket: "approved", kind: "image", imagePath: "segment/group-alimenticio/esfiha.png", text: "Esfiha redonda", source: "manual", createdAt: "2026-08-01" },
              ],
            },
          ],
        },
      },
    ]);
    renderPage();

    await userEvent.selectOptions(await screen.findByLabelText("Setor"), "Alimentício");
    await userEvent.selectOptions(screen.getByLabelText("Nicho"), "Pizzaria");
    await userEvent.click(screen.getByRole("button", { name: "Ver aprendizado" }));

    expect(await screen.findByText("Esfiha tem que ser redonda")).toBeInTheDocument();
    expect(screen.getByAltText("Esfiha redonda")).toHaveAttribute("src", "/api/learning-assets/segment/group-alimenticio/esfiha.png");
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    // URLSearchParams percent-encodes "í", so decode before asserting on the
    // literal value that was actually sent.
    expect(decodeURIComponent(call[0])).toContain("segmentGroup=Alimentício");
  });
});
