# Cérebro: plano contratado, feriado em dia fechado, avisos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cérebro plans to the client's contracted cadence, keeps holiday posts on closed days, gets server-side warnings for the rules it ignored, and its CLI starts fast.

**Architecture:** A dependency-free goals module serves the CLI. A contract module validates/describes `project.contractedPlan` and checks a plan against it. Plan slot choices gain `skip`. `saveBrainPlan` drops skipped slots, keeps closed-day extras, enforces the contract and stores `plan.warnings`.

**Tech Stack:** Node ESM, `node:test`; React + Vitest in `content-central-app/`.

Spec: `docs/superpowers/specs/2026-10-04-cerebro-plano-contratado-design.md`.

## Global Constraints

- Work only in the worktree `C:\Users\jucic\OneDrive\Documentos\PROJETO\OPENSQUAD\.claude\worktrees\cerebro`, branch `cerebro`.
- Git from PowerShell, not Bash. `docs/` needs `git add -f`. Implementers do not commit; the controller commits per task.
- Never touch production (port 3333) or the main checkout's `_opensquad` data.
- Operator/cérebro-facing strings in Portuguese; code comments in English, matching the surrounding style.
- Server tests: `node --test <file>` from the worktree root; never `--test-name-pattern` after the file argument.
- App: `cd content-central-app; npx vitest run <file> --testTimeout=20000`; type errors only show in `npm run build`.
- Dates "AAAA-MM-DD"; times "HH:MM" local.

## Waves

| Wave | Tasks |
|---|---|
| 1 | Task 1 |
| 2 | Task 2 |
| 3 | Task 3, Task 5 (disjoint: `content-central.js`+plan-choices test vs `content-central-app/`) |
| 4 | Task 4 |
| 5 | Task 6 (controller verification) |

---

### Task 1: Light goals module for a fast cérebro CLI

**Files:**
- Create: `src/content-central-goals.js`
- Modify: `src/content-central.js` (the `export const CONTENT_GOAL_LABELS = {...}` block ~line 135)
- Modify: `src/content-central-brain.js` (remove local `goalName` and `slotTag`, import them)
- Modify: `bin/cerebro.js` (import)
- Test: `tests/content-central-goals.test.js` (new)

**Depends-on:** none

**Interfaces:**
- Produces: `src/content-central-goals.js` exports `CONTENT_GOAL_LABELS`, `goalName(key)`, `slotTag(slot)` and imports nothing. `src/content-central.js` still exports `CONTENT_GOAL_LABELS` (re-export), so existing importers keep working.

- [ ] **Step 1: Failing test** — `tests/content-central-goals.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTENT_GOAL_LABELS, goalName, slotTag } from '../src/content-central-goals.js';
import { CONTENT_GOAL_LABELS as FROM_CENTRAL } from '../src/content-central.js';

test('goal names and slot tags read the same everywhere', () => {
  assert.equal(goalName('sales'), 'Venda');
  assert.equal(goalName('authority'), 'Gerar autoridade');
  assert.equal(slotTag({ source: 'offer' }), 'venda');
  assert.equal(slotTag({ source: 'goal', goalKey: 'relationship' }), 'Criar relacionamento');
  assert.equal(slotTag({ source: 'special_date' }), 'special_date');
  assert.equal(FROM_CENTRAL, CONTENT_GOAL_LABELS);
});

// The CLI runs on every cérebro action; importing content-central.js (and
// jimp through it) cost ~1.4 s per call.
test('the cérebro CLI imports only the dependency-free goals module', async () => {
  const cli = await readFile(new URL('../bin/cerebro.js', import.meta.url), 'utf-8');
  assert.deepEqual([...cli.matchAll(/from '([^']+)'/g)].map((match) => match[1]), ['../src/content-central-goals.js']);
  const goals = await readFile(new URL('../src/content-central-goals.js', import.meta.url), 'utf-8');
  assert.doesNotMatch(goals, /^import /m);
});
```

- [ ] **Step 2: Run** `node --test tests/content-central-goals.test.js` — expect FAIL (module missing).

- [ ] **Step 3: Create** `src/content-central-goals.js`:

```js
// Goal names shared by the server and the cérebro CLI (bin/cerebro.js). Kept
// free of imports: the CLI runs on every cérebro action and loading
// content-central.js (and jimp through it) cost ~1.4 s per call.
export const CONTENT_GOAL_LABELS = {
  // <move the exact entries of the existing CONTENT_GOAL_LABELS object here, unchanged>
};

export const goalName = (key) => (key === 'sales' ? 'Venda' : CONTENT_GOAL_LABELS[key] || key);

export function slotTag(slot) {
  if (slot.source === 'offer') return 'venda';
  if (slot.source === 'goal') return goalName(slot.goalKey);
  return slot.source || 'assunto';
}
```

Move the twelve entries (`sell_products` … `education`) verbatim from `src/content-central.js`.

- [ ] **Step 4: Rewire**
  - `src/content-central.js`: delete the `export const CONTENT_GOAL_LABELS = { ... };` block and add near the other imports:
    ```js
    import { CONTENT_GOAL_LABELS } from './content-central-goals.js';
    ```
    and right after the imports: `export { CONTENT_GOAL_LABELS };`
  - `src/content-central-brain.js`: remove `CONTENT_GOAL_LABELS` from the `./content-central.js` import, delete the local `const goalName = ...` and `export function slotTag(slot) {...}`, and add `import { goalName, slotTag } from './content-central-goals.js';`. Keep `export { slotTag };` only if a test imports `slotTag` from the brain module (grep `tests/`); otherwise don't.
  - `bin/cerebro.js`: replace the import and its comment with
    ```js
    import { slotTag } from '../src/content-central-goals.js';
    ```

- [ ] **Step 5: Run** `node --test tests/content-central-goals.test.js tests/content-central-brain.test.js tests/content-central-brain-server.test.js tests/content-central-plan-choices.test.js` — all pass.

- [ ] **Step 6: Commit** (controller): `perf(content-central): cérebro CLI loads only a light goals module`

---

### Task 2: Plano contratado — data, check, save, list

**Files:**
- Create: `src/content-central-contract.js`
- Modify: `src/content-central.js` (new `updateProjectContractedPlan` next to `updateProjectBusinessHours`; `toProjectSummary`)
- Modify: `src/content-central-server.js` (route next to `business-hours`)
- Test: `tests/content-central-contract.test.js` (new)

**Depends-on:** Task 1 (same file `content-central.js`)

**Interfaces:**
- Consumes: `isOpenDay(hours, dateKey)` from `./content-central-business-hours.js` (`hours === null` → every day open).
- Produces (`src/content-central-contract.js`):
  - `STORY_CHANNELS = ['instagram_story','facebook_story','whatsapp_status']`, `FEED_CHANNELS = ['instagram_feed','facebook_feed']`
  - `validateContractedPlan(input): ContractedPlan | null` (throws Portuguese message), `normalizeContractedPlan(value)` (lenient), `describeContractedPlan(plan): string`
  - `contractProblems(plan, contract, hours): string[]` — `plan` has `dayPlans[].{date, regular[].channel}` (closed days already emptied)
  - `ContractedPlan = { storiesPerDay, feedsPerWeek, storyChannels: string[], feedChannels: string[], flyersPerMonth }`
- Produces: `updateProjectContractedPlan(projectId, plan, targetDir, now?)`; summaries carry `contractedPlan`; `POST /api/projects/:id/contracted-plan` `{ contractedPlan }` → `200 { contractedPlan }` | `400 { error }`.

- [ ] **Step 1: Failing tests** — `tests/content-central-contract.test.js`:

```js
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
```

- [ ] **Step 2: Run** `node --test tests/content-central-contract.test.js` — expect FAIL (module missing).

- [ ] **Step 3: Create** `src/content-central-contract.js`:

```js
// What the client bought, filled in by hand per project
// (project.contractedPlan): stories a day, feeds a week, the channels each
// goes to (a story is one art on all of them) and how many encartes a month
// the operator makes by hand. The cérebro plans to it; saveBrainPlan checks.
import { isOpenDay } from './content-central-business-hours.js';

export const STORY_CHANNELS = ['instagram_story', 'facebook_story', 'whatsapp_status'];
export const FEED_CHANNELS = ['instagram_feed', 'facebook_feed'];
const CHANNEL_NAMES = {
  instagram_story: 'Instagram', facebook_story: 'Facebook', whatsapp_status: 'Status do WhatsApp',
  instagram_feed: 'Instagram', facebook_feed: 'Facebook',
};

function count(value, label, max) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new Error(`${label}: use um número inteiro de 0 a ${max}.`);
  return number;
}

function channels(value, allowed, label) {
  const list = Array.isArray(value) ? value.map(String) : [];
  const unknown = list.find((channel) => !allowed.includes(channel));
  if (unknown) throw new Error(`${label}: canal desconhecido "${unknown}".`);
  return allowed.filter((channel) => list.includes(channel));
}

// Strict: the operator's form gets the reason. All counts at zero reads as
// not configured.
export function validateContractedPlan(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Plano contratado inválido.');
  const plan = {
    storiesPerDay: count(input.storiesPerDay, 'Stories por dia', 10),
    feedsPerWeek: count(input.feedsPerWeek, 'Feed por semana', 14),
    storyChannels: channels(input.storyChannels, STORY_CHANNELS, 'Canais do story'),
    feedChannels: channels(input.feedChannels, FEED_CHANNELS, 'Canais do feed'),
    flyersPerMonth: count(input.flyersPerMonth, 'Encartes por mês', 31),
  };
  if (plan.storiesPerDay && !plan.storyChannels.length) throw new Error('Escolha em quais canais o story sai.');
  if (plan.feedsPerWeek && !plan.feedChannels.length) throw new Error('Escolha em quais canais o feed sai.');
  if (!plan.storiesPerDay && !plan.feedsPerWeek && !plan.flyersPerMonth) return null;
  return plan;
}

export function normalizeContractedPlan(value) {
  try {
    return value ? validateContractedPlan(value) : null;
  } catch {
    return null;
  }
}

const names = (list) => list.map((channel) => CHANNEL_NAMES[channel]).join(', ');

export function describeContractedPlan(plan) {
  if (!plan) return '(não configurado)';
  return [
    `- Stories por dia: ${plan.storiesPerDay}${plan.storiesPerDay ? ` (mesma arte em: ${names(plan.storyChannels)})` : ''}`,
    `- Feed por semana: ${plan.feedsPerWeek}${plan.feedsPerWeek ? ` (em: ${names(plan.feedChannels)})` : ''}`,
    `- Encartes por mês: ${plan.flyersPerMonth}${plan.flyersPerMonth ? ' (feitos à mão pelo operador; você não gera, só lembra)' : ''}`,
  ].join('\n');
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Monday of the date's week.
function weekStart(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return addDays(dateKey, -((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7));
}

// Every way the plan departs from the contract, [] when it matches. Closed
// days are expected empty (saveBrainPlan empties them first). Feeds are
// counted per Monday–Sunday week: never more than contracted, and exactly
// that many when the plan covers every open day of the week.
export function contractProblems(plan, contract, hours) {
  if (!contract) return [];
  const problems = [];
  const storyChannels = contract.storiesPerDay ? contract.storyChannels : [];
  const feedChannels = contract.feedsPerWeek ? contract.feedChannels : [];
  const used = new Set(plan.dayPlans.flatMap((day) => day.regular.map((slot) => slot.channel)));
  for (const channel of used) if (![...storyChannels, ...feedChannels].includes(channel)) problems.push(`o canal ${channel} não está no plano contratado`);
  // Feeds are weekly, so a short plan may rightly have none; the week count below covers them.
  for (const channel of storyChannels) if (!used.has(channel)) problems.push(`falta o canal ${channel} do plano contratado`);
  for (const day of plan.dayPlans.filter((entry) => isOpenDay(hours, entry.date))) {
    for (const channel of storyChannels) {
      const posts = day.regular.filter((slot) => slot.channel === channel).length;
      if (posts !== contract.storiesPerDay) problems.push(`${day.date}: ${posts} post(s) em ${channel}, o contratado é ${contract.storiesPerDay} por dia`);
    }
  }
  if (feedChannels.length) {
    const covered = new Set(plan.dayPlans.map((day) => day.date));
    for (const start of new Set(plan.dayPlans.map((day) => weekStart(day.date)))) {
      const weekDays = Array.from({ length: 7 }, (_, index) => addDays(start, index));
      const coversWeek = weekDays.filter((date) => isOpenDay(hours, date)).every((date) => covered.has(date));
      for (const channel of feedChannels) {
        const feeds = plan.dayPlans.filter((day) => weekDays.includes(day.date)).flatMap((day) => day.regular).filter((slot) => slot.channel === channel).length;
        if (feeds > contract.feedsPerWeek || (coversWeek && feeds < contract.feedsPerWeek)) {
          problems.push(`semana de ${start}: ${feeds} feed(s) em ${channel}, o contratado é ${contract.feedsPerWeek} por semana`);
        }
      }
    }
  }
  return problems;
}
```

