# Cloud Panel Aprendizado (Fase 3b-iv) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the 3 global (not per-project) "Aprendizado" data domains into
the cloud panel: segment learnings (per-project view into a global tree),
offer-type learnings (global, 11 fixed types), and segment templates
(global, read-only).

**Architecture:** Two new Supabase tables (`global_learning` — singleton
per owner, mirrors the 2 local JSON files verbatim as jsonb; `segment_templates`
— 1 row per segment). Migration script extension uploads existing learning-
entry and template-piece images to the already-existing `content-media`
bucket and stamps `storagePath`. Three new `cloud-panel-app` pages, wired
in a small final task to avoid two tasks colliding on `App.tsx`/`Dashboard.tsx`.

**Tech Stack:** Node.js (`node --test`) for the migration script; React 19 +
TypeScript + Vitest for `cloud-panel-app`; Supabase (2 new tables + reused
Storage bucket, no new bucket/policy).

## Global Constraints

- `@supabase/supabase-js` stays pinned to exact `2.106.0` — no new dependency.
- Every read of a jsonb column checks shape (`typeof x === 'object' && x !== null`,
  or `Array.isArray` for arrays), never bare truthiness.
- Every write to `global_learning`'s jsonb columns is read-modify-write on
  the **whole** column value (`{ nodes: {...} }` / `{ types: {...} }`) —
  never drop sibling node/type keys.
- Storage bucket is `content-media` (reuse — no new bucket, no new policy).
- Signed URL TTL for previews: 300 seconds.
- `segmentNodePathsFromFields`/`segmentNodeLabelFromFields` (ported to TS
  in Task 2) MUST reproduce `src/content-central.js`'s exact behavior,
  **including its positional-index quirk**: `SEGMENT_LEVELS[index]` is
  assigned to each returned path by array position, not by which real
  field (group/category/specialty) it came from. This is pre-existing
  local behavior (a project missing Setor gets its first populated field
  labeled "setor" anyway) — reproduce it exactly, don't "fix" it, or the
  cloud will label nodes the local system doesn't recognize.
- Templates de Segmento is **read-only** in the cloud this phase — no
  create/edit/delete UI. Creating a template stays a local script action
  (`registerSegmentTemplate`, unchanged).
- No AI/image-analysis in the cloud — a manual image entry always has its
  text typed by the user at upload time, no auto-suggest button.

---

### Task 1: Migration — global_learning + segment_templates tables and upload

**Files:**
- Create: `supabase/migrations/0005_global_learning.sql`
- Modify: `src/content-central.js` (export `normalizeSegmentLearningEntry`
  at its definition)
- Modify: `src/migrate-to-supabase.js` (import, new
  `migrateGlobalLearning`/`migrateSegmentTemplates`, wire into
  `runMigration`/`main`)
- Test: `tests/migrate-to-supabase.test.js` (append new tests)

**Interfaces:**
- Consumes: `getCentralPaths(targetDir)` → includes `root`,
  `segmentLearningsPath`, `offerTypeLearningsPath`, `segmentTemplatesDir`
  (all already present, no change needed — see
  `src/content-central.js:381-406`). `migrateSegmentLearningStoreV1ToV2`
  (existing, exported). `normalizeSegmentLearningEntry` (existing, made
  exported by this task) — returns `{ id, bucket, kind, text, title,
  imagePath, purpose, postType, shape, source, sourceProjectId, createdAt }`.
- Produces: `migrateGlobalLearning(targetDir, client) →
  Promise<{ migrated: number, errors: Array<{ error }> }>`,
  `migrateSegmentTemplates(targetDir, client) →
  Promise<{ migrated: number, errors: Array<{ segmentId?, piece?, error }> }>`
  — called once each (not per-slug) from `runMigration`.

- [ ] **Step 1: Write the SQL migration**

Create `supabase/migrations/0005_global_learning.sql`:

```sql
create table if not exists global_learning (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  segment_learnings jsonb not null default '{}'::jsonb,
  offer_type_learnings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table global_learning enable row level security;
create policy "owner full access" on global_learning
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists segment_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  segment_id text not null,
  label text not null,
  pieces jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, segment_id)
);
alter table segment_templates enable row level security;
create policy "owner full access" on segment_templates
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Rollback (manual, run by hand if needed — not auto-executed):
-- drop table if exists segment_templates;
-- drop table if exists global_learning;
```

- [ ] **Step 2: Export `normalizeSegmentLearningEntry`**

In `src/content-central.js`, find (around line 4995):

```js
function normalizeSegmentLearningEntry(input = {}) {
```

change to:

```js
export function normalizeSegmentLearningEntry(input = {}) {
```

- [ ] **Step 3: Write the failing tests**

Append to `tests/migrate-to-supabase.test.js` (add `migrateGlobalLearning`
and `migrateSegmentTemplates` to the existing
`import { runMigration, migrateCompanyBrandData, migrateProjectReferences } from '../src/migrate-to-supabase.js';`
line):

