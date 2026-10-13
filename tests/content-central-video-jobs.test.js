import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Jimp } from 'jimp';
import { createCentralProject, getCentralPaths } from '../src/content-central.js';
import { STATUS, createVideo, readVideo, updateVideo, videoDir } from '../src/content-central-video.js';
import { createVideoJobs, isUsageLimit, runClaudeCode, narrarComTts, DIRECOES } from '../src/content-central-video-jobs.js';

const briefing = { assunto: 'Bio do Instagram', objetivo: 'alcance', duracao: 15, tom: 'vendedor', legenda: 'sem', observacao: 'usar Carvalho' };

async function withProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-video-jobs-'));
  try {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    const paths = getCentralPaths(dir, 'king');
    const project = JSON.parse(await readFile(paths.projectPath, 'utf8'));
    project.videoAnimado = { ativo: true, projetosDeMaterial: [], whatsapp: '65 98108-6707' };
    await writeFile(paths.projectPath, JSON.stringify(project));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

// A fake Claude that writes the files a real run would, for each stage.
function fakeRunner(calls, { fail } = {}) {
  return async ({ prompt, cwd }) => {
    calls.push({ prompt, cwd });
    if (fail) throw fail;
    if (/Etapa 1/.test(prompt)) {
      await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'a', fala: 'Sua bio tem os cinco itens?', descricao: 'Pergunta' }, { tipo: 'b', fala: 'Comenta quantos tem a sua?', descricao: 'Enquete' }] }));
    } else {
      await writeFile(join(cwd, 'cenas.js'), 'window.VIDEO = {};');
      await mkdir(join(cwd, 'voz'), { recursive: true });
      await writeFile(join(cwd, 'voz', 'tempos.json'), JSON.stringify({ cenas: [{ words: [{ w: 'Sua', t: 0.05, d: 0.2 }] }, { words: [{ w: 'Comenta', t: 2, d: 0.3 }] }] }));
    }
    return { text: 'feito' };
  };
}

test('isUsageLimit recognises Claude Code limit messages', () => {
  assert.equal(isUsageLimit('Claude AI usage limit reached|1791700000'), true);
  assert.equal(isUsageLimit("You've hit your limit · resets 3pm"), true);
  assert.equal(isUsageLimit("You've hit your session limit · resets 2am (America/Cuiaba)"), true);
  assert.equal(isUsageLimit('erro de sintaxe'), false);
});

test('stage 1 prepares the folder, runs Claude with the stage prompt and forces brand, voice and caption', async () => {
  await withProject(async (dir) => {
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner(calls), renderer: async () => ({}) });
    const video = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const vdir = videoDir(dir, 'king', video.id);
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.ROTEIRO_PRONTO);
    assert.match(calls[0].prompt, /Etapa 1/);
    assert.equal(calls[0].cwd, vdir);
    for (const f of ['briefing.json', 'marca.json', 'material.json', 'REGRAS.md']) assert.ok(existsSync(join(vdir, f)), f);
    const roteiro = JSON.parse(await readFile(join(vdir, 'roteiro.json'), 'utf8'));
    assert.equal(roteiro.voz, 'gemini:Puck');
    assert.equal(roteiro.direcao, DIRECOES.vendedor);
    assert.equal(roteiro.legendas, false);
    assert.equal(roteiro.marca.whatsapp, '65 98108-6707');
  });
});

test('stage 2 runs Claude, checks the preview with the renderer and lands in previa_pronta', async () => {
  await withProject(async (dir) => {
    const calls = [];
    const renders = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner(calls), renderer: async (opts) => { renders.push(opts); return { stills: ['t0.05.jpg'] }; } });
    const video = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
    await jobs.enqueue('king', video.id, 'producao', { ajuste: 'mais rápido' });
    await jobs.idle();
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.PREVIA_PRONTA);
    assert.match(calls[1].prompt, /Etapa 2/);
    assert.equal(await readFile(join(videoDir(dir, 'king', video.id), 'ajuste.txt'), 'utf8'), 'mais rápido');
    assert.ok(renders[0].stills.length >= 2);
  });
});

