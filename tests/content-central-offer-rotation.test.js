import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildOfferUsage,
  createCentralProject,
  generateContentBatch,
  generateContentSchedulePlan,
  getCentralPaths,
  listProjectContent,
  loadProjectForTest,
  previewContentSchedulePlan,
  saveProjectOffer,
  saveProjectOfferGroup,
  saveProjectPillar,
} from '../src/content-central.js';

async function withTempProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-rotation-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ONE_STORY_A_DAY = [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }];

// A piece that already exists on disk, the way the panel leaves it.
async function writeHistoryItem(dir, projectId, { offerId, offerName, scheduledDate, publishedAt = null, status = 'aprovado', products = null }) {
  const batchDir = join(getCentralPaths(dir, projectId).draftsDir, `historico-${scheduledDate}-${offerId}`);
  await mkdir(batchDir, { recursive: true });
  await writeFile(join(batchDir, 'day-01-instagram_story.json'), JSON.stringify({
    contentId: `${projectId}-${scheduledDate}-${offerId}`,
    batchId: `historico-${scheduledDate}-${offerId}`,
    channel: 'instagram_story',
    scheduledDate,
    scheduledTime: '09:00',
    status,
    contentTopic: { source: 'offer', offerId, offerName, ...(products ? { products } : {}) },
    publish: { publishedAt },
  }), 'utf-8');
}

const offerNames = (items) => items.filter((item) => item.contentTopic.source === 'offer').map((item) => item.contentTopic.offerName);

test('never-posted offers go first, then the one that has gone longest without going out', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'fila', name: 'Fila' }, dir);
    const a = (await saveProjectOffer('fila', { name: 'Produto A', type: 'offer' }, dir)).offer;
    await saveProjectOffer('fila', { name: 'Produto B', type: 'offer' }, dir);
    const c = (await saveProjectOffer('fila', { name: 'Produto C', type: 'offer' }, dir)).offer;
    await writeHistoryItem(dir, 'fila', { offerId: a.id, offerName: 'Produto A', scheduledDate: '2026-09-20', publishedAt: '2026-09-20T13:00:00.000Z' });
    await writeHistoryItem(dir, 'fila', { offerId: c.id, offerName: 'Produto C', scheduledDate: '2026-09-01', publishedAt: '2026-09-01T13:00:00.000Z' });

    const batch = await generateContentSchedulePlan('fila', { days: 4, startDate: '2026-10-05', formats: ONE_STORY_A_DAY }, dir);

    assert.deepEqual(offerNames(batch.items), ['Produto B', 'Produto C', 'Produto A', 'Produto B']);
  });
});

test('an offer added halfway through is not skipped and nothing repeats before every offer went out', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'nova-oferta', name: 'Nova Oferta' }, dir);
    await saveProjectOffer('nova-oferta', { name: 'Produto A', type: 'offer' }, dir);
    await saveProjectOffer('nova-oferta', { name: 'Produto B', type: 'offer' }, dir);
    await saveProjectOffer('nova-oferta', { name: 'Produto C', type: 'offer' }, dir);

    const first = await generateContentSchedulePlan('nova-oferta', { days: 2, startDate: '2026-10-05', formats: ONE_STORY_A_DAY }, dir);
    await saveProjectOffer('nova-oferta', { name: 'Produto D', type: 'offer' }, dir);
    const second = await generateContentSchedulePlan('nova-oferta', { days: 3, startDate: '2026-10-07', formats: ONE_STORY_A_DAY }, dir);

    assert.deepEqual(offerNames(first.items), ['Produto A', 'Produto B']);
    assert.deepEqual(offerNames(second.items), ['Produto C', 'Produto D', 'Produto A']);
  });
});

test('with pillars, every offer of a pillar takes its turn instead of the same one repeating', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pilares-fila', name: 'Pilares Fila' }, dir);
    const ensina = await saveProjectPillar('pilares-fila', { name: 'Ensina', role: 'ensina', weight: 1 }, dir);
    const convida = await saveProjectPillar('pilares-fila', { name: 'Convida', role: 'convida', weight: 1 }, dir);
    await saveProjectOffer('pilares-fila', { name: 'Dica', type: 'orientation', pillarId: ensina.pillar.id }, dir);
    await saveProjectOffer('pilares-fila', { name: 'Oferta 1', type: 'offer', pillarId: convida.pillar.id }, dir);
    await saveProjectOffer('pilares-fila', { name: 'Oferta 2', type: 'offer', pillarId: convida.pillar.id }, dir);

    const batch = await generateContentSchedulePlan('pilares-fila', { days: 4, startDate: '2026-10-05', formats: ONE_STORY_A_DAY }, dir);

    const sales = batch.items.filter((item) => item.contentTopic.pillar?.role === 'convida').map((item) => item.contentTopic.offerName);
    assert.deepEqual(sales, ['Oferta 1', 'Oferta 2']);
  });
});

