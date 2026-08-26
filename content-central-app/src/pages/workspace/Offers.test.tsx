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

// Groups (including the default "Sem grupo" section) render collapsed —
// only the header (name + count) is visible until clicked.
async function expandSection(groupName: string) {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(groupName) }));
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
    await screen.findByRole("button", { name: /Sem grupo/ });
    await expandSection("Sem grupo");
    expect(await screen.findByText("Rodízio da Boss")).toBeInTheDocument();
    expect(screen.getAllByText("Rodízio").length).toBeGreaterThan(0);
    expect(screen.getByText("R$49,90")).toBeInTheDocument();
    expect(screen.getByText("ativo")).toBeInTheDocument();
  });

  it("keeps the create form and text importer collapsed behind toolbar buttons so a long product list isn't pushed down", async () => {
    stubFetchSequence([{ body: projectState([RODIZIO_OFFER]) }]);
    renderOffers();

    await screen.findByRole("button", { name: /Sem grupo/ });
    expect(screen.queryByLabelText("Nome")).not.toBeInTheDocument();
    expect(screen.queryByText("Cadastrar a partir de texto")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Nova oferta/assunto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Colar lista de produtos" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "+ Nova oferta/assunto" }));
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Serviço" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tratamento do produto")).toHaveValue("faithful_enhance");
    expect(screen.getByLabelText("Obediência ao modelo")).toHaveValue("strict");
  });

  it("creates a new offer through the real endpoint and shows it in the list", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {}, offer: RODIZIO_OFFER } },
      { body: projectState([RODIZIO_OFFER]) },
    ]);
    renderOffers();

    await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova oferta/assunto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Rodízio da Boss");
    await userEvent.click(screen.getByRole("button", { name: "Salvar oferta/assunto" }));

    await screen.findByRole("button", { name: /Sem grupo/ });
    await expandSection("Sem grupo");
    expect(await screen.findByText("Rodízio da Boss")).toBeInTheDocument();
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    const payload = JSON.parse(saveCall[1].body as string);
    expect(payload.productTreatment).toBe("faithful_enhance");
    expect(payload.layoutStrength).toBe("strict");
  });

  it("deletes an offer through the real endpoint after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([{ body: projectState([RODIZIO_OFFER]) }, { body: { deleted: true } }, { body: projectState() }]);
    renderOffers();

    await expandSection("Sem grupo");
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

    await expandSection("Sem grupo");
    await screen.findByText("Rodízio da Boss");
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByRole("button", { name: "Salvar edição" })).toBeInTheDocument();
    const nameField = screen.getByLabelText("Nome") as HTMLInputElement;
    expect(nameField.value).toBe("Rodízio da Boss");

    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Rodízio da Boss (grande)");
    await userEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    // The "Sem grupo" section was already expanded above and stays expanded
    // across the refreshProject() re-render (same component instance).
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
    await userEvent.click(screen.getByRole("button", { name: "+ Novo produto" }));
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
    await userEvent.click(screen.getByRole("button", { name: "+ Novo produto" }));
    await userEvent.type(screen.getByLabelText("Nome do produto"), "iPhone 13 128GB");
    const photoFile = new File(["fake-image-bytes"], "iphone.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Foto(s) real(is) do produto"), photoFile);
    await userEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    await screen.findByRole("button", { name: /Sem grupo/ });
    await expandSection("Sem grupo");
    expect(await screen.findByText("iPhone 13 128GB")).toBeInTheDocument();

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/assets");
    expect(calls[2][0]).toBe("/api/projects/boss-pizzaria/offers");
    expect(JSON.parse(calls[2][1].body as string).photoReferenceIds).toEqual(["foto-iphone"]);
  });

  it("suggests product-specific direction into observations before saving", async () => {
    const savedProduct = { id: "pano-microfibra", name: "Pano Microfibra 30x30", type: "offer", price: "R$ 6,50", notes: "" };
    stubFetchSequence([
      {
        body: {
          projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", projectType: "catalog", contentStrategy: { offers: [] } }],
          globalRules: {},
        },
      },
      { body: { notes: "Direcionamento: produto visto na foto. Chamada sugerida: Proteção prática para embalar melhor. Benefícios permitidos: protege, organiza e facilita o preparo." } },
      { body: { asset: { kind: "reference", metadata: { id: "foto-pano" } } } },
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
    await userEvent.click(screen.getByRole("button", { name: "+ Novo produto" }));
    await userEvent.type(screen.getByLabelText("Nome do produto"), "Pano Microfibra 30x30");
    await userEvent.type(screen.getByLabelText("Detalhes"), "2 unidades");
    await userEvent.click(screen.getByRole("button", { name: "Sugerir direcionamento" }));
    expect((screen.getByLabelText("Observações") as HTMLTextAreaElement).value).toContain("produto visto na foto");

    const photoFile = new File(["fake-image-bytes"], "pano.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Foto(s) real(is) do produto"), photoFile);
    await userEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/offers/suggest-direction");
    expect(JSON.parse(calls[1][1].body as string).name).toBe("Pano Microfibra 30x30");
    const payload = JSON.parse(calls[3][1].body as string);
    expect(payload.notes).toContain("Benefícios permitidos");
    expect(payload.notes).toContain("protege");
  });

  it("uploads the offer photo with scope 'offer' so it never lands in the shared references gallery", async () => {
    const savedOffer = { ...RODIZIO_OFFER, photoReferenceIds: ["foto-pizza"] };
    stubFetchSequence([
      { body: projectState() },
      { body: { asset: { kind: "reference", metadata: { id: "foto-pizza" } } } },
      { body: { project: {}, offer: savedOffer } },
      { body: projectState([savedOffer]) },
    ]);
    renderOffers();

    await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova oferta/assunto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Rodízio da Boss");
    const photoFile = new File(["fake-image-bytes"], "pizza.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Foto(s) real(is) do produto (opcional)"), photoFile);
    await userEvent.click(screen.getByRole("button", { name: "Salvar oferta/assunto" }));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/assets");
    expect(JSON.parse(calls[1][1].body as string).scope).toBe("offer");
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

    await screen.findByRole("button", { name: /Sem grupo/ });
    await expandSection("Sem grupo");
    expect(await screen.findByText("Rodízio da Boss")).toBeInTheDocument();
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

  it("renders the product list as one section per group, plus a trailing 'Sem grupo' section for ungrouped offers", async () => {
    const geral = { id: "geral", name: "Geral" };
    const blackFriday = { id: "black-friday", name: "Black Friday" };
    const grouped1 = { ...RODIZIO_OFFER, id: "o1", name: "Produto Geral 1", groupId: "geral" };
    const grouped2 = { ...RODIZIO_OFFER, id: "o2", name: "Produto BF", groupId: "black-friday" };
    const ungrouped = { ...RODIZIO_OFFER, id: "o3", name: "Produto Solto", groupId: null };
    stubFetchSequence([{
      body: {
        projects: [{
          projectId: "boss-pizzaria",
          name: "Boss Pizzaria",
          contentStrategy: { offers: [grouped1, grouped2, ungrouped], offerGroups: [geral, blackFriday] },
        }],
        globalRules: {},
      },
    }]);
    renderOffers();

    // Collapsed by default: only the section headers (name + count) show,
    // no product name is visible yet.
    await screen.findByRole("button", { name: /Geral/ });
    expect(screen.getByRole("button", { name: /Black Friday/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sem grupo/ })).toBeInTheDocument();
    expect(screen.queryByText("Produto Geral 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Produto BF")).not.toBeInTheDocument();
    expect(screen.queryByText("Produto Solto")).not.toBeInTheDocument();

    // Clicking a group's header opens it (and only it).
    await expandSection("Geral");
    expect(screen.getByText("Produto Geral 1")).toBeInTheDocument();
    expect(screen.queryByText("Produto BF")).not.toBeInTheDocument();
    expect(screen.queryByText("Produto Solto")).not.toBeInTheDocument();

    // Opening a different group closes the previous one.
    await expandSection("Black Friday");
    expect(screen.queryByText("Produto Geral 1")).not.toBeInTheDocument();
    expect(screen.getByText("Produto BF")).toBeInTheDocument();

    await expandSection("Sem grupo");
    expect(screen.queryByText("Produto BF")).not.toBeInTheDocument();
    expect(screen.getByText("Produto Solto")).toBeInTheDocument();
  });

  it("creates an offer group, assigns an offer to it, and shows it under that group's section in the list", async () => {
    const blackFridayGroup = { id: "black-friday", name: "Black Friday" };
    const offerWithGroup = { ...RODIZIO_OFFER, groupId: "black-friday" };
    stubFetchSequence([
      { body: projectState([RODIZIO_OFFER]) },
      { body: { project: {}, group: blackFridayGroup } },
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            contentStrategy: { offers: [RODIZIO_OFFER], offerGroups: [blackFridayGroup] },
          }],
          globalRules: {},
        },
      },
      { body: { project: {}, offer: offerWithGroup } },
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            contentStrategy: { offers: [offerWithGroup], offerGroups: [blackFridayGroup] },
          }],
          globalRules: {},
        },
      },
    ]);
    renderOffers();

    await screen.findByRole("button", { name: /Sem grupo/ });
    await expandSection("Sem grupo");
    await screen.findByText("Rodízio da Boss");
    await userEvent.click(screen.getByRole("button", { name: "Grupos de ofertas" }));
    await userEvent.type(screen.getByLabelText("Novo grupo"), "Black Friday");
    await userEvent.click(screen.getByRole("button", { name: "Criar grupo" }));

    expect(await screen.findByText("Black Friday")).toBeInTheDocument();
    const createGroupCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(createGroupCall[0]).toBe("/api/projects/boss-pizzaria/offer-groups");
    expect(JSON.parse(createGroupCall[1].body as string).name).toBe("Black Friday");

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.selectOptions(screen.getByLabelText("Grupo (opcional)"), "black-friday");
    await userEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    // "Sem grupo" no longer exists (the offer moved out of it) — its section
    // disappears, so open the new "Black Friday" product section instead.
    await screen.findByRole("button", { name: /Black Friday \d/ });
    await userEvent.click(screen.getByRole("button", { name: "Fechar" })); // close the groups-management panel first
    await expandSection("Black Friday");
    expect(await screen.findByText("Rodízio da Boss")).toBeInTheDocument();
    const saveOfferCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[3];
    expect(JSON.parse(saveOfferCall[1].body as string).groupId).toBe("black-friday");
  });

  it("saves a group's combo % (chance of pairing two similar products in one arte) on blur", async () => {
    const pizzasGroup = { id: "pizzas", name: "Pizzas", comboChance: 0 };
    stubFetchSequence([
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            contentStrategy: { offers: [], offerGroups: [pizzasGroup] },
          }],
          globalRules: {},
        },
      },
      { body: { project: {}, group: { ...pizzasGroup, comboChance: 30 } } },
    ]);
    renderOffers();

    await userEvent.click(await screen.findByRole("button", { name: "Grupos de ofertas" }));
    const comboInput = await screen.findByLabelText("Combo %");
    await userEvent.clear(comboInput);
    await userEvent.type(comboInput, "30");
    await userEvent.tab();

    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(saveCall[0]).toBe("/api/projects/boss-pizzaria/offer-groups");
    const savedBody = JSON.parse(saveCall[1].body as string);
    expect(savedBody.id).toBe("pizzas");
    expect(savedBody.name).toBe("Pizzas");
    expect(savedBody.comboChance).toBe(30);
  });

  it("restricts an offer to selected weekdays and shows the chosen days as a pill in the list", async () => {
    const weekdayOffer = { ...RODIZIO_OFFER, name: "Rodízio Seg-Sex", daysOfWeek: ["mon", "tue", "wed", "thu", "fri"] };
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {}, offer: weekdayOffer } },
      { body: projectState([weekdayOffer]) },
    ]);
    renderOffers();

    await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova oferta/assunto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Rodízio Seg-Sex");
    await userEvent.click(screen.getByRole("button", { name: "Seg" }));
    await userEvent.click(screen.getByRole("button", { name: "Ter" }));
    await userEvent.click(screen.getByRole("button", { name: "Qua" }));
    await userEvent.click(screen.getByRole("button", { name: "Qui" }));
    await userEvent.click(screen.getByRole("button", { name: "Sex" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar oferta/assunto" }));

    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(saveCall[1].body as string).daysOfWeek).toEqual(["mon", "tue", "wed", "thu", "fri"]);

    await screen.findByRole("button", { name: /Sem grupo/ });
    await expandSection("Sem grupo");
    expect(await screen.findByText("Seg, Ter, Qua, Qui, Sex")).toBeInTheDocument();
  });

  it("defaults the create form's group select to the project's first existing group instead of 'Sem grupo'", async () => {
    const geral = { id: "geral", name: "Geral" };
    stubFetchSequence([{
      body: {
        projects: [{
          projectId: "boss-pizzaria",
          name: "Boss Pizzaria",
          contentStrategy: { offers: [], offerGroups: [geral] },
        }],
        globalRules: {},
      },
    }]);
    renderOffers();

    await userEvent.click(await screen.findByRole("button", { name: "+ Nova oferta/assunto" }));
    const groupSelect = screen.getByLabelText("Grupo (opcional)") as HTMLSelectElement;
    expect(groupSelect.value).toBe("geral");
  });

  it("assigns offers added through the paste-text importer to the project's first existing group, not 'Sem grupo'", async () => {
    const geral = { id: "geral", name: "Geral" };
    const importedOffer = { id: "iphone-13", name: "iPhone 13 128GB", type: "offer", price: "R$ 2.499,00", items: "novo, lacrado", groupId: "geral" };
    stubFetchSequence([
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            contentStrategy: { offers: [], offerGroups: [geral] },
          }],
          globalRules: {},
        },
      },
      { body: { offers: [{ name: "iPhone 13 128GB", price: "R$ 2.499,00", items: "novo, lacrado" }] } },
      { body: { project: {}, offer: importedOffer } },
      {
        body: {
          projects: [{
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            contentStrategy: { offers: [importedOffer], offerGroups: [geral] },
          }],
          globalRules: {},
        },
      },
    ]);
    renderOffers();

    await userEvent.click(await screen.findByRole("button", { name: "Colar lista de produtos" }));
    await userEvent.type(
      screen.getByPlaceholderText(/iPhone 13 128GB - R\$ 3\.299,99/),
      "iPhone 13 128GB - R$ 2.499,00 - novo, lacrado",
    );
    await userEvent.click(screen.getByRole("button", { name: "Analisar e sugerir ofertas" }));

    await screen.findByText("iPhone 13 128GB");
    await userEvent.click(screen.getByRole("button", { name: /Adicionar \d selecionada\(s\)/ }));

    await screen.findByRole("button", { name: /Geral/ });
    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(JSON.parse(saveCall[1].body as string).groupId).toBe("geral");
  });

});
