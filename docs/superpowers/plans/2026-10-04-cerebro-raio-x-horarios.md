# Cérebro: Raio-X, banco de assuntos, horário de funcionamento e horários que funcionam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cérebro respects the Raio-X goal split, picks goal topics from the topic bank, plans only inside the shop's opening hours, and learns which posting hours reach more people.

**Architecture:** Opening hours are a new `project.businessHours` (pure helpers in a new module). Plan slot choices gain `time` and `topicId`, both applied to every channel sharing the art; generation honors them plus `skippedSlotIds`. The metrics collector keeps each post's time and a pure function turns metrics into reach-by-hour stats. The cérebro's context and prompt gain the Raio-X, the bank, the hours and the stats.

**Tech Stack:** Node ESM, `node:test`; React + Vitest in `content-central-app/`.

Spec: `docs/superpowers/specs/2026-10-04-cerebro-raio-x-horarios-design.md`.

## Global Constraints

- Work only in the worktree `C:\Users\jucic\OneDrive\Documentos\PROJETO\OPENSQUAD\.claude\worktrees\cerebro`, branch `cerebro`.
- Git commands from PowerShell, not Bash (Bash git is refused in a worktree session). Files under `docs/` need `git add -f`.
- Never touch the production server (port 3333) or `../../../_opensquad` (the main checkout's data).
- Operator-facing strings in Portuguese; code comments in English, matching the surrounding style.
- Server tests: `node --test <file>` from the worktree root. Do NOT use `--test-name-pattern` after the file argument (it silently runs everything).
- App: `cd content-central-app; npx vitest run <file>`; type errors only show in `npm run build` (`tsc --noEmit` checks nothing here).
- Time of day is local wall-clock "HH:MM" (the server runs with `TZ=America/Cuiaba`); dates are "AAAA-MM-DD".
- Implementers do not commit when dispatched in parallel waves; the controller commits per task.

## File map

| File | Responsibility |
|---|---|
| `src/content-central-business-hours.js` (new) | Validate/normalize/describe opening hours; open-day/open-hour checks |
| `src/content-central.js` | Save hours, list them; plan choices (`time`, `topicId`, sales-only pins); label fix; generation honors the approved plan; Agenda warnings |
| `src/content-central-server.js` | `POST /api/projects/:id/business-hours` |
| `src/content-central-metrics.js` | Keep `postedAt`; `buildPostingTimeStats` |
| `src/content-central-brain.js` | Plan fits opening hours; richer context; prompt rules |
| `content-central-app/src/api/client.ts` | `BusinessHours` type, `saveBusinessHours`, `businessHoursWarnings` |
| `content-central-app/src/pages/workspace/BusinessHoursCard.tsx` (new) | Opening-hours editor |
| `content-central-app/src/pages/workspace/Company.tsx` | Renders the card in the Raio-X |
| `content-central-app/src/pages/workspace/Brain.tsx` | Hides closed days in the plan list |
| `content-central-app/src/pages/workspace/GenerateContent.tsx` | Shows the out-of-hours warning |

## Waves

| Wave | Tasks | Why together |
|---|---|---|
| 1 | Task 1, Task 4 | Disjoint files, no dependency |
| 2 | Task 2, Task 7 | Both need Task 1 only; files disjoint |
| 3 | Task 3 | Same file as Task 2 (`content-central.js`) and uses its helpers |
| 4 | Task 5, Task 6 | Task 5 needs 1–4; Task 6 needs 1, 3 (same file) and 7 (`client.ts`); files disjoint |
| 5 | Task 8 | Verification by the controller |

---

### Task 1: Opening hours — data, save, list

**Files:**
- Create: `src/content-central-business-hours.js`
- Modify: `src/content-central.js` (import; new `updateProjectBusinessHours` next to `updateProjectContentGoalWeights` ~line 1135; `toProjectSummary` ~line 6111)
- Modify: `src/content-central-server.js` (import; route next to `brand-input` ~line 972)
- Test: `tests/content-central-business-hours.test.js` (new)

**Depends-on:** none

**Interfaces:**
- Produces (from `src/content-central-business-hours.js`):
  - `WEEKDAYS: string[]` = `['sun','mon','tue','wed','thu','fri','sat']`
  - `isClockTime(value: unknown): boolean` — `"HH:MM"`, 00:00–23:59
  - `validateBusinessHours(input): BusinessHours | null` — throws a Portuguese message on bad input; `null`/`undefined` → `null`
  - `normalizeBusinessHours(value): BusinessHours | null` — lenient (malformed → `null`)
  - `isOpenDay(hours, dateKey): boolean`, `isOpenAt(hours, dateKey, time): boolean` (`from <= time < to`; `hours === null` → always `true`)
  - `firstOpenTime(hours, dateKey): string | null`
  - `openHours(hours): number[]` — whole hours `h` where `"hh:00"` is open on some weekday
  - `describeBusinessHours(hours): string`
  - `BusinessHours` = `{ mon|tue|wed|thu|fri|sat|sun: Array<{ from: "HH:MM", to: "HH:MM" }> }` (0–2 periods, sorted)
- Produces (from `src/content-central.js`): `updateProjectBusinessHours(projectId, hours, targetDir, now?)` → project; project summaries carry `businessHours: BusinessHours | null`.
- Produces (HTTP): `POST /api/projects/:id/business-hours` body `{ businessHours: BusinessHours | null }` → `200 { businessHours }` or `400 { error }`.

- [ ] **Step 1: Write the failing tests**

`tests/content-central-business-hours.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  describeBusinessHours, firstOpenTime, isClockTime, isOpenAt, isOpenDay, normalizeBusinessHours, openHours, validateBusinessHours,
} from '../src/content-central-business-hours.js';
import { createCentralProject, listCentralProjects, updateProjectBusinessHours } from '../src/content-central.js';

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
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/content-central-business-hours.test.js`
Expected: FAIL — cannot find module `content-central-business-hours.js`.

- [ ] **Step 3: Create the module**

`src/content-central-business-hours.js`:

```js
// The client's opening hours, set in the Raio-X (project.businessHours). The
// cérebro only plans posts inside them; "Agenda e geração" only warns. Not
// the social-selling businessHours (src/social-selling-safety.js): that one
// is a single window for the agency's own outreach.
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_LABELS = { mon: 'segunda', tue: 'terça', wed: 'quarta', thu: 'quinta', fri: 'sexta', sat: 'sábado', sun: 'domingo' };

export const isClockTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ''));

// Strict: the operator's form gets the reason it was not saved.
export function validateBusinessHours(input) {
  if (input == null) return null;
  const hours = {};
  for (const day of WEEK_ORDER) {
    const label = WEEKDAY_LABELS[day];
    const periods = input[day] ?? [];
    if (!Array.isArray(periods) || periods.length > 2) throw new Error(`${label}: no máximo dois períodos.`);
    const clean = periods.map((period) => ({ from: String(period?.from ?? ''), to: String(period?.to ?? '') }));
    for (const period of clean) {
      if (!isClockTime(period.from) || !isClockTime(period.to)) throw new Error(`${label}: use HH:MM.`);
      if (period.from >= period.to) throw new Error(`${label}: a abertura precisa ser antes do fechamento.`);
    }
    clean.sort((a, b) => a.from.localeCompare(b.from));
    if (clean.length === 2 && clean[1].from < clean[0].to) throw new Error(`${label}: os períodos se sobrepõem.`);
    hours[day] = clean;
  }
  return hours;
}

// Lenient read of what is stored: anything malformed reads as not configured.
export function normalizeBusinessHours(value) {
  try {
    return value ? validateBusinessHours(value) : null;
  } catch {
    return null;
  }
}

function weekdayOf(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function isOpenDay(hours, dateKey) {
  return !hours || hours[weekdayOf(dateKey)].length > 0;
}

// The closing minute counts as closed: from <= time < to.
export function isOpenAt(hours, dateKey, time) {
  if (!hours) return true;
  return hours[weekdayOf(dateKey)].some((period) => period.from <= time && time < period.to);
}

export function firstOpenTime(hours, dateKey) {
  return hours?.[weekdayOf(dateKey)][0]?.from || null;
}

export function openHours(hours) {
  return [...Array(24).keys()].filter((hour) => {
    const time = `${String(hour).padStart(2, '0')}:00`;
    return WEEK_ORDER.some((day) => hours[day].some((period) => period.from <= time && time < period.to));
  });
}

export function describeBusinessHours(hours) {
  if (!hours) return '(não configurado)';
  return WEEK_ORDER.map((day) => `- ${WEEKDAY_LABELS[day]}: ${hours[day].length ? hours[day].map((period) => `${period.from}–${period.to}`).join(' e ') : 'fechado'}`).join('\n');
}
```

- [ ] **Step 4: Save and list on the project**

In `src/content-central.js`, add to the imports at the top:

```js
import { normalizeBusinessHours, validateBusinessHours } from './content-central-business-hours.js';
```

Right after `updateProjectContentGoalWeights` (~line 1145):

```js
export async function updateProjectBusinessHours(projectId, hours, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const businessHours = validateBusinessHours(hours);
    if (businessHours) project.businessHours = businessHours;
    else delete project.businessHours;
    project.updatedAt = now.toISOString();
    await writeJson(paths.projectPath, project);
    return project;
  });
}
```

In `toProjectSummary`, after `timezone: project.timezone,` add:

```js
    businessHours: normalizeBusinessHours(project.businessHours),
```

- [ ] **Step 5: Route**

In `src/content-central-server.js`, import `updateProjectBusinessHours` from `./content-central.js` (same import list as `updateProjectBrandInput`), and add right after the `brand-input` block (same section, so it is POST-only like it):

```js
  if (parts.length === 4 && parts[3] === 'business-hours') {
    const body = await readBody(req);
    try {
      const project = await updateProjectBusinessHours(projectId, body.businessHours ?? null, targetDir);
      return sendJson(res, 200, { businessHours: project.businessHours ?? null });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }
```

Verify by reading the surrounding code that the `brand-input` block is only reached for POST; if it is not, add `method === 'POST' &&` to the condition.

- [ ] **Step 6: Run the tests**

Run: `node --test tests/content-central-business-hours.test.js`
Expected: 3 pass.

- [ ] **Step 7: Commit** (controller, in wave order)

```powershell
git add src/content-central-business-hours.js src/content-central.js src/content-central-server.js tests/content-central-business-hours.test.js
git commit -m "feat(content-central): opening hours per weekday in the Raio-X"
```

---

### Task 2: Plan choices — sales-only pins, bank topics, time per slot, clean goal labels

**Files:**
- Modify: `src/content-central.js` (`CONTENT_GOAL_LABELS` ~line 134; `planSlotFromTopic` ~line 3836; `resolveGroupPins` ~line 3896; `applyPlanSlotChoices` ~line 3914; new exports next to `buildGoalContentTopics` ~line 6576)
- Test: `tests/content-central-plan-choices.test.js` (new)

**Depends-on:** Task 1 (`isClockTime`)

**Interfaces:**
- Consumes: `isClockTime` from `./content-central-business-hours.js`.
- Produces (exported from `src/content-central.js`):
  - `CONTENT_GOAL_LABELS: Record<string, string>` (now exported)
  - `listProjectGoalTopics(project): Array<{ goalKey, ideaId, title, detail }>` — ids are the same `topic.ideaId` generation uses
  - `goalTopicForIdea(project, goalKey, ideaId): topic` — throws `Assunto <id> não existe no banco de <goal>.`
- Produces (plan slot choice shape accepted by `applyPlanSlotChoices`): `{ id, offerIds?, topicId?, time?, reason?, label? }`. A slot with a chosen topic gets `topicId` and the new `topic`/`label`; a slot with a time gets `scheduledTime`. Both spread to every slot sharing the art (same date, shape group, slot number).

- [ ] **Step 1: Write the failing tests**

`tests/content-central-plan-choices.test.js`:

```js
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
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/content-central-plan-choices.test.js`
Expected: FAIL — `listProjectGoalTopics` is not exported (import error).

- [ ] **Step 3: Export the goal labels and the bank helpers**

In `src/content-central.js`:
- Change `const CONTENT_GOAL_LABELS = {` to `export const CONTENT_GOAL_LABELS = {`.
- Add `isClockTime` to the Task 1 import: `import { isClockTime, normalizeBusinessHours, validateBusinessHours } from './content-central-business-hours.js';`
- Right after `buildGoalContentTopics` (~line 6583) add:

```js
// The bank as the cérebro sees it. ideaId is the topic's own id (the stored
// bank item's id gets the goal prefixed when normalized), so a pick made from
// this list is found again by goalTopicForIdea and by generation.
export function listProjectGoalTopics(project) {
  return selectedTopicIdeaGoalKeys(project).flatMap((goalKey) => buildGoalContentTopics(goalKey, project)
    .filter((topic) => topic.ideaId)
    .map((topic) => ({ goalKey, ideaId: topic.ideaId, title: topic.ideaTitle, detail: topic.items })));
}

export function goalTopicForIdea(project, goalKey, ideaId) {
  const topic = buildGoalContentTopics(goalKey, project).find((entry) => entry.ideaId === ideaId);
  if (!topic) throw new Error(`Assunto ${ideaId} não existe no banco de ${CONTENT_GOAL_LABELS[goalKey] || goalKey}.`);
  return topic;
}
```

- [ ] **Step 4: Goal labels read once**

In `planSlotFromTopic`, replace

```js
  const label = topic.source === 'special_date' && topic.label ? topic.label : `${kind} — ${name}`;
```

with

```js
  // A goal topic's label already reads "<goal> — <topic>"; prefixing the
  // kind (which is that same label) repeated both.
  const label = (topic.source === 'special_date' || topic.source === 'goal') && topic.label ? topic.label : `${kind} — ${name}`;
```

- [ ] **Step 5: One group rule for pins, times and topics**

Replace the whole `resolveGroupPins` function (keep its comment block above it, and add the second paragraph shown) with:

```js
// Same-shape channels at one day and slot (Story/Reels/Facebook Story, or
// Feed/Facebook Feed) share one creative, image and caption alike (see
// creativeGroupKey). So a pin on any of them pins all of them — otherwise a
// pinned Story could go out with the art of the Reels' rotation pick — and
// two different pins in one group can't both be honored.
// The cérebro's time and bank topic follow the same rule: one art goes out
// once, about one thing.
// Returns slot id → chosen value for every chosen slot and its siblings.
function resolveGroupChoice(slots, valueOf, conflict) {
  const groupOf = (slot) => `${slot.date}::${creativeShapeGroupForChannel(slot.channel) || slot.channel}::${slot.slotNumber}`;
  const byGroup = new Map();
  for (const slot of slots) {
    const value = valueOf(slot.id);
    if (value === undefined) continue;
    const key = groupOf(slot);
    if (byGroup.has(key) && JSON.stringify(byGroup.get(key)) !== JSON.stringify(value)) throw new Error(`Horário ${slot.id}: ${conflict}`);
    byGroup.set(key, value);
  }
  return new Map(slots.filter((slot) => byGroup.has(groupOf(slot))).map((slot) => [slot.id, byGroup.get(groupOf(slot))]));
}

function resolveGroupPins(slots, pinOf) {
  return resolveGroupChoice(slots, (id) => {
    const offerIds = pinOf(id) || [];
    return offerIds.length ? offerIds : undefined;
  }, 'canais do mesmo formato no mesmo horário dividem a arte — use a mesma oferta neles.');
}
```

- [ ] **Step 6: Apply topic and time choices**

Replace the body of `applyPlanSlotChoices` (keep its comment, and add the sentence shown) with:

```js
// Applies the cérebro's per-slot choices to a preview plan, validating each
// pinned slot with the same rules generation uses, so a plan shown in the
// panel is a plan that will generate. The Raio-X split stays the preview's:
// offers only on sales slots, bank topics only on goal slots.
export async function applyPlanSlotChoices(projectId, plan, choices, targetDir = process.cwd()) {
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  const byId = new Map((Array.isArray(choices) ? choices : []).map((choice) => [String(choice?.id || ''), choice]));
  const slots = plan.dayPlans.flatMap((day) => day.regular);
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  for (const id of byId.keys()) if (!slotById.has(id)) throw new Error(`Horário ${id} não existe neste plano.`);
  const offerIdsOf = (choice) => (Array.isArray(choice?.offerIds) ? choice.offerIds.map(String).filter(Boolean).slice(0, 2) : []);
  const pinsBySlot = resolveGroupPins(slots, (id) => offerIdsOf(byId.get(id)));
  const timeBySlot = resolveGroupChoice(slots, (id) => {
    const time = byId.get(id)?.time;
    if (time === undefined || time === null || time === '') return undefined;
    if (!isClockTime(time)) throw new Error(`Horário ${id}: hora "${time}" inválida, use HH:MM.`);
    return String(time);
  }, 'canais que dividem a arte saem no mesmo horário — use a mesma hora neles.');
  const topicBySlot = resolveGroupChoice(slots, (id) => String(byId.get(id)?.topicId || '').trim() || undefined,
    'canais que dividem a arte falam do mesmo assunto — use o mesmo assunto neles.');
  for (const id of pinsBySlot.keys()) {
    const slot = slotById.get(id);
    if (slot.source !== 'offer') {
      throw new Error(`Horário ${id} é de ${CONTENT_GOAL_LABELS[slot.goalKey] || 'objetivo do Raio-X'} pelo Raio-X; oferta só entra em horário de venda.`);
    }
  }
  for (const id of topicBySlot.keys()) {
    if (slotById.get(id).source !== 'goal') throw new Error(`Horário ${id} é de venda; assunto do banco só entra em horário de objetivo.`);
  }
  const dayPlans = [];
  for (const day of plan.dayPlans) {
    const regular = [];
    for (const slot of day.regular) {
      const choice = byId.get(slot.id);
      const offerIds = pinsBySlot.get(slot.id) || [];
      const time = timeBySlot.get(slot.id);
      const topicId = topicBySlot.get(slot.id);
      if (!choice && !offerIds.length && !time && !topicId) { regular.push(slot); continue; }
      let next = time ? { ...slot, scheduledTime: time } : slot;
      if (topicId) {
        const topic = { ...goalTopicForIdea(project, slot.goalKey, topicId), channel: slot.channel };
        next = { ...next, topic, topicId, label: topic.label };
      }
      const reason = cleanApprovedPlanText(choice?.reason, 500) || next.reason;
      if (!offerIds.length) {
        regular.push({ ...next, label: cleanApprovedPlanText(choice?.label, 220) || next.label, reason });
        continue;
      }
      const topic = await topicForPinnedOffers(project, slot.id, offerIds, slot.date, targetDir);
      const name = topic.products?.length ? topic.products.map((product) => product.name).join(' + ') : topic.offerName;
      const rest = { ...next };
      delete rest.topic;
      regular.push({
        ...rest,
        kind: 'Venda',
        source: 'offer',
        offerIds,
        offerId: offerIds[0],
        offerName: name,
        price: topic.products?.length ? topic.products.map((product) => product.price).join(' + ') : topic.price,
        label: `Venda — ${name}`,
        reason,
      });
    }
    dayPlans.push({ ...day, regular });
  }
  return { ...plan, dayPlans };
}
```

- [ ] **Step 7: Run the new and the old plan tests**

Run: `node --test tests/content-central-plan-choices.test.js`
Expected: 4 pass.
Run: `node --test tests/content-central-offer-rotation.test.js`
Expected: all pass (pins and "dividem a arte" unchanged).

- [ ] **Step 8: Commit** (controller)

```powershell
git add src/content-central.js tests/content-central-plan-choices.test.js
git commit -m "feat(content-central): plan slots take a bank topic and a time, and offers stay on sales slots"
```

---

### Task 3: Generation honors the approved plan's time, topic and skipped slots

**Files:**
- Modify: `src/content-central.js` (`buildApprovedPlanOverrideMap` ~line 3533; `generateContentSchedulePlan` ~lines 3600–3690)
- Test: `tests/content-central-plan-choices.test.js` (append)

**Depends-on:** Task 2

**Interfaces:**
- Consumes: `goalTopicForIdea`, `listProjectGoalTopics`, `applyPlanSlotChoices` (Task 2); `isClockTime` (Task 1).
- Produces: `generateContentSchedulePlan(projectId, { ..., approvedPlan })` where `approvedPlan` may carry `skippedSlotIds: string[]` and slots with `scheduledTime`, `topicId`, `goalKey`. Skipped slots still take their rotation turn.

- [ ] **Step 1: Append the failing tests**

Add to the imports of `tests/content-central-plan-choices.test.js`: `generateContentSchedulePlan, listProjectContent`. Add `const NOW = new Date(2026, 9, 3, 9);` below the formats. Append:

```js
test('generation uses the time and the bank topic the approved plan chose', async () => {
  await withTempProject(async (dir) => {
    await goalProject(dir, 'gera');
    const preview = await previewContentSchedulePlan('gera', { days: 1, startDate: '2026-10-05', formats: TWO_STORIES }, dir);
    const goal = preview.dayPlans[0].regular[1];
    const other = listProjectGoalTopics(await loadProjectForTest('gera', dir)).find((topic) => topic.ideaId !== goal.topic.ideaId);
    const plan = await applyPlanSlotChoices('gera', preview, [{ id: goal.id, topicId: other.ideaId, time: '15:30' }], dir);

    const batch = await generateContentSchedulePlan('gera', { days: 1, startDate: '2026-10-05', formats: TWO_STORIES, approvedPlan: plan, now: NOW }, dir);

    const goalItem = batch.items.find((item) => item.contentId.endsWith('-02'));
    assert.equal(goalItem.scheduledTime, '15:30');
    assert.equal(goalItem.contentTopic.ideaId, other.ideaId);
    const salesItem = batch.items.find((item) => item.contentId.endsWith('-01'));
    assert.equal(salesItem.scheduledTime, '09:00');
    assert.equal(salesItem.contentTopic.offerName, 'Arroz');
  });
});

test('generation skips the slots the plan dropped and the others keep their offers', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pula', name: 'Pula' }, dir);
    for (const name of ['A', 'B', 'C']) await saveProjectOffer('pula', { name, type: 'offer' }, dir);
    const ONE_STORY = [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }];
    const preview = await previewContentSchedulePlan('pula', { days: 3, startDate: '2026-10-05', formats: ONE_STORY }, dir);
    const approvedPlan = { ...preview, skippedSlotIds: ['2026-10-06-instagram_story-01'] };

    const batch = await generateContentSchedulePlan('pula', { days: 3, startDate: '2026-10-05', formats: ONE_STORY, approvedPlan, now: NOW }, dir);

    assert.deepEqual(batch.items.map((item) => [item.scheduledDate, item.contentTopic.offerName]), [
      ['2026-10-05', preview.dayPlans[0].regular[0].offerName],
      ['2026-10-07', preview.dayPlans[2].regular[0].offerName],
    ]);
  });
});

test('a bank topic that no longer exists fails before anything is written', async () => {
  await withTempProject(async (dir) => {
    await goalProject(dir, 'sumiu');
    const approvedPlan = { dayPlans: [{ date: '2026-10-05', regular: [{ id: '2026-10-05-instagram_story-02', topicId: 'authority-nao-existe', goalKey: 'authority' }] }] };
    await assert.rejects(
      generateContentSchedulePlan('sumiu', { days: 1, startDate: '2026-10-05', formats: TWO_STORIES, approvedPlan, now: NOW }, dir),
      /authority-nao-existe/,
    );
    assert.deepEqual(await listProjectContent('sumiu', dir), []);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/content-central-plan-choices.test.js`
Expected: the 3 new tests FAIL (time stays 09:00 / skipped slot generated / no rejection).

- [ ] **Step 3: Carry time, topic and goal in the override map**

In `buildApprovedPlanOverrideMap`, replace the two lines

```js
      if (!id || (!label && !reason && !offerIds.length)) continue;
      map.set(id, { id, label, reason, offerIds });
```

with

```js
      const time = isClockTime(slot?.scheduledTime) ? slot.scheduledTime : '';
      const topicId = cleanApprovedPlanText(slot?.topicId, 160);
      const goalKey = cleanApprovedPlanText(slot?.goalKey, 60);
      if (!id || (!label && !reason && !offerIds.length && !time && !topicId)) continue;
      map.set(id, { id, label, reason, offerIds, time, topicId, goalKey });
```

- [ ] **Step 4: Check topics up front and read the skipped slots**

In `generateContentSchedulePlan`, right after

```js
  await refreshProjectTopicIdeasInPlace(project, paths, { topicIdeaGenerator: options.topicIdeaGenerator }, new Date());
```

add

```js
  // A bank topic the cérebro chose must still exist (the bank refreshes every
  // 15 days) — checked here, after the refresh and before anything is written.
  for (const override of approvedPlanOverrides.values()) {
    if (override.topicId) goalTopicForIdea(project, override.goalKey, override.topicId);
  }
  const skippedSlotIds = new Set(Array.isArray(options.approvedPlan?.skippedSlotIds) ? options.approvedPlan.skippedSlotIds.map(String) : []);
```

- [ ] **Step 5: Use them in the slot loop**

In the inner slot loop, replace from `const slotNumber = slotIndex + 1;` down to and including the `const baseContentTopic = applyApprovedPlanOverrideToTopic(...);` statement with:

```js
        const slotNumber = slotIndex + 1;
        const rotationTime = addMinutesToTime(format.startTime, slotIndex * format.intervalMinutes);
        const planSlotId = `${scheduledDate}-${format.channel}-${String(slotNumber).padStart(2, '0')}`;
        const approvedPlanOverride = approvedPlanOverrides.get(planSlotId);
        // The approved plan's time wins (the cérebro may move a slot); the
        // rotation keeps asking with the format's time, as the preview did.
        const scheduledTime = approvedPlanOverride?.time || rotationTime;
        const dimensions = imageDimensionsForChannel(format.channel);
        const aspectRatio = imageAspectRatioForChannel(format.channel);
        const shapeGroup = creativeShapeGroupForChannel(format.channel);
        const creativeGroupKey = shapeGroup ? `${batchId}::${scheduledDate}::${shapeGroup}::slot${slotIndex}` : null;
        const rotationTopic = await picker.next(format.channel, creativeGroupKey, weekday, `${scheduledDate} ${rotationTime}`);
        // A closed day's slot (fitPlanToBusinessHours in content-central-brain.js)
        // still takes its rotation turn, so the slots after it keep the preview's picks.
        if (skippedSlotIds.has(planSlotId)) continue;
        const baseContentTopic = applyApprovedPlanOverrideToTopic({ ...rotationTopic, channel: format.channel }, approvedPlanOverride);
```

Then replace the `slotTopic` statement with:

```js
        const slotTopic = pinnedOfferIds.length
          ? applyApprovedPlanOverrideToTopic(
            { ...(await topicForPinnedOffers(project, planSlotId, pinnedOfferIds, scheduledDate, targetDir)), channel: format.channel },
            { ...approvedPlanOverride, label: '' },
          )
          : approvedPlanOverride?.topicId
            ? applyApprovedPlanOverrideToTopic(
              { ...goalTopicForIdea(project, approvedPlanOverride.goalKey, approvedPlanOverride.topicId), channel: format.channel },
              { ...approvedPlanOverride, label: '' },
            )
            : baseContentTopic;
```

Leave the existing comment above `slotTopic` in place. Make sure no second declaration of `planSlotId`, `approvedPlanOverride`, `dimensions`, `aspectRatio`, `shapeGroup` or `creativeGroupKey` is left behind further down.

- [ ] **Step 6: Run the tests**

Run: `node --test tests/content-central-plan-choices.test.js`
Expected: 7 pass.
Run: `node --test tests/content-central-offer-rotation.test.js`
Expected: all pass.

- [ ] **Step 7: Commit** (controller)

```powershell
git add src/content-central.js tests/content-central-plan-choices.test.js
git commit -m "feat(content-central): generation honors the approved plan's time, bank topic and dropped slots"
```

---

### Task 4: Metrics keep each post's time; reach by posting hour

**Files:**
- Modify: `src/content-central-metrics.js` (stories loop ~line 106; media loop ~line 133; new export at the end)
- Test: `tests/content-central-metrics.test.js` (append; add `buildPostingTimeStats` to its import)

**Depends-on:** none

**Interfaces:**
- Produces: `metrics.media[id].postedAt` (Graph `timestamp` string) for stories and feed/reels.
- Produces: `buildPostingTimeStats(metrics, items = [], now = new Date()): Array<{ kind: 'story'|'feed'|'reels', hour: number, count: number, avgReach: number, best: number, worst: number }>` sorted by kind then hour; `items` are content items (`publish.metaMediaId`, `publish.publishedAt` give the time when `postedAt` is missing).

- [ ] **Step 1: Append the failing tests**

```js
test('keeps when each story and post went out', async () => {
  await withTempProject(async (dir) => {
    await projectWithToken(dir, 'loja', WITH_INSIGHTS);
    const graph = fakeGraph({
      'ig-1/stories': { data: [{ id: 's1', timestamp: '2026-10-06T13:00:00+0000' }] },
      's1/insights': mediaInsight({ views: 10, reach: 8, replies: 0 }),
      'ig-1': { followers_count: 1 },
      'ig-1/media': { data: [{ id: 'm1', media_product_type: 'FEED', like_count: 1, comments_count: 0, timestamp: '2026-10-05T21:30:00+0000' }] },
      'm1/insights': mediaInsight({ views: 50, reach: 40 }),
      'ig-1/insights': (url) => accountTotal(url.searchParams.get('metric'), 1),
    });

    await collectProjectMetrics('loja', dir, { fetchImpl: graph.fetchImpl, now: new Date(2026, 9, 6, 14) });

    const metrics = await loadProjectMetrics('loja', dir);
    assert.equal(metrics.media.s1.postedAt, '2026-10-06T13:00:00+0000');
    assert.equal(metrics.media.m1.postedAt, '2026-10-05T21:30:00+0000');
  });
});

test('reach is grouped by kind and local hour, only for posts at least a day old', () => {
  const at = (day, hour) => new Date(2026, 9, day, hour, 10).toISOString();
  const metrics = { media: {
    a: { kind: 'story', reach: 200, postedAt: at(1, 13) },
    b: { kind: 'story', reach: 100, postedAt: at(2, 13) },
    c: { kind: 'story', reach: 30, postedAt: at(3, 9) },
    fresh: { kind: 'story', reach: 999, postedAt: at(5, 13) },
    noReach: { kind: 'feed', likes: 3, postedAt: at(1, 18) },
    fromPublish: { kind: 'feed', reach: 50 },
  } };
  const items = [{ publish: { metaMediaId: 'fromPublish', publishedAt: at(2, 18) } }];

  assert.deepEqual(buildPostingTimeStats(metrics, items, new Date(2026, 9, 5, 20)), [
    { kind: 'feed', hour: 18, count: 1, avgReach: 50, best: 50, worst: 50 },
    { kind: 'story', hour: 9, count: 1, avgReach: 30, best: 30, worst: 30 },
    { kind: 'story', hour: 13, count: 2, avgReach: 150, best: 200, worst: 100 },
  ]);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/content-central-metrics.test.js`
Expected: FAIL — `buildPostingTimeStats` not exported.

- [ ] **Step 3: Keep `postedAt`**

Stories loop — replace

```js
          metrics.media[story.id] = { ...metrics.media[story.id], kind: 'story', ...values, updatedAt: stamp };
```

with

```js
          metrics.media[story.id] = {
            ...metrics.media[story.id], kind: 'story', ...(story.timestamp ? { postedAt: story.timestamp } : {}), ...values, updatedAt: stamp,
          };
```

Media loop — replace

```js
        const entry = { ...metrics.media[media.id], kind, updatedAt: stamp };
```

with

```js
        const entry = { ...metrics.media[media.id], kind, postedAt: media.timestamp, updatedAt: stamp };
```

- [ ] **Step 4: Add the stats function at the end of the file**

```js
const DAY_MS = 86400000;

// Reach by kind and local posting hour, for the cérebro to learn which hours
// work. Only posts at least a day old: a story's reach is still growing
// before that. Stories that went out before postedAt was kept get their time
// from the content item that published them.
export function buildPostingTimeStats(metrics, items = [], now = new Date()) {
  const publishedAt = new Map(items
    .filter((item) => item.publish?.metaMediaId && item.publish?.publishedAt)
    .map((item) => [String(item.publish.metaMediaId), item.publish.publishedAt]));
  const groups = new Map();
  for (const [id, media] of Object.entries(metrics?.media || {})) {
    const posted = new Date(media.postedAt || publishedAt.get(id) || NaN);
    if (Number.isNaN(posted.getTime()) || now - posted < DAY_MS || !Number.isFinite(media.reach)) continue;
    const key = `${media.kind}::${posted.getHours()}`;
    const group = groups.get(key) || { kind: media.kind, hour: posted.getHours(), reaches: [] };
    group.reaches.push(media.reach);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ kind, hour, reaches }) => ({
      kind,
      hour,
      count: reaches.length,
      avgReach: Math.round(reaches.reduce((total, value) => total + value, 0) / reaches.length),
      best: Math.max(...reaches),
      worst: Math.min(...reaches),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.hour - b.hour);
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/content-central-metrics.test.js`
Expected: all pass.

- [ ] **Step 6: Commit** (controller)

```powershell
git add src/content-central-metrics.js tests/content-central-metrics.test.js
git commit -m "feat(content-central): keep when each post went out and sum reach by posting hour"
```

---

### Task 5: The cérebro plans in opening hours and reads the whole Raio-X

**Files:**
- Modify: `src/content-central-brain.js` (imports; `saveBrainPlan` ~line 88; `buildBrainContext` ~line 234; `brainSystemPrompt` ~line 273)
- Test: `tests/content-central-brain.test.js` (append)

**Depends-on:** Task 1, Task 2, Task 3, Task 4

**Interfaces:**
- Consumes: `normalizeBusinessHours`, `isOpenDay`, `isOpenAt`, `firstOpenTime`, `openHours`, `describeBusinessHours` (Task 1); `CONTENT_GOAL_LABELS`, `listProjectGoalTopics` (Task 2); `skippedSlotIds` honored by generation (Task 3); `loadProjectMetrics`, `buildPostingTimeStats` (Task 4); `updateProjectBusinessHours` (Task 1, in tests).
- Produces: stored plans carry `plan.skippedSlotIds` when opening hours closed a day; the context gains sections `## Raio-X da marca`, `## O que evitar`, `## Banco de assuntos`, `## Horário de funcionamento`, `## Desempenho por horário (Instagram)`.

- [ ] **Step 1: Append the failing tests**

Add to the test file's imports: `mkdir` from `node:fs/promises`, `dirname` from `node:path`, `updateProjectBusinessHours` from `../src/content-central.js`, and `brainSystemPrompt` from `../src/content-central-brain.js`. Append:

```js
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
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/content-central-brain.test.js`
Expected: the 5 new tests FAIL.

- [ ] **Step 3: Imports**

In `src/content-central-brain.js`, extend the `./content-central.js` import with `CONTENT_GOAL_LABELS, listProjectGoalTopics`, and add:

```js
import {
  describeBusinessHours, firstOpenTime, isOpenAt, isOpenDay, normalizeBusinessHours, openHours,
} from './content-central-business-hours.js';
import { buildPostingTimeStats, loadProjectMetrics } from './content-central-metrics.js';
```

- [ ] **Step 4: Fit the plan to the opening hours**

Above `saveBrainPlan` add:

```js
// A plan's formats repeat every day, so a closed day can't be avoided by the
// formats alone: its slots leave the plan and are listed in skippedSlotIds,
// which generation skips (after their rotation turn, so the other slots keep
// what the preview showed). A slot at a closed hour of an open day is the
// cérebro's to move with "time". Commemorative extras have no time of their
// own, so one at a closed hour moves to the day's opening.
function fitPlanToBusinessHours(plan, hours) {
  if (!hours) return plan;
  const skippedSlotIds = [];
  const dayPlans = plan.dayPlans.map((day) => {
    if (!isOpenDay(hours, day.date)) {
      skippedSlotIds.push(...day.regular.map((slot) => slot.id));
      return { ...day, regular: [], extras: [] };
    }
    const outside = day.regular.find((slot) => !isOpenAt(hours, day.date, slot.scheduledTime));
    if (outside) {
      throw new Error(`Horário ${outside.id} (${outside.scheduledTime}) fica fora do horário de funcionamento de ${day.date}. Escolha uma hora aberta com "time" ou mude o startTime do formato.`);
    }
    const extras = day.extras.map((extra) => (isOpenAt(hours, day.date, extra.scheduledTime) ? extra : { ...extra, scheduledTime: firstOpenTime(hours, day.date) }));
    return { ...day, extras };
  });
  return {
    ...plan,
    dayPlans,
    skippedSlotIds,
    regularCount: dayPlans.reduce((sum, day) => sum + day.regular.length, 0),
    extraCount: dayPlans.reduce((sum, day) => sum + day.extras.length, 0),
  };
}
```

In `saveBrainPlan`, replace

```js
  const plan = await applyPlanSlotChoices(projectId, preview, slots || [], targetDir);
```

with

```js
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  const plan = fitPlanToBusinessHours(
    await applyPlanSlotChoices(projectId, preview, slots || [], targetDir),
    normalizeBusinessHours(project.businessHours),
  );
```

- [ ] **Step 5: Context helpers**

Above `buildBrainContext` add:

```js
const goalName = (key) => (key === 'sales' ? 'Venda' : CONTENT_GOAL_LABELS[key] || key);
const KIND_LABELS = { story: 'Story', feed: 'Feed', reels: 'Reels' };

function clip(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function slotTag(slot) {
  if (slot.source === 'offer') return 'venda';
  if (slot.source === 'goal') return goalName(slot.goalKey);
  return slot.source || 'assunto';
}

function brandLines(project) {
  const input = project.brandInput || {};
  const xray = project.brandXray?.status === 'approved' ? project.brandXray.blocks || {} : {};
  return [
    `Público: ${input.audience || '-'}`,
    `Região: ${input.serviceRegion || '-'}`,
    `Diferencial: ${input.mainDifferential || '-'}`,
    `Tom: ${(input.tone || []).join(', ') || '-'}`,
    `Evitar: ${input.avoid || '-'}`,
    xray.summary?.text ? `Resumo aprovado: ${clip(xray.summary.text, 600)}` : 'Raio-X da marca ainda não aprovado.',
    xray.communication?.text ? `Comunicação: ${clip(xray.communication.text, 600)}` : '',
  ].filter(Boolean).join('\n');
}

function topicBankLines(project, items) {
  const lastUse = new Map();
  for (const item of items) {
    const id = item.contentTopic?.ideaId;
    if (id && String(item.scheduledDate || '') > (lastUse.get(id) || '')) lastUse.set(id, item.scheduledDate);
  }
  return listProjectGoalTopics(project)
    .map((topic) => `- [${topic.ideaId}] (${goalName(topic.goalKey)}) ${topic.title} — ${topic.detail}${lastUse.has(topic.ideaId) ? ` · já saiu ${lastUse.get(topic.ideaId)}` : ''}`)
    .join('\n');
}

function postingTimeLines(stats, hours) {
  const lines = stats.map((entry) => `- ${KIND_LABELS[entry.kind] || entry.kind} às ${entry.hour}h: alcance médio ${entry.avgReach} em ${entry.count} post(s) (maior ${entry.best}, menor ${entry.worst})${entry.count < 3 ? ' — em teste' : ''}`);
  if (hours) {
    const open = openHours(hours);
    for (const kind of ['story', 'feed']) {
      const tried = new Set(stats.filter((entry) => entry.kind === kind).map((entry) => entry.hour));
      const untried = open.filter((hour) => !tried.has(hour));
      if (untried.length) lines.push(`- ${KIND_LABELS[kind]}: horas abertas nunca testadas: ${untried.map((hour) => `${hour}h`).join(', ')}`);
    }
  }
  return lines.join('\n') || '(nenhum post medido ainda)';
}
```

- [ ] **Step 6: Rewrite `buildBrainContext`**

Replace the whole function with:

```js
export async function buildBrainContext(projectId, targetDir) {
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  const state = await readBrainState(projectId, targetDir);
  const items = await listProjectContent(projectId, targetDir);
  const usage = buildOfferUsage(project, items);
  const hours = normalizeBusinessHours(project.businessHours);
  const stats = buildPostingTimeStats(await loadProjectMetrics(projectId, targetDir), items);
  const groups = new Map((project.contentStrategy?.offerGroups || []).map((group) => [group.id, `${group.name} [${group.id}]`]));
  const offers = normalizeProjectOffers(project.contentStrategy?.offers || []).map((offer) => offerLine(offer, groups, usage));
  const skipped = state.plan?.plan?.skippedSlotIds || [];
  const plan = state.plan
    ? [
      `Início ${state.plan.startDate}, ${state.plan.days} dia(s), formatos: ${JSON.stringify(state.plan.formats)}`
        + (state.plan.approvedAt ? ` — JÁ APROVADO e gerado em ${state.plan.approvedAt.slice(0, 10)}; para outra semana monte um plano novo.` : ''),
      ...state.plan.plan.dayPlans.flatMap((day) => day.regular.map((slot) => `- ${slot.id} ${slot.scheduledTime} [${slotTag(slot)}]: ${slot.label}`)),
      ...(skipped.length ? [`Sem post por loja fechada: ${skipped.join(', ')}`] : []),
    ].join('\n')
    : '(nenhum)';
  const resolved = state.proposals.filter((proposal) => proposal.status !== 'pending').slice(-5).map((proposal) => {
    const errors = (proposal.results || []).filter((result) => !result.ok).map((result) => result.error);
    return `- ${proposal.summary}: ${PROPOSAL_STATUS_LABELS[proposal.status] || proposal.status}${errors.length ? ` (falhou: ${errors.join('; ')})` : ''}`;
  });
  const weights = Object.entries(project.brandInput?.contentGoalWeights || {}).map(([key, value]) => `${goalName(key)} ${value}%`).join(', ');
  const avoid = [...(project.learnings?.avoid || []), ...(project.segmentLearnings?.avoid || [])].slice(0, 10).map((entry) => `- ${entry}`);
  const now = new Date();
  return [
    `# Projeto ${project.name} (${project.projectId})`,
    `Hoje: ${localDateKey(now)} (${now.toLocaleDateString('pt-BR', { weekday: 'long' })})`,
    '## Caderno do cliente',
    state.notebook.trim() || '(vazio)',
    '## Raio-X da marca',
    brandLines(project),
    '## O que evitar',
    avoid.join('\n') || '(nada registrado)',
    '## Objetivos e percentuais do Raio-X',
    `${weights || '(sem percentuais; o sistema divide por igual)'}. O sistema já divide os horários do plano por esses percentuais: cada horário vem marcado [venda] ou com o objetivo.`,
    '## Banco de assuntos',
    topicBankLines(project, items) || '(vazio — marque objetivos no Raio-X)',
    '## Horário de funcionamento',
    hours ? describeBusinessHours(hours) : '(não configurado — peça ao operador para configurar na aba Empresa / Raio-X)',
    '## Desempenho por horário (Instagram)',
    `Alcance de posts com mais de 24h, por hora em que saíram.\n${postingTimeLines(stats, hours)}`,
    '## Ofertas',
    offers.join('\n') || '(nenhuma)',
    '## Plano atual',
    plan,
    '## Propostas pendentes',
    state.proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => `- ${proposal.id}: ${proposal.summary}`).join('\n') || '(nenhuma)',
    '## Últimas propostas resolvidas',
    resolved.join('\n') || '(nenhuma)',
  ].join('\n\n');
}
```

- [ ] **Step 7: Prompt**

In `brainSystemPrompt`, replace the `plan` command line with:

```js
    `- ${cli} plan ${projectId} '<json>'  → monta ou refaz o plano. JSON: {"startDate":"AAAA-MM-DD","days":N,"formats":[{"channel":"${[...PLAN_CHANNELS].join('|')}","postsPerDay":N,"everyDays":1,"startTime":"HH:MM","intervalMinutes":N}],"slots":[{"id":"<id do horário>","offerIds":["<id>"] ou ["<id1>","<id2>"] para combo (só em horário [venda]),"topicId":"<id do banco>" (só em horário de objetivo),"time":"HH:MM" (muda a hora desse post),"reason":"por quê"}]}. Rode primeiro sem "slots" para ver os ids dos horários e o que o rodízio escolheria; depois rode com as suas escolhas. Horário sem escolha fica com o rodízio automático.`,