test('a usage limit sets aguardando_limite and any other failure sets erro', async () => {
  await withProject(async (dir) => {
    const limite = Object.assign(new Error("You've hit your limit"), { limite: true });
    const jobsA = createVideoJobs({ targetDir: dir, runner: fakeRunner([], { fail: limite }), renderer: async () => ({}) });
    const a = await createVideo('king', briefing, dir);
    await jobsA.enqueue('king', a.id, 'roteiro');
    await jobsA.idle();
    assert.equal((await readVideo('king', a.id, dir)).status, STATUS.AGUARDANDO_LIMITE);
    const jobsB = createVideoJobs({ targetDir: dir, runner: fakeRunner([], { fail: new Error('quebrou') }), renderer: async () => ({}) });
    const b = await createVideo('king', briefing, dir);
    await jobsB.enqueue('king', b.id, 'roteiro');
    await jobsB.idle();
    const vb = await readVideo('king', b.id, dir);
    assert.equal(vb.status, STATUS.ERRO);
    assert.match(vb.erro, /quebrou/);
  });
});

test('jobs run one at a time', async () => {
  await withProject(async (dir) => {
    let running = 0;
    let peak = 0;
    const base = fakeRunner([]);
    const runner = async (input) => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 30)); try { return await base(input); } finally { running -= 1; } };
    const jobs = createVideoJobs({ targetDir: dir, runner, renderer: async () => ({}) });
    const a = await createVideo('king', briefing, dir);
    const b = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', a.id, 'roteiro');
    await jobs.enqueue('king', b.id, 'roteiro');
    assert.equal(jobs.isBusy('king', a.id) || jobs.isBusy('king', b.id), true);
    await jobs.idle();
    assert.equal(peak, 1);
  });
});

test('stage 3 renders the full video and lands in pronto', async () => {
  await withProject(async (dir) => {
    const renders = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner([]), renderer: async (opts) => { renders.push(opts); return { out: 'x' }; } });
    const video = await createVideo('king', briefing, dir);
    await updateVideo('king', video.id, { status: STATUS.RENDER_GERANDO }, dir);
    await jobs.enqueue('king', video.id, 'render');
    await jobs.idle();
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.PRONTO);
    assert.deepEqual(renders, [{ videoDir: videoDir(dir, 'king', video.id) }]);
  });
});

// Runs stage 1 with the plain fake, then stage 2 with `runner2`; returns the video after stage 2.
async function runStage2(dir, runner2, renderer = async () => ({})) {
  const video = await createVideo('king', briefing, dir);
  const um = createVideoJobs({ targetDir: dir, runner: fakeRunner([]), renderer });
  await um.enqueue('king', video.id, 'roteiro');
  await um.idle();
  await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
  const dois = createVideoJobs({ targetDir: dir, runner: runner2, renderer });
  await dois.enqueue('king', video.id, 'producao');
  await dois.idle();
  return { video: await readVideo('king', video.id, dir), vdir: videoDir(dir, 'king', video.id) };
}

const velho = new Date(Date.now() - 3600 * 1000);

test('a roteiro that fails validation fails stage 1', async () => {
  await withProject(async (dir) => {
    const runner = async ({ cwd }) => { await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'a', fala: '', descricao: 'x' }] })); return { text: '' }; };
    const jobs = createVideoJobs({ targetDir: dir, runner, renderer: async () => ({}) });
    const video = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const v = await readVideo('king', video.id, dir);
    assert.equal(v.status, STATUS.ERRO);
    assert.match(v.erro, /sem fala/);
  });
});

test('stage 1 fails when roteiro.json is stale (not written during this run)', async () => {
  await withProject(async (dir) => {
    const video = await createVideo('king', briefing, dir);
    const antigo = join(videoDir(dir, 'king', video.id), 'roteiro.json');
    await writeFile(antigo, JSON.stringify({ cenas: [{ tipo: 'a', fala: 'Velho?', descricao: 'x' }] }));
    await utimes(antigo, velho, velho);
    const jobs = createVideoJobs({ targetDir: dir, runner: async () => ({ text: '' }), renderer: async () => ({}) });
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const v = await readVideo('king', video.id, dir);
    assert.equal(v.status, STATUS.ERRO);
    assert.match(v.erro, /roteiro\.json/);
  });
});

