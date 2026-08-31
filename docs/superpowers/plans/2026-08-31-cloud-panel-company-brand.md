# Cloud Panel Company + Brand — Fase 3b-i Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring a project's company profile and brand Raio-X/Briefing into Supabase, migrate the 9 already-migrated projects' existing local data into the new columns, and add a "Empresa" page to `cloud-panel-app` to view/edit the profile and approve the brand documents.

**Architecture:** 3 new `jsonb` columns on `projects`, mirroring the exact shapes `src/content-central.js`'s own `normalizeCompanyProfile`/`normalizeBrandXray`/`normalizeBrandBriefing` already produce (now exported so the migration script can reuse them instead of reimplementing the shape). A new `migrateCompanyBrandData` function in `src/migrate-to-supabase.js` populates the columns from each project's local `project.json`. `cloud-panel-app` gets a new page: an editable form for the profile, and a read + one-click-approve view for the two brand documents — no AI-analysis action, that stays local (Fase 4).

## Global Constraints

- No AI-triggering UI ("Analisar com IA") — this phase only ships pure-data view/edit/approve actions, same rule as Fase 3a.
- Approval of `brand_xray`/`brand_briefing` is one action per document (matches `approveProjectBrandXray`/`approveProjectBrandBriefing`'s real local behavior: all blocks approved at once), never per-block.
- `company_profile`/`brand_xray`/`brand_briefing` are distinct from the existing `projects.brand_profile` column (Fase 1, sourced from local `project.brand`) — never conflate them.
- Migration is idempotent (same convention as Fase 1: safe to re-run, upsert/update by an existing key, never duplicate).

---

### Task 1: Schema — company/brand columns

**Files:**
- Create: `supabase/migrations/0003_company_brand.sql`

**Interfaces:**
- Consumes: the `projects` table from Fase 1.
- Produces: `projects.company_profile jsonb`, `projects.brand_xray jsonb`, `projects.brand_briefing jsonb` — Tasks 2 and 4 read/write these by name.

No automated test (SQL file, same convention as every prior schema task — applied and verified manually against the real project).

- [ ] **Step 1: write the migration SQL**

```sql
-- supabase/migrations/0003_company_brand.sql

alter table projects add column if not exists company_profile jsonb not null default '{}'::jsonb;
alter table projects add column if not exists brand_xray jsonb not null default '{}'::jsonb;
alter table projects add column if not exists brand_briefing jsonb not null default '{}'::jsonb;

-- Rollback (manual, run by hand if needed — not auto-executed):
-- alter table projects drop column if exists brand_briefing;
-- alter table projects drop column if exists brand_xray;
-- alter table projects drop column if exists company_profile;
```

- [ ] **Step 2: apply the migration**

Paste into the Supabase Dashboard's SQL Editor (same manual process as every prior migration file) and run it against the real project.

- [ ] **Step 3: verify manually**

Confirm the 3 new columns exist on `projects` (`select company_profile, brand_xray, brand_briefing from projects limit 1;` should return `{}` for each on an unmigrated row).

- [ ] **Step 4: commit**

```bash
git add supabase/migrations/0003_company_brand.sql
git commit -m "feat: add company_profile/brand_xray/brand_briefing columns to projects"
```

---

### Task 2: Migration script — company/brand data

**Files:**
- Modify: `src/content-central.js` (export 3 existing functions — no behavior change)
- Modify: `src/migrate-to-supabase.js`
- Modify: `tests/migrate-to-supabase.test.js`

**Interfaces:**
- Consumes: `normalizeCompanyProfile`, `normalizeBrandXray`, `normalizeBrandBriefing` (now exported from `content-central.js`); `getCentralPaths`, `readJsonIfExists` (already in `migrate-to-supabase.js`).
- Produces: `migrateCompanyBrandData(targetDir, slug, client)` → reads one project's local `project.json`, normalizes its `companyProfile`/`brandXray`/`brandBriefing` with the (now-exported) existing functions, and updates that project's row in Supabase by `slug`. Returns `{ migrated: number, errors: Array<{ slug, error }> }`. `runMigration` (Task 6 of the Fase 1 plan, already shipped) is extended to call this per project alongside `migrateContentForProject`.

- [ ] **Step 1: export the three normalize functions**

In `src/content-central.js`, these three function declarations currently have no `export` keyword — add one to each, changing nothing else about them:

```js
// line ~7682 — change:
function normalizeCompanyProfile(input = {}) {
// to:
export function normalizeCompanyProfile(input = {}) {
```

```js
// line ~7985 — change:
function normalizeBrandXray(input = {}) {
// to:
export function normalizeBrandXray(input = {}) {
```

```js
// line ~8341 — change:
function normalizeBrandBriefing(input = {}) {
// to:
export function normalizeBrandBriefing(input = {}) {
```

Nothing else in the file changes — these are pure functions with no side effects, already called internally exactly the same way; adding `export` only makes them importable elsewhere.

- [ ] **Step 2: write the failing test**

```js
// append to tests/migrate-to-supabase.test.js
import { migrateCompanyBrandData, runMigration } from '../src/migrate-to-supabase.js';

function fakeClientForCompanyBrand() {
  const updates = [];
  return {
    updates,
    from(table) {
      if (table !== 'projects') throw new Error(`fakeClientForCompanyBrand: unhandled table ${table}`);
      return {
        update: (patch) => ({
          eq: async (_col, value) => {
            updates.push({ slug: value, patch });
            return { error: null };
          },
        }),
      };
    },
  };
}

test('migrateCompanyBrandData normalizes and writes companyProfile/brandXray/brandBriefing by slug', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-brand-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      companyProfile: { segment: 'Pizzaria', audience: 'Famílias' },
      brandXray: { status: 'approved', blocks: { summary: { text: 'Marca calorosa' } } },
      brandBriefing: {},
    }),
  );

  const client = fakeClientForCompanyBrand();
  const result = await migrateCompanyBrandData(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].slug, 'acme-pizza');
  assert.equal(client.updates[0].patch.company_profile.segment, 'Pizzaria');
  assert.equal(client.updates[0].patch.company_profile.audience, 'Famílias');
  assert.equal(client.updates[0].patch.brand_xray.status, 'approved');
  assert.equal(client.updates[0].patch.brand_xray.blocks.summary.text, 'Marca calorosa');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateCompanyBrandData records an error when project.json is missing', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-brand-missing-'));
  const client = fakeClientForCompanyBrand();
  const result = await migrateCompanyBrandData(targetDir, 'no-such-project', client);
  assert.equal(result.migrated, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].slug, 'no-such-project');
  await rm(targetDir, { recursive: true, force: true });
});
```

- [ ] **Step 3: run test to verify it fails**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: FAIL — `migrateCompanyBrandData` is not exported / not defined.

- [ ] **Step 4: write the implementation**

```js
// add near the top of src/migrate-to-supabase.js, alongside the existing
// `import { getCentralPaths } from './content-central.js';` line — extend
// it to also pull in the three normalize functions:
import { getCentralPaths, normalizeCompanyProfile, normalizeBrandXray, normalizeBrandBriefing } from './content-central.js';
```

```js
// append to src/migrate-to-supabase.js, after migrateContentForProject and
// before runMigration
export async function migrateCompanyBrandData(targetDir, slug, client) {
  const result = { migrated: 0, errors: [] };
  const { projectsDir } = getCentralPaths(targetDir);
  const project = await readJsonIfExists(join(projectsDir, slug, 'project.json'));
  if (!project) {
    result.errors.push({ slug, error: 'project.json not found' });
    return result;
  }

  const { error } = await client
    .from('projects')
    .update({
      company_profile: normalizeCompanyProfile(project.companyProfile),
      brand_xray: normalizeBrandXray(project.brandXray),
      brand_briefing: normalizeBrandBriefing(project.brandBriefing),
    })
    .eq('slug', slug);
  if (error) {
    result.errors.push({ slug, error: error.message || String(error) });
    return result;
  }

  result.migrated += 1;
  return result;
}
```

- [ ] **Step 5: wire it into `runMigration`**

```js
// replace the existing runMigration in src/migrate-to-supabase.js with:
export async function runMigration(targetDir, client) {
  const projects = await migrateProjects(targetDir, client);
  const { projectsDir } = getCentralPaths(targetDir);
  let slugs = [];
  try {
    slugs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const content = { migrated: 0, errors: [] };
  const companyBrand = { migrated: 0, errors: [] };
  for (const slug of slugs) {
    const perProject = await migrateContentForProject(targetDir, slug, client);
    content.migrated += perProject.migrated;
    content.errors.push(...perProject.errors);

    const perProjectBrand = await migrateCompanyBrandData(targetDir, slug, client);
    companyBrand.migrated += perProjectBrand.migrated;
    companyBrand.errors.push(...perProjectBrand.errors);
  }

  return { projects, content, companyBrand };
}
```

Also update `main()`'s logging to report the new `companyBrand` result:

```js
// replace the body of main() in src/migrate-to-supabase.js with:
async function main() {
  const client = createSupabaseAdminClient();
  const result = await runMigration(process.cwd(), client);
  console.log(`Projects migrated: ${result.projects.migrated} (${result.projects.errors.length} errors)`);
  console.log(`Content items migrated: ${result.content.migrated} (${result.content.errors.length} errors)`);
  console.log(`Company/brand data migrated: ${result.companyBrand.migrated} (${result.companyBrand.errors.length} errors)`);
  const allErrors = [...result.projects.errors, ...result.content.errors, ...result.companyBrand.errors];
  if (allErrors.length) {
    console.error('Errors:', JSON.stringify(allErrors, null, 2));
    process.exitCode = 1;
  }
}
```

- [ ] **Step 6: update the existing idempotency test's fake client**

`tests/migrate-to-supabase.test.js`'s `runMigration is idempotent` test uses `fakeClientWithStorage()`, which now needs to handle the `projects` table's `.update(...).eq(...)` call `migrateCompanyBrandData` makes internally (it currently only has `.upsert`/`.select`). Add an `update` method to that table's handler:

```js
// in fakeClientWithStorage(), inside the `if (table === 'projects')` block, add:
update: (_patch) => ({ eq: async () => ({ error: null }) }),
```

(alongside the existing `upsert`/`select` methods on that same returned object — this is a no-op write, just enough for `runMigration`'s new `migrateCompanyBrandData` call inside the loop not to throw `unhandled table`.)

- [ ] **Step 7: run test to verify it passes**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 8: run the full existing suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (same one known pre-existing, unrelated SPA-fallback failure as every prior phase — nothing new).

- [ ] **Step 9: commit**

```bash
git add src/content-central.js src/migrate-to-supabase.js tests/migrate-to-supabase.test.js
git commit -m "feat: migrate company profile and brand xray/briefing to Supabase"
```

- [ ] **Step 10 (manual, controller-run): run it for real**

With `.env` pointed at the real Supabase project, run `npm run migrate:supabase` and confirm the new "Company/brand data migrated" line reports 9 migrated, 0 errors (matching the 9 real projects already migrated in Fase 1).

---

### Task 3: Pure brand-document approval helper

**Files:**
- Create: `cloud-panel-app/src/lib/approveBrandDocument.ts`
- Create: `cloud-panel-app/tests/approveBrandDocument.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `approveBrandDocument<T extends BrandDocument>(doc: T): T` — returns a new object with every entry in `doc.blocks` set to `{ ...block, status: 'approved', approvedAt: <ISO now> }` and the top-level `status` also set to `'approved'` with `approvedAt` set. Task 4 imports and calls this for both `brand_xray` and `brand_briefing` (same shape, same function).

- [ ] **Step 1: write the failing tests**

```ts
// cloud-panel-app/tests/approveBrandDocument.test.ts
import { describe, it, expect } from "vitest";
import { approveBrandDocument } from "../src/lib/approveBrandDocument";

describe("approveBrandDocument", () => {
  it("approves every block and the top-level status", () => {
    const doc = {
      status: "generated",
      source: "ai_analysis",
      blocks: {
        summary: { id: "summary", label: "Resumo", text: "x", status: "generated", approvedAt: null },
        audience: { id: "audience", label: "Público", text: "y", status: "draft", approvedAt: null },
      },
      generatedAt: "2026-08-01T00:00:00.000Z",
      approvedAt: null,
    };
    const result = approveBrandDocument(doc);
    expect(result.status).toBe("approved");
    expect(result.approvedAt).not.toBeNull();
    expect(result.blocks.summary.status).toBe("approved");
    expect(result.blocks.audience.status).toBe("approved");
    expect(result.blocks.summary.approvedAt).not.toBeNull();
    expect(result.blocks.audience.approvedAt).not.toBeNull();
  });

  it("preserves block text and label, only changes status/approvedAt", () => {
    const doc = {
      status: "generated",
      source: "",
      blocks: { summary: { id: "summary", label: "Resumo", text: "conteúdo original", status: "generated", approvedAt: null } },
      generatedAt: null,
      approvedAt: null,
    };
    const result = approveBrandDocument(doc);
    expect(result.blocks.summary.text).toBe("conteúdo original");
    expect(result.blocks.summary.label).toBe("Resumo");
  });

  it("handles a document with no blocks yet", () => {
    const doc = { status: "empty", source: "", blocks: {}, generatedAt: null, approvedAt: null };
    const result = approveBrandDocument(doc);
    expect(result.status).toBe("approved");
    expect(result.blocks).toEqual({});
  });

  it("does not mutate the input object", () => {
    const doc = {
      status: "generated",
      source: "",
      blocks: { summary: { id: "summary", label: "Resumo", text: "x", status: "generated", approvedAt: null } },
      generatedAt: null,
      approvedAt: null,
    };
    approveBrandDocument(doc);
    expect(doc.status).toBe("generated");
    expect(doc.blocks.summary.status).toBe("generated");
  });
});
```

- [ ] **Step 2: run tests to verify they fail**

Run: `cd cloud-panel-app && npx vitest run tests/approveBrandDocument.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: write the implementation**

```ts
// cloud-panel-app/src/lib/approveBrandDocument.ts
export interface BrandBlock {
  id: string;
  label: string;
  text: string;
  status: "draft" | "generated" | "approved";
  approvedAt: string | null;
}

export interface BrandDocument {
  status: "empty" | "generated" | "approved" | "needs_review";
  source: string;
  blocks: Record<string, BrandBlock>;
  generatedAt: string | null;
  approvedAt: string | null;
}

// Mirrors the real local behavior (approveProjectBrandXray/
// approveProjectBrandBriefing in src/content-central.js): approval is one
// action for the whole document — every block is approved at once, never
// block-by-block.
export function approveBrandDocument<T extends BrandDocument>(doc: T): T {
  const now = new Date().toISOString();
  const blocks: Record<string, BrandBlock> = {};
  for (const [id, block] of Object.entries(doc.blocks)) {
    blocks[id] = { ...block, status: "approved", approvedAt: now };
  }
  return { ...doc, status: "approved", approvedAt: now, blocks };
}
```

- [ ] **Step 4: run tests to verify they pass**

Run: `cd cloud-panel-app && npx vitest run tests/approveBrandDocument.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: commit**

```bash
git add cloud-panel-app/src/lib/approveBrandDocument.ts cloud-panel-app/tests/approveBrandDocument.test.ts
git commit -m "feat: add pure brand-document approval helper"
```

---

### Task 4: Company page

**Files:**
- Create: `cloud-panel-app/src/pages/Company.tsx`
- Modify: `cloud-panel-app/src/App.tsx`
- Modify: `cloud-panel-app/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `supabase` (Fase 3a), `RequireAuth` (Fase 3a), `approveBrandDocument` (Task 3).
- Produces: `/projects/:projectId/empresa` route.

- [ ] **Step 1: write the page**

```tsx
// cloud-panel-app/src/pages/Company.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { approveBrandDocument, type BrandDocument } from "@/lib/approveBrandDocument";

interface CompanyProfile {
  segmentGroup: string; segmentCategory: string; segmentSpecialty: string;
  segment: string; description: string; audience: string; audienceType: string;
  location: string; productsOrServices: string; differentiators: string;
  primaryObjective: string; websiteOrInstagram: string; factualConstraints: string;
  tone: string[]; contentGoals: string[]; brandColors: string; avoid: string;
  positioning: string;
}

const EMPTY_PROFILE: CompanyProfile = {
  segmentGroup: "", segmentCategory: "", segmentSpecialty: "", segment: "",
  description: "", audience: "", audienceType: "", location: "",
  productsOrServices: "", differentiators: "", primaryObjective: "",
  websiteOrInstagram: "", factualConstraints: "", tone: [], contentGoals: [],
  brandColors: "", avoid: "", positioning: "",
};

const PROFILE_FIELDS: Array<{ key: keyof CompanyProfile; label: string; multiline?: boolean }> = [
  { key: "segmentGroup", label: "Setor principal" },
  { key: "segmentCategory", label: "Categoria" },
  { key: "segmentSpecialty", label: "Especialidade / subsegmento" },
  { key: "segment", label: "Segmento" },
  { key: "description", label: "Descrição da empresa", multiline: true },
  { key: "audience", label: "Público-alvo", multiline: true },
  { key: "location", label: "Região / cidade" },
  { key: "productsOrServices", label: "O que vende / presta", multiline: true },
  { key: "differentiators", label: "Diferenciais", multiline: true },
  { key: "primaryObjective", label: "Objetivo principal da comunicação" },
  { key: "websiteOrInstagram", label: "Site / Instagram" },
  { key: "factualConstraints", label: "Informações que não podem ser inventadas", multiline: true },
  { key: "brandColors", label: "Cores / identidade desejada" },
  { key: "avoid", label: "Evitar", multiline: true },
  { key: "positioning", label: "Posicionamento desejado", multiline: true },
];

const AUDIENCE_TYPE_OPTIONS = [
  { value: "", label: "Não definido" },
  { value: "b2b", label: "B2B" },
  { value: "b2c", label: "B2C" },
  { value: "mixed", label: "B2B e B2C" },
];

const BRAND_XRAY_BLOCKS: Array<[string, string]> = [
  ["summary", "Resumo da marca"],
  ["communication", "Compradores e comunicação"],
  ["contentStrategy", "Estratégia de conteúdo"],
  ["visualIdentity", "Identidade visual"],
];

const BRAND_BRIEFING_BLOCKS: Array<[string, string]> = [
  ["summary", "Resumo da empresa"],
  ["positioning", "Posicionamento sugerido"],
  ["audience", "Público-alvo sugerido"],
  ["tone", "Tom de voz sugerido"],
  ["personality", "Personalidade da marca"],
  ["contentPillars", "Pilares de conteúdo"],
  ["visualDirection", "Direção visual"],
  ["differentiators", "Diferenciais percebidos"],
  ["avoid", "O que evitar"],
  ["missingInfo", "Informações que ainda estão faltando"],
];

function BrandDocumentSection({
  title,
  blockDefs,
  doc,
  onApprove,
  busy,
}: {
  title: string;
  blockDefs: Array<[string, string]>;
  doc: BrandDocument;
  onApprove: () => void;
  busy: boolean;
}) {
  const hasContent = Object.keys(doc.blocks).length > 0;
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span style={{ color: "var(--text-dim)" }}>{doc.status}</span>
      </div>
      {!hasContent ? <p>Ainda não gerado localmente.</p> : null}
      {blockDefs.map(([id, label]) => {
        const block = doc.blocks[id];
        if (!block) return null;
        return (
          <div key={id}>
            <strong>{label}</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{block.text || "(vazio)"}</p>
          </div>
        );
      })}
      {hasContent && doc.status !== "approved" ? (
        <button type="button" className="primary" onClick={onApprove} disabled={busy}>
          Aprovar
        </button>
      ) : null}
    </section>
  );
}

export function Company() {
  const { projectId } = useParams<{ projectId: string }>();
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [brandXray, setBrandXray] = useState<BrandDocument | null>(null);
  const [brandBriefing, setBrandBriefing] = useState<BrandDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("company_profile, brand_xray, brand_briefing")
      .eq("id", projectId)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setProfile({ ...EMPTY_PROFILE, ...(data.company_profile || {}) });
    setBrandXray(data.brand_xray || { status: "empty", source: "", blocks: {}, generatedAt: null, approvedAt: null });
    setBrandBriefing(data.brand_briefing || { status: "empty", source: "", blocks: {}, generatedAt: null, approvedAt: null });
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function updateField(key: keyof CompanyProfile, value: string) {
    if (key === "tone" || key === "contentGoals") {
      setProfile((prev) => ({ ...prev, [key]: value.split(",").map((v) => v.trim()).filter(Boolean) }));
    } else {
      setProfile((prev) => ({ ...prev, [key]: value }));
    }
  }

  async function saveProfile() {
    setBusy(true);
    await supabase.from("projects").update({ company_profile: profile }).eq("id", projectId);
    setBusy(false);
  }

  async function approveXray() {
    if (!brandXray) return;
    setBusy(true);
    const approved = approveBrandDocument(brandXray);
    await supabase.from("projects").update({ brand_xray: approved }).eq("id", projectId);
    setBrandXray(approved);
    setBusy(false);
  }

  async function approveBriefing() {
    if (!brandBriefing) return;
    setBusy(true);
    const approved = approveBrandDocument(brandBriefing);
    await supabase.from("projects").update({ brand_briefing: approved }).eq("id", projectId);
    setBrandBriefing(approved);
    setBusy(false);
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded || !brandXray || !brandBriefing) return <div className="card">Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Empresa</h1>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Perfil</h2>
        <div>
          <label>Foco comercial</label>
          <select
            value={profile.audienceType}
            onChange={(e) => updateField("audienceType", e.target.value)}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
          >
            {AUDIENCE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {PROFILE_FIELDS.map(({ key, label, multiline }) => (
          <div key={key}>
            <label htmlFor={`field-${key}`}>{label}</label>
            {multiline ? (
              <textarea
                id={`field-${key}`}
                rows={3}
                value={profile[key] as string}
                onChange={(e) => updateField(key, e.target.value)}
              />
            ) : (
              <input
                id={`field-${key}`}
                type="text"
                value={profile[key] as string}
                onChange={(e) => updateField(key, e.target.value)}
              />
            )}
          </div>
        ))}
        <div>
          <label htmlFor="field-tone">Tom de voz (separado por vírgula)</label>
          <input id="field-tone" type="text" value={profile.tone.join(", ")} onChange={(e) => updateField("tone", e.target.value)} />
        </div>
        <div>
          <label htmlFor="field-contentGoals">Interesses / objetivos das postagens (separado por vírgula)</label>
          <input
            id="field-contentGoals"
            type="text"
            value={profile.contentGoals.join(", ")}
            onChange={(e) => updateField("contentGoals", e.target.value)}
          />
        </div>
        <button type="button" className="primary" onClick={saveProfile} disabled={busy}>
          Salvar perfil
        </button>
      </section>

      <BrandDocumentSection title="Raio-X de marca" blockDefs={BRAND_XRAY_BLOCKS} doc={brandXray} onApprove={approveXray} busy={busy} />
      <BrandDocumentSection title="Briefing" blockDefs={BRAND_BRIEFING_BLOCKS} doc={brandBriefing} onApprove={approveBriefing} busy={busy} />
    </div>
  );
}
```

- [ ] **Step 2: wire the route**

```tsx
// cloud-panel-app/src/App.tsx — add the import and route
import { Company } from "@/pages/Company";
// ...
<Route
  path="/projects/:projectId/empresa"
  element={
    <RequireAuth>
      <Company />
    </RequireAuth>
  }
/>
```

- [ ] **Step 3: add the Dashboard link**

```tsx
// cloud-panel-app/src/pages/Dashboard.tsx — in the per-project card's link row, add:
<Link to={`/projects/${project.id}/empresa`}>Empresa</Link>
```
(alongside the existing "Aprovação" and "Calendário" links)

- [ ] **Step 4: run full test suite + build**

Run: `cd cloud-panel-app && npm test && npm run build`
Expected: tests pass (7 total — 3 from Fase 3a + 4 new), build succeeds.

- [ ] **Step 5: commit**

```bash
git add cloud-panel-app/src
git commit -m "feat: add Company page (profile edit, brand xray/briefing approve)"
```

---

## Out of scope / next

- 3b-ii: Ofertas + Pilares.
- 3b-iii: Referências (upload) + Aprendizado.
- "Analisar com IA" and manual per-block text editing — Fase 4.