```

and, after the line `'- Combo junta só ofertas do mesmo setor. Oferta fora da validade não entra.',` add:

```js
    '- O Raio-X manda na divisão: oferta só entra em horário marcado [venda]. Nos horários de objetivo, escolha no banco de assuntos (topicId) o que faz sentido para a semana, sem repetir o que saiu há pouco.',
    '- Horário de funcionamento: só programe dentro dele. Dias fechados ficam sem post sozinhos. Se não estiver configurado, peça ao operador para configurar no Raio-X.',
    '- Horários: use o desempenho por horário. Hora com menos de 3 posts medidos está em teste. Enquanto houver horas abertas nunca testadas, ponha cerca de 1 em cada 3 posts numa hora nova (com "time") e diga quais são teste. Com 3 ou mais posts medidos, prefira as horas de maior alcance e cite os números. Nunca tire conclusão de um post só.',
    '- Oferta sem preço em post de venda: avise o operador.',
    '- Não repita a mesma oferta em dias seguidos nem na mesma hora. Se faltar oferta, diga isso em vez de repetir.',
```

- [ ] **Step 8: Run the tests**

Run: `node --test tests/content-central-brain.test.js`
Expected: all pass (the older context test still finds offers, notebook and resolved proposals).
Run: `node --test tests/content-central-brain-server.test.js`
Expected: all pass.

- [ ] **Step 9: Commit** (controller)

```powershell
git add src/content-central-brain.js tests/content-central-brain.test.js
git commit -m "feat(content-central): cérebro plans in opening hours and reads the Raio-X, the topic bank and reach by hour"
```

---

### Task 6: "Agenda e geração" warns about posts outside opening hours

**Files:**
- Modify: `src/content-central.js` (`previewContentSchedulePlan`, before `const plan = {` ~line 4024)
- Modify: `content-central-app/src/api/client.ts` (`PlannedContentSchedule`)
- Modify: `content-central-app/src/pages/workspace/GenerateContent.tsx` (~line 593)
- Test: `tests/content-central-business-hours.test.js` (append)

**Depends-on:** Task 1, Task 3 (same file), Task 7 (`client.ts`)

**Interfaces:**
- Consumes: `normalizeBusinessHours`, `isOpenAt`, `isOpenDay` (Task 1).
- Produces: the preview plan gains `businessHoursWarnings: string[]` (empty when hours are not configured).

- [ ] **Step 1: Append the failing test**

Add `previewContentSchedulePlan` to the `../src/content-central.js` import of `tests/content-central-business-hours.test.js` and append:

```js
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
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/content-central-business-hours.test.js`
Expected: FAIL — `businessHoursWarnings` is undefined.

- [ ] **Step 3: Build the warnings**

Extend the business-hours import in `src/content-central.js` to `import { isClockTime, isOpenAt, isOpenDay, normalizeBusinessHours, validateBusinessHours } from './content-central-business-hours.js';`. In `previewContentSchedulePlan`, right before `const plan = {`:

```js
  // "Agenda e geração" keeps the operator's times (only the cérebro plans
  // inside opening hours); it just points out the ones outside.
  const hours = normalizeBusinessHours(project.businessHours);
  const businessHoursWarnings = hours
    ? dayPlans.flatMap((day) => day.regular
      .filter((slot) => !isOpenAt(hours, day.date, slot.scheduledTime))
      .map((slot) => `${day.date} às ${slot.scheduledTime} (${slot.channelLabel}): ${isOpenDay(hours, day.date) ? 'fora do horário de funcionamento' : 'loja fechada nesse dia'}`))
    : [];
```

and add `businessHoursWarnings,` to the `plan` object (after `dayPlans,`).

- [ ] **Step 4: Show it in the Agenda**

In `content-central-app/src/api/client.ts`, add to `PlannedContentSchedule`:

```ts
  businessHoursWarnings?: string[];
```

In `GenerateContent.tsx`, right after `<p className="muted" style={{ marginTop: 0 }}>{plannedSchedule.summary}</p>`:

```tsx
          {plannedSchedule.businessHoursWarnings?.length ? (
            <div className="pill warn" style={{ display: "block", marginBottom: 10 }}>
              Fora do horário de funcionamento do Raio-X: {plannedSchedule.businessHoursWarnings.join(" · ")}
            </div>
          ) : null}
```

- [ ] **Step 5: Run the tests and the build**

Run: `node --test tests/content-central-business-hours.test.js`
Expected: 4 pass.
Run: `cd content-central-app; npx vitest run src/pages/workspace/GenerateContent.test.tsx; npm run build`
Expected: tests pass, build succeeds.

- [ ] **Step 6: Commit** (controller)

```powershell
git add src/content-central.js tests/content-central-business-hours.test.js content-central-app/src/api/client.ts content-central-app/src/pages/workspace/GenerateContent.tsx
git commit -m "feat(content-central-app): Agenda points out posts outside opening hours"
```

---

### Task 7: Opening-hours editor in the Raio-X; closed days hidden in the Cérebro tab

**Files:**
- Create: `content-central-app/src/pages/workspace/BusinessHoursCard.tsx`
- Modify: `content-central-app/src/api/client.ts` (types, `ProjectSummary`, `saveBusinessHours`)
- Modify: `content-central-app/src/pages/workspace/Company.tsx` (import; render after the goal-weights block, before the "Salvar e analisar minha marca" button ~line 775)
- Modify: `content-central-app/src/pages/workspace/Brain.tsx` (~line 263)
- Test: `content-central-app/src/pages/workspace/Company.test.tsx` (append inside `describe("Company", ...)`)

**Depends-on:** Task 1 (route and body shape)

**Interfaces:**
- Consumes: `POST /api/projects/:id/business-hours` with `{ businessHours }` → `{ businessHours }`.
- Produces: `BusinessHours`, `BusinessPeriod` types; `saveBusinessHours(projectId, businessHours)`; `ProjectSummary.businessHours?: BusinessHours | null`.

- [ ] **Step 1: Write the failing test**

Append inside `describe("Company", ...)` in `Company.test.tsx`:

```tsx
  it("saves the opening hours from the Raio-X", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { businessHours: null } },
      { body: projectState() },
    ]);
    renderCompany();

    expect(await screen.findByText("Horário de funcionamento")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Abrir segunda" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar horário" }));

    const calls = (fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls;
    const save = calls.find(([url]) => url === "/api/projects/boss-pizzaria/business-hours");
    expect(save).toBeTruthy();
    const body = JSON.parse(String(save?.[1]?.body));
    expect(body.businessHours.mon).toEqual([{ from: "08:00", to: "18:00" }]);
    expect(body.businessHours.sun).toEqual([]);
  });