test('a renderer that throws in stage 2 sets erro', async () => {
  await withProject(async (dir) => {
    const { video } = await runStage2(dir, fakeRunner([]), async () => { throw new Error('cena quebrada'); });
    assert.equal(video.status, STATUS.ERRO);
    assert.match(video.erro, /cena quebrada/);
  });
});

test('stage 2 fails when the runner changes a spoken line', async () => {
  await withProject(async (dir) => {
    const base = fakeRunner([]);
    const runner = async (input) => {
      await base(input);
      const f = join(input.cwd, 'roteiro.json');
      const r = JSON.parse(await readFile(f, 'utf8'));
      r.cenas[0].fala = 'Outra fala completamente diferente?';
      await writeFile(f, JSON.stringify(r));
      return { text: '' };
    };
    const { video } = await runStage2(dir, runner);
    assert.equal(video.status, STATUS.ERRO);
    assert.match(video.erro, /falas/);
  });
});

test('stage 2 re-forces voice, caption and brand and keeps segura changes', async () => {
  await withProject(async (dir) => {
    const base = fakeRunner([]);
    const runner = async (input) => {
      await base(input);
      const f = join(input.cwd, 'roteiro.json');
      const r = JSON.parse(await readFile(f, 'utf8'));
      Object.assign(r, { voz: 'edge:outra', legendas: true, legenda: 'bonita', direcao: 'grite', marca: { whatsapp: '0' } });
      r.cenas[0].segura = 3;
      await writeFile(f, JSON.stringify(r));
      return { text: '' };
    };
    const { video, vdir } = await runStage2(dir, runner);
    assert.equal(video.status, STATUS.PREVIA_PRONTA);
    const r = JSON.parse(await readFile(join(vdir, 'roteiro.json'), 'utf8'));
    assert.equal(r.voz, 'gemini:Puck');
    assert.equal(r.legendas, false);
    assert.equal(r.legenda, undefined);
    assert.equal(r.direcao, DIRECOES.vendedor);
    assert.equal(r.marca.whatsapp, '65 98108-6707');
    assert.equal(r.cenas[0].segura, 3);
  });
});

test('stage 2 fails when cenas.js and tempos.json are stale', async () => {
  await withProject(async (dir) => {
    const video = await createVideo('king', briefing, dir);
    const vdir = videoDir(dir, 'king', video.id);
    const um = createVideoJobs({ targetDir: dir, runner: fakeRunner([]), renderer: async () => ({}) });
    await um.enqueue('king', video.id, 'roteiro');
    await um.idle();
    await mkdir(join(vdir, 'voz'), { recursive: true });
    for (const f of ['cenas.js', 'voz/tempos.json']) { await writeFile(join(vdir, f), f.endsWith('.js') ? 'x' : '{"cenas":[]}'); await utimes(join(vdir, f), velho, velho); }
    await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
    const dois = createVideoJobs({ targetDir: dir, runner: async () => ({ text: '' }), renderer: async () => ({}) });
    await dois.enqueue('king', video.id, 'producao');
    await dois.idle();
    const v = await readVideo('king', video.id, dir);
    assert.equal(v.status, STATUS.ERRO);
    assert.match(v.erro, /cenas\.js/);
  });
});

test('the stage prompts name the motor with forward slashes and say whether there is a logo and which caption mode', async () => {
  await withProject(async (dir) => {
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner(calls), renderer: async () => ({}) });
    const video = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.doesNotMatch(calls[0].prompt, /\\/);
    assert.match(calls[0].prompt, /video-motor\/PEDIDO-roteiro\.md/);
    assert.match(calls[0].prompt, /não tem logo/);
    assert.match(calls[0].prompt, /legendas": false/);
    const roteiro = JSON.parse(await readFile(join(videoDir(dir, 'king', video.id), 'roteiro.json'), 'utf8'));
    assert.equal(roteiro.marca.logo, '');
  });
});

