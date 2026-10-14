import { fireEvent, render, screen } from "@testing-library/react";
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

function projectState() {
  return {
    projects: [{
      projectId: "boss-pizzaria",
      name: "Boss Pizzaria",
      contentSettings: { defaultPostTime: "18:00" },
      contentStrategy: { offers: [{ id: "pizza-calabresa", name: "Pizza Calabresa", type: "offer", items: "Borda recheada", active: true }] },
    }],
    globalRules: {},
  };
}

function renderCarousels() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/carrossel"]}>
      <App />
    </MemoryRouter>,
  );
}

const CAROUSEL_FIXTURE = {
  carouselId: "boss-pizzaria-carrossel-1",
  projectId: "boss-pizzaria",
  briefing: "5 dicas de pizza",
  format: "listicle",
  slideCount: 2,
  slides: [
    {
      slideId: "boss-pizzaria-carrossel-1-slide-1",
      order: 1,
      role: "cover",
      slideText: "5 dicas de pizza",
      image: { url: "/api/projects/boss-pizzaria/assets/assets/generated/slide1.png", generating: false },
      imageGenerationError: null,
    },
    {
      slideId: "boss-pizzaria-carrossel-1-slide-2",
      order: 2,
      role: "cta",
      slideText: "Salve esse post",
      image: { url: "/api/projects/boss-pizzaria/assets/assets/generated/slide2.png", generating: false },
      imageGenerationError: null,
    },
  ],
  outlineGenerationError: null,
  status: "ready",
  createdAt: "2026-08-26T12:00:00.000Z",
  updatedAt: "2026-08-26T12:00:00.000Z",
};

