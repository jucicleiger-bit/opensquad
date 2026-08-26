# Combo Offer Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the scheduled-offer rotation (`nextSelectedOffer` in `src/content-central.js`) occasionally, at random, pair the drawn offer with a random sibling from the same offer group into one combo arte, instead of always producing a single-product post.

**Architecture:** A new per-group `comboChance` (0–100) field drives a dice roll inside `nextSelectedOffer`. On a hit, a new `buildComboOfferTopic` merges two real offers into one synthetic `type: 'combo'` offer and hands it to the existing `offerToContentTopic` — so every downstream system (CTA/objective resolution, per-type learning, the mandatory-template rule for `combo`, the 2-photo cap in `buildPrimaryAiImageReferences`) already knows how to handle it with zero changes.

**Tech Stack:** Node.js (backend, `src/content-central.js`, `node:test`/`node:assert`), React + TypeScript (frontend, `content-central-app`, Vitest + Testing Library).

## Global Constraints

- Similarity = same `offer.groupId`. No new per-offer field.
- Always exactly 2 offers combined (never 3+).
- `comboChance` is a plain 0–100 percentage, configured per offer group, default `0` (off, unchanged behavior).
- Merged price: never summed, never picked — both original prices shown as separate text in `notes`.
- An offer that is already `type: 'combo'` (manual combo) is never re-paired.
- No new template/postType rule — reuses the existing mandatory-`combo`-template requirement (`src/content-central.js:42`) untouched.

Spec: `docs/superpowers/specs/2026-08-25-combo-offer-pairing-design.md`.

---

### Task 1: `comboChance` field on offer groups (data model)

**Files:**
- Modify: `src/content-central.js:7928-7939` (`normalizeProjectOfferGroup`)
- Test: `tests/content-central.test.js` (append near the existing `'offer groups can be created, edited and deleted...'` test, around line 5033)

**Interfaces:**
- Consumes: nothing new.
- Produces: `normalizeProjectOfferGroup(...)` / `normalizeProjectOfferGroups(...)` now return a `comboChance: number` field (0–100 integer) on every group object. `saveProjectOfferGroup` (unchanged code, already passes `groupInput` straight through) persists whatever `comboChance` is sent in the input.

- [ ] **Step 1: Write the failing test**

Append to `tests/content-central.test.js` (same file already imports `withTempProject`, `createCentralProject`, `saveProjectOfferGroup`, `assert`, `test` — no new imports needed):

```js
test('offer group comboChance defaults to 0 and clamps to 0-100', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-chance-clamp', name: 'Combo Chance Clamp' }, dir);
    const { group: defaulted } = await saveProjectOfferGroup('combo-chance-clamp', { name: 'Geral' }, dir);
    assert.equal(defaulted.comboChance, 0);

    const { group: clampedHigh } = await saveProjectOfferGroup('combo-chance-clamp', { name: 'Alto', comboChance: 500 }, dir);
    assert.equal(clampedHigh.comboChance, 100);

    const { group: clampedLow } = await saveProjectOfferGroup('combo-chance-clamp', { name: 'Baixo', comboChance: -10 }, dir);
    assert.equal(clampedLow.comboChance, 0);

    const { group: set } = await saveProjectOfferGroup('combo-chance-clamp', { name: 'Definido', comboChance: 25 }, dir);
    assert.equal(set.comboChance, 25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central.test.js`
Expected: FAIL — `defaulted.comboChance` is `undefined`, not `0`.

- [ ] **Step 3: Write minimal implementation**

Current code at `src/content-central.js:7928`:

```js
function normalizeProjectOfferGroup(input, now = new Date(), existingGroups = []) {
  const name = String(input?.name || '').trim();
  if (!name) throw new Error('Nome do grupo é obrigatório');
  const id = String(input?.id || uniqueOfferGroupId(name, existingGroups)).trim();
  const createdAt = input?.createdAt || now.toISOString();
  return {
    id,
    name,
    createdAt,
    updatedAt: now.toISOString(),
  };
}
```

Replace with:

```js
function normalizeProjectOfferGroup(input, now = new Date(), existingGroups = []) {
  const name = String(input?.name || '').trim();
  if (!name) throw new Error('Nome do grupo é obrigatório');
  const id = String(input?.id || uniqueOfferGroupId(name, existingGroups)).trim();
  const createdAt = input?.createdAt || now.toISOString();
  // % chance (0-100) that a scheduled draw from this group pairs the offer
  // with a random same-group sibling into one combo arte instead of a
  // single-product post — see pickComboPartner. 0 (default) is the
  // unchanged single-product behavior.
  const comboChance = Math.max(0, Math.min(100, Math.round(Number(input?.comboChance)) || 0));
  return {
    id,
    name,
    comboChance,
    createdAt,
    updatedAt: now.toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/content-central.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): add comboChance field to offer groups"
```

---

### Task 2: Combo pairing logic in `nextSelectedOffer`

**Depends-on:** Task 1 (reads `comboChance` from `normalizeProjectOfferGroups`; same file, must land after Task 1's edit).

**Files:**
- Modify: `src/content-central.js` — `nextSelectedOffer` (`:5671-5681`), its 3 call sites (`:1792`, `:2921`, `:3141`), and two new functions added near `offerToContentTopic` (`:5753`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `normalizeProjectOfferGroups` (Task 1's `comboChance` field), `offerToContentTopic` (existing, unchanged).
- Produces: `nextSelectedOffer(rotator, weekday, targetDir, project)` — new 4th parameter `project`. Every caller must pass it. New internal helpers `pickComboPartner(offers, primary, project)` and `buildComboOfferTopic(a, b, targetDir)` (not exported — nothing outside this file calls them).

- [ ] **Step 1: Write the failing tests**

Append to `tests/content-central.test.js` (near the other `generateContentBatch`/offer-group tests, e.g. after the test block ending around line 5109):

```js
test('a group with comboChance=100 always pairs the drawn offer with a same-group sibling into one combo topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-pairing', name: 'Combo Pairing' }, dir);
    const { group } = await saveProjectOfferGroup('combo-pairing', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('combo-pairing', { name: 'Pizza Calabresa', price: 'R$45', groupId: group.id }, dir);
    await saveProjectOffer('combo-pairing', { name: 'Pizza Marguerita', price: 'R$50', groupId: group.id }, dir);

    const batch = await generateContentBatch('combo-pairing', {
      days: 1,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    const topic = batch.items[0].contentTopic;
    assert.equal(topic.type, 'combo');
    assert.ok(topic.offerName.includes('Pizza Calabresa'));
    assert.ok(topic.offerName.includes('Pizza Marguerita'));
    assert.ok(topic.notes.includes('R$45'));
    assert.ok(topic.notes.includes('R$50'));
  });
});

test('comboChance=100 with only one offer in the group falls back to a single-product topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-pairing-sozinho', name: 'Combo Pairing Sozinho' }, dir);
    const { group } = await saveProjectOfferGroup('combo-pairing-sozinho', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('combo-pairing-sozinho', { name: 'Pizza Única', price: 'R$45', groupId: group.id }, dir);

    const batch = await generateContentBatch('combo-pairing-sozinho', {
      days: 1,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    const topic = batch.items[0].contentTopic;
    assert.equal(topic.type, 'offer');
    assert.equal(topic.offerName, 'Pizza Única');
  });
});

test('an offer that is already type combo is never paired again even with comboChance=100', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-no-nest', name: 'Combo No Nest' }, dir);
    const { group } = await saveProjectOfferGroup('combo-no-nest', { name: 'Promos', comboChance: 100 }, dir);
    await saveProjectOffer('combo-no-nest', { name: 'Combo Família', type: 'combo', price: 'R$60', groupId: group.id }, dir);
    await saveProjectOffer('combo-no-nest', { name: 'Pizza Solo', price: 'R$45', groupId: group.id }, dir);

    const batch = await generateContentBatch('combo-no-nest', {
      days: 2,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    // Neither draw should become a synthetic merged topic (id pattern
    // "<a.id>+<b.id>") — "Combo Família" is already type combo (skips
    // pairing as the primary), and "Pizza Solo" has no eligible non-combo
    // partner to pair with (the only sibling is the combo itself).
    assert.ok(batch.items.every((item) => !String(item.contentTopic.id || '').includes('+')));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central.test.js`
Expected: FAIL on the first new test — topic stays `type: 'offer'` with a single product name (combo pairing doesn't exist yet). The other two currently pass trivially (nothing pairs today) but must keep passing after the implementation.

- [ ] **Step 3: Write minimal implementation**

Add two new functions right after `offerToContentTopic` (`src/content-central.js:5774`, i.e. right after its closing `}`):

```js
// Occasionally pairs the primary offer with a random same-group sibling
// into one combo arte, instead of always a single product per post — a
// large homogeneous catalog (e.g. 40 pizza flavors) otherwise reads as
// "always one product, one arte". Chance is per-group (see comboChance on
// normalizeProjectOfferGroup); 0/missing group = today's unchanged
// behavior. Never fires for an offer that is already a manual combo
// (type: 'combo') — combos never nest.
function pickComboPartner(offers, primary, project) {
  if (primary.type === 'combo' || !primary.groupId) return null;
  const group = normalizeProjectOfferGroups(project?.contentStrategy?.offerGroups || [])
    .find((entry) => entry.id === primary.groupId);
  const chance = group?.comboChance || 0;
  if (chance <= 0 || Math.random() * 100 >= chance) return null;
  const candidates = offers.filter((offer) => (
    offer.groupId === primary.groupId && offer.id !== primary.id && offer.type !== 'combo'
  ));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Builds a single synthetic "offer" pairing two real offers into one combo
// arte (see pickComboPartner), then delegates entirely to
// offerToContentTopic — so type: 'combo' resolution (objective, per-type
// learning, CTA) is the exact same code path a manually-created combo
// offer already uses. Price is never summed nor picked: both original
// prices are shown as separate text in `notes` instead.
async function buildComboOfferTopic(a, b, targetDir) {
  const priceLabel = (offer) => offer.price || 'sem preço informado';
  const merged = {
    id: `${a.id}+${b.id}`,
    name: `${a.name} + ${b.name}`,
    type: 'combo',
    price: '',
    items: [a.items, b.items].filter(Boolean).join(' | '),
    cta: '',
    autoGenerateCta: true,
    notes: [
      `${a.name} - ${priceLabel(a)} | ${b.name} - ${priceLabel(b)}`,
      a.notes,
      b.notes,
    ].filter(Boolean).join('\n'),
    productTreatment: a.productTreatment || b.productTreatment,
    layoutStrength: a.layoutStrength,
    pillarId: a.pillarId,
    photoReferenceIds: [...(a.photoReferenceIds || []), ...(b.photoReferenceIds || [])],
  };
  return offerToContentTopic(merged, targetDir);
}
```

Change `nextSelectedOffer` (`src/content-central.js:5671`) from:

```js
async function nextSelectedOffer(rotator, weekday, targetDir) {
  if (!rotator) return null;
  for (let index = 0; index < rotator.offers.length; index += 1) {
    const offer = rotator.offers[rotator.cursor % rotator.offers.length];
    rotator.cursor = normalizeTopicIndex(rotator.cursor + 1, rotator.offers.length);
    if (!weekday || !offer.daysOfWeek?.length || offer.daysOfWeek.includes(weekday)) {
      return offerToContentTopic(offer, targetDir);
    }
  }
  return null;
}
```

to:

```js
async function nextSelectedOffer(rotator, weekday, targetDir, project) {
  if (!rotator) return null;
  for (let index = 0; index < rotator.offers.length; index += 1) {
    const offer = rotator.offers[rotator.cursor % rotator.offers.length];
    rotator.cursor = normalizeTopicIndex(rotator.cursor + 1, rotator.offers.length);
    if (!weekday || !offer.daysOfWeek?.length || offer.daysOfWeek.includes(weekday)) {
      const partner = pickComboPartner(rotator.offers, offer, project);
      if (partner) return buildComboOfferTopic(offer, partner, targetDir);
      return offerToContentTopic(offer, targetDir);
    }
  }
  return null;
}
```

Update all 3 call sites to pass `project` as the 4th argument:

- `src/content-central.js:1792`: `await nextSelectedOffer(selectedOfferRotator, weekdayFromDate(scheduledDate), targetDir)` → `await nextSelectedOffer(selectedOfferRotator, weekdayFromDate(scheduledDate), targetDir, project)`
- `src/content-central.js:2921`: `await nextSelectedOffer(selectedOfferRotator, weekday, targetDir)` → `await nextSelectedOffer(selectedOfferRotator, weekday, targetDir, project)`
- `src/content-central.js:3141`: `await nextSelectedOffer(selectedOfferRotator, weekday, targetDir)` → `await nextSelectedOffer(selectedOfferRotator, weekday, targetDir, project)`

(All 3 sites already have a `project` variable in scope — each is inside a function that already calls `createSelectedOfferRotator(project, options)` a few lines above.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central.test.js`
Expected: PASS — including every pre-existing offer-rotation/group test (they all use `comboChance: 0`/absent, so behavior is byte-for-byte unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): pair same-group offers into combo artes by chance"
```

---

### Task 3: `comboChance` on the frontend API client

**Depends-on:** none (independent file from Tasks 1/2; can run in the same wave as Task 1).

**Files:**
- Modify: `content-central-app/src/api/client.ts:121-126` (`OfferGroup` interface), `:1004` (`saveOfferGroup`)

**Interfaces:**
- Produces: `OfferGroup.comboChance?: number`; `saveOfferGroup(projectId, input: { id?: string; name: string; comboChance?: number })`.

- [ ] **Step 1: Write the (type-level) failing check**

There's no dedicated test file for `client.ts` (it's thin fetch wrappers + types, verified by the TS build and by the consuming component's tests — see Task 4). Confirm the current type is missing the field:

Run: `npm --prefix content-central-app run build`
Expected: succeeds now (nothing references `comboChance` yet) — this step just captures the baseline before the change.

- [ ] **Step 2: Update the types**

In `content-central-app/src/api/client.ts`, change (`:121-126`):

```ts
export interface OfferGroup {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}
```

to:

```ts
export interface OfferGroup {
  id: string;
  name: string;
  comboChance?: number;
  createdAt?: string;
  updatedAt?: string;
}
```

And change (`:1004`):

```ts
export function saveOfferGroup(projectId: string, input: { id?: string; name: string }): Promise<{ project: ProjectSummary; group: OfferGroup }> {
```

to:

```ts
export function saveOfferGroup(projectId: string, input: { id?: string; name: string; comboChance?: number }): Promise<{ project: ProjectSummary; group: OfferGroup }> {
```

- [ ] **Step 3: Run the build to verify it still passes**

Run: `npm --prefix content-central-app run build`
Expected: PASS (no other file references `comboChance` yet, so this is a type-only addition — nothing can break). Note: `tsc --noEmit` alone does not reliably catch errors in this project; use `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add content-central-app/src/api/client.ts
git commit -m "feat(content-central-app): add comboChance to OfferGroup client type"
```

---

### Task 4: Combo % input in the offer-group editor UI

**Depends-on:** Task 3 (needs `OfferGroup.comboChance` and `saveOfferGroup`'s updated input type)

**Files:**
- Modify: `content-central-app/src/pages/workspace/Offers.tsx` (state block `:132-138`, handlers after `:272`, JSX `:480-494`)
- Test: `content-central-app/src/pages/workspace/Offers.test.tsx`

**Interfaces:**
- Consumes: `saveOfferGroup(projectId, { id, name, comboChance })` (Task 3), `OfferGroup.comboChance` (Task 3).
- Produces: nothing consumed by later tasks (final task in this plan).

- [ ] **Step 1: Write the failing test**

Append to `content-central-app/src/pages/workspace/Offers.test.tsx`, near the other group-management test (after the `it("creates an offer group, ...")` block):

```tsx
it("saves a group's combo % (chance of pairing two similar products in one arte) on blur", async () => {
  const pizzasGroup = { id: "pizzas", name: "Pizzas", comboChance: 0 };
  stubFetchSequence([
    {
      body: {
        projects: [{
          projectId: "boss-pizzaria",
          name: "Boss Pizzaria",
          contentStrategy: { offers: [], offerGroups: [pizzasGroup] },
        }],
        globalRules: {},
      },
    },
    { body: { project: {}, group: { ...pizzasGroup, comboChance: 30 } } },
  ]);
  renderOffers();

  await userEvent.click(await screen.findByRole("button", { name: "Grupos de ofertas" }));
  const comboInput = await screen.findByLabelText("Combo %");
  await userEvent.clear(comboInput);
  await userEvent.type(comboInput, "30");
  await userEvent.tab();

  const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
  expect(saveCall[0]).toBe("/api/projects/boss-pizzaria/offer-groups");
  const savedBody = JSON.parse(saveCall[1].body as string);
  expect(savedBody.id).toBe("pizzas");
  expect(savedBody.name).toBe("Pizzas");
  expect(savedBody.comboChance).toBe(30);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix content-central-app run test -- Offers.test.tsx`
Expected: FAIL — `screen.findByLabelText("Combo %")` finds nothing (input doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `content-central-app/src/pages/workspace/Offers.tsx`, add new state next to the existing group-editing state (`:132-138`):

```tsx
const [savingComboGroupId, setSavingComboGroupId] = useState<string | null>(null);
```

Add a new handler right after `handleSaveGroupName` (after its closing `}` around line 272):

```tsx
async function handleSaveComboChance(group: OfferGroup, rawValue: string) {
  const parsed = Math.max(0, Math.min(100, Math.round(Number(rawValue)) || 0));
  setSavingComboGroupId(group.id);
  setGroupError(null);
  try {
    await saveOfferGroup(project.projectId, { id: group.id, name: group.name, comboChance: parsed });
    await refreshProject();
  } catch (err) {
    setGroupError((err as Error).message);
  } finally {
    setSavingComboGroupId(null);
  }
}
```

In the group row's view-mode branch (`:480-494`), change:

```tsx
) : (
  <>
    <span className="pill" style={{ flex: 1, width: "max-content" }}>{group.name}</span>
    <Button type="button" variant="secondary" onClick={() => handleStartRenameGroup(group)}>
      Renomear
    </Button>
    <Button
      type="button"
      variant="ghost"
      disabled={deletingGroupId === group.id}
      onClick={() => handleDeleteGroup(group)}
    >
      {deletingGroupId === group.id ? "Apagando..." : "Apagar"}
    </Button>
  </>
)}
```

to:

```tsx
) : (
  <>
    <span className="pill" style={{ flex: 1, width: "max-content" }}>{group.name}</span>
    <label htmlFor={`combo-chance-${group.id}`} className="muted" style={{ fontSize: 12 }}>
      Combo %
    </label>
    <input
      id={`combo-chance-${group.id}`}
      type="number"
      min={0}
      max={100}
      defaultValue={group.comboChance ?? 0}
      disabled={savingComboGroupId === group.id}
      onBlur={(e) => handleSaveComboChance(group, e.target.value)}
      style={{ width: 64 }}
      title="Chance (0-100%) de juntar 2 produtos parecidos deste grupo na mesma arte"
    />
    <Button type="button" variant="secondary" onClick={() => handleStartRenameGroup(group)}>
      Renomear
    </Button>
    <Button
      type="button"
      variant="ghost"
      disabled={deletingGroupId === group.id}
      onClick={() => handleDeleteGroup(group)}
    >
      {deletingGroupId === group.id ? "Apagando..." : "Apagar"}
    </Button>
  </>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix content-central-app run test -- Offers.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full frontend build to catch type errors**

Run: `npm --prefix content-central-app run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add content-central-app/src/pages/workspace/Offers.tsx content-central-app/src/pages/workspace/Offers.test.tsx
git commit -m "feat(content-central-app): edit combo % per offer group"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section has a task — data model (Task 1), selection logic + merge (Task 2), image/template reuse (no code, verified by Task 2's tests exercising the real `generateContentBatch` path which already enforces the mandatory-template rule), frontend (Tasks 3-4).
- **Type consistency:** `nextSelectedOffer`'s new 4th param is named `project` everywhere (Task 2's 3 call sites + signature); `OfferGroup.comboChance` (Task 3) matches the field name read in Task 2's `pickComboPartner` and written in Task 1's `normalizeProjectOfferGroup`.
- **Out of scope**, unchanged from the spec: 3+ product combos, similarity beyond `groupId`, applying this to `buildTopicPool`'s goal/pillar path, computed/editable combo prices.
