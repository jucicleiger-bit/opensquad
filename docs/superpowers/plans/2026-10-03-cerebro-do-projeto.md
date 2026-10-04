# Cérebro do projeto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-project planning agent ("cérebro") the operator chats with inside Content Central; it builds the week's plan (which offer/combo per slot), proposes cadastro changes for approval, keeps a client notebook, and approval runs the existing generation.

**Architecture:** Offers gain `validFrom`/`validUntil`/`sector`; the rotation and combo pairing respect them; approved-plan slots can pin `offerIds`. A new module `src/content-central-brain.js` stores chat/plan/proposals/notebook under the project dir and runs `claude -p` (injectable runner). The cérebro acts only through `bin/cerebro.js`, a CLI over the local HTTP API. A new `Brain.tsx` workspace tab shows chat, proposal cards, the plan and the notebook.

**Tech Stack:** Node ESM (`node:test`), React + Vite + vitest (content-central-app), Claude Code CLI 2.1.288.

Spec: `docs/superpowers/specs/2026-10-03-cerebro-do-projeto-design.md`

## Global Constraints

- Offer with empty `validFrom`/`validUntil` behaves exactly as today (always valid).
- Combo pairs only offers whose `sector` matches (trimmed, case-insensitive); sector-less only pairs with sector-less.
- Invalid pinned plan slot fails the request naming the slot; never silently falls back to the picker.
- The cérebro never edits files: `claude` runs with `--tools Bash` and `--allowedTools "Bash(node <abs>/bin/cerebro.js:*)"`, `--setting-sources project` (keeps the operator's personal plugins/hooks out), cwd = the project's `brain/` dir.
- Times come from the plan's `formats` (start time + interval); slots do not carry their own time.
- Brain files live in `_opensquad/content-central/projects/<id>/brain/`: `chat.json`, `plan.json`, `proposals.json`, `notebook.md`.
- Claude timeout: 5 minutes. One message at a time per project (HTTP 409 `O cérebro ainda está respondendo`).
- UI copy in Portuguese. `content-central-app`: verify types with `npm run build`, not `tsc --noEmit`.
- Run a single test file with `node --test tests/<file>.test.js`; the full suite is `npm test` (~2.5 min).

---

### Task 1: Offer validity and sector

**Files:**
- Modify: `src/content-central.js` (normalizeProjectOffer ~L9936, `fitsWeekday` ~L6978, `pickComboPartner` ~L6982, `createOfferChooser` ~L6738, `buildTopicPool` ~L6630, `createScheduleTopicPicker.next` ~L6795, `buildContentTopic` ~L6862, `buildOfferUsage` queue ~L6845)
- Test: `tests/content-central-offer-rotation.test.js`

**Interfaces:**
- Produces: offer fields `validFrom: string` (`YYYY-MM-DD` or `''`), `validUntil: string`, `sector: string`; internal `fitsSlot(offer, weekday, date)` and `sameSector(a, b)` used by Task 2.

- [ ] **Step 1: Failing tests** (append to the rotation test file)

```js
test('an offer outside its validity window never takes a slot', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'validade', name: 'Validade' }, dir);
    await saveProjectOffer('validade', { name: 'Sempre', type: 'offer' }, dir);
    await saveProjectOffer('validade', { name: 'Sorteio', type: 'offer', validFrom: '2026-10-06', validUntil: '2026-10-07' }, dir);

    const batch = await generateContentSchedulePlan('validade', { days: 5, startDate: '2026-10-05', formats: ONE_STORY_A_DAY, now: NOW }, dir);

    assert.deepEqual(offerNames(batch.items), ['Sempre', 'Sorteio', 'Sempre', 'Sempre', 'Sempre']);
  });
});

test('offer validity and sector are saved trimmed; a bad date is dropped', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'campos', name: 'Campos' }, dir);
    const { offer } = await saveProjectOffer('campos', { name: 'X', validFrom: '2026-10-01', validUntil: 'amanhã', sector: '  Higiene ' }, dir);
    assert.equal(offer.validFrom, '2026-10-01');
    assert.equal(offer.validUntil, '');
    assert.equal(offer.sector, 'Higiene');
  });
});

test('a combo never pairs offers of different sectors', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'setor', name: 'Setor' }, dir);
    const { group } = await saveProjectOfferGroup('setor', { name: 'Geral', comboChance: 100 }, dir);
    await saveProjectOffer('setor', { name: 'Sabonete', type: 'offer', groupId: group.id, sector: 'Higiene' }, dir);
    await saveProjectOffer('setor', { name: 'Arroz', type: 'offer', groupId: group.id, sector: 'Mercearia' }, dir);
    await saveProjectOffer('setor', { name: 'Feijão', type: 'offer', groupId: group.id, sector: 'mercearia' }, dir);

    const batch = await generateContentSchedulePlan('setor', { days: 3, startDate: '2026-10-05', formats: ONE_STORY_A_DAY, groupIds: [group.id], offersOnly: true, now: NOW }, dir);

    for (const item of batch.items) {
      const names = (item.contentTopic.products || []).map((product) => product.name).sort();
      if (names.length) assert.deepEqual(names, ['Arroz', 'Feijão']);
    }
    assert.ok(batch.items.some((item) => item.contentTopic.offerName === 'Sabonete'));
  });
});
```

- [ ] **Step 2: Run** `node --test tests/content-central-offer-rotation.test.js` — Expected: the 3 new tests FAIL.

- [ ] **Step 3: Implement**

In `normalizeProjectOffer`, after `daysOfWeek: normalizeDaysOfWeek(input?.daysOfWeek),`:

```js
    // Optional validity window (YYYY-MM-DD, inclusive). Empty = always
    // valid, unchanged from before. See fitsSlot.
    validFrom: normalizeDateKey(input?.validFrom),
    validUntil: normalizeDateKey(input?.validUntil),
    // Product sector ("Hortifruti", "Higiene"…). A combo only pairs offers
    // of the same sector — groups mix sector and campaign, so grouping
    // alone let hygiene pair with food. See sameSector.
    sector: String(input?.sector || '').trim(),
```

Next to `normalizeDaysOfWeek`:

```js
function normalizeDateKey(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? text : '';
}
```

Replace `fitsWeekday` with:

```js
function fitsSlot(offer, weekday, date) {
  if (weekday && offer.daysOfWeek?.length && !offer.daysOfWeek.includes(weekday)) return false;
  if (date && offer.validFrom && date < offer.validFrom) return false;
  if (date && offer.validUntil && date > offer.validUntil) return false;
  return true;
}

function sameSector(a, b) {
  return String(a.sector || '').trim().toLowerCase() === String(b.sector || '').trim().toLowerCase();
}
```

`pickComboPartner(offers, primary, project, weekday, date)`: candidate filter uses `fitsSlot(offer, weekday, date) && sameSector(offer, primary)`.

`createOfferChooser`: `const date = String(slotKey || '').slice(0, 10) || null;`, candidates filtered by `fitsSlot(offer, weekday, date)`, pass `date` to `pickComboPartner`.

`buildTopicPool`: replace the weekday filter line with `.filter((offer) => fitsSlot(offer, options.weekday, options.date))`.

`createScheduleTopicPicker.next`: `const date = String(slotKey || '').slice(0, 10) || undefined;` and pass `date` in both `buildTopicPool(...)` and `buildContentTopic(...)` option objects; `buildContentTopic` forwards `date: context.date` to `buildTopicPool`.

`buildOfferUsage` queue: `[...activeProjectOffers(project)].filter((offer) => !offer.validUntil || offer.validUntil >= today)`.

- [ ] **Step 4: Run** the rotation test file — Expected: all PASS. Then `node --test tests/content-central.test.js` — Expected: PASS (no regression).

- [ ] **Step 5: Commit** `feat(content-central): offers can have a validity window and a sector; combos stay within one sector`

---

### Task 2: Plan slots pin offers

**Files:**
- Modify: `src/content-central.js` (`buildApprovedPlanOverrideMap` ~L3507, generate loop ~L3615, new exported `applyPlanSlotChoices` near `previewContentSchedulePlan`)
- Test: `tests/content-central-offer-rotation.test.js`

**Interfaces:**
- Consumes: `fitsSlot`, `sameSector` (Task 1).
- Produces:
  - approved-plan regular slot field `offerIds: string[]` (1 or 2).
  - `export async function applyPlanSlotChoices(projectId, plan, choices, targetDir)` → returns the plan with each chosen slot rewritten (`offerIds`, `offerName`, `price`, `label`, `reason`, `kind: 'Venda'`, `source: 'offer'`); throws `Error` naming the slot when invalid. `choices`: `[{ id, offerIds?, label?, reason? }]`.

- [ ] **Step 1: Failing tests**

```js
test('an approved plan slot with offerIds generates exactly those offers', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'fixo', name: 'Fixo' }, dir);
    await saveProjectOffer('fixo', { name: 'A', type: 'offer', sector: 'Mercearia' }, dir);
    const b = (await saveProjectOffer('fixo', { name: 'B', type: 'offer', sector: 'Mercearia' }, dir)).offer;
    const c = (await saveProjectOffer('fixo', { name: 'C', type: 'offer', sector: 'Mercearia' }, dir)).offer;
    const approvedPlan = { dayPlans: [
      { date: '2026-10-05', regular: [{ id: '2026-10-05-instagram_story-01', offerIds: [c.id] }] },
      { date: '2026-10-06', regular: [{ id: '2026-10-06-instagram_story-01', offerIds: [b.id, c.id] }] },
    ] };

    const batch = await generateContentSchedulePlan('fixo', { days: 2, startDate: '2026-10-05', formats: ONE_STORY_A_DAY, approvedPlan, now: NOW }, dir);

    assert.equal(batch.items[0].contentTopic.offerName, 'C');
    assert.deepEqual(batch.items[1].contentTopic.products.map((p) => p.name), ['B', 'C']);
  });
});

test('a pinned slot with an expired offer or mixed sectors fails naming the slot', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'fixo-ruim', name: 'Fixo Ruim' }, dir);
    const old = (await saveProjectOffer('fixo-ruim', { name: 'Velha', type: 'offer', validUntil: '2026-10-01' }, dir)).offer;
    const soap = (await saveProjectOffer('fixo-ruim', { name: 'Sabonete', type: 'offer', sector: 'Higiene' }, dir)).offer;
    const rice = (await saveProjectOffer('fixo-ruim', { name: 'Arroz', type: 'offer', sector: 'Mercearia' }, dir)).offer;
    const plan = (ids) => ({ dayPlans: [{ date: '2026-10-05', regular: [{ id: '2026-10-05-instagram_story-01', offerIds: ids }] }] });
    const run = (ids) => generateContentSchedulePlan('fixo-ruim', { days: 1, startDate: '2026-10-05', formats: ONE_STORY_A_DAY, approvedPlan: plan(ids), now: NOW }, dir);

    await assert.rejects(run([old.id]), /2026-10-05-instagram_story-01.*Velha/);
    await assert.rejects(run([soap.id, rice.id]), /2026-10-05-instagram_story-01.*setor/);
  });
});

test('applyPlanSlotChoices rewrites the preview slot so the operator sees the pinned offer', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'escolha', name: 'Escolha' }, dir);
    await saveProjectOffer('escolha', { name: 'A', type: 'offer' }, dir);
    const b = (await saveProjectOffer('escolha', { name: 'B', type: 'offer', price: '9,90' }, dir)).offer;
    const preview = await previewContentSchedulePlan('escolha', { days: 1, startDate: '2026-10-05', formats: ONE_STORY_A_DAY }, dir);

    const plan = await applyPlanSlotChoices('escolha', preview, [{ id: '2026-10-05-instagram_story-01', offerIds: [b.id], reason: 'Foco da semana' }], dir);

    const slot = plan.dayPlans[0].regular[0];
    assert.deepEqual(slot.offerIds, [b.id]);
    assert.equal(slot.offerName, 'B');
    assert.equal(slot.label, 'Venda — B');
    assert.equal(slot.reason, 'Foco da semana');
  });
});
```

Add `applyPlanSlotChoices` to the file's import list.

- [ ] **Step 2: Run** the rotation test file — Expected: the 3 new tests FAIL.

- [ ] **Step 3: Implement**

`buildApprovedPlanOverrideMap`: keep a slot when it has `offerIds` too:

```js
      const offerIds = Array.isArray(slot?.offerIds)
        ? slot.offerIds.map((value) => cleanApprovedPlanText(value, 120)).filter(Boolean).slice(0, 2)
        : [];
      if (!id || (!label && !reason && !offerIds.length)) continue;
      map.set(id, { id, label, reason, offerIds });
```

New helper (near `pickComboPartner`):

```js
// The topic of a plan slot the operator (or the cérebro) pinned to one offer
// or a side-by-side pair. Same eligibility as the automatic rotation — an
// invalid pin is an error naming the slot, never a silent swap, because the
// operator approved exactly this.
async function topicForPinnedOffers(project, slotId, offerIds, date, targetDir) {
  const offers = activeProjectOffers(project);
  const weekday = weekdayFromDate(date);
  const picked = offerIds.map((offerId) => {
    const offer = offers.find((entry) => entry.id === offerId);
    if (!offer) throw new Error(`Horário ${slotId}: oferta ${offerId} não existe ou está pausada.`);
    if (!fitsSlot(offer, weekday, date)) throw new Error(`Horário ${slotId}: a oferta ${offer.name} não vale em ${date}.`);
    return offer;
  });
  if (picked.length === 1) return offerToContentTopic(picked[0], targetDir);
  const [a, b] = picked;
  if (!sameSector(a, b)) throw new Error(`Horário ${slotId}: ${a.name} e ${b.name} são de setor diferente — combo só junta o mesmo setor.`);
  for (const offer of picked) {
    if (offer.type === 'combo' || offer.uniqueProposal || offer.flavors?.length) {
      throw new Error(`Horário ${slotId}: ${offer.name} não pode entrar em combo.`);
    }
  }
  return buildComboOfferTopic(a, b, targetDir);
}
```

Generate loop, right after `baseContentTopic` is computed:

```js
        const pinnedTopic = approvedPlanOverride?.offerIds?.length
          ? applyApprovedPlanOverrideToTopic(
            { ...(await topicForPinnedOffers(project, planSlotId, approvedPlanOverride.offerIds, scheduledDate, targetDir)), channel: format.channel },
            { ...approvedPlanOverride, label: '' },
          )
          : baseContentTopic;
```

and use `pinnedTopic` where `baseContentTopic` was used (`withProductRotationSeed(pinnedTopic, contentId)`). The label override is dropped for pinned slots so the subject stays the real offer name; the reason still becomes the operator's orientation.

Sibling channels sharing one creative (same `creativeGroupKey`) must not be pinned to different offers. Before the day loop:

```js
  const pinnedByCreativeGroup = new Map();
```

and after computing `pinnedTopic` when the slot is pinned and `creativeGroupKey` is set:

```js
        if (approvedPlanOverride?.offerIds?.length && creativeGroupKey) {
          const key = approvedPlanOverride.offerIds.join('+');
          const seen = pinnedByCreativeGroup.get(creativeGroupKey);
          if (seen && seen !== key) throw new Error(`Horário ${planSlotId}: canais do mesmo formato no mesmo horário dividem a arte — use a mesma oferta.`);
          pinnedByCreativeGroup.set(creativeGroupKey, key);
        }
```

`applyPlanSlotChoices`:

```js
// Applies the cérebro's per-slot choices to a preview plan, validating each
// pinned slot with the same rules generation uses, so a plan that shows up
// in the panel is a plan that will generate.
export async function applyPlanSlotChoices(projectId, plan, choices, targetDir = process.cwd()) {
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  const byId = new Map((Array.isArray(choices) ? choices : []).map((choice) => [String(choice?.id || ''), choice]));
  const known = new Set(plan.dayPlans.flatMap((day) => day.regular.map((slot) => slot.id)));
  for (const id of byId.keys()) if (!known.has(id)) throw new Error(`Horário ${id} não existe neste plano.`);
  const dayPlans = [];
  for (const day of plan.dayPlans) {
    const regular = [];
    for (const slot of day.regular) {
      const choice = byId.get(slot.id);
      if (!choice) { regular.push(slot); continue; }
      const offerIds = Array.isArray(choice.offerIds) ? choice.offerIds.map(String).filter(Boolean).slice(0, 2) : [];
      const reason = cleanApprovedPlanText(choice.reason, 500) || slot.reason;
      if (!offerIds.length) {
        regular.push({ ...slot, label: cleanApprovedPlanText(choice.label, 220) || slot.label, reason });
        continue;
      }
      const topic = await topicForPinnedOffers(project, slot.id, offerIds, slot.date, targetDir);
      const name = topic.products?.length ? topic.products.map((product) => product.name).join(' + ') : topic.offerName;
      const { topic: _previewTopic, ...rest } = slot;
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

- [ ] **Step 4: Run** the rotation file, then `node --test tests/content-central.test.js tests/content-central-server.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(content-central): a plan slot can pin the offer or same-sector pair it must generate`

---

### Task 3: Brain store (notebook, chat, plan, proposals, context)

**Files:**
- Create: `src/content-central-brain.js`
- Test: `tests/content-central-brain.test.js`

**Interfaces:**
- Consumes: `getCentralPaths`, `loadProject`, `saveProjectOffer`, `updateProjectBrandInput`, `normalizeProjectOffers` (export it if not exported), `listProjectContent`, `buildOfferUsage`, `previewContentSchedulePlan`, `applyPlanSlotChoices` from `src/content-central.js`.
- Produces (all `(projectId, …, targetDir)`):
  - `brainPaths(targetDir, projectId)` → `{ dir, chatPath, planPath, proposalsPath, notebookPath }`
  - `readBrainState(projectId, targetDir)` → `{ chat: { sessionId, messages[] }, plan, proposals[], notebook }`
  - `appendBrainMessages(projectId, messages, sessionId, targetDir)`
  - `saveNotebook(projectId, text, targetDir)`
  - `saveBrainPlan(projectId, { startDate, days, formats, slots }, targetDir)` → stored `{ startDate, days, formats, plan, updatedAt }`
  - `createProposal(projectId, { summary, changes }, targetDir)` → proposal; change kinds: `{ kind: 'offer', offerId, field, after }` (field ∈ `validFrom|validUntil|sector|active|groupId`), `{ kind: 'goalWeights', after: {key: n} }`, `{ kind: 'notebook', after: string }`. `before` is captured from current data at creation.
  - `resolveProposal(projectId, proposalId, action /* 'apply'|'reject' */, targetDir)` → `{ proposal, results: [{ index, ok, error? }] }`
  - `buildBrainContext(projectId, targetDir)` → string

- [ ] **Step 1: Failing tests** — `tests/content-central-brain.test.js`:

```js
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
```

- [ ] **Step 2: Run** `node --test tests/content-central-brain.test.js` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/content-central-brain.js`:

```js
// The per-project planning agent ("cérebro"): its stored chat, current draft
// plan, pending proposals and client notebook, plus the context it reads at
// the start of a conversation. See
// docs/superpowers/specs/2026-10-03-cerebro-do-projeto-design.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  applyPlanSlotChoices, buildOfferUsage, getCentralPaths, listProjectContent, loadProject,
  normalizeProjectOffers, previewContentSchedulePlan, saveProjectOffer, updateProjectBrandInput,
} from './content-central.js';

const OFFER_FIELDS = new Set(['validFrom', 'validUntil', 'sector', 'active', 'groupId']);

export function brainPaths(targetDir, projectId) {
  const dir = join(getCentralPaths(targetDir, projectId).projectDir, 'brain');
  return {
    dir,
    chatPath: join(dir, 'chat.json'),
    planPath: join(dir, 'plan.json'),
    proposalsPath: join(dir, 'proposals.json'),
    notebookPath: join(dir, 'notebook.md'),
  };
}

async function readOr(path, fallback, parse = JSON.parse) {
  try { return parse(await readFile(path, 'utf-8')); } catch (err) { if (err.code === 'ENOENT') return fallback; throw err; }
}

async function write(path, value) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf-8');
}

export async function readBrainState(projectId, targetDir) {
  const paths = brainPaths(targetDir, projectId);
  return {
    chat: await readOr(paths.chatPath, { sessionId: null, messages: [] }),
    plan: await readOr(paths.planPath, null),
    proposals: await readOr(paths.proposalsPath, []),
    notebook: await readOr(paths.notebookPath, '', (text) => text),
  };
}

export async function appendBrainMessages(projectId, messages, sessionId, targetDir) {
  const paths = brainPaths(targetDir, projectId);
  const chat = await readOr(paths.chatPath, { sessionId: null, messages: [] });
  const next = { sessionId: sessionId || chat.sessionId, messages: [...chat.messages, ...messages] };
  await write(paths.chatPath, next);
  return next;
}

export async function saveNotebook(projectId, text, targetDir) {
  await write(brainPaths(targetDir, projectId).notebookPath, String(text || ''));
}

export async function saveBrainPlan(projectId, { startDate, days, formats, slots }, targetDir) {
  const preview = await previewContentSchedulePlan(projectId, { startDate, days: Number(days), formats }, targetDir);
  const plan = await applyPlanSlotChoices(projectId, preview, slots || [], targetDir);
  const stored = { startDate, days: Number(days), formats, plan, updatedAt: new Date().toISOString() };
  await write(brainPaths(targetDir, projectId).planPath, stored);
  return stored;
}

async function currentValue(projectId, change, targetDir) {
  if (change.kind === 'notebook') return (await readBrainState(projectId, targetDir)).notebook;
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  if (change.kind === 'goalWeights') return project.brandInput?.contentGoalWeights || {};
  if (change.kind === 'offer') {
    const offer = normalizeProjectOffers(project.contentStrategy?.offers || []).find((entry) => entry.id === change.offerId);
    if (!offer) throw new Error(`Oferta ${change.offerId} não existe.`);
    return offer[change.field];
  }
  throw new Error(`Tipo de mudança desconhecido: ${change.kind}`);
}

function checkChange(change) {
  if (change.kind === 'offer' && !OFFER_FIELDS.has(change.field)) throw new Error(`Campo de oferta não permitido: ${change.field}`);
  if (!['offer', 'goalWeights', 'notebook'].includes(change.kind)) throw new Error(`Tipo de mudança desconhecido: ${change.kind}`);
}

export async function createProposal(projectId, { summary, changes }, targetDir) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('A proposta precisa de pelo menos uma mudança.');
  const withBefore = [];
  for (const change of changes) {
    checkChange(change);
    withBefore.push({ ...change, before: await currentValue(projectId, change, targetDir) });
  }
  const proposal = { id: randomUUID(), summary: String(summary || '').trim(), changes: withBefore, status: 'pending', createdAt: new Date().toISOString() };
  const paths = brainPaths(targetDir, projectId);
  await write(paths.proposalsPath, [...await readOr(paths.proposalsPath, []), proposal]);
  return proposal;
}

async function applyChange(projectId, change, targetDir) {
  const now = await currentValue(projectId, change, targetDir);
  if (JSON.stringify(now ?? null) !== JSON.stringify(change.before ?? null)) {
    throw new Error('O dado mudou desde a proposta; peça ao cérebro para propor de novo.');
  }
  if (change.kind === 'notebook') return saveNotebook(projectId, change.after, targetDir);
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  if (change.kind === 'goalWeights') {
    return updateProjectBrandInput(projectId, { ...project.brandInput, contentGoalWeights: change.after }, targetDir);
  }
  const offer = normalizeProjectOffers(project.contentStrategy?.offers || []).find((entry) => entry.id === change.offerId);
  return saveProjectOffer(projectId, { ...offer, [change.field]: change.after }, targetDir);
}

export async function resolveProposal(projectId, proposalId, action, targetDir) {
  const paths = brainPaths(targetDir, projectId);
  const proposals = await readOr(paths.proposalsPath, []);
  const proposal = proposals.find((entry) => entry.id === proposalId);
  if (!proposal) throw new Error('Proposta não encontrada.');
  if (proposal.status !== 'pending') throw new Error('Essa proposta já foi resolvida.');
  const results = [];
  if (action === 'apply') {
    for (const [index, change] of proposal.changes.entries()) {
      try { await applyChange(projectId, change, targetDir); results.push({ index, ok: true }); } catch (err) { results.push({ index, ok: false, error: err.message }); }
    }
  }
  proposal.status = action === 'apply' ? 'applied' : 'rejected';
  proposal.results = results;
  proposal.resolvedAt = new Date().toISOString();
  await write(paths.proposalsPath, proposals);
  return { proposal, results };
}

export async function buildBrainContext(projectId, targetDir) {
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  const state = await readBrainState(projectId, targetDir);
  const usage = buildOfferUsage(project, await listProjectContent(projectId, targetDir));
  const groups = new Map((project.contentStrategy?.offerGroups || []).map((group) => [group.id, group.name]));
  const offers = normalizeProjectOffers(project.contentStrategy?.offers || []).map((offer) => {
    const use = usage.offers[offer.id] || {};
    const validity = offer.validFrom || offer.validUntil ? ` · vale ${offer.validFrom ? `de ${offer.validFrom} ` : ''}${offer.validUntil ? `até ${offer.validUntil}` : ''}` : ' · vale sempre';
    const days = offer.daysOfWeek?.length ? ` · só ${offer.daysOfWeek.join(',')}` : '';
    return `- [${offer.id}] ${offer.name} · ${offer.price || 'sem preço'} · setor: ${offer.sector || '(sem setor)'} · grupo: ${groups.get(offer.groupId) || '-'}${validity}${days}${offer.active ? '' : ' · PAUSADA'} · saiu ${use.publishedCount || 0}x${use.nextScheduledDate ? ` · na fila ${use.nextScheduledDate}` : ''}`;
  });
  const weights = project.brandInput?.contentGoalWeights || {};
  return [
    `# Projeto ${project.name} (${project.projectId})`,
    `Hoje: ${new Date().toISOString().slice(0, 10)}`,
    '## Caderno do cliente', state.notebook.trim() || '(vazio)',
    '## Ofertas', offers.join('\n') || '(nenhuma)',
    '## Percentuais do Raio-X (contentGoalWeights)', JSON.stringify(weights),
    '## Plano atual', state.plan ? JSON.stringify({ startDate: state.plan.startDate, days: state.plan.days, formats: state.plan.formats, slots: state.plan.plan.dayPlans.flatMap((day) => day.regular.map((slot) => `${slot.id} ${slot.label}`)) }) : '(nenhum)',
    '## Propostas pendentes', state.proposals.filter((p) => p.status === 'pending').map((p) => `- ${p.id}: ${p.summary}`).join('\n') || '(nenhuma)',
  ].join('\n\n');
}
```

(If `normalizeProjectOffers` or `listProjectContent` aren't exported, export them — `normalizeProjectOffers` is already `export function` at ~L9046.)

- [ ] **Step 4: Run** `node --test tests/content-central-brain.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(content-central): cérebro store — notebook, chat, draft plan, proposals and context`

---

### Task 4: Claude runner, HTTP routes and the `cerebro` CLI

**Files:**
- Modify: `src/content-central-brain.js` (add `runClaudeTurn`, `sendBrainMessage`, `BRAIN_SYSTEM_PROMPT`)
- Modify: `src/content-central-server.js` (option `brainRunner`, routes under `/api/projects/:id/brain`)
- Create: `bin/cerebro.js`
- Test: `tests/content-central-brain-server.test.js`

**Interfaces:**
- Consumes: Task 3 exports.
- Produces HTTP (all JSON):
  - `GET  /api/projects/:id/brain` → `readBrainState`
  - `POST /api/projects/:id/brain/messages` `{ text }` → `{ chat }` (409 while busy, 502 with `{ error, chat }` on runner failure)
  - `GET  /api/projects/:id/brain/context` → `{ text }`
  - `POST /api/projects/:id/brain/plan` `{ startDate, days, formats, slots }` → stored plan
  - `POST /api/projects/:id/brain/proposals` `{ summary, changes }` → proposal
  - `POST /api/projects/:id/brain/proposals/:pid/apply|reject` → `{ proposal, results }`
  - `POST /api/projects/:id/brain/notebook` `{ text }` → `{ notebook }`
- Runner contract: `brainRunner({ prompt, sessionId, systemPrompt, cwd }) → Promise<{ sessionId, text }>`.

- [ ] **Step 1: Failing tests** — `tests/content-central-brain-server.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startContentCentralServer } from '../src/content-central-server.js';
import { createCentralProject, saveProjectOffer } from '../src/content-central.js';

