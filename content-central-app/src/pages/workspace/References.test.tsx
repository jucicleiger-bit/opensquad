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
    projects: [
      {
        projectId: "boss-pizzaria",
        name: "Boss Pizzaria",
        brand: { references: [], visualStyle: "", imageRules: [], visualSystem: {} },
        brandIdentity: {},
        ...overrides,
      },
    ],
    globalRules: {},
  };
}

function renderReferences() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/referencias"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("References", () => {
  it("saves the consolidated visual direction through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {} } },
      { body: projectState({ brand: { references: [], visualStyle: "Tons quentes, tipografia bold", imageRules: [] } }) },
    ]);
    renderReferences();

    const visualStyleField = await screen.findByLabelText("Direção visual usada nas novas imagens");
    await userEvent.type(visualStyleField, "Tons quentes, tipografia bold");
    await userEvent.click(screen.getByRole("button", { name: "Salvar direção visual" }));

    expect(await screen.findByText("Direção visual salva.")).toBeInTheDocument();
  });

  it("suggests a structured visual system and saves it only after operator review", async () => {
    stubFetchSequence([
      { body: projectState() },
      {
        body: {
          source: "structured_fallback",
          visualSystem: {
            typography: "commercial_condensed",
            titleWeight: "extra_bold",
            bodyWeight: "medium",
            priceWeight: "black",
            colorUsage: "vermelho para preço, branco para texto e fundo escuro",
            cornerStyle: "sharp",
            shadowStyle: "subtle",
          },
        },
      },
      { body: { project: {} } },
      {
        body: projectState({
          brand: {
            references: [],
            visualStyle: "",
            imageRules: [],
            visualSystem: {
              typography: "commercial_condensed",
              titleWeight: "extra_bold",
              bodyWeight: "medium",
              priceWeight: "black",
              colorUsage: "vermelho para preço, branco para texto e fundo escuro",
              cornerStyle: "sharp",
              shadowStyle: "subtle",
            },
          },
        }),
      },
    ]);
    renderReferences();

    await userEvent.click(await screen.findByRole("button", { name: "Sugerir sistema visual" }));

    expect(await screen.findByText("Sugestão aplicada. Revise e salve para usar nas próximas artes.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tipografia")).toHaveValue("commercial_condensed");
    expect(screen.getByLabelText("Cantos")).toHaveValue("sharp");
    expect(screen.getByLabelText("Sombras")).toHaveValue("subtle");

    await userEvent.click(screen.getByRole("button", { name: "Salvar sistema visual" }));

    const calls = vi.mocked(fetch).mock.calls;
    expect(String(calls[1][0])).toContain("/visual-system-suggest");
    expect(String(calls[2][0])).toContain("/image-rules");
    const payload = JSON.parse(String((calls[2][1] as RequestInit).body));
    expect(payload.visualSystem).toMatchObject({
      typography: "commercial_condensed",
      titleWeight: "extra_bold",
      bodyWeight: "medium",
      priceWeight: "black",
      cornerStyle: "sharp",
      shadowStyle: "subtle",
    });
    expect(payload.visualSystem.colorUsage).toContain("vermelho para preço");
  });

  it("researches online visual trends through the real endpoint and shows the new findings in the rules field", async () => {
    stubFetchSequence([
      { body: projectState() },
      {
        body: {
          researchedAt: "2026-07-27T12:00:00.000Z",
          findings: ["[Pesquisa online] Fundo escuro com foto do produto centralizada"],
        },
      },
      {
        body: projectState({
          brand: { references: [], visualStyle: "", imageRules: ["[Pesquisa online] Fundo escuro com foto do produto centralizada"] },
        }),
      },
    ]);
    renderReferences();

    await userEvent.click(await screen.findByRole("button", { name: "Pesquisar referências online" }));

    expect(await screen.findByText(/Pesquisa concluída/)).toBeInTheDocument();
    const rulesField = (await screen.findByLabelText("Regras técnicas extras para o ChatGPT")) as HTMLTextAreaElement;
    expect(rulesField.value).toContain("Fundo escuro com foto do produto centralizada");
  });

});
