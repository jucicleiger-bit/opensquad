// Runs the Vídeo animado stages: Claude Code writes the script (stage 1) and
// the per-video scene code (stage 2) inside the video folder; the motor
// renders the MP4 (stage 3). One job at a time: Claude, Whisper and the
// renderer all compete for the same CPU.
import { spawn } from 'node:child_process';
import { copyFile, writeFile, rm, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, getCentralPaths } from './content-central.js';
import {
  STATUS, requireVideoProject, readVideo, updateVideo, videoDir, validateRoteiro, buildMarca, buildMaterialInventory, normalizeVideoAnimado,
} from './content-central-video.js';
import {
  MOLDURAS, SEGUNDOS_POR_PRODUTO, precoNaTela, precoPorExtenso, recortarFundoBranco, validateRoteiroOferta, expandirRoteiro, validadePorExtenso, legendaPostOferta,
} from './content-central-video-produtos.js';

const MOTOR_DIR = fileURLToPath(new URL('./video-motor/', import.meta.url));
const MOTOR_PROMPT = MOTOR_DIR.replaceAll('\\', '/').replace(/\/+$/, ''); // Git Bash loses backslashes
const CLAUDE_TIMEOUT_MS = 45 * 60 * 1000;
const TTS_TIMEOUT_MS = 10 * 60 * 1000;
const CLOCK_SLACK_MS = 2000; // coarse filesystem timestamps

export const DIRECOES = {
  criador: 'Leia em português do Brasil, como um criador de conteúdo de Instagram: animado, sorrindo, ritmo rápido, com energia e variação de entonação, dando ênfase nas palavras importantes. Leia exatamente o texto abaixo, sem acrescentar nada:',
  vendedor: 'Leia em português do Brasil, como um vendedor simpático e confiante de loja de bairro: próximo, caloroso e natural, sem exagero, com ritmo de anúncio de Instagram. Leia exatamente o texto abaixo, sem acrescentar nada:',
  locutor: 'Leia em português do Brasil, como locutor de comercial de supermercado na TV e no rádio: muita energia, sorriso na voz, ritmo rápido, ênfase forte nos nomes dos produtos e nos preços, como quem anuncia uma oferta imperdível. Leia exatamente o texto abaixo, sem acrescentar nada:',
};

export function isUsageLimit(text) {
  return /usage limit|session limit|hit your (\w+ )?limit|limit reached|limite de uso/i.test(String(text || ''));
}

// Killing only claude.exe would leave its Bash children (Chromium, python,
// ffmpeg) running, so on Windows the whole tree goes.
function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
  } else child.kill();
}

// Same shape as runClaudeTurn (content-central-brain.js): prompt on stdin
// (Windows command-line limit), project settings only (no personal plugins
// or hooks restyling the work), JSON result. Here Claude edits files and
// runs the motor, so it gets file tools and Bash.
// `bin`/`args` exist only so tests can run a stand-in process.
export function runClaudeCode({ prompt, cwd, addDirs = [], timeoutMs = CLAUDE_TIMEOUT_MS, bin = process.env.CLAUDE_BIN || 'claude', args: argsOverride }) {
  const args = argsOverride || ['-p', '--output-format', 'json', '--setting-sources', 'project', '--model', 'opus',
    '--permission-mode', 'bypassPermissions', '--tools', 'Read,Write,Edit,Bash,Glob,Grep',
    ...addDirs.flatMap((d) => ['--add-dir', d])];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { killTree(child); reject(new Error('O Claude Code passou de 45 minutos e foi interrompido.')); }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`Não consegui abrir o Claude Code: ${err.message}`)); });
    child.on('close', () => {
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(stdout); } catch {
        const text = (stderr || stdout || 'O Claude Code não respondeu.').trim().slice(-600);
        return reject(Object.assign(new Error(text), { limite: isUsageLimit(text) }));
      }
      const text = String(result.result || '');
      if (result.is_error) return reject(Object.assign(new Error(text.slice(-600) || 'O Claude Code devolveu erro.'), { limite: isUsageLimit(text) }));
      resolve({ text });
    });
    child.stdin.end(prompt);
  });
}