```js
function fakeClientForGlobalLearning() {
  const upserts = { global_learning: [], segment_templates: [] };
  const uploads = [];
  return {
    upserts,
    uploads,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [{ id: 'owner-uuid-1' }] }, error: null }),
      },
    },
    from(table) {
      if (table !== 'global_learning' && table !== 'segment_templates') throw new Error(`fakeClientForGlobalLearning: unhandled table ${table}`);
      return {
        upsert: async (rows) => { upserts[table].push(...rows); return { error: null }; },
      };
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, buffer, opts) => {
          uploads.push({ bucket, path, size: buffer.length, contentType: opts?.contentType });
          return { data: { path }, error: null };
        },
      }),
    },
  };
}

test('migrateGlobalLearning uploads image entries, stamps storagePath, and writes one global_learning row', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-learning-'));
  const root = join(targetDir, '_opensquad', 'content-central');
  await mkdir(join(root, 'assets', 'learning', 'segment', 'alimenticio'), { recursive: true });
  await writeFile(join(root, 'assets', 'learning', 'segment', 'alimenticio', 'foto.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(join(root, 'segment-learnings.json'), JSON.stringify({
    schemaVersion: 2,
    nodes: {
      'group:alimenticio': {
        label: 'Alimentício',
        entries: [
          { id: 'e1', bucket: 'approved', kind: 'text', text: 'Funciona bem falar de frescor', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'e2', bucket: 'avoid', kind: 'image', text: 'Evitar esse enquadramento', imagePath: 'segment/alimenticio/foto.jpg', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    },
  }));
  await writeFile(join(root, 'offer-type-learnings.json'), JSON.stringify({
    schemaVersion: 1,
    types: { combo: { baseInstruction: 'Sempre mostrar preço por pessoa', entries: [] } },
  }));

  const client = fakeClientForGlobalLearning();
  const result = await migrateGlobalLearning(targetDir, client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].bucket, 'content-media');
  assert.equal(client.uploads[0].path, 'learning/segment/alimenticio/foto.jpg');
  assert.equal(client.upserts.global_learning.length, 1);
  const written = client.upserts.global_learning[0];
  assert.equal(written.owner_id, 'owner-uuid-1');
  assert.equal(written.segment_learnings.nodes['group:alimenticio'].entries[0].text, 'Funciona bem falar de frescor');
  assert.equal(written.segment_learnings.nodes['group:alimenticio'].entries[1].storagePath, 'learning/segment/alimenticio/foto.jpg');
  assert.equal(written.offer_type_learnings.types.combo.baseInstruction, 'Sempre mostrar preço por pessoa');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateGlobalLearning migrates a legacy v1 segment-learnings.json via migrateSegmentLearningStoreV1ToV2', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-learning-v1-'));
  const root = join(targetDir, '_opensquad', 'content-central');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'segment-learnings.json'), JSON.stringify({
    segments: { s1: { label: 'Alimentício', approved: ['Falar de frescor'], avoid: [], technical: [] } },
  }));

  const client = fakeClientForGlobalLearning();
  const result = await migrateGlobalLearning(targetDir, client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  const written = client.upserts.global_learning[0];
  const node = written.segment_learnings.nodes['alimenticio'];
  assert.ok(node, 'expected a node keyed by the slugified v1 label');
  assert.equal(node.entries[0].text, 'Falar de frescor');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateSegmentTemplates uploads each piece image and upserts one row per segment', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-templates-'));
  const templateDir = join(targetDir, '_opensquad', 'content-central', 'segment-templates', 'alimenticio-pizzaria', 'images');
  await mkdir(templateDir, { recursive: true });
  await writeFile(join(templateDir, 'capa.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(
    join(targetDir, '_opensquad', 'content-central', 'segment-templates', 'alimenticio-pizzaria', 'template.json'),
    JSON.stringify({
      segmentId: 'alimenticio-pizzaria',
      label: 'Pizzaria',
      pieces: [{ key: 'capa', label: 'Capa', channel: 'instagram_feed', angleNote: '', imagePath: 'images/capa.png' }],
    }),
  );

  const client = fakeClientForGlobalLearning();
  const result = await migrateSegmentTemplates(targetDir, client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].path, 'segment-templates/alimenticio-pizzaria/images/capa.png');
  assert.equal(client.upserts.segment_templates.length, 1);
  assert.equal(client.upserts.segment_templates[0].segment_id, 'alimenticio-pizzaria');
  assert.equal(client.upserts.segment_templates[0].pieces[0].storagePath, 'segment-templates/alimenticio-pizzaria/images/capa.png');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateSegmentTemplates returns an empty result when segment-templates/ does not exist', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-templates-empty-'));
  const client = fakeClientForGlobalLearning();
  const result = await migrateSegmentTemplates(targetDir, client);
  assert.equal(result.migrated, 0);
  assert.equal(result.errors.length, 0);
  await rm(targetDir, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: FAIL — `migrateGlobalLearning`/`migrateSegmentTemplates` are not
functions (not yet imported/defined).

- [ ] **Step 5: Update the import line**

In `src/migrate-to-supabase.js`, change the `content-central.js` import to
also bring in `migrateSegmentLearningStoreV1ToV2` and
`normalizeSegmentLearningEntry`:

```js
import { getCentralPaths, normalizeCompanyProfile, normalizeBrandXray, normalizeBrandBriefing, normalizeProjectOffers, normalizeProjectOfferGroups, normalizeProjectPillars, normalizeProjectReferences, migrateSegmentLearningStoreV1ToV2, normalizeSegmentLearningEntry } from './content-central.js';
```

- [ ] **Step 6: Implement `migrateGlobalLearning` and `migrateSegmentTemplates`**

In `src/migrate-to-supabase.js`, add this right after `migrateProjectReferences`
(after its closing `}`, before `export async function runMigration`):

```js
function contentTypeForFilename(filename) {
  const ext = String(filename).split('.').pop()?.toLowerCase() || '';
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  }[ext] || 'application/octet-stream';
}

async function lookUpOwnerId(client) {
  const { data: usersData, error: usersError } = await client.auth.admin.listUsers();
  if (usersError) throw new Error(`failed to look up the owner user: ${usersError.message}`);
  if (!usersData.users.length) throw new Error('no Supabase Auth user exists yet — create the single owner user before migrating');
  return usersData.users[0].id;
}

function toSegmentLearningsV2(stored) {
  if (!stored) return { schemaVersion: 2, nodes: {} };
  if (stored.schemaVersion === 2) return { ...stored, nodes: stored.nodes || {} };
  return migrateSegmentLearningStoreV1ToV2(stored);
}