test('a selected group keeps its turn order across generations', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'grupo-fila', name: 'Grupo Fila' }, dir);
    const { group } = await saveProjectOfferGroup('grupo-fila', { name: 'Hortifrúti' }, dir);
    await saveProjectOffer('grupo-fila', { name: 'Alface', type: 'offer', groupId: group.id }, dir);
    await saveProjectOffer('grupo-fila', { name: 'Tomate', type: 'offer', groupId: group.id }, dir);
    await saveProjectOffer('grupo-fila', { name: 'Fora do grupo', type: 'offer' }, dir);
    const options = (startDate, days) => ({ days, startDate, formats: ONE_STORY_A_DAY, groupIds: [group.id], offersOnly: true });

    const first = await generateContentSchedulePlan('grupo-fila', options('2026-10-05', 1), dir);
    const second = await generateContentSchedulePlan('grupo-fila', options('2026-10-06', 2), dir);

    assert.deepEqual([...offerNames(first.items), ...offerNames(second.items)], ['Alface', 'Tomate', 'Alface']);
  });
});

test('the plan preview shows the same offers the generation then uses', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'previa', name: 'Prévia' }, dir);
    const a = (await saveProjectOffer('previa', { name: 'Produto A', type: 'offer' }, dir)).offer;
    await saveProjectOffer('previa', { name: 'Produto B', type: 'offer' }, dir);
    await saveProjectOffer('previa', { name: 'Produto C', type: 'offer' }, dir);
    await writeHistoryItem(dir, 'previa', { offerId: a.id, offerName: 'Produto A', scheduledDate: '2026-09-20', publishedAt: '2026-09-20T13:00:00.000Z' });
    const options = { days: 3, startDate: '2026-10-05', formats: ONE_STORY_A_DAY };

    const plan = await previewContentSchedulePlan('previa', options, dir);
    const batch = await generateContentSchedulePlan('previa', options, dir);

    const planned = plan.dayPlans.flatMap((day) => day.regular).map((slot) => slot.offerName);
    assert.deepEqual(planned, ['Produto B', 'Produto C', 'Produto A']);
    assert.deepEqual(offerNames(batch.items), planned);
  });
});

test('safe test posts neither count as having gone out nor follow the queue', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'teste-fila', name: 'Teste Fila' }, dir);
    const a = (await saveProjectOffer('teste-fila', { name: 'Produto A', type: 'offer' }, dir)).offer;
    await saveProjectOffer('teste-fila', { name: 'Produto B', type: 'offer' }, dir);
    await writeHistoryItem(dir, 'teste-fila', { offerId: a.id, offerName: 'Produto A', scheduledDate: '2026-10-01', status: 'test_post_simulated' });

    const batch = await generateContentSchedulePlan('teste-fila', { days: 1, startDate: '2026-10-05', formats: ONE_STORY_A_DAY }, dir);
    assert.deepEqual(offerNames(batch.items), ['Produto A']);

    // An explicit topicOffset (the safe-test flow) keeps its own rotation.
    const pinned = await generateContentBatch('teste-fila', { days: 1, startDate: '2026-10-06', channel: 'instagram_story', topicOffset: 1 }, dir);
    assert.deepEqual(offerNames(pinned.items), ['Produto B']);
  });
});

test('buildOfferUsage counts publications, the last one, the next in line and the queue order', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'uso', name: 'Uso' }, dir);
    const a = (await saveProjectOffer('uso', { name: 'Produto A', type: 'offer' }, dir)).offer;
    const b = (await saveProjectOffer('uso', { name: 'Produto B', type: 'offer' }, dir)).offer;
    const c = (await saveProjectOffer('uso', { name: 'Produto C', type: 'offer' }, dir)).offer;
    await writeHistoryItem(dir, 'uso', { offerId: a.id, offerName: 'Produto A', scheduledDate: '2026-09-10', publishedAt: '2026-09-10T13:00:00.000Z' });
    await writeHistoryItem(dir, 'uso', { offerId: a.id, offerName: 'Produto A', scheduledDate: '2026-09-28', publishedAt: '2026-09-28T13:00:00.000Z' });
    // A side-by-side pair counts for both of its offers.
    await writeHistoryItem(dir, 'uso', {
      offerId: `${b.id}+${c.id}`,
      offerName: 'Produto B + Produto C',
      scheduledDate: '2026-10-08',
      products: [{ offerId: b.id }, { offerId: c.id }],
    });
    await writeHistoryItem(dir, 'uso', { offerId: c.id, offerName: 'Produto C', scheduledDate: '2026-10-01', status: 'test_post_simulated', publishedAt: '2026-10-01T13:00:00.000Z' });

    const project = await loadProjectForTest('uso', dir);
    const items = await listProjectContent('uso', dir);
    const usage = buildOfferUsage(project, items, new Date(2026, 9, 3, 9));

    assert.deepEqual(usage.offers[a.id], { publishedCount: 2, lastPublishedAt: '2026-09-28T13:00:00.000Z', nextScheduledDate: null });
    assert.deepEqual(usage.offers[b.id], { publishedCount: 0, lastPublishedAt: null, nextScheduledDate: '2026-10-08' });
    assert.deepEqual(usage.offers[c.id], { publishedCount: 0, lastPublishedAt: null, nextScheduledDate: '2026-10-08' });
    assert.deepEqual(usage.queue, [a.id, b.id, c.id]);
  });
});
