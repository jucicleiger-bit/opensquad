import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createCentralProject, generateContentSchedulePlan, getCentralPaths, loadProjectForTest, saveProjectOffer, saveProjectOfferGroup, updateProjectBrandInput,
  updateProjectBusinessHours, updateProjectContractedPlan,
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
    assert.equal('businessHoursWarnings' in stored.plan, false);
    assert.equal('summary' in stored.plan, false);
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
      /fora do horário de funcionamento: 2026-10-12-instagram_story-01 \(09:00\)\./i,
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

test('every post at a closed hour is listed in one refusal, across days', async () => {
  await withProject(async (dir) => {
    const afternoon = [{ from: '13:00', to: '20:00' }];
    await updateProjectBusinessHours('loja', { ...WEEK_HOURS, mon: afternoon, tue: afternoon }, dir);
    await assert.rejects(
      saveBrainPlan('loja', { startDate: '2026-10-12', days: 2, formats: STORY }, dir),
      /fora do horário de funcionamento: 2026-10-12-instagram_story-01 \(09:00\), 2026-10-13-instagram_story-01 \(09:00\)\./i,
    );
  });
});

test('an approved plan with a closed Sunday and a chosen time generates exactly that', async () => {
  await withProject(async (dir) => {
    await saveProjectOffer('loja', { name: 'Arroz', type: 'offer' }, dir);
    await saveProjectOffer('loja', { name: 'Feijão', type: 'offer' }, dir);
    await updateProjectBusinessHours('loja', WEEK_HOURS, dir);
    // 2026-10-11 is a Sunday, 2026-10-12 a Monday.
    const stored = await saveBrainPlan('loja', {
      startDate: '2026-10-11', days: 2, formats: STORY, slots: [{ id: '2026-10-12-instagram_story-01', time: '14:00' }],
    }, dir);
    const batch = await generateContentSchedulePlan('loja', {
      days: stored.days, startDate: stored.startDate, formats: stored.formats, approvedPlan: stored.plan, now: new Date(2026, 9, 3, 9),
    }, dir);
    assert.deepEqual(batch.items.map((item) => [item.scheduledDate, item.scheduledTime]), [['2026-10-12', '14:00']]);
  });
});

