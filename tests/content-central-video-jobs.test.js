import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCentralProject, getCentralPaths } from '../src/content-central.js';
import { STATUS, createVideo, readVideo, updateVideo, videoDir } from '../src/content-central-video.js';
import { createVideoJobs, isUsageLimit, runClaudeCode, DIRECOES } from '../src/content-central-video-jobs.js';

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
