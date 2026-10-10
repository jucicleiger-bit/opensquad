import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  createVideo, getVideo, listVideos, requestVideoAdjustment, saveVideoRoteiro, videoAction, videoFileUrl,
  type VideoBriefing, type VideoCena, type VideoState, type VideoSummary,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import styles from "./VideoAnimado.module.css";

const ROTULO: Record<string, string> = {
  roteiro_gerando: "Escrevendo o roteiro…", roteiro_pronto: "Roteiro para revisar", producao_gerando: "Produzindo (voz, cenas e prévia)…",
  previa_pronta: "Prévia para revisar", render_gerando: "Gerando o vídeo final…", pronto: "Pronto", erro: "Erro",
  aguardando_limite: "Aguardando o limite do Claude Code", interrompido: "Interrompido",
};
const GERANDO = new Set(["roteiro_gerando", "producao_gerando", "render_gerando"]);
const LEGENDAS: Array<[VideoBriefing["legenda"], string]> = [["do-video", "Do vídeo (sob medida)"], ["simples", "Simples"], ["karaoke", "Karaokê"], ["pop", "Pop (palavra por vez)"], ["destaque", "Destaque"], ["caixa", "Caixa"], ["sem", "Sem legenda"]];
const PALAVRAS_POR_SEGUNDO = 2.6;
const segundos = (fala: string) => Math.round(((fala.match(/[\p{L}\d]+/gu) || []).length / PALAVRAS_POR_SEGUNDO) * 10) / 10;

