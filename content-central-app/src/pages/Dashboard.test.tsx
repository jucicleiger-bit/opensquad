import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { Dashboard } from "./Dashboard";

const toPngMock = vi.fn().mockResolvedValue("data:image/png;base64,fake");
vi.mock("html-to-image", () => ({
  toPng: (...args: unknown[]) => toPngMock(...args),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  toPngMock.mockClear();
});

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      text: async () => JSON.stringify(body),
    }),
  );
}

// A minimal but real-shaped registered segment template — 6 feed pieces for
// the grid, 3 story pieces for the highlight bubbles, matching how
// registerSegmentTemplate actually stores them.
const EMBALAGENS_TEMPLATE = {
  segmentId: "embalagens",
  label: "Embalagens",
  pieceCount: 9,
  pieces: [
    { key: "sell-products", label: "Venda direta", channel: "instagram_feed", imagePath: "images/sell-products.png" },
    { key: "promotions", label: "Novidades", channel: "instagram_feed", imagePath: "images/promotions.png" },
    { key: "whatsapp-orders", label: "Pedido pelo WhatsApp", channel: "instagram_feed", imagePath: "images/whatsapp-orders.png" },
    { key: "authority", label: "Autoridade", channel: "instagram_feed", imagePath: "images/authority.png" },
    { key: "relationship", label: "Atendimento sob medida", channel: "instagram_feed", imagePath: "images/relationship.png" },
    { key: "show-products", label: "Vitrine completa", channel: "instagram_feed", imagePath: "images/show-products.png" },
    { key: "produtos", label: "Produtos", channel: "instagram_story", imagePath: "images/produtos.png" },
    { key: "pedidos", label: "Pedidos", channel: "instagram_story", imagePath: "images/pedidos.png" },
    { key: "sobre", label: "Sobre", channel: "instagram_story", imagePath: "images/sobre.png" },
  ],
};

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

