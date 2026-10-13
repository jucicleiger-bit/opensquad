// Vídeo animado: per-project video folders, their status, and what Claude
// needs to write a video (brand block, real-material inventory, validation).
// Running Claude Code and the renderer lives in content-central-video-jobs.js.
import { mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getCentralPaths, loadProject, readJson, writeJson } from './content-central.js';

export const STATUS = {
  ROTEIRO_GERANDO: 'roteiro_gerando', ROTEIRO_PRONTO: 'roteiro_pronto',
  PRODUCAO_GERANDO: 'producao_gerando', PREVIA_PRONTA: 'previa_pronta',
  RENDER_GERANDO: 'render_gerando', PRONTO: 'pronto',
  ERRO: 'erro', AGUARDANDO_LIMITE: 'aguardando_limite', INTERROMPIDO: 'interrompido',
};
export const ESTADOS_GERANDO = new Set([STATUS.ROTEIRO_GERANDO, STATUS.PRODUCAO_GERANDO, STATUS.RENDER_GERANDO]);
const ESTADOS_FALHA = new Set([STATUS.ERRO, STATUS.AGUARDANDO_LIMITE, STATUS.INTERROMPIDO]);
const OBJETIVOS = new Set(['alcance', 'anuncio', 'oferta', 'institucional', 'aviso']);
const FORMATOS = new Set(['reels', 'status']);
const ESTILOS = new Set(['livre', 'dinamico', 'mercado', 'premium', 'informativo']);
const DURACOES = new Set([15, 30, 45, 60]);
const TONS = new Set(['criador', 'vendedor', 'locutor']);
const LEGENDAS = new Set(['simples', 'karaoke', 'pop', 'destaque', 'caixa', 'do-video', 'sem']);
const PALAVRAS_POR_SEGUNDO = 2.6;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// On for every project unless explicitly turned off. Without a configured
// list, a project's real material is its own.
export function normalizeVideoAnimado(value, projectId = '') {
  const materiais = Array.isArray(value?.projetosDeMaterial) ? value.projetosDeMaterial.filter((id) => typeof id === 'string' && id) : [];
  return {
    ativo: value?.ativo !== false,
    projetosDeMaterial: materiais.length || !projectId ? materiais : [projectId],
    whatsapp: typeof value?.whatsapp === 'string' ? value.whatsapp : '',
  };
}

export async function requireVideoProject(projectId, targetDir) {
  const paths = getCentralPaths(targetDir, projectId);
  const raw = await readJson(paths.projectPath, null);
  if (!raw || !normalizeVideoAnimado(raw.videoAnimado).ativo) throw httpError(404, 'Vídeo animado não está ligado neste projeto.');
  return loadProject(paths);
}

export function videoDir(targetDir, projectId, videoId) {
  if (!/^[a-z0-9-]+$/.test(String(videoId))) throw httpError(400, 'Vídeo inválido.');
  return join(getCentralPaths(targetDir, projectId).projectDir, 'videos', videoId);
}

const slug = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function normalizeBriefing(input = {}, produtosDisponiveis = null) {
  const assunto = String(input.assunto || '').trim();
  if (!assunto) throw httpError(400, 'Informe o assunto do vídeo.');
  const objetivo = String(input.objetivo || '');
  if (!OBJETIVOS.has(objetivo)) throw httpError(400, 'Objetivo deve ser alcance, anúncio, oferta, institucional ou aviso.');
  const formato = String(input.formato || 'reels');
  if (!FORMATOS.has(formato)) throw httpError(400, 'Formato deve ser reels ou status.');
  const estilo = String(input.estilo || 'livre');
  if (!ESTILOS.has(estilo)) throw httpError(400, 'Estilo desconhecido.');
  const duracao = input.duracao === 'auto' ? 'auto' : Number(input.duracao);
  if (duracao !== 'auto' && !DURACOES.has(duracao)) throw httpError(400, 'Duração deve ser 15, 30, 45, 60 segundos ou automática.');
  const tom = String(input.tom || 'criador');
  if (!TONS.has(tom)) throw httpError(400, 'Tom deve ser criador, vendedor ou locutor.');
  const legenda = String(input.legenda || 'do-video');
  if (!LEGENDAS.has(legenda)) throw httpError(400, 'Modelo de legenda desconhecido.');
  const briefing = { assunto, objetivo, formato, estilo, duracao, tom, legenda, observacao: String(input.observacao || '').trim() };
  if (objetivo === 'oferta' && !produtosDisponiveis) throw httpError(400, 'Oferta precisa dos produtos cadastrados.');
  return briefing;
}

// Seconds the script should aim for, or null when the operator chose "auto".
export const duracaoAlvo = (briefing) => (briefing?.duracao === 'auto' ? null : Number(briefing?.duracao) || null);