async function uploadLearningEntryImage(client, root, entry) {
  if (entry.kind !== 'image' || !entry.imagePath) return null;
  const fullPath = join(root, 'assets', 'learning', entry.imagePath);
  if (!existsSync(fullPath)) return null;
  const buffer = await readFile(fullPath);
  const storagePath = `learning/${entry.imagePath}`;
  const { error } = await client.storage.from('content-media').upload(storagePath, buffer, {
    contentType: contentTypeForFilename(entry.imagePath),
    upsert: true,
  });
  if (error) throw new Error(error.message || String(error));
  return storagePath;
}

async function withEntryStoragePaths(client, root, entries, errors) {
  const result = [];
  for (const entry of entries) {
    try {
      const storagePath = await uploadLearningEntryImage(client, root, entry);
      result.push(storagePath ? { ...entry, storagePath } : entry);
    } catch (err) {
      errors.push({ entryId: entry.id, error: err.message });
      result.push(entry);
    }
  }
  return result;
}

export async function migrateGlobalLearning(targetDir, client) {
  const result = { migrated: 0, errors: [] };
  const { root, segmentLearningsPath, offerTypeLearningsPath } = getCentralPaths(targetDir);
  const ownerId = await lookUpOwnerId(client);

  const rawSegmentStore = await readJsonIfExists(segmentLearningsPath);
  const segmentStore = toSegmentLearningsV2(rawSegmentStore);
  const segmentNodes = {};
  for (const [path, node] of Object.entries(segmentStore.nodes)) {
    const entries = (node.entries || []).map(normalizeSegmentLearningEntry);
    segmentNodes[path] = { label: node.label, entries: await withEntryStoragePaths(client, root, entries, result.errors) };
  }

  const rawOfferTypeStore = await readJsonIfExists(offerTypeLearningsPath);
  const offerTypeTypes = {};
  for (const [type, node] of Object.entries(rawOfferTypeStore?.types || {})) {
    const entries = (node.entries || []).map(normalizeSegmentLearningEntry);
    offerTypeTypes[type] = {
      baseInstruction: node.baseInstruction || '',
      entries: await withEntryStoragePaths(client, root, entries, result.errors),
    };
  }

  const { error } = await client
    .from('global_learning')
    .upsert([{
      owner_id: ownerId,
      segment_learnings: { nodes: segmentNodes },
      offer_type_learnings: { types: offerTypeTypes },
    }], { onConflict: 'owner_id' });
  if (error) {
    result.errors.push({ error: error.message || String(error) });
    return result;
  }

  result.migrated += 1;
  return result;
}

export async function migrateSegmentTemplates(targetDir, client) {
  const result = { migrated: 0, errors: [] };
  const { segmentTemplatesDir } = getCentralPaths(targetDir);
  const ownerId = await lookUpOwnerId(client);

  let dirEntries;
  try {
    dirEntries = await readdir(segmentTemplatesDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return result;
    throw err;
  }

  for (const dirEntry of dirEntries) {
    if (!dirEntry.isDirectory()) continue;
    const segmentId = dirEntry.name;
    const templateDir = join(segmentTemplatesDir, segmentId);
    const template = await readJsonIfExists(join(templateDir, 'template.json'));
    if (!template) continue;

    const pieces = [];
    for (const piece of template.pieces || []) {
      try {
        const fullPath = join(templateDir, piece.imagePath);
        let storagePath;
        if (existsSync(fullPath)) {
          const buffer = await readFile(fullPath);
          storagePath = `segment-templates/${segmentId}/${piece.imagePath}`;
          const { error: uploadError } = await client.storage.from('content-media').upload(storagePath, buffer, {
            contentType: contentTypeForFilename(piece.imagePath),
            upsert: true,
          });
          if (uploadError) throw new Error(uploadError.message || String(uploadError));
        }
        pieces.push(storagePath ? { ...piece, storagePath } : piece);
      } catch (err) {
        result.errors.push({ segmentId, piece: piece.key, error: err.message });
        pieces.push(piece);
      }
    }

    const { error } = await client
      .from('segment_templates')
      .upsert([{ owner_id: ownerId, segment_id: segmentId, label: template.label, pieces }], { onConflict: 'owner_id,segment_id' });
    if (error) {
      result.errors.push({ segmentId, error: error.message || String(error) });
      continue;
    }
    result.migrated += 1;
  }

  return result;
}
```

- [ ] **Step 7: Wire into `runMigration` and `main()`**

In `src/migrate-to-supabase.js`, inside `runMigration`, change the final
part (after the per-slug loop) from:

```js
    const perProjectReferences = await migrateProjectReferences(targetDir, slug, client);
    references.migrated += perProjectReferences.migrated;
    references.errors.push(...perProjectReferences.errors);
  }

  return { projects, content, companyBrand, references };
```

to:

```js
    const perProjectReferences = await migrateProjectReferences(targetDir, slug, client);
    references.migrated += perProjectReferences.migrated;
    references.errors.push(...perProjectReferences.errors);
  }

  const globalLearning = await migrateGlobalLearning(targetDir, client);
  const segmentTemplates = await migrateSegmentTemplates(targetDir, client);

  return { projects, content, companyBrand, references, globalLearning, segmentTemplates };
```

Then in `main()`, change:

```js
  console.log(`Reference files migrated: ${result.references.migrated} (${result.references.errors.length} errors)`);
  const allErrors = [...result.projects.errors, ...result.content.errors, ...result.companyBrand.errors, ...result.references.errors];