```

If `userEvent` is not yet imported in this test file, add `import userEvent from "@testing-library/user-event";`.

- [ ] **Step 2: Run to see it fail**

Run: `cd content-central-app; npx vitest run src/pages/workspace/Company.test.tsx`
Expected: FAIL — "Horário de funcionamento" not found.

- [ ] **Step 3: Client**

In `content-central-app/src/api/client.ts`, add near `BrandInput`:

```ts
export interface BusinessPeriod {
  from: string;
  to: string;
}

export type BusinessHours = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", BusinessPeriod[]>;
```

Add to `ProjectSummary` (after `timezone?: string;`):

```ts
  businessHours?: BusinessHours | null;
```

Add next to `saveBrandInput`:

```ts
export function saveBusinessHours(projectId: string, businessHours: BusinessHours | null): Promise<{ businessHours: BusinessHours | null }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/business-hours`, {
    method: "POST",
    body: JSON.stringify({ businessHours }),
  });
}
```

- [ ] **Step 4: The card**

`content-central-app/src/pages/workspace/BusinessHoursCard.tsx`:

```tsx
import { useState } from "react";
import { saveBusinessHours, type BusinessHours, type BusinessPeriod, type ProjectSummary } from "@/api/client";
import { Button } from "@/components/Button";

type Day = keyof BusinessHours;

const DAYS: Array<[Day, string]> = [
  ["mon", "segunda"], ["tue", "terça"], ["wed", "quarta"], ["thu", "quinta"], ["fri", "sexta"], ["sat", "sábado"], ["sun", "domingo"],
];
const CLOSED: BusinessHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

interface Props {
  project: ProjectSummary;
  refreshProject: () => Promise<void>;
}

// The cérebro only plans posts while the shop is open; "Agenda e geração"
// only warns. Up to two periods a day (e.g. a lunch break).
export function BusinessHoursCard({ project, refreshProject }: Props) {
  const [hours, setHours] = useState<BusinessHours>(project.businessHours || CLOSED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setDay(day: Day, periods: BusinessPeriod[]) {
    setSaved(false);
    setHours((current) => ({ ...current, [day]: periods }));
  }

  function setPeriod(day: Day, index: number, field: keyof BusinessPeriod, value: string) {
    setDay(day, hours[day].map((period, i) => (i === index ? { ...period, [field]: value } : period)));
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveBusinessHours(project.projectId, hours);
      await refreshProject();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-card" style={{ marginTop: 14 }}>
      <b>Horário de funcionamento</b>
      <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
        O cérebro só programa posts nos horários em que a loja está aberta. Dia sem período fica fechado.
        {project.businessHours ? null : " Ainda não configurado."}
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {DAYS.map(([day, label]) => (
          <div key={day} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ width: 72, textTransform: "capitalize" }}>{label}</span>
            {hours[day].length === 0 ? <span className="muted">Fechado</span> : null}
            {hours[day].map((period, index) => (
              <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input type="time" aria-label={`${label}, período ${index + 1}, abre`} value={period.from} onChange={(e) => setPeriod(day, index, "from", e.target.value)} />
                <span className="muted">às</span>
                <input type="time" aria-label={`${label}, período ${index + 1}, fecha`} value={period.to} onChange={(e) => setPeriod(day, index, "to", e.target.value)} />
                <Button type="button" variant="secondary" aria-label={`Tirar período ${index + 1} de ${label}`} onClick={() => setDay(day, hours[day].filter((_, i) => i !== index))}>
                  ×
                </Button>
              </span>
            ))}
            {hours[day].length < 2 ? (
              <Button
                type="button"
                variant="secondary"
                aria-label={hours[day].length ? `Mais um período na ${label}` : `Abrir ${label}`}
                onClick={() => setDay(day, [...hours[day], hours[day].length ? { from: "13:00", to: "18:00" } : { from: "08:00", to: "18:00" }])}
              >
                {hours[day].length ? "+ período" : "Abrir"}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
      {saved ? <p className="muted" style={{ marginTop: 10 }}>Horário salvo.</p> : null}
      <Button type="button" style={{ marginTop: 10 }} disabled={busy} onClick={() => void handleSave()}>
        Salvar horário
      </Button>
    </div>
  );
}
```

