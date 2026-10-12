import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCentralProject, getCentralPaths } from '../src/content-central.js';
import {
  STATUS, normalizeBriefing, createVideo, updateVideo, readVideoState, listVideos, saveRoteiroCenas, deleteVideo,
  estimateSeconds, validateRoteiro, buildMarca, buildMaterialInventory, reconcileInterruptedVideos, requireVideoProject, videoDir,
} from '../src/content-central-video.js';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-video-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

async function enable(dir, projectId, extra = {}) {
  const path = getCentralPaths(dir, projectId).projectPath;
  const project = JSON.parse(await readFile(path, 'utf8'));
  project.videoAnimado = { ativo: true, projetosDeMaterial: ['mercado'], whatsapp: '65 98108-6707', ...extra };
  await writeFile(path, JSON.stringify(project));
}

const briefing = { assunto: 'Diagnóstico antes do anúncio', objetivo: 'anuncio', duracao: 30, tom: 'vendedor', legenda: 'karaoke', observacao: '' };

test('a project without videoAnimado.ativo is a 404 for every video call', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await assert.rejects(requireVideoProject('king', dir), (err) => err.status === 404);
    await assert.rejects(createVideo('king', briefing, dir), (err) => err.status === 404);
  });
});

test('briefing is validated and normalized', () => {
  assert.throws(() => normalizeBriefing({ ...briefing, assunto: ' ' }), (err) => err.status === 400);
  assert.throws(() => normalizeBriefing({ ...briefing, objetivo: 'venda' }), (err) => err.status === 400);
  assert.throws(() => normalizeBriefing({ ...briefing, duracao: 20 }), (err) => err.status === 400);
  assert.deepEqual(normalizeBriefing({ ...briefing, duracao: '45' }).duracao, 45);
});

test('createVideo writes video.json in roteiro_gerando and listVideos returns it', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await enable(dir, 'king');
    const video = await createVideo('king', briefing, dir);
    assert.equal(video.status, STATUS.ROTEIRO_GERANDO);
    assert.match(video.id, /^\d{4}-\d{2}-\d{2}-diagnostico-antes-do-anuncio-[0-9a-f]{4}$/);
    const list = await listVideos('king', dir);
    assert.deepEqual(list.map((v) => [v.id, v.assunto, v.status]), [[video.id, briefing.assunto, STATUS.ROTEIRO_GERANDO]]);
  });
});

test('updateVideo records status history; saveRoteiroCenas only in roteiro_pronto', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await enable(dir, 'king');
    const video = await createVideo('king', briefing, dir);
    await writeFile(join(videoDir(dir, 'king', video.id), 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'a', fala: 'Oi.', descricao: 'x' }] }));
    const cenas = [{ tipo: 'a', fala: 'Olá, tudo bem?', descricao: 'Título' }];
    await assert.rejects(saveRoteiroCenas('king', video.id, cenas, dir), (err) => err.status === 409);
    const updated = await updateVideo('king', video.id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    assert.deepEqual(updated.historico.map((h) => h.status), [STATUS.ROTEIRO_GERANDO, STATUS.ROTEIRO_PRONTO]);
    const roteiro = await saveRoteiroCenas('king', video.id, cenas, dir);
    assert.equal(roteiro.cenas[0].fala, 'Olá, tudo bem?');
    await assert.rejects(saveRoteiroCenas('king', video.id, [{ tipo: '', fala: 'x' }], dir), (err) => err.status === 400);
  });
});

test('estimateSeconds counts spoken words at 2.6 per second plus holds', () => {
  const cenas = [{ fala: 'um dois três quatro cinco', segura: 1 }, { fala: 'seis sete oito' }];
  assert.equal(estimateSeconds(cenas), Math.round((8 / 2.6 + 1) * 10) / 10);
});

test('validateRoteiro: errors block, objective mismatches and timing only warn', () => {
  const ok = { cenas: [{ tipo: 'a', fala: 'Antes de anunciar, pensa.', descricao: 'x' }, { tipo: 'b', fala: 'Chama no WhatsApp!', descricao: 'y' }] };
  assert.deepEqual(validateRoteiro(ok, { ...briefing, duracao: 15 }).erros, []);
  assert.ok(validateRoteiro(ok, { ...briefing, duracao: 60 }).avisos.some((a) => /tempo/i.test(a)));
  assert.ok(validateRoteiro(ok, { ...briefing, objetivo: 'alcance' }).avisos.some((a) => /pergunta/i.test(a)));
  assert.ok(validateRoteiro({ cenas: [] }, briefing).erros.length > 0);
  assert.ok(validateRoteiro({ cenas: [{ tipo: 'a', fala: '' }] }, briefing).erros.length > 0);
});

test('buildMarca takes name, Instagram, WhatsApp and the most saturated brand color', () => {
  const marca = buildMarca(
    { name: 'KING', brandInput: { brandName: 'King Assessoria MKT' }, instagram: { handle: '@king.assessoriamkt' }, brandIdentity: { extractedColors: ['#000000', '#FFFFFF', '#FFD100'], editedColors: [] } },
    { whatsapp: '65 98108-6707' },
  );
  assert.deepEqual(marca, { nome: 'King Assessoria MKT', subtitulo: '', logo: 'fotos/logo.png', whatsapp: '65 98108-6707', instagram: '@king.assessoriamkt', cor: '#FFD100' });
});