```

to:

```js
  console.log(`Reference files migrated: ${result.references.migrated} (${result.references.errors.length} errors)`);
  console.log(`Global learning migrated: ${result.globalLearning.migrated} (${result.globalLearning.errors.length} errors)`);
  console.log(`Segment templates migrated: ${result.segmentTemplates.migrated} (${result.segmentTemplates.errors.length} errors)`);
  const allErrors = [...result.projects.errors, ...result.content.errors, ...result.companyBrand.errors, ...result.references.errors, ...result.globalLearning.errors, ...result.segmentTemplates.errors];
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: PASS, all tests including the 4 new ones (16 total) and the
pre-existing `runMigration is idempotent` test (which now also calls
`migrateGlobalLearning`/`migrateSegmentTemplates` once — must still pass;
that test's fake client (`fakeClientWithStorage`) does not implement
`from('global_learning')`/`from('segment_templates')`/`auth.admin.listUsers`
in a way compatible with these new calls, so **also update
`fakeClientWithStorage`** in the same test file to add:

```js
      if (table === 'global_learning' || table === 'segment_templates') {
        return { upsert: async (rows) => { upserts[table] = upserts[table] || []; upserts[table].push(...rows); return { error: null }; } };
      }
```

right before the existing `throw new Error(\`fakeClientWithStorage: unhandled table ${table}\`);` line inside its `from(table)` function.)

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0005_global_learning.sql src/content-central.js src/migrate-to-supabase.js tests/migrate-to-supabase.test.js
git commit -m "feat: migrate segment/offer-type learning entries and segment templates to Supabase"
```

---

### Task 2: Cloud panel — Aprendizado do Segmento page

**Files:**
- Create: `cloud-panel-app/src/lib/segmentLearning.ts`
- Test: `cloud-panel-app/tests/segmentLearning.test.ts`
- Create: `cloud-panel-app/src/pages/SegmentLearning.tsx`

**Interfaces:**
- Consumes: `upsertById`/`removeById` from `@/lib/contentStrategy`
  (existing, unchanged). `supabase` from `@/lib/supabaseClient` (existing).
- Produces (from `src/lib/segmentLearning.ts`, for `SegmentLearning.tsx`
  and its test to import):
  - `SEGMENT_LEVELS: readonly ['setor', 'nicho', 'especialidade']`
  - `type SegmentLevel`
  - `segmentNodePathsFromFields(group: string, category: string, specialty: string): string[]`
  - `segmentNodeLabelFromFields(group: string, category: string, specialty: string, level: SegmentLevel): string`
  - `interface SegmentNodeRef { path: string; label: string; level: SegmentLevel }`
  - `segmentNodesForProject(group: string, category: string, specialty: string): SegmentNodeRef[]`
  - `interface LearningEntry { id: string; bucket: string; kind: 'text' | 'image'; text: string; title: string; storagePath?: string; source: string; createdAt: string; [key: string]: unknown }`

- [ ] **Step 1: Write the failing tests**

Create `cloud-panel-app/tests/segmentLearning.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentNodePathsFromFields, segmentNodeLabelFromFields, segmentNodesForProject } from "../src/lib/segmentLearning";

describe("segmentNodePathsFromFields", () => {
  it("builds one tagged path per populated level, group first", () => {
    expect(segmentNodePathsFromFields("Alimentício", "Pizzaria", "Delivery")).toEqual([
      "group:alimenticio",
      "group:alimenticio/category:pizzaria",
      "group:alimenticio/category:pizzaria/specialty:delivery",
    ]);
  });

  it("skips an empty group but still returns paths for the populated fields (positional quirk, matches local)", () => {
    expect(segmentNodePathsFromFields("", "Pizzaria", "Delivery")).toEqual([
      "category:pizzaria",
      "category:pizzaria/specialty:delivery",
    ]);
  });

  it("returns an empty array when nothing is populated", () => {
    expect(segmentNodePathsFromFields("", "", "")).toEqual([]);
  });
});

describe("segmentNodeLabelFromFields", () => {
  it("returns just the group for level=setor", () => {
    expect(segmentNodeLabelFromFields("Alimentício", "Pizzaria", "", "setor")).toBe("Alimentício");
  });

  it("returns group/category for level=nicho", () => {
    expect(segmentNodeLabelFromFields("Alimentício", "Pizzaria", "", "nicho")).toBe("Alimentício / Pizzaria");
  });

  it("returns the empty group when group is unset, even at level=setor (positional quirk, matches local)", () => {
    expect(segmentNodeLabelFromFields("", "Pizzaria", "Delivery", "setor")).toBe("");
  });
});

