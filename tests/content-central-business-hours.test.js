import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  describeBusinessHours, firstOpenTime, isClockTime, isOpenAt, isOpenDay, normalizeBusinessHours, openHours, validateBusinessHours,
} from '../src/content-central-business-hours.js';
import { createCentralProject, listCentralProjects, previewContentSchedulePlan, updateProjectBusinessHours } from '../src/content-central.js';

const OPEN = [{ from: '07:00', to: '11:00' }, { from: '13:00', to: '20:00' }];
const WEEK = { mon: OPEN, tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: [{ from: '07:00', to: '12:00' }], sun: [] };

test('opening hours are validated, sorted, and missing days read as closed', () => {
  const hours = validateBusinessHours({ mon: [{ from: '13:00', to: '20:00' }, { from: '07:00', to: '11:00' }] });
  assert.deepEqual(hours.mon, OPEN);
  assert.deepEqual(hours.sun, []);
  assert.equal(validateBusinessHours(null), null);
  assert.throws(() => validateBusinessHours({ mon: [...OPEN, { from: '21:00', to: '22:00' }] }), /dois períodos/);
  assert.throws(() => validateBusinessHours({ mon: [{ from: '7h', to: '11:00' }] }), /HH:MM/);
  assert.throws(() => validateBusinessHours({ mon: [{ from: '11:00', to: '07:00' }] }), /antes/);
  assert.throws(() => validateBusinessHours({ mon: [{ from: '07:00', to: '12:00' }, { from: '11:00', to: '20:00' }] }), /sobrepõem/);
  assert.equal(normalizeBusinessHours({ mon: 'x' }), null);
  assert.equal(isClockTime('23:59'), true);
  assert.equal(isClockTime('24:00'), false);
});

test('a closed day, the lunch break and the closing minute are outside', () => {
  assert.equal(isOpenDay(WEEK, '2026-10-11'), false); // Sunday
  assert.equal(isOpenAt(WEEK, '2026-10-12', '10:59'), true);
  assert.equal(isOpenAt(WEEK, '2026-10-12', '11:00'), false);
  assert.equal(isOpenAt(WEEK, '2026-10-12', '12:00'), false);
  assert.equal(isOpenAt(WEEK, '2026-10-12', '13:00'), true);
  assert.equal(isOpenAt(WEEK, '2026-10-12', '20:00'), false);
  assert.equal(isOpenAt(WEEK, '2026-10-17', '11:30'), true); // Saturday
  assert.equal(isOpenDay(null, '2026-10-11'), true);
  assert.equal(isOpenAt(null, '2026-10-11', '03:00'), true);
  assert.equal(firstOpenTime(WEEK, '2026-10-12'), '07:00');
  assert.equal(firstOpenTime(WEEK, '2026-10-11'), null);
  assert.deepEqual(openHours(WEEK), [7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19]);
  assert.match(describeBusinessHours(WEEK), /segunda: 07:00–11:00 e 13:00–20:00/);
  assert.match(describeBusinessHours(WEEK), /domingo: fechado/);
  assert.equal(describeBusinessHours(null), '(não configurado)');
});

test('opening hours are saved on the project and listed with it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-hours-'));
  try {
    await createCentralProject({ projectId: 'loja', name: 'Loja' }, dir);
    await updateProjectBusinessHours('loja', WEEK, dir);
    const listed = (await listCentralProjects(dir)).find((project) => project.projectId === 'loja');
    assert.deepEqual(listed.businessHours.sat, [{ from: '07:00', to: '12:00' }]);
    await assert.rejects(updateProjectBusinessHours('loja', { mon: [{ from: '9', to: '10:00' }] }, dir), /HH:MM/);
    await updateProjectBusinessHours('loja', null, dir);
    assert.equal((await listCentralProjects(dir)).find((project) => project.projectId === 'loja').businessHours, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Agenda preview warns about posts outside opening hours without dropping them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-hours-'));
  try {
    await createCentralProject({ projectId: 'agenda', name: 'Agenda' }, dir);
    const STORY = [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 }];
    const before = await previewContentSchedulePlan('agenda', { days: 2, startDate: '2026-10-11', formats: STORY }, dir);
    assert.deepEqual(before.businessHoursWarnings, []);

    await updateProjectBusinessHours('agenda', WEEK, dir);
    const plan = await previewContentSchedulePlan('agenda', { days: 2, startDate: '2026-10-11', formats: STORY }, dir);
    assert.equal(plan.regularCount, 2);
    assert.deepEqual(plan.businessHoursWarnings, [
      '2026-10-11 às 12:00 (Instagram Stories): loja fechada nesse dia',
      '2026-10-12 às 12:00 (Instagram Stories): fora do horário de funcionamento',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a non-object is refused, and an untouched all-closed week reads as not configured', async () => {
  for (const bad of ['seg', 5, true, [], [{ from: '07:00', to: '11:00' }]]) {
    assert.throws(() => validateBusinessHours(bad), /^Error: Horário de funcionamento inválido\.$/);
  }
  assert.equal(validateBusinessHours({}), null);
  assert.equal(validateBusinessHours({ mon: [], sun: [] }), null);
  assert.equal(normalizeBusinessHours({ mon: [] }), null);

  const dir = await mkdtemp(join(tmpdir(), 'opensquad-hours-'));
  try {
    await createCentralProject({ projectId: 'loja', name: 'Loja' }, dir);
    await updateProjectBusinessHours('loja', WEEK, dir);
    await updateProjectBusinessHours('loja', { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, dir);
    assert.equal((await listCentralProjects(dir)).find((project) => project.projectId === 'loja').businessHours, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('closing at midnight points to 23:59', () => {
  assert.throws(() => validateBusinessHours({ fri: [{ from: '18:00', to: '00:00' }] }), /sexta: para fechar à meia-noite use 23:59\./);
  assert.equal(validateBusinessHours({ fri: [{ from: '18:00', to: '23:59' }] }).fri[0].to, '23:59');
});