const realFetch = globalThis.fetch;

async function withServer(fn, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-brain-server-'));
  await createCentralProject({ projectId: 'loja', name: 'Loja' }, dir);
  const server = await startContentCentralServer({ targetDir: dir, port: 0, openBrowser: false, ...options });
  try { return await fn(dir, server); } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
}

async function call(server, path, body) {
  const response = await realFetch(`${server.url}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('a message runs the cérebro, stores both sides and reuses the session', async () => {
  const calls = [];
  const brainRunner = async (input) => { calls.push(input); return { sessionId: 'sessao-1', text: `ok ${calls.length}` }; };
  await withServer(async (_dir, server) => {
    await call(server, '/api/projects/loja/brain/messages', { text: 'oi' });
    const second = await call(server, '/api/projects/loja/brain/messages', { text: 'de novo' });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.chat.messages.map((m) => [m.role, m.text]), [['user', 'oi'], ['assistant', 'ok 1'], ['user', 'de novo'], ['assistant', 'ok 2']]);
    assert.equal(calls[0].sessionId, null);
    assert.equal(calls[1].sessionId, 'sessao-1');
    assert.match(calls[0].prompt, /Projeto Loja/);
    assert.doesNotMatch(calls[1].prompt, /Projeto Loja/);
  }, { brainRunner });
});

test('a second message while the first runs gets 409', async () => {
  let release;
  const brainRunner = () => new Promise((resolve) => { release = () => resolve({ sessionId: 's', text: 'pronto' }); });
  await withServer(async (_dir, server) => {
    const first = call(server, '/api/projects/loja/brain/messages', { text: 'um' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await call(server, '/api/projects/loja/brain/messages', { text: 'dois' });
    assert.equal(second.status, 409);
    release();
    assert.equal((await first).status, 200);
  }, { brainRunner });
});

test('a runner failure is shown in the chat and keeps the session', async () => {
  const brainRunner = async () => { throw new Error('claude não está logado'); };
  await withServer(async (_dir, server) => {
    const result = await call(server, '/api/projects/loja/brain/messages', { text: 'oi' });
    assert.equal(result.status, 502);
    assert.equal(result.body.chat.messages.at(-1).role, 'error');
    assert.match(result.body.chat.messages.at(-1).text, /não está logado/);
  }, { brainRunner });
});

test('the cerebro CLI saves a plan and a proposal through the server', async () => {
  await withServer(async (dir, server) => {
    const { offer } = await saveProjectOffer('loja', { name: 'Arroz', type: 'offer' }, dir);
    const run = (...args) => promisify(execFile)(process.execPath, ['bin/cerebro.js', ...args], { env: { ...process.env, CONTENT_CENTRAL_URL: server.url } });
    const formats = [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }];
    const planOut = await run('plan', 'loja', JSON.stringify({ startDate: '2026-10-05', days: 1, formats, slots: [{ id: '2026-10-05-instagram_story-01', offerIds: [offer.id] }] }));
    assert.match(planOut.stdout, /Venda — Arroz/);
    const propOut = await run('propose', 'loja', JSON.stringify({ summary: 'Setor', changes: [{ kind: 'offer', offerId: offer.id, field: 'sector', after: 'Mercearia' }] }));
    assert.match(propOut.stdout, /Proposta criada/);
    const state = await call(server, '/api/projects/loja/brain');
    assert.equal(state.body.proposals[0].status, 'pending');
  });
});
```

- [ ] **Step 2: Run** `node --test tests/content-central-brain-server.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/content-central-brain.js`, add:

```js
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CEREBRO_CLI = fileURLToPath(new URL('../bin/cerebro.js', import.meta.url)).replace(/\\/g, '/');
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

export function brainSystemPrompt(projectId) {
  return [
    `Você é o cérebro (administrador de planejamento) do projeto ${projectId} no Content Central, uma central de conteúdo para lojas locais.`,
    'Fale em português simples, direto, como um gerente de marketing falando com o dono da agência. Não fale de código.',
    'Você só age pelo comando abaixo (Bash). Não edite arquivos.',
    `- node ${CEREBRO_CLI} context ${projectId}  → estado atual (ofertas, caderno, plano, propostas).`,
    `- node ${CEREBRO_CLI} plan ${projectId} '<json>'  → monta/refaz o plano. JSON: {"startDate":"AAAA-MM-DD","days":N,"formats":[{"channel":"instagram_story|instagram_feed|instagram_reels|facebook_feed|facebook_story|whatsapp_status","postsPerDay":N,"everyDays":1,"startTime":"HH:MM","intervalMinutes":N}],"slots":[{"id":"AAAA-MM-DD-canal-01","offerIds":["id"] ou ["id1","id2"] para combo,"reason":"porquê"}]}. Rode primeiro sem slots para ver os ids dos horários, depois com as escolhas.`,
    `- node ${CEREBRO_CLI} propose ${projectId} '<json>'  → propõe mudança no cadastro, que o operador aprova. JSON: {"summary":"...","changes":[{"kind":"offer","offerId":"id","field":"validFrom|validUntil|sector|active|groupId","after":valor} | {"kind":"goalWeights","after":{"sales":70,...}} | {"kind":"notebook","after":"caderno inteiro novo"}]}`,
    'Regras: o plano você monta direto. Ofertas, percentuais do Raio-X e caderno você só PROPÕE. Quando algo dito agora contradiz o caderno, proponha o caderno novo dizendo o que sai e o que entra.',
    'Combo só junta ofertas do mesmo setor. Oferta fora da validade não entra. Canais do mesmo formato no mesmo horário (Story/Reels/Facebook Story; Feed/Facebook Feed) dividem a arte: use a mesma oferta neles.',
    'Nunca gere nem publique: o operador aprova o plano na tela. Termine cada resposta dizendo o que fez e o que espera dele.',
  ].join('\n');
}

export function runClaudeTurn({ prompt, sessionId, systemPrompt, cwd }) {
  const args = ['-p', prompt, '--output-format', 'json', '--setting-sources', 'project', '--tools', 'Bash',
    '--allowedTools', `Bash(node ${CEREBRO_CLI}:*)`, '--append-system-prompt', systemPrompt];
  if (sessionId) args.push('--resume', sessionId);
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('O cérebro demorou mais de 5 minutos e foi interrompido.')); }, CLAUDE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`Não consegui abrir o Claude Code: ${err.message}`)); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout);
        if (result.is_error) return reject(new Error(String(result.result || 'Claude Code devolveu erro.')));
        resolve({ sessionId: result.session_id, text: String(result.result || '') });
      } catch {
        reject(new Error((stderr || stdout || 'Claude Code não respondeu.').trim().slice(0, 500)));
      }
    });
  });
}

const busy = new Set();

export async function sendBrainMessage(projectId, text, targetDir, runner = runClaudeTurn) {
  const message = String(text || '').trim();
  if (!message) throw Object.assign(new Error('Mensagem vazia.'), { status: 400 });
  if (busy.has(projectId)) throw Object.assign(new Error('O cérebro ainda está respondendo.'), { status: 409 });
  busy.add(projectId);
  try {
    const { chat } = await readBrainState(projectId, targetDir);
    const at = new Date().toISOString();
    await appendBrainMessages(projectId, [{ role: 'user', text: message, at }], null, targetDir);
    const prompt = chat.sessionId ? message : `${await buildBrainContext(projectId, targetDir)}\n\n---\nMensagem do operador:\n${message}`;
    const { dir } = brainPaths(targetDir, projectId);
    await mkdir(dir, { recursive: true });
    try {
      const reply = await runner({ prompt, sessionId: chat.sessionId, systemPrompt: brainSystemPrompt(projectId), cwd: dir });
      return { chat: await appendBrainMessages(projectId, [{ role: 'assistant', text: reply.text, at: new Date().toISOString() }], reply.sessionId, targetDir) };
    } catch (err) {
      const failed = await appendBrainMessages(projectId, [{ role: 'error', text: err.message, at: new Date().toISOString() }], null, targetDir);
      throw Object.assign(new Error(err.message), { status: 502, chat: failed });
    }
  } finally {
    busy.delete(projectId);
  }
}
```

In `src/content-central-server.js`: import the brain exports; add `brainRunner = null` to `startContentCentralServer` options and `brainRunner: brainRunner || runClaudeTurn` to `context`; add, beside the `plan` route:

```js
  if (parts[3] === 'brain') {
    try {
      if (parts.length === 4 && req.method === 'GET') return sendJson(res, 200, await readBrainState(projectId, targetDir));
      if (parts.length === 5 && parts[4] === 'context') return sendJson(res, 200, { text: await buildBrainContext(projectId, targetDir) });
      const body = await readBody(req);
      if (parts.length === 5 && parts[4] === 'messages') return sendJson(res, 200, await sendBrainMessage(projectId, body.text, targetDir, context.brainRunner));
      if (parts.length === 5 && parts[4] === 'plan') return sendJson(res, 200, await saveBrainPlan(projectId, body, targetDir));
      if (parts.length === 5 && parts[4] === 'notebook') { await saveNotebook(projectId, body.text, targetDir); return sendJson(res, 200, { notebook: String(body.text || '') }); }
      if (parts.length === 5 && parts[4] === 'proposals') return sendJson(res, 201, await createProposal(projectId, body, targetDir));
      if (parts.length === 7 && parts[4] === 'proposals' && ['apply', 'reject'].includes(parts[6])) return sendJson(res, 200, await resolveProposal(projectId, parts[5], parts[6], targetDir));
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.message, ...(err.chat ? { chat: err.chat } : {}) });
    }
  }
```

`bin/cerebro.js`:

```js
#!/usr/bin/env node
// The only door the cérebro (Claude Code, see src/content-central-brain.js)
// has into Content Central: it goes through the local HTTP API so every
// existing validation and project lock applies.
const base = process.env.CONTENT_CENTRAL_URL || `http://127.0.0.1:${process.env.CONTENT_CENTRAL_PORT || 3333}`;
const [command, projectId, json] = process.argv.slice(2);

async function call(path, body) {
  const response = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/brain${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function parse(text) {
  try { return JSON.parse(text || '{}'); } catch (err) { throw new Error(`JSON inválido: ${err.message}`); }
}

try {
  if (!projectId) throw new Error('Uso: cerebro <context|plan|propose> <projeto> [json]');
  if (command === 'context') {
    console.log((await call('/context')).text);
  } else if (command === 'plan') {
    const stored = await call('/plan', parse(json));
    for (const day of stored.plan.dayPlans) {
      for (const slot of day.regular) console.log(`${slot.id} ${slot.scheduledTime} ${slot.channelLabel}: ${slot.label}`);
      for (const extra of day.extras) console.log(`${day.date} extra: ${extra.label}`);
    }
    console.log('Plano salvo; o operador vê e aprova na tela.');
  } else if (command === 'propose') {
    const proposal = await call('/proposals', parse(json));
    console.log(`Proposta criada (${proposal.id}); aguardando o operador aplicar.`);
  } else {
    throw new Error(`Comando desconhecido: ${command}`);
  }
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run** `node --test tests/content-central-brain-server.test.js tests/content-central-brain.test.js` — Expected: PASS. Then `npm run lint`.

- [ ] **Step 5: Commit** `feat(content-central): cérebro talks through Claude Code and acts only via the cerebro CLI`

---

### Task 5: Offers page — validity and sector fields

**Files:**
- Modify: `content-central-app/src/api/client.ts` (`ProjectOffer`, `SaveOfferInput`)
- Modify: `content-central-app/src/pages/workspace/Offers.tsx`
- Test: `content-central-app/src/pages/workspace/Offers.test.tsx`

**Interfaces:**
- Produces: `ProjectOffer.validFrom?`, `validUntil?`, `sector?` (strings).

- [ ] **Step 1: Read `Offers.tsx`** form state + submit + list row to locate where `daysOfWeek` is handled; mirror that for the three new fields (state init from offer when editing, reset on clear, included in the `saveOffer` payload).
- [ ] **Step 2: Failing test** in `Offers.test.tsx` following the file's existing save test: fill "Setor" with `Higiene`, "Vale de" `2026-10-05`, "Vale até" `2026-10-20`, submit, assert `saveOffer` was called with `expect.objectContaining({ sector: 'Higiene', validFrom: '2026-10-05', validUntil: '2026-10-20' })`; and a list test asserting an offer with `validUntil` in the past shows `Vencida`, a future one shows `Vence 20/10`.
- [ ] **Step 3: Run** `cd content-central-app && npx vitest run src/pages/workspace/Offers.test.tsx` — FAIL.
- [ ] **Step 4: Implement**: add to both interfaces `validFrom?: string; validUntil?: string; sector?: string;`. In the form, add `<label>Setor <input list="offer-sectors" …/></label>` with a `<datalist id="offer-sectors">` of the distinct non-empty sectors of the project's offers, and two `<input type="date">` labeled "Vale de" / "Vale até" (hint text: "Vazio = vale sempre"). In the list row, next to the usage line: `validUntil < today ? 'Vencida' : validUntil ? \`Vence ${dd}/${mm}\` : ''`, and the sector as a small tag.
- [ ] **Step 5: Run** the test file — PASS; `npm run build` — no type errors.
- [ ] **Step 6: Commit** `feat(content-central-app): offers form takes sector and validity dates`

---

### Task 6: Cérebro tab

**Files:**
- Modify: `content-central-app/src/api/client.ts` (brain types + functions)
- Create: `content-central-app/src/pages/workspace/Brain.tsx`, `Brain.module.css`, `Brain.test.tsx`
- Modify: `content-central-app/src/App.tsx` (route `cerebro`), `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx` (nav item `{ to: "cerebro", label: "Cérebro", group: "Conteúdo" }` first in the Conteúdo group)

**Interfaces:**
- Consumes: Task 4 routes; existing `generateContent(projectId, { days, startDate, formats, approvedPlan })`.
- Produces in client.ts:

```ts
export interface BrainMessage { role: "user" | "assistant" | "error"; text: string; at: string }
export interface BrainChange { kind: "offer" | "goalWeights" | "notebook"; offerId?: string; field?: string; before: unknown; after: unknown }
export interface BrainProposal { id: string; summary: string; changes: BrainChange[]; status: "pending" | "applied" | "rejected"; results?: { index: number; ok: boolean; error?: string }[]; createdAt: string }
export interface BrainPlan { startDate: string; days: number; formats: GenerateContentInput["formats"]; plan: PlannedContentSchedule; updatedAt: string }
export interface BrainState { chat: { sessionId: string | null; messages: BrainMessage[] }; plan: BrainPlan | null; proposals: BrainProposal[]; notebook: string }
export function getBrain(projectId: string): Promise<BrainState>
export function sendBrainMessage(projectId: string, text: string): Promise<{ chat: BrainState["chat"] }>
export function resolveBrainProposal(projectId: string, proposalId: string, action: "apply" | "reject"): Promise<{ proposal: BrainProposal }>
export function saveBrainNotebook(projectId: string, text: string): Promise<{ notebook: string }>
```

(each via the existing `api()` helper, POST with JSON body). Also add `offerIds?: string[]` to `PlannedContentSlot`.

- [ ] **Step 1: Failing tests** `Brain.test.tsx` (mock `@/api/client` like other workspace tests):
  1. renders messages from `getBrain`; typing and sending calls `sendBrainMessage('p1', 'monta a semana')`, then refetches state.
  2. a pending proposal card shows `antes → depois` for each change and "Aplicar" calls `resolveBrainProposal('p1', id, 'apply')`.
  3. with a plan, "Aprovar e gerar" calls `generateContent('p1', { days, startDate, formats, approvedPlan: plan.plan })`.
  4. while `sendBrainMessage` is pending the send button is disabled and shows "Pensando…".
- [ ] **Step 2: Run** `npx vitest run src/pages/workspace/Brain.test.tsx` — FAIL.
- [ ] **Step 3: Implement** `Brain.tsx`: two-column layout (chat | plan + notebook). Chat: message list (assistant text rendered with `white-space: pre-wrap`; `error` role styled as a warning), pending proposals rendered as cards after the messages, textarea + "Enviar" (Enter sends, Shift+Enter breaks line). Plan panel: days → slots `HH:MM · canal · label`, extras listed under the day, button "Aprovar e gerar" (on success: message "Geração iniciada — acompanhe em Aguardando aprovação" and link to `aguardando`). Notebook: textarea + "Salvar caderno". Reuse `Button`, `Card`, `EmptyState` from `@/components`. Follow `GenerateContent.tsx` for the `useParams`/project id pattern and error toasts.
- [ ] **Step 4: Run** the test file — PASS; `npm run build` — PASS.
- [ ] **Step 5: Commit** `feat(content-central-app): Cérebro tab — chat, proposals, plan approval and client notebook`

---

### Task 7: Verify end to end

- [ ] `npm test` (root) — all pass; `npm run lint`.
- [ ] `cd content-central-app && npx vitest run && npm run build`.
- [ ] Real smoke test on the test bench (not production 3333): start the server on another port against a copy project, open the Cérebro tab, send "monta a semana de 05/10 com 1 story por dia às 9h", confirm a plan appears and a proposal card applies. Note the real `claude` round-trip time.
- [ ] `graphify update .`
- [ ] Commit any fixes; report to the operator. Do not merge or restart 3333 without his word.