describe("segmentNodesForProject", () => {
  it("zips paths with levels positionally, reproducing local's quirk for a missing group", () => {
    const nodes = segmentNodesForProject("", "Pizzaria", "Delivery");
    expect(nodes).toEqual([
      { path: "category:pizzaria", label: "", level: "setor" },
      { path: "category:pizzaria/specialty:delivery", label: "Pizzaria", level: "nicho" },
    ]);
  });

  it("labels correctly when all 3 fields are populated", () => {
    const nodes = segmentNodesForProject("Alimentício", "Pizzaria", "Delivery");
    expect(nodes.map((n) => n.label)).toEqual(["Alimentício", "Alimentício / Pizzaria", "Alimentício / Pizzaria / Delivery"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/segmentLearning.test.ts` (from `cloud-panel-app/`)
Expected: FAIL — cannot find module `../src/lib/segmentLearning`.

- [ ] **Step 3: Implement `src/lib/segmentLearning.ts`**

Create `cloud-panel-app/src/lib/segmentLearning.ts`:

```ts
function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "data"
  );
}

export const SEGMENT_LEVELS = ["setor", "nicho", "especialidade"] as const;
export type SegmentLevel = (typeof SEGMENT_LEVELS)[number];

// Mirrors src/content-central.js's segmentNodePathsFromFields verbatim.
// Each kept segment is tagged with the field it came from (group:/
// category:/specialty:) — two projects only share a node when they have
// the IDENTICAL set of populated fields with identical values.
export function segmentNodePathsFromFields(group: string, category: string, specialty: string): string[] {
  const g = group.trim();
  const c = category.trim();
  const s = specialty.trim();
  const parts = [
    g ? `group:${slugify(g)}` : "",
    c ? `category:${slugify(c)}` : "",
    s ? `specialty:${slugify(s)}` : "",
  ].filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// Mirrors src/content-central.js's segmentNodeLabelFromFields verbatim —
// `level` is assigned POSITIONALLY by the caller (SEGMENT_LEVELS[index] on
// segmentNodePathsFromFields's result), not by which real field a path
// segment came from. This is a known quirk of the local system (a project
// with no Setor set skips straight to a "nicho"-labeled first path) —
// reproduced here on purpose so the cloud reads the same stored nodes the
// same way local does.
export function segmentNodeLabelFromFields(group: string, category: string, specialty: string, level: SegmentLevel): string {
  const g = group.trim();
  const c = category.trim();
  const s = specialty.trim();
  if (level === "setor") return g;
  if (level === "nicho") return [g, c].filter(Boolean).join(" / ");
  return [g, c, s].filter(Boolean).join(" / ");
}

export interface SegmentNodeRef {
  path: string;
  label: string;
  level: SegmentLevel;
}

export function segmentNodesForProject(group: string, category: string, specialty: string): SegmentNodeRef[] {
  return segmentNodePathsFromFields(group, category, specialty).map((path, index) => ({
    path,
    label: segmentNodeLabelFromFields(group, category, specialty, SEGMENT_LEVELS[index]),
    level: SEGMENT_LEVELS[index],
  }));
}

export interface LearningEntry {
  id: string;
  bucket: string;
  kind: "text" | "image";
  text: string;
  title: string;
  storagePath?: string;
  source: string;
  createdAt: string;
  [key: string]: unknown;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/segmentLearning.test.ts` (from `cloud-panel-app/`)
Expected: PASS, 8 tests.

- [ ] **Step 5: Implement `src/pages/SegmentLearning.tsx`**

Create `cloud-panel-app/src/pages/SegmentLearning.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";
import { segmentNodesForProject, SEGMENT_LEVELS, type SegmentNodeRef, type LearningEntry } from "@/lib/segmentLearning";

interface SegmentLearningStore {
  nodes: Record<string, { label: string; entries: LearningEntry[] }>;
}

const EMPTY_STORE: SegmentLearningStore = { nodes: {} };
const BUCKETS: Array<[string, string]> = [["technical", "Técnico"], ["approved", "Aprovado"], ["avoid", "Evitar"]];

interface EntryDraft {
  id: string;
  path: string;
  bucket: string;
  kind: "text" | "image";
  text: string;
  title: string;
}

function newDraft(path: string): EntryDraft {
  return { id: crypto.randomUUID(), path, bucket: "approved", kind: "text", text: "", title: "" };
}

export function SegmentLearning() {
  const { projectId } = useParams<{ projectId: string }>();
  const [nodes, setNodes] = useState<SegmentNodeRef[]>([]);
  const [store, setStore] = useState<SegmentLearningStore>(EMPTY_STORE);
  const [rowId, setRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [draftFile, setDraftFile] = useState<File | null>(null);

  async function load() {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("company_profile")
      .eq("id", projectId)
      .single();
    if (projectError) {
      setError(projectError.message);
      return;
    }
    const profile = (project.company_profile || {}) as Record<string, unknown>;
    setNodes(segmentNodesForProject(
      String(profile.segmentGroup || ""),
      String(profile.segmentCategory || ""),
      String(profile.segmentSpecialty || ""),
    ));

    const { data: learning, error: learningError } = await supabase
      .from("global_learning")
      .select("id, segment_learnings")
      .single();
    if (learningError) {
      if (learningError.code !== "PGRST116") {
        setError(learningError.message);
        return;
      }
      setStore(EMPTY_STORE);
      setRowId(null);
    } else {
      const raw = learning.segment_learnings as { nodes?: unknown } | null;
      setStore({ nodes: raw && typeof raw.nodes === "object" && raw.nodes !== null ? (raw.nodes as SegmentLearningStore["nodes"]) : {} });
      setRowId(learning.id);
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function ensureSignedUrl(entry: LearningEntry) {
    if (!entry.storagePath || signedUrls[entry.id]) return;
    const { data } = await supabase.storage.from("content-media").createSignedUrl(entry.storagePath, 300);
    if (data) setSignedUrls((prev) => ({ ...prev, [entry.id]: data.signedUrl }));
  }

  useEffect(() => {
    Object.values(store.nodes).forEach((node) => {
      node.entries.forEach((entry) => { if (entry.kind === "image") ensureSignedUrl(entry); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  async function persist(nextStore: SegmentLearningStore): Promise<boolean> {
    if (!rowId) {
      setError("Nenhum registro de Aprendizado encontrado — rode a migração primeiro.");
      return false;
    }
    setBusy(true);
    const { error: updateError } = await supabase.from("global_learning").update({ segment_learnings: nextStore }).eq("id", rowId);
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return false;
    }
    setStore(nextStore);
    setBusy(false);
    return true;
  }

  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!draft || !draft.text.trim()) return;
    let storagePath: string | undefined;
    if (draft.kind === "image" && draftFile) {
      const path = `learning/segment/${draft.path.replace(/[^a-z0-9/-]/gi, "-")}/${draft.id}-${draftFile.name}`;
      const { error: uploadError } = await supabase.storage.from("content-media").upload(path, draftFile, {
        contentType: draftFile.type || "application/octet-stream",
      });
      if (uploadError) { setError(uploadError.message); return; }
      storagePath = path;
    }
    const node = store.nodes[draft.path] || { label: nodes.find((n) => n.path === draft.path)?.label || "", entries: [] };
    const entry: LearningEntry = {
      id: draft.id, bucket: draft.bucket, kind: draft.kind,
      text: draft.text.trim(), title: draft.kind === "image" ? draft.title.trim() : "",
      storagePath, source: "manual", createdAt: new Date().toISOString(),
    };
    const nextNode = { ...node, entries: upsertById(node.entries, entry) };
    const ok = await persist({ nodes: { ...store.nodes, [draft.path]: nextNode } });
    if (ok) { setDraft(null); setDraftFile(null); }
  }

  async function deleteEntry(path: string, entry: LearningEntry) {
    if (!confirm("Apagar esta entrada?")) return;
    const node = store.nodes[path];
    if (!node) return;
    const ok = await persist({ nodes: { ...store.nodes, [path]: { ...node, entries: removeById(node.entries, entry.id) } } });
    if (ok && entry.storagePath) {
      await supabase.storage.from("content-media").remove([entry.storagePath]);
    }
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded) return <div className="card">Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Aprendizado do Segmento</h1>
      {nodes.length === 0 ? <p>Este projeto ainda não tem Setor/Categoria/Especialidade definidos em Empresa.</p> : null}
      {nodes.map((node) => {
        const entries = store.nodes[node.path]?.entries || [];
        return (
          <section key={node.path} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ margin: 0 }}>{node.level}: {node.label || "(sem nome)"}</h2>
            {entries.map((entry) => (
              <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                {entry.kind === "image" && signedUrls[entry.id] ? (
                  <img src={signedUrls[entry.id]} alt={entry.title || entry.text} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4 }} />
                ) : null}
                <span style={{ flex: 1 }}>[{entry.bucket}] {entry.text}</span>
                <button type="button" className="danger" onClick={() => deleteEntry(node.path, entry)} disabled={busy}>Apagar</button>
              </div>
            ))}
            {draft?.path === node.path ? (
              <form onSubmit={saveEntry} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={draft.bucket} onChange={(e) => setDraft({ ...draft, bucket: e.target.value })}>
                  {BUCKETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "text" | "image" })}>
                  <option value="text">Texto</option>
                  <option value="image">Imagem</option>
                </select>
                {draft.kind === "image" ? (
                  <>
                    <input type="text" placeholder="Título" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                    <input type="file" accept="image/*" onChange={(e) => setDraftFile(e.target.files?.[0] || null)} required />
                  </>
                ) : null}
                <textarea placeholder="Texto do aprendizado" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} required />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="primary" disabled={busy}>Salvar</button>
                  <button type="button" onClick={() => { setDraft(null); setDraftFile(null); }}>Cancelar</button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setDraft(newDraft(node.path))} disabled={!rowId}>+ Nova entrada</button>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

Note: `SEGMENT_LEVELS` is imported but only used indirectly through
`segmentNodesForProject` — if the TypeScript build flags it as an unused
import, remove it from the import list (the type `SegmentNodeRef` and
value `segmentNodesForProject` are what's actually used directly in this
file).

- [ ] **Step 6: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean (fix the possible unused-import issue from the note above
if it appears).

Run: `npx vitest run`
Expected: PASS, all existing tests plus the 8 new `segmentLearning.test.ts`
tests.

- [ ] **Step 7: Commit**

```bash
git add cloud-panel-app/src/lib/segmentLearning.ts cloud-panel-app/tests/segmentLearning.test.ts cloud-panel-app/src/pages/SegmentLearning.tsx
git commit -m "feat(cloud-panel): Aprendizado do Segmento page (per-project view into the global segment tree)"
```

---

### Task 3: Cloud panel — Aprendizado por Tipo de Oferta + Templates de Segmento pages

**Files:**
- Create: `cloud-panel-app/src/pages/OfferTypeLearning.tsx`
- Create: `cloud-panel-app/src/pages/SegmentTemplates.tsx`

**Interfaces:**
- Consumes: `upsertById`/`removeById` from `@/lib/contentStrategy`;
  `supabase` from `@/lib/supabaseClient`. No new lib file — this task's
  logic is small enough to live inline in the two page components (no pure
  function worth its own test file), matching how `OffersAndPillars.tsx`
  inlines its own `OFFER_TYPES` list rather than importing it.
- Produces: `OfferTypeLearning` and `SegmentTemplates` React components,
  default-exported by name (`export function OfferTypeLearning()` /
  `export function SegmentTemplates()`), for Task 4 to route to.

- [ ] **Step 1: Implement `src/pages/OfferTypeLearning.tsx`**

Create `cloud-panel-app/src/pages/OfferTypeLearning.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";

interface LearningEntry {
  id: string;
  bucket: string;
  kind: "text" | "image";
  text: string;
  title: string;
  storagePath?: string;
  source: string;
  createdAt: string;
  [key: string]: unknown;
}

interface OfferTypeNode { baseInstruction?: string; entries: LearningEntry[] }
interface OfferTypeStore { types: Record<string, OfferTypeNode> }

const EMPTY_STORE: OfferTypeStore = { types: {} };
const BUCKETS: Array<[string, string]> = [["technical", "Técnico"], ["approved", "Aprovado"], ["avoid", "Evitar"]];
const OFFER_TYPES: Array<[string, string]> = [
  ["offer", "Oferta direta"], ["service", "Serviço"], ["combo", "Combo / promoção"],
  ["rodizio", "Rodízio"], ["delivery", "Delivery"], ["product", "Produto destaque"],
  ["orientation", "Post de orientação"], ["desire", "Post de desejo"],
  ["urgency", "Urgência / hoje tem"], ["institutional", "Institucional"],
  ["social_proof", "Prova social"],
];

interface EntryDraft {
  id: string;
  type: string;
  bucket: string;
  kind: "text" | "image";
  text: string;
  title: string;
}

function newDraft(type: string): EntryDraft {
  return { id: crypto.randomUUID(), type, bucket: "approved", kind: "text", text: "", title: "" };
}

export function OfferTypeLearning() {
  const [store, setStore] = useState<OfferTypeStore>(EMPTY_STORE);
  const [rowId, setRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [instructionDrafts, setInstructionDrafts] = useState<Record<string, string>>({});
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [entryDraftFile, setEntryDraftFile] = useState<File | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase.from("global_learning").select("id, offer_type_learnings").single();
    if (queryError) {
      if (queryError.code !== "PGRST116") { setError(queryError.message); return; }
      setStore(EMPTY_STORE);
      setRowId(null);
    } else {
      const raw = data.offer_type_learnings as { types?: unknown } | null;
      setStore({ types: raw && typeof raw.types === "object" && raw.types !== null ? (raw.types as OfferTypeStore["types"]) : {} });
      setRowId(data.id);
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, []);

  async function ensureSignedUrl(entry: LearningEntry) {
    if (!entry.storagePath || signedUrls[entry.id]) return;
    const { data } = await supabase.storage.from("content-media").createSignedUrl(entry.storagePath, 300);
    if (data) setSignedUrls((prev) => ({ ...prev, [entry.id]: data.signedUrl }));
  }

  useEffect(() => {
    Object.values(store.types).forEach((node) => node.entries.forEach((entry) => { if (entry.kind === "image") ensureSignedUrl(entry); }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  async function persist(nextStore: OfferTypeStore): Promise<boolean> {
    if (!rowId) { setError("Nenhum registro de Aprendizado encontrado — rode a migração primeiro."); return false; }
    setBusy(true);
    const { error: updateError } = await supabase.from("global_learning").update({ offer_type_learnings: nextStore }).eq("id", rowId);
    if (updateError) { setError(updateError.message); setBusy(false); return false; }
    setStore(nextStore);
    setBusy(false);
    return true;
  }

  async function saveInstruction(type: string) {
    const text = instructionDrafts[type];
    if (text === undefined) return;
    const node = store.types[type] || { entries: [] };
    const ok = await persist({ types: { ...store.types, [type]: { ...node, baseInstruction: text.trim() } } });
    if (ok) setInstructionDrafts((prev) => { const next = { ...prev }; delete next[type]; return next; });
  }

  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!entryDraft || !entryDraft.text.trim()) return;
    let storagePath: string | undefined;
    if (entryDraft.kind === "image" && entryDraftFile) {
      const path = `learning/offer-type/${entryDraft.type}/${entryDraft.id}-${entryDraftFile.name}`;
      const { error: uploadError } = await supabase.storage.from("content-media").upload(path, entryDraftFile, {
        contentType: entryDraftFile.type || "application/octet-stream",
      });
      if (uploadError) { setError(uploadError.message); return; }
      storagePath = path;
    }
    const node = store.types[entryDraft.type] || { entries: [] };
    const entry: LearningEntry = {
      id: entryDraft.id, bucket: entryDraft.bucket, kind: entryDraft.kind,
      text: entryDraft.text.trim(), title: entryDraft.kind === "image" ? entryDraft.title.trim() : "",
      storagePath, source: "manual", createdAt: new Date().toISOString(),
    };
    const ok = await persist({ types: { ...store.types, [entryDraft.type]: { ...node, entries: upsertById(node.entries, entry) } } });
    if (ok) { setEntryDraft(null); setEntryDraftFile(null); }
  }

  async function deleteEntry(type: string, entry: LearningEntry) {
    if (!confirm("Apagar esta entrada?")) return;
    const node = store.types[type];
    if (!node) return;
    const ok = await persist({ types: { ...store.types, [type]: { ...node, entries: removeById(node.entries, entry.id) } } });
    if (ok && entry.storagePath) await supabase.storage.from("content-media").remove([entry.storagePath]);
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded) return <div className="card">Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Aprendizado por Tipo de Oferta</h1>
      {OFFER_TYPES.map(([type, label]) => {
        const node = store.types[type];
        const entries = node?.entries || [];
        return (
          <section key={type} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ margin: 0 }}>{label}</h2>
            <textarea
              placeholder="Instrução base"
              value={instructionDrafts[type] ?? node?.baseInstruction ?? ""}
              onChange={(e) => setInstructionDrafts((prev) => ({ ...prev, [type]: e.target.value }))}
            />
            <button type="button" onClick={() => saveInstruction(type)} disabled={busy}>Salvar instrução</button>

            {entries.map((entry) => (
              <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                {entry.kind === "image" && signedUrls[entry.id] ? (
                  <img src={signedUrls[entry.id]} alt={entry.title || entry.text} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4 }} />
                ) : null}
                <span style={{ flex: 1 }}>[{entry.bucket}] {entry.text}</span>
                <button type="button" className="danger" onClick={() => deleteEntry(type, entry)} disabled={busy}>Apagar</button>
              </div>
            ))}
            {entryDraft?.type === type ? (
              <form onSubmit={saveEntry} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={entryDraft.bucket} onChange={(e) => setEntryDraft({ ...entryDraft, bucket: e.target.value })}>
                  {BUCKETS.map(([value, label2]) => <option key={value} value={value}>{label2}</option>)}
                </select>
                <select value={entryDraft.kind} onChange={(e) => setEntryDraft({ ...entryDraft, kind: e.target.value as "text" | "image" })}>
                  <option value="text">Texto</option>
                  <option value="image">Imagem</option>
                </select>
                {entryDraft.kind === "image" ? (
                  <>
                    <input type="text" placeholder="Título" value={entryDraft.title} onChange={(e) => setEntryDraft({ ...entryDraft, title: e.target.value })} />
                    <input type="file" accept="image/*" onChange={(e) => setEntryDraftFile(e.target.files?.[0] || null)} required />
                  </>
                ) : null}
                <textarea placeholder="Texto do aprendizado" value={entryDraft.text} onChange={(e) => setEntryDraft({ ...entryDraft, text: e.target.value })} required />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="primary" disabled={busy}>Salvar</button>
                  <button type="button" onClick={() => { setEntryDraft(null); setEntryDraftFile(null); }}>Cancelar</button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setEntryDraft(newDraft(type))} disabled={!rowId}>+ Nova entrada</button>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/pages/SegmentTemplates.tsx`**

Create `cloud-panel-app/src/pages/SegmentTemplates.tsx`:

```tsx
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface TemplatePiece {
  key: string;
  label: string;
  channel: string;
  angleNote: string;
  storagePath?: string;
}

interface SegmentTemplateRow {
  id: string;
  segment_id: string;
  label: string;
  pieces: TemplatePiece[];
}

export function SegmentTemplates() {
  const [templates, setTemplates] = useState<SegmentTemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  async function load() {
    const { data, error: queryError } = await supabase
      .from("segment_templates")
      .select("id, segment_id, label, pieces")
      .order("label");
    if (queryError) { setError(queryError.message); return; }
    setTemplates((data || []).map((row) => ({ ...row, pieces: Array.isArray(row.pieces) ? row.pieces : [] })));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    templates?.forEach((template) => {
      template.pieces.forEach(async (piece) => {
        const cacheKey = `${template.id}-${piece.key}`;
        if (!piece.storagePath || signedUrls[cacheKey]) return;
        const { data } = await supabase.storage.from("content-media").createSignedUrl(piece.storagePath, 300);
        if (data) setSignedUrls((prev) => ({ ...prev, [cacheKey]: data.signedUrl }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  if (error) return <div className="card">Erro: {error}</div>;
  if (!templates) return <div className="card">Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Templates de Segmento</h1>
      <p style={{ color: "var(--text-dim)" }}>Somente leitura — criar/editar template continua via script local.</p>
      {templates.length === 0 ? <p>Nenhum template registrado ainda.</p> : null}
      {templates.map((template) => (
        <section key={template.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0 }}>{template.label}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {template.pieces.map((piece) => {
              const cacheKey = `${template.id}-${piece.key}`;
              return (
                <div key={piece.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  {signedUrls[cacheKey] ? (
                    <img src={signedUrls[cacheKey]} alt={piece.label} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 4 }} />
                  ) : (
                    <span style={{ width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center", background: "#eee", borderRadius: 4, fontSize: 11 }}>
                      sem imagem
                    </span>
                  )}
                  <span style={{ fontSize: 12 }}>{piece.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as before this task (no new test files).

- [ ] **Step 4: Commit**

```bash
git add cloud-panel-app/src/pages/OfferTypeLearning.tsx cloud-panel-app/src/pages/SegmentTemplates.tsx
git commit -m "feat(cloud-panel): Aprendizado por Tipo de Oferta + Templates de Segmento pages"
```

---

### Task 4: Wire the 3 new routes and nav links

**Files:**
- Modify: `cloud-panel-app/src/App.tsx`
- Modify: `cloud-panel-app/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `SegmentLearning` from `@/pages/SegmentLearning` (Task 2),
  `OfferTypeLearning`/`SegmentTemplates` from `@/pages/OfferTypeLearning`
  and `@/pages/SegmentTemplates` (Task 3).

**Depends-on:** Task 2, Task 3 (imports their page components — this task
only starts once both have committed).

- [ ] **Step 1: Add imports and routes to `App.tsx`**

In `cloud-panel-app/src/App.tsx`, add these imports right after the
`References` import:

```tsx
import { SegmentLearning } from "@/pages/SegmentLearning";
import { OfferTypeLearning } from "@/pages/OfferTypeLearning";
import { SegmentTemplates } from "@/pages/SegmentTemplates";
```

Add this route right after the `/projects/:projectId/referencias` route
(before the closing `</Routes>`):

```tsx
      <Route
        path="/projects/:projectId/aprendizado"
        element={
          <RequireAuth>
            <SegmentLearning />
          </RequireAuth>
        }
      />
      <Route
        path="/aprendizado/tipos-de-oferta"
        element={
          <RequireAuth>
            <OfferTypeLearning />
          </RequireAuth>
        }
      />
      <Route
        path="/aprendizado/templates"
        element={
          <RequireAuth>
            <SegmentTemplates />
          </RequireAuth>
        }
      />
```

- [ ] **Step 2: Add nav links to `Dashboard.tsx`**

In `cloud-panel-app/src/pages/Dashboard.tsx`, change the per-project link
row from:

```tsx
            <Link to={`/projects/${project.id}/ofertas`}>Ofertas e Pilares</Link>
            <Link to={`/projects/${project.id}/referencias`}>Referências</Link>
```

to:

```tsx
            <Link to={`/projects/${project.id}/ofertas`}>Ofertas e Pilares</Link>
            <Link to={`/projects/${project.id}/referencias`}>Referências</Link>
            <Link to={`/projects/${project.id}/aprendizado`}>Aprendizado</Link>
```

Then change the header row from:

```tsx
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Projetos</h1>
        <Link to="/conta">Conta / MFA</Link>
      </div>
```

to:

```tsx
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Projetos</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link to="/aprendizado/tipos-de-oferta">Aprendizado: Tipos de Oferta</Link>
          <Link to="/aprendizado/templates">Templates de Segmento</Link>
          <Link to="/conta">Conta / MFA</Link>
        </div>
      </div>
```

- [ ] **Step 3: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as Task 3 (no test files touched here).

- [ ] **Step 4: Commit**

```bash
git add cloud-panel-app/src/App.tsx cloud-panel-app/src/pages/Dashboard.tsx
git commit -m "feat(cloud-panel): wire Aprendizado routes and nav links"
```

---

## Post-plan (controller, not a subagent task)

After all 4 tasks land and the final review is clean:

1. Run the real migration (`node --env-file=.env src/migrate-to-supabase.js`
   from repo root, or from a worktree checked out on the branch this
   merges into — same caution as last phase: **verify with `grep -n
   "Global learning migrated" src/migrate-to-supabase.js` in whatever
   checkout you run it from, before running, to confirm you're not
   accidentally running stale pre-Aprendizado code from a different
   branch.**) against the live Supabase project.
2. Verify with a quick query that `global_learning`/`segment_templates`
   rows exist and that at least one image entry (if any exist in the real
   local data) got a `storagePath`.
3. Deploy `cloud-panel-app` to Vercel (`npx vercel --yes --prod`).
4. Manually click through all 3 new pages to confirm signed-URL previews
   render and CRUD works.