- [ ] **Step 4: Save and list** — in `src/content-central.js` import `{ normalizeContractedPlan, validateContractedPlan } from './content-central-contract.js'`; right after `updateProjectBusinessHours` add:

```js
export async function updateProjectContractedPlan(projectId, plan, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const contractedPlan = validateContractedPlan(plan);
    if (contractedPlan) project.contractedPlan = contractedPlan;
    else delete project.contractedPlan;
    project.updatedAt = now.toISOString();
    await writeJson(paths.projectPath, project);
    return project;
  });
}
```

In `toProjectSummary`, after `businessHours: ...,` add `contractedPlan: normalizeContractedPlan(project.contractedPlan),`.

- [ ] **Step 5: Route** — in `src/content-central-server.js`, import `updateProjectContractedPlan` and add right after the `business-hours` block:

```js
  if (parts.length === 4 && parts[3] === 'contracted-plan') {
    const body = await readBody(req);
    try {
      const project = await updateProjectContractedPlan(projectId, body.contractedPlan ?? null, targetDir);
      return sendJson(res, 200, { contractedPlan: project.contractedPlan ?? null });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }
```

- [ ] **Step 6: Run** `node --test tests/content-central-contract.test.js tests/content-central-business-hours.test.js` — all pass.

- [ ] **Step 7: Commit** (controller): `feat(content-central): contracted plan per client — stories a day, feeds a week, channels, encartes`

---

### Task 3: A plan slot can be skipped

**Files:**
- Modify: `src/content-central.js` (`applyPlanSlotChoices`)
- Test: `tests/content-central-plan-choices.test.js` (append)

**Depends-on:** Task 2 (same file)

**Interfaces:**
- Produces: a slot choice `{ id, skip: true }` marks that slot and every slot sharing its art with `skip: true` (other choices for it are ignored). `saveBrainPlan` (Task 4) moves them into `skippedSlotIds`.

- [ ] **Step 1: Failing test** (append; `STORY_AND_REELS`, `withTempProject` already exist in the file):

```js
test('skipping a slot skips every channel that shares its art', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pula-par', name: 'Pula Par' }, dir);
    await saveProjectOffer('pula-par', { name: 'A', type: 'offer' }, dir);
    const preview = await previewContentSchedulePlan('pula-par', { days: 2, startDate: '2026-10-05', formats: STORY_AND_REELS }, dir);

    const plan = await applyPlanSlotChoices('pula-par', preview, [{ id: '2026-10-05-instagram_story-01', skip: true }], dir);

    assert.deepEqual(plan.dayPlans[0].regular.map((slot) => slot.skip), [true, true]);
    assert.deepEqual(plan.dayPlans[1].regular.map((slot) => slot.skip), [undefined, undefined]);
  });
});
```

- [ ] **Step 2: Run** `node --test tests/content-central-plan-choices.test.js` — the new test FAILS.

- [ ] **Step 3: Implement** — in `applyPlanSlotChoices`, after `topicBySlot` is built:

```js
  const skipBySlot = resolveGroupChoice(slots, (id) => (byId.get(id)?.skip === true ? true : undefined),
    'canais que dividem a arte são pulados juntos.');
```

and at the top of the inner `for (const slot of day.regular)` loop body:

```js
      // Skipped (e.g. the days a weekly feed doesn't go out): saveBrainPlan
      // moves it to skippedSlotIds; nothing else chosen for it matters.
      if (skipBySlot.has(slot.id)) { regular.push({ ...slot, skip: true }); continue; }
```

Also exclude skipped slots from the offer/topic source checks: in the two `for (const id of pinsBySlot.keys())` / `topicBySlot.keys()` loops, `continue` when `skipBySlot.has(id)`.

- [ ] **Step 4: Run** `node --test tests/content-central-plan-choices.test.js tests/content-central-offer-rotation.test.js` — all pass.

- [ ] **Step 5: Commit** (controller): `feat(content-central): a plan slot can be skipped with the channels sharing its art`

---

### Task 4: Brain — skip, holiday extras, contract check, warnings, context, prompt, CLI

**Files:**
- Modify: `src/content-central-brain.js`
- Modify: `bin/cerebro.js`
- Test: `tests/content-central-brain.test.js` (append), `tests/content-central-brain-server.test.js` (extend the CLI test)

**Depends-on:** Task 1, Task 2, Task 3

