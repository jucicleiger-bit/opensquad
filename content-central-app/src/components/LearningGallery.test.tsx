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

describe("LearningGallery — creative template tagging", () => {
  it("shows postType and shape selects only for a creative-purpose pending image, and includes them in the save call", async () => {
    stubFetchSequence([
      { body: { imagePath: "segment/x/modelo.png", suggestedText: "modelo" } },
      { body: { entries: [] } },
    ]);
    const user = userEvent.setup();

    render(
      <LearningGallery scope="segment" groupKey="group:x" entries={[]} onEntriesChange={() => {}} splitImagePurposes />,
    );

    const file = new File(["x"], "modelo.png", { type: "image/png" });
    const creativeInput = screen.getByLabelText("Referência de estrutura de criativo") as HTMLInputElement;
    await user.upload(creativeInput, file);

    await waitFor(() => screen.getByLabelText("Tipo de post"));
    await user.selectOptions(screen.getByLabelText("Tipo de post"), "offer");
    await user.selectOptions(screen.getByLabelText("Formato"), "vertical");
    await user.click(screen.getByText("Confirmar"));

    await waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      expect(calls[1][0]).toBe("/api/segment-learnings/entries");
      const payload = JSON.parse(calls[1][1].body as string);
      expect(payload.postType).toBe("offer");
      expect(payload.shape).toBe("vertical");
    });
  });

  it("does not show postType/shape selects for a product-purpose pending image", async () => {
    stubFetchSequence([{ body: { imagePath: "segment/x/produto.png", suggestedText: "produto" } }]);
    const user = userEvent.setup();

    render(
      <LearningGallery scope="segment" groupKey="group:x" entries={[]} onEntriesChange={() => {}} splitImagePurposes />,
    );

    const file = new File(["x"], "produto.png", { type: "image/png" });
    const productInput = screen.getByLabelText("Referência de produto") as HTMLInputElement;
    await user.upload(productInput, file);

    await waitFor(() => screen.getByText("Confirmar"));
    expect(screen.queryByLabelText("Tipo de post")).toBeNull();
  });

  it("keeps Confirmar disabled for a creative-purpose pending image until both postType and shape are set", async () => {
    stubFetchSequence([{ body: { imagePath: "segment/x/modelo.png", suggestedText: "modelo" } }]);
    const user = userEvent.setup();

    render(
      <LearningGallery scope="segment" groupKey="group:x" entries={[]} onEntriesChange={() => {}} splitImagePurposes />,
    );

    const file = new File(["x"], "modelo.png", { type: "image/png" });
    const creativeInput = screen.getByLabelText("Referência de estrutura de criativo") as HTMLInputElement;
    await user.upload(creativeInput, file);

    await waitFor(() => screen.getByLabelText("Tipo de post"));
    expect(screen.getByText("Confirmar")).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Tipo de post"), "offer");
    expect(screen.getByText("Confirmar")).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Formato"), "vertical");
    expect(screen.getByText("Confirmar")).not.toBeDisabled();
  });

  it("renders postType/shape pills on an existing tagged creative entry", () => {
    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          {
            id: "1",
            bucket: "approved",
            kind: "image",
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

    expect(screen.getByText("Oferta")).toBeInTheDocument();
    expect(screen.getByText("Vertical (Stories/Reels)")).toBeInTheDocument();
  });
});