test('buildMaterialInventory lists generated Stories with their raw photo, approved first', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'mercado', name: 'Mercado' }, dir);
    const paths = getCentralPaths(dir, 'mercado');
    await mkdir(join(paths.assetsDir, 'generated'), { recursive: true });
    await mkdir(paths.referencesDir, { recursive: true });
    await writeFile(join(paths.assetsDir, 'generated', 'arte-1.png'), 'x');
    await writeFile(join(paths.referencesDir, 'cru-1.jpg'), 'x');
    await mkdir(paths.draftsDir, { recursive: true });
    await writeFile(join(paths.draftsDir, 'day-01.json'), JSON.stringify({ items: [
      { channel: 'instagram_story', status: 'test_post_simulated', contentTopic: { offerName: 'Bacon' }, image: { url: '/x/arte-1.png', references: [{ absolutePath: join(paths.referencesDir, 'cru-1.jpg') }] } },
      { channel: 'instagram_story', status: 'aprovado', contentTopic: { label: 'Rotina' }, image: { url: '/x/arte-1.png', references: [] } },
      { channel: 'instagram_story', status: 'aprovado', contentTopic: { label: 'Some' }, image: { url: '/x/nao-existe.png' } },
    ] }));
    const items = await buildMaterialInventory(['mercado', 'inexistente'], dir);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'aprovado');
    assert.equal(items[0].arte, join(paths.assetsDir, 'generated', 'arte-1.png'));
    // The approved item had no raw photo; the test-run one did, and it is kept.
    assert.equal(items[0].cru, join(paths.referencesDir, 'cru-1.jpg'));
  });
});

test('buildMaterialInventory keeps the raw photo when the better item comes first without one', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'mercado', name: 'Mercado' }, dir);
    const paths = getCentralPaths(dir, 'mercado');
    await mkdir(join(paths.assetsDir, 'generated'), { recursive: true });
    await mkdir(paths.referencesDir, { recursive: true });
    await writeFile(join(paths.assetsDir, 'generated', 'arte-1.png'), 'x');
    await writeFile(join(paths.referencesDir, 'cru-1.jpg'), 'x');
    await mkdir(paths.draftsDir, { recursive: true });
    await writeFile(join(paths.draftsDir, 'day-01.json'), JSON.stringify({ items: [
      { channel: 'instagram_story', status: 'aprovado', contentTopic: { label: 'Rotina' }, image: { url: '/x/arte-1.png', references: [] } },
      { channel: 'instagram_story', status: 'test_post_simulated', contentTopic: { offerName: 'Bacon' }, image: { url: '/x/arte-1.png', references: [{ absolutePath: join(paths.referencesDir, 'cru-1.jpg') }] } },
    ] }));
    const items = await buildMaterialInventory(['mercado'], dir);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'aprovado');
    assert.equal(items[0].cru, join(paths.referencesDir, 'cru-1.jpg'));
  });
});

test('reconcileInterruptedVideos turns running statuses into interrompido', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await enable(dir, 'king');
    const video = await createVideo('king', briefing, dir);
    assert.equal(await reconcileInterruptedVideos(dir), 1);
    const state = await readVideoState('king', video.id, dir);
    assert.equal(state.video.status, STATUS.INTERROMPIDO);
    await deleteVideo('king', video.id, dir);
    assert.deepEqual(await listVideos('king', dir), []);
  });
});

test('a malformed roteiro.json (cenas null or null items) does not break the state, the estimate or validation', async () => {
  assert.equal(estimateSeconds(null), 0);
  assert.ok(validateRoteiro({ cenas: null }, briefing).erros.length > 0);
  assert.deepEqual(validateRoteiro({ cenas: [null, { tipo: 'a', fala: 'Chama no WhatsApp!' }] }, briefing).erros, []);
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await enable(dir, 'king');
    const video = await createVideo('king', briefing, dir);
    const path = join(videoDir(dir, 'king', video.id), 'roteiro.json');
    await writeFile(path, JSON.stringify({ cenas: null }));
    assert.deepEqual((await readVideoState('king', video.id, dir)).roteiro.cenas, []);
    await writeFile(path, JSON.stringify({ cenas: [null, 'x', { tipo: 'a', fala: 'Oi.' }] }));
    const state = await readVideoState('king', video.id, dir);
    assert.deepEqual(state.roteiro.cenas, [{ tipo: 'a', fala: 'Oi.' }]);
    assert.equal(typeof state.estimativa, 'number');
  });
});

test('updateVideo clears the recorded failed/interrupted stage once a stage starts or succeeds', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await enable(dir, 'king');
    const video = await createVideo('king', briefing, dir);
    await updateVideo('king', video.id, { status: STATUS.INTERROMPIDO, etapaInterrompida: STATUS.ROTEIRO_GERANDO }, dir);
    const erro = await updateVideo('king', video.id, { status: STATUS.ERRO, etapaComErro: 'producao', erro: 'x' }, dir);
    assert.equal(erro.etapaInterrompida, STATUS.ROTEIRO_GERANDO, 'a failure keeps what was recorded');
    const next = await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
    assert.equal(next.etapaComErro, undefined);
    assert.equal(next.etapaInterrompida, undefined);
  });
});