export async function createVideo(projectId, input, targetDir) {
  await requireVideoProject(projectId, targetDir);
  const briefing = normalizeBriefing(input);
  const agora = new Date().toISOString();
  const id = `${agora.slice(0, 10)}-${slug(briefing.assunto) || 'video'}-${randomBytes(2).toString('hex')}`;
  const dir = videoDir(targetDir, projectId, id);
  await mkdir(join(dir, 'fotos'), { recursive: true });
  const video = { id, projectId, briefing, status: STATUS.ROTEIRO_GERANDO, erro: null, criadoEm: agora, atualizadoEm: agora, historico: [{ em: agora, status: STATUS.ROTEIRO_GERANDO }] };
  await writeJson(join(dir, 'video.json'), video);
  return video;
}

export async function readVideo(projectId, videoId, targetDir) {
  const video = await readJson(join(videoDir(targetDir, projectId, videoId), 'video.json'), null);
  if (!video) throw httpError(404, 'Vídeo não encontrado.');
  return video;
}

export async function updateVideo(projectId, videoId, patch, targetDir) {
  const video = await readVideo(projectId, videoId, targetDir);
  const agora = new Date().toISOString();
  const next = { ...video, ...patch, atualizadoEm: agora };
  if (patch.status && patch.status !== video.status) next.historico = [...(video.historico || []), { em: agora, status: patch.status }];
  if (patch.status && patch.status !== STATUS.ERRO && patch.status !== STATUS.AGUARDANDO_LIMITE && !('erro' in patch)) next.erro = null;
  // A stage starting or succeeding makes the recorded failure stale; it must not steer a later retry.
  if (patch.status && !ESTADOS_FALHA.has(patch.status)) { delete next.etapaComErro; delete next.etapaInterrompida; }
  await writeJson(join(videoDir(targetDir, projectId, videoId), 'video.json'), next);
  return next;
}

// roteiro.json is written by Claude or by hand: anything but a list of objects is ignored.
const cenasValidas = (cenas) => (Array.isArray(cenas) ? cenas : []).filter((c) => c && typeof c === 'object');

export function estimateSeconds(lista) {
  const cenas = cenasValidas(lista);
  const palavras = cenas.reduce((n, c) => n + (String(c.fala || '').match(/[\p{L}\d]+/gu) || []).length, 0);
  const segura = cenas.reduce((n, c) => n + (Number(c.segura) || 0), 0);
  return Math.round((palavras / PALAVRAS_POR_SEGUNDO + segura) * 10) / 10;
}

export function validateRoteiro(roteiro, briefing) {
  const erros = [];
  const avisos = [];
  const cenas = cenasValidas(roteiro?.cenas);
  if (!cenas.length) erros.push('O roteiro não tem cenas.');
  cenas.forEach((c, i) => {
    if (!String(c.tipo || '').trim()) erros.push(`Cena ${i + 1} sem tipo.`);
    if (!String(c.fala || '').trim()) erros.push(`Cena ${i + 1} sem fala.`);
  });
  if (!erros.length && briefing) {
    const alvo = duracaoAlvo(briefing);
    const est = estimateSeconds(cenas);
    if (alvo && Math.abs(est - alvo) > alvo * 0.15) avisos.push(`Tempo estimado ${est}s, a meta é ${alvo}s.`);
    const fim = cenas.slice(-2).map((c) => String(c.fala || '')).join(' ');
    const status = briefing.formato === 'status';
    if (briefing.objetivo === 'alcance' && !status && !/\?|salv|compartilh/i.test(fim)) avisos.push('Vídeo de alcance deve fechar com uma enquete ou pedindo para salvar/compartilhar.');
    if ((briefing.objetivo === 'anuncio' || status) && !/whats/i.test(fim)) avisos.push('Este vídeo deve fechar chamando no WhatsApp.');
  }
  return { erros, avisos };
}

export async function saveRoteiroCenas(projectId, videoId, cenas, targetDir) {
  const video = await readVideo(projectId, videoId, targetDir);
  if (video.status !== STATUS.ROTEIRO_PRONTO) throw httpError(409, 'O roteiro só pode ser editado quando estiver pronto para revisão.');
  const limpas = (Array.isArray(cenas) ? cenas : []).map((c) => ({
    ...c,
    tipo: String(c.tipo || '').trim(),
    fala: String(c.fala || '').trim(),
    descricao: String(c.descricao || '').trim(),
  }));
  const { erros } = validateRoteiro({ cenas: limpas });
  if (erros.length) throw httpError(400, erros.join(' '));
  const path = join(videoDir(targetDir, projectId, videoId), 'roteiro.json');
  const roteiro = { ...(await readJson(path, {})), cenas: limpas };
  await writeJson(path, roteiro);
  return roteiro;
}

export async function readVideoState(projectId, videoId, targetDir) {
  const video = await readVideo(projectId, videoId, targetDir);
  const dir = videoDir(targetDir, projectId, videoId);
  const lido = await readJson(join(dir, 'roteiro.json'), null);
  const roteiro = lido && typeof lido === 'object' ? { ...lido, cenas: cenasValidas(lido.cenas) } : null;
  const { avisos } = roteiro ? validateRoteiro(roteiro, video.briefing) : { avisos: [] };
  const stills = existsSync(join(dir, 'stills')) ? (await readdir(join(dir, 'stills'))).filter((n) => n.endsWith('.jpg')).sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1))) : [];
  const has = (name) => existsSync(join(dir, name));
  const narracao = await readJson(join(dir, 'voz', 'narracao.json'), null);
  return {
    video,
    roteiro,
    estimativa: roteiro ? estimateSeconds(roteiro.cenas) : null,
    avisos,
    stills,
    arquivos: { video: has('video.mp4'), narracaoMp3: has('voz/narracao.mp3'), narracaoTxt: has('voz/narracao.txt'), legendaPost: has('legenda-post.txt'), notas: has('NOTAS.md') },
    vozUsada: narracao?.usada || null,
  };
}

