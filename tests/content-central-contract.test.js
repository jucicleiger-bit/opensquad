import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { contractProblems, describeContractedPlan, normalizeContractedPlan, validateContractedPlan } from '../src/content-central-contract.js';
import { createCentralProject, listCentralProjects, updateProjectContractedPlan } from '../src/content-central.js';

const ESSENCIAL = { storiesPerDay: 2, feedsPerWeek: 1, storyChannels: ['instagram_story', 'whatsapp_status'], feedChannels: ['instagram_feed'], flyersPerMonth: 2 };
const SUN_CLOSED = { mon: [{ from: '07:00', to: '20:00' }], tue: [{ from: '07:00', to: '20:00' }], wed: [{ from: '07:00', to: '20:00' }], thu: [{ from: '07:00', to: '20:00' }], fri: [{ from: '07:00', to: '20:00' }], sat: [{ from: '07:00', to: '12:00' }], sun: [] };

// One plan day: n posts on each channel given.
const day = (date, counts) => ({ date, regular: Object.entries(counts).flatMap(([channel, n]) => Array.from({ length: n }, () => ({ channel }))) });
const week = (feedDays) => ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']
  .map((date) => day(date, { instagram_story: 2, whatsapp_status: 2, instagram_feed: feedDays.includes(date) ? 1 : 0 }));

