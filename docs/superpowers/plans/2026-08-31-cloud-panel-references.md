# Cloud Panel References (Fase 3b-iii-a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the cloud panel show, upload, edit and delete a project's brand
references (images/files used as visual guidance for content generation),
with real preview — closing the gap where reference metadata already exists
in Supabase (`brand_profile.references`, migrated verbatim since Fase 1) but
the actual file bytes still only live on the local disk.

**Architecture:** No new database column — `brand_profile` already holds the
whole local `project.brand` object, references included. This phase (1)
extends the one-time migration script to upload existing reference file
bytes into the already-existing `content-media` Storage bucket and stamp a
`storagePath` field onto each reference, and (2) adds a References page to
`cloud-panel-app` that reads/writes `brand_profile.references` (read-modify-
write, whole array, same convention as every prior cloud-panel phase) and
uploads new files straight from the browser to the same bucket.

**Tech Stack:** Node.js (`node --test`) for the migration script; React 19 +
TypeScript + Vitest for `cloud-panel-app`; Supabase Storage (`content-media`
bucket, already private, already has an "authenticated full access" policy —
no new SQL).

## Global Constraints

- `@supabase/supabase-js` stays pinned to exact `2.106.0` everywhere (Node
  engine floor `>=20`) — this phase adds no new dependency, so this is just
  a reminder not to loosen it if a lockfile touches it.
- Every read of a `jsonb` column must check shape (`Array.isArray(...)`),
  never bare truthiness — Supabase's jsonb default is `'{}'`, not `null`,
  and `{}` is truthy.
- Every write to `brand_profile` is read-modify-write on the **whole**
  object (`{ ...brandProfile, references: next }`) — never construct
  `brand_profile` from just the edited field, that silently drops sibling
  keys (logo, colors, visual style, etc.).
- Storage bucket is `content-media` (reuse — do not create a new bucket).
- Category → role map (exact, mirrors `roleForReferenceCategory` in
  `src/content-central.js`):
  `official_asset` → `brand_asset`, `real_product` → `product_photo`,
  anything else (including `visual_inspiration`) → `visual_reference`.
- Category → automatic-rule text map (exact strings, mirrors
  `automaticReferenceRule` in `src/content-central.js`):
  - `official_asset`: "Preservar exatamente o ativo enviado. Não redesenhar, reinterpretar, alterar textos, cores ou proporções importantes."
  - `real_product`: "Preservar a aparência real. É permitido recortar, ajustar iluminação e integrar à composição, mas não substituir por outro produto."
  - `visual_inspiration` (and default): "Utilizar apenas como inspiração visual. Não copiar logos, nomes, textos, preços, produtos ou elementos exclusivos da referência."
- Signed URL TTL for previews: 300 seconds (matches `Approval.tsx`).

---

### Task 1: Migration — upload reference file bytes, stamp `storagePath`

**Files:**
- Modify: `src/content-central.js:8760` (add `export` to
  `normalizeProjectReferences`)
- Modify: `src/migrate-to-supabase.js` (import, new
  `uploadReferenceFile`/`migrateProjectReferences`, wire into
  `runMigration`/`main`)
- Test: `tests/migrate-to-supabase.test.js` (append new tests)

**Interfaces:**
- Consumes: `normalizeProjectReferences(project)` (existing, made
  exported by this task) — returns `Array<{ id, filename, relativePath,
  previewUrl, mimeType, bytes, width, height, aspectRatio, role,
  usageRoles, referenceCategory, automaticRule, useInNextGeneration,
  weight, instruction, createdAt }>`. `getCentralPaths(targetDir)` →
  `{ projectsDir }`; `getCentralPaths(targetDir, slug)` → `{ projectDir }`
  (both already imported in `migrate-to-supabase.js`).
- Produces: `migrateProjectReferences(targetDir, slug, client) →
  Promise<{ migrated: number, errors: Array<{ slug, reference?, error }> }>`
  — later tasks (none in this plan) and the controller's real migration run
  call this the same way `migrateCompanyBrandData` is called today.

- [ ] **Step 1: Export `normalizeProjectReferences`**

In `src/content-central.js`, line 8760, change:

```js
function normalizeProjectReferences(project) {
```

to:

```js
export function normalizeProjectReferences(project) {
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/migrate-to-supabase.test.js` (after the existing content —
keep the existing `import { runMigration, migrateCompanyBrandData } from
'../src/migrate-to-supabase.js';` at line 207, add `migrateProjectReferences`
to that same import):

```js
function fakeClientForReferences() {
  const updates = [];
  const uploads = [];
  return {
    updates,
    uploads,
    from(table) {
      if (table !== 'projects') throw new Error(`fakeClientForReferences: unhandled table ${table}`);
      return {
        update: (patch) => ({
          eq: async (_col, value) => {
            updates.push({ slug: value, patch });
            return { error: null };
          },
        }),
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

test('migrateProjectReferences uploads reference file bytes and stamps storagePath', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-refs-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(join(projectDir, 'assets', 'references'), { recursive: true });
  await writeFile(join(projectDir, 'assets', 'references', 'img.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      projectId: 'acme-pizza',
      brand: {
        logo: 'acme-logo.png',
        references: [{
          id: 'img', filename: 'img.jpg', relativePath: 'assets/references/img.jpg',
          mimeType: 'image/jpeg', referenceCategory: 'visual_inspiration',
        }],
      },
    }),
  );

  const client = fakeClientForReferences();
  const result = await migrateProjectReferences(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].bucket, 'content-media');
  assert.equal(client.uploads[0].path, 'acme-pizza/assets/references/img.jpg');
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].slug, 'acme-pizza');
  assert.equal(client.updates[0].patch.brand_profile.logo, 'acme-logo.png');
  assert.equal(client.updates[0].patch.brand_profile.references[0].storagePath, 'acme-pizza/assets/references/img.jpg');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateProjectReferences keeps a reference without storagePath when its file is missing on disk', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-refs-missing-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      projectId: 'acme-pizza',
      brand: {
        references: [{
          id: 'ghost', filename: 'ghost.jpg', relativePath: 'assets/references/ghost.jpg',
          mimeType: 'image/jpeg', referenceCategory: 'visual_inspiration',
        }],
      },
    }),
  );

  const client = fakeClientForReferences();
  const result = await migrateProjectReferences(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.uploads.length, 0);
  assert.equal(client.updates[0].patch.brand_profile.references[0].storagePath, undefined);

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateProjectReferences records an error when project.json is missing', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-refs-nofile-'));
  const client = fakeClientForReferences();
  const result = await migrateProjectReferences(targetDir, 'no-such-project', client);
  assert.equal(result.migrated, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].slug, 'no-such-project');
  await rm(targetDir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: FAIL — `migrateProjectReferences is not a function` (not yet
imported/defined).

- [ ] **Step 4: Update the import line**

In `src/migrate-to-supabase.js` line 6, change:

```js
import { getCentralPaths, normalizeCompanyProfile, normalizeBrandXray, normalizeBrandBriefing, normalizeProjectOffers, normalizeProjectOfferGroups, normalizeProjectPillars } from './content-central.js';
```

to:

```js
import { getCentralPaths, normalizeCompanyProfile, normalizeBrandXray, normalizeBrandBriefing, normalizeProjectOffers, normalizeProjectOfferGroups, normalizeProjectPillars, normalizeProjectReferences } from './content-central.js';
```

- [ ] **Step 5: Implement `uploadReferenceFile` and `migrateProjectReferences`**

In `src/migrate-to-supabase.js`, add this right after `migrateCompanyBrandData`
(after its closing `}`, before `export async function runMigration`):

```js
async function uploadReferenceFile(client, projectDir, slug, reference) {
  const fullPath = join(projectDir, reference.relativePath);
  if (!existsSync(fullPath)) return null;

  const buffer = await readFile(fullPath);
  const storagePath = `${slug}/${reference.relativePath}`;
  const { error } = await client.storage.from('content-media').upload(storagePath, buffer, {
    contentType: reference.mimeType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(error.message || String(error));
  return storagePath;
}

export async function migrateProjectReferences(targetDir, slug, client) {
  const result = { migrated: 0, errors: [] };
  const { projectsDir } = getCentralPaths(targetDir);
  const project = await readJsonIfExists(join(projectsDir, slug, 'project.json'));
  if (!project) {
    result.errors.push({ slug, error: 'project.json not found' });
    return result;
  }

  const { projectDir } = getCentralPaths(targetDir, slug);
  const references = normalizeProjectReferences(project);
  const withStorage = [];
  for (const reference of references) {
    try {
      const storagePath = await uploadReferenceFile(client, projectDir, slug, reference);
      withStorage.push(storagePath ? { ...reference, storagePath } : reference);
    } catch (err) {
      result.errors.push({ slug, reference: reference.relativePath, error: err.message });
      withStorage.push(reference);
    }
  }

  const { error } = await client
    .from('projects')
    .update({ brand_profile: { ...project.brand, references: withStorage } })
    .eq('slug', slug);
  if (error) {
    result.errors.push({ slug, error: error.message || String(error) });
    return result;
  }

  result.migrated += 1;
  return result;
}
```

- [ ] **Step 6: Wire into `runMigration` and `main()`**

In `src/migrate-to-supabase.js`, inside `runMigration`, change:

```js
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
```

to:

```js
  const content = { migrated: 0, errors: [] };
  const companyBrand = { migrated: 0, errors: [] };
  const references = { migrated: 0, errors: [] };
  for (const slug of slugs) {
    const perProject = await migrateContentForProject(targetDir, slug, client);
    content.migrated += perProject.migrated;
    content.errors.push(...perProject.errors);

    const perProjectBrand = await migrateCompanyBrandData(targetDir, slug, client);
    companyBrand.migrated += perProjectBrand.migrated;
    companyBrand.errors.push(...perProjectBrand.errors);

    const perProjectReferences = await migrateProjectReferences(targetDir, slug, client);
    references.migrated += perProjectReferences.migrated;
    references.errors.push(...perProjectReferences.errors);
  }

  return { projects, content, companyBrand, references };
```

Then in `main()`, change:

```js
  console.log(`Company/brand data migrated: ${result.companyBrand.migrated} (${result.companyBrand.errors.length} errors)`);
  const allErrors = [...result.projects.errors, ...result.content.errors, ...result.companyBrand.errors];
```

to:

```js
  console.log(`Company/brand data migrated: ${result.companyBrand.migrated} (${result.companyBrand.errors.length} errors)`);
  console.log(`Reference files migrated: ${result.references.migrated} (${result.references.errors.length} errors)`);
  const allErrors = [...result.projects.errors, ...result.content.errors, ...result.companyBrand.errors, ...result.references.errors];
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: PASS, all tests including the 3 new ones and the pre-existing
`runMigration is idempotent` test (which now also exercises
`migrateProjectReferences` on a project with no `brand` key — must still
pass with an empty references array, no crash on `{ ...undefined }`).

- [ ] **Step 8: Commit**

```bash
git add src/content-central.js src/migrate-to-supabase.js tests/migrate-to-supabase.test.js
git commit -m "feat: migrate reference file bytes to Storage, stamp storagePath"
```

---

### Task 2: Cloud panel — References page

**Files:**
- Create: `cloud-panel-app/src/lib/references.ts`
- Test: `cloud-panel-app/tests/references.test.ts`
- Create: `cloud-panel-app/src/pages/References.tsx`
- Modify: `cloud-panel-app/src/App.tsx`
- Modify: `cloud-panel-app/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `upsertById<T extends {id:string}>(list, item)` and
  `removeById<T extends {id:string}>(list, id)` from
  `cloud-panel-app/src/lib/contentStrategy.ts` (existing, unchanged).
  `supabase` client from `cloud-panel-app/src/lib/supabaseClient.ts`
  (existing, unchanged).
- Produces (from `src/lib/references.ts`, for `References.tsx` and its
  test to import):
  - `REFERENCE_CATEGORIES: Array<[string, string]>` — `[value, label]`
    pairs for the category `<select>`.
  - `REFERENCE_WEIGHTS: Array<[string, string]>` — `[value, label]` pairs
    for the weight `<select>`.
  - `roleForCategory(category: string): string`
  - `automaticRuleForCategory(category: string): string`
  - `buildReferenceStoragePath(slug: string, id: string, filename: string): string`

- [ ] **Step 1: Write the failing tests**

Create `cloud-panel-app/tests/references.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { roleForCategory, automaticRuleForCategory, buildReferenceStoragePath } from "../src/lib/references";

describe("roleForCategory", () => {
  it("maps official_asset to brand_asset", () => {
    expect(roleForCategory("official_asset")).toBe("brand_asset");
  });
  it("maps real_product to product_photo", () => {
    expect(roleForCategory("real_product")).toBe("product_photo");
  });
  it("maps visual_inspiration and anything unknown to visual_reference", () => {
    expect(roleForCategory("visual_inspiration")).toBe("visual_reference");
    expect(roleForCategory("bogus")).toBe("visual_reference");
  });
});

describe("automaticRuleForCategory", () => {
  it("returns the official_asset rule text", () => {
    expect(automaticRuleForCategory("official_asset")).toMatch(/Preservar exatamente o ativo enviado/);
  });
  it("returns the real_product rule text", () => {
    expect(automaticRuleForCategory("real_product")).toMatch(/Preservar a aparência real/);
  });
  it("returns the visual_inspiration rule text for that category and as the default", () => {
    expect(automaticRuleForCategory("visual_inspiration")).toMatch(/Utilizar apenas como inspiração visual/);
    expect(automaticRuleForCategory("bogus")).toMatch(/Utilizar apenas como inspiração visual/);
  });
});

describe("buildReferenceStoragePath", () => {
  it("builds slug/references/id-filename", () => {
    expect(buildReferenceStoragePath("acme-pizza", "abc123", "logo.png")).toBe("acme-pizza/references/abc123-logo.png");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/references.test.ts` (from `cloud-panel-app/`)
Expected: FAIL — cannot find module `../src/lib/references`.

- [ ] **Step 3: Implement `src/lib/references.ts`**

Create `cloud-panel-app/src/lib/references.ts`:

```ts
export const REFERENCE_CATEGORIES: Array<[string, string]> = [
  ["official_asset", "Ativo oficial da marca"],
  ["real_product", "Foto real do produto"],
  ["visual_inspiration", "Inspiração visual"],
];

export const REFERENCE_WEIGHTS: Array<[string, string]> = [
  ["low", "Baixo"],
  ["medium", "Médio"],
  ["high", "Alto"],
];

export function roleForCategory(category: string): string {
  if (category === "official_asset") return "brand_asset";
  if (category === "real_product") return "product_photo";
  return "visual_reference";
}

const AUTOMATIC_RULES: Record<string, string> = {
  official_asset: "Preservar exatamente o ativo enviado. Não redesenhar, reinterpretar, alterar textos, cores ou proporções importantes.",
  real_product: "Preservar a aparência real. É permitido recortar, ajustar iluminação e integrar à composição, mas não substituir por outro produto.",
  visual_inspiration: "Utilizar apenas como inspiração visual. Não copiar logos, nomes, textos, preços, produtos ou elementos exclusivos da referência.",
};

export function automaticRuleForCategory(category: string): string {
  return AUTOMATIC_RULES[category] || AUTOMATIC_RULES.visual_inspiration;
}

export function buildReferenceStoragePath(slug: string, id: string, filename: string): string {
  return `${slug}/references/${id}-${filename}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/references.test.ts` (from `cloud-panel-app/`)
Expected: PASS, 7 tests.

- [ ] **Step 5: Implement `src/pages/References.tsx`**

Create `cloud-panel-app/src/pages/References.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";
import { REFERENCE_CATEGORIES, REFERENCE_WEIGHTS, roleForCategory, automaticRuleForCategory, buildReferenceStoragePath } from "@/lib/references";

interface Reference {
  id: string;
  filename: string;
  relativePath: string;
  storagePath?: string;
  mimeType: string;
  bytes: number;
  role: string;
  usageRoles: string[];
  referenceCategory: string;
  weight: string;
  instruction: string;
  automaticRule: string;
  useInNextGeneration: boolean;
  createdAt: string;
  [key: string]: unknown;
}

interface ReferenceDraft {
  id: string;
  referenceCategory: string;
  weight: string;
  instruction: string;
  useInNextGeneration: boolean;
}

function draftFromReference(reference: Reference): ReferenceDraft {
  return {
    id: reference.id,
    referenceCategory: reference.referenceCategory,
    weight: reference.weight,
    instruction: reference.instruction,
    useInNextGeneration: reference.useInNextGeneration,
  };
}

export function References() {
  const { projectId } = useParams<{ projectId: string }>();
  const [slug, setSlug] = useState<string | null>(null);
  const [brandProfile, setBrandProfile] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const [editDraft, setEditDraft] = useState<ReferenceDraft | null>(null);
  const [newCategory, setNewCategory] = useState("visual_inspiration");
  const [newInstruction, setNewInstruction] = useState("");

  const references: Reference[] = Array.isArray(brandProfile.references) ? (brandProfile.references as Reference[]) : [];

  async function load() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("slug, brand_profile")
      .eq("id", projectId)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setSlug(data.slug);
    setBrandProfile(data.brand_profile && typeof data.brand_profile === "object" ? data.brand_profile : {});
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function ensureSignedUrl(reference: Reference) {
    if (!reference.storagePath || signedUrls[reference.id]) return;
    const { data } = await supabase.storage.from("content-media").createSignedUrl(reference.storagePath, 300);
    if (data) setSignedUrls((prev) => ({ ...prev, [reference.id]: data.signedUrl }));
  }

  useEffect(() => {
    references.forEach((reference) => {
      if (reference.mimeType.startsWith("image/")) ensureSignedUrl(reference);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandProfile]);

  async function persist(nextReferences: Reference[]): Promise<boolean> {
    setBusy(true);
    const nextBrandProfile = { ...brandProfile, references: nextReferences };
    const { error: updateError } = await supabase.from("projects").update({ brand_profile: nextBrandProfile }).eq("id", projectId);
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return false;
    }
    setBrandProfile(nextBrandProfile);
    setBusy(false);
    return true;
  }

  async function addReference(e: FormEvent) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !slug) return;

    setBusy(true);
    const id = crypto.randomUUID();
    const storagePath = buildReferenceStoragePath(slug, id, file.name);
    const { error: uploadError } = await supabase.storage.from("content-media").upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const role = roleForCategory(newCategory);
    const reference: Reference = {
      id,
      filename: file.name,
      relativePath: `assets/references/${file.name}`,
      storagePath,
      mimeType: file.type || "application/octet-stream",
      bytes: file.size,
      role,
      usageRoles: [role],
      referenceCategory: newCategory,
      weight: "medium",
      instruction: newInstruction.trim(),
      automaticRule: automaticRuleForCategory(newCategory),
      useInNextGeneration: true,
      createdAt: new Date().toISOString(),
    };
    const ok = await persist(upsertById(references, reference));
    if (ok) {
      setNewCategory("visual_inspiration");
      setNewInstruction("");
      input.value = "";
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editDraft) return;
    const original = references.find((r) => r.id === editDraft.id);
    if (!original) return;
    const role = roleForCategory(editDraft.referenceCategory);
    const updated: Reference = {
      ...original,
      referenceCategory: editDraft.referenceCategory,
      role,
      usageRoles: [role],
      weight: editDraft.weight,
      instruction: editDraft.instruction,
      useInNextGeneration: editDraft.useInNextGeneration,
      automaticRule: automaticRuleForCategory(editDraft.referenceCategory),
    };
    const ok = await persist(upsertById(references, updated));
    if (ok) setEditDraft(null);
  }

  async function deleteReference(reference: Reference) {
    if (!confirm("Apagar esta referência?")) return;
    const ok = await persist(removeById(references, reference.id));
    if (ok && reference.storagePath) {
      await supabase.storage.from("content-media").remove([reference.storagePath]);
    }
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded) return <div className="card">Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Referências</h1>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {references.map((reference) => (
          <div key={reference.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            {reference.mimeType.startsWith("image/") && signedUrls[reference.id] ? (
              <img src={signedUrls[reference.id]} alt={reference.filename} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4 }} />
            ) : (
              <span style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", background: "#eee", borderRadius: 4, fontSize: 11, textAlign: "center" }}>
                {reference.storagePath ? reference.filename : "arquivo indisponível"}
              </span>
            )}
            <span style={{ flex: 1 }}>{reference.filename} — {reference.referenceCategory} — peso {reference.weight}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setEditDraft(draftFromReference(reference))}>Editar</button>
              <button type="button" className="danger" onClick={() => deleteReference(reference)} disabled={busy}>Apagar</button>
            </div>
          </div>
        ))}

        {editDraft ? (
          <form onSubmit={saveEdit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <select value={editDraft.referenceCategory} onChange={(e) => setEditDraft({ ...editDraft, referenceCategory: e.target.value })}>
              {REFERENCE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={editDraft.weight} onChange={(e) => setEditDraft({ ...editDraft, weight: e.target.value })}>
              {REFERENCE_WEIGHTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <textarea placeholder="Instrução" value={editDraft.instruction} onChange={(e) => setEditDraft({ ...editDraft, instruction: e.target.value })} />
            <label>
              <input type="checkbox" checked={editDraft.useInNextGeneration} onChange={(e) => setEditDraft({ ...editDraft, useInNextGeneration: e.target.checked })} /> Usar na próxima geração
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="primary" disabled={busy}>Salvar</button>
              <button type="button" onClick={() => setEditDraft(null)}>Cancelar</button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Adicionar referência</h2>
        <form onSubmit={addReference} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input type="file" name="file" accept="image/*,.pdf,.txt,.md,.doc,.docx" required />
          <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
            {REFERENCE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="text" placeholder="Observação curta" value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} />
          <button type="submit" className="primary" disabled={busy}>Enviar</button>
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Wire the route into `App.tsx`**

In `cloud-panel-app/src/App.tsx`, add the import:

```tsx
import { References } from "@/pages/References";
```

right after the `OffersAndPillars` import, and add this route right after
the `/projects/:projectId/ofertas` route (before the closing `</Routes>`):

```tsx
      <Route
        path="/projects/:projectId/referencias"
        element={
          <RequireAuth>
            <References />
          </RequireAuth>
        }
      />
```

- [ ] **Step 7: Add the Dashboard link**

In `cloud-panel-app/src/pages/Dashboard.tsx`, change:

```tsx
            <Link to={`/projects/${project.id}/ofertas`}>Ofertas e Pilares</Link>
```

to:

```tsx
            <Link to={`/projects/${project.id}/ofertas`}>Ofertas e Pilares</Link>
            <Link to={`/projects/${project.id}/referencias`}>Referências</Link>
```

- [ ] **Step 8: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: TypeScript compiles clean, Vite build succeeds. This is the real
type-check for this project — plain `tsc --noEmit` is known to silently
check nothing here (see prior-session note), always use `npm run build`.

Run: `npx vitest run`
Expected: PASS, all existing tests plus the 7 new `references.test.ts`
tests.

- [ ] **Step 9: Commit**

```bash
git add cloud-panel-app/src/lib/references.ts cloud-panel-app/tests/references.test.ts cloud-panel-app/src/pages/References.tsx cloud-panel-app/src/App.tsx cloud-panel-app/src/pages/Dashboard.tsx
git commit -m "feat(cloud-panel): References page (list, preview, edit, add, delete)"
```

---

## Post-plan (controller, not a subagent task)

After both tasks land and the final review is clean:

1. Run the real migration (`node --env-file=.env src/migrate-to-supabase.js`
   from repo root) against the live Supabase project — this is what
   actually uploads the 15 + 1 + 13 real reference files already confirmed
   present in `boss-pizzaria`/`terco-que-vende`/`casa-de-embalagem`.
2. Verify with a quick query that `storagePath` landed on those rows (same
   style as the verification query already run this session).
3. Deploy `cloud-panel-app` to Vercel (`npx vercel --yes --prod`).
4. Manually click through the References page for at least one project
   with real references (e.g. `boss-pizzaria`) to confirm signed-URL
   previews actually render.
