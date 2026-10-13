import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  createVideo, getVideo, listVideoProdutos, listVideos, requestVideoAdjustment, saveVideoRoteiro, videoAction, videoFileUrl,
  type VideoBriefing, type VideoCena, type VideoOfertaInput, type VideoProduto, type VideoState, type VideoStatus, type VideoSummary,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Skeleton } from "@/components/Skeleton";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import styles from "./VideoAnimado.module.css";

const ROTULO: Record<string, string> = {
  roteiro_gerando: "Escrevendo o roteiro…", roteiro_pronto: "Roteiro para revisar", producao_gerando: "Produzindo (voz, cenas e prévia)…",
  previa_pronta: "Prévia para revisar", render_gerando: "Gerando o vídeo final…", pronto: "Pronto", erro: "Erro",
  aguardando_limite: "Aguardando o limite do Claude Code", interrompido: "Interrompido",
};
// Shorter labels for the list badges, where space is tight.
const SELO: Record<VideoStatus, string> = {
  roteiro_gerando: "Escrevendo roteiro", roteiro_pronto: "Revisar roteiro", producao_gerando: "Produzindo",
  previa_pronta: "Revisar prévia", render_gerando: "Renderizando", pronto: "Pronto", erro: "Erro",
  aguardando_limite: "Aguardando limite", interrompido: "Interrompido",
};
const GERANDO = new Set(["roteiro_gerando", "producao_gerando", "render_gerando"]);
const FALHA = new Set(["erro", "interrompido", "aguardando_limite"]);
const LEGENDAS: Array<[VideoBriefing["legenda"], string]> = [["do-video", "Do vídeo (sob medida)"], ["simples", "Simples"], ["karaoke", "Karaokê"], ["pop", "Pop (palavra por vez)"], ["destaque", "Destaque"], ["caixa", "Caixa"], ["sem", "Sem legenda"]];
const MODELOS = new Set(["simples", "karaoke", "pop", "destaque", "caixa"]);
const LEGENDA_INFO: Record<VideoBriefing["legenda"], { titulo: string; ajuda: string }> = {
  "do-video": { titulo: "Do vídeo", ajuda: "Legenda criada junto com as cenas deste vídeo" },
  simples: { titulo: "Simples", ajuda: "Frase limpa com contorno, sem efeitos" },
  karaoke: { titulo: "Karaokê", ajuda: "A palavra falada acende no ritmo da voz" },
  pop: { titulo: "Pop", ajuda: "Uma palavra de cada vez, com impacto" },
  destaque: { titulo: "Destaque", ajuda: "Texto grande com a palavra-chave em cor" },
  caixa: { titulo: "Caixa", ajuda: "Texto numa caixa clara, fácil de ler" },
  sem: { titulo: "Sem legenda", ajuda: "Só a narração, sem texto na tela" },
};
const OBJETIVOS = [
  { v: "alcance", nome: "Alcance", ajuda: "Ganhar seguidores · fecha com enquete ou “salva e compartilha”", ideal: [20, 45] },
  { v: "anuncio", nome: "Anúncio", ajuda: "Converter no WhatsApp · fecha com chamada direta", ideal: [15, 30] },
  { v: "oferta", nome: "Oferta", ajuda: "VT de mercado com vários produtos e preços", ideal: [15, 60] },
  { v: "institucional", nome: "Institucional", ajuda: "Apresenta a empresa · fecha com a marca", ideal: [20, 45] },
  { v: "aviso", nome: "Aviso", ajuda: "Feriado, horário, novidade · curto e direto", ideal: [15, 15] },
] as const;
const TONS = [
  { v: "criador", nome: "Criador de conteúdo", curto: "Criador", ajuda: "Animado, sorrindo" },
  { v: "vendedor", nome: "Vendedor de bairro", curto: "Vendedor", ajuda: "Próximo, confiante" },
  { v: "locutor", nome: "Locutor de VT", curto: "Locutor", ajuda: "Propaganda de mercado, energia lá em cima" },
] as const;
const FORMATOS = [
  { v: "reels", nome: "Reels", ajuda: "Feed e Reels do Instagram" },
  { v: "status", nome: "Story/Status", ajuda: "Mais curto, fecha no WhatsApp" },
] as const;
const ESTILOS = [
  { v: "livre", nome: "Livre" }, { v: "dinamico", nome: "🔥 Dinâmico" }, { v: "mercado", nome: "🛒 Promoção de mercado" },
  { v: "premium", nome: "✨ Premium" }, { v: "informativo", nome: "📰 Informativo" },
] as const;
const ETAPAS = ["Roteiro", "Prévia", "Vídeo final"];
const PALAVRAS_POR_SEGUNDO = 2.6;
const segundos = (fala: string) => Math.round(((fala.match(/[\p{L}\d]+/gu) || []).length / PALAVRAS_POR_SEGUNDO) * 10) / 10;
// React sets `muted` only as a property, and Chrome then refuses to autoplay; the attribute makes the loop start.
const mudo = (el: HTMLVideoElement | null) => { if (el) el.defaultMuted = true; };
const NOMES_OBJETIVO: Record<string, string> = { alcance: "Alcance", anuncio: "Anúncio", oferta: "Oferta", institucional: "Institucional", aviso: "Aviso" };
const nomeObjetivo = (o: string) => NOMES_OBJETIVO[o] || o;
const nomeDuracao = (d: number | "auto") => (d === "auto" ? "Automático" : `${d}s`);
// Frames and pace mirror the server (content-central-video-produtos.js); automatic duration takes up to the maximum.
const MOLDURAS = [{ v: "encarte", nome: "Encarte", ajuda: "Fundo claro de panfleto, preço em selo" }, { v: "diagonal", nome: "Diagonal", ajuda: "Faixas inclinadas, ritmo de promoção" }, { v: "neon", nome: "Neon Premium", ajuda: "Fundo escuro com brilho neon" }] as const;
const NOMES_MOLDURA: Record<string, string> = { encarte: "Encarte", diagonal: "Diagonal", neon: "Neon Premium", auto: "A IA escolhe" };
const SEGUNDOS = { rapido: 3, calmo: 4 } as const;
const MAX_PRODUTOS = 12;
const limiteProdutos = (duracao: number | "auto", ritmo: "rapido" | "calmo") => (duracao === "auto" ? MAX_PRODUTOS : Math.min(MAX_PRODUTOS, Math.floor((duracao - 6) / SEGUNDOS[ritmo])));
const CRIACOES = [
  { v: "nova", nome: "Criação nova", ajuda: "O Claude cria um VT único · ~15 min" },
  { v: "padrao", nome: "VT padrão", ajuda: "Modelo fixo nas cores da marca · ~5 min" },
] as const;
// "2026-10-12" -> "12/10" without going through Date, so the time zone cannot shift the day.
const diaMes = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

