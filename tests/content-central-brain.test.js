import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCentralProject, loadProjectForTest, saveProjectOffer } from '../src/content-central.js';
import {
  buildBrainContext, createProposal, readBrainState, resolveProposal, saveBrainPlan, saveNotebook,
} from '../src/content-central-brain.js';

async function withProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-brain-'));
  try {
    await createCentralProject({ projectId: 'loja', name: 'Loja' }, dir);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const STORY = [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }];

test('empty brain state reads as defaults', async () => {
  await withProject(async (dir) => {
    const state = await readBrainState('loja', dir);
    assert.deepEqual(state, { chat: { sessionId: null, messages: [] }, plan: null, proposals: [], notebook: '' });
  });
});

test('an offer proposal captures before, applies, and refuses when data changed since', async () => {
  await withProject(async (dir) => {
    const { offer } = await saveProjectOffer('loja', { name: 'Arroz', type: 'offer' }, dir);
    const first = await createProposal('loja', { summary: 'Setor', changes: [{ kind: 'offer', offerId: offer.id, field: 'sector', after: 'Mercearia' }] }, dir);
    assert.equal(first.changes[0].before, '');

    const applied = await resolveProposal('loja', first.id, 'apply', dir);
    assert.deepEqual(applied.results, [{ index: 0, ok: true }]);
    const saved = (await loadProjectForTest('loja', dir)).contentStrategy.offers[0];
    assert.equal(saved.sector, 'Mercearia');
    assert.equal(saved.name, 'Arroz');

    const stale = await createProposal('loja', { summary: 'Setor 2', changes: [{ kind: 'offer', offerId: offer.id, field: 'sector', after: 'Grãos' }] }, dir);
    await saveProjectOffer('loja', { ...saved, sector: 'Outro' }, dir);
    const refused = await resolveProposal('loja', stale.id, 'apply', dir);
    assert.equal(refused.results[0].ok, false);
    assert.match(refused.results[0].error, /mudou/);
  });
});

test('a proposal with an unknown field or kind is refused up front', async () => {
  await withProject(async (dir) => {
    const { offer } = await saveProjectOffer('loja', { name: 'Arroz', type: 'offer' }, dir);
    await assert.rejects(createProposal('loja', { summary: 'x', changes: [{ kind: 'offer', offerId: offer.id, field: 'price', after: '1' }] }, dir), /não permitido/);
    await assert.rejects(createProposal('loja', { summary: 'x', changes: [{ kind: 'apagar', after: 1 }] }, dir), /desconhecido/);
  });
});

test('a notebook proposal replaces the notebook only when applied; reject changes nothing', async () => {
  await withProject(async (dir) => {
    await saveNotebook('loja', 'Sorteio às sextas.', dir);
    const p = await createProposal('loja', { summary: 'Troca', changes: [{ kind: 'notebook', after: 'Sorteio aos sábados.' }] }, dir);
    await resolveProposal('loja', p.id, 'reject', dir);
    assert.equal((await readBrainState('loja', dir)).notebook, 'Sorteio às sextas.');
    const q = await createProposal('loja', { summary: 'Troca', changes: [{ kind: 'notebook', after: 'Sorteio aos sábados.' }] }, dir);
    await resolveProposal('loja', q.id, 'apply', dir);
    assert.equal((await readBrainState('loja', dir)).notebook, 'Sorteio aos sábados.');
    await assert.rejects(resolveProposal('loja', q.id, 'apply', dir), /já foi/);
  });
});

test('saveBrainPlan stores the preview with the chosen offers', async () => {
  await withProject(async (dir) => {
    const { offer } = await saveProjectOffer('loja', { name: 'Feijão', type: 'offer' }, dir);
    const stored = await saveBrainPlan('loja', { startDate: '2026-10-05', days: 1, formats: STORY, slots: [{ id: '2026-10-05-instagram_story-01', offerIds: [offer.id] }] }, dir);
    assert.equal(stored.plan.dayPlans[0].regular[0].offerName, 'Feijão');
    assert.deepEqual((await readBrainState('loja', dir)).plan.formats, STORY);
  });
});

test('the context names the offers with sector and validity and includes the notebook', async () => {
  await withProject(async (dir) => {
    await saveProjectOffer('loja', { name: 'Sabonete', type: 'offer', sector: 'Higiene', validUntil: '2026-10-20' }, dir);
    await saveNotebook('loja', 'Dono não quer post no domingo.', dir);
    const text = await buildBrainContext('loja', dir);
    assert.match(text, /Sabonete/);
    assert.match(text, /Higiene/);
    assert.match(text, /até 2026-10-20/);
    assert.match(text, /Dono não quer post no domingo/);
  });
});