test('a contracted plan is validated, ordered and described', () => {
  const plan = validateContractedPlan({ ...ESSENCIAL, storyChannels: ['whatsapp_status', 'instagram_story', 'instagram_story'] });
  assert.deepEqual(plan.storyChannels, ['instagram_story', 'whatsapp_status']);
  assert.equal(validateContractedPlan(null), null);
  assert.equal(validateContractedPlan({ storiesPerDay: 0, feedsPerWeek: 0, flyersPerMonth: 0 }), null);
  assert.throws(() => validateContractedPlan('x'), /Plano contratado inválido/);
  assert.throws(() => validateContractedPlan({ ...ESSENCIAL, storiesPerDay: 1.5 }), /Stories por dia/);
  assert.throws(() => validateContractedPlan({ ...ESSENCIAL, storyChannels: ['tiktok'] }), /canal desconhecido "tiktok"/);
  assert.throws(() => validateContractedPlan({ ...ESSENCIAL, storyChannels: [] }), /em quais canais o story/);
  assert.equal(normalizeContractedPlan({ storiesPerDay: 'x' }), null);
  const text = describeContractedPlan(validateContractedPlan(ESSENCIAL));
  assert.match(text, /Stories por dia: 2 \(mesma arte em: Instagram, Status do WhatsApp\)/);
  assert.match(text, /Feed por semana: 1 \(em: Instagram\)/);
  assert.match(text, /Encartes por mês: 2 \(feitos à mão pelo operador/);
  assert.equal(describeContractedPlan(null), '(não configurado)');
});

test('a plan must match the contract: channels, stories per open day, feeds per week', () => {
  const contract = validateContractedPlan(ESSENCIAL);
  assert.deepEqual(contractProblems({ dayPlans: week(['2026-10-15']) }, contract, SUN_CLOSED), []);
  assert.deepEqual(contractProblems({ dayPlans: week(['2026-10-15']) }, null, SUN_CLOSED), []);

  // Mon–Sat covers every open day of that week (Sunday closed): exactly one feed.
  assert.match(contractProblems({ dayPlans: week([]) }, contract, SUN_CLOSED).join(' | '), /semana de 2026-10-12: 0 feed\(s\) em instagram_feed, o contratado é 1 por semana/);
  assert.match(contractProblems({ dayPlans: week(['2026-10-13', '2026-10-15']) }, contract, SUN_CLOSED).join(' | '), /2 feed\(s\)/);
  // Without opening hours Sunday counts as open, so Mon–Sat is a partial week: fewer is fine, more is not.
  assert.deepEqual(contractProblems({ dayPlans: week([]) }, contract, null), []);

  const oneStory = week(['2026-10-15']);
  oneStory[0] = day('2026-10-12', { instagram_story: 1, whatsapp_status: 1 });
  assert.match(contractProblems({ dayPlans: oneStory }, contract, SUN_CLOSED).join(' | '), /2026-10-12: 1 post\(s\) em instagram_story, o contratado é 2 por dia/);

  const extraChannel = week(['2026-10-15']);
  extraChannel[0].regular.push({ channel: 'facebook_story' });
  const problems = contractProblems({ dayPlans: extraChannel }, contract, SUN_CLOSED).join(' | ');
  assert.match(problems, /o canal facebook_story não está no plano contratado/);
  const missing = week(['2026-10-15']).map((entry) => ({ ...entry, regular: entry.regular.filter((slot) => slot.channel !== 'whatsapp_status') }));
  assert.match(contractProblems({ dayPlans: missing }, contract, SUN_CLOSED).join(' | '), /falta o canal whatsapp_status/);
});

test('an over-count names the feed slot ids the cérebro could skip', () => {
  const contract = validateContractedPlan(ESSENCIAL);
  const dayPlans = week(['2026-10-12', '2026-10-13', '2026-10-15']).map((entry) => ({
    ...entry, regular: entry.regular.map((slot) => ({ ...slot, id: `${entry.date}-${slot.channel}-01` })),
  }));
  const text = contractProblems({ dayPlans }, contract, SUN_CLOSED).join(' | ');
  assert.match(text, /3 feed\(s\) em instagram_feed, o contratado é 1 por semana — pule \("skip": true\) até sobrar 1: 2026-10-12-instagram_feed-01, 2026-10-13-instagram_feed-01, 2026-10-15-instagram_feed-01/);
  // Slots without ids (tests, callers outside the cérebro): no list.
  assert.doesNotMatch(contractProblems({ dayPlans: week(['2026-10-12', '2026-10-13']) }, contract, SUN_CLOSED).join(' | '), /pule/);
});

test('the weekly feed check covers a plan that starts mid-week and counts feeds already scheduled', () => {
  const contract = validateContractedPlan(ESSENCIAL);
  const days = (dates, feedDays) => dates.map((date) => day(date, { instagram_story: 2, whatsapp_status: 2, instagram_feed: feedDays.includes(date) ? 1 : 0 }));
  // Wed 2026-10-07 to Tue 10-13: Wed–Sat is every open day of the first week from the start on, with no feed.
  const wedToTue = days(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'], []);
  const text = contractProblems({ dayPlans: wedToTue }, contract, SUN_CLOSED).join(' | ');
  assert.match(text, /semana de 2026-10-05: 0 feed\(s\)/);
  assert.doesNotMatch(text, /semana de 2026-10-12/);

  // Wed–Sun with the week's feed already scheduled on Monday: nothing more to plan, and one more is too many.
  const wedToSun = (feedDays) => days(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'], feedDays);
  const existing = [{ date: '2026-10-05', channel: 'instagram_feed' }];
  assert.deepEqual(contractProblems({ dayPlans: wedToSun([]) }, contract, SUN_CLOSED, existing), []);
  assert.match(contractProblems({ dayPlans: wedToSun(['2026-10-08']) }, contract, SUN_CLOSED, existing).join(' | '), /semana de 2026-10-05: 2 feed\(s\)/);
  // Another channel's or another week's feed does not count.
  assert.match(contractProblems({ dayPlans: wedToSun([]) }, contract, SUN_CLOSED, [{ date: '2026-10-05', channel: 'facebook_feed' }, { date: '2026-10-12', channel: 'instagram_feed' }]).join(' | '), /0 feed\(s\)/);
});

test('the contracted plan is saved on the project and listed with it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-contract-'));
  try {
    await createCentralProject({ projectId: 'loja', name: 'Loja' }, dir);
    await updateProjectContractedPlan('loja', ESSENCIAL, dir);
    const listed = (await listCentralProjects(dir)).find((project) => project.projectId === 'loja');
    assert.equal(listed.contractedPlan.storiesPerDay, 2);
    await assert.rejects(updateProjectContractedPlan('loja', { ...ESSENCIAL, feedsPerWeek: -1 }, dir), /Feed por semana/);
    await updateProjectContractedPlan('loja', null, dir);
    assert.equal((await listCentralProjects(dir)).find((project) => project.projectId === 'loja').contractedPlan, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
