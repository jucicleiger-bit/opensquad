import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createCentralProject, getCentralPaths, loadProjectForTest, saveProjectOffer, saveProjectOfferGroup, updateProjectBrandInput,
  updateProjectBusinessHours,
} from '../src/content-central.js';
import {
  brainSystemPrompt, buildBrainContext, createProposal, markBrainPlanApproved, readBrainState, resolveProposal, saveBrainPlan, saveNotebook,
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
    const first = await createProposal('loja', { summary: 'Setor', changes: [{ kind: 'offer', offerId: offer.id, field: 'sector', after: ' Mercearia ' }] }, dir);
    assert.equal(first.changes[0].before, '');
    assert.equal(first.changes[0].after, 'Mercearia');

    const applied = await resolveProposal('loja', first.id, 'apply', dir);
    assert.deepEqual(applied.results, [{ index: 0, ok: true }]);
    assert.equal(applied.proposal.status, 'applied');
    const saved = (await loadProjectForTest('loja', dir)).contentStrategy.offers[0];
    assert.equal(saved.sector, 'Mercearia');
    assert.equal(saved.name, 'Arroz');

    const stale = await createProposal('loja', { summary: 'Setor 2', changes: [{ kind: 'offer', offerId: offer.id, field: 'sector', after: 'Grãos' }] }, dir);
    await saveProjectOffer('loja', { ...saved, sector: 'Outro' }, dir);
    const refused = await resolveProposal('loja', stale.id, 'apply', dir);
    assert.equal(refused.results[0].ok, false);
    assert.match(refused.results[0].error, /mudou/);
    assert.equal(refused.proposal.status, 'failed');
  });
});

test('a proposal is refused up front when what it would save is not valid', async () => {
  await withProject(async (dir) => {
    const { offer } = await saveProjectOffer('loja', { name: 'Arroz', type: 'offer' }, dir);
    const propose = (change) => createProposal('loja', { summary: 'x', changes: [{ kind: 'offer', offerId: offer.id, ...change }] }, dir);
    await assert.rejects(propose({ field: 'price', after: '1' }), /não permitido/);
    await assert.rejects(propose({ field: 'validUntil', after: '20/10/2026' }), /AAAA-MM-DD/);
    await assert.rejects(propose({ field: 'active', after: 'false' }), /true ou false/);
    await assert.rejects(propose({ field: 'groupId', after: 'nao-existe' }), /Grupo nao-existe não existe/);
    await assert.rejects(createProposal('loja', { summary: 'x', changes: [{ kind: 'apagar', after: 1 }] }, dir), /desconhecido/);

    const { group } = await saveProjectOfferGroup('loja', { name: 'Hortifruti' }, dir);
    const ok = await propose({ field: 'groupId', after: group.id });
    assert.equal(ok.changes[0].before, null);
    assert.equal((await propose({ field: 'validUntil', after: '' })).changes[0].after, '');
  });
});

