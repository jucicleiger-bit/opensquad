import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningGallery } from "./LearningGallery";

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
  it("requires a structure name, post type and shape before saving a creative structure", async () => {
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
    await user.selectOptions(screen.getByLabelText("Tipo de post"), "offer");
    await user.selectOptions(screen.getByLabelText("Formato"), "vertical");
    await user.click(screen.getByText("Salvar referencia"));

    await waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      expect(calls[1][0]).toBe("/api/segment-learnings/entries");
      const payload = JSON.parse(calls[1][1].body as string);
      expect(payload.title).toBe("Oferta vertical");
      expect(payload.postType).toBe("offer");
      expect(payload.shape).toBe("vertical");
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
    expect(screen.queryByLabelText("Tipo de post")).toBeNull();
  });

  it("renders named creative structures with postType and shape pills", () => {
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
    expect(screen.getByText("Oferta")).toBeInTheDocument();
    expect(screen.getByText("Vertical (Stories/Reels)")).toBeInTheDocument();
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
});