**Interfaces:**
- Consumes: `normalizeContractedPlan`, `describeContractedPlan`, `contractProblems` (Task 2); slots with `skip: true` (Task 3); `goalName`, `slotTag` from `./content-central-goals.js` (Task 1); `updateProjectContractedPlan` (tests).
- Produces: stored plans carry `skippedSlotIds` (closed days + skipped slots, always an array) and `warnings: string[]`; context gains `## Plano contratado`; `cerebro plan` prints warnings.

- [ ] **Step 1: Failing tests** — append to `tests/content-central-brain.test.js` (add `updateProjectContractedPlan` and `generateContentSchedulePlan` to the `../src/content-central.js` import if missing; `WEEK_HOURS`, `STORY`, `withProject` exist):

```js
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
```

Also extend the existing CLI test in `tests/content-central-brain-server.test.js` (the one that runs `bin/cerebro.js plan` against a test server) so a plan with a price-less offer prints a line starting `Aviso:`; follow that test's existing setup.

- [ ] **Step 2: Run** `node --test tests/content-central-brain.test.js` — new tests FAIL.

- [ ] **Step 3: Imports** in `src/content-central-brain.js`:

```js
import { contractProblems, describeContractedPlan, normalizeContractedPlan } from './content-central-contract.js';
```

- [ ] **Step 4: Replace `fitPlanToBusinessHours`** with:

```js
// A plan's formats repeat every day, so closed days and the slots the cérebro
// skips ("skip", e.g. the days a weekly feed doesn't go out) leave the plan
// and are listed in skippedSlotIds, which generation skips (after their
// rotation turn, so the other slots keep what the preview showed). A slot at
// a closed hour of an open day is the cérebro's to move with "time". A
// closed day keeps its holiday / commemorative post; an extra at a closed
// hour of an open day moves to the day's opening.
function fitPlan(plan, hours) {
  const skippedSlotIds = [];
  const outside = [];
  const dayPlans = plan.dayPlans.map((day) => {
    const closed = !isOpenDay(hours, day.date);
    const regular = day.regular.filter((slot) => {
      if (closed || slot.skip) { skippedSlotIds.push(slot.id); return false; }
      return true;
    });
    if (closed || !hours) return { ...day, regular };
    outside.push(...regular.filter((slot) => !isOpenAt(hours, day.date, slot.scheduledTime)).map((slot) => `${slot.id} (${slot.scheduledTime})`));
    const extras = day.extras.map((extra) => (isOpenAt(hours, day.date, extra.scheduledTime) ? extra : { ...extra, scheduledTime: firstOpenTime(hours, day.date) }));
    return { ...day, regular, extras };
  });
  if (outside.length) throw new Error(`Fora do horário de funcionamento: ${outside.join(', ')}. Mova esses horários com "time" ou mude o startTime do formato.`);
  return {
    ...plan,
    dayPlans,
    skippedSlotIds,
    regularCount: dayPlans.reduce((sum, day) => sum + day.regular.length, 0),
    extraCount: dayPlans.reduce((sum, day) => sum + day.extras.length, 0),
  };
}
```

(`isOpenDay(null, …)` is true, so without hours only skips apply.) The existing test 'without opening hours nothing is dropped' asserted `skippedSlotIds === undefined`; change it to `assert.deepEqual(stored.plan.skippedSlotIds, [])` — the field is now always an array.

- [ ] **Step 5: Warnings** — add above `saveBrainPlan`:

```js
const KIND_OF_CHANNEL = {
  instagram_story: 'story', facebook_story: 'story', whatsapp_status: 'story', instagram_feed: 'feed', facebook_feed: 'feed', instagram_reels: 'reels',
};

function nextDay(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

// What the cérebro must fix or explain to the operator. With few products a
// repeat is normal, so a consecutive-day repeat only warns while some active
// offer valid on both days went unused on both.
function planWarnings(plan, project, stats, hours) {
  const warnings = new Set();
  const offers = normalizeProjectOffers(project.contentStrategy?.offers || []);
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const days = plan.dayPlans.filter((day) => day.regular.length);
  const offersOn = (day) => new Set(day.regular.flatMap((slot) => slot.offerIds || []));
  for (const day of days) {
    for (const slot of day.regular) {
      for (const id of slot.offerIds || []) {
        if (byId.has(id) && !byId.get(id).price) warnings.add(`${byId.get(id).name} está sem preço no post de ${day.date} às ${slot.scheduledTime}.`);
      }
    }
  }
  for (let index = 1; index < days.length; index += 1) {
    const [before, after] = [days[index - 1], days[index]];
    if (nextDay(before.date) !== after.date) continue;
    const used = new Set([...offersOn(before), ...offersOn(after)]);
    const idle = offers
      .filter((offer) => offer.active && !used.has(offer.id)
        && (!offer.validFrom || offer.validFrom <= before.date) && (!offer.validUntil || offer.validUntil >= after.date))
      .map((offer) => offer.name);
    if (!idle.length) continue;
    for (const id of offersOn(before)) {
      if (offersOn(after).has(id) && byId.has(id)) {
        warnings.add(`${byId.get(id).name} sai em dias seguidos (${before.date} e ${after.date}) e há ofertas sem usar nesses dias: ${idle.slice(0, 5).join(', ')}.`);
      }
    }
  }
  if (hours) {
    const open = openHours(hours);
    for (const kind of ['story', 'feed']) {
      const planned = days.flatMap((day) => day.regular).filter((slot) => KIND_OF_CHANNEL[slot.channel] === kind).map((slot) => Number(slot.scheduledTime.slice(0, 2)));
      if (!planned.length) continue;
      const tried = new Set(stats.filter((entry) => entry.kind === kind).map((entry) => entry.hour));
      const untried = open.filter((hour) => !tried.has(hour));
      if (untried.length && !planned.some((hour) => untried.includes(hour))) {
        warnings.add(`Nenhum ${kind} em horário novo; horas abertas nunca testadas: ${untried.map((hour) => `${hour}h`).join(', ')}.`);
      }
    }
  }
  return [...warnings];
}
```

- [ ] **Step 6: Wire `saveBrainPlan`** — replace its last lines (from `const { summary, businessHoursWarnings, ...chosen } = ...` through `return stored;`) with:

```js
  // summary and businessHoursWarnings describe the preview before the choices
  // and the trimming, so they would be stale here; nothing reads them.
  const { summary, businessHoursWarnings, ...chosen } = await applyPlanSlotChoices(projectId, preview, slots || [], targetDir);
  const hours = normalizeBusinessHours(project.businessHours);
  const fitted = fitPlan(chosen, hours);
  const problems = contractProblems(fitted, normalizeContractedPlan(project.contractedPlan), hours);
  if (problems.length) {
    throw new Error(`O plano não bate com o plano contratado: ${problems.join('; ')}. Ajuste os formatos ou pule horários com "skip".`);
  }
  const items = await listProjectContent(projectId, targetDir);
  const stats = buildPostingTimeStats(await loadProjectMetrics(projectId, targetDir), items);
  const plan = { ...fitted, warnings: planWarnings(fitted, project, stats, hours) };
  const stored = { startDate: plan.startDate, days: plan.days, formats: plan.formats, plan, approvedAt: null, updatedAt: new Date().toISOString() };
  await write(brainPaths(targetDir, projectId).planPath, stored);
  return stored;
```

- [ ] **Step 7: Context** — in `buildBrainContext`:
  - after the `## Horário de funcionamento` pair, add:
    ```js
    '## Plano contratado',
    describeContractedPlan(normalizeContractedPlan(project.contractedPlan)) + (project.contractedPlan ? '' : '\nPeça ao operador para preencher na aba Empresa / Raio-X.'),
    ```
  - change the skipped line to `Sem post (loja fechada ou pulado): ${skipped.join(', ')}` and after it add `...(state.plan?.plan?.warnings?.length ? [`Avisos do plano:\n${state.plan.plan.warnings.map((warning) => `- ${warning}`).join('\n')}`] : []),`

- [ ] **Step 8: Prompt** — in `brainSystemPrompt`:
  - in the `plan` command line, after `"time":"HH:MM" (muda a hora desse post),` insert `"skip":true (pula esse post),`; and after `Horário sem escolha fica com o rodízio automático.` append ` Depois de salvar, o comando mostra avisos: corrija cada um ou explique ao operador por que fica assim.`
  - replace the two rules `'- Oferta sem preço em post de venda: avise o operador.'` and `'- Não repita a mesma oferta em dias seguidos nem na mesma hora. Se faltar oferta, diga isso em vez de repetir.'` with:
    ```js
    '- Plano contratado é a regra fixa: monte exatamente os stories por dia (em todos os canais do story, mesma arte) e os feeds por semana. Para feed por semana, use o formato de feed diário e pule ("skip": true) os dias sem feed, escolhendo o melhor dia. O sistema recusa plano fora do contratado. Encartes são feitos à mão pelo operador: você não gera, só lembra quando houver.',
    '- Com poucas ofertas, repetir é normal: siga a sequência do rodízio (a que está há mais tempo sem sair vem primeiro) e só repita em dias seguidos quando não houver outra livre. Oferta sem setor não forma combo: se houver várias sem setor, proponha o setor delas para variar a semana com combos.',
    '- Oferta sem preço em post de venda: avise o operador.',
    ```

