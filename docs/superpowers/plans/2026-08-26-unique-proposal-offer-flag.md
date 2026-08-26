# Unique-Proposal Offer Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator flag an individual offer as a "unique proposal" so it never takes part in combo pairing — neither as the primary offer pulling in a partner, nor as another offer's partner.

**Architecture:** A new `uniqueProposal` boolean field on the offer (default `false`, fully backward compatible), read by two guard clauses already inside `pickComboPartner` (the function shipped by the combo-pairing feature). Frontend: a checkbox in the offer form, a pill in the offer list, and the matching API client types.

**Tech Stack:** Node.js backend (`src/content-central.js`, `node:test`), React + TypeScript frontend (`content-central-app`, Vitest + Testing Library).

## Global Constraints

- Default `false` — every existing offer stays exactly as combo-eligible as it is today.
- The flag blocks the offer in BOTH roles: as the primary offer (never pulls in a partner) and as a candidate (never picked as someone else's partner).
- No group-level change, no new HTTP route — `saveProjectOffer`/the `offers` route already pass raw input straight through to `normalizeProjectOffer`.

Spec: `docs/superpowers/specs/2026-08-26-unique-proposal-offer-flag-design.md`.

---

### Task 1: `uniqueProposal` field + combo-pairing guards (backend)

**Files:**
- Modify: `src/content-central.js:7863-7906` (`normalizeProjectOffer`), `src/content-central.js:5793-5804` (`pickComboPartner`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `normalizeProjectOffer(...)` returns a `uniqueProposal: boolean` field. `pickComboPartner` respects it in both roles — no signature change.

- [ ] **Step 1: Write the failing tests**

Append to `tests/content-central.test.js`, near the other combo-pairing tests (search for `'a group with comboChance=100 always pairs the drawn offer'`):

```js
test('an offer flagged uniqueProposal never pulls in a combo partner, even at comboChance=100', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'unique-proposal-primary', name: 'Unique Proposal Primary' }, dir);
    const { group } = await saveProjectOfferGroup('unique-proposal-primary', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('unique-proposal-primary', { name: 'Pizza Exclusiva', price: 'R$60', groupId: group.id, uniqueProposal: true }, dir);
    await saveProjectOffer('unique-proposal-primary', { name: 'Pizza Comum', price: 'R$45', groupId: group.id }, dir);

    const batch = await generateContentBatch('unique-proposal-primary', {
      days: 2,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    const exclusiva = batch.items.find((item) => item.contentTopic.offerName === 'Pizza Exclusiva');
    assert.ok(exclusiva, 'Pizza Exclusiva should still be drawn on its own turn');
    assert.equal(exclusiva.contentTopic.type, 'offer');
  });
});

test('an offer flagged uniqueProposal is never picked as another offer\'s combo partner, even at comboChance=100', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'unique-proposal-partner', name: 'Unique Proposal Partner' }, dir);
    const { group } = await saveProjectOfferGroup('unique-proposal-partner', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('unique-proposal-partner', { name: 'Pizza Comum', price: 'R$45', groupId: group.id }, dir);
    await saveProjectOffer('unique-proposal-partner', { name: 'Pizza Exclusiva', price: 'R$60', groupId: group.id, uniqueProposal: true }, dir);

    const batch = await generateContentBatch('unique-proposal-partner', {
      days: 2,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    // "Pizza Comum" is the only non-flagged offer in the group, so its only
    // possible partner is the flagged "Pizza Exclusiva" — with that excluded,
    // no combo topic can ever be produced.
    assert.ok(batch.items.every((item) => item.contentTopic.type !== 'combo'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central.test.js`
Expected: FAIL on both new tests — `uniqueProposal` doesn't exist yet, so `pickComboPartner` ignores it and both tests observe a combo topic where they shouldn't.

- [ ] **Step 3: Write minimal implementation**

In `normalizeProjectOffer` (`src/content-central.js:7863`), add the field to the returned object (anywhere among the other boolean/simple fields, e.g. right after `active`):

```js
    active: input?.active === false ? false : true,
    // A unique/flagship product the operator never wants blended into a
    // combo arte with another product — blocks it in both combo-pairing
    // roles (see pickComboPartner). Default false: every existing offer
    // stays exactly as combo-eligible as it is today.
    uniqueProposal: input?.uniqueProposal === true,
```

In `pickComboPartner` (`src/content-central.js:5793`), change:

```js
function pickComboPartner(offers, primary, project, weekday) {
  if (primary.type === 'combo' || !primary.groupId) return null;
  const group = normalizeProjectOfferGroups(project?.contentStrategy?.offerGroups || [])
    .find((entry) => entry.id === primary.groupId);
  const chance = group?.comboChance || 0;
  if (chance <= 0 || Math.random() * 100 >= chance) return null;
  const candidates = offers.filter((offer) => (
    offer.groupId === primary.groupId && offer.id !== primary.id && offer.type !== 'combo' && fitsWeekday(offer, weekday)
  ));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
```

to:

```js
function pickComboPartner(offers, primary, project, weekday) {
  if (primary.type === 'combo' || primary.uniqueProposal || !primary.groupId) return null;
  const group = normalizeProjectOfferGroups(project?.contentStrategy?.offerGroups || [])
    .find((entry) => entry.id === primary.groupId);
  const chance = group?.comboChance || 0;
  if (chance <= 0 || Math.random() * 100 >= chance) return null;
  const candidates = offers.filter((offer) => (
    offer.groupId === primary.groupId && offer.id !== primary.id && offer.type !== 'combo'
    && !offer.uniqueProposal && fitsWeekday(offer, weekday)
  ));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central.test.js`
Expected: PASS — all tests including the full pre-existing suite (no regressions; default `false` means every offer without the field behaves exactly as before).

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): add uniqueProposal flag to exclude an offer from combo pairing"
```

---

### Task 2: `uniqueProposal` on the frontend API client

**Depends-on:** none (independent file from Task 1; can run in the same wave).

**Files:**
- Modify: `content-central-app/src/api/client.ts:86-102` (`ProjectOffer`), `:963-979` (`SaveOfferInput`)

**Interfaces:**
- Produces: `ProjectOffer.uniqueProposal?: boolean`; `SaveOfferInput.uniqueProposal?: boolean`.

- [ ] **Step 1: Write the (type-level) failing check**

No dedicated test file for `client.ts` (thin types + fetch wrappers, verified by the build and by Task 3's component tests). Run: `npm --prefix content-central-app run build` — confirm it currently passes (baseline before the change).

- [ ] **Step 2: Update the types**

In `content-central-app/src/api/client.ts`, change (`:86-102`):

```ts
export interface ProjectOffer {
  id: string;
  name: string;
  type: string;
  price?: string;
  items?: string;
  cta?: string;
  autoGenerateCta?: boolean;
  notes?: string;
  active?: boolean;
  pillarId?: string | null;
  groupId?: string | null;
  daysOfWeek?: string[];
  photoReferenceIds?: string[];
  productTreatment?: "faithful_enhance" | "creative_redraw" | "exact_asset" | "";
  layoutStrength?: "strict" | "balanced" | "free" | "";
}
```

to:

```ts
export interface ProjectOffer {
  id: string;
  name: string;
  type: string;
  price?: string;
  items?: string;
  cta?: string;
  autoGenerateCta?: boolean;
  notes?: string;
  active?: boolean;
  uniqueProposal?: boolean;
  pillarId?: string | null;
  groupId?: string | null;
  daysOfWeek?: string[];
  photoReferenceIds?: string[];
  productTreatment?: "faithful_enhance" | "creative_redraw" | "exact_asset" | "";
  layoutStrength?: "strict" | "balanced" | "free" | "";
}
```

And change (`:963-979`):

```ts
export interface SaveOfferInput {
  id?: string;
  name: string;
  type: string;
  price?: string;
  items?: string;
  cta?: string;
  autoGenerateCta?: boolean;
  notes?: string;
  pillarId?: string | null;
  groupId?: string | null;
  daysOfWeek?: string[];
  active?: boolean;
  photoReferenceIds?: string[];
  productTreatment?: "faithful_enhance" | "creative_redraw" | "exact_asset" | "";
  layoutStrength?: "strict" | "balanced" | "free" | "";
}
```

to:

```ts
export interface SaveOfferInput {
  id?: string;
  name: string;
  type: string;
  price?: string;
  items?: string;
  cta?: string;
  autoGenerateCta?: boolean;
  notes?: string;
  pillarId?: string | null;
  groupId?: string | null;
  daysOfWeek?: string[];
  active?: boolean;
  uniqueProposal?: boolean;
  photoReferenceIds?: string[];
  productTreatment?: "faithful_enhance" | "creative_redraw" | "exact_asset" | "";
  layoutStrength?: "strict" | "balanced" | "free" | "";
}
```

- [ ] **Step 3: Run the build to verify it still passes**

Run: `npm --prefix content-central-app run build`
Expected: PASS. Note: this project's `tsc --noEmit` alone does not reliably catch type errors — always use `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add content-central-app/src/api/client.ts
git commit -m "feat(content-central-app): add uniqueProposal to offer client types"
```

---

### Task 3: "Proposta única" checkbox in the offer form + list pill

**Depends-on:** Task 2 (needs `ProjectOffer.uniqueProposal` / `SaveOfferInput.uniqueProposal`)

**Files:**
- Modify: `content-central-app/src/pages/workspace/Offers.tsx:42-57` (`EMPTY_FORM`), `:364-384` (`handleEdit`), `:737-745` (form checkbox area), `:900-917` (list pills)
- Test: `content-central-app/src/pages/workspace/Offers.test.tsx`

**Interfaces:**
- Consumes: `ProjectOffer.uniqueProposal`, `SaveOfferInput.uniqueProposal` (Task 2).
- Produces: nothing consumed by later tasks (final task in this plan).

- [ ] **Step 1: Write the failing test**

Append to `content-central-app/src/pages/workspace/Offers.test.tsx`, near the other offer-creation test (after `it("creates a new offer through the real endpoint and shows it in the list", ...)`):

```tsx
it("saves an offer flagged as a unique proposal (never combined into a combo) and shows a pill for it", async () => {
  const uniqueOffer = { ...RODIZIO_OFFER, name: "Pizza Exclusiva", uniqueProposal: true };
  stubFetchSequence([
    { body: projectState() },
    { body: { project: {}, offer: uniqueOffer } },
    { body: projectState([uniqueOffer]) },
  ]);
  renderOffers();

  await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
  await userEvent.click(screen.getByRole("button", { name: "+ Nova oferta/assunto" }));
  await userEvent.type(screen.getByLabelText("Nome"), "Pizza Exclusiva");
  await userEvent.click(screen.getByLabelText("Proposta única (nunca combinar)"));
  await userEvent.click(screen.getByRole("button", { name: "Salvar oferta/assunto" }));

  await screen.findByRole("button", { name: /Sem grupo/ });
  await expandSection("Sem grupo");
  expect(await screen.findByText("Pizza Exclusiva")).toBeInTheDocument();
  expect(await screen.findByText("proposta única")).toBeInTheDocument();

  const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
  const payload = JSON.parse(saveCall[1].body as string);
  expect(payload.uniqueProposal).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/workspace/Offers.test.tsx` (from `content-central-app/`)
Expected: FAIL — `screen.getByLabelText("Proposta única (nunca combinar)")` finds nothing (checkbox doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `content-central-app/src/pages/workspace/Offers.tsx`:

`EMPTY_FORM` (`:42-57`), add after `active: true,`:

```tsx
const EMPTY_FORM = {
  name: "",
  type: "offer",
  price: "",
  items: "",
  cta: "",
  autoGenerateCta: false,
  notes: "",
  pillarId: "",
  groupId: "",
  daysOfWeek: [] as string[],
  active: true,
  uniqueProposal: false,
  photoReferenceIds: [] as string[],
  productTreatment: "faithful_enhance" as ProductTreatment,
  layoutStrength: "strict" as "strict" | "balanced" | "free",
};
```

`handleEdit` (`:364-384`), add `uniqueProposal: offer.uniqueProposal || false,` right after `active: offer.active !== false,`:

```tsx
  function handleEdit(offer: ProjectOffer) {
    setEditingId(offer.id);
    setForm({
      name: offer.name,
      type: offer.type,
      price: offer.price || "",
      items: offer.items || "",
      cta: offer.cta || "",
      autoGenerateCta: offer.autoGenerateCta || false,
      notes: offer.notes || "",
      pillarId: offer.pillarId || "",
      groupId: offer.groupId || "",
      daysOfWeek: offer.daysOfWeek || [],
      active: offer.active !== false,
      uniqueProposal: offer.uniqueProposal || false,
      photoReferenceIds: offer.photoReferenceIds || [],
      productTreatment: offer.productTreatment === "exact_asset" || offer.productTreatment === "creative_redraw"
        ? offer.productTreatment
        : "faithful_enhance",
      layoutStrength: offer.layoutStrength === "balanced" || offer.layoutStrength === "free" ? offer.layoutStrength : "strict",
    });
```

Form checkbox area (`:737-745`), change:

```tsx
            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 0" }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto" }}
              />
              {isCatalog ? "Em estoque (entra na rotação de posts)" : "Ativo (entra nas próximas gerações)"}
            </label>
```

to:

```tsx
            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 0" }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto" }}
              />
              {isCatalog ? "Em estoque (entra na rotação de posts)" : "Ativo (entra nas próximas gerações)"}
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 0" }}>
              <input
                type="checkbox"
                checked={form.uniqueProposal}
                onChange={(e) => setForm({ ...form, uniqueProposal: e.target.checked })}
                style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto" }}
              />
              Proposta única (nunca combinar)
            </label>
