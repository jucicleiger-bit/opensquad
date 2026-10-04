import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyPlanSlotChoices, createCentralProject, listProjectGoalTopics, loadProjectForTest, previewContentSchedulePlan,
  saveProjectOffer, updateProjectBrandInput,
} from '../src/content-central.js';

async function withTempProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-choices-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Venda 50% / Gerar autoridade 50% with one offer: on each day, story 01
// (09:00) is a sales slot and story 02 (13:00) an authority slot.
const TWO_STORIES = [{ channel: 'instagram_story', postsPerDay: 2, everyDays: 1, startTime: '09:00', intervalMinutes: 240 }];
const STORY_AND_REELS = [
  { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
  { channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
];

async function goalProject(dir, projectId) {
  await createCentralProject({ projectId, name: 'Loja' }, dir);
  await updateProjectBrandInput(projectId, {
    brandName: 'Loja', segment: 'Mercado', productsOrServices: 'Alimentos', contentGoals: ['authority'], contentGoalWeights: { sales: 50, authority: 50 },
  }, dir);
  return (await saveProjectOffer(projectId, { name: 'Arroz', type: 'offer', price: '9,90' }, dir)).offer;
}

test('a goal slot names its topic once, without the goal and topic twice', async () => {
  await withTempProject(async (dir) => {
    await goalProject(dir, 'rotulo');
    const preview = await previewContentSchedulePlan('rotulo', { days: 1, startDate: '2026-10-05', formats: TWO_STORIES }, dir);
    const goal = preview.dayPlans[0].regular[1];
    assert.equal(goal.source, 'goal');
    assert.equal(goal.label, goal.topic.label);
    assert.equal(goal.label.indexOf(goal.topic.ideaTitle), goal.label.lastIndexOf(goal.topic.ideaTitle));
  });
});

test('an offer can only be pinned on a sales slot', async () => {
  await withTempProject(async (dir) => {
    const offer = await goalProject(dir, 'so-venda');
    const preview = await previewContentSchedulePlan('so-venda', { days: 1, startDate: '2026-10-05', formats: TWO_STORIES }, dir);
    await assert.rejects(
      applyPlanSlotChoices('so-venda', preview, [{ id: '2026-10-05-instagram_story-02', offerIds: [offer.id] }], dir),
      /2026-10-05-instagram_story-02.*Gerar autoridade.*horário de venda/,
    );
  });
});

test('a goal slot takes a topic of its own goal from the bank', async () => {
  await withTempProject(async (dir) => {
    await goalProject(dir, 'banco');
    const preview = await previewContentSchedulePlan('banco', { days: 1, startDate: '2026-10-05', formats: TWO_STORIES }, dir);
    const goal = preview.dayPlans[0].regular[1];
    const other = listProjectGoalTopics(await loadProjectForTest('banco', dir)).find((topic) => topic.ideaId !== goal.topic.ideaId);

    const plan = await applyPlanSlotChoices('banco', preview, [{ id: goal.id, topicId: other.ideaId, reason: 'Começo do mês' }], dir);
    const slot = plan.dayPlans[0].regular[1];
    assert.equal(slot.topicId, other.ideaId);
    assert.equal(slot.topic.ideaId, other.ideaId);
    assert.match(slot.label, new RegExp(other.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(slot.reason, 'Começo do mês');

    await assert.rejects(applyPlanSlotChoices('banco', preview, [{ id: '2026-10-05-instagram_story-01', topicId: other.ideaId }], dir), /horário de objetivo/);
    await assert.rejects(applyPlanSlotChoices('banco', preview, [{ id: goal.id, topicId: 'authority-nao-existe' }], dir), /não existe/);
  });
});

test('a time choice moves every channel that shares the art', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'hora', name: 'Hora' }, dir);
    await saveProjectOffer('hora', { name: 'A', type: 'offer' }, dir);
    const preview = await previewContentSchedulePlan('hora', { days: 1, startDate: '2026-10-05', formats: STORY_AND_REELS }, dir);

    const plan = await applyPlanSlotChoices('hora', preview, [{ id: '2026-10-05-instagram_story-01', time: '15:30' }], dir);
    assert.deepEqual(plan.dayPlans[0].regular.map((slot) => slot.scheduledTime), ['15:30', '15:30']);

    await assert.rejects(applyPlanSlotChoices('hora', preview, [{ id: '2026-10-05-instagram_story-01', time: '9h' }], dir), /HH:MM/);
    await assert.rejects(applyPlanSlotChoices('hora', preview, [
      { id: '2026-10-05-instagram_story-01', time: '15:30' },
      { id: '2026-10-05-instagram_reels-01', time: '16:00' },
    ], dir), /mesmo horário/);
  });
});
