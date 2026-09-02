import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreativeStructureGallery, LearningGallery } from "./LearningGallery";

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

describe("LearningGallery - creative structure references", () => {
  it("requires a structure name and post type before saving a creative structure — Formato stays optional", async () => {
    stubFetchSequence([
      { body: { imagePath: "segment/x/modelo.png", suggestedText: "modelo" } },
      { body: { entries: [] } },
    ]);
    const user = userEvent.setup();

    render(
      <LearningGallery scope="segment" groupKey="group:x" entries={[]} onEntriesChange={() => {}} splitImagePurposes />,
    );

    const file = new File(["x"], "modelo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Nova estrutura de criativo"), file);

    await waitFor(() => screen.getByLabelText("Nome da estrutura"));
    expect(screen.getByText("Salvar referencia")).toBeDisabled();

    await user.type(screen.getByLabelText("Nome da estrutura"), "Oferta vertical");
    expect(screen.getByText("Salvar referencia")).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Modelo do post"), "rodizio");
    expect(screen.getByText("Salvar referencia")).toBeEnabled();

    await user.click(screen.getByText("Salvar referencia"));

    await waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      expect(calls[1][0]).toBe("/api/segment-learnings/entries");
      const payload = JSON.parse(calls[1][1].body as string);
      expect(payload.title).toBe("Oferta vertical");
      expect(payload.postType).toBe("rodizio");
      expect(payload.shape).toBe("");
      expect(payload.purpose).toBe("creative");
    });
  });

  it("does not show postType/shape selects for a product-purpose pending image", async () => {
    stubFetchSequence([{ body: { imagePath: "segment/x/produto.png", suggestedText: "produto" } }]);
    const user = userEvent.setup();

    render(
      <LearningGallery scope="segment" groupKey="group:x" entries={[]} onEntriesChange={() => {}} splitImagePurposes />,
    );

    const file = new File(["x"], "produto.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Nova referencia de produto"), file);

    await waitFor(() => screen.getByText("Salvar referencia"));
    expect(screen.queryByLabelText("Modelo do post")).toBeNull();
  });

  it("renders a named creative structure's card with photo, name, and postType/shape pills — no description on the card face", () => {
    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          {
            id: "1",
            bucket: "approved",
            kind: "image",
            title: "Oferta vertical",
            text: "modelo aprovado",
            imagePath: "segment/x/modelo.png",
            purpose: "creative",
            postType: "offer",
            shape: "vertical",
            source: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    expect(screen.getByText("Oferta vertical")).toBeInTheDocument();
    expect(screen.getByAltText("Oferta vertical")).toHaveAttribute("src", "/api/learning-assets/segment/x/modelo.png");
    expect(screen.getByText("Oferta direta")).toBeInTheDocument();
    expect(screen.getByText("Vertical (Stories/Reels)")).toBeInTheDocument();
    expect(screen.queryByText("modelo aprovado")).toBeNull();
  });

  it("shows a 'Vertical + Feed' pill on the card face instead of no pill when a structure's Formato is left blank", () => {
    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          { id: "1", bucket: "approved", kind: "image", title: "Serve pros dois", text: "modelo", imagePath: "segment/x/a.png", purpose: "creative", postType: "offer", shape: undefined, source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    expect(screen.getByText("Vertical + Feed")).toBeInTheDocument();
  });

  it("opens an edit popup with all fields when Editar is clicked, pre-filled from the structure", async () => {
    const user = userEvent.setup();

    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          {
            id: "1",
            bucket: "approved",
            kind: "image",
            title: "Oferta vertical",
            text: "modelo aprovado",
            imagePath: "segment/x/modelo.png",
            purpose: "creative",
            postType: "offer",
            shape: "vertical",
            source: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByText("Editar"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Nome da estrutura")).toHaveValue("Oferta vertical");
    expect(screen.getByLabelText("Modelo do post")).toHaveValue("offer");
    expect(screen.getByLabelText("Formato")).toHaveValue("vertical");
    expect(screen.getByLabelText("Descrição da estrutura")).toHaveValue("modelo aprovado");

    await user.click(screen.getByText("Cancelar"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lays out multiple creative structures as a grid, not a single-column stack", () => {
    const { container } = render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          { id: "1", bucket: "approved", kind: "image", title: "Oferta vertical", text: "modelo 1", imagePath: "segment/x/a.png", purpose: "creative", postType: "offer", shape: "vertical", source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "2", bucket: "approved", kind: "image", title: "Institucional", text: "modelo 2", imagePath: "segment/x/b.png", purpose: "creative", postType: "institutional", shape: "feed", source: "manual", createdAt: "2026-01-02T00:00:00.000Z" },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    const grid = container.querySelector('[style*="grid-template-columns"]');
    expect(grid).not.toBeNull();
    expect(grid?.children).toHaveLength(2);
  });

  it("updates an existing creative structure instead of creating a second one", async () => {
    stubFetchSequence([{ body: { entries: [] } }]);
    const user = userEvent.setup();

    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          {
            id: "1",
            bucket: "approved",
            kind: "image",
            title: "Oferta antiga",
            text: "modelo aprovado",
            imagePath: "segment/x/modelo.png",
            purpose: "creative",
            postType: "offer",
            shape: "vertical",
            source: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    await user.click(screen.getByText("Editar"));
    await user.clear(screen.getByLabelText("Nome da estrutura"));
    await user.type(screen.getByLabelText("Nome da estrutura"), "Oferta premium");
    await user.click(screen.getByText("Salvar edição"));

    await waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      const payload = JSON.parse(calls[0][1].body as string);
      expect(payload.entryId).toBe("1");
      expect(payload.title).toBe("Oferta premium");
      expect(payload.purpose).toBe("creative");
    });
  });

  it("seeds the edit form's title field with the raw (possibly empty) title, not the 'Estrutura sem nome' display fallback", async () => {
    const user = userEvent.setup();

    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          {
            id: "1",
            bucket: "approved",
            kind: "image",
            title: "",
            text: "",
            imagePath: "segment/x/modelo.png",
            purpose: "creative",
            postType: "offer",
            shape: "vertical",
            source: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    expect(screen.getByText("Estrutura sem nome")).toBeInTheDocument();
    await user.click(screen.getByText("Editar"));
    expect(screen.getByLabelText("Nome da estrutura")).toHaveValue("");
  });

  it("hides the product-reference section when showProductReferences is false", () => {
    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[]}
        onEntriesChange={() => {}}
        splitImagePurposes
        showProductReferences={false}
      />,
    );

    expect(screen.queryByText("Referencias de produto")).toBeNull();
  });

  it("asks for confirmation before deleting a creative structure, and does nothing when the operator cancels", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onEntriesChange = vi.fn();
    const user = userEvent.setup();

    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          { id: "1", bucket: "approved", kind: "image", title: "Oferta vertical", text: "modelo", imagePath: "segment/x/a.png", purpose: "creative", postType: "offer", shape: "vertical", source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
        ]}
        onEntriesChange={onEntriesChange}
        splitImagePurposes
      />,
    );

    await user.click(screen.getByText("Apagar"));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onEntriesChange).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("deletes a creative structure once the operator confirms", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([{ body: { entries: [] } }]);
    const user = userEvent.setup();

    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          { id: "1", bucket: "approved", kind: "image", title: "Oferta vertical", text: "modelo", imagePath: "segment/x/a.png", purpose: "creative", postType: "offer", shape: "vertical", source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    await user.click(screen.getByText("Apagar"));

    await waitFor(() => {
      expect((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][0]).toBe("/api/segment-learnings/entries-delete");
    });
  });

  it("opens the edit popup with Formato left on 'Selecione' for a structure that has no shape set (applies to both)", async () => {
    const user = userEvent.setup();

    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          { id: "1", bucket: "approved", kind: "image", title: "Serve pros dois", text: "modelo", imagePath: "segment/x/a.png", purpose: "creative", postType: "offer", shape: undefined, source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    await user.click(screen.getByText("Editar"));
    expect(screen.getByLabelText("Formato")).toHaveValue("");
  });

  it("suppresses the section heading when showHeading is false, for a composing gallery that already renders its own outer heading", () => {
    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[]}
        onEntriesChange={() => {}}
        splitImagePurposes
        showHeading={false}
      />,
    );

    expect(screen.queryByText("Estruturas de criativo")).toBeNull();
    expect(screen.queryByText("Referencias de produto")).toBeNull();
  });

  it("still shows Aprovado/Evitar buckets and the general text field on a per-node card even when the product-reference section is hidden", () => {
    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          { id: "t1", bucket: "approved", kind: "text", text: "nota geral", source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
        showCreativeStructures={false}
        showProductReferences={false}
      />,
    );

    expect(screen.getByText("nota geral")).toBeInTheDocument();
    expect(screen.getByLabelText("Novo aprendizado em texto")).toBeInTheDocument();
  });

  it("imports selected ready structures from another segment node into the currently selected node", async () => {
    stubFetchSequence([
      {
        body: {
          sources: [
            {
              path: "group:alimenticio/category:pizzaria",
              label: "Alimenticio / Pizzaria",
              count: 2,
              entries: [
                {
                  id: "source-1",
                  bucket: "approved",
                  kind: "image",
                  title: "Oferta vertical",
                  text: "modelo 1",
                  imagePath: "segment/source/oferta.png",
                  purpose: "creative",
                  postType: "offer",
                  shape: "vertical",
                  source: "manual",
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
                {
                  id: "source-2",
                  bucket: "approved",
                  kind: "image",
                  title: "Institucional feed",
                  text: "modelo 2",
                  imagePath: "segment/source/institucional.png",
                  purpose: "creative",
                  postType: "institutional",
                  shape: "feed",
                  source: "manual",
                  createdAt: "2026-01-02T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      },
      {
        body: {
          entries: [
            {
              id: "imported-1",
              bucket: "approved",
              kind: "image",
              title: "Oferta vertical",
              text: "modelo 1",
              imagePath: "segment/source/oferta.png",
              purpose: "creative",
              postType: "offer",
              shape: "vertical",
              source: "manual",
              createdAt: "2026-01-03T00:00:00.000Z",
            },
          ],
          importedCount: 1,
          skippedCount: 0,
        },
      },
    ]);
    const user = userEvent.setup();
    const onNodeEntriesChange = vi.fn();

    render(
      <CreativeStructureGallery
        scope="segment"
        nodes={[
          { path: "group:negocios-locais-e-lojas", label: "Negocios locais e lojas", level: "setor", entries: [] },
          { path: "group:negocios-locais-e-lojas/category:casa-de-frios", label: "Negocios locais e lojas / Casa de Frios", level: "nicho", entries: [] },
        ]}
        onNodeEntriesChange={onNodeEntriesChange}
      />,
    );

    await user.click(screen.getByText("Importar estruturas prontas"));

    expect(await screen.findByLabelText("Nicho de origem")).toHaveValue("group:alimenticio/category:pizzaria");
    expect(screen.getByLabelText(/Oferta vertical/)).toBeChecked();
    expect(screen.getByLabelText(/Institucional feed/)).toBeChecked();

    await user.click(screen.getByLabelText(/Institucional feed/));
    await user.click(screen.getByText("Importar selecionadas"));

    await waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      expect(calls[0][0]).toBe("/api/segment-learnings/creative-structure-sources");
      expect(calls[1][0]).toBe("/api/segment-learnings/import-creative-structures");
      expect(JSON.parse(calls[1][1].body as string)).toEqual({
        sourceGroupKey: "group:alimenticio/category:pizzaria",
        targetGroupKey: "group:negocios-locais-e-lojas/category:casa-de-frios",
        entryIds: ["source-1"],
      });
      expect(onNodeEntriesChange).toHaveBeenCalledWith(
        "group:negocios-locais-e-lojas/category:casa-de-frios",
        expect.arrayContaining([expect.objectContaining({ id: "imported-1" })]),
      );
    });

    expect(screen.getByText("1 importada(s), 0 duplicada(s) ignorada(s).")).toBeInTheDocument();
  });
});
