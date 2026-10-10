import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCentralProject, getCentralPaths } from '../src/content-central.js';
import { STATUS, createVideo, readVideo, updateVideo, videoDir } from '../src/content-central-video.js';
import { createVideoJobs, isUsageLimit, DIRECOES } from '../src/content-central-video-jobs.js';

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