test('without opening hours nothing is dropped', async () => {
  await withProject(async (dir) => {
    const stored = await saveBrainPlan('loja', { startDate: '2026-10-11', days: 1, formats: STORY }, dir);
    assert.deepEqual(stored.plan.skippedSlotIds, []);
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

const FEED_DAILY = { channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '18:00', intervalMinutes: 0 };
const TWO_STORIES_DAILY = { channel: 'instagram_story', postsPerDay: 2, everyDays: 1, startTime: '09:00', intervalMinutes: 240 };
const ESSENCIAL = { storiesPerDay: 2, feedsPerWeek: 1, storyChannels: ['instagram_story'], feedChannels: ['instagram_feed'], flyersPerMonth: 2 };
const DAY_LONG = [{ from: '07:00', to: '20:00' }];
const MON_TO_SAT_OPEN = { mon: DAY_LONG, tue: DAY_LONG, wed: DAY_LONG, thu: DAY_LONG, fri: DAY_LONG, sat: DAY_LONG, sun: [] };
const DAYS_WITHOUT_FEED = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-16', '2026-10-17'];

test('skipped slots leave the plan even without opening hours', async () => {
  await withProject(async (dir) => {
    const stored = await saveBrainPlan('loja', { startDate: '2026-10-12', days: 2, formats: STORY, slots: [{ id: '2026-10-13-instagram_story-01', skip: true }] }, dir);
    assert.deepEqual(stored.plan.skippedSlotIds, ['2026-10-13-instagram_story-01']);
    assert.deepEqual(stored.plan.dayPlans[1].regular, []);
    assert.equal(stored.plan.regularCount, 1);
  });
});

test('a closed day keeps its holiday post', async () => {
  await withProject(async (dir) => {
    await updateProjectBusinessHours('loja', { ...WEEK_HOURS, mon: [] }, dir);
    // 2026-10-12 (Monday, closed here) is Dia das Crianças.
    const stored = await saveBrainPlan('loja', { startDate: '2026-10-12', days: 1, formats: STORY }, dir);
    assert.deepEqual(stored.plan.dayPlans[0].regular, []);
    assert.ok(stored.plan.dayPlans[0].extras.length > 0);
  });
});

test('the plan must follow the contracted plan; a weekly feed is the daily feed with the other days skipped', async () => {
  await withProject(async (dir) => {
    // Mon–Sat 07–20, Sunday closed: a Mon–Sat plan covers every open day, so exactly one feed.
    await updateProjectBusinessHours('loja', MON_TO_SAT_OPEN, dir);
    await updateProjectContractedPlan('loja', ESSENCIAL, dir);
    const formats = [TWO_STORIES_DAILY, FEED_DAILY];
    await assert.rejects(saveBrainPlan('loja', { startDate: '2026-10-12', days: 6, formats }, dir), /plano contratado.*6 feed\(s\) em instagram_feed/);
    await assert.rejects(saveBrainPlan('loja', { startDate: '2026-10-12', days: 6, formats: [{ ...TWO_STORIES_DAILY, postsPerDay: 1 }, FEED_DAILY] }, dir), /o contratado é 2 por dia/);

    const slots = DAYS_WITHOUT_FEED.map((date) => ({ id: `${date}-instagram_feed-01`, skip: true }));
    const stored = await saveBrainPlan('loja', { startDate: '2026-10-12', days: 6, formats, slots }, dir);
    const feeds = stored.plan.dayPlans.flatMap((day) => day.regular).filter((slot) => slot.channel === 'instagram_feed');
    assert.deepEqual(feeds.map((slot) => slot.date), ['2026-10-15']);
  });
});

test('the plan warns about an offer without price, a repeat on consecutive days and no new hour', async () => {
  await withProject(async (dir) => {
    const a = (await saveProjectOffer('loja', { name: 'Chocolate', type: 'offer' }, dir)).offer;
    await saveProjectOffer('loja', { name: 'Arroz', type: 'offer', price: '9,90' }, dir);
    await saveProjectOffer('loja', { name: 'Feijão', type: 'offer', price: '7,90' }, dir);
    await updateProjectBusinessHours('loja', WEEK_HOURS, dir);
    const { metricsPath } = getCentralPaths(dir, 'loja');
    await mkdir(dirname(metricsPath), { recursive: true });
    await writeFile(metricsPath, JSON.stringify({ media: { s1: { kind: 'story', reach: 30, postedAt: new Date(2026, 9, 3, 9).toISOString() } } }), 'utf-8');

    const stored = await saveBrainPlan('loja', {
      startDate: '2026-10-12', days: 2, formats: STORY,
      slots: [{ id: '2026-10-12-instagram_story-01', offerIds: [a.id] }, { id: '2026-10-13-instagram_story-01', offerIds: [a.id] }],
    }, dir);

    const text = stored.plan.warnings.join(' | ');
    assert.match(text, /Chocolate está sem preço no post de 2026-10-12 às 09:00/);
    assert.match(text, /Chocolate sai em dias seguidos \(2026-10-12 e 2026-10-13\) e há ofertas sem usar nesses dias: Arroz, Feijão/);
    assert.match(text, /Nenhum story em horário novo; horas abertas nunca testadas: 7h, 8h, 10h/);
  });
});

test('with few offers a repeat on consecutive days is not a warning', async () => {
  await withProject(async (dir) => {
    const a = (await saveProjectOffer('loja', { name: 'Arroz', type: 'offer', price: '9,90' }, dir)).offer;
    const stored = await saveBrainPlan('loja', {
      startDate: '2026-10-12', days: 2, formats: STORY,
      slots: [{ id: '2026-10-12-instagram_story-01', offerIds: [a.id] }, { id: '2026-10-13-instagram_story-01', offerIds: [a.id] }],
    }, dir);
    assert.deepEqual(stored.plan.warnings, []);
  });
});

test('the context shows the contracted plan and the plan warnings', async () => {
  await withProject(async (dir) => {
    await updateProjectContractedPlan('loja', { ...ESSENCIAL, feedsPerWeek: 0, feedChannels: [], storiesPerDay: 1 }, dir);
    await saveProjectOffer('loja', { name: 'Chocolate', type: 'offer' }, dir);
    await saveBrainPlan('loja', { startDate: '2026-10-12', days: 1, formats: STORY }, dir);
    const text = await buildBrainContext('loja', dir);
    assert.match(text, /## Plano contratado\n\n- Stories por dia: 1 \(mesma arte em: Instagram\)/);
    assert.match(text, /Encartes por mês: 2/);
    assert.match(text, /Avisos do plano:\n- Chocolate está sem preço/);
  });
});