const defaultRenderer = async (opts) => (await import('./video-motor/render.mjs')).renderVideo(opts);

const DIAS_CURTOS = { mon: 'seg', tue: 'ter', wed: 'qua', thu: 'qui', fri: 'sex', sat: 'sáb', sun: 'dom' };
// "seg a sex 08:00–18:00 · sáb 08:00–12:00": days with the same hours are grouped.
function resumoHorario(hours) {
  if (!hours || typeof hours !== 'object') return '';
  const grupos = [];
  for (const [dia, curto] of Object.entries(DIAS_CURTOS)) {
    const faixa = (hours[dia] || []).map((f) => `${f.from}–${f.to}`).join(', ');
    if (!faixa) continue;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.faixa === faixa) ultimo.ate = curto; else grupos.push({ de: curto, ate: curto, faixa });
  }
  return grupos.map((g) => `${g.de === g.ate ? g.de : `${g.de} a ${g.ate}`} ${g.faixa}`).join(' · ');
}

async function prepareFolder(project, video, dir, targetDir) {
  const settings = normalizeVideoAnimado(project.videoAnimado, project.projectId);
  const marca = buildMarca(project, settings);
  const logo = project.brand?.logoPath ? join(getCentralPaths(targetDir, project.projectId).projectDir, project.brand.logoPath) : null;
  const temLogo = Boolean(logo && existsSync(logo));
  if (!temLogo) marca.logo = '';
  await writeJson(join(dir, 'briefing.json'), video.briefing);
  await writeJson(join(dir, 'marca.json'), {
    marca,
    identidade: project.brand?.visualStyle || '',
    empresa: project.companyProfile || {},
  });
  await writeJson(join(dir, 'material.json'), await buildMaterialInventory(settings.projetosDeMaterial, targetDir));
  if (temLogo) await copyFile(logo, join(dir, 'fotos', 'logo.png'));
  const oferta = video.briefing.oferta;
  if (oferta) {
    const base = getCentralPaths(targetDir, project.projectId).projectDir;
    const produtos = [];
    for (const p of oferta.produtos) {
      const origem = join(base, p.fotoOrigem || '');
      if (!p.fotoOrigem || !existsSync(origem)) throw new Error(`A foto de ${p.nome} não foi encontrada no cadastro.`);
      const foto = `fotos/produto-${p.id}${p.fotoTipo === 'recorte' ? '.png' : extname(origem).toLowerCase()}`;
      if (p.fotoTipo === 'recorte') await recortarFundoBranco(origem, join(dir, foto));
      else await copyFile(origem, join(dir, foto));
      produtos.push({ id: p.id, nome: p.nome, preco: p.preco, precoDe: p.precoDe, precoTela: precoNaTela(p.preco), precoDeTela: p.precoDe ? precoNaTela(p.precoDe) : '', precoFalado: precoPorExtenso(p.preco), unidade: p.unidade, foto, fotoTipo: p.fotoTipo });
    }
    const empresa = project.companyProfile || {};
    await writeJson(join(dir, 'produtos.json'), {
      produtos,
      loja: { nome: marca.nome, endereco: empresa.address || '', whatsapp: marca.whatsapp, horario: resumoHorario(project.businessHours), validoAte: oferta.validoAte, validade: oferta.validoAte ? validadePorExtenso(oferta.validoAte) : '' },
    });
  }
  await copyFile(join(MOTOR_DIR, 'REGRAS.md'), join(dir, 'REGRAS.md'));
  await cp(join(MOTOR_DIR, 'exemplos'), join(dir, 'exemplos'), { recursive: true });
  return { marca, settings, temLogo };
}

async function writeAjuste(dir, ajuste) {
  const path = join(dir, 'ajuste.txt');
  if (ajuste) await writeFile(path, ajuste);
  else await rm(path, { force: true });
}

const LEGENDA_TEXTO = {
  sem: 'Legendas na tela: nenhuma (o roteiro fica com "legendas": false).',
  'do-video': 'Legendas na tela: as falas do próprio vídeo.',
};

const ESTILO_TEXTO = { dinamico: 'dinamico', mercado: 'mercado', premium: 'premium', informativo: 'informativo' };