export async function listVideos(projectId, targetDir) {
  await requireVideoProject(projectId, targetDir);
  const base = join(getCentralPaths(targetDir, projectId).projectDir, 'videos');
  if (!existsSync(base)) return [];
  const videos = [];
  for (const id of await readdir(base)) {
    const video = await readJson(join(base, id, 'video.json'), null);
    if (!video) continue;
    videos.push({ id: video.id, assunto: video.briefing.assunto, objetivo: video.briefing.objetivo, duracao: video.briefing.duracao, status: video.status, erro: video.erro, criadoEm: video.criadoEm, atualizadoEm: video.atualizadoEm, temVideo: existsSync(join(base, id, 'video.mp4')) });
  }
  return videos.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export async function deleteVideo(projectId, videoId, targetDir) {
  const video = await readVideo(projectId, videoId, targetDir);
  if (ESTADOS_GERANDO.has(video.status)) throw httpError(409, 'O vídeo está sendo gerado; espere terminar para excluir.');
  await rm(videoDir(targetDir, projectId, videoId), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

// The most saturated color in the brand identity is the highlight color.
function pickAccent(colors = []) {
  const sat = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  };
  const valid = colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  return valid.sort((a, b) => sat(b) - sat(a))[0] || '#FFD100';
}

export function buildMarca(project, settings = {}) {
  const colors = [...(project.brandIdentity?.editedColors || []), ...(project.brandIdentity?.extractedColors || [])];
  return {
    nome: project.brandInput?.brandName || project.name,
    subtitulo: '',
    logo: 'fotos/logo.png',
    whatsapp: settings.whatsapp || project.companyProfile?.contact || '',
    instagram: project.instagram?.handle || '',
    cor: pickAccent(colors),
  };
}

const STATUS_MATERIAL = ['aprovado', 'published', 'scheduled', 'test_post_simulated', 'regenerated', 'draft_generated'];
const CANAIS_MATERIAL = new Set(['instagram_story', 'whatsapp_status', 'facebook_story', 'instagram_feed']);

// Real material Claude may use: generated arts that exist on disk, with the
// raw product photo when the item kept one. Approved first.
export async function buildMaterialInventory(projectIds, targetDir) {
  const out = [];
  const rank = (status) => STATUS_MATERIAL.indexOf(status);
  for (const projeto of projectIds) {
    const paths = getCentralPaths(targetDir, projeto);
    if (!existsSync(paths.contentDir)) continue;
    // One entry per art file; when the same art appears in several items,
    // keep the best status (approved over test runs).
    const best = new Map();
    const files = (await readdir(paths.contentDir, { recursive: true })).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const data = await readJson(join(paths.contentDir, f), null);
      const items = Array.isArray(data) ? data : data?.items || data?.contents || [];
      for (const it of Array.isArray(items) ? items : []) {
        if (!it || !CANAIS_MATERIAL.has(it.channel) || !STATUS_MATERIAL.includes(it.status)) continue;
        const url = it.image?.url;
        if (!url) continue;
        const arte = join(paths.assetsDir, 'generated', basename(url));
        if (!existsSync(arte)) continue;
        const atual = best.get(arte);
        let crua = (it.image.references || []).map((r) => r?.absolutePath).find((p) => p && !/logo/i.test(p) && existsSync(p)) || null;
        if (atual && rank(atual.status) <= rank(it.status)) {
          atual.cru ??= crua;
          continue;
        }
        crua ??= atual?.cru ?? null;
        const topic = it.contentTopic || {};
        best.set(arte, { projeto, produto: topic.offerName || topic.label || atual?.produto || '', canal: it.channel, status: it.status, arte, cru: crua });
      }
    }
    out.push(...best.values());
  }
  return out.sort((a, b) => rank(a.status) - rank(b.status));
}

export async function reconcileInterruptedVideos(targetDir) {
  const projectsDir = getCentralPaths(targetDir).projectsDir;
  if (!existsSync(projectsDir)) return 0;
  let count = 0;
  for (const projectId of await readdir(projectsDir)) {
    const base = join(projectsDir, projectId, 'videos');
    if (!existsSync(base)) continue;
    for (const id of await readdir(base)) {
      const video = await readJson(join(base, id, 'video.json'), null);
      if (video && ESTADOS_GERANDO.has(video.status)) {
        await updateVideo(projectId, id, { status: STATUS.INTERROMPIDO, erro: 'O servidor reiniciou no meio da geração.', etapaInterrompida: video.status }, targetDir);
        count += 1;
      }
    }
  }
  return count;
}