- [ ] **Step 9: CLI** — in `bin/cerebro.js`, change the skipped line to `Sem post (loja fechada ou pulado): …` and before `console.log('Plano salvo; ...')` add:

```js
    for (const warning of stored.plan.warnings || []) console.log(`Aviso: ${warning}`);
```

- [ ] **Step 10: Run** `node --test tests/content-central-brain.test.js tests/content-central-brain-server.test.js tests/content-central-goals.test.js` — all pass.

- [ ] **Step 11: Commit** (controller): `feat(content-central): cérebro follows the contracted plan, keeps holiday posts and gets plan warnings`

---

### Task 5: "Plano contratado" card in the Raio-X

**Files:**
- Create: `content-central-app/src/pages/workspace/ContractedPlanCard.tsx`
- Modify: `content-central-app/src/api/client.ts`
- Modify: `content-central-app/src/pages/workspace/Company.tsx` (render right after `<BusinessHoursCard ... />`)
- Test: `content-central-app/src/pages/workspace/Company.test.tsx` (append inside `describe("Company")`)

**Depends-on:** Task 2 (route and body shape)

**Interfaces:**
- Consumes: `POST /api/projects/:id/contracted-plan` `{ contractedPlan }` → `{ contractedPlan }` | `400 { error }`.
- Produces: `ContractedPlan` type, `saveContractedPlan(projectId, plan)`, `ProjectSummary.contractedPlan?: ContractedPlan | null`.

- [ ] **Step 1: Failing test**:

```tsx
  it("saves the contracted plan from the Raio-X", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { contractedPlan: null } },
      { body: projectState() },
    ]);
    renderCompany();

    expect(await screen.findByText("Plano contratado")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Stories por dia"));
    await userEvent.type(screen.getByLabelText("Stories por dia"), "2");
    await userEvent.clear(screen.getByLabelText("Feed por semana"));
    await userEvent.type(screen.getByLabelText("Feed por semana"), "1");
    await userEvent.click(screen.getByRole("checkbox", { name: "Story no Status do WhatsApp" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar plano contratado" }));

    const calls = (fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls;
    const save = calls.find(([url]) => url === "/api/projects/boss-pizzaria/contracted-plan");
    expect(save).toBeTruthy();
    expect(JSON.parse(String(save?.[1]?.body)).contractedPlan).toEqual({
      storiesPerDay: 2,
      feedsPerWeek: 1,
      storyChannels: ["instagram_story", "facebook_story", "whatsapp_status"],
      feedChannels: ["instagram_feed", "facebook_feed"],
      flyersPerMonth: 0,
    });
  });
```

(The card starts unconfigured projects with Instagram and Facebook checked for both story and feed, WhatsApp Status unchecked.)

- [ ] **Step 2: Run** `cd content-central-app; npx vitest run src/pages/workspace/Company.test.tsx --testTimeout=20000` — FAIL.

- [ ] **Step 3: Client** — in `client.ts` near `BusinessHours`:

```ts
export interface ContractedPlan {
  storiesPerDay: number;
  feedsPerWeek: number;
  storyChannels: string[];
  feedChannels: string[];
  flyersPerMonth: number;
}

export function saveContractedPlan(projectId: string, contractedPlan: ContractedPlan | null): Promise<{ contractedPlan: ContractedPlan | null }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/contracted-plan`, {
    method: "POST",
    body: JSON.stringify({ contractedPlan }),
  });
}
```

and in `ProjectSummary` after `businessHours?`: `contractedPlan?: ContractedPlan | null;`

- [ ] **Step 4: Card** — `ContractedPlanCard.tsx`:

```tsx
import { useState } from "react";
import { saveContractedPlan, type ContractedPlan, type ProjectSummary } from "@/api/client";
import { Button } from "@/components/Button";

