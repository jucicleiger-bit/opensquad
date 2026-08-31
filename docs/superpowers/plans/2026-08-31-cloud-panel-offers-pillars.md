# Cloud Panel Offers + Pillars — Fase 3b-ii Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring a project's offers, offer groups, and pillars into Supabase, migrate the 9 already-migrated projects' existing local data, and add an "Ofertas e Pilares" page to `cloud-panel-app` with CRUD for all three.

**Architecture:** 1 new `content_strategy jsonb` column on `projects`, holding `{ offers, offerGroups, pillars }` — same whole-object-in-one-column pattern as Fase 3b-i's `company_profile`/`brand_xray`/`brand_briefing`. `src/migrate-to-supabase.js`'s existing `migrateCompanyBrandData` (already reads each project's `project.json` and updates its Supabase row) is extended to also normalize and write these three arrays. `cloud-panel-app` gets pure array-CRUD helpers (add/update/remove-by-id, always preserving fields the form doesn't touch) and an "Ofertas e Pilares" page built on them.

## Global Constraints

- No new relational tables — offers/offerGroups/pillars are arrays inside one jsonb column, mirroring how the local system itself stores them inside `project.contentStrategy` (never separate files).
- Editing an item never reconstructs it from scratch — always `{ ...existingItem, ...formFields }`, so fields the cloud form doesn't expose (e.g. `daysOfWeek`, `photoReferenceIds`) survive untouched.
- Deleting an offer group does not delete offers that belong to it — same as the local `deleteProjectOfferGroup` behavior (orphaned offers just fall out of generation rotation, they aren't removed).
- New item IDs are generated client-side with `crypto.randomUUID()` (native browser API) — no new dependency.
- Migration is idempotent (same convention as every prior phase).

---

### Task 1: Schema — content_strategy column

**Files:**
- Create: `supabase/migrations/0004_content_strategy.sql`

**Interfaces:**
- Consumes: the `projects` table from Fase 1.
- Produces: `projects.content_strategy jsonb` — Tasks 2 and 4 read/write it by name.

No automated test (SQL file, same convention as every prior schema task).

- [ ] **Step 1: write the migration SQL**

```sql
-- supabase/migrations/0004_content_strategy.sql

alter table projects add column if not exists content_strategy jsonb not null default '{}'::jsonb;

-- Rollback (manual, run by hand if needed — not auto-executed):
-- alter table projects drop column if exists content_strategy;
```

- [ ] **Step 2: apply the migration**

Paste into the Supabase Dashboard's SQL Editor and run it against the real project.

- [ ] **Step 3: verify manually**

Confirm the column exists (`select content_strategy from projects limit 1;` returns `{}` on an unmigrated row).

- [ ] **Step 4: commit**

```bash
git add supabase/migrations/0004_content_strategy.sql
git commit -m "feat: add content_strategy column to projects"
```

---

### Task 2: Migration script — offers/groups/pillars

**Files:**
- Modify: `src/content-central.js` (export 3 existing functions — no behavior change)
- Modify: `src/migrate-to-supabase.js`
- Modify: `tests/migrate-to-supabase.test.js`

**Interfaces:**
- Consumes: `normalizeProjectOffers`, `normalizeProjectOfferGroups`, `normalizeProjectPillars` (now exported from `content-central.js`).
- Produces: `migrateCompanyBrandData` (already exists from Fase 3b-i) now also writes `content_strategy` on the same row update — no new exported function, no signature change.

- [ ] **Step 1: export the three normalize functions**

In `src/content-central.js`, add `export` to these three existing declarations — nothing else about them changes:

```js
// line ~7676 — change:
function normalizeProjectOffers(offers) {
// to:
export function normalizeProjectOffers(offers) {
```

```js
// line ~8565 — change:
function normalizeProjectPillars(pillars) {
// to:
export function normalizeProjectPillars(pillars) {
```

```js
// line ~8642 — change:
function normalizeProjectOfferGroups(groups) {
// to:
export function normalizeProjectOfferGroups(groups) {
```

- [ ] **Step 2: write the failing test**

```js
// append to tests/migrate-to-supabase.test.js
test('migrateCompanyBrandData also normalizes and writes content_strategy (offers/offerGroups/pillars)', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-strategy-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      companyProfile: {},
      brandXray: {},
      brandBriefing: {},
      contentStrategy: {
        offers: [{ id: 'offer-1', name: 'Rodízio', type: 'rodizio', price: 'R$ 49,90', items: '', cta: '', notes: '', active: true, pillarId: null, groupId: null }],
        offerGroups: [{ id: 'group-1', name: 'Geral', comboChance: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
        pillars: [{ id: 'pillar-1', name: 'Prova social', role: 'prova', objective: '', visualTreatment: 'leve', color: '#7C7C7C', weight: 1, requiresEvidence: true, active: true }],
      },
    }),
  );

  const client = fakeClientForCompanyBrand();
  const result = await migrateCompanyBrandData(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].patch.content_strategy.offers.length, 1);
  assert.equal(client.updates[0].patch.content_strategy.offers[0].name, 'Rodízio');
  assert.equal(client.updates[0].patch.content_strategy.offerGroups[0].name, 'Geral');
  assert.equal(client.updates[0].patch.content_strategy.pillars[0].name, 'Prova social');

  await rm(targetDir, { recursive: true, force: true });
});
```

- [ ] **Step 3: run test to verify it fails**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: FAIL — `content_strategy` not present in the update patch (the field doesn't exist yet).

- [ ] **Step 4: write the implementation**

```js
// update the import line near the top of src/migrate-to-supabase.js:
import { getCentralPaths, normalizeCompanyProfile, normalizeBrandXray, normalizeBrandBriefing, normalizeProjectOffers, normalizeProjectOfferGroups, normalizeProjectPillars } from './content-central.js';
```

```js
// replace migrateCompanyBrandData's update() call body in src/migrate-to-supabase.js with:
  const { error } = await client
    .from('projects')
    .update({
      company_profile: normalizeCompanyProfile(project.companyProfile),
      brand_xray: normalizeBrandXray(project.brandXray),
      brand_briefing: normalizeBrandBriefing(project.brandBriefing),
      content_strategy: {
        offers: normalizeProjectOffers(project.contentStrategy?.offers),
        offerGroups: normalizeProjectOfferGroups(project.contentStrategy?.offerGroups),
        pillars: normalizeProjectPillars(project.contentStrategy?.pillars),
      },
    })
    .eq('slug', slug);
```

(everything else in `migrateCompanyBrandData` — the `project.json not found` guard, the error handling, the return shape — stays exactly as it is; this only adds the one new key to the object passed to `.update()`.)

- [ ] **Step 5: run test to verify it passes**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: PASS (all tests, including the new one)

- [ ] **Step 6: run the full existing suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (same one known pre-existing, unrelated SPA-fallback failure as every prior phase).

- [ ] **Step 7: commit**

```bash
git add src/content-central.js src/migrate-to-supabase.js tests/migrate-to-supabase.test.js
git commit -m "feat: migrate offers/offerGroups/pillars to Supabase"
```

- [ ] **Step 8 (manual, controller-run): run it for real**

With `.env` pointed at the real Supabase project, run `npm run migrate:supabase` and confirm "Company/brand data migrated: 9 (0 errors)" (same line as Fase 3b-i — this task doesn't add a new counter, it's folded into the same migration pass).

---

### Task 3: Pure array-CRUD helpers

**Files:**
- Create: `cloud-panel-app/src/lib/contentStrategy.ts`
- Create: `cloud-panel-app/tests/contentStrategy.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `upsertById<T extends { id: string }>(list: T[], item: T): T[]` (adds if `id` isn't present, replaces in place if it is — used for both create and edit); `removeById<T extends { id: string }>(list: T[], id: string): T[]`. Task 4 imports both, calling them on `content_strategy.offers`/`.offerGroups`/`.pillars` before writing the whole `content_strategy` object back.

- [ ] **Step 1: write the failing tests**

```ts
// cloud-panel-app/tests/contentStrategy.test.ts
import { describe, it, expect } from "vitest";
import { upsertById, removeById } from "../src/lib/contentStrategy";

interface Item { id: string; name: string; extra?: string }

describe("upsertById", () => {
  it("appends a new item when its id isn't in the list", () => {
    const list: Item[] = [{ id: "a", name: "A" }];
    const result = upsertById(list, { id: "b", name: "B" });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ id: "b", name: "B" });
  });

  it("replaces the item in place (same position) when its id already exists", () => {
    const list: Item[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    const result = upsertById(list, { id: "a", name: "A updated" });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "a", name: "A updated" });
    expect(result[1]).toEqual({ id: "b", name: "B" });
  });

  it("does not mutate the input list", () => {
    const list: Item[] = [{ id: "a", name: "A" }];
    upsertById(list, { id: "a", name: "changed" });
    expect(list[0].name).toBe("A");
  });
});

