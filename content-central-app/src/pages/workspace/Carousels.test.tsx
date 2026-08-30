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

function projectState() {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [] } }],
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

  it("generates a new carousel with the typed briefing and slide count through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [] } },
      { body: { carousel: CAROUSEL_FIXTURE } },
      { body: { carousels: [CAROUSEL_FIXTURE] } },
    ]);
    renderCarousels();

    await screen.findByText("Nenhum carrossel ainda");
    await userEvent.type(screen.getByLabelText("Tema do carrossel"), "5 dicas de pizza");
    await userEvent.clear(screen.getByLabelText("Quantidade de folhas"));
    await userEvent.type(screen.getByLabelText("Quantidade de folhas"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Gerar carrossel" }));

    expect(await screen.findByText("5 dicas de pizza")).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const generateCall = calls.find(([url, options]) => url === "/api/projects/boss-pizzaria/carousels" && options?.method === "POST");
    expect(generateCall).toBeTruthy();
    expect(JSON.parse(generateCall![1].body as string)).toEqual({ briefing: "5 dicas de pizza", slideCount: 2 });
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
    const generatingCarousel = { ...CAROUSEL_FIXTURE, slides: [generatingSlide, CAROUSEL_FIXTURE.slides[1]] };
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
      expect(screen.getAllByRole("button", { name: "Regenerar esse slide" })[0]).toBeDisabled();

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