describe("Carousels", () => {
  it("shows an empty state when no carousel has been generated yet", async () => {
    stubFetchSequence([{ body: projectState() }, { body: { carousels: [] } }]);
    renderCarousels();

    expect(await screen.findByRole("heading", { name: "Carrossel" })).toBeInTheDocument();
    expect(await screen.findByText("Nenhum carrossel ainda")).toBeInTheDocument();
  });

  it("plans a new carousel with the typed briefing and slide count through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [] } },
      { body: { carousel: CAROUSEL_FIXTURE } },
      { body: { carousels: [CAROUSEL_FIXTURE] } },
    ]);
    renderCarousels();

    await screen.findByText("Nenhum carrossel ainda");
    await userEvent.type(screen.getByLabelText("O que você quer neste carrossel?"), "5 dicas de pizza");
    await userEvent.clear(screen.getByLabelText("Quantidade de folhas"));
    await userEvent.type(screen.getByLabelText("Quantidade de folhas"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Planejar" }));

    expect(await screen.findByText("5 dicas de pizza")).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const generateCall = calls.find(([url, options]) => url === "/api/projects/boss-pizzaria/carousels" && options?.method === "POST");
    expect(generateCall).toBeTruthy();
    expect(JSON.parse(generateCall![1].body as string)).toEqual({ briefing: "5 dicas de pizza", slideCount: 2 });
  });

  const PLAN_FIXTURE = {
    ...CAROUSEL_FIXTURE,
    status: "plan_ready",
    planError: null,
    planMessages: [{ text: "fala da entrega", at: "2026-10-08T12:00:00.000Z" }],
    slides: CAROUSEL_FIXTURE.slides.map((slide, index) => ({
      ...slide,
      image: { generating: false },
      slideContent: index === 1
        ? { title: "Salve esse post", body: "", highlight: "", bullets: [], visual: "motoboy entregando pizza", layout: "lista", background: "claro", bridge: "Veja como" }
        : null,
    })),
  };

  it("pulls the theme from a registered offer and sends its offerId", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [] } },
      { body: { carousel: { ...PLAN_FIXTURE, status: "planning" } } },
      { body: { carousels: [] } },
    ]);
    renderCarousels();
    await screen.findByText("Nenhum carrossel ainda");

    await userEvent.selectOptions(screen.getByLabelText("Puxar de Ofertas e assuntos"), "pizza-calabresa");
    expect(screen.getByLabelText("O que você quer neste carrossel?")).toHaveValue("Pizza Calabresa — Borda recheada");
    await userEvent.click(screen.getByRole("button", { name: "Planejar" }));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const planCall = calls.find(([url, options]) => url === "/api/projects/boss-pizzaria/carousels" && options?.method === "POST");
    expect(JSON.parse(planCall![1].body as string)).toEqual({ briefing: "Pizza Calabresa — Borda recheada", slideCount: 7, offerId: "pizza-calabresa" });
  });

  it("lists trending subjects and fills the theme with the one clicked", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [] } },
      { body: { ideas: [{ title: "5 erros ao pedir pizza", angle: "lista do que evitar" }] } },
    ]);
    renderCarousels();
    await screen.findByText("Nenhum carrossel ainda");

    await userEvent.click(screen.getByRole("button", { name: "Assuntos em alta do segmento" }));
    const idea = await screen.findByRole("button", { name: /5 erros ao pedir pizza/ });
    expect(idea).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(idea);
    expect(screen.getByLabelText("O que você quer neste carrossel?")).toHaveValue("5 erros ao pedir pizza — lista do que evitar");
    expect(idea).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the plan with the operator's messages and sends an adjustment", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [PLAN_FIXTURE] } },
      { body: { carousel: { ...PLAN_FIXTURE, status: "planning" } } },
      { body: { carousels: [{ ...PLAN_FIXTURE, status: "planning" }] } },
    ]);
    renderCarousels();

    expect(await screen.findByText("fala da entrega")).toBeInTheDocument();
    expect(screen.getByText("Salve esse post")).toBeInTheDocument();
    expect(screen.getByText("Lista em cartões, fundo claro · Imagem: motoboy entregando pizza · Rodapé: Veja como →")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("O que mudar?"), "troca a capa");
    await userEvent.click(screen.getByRole("button", { name: "Ajustar" }));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const replanCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/carousels-replan/boss-pizzaria-carrossel-1");
    expect(JSON.parse(replanCall![1].body as string)).toEqual({ message: "troca a capa" });
    expect(await screen.findByText("Planejando…")).toBeInTheDocument();
  });

  it("generates the images from the plan", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [PLAN_FIXTURE] } },
      { body: { carousel: { ...CAROUSEL_FIXTURE, status: "generating" } } },
      { body: { carousels: [CAROUSEL_FIXTURE] } },
    ]);
    renderCarousels();

    await userEvent.click(await screen.findByRole("button", { name: "Gerar imagens" }));
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls.some(([url]) => url === "/api/projects/boss-pizzaria/carousels-generate/boss-pizzaria-carrossel-1")).toBe(true);
    // The plan view also shows role labels, so check for a real slide image.
    expect(await screen.findByAltText("5 dicas de pizza")).toBeInTheDocument();
  });

  it("schedules a finished carousel with a drafted caption", async () => {
    const scheduled = { ...CAROUSEL_FIXTURE, schedules: [{ contentId: "c-1", batchId: "b-1", date: "2026-10-10", time: "18:00" }] };
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [CAROUSEL_FIXTURE] } },
      { body: { caption: "Legenda pronta" } },
      { body: { item: {}, carousel: scheduled } },
      { body: { carousels: [scheduled] } },
    ]);
    renderCarousels();

    await userEvent.click(await screen.findByRole("button", { name: "Agendar" }));
    expect(await screen.findByDisplayValue("Legenda pronta")).toBeInTheDocument();
    expect(screen.getByLabelText("Horário")).toHaveValue("18:00");
    // Typing into a date input is unreliable in jsdom; set it directly.
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-10" } });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar agendamento" }));

    expect(await screen.findByText("Agendado para 10/10 18:00")).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const scheduleCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/carousels-schedule/boss-pizzaria-carrossel-1");
    expect(JSON.parse(scheduleCall![1].body as string)).toEqual({ date: "2026-10-10", time: "18:00", caption: "Legenda pronta" });
  });

  it("invites the operator to plan the first carousel", async () => {
    stubFetchSequence([{ body: projectState() }, { body: { carousels: [] } }]);
    renderCarousels();
    expect(await screen.findByText("Planeje o primeiro usando o formulário acima.")).toBeInTheDocument();
  });

  it("does not let the operator delete a carousel that is still planning", async () => {
    stubFetchSequence([{ body: projectState() }, { body: { carousels: [{ ...PLAN_FIXTURE, status: "planning" }] } }]);
    renderCarousels();
    expect(await screen.findByText("Planejando…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apagar" })).toBeDisabled();
  });

  it("blocks per-slide regeneration while the carousel is still generating", async () => {
    stubFetchSequence([{ body: projectState() }, { body: { carousels: [{ ...CAROUSEL_FIXTURE, status: "generating" }] } }]);
    renderCarousels();
    const buttons = await screen.findAllByRole("button", { name: "Regenerar esse slide" });
    buttons.forEach((button) => expect(button).toBeDisabled());
    await userEvent.type(screen.getAllByPlaceholderText(/texto menor/)[0], "menor");
    expect(screen.getByRole("button", { name: "Aplicar correção" })).toBeDisabled();
  });

  it("releases a stale slide generation for retry and preserves the correction text", async () => {
    const staleSlide = {
      ...CAROUSEL_FIXTURE.slides[0],
      image: {
        ...CAROUSEL_FIXTURE.slides[0].image,
        generating: true,
        generationStartedAt: "2026-10-13T12:00:00.000Z",
        generationKind: "correction",
      },
    };
    const staleCarousel = {
      ...CAROUSEL_FIXTURE,
      updatedAt: "2026-10-13T12:00:00.000Z",
      slides: [staleSlide, CAROUSEL_FIXTURE.slides[1]],
    };
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [staleCarousel] } },
      { body: { carousel: staleCarousel } },
      { body: { carousels: [staleCarousel] } },
    ]);
    renderCarousels();

    expect(await screen.findByText("A geração demorou mais que o esperado. Você já pode tentar novamente.")).toBeInTheDocument();
    const correction = screen.getAllByPlaceholderText(/texto menor/)[0];
    await userEvent.type(correction, "deixe a lista preta e as letras em branco");
    const retry = screen.getByRole("button", { name: "Aplicar correção" });
    expect(retry).toBeEnabled();
    await userEvent.click(retry);

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const correctionCall = calls.find(([url]) => url.endsWith("/carousels-regenerate-slide/boss-pizzaria-carrossel-1/boss-pizzaria-carrossel-1-slide-1"));
    expect(JSON.parse(correctionCall![1].body as string)).toEqual({ note: "deixe a lista preta e as letras em branco" });
    expect(correction).toHaveValue("deixe a lista preta e as letras em branco");
  });

  it("only offers Agendar when every slide has a published url (a preview alone is not enough)", async () => {
    const previewOnly = {
      ...CAROUSEL_FIXTURE,
      slides: CAROUSEL_FIXTURE.slides.map((slide) => ({ ...slide, image: { previewUrl: "data:image/png;base64,AAAA", generating: false } })),
    };
    stubFetchSequence([{ body: projectState() }, { body: { carousels: [previewOnly] } }]);
    renderCarousels();
    expect(await screen.findByRole("button", { name: "Agendar" })).toBeDisabled();
  });

  it("pads an unpadded default post time in the schedule form", async () => {
    const state = projectState();
    state.projects[0].contentSettings.defaultPostTime = "9:00";
    stubFetchSequence([{ body: state }, { body: { carousels: [CAROUSEL_FIXTURE] } }, { body: { caption: "Legenda" } }]);
    renderCarousels();
    await userEvent.click(await screen.findByRole("button", { name: "Agendar" }));
    expect(screen.getByLabelText("Horário")).toHaveValue("09:00");
  });

  it("shows every slide with its role, regenerates one slide through the real endpoint (polling until the new image renders), and deletes the carousel", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    // Right after the regenerate POST, the background job has only just
    // flagged the slide as generating — the image is still the stale one.
    // Only a later poll tick picks up the finished image. This mirrors the
    // real server: regenerateCarouselSlide's own response is immediately
    // followed by an unrelated background enqueue, so the slide isn't done
    // yet by the time the panel's own post-POST refresh() fires.
    const generatingSlide = { ...CAROUSEL_FIXTURE.slides[0], image: { url: CAROUSEL_FIXTURE.slides[0].image.url, generating: true } };
    const generatingCarousel = { ...CAROUSEL_FIXTURE, updatedAt: new Date().toISOString(), slides: [generatingSlide, CAROUSEL_FIXTURE.slides[1]] };
    const regeneratedSlide = { ...CAROUSEL_FIXTURE.slides[0], image: { url: "/api/projects/boss-pizzaria/assets/assets/generated/slide1-novo.png", generating: false } };
    const regeneratedCarousel = { ...CAROUSEL_FIXTURE, slides: [regeneratedSlide, CAROUSEL_FIXTURE.slides[1]] };

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubFetchSequence([
        { body: projectState() },
        { body: { carousels: [CAROUSEL_FIXTURE] } },
        { body: { carousel: generatingCarousel } },
        { body: { carousels: [generatingCarousel] } },
        { body: { carousels: [regeneratedCarousel] } },
        { body: { deleted: true } },
        { body: { carousels: [] } },
      ]);
      renderCarousels();

      expect(await screen.findByText("Capa")).toBeInTheDocument();
      expect(screen.getByText("CTA")).toBeInTheDocument();

      const regenerateButtons = screen.getAllByRole("button", { name: "Regenerar esse slide" });
      await userEvent.click(regenerateButtons[0]);

      let calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      const regenerateCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/carousels-regenerate-slide/boss-pizzaria-carrossel-1/boss-pizzaria-carrossel-1-slide-1");
      expect(regenerateCall).toBeTruthy();

      // Still generating right after the POST + its own refresh() — the poll
      // interval must be the thing that eventually picks up the new image.
      expect(screen.getByRole("button", { name: "Gerando nova imagem..." })).toBeDisabled();
      expect(screen.getByText("Gerando uma nova imagem. Ela aparecerá aqui automaticamente.")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(3000);

      const image = (await screen.findByAltText("5 dicas de pizza")) as HTMLImageElement;
      expect(image.src).toContain("slide1-novo.png");

      await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
      expect(await screen.findByText("Nenhum carrossel ainda")).toBeInTheDocument();
      calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      const deleteCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/carousels-delete/boss-pizzaria-carrossel-1");
      expect(deleteCall).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