function duracaoTexto(b) {
  if (b.duracao !== 'auto') return `${b.duracao}s`;
  if (b.oferta) {
    const n = b.oferta.produtos.length;
    const s = SEGUNDOS_POR_PRODUTO[b.oferta.ritmo] || SEGUNDOS_POR_PRODUTO.rapido;
    return `automática (cerca de ${s}s por produto × ${n} + uns 6s de abertura e fechamento ≈ ${n * s + 6}s)`;
  }
  return b.formato === 'status' ? 'automática (15 a 30s)' : 'automática (20 a 45s, o que o assunto pedir)';
}

const NOMES_RITMO = { rapido: 'rápido', calmo: 'calmo' };
function linhaMoldura(o) {
  const ritmo = `ritmo ${NOMES_RITMO[o.ritmo] || 'rápido'} (${SEGUNDOS_POR_PRODUTO[o.ritmo] || 3}s por produto)`;
  const selo = `selo da campanha "${o.campanha || 'Ofertas da Semana'}"`;
  if (o.moldura === 'auto') {
    return `Moldura: você escolhe pelo assunto, a observação e a época; escreva "moldura": "<id>" no roteiro.json, um de: ${MOLDURAS.map((m) => `${m.id}: ${m.descricao}`).join('; ')}. ${ritmo}, ${selo}.`;
  }
  const m = MOLDURAS.find((x) => x.id === o.moldura) || MOLDURAS[0];
  return `Moldura: ${m.nome} (${m.id}), ${ritmo}, ${selo}.`;
}

function stagePrompt(nome, video, temLogo, erroAnterior) {
  const b = video.briefing;
  return [
    `Leia e siga ${MOTOR_PROMPT}/${nome}. Onde ele diz <MOTOR>, use: ${MOTOR_PROMPT}`,
    `Assunto: ${b.assunto}. Objetivo: ${b.objetivo}. Duração alvo: ${duracaoTexto(b)}.${b.observacao ? ` Observação do operador: ${b.observacao}` : ''}`,
    `Formato: ${b.formato === 'status' ? 'Story/Status do WhatsApp (REGRAS.md § Formato)' : 'Reels'}.`,
    ...(b.oferta ? [`Oferta: ${b.oferta.produtos.length} produto${b.oferta.produtos.length > 1 ? 's' : ''} em produtos.json, criação ${b.oferta.criacao === 'padrao' ? 'VT padrão' : 'nova'} (REGRAS.md § Oferta).`] : []),
    ...(b.oferta ? [linhaMoldura(b.oferta)] : []),
    ...(ESTILO_TEXTO[b.estilo] ? [`Estilo: ${ESTILO_TEXTO[b.estilo]} (REGRAS.md § Estilo).`] : []),
    LEGENDA_TEXTO[b.legenda] || `Legendas na tela: modelo "${b.legenda}" (já definido, não mude).`,
    temLogo ? 'O logo da marca está em fotos/logo.png.' : 'Esta marca não tem logo cadastrado; não use logo.',
    ...(erroAnterior ? [`A tentativa anterior falhou com: ${erroAnterior}`] : []),
  ].join('\n');
}

// Brand, voice and caption come from the briefing, never from the model.
function forcarRoteiro(roteiro, briefing, marca) {
  roteiro.marca = marca;
  roteiro.voz = 'gemini:Puck';
  roteiro.velocidade = '+6%';
  roteiro.direcao = DIRECOES[briefing.tom];
  roteiro.objetivo = briefing.objetivo;
  delete roteiro.legenda;
  delete roteiro.legendas;
  if (briefing.legenda === 'sem') roteiro.legendas = false;
  else if (briefing.legenda !== 'do-video') roteiro.legenda = briefing.legenda;
  if (briefing.oferta) {
    const o = briefing.oferta;
    // "auto" keeps Claude's pick (validated before this); anything else comes from the briefing.
    if (o.moldura !== 'auto') roteiro.moldura = o.moldura;
    roteiro.campanha = o.campanha;
    roteiro.ritmo = o.ritmo;
    roteiro.trilha = (MOLDURAS.find((m) => m.id === roteiro.moldura) || MOLDURAS[0]).trilha;
  }
  return roteiro;
}

