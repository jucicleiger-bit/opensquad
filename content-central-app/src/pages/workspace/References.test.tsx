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

const REAL_REFERENCE = {
  id: "reference-boss-1",
  filename: "salao.jpg",
  relativePath: "assets/references/salao.jpg",
  previewUrl: "/api/projects/boss-pizzaria/assets/assets/references/salao.jpg",
  mimeType: "image/jpeg",
  role: "visual_reference",
  usageRoles: ["visual_reference"],
  weight: "medium",
  referenceCategory: "visual_inspiration",
  automaticRule: "Utilizar apenas como inspiração visual.",
  useInNextGeneration: true,
  instruction: "Seguir clima visual do salão",
};

function projectState(overrides: Record<string, unknown> = {}) {
  return {
    projects: [
      {
        projectId: "boss-pizzaria",
        name: "Boss Pizzaria",
        brand: { references: [], visualStyle: "", imageRules: [] },
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
  it("renders a real uploaded reference with its category and role pills", async () => {
    stubFetchSequence([{ body: projectState({ brand: { references: [REAL_REFERENCE] } }) }]);
    renderReferences();

    expect(await screen.findByText("salao.jpg")).toBeInTheDocument();
    expect(screen.getAllByText("Inspirações visuais").length).toBeGreaterThan(0);
    expect(screen.getByText("Seguir clima visual do salão", { exact: false })).toBeInTheDocument();
  });

  it("shows an empty state when there are no references yet", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderReferences();

    expect(await screen.findByText("Nenhuma referência enviada ainda.")).toBeInTheDocument();
  });

  it("saves the consolidated visual direction through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {} } },
      { body: projectState({ brand: { references: [], visualStyle: "Tons quentes, tipografia bold", imageRules: [] } }) },
    ]);
    renderReferences();

    const visualStyleField = await screen.findByLabelText("Resumo visual gerado/aprovado");
    await userEvent.type(visualStyleField, "Tons quentes, tipografia bold");
    await userEvent.click(screen.getByRole("button", { name: "Salvar direção visual consolidada" }));

    expect(await screen.findByText("Direção visual salva.")).toBeInTheDocument();
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

  it("deletes a reference through the real endpoint after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([
      { body: projectState({ brand: { references: [REAL_REFERENCE] } }) },
      { body: { deleted: true } },
      { body: projectState() },
    ]);
    renderReferences();

    await screen.findByText("salao.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Apagar referência" }));

    expect(await screen.findByText("Nenhuma referência enviada ainda.")).toBeInTheDocument();
  });

  it("edits a reference's metadata through the real endpoint without re-uploading the file", async () => {
    const updated = { ...REAL_REFERENCE, referenceCategory: "real_product", instruction: "Preservar o prato real" };
    stubFetchSequence([
      { body: projectState({ brand: { references: [REAL_REFERENCE] } }) },
      { body: { project: {}, reference: updated } },
      { body: projectState({ brand: { references: [updated] } }) },
    ]);
    renderReferences();

    await screen.findByText("salao.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    const instructionFields = screen.getAllByLabelText("Observação curta") as HTMLInputElement[];
    const instructionField = instructionFields[instructionFields.length - 1];
    expect(instructionField.value).toBe("Seguir clima visual do salão");
    await userEvent.clear(instructionField);
    await userEvent.type(instructionField, "Preservar o prato real");

    const roleCheckboxes = screen.getAllByRole("checkbox", { name: "Produto/foto" });
    const roleCheckbox = roleCheckboxes[roleCheckboxes.length - 1];
    expect(roleCheckbox).not.toBeChecked();
    await userEvent.click(roleCheckbox);

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(saveCall[0]).toContain("/references-update");
    const body = JSON.parse(saveCall[1].body as string);
    expect(body.relativePath).toBe(REAL_REFERENCE.relativePath);
    expect(body.instruction).toBe("Preservar o prato real");
    expect(body.usageRoles).toEqual(["visual_reference", "product_photo"]);
  });
});