Check `@/components/Button` forwards `aria-label` and `style` (read the component); if it does not, wrap the label text in a visually-hidden span instead and adjust the test's button names to the visible text.

- [ ] **Step 5: Render it in the Raio-X**

In `Company.tsx`, import `import { BusinessHoursCard } from "./BusinessHoursCard";` and render

```tsx
        <BusinessHoursCard project={project} refreshProject={refreshProject} />
```

right after the goal-weights block's closing `) : null}` and before the "Salvar e analisar minha marca" `<Button`.

- [ ] **Step 6: Hide closed days in the Cérebro tab**

In `Brain.tsx`, change `{stored.plan.dayPlans.map((day) => (` to

```tsx
                {stored.plan.dayPlans.filter((day) => day.regular.length).map((day) => (
```

- [ ] **Step 7: Run the tests and the build**

Run: `cd content-central-app; npx vitest run src/pages/workspace/Company.test.tsx src/pages/workspace/Brain.test.tsx; npm run build`
Expected: pass; build succeeds.

- [ ] **Step 8: Commit** (controller)

```powershell
git add content-central-app/src/pages/workspace/BusinessHoursCard.tsx content-central-app/src/api/client.ts content-central-app/src/pages/workspace/Company.tsx content-central-app/src/pages/workspace/Brain.tsx content-central-app/src/pages/workspace/Company.test.tsx
git commit -m "feat(content-central-app): opening hours editor in the Raio-X"
```

