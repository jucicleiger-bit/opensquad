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

function projectState(offers: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers } }],
    globalRules: {},
  };
}

function renderAdCreatives() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/anuncios"]}>
      <App />
    </MemoryRouter>,
  );
}

const RODIZIO_OFFER = { id: "rodizio", name: "Rodízio da Boss", type: "rodizio", price: "R$49,90", active: true };

const AD_CREATIVE_FIXTURE = {
  adCreativeId: "boss-pizzaria-anuncio-1",
  projectId: "boss-pizzaria",
  objective: "whatsapp",
  objectiveLabel: "Tráfego para o WhatsApp",
  offerId: "rodizio",
  offerName: "Rodízio da Boss",
  channel: "instagram_feed",
  formatLabel: "Instagram Feed",
  title: "Anúncio — Rodízio da Boss",
  image: { url: "/api/projects/boss-pizzaria/assets/assets/generated/anuncio.png", generating: false },
  variations: [
    { angle: "dor", angleLabel: "Dor", headline: "Cansou de complicar o jantar?", primaryText: "A Boss resolve rápido.", description: "Peça e relaxe", cta: "Chame no WhatsApp" },
    { angle: "desejo", angleLabel: "Desejo/Resultado", headline: "Pizza quentinha em minutos", primaryText: "Peça agora e relaxe.", description: "Sabor de verdade", cta: "Chame no WhatsApp" },
    { angle: "urgencia", angleLabel: "Urgência", headline: "Hoje tem rodízio", primaryText: "Só até acabar o forno ligado.", description: "Vagas limitadas", cta: "Chame no WhatsApp" },
  ],
  imageGenerationError: null,
  copyGenerationError: null,
  createdAt: "2026-08-04T12:00:00.000Z",
  updatedAt: "2026-08-04T12:00:00.000Z",
};

describe("AdCreatives", () => {
  it("shows an empty state when no ad creative has been generated yet", async () => {
    stubFetchSequence([{ body: projectState([RODIZIO_OFFER]) }, { body: { adCreatives: [] } }]);
    renderAdCreatives();

    expect(await screen.findByRole("heading", { name: "Criativos de Anúncio" })).toBeInTheDocument();
    expect(await screen.findByText("Nenhum criativo de anúncio ainda")).toBeInTheDocument();
  });

  it("generates a new ad creative tied to the selected offer, objective, format and idea through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState([RODIZIO_OFFER]) },
      { body: { adCreatives: [] } },
      { body: { adCreatives: [AD_CREATIVE_FIXTURE] } },
      { body: { adCreatives: [AD_CREATIVE_FIXTURE] } },
    ]);
    renderAdCreatives();

    await screen.findByText("Nenhum criativo de anúncio ainda");
    await userEvent.selectOptions(screen.getByLabelText("Oferta vinculada (opcional)"), "rodizio");
    await userEvent.selectOptions(screen.getByLabelText("Objetivo"), "sales");
    await userEvent.click(screen.getByRole("button", { name: "Story" }));
    await userEvent.type(screen.getByLabelText("Sua ideia pra esse anúncio (opcional)"), "menos de R$5 por dia");
    await userEvent.click(screen.getByLabelText(/Basear o criativo totalmente/i));
    await userEvent.click(screen.getByRole("button", { name: "Gerar criativo de anúncio" }));

    expect(await screen.findByText("Anúncio — Rodízio da Boss")).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const generateCall = calls.find(([url, options]) => url === "/api/projects/boss-pizzaria/ad-creatives" && options?.method === "POST");
    expect(generateCall).toBeTruthy();
    expect(JSON.parse(generateCall![1].body as string)).toEqual({
      objective: "sales",
      offerId: "rodizio",
      format: "story",
      note: "menos de R$5 por dia",
      noteMode: "base_total",
    });
  });

  it("shows the 3 angle-based copy variations with a working copy-to-clipboard button, and deletes a creative through the real endpoint", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    stubFetchSequence([
      { body: projectState([RODIZIO_OFFER]) },
      { body: { adCreatives: [AD_CREATIVE_FIXTURE] } },
      { body: { deleted: true } },
      { body: { adCreatives: [] } },
    ]);
    renderAdCreatives();

    expect(await screen.findByText("Dor")).toBeInTheDocument();
    expect(screen.getByText("Desejo/Resultado")).toBeInTheDocument();
    expect(screen.getByText("Urgência")).toBeInTheDocument();
    expect(screen.getByText("Cansou de complicar o jantar?")).toBeInTheDocument();
    expect(screen.getByText("Peça e relaxe")).toBeInTheDocument();

    const copyButtons = screen.getAllByRole("button", { name: "Copiar texto" });
    await userEvent.click(copyButtons[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Cansou de complicar o jantar?"));
    expect(await screen.findByText("Copiado!")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(await screen.findByText("Nenhum criativo de anúncio ainda")).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[2][0]).toBe("/api/projects/boss-pizzaria/ad-creatives-delete/boss-pizzaria-anuncio-1");
  });

  it("regenerates just the image with no note, and applies a targeted edit through the real endpoint once a 'Pedido de alteração' is typed", async () => {
    const regenerated = { ...AD_CREATIVE_FIXTURE, image: { url: "/api/projects/boss-pizzaria/assets/assets/generated/editado.png", generating: false } };
    stubFetchSequence([
      { body: projectState([RODIZIO_OFFER]) },
      { body: { adCreatives: [AD_CREATIVE_FIXTURE] } },
      { body: { adCreative: regenerated } },
      { body: { adCreatives: [regenerated] } },
    ]);
    renderAdCreatives();

    await screen.findByText("Dor");
    await userEvent.click(screen.getByRole("button", { name: "Regenerar só a imagem" }));

    let calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    let regenerateCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/ad-creatives-regenerate/boss-pizzaria-anuncio-1");
    expect(regenerateCall).toBeTruthy();
    expect(JSON.parse(regenerateCall![1].body as string)).toEqual({ note: undefined });

    await userEvent.type(screen.getByLabelText("Pedido de alteração (opcional)"), "aumentar o preço");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar alteração" }));

    calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    regenerateCall = calls.filter(([url]) => url === "/api/projects/boss-pizzaria/ad-creatives-regenerate/boss-pizzaria-anuncio-1").pop();
    expect(JSON.parse(regenerateCall![1].body as string)).toEqual({ note: "aumentar o preço" });
  });
});
