import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Jimp } from 'jimp';
import { startContentCentralServer } from '../src/content-central-server.js';
import { createCentralProject, getCentralPaths } from '../src/content-central.js';
import { STATUS, readVideo, updateVideo, videoDir } from '../src/content-central-video.js';
import { createVideoJobs } from '../src/content-central-video-jobs.js';

const realFetch = globalThis.fetch;
const briefing = { assunto: 'Bio', objetivo: 'alcance', duracao: 15, tom: 'criador', legenda: 'pop' };

async function withServer(fn, { ativo = true, busy = false, jobs = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-video-server-'));
  await createCentralProject({ projectId: 'king', name: 'King' }, dir);
  const path = getCentralPaths(dir, 'king').projectPath;
  const project = JSON.parse(await readFile(path, 'utf8'));
  project.videoAnimado = { ativo, projetosDeMaterial: [] };
  await writeFile(path, JSON.stringify(project));
  const enqueued = [];
  const videoJobs = jobs ? jobs(dir) : { enqueue: async (...args) => { enqueued.push(args); }, isBusy: () => busy, idle: async () => {} };
  const server = await startContentCentralServer({ targetDir: dir, port: 0, openBrowser: false, videoJobs });
  try { return await fn(dir, server, enqueued, videoJobs); } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

async function call(server, path, body) {
  const res = await realFetch(`${server.url}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text, headers: res.headers };
}

test('video routes are 404 when the project does not have the feature', async () => {
  await withServer(async (_dir, server) => {
    assert.equal((await call(server, '/api/projects/king/videos')).status, 404);
    assert.equal((await call(server, '/api/projects/king/videos', briefing)).status, 404);
  }, { ativo: false });
});

test('creating a video queues stage 1 and the list shows it; the summary carries videoAnimado', async () => {
  await withServer(async (_dir, server, enqueued) => {
    const created = await call(server, '/api/projects/king/videos', briefing);
    assert.equal(created.status, 201);
    assert.deepEqual(enqueued, [['king', created.body.video.id, 'roteiro', {}]]);
    const list = await call(server, '/api/projects/king/videos');
    assert.equal(list.body.videos.length, 1);
    const state = await call(server, '/api/state');
    assert.equal(state.body.projects.find((p) => p.projectId === 'king').videoAnimado.ativo, true);
    assert.equal((await call(server, '/api/projects/king/videos', { ...briefing, duracao: 7 })).status, 400);
  });
});

test('approve, adjust and resume move the status and queue the right stage', async () => {
  await withServer(async (dir, server, enqueued) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const id = body.video.id;
    assert.equal((await call(server, `/api/projects/king/videos/${id}/aprovar-roteiro`, {})).status, 409);
    await updateVideo('king', id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    await writeFile(join(videoDir(dir, 'king', id), 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'a', fala: 'Oi?', descricao: 'x' }] }));
    const saved = await call(server, `/api/projects/king/videos/${id}/roteiro`, { cenas: [{ tipo: 'a', fala: 'Olá, tudo bem?', descricao: 'x' }] });
    assert.equal(saved.body.roteiro.cenas[0].fala, 'Olá, tudo bem?');
    const adj = await call(server, `/api/projects/king/videos/${id}/ajuste`, { etapa: 'roteiro', pedido: 'mais curto' });
    assert.equal(adj.body.video.status, STATUS.ROTEIRO_GERANDO);
    assert.deepEqual(enqueued.at(-1), ['king', id, 'roteiro', { ajuste: 'mais curto' }]);
    await updateVideo('king', id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    const ap = await call(server, `/api/projects/king/videos/${id}/aprovar-roteiro`, {});
    assert.equal(ap.body.video.status, STATUS.PRODUCAO_GERANDO);
    assert.deepEqual(enqueued.at(-1), ['king', id, 'producao', {}]);
    await updateVideo('king', id, { status: STATUS.PREVIA_PRONTA }, dir);
    const ok = await call(server, `/api/projects/king/videos/${id}/aprovar-previa`, {});
    assert.equal(ok.body.video.status, STATUS.RENDER_GERANDO);
    await updateVideo('king', id, { status: STATUS.ERRO, etapaComErro: 'render' }, dir);
    const again = await call(server, `/api/projects/king/videos/${id}/retomar`, {});
    assert.equal(again.body.video.status, STATUS.RENDER_GERANDO);
    assert.deepEqual(enqueued.at(-1), ['king', id, 'render', {}]);
  });
});

test('a video that is already queued or running is refused with 409 and not re-queued', async () => {
  await withServer(async (dir, server, enqueued) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const id = body.video.id;
    const before = enqueued.length;
    await updateVideo('king', id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    const ap = await call(server, `/api/projects/king/videos/${id}/aprovar-roteiro`, {});
    assert.equal(ap.status, 409);
    assert.equal(ap.body.error, 'O vídeo já está sendo gerado.');
    await updateVideo('king', id, { status: STATUS.ERRO, etapaComErro: 'producao' }, dir);
    assert.equal((await call(server, `/api/projects/king/videos/${id}/retomar`, {})).status, 409);
    assert.equal(enqueued.length, before);
    assert.equal((await readVideoStatus(dir, id)), STATUS.ERRO);
  }, { busy: true });
});

test('two concurrent approvals queue the stage once; delete and roteiro save are refused while busy', async () => {
  await withServer(async (dir, server, enqueued) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const id = body.video.id;
    await updateVideo('king', id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    const before = enqueued.length;
    const [a, b] = await Promise.all([1, 2].map(() => call(server, `/api/projects/king/videos/${id}/aprovar-roteiro`, {})));
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(enqueued.length, before + 1);
  });
  await withServer(async (_dir, server) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    assert.equal((await call(server, `/api/projects/king/videos/${body.video.id}/excluir`, {})).status, 409);
    assert.equal((await call(server, `/api/projects/king/videos/${body.video.id}/roteiro`, { cenas: [] })).status, 409);
  }, { busy: true });
});

async function readVideoStatus(dir, id) {
  return JSON.parse(await readFile(join(videoDir(dir, 'king', id), 'video.json'), 'utf8')).status;
}

test('files are served from a whitelist, the MP4 honours Range', async () => {
  await withServer(async (dir, server) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const vdir = videoDir(dir, 'king', body.video.id);
    await writeFile(join(vdir, 'video.mp4'), Buffer.from('0123456789'));
    await mkdir(join(vdir, 'stills'), { recursive: true });
    await writeFile(join(vdir, 'stills', 't0.05.jpg'), 'jpg');
    const base = `${server.url}/api/projects/king/videos/${body.video.id}/arquivo`;
    const ranged = await realFetch(`${base}/video.mp4`, { headers: { range: 'bytes=2-5' } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), '2345');
    const open = await realFetch(`${base}/video.mp4`, { headers: { range: 'bytes=2-' } });
    assert.equal(open.status, 206);
    assert.equal(await open.text(), '23456789');
    const suffix = await realFetch(`${base}/video.mp4`, { headers: { range: 'bytes=-3' } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
    assert.equal(await suffix.text(), '789');
    const past = await realFetch(`${base}/video.mp4`, { headers: { range: 'bytes=50-60' } });
    assert.equal(past.status, 416);
    assert.equal(past.headers.get('content-range'), 'bytes */10');
    await writeFile(join(vdir, 'trecho.mp4'), '');
    assert.equal((await realFetch(`${base}/trecho.mp4`, { headers: { range: 'bytes=0-5' } })).status, 416);
    assert.equal((await realFetch(`${base}/stills/t0.05.jpg`)).status, 200);
    assert.equal((await realFetch(`${base}/video.json`)).status, 404);
    assert.equal((await realFetch(`${base}/..%2F..%2Fproject.json`)).status, 404);
  });
});

test('Oferta product photos are served, other files under fotos/ are not', async () => {
  await withServer(async (dir, server) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const vdir = videoDir(dir, 'king', body.video.id);
    await mkdir(join(vdir, 'fotos'), { recursive: true });
    await writeFile(join(vdir, 'fotos', 'produto-abc.png'), 'png');
    await writeFile(join(vdir, 'fotos', 'logo.png'), 'png');
    const base = `${server.url}/api/projects/king/videos/${body.video.id}/arquivo`;
    const foto = await realFetch(`${base}/fotos/produto-abc.png`);
    assert.equal(foto.status, 200);
    assert.equal(foto.headers.get('content-type'), 'image/png');
    assert.equal((await realFetch(`${base}/fotos/logo.png`)).status, 404);
    assert.equal((await realFetch(`${base}/fotos/../video.json`)).status, 404);
  });
});

test('retomar reruns the stage recorded for the current status, never a stale one', async () => {
  await withServer(async (dir, server, enqueued) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const id = body.video.id;
    // Interrupted once in the script stage, later failed in production (legacy video.json with both recorded).
    await updateVideo('king', id, { status: STATUS.INTERROMPIDO, etapaInterrompida: STATUS.ROTEIRO_GERANDO }, dir);
    await updateVideo('king', id, { status: STATUS.ERRO, etapaComErro: 'producao', erro: 'cena quebrada' }, dir);
    const again = await call(server, `/api/projects/king/videos/${id}/retomar`, {});
    assert.equal(again.body.video.status, STATUS.PRODUCAO_GERANDO);
    assert.deepEqual(enqueued.at(-1), ['king', id, 'producao', { erroAnterior: 'cena quebrada' }]);
    assert.equal(again.body.video.etapaInterrompida, undefined);
    assert.equal(again.body.video.etapaComErro, undefined);
    await updateVideo('king', id, { status: STATUS.INTERROMPIDO, etapaInterrompida: STATUS.RENDER_GERANDO, etapaComErro: 'roteiro' }, dir);
    const render = await call(server, `/api/projects/king/videos/${id}/retomar`, {});
    assert.equal(render.body.video.status, STATUS.RENDER_GERANDO);
    assert.deepEqual(enqueued.at(-1), ['king', id, 'render', {}]);
  });
});

test('an ajuste in production that hits the usage limit is not lost on retomar', async () => {
  const vistos = [];
  let falhar = false;
  const runner = async ({ prompt, cwd }) => {
    if (/Etapa 1/.test(prompt)) {
      await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'a', fala: 'Sua bio convence?', descricao: 'x' }] }));
      return { text: '' };
    }
    vistos.push(existsSync(join(cwd, 'ajuste.txt')) ? await readFile(join(cwd, 'ajuste.txt'), 'utf8') : null);
    if (falhar) { falhar = false; throw Object.assign(new Error("You've hit your limit"), { limite: true }); }
    await writeFile(join(cwd, 'cenas.js'), 'window.VIDEO = {};');
    await mkdir(join(cwd, 'voz'), { recursive: true });
    await writeFile(join(cwd, 'voz', 'tempos.json'), JSON.stringify({ cenas: [] }));
    return { text: '' };
  };
  await withServer(async (dir, server, _enqueued, jobs) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const id = body.video.id;
    await jobs.idle();
    await call(server, `/api/projects/king/videos/${id}/aprovar-roteiro`, {});
    await jobs.idle();
    assert.equal((await readVideo('king', id, dir)).status, STATUS.PREVIA_PRONTA);
    falhar = true;
    await call(server, `/api/projects/king/videos/${id}/ajuste`, { etapa: 'producao', pedido: 'troque as cores' });
    await jobs.idle();
    assert.equal((await readVideo('king', id, dir)).status, STATUS.AGUARDANDO_LIMITE);
    assert.equal((await call(server, `/api/projects/king/videos/${id}/retomar`, {})).status, 200);
    await jobs.idle();
    assert.deepEqual(vistos, [null, 'troque as cores', 'troque as cores']);
    const v = await readVideo('king', id, dir);
    assert.equal(v.status, STATUS.PREVIA_PRONTA);
    assert.equal(v.ajustePendente, null);
  }, { jobs: (dir) => createVideoJobs({ targetDir: dir, runner, renderer: async () => ({}) }) });
});

test('the final MP4 downloads under the video id', async () => {
  await withServer(async (dir, server) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    await writeFile(join(videoDir(dir, 'king', body.video.id), 'video.mp4'), '0123');
    const res = await realFetch(`${server.url}/api/projects/king/videos/${body.video.id}/arquivo/video.mp4`);
    assert.equal(res.headers.get('content-disposition'), `inline; filename="${body.video.id}.mp4"`);
  });
});

const DIST = fileURLToPath(new URL('../content-central-app/dist/', import.meta.url));
test('caption previews and voice samples from the app build play on Safari (type, Range, short cache)', { skip: !existsSync(join(DIST, 'video-vozes', 'criador.mp3')) && 'app not built' }, async () => {
  await withServer(async (_dir, server) => {
    const voz = await realFetch(`${server.url}/video-vozes/criador.mp3`);
    assert.equal(voz.status, 200);
    assert.equal(voz.headers.get('content-type'), 'audio/mpeg');
    assert.equal(voz.headers.get('cache-control'), 'public, max-age=3600');
    await voz.arrayBuffer();
    const trecho = await realFetch(`${server.url}/video-legendas/simples.mp4`, { headers: { range: 'bytes=0-9' } });
    assert.equal(trecho.status, 206);
    assert.equal(trecho.headers.get('content-type'), 'video/mp4');
    assert.equal((await trecho.arrayBuffer()).byteLength, 10);
  });
});

test('GET videos/produtos lists the offers with their usable state', async () => {
  await withServer(async (dir, server) => {
    const paths = getCentralPaths(dir, 'king');
    await mkdir(join(paths.projectDir, 'assets', 'references'), { recursive: true });
    const im = new Jimp({ width: 40, height: 40, color: 0xffffffff });
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) im.setPixelColor(0x202020ff, x, y);
    await im.write(join(paths.projectDir, 'assets', 'references', 'fralda.png'));
    const project = JSON.parse(await readFile(paths.projectPath, 'utf8'));
    project.offerAssets = [{ id: 'f1', relativePath: 'assets/references/fralda.png', previewUrl: '/p/fralda.png' }];
    project.contentStrategy = { ...(project.contentStrategy || {}), offers: [
      { id: 'fralda', name: 'Fralda IsaBaby', type: 'offer', price: 'R$ 13,99', originalPrice: 'R$ 16,99', priceUnit: 'un', photoReferenceIds: ['f1'] },
      { id: 'ruim', name: 'Ruim', type: 'offer', price: 'barato', photoReferenceIds: ['f1'] },
    ] };
    await writeFile(paths.projectPath, JSON.stringify(project));
    const r = await call(server, '/api/projects/king/videos/produtos');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.produtos.map((p) => [p.id, p.motivo]), [['fralda', null], ['ruim', 'preço inválido']]);
    assert.equal(r.body.produtos[0].precoTela, 'R$ 13,99');
    assert.equal('preco' in r.body.produtos[0], false);
  });
});

test('a visual ajuste on a VT padrão prévia is refused', async () => {
  await withServer(async (dir, server, enqueued) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const id = body.video.id;
    const video = await readVideo('king', id, dir);
    await updateVideo('king', id, { status: STATUS.PREVIA_PRONTA, briefing: { ...video.briefing, oferta: { produtos: [], criacao: 'padrao' } } }, dir);
    const before = enqueued.length;
    const r = await call(server, `/api/projects/king/videos/${id}/ajuste`, { etapa: 'producao', pedido: 'muda a cor' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Criação nova/);
    assert.equal(enqueued.length, before);
  });
});