// Stale files from a previous run must not pass as this run's output.
async function escritoDepois(path, inicio) {
  try { return (await stat(path)).mtimeMs >= inicio - CLOCK_SLACK_MS; } catch { return false; }
}

const falas = (roteiro) => JSON.stringify((roteiro?.cenas || []).map((c) => [c.tipo, c.fala]));

// Runs the motor's TTS directly (VT padrão has no Claude in stage 2).
// `bin`/`args`/`timeoutMs` exist only so tests can run a stand-in process.
export function narrarComTts(dir, { timeoutMs = TTS_TIMEOUT_MS, bin = process.env.PYTHON_BIN || 'python', args = [join(MOTOR_DIR, 'tts.py'), dir] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    // The queue runs one job at a time: a stalled Gemini stream would block every project.
    const timer = setTimeout(() => { killTree(child); reject(new Error('A voz passou de 10 minutos e foi interrompida.')); }, timeoutMs);
    let saida = '';
    child.stdout.on('data', (c) => { saida += c; });
    child.stderr.on('data', (c) => { saida += c; });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`Não consegui gerar a voz: ${err.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(saida.trim().slice(-600) || `A voz saiu com código ${code}.`)); });
  });
}

export function createVideoJobs({ targetDir, runner = runClaudeCode, renderer = defaultRenderer, narrador = narrarComTts }) {
  const queue = [];
  const busy = new Set();
  let running = null;

  async function etapaRoteiro(projectId, video, dir, { ajuste, erroAnterior, inicio }) {
    const project = await requireVideoProject(projectId, targetDir);
    const { marca, settings, temLogo } = await prepareFolder(project, video, dir, targetDir);
    await writeAjuste(dir, ajuste);
    const addDirs = [MOTOR_DIR, ...settings.projetosDeMaterial.map((id) => getCentralPaths(targetDir, id).assetsDir)];
    const rodar = async (erro, desde) => {
      await runner({ prompt: `# Etapa 1
${stagePrompt('PEDIDO-roteiro.md', video, temLogo, erro)}`, cwd: dir, addDirs });
      if (!await escritoDepois(join(dir, 'roteiro.json'), desde)) throw new Error('O Claude não escreveu o roteiro.json.');
      const lido = await readJson(join(dir, 'roteiro.json'), null);
      if (!lido) throw new Error('O Claude não escreveu o roteiro.json.');
      return lido;
    };
    const oferta = video.briefing.oferta;
    let roteiro = await rodar(erroAnterior, inicio);
    // Oferta: prices only through placeholders. One automatic retry with the
    // problems spelled out, then the operator sees the error.
    if (oferta) {
      let problemas = validateRoteiroOferta(roteiro, oferta);
      if (problemas.length) {
        roteiro = await rodar(problemas.join(' '), Date.now());
        problemas = validateRoteiroOferta(roteiro, oferta);
        if (problemas.length) throw new Error(problemas.join(' '));
      }
    }
    forcarRoteiro(roteiro, video.briefing, marca);
    const { erros } = validateRoteiro(roteiro, video.briefing);
    if (erros.length) throw new Error(erros.join(' '));
    if (oferta) {
      await writeJson(join(dir, 'roteiro-modelo.json'), roteiro);
      roteiro = expandirRoteiro(roteiro, oferta);
    }
    await writeJson(join(dir, 'roteiro.json'), roteiro);
    return STATUS.ROTEIRO_PRONTO;
  }

  async function etapaProducao(projectId, video, dir, { ajuste, erroAnterior, inicio }) {
    const aprovado = await readJson(join(dir, 'roteiro.json'), null);
    if (!aprovado) throw new Error('Não há roteiro aprovado para produzir.');
    await writeAjuste(dir, ajuste);
    const oferta = video.briefing.oferta;
    if (oferta?.criacao === 'padrao') {
      // Fixed template: narration and stills are mechanical, no Claude.
      await narrador(dir);
      await copyFile(join(MOTOR_DIR, 'modelos', 'vt-padrao', 'cenas.js'), join(dir, 'cenas.js'));
    } else {
      const temLogo = existsSync(join(dir, 'fotos', 'logo.png'));
      // Prices come from the catalog, never from Claude: produtos.json comes back as it was.
      const produtosOriginal = oferta ? await readJson(join(dir, 'produtos.json'), null) : null;
      await runner({ prompt: `# Etapa 2
${stagePrompt('PEDIDO-producao.md', video, temLogo, erroAnterior)}`, cwd: dir, addDirs: [MOTOR_DIR] });
      if (produtosOriginal) await writeJson(join(dir, 'produtos.json'), produtosOriginal);
      if (!await escritoDepois(join(dir, 'cenas.js'), inicio)) throw new Error('A produção não gerou cenas.js.');
    }
    // Oferta: the post caption is mechanical too, so no hand-typed price reaches it.
    if (oferta) {
      const { loja } = await readJson(join(dir, 'produtos.json'), { loja: {} });
      await writeFile(join(dir, 'legenda-post.txt'), legendaPostOferta(oferta, loja));
    }
    // An adjustment may reuse the existing voice (saves quota): tempos.json then only has to exist.
    const temposPath = join(dir, 'voz', 'tempos.json');
    if (ajuste ? !existsSync(temposPath) : !await escritoDepois(temposPath, inicio)) throw new Error('A produção não gerou voz/tempos.json.');
    // Claude may have touched roteiro.json: spoken lines and scene order stay as approved, the forced fields come back.
    const atual = await readJson(join(dir, 'roteiro.json'), null);
    if (!atual || falas(atual) !== falas(aprovado)) throw new Error('A produção alterou as falas ou a ordem das cenas do roteiro aprovado.');
    await writeJson(join(dir, 'roteiro.json'), forcarRoteiro(atual, video.briefing, aprovado.marca));
    // Mechanical check: sample the first instant and the end of each scene's last word; the scenes must draw there without errors.
    const tempos = await readJson(join(dir, 'voz', 'tempos.json'), { cenas: [] });
    const marcas = [0.05, ...tempos.cenas.map((c) => c.words?.[c.words.length - 1]).filter(Boolean).map((w) => Math.round((w.t + w.d) * 100) / 100)];
    // Claude's own check renders and older rounds must not show up in the preview grid.
    await rm(join(dir, 'stills'), { recursive: true, force: true });
    await renderer({ videoDir: dir, stills: marcas });
    return STATUS.PREVIA_PRONTA;
  }

  async function etapaRender(projectId, video, dir) {
    await renderer({ videoDir: dir });
    return STATUS.PRONTO;
  }

  const ETAPAS = { roteiro: etapaRoteiro, producao: etapaProducao, render: etapaRender };

  async function pump() {
    if (running) return;
    const job = queue.shift();
    if (!job) return;
    running = job;
    const { projectId, videoId, etapa, opts } = job;
    const inicio = Date.now();
    try {
      const video = await readVideo(projectId, videoId, targetDir);
      const dir = videoDir(targetDir, projectId, videoId);
      const status = await ETAPAS[etapa](projectId, video, dir, { ...opts, inicio });
      await updateVideo(projectId, videoId, { status, ajustePendente: null }, targetDir);
    } catch (err) {
      await updateVideo(projectId, videoId, { status: err.limite ? STATUS.AGUARDANDO_LIMITE : STATUS.ERRO, erro: String(err.message || err).slice(0, 800), etapaComErro: etapa }, targetDir).catch(() => {});
    } finally {
      busy.delete(`${projectId}/${videoId}`);
      running = null;
      job.done();
      pump();
    }
  }

  return {
    async enqueue(projectId, videoId, etapa, opts = {}) {
      if (!ETAPAS[etapa]) throw new Error(`Etapa desconhecida: ${etapa}`);
      let done;
      const finished = new Promise((r) => { done = r; });
      busy.add(`${projectId}/${videoId}`);
      queue.push({ projectId, videoId, etapa, opts, done, finished });
      pump();
    },
    isBusy: (projectId, videoId) => busy.has(`${projectId}/${videoId}`),
    async idle() {
      while (running || queue.length) await (running || queue[0]).finished;
    },
  };
}