export function VideoAnimado() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [params, setParams] = useSearchParams();
  const selected = params.get("v");
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [novo, setNovo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => listVideos(project.projectId).then((r) => setVideos(r.videos)).catch((e: Error) => setError(e.message)), [project.projectId]);
  useEffect(() => { reload(); }, [reload]);
  const open = (id: string | null) => setParams(id ? { v: id } : {});

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className="section-heading">Vídeo animado</h2>
        <Button type="button" onClick={() => { setNovo(true); open(null); }}>Novo vídeo</Button>
      </div>
      {error ? <div className="pill bad">{error}</div> : null}
      {novo ? <NovoVideo project={project} onCreated={(id) => { setNovo(false); reload(); open(id); }} onCancel={() => setNovo(false)} /> : null}
      {selected ? <VideoDetalhe projectId={project.projectId} videoId={selected} onChanged={reload} onClose={() => open(null)} /> : null}
      {!selected && !novo ? (
        <div className={styles.list}>
          {videos.length === 0 ? <p className="muted">Nenhum vídeo ainda.</p> : null}
          {videos.map((v) => (
            <Card key={v.id} style={{ padding: 16 }}>
              <button type="button" className={styles.cardButton} onClick={() => open(v.id)}>
                <b>{v.assunto}</b>
                <span className="muted">{v.objetivo === "anuncio" ? "Anúncio" : "Alcance"} · {v.duracao}s · {new Date(v.criadoEm).toLocaleDateString("pt-BR")}</span>
                <span className={styles.status}>{ROTULO[v.status]}</span>
              </button>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NovoVideo({ project, onCreated, onCancel }: { project: WorkspaceContext["project"]; onCreated: (id: string) => void; onCancel: () => void }) {
  const [b, setB] = useState<VideoBriefing>({ assunto: "", objetivo: "alcance", duracao: 30, tom: "criador", legenda: "do-video", observacao: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assuntos = useMemo(() => {
    const ofertas = (project.contentStrategy?.offers || []).map((o) => (o as { name?: string }).name).filter(Boolean) as string[];
    const banco = Object.values(project.contentStrategy?.topicIdeas?.goals || {}).flatMap((g) => (g.items || []).map((i) => i.title));
    return [...new Set([...ofertas, ...banco])];
  }, [project]);
  const set = <K extends keyof VideoBriefing>(k: K, v: VideoBriefing[K]) => setB((prev) => ({ ...prev, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try { onCreated((await createVideo(project.projectId, b)).video.id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Card style={{ padding: 20 }}>
      <label className={styles.field}>Assunto<input value={b.assunto} onChange={(e) => set("assunto", e.target.value)} placeholder="Ex.: O que colocar na bio do Instagram" /></label>
      <label className={styles.field}>Importar assunto
        <select value="" onChange={(e) => e.target.value && set("assunto", e.target.value)}>
          <option value="">Escolha um assunto cadastrado…</option>
          {assuntos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <fieldset className={styles.row}><legend>Objetivo</legend>
        {(["alcance", "anuncio"] as const).map((o) => <label key={o}><input type="radio" name="objetivo" checked={b.objetivo === o} onChange={() => set("objetivo", o)} />{o === "alcance" ? "Alcance" : "Anúncio"}</label>)}
      </fieldset>
      <fieldset className={styles.row}><legend>Duração</legend>
        {([15, 30, 45, 60] as const).map((d) => <label key={d}><input type="radio" name="duracao" checked={b.duracao === d} onChange={() => set("duracao", d)} />{d}s</label>)}
      </fieldset>
      <fieldset className={styles.row}><legend>Tom da voz</legend>
        {(["criador", "vendedor"] as const).map((t) => <label key={t}><input type="radio" name="tom" checked={b.tom === t} onChange={() => set("tom", t)} />{t === "criador" ? "Criador de conteúdo" : "Vendedor de bairro"}</label>)}
      </fieldset>
      <label className={styles.field}>Legenda
        <select value={b.legenda} onChange={(e) => set("legenda", e.target.value as VideoBriefing["legenda"])}>
          {LEGENDAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className={styles.field}>Observação (opcional)<textarea value={b.observacao} onChange={(e) => set("observacao", e.target.value)} /></label>
      {error ? <div className="pill bad">{error}</div> : null}
      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="button" disabled={busy || !b.assunto.trim()} onClick={submit}>{busy ? "Enviando…" : "Gerar roteiro"}</Button>
      </div>
    </Card>
  );
}

function VideoDetalhe({ projectId, videoId, onChanged, onClose }: { projectId: string; videoId: string; onChanged: () => void; onClose: () => void }) {
  const [state, setState] = useState<VideoState | null>(null);
  const [cenas, setCenas] = useState<VideoCena[]>([]);
  const [ajuste, setAjuste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getVideo(projectId, videoId).then((s) => { setState(s); setCenas(s.roteiro?.cenas || []); return s; }), [projectId, videoId]);

  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  // Jobs keep running on the server; poll while one runs.
  useEffect(() => {
    if (!state || !GERANDO.has(state.video.status)) return;
    const timer = setInterval(() => { load().then((s) => { if (!GERANDO.has(s.video.status)) onChanged(); }).catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [state, load, onChanged]);

  if (!state) return error ? <div className="pill bad">{error}</div> : <p className="muted">Carregando…</p>;
  const { video } = state;
  const file = (name: string) => videoFileUrl(projectId, videoId, name);
  const run = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try { await fn(); setAjuste(""); await load(); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  const total = Math.round((cenas.reduce((n, c) => n + segundos(c.fala) + (c.segura || 0), 0)) * 10) / 10;
  const move = (i: number, d: number) => setCenas((cs) => { const next = [...cs]; const [c] = next.splice(i, 1); next.splice(i + d, 0, c); return next; });

  return (
    <Card style={{ padding: 20 }}>
      <div className={styles.header}>
        <div><b>{video.briefing.assunto}</b><div className="muted">{video.briefing.objetivo === "anuncio" ? "Anúncio" : "Alcance"} · meta {video.briefing.duracao}s</div></div>
        <Button type="button" variant="secondary" onClick={onClose}>Voltar à lista</Button>
      </div>
      <div className={styles.status}>{ROTULO[video.status]}</div>
      {video.erro ? <div className="pill bad">{video.erro}</div> : null}
      {error ? <div className="pill bad">{error}</div> : null}
      {["erro", "interrompido", "aguardando_limite"].includes(video.status) ? <Button type="button" onClick={run(() => videoAction(projectId, videoId, "retomar"))}>Tentar de novo</Button> : null}

      {video.status === "roteiro_pronto" ? (
        <>
          <div className={styles.timebar}><span style={{ width: `${Math.min(100, (total / video.briefing.duracao) * 100)}%` }} />{total}s de {video.briefing.duracao}s</div>
          {state.avisos.map((a) => <div key={a} className="notice">{a}</div>)}
          {cenas.map((c, i) => (
            <div key={i} data-testid="cena" className={styles.cena}>
              <div className={styles.cenaHead}><b>Cena {i + 1}</b><span className="muted">~{segundos(c.fala)}s</span>
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir cena ${i + 1}`}>↑</button>
                <button type="button" disabled={i === cenas.length - 1} onClick={() => move(i, 1)} aria-label={`Descer cena ${i + 1}`}>↓</button>
                <button type="button" onClick={() => setCenas((cs) => cs.filter((_, j) => j !== i))} aria-label={`Apagar cena ${i + 1}`}>✕</button>
              </div>
              <label className={styles.field}>Fala da cena {i + 1}<textarea aria-label={`Fala da cena ${i + 1}`} value={c.fala} onChange={(e) => setCenas((cs) => cs.map((x, j) => (j === i ? { ...x, fala: e.target.value } : x)))} /></label>
              <p className="muted">{c.descricao}</p>
            </div>
          ))}
          <label className={styles.field}>Pedir ajuste no roteiro<textarea value={ajuste} onChange={(e) => setAjuste(e.target.value)} /></label>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={!ajuste.trim()} onClick={run(async () => { await saveVideoRoteiro(projectId, videoId, cenas); await requestVideoAdjustment(projectId, videoId, "roteiro", ajuste); })}>Pedir ajuste</Button>
            <Button type="button" onClick={run(async () => { await saveVideoRoteiro(projectId, videoId, cenas); await videoAction(projectId, videoId, "aprovar-roteiro"); })}>Aprovar roteiro</Button>
          </div>
        </>
      ) : null}

      {video.status === "previa_pronta" ? (
        <>
          <div className={styles.stills}>{state.stills.map((s) => <img key={s} src={file(`stills/${s}`)} alt={s} />)}</div>
          {state.arquivos.narracaoMp3 ? <audio controls src={file("voz/narracao.mp3")} /> : null}
          {state.vozUsada ? <div className="muted">Voz usada: {state.vozUsada}</div> : null}
          {state.arquivos.notas ? <a href={file("NOTAS.md")} target="_blank" rel="noreferrer">Notas do Claude</a> : null}
          <label className={styles.field}>Pedir ajuste na prévia<textarea value={ajuste} onChange={(e) => setAjuste(e.target.value)} /></label>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={!ajuste.trim()} onClick={run(() => requestVideoAdjustment(projectId, videoId, "producao", ajuste))}>Pedir ajuste</Button>
            <Button type="button" onClick={run(() => videoAction(projectId, videoId, "aprovar-previa"))}>Aprovar prévia</Button>
          </div>
        </>
      ) : null}

      {video.status === "pronto" ? (
        <>
          {state.arquivos.video ? <video className={styles.player} controls src={file("video.mp4")} /> : null}
          <div className={styles.actions}>
            <a href={file("video.mp4")} download>Baixar MP4</a>
            {state.arquivos.legendaPost ? <a href={file("legenda-post.txt")} target="_blank" rel="noreferrer">Legenda do post</a> : null}
            {state.arquivos.narracaoTxt ? <a href={file("voz/narracao.txt")} target="_blank" rel="noreferrer">Texto da narração</a> : null}
          </div>
        </>
      ) : null}

      {!GERANDO.has(video.status) ? (
        <div className={styles.actions}><Button type="button" variant="secondary" onClick={run(async () => { await videoAction(projectId, videoId, "excluir"); onClose(); })}>Excluir vídeo</Button></div>
      ) : null}
    </Card>
  );
}