describe("removeById", () => {
  it("removes the matching item", () => {
    const list: Item[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    const result = removeById(list, "a");
    expect(result).toEqual([{ id: "b", name: "B" }]);
  });

  it("returns an equivalent list when the id isn't found", () => {
    const list: Item[] = [{ id: "a", name: "A" }];
    const result = removeById(list, "nope");
    expect(result).toEqual(list);
  });
});
```

- [ ] **Step 2: run tests to verify they fail**

Run: `cd cloud-panel-app && npx vitest run tests/contentStrategy.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: write the implementation**

```ts
// cloud-panel-app/src/lib/contentStrategy.ts
export function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...list, item];
  const next = [...list];
  next[index] = item;
  return next;
}

export function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}
```

- [ ] **Step 4: run tests to verify they pass**

Run: `cd cloud-panel-app && npx vitest run tests/contentStrategy.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: commit**

```bash
git add cloud-panel-app/src/lib/contentStrategy.ts cloud-panel-app/tests/contentStrategy.test.ts
git commit -m "feat: add pure array-CRUD helpers for content strategy"
```

---

### Task 4: Offers and Pillars page

**Files:**
- Create: `cloud-panel-app/src/pages/OffersAndPillars.tsx`
- Modify: `cloud-panel-app/src/App.tsx`
- Modify: `cloud-panel-app/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `supabase` (Fase 3a), `RequireAuth` (Fase 3a), `upsertById`/`removeById` (Task 3).
- Produces: `/projects/:projectId/ofertas` route.

- [ ] **Step 1: write the page**

```tsx
// cloud-panel-app/src/pages/OffersAndPillars.tsx
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";

interface OfferGroup {
  id: string;
  name: string;
  comboChance: number;
  createdAt: string;
  updatedAt: string;
}

interface Offer {
  id: string;
  name: string;
  type: string;
  price: string;
  items: string;
  cta: string;
  notes: string;
  active: boolean;
  pillarId: string | null;
  groupId: string | null;
  [key: string]: unknown;
}

interface Pillar {
  id: string;
  name: string;
  role: string;
  objective: string;
  visualTreatment: string;
  color: string;
  weight: number;
  active: boolean;
  [key: string]: unknown;
}

interface ContentStrategy {
  offers: Offer[];
  offerGroups: OfferGroup[];
  pillars: Pillar[];
}

const EMPTY_STRATEGY: ContentStrategy = { offers: [], offerGroups: [], pillars: [] };

const OFFER_TYPES: Array<[string, string]> = [
  ["offer", "Oferta direta"], ["service", "Serviço"], ["combo", "Combo / promoção"],
  ["rodizio", "Rodízio"], ["delivery", "Delivery"], ["product", "Produto destaque"],
  ["orientation", "Post de orientação"], ["desire", "Post de desejo"],
  ["urgency", "Urgência / hoje tem"], ["institutional", "Institucional"],
  ["social_proof", "Prova social"],
];

const PILLAR_ROLES: Array<[string, string]> = [
  ["ensina", "Ensina"], ["prova", "Prova"], ["posiciona", "Posiciona"], ["convida", "Convida"],
];

const PILLAR_VISUAL_TREATMENTS: Array<[string, string]> = [
  ["cru", "Cru"], ["leve", "Leve"], ["desenhado", "Desenhado"],
];

export function OffersAndPillars() {
  const { projectId } = useParams<{ projectId: string }>();
  const [strategy, setStrategy] = useState<ContentStrategy>(EMPTY_STRATEGY);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const [offerDraft, setOfferDraft] = useState<Offer | null>(null);
  const [pillarDraft, setPillarDraft] = useState<Pillar | null>(null);
  const [groupDraft, setGroupDraft] = useState<OfferGroup | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("content_strategy")
      .eq("id", projectId)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    const raw = data.content_strategy;
    setStrategy({
      offers: Array.isArray(raw?.offers) ? raw.offers : [],
      offerGroups: Array.isArray(raw?.offerGroups) ? raw.offerGroups : [],
      pillars: Array.isArray(raw?.pillars) ? raw.pillars : [],
    });
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function persist(next: ContentStrategy) {
    setBusy(true);
    const { error: updateError } = await supabase.from("projects").update({ content_strategy: next }).eq("id", projectId);
    if (updateError) {
      setError(updateError.message);
    } else {
      setStrategy(next);
    }
    setBusy(false);
  }

  function newOfferDraft(): Offer {
    return {
      id: crypto.randomUUID(), name: "", type: "offer", price: "", items: "",
      cta: "", notes: "", active: true, pillarId: null, groupId: null,
    };
  }
  function newPillarDraft(): Pillar {
    return {
      id: crypto.randomUUID(), name: "", role: "ensina", objective: "",
      visualTreatment: "leve", color: "#7C7C7C", weight: 1, active: true,
    };
  }
  function newGroupDraft(): OfferGroup {
    return { id: crypto.randomUUID(), name: "", comboChance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  async function saveOffer(e: FormEvent) {
    e.preventDefault();
    if (!offerDraft || !offerDraft.name.trim()) return;
    await persist({ ...strategy, offers: upsertById(strategy.offers, offerDraft) });
    setOfferDraft(null);
  }
  async function savePillar(e: FormEvent) {
    e.preventDefault();
    if (!pillarDraft || !pillarDraft.name.trim()) return;
    await persist({ ...strategy, pillars: upsertById(strategy.pillars, pillarDraft) });
    setPillarDraft(null);
  }
  async function saveGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupDraft || !groupDraft.name.trim()) return;
    await persist({ ...strategy, offerGroups: upsertById(strategy.offerGroups, { ...groupDraft, updatedAt: new Date().toISOString() }) });
    setGroupDraft(null);
  }

  async function deleteOffer(id: string) {
    await persist({ ...strategy, offers: removeById(strategy.offers, id) });
  }
  async function deletePillar(id: string) {
    await persist({ ...strategy, pillars: removeById(strategy.pillars, id) });
  }
  async function deleteGroup(id: string) {
    await persist({ ...strategy, offerGroups: removeById(strategy.offerGroups, id) });
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded) return <div className="card">Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Ofertas e Pilares</h1>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Grupos de ofertas</h2>
        {strategy.offerGroups.map((group) => (
          <div key={group.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{group.name} — combo {group.comboChance}%</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setGroupDraft(group)}>Editar</button>
              <button type="button" className="danger" onClick={() => deleteGroup(group.id)} disabled={busy}>Apagar</button>
            </div>
          </div>
        ))}
        {groupDraft ? (
          <form onSubmit={saveGroup} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="text" placeholder="Nome do grupo" value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} required />
            <label>
              Chance de combo (%)
              <input type="number" min={0} max={100} value={groupDraft.comboChance} onChange={(e) => setGroupDraft({ ...groupDraft, comboChance: Number(e.target.value) })} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="primary" disabled={busy}>Salvar</button>
              <button type="button" onClick={() => setGroupDraft(null)}>Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setGroupDraft(newGroupDraft())}>+ Novo grupo</button>
        )}
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Ofertas</h2>
        {strategy.offers.map((offer) => (
          <div key={offer.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{offer.name} ({offer.type}) {offer.active ? "" : "— inativa"}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setOfferDraft(offer)}>Editar</button>
              <button type="button" className="danger" onClick={() => deleteOffer(offer.id)} disabled={busy}>Apagar</button>
            </div>
          </div>
        ))}
        {offerDraft ? (
          <form onSubmit={saveOffer} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="text" placeholder="Nome" value={offerDraft.name} onChange={(e) => setOfferDraft({ ...offerDraft, name: e.target.value })} required />
            <select value={offerDraft.type} onChange={(e) => setOfferDraft({ ...offerDraft, type: e.target.value })}>
              {OFFER_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="text" placeholder="Preço" value={offerDraft.price} onChange={(e) => setOfferDraft({ ...offerDraft, price: e.target.value })} />
            <input type="text" placeholder="Itens" value={offerDraft.items} onChange={(e) => setOfferDraft({ ...offerDraft, items: e.target.value })} />
            <input type="text" placeholder="CTA" value={offerDraft.cta} onChange={(e) => setOfferDraft({ ...offerDraft, cta: e.target.value })} />
            <textarea placeholder="Notas" value={offerDraft.notes} onChange={(e) => setOfferDraft({ ...offerDraft, notes: e.target.value })} />
            <select value={offerDraft.groupId || ""} onChange={(e) => setOfferDraft({ ...offerDraft, groupId: e.target.value || null })}>
              <option value="">Sem grupo</option>
              {strategy.offerGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={offerDraft.pillarId || ""} onChange={(e) => setOfferDraft({ ...offerDraft, pillarId: e.target.value || null })}>
              <option value="">Sem pilar</option>
              {strategy.pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label>
              <input type="checkbox" checked={offerDraft.active} onChange={(e) => setOfferDraft({ ...offerDraft, active: e.target.checked })} /> Ativa
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="primary" disabled={busy}>Salvar</button>
              <button type="button" onClick={() => setOfferDraft(null)}>Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setOfferDraft(newOfferDraft())}>+ Nova oferta</button>
        )}
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Pilares</h2>
        {strategy.pillars.map((pillar) => (
          <div key={pillar.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: pillar.color, marginRight: 6 }} />
              {pillar.name} ({pillar.role}) {pillar.active ? "" : "— inativo"}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setPillarDraft(pillar)}>Editar</button>
              <button type="button" className="danger" onClick={() => deletePillar(pillar.id)} disabled={busy}>Apagar</button>
            </div>
          </div>
        ))}
        {pillarDraft ? (
          <form onSubmit={savePillar} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="text" placeholder="Nome" value={pillarDraft.name} onChange={(e) => setPillarDraft({ ...pillarDraft, name: e.target.value })} required />
            <select value={pillarDraft.role} onChange={(e) => setPillarDraft({ ...pillarDraft, role: e.target.value })}>
              {PILLAR_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="text" placeholder="Objetivo" value={pillarDraft.objective} onChange={(e) => setPillarDraft({ ...pillarDraft, objective: e.target.value })} />
            <select value={pillarDraft.visualTreatment} onChange={(e) => setPillarDraft({ ...pillarDraft, visualTreatment: e.target.value })}>
              {PILLAR_VISUAL_TREATMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label>
              Cor
              <input type="color" value={pillarDraft.color} onChange={(e) => setPillarDraft({ ...pillarDraft, color: e.target.value })} />
            </label>
            <label>
              Peso
              <input type="number" min={1} value={pillarDraft.weight} onChange={(e) => setPillarDraft({ ...pillarDraft, weight: Math.max(1, Number(e.target.value)) })} />
            </label>
            <label>
              <input type="checkbox" checked={pillarDraft.active} onChange={(e) => setPillarDraft({ ...pillarDraft, active: e.target.checked })} /> Ativo
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="primary" disabled={busy}>Salvar</button>
              <button type="button" onClick={() => setPillarDraft(null)}>Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setPillarDraft(newPillarDraft())}>+ Novo pilar</button>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: wire the route**

```tsx
// cloud-panel-app/src/App.tsx — add the import and route
import { OffersAndPillars } from "@/pages/OffersAndPillars";
// ...
<Route
  path="/projects/:projectId/ofertas"
  element={
    <RequireAuth>
      <OffersAndPillars />
    </RequireAuth>
  }
/>
```

- [ ] **Step 3: add the Dashboard link**

```tsx
// cloud-panel-app/src/pages/Dashboard.tsx — in the per-project card's link row, add:
<Link to={`/projects/${project.id}/ofertas`}>Ofertas e Pilares</Link>
```
(alongside the existing "Aprovação", "Calendário", "Empresa" links)

- [ ] **Step 4: run full test suite + build**

Run: `cd cloud-panel-app && npm test && npm run build`
Expected: tests pass (12 total — 7 from before + 5 new), build succeeds.

- [ ] **Step 5: commit**

```bash
git add cloud-panel-app/src
git commit -m "feat: add Offers and Pillars page"
```

---

## Out of scope / next

- 3b-iii: Referências (upload) + Aprendizado.
- Preview de foto de referência vinculada a uma oferta — depende da 3b-iii.
- Geração de conteúdo a partir de oferta/pilar — Fase 4.