test('runClaudeCode rejects on timeout', async () => {
  await assert.rejects(runClaudeCode({ prompt: 'x', cwd: tmpdir(), timeoutMs: 300, bin: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }), /interrompido/);
});

test('narrarComTts rejects with the timeout message when the TTS never exits', async () => {
  await assert.rejects(narrarComTts(tmpdir(), { timeoutMs: 300, bin: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }), /A voz passou de 10 minutos e foi interrompida\./);
});

test('narrarComTts runs python with UTF-8 output so the error text has no mojibake', async () => {
  await assert.rejects(narrarComTts(tmpdir(), { bin: process.execPath, args: ['-e', 'console.error(process.env.PYTHONIOENCODING); process.exit(3)'] }), /^Error: utf-8/);
});

test('runClaudeCode timeout kills the whole process tree on Windows', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-video-kill-'));
  try {
    const pidFile = join(dir, 'neto.pid');
    const script = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`;
    await assert.rejects(runClaudeCode({ prompt: 'x', cwd: dir, timeoutMs: 2500, bin: process.execPath, args: ['-e', script] }), /interrompido/);
    const pid = Number(await readFile(pidFile, 'utf8'));
    const vivo = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 30 && vivo(); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.equal(vivo(), false, 'grandchild should be gone');
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

// Stage 1, then an old voice already on disk; stage 2 only rewrites cenas.js.
async function stage2ComVozAntiga(dir, ajuste) {
  const video = await createVideo('king', briefing, dir);
  const vdir = videoDir(dir, 'king', video.id);
  const um = createVideoJobs({ targetDir: dir, runner: fakeRunner([]), renderer: async () => ({}) });
  await um.enqueue('king', video.id, 'roteiro');
  await um.idle();
  await mkdir(join(vdir, 'voz'), { recursive: true });
  const tempos = join(vdir, 'voz', 'tempos.json');
  await writeFile(tempos, JSON.stringify({ cenas: [{ words: [{ w: 'Sua', t: 0.05, d: 0.2 }] }] }));
  await utimes(tempos, velho, velho);
  await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
  const soCenas = async ({ cwd }) => { await writeFile(join(cwd, 'cenas.js'), 'window.VIDEO = {};'); return { text: '' }; };
  const dois = createVideoJobs({ targetDir: dir, runner: soCenas, renderer: async () => ({}) });
  await dois.enqueue('king', video.id, 'producao', ajuste ? { ajuste } : {});
  await dois.idle();
  return readVideo('king', video.id, dir);
}

test('stage 2 with an ajuste may reuse the existing voice (only cenas.js has to be fresh)', async () => {
  await withProject(async (dir) => {
    assert.equal((await stage2ComVozAntiga(dir, 'troque as cores')).status, STATUS.PREVIA_PRONTA);
  });
});

test('stage 2 without an ajuste still requires a fresh voz/tempos.json', async () => {
  await withProject(async (dir) => {
    const v = await stage2ComVozAntiga(dir, '');
    assert.equal(v.status, STATUS.ERRO);
    assert.match(v.erro, /tempos\.json/);
  });
});

test('stage 2 empties stills/ before the mechanical check, so old stills do not reach the preview', async () => {
  await withProject(async (dir) => {
    let antigoNaHora = null;
    const renderer = async ({ videoDir: vd, stills }) => {
      if (!stills) return {};
      antigoNaHora = existsSync(join(vd, 'stills', 'old.jpg'));
      await mkdir(join(vd, 'stills'), { recursive: true });
      await writeFile(join(vd, 'stills', 't0.05.jpg'), 'jpg');
      return {};
    };
    const base = fakeRunner([]);
    const runner = async (input) => {
      await mkdir(join(input.cwd, 'stills'), { recursive: true });
      await writeFile(join(input.cwd, 'stills', 'old.jpg'), 'velho');
      return base(input);
    };
    const { video, vdir } = await runStage2(dir, runner, renderer);
    assert.equal(video.status, STATUS.PREVIA_PRONTA);
    assert.equal(antigoNaHora, false);
    assert.equal(existsSync(join(vdir, 'stills', 'old.jpg')), false);
    assert.equal(existsSync(join(vdir, 'stills', 't0.05.jpg')), true);
  });
});

test('a retry after an error tells Claude what failed before; a success clears the pending ajuste', async () => {
  await withProject(async (dir) => {
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner(calls), renderer: async () => ({}) });
    const video = await createVideo('king', briefing, dir);
    await updateVideo('king', video.id, { ajustePendente: { etapa: 'roteiro', pedido: 'mais curto' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro', { ajuste: 'mais curto', erroAnterior: 'O Claude não escreveu o roteiro.json.' });
    await jobs.idle();
    assert.match(calls[0].prompt, /A tentativa anterior falhou com: O Claude não escreveu o roteiro\.json\./);
    const v = await readVideo('king', video.id, dir);
    assert.equal(v.status, STATUS.ROTEIRO_PRONTO);
    assert.equal(v.ajustePendente, null);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.doesNotMatch(calls[1].prompt, /tentativa anterior/);
  });
});

test('DIRECOES has the locutor direction', () => {
  assert.match(DIRECOES.locutor, /^Leia em português do Brasil, como locutor de comercial de supermercado/);
});

test('stage 1 prompt carries format, style and auto duration', async () => {
  await withProject(async (dir) => {
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner(calls), renderer: async () => ({}) });
    const video = await createVideo('king', { ...briefing, formato: 'status', estilo: 'premium', duracao: 'auto' }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.match(calls[0].prompt, /Formato: Story\/Status/);
    assert.match(calls[0].prompt, /Estilo: premium/);
    assert.match(calls[0].prompt, /Duração alvo: automática/);
  });
});

async function comOferta(dir, projectId = 'king') {
  const paths = getCentralPaths(dir, projectId);
  await mkdir(join(paths.projectDir, 'assets', 'references'), { recursive: true });
  const im = new Jimp({ width: 40, height: 40, color: 0xffffffff });
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) im.setPixelColor(0x202020ff, x, y);
  await im.write(join(paths.projectDir, 'assets', 'references', 'fralda.png'));
  const project = JSON.parse(await readFile(paths.projectPath, 'utf8'));
  project.offerAssets = [{ id: 'f1', relativePath: 'assets/references/fralda.png', previewUrl: '/p/fralda.png' }];
  project.contentStrategy = { ...(project.contentStrategy || {}), offers: [{ id: 'fralda', name: 'Fralda IsaBaby', type: 'offer', price: 'R$ 13,99', originalPrice: 'R$ 16,99', priceUnit: 'un', photoReferenceIds: ['f1'] }] };
  await writeFile(paths.projectPath, JSON.stringify(project));
}
const ofertaBriefing = { ...briefing, objetivo: 'oferta', tom: 'locutor', oferta: { produtos: [{ id: 'fralda' }], validoAte: '2026-10-18', criacao: 'nova' } };

function ofertaRunner(calls, falas) {
  let n = 0;
  return async ({ prompt, cwd }) => {
    calls.push({ prompt, cwd });
    const fala = falas[Math.min(n++, falas.length - 1)];
    await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'abre', fala: 'Olha as ofertas!', descricao: 'a' }, { tipo: 'p', produto: 'fralda', fala, descricao: 'b' }, { tipo: 'fim', fala: 'Só até {validade}, chama no WhatsApp!', descricao: 'c' }] }));
    return { text: 'ok' };
  };
}

test('Oferta stage 1 writes produtos.json, the cutout photo, the template and the expanded roteiro', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda de {precoDe} por {preco}!']), renderer: async () => ({}) });
    const video = await createVideo('king', ofertaBriefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const vdir = videoDir(dir, 'king', video.id);
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.ROTEIRO_PRONTO);
    const produtos = JSON.parse(await readFile(join(vdir, 'produtos.json'), 'utf8'));
    assert.equal(produtos.produtos[0].precoTela, 'R$ 13,99');
    assert.equal(produtos.produtos[0].foto, 'fotos/produto-fralda.png');
    assert.ok(existsSync(join(vdir, 'fotos', 'produto-fralda.png')));
    assert.match(JSON.parse(await readFile(join(vdir, 'roteiro-modelo.json'), 'utf8')).cenas[1].fala, /\{preco\}/);
    assert.equal(JSON.parse(await readFile(join(vdir, 'roteiro.json'), 'utf8')).cenas[1].fala, 'Fralda de dezesseis e noventa e nove por treze e noventa e nove!');
    assert.match(calls[0].prompt, /Oferta: 1 produto/);
  });
});

test('Oferta stage 1 retries once with the validation error, then fails', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por 13,99!', 'Fralda por 13,99!']), renderer: async () => ({}) });
    const video = await createVideo('king', ofertaBriefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.equal(calls.length, 2);
    assert.match(calls[1].prompt, /A tentativa anterior falhou com: .*dígitos/);
    const final = await readVideo('king', video.id, dir);
    assert.equal(final.status, STATUS.ERRO);
    assert.match(final.erro, /dígitos/);
  });
});

test('Oferta stage 1 retry succeeds when Claude fixes the roteiro', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por 13,99!', 'Fralda por {preco}!']), renderer: async () => ({}) });
    const video = await createVideo('king', ofertaBriefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.ROTEIRO_PRONTO);
  });
});

test('Oferta prompt: a fixed duration is kept, only auto uses the per-product formula', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por {preco}!']), renderer: async () => ({}) });
    const fixo = await createVideo('king', { ...ofertaBriefing, duracao: 15 }, dir);
    await jobs.enqueue('king', fixo.id, 'roteiro');
    await jobs.idle();
    assert.match(calls[0].prompt, /Duração alvo: 15s/);
    assert.doesNotMatch(calls[0].prompt, /cerca de .* por produto/);
    const auto = await createVideo('king', { ...ofertaBriefing, duracao: 'auto' }, dir);
    await jobs.enqueue('king', auto.id, 'roteiro');
    await jobs.idle();
    assert.match(calls[1].prompt, /Duração alvo: automática .*por produto/);
  });
});

test('VT padrão stage 2 never calls Claude: it narrates, copies the template, writes the caption and stills', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const narrados = [];
    const renders = [];
    const runner = async ({ prompt, cwd }) => {
      calls.push(prompt);
      await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'abertura', fala: 'Ofertas!', descricao: 'a' }, { tipo: 'produto', produto: 'fralda', fala: 'Fralda por {preco}!', descricao: 'b' }, { tipo: 'fechamento', fala: 'Chama no WhatsApp!', descricao: 'c' }] }));
      return { text: 'ok' };
    };
    const narrador = async (vdir) => {
      narrados.push(vdir);
      await mkdir(join(vdir, 'voz'), { recursive: true });
      await writeFile(join(vdir, 'voz', 'tempos.json'), JSON.stringify({ cenas: [{ words: [{ w: 'Ofertas', t: 0.05, d: 0.3 }] }, { words: [{ w: 'Fralda', t: 1, d: 0.3 }] }, { words: [{ w: 'Chama', t: 3, d: 0.3 }] }] }));
    };
    const jobs = createVideoJobs({ targetDir: dir, runner, narrador, renderer: async (o) => { renders.push(o); return {}; } });
    const video = await createVideo('king', { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, criacao: 'padrao' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
    await jobs.enqueue('king', video.id, 'producao');
    await jobs.idle();
    const vdir = videoDir(dir, 'king', video.id);
    assert.equal(calls.length, 1, 'only stage 1 called Claude');
    assert.deepEqual(narrados, [vdir]);
    assert.equal(await readFile(join(vdir, 'cenas.js'), 'utf8'), await readFile(new URL('../src/video-motor/modelos/vt-padrao/cenas.js', import.meta.url), 'utf8'));
    assert.match(await readFile(join(vdir, 'legenda-post.txt'), 'utf8'), /R\$ 13,99/);
    assert.ok(renders[0].stills.length >= 2);
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.PREVIA_PRONTA);
  });
});

test('Oferta nova stage 2: Claude cannot change produtos.json, and legenda-post.txt is rebuilt with the catalog price', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const runner = async ({ prompt, cwd }) => {
      if (/# Etapa 1/.test(prompt)) return ofertaRunner([], ['Fralda por {preco}!'])({ prompt, cwd });
      const p = JSON.parse(await readFile(join(cwd, 'produtos.json'), 'utf8'));
      p.produtos[0].precoTela = 'R$ 0,01';
      await writeFile(join(cwd, 'produtos.json'), JSON.stringify(p));
      await writeFile(join(cwd, 'legenda-post.txt'), 'Fralda por R$ 0,01!');
      await writeFile(join(cwd, 'cenas.js'), '// cenas');
      await mkdir(join(cwd, 'voz'), { recursive: true });
      await writeFile(join(cwd, 'voz', 'tempos.json'), JSON.stringify({ cenas: [{ words: [{ w: 'a', t: 0.1, d: 0.2 }] }] }));
      return { text: 'ok' };
    };
    const jobs = createVideoJobs({ targetDir: dir, runner, renderer: async () => ({}) });
    const video = await createVideo('king', ofertaBriefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const vdir = videoDir(dir, 'king', video.id);
    const original = await readFile(join(vdir, 'produtos.json'), 'utf8');
    await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
    await jobs.enqueue('king', video.id, 'producao');
    await jobs.idle();
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.PREVIA_PRONTA);
    assert.equal(await readFile(join(vdir, 'produtos.json'), 'utf8'), original);
    const legenda = await readFile(join(vdir, 'legenda-post.txt'), 'utf8');
    assert.match(legenda, /R\$ 13,99/);
    assert.doesNotMatch(legenda, /0,01/);
  });
});

test('Oferta stage 1 forces frame, campaign, pace and the frame track into roteiro.json', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por {preco}!']), renderer: async () => ({}) });
    const video = await createVideo('king', { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, moldura: 'neon', ritmo: 'calmo', campanha: 'Mês da Economia' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const r = JSON.parse(await readFile(join(videoDir(dir, 'king', video.id), 'roteiro.json'), 'utf8'));
    assert.equal(r.moldura, 'neon');
    assert.equal(r.campanha, 'Mês da Economia');
    assert.equal(r.ritmo, 'calmo');
    assert.equal(r.trilha, 'trap-electro-vibes.mp3');
    assert.match(calls[0].prompt, /Moldura: Neon Premium/);
    assert.match(calls[0].prompt, /ritmo calmo \(4s por produto\)/);
    assert.match(calls[0].prompt, /selo da campanha "Mês da Economia"/);
  });
});

test('Oferta with moldura auto: the prompt lists the frames, Claude picks one, the track follows it', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const runner = async (args) => {
      await ofertaRunner(calls, ['Fralda por {preco}!'])(args);
      const p = join(args.cwd, 'roteiro.json');
      const r = JSON.parse(await readFile(p, 'utf8'));
      await writeFile(p, JSON.stringify({ ...r, moldura: 'diagonal' }));
      return { text: 'ok' };
    };
    const jobs = createVideoJobs({ targetDir: dir, runner, renderer: async () => ({}) });
    const video = await createVideo('king', { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, moldura: 'auto' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.match(calls[0].prompt, /Moldura: você escolhe/);
    assert.match(calls[0].prompt, /encarte: encarte clássico/);
    const r = JSON.parse(await readFile(join(videoDir(dir, 'king', video.id), 'roteiro.json'), 'utf8'));
    assert.equal(r.moldura, 'diagonal');
    assert.equal(r.trilha, 'midnight-funk.mp3');
  });
});

test('Oferta with moldura auto and no pick: one retry, then erro', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por {preco}!']), renderer: async () => ({}) });
    const video = await createVideo('king', { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, moldura: 'auto' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.equal(calls.length, 2);
    assert.match((await readVideo('king', video.id, dir)).erro, /moldura/);
  });
});