test('new percentages keep the Raio-X approved and must name every active goal', async () => {
  await withProject(async (dir) => {
    await updateProjectBrandInput('loja', { brandName: 'Loja', contentGoals: ['authority'], contentGoalWeights: { sales: 80, authority: 20 } }, dir);
    const projectPath = getCentralPaths(dir, 'loja').projectPath;
    const raw = JSON.parse(await readFile(projectPath, 'utf-8'));
    await writeFile(projectPath, JSON.stringify({ ...raw, brandXray: { ...raw.brandXray, status: 'approved' } }), 'utf-8');

    await assert.rejects(createProposal('loja', { summary: 'x', changes: [{ kind: 'goalWeights', after: { sales: 70 } }] }, dir), /Faltam os percentuais de: authority/);
    await assert.rejects(createProposal('loja', { summary: 'x', changes: [{ kind: 'goalWeights', after: { sales: 70, authority: 20 } }] }, dir), /somar 100/);

    const proposal = await createProposal('loja', { summary: 'Mais venda', changes: [{ kind: 'goalWeights', after: { sales: 70, authority: 30 } }] }, dir);
    await resolveProposal('loja', proposal.id, 'apply', dir);
    const project = await loadProjectForTest('loja', dir);
    assert.deepEqual(project.brandInput.contentGoalWeights, { sales: 70, authority: 30 });
    assert.equal(project.brandXray.status, 'approved');
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

test('saveBrainPlan stores the preview with the chosen offers and the normalized formats', async () => {
  await withProject(async (dir) => {
    const { offer } = await saveProjectOffer('loja', { name: 'Feijão', type: 'offer' }, dir);
    const stored = await saveBrainPlan('loja', { startDate: '2026-10-05', days: 1, formats: STORY, slots: [{ id: '2026-10-05-instagram_story-01', offerIds: [offer.id] }] }, dir);
    assert.equal(stored.plan.dayPlans[0].regular[0].offerName, 'Feijão');
    assert.equal(stored.approvedAt, null);
    const { formats } = (await readBrainState('loja', dir)).plan;
    assert.deepEqual(formats.map((format) => [format.channel, format.startTime, format.label]), [['instagram_story', '09:00', 'Instagram Stories']]);
  });
});

test('saveBrainPlan refuses a channel generation would reject and a malformed start date', async () => {
  await withProject(async (dir) => {
    await assert.rejects(saveBrainPlan('loja', { startDate: '2026-10-05', days: 1, formats: [{ ...STORY[0], channel: 'story' }] }, dir), /Canal não suportado: "story"/);
    await assert.rejects(saveBrainPlan('loja', { startDate: '05/10/2026', days: 1, formats: STORY }, dir), /AAAA-MM-DD/);
  });
});

test('an approved plan is marked, and the next plan from the cérebro starts unapproved', async () => {
  await withProject(async (dir) => {
    await saveBrainPlan('loja', { startDate: '2026-10-05', days: 1, formats: STORY }, dir);
    assert.ok((await markBrainPlanApproved('loja', dir)).approvedAt);
    assert.match(await buildBrainContext('loja', dir), /JÁ APROVADO/);
    await saveBrainPlan('loja', { startDate: '2026-10-12', days: 1, formats: STORY }, dir);
    assert.equal((await readBrainState('loja', dir)).plan.approvedAt, null);
  });
});

test('the context names the offers with sector and validity, the notebook and resolved proposals', async () => {
  await withProject(async (dir) => {
    await saveProjectOffer('loja', { name: 'Sabonete', type: 'offer', sector: 'Higiene', validUntil: '2026-10-20' }, dir);
    await saveNotebook('loja', 'Dono não quer post no domingo.', dir);
    const p = await createProposal('loja', { summary: 'Novo caderno', changes: [{ kind: 'notebook', after: 'x' }] }, dir);
    await resolveProposal('loja', p.id, 'reject', dir);
    const text = await buildBrainContext('loja', dir);
    assert.match(text, /Sabonete/);
    assert.match(text, /Higiene/);
    assert.match(text, /até 2026-10-20/);
    assert.match(text, /Dono não quer post no domingo/);
    assert.match(text, /Novo caderno: recusada/);
  });
});

const OPEN = [{ from: '07:00', to: '11:00' }, { from: '13:00', to: '20:00' }];
const WEEK_HOURS = { mon: OPEN, tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: [{ from: '07:00', to: '12:00' }], sun: [] };

test('a closed day loses its posts and generation is told to skip them', async () => {
  await withProject(async (dir) => {
    await updateProjectBusinessHours('loja', WEEK_HOURS, dir);
    // 2026-10-11 is a Sunday.
    const stored = await saveBrainPlan('loja', { startDate: '2026-10-11', days: 2, formats: STORY }, dir);
    assert.deepEqual(stored.plan.skippedSlotIds, ['2026-10-11-instagram_story-01']);
    assert.deepEqual(stored.plan.dayPlans[0].regular, []);
    assert.equal(stored.plan.dayPlans[1].regular[0].scheduledTime, '09:00');
    assert.equal(stored.plan.regularCount, 1);
  });
});

test('a post at a closed hour is refused; a chosen open hour is kept and extras move to the opening', async () => {
  await withProject(async (dir) => {
    await updateProjectBusinessHours('loja', { ...WEEK_HOURS, mon: [{ from: '13:00', to: '20:00' }] }, dir);
    await assert.rejects(
      saveBrainPlan('loja', { startDate: '2026-10-12', days: 1, formats: STORY }, dir),
      /2026-10-12-instagram_story-01.*fora do horário de funcionamento/,
    );
    // 2026-10-12 (Monday) is Dia das Crianças, so the plan has extras at the format's 09:00.
    const stored = await saveBrainPlan('loja', {
      startDate: '2026-10-12', days: 1, formats: STORY, slots: [{ id: '2026-10-12-instagram_story-01', time: '14:00' }],
    }, dir);
    assert.equal(stored.plan.dayPlans[0].regular[0].scheduledTime, '14:00');
    assert.ok(stored.plan.dayPlans[0].extras.length > 0);
    assert.ok(stored.plan.dayPlans[0].extras.every((extra) => extra.scheduledTime === '13:00'));
  });
});

test('without opening hours nothing is dropped', async () => {
  await withProject(async (dir) => {
    const stored = await saveBrainPlan('loja', { startDate: '2026-10-11', days: 1, formats: STORY }, dir);
    assert.equal(stored.plan.skippedSlotIds, undefined);
    assert.equal(stored.plan.dayPlans[0].regular.length, 1);
  });
});

test('the context shows the Raio-X in words, the bank, the hours and reach by hour', async () => {
  await withProject(async (dir) => {
    await updateProjectBrandInput('loja', {
      brandName: 'Loja', segment: 'Mercado', productsOrServices: 'Alimentos', audience: 'Famílias do bairro',
      contentGoals: ['authority'], contentGoalWeights: { sales: 85, authority: 15 },
    }, dir);
    await saveProjectOffer('loja', { name: 'Arroz', type: 'offer', price: '9,90' }, dir);
    await updateProjectBusinessHours('loja', WEEK_HOURS, dir);
    const { metricsPath } = getCentralPaths(dir, 'loja');
    await mkdir(dirname(metricsPath), { recursive: true });
    await writeFile(metricsPath, JSON.stringify({ media: { s1: { kind: 'story', reach: 230, postedAt: new Date(2026, 9, 3, 13).toISOString() } } }), 'utf-8');
    await saveBrainPlan('loja', { startDate: '2026-10-12', days: 1, formats: STORY }, dir);

    const text = await buildBrainContext('loja', dir);
    assert.match(text, /Venda 85%, Gerar autoridade 15%/);
    assert.match(text, /Famílias do bairro/);
    assert.match(text, /## Banco de assuntos\n\n- \[authority-/);
    assert.match(text, /segunda: 07:00–11:00 e 13:00–20:00/);
    assert.match(text, /domingo: fechado/);
    assert.match(text, /Story às 13h: alcance médio 230 em 1 post\(s\).*em teste/);
    assert.match(text, /Story: horas abertas nunca testadas: 7h, 8h, 9h, 10h, 11h, 14h/);
    assert.match(text, /2026-10-12-instagram_story-01 09:00 \[(venda|Gerar autoridade)\]/);
  });
});

test('the prompt teaches time, bank topics and the Raio-X rules', () => {
  const prompt = brainSystemPrompt('loja');
  assert.match(prompt, /"time":"HH:MM"/);
  assert.match(prompt, /"topicId"/);
  assert.match(prompt, /oferta só/i);
  assert.match(prompt, /em teste/);
});
