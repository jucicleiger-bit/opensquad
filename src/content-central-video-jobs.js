// Runs the Vídeo animado stages: Claude Code writes the script (stage 1) and
// the per-video scene code (stage 2) inside the video folder; the motor
// renders the MP4 (stage 3). One job at a time: Claude, Whisper and the
// renderer all compete for the same CPU.
import { spawn } from 'node:child_process';
import { copyFile, writeFile, rm, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, getCentralPaths } from './content-central.js';
import {
  STATUS, requireVideoProject, readVideo, updateVideo, videoDir, validateRoteiro, buildMarca, buildMaterialInventory, normalizeVideoAnimado,
} from './content-central-video.js';

const MOTOR_DIR = fileURLToPath(new URL('./video-motor/', import.meta.url));
const MOTOR_PROMPT = MOTOR_DIR.replaceAll('\\', '/').replace(/\/+$/, ''); // Git Bash loses backslashes
const CLAUDE_TIMEOUT_MS = 45 * 60 * 1000;
const CLOCK_SLACK_MS = 2000; // coarse filesystem timestamps

export const DIRECOES = {
  criador: 'Leia em português do Brasil, como um criador de conteúdo de Instagram: animado, sorrindo, ritmo rápido, com energia e variação de entonação, dando ênfase nas palavras importantes. Leia exatamente o texto abaixo, sem acrescentar nada:',
  vendedor: 'Leia em português do Brasil, como um vendedor simpático e confiante de loja de bairro: próximo, caloroso e natural, sem exagero, com ritmo de anúncio de Instagram. Leia exatamente o texto abaixo, sem acrescentar nada:',
};

export function isUsageLimit(text) {
  return /usage limit|hit your limit|limit reached|limite de uso/i.test(String(text || ''));
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

async function prepareFolder(project, video, dir, targetDir) {
  const settings = normalizeVideoAnimado(project.videoAnimado);
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

function stagePrompt(nome, video, temLogo, erroAnterior) {
  const b = video.briefing;
  return [
    `Leia e siga ${MOTOR_PROMPT}/${nome}. Onde ele diz <MOTOR>, use: ${MOTOR_PROMPT}`,
    `Assunto: ${b.assunto}. Objetivo: ${b.objetivo}. Duração alvo: ${b.duracao}s.${b.observacao ? ` Observação do operador: ${b.observacao}` : ''}`,
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
  return roteiro;
}

// Stale files from a previous run must not pass as this run's output.
async function escritoDepois(path, inicio) {
  try { return (await stat(path)).mtimeMs >= inicio - CLOCK_SLACK_MS; } catch { return false; }
}

const falas = (roteiro) => JSON.stringify((roteiro?.cenas || []).map((c) => [c.tipo, c.fala]));

export function createVideoJobs({ targetDir, runner = runClaudeCode, renderer = defaultRenderer }) {
  const queue = [];
  const busy = new Set();
  let running = null;

  async function etapaRoteiro(projectId, video, dir, { ajuste, erroAnterior, inicio }) {
    const project = await requireVideoProject(projectId, targetDir);
    const { marca, settings, temLogo } = await prepareFolder(project, video, dir, targetDir);
    await writeAjuste(dir, ajuste);
    const addDirs = [MOTOR_DIR, ...settings.projetosDeMaterial.map((id) => getCentralPaths(targetDir, id).assetsDir)];
    await runner({ prompt: `# Etapa 1
${stagePrompt('PEDIDO-roteiro.md', video, temLogo, erroAnterior)}`, cwd: dir, addDirs });
    if (!await escritoDepois(join(dir, 'roteiro.json'), inicio)) throw new Error('O Claude não escreveu o roteiro.json.');
    const roteiro = await readJson(join(dir, 'roteiro.json'), null);
    if (!roteiro) throw new Error('O Claude não escreveu o roteiro.json.');
    forcarRoteiro(roteiro, video.briefing, marca);
    const { erros } = validateRoteiro(roteiro, video.briefing);
    if (erros.length) throw new Error(erros.join(' '));
    await writeJson(join(dir, 'roteiro.json'), roteiro);
    return STATUS.ROTEIRO_PRONTO;
  }

  async function etapaProducao(projectId, video, dir, { ajuste, erroAnterior, inicio }) {
    const aprovado = await readJson(join(dir, 'roteiro.json'), null);
    if (!aprovado) throw new Error('Não há roteiro aprovado para produzir.');
    await writeAjuste(dir, ajuste);
    const temLogo = existsSync(join(dir, 'fotos', 'logo.png'));
    await runner({ prompt: `# Etapa 2
${stagePrompt('PEDIDO-producao.md', video, temLogo, erroAnterior)}`, cwd: dir, addDirs: [MOTOR_DIR] });
    // An adjustment may reuse the existing voice (saves quota): tempos.json then only has to exist.
    if (!await escritoDepois(join(dir, 'cenas.js'), inicio)) throw new Error('A produção não gerou cenas.js.');
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