---

### Task 8: Verify end to end (controller)

**Depends-on:** Tasks 1–7

- [ ] **Step 1: Full server suite**

Run: `node --test tests/` (from the worktree root, ~2.5 min).
Expected: all pass except the known Windows ENOTEMPTY flake (`content central server serves only supported API channels`), which also fails on base `3cb8807`.

- [ ] **Step 2: Full app suite and build**

Run: `cd content-central-app; npm test; npm run build`
Expected: pass; build succeeds (the bench serves `content-central-app/dist`).

- [ ] **Step 3: Restart the bench and try it live**

Stop the bench on port 3398 and start it again from the worktree (same `bench.mjs` as before). In the Mercado Carvalho copy: set the hours (mon–fri 07:00–11:00 and 13:00–20:00, sat 07:00–12:00, sun closed) in Empresa / Raio-X, then ask the cérebro for a week of 2 stories and 1 feed a day. Check:
- no post on Sunday, none at 11:00–13:00 or after 20:00;
- the goal slots keep their objective and name a topic from the bank;
- some posts are marked as time tests;
- the reply cites the 13:00 story reach.

- [ ] **Step 4: Spec and memory**

Add an "Implemented" note to the spec, commit with `git add -f`, run `graphify update .`, and update the memory file `content_central_cerebro.md`.
