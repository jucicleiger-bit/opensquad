import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => vi.unstubAllGlobals());

type Route = (url: string, init?: RequestInit) => unknown;
function stubApi(route: Route) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = route(url, init);
    return Promise.resolve({ ok: !(body as { __status?: number })?.__status, text: async () => JSON.stringify(body) });
  }));
  return calls;
}

const project = (ativo: boolean) => ({ projects: [{ projectId: "king", name: "King", videoAnimado: { ativo, projetosDeMaterial: [], whatsapp: "" }, contentStrategy: { offers: [{ id: "o1", name: "Encarte da semana" }], topicIdeas: { goals: { authority: { items: [{ id: "t1", title: "Diagnóstico antes do anúncio" }] } } } } }], globalRules: {} });

const roteiroPronto = {
  video: { id: "v1", projectId: "king", briefing: { assunto: "Bio", objetivo: "alcance", duracao: 15, tom: "criador", legenda: "pop" }, status: "roteiro_pronto", erro: null, criadoEm: "2026-10-10T10:00:00Z", atualizadoEm: "2026-10-10T10:05:00Z" },
  roteiro: { cenas: [{ tipo: "a", fala: "Sua bio tem os cinco?", descricao: "Pergunta" }, { tipo: "b", fala: "Comenta quantos!", descricao: "Enquete" }] },
  estimativa: 3.1, avisos: ["Tempo estimado 3.1s, a meta é 15s."], stills: [], arquivos: { video: false, narracaoMp3: false, narracaoTxt: false, legendaPost: false, notas: false }, vozUsada: null, ocupado: false,
};

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe("Vídeo animado", () => {
  it("only shows in the sidebar when the project has it on", async () => {
    stubApi((url) => (url === "/api/state" ? project(false) : { videos: [] }));
    renderAt("/projects/king/visao-geral");
    expect((await screen.findAllByText("King")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Vídeo animado" })).not.toBeInTheDocument();
  });

  it("creates a video from a registered subject with objective, duration, tone and caption", async () => {
    const calls = stubApi((url, init) => {
      if (url === "/api/state") return project(true);
      if (url.endsWith("/videos") && init?.method === "POST") return { video: { ...roteiroPronto.video, id: "v2", status: "roteiro_gerando" } };
      if (url.endsWith("/videos")) return { videos: [] };
      return { ...roteiroPronto, video: { ...roteiroPronto.video, id: "v2", status: "roteiro_gerando" }, roteiro: null, ocupado: true };
    });
    renderAt("/projects/king/video");
    await userEvent.click(await screen.findByRole("button", { name: "Novo vídeo" }));
    await userEvent.selectOptions(screen.getByLabelText("Importar assunto"), "Diagnóstico antes do anúncio");
    await userEvent.click(screen.getByRole("radio", { name: "Anúncio" }));
    await userEvent.click(screen.getByRole("radio", { name: "30s" }));
    await userEvent.selectOptions(screen.getByLabelText("Legenda"), "karaoke");
    await userEvent.click(screen.getByRole("button", { name: "Gerar roteiro" }));
    const post = calls.find((c) => c.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ assunto: "Diagnóstico antes do anúncio", objetivo: "anuncio", duracao: 30, tom: "criador", legenda: "karaoke" });
    expect(await screen.findByText(/Escrevendo o roteiro/)).toBeInTheDocument();
  });

  it("shows the script as editable scene cards with the time bar, saves and approves", async () => {
    const calls = stubApi((url, init) => {
      if (url === "/api/state") return project(true);
      if (url.endsWith("/videos")) return { videos: [{ id: "v1", assunto: "Bio", objetivo: "alcance", duracao: 15, status: "roteiro_pronto", erro: null, criadoEm: "", atualizadoEm: "", temVideo: false }] };
      if (url.endsWith("/roteiro")) return { roteiro: { cenas: JSON.parse(String(init?.body)).cenas } };
      if (url.endsWith("/aprovar-roteiro")) return { video: { ...roteiroPronto.video, status: "producao_gerando" } };
      return roteiroPronto;
    });
    renderAt("/projects/king/video?v=v1");
    const cards = await screen.findAllByTestId("cena");
    expect(cards).toHaveLength(2);
    // 5 words + 2 words at 2.6 words/s: 1.9s + 0.8s.
    expect(screen.getByText(/2.7s de 15s/)).toBeInTheDocument();
    expect(screen.getByText(/a meta é 15s/)).toBeInTheDocument();
    const fala = within(cards[0]).getByLabelText("Fala da cena 1");
    await userEvent.clear(fala);
    await userEvent.type(fala, "Sua bio convence?");
    await userEvent.click(screen.getByRole("button", { name: "Aprovar roteiro" }));
    const saved = calls.find((c) => c.url.endsWith("/roteiro"));
    expect(JSON.parse(String(saved?.init?.body)).cenas[0].fala).toBe("Sua bio convence?");
    expect(calls.some((c) => c.url.endsWith("/aprovar-roteiro"))).toBe(true);
  });

  it("final video offers the player, download, post caption and narration text", async () => {
    stubApi((url) => {
      if (url === "/api/state") return project(true);
      if (url.endsWith("/videos")) return { videos: [] };
      return { ...roteiroPronto, video: { ...roteiroPronto.video, status: "pronto" }, arquivos: { video: true, narracaoMp3: true, narracaoTxt: true, legendaPost: true, notas: true }, vozUsada: "gemini:Puck" };
    });
    renderAt("/projects/king/video?v=v1");
    expect(await screen.findByRole("link", { name: "Baixar MP4" })).toHaveAttribute("href", "/api/projects/king/videos/v1/arquivo/video.mp4");
    expect(screen.getByRole("link", { name: "Texto da narração" })).toHaveAttribute("href", "/api/projects/king/videos/v1/arquivo/voz/narracao.txt");
    expect(screen.getByRole("link", { name: "Legenda do post" })).toBeInTheDocument();
  });
});