describe("Dashboard", () => {
  it("renders a real project fetched from /api/state as a card", async () => {
    stubFetch({
      projects: [
        {
          projectId: "boss-pizzaria",
          name: "Boss Pizzaria",
          token: { configured: true, expiresAt: new Date(Date.now() + 12 * 86400000).toISOString() },
          brandXray: { status: "approved" },
        },
      ],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Boss Pizzaria")).toBeInTheDocument();
    expect(screen.getByText("boss-pizzaria")).toBeInTheDocument();
    expect(screen.getByText("Expira em 12 dias")).toBeInTheDocument();
    expect(screen.getByText("Raio-X ok")).toBeInTheDocument();
  });

  it("shows a proactive alert banner for an expiring token and links to the account page", async () => {
    stubFetch({
      projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", token: {}, brandXray: { status: "empty" } }],
      globalRules: {},
      alerts: [
        {
          type: "token_expiring",
          projectId: "boss-pizzaria",
          projectName: "Boss Pizzaria",
          message: "Token da Meta vence em 5 dia(s).",
        },
      ],
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("1 alerta precisa de atenção:")).toBeInTheDocument();
    expect(screen.getByText(/Token da Meta vence em 5 dia\(s\)\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resolver" })).toHaveAttribute("href", "/projects/boss-pizzaria/conta");
  });

  it("shows an empty state when there are no projects", async () => {
    stubFetch({ projects: [], globalRules: {} });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Nenhum projeto ainda")).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    stubFetch({ error: "Falha ao carregar" }, false);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Não foi possível carregar os projetos")).toBeInTheDocument();
    expect(screen.getByText("Falha ao carregar")).toBeInTheDocument();
  });

  it("deletes a project through the real endpoint after confirmation, without navigating into it", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubFetchSequence([
      {
        body: {
          projects: [
            { projectId: "cliente-antigo", name: "Cliente Antigo", token: {}, brandXray: { status: "empty" } },
          ],
          globalRules: {},
        },
      },
      { body: { projectId: "cliente-antigo", deleted: true } },
    ]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Cliente Antigo");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Cliente Antigo"));
    expect(await screen.findByText("Nenhum projeto ainda")).toBeInTheDocument();

    const deleteCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(deleteCall[0]).toBe("/api/projects/cliente-antigo");
    expect(deleteCall[1].method).toBe("POST");
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    stubFetch({
      projects: [{ projectId: "cliente-antigo", name: "Cliente Antigo", token: {}, brandXray: { status: "empty" } }],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Cliente Antigo");
    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));

    expect(screen.getByText("Cliente Antigo")).toBeInTheDocument();
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("creates a new project through the real endpoint and navigates into its workspace", async () => {
    stubFetchSequence([
      { body: { projects: [], globalRules: {} } },
      { body: { project: { projectId: "cliente-teste", name: "Cliente Teste" } } },
      {
        body: {
          projects: [{ projectId: "cliente-teste", name: "Cliente Teste", brandXray: { status: "empty", blocks: {} } }],
          globalRules: {},
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Novo projeto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Cliente Teste");
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto" }));

    expect(await screen.findByRole("heading", { name: "Cliente Teste" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Todos os projetos" })).toBeInTheDocument();
  });

  it("creates a catalog (venda direta) project by sending projectType: catalog to the real endpoint", async () => {
    stubFetchSequence([
      { body: { projects: [], globalRules: {} } },
      { body: { project: { projectId: "loja-celulares", name: "Loja de Celulares", projectType: "catalog" } } },
      {
        body: {
          projects: [{ projectId: "loja-celulares", name: "Loja de Celulares", projectType: "catalog" }],
          globalRules: {},
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Novo projeto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Loja de Celulares");
    await userEvent.selectOptions(screen.getByLabelText("Tipo de projeto"), "catalog");
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto" }));

    expect(await screen.findByRole("heading", { name: "Loja de Celulares" })).toBeInTheDocument();
    const createCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(createCall[1].body as string).projectType).toBe("catalog");
  });

  it("duplicates a project through the real endpoint and navigates into the new project's workspace", async () => {
    stubFetchSequence([
      {
        body: {
          projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", token: {}, brandXray: { status: "approved" } }],
          globalRules: {},
        },
      },
      { body: { project: { projectId: "boss-pizzaria-zona-sul", name: "Boss Pizzaria Zona Sul" } } },
      {
        body: {
          projects: [
            { projectId: "boss-pizzaria", name: "Boss Pizzaria", token: {}, brandXray: { status: "approved" } },
            {
              projectId: "boss-pizzaria-zona-sul",
              name: "Boss Pizzaria Zona Sul",
              token: {},
              brandXray: { status: "approved", blocks: {} },
            },
          ],
          globalRules: {},
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText("Boss Pizzaria");
    await userEvent.click(screen.getByRole("button", { name: "Duplicar" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Boss Pizzaria Zona Sul");
    await userEvent.type(screen.getByLabelText("ID curto"), "boss-pizzaria-zona-sul");
    await userEvent.click(screen.getByRole("button", { name: "Duplicar projeto" }));

    expect(await screen.findByRole("heading", { name: "Boss Pizzaria Zona Sul" })).toBeInTheDocument();

    const duplicateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(duplicateCall[0]).toBe("/api/projects/boss-pizzaria/duplicate");
    expect(duplicateCall[1].method).toBe("POST");
    expect(JSON.parse(duplicateCall[1].body as string)).toEqual({
      projectId: "boss-pizzaria-zona-sul",
      name: "Boss Pizzaria Zona Sul",
    });
  });

  it("shows the duplicate error inline without closing the dialog", async () => {
    stubFetchSequence([
      {
        body: {
          projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", token: {}, brandXray: { status: "approved" } }],
          globalRules: {},
        },
      },
      { body: { error: "Project already exists: boss-pizzaria" }, ok: false },
    ]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Boss Pizzaria");
    await userEvent.click(screen.getByRole("button", { name: "Duplicar" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Boss Pizzaria");
    await userEvent.click(screen.getByRole("button", { name: "Duplicar projeto" }));

    expect(await screen.findByText("Project already exists: boss-pizzaria")).toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
  });

  it("has no Duplicar button on a catalog project card", async () => {
    stubFetch({
      projects: [{ projectId: "loja-celulares", name: "Loja de Celulares", token: {}, projectType: "catalog", brandXray: { status: "empty" } }],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Loja de Celulares");
    expect(screen.queryByRole("button", { name: "Duplicar" })).not.toBeInTheDocument();
  });

  it("keeps a prospect project out of the main grid and shows it in a separate Prospecção section, with no such section when there are no prospects", async () => {
    stubFetch({
      projects: [
        { projectId: "boss-pizzaria", name: "Boss Pizzaria", token: {}, brandXray: { status: "empty" } },
        {
          projectId: "emporio-rei-da-mussarela",
          name: "Empório Rei da Mussarela",
          isProspect: true,
          prospectSource: { handle: "@emporioreidamussarela", bio: null, realFollowers: 4388, realPosts: null, realFollowing: null },
          token: {},
          brandXray: { status: "empty" },
        },
      ],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Boss Pizzaria");
    // The client grid stays client-only — a prospect must not show up there.
    expect(screen.queryByRole("link", { name: /Empório Rei da Mussarela/ })).not.toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "Prospecção" })).toBeInTheDocument();
    expect(screen.getByText("Empório Rei da Mussarela")).toBeInTheDocument();
    expect(screen.getByText("@emporioreidamussarela")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver mockup" })).toHaveAttribute(
      "href",
      "/api/projects/emporio-rei-da-mussarela/prospect-mockup",
    );
  });

  it("has no Prospecção section when every project is a real client", async () => {
    stubFetch({
      projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", token: {}, brandXray: { status: "empty" } }],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Boss Pizzaria");
    expect(screen.queryByRole("heading", { name: "Prospecção" })).not.toBeInTheDocument();
  });

  it("has no 'Nova prospecção' entry point while the feature is taken off the air (PROSPECTING_ENABLED = false)", async () => {
    stubFetch({ projects: [], globalRules: {} });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    expect(screen.queryByRole("button", { name: /Nova prospecção/ })).not.toBeInTheDocument();
    // The unrelated "+ Novo projeto" entry point is untouched by the flag.
    expect(screen.getByRole("button", { name: "+ Novo projeto" })).toBeInTheDocument();
  });

  // The 4 tests below exercise the full "Nova prospecção" flow end to end.
  // The feature is currently taken off the air (PROSPECTING_ENABLED = false
  // in Dashboard.tsx) at the operator's request, so its entry-point button
  // doesn't render and these can't drive the UI anymore. Skipped rather
  // than deleted — flip the flag back and un-skip these in the same
  // change, no rewrite needed.
  it.skip("runs the full prospecting flow — upload a real screenshot, review the AI-extracted facts, and polish the bio with one AI pass, with no 'generate final' step anywhere", async () => {
    stubFetchSequence([
      { body: { projects: [], globalRules: {} } },
      { body: { templates: [EMBALAGENS_TEMPLATE] } },
      {
        body: {
          project: {
            projectId: "emporio-rei-da-mussarela",
            name: "Empório Rei da Mussarela",
            isProspect: true,
            prospectSource: { handle: "@emporioreidamussarela", bio: "Loja de frios e Fatiados.", realFollowers: 4388, realPosts: 20, realFollowing: 35 },
          },
          extracted: {
            businessName: "Empório Rei da Mussarela",
            handle: "@emporioreidamussarela",
            nicheGuess: "delivery de frios e laticínios",
            bioText: "Loja de frios e Fatiados.",
            differentiators: ["Qualidade e preço justo", "O melhor preço de Cuiabá"],
            realFollowers: 4388,
            realPosts: 20,
            realFollowing: 35,
          },
        },
      },
      { body: { bio: "Frios selecionados e fatiados na hora, direto de Cuiabá." } },
    ]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova prospecção" }));

    const screenshotFile = new File(["fake-screenshot-bytes"], "perfil.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Print do perfil (Instagram)"), screenshotFile);

    // The review step pre-fills straight from what the AI read.
    const segmentInput = await screen.findByLabelText("Segmento/nicho");
    expect(segmentInput).toHaveValue("delivery de frios e laticínios");
    expect(screen.getByLabelText("Bio / descrição")).toHaveValue("Loja de frios e Fatiados.");
    expect(screen.getByLabelText("Diferenciais")).toHaveValue("Qualidade e preço justo; O melhor preço de Cuiabá");

    // There's no "generate final art" button anymore — the live preview
    // itself is the deliverable now.
    expect(screen.queryByRole("button", { name: /Gerar versão com arte real/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "✦ Melhorar com IA" }));

    expect(await screen.findByLabelText("Bio / descrição")).toHaveValue(
      "Frios selecionados e fatiados na hora, direto de Cuiabá.",
    );

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/segment-templates");
    expect(calls[2][0]).toBe("/api/prospects");
    expect(JSON.parse(calls[2][1].body as string).dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(calls[3][0]).toBe("/api/projects/emporio-rei-da-mussarela/improve-bio");
    expect(JSON.parse(calls[3][1].body as string)).toEqual({
      bio: "Loja de frios e Fatiados.",
      segment: "delivery de frios e laticínios",
      businessName: "Empório Rei da Mussarela",
    });
  });

  it.skip("shows the Instagram mockup preview instantly with the real extracted data, updating live as the operator types, with zero network calls beyond the initial page/upload ones", async () => {
    stubFetchSequence([
      { body: { projects: [], globalRules: {} } },
      { body: { templates: [EMBALAGENS_TEMPLATE] } },
      {
        body: {
          project: {
            projectId: "emporio-rei-da-mussarela",
            name: "Empório Rei da Mussarela",
            isProspect: true,
            prospectSource: { handle: "@emporioreidamussarela", bio: "Loja de frios e Fatiados.", realFollowers: 4388, realPosts: 20, realFollowing: 35 },
          },
          extracted: {
            businessName: "Empório Rei da Mussarela",
            handle: "@emporioreidamussarela",
            nicheGuess: "delivery de frios e laticínios",
            bioText: "Loja de frios e Fatiados.",
            differentiators: [],
            realFollowers: 4388,
            realPosts: 20,
            realFollowing: 35,
          },
        },
      },
    ]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova prospecção" }));
    const screenshotFile = new File(["fake-screenshot-bytes"], "perfil.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Print do perfil (Instagram)"), screenshotFile);
    await screen.findByLabelText("Segmento/nicho");

    // The real counts read off the screenshot render immediately — no
    // "gerar" click needed to see them.
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("4.4K")).toBeInTheDocument();

    const callsBeforeTyping = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const bioField = screen.getByLabelText("Bio / descrição");
    await userEvent.clear(bioField);
    await userEvent.type(bioField, "Nova bio digitada na hora");

    // The preview is a pure presentational re-render off local state —
    // typing must never itself trigger a request.
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsBeforeTyping);
    // Matches both the textarea's own value and the live preview's bio text
    // rendering the same string — either way, confirms the preview updated.
    expect(screen.getAllByText("Nova bio digitada na hora").length).toBeGreaterThan(0);
  });

  it.skip("shows the real approved template art (6 grid photos + 3 highlight photos) and recolors every tile instantly when the brand color changes, with zero network calls", async () => {
    stubFetchSequence([
      { body: { projects: [], globalRules: {} } },
      { body: { templates: [EMBALAGENS_TEMPLATE] } },
      {
        body: {
          project: { projectId: "prospect-embalagens", name: "Nova Embalagens", isProspect: true, prospectSource: {} },
          extracted: null,
        },
      },
    ]);

    const { container } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova prospecção" }));

    const screenshotFile = new File(["fake-screenshot-bytes"], "perfil.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Print do perfil (Instagram)"), screenshotFile);

    const segmentSelect = await screen.findByLabelText("Segmento (define os cards da grade)");
    expect(segmentSelect).toHaveValue("embalagens");

    // 6 feed pieces in the grid, real approved art — not stock photos or icons.
    const gridImages = [...container.querySelectorAll("img")].filter((img) =>
      img.getAttribute("src")?.startsWith("/api/segment-templates/embalagens/images/"),
    );
    expect(gridImages).toHaveLength(6 + 3); // 6 grid + 3 highlight bubbles
    expect(gridImages.some((img) => img.getAttribute("src") === "/api/segment-templates/embalagens/images/whatsapp-orders.png")).toBe(true);

    const callsBeforeColor = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const colorInput = screen.getByLabelText("Cor da marca (hex)");
    await userEvent.clear(colorInput);
    await userEvent.type(colorInput, "#123456");

    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsBeforeColor);
    expect(colorInput).toHaveValue("#123456");
    // The color overlay div sitting on top of each photo picks up the new
    // accent immediately — same re-render, no fetch.
    const overlays = [...container.querySelectorAll("div")].filter((div) => div.getAttribute("style")?.includes("mix-blend-mode"));
    expect(overlays.length).toBeGreaterThan(0);
    expect(overlays.every((div) => div.getAttribute("style")?.includes("rgb(18, 52, 86)"))).toBe(true);
  });

  it.skip("downloads a real PNG of the preview card through html-to-image, instead of opening the browser's print dialog", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    stubFetchSequence([
      { body: { projects: [], globalRules: {} } },
      { body: { templates: [EMBALAGENS_TEMPLATE] } },
      {
        body: {
          project: { projectId: "prospect-embalagens", name: "Nova Embalagens", isProspect: true, prospectSource: {} },
          extracted: null,
        },
      },
    ]);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText("Nenhum projeto ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova prospecção" }));
    const screenshotFile = new File(["fake-screenshot-bytes"], "perfil.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Print do perfil (Instagram)"), screenshotFile);
    await screen.findByLabelText("Segmento/nicho");

    expect(screen.queryByRole("button", { name: /Baixar\/Compartilhar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ver como/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Baixar PNG" }));

    await vi.waitFor(() => expect(toPngMock).toHaveBeenCalledTimes(1));
    expect(toPngMock.mock.calls[0][1]).toMatchObject({ pixelRatio: 3 });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
  });

  it("shows a catalog pill instead of Raio-X status for catalog projects", async () => {
    stubFetch({
      projects: [
        { projectId: "loja-celulares", name: "Loja de Celulares", token: {}, projectType: "catalog", brandXray: { status: "empty" } },
      ],
      globalRules: {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Loja de Celulares")).toBeInTheDocument();
    expect(screen.getByText("Catálogo de produtos")).toBeInTheDocument();
    expect(screen.queryByText("Raio-X pendente")).not.toBeInTheDocument();
  });
});