type Tom = "gen" | "review" | "ok" | "bad" | "warn";
function tomDoStatus(s: string): Tom {
  if (GERANDO.has(s)) return "gen";
  if (s === "pronto") return "ok";
  if (s === "aguardando_limite") return "warn";
  if (FALHA.has(s)) return "bad";
  return "review";
}
// Which of Roteiro / Prévia / Vídeo is in play; -1 when the status alone can't tell (failures).
function etapaDoStatus(s: string): number {
  if (s === "roteiro_gerando" || s === "roteiro_pronto") return 0;
  if (s === "producao_gerando" || s === "previa_pronta") return 1;
  if (s === "render_gerando" || s === "pronto") return 2;
  return -1;
}
function dataCurta(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return `Hoje, ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
function decorrido(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60000);
  return min < 1 ? "há menos de 1 min" : min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h ${min % 60} min`;
}

const ICONES: Record<string, string> = {
  play: "M8 5.5v13l10.5-6.5z",
  pause: "M8 5.5h2.8v13H8zM13.2 5.5H16v13h-2.8z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  film: "M4 9.5h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 9.5l.9-3.6A1.5 1.5 0 0 1 6.7 4.8L19 3.6l.6 3.4L4 9.5M9.2 4.4l1.4 4M14.4 3.9l1.4 4.1",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2l.9-12.5",
  alert: "M12 4l9 15.5H3zM12 10v4M12 17v.01",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M12 7.5V12l3 2",
  sparkle: "M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  script: "M7 3.5h7l4 4v13H7zM14 3.5v4h4M10 12h5M10 15.5h5",
  eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5",
  download: "M12 4v11M7 10.5l5 5 5-5M5 19.5h14",
  copy: "M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9",
  back: "M19 12H5M11 6l-6 6 6 6",
  captions: "M3.5 5.5h17v13h-17zM7 11h4M13 11h4M7 14.5h7",
  nocaptions: "M3.5 5.5h17v13h-17zM7 14.5h4M5 4l14 16",
  mic: "M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5V21",
  retry: "M20 12a8 8 0 1 1-2.3-5.6M20 4.5v4h-4",
  doc: "M7 3.5h7l4 4v13H7zM14 3.5v4h4",
  plus: "M12 5v14M5 12h14",
};
const CHEIOS = new Set(["play", "pause"]);
function Icon({ name, size = 18 }: { name: keyof typeof ICONES; size?: number }) {
  const cheio = CHEIOS.has(name);
  return (
    <svg className={styles.icon} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={cheio ? "currentColor" : "none"} stroke={cheio ? "none" : "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONES[name]} />
    </svg>
  );
}
const ICONE_STATUS: Record<VideoStatus, keyof typeof ICONES> = {
  roteiro_gerando: "sparkle", producao_gerando: "sparkle", render_gerando: "sparkle", roteiro_pronto: "script", previa_pronta: "eye",
  pronto: "film", erro: "alert", interrompido: "alert", aguardando_limite: "clock",
};

function Selo({ status }: { status: VideoStatus }) {
  return <span className={styles.badge} data-tom={tomDoStatus(status)}>{SELO[status] || status}</span>;
}

function MiniEtapas({ status }: { status: VideoStatus }) {
  const atual = etapaDoStatus(status);
  const tudo = status === "pronto";
  // Lives inside the card's <button>, so spans only; the badge already tells screen readers the status.
  return (
    <span className={styles.miniSteps} aria-hidden="true">
      {["Roteiro", "Prévia", "Vídeo"].map((e, i) => (
        <span key={e} data-estado={tudo || i < atual ? "feito" : i === atual ? "atual" : "fila"}>{e}</span>
      ))}
    </span>
  );
}

export function VideoAnimado() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [params, setParams] = useSearchParams();
  const selected = params.get("v");
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => listVideos(project.projectId).then((r) => setVideos(r.videos)).catch((e: Error) => setError(e.message)), [project.projectId]);
  useEffect(() => { reload(); }, [reload]);
  const open = (id: string | null) => setParams(id ? { v: id } : {});
  // The list comes newest first, but sort anyway so the default never depends on it.
  const ultimaMoldura = ([...(videos || [])].filter((v) => v.objetivo === "oferta" && v.moldura).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0]?.moldura || null) as VideoOfertaInput["moldura"] | null;
  const comecar = () => { setNovo(true); open(null); };

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h2 className={styles.pageTitle}>Vídeo animado</h2>
          <p className={styles.pageSub}>Reels criados do zero a partir de um assunto: você aprova o roteiro e a prévia antes do vídeo final.</p>
        </div>
        <Button type="button" onClick={comecar}><Icon name="plus" />Novo vídeo</Button>
      </header>
      {error ? <div className="pill bad">{error}</div> : null}
      {novo ? <NovoVideo project={project} ultimaMoldura={ultimaMoldura} onCreated={(id) => { setNovo(false); reload(); open(id); }} onCancel={() => setNovo(false)} /> : null}
      {selected ? <VideoDetalhe projectId={project.projectId} videoId={selected} onChanged={reload} onClose={() => open(null)} /> : null}
      {!selected && !novo ? (
        videos === null ? (
          <div className={styles.grid}>{[0, 1, 2].map((i) => <Skeleton key={i} height={420} />)}</div>
        ) : videos.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nenhum vídeo ainda.</p>
            <p className="muted">Escolha um assunto, aprove o roteiro e a prévia, e o Reel sai pronto para postar.</p>
            <Button type="button" onClick={comecar}>Criar o primeiro vídeo</Button>
          </div>
        ) : (
          <ul className={styles.grid}>
            {videos.map((v) => (
              <li key={v.id}>
                <button type="button" className={styles.videoCard} onClick={() => open(v.id)}>
                  <span className={styles.thumb} data-tom={tomDoStatus(v.status)}>
                    {v.temVideo
                      ? <video src={`${videoFileUrl(project.projectId, v.id, "video.mp4")}#t=0.5`} muted preload="metadata" />
                      : <span className={styles.thumbIcon}><Icon name={ICONE_STATUS[v.status] || "film"} size={30} /></span>}
                    <Selo status={v.status} />
                  </span>
                  <span className={styles.cardBody}>
                    <span className={styles.cardTitle}>{v.assunto}</span>
                    <span className={styles.chips}>
                      <span className={styles.chip}>{nomeObjetivo(v.objetivo)}</span>
                      <span className={styles.chip}>{nomeDuracao(v.duracao)}</span>
                      <span className={styles.date}>{dataCurta(v.criadoEm)}</span>
                    </span>
                    <MiniEtapas status={v.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function Secao({ n, titulo, ajuda, id, children }: { n: number; titulo: string; ajuda: string; id: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.num} aria-hidden="true">{n}</span>
        <div>
          <h3 id={id} className={styles.sectionTitle}>{titulo}</h3>
          <p className={styles.sectionHelp}>{ajuda}</p>
        </div>
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function NovoVideo({ project, ultimaMoldura, onCreated, onCancel }: { project: WorkspaceContext["project"]; ultimaMoldura: VideoOfertaInput["moldura"] | null; onCreated: (id: string) => void; onCancel: () => void }) {
  const [b, setB] = useState<VideoBriefing>({ assunto: "", objetivo: "alcance", formato: "reels", estilo: "livre", duracao: 30, tom: "criador", legenda: "do-video", observacao: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tocando, setTocando] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const uid = useId();
  const assuntos = useMemo(() => {
    const ofertas = (project.contentStrategy?.offers || []).map((o) => (o as { name?: string }).name).filter(Boolean) as string[];
    const banco = Object.values(project.contentStrategy?.topicIdeas?.goals || {}).flatMap((g) => (g.items || []).map((i) => i.title));
    return [...new Set([...ofertas, ...banco])];
  }, [project]);
  const set = <K extends keyof VideoBriefing>(k: K, v: VideoBriefing[K]) => setB((prev) => ({ ...prev, [k]: v }));
  useEffect(() => () => audio.current?.pause(), []);
  const [produtos, setProdutos] = useState<VideoProduto[] | null>(null);
  // Click order is the order in the video.
  const [escolhidos, setEscolhidos] = useState<Array<{ id: string; foto: "recorte" | "moldura" }>>([]);
  const [validoAte, setValidoAte] = useState("");
  const [validadeMexida, setValidadeMexida] = useState(false);
  const [criacao, setCriacao] = useState<"nova" | "padrao">("nova");
  // null = untouched, so the last-used frame still applies if the list arrives after the form opens.
  const [molduraEscolhida, setMolduraEscolhida] = useState<VideoOfertaInput["moldura"] | null>(null);
  const moldura = molduraEscolhida ?? ultimaMoldura ?? "encarte";
  const [ritmo, setRitmo] = useState<VideoOfertaInput["ritmo"]>("rapido");
  const [campanha, setCampanha] = useState("");
  useEffect(() => {
    if (b.objetivo !== "oferta" || produtos) return;
    listVideoProdutos(project.projectId).then((r) => setProdutos(r.produtos)).catch((e) => setError((e as Error).message));
  }, [b.objetivo, produtos, project.projectId]);
  // "Válido até" follows the earliest validity among the picked products until the operator edits it.
  useEffect(() => {
    if (validadeMexida || !produtos) return;
    const datas = escolhidos.map((e) => produtos.find((p) => p.id === e.id)?.validoAte).filter(Boolean).sort() as string[];
    setValidoAte(datas[0] || "");
  }, [escolhidos, produtos, validadeMexida]);
  // Oferta is narrated by the locutor and shows no caption (the price is the text on
  // screen); leaving it hands the voice and caption back to the defaults.
  function escolherObjetivo(v: VideoBriefing["objetivo"]) {
    setB((prev) => ({
      ...prev, objetivo: v, tom: v === "oferta" ? "locutor" : prev.tom === "locutor" ? "criador" : prev.tom,
      legenda: v === "oferta" ? "sem" : prev.objetivo === "oferta" && prev.legenda === "sem" ? "do-video" : prev.legenda,
      assunto: v === "oferta" && !prev.assunto.trim() ? "Ofertas da semana" : prev.assunto,
    }));
  }
  function alternarProduto(p: VideoProduto) {
    setEscolhidos((es) => (es.some((e) => e.id === p.id) ? es.filter((e) => e.id !== p.id) : [...es, { id: p.id, foto: p.fotoTipo === "fundo" ? "moldura" : "recorte" }]));
  }

  // One sample at a time; the button sits outside the option's label so it never changes the selection.
  function amostra(tom: string) {
    audio.current?.pause();
    if (tocando === tom) { setTocando(null); return; }
    const a = new Audio(`/video-vozes/${tom}.mp3`);
    a.onended = () => setTocando(null);
    audio.current = a;
    setTocando(tom);
    Promise.resolve(a.play()).catch(() => setTocando(null));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try { onCreated((await createVideo(project.projectId, body)).video.id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const oferta = b.objetivo === "oferta";
  const limite = limiteProdutos(b.duracao, ritmo);
  const excedeu = oferta && escolhidos.length > limite;
  const faltaProduto = oferta && escolhidos.length === 0;
  const padrao = oferta && criacao === "padrao";
  const body: VideoBriefing = oferta
    ? { ...b, estilo: padrao ? "livre" : b.estilo, oferta: { produtos: escolhidos, validoAte, criacao, moldura, ritmo, campanha: campanha.trim() || "Ofertas da Semana" } }
    : b;
  // Sections are numbered in render order, since Produtos and Estilo come and go.
  let n = 0;
  const objetivo = OBJETIVOS.find((o) => o.v === b.objetivo)!;
  const foraDoIdeal = b.duracao !== "auto" && (b.duracao < objetivo.ideal[0] || b.duracao > objetivo.ideal[1]);
  const resumo = [objetivo.nome, nomeDuracao(b.duracao), FORMATOS.find((f) => f.v === b.formato)!.nome, TONS.find((t) => t.v === b.tom)!.curto, b.legenda === "do-video" ? "Legenda do vídeo" : LEGENDA_INFO[b.legenda].titulo].join(" · ");
  const resumoCompleto = [resumo, oferta ? `${escolhidos.length} produto${escolhidos.length === 1 ? "" : "s"}` : "", oferta ? NOMES_MOLDURA[moldura] : "", oferta ? (ritmo === "rapido" ? "Rápido" : "Calmo") : "", padrao ? "VT padrão" : ""].filter(Boolean).join(" · ");

  return (
    <Card className={styles.form}>
      <Secao n={++n} id={`${uid}-assunto`} titulo="Assunto" ajuda="Sobre o que é o Reel. Uma frase basta: o roteiro sai dela.">
        <input aria-labelledby={`${uid}-assunto`} value={b.assunto} onChange={(e) => set("assunto", e.target.value)} placeholder="Ex.: O que colocar na bio do Instagram" />
        {assuntos.length ? (
          <div className={styles.suggest}>
            <span className={styles.suggestLabel}>Sugestões</span>
            <div className={styles.suggestChips}>
              {assuntos.slice(0, 8).map((a) => (
                <button key={a} type="button" className={styles.suggestChip} aria-pressed={b.assunto === a} onClick={() => set("assunto", a)}>{a}</button>
              ))}
            </div>
            <select className={styles.suggestAll} aria-label="Importar assunto" value="" onChange={(e) => e.target.value && set("assunto", e.target.value)}>
              <option value="">Ver todos os {assuntos.length} assuntos…</option>
              {assuntos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        ) : null}
      </Secao>

      <Secao n={++n} id={`${uid}-obj`} titulo="Objetivo" ajuda="Muda o tom do roteiro e como o vídeo termina.">
        <div role="radiogroup" aria-labelledby={`${uid}-obj`} className={styles.options5}>
          {OBJETIVOS.map((o) => (
            <label key={o.v} className={styles.option}>
              <input type="radio" className="sr-only" name="objetivo" aria-label={o.nome} checked={b.objetivo === o.v} onChange={() => escolherObjetivo(o.v)} />
              <span className={styles.optionCheck} aria-hidden="true"><Icon name="check" size={14} /></span>
              <span className={styles.optionName}>{o.nome}</span>
              <span className={styles.optionHelp}>{o.ajuda}</span>
            </label>
          ))}
        </div>
      </Secao>

      {oferta ? (
        <Secao n={++n} id={`${uid}-prod`} titulo="Produtos da oferta" ajuda="Só entram produtos cadastrados com preço. Os preços são travados pelo cadastro; a ordem do clique é a ordem no vídeo.">
          {produtos === null ? <Skeleton height={140} /> : produtos.length === 0 ? <p className={styles.hint}>Nenhum produto cadastrado neste projeto.</p> : (
            <div role="group" aria-label="Produtos" className={styles.produtos}>
              {produtos.map((p) => {
                const pos = escolhidos.findIndex((e) => e.id === p.id);
                const escolhido = pos >= 0;
                return (
                  <div key={p.id} className={styles.produto} data-escolhido={escolhido} data-bloqueado={Boolean(p.motivo)}>
                    <label className={styles.produtoCard}>
                      <input type="checkbox" className="sr-only" aria-label={`${p.nome} ${p.precoTela}`} checked={escolhido} disabled={Boolean(p.motivo)} onChange={() => alternarProduto(p)} />
                      <span className={styles.produtoFoto}>
                        {p.previewUrl ? <img src={p.previewUrl} alt="" loading="lazy" /> : null}
                        {escolhido ? <span className={styles.produtoPos} aria-hidden="true">{pos + 1}</span> : null}
                      </span>
                      <span className={styles.produtoNome}>{p.nome}</span>
                      {p.motivo ? <span className={styles.produtoMotivo}>{p.motivo}</span> : (
                        <span className={styles.produtoPreco}>
                          {p.precoDeTela ? <s className={styles.precoDe}>{p.precoDeTela}</s> : null}
                          <b>{p.precoTela}</b>
                        </span>
                      )}
                      {p.fotoTipo === "fundo" ? <span className={styles.produtoNota}>vai em moldura</span> : null}
                    </label>
                    {p.fotoTipo === "branco" && escolhido ? (
                      <div role="radiogroup" aria-label={`Foto de ${p.nome}`} className={styles.fotoModo}>
                        {([["recorte", "Recortar"], ["moldura", "Moldura"]] as const).map(([v, nome]) => (
                          <label key={v} className={styles.fotoOpcao}>
                            <input type="radio" className="sr-only" name={`foto-${p.id}`} aria-label={nome} checked={escolhidos[pos].foto === v}
                              onChange={() => setEscolhidos((es) => es.map((e) => (e.id === p.id ? { ...e, foto: v } : e)))} />{nome}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className={styles.hint} data-fora={excedeu}>
            <span className={styles.contador} data-fora={excedeu}>{`${escolhidos.length} de ${limite}`}</span>
            {excedeu ? <><Icon name="alert" size={15} />{`${nomeDuracao(b.duracao)} cabe até ${limite} produtos.`}</> : escolhidos.length === 0 ? "Escolha pelo menos um produto." : null}
          </p>
          <label className={styles.field}>Válido até
            <input type="date" className={styles.data} value={validoAte} onChange={(e) => { setValidadeMexida(true); setValidoAte(e.target.value); }} />
          </label>
          <div role="radiogroup" aria-label="Criação" className={styles.options2}>
            {CRIACOES.map((c) => (
              <label key={c.v} className={styles.option}>
                <input type="radio" className="sr-only" name="criacao" aria-label={c.nome} checked={criacao === c.v} onChange={() => setCriacao(c.v)} />
                <span className={styles.optionCheck} aria-hidden="true"><Icon name="check" size={14} /></span>
                <span className={styles.optionName}>{c.nome}</span>
                <span className={styles.optionHelp}>{c.ajuda}</span>
              </label>
            ))}
          </div>
          <div role="radiogroup" aria-label="Moldura" className={styles.gallery}>
            {[...MOLDURAS, { v: "auto", nome: "✨ A IA escolhe", ajuda: "A IA escolhe pela época e pelo assunto" }].map((m) => (
              <label key={m.v} className={styles.tile}>
                <input type="radio" className="sr-only" name="moldura" aria-label={m.nome} checked={moldura === m.v} onChange={() => setMolduraEscolhida(m.v as VideoOfertaInput["moldura"])} />
                <span className={styles.tileMedia}>
                  {m.v === "auto"
                    ? <span className={styles.tileIcon} style={{ fontSize: 30 }} aria-hidden="true">✨</span>
                    : <video ref={mudo} src={`/video-molduras/${m.v}.mp4`} autoPlay loop muted playsInline preload="auto" aria-hidden="true" />}
                  <span className={styles.tileCheck} aria-hidden="true"><Icon name="check" size={14} /></span>
                </span>
                <span className={styles.tileName}>{m.nome}</span>
                <span className={styles.tileHelp}>{m.ajuda}</span>
              </label>
            ))}
          </div>
          <div role="radiogroup" aria-label="Ritmo" className={styles.segmented}>
            {([["rapido", "Rápido"], ["calmo", "Calmo"]] as const).map(([v, nome]) => (
              <label key={v} className={styles.segment}>
                <input type="radio" className="sr-only" name="ritmo" aria-label={`${nome} (${SEGUNDOS[v]} s)`} checked={ritmo === v} onChange={() => setRitmo(v)} />{nome} ({SEGUNDOS[v]} s)
              </label>
            ))}
          </div>
          <label className={styles.field}>Selo da campanha
            <input type="text" maxLength={30} value={campanha} onChange={(e) => setCampanha(e.target.value)} placeholder="Ofertas da Semana" />
          </label>
        </Secao>
      ) : null}

      <Secao n={++n} id={`${uid}-fmt`} titulo="Formato" ajuda="Onde o vídeo vai ser postado.">
        <div role="radiogroup" aria-labelledby={`${uid}-fmt`} className={styles.options2}>
          {FORMATOS.map((f) => (
            <label key={f.v} className={styles.option}>
              <input type="radio" className="sr-only" name="formato" aria-label={f.nome} checked={b.formato === f.v} onChange={() => set("formato", f.v)} />
              <span className={styles.optionCheck} aria-hidden="true"><Icon name="check" size={14} /></span>
              <span className={styles.optionName}>{f.nome}</span>
              <span className={styles.optionHelp}>{f.ajuda}</span>
            </label>
          ))}
        </div>
      </Secao>

      <Secao n={++n} id={`${uid}-dur`} titulo="Duração" ajuda="Tempo alvo do vídeo. O roteiro mostra quanto a fala ocupa de verdade.">
        <div role="radiogroup" aria-labelledby={`${uid}-dur`} className={styles.segmented}>
          {([15, 30, 45, 60] as const).map((d) => (
            <label key={d} className={styles.segment} data-ideal={d >= objetivo.ideal[0] && d <= objetivo.ideal[1]}>
              <input type="radio" className="sr-only" name="duracao" checked={b.duracao === d} onChange={() => set("duracao", d)} />{d}s
            </label>
          ))}
          <label className={styles.segment}>
            <input type="radio" className="sr-only" name="duracao" aria-label="Automático" checked={b.duracao === "auto"} onChange={() => set("duracao", "auto")} />Automático ✨
          </label>
        </div>
        <p className={styles.hint} data-fora={foraDoIdeal}>
          {foraDoIdeal ? <Icon name="alert" size={15} /> : null}
          {foraDoIdeal
            ? `${b.duracao}s fica fora do ideal para ${objetivo.nome.toLowerCase()} (${objetivo.ideal[0]}–${objetivo.ideal[1]} s). Dá para usar, mas a retenção costuma cair.`
            : b.duracao === "auto"
              ? "Automático: o roteiro escolhe o tempo pelo conteúdo."
              : `Ideal para ${objetivo.nome.toLowerCase()}: ${objetivo.ideal[0]}–${objetivo.ideal[1]} s.`}
        </p>
      </Secao>

      <Secao n={++n} id={`${uid}-voz`} titulo="Voz" ajuda="Quem narra. Toque no play para ouvir uma amostra.">
        <div role="radiogroup" aria-labelledby={`${uid}-voz`} className={styles.options3}>
          {TONS.map((t) => (
            <div key={t.v} className={styles.voiceWrap}>
              <label className={`${styles.option} ${styles.voice}`}>
                <input type="radio" className="sr-only" name="tom" aria-label={t.nome} checked={b.tom === t.v} onChange={() => set("tom", t.v)} />
                <span className={styles.optionCheck} aria-hidden="true"><Icon name="check" size={14} /></span>
                <span className={styles.optionName}>{t.nome}</span>
                <span className={styles.optionHelp}>{t.ajuda}</span>
              </label>
              <button type="button" className={styles.playBtn} data-on={tocando === t.v} onClick={() => amostra(t.v)}
                aria-label={`${tocando === t.v ? "Pausar" : "Ouvir"} amostra: ${t.nome}`}>
                <Icon name={tocando === t.v ? "pause" : "play"} size={16} />
              </button>
            </div>
          ))}
        </div>
      </Secao>

      {padrao ? null : (
        <Secao n={++n} id={`${uid}-est`} titulo="Estilo" ajuda="O clima visual e de ritmo do vídeo.">
          <div role="radiogroup" aria-labelledby={`${uid}-est`} className={styles.chipsRow}>
            {ESTILOS.map((e) => (
              <label key={e.v} className={styles.suggestChip}>
                <input type="radio" className="sr-only" name="estilo" aria-label={e.nome.replace(/^\S+\s/, "")} checked={b.estilo === e.v} onChange={() => set("estilo", e.v)} />{e.nome}
              </label>
            ))}
          </div>
        </Secao>
      )}

      <Secao n={++n} id={`${uid}-leg`} titulo="Legenda" ajuda="Veja cada estilo rodando antes de escolher.">
        <div role="radiogroup" aria-labelledby={`${uid}-leg`} className={styles.gallery}>
          {LEGENDAS.map(([v, l]) => (
            <label key={v} className={styles.tile}>
              <input type="radio" className="sr-only" name="legenda" aria-label={l} checked={b.legenda === v} onChange={() => set("legenda", v)} />
              <span className={styles.tileMedia} data-tipo={v}>
                {MODELOS.has(v)
                  ? <video ref={mudo} src={`/video-legendas/${v}.mp4`} autoPlay loop muted playsInline preload="auto" aria-hidden="true" />
                  : <span className={styles.tileIcon}><Icon name={v === "sem" ? "nocaptions" : "captions"} size={34} /></span>}
                <span className={styles.tileCheck} aria-hidden="true"><Icon name="check" size={14} /></span>
                {v === "do-video" ? <span className={styles.tileTag}>Padrão</span> : null}
              </span>
              <span className={styles.tileName}>{LEGENDA_INFO[v].titulo}</span>
              <span className={styles.tileHelp}>{LEGENDA_INFO[v].ajuda}</span>
            </label>
          ))}
        </div>
      </Secao>

      <Secao n={++n} id={`${uid}-obs`} titulo="Observação (opcional)" ajuda="Algo que o roteiro precisa citar ou evitar.">
        <textarea aria-labelledby={`${uid}-obs`} value={b.observacao} onChange={(e) => set("observacao", e.target.value)} placeholder="Ex.: citar o preço do plano mensal" />
      </Secao>

      <div className={styles.actionBar}>
        <span className={styles.summary}>{resumoCompleto}</span>
        {error ? <div className="pill bad">{error}</div> : null}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="button" disabled={busy || !b.assunto.trim() || excedeu || faltaProduto} onClick={submit}>{busy ? "Enviando…" : "Gerar roteiro"}</Button>
        </div>
      </div>
    </Card>
  );
}

function Etapas({ status, falhou }: { status: VideoStatus; falhou: number }) {
  const atual = FALHA.has(status) ? falhou : etapaDoStatus(status);
  return (
    <ol className={styles.steps}>
      {ETAPAS.map((e, i) => {
        const estado = status === "pronto" || i < atual ? "feito" : i === atual ? (FALHA.has(status) ? "falhou" : "atual") : "fila";
        return (
          <li key={e} data-estado={estado} aria-current={estado === "atual" ? "step" : undefined}>
            <span className={styles.stepDot}>{estado === "feito" ? <Icon name="check" size={13} /> : i + 1}</span>
            <span>{e}</span>
          </li>
        );
      })}
    </ol>
  );
}

function VideoDetalhe({ projectId, videoId, onChanged, onClose }: { projectId: string; videoId: string; onChanged: () => void; onClose: () => void }) {
  const [state, setState] = useState<VideoState | null>(null);
  const [cenas, setCenas] = useState<VideoCena[]>([]);
  const [ajuste, setAjuste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [still, setStill] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const load = useCallback(() => getVideo(projectId, videoId).then((s) => { setState(s); setCenas(s.roteiro?.cenas || []); return s; }), [projectId, videoId]);

  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  // Jobs keep running on the server; poll while one runs.
  useEffect(() => {
    if (!state || !GERANDO.has(state.video.status)) return;
    const timer = setInterval(() => { load().then((s) => { if (!GERANDO.has(s.video.status)) onChanged(); }).catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [state, load, onChanged]);

  if (!state) return error ? <div className="pill bad">{error}</div> : <Card className={styles.detail}><Skeleton height={28} width="50%" /><Skeleton height={44} /><Skeleton height={220} /></Card>;
  const { video } = state;
  const file = (name: string) => videoFileUrl(projectId, videoId, name);
  const run = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try { await fn(); setAjuste(""); await load(); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  const total = Math.round((cenas.reduce((n, c) => n + segundos(c.fala) + (c.segura || 0), 0)) * 10) / 10;
  const meta = video.briefing.duracao;
  const oferta = video.briefing.oferta;
  const precosEm = oferta && "precosEm" in oferta ? oferta.precosEm : "";
  const padrao = oferta?.criacao === "padrao";
  const produtoDe = (c: VideoCena) => (c.produto ? (state.produtos || []).find((p) => p.id === c.produto) : undefined);
  // With automatic duration there is no target to measure against.
  const alvo = meta === "auto" ? total : meta;
  const escala = Math.max(alvo * 1.3, total * 1.05);
  const desvio = meta === "auto" ? null : total < alvo * 0.85 ? "curto" : total > alvo * 1.15 ? "longo" : null;
  const move = (i: number, d: number) => setCenas((cs) => { const next = [...cs]; const [c] = next.splice(i, 1); next.splice(i + d, 0, c); return next; });
  // Same choice as the server's retry: the field recorded for the current status.
  const falhou = Math.max(0, video.status === "interrompido"
    ? etapaDoStatus(video.etapaInterrompida || "")
    : ["roteiro", "producao", "render"].indexOf(video.etapaComErro || ""));
  async function copiarLegenda() {
    setError(null);
    try {
      await navigator.clipboard.writeText(await (await fetch(file("legenda-post.txt"))).text());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch (e) { setError(`Não deu para copiar: ${(e as Error).message}`); }
  }

  return (
    <Card className={styles.detail}>
      <div className={styles.detailHead}>
        <Button type="button" variant="ghost" className={styles.back} onClick={onClose}><Icon name="back" />Voltar à lista</Button>
        <h3 className={styles.detailTitle}>{video.briefing.assunto}</h3>
        <div className={styles.chips}>
          <span className={styles.chip}>{nomeObjetivo(video.briefing.objetivo)}</span>
          <span className={styles.chip}>{nomeDuracao(meta)}</span>
          {precosEm ? <span className={styles.chip}>{`preços de ${diaMes(precosEm)}`}</span> : null}
          {padrao ? <span className={styles.chip}>VT padrão</span> : null}
          {oferta?.moldura ? <span className={styles.chip}>{`Moldura ${NOMES_MOLDURA[oferta.moldura === "auto" && state.roteiro?.moldura ? state.roteiro.moldura : oferta.moldura] || oferta.moldura}`}</span> : null}
        </div>
      </div>
      <Etapas status={video.status} falhou={falhou} />

      {GERANDO.has(video.status) ? (
        <div className={styles.working} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <p className={styles.panelTitle}>{ROTULO[video.status]}</p>
            <p className={styles.panelText}>Começou {decorrido(video.atualizadoEm)}. Você pode sair desta tela; o trabalho continua.</p>
          </div>
        </div>
      ) : null}

      {FALHA.has(video.status) ? (
        <div className={styles.alert} data-tom={tomDoStatus(video.status)} role="alert">
          <Icon name={video.status === "aguardando_limite" ? "clock" : "alert"} size={22} />
          <div>
            <p className={styles.panelTitle}>{ROTULO[video.status]}</p>
            {video.erro ? <p className={styles.panelText}>{video.erro}</p> : null}
          </div>
          <Button type="button" onClick={run(() => videoAction(projectId, videoId, "retomar"))}><Icon name="retry" />Tentar de novo</Button>
        </div>
      ) : video.erro ? <div className="pill bad">{video.erro}</div> : null}
      {error ? <div className="pill bad">{error}</div> : null}

      {video.status === "roteiro_pronto" ? (
        <section className={styles.stage}>
          <div className={styles.stageHead}>
            <h4 className={styles.stageTitle}>{ROTULO.roteiro_pronto}</h4>
            <p className={styles.panelText}>Edite as falas, reordene ou apague cenas. A barra mostra o tempo estimado contra a meta.</p>
          </div>
          <div className={styles.timebar} data-desvio={desvio || undefined}>
            <div className={styles.track}>
              <span className={styles.fill} style={{ width: `${Math.min(100, (total / escala) * 100)}%` }} />
              <span className={styles.target} style={{ left: `${(alvo / escala) * 100}%` }} title={`Meta ${nomeDuracao(meta)}`} />
            </div>
            <span className={styles.timeText}>{meta === "auto" ? `${total}s` : `${total}s de ${meta}s`}</span>
            {desvio ? <span className={styles.timeFlag}>{desvio === "curto" ? "Curto" : "Longo"} demais</span> : null}
          </div>
          {state.avisos.map((a) => <div key={a} className={styles.notice}><Icon name="alert" size={15} />{a}</div>)}
          <ol className={styles.cenas}>
            {cenas.map((c, i) => {
              const prod = produtoDe(c);
              return (
              <li key={i} data-testid="cena" className={styles.cena}>
                <span className={styles.cenaNum}>{i + 1}</span>
                <div className={styles.cenaMain}>
                  {prod ? (
                    <div className={styles.cenaProduto}>
                      {prod.foto ? <img src={file(prod.foto)} alt={prod.nome} /> : null}
                      <span className={styles.produtoNome}>{prod.nome}</span>
                      {prod.precoDeTela ? <s className={styles.precoDe}>{prod.precoDeTela}</s> : null}
                      <span className={styles.chip}>{prod.precoTela}</span>
                    </div>
                  ) : null}
                  <textarea aria-label={`Fala da cena ${i + 1}`} value={c.fala} rows={2} onChange={(e) => setCenas((cs) => cs.map((x, j) => (j === i ? { ...x, fala: e.target.value } : x)))} />
                  <p className={styles.cenaDesc}><Icon name="film" size={14} />{c.descricao}</p>
                </div>
                <div className={styles.cenaSide}>
                  <span className={styles.chip}>~{segundos(c.fala)}s</span>
                  <div className={styles.iconBtns}>
                    <button type="button" className={styles.iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir cena ${i + 1}`}><Icon name="up" size={16} /></button>
                    <button type="button" className={styles.iconBtn} disabled={i === cenas.length - 1} onClick={() => move(i, 1)} aria-label={`Descer cena ${i + 1}`}><Icon name="down" size={16} /></button>
                    <button type="button" className={`${styles.iconBtn} ${styles.danger}`} onClick={() => setCenas((cs) => cs.filter((_, j) => j !== i))} aria-label={`Apagar cena ${i + 1}`}><Icon name="trash" size={16} /></button>
                  </div>
                </div>
              </li>
              );
            })}
          </ol>
          <label className={styles.field}>Pedir ajuste no roteiro<textarea value={ajuste} onChange={(e) => setAjuste(e.target.value)} placeholder="Ex.: abrir com uma pergunta mais direta" /></label>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={!ajuste.trim() || cenas.length === 0} onClick={run(async () => { await saveVideoRoteiro(projectId, videoId, cenas); await requestVideoAdjustment(projectId, videoId, "roteiro", ajuste); })}>Pedir ajuste</Button>
            <Button type="button" disabled={cenas.length === 0} onClick={run(async () => { await saveVideoRoteiro(projectId, videoId, cenas); await videoAction(projectId, videoId, "aprovar-roteiro"); })}>Aprovar roteiro</Button>
          </div>
        </section>
      ) : null}

      {video.status === "previa_pronta" ? (
        <section className={styles.stage}>
          <div className={styles.stageHead}>
            <h4 className={styles.stageTitle}>{ROTULO.previa_pronta}</h4>
            <p className={styles.panelText}>Confira as cenas e a narração. Clique numa cena para ver grande.</p>
          </div>
          {state.stills.length ? (
            <div className={styles.stills}>
              {state.stills.map((s) => (
                <button key={s} type="button" className={styles.stillBtn} onClick={() => setStill(s)} aria-label={`Ver ${s} grande`}>
                  <img src={file(`stills/${s}`)} alt={s} loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
          {state.arquivos.narracaoMp3 || state.vozUsada || state.arquivos.notas ? (
            <div className={styles.narration}>
              <span className={styles.narrationIcon}><Icon name="mic" size={20} /></span>
              <div className={styles.narrationMain}>
                <div className={styles.narrationHead}>
                  <b>Narração</b>
                  {state.vozUsada ? <span className={styles.chip}>Voz usada: {state.vozUsada}</span> : null}
                  {state.arquivos.notas ? <a className={styles.link} href={file("NOTAS.md")} target="_blank" rel="noreferrer"><Icon name="doc" size={14} />Notas do Claude</a> : null}
                </div>
                {state.arquivos.narracaoMp3 ? <audio controls src={file("voz/narracao.mp3")} /> : null}
              </div>
            </div>
          ) : null}
          {padrao ? <p className={styles.hint}>VT padrão: para mudar o visual, use Criação nova.</p> : (
            <label className={styles.field}>Pedir ajuste na prévia<textarea value={ajuste} onChange={(e) => setAjuste(e.target.value)} placeholder="Ex.: trocar a cena 3 por algo mais claro" /></label>
          )}
          <div className={styles.actions}>
            {padrao ? null : <Button type="button" variant="secondary" disabled={!ajuste.trim()} onClick={run(() => requestVideoAdjustment(projectId, videoId, "producao", ajuste))}>Pedir ajuste</Button>}
            <Button type="button" onClick={run(() => videoAction(projectId, videoId, "aprovar-previa"))}>Aprovar prévia</Button>
          </div>
          {still ? <ImageLightbox src={file(`stills/${still}`)} alt={still} fileName={still} onClose={() => setStill(null)} /> : null}
        </section>
      ) : null}

      {video.status === "pronto" ? (
        <section className={styles.final}>
          {state.arquivos.video ? <div className={styles.phone}><video controls playsInline src={file("video.mp4")} /></div> : null}
          <div className={styles.finalActions}>
            <h4 className={styles.stageTitle}>Vídeo pronto</h4>
            <p className={styles.panelText}>Baixe o MP4 e poste com a legenda pronta.</p>
            <a className={styles.primaryLink} href={file("video.mp4")} download={`${video.id}.mp4`}><Icon name="download" />Baixar MP4</a>
            {state.arquivos.legendaPost ? (
              <div className={styles.linkRow}>
                <a className={styles.link} href={file("legenda-post.txt")} target="_blank" rel="noreferrer"><Icon name="doc" size={15} />Legenda do post</a>
                <Button type="button" variant="ghost" className={styles.smallBtn} onClick={copiarLegenda}><Icon name={copiado ? "check" : "copy"} size={15} />{copiado ? "Copiado!" : "Copiar legenda"}</Button>
              </div>
            ) : null}
            {state.arquivos.narracaoTxt ? <a className={styles.link} href={file("voz/narracao.txt")} target="_blank" rel="noreferrer"><Icon name="mic" size={15} />Texto da narração</a> : null}
          </div>
        </section>
      ) : null}

      {!GERANDO.has(video.status) ? (
        <div className={styles.footer}><Button type="button" variant="ghost" className={styles.deleteBtn} onClick={async () => { setError(null); try { await videoAction(projectId, videoId, "excluir"); onChanged(); onClose(); } catch (e) { setError((e as Error).message); } }}><Icon name="trash" size={16} />Excluir vídeo</Button></div>
      ) : null}
    </Card>
  );
}