const STORY_CHANNELS: Array<[string, string]> = [["instagram_story", "Instagram"], ["facebook_story", "Facebook"], ["whatsapp_status", "Status do WhatsApp"]];
const FEED_CHANNELS: Array<[string, string]> = [["instagram_feed", "Instagram"], ["facebook_feed", "Facebook"]];
const START: ContractedPlan = {
  storiesPerDay: 0, feedsPerWeek: 0, storyChannels: ["instagram_story", "facebook_story"], feedChannels: ["instagram_feed", "facebook_feed"], flyersPerMonth: 0,
};

interface Props {
  project: ProjectSummary;
  refreshProject: () => Promise<void>;
}

// What the client bought, filled in by hand. The cérebro plans exactly this;
// a story is one art on every channel checked.
export function ContractedPlanCard({ project, refreshProject }: Props) {
  const [plan, setPlan] = useState<ContractedPlan>(project.contractedPlan || START);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(next: Partial<ContractedPlan>) {
    setSaved(false);
    setPlan((current) => ({ ...current, ...next }));
  }

  function toggle(field: "storyChannels" | "feedChannels", channel: string, order: Array<[string, string]>) {
    const has = plan[field].includes(channel);
    const set = new Set(has ? plan[field].filter((entry) => entry !== channel) : [...plan[field], channel]);
    update({ [field]: order.map(([id]) => id).filter((id) => set.has(id)) });
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveContractedPlan(project.projectId, plan);
      await refreshProject();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const number = (label: string, field: "storiesPerDay" | "feedsPerWeek" | "flyersPerMonth", max: number) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 140 }}>{label}</span>
      <input type="number" aria-label={label} min={0} max={max} value={plan[field]} onChange={(e) => update({ [field]: Number(e.target.value) || 0 })} style={{ width: 80 }} />
    </label>
  );

  return (
    <div className="field-card" style={{ marginTop: 14 }}>
      <b>Plano contratado</b>
      <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
        O que o cliente comprou. O cérebro monta a semana exatamente assim. Encartes são feitos à mão: ele só lembra.
        {project.contractedPlan ? null : " Ainda não configurado."}
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {number("Stories por dia", "storiesPerDay", 10)}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {STORY_CHANNELS.map(([id, name]) => (
            <label key={id}>
              <input type="checkbox" aria-label={`Story no ${name}`} checked={plan.storyChannels.includes(id)} onChange={() => toggle("storyChannels", id, STORY_CHANNELS)} /> {name}
            </label>
          ))}
        </div>
        {number("Feed por semana", "feedsPerWeek", 14)}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {FEED_CHANNELS.map(([id, name]) => (
            <label key={id}>
              <input type="checkbox" aria-label={`Feed no ${name}`} checked={plan.feedChannels.includes(id)} onChange={() => toggle("feedChannels", id, FEED_CHANNELS)} /> {name}
            </label>
          ))}
        </div>
        {number("Encartes por mês", "flyersPerMonth", 31)}
      </div>
      {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
      {saved ? <p className="muted" style={{ marginTop: 10 }}>Plano salvo.</p> : null}
      <Button type="button" style={{ marginTop: 10 }} disabled={busy} onClick={() => void handleSave()}>
        Salvar plano contratado
      </Button>
    </div>
  );
}
```

Note the aria-labels "Story no Status do WhatsApp" etc.; the test relies on them. Instagram/Facebook labels read "Story no Instagram", "Feed no Facebook".

- [ ] **Step 5: Render** in `Company.tsx`: import `{ ContractedPlanCard } from "./ContractedPlanCard"` and add `<ContractedPlanCard project={project} refreshProject={refreshProject} />` right after `<BusinessHoursCard ... />`.

- [ ] **Step 6: Run** `cd content-central-app; npx vitest run src/pages/workspace/Company.test.tsx --testTimeout=20000; npm run build` — pass; build succeeds.

- [ ] **Step 7: Commit** (controller): `feat(content-central-app): contracted plan card in the Raio-X`

---

### Task 6: Verify (controller)

- [ ] Full suites: `node --test tests/*.test.js` (all pass) and `cd content-central-app; npm test` (re-run any failing file alone before calling it a failure).
- [ ] `npm run build` in `content-central-app`.
- [ ] Bench (only if the operator asks to restart it): set Carvalho's contracted plan (2 stories/day on Instagram + Facebook + WhatsApp Status, 1 feed/week Instagram + Facebook, 2 encartes/month) and run one cérebro turn; check the plan matches, warnings show, and the turn is faster than 74 s.
- [ ] Update memory `content_central_cerebro.md`; commit spec/plan with `git add -f`.
