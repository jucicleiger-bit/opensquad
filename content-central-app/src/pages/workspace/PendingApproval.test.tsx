import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    contentId: "boss-pizzaria-day-1-instagram_story-01",
    batchId: "batch-1",
    scheduledDate: "2026-07-24",
    scheduledTime: "09:00",
    channel: "instagram_story",
    formatLabel: "Story 1/1",
    status: "aguardando_aprovacao",
    image: { previewDataUrl: "data:image/svg+xml;base64,AAAA" },
    caption: { text: "Legenda aguardando aprovação" },
    publish: {},
    ...overrides,
  };
}

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

function deferredResponse(body: unknown) {
  let resolve!: () => void;
  const promise = new Promise<{ ok: boolean; text: () => Promise<string> }>((done) => {
    resolve = () => done({ ok: true, text: async () => JSON.stringify(body) });
  });
  return { promise, resolve };
}

function renderPendingApproval() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/aguardando"]}>
      <App />
    </MemoryRouter>,
  );
}

const PROJECT_STATE = {
  projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria" }],
  globalRules: {},
};

describe("PendingApproval", () => {
  it("shows a pending card with its caption and the briefing link", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);

    renderPendingApproval();

    expect(await screen.findByText("Legenda aguardando aprovação")).toBeInTheDocument();
    expect(screen.getByText("Pipeline deste criativo")).toBeInTheDocument();
    expect(screen.getByText("Sofia")).toBeInTheDocument();
    expect(screen.getByText("Dante")).toBeInTheDocument();
    expect(screen.getByText("Clara")).toBeInTheDocument();
    expect(screen.getByText("Direct response")).toBeInTheDocument();
    expect(screen.getByText("Renata")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir apresentação" })).toHaveAttribute(
      "href",
      "/api/projects/boss-pizzaria/briefing",
    );
  });

  it("renders every slide of a carousel-format pending item, with its own regenerate action per slide", async () => {
    const carouselItem = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_feed-carrossel",
      channel: "instagram_feed",
      formatLabel: "Carrossel",
      format: "carousel",
      image: undefined,
      slides: [
        {
          slideId: "slide-1",
          order: 1,
          role: "cover",
          slideText: "5 dicas de pizza",
          image: { url: "https://cdn.example.com/slide-1.png", generating: false },
          imageGenerationError: null,
        },
        {
          slideId: "slide-2",
          order: 2,
          role: "cta",
          slideText: "Peça já",
          image: { generating: true },
          imageGenerationError: null,
        },
      ],
    });
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [carouselItem] } }]);

    renderPendingApproval();

    expect(await screen.findByRole("img", { name: "5 dicas de pizza" })).toHaveAttribute("src", "https://cdn.example.com/slide-1.png");
    expect(screen.getByText("Gerando imagem...")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Regenerar esse slide" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
  });

  it("keeps polling while only a carousel item is still generating (it has no top-level image to look at)", async () => {
    const carouselItem = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_feed-carrossel",
      channel: "instagram_feed",
      formatLabel: "Carrossel",
      format: "carousel",
      image: undefined,
      caption: { text: "Carrossel em geração" },
      slides: [
        { slideId: "slide-1", order: 1, role: "cover", slideText: "Capa", image: { generating: true }, imageGenerationError: null },
      ],
    });
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [carouselItem] } }]);

    renderPendingApproval();
    await screen.findByText("Carrossel em geração");

    // Real timers on purpose: swapping in fake ones here leaks into the rest
    // of this file's tests. The poll interval is 3s, so one real tick is
    // enough to prove the keepalive predicate saw the carousel's slides.
    const callsAfterFirstLoad = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await waitFor(
      () => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterFirstLoad),
      { timeout: 8000 },
    );
  }, 15000);

  it("shows the resolved pillar as a colored pill when the topic has one", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            baseItem({
              contentTopic: {
                pillar: { id: "bastidor-sabor", name: "Bastidor & Sabor", role: "prova", color: "#c2784a" },
              },
            }),
          ],
        },
      },
    ]);

    renderPendingApproval();

    const pill = await screen.findByText("Bastidor & Sabor");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveStyle({ borderColor: "#c2784a" });
  });

  it("does not show a pillar pill when the topic has no resolved pillar", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    expect(screen.queryByText("Bastidor & Sabor")).not.toBeInTheDocument();
  });

  it("shows which creative structure was used and whether a segment product reference rode along", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            baseItem({
              creativeStructureUsed: { title: "Oferta vertical com preco", postType: "offer", shape: "vertical" },
              usedSegmentProductReference: true,
            }),
          ],
        },
      },
    ]);

    renderPendingApproval();

    expect(await screen.findByText("Estrutura: Oferta vertical com preco")).toBeInTheDocument();
    expect(screen.getByText("Referencia de produto: usada")).toBeInTheDocument();
  });

  it("does not show creative-reference pills when the fields are absent", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    expect(screen.queryByText(/^Estrutura:/)).toBeNull();
    expect(screen.queryByText("Referencia de produto: usada")).toBeNull();
  });

  it("does not show items that are already approved", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem({ status: "aprovado" })] } },
    ]);

    renderPendingApproval();

    expect(await screen.findByText("Nada aguardando aprovação")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Abrir apresentação" })).not.toBeInTheDocument();
  });

  it("approves a card through the real endpoint and removes it from the list", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { ok: true } },
      { body: { content: [] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    expect(await screen.findByText("Nada aguardando aprovação")).toBeInTheDocument();
  });

  it("keeps one approval button loading until the approval finishes", async () => {
    const item = baseItem();
    const approval = deferredResponse({ ok: true });
    let contentLoads = 0;
    const response = (body: unknown) => Promise.resolve({ ok: true, text: async () => JSON.stringify(body) });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/state") return response(PROJECT_STATE);
      if (url === "/api/projects/boss-pizzaria/content" && !init?.method) {
        contentLoads += 1;
        return response({ content: contentLoads === 1 ? [item] : [] });
      }
      if (url.endsWith("/approve")) return approval.promise;
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPendingApproval();

    await screen.findAllByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    expect(screen.getByRole("button", { name: /Aprovando/ })).toBeDisabled();
    expect(screen.queryByText("Nada aguardando aprovação")).not.toBeInTheDocument();

    await act(async () => {
      approval.resolve();
      await approval.promise;
    });

    expect(await screen.findByText("Nada aguardando aprovação")).toBeInTheDocument();
    expect(screen.getByText(/Post aprovado/)).toBeInTheDocument();
  });

  it("approves all pending items with a decreasing progress counter", async () => {
    const story = baseItem({ contentId: "boss-pizzaria-day-1-instagram_story-01", formatLabel: "Instagram Stories" });
    const status = baseItem({
      contentId: "boss-pizzaria-day-1-whatsapp_status-01",
      channel: "whatsapp_status",
      formatLabel: "WhatsApp Status",
      scheduledTime: "11:00",
    });
    const storyApproval = deferredResponse({ ok: true });
    const statusApproval = deferredResponse({ ok: true });
    let contentLoads = 0;
    const response = (body: unknown) => Promise.resolve({ ok: true, text: async () => JSON.stringify(body) });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/state") return response(PROJECT_STATE);
      if (url === "/api/projects/boss-pizzaria/content" && !init?.method) {
        contentLoads += 1;
        return response({ content: contentLoads === 1 ? [story, status] : [] });
      }
      if (url.includes("instagram_story") && url.endsWith("/approve")) return storyApproval.promise;
      if (url.includes("whatsapp_status") && url.endsWith("/approve")) return statusApproval.promise;
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPendingApproval();

    await screen.findAllByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Aprovar todos (2)" }));

    expect(screen.getByRole("button", { name: /Aprovando todos/ })).toBeDisabled();
    expect(screen.getByText("2 faltando")).toBeInTheDocument();

    await act(async () => {
      storyApproval.resolve();
      await storyApproval.promise;
    });

    await waitFor(() => {
      const approveCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/approve"));
      expect(approveCalls).toHaveLength(2);
    });
    expect(screen.getByText("1 faltando")).toBeInTheDocument();

    await act(async () => {
      statusApproval.resolve();
      await statusApproval.promise;
    });

    expect(await screen.findByText("Nada aguardando aprovação")).toBeInTheDocument();
    expect(screen.getByText(/2 post\(s\) aprovado\(s\)/)).toBeInTheDocument();
    expect(screen.getByText("0 faltando")).toBeInTheDocument();
  });

  it("deletes a card through the real endpoint after confirmation", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("");
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { deleted: true } },
      { body: { content: [] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(await screen.findByText("Nada aguardando aprovação")).toBeInTheDocument();
  });

  it("does not delete the card when the prompt is dismissed", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(screen.getByText("Legenda aguardando aprovação")).toBeInTheDocument();
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });

  it("sends the rejection reason typed into the prompt when deleting", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("preço errado no criativo");
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { deleted: true } },
      { body: { content: [] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(await screen.findByText("Nada aguardando aprovação")).toBeInTheDocument();
    const deleteCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    const body = JSON.parse(deleteCall[1].body as string);
    expect(body.reason).toBe("preço errado no criativo");
  });

  it("warns when the caption is still the unfilled draft skeleton because the AI writer returned nothing", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            baseItem({
              caption: { text: "Dia 1: Produto destaque.\nGancho: [criar chamada curta]" },
              captionGenerationError:
                "O redator de IA não retornou uma legenda (resposta vazia). O rascunho abaixo ainda não foi revisado — regenere o dia para tentar de novo.",
            }),
          ],
        },
      },
    ]);

    renderPendingApproval();

    expect(await screen.findByText(/não retornou uma legenda/)).toBeInTheDocument();
    expect(screen.getByText(/Gancho: \[criar chamada curta\]/)).toBeInTheDocument();
  });

  it("warns when the image generator failed to return a real image", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            baseItem({
              imageGenerationError: "O gerador de imagem não retornou uma URL de imagem (resposta vazia ou inválida).",
            }),
          ],
        },
      },
    ]);

    renderPendingApproval();

    expect(await screen.findByText(/Imagem: .*não retornou uma URL de imagem/)).toBeInTheDocument();
  });

  it("lets the operator edit the caption directly and save it without touching the image", async () => {
    const edited = baseItem({ caption: { text: "Legenda revisada à mão." } });
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { content: edited } },
      { body: { content: [edited] } },
    ]);

    renderPendingApproval();

    const captionField = await screen.findByLabelText("Legenda");
    expect(screen.queryByRole("button", { name: "Salvar legenda" })).not.toBeInTheDocument();

    await userEvent.clear(captionField);
    await userEvent.type(captionField, "Legenda revisada à mão.");

    await userEvent.click(screen.getByRole("button", { name: "Salvar legenda" }));

    expect(await screen.findByText("Legenda salva.")).toBeInTheDocument();
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(saveCall[0]).toContain("/caption");
    const body = JSON.parse(saveCall[1].body as string);
    expect(body.text).toBe("Legenda revisada à mão.");
    expect(body.batchId).toBe("batch-1");
  });

  it("does not show a save button when the caption text hasn't changed", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);
    renderPendingApproval();

    await screen.findByLabelText("Legenda");
    expect(screen.queryByRole("button", { name: "Salvar legenda" })).not.toBeInTheDocument();
  });

  it("discards the caption edit when 'Desfazer' is clicked", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);
    renderPendingApproval();

    const captionField = (await screen.findByLabelText("Legenda")) as HTMLTextAreaElement;
    await userEvent.type(captionField, " extra");
    expect(screen.getByRole("button", { name: "Salvar legenda" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Desfazer" }));

    expect(captionField.value).toBe("Legenda aguardando aprovação");
    expect(screen.queryByRole("button", { name: "Salvar legenda" })).not.toBeInTheDocument();
  });

  it("regenerates only the image through the real endpoint, sending the change request note", async () => {
    const regenerated = baseItem({ caption: { text: "Legenda aguardando aprovação" } });
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { content: regenerated } },
      { body: { content: [regenerated] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.type(
      screen.getByLabelText("Pedido de alteração (opcional)"),
      "deixar o preço maior",
    );
    await userEvent.click(screen.getByRole("button", { name: "Regenerar só a imagem" }));

    expect(await screen.findByText("Imagem regenerada.")).toBeInTheDocument();
    const regenerateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(regenerateCall[0]).toContain(`/content/${baseItem().contentId}/regenerate`);
    const body = JSON.parse(regenerateCall[1].body as string);
    expect(body.regenerate).toBe("creative");
    expect(body.note).toBe("deixar o preço maior");
    expect(body.batchId).toBe("batch-1");
  });

  it("regenerates only the caption through the real endpoint", async () => {
    const regenerated = baseItem({ caption: { text: "Copy final gerada pela IA." } });
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { content: regenerated } },
      { body: { content: [regenerated] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Regenerar legenda" }));

    expect(await screen.findByText("Legenda regenerada.")).toBeInTheDocument();
    const regenerateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(regenerateCall[0]).toContain(`/content/${baseItem().contentId}/regenerate`);
    const body = JSON.parse(regenerateCall[1].body as string);
    expect(body.regenerate).toBe("caption");
    expect(body.batchId).toBe("batch-1");
  });

  it("does not show \"Animar para Reels\" on a non-Reels card", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);
    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    expect(screen.queryByRole("button", { name: "Animar para Reels" })).not.toBeInTheDocument();
  });

  it("animates a Reels card into a video through the real endpoint and shows a preview afterward", async () => {
    const reels = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_reels-01",
      channel: "instagram_reels",
      formatLabel: "Instagram Reels",
    });
    const animated = { ...reels, video: { url: "/api/projects/boss-pizzaria/assets/assets/generated/reels-1.mp4", mimeType: "video/mp4" } };
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [reels] } },
      { body: { content: animated } },
      { body: { content: [animated] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Animar para Reels" }));

    expect(await screen.findByText("Vídeo gerado.")).toBeInTheDocument();
    const animateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(animateCall[0]).toContain(`/content/${reels.contentId}/animate-reels`);
    expect(JSON.parse(animateCall[1].body as string).batchId).toBe("batch-1");

    expect(screen.getByRole("button", { name: "Gerar vídeo de novo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baixar vídeo" })).toBeInTheDocument();
  });

  it("opens a bigger preview of the image and lets the user download it", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);
    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Ver maior" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    const downloadFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["fake-image-bytes"], { type: "image/svg+xml" }),
    });
    vi.stubGlobal("fetch", downloadFetch);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn().mockReturnValue("blob:fake"), revokeObjectURL: vi.fn() });
    // jsdom logs a harmless "Not implemented: navigation" error when a real
    // <a href> gets click()'d — stub it out so the download trigger doesn't
    // actually try to navigate.
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await userEvent.click(screen.getByRole("button", { name: "Baixar imagem" }));

    expect(downloadFetch).toHaveBeenCalledWith("data:image/svg+xml;base64,AAAA");
    expect(anchorClick).toHaveBeenCalled();
    anchorClick.mockRestore();

    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("groups cards that share a creative into one card with a channel tag each, and approves all of them with one click", async () => {
    const groupKey = "2026-07-24::vertical::slot0";
    const story = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_story-01",
      channel: "instagram_story",
      formatLabel: "Instagram Stories",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-facebook_story-01", "boss-pizzaria-day-1-instagram_reels-01"],
    });
    const fbStory = baseItem({
      contentId: "boss-pizzaria-day-1-facebook_story-01",
      channel: "facebook_story",
      formatLabel: "Facebook Story",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-instagram_story-01", "boss-pizzaria-day-1-instagram_reels-01"],
    });
    const reels = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_reels-01",
      channel: "instagram_reels",
      formatLabel: "Instagram Reels",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-instagram_story-01", "boss-pizzaria-day-1-facebook_story-01"],
    });

    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [story, fbStory, reels] } },
      { body: { ok: true } },
      { body: { ok: true } },
      { body: { ok: true } },
      { body: { content: [] } },
    ]);

    renderPendingApproval();

    expect(await screen.findByText("Legenda aguardando aprovação")).toBeInTheDocument();
    // Each channel tag appears twice: once in the group header, once in the
    // collapsed "adjust individually" list.
    expect(screen.getAllByText("Instagram Stories").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Facebook Story").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Instagram Reels").length).toBeGreaterThan(0);
    // Only one image/caption block rendered for the whole group.
    expect(screen.getAllByText("Legenda aguardando aprovação").length).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Aprovar (3 formatos)" }));

    expect(await screen.findByText("Nada aguardando aprovação")).toBeInTheDocument();
    const approveCalls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.slice(2, 5);
    const approvedIds = approveCalls.map(([url]) => url).sort();
    expect(approvedIds).toEqual([
      "/api/projects/boss-pizzaria/content/boss-pizzaria-day-1-facebook_story-01/approve",
      "/api/projects/boss-pizzaria/content/boss-pizzaria-day-1-instagram_reels-01/approve",
      "/api/projects/boss-pizzaria/content/boss-pizzaria-day-1-instagram_story-01/approve",
    ]);
  });

  it("starts every grouped approval request before waiting for the slowest format", async () => {
    const groupKey = "2026-07-24::vertical::slot0";
    const story = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_story-01",
      channel: "instagram_story",
      formatLabel: "Instagram Stories",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-whatsapp_status-01"],
    });
    const whatsappStatus = baseItem({
      contentId: "boss-pizzaria-day-1-whatsapp_status-01",
      channel: "whatsapp_status",
      formatLabel: "WhatsApp Status",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-instagram_story-01"],
    });
    let contentLoads = 0;
    let releaseStoryApproval = () => {};
    const response = (body: unknown) => Promise.resolve({ ok: true, text: async () => JSON.stringify(body) });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/state") return response(PROJECT_STATE);
      if (url === "/api/projects/boss-pizzaria/content" && !init?.method) {
        contentLoads += 1;
        return response({ content: contentLoads === 1 ? [story, whatsappStatus] : [] });
      }
      if (url.includes("instagram_story") && url.endsWith("/approve")) {
        return new Promise((resolve) => {
          releaseStoryApproval = () => resolve({ ok: true, text: async () => JSON.stringify({ ok: true }) });
        });
      }
      if (url.includes("whatsapp_status") && url.endsWith("/approve")) return response({ ok: true });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPendingApproval();

    expect(await screen.findByText("Legenda aguardando aprovação")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aprovar (2 formatos)" }));

    await waitFor(() => {
      const approveCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/approve"));
      expect(approveCalls).toHaveLength(2);
    });
    expect(screen.getByRole("button", { name: /Aprovando/ })).toBeDisabled();
    expect(screen.queryByText("Nada aguardando aprovação")).not.toBeInTheDocument();

    await act(async () => {
      releaseStoryApproval();
    });
    expect(await screen.findByText("Nada aguardando aprovação")).toBeInTheDocument();
  });

  it("saves an edited shared caption to every member of a creative group", async () => {
    const groupKey = "2026-07-24::feed::slot0";
    const feed = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_feed-01",
      channel: "instagram_feed",
      formatLabel: "Instagram Feed",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-facebook_feed-01"],
    });
    const fbFeed = baseItem({
      contentId: "boss-pizzaria-day-1-facebook_feed-01",
      channel: "facebook_feed",
      formatLabel: "Facebook Feed",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-instagram_feed-01"],
    });

    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [feed, fbFeed] } },
      { body: { content: {} } },
      { body: { content: {} } },
      { body: { content: [feed, fbFeed] } },
    ]);

    renderPendingApproval();

    const captionField = await screen.findByLabelText("Legenda (compartilhada entre esses formatos)");
    await userEvent.clear(captionField);
    await userEvent.type(captionField, "Legenda revisada nos dois formatos.");
    await userEvent.click(screen.getByRole("button", { name: "Salvar legenda em todos" }));

    expect(await screen.findByText("Legenda salva em todos os formatos.")).toBeInTheDocument();
    const captionCalls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.slice(2, 4);
    const captionedIds = captionCalls.map(([url]) => url).sort();
    expect(captionedIds).toEqual([
      "/api/projects/boss-pizzaria/content/boss-pizzaria-day-1-facebook_feed-01/caption",
      "/api/projects/boss-pizzaria/content/boss-pizzaria-day-1-instagram_feed-01/caption",
    ]);
  });

  it("regenerates a creative group with one note and one click instead of once per channel", async () => {
    const groupKey = "2026-07-24::vertical::slot0";
    const story = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_story-01",
      channel: "instagram_story",
      formatLabel: "Instagram Stories",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-facebook_story-01"],
    });
    const fbStory = baseItem({
      contentId: "boss-pizzaria-day-1-facebook_story-01",
      channel: "facebook_story",
      formatLabel: "Facebook Story",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-instagram_story-01"],
    });

    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [story, fbStory] } },
      { body: { items: [story, fbStory] } },
      { body: { content: [story, fbStory] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.type(
      screen.getByLabelText("Pedido de alteração (aplica no criativo dos 2 formatos de uma vez)"),
      "deixar mais vibrante",
    );
    // The group-level button is the first one — the per-channel override
    // list below (inside a collapsed <details>) has its own copies of the
    // same label.
    await userEvent.click(screen.getAllByRole("button", { name: "Regenerar só a imagem" })[0]);

    expect(await screen.findByText("Imagem regenerada em todos os formatos.")).toBeInTheDocument();
    const regenerateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(regenerateCall[0]).toContain("/content-group-regenerate");
    const body = JSON.parse(regenerateCall[1].body as string);
    expect(body.regenerate).toBe("creative");
    expect(body.note).toBe("deixar mais vibrante");
    expect([...body.contentIds].sort()).toEqual([
      "boss-pizzaria-day-1-facebook_story-01",
      "boss-pizzaria-day-1-instagram_story-01",
    ]);
  });

  it("regenerates a grouped caption without regenerating the shared image", async () => {
    const groupKey = "2026-07-24::vertical::slot0";
    const story = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_story-01",
      channel: "instagram_story",
      formatLabel: "Instagram Stories",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-whatsapp_status-01"],
    });
    const whatsappStatus = baseItem({
      contentId: "boss-pizzaria-day-1-whatsapp_status-01",
      channel: "whatsapp_status",
      formatLabel: "WhatsApp Status",
      creativeGroupKey: groupKey,
      creativeSharedWith: ["boss-pizzaria-day-1-instagram_story-01"],
    });
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [story, whatsappStatus] } },
      { body: { items: [story, whatsappStatus] } },
      { body: { content: [story, whatsappStatus] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getAllByRole("button", { name: "Regenerar legenda" })[0]);

    expect(await screen.findByText("Legenda regenerada em todos os formatos.")).toBeInTheDocument();
    const regenerateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(regenerateCall[0]).toContain("/content-group-regenerate");
    const body = JSON.parse(regenerateCall[1].body as string);
    expect(body.regenerate).toBe("caption");
    expect([...body.contentIds].sort()).toEqual([
      "boss-pizzaria-day-1-instagram_story-01",
      "boss-pizzaria-day-1-whatsapp_status-01",
    ]);
  });

  it("regenerates the whole day through the real endpoint", async () => {
    const regenerated = baseItem({ caption: { text: "Legenda aguardando aprovação" } });
    stubFetchSequence([
      { body: PROJECT_STATE },
      { body: { content: [baseItem()] } },
      { body: { content: regenerated } },
      { body: { content: [regenerated] } },
    ]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    await userEvent.click(screen.getByRole("button", { name: "Regenerar dia" }));

    expect(await screen.findByText("Dia regenerado.")).toBeInTheDocument();
    const regenerateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    const body = JSON.parse(regenerateCall[1].body as string);
    expect(body.regenerate).toBe("all");
  });
});
