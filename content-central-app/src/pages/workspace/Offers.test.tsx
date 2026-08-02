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

function renderOffers() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/ofertas"]}>
      <App />
    </MemoryRouter>,
  );
}

const RODIZIO_OFFER = {
  id: "rodizio-boss",
  name: "Rodízio da Boss",
  type: "rodizio",
  price: "R$49,90",
  items: "pizzas salgadas, pizzas doces",
  cta: "Aproveite hoje",
  active: true,
};

describe("Offers", () => {
  it("shows an empty state when there are no offers yet", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderOffers();
    expect(await screen.findByText("Nenhuma oferta/assunto cadastrado ainda")).toBeInTheDocument();
  });

  it("renders a real offer with its type, price and status pills", async () => {
    stubFetchSequence([{ body: projectState([RODIZIO_OFFER]) }]);
    renderOffers();
    expect(await screen.findByText("Rodízio da Boss")).toBeInTheDocument();
    expect(screen.getAllByText("Rodízio").length).toBeGreaterThan(0);
    expect(screen.getByText("R$49,90")).toBeInTheDocument();
    expect(screen.getByText("ativo")).toBeInTheDocument();
  });

  it("creates a new offer through the real endpoint and shows it in the list", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {}, offer: RODIZIO_OFFER } },
      { body: projectState([RODIZIO_OFFER]) },
    ]);
    renderOffers();

    await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
    await userEvent.type(screen.getByLabelText("Nome"), "Rodízio da Boss");
    await userEvent.click(screen.getByRole("button", { name: "Salvar oferta/assunto" }));

    expect(await screen.findByText("Rodízio da Boss")).toBeInTheDocument();
  });

  it("deletes an offer through the real endpoint after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([{ body: projectState([RODIZIO_OFFER]) }, { body: { deleted: true } }, { body: projectState() }]);
    renderOffers();

    await screen.findByText("Rodízio da Boss");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(await screen.findByText("Nenhuma oferta/assunto cadastrado ainda")).toBeInTheDocument();
  });

  it("edits an existing offer in place by sending its id to the save endpoint", async () => {
    const updated = { ...RODIZIO_OFFER, name: "Rodízio da Boss (grande)" };
    stubFetchSequence([
      { body: projectState([RODIZIO_OFFER]) },
      { body: { project: {}, offer: updated } },
      { body: projectState([updated]) },
    ]);
    renderOffers();

    await screen.findByText("Rodízio da Boss");
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByRole("button", { name: "Salvar edição" })).toBeInTheDocument();
    const nameField = screen.getByLabelText("Nome") as HTMLInputElement;
    expect(nameField.value).toBe("Rodízio da Boss");

    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Rodízio da Boss (grande)");
    await userEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    expect(await screen.findByText("Rodízio da Boss (grande)")).toBeInTheDocument();
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(saveCall[1].body as string).id).toBe(RODIZIO_OFFER.id);
  });

  it("renders catalog (venda direta) projects as Produtos, hiding Tipo/CTA/Pilar and requiring a photo upload field", async () => {
    stubFetchSequence([{
      body: {
        projects: [{
          projectId: "boss-pizzaria",
          name: "Boss Pizzaria",
          projectType: "catalog",
          contentStrategy: { offers: [] },
        }],
        globalRules: {},
      },
    }]);
    renderOffers();

    expect(await screen.findByRole("heading", { name: "Produtos" })).toBeInTheDocument();
    expect(screen.getByText("Nenhum produto cadastrado ainda")).toBeInTheDocument();
    expect(screen.getByLabelText("Foto(s) real(is) do produto")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tipo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("CTA")).not.toBeInTheDocument();
    expect(screen.getByText("Em estoque (entra na rotação de posts)")).toBeInTheDocument();
  });

  it("creates a new product by uploading a real photo first, then sending its photoReferenceIds with the offer", async () => {
    const savedProduct = { id: "iphone-13", name: "iPhone 13 128GB", type: "offer", price: "R$ 2.499,00", photoReferenceIds: ["foto-iphone"] };
    stubFetchSequence([
      {
        body: {
          projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", projectType: "catalog", contentStrategy: { offers: [] } }],
          globalRules: {},
        },
      },
      { body: { asset: { kind: "reference", metadata: { id: "foto-iphone" } } } },
      { body: { project: {}, offer: savedProduct } },
      {
        body: {
          projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", projectType: "catalog", contentStrategy: { offers: [savedProduct] } }],
          globalRules: {},
        },
      },
    ]);
    renderOffers();

    await screen.findByText("Nenhum produto cadastrado ainda");
    await userEvent.type(screen.getByLabelText("Nome do produto"), "iPhone 13 128GB");
    const photoFile = new File(["fake-image-bytes"], "iphone.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Foto(s) real(is) do produto"), photoFile);
    await userEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect(await screen.findByText("iPhone 13 128GB")).toBeInTheDocument();

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/assets");
    expect(calls[2][0]).toBe("/api/projects/boss-pizzaria/offers");
    expect(JSON.parse(calls[2][1].body as string).photoReferenceIds).toEqual(["foto-iphone"]);
  });

  it("previews the pillar an offer would auto-resolve to when no pillarId is set, and hides it once one is", async () => {
    const convidaPillar = { id: "convite", name: "Convite Direto", role: "convida", visualTreatment: "leve", color: "#E63946", weight: 1, requiresEvidence: false };
    const autoOffer = { ...RODIZIO_OFFER, type: "offer", pillarId: null };
    const explicitOffer = { ...RODIZIO_OFFER, id: "explicit-offer", name: "Combo Explícito", pillarId: "convite" };
    stubFetchSequence([{
      body: {
        projects: [{
          projectId: "boss-pizzaria",
          name: "Boss Pizzaria",
          contentStrategy: { offers: [autoOffer, explicitOffer], pillars: [convidaPillar] },
        }],
        globalRules: {},
      },
    }]);
    renderOffers();

    await screen.findByText("Rodízio da Boss");
    expect(screen.getByText("pilar automático: Convite Direto")).toBeInTheDocument();
    expect(screen.getByText("pilar: Convite Direto")).toBeInTheDocument();
  });

  it("saves the catalog's general info (financing terms etc.) through the real catalog-settings endpoint", async () => {
    stubFetchSequence([
      {
        body: {
          projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", projectType: "catalog", contentStrategy: { offers: [] } }],
          globalRules: {},
        },
      },
      { body: { project: { contentSettings: { catalogGeneralInfo: "Entrada facilitada · Parcelamos em até 48x" } } } },
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            projectType: "catalog",
            contentSettings: { catalogGeneralInfo: "Entrada facilitada · Parcelamos em até 48x" },
            contentStrategy: { offers: [] },
          }],
          globalRules: {},
        },
      },
    ]);
    renderOffers();

    await screen.findByRole("heading", { name: "Produtos" });
    await userEvent.type(screen.getByLabelText("Informação fixa (opcional)"), "Entrada facilitada · Parcelamos em até 48x");
    await userEvent.click(screen.getByRole("button", { name: "Salvar informação geral" }));

    expect(await screen.findByText(/Informação geral salva/)).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/catalog-settings");
    expect(JSON.parse(calls[1][1].body as string).catalogGeneralInfo).toBe("Entrada facilitada · Parcelamos em até 48x");
  });
});