```

List pills (`:900-917`), change:

```tsx
                            {offer.daysOfWeek?.length ? (
                              <span className="pill">
                                {offer.daysOfWeek.map((day) => WEEKDAY_LABELS[day] || day).join(", ")}
                              </span>
                            ) : null}
```

to:

```tsx
                            {offer.daysOfWeek?.length ? (
                              <span className="pill">
                                {offer.daysOfWeek.map((day) => WEEKDAY_LABELS[day] || day).join(", ")}
                              </span>
                            ) : null}
                            {offer.uniqueProposal ? <span className="pill">proposta única</span> : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/workspace/Offers.test.tsx` (from `content-central-app/`)
Expected: PASS — all tests in the file (existing 18 + this new one = 19).

- [ ] **Step 5: Run the full frontend build to catch type errors**

Run: `npm --prefix content-central-app run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add content-central-app/src/pages/workspace/Offers.tsx content-central-app/src/pages/workspace/Offers.test.tsx
git commit -m "feat(content-central-app): add unique-proposal checkbox and list pill to offer form"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), selection-logic guards in both roles (Task 1), frontend types (Task 2), form checkbox + list pill (Task 3) — every spec section has a task.
- **Type consistency:** `uniqueProposal` is the field name everywhere — `normalizeProjectOffer` (Task 1), `ProjectOffer`/`SaveOfferInput` (Task 2), `EMPTY_FORM`/`handleEdit`/checkbox/pill (Task 3).
- **Out of scope**, unchanged from the spec: no group-level "block all combos" toggle (already covered by `comboChance: 0`), no bulk-flagging UI.
