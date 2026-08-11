# Sistema de Aprendizado de Imagem (Segmento + Tipo de Oferta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop offer-photo uploads from leaking into the shared Referências gallery, shrink References to just logo+direção visual, and expose the two learning systems that already exist half-built and invisible (per-segment auto-learning, per-offer-type hardcoded instructions) as editable, image-capable UI.

**Architecture:** Three independently shippable phases. **A** fixes the reference leak and trims `References.tsx`. **B** upgrades `segment-learnings.json` from a flat string-bucket store to a 3-level hierarchical store (Setor → Nicho → Especialidade, each level inheriting from its ancestor) with a new editable UI, and adds the first real "upload image → AI describes it → user edits → confirms" endpoint pair (`analyzeLearningImage` / `saveLearningEntry`), built on the existing `callCodexAgentText(prompt, timeoutEnvVar, imagePaths)` vision primitive. **C** reuses those same two endpoints with `scope: 'offerType'` to expose `offerObjective()`'s hardcoded per-type strings as an editable `offer-type-learnings.json`, plus a UI panel inside Ofertas.

**Tech Stack:** Node (`node:test`/`node:assert` on the backend, no framework — `src/content-central.js` + raw `http.createServer` router in `src/content-central-server.js`), React + TypeScript + Vitest + Testing Library on the frontend (`content-central-app/`), `react-router-dom`.

## Global Constraints

- Backend has no framework: routes are matched by `parts = route.split('/').filter(Boolean)`, then `if (method === 'X' && parts.length === N && parts[k] === 'segment')` chains in `src/content-central-server.js`. Follow that exact style for new routes — no new abstraction.
- Every "loads/saves the whole project" backend function takes `(projectId, input, targetDir = process.cwd(), now = new Date(), options = {})` — `options` is where injectable AI callers go (see `logoColorAnalyzer`, `webResearcher`). Tests inject a fake; production code defaults to the real implementation. New AI-calling functions MUST follow this pattern so they're testable without shelling out to `codex`.
- Frontend API calls are thin `api<T>(path, options)` wrappers in `content-central-app/src/api/client.ts` (fetch + JSON parse + `ApiError` on non-ok) — no other HTTP client.
- Frontend tests render the real `<App/>` inside `<MemoryRouter initialEntries={[...]}>` and stub `global.fetch` with a canned response sequence (see `stubFetchSequence` in every `*.test.tsx`) — never mock the page component in isolation.
- Backend tests use `withTempProject(async (dir) => {...})` from `tests/content-central.test.js`, call server functions directly (not HTTP), assert on returned data or `image.prompt` string content.
- Run backend tests with `npm test` (repo root). Run frontend tests with `cd content-central-app && npm test`.
- Two existing backend tests must keep passing unmodified: `'segment learnings are reused only for the same selected segment category/specialty'` and `'technical base summarizes pasted sector material and reuses it only inside the same segment hierarchy'` (`tests/content-central.test.js:270`, `:308`) — they assert cross-segment isolation. The new hierarchy adds *more* sharing (same Setor → shares Setor-level entries) without breaking that isolation for genuinely different segments.

---

## File Structure

**Phase A**
- Modify: `src/content-central.js` — `saveProjectAsset` (scope-aware, ~L913-988), new `normalizeProjectOfferAssets`, `toProjectSummary` (~L3576-3609).
- Modify: `content-central-app/src/api/client.ts` — `SaveAssetInput` (scope field), `ProjectSummary` (offerAssets field).
- Modify: `content-central-app/src/pages/workspace/Offers.tsx` — upload passes `scope: "offer"`, photo lookup reads `offerAssets` too.
- Modify: `content-central-app/src/pages/workspace/References.tsx` — remove the reference-library section.
- Modify: `content-central-app/src/pages/workspace/References.test.tsx` — drop the 4 gallery-dependent tests.
- Modify: `content-central-app/src/pages/workspace/Offers.test.tsx` — add a scope-leak regression test.
- Modify: `tests/content-central.test.js` — add offer-asset scope backend test.

**Phase B**
- Modify: `src/content-central.js` — new `segment-learnings.json` v2 schema, `segmentNodePaths`, `loadSegmentLearningNodes`, `addSegmentLearning` (bucket-aware, writes to deepest node), `loadSegmentLearningsForProject` (sums ancestor chain), `migrateSegmentLearningStoreV1ToV2`, new shared `analyzeLearningImage` / `saveLearningEntry` / `deleteLearningEntry`.
- Modify: `src/content-central-server.js` — routes: `POST /api/projects/:id/segment-learnings/analyze-image`, `POST /api/projects/:id/segment-learnings/entries`, `POST /api/projects/:id/segment-learnings/entries-delete`.
- Modify: `content-central-app/src/api/client.ts` — `SegmentLearningNode` type, `analyzeLearningImage`, `saveLearningEntry`, `deleteLearningEntry` wrappers.
- Create: `content-central-app/src/components/LearningGallery.tsx` — shared entry list + add-text/add-image form, used by B and C.
- Create: `content-central-app/src/pages/workspace/SegmentLearning.tsx` — 3-panel page (Setor/Nicho/Especialidade).
- Create: `content-central-app/src/pages/workspace/SegmentLearning.test.tsx`.
- Modify: `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx` — add `SECTIONS` entry.
- Modify: `content-central-app/src/App.tsx` — add route.
- Modify: `tests/content-central.test.js` — hierarchy inheritance test + v1→v2 migration test.

**Phase C**
- Modify: `src/content-central.js` — `offer-type-learnings.json` store, `offerObjective` reads `baseInstruction` from it, `formatContentTopicLines` includes approved entries.
- Modify: `src/content-central-server.js` — routes: `GET /api/projects/:id/offer-type-learnings`, `POST /api/projects/:id/offer-type-learnings/base-instruction`, reuses the Phase B `analyze-image`/`entries`/`entries-delete` routes with `scope=offerType`.
- Modify: `content-central-app/src/api/client.ts` — `OfferTypeLearning` type + wrappers.
- Modify: `content-central-app/src/pages/workspace/Offers.tsx` — "Aprendizado por tipo" panel using `LearningGallery`.
- Modify: `content-central-app/src/pages/workspace/Offers.test.tsx` — panel test.
- Modify: `tests/content-central.test.js` — `offerObjective` override test.

---

# Phase A — Reference leak fix + References scope-down

### Task 1 (A1): Stop offer photos from writing into `project.brand.references`

**Files:**
- Modify: `src/content-central.js:913-988` (`saveProjectAsset`)
- Modify: `src/content-central.js:3576-3609` (`toProjectSummary`)
- Create/modify: add `normalizeProjectOfferAssets` near `normalizeProjectReferences` (`src/content-central.js:5972`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `saveProjectAsset(projectId, assetInput, targetDir, now, options)` now accepts `assetInput.scope === 'offer'`. When set, `kind === 'reference'` uploads are written to `project.offerAssets` (array of the same shape as `project.brand.references` entries) instead of `project.brand.references`/`referenceFiles`. Return shape unchanged (`{ kind, filename, relativePath, bytes, metadata, project }`).
- Produces: `normalizeProjectOfferAssets(project)` — same normalization as `normalizeProjectReferences` but reads `project.offerAssets` (no `referenceFiles`-style migration needed, it's a new field).
- Consumes: existing `normalizeReferenceMetadata`, `upsertReferenceMetadata` (unchanged).

- [ ] **Step 1: Write the failing backend test**

Add to `tests/content-central.test.js` (near the other `saveProjectAsset` tests, e.g. after the logo-color tests around line 507):

```js
test('saveProjectAsset with scope "offer" stores the photo on project.offerAssets, not project.brand.references', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'oferta-fotos', name: 'Oferta Fotos', handle: '@of', approvalEmail: 'a@example.com' }, dir);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const result = await saveProjectAsset('oferta-fotos', {
      kind: 'reference',
      filename: 'produto.png',
      dataUrl,
      role: 'product_photo',
      referenceCategory: 'real_product',
      scope: 'offer',
    }, dir);

    assert.equal(result.project.brand?.references?.length ?? 0, 0);
    assert.equal(result.project.offerAssets?.length, 1);
    assert.equal(result.project.offerAssets[0].filename, 'produto.png');
    assert.ok(result.metadata?.id);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test` (repo root). Expected: FAIL — `result.project.offerAssets` is `undefined`, and the photo is present in `result.project.brand.references` instead.

- [ ] **Step 3: Add `normalizeProjectOfferAssets`**

Add right after `normalizeProjectReferences` (`src/content-central.js:5988`, i.e. after its closing `}`):

```js
function normalizeProjectOfferAssets(project) {
  const existing = Array.isArray(project.offerAssets) ? project.offerAssets : [];
  const byPath = new Map();
  for (const reference of existing) {
    const normalized = normalizeReferenceMetadata({ projectId: project.projectId, ...reference });
    byPath.set(normalized.relativePath, normalized);
  }
  return [...byPath.values()];
}
```

- [ ] **Step 4: Make `saveProjectAsset` scope-aware**

In `src/content-central.js`, replace the `project.brand = {...}` block at lines 955-965 with:

```js
  const isOfferScoped = kind === 'reference' && assetInput?.scope === 'offer';
  project.brand = {
    ...project.brand,
    logoPath: kind === 'logo' ? relativePath : project.brand.logoPath,
    referencesDir: 'assets/references',
    references: kind === 'reference' && !isOfferScoped
      ? upsertReferenceMetadata(currentReferences, referenceMetadata)
      : currentReferences,
    referenceFiles: kind === 'reference' && !isOfferScoped
      ? [...new Set([...(project.brand.referenceFiles || []), relativePath])]
      : project.brand.referenceFiles || [],
  };
  if (isOfferScoped) {
    const currentOfferAssets = normalizeProjectOfferAssets(project);
    project.offerAssets = upsertReferenceMetadata(currentOfferAssets, referenceMetadata);
  }
```

- [ ] **Step 5: Wire `offerAssets` into `toProjectSummary`**

In `src/content-central.js:3576-3609` (`toProjectSummary`), add a line right after `brand: project.brand,` (currently line 3594):

```js
    brand: project.brand,
    offerAssets: normalizeProjectOfferAssets(project),
```

- [ ] **Step 6: Run the backend test again**

Run: `npm test`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "fix(content-central): scope offer photo uploads out of the shared references array"
```

---

### Task 2 (A2): Frontend types + Offers.tsx uses the new scope, resolves preview from `offerAssets`

**Files:**
- Modify: `content-central-app/src/api/client.ts` (`SaveAssetInput` ~L833-852, `ProjectSummary` ~L186-214)
- Modify: `content-central-app/src/pages/workspace/Offers.tsx` (`photoPreviewUrl` ~L194-196, `references` ~L67, upload call ~L307-316)
- Test: `content-central-app/src/pages/workspace/Offers.test.tsx`

**Interfaces:**
- Consumes: `saveProjectAsset` from Task A1 (accepts `scope`), `toProjectSummary`'s new `offerAssets` field.
- Produces: `Offers.tsx` resolves a `photoReferenceId` from `project.offerAssets` first, falling back to `project.brand?.references` (covers photos uploaded before this change).

- [ ] **Step 1: Write the failing frontend test**

Add to `content-central-app/src/pages/workspace/Offers.test.tsx`, after the existing "creates a new product by uploading a real photo first..." test (currently ends at line 205):

```tsx
  it("uploads the offer photo with scope 'offer' so it never lands in the shared references gallery", async () => {
    const savedOffer = { ...RODIZIO_OFFER, photoReferenceIds: ["foto-pizza"] };
    stubFetchSequence([
      { body: projectState() },
      { body: { asset: { kind: "reference", metadata: { id: "foto-pizza" } } } },
      { body: { project: {}, offer: savedOffer } },
      { body: projectState([savedOffer]) },
    ]);
    renderOffers();

    await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova oferta/assunto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Rodízio da Boss");
    const photoFile = new File(["fake-image-bytes"], "pizza.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Foto(s) real(is) do produto (opcional)"), photoFile);
    await userEvent.click(screen.getByRole("button", { name: "Salvar oferta/assunto" }));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/assets");
    expect(JSON.parse(calls[1][1].body as string).scope).toBe("offer");
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd content-central-app && npm test`. Expected: FAIL — `JSON.parse(calls[1][1].body).scope` is `undefined`.

- [ ] **Step 3: Add `scope` to the client type and `offerAssets` to `ProjectSummary`**

In `content-central-app/src/api/client.ts`, find the `SaveAssetInput` interface (~L833-852) and add:

```ts
  scope?: "offer";
```

And in `ProjectSummary` (L186-214), add right after `brand?: ProjectBrand;` (L203):

```ts
  brand?: ProjectBrand;
  offerAssets?: ProjectReference[];
```

- [ ] **Step 4: Pass `scope: "offer"` from Offers.tsx's upload**

In `content-central-app/src/pages/workspace/Offers.tsx`, in `handleSubmit` (the `for (const photoFile of photoFiles)` loop, ~L306-317), add `scope: "offer"` to the `saveAsset()` call:

```tsx
        const uploaded = await saveAsset(project.projectId, {
          kind: "reference",
          filename: photoFile.name,
          dataUrl: await fileToDataUrl(photoFile),
          role: "product_photo",
          usageRoles: ["product_photo"],
          referenceCategory: "real_product",
          useInNextGeneration: true,
          scope: "offer",
          instruction: `Foto real do produto: ${form.name}`,
        });
```

- [ ] **Step 5: Resolve previews from `offerAssets` (with fallback)**

In `Offers.tsx`, change line 67 and the `photoPreviewUrl` function (L194-196):

```tsx
  const references = [...(project.offerAssets || []), ...(project.brand?.references || [])];
```

`photoPreviewUrl` and `removePhoto` already read from `references` — no further change needed there.

- [ ] **Step 6: Run the frontend test again**

Run: `cd content-central-app && npm test`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add content-central-app/src/api/client.ts content-central-app/src/pages/workspace/Offers.tsx content-central-app/src/pages/workspace/Offers.test.tsx
git commit -m "feat(content-central-app): scope offer photo uploads out of the references gallery"
```

---

### Task 3 (A3): Shrink References.tsx to logo + direção visual only

**Files:**
- Modify: `content-central-app/src/pages/workspace/References.tsx`
- Modify: `content-central-app/src/pages/workspace/References.test.tsx`

**Interfaces:**
- Consumes: nothing new — this only removes UI, no data-shape change.
- Produces: `References.tsx` no longer imports/uses `REFERENCE_ROLE_LABELS`, `roleForReferenceCategory`, `saveAsset`, `updateReference`, `deleteReference`, `USAGE_ROLE_OPTIONS`, or renders the reference-library section (lines 239-255 and 310-479 of the current file).

- [ ] **Step 1: Delete the 4 gallery-dependent tests**

In `content-central-app/src/pages/workspace/References.test.tsx`, delete these 4 `it(...)` blocks (identified by their exact titles, currently lines 65-79, 120-133, 135-166 — keep everything else, including `REAL_REFERENCE`, `projectState`, and the 2 tests about visual direction / research online):
- `"renders a real uploaded reference with its category and role pills"`
- `"shows an empty state when there are no references yet"`
- `"deletes a reference through the real endpoint after confirmation"`
- `"edits a reference's metadata through the real endpoint without re-uploading the file"`

Also delete the now-unused `REAL_REFERENCE` constant (L26-39) since only the deleted tests referenced it.

- [ ] **Step 2: Run the frontend tests, confirm the remaining 2 still pass and nothing else newly fails**

Run: `cd content-central-app && npm test -- References`. Expected: 2 tests pass (`"saves the consolidated visual direction..."`, `"researches online visual trends..."`).

- [ ] **Step 3: Remove the reference-library section from References.tsx**

In `content-central-app/src/pages/workspace/References.tsx`:
- Delete the 3-card category-explainer grid, lines 239-255 (`<div className={styles.categoryGrid}>...</div>`).
- Delete the entire "Criativos, modelos, fotos ou parâmetros" `<Card>`, lines 310-479 (from `<Card style={{ padding: 20, marginTop: 16 }}>` through its matching closing `</Card>`) — this removes the upload form, the category/function/prioridade selectors, and the gallery grid.
- Delete now-unused state/handlers that only fed that section: `refInputRef`, `refCategory`, `refInstruction`, `refUseInNext`, `refUsageRoles`, `refWeight`, `refBusy`, `refError`, `deletingPath`, `editingPath`, `editCategory`, `editInstruction`, `editUseInNext`, `editUsageRoles`, `editWeight`, `editBusy`, `editError`, `toggleEditUsageRole`, `toggleUsageRole`, `handleUploadReferences`, `handleDeleteReference`, `handleEditReference`, `handleCancelEditReference`, `handleSaveReferenceEdit` (all currently between L47-230).
- Delete the now-unused imports: `REFERENCE_ROLE_LABELS`, `deleteReference`, `roleForReferenceCategory`, `saveAsset`, `updateReference`, `type ProjectReference` from the `@/api/client` import block, and the top-level `const USAGE_ROLE_OPTIONS = [...]` constant (L21-27).
- Keep: the logo upload card, the "Direção visual consolidada" card (visual style + image rules + pesquisar online), and their existing state/handlers.

- [ ] **Step 4: Run the frontend tests again**

Run: `cd content-central-app && npm test -- References`. Expected: PASS (still 2 tests).

- [ ] **Step 5: Run the full frontend suite to catch anything that imported the removed exports**

Run: `cd content-central-app && npm test`. Expected: PASS. If `References.module.css` now has unused classes (`gallery`, `card`, `thumb`, `body`, `name`, `meta`, `note`, `toolbar`, `roleRow`, `categoryGrid`), that's harmless dead CSS — leave it (no linter in this repo enforces unused-CSS-class removal); do not spend a step hunting it down.

- [ ] **Step 6: Commit**

```bash
git add content-central-app/src/pages/workspace/References.tsx content-central-app/src/pages/workspace/References.test.tsx
git commit -m "refactor(content-central-app): shrink References to logo + direção visual only"
```

---

# Phase B — Hierarchical segment learning (Setor → Nicho → Especialidade)

### Task 4 (B1): Rewrite `segment-learnings.json` as a hierarchical v2 store with ancestor inheritance

**Files:**
- Modify: `src/content-central.js` — `normalizeSegmentLearnings` (~L3440), `projectSegmentKey`/`projectSegmentLabel` (~L3508-3521), `readSegmentLearningStore`/`loadSegmentLearningsForProject`/`addSegmentLearning` (~L3523-3543)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `segmentNodePaths(project)` → `string[]`, ancestor chain from broadest to narrowest, e.g. `["alimenticio", "alimenticio/pizzaria", "alimenticio/pizzaria/napolitana"]`; stops early (shorter array) if a level is empty, e.g. `["alimenticio"]` if only Setor is set.
- Produces: `normalizeSegmentLearningEntry(input)` → `{ id, bucket: 'technical'|'approved'|'avoid', kind: 'text'|'image', text, imagePath, source: 'auto'|'manual', createdAt }`.
- Produces: `loadSegmentLearningNodes(paths, project)` → `Array<{ path, label, level: 'setor'|'nicho'|'especialidade', entries: SegmentLearningEntry[] }>` — one entry per node in `segmentNodePaths`, each with **only its own** entries (not summed) — this is what the new UI renders, one panel per level.
- Produces: `loadSegmentLearningsForProject(paths, project)` → unchanged return shape `{ key, label, technical: string[], approved: string[], avoid: string[] }` (so `buildManual`/`buildImagePrompt` need zero changes), but now **sums entries from every node in the ancestor chain**, filtered to `kind === 'text'` mapped to `.text`, plus for `kind === 'image'` entries appends `` `${entry.text} (ver referência de imagem: ${entry.imagePath})` `` so image-sourced learnings still show up in the text prompt.
- Produces: `addSegmentLearning(paths, project, bucket, line)` — same call signature as today (`bucket` replaces the old `kind` param name, same 3 values), writes to the **deepest** node in `segmentNodePaths(project)` (falls back to the shallowest available if the project has no Especialidade/Nicho set), `source: 'auto'`.
- Produces: `migrateSegmentLearningStoreV1ToV2(v1Store)` → v2 store. Pure function, no I/O.
- Consumes: existing `cleanText`, `slugify`, `normalizeCompanyProfile`, `normalizeBrandInput`, `companyProfileToBrandInput`, `MAX_SEGMENT_LEARNING_ENTRIES` (unchanged).

- [ ] **Step 1: Write the failing inheritance test**

Add to `tests/content-central.test.js`, right after the existing `'segment learnings are reused only for the same selected segment category/specialty'` test (after line 306):

```js
test('segment learnings at the Setor level are shared across different Nicho/Categoria within the same Setor, but not with a different Setor', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'boss-pizza', name: 'Boss Pizza', handle: '@boss', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('boss-pizza', {
      brandName: 'Boss Pizza',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segmentSpecialty: 'napolitana',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);
    const badBatch = await generateContentBatch('boss-pizza', { days: 1, startDate: '2026-07-20' }, dir);
    await deleteProjectContent('boss-pizza', badBatch.items[0].contentId, dir, badBatch.batchId, 'não parecer gerado por IA, mais detalhista');

    await createCentralProject({ projectId: 'rei-hamburguer', name: 'Rei Hambúrguer', handle: '@rei', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('rei-hamburguer', {
      brandName: 'Rei Hambúrguer',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Hamburgueria',
      segmentSpecialty: 'artesanal',
      segment: 'hamburgueria',
      productsOrServices: 'hambúrgueres',
    }, dir);
    const sameSetor = await generateContentBatch('rei-hamburguer', { days: 1, startDate: '2026-07-21' }, dir);
    assert.match(sameSetor.items[0].image.prompt, /não parecer gerado por IA, mais detalhista/);

    await createCentralProject({ projectId: 'obra-civil-2', name: 'Obra Civil 2', handle: '@obra2', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('obra-civil-2', {
      brandName: 'Obra Civil 2',
      segmentGroup: 'Engenharia',
      segmentCategory: 'Construção civil',
      segmentSpecialty: 'residencial',
      segment: 'engenharia',
      productsOrServices: 'construção',
    }, dir);
    const otherSetor = await generateContentBatch('obra-civil-2', { days: 1, startDate: '2026-07-22' }, dir);
    assert.doesNotMatch(otherSetor.items[0].image.prompt, /não parecer gerado por IA, mais detalhista/);
  });
});

test('migrateSegmentLearningStoreV1ToV2 splits the flat label into a Setor/Nicho/Especialidade node chain', () => {
  const v1 = {
    schemaVersion: 1,
    segments: {
      'engenharia-controle-tecnologico-solos-e-pavimentacao': {
        key: 'engenharia-controle-tecnologico-solos-e-pavimentacao',
        label: 'Engenharia / Controle tecnológico / solos e pavimentação',
        technical: ['CBR, limite de liquidez'],
        approved: [],
        avoid: ['não misturar concreto com obra predial genérica'],
      },
    },
  };
  const v2 = migrateSegmentLearningStoreV1ToV2(v1);
  assert.equal(v2.schemaVersion, 2);
  assert.ok(v2.nodes['engenharia']);
  assert.ok(v2.nodes['engenharia/controle-tecnologico']);
  assert.ok(v2.nodes['engenharia/controle-tecnologico/solos-e-pavimentacao']);
  const deepest = v2.nodes['engenharia/controle-tecnologico/solos-e-pavimentacao'].entries;
  assert.ok(deepest.some((e) => e.bucket === 'technical' && e.text === 'CBR, limite de liquidez'));
  assert.ok(deepest.some((e) => e.bucket === 'avoid' && e.text === 'não misturar concreto com obra predial genérica'));
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test`. Expected: FAIL — `migrateSegmentLearningStoreV1ToV2` is not defined, and the Setor-sharing test fails because today's store is keyed by the full flattened label with no ancestor sharing.

- [ ] **Step 3: Replace the segment-learning functions**

In `src/content-central.js`, replace `normalizeSegmentLearnings` (currently `src/content-central.js:3440-3447`, matching the code block quoted below) with the v2 versions. First, the old function to replace:

```js
function normalizeSegmentLearnings(input = {}) {
  return {
    key: cleanText(input?.key),
    label: cleanText(input?.label),
    technical: (Array.isArray(input?.technical) ? input.technical : []).slice(0, MAX_SEGMENT_LEARNING_ENTRIES).map(String),
    approved: (Array.isArray(input?.approved) ? input.approved : []).slice(0, MAX_SEGMENT_LEARNING_ENTRIES).map(String),
    avoid: (Array.isArray(input?.avoid) ? input.avoid : []).slice(0, MAX_SEGMENT_LEARNING_ENTRIES).map(String),
  };
}
```

New code (keeps the function name and return shape — callers in `buildManual`/`buildImagePrompt` don't change):

```js
const SEGMENT_LEVELS = ['setor', 'nicho', 'especialidade'];

function normalizeSegmentLearningEntry(input = {}) {
  return {
    id: String(input.id || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    bucket: ['technical', 'approved', 'avoid'].includes(input.bucket) ? input.bucket : 'approved',
    kind: input.kind === 'image' ? 'image' : 'text',
    text: cleanText(input.text),
    imagePath: input.kind === 'image' ? String(input.imagePath || '').replace(/\\/g, '/') : '',
    source: input.source === 'auto' ? 'auto' : 'manual',
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function segmentNodePaths(project) {
  const profile = normalizeCompanyProfile(project.companyProfile);
  const brandInput = normalizeBrandInput(project.brandInput || companyProfileToBrandInput(profile, project.name));
  const group = slugify(profile.segmentGroup || brandInput.segmentGroup || '');
  const category = slugify(profile.segmentCategory || brandInput.segmentCategory || '');
  const specialty = slugify(profile.segmentSpecialty || brandInput.segmentSpecialty || '');
  const paths = [];
  if (group) paths.push(group);
  if (group && category) paths.push(`${group}/${category}`);
  if (group && category && specialty) paths.push(`${group}/${category}/${specialty}`);
  return paths;
}

function segmentNodeLabel(project, level) {
  const profile = normalizeCompanyProfile(project.companyProfile);
  const brandInput = normalizeBrandInput(project.brandInput || companyProfileToBrandInput(profile, project.name));
  const group = cleanText(profile.segmentGroup || brandInput.segmentGroup || '');
  const category = cleanText(profile.segmentCategory || brandInput.segmentCategory || '');
  const specialty = cleanText(profile.segmentSpecialty || brandInput.segmentSpecialty || '');
  if (level === 'setor') return group;
  if (level === 'nicho') return [group, category].filter(Boolean).join(' / ');
  return [group, category, specialty].filter(Boolean).join(' / ');
}

// Legacy flat shape (buildManual/buildImagePrompt callers keep working
// unchanged) — now summed across every node in the project's ancestor
// chain instead of read from a single flat-keyed bucket, so a Setor-level
// entry (e.g. "não parecer gerado por IA") reaches every Nicho underneath
// it without being copy-pasted into each one.
function normalizeSegmentLearnings(input = {}) {
  const entries = Array.isArray(input?.entries) ? input.entries.map(normalizeSegmentLearningEntry) : [];
  const textFor = (bucket) => entries
    .filter((entry) => entry.bucket === bucket)
    .map((entry) => (entry.kind === 'image' ? `${entry.text} (ver referência de imagem: ${entry.imagePath})` : entry.text))
    .filter(Boolean)
    .slice(0, MAX_SEGMENT_LEARNING_ENTRIES);
  return {
    key: cleanText(input?.key),
    label: cleanText(input?.label),
    technical: textFor('technical'),
    approved: textFor('approved'),
    avoid: textFor('avoid'),
  };
}

function migrateSegmentLearningStoreV1ToV2(v1Store) {
  const nodes = {};
  for (const segment of Object.values(v1Store?.segments || {})) {
    const parts = String(segment.label || '').split(' / ').map((part) => slugify(part)).filter(Boolean);
    if (!parts.length) continue;
    const paths = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    const deepestPath = paths[paths.length - 1];
    const labelParts = String(segment.label || '').split(' / ').map((part) => part.trim()).filter(Boolean);
    for (const path of paths) {
      if (!nodes[path]) nodes[path] = { label: labelParts.slice(0, path.split('/').length).join(' / '), entries: [] };
    }
    const entries = [];
    for (const text of segment.technical || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'technical', kind: 'text', text, source: 'auto' }));
    for (const text of segment.approved || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'approved', kind: 'text', text, source: 'auto' }));
    for (const text of segment.avoid || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'avoid', kind: 'text', text, source: 'auto' }));
    nodes[deepestPath].entries.push(...entries);
  }
  return { schemaVersion: 2, nodes };
}

async function readSegmentLearningStore(paths) {
  const stored = await readJson(paths.segmentLearningsPath, null);
  if (!stored) return { schemaVersion: 2, nodes: {} };
  if (stored.schemaVersion === 2) return stored;
  return migrateSegmentLearningStoreV1ToV2(stored);
}

async function loadSegmentLearningNodes(paths, project) {
  const store = await readSegmentLearningStore(paths);
  return segmentNodePaths(project).map((path, index) => ({
    path,
    label: segmentNodeLabel(project, SEGMENT_LEVELS[index]),
    level: SEGMENT_LEVELS[index],
    entries: (store.nodes[path]?.entries || []).map(normalizeSegmentLearningEntry),
  }));
}

async function loadSegmentLearningsForProject(paths, project) {
  const nodePaths = segmentNodePaths(project);
  if (!nodePaths.length) return normalizeSegmentLearnings();
  const store = await readSegmentLearningStore(paths);
  const entries = nodePaths.flatMap((path) => store.nodes[path]?.entries || []);
  return normalizeSegmentLearnings({ key: nodePaths[nodePaths.length - 1], label: projectSegmentLabel(project), entries });
}

async function addSegmentLearning(paths, project, bucket, line) {
  const nodePaths = segmentNodePaths(project);
  const text = cleanText(line);
  if (!nodePaths.length || !text || !['approved', 'avoid', 'technical'].includes(bucket)) return;
  const deepestPath = nodePaths[nodePaths.length - 1];
  const store = await readSegmentLearningStore(paths);
  const node = store.nodes[deepestPath] || { label: segmentNodeLabel(project, SEGMENT_LEVELS[nodePaths.length - 1]), entries: [] };
  const entry = normalizeSegmentLearningEntry({ bucket, kind: 'text', text, source: 'auto' });
  node.entries = [entry, ...node.entries.filter((existing) => existing.text !== text)].slice(0, MAX_SEGMENT_LEARNING_ENTRIES);
  store.nodes = { ...store.nodes, [deepestPath]: node };
  store.schemaVersion = 2;
  await writeJson(paths.segmentLearningsPath, store);
}
```

Also update `projectSegmentKey`/`projectSegmentLabel` callers: they're unchanged in signature and still used by `loadSegmentLearningsForProject`'s `label` field and by `toProjectSummary`'s `segmentLearnings: normalizeSegmentLearnings(project.segmentLearnings)` (`src/content-central.js:3605`) — that line stays as-is since `normalizeSegmentLearnings` still returns the same flat shape.

- [ ] **Step 4: Run the tests again**

Run: `npm test`. Expected: PASS, including the two pre-existing isolation tests (`:270`, `:308`).

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): hierarchical segment learning with Setor/Nicho/Especialidade inheritance"
```

---

### Task 5 (B2): Shared `analyzeLearningImage` / `saveLearningEntry` / `deleteLearningEntry` + routes

**Files:**
- Modify: `src/content-central.js` — new functions near `loadSegmentLearningNodes`
- Modify: `src/content-central-server.js` — 3 new routes under `/api/projects/:id/segment-learnings/*`
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `async function analyzeLearningImage(projectId, input, targetDir, now, options)` where `input = { scope: 'segment'|'offerType', groupKey, dataUrl, filename }`. Saves the file to `assets/learning/<scope>/<slugify(groupKey)>/<filename>`, calls `options.learningImageAnalyzer(imagePath, context)` (default: real implementation using `callCodexAgentText`) and returns `{ imagePath, suggestedText }`. Does **not** write to any learning store yet.
- Produces: `async function saveLearningEntry(projectId, input, targetDir, now)` where `input = { scope: 'segment'|'offerType', groupKey, bucket, kind, text, imagePath }`. `scope: 'segment'` writes to `segment-learnings.json` under `nodes[groupKey]` (via the same store shape as B1); `scope: 'offerType'` writes to a new `offer-type-learnings.json` under `types[groupKey]` (built in Phase C, but the write path is shared — Phase C only needs to add the read side). Returns the updated node's `entries`.
- Produces: `async function deleteLearningEntry(projectId, input, targetDir)` where `input = { scope, groupKey, entryId }`.
- Consumes: `callCodexAgentText(prompt, timeoutEnvVar, imagePaths)` (`src/content-central-server.js:3135`, already exported — check its export statement and import it into `content-central.js`, or move `analyzeLearningImage`'s default analyzer into `content-central-server.js` next to `callCodexAgentText` and pass it in via `options.learningImageAnalyzer` from the route handler, following the same wiring as `logoColorAnalyzer` in the `/assets` route (`src/content-central-server.js:619`) — prefer this second approach, it keeps `content-central.js` free of `codex`-shelling code, matching today's separation.

- [ ] **Step 1: Write the failing backend test**

Add to `tests/content-central.test.js`:

```js
test('analyzeLearningImage saves the file and returns a suggested description without writing to the store yet; saveLearningEntry then persists it', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'boss-pizza-2', name: 'Boss Pizza 2', handle: '@boss2', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('boss-pizza-2', {
      brandName: 'Boss Pizza 2',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segmentSpecialty: 'napolitana',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const fakeAnalyzer = async () => 'Esfiha redonda, borda dourada natural, sem formato retangular.';

    const analyzed = await analyzeLearningImage('boss-pizza-2', {
      scope: 'segment',
      groupKey: 'alimenticio/pizzaria',
      dataUrl,
      filename: 'esfiha-redonda.png',
    }, dir, new Date(), { learningImageAnalyzer: fakeAnalyzer });

    assert.match(analyzed.imagePath, /assets\/learning\/segment\/alimenticio-pizzaria\/esfiha-redonda\.png/);
    assert.equal(analyzed.suggestedText, 'Esfiha redonda, borda dourada natural, sem formato retangular.');

    const saved = await saveLearningEntry('boss-pizza-2', {
      scope: 'segment',
      groupKey: 'alimenticio/pizzaria',
      bucket: 'approved',
      kind: 'image',
      text: analyzed.suggestedText,
      imagePath: analyzed.imagePath,
    }, dir, new Date());

    assert.equal(saved.length, 1);
    assert.equal(saved[0].imagePath, analyzed.imagePath);

    const nodes = await loadSegmentLearningNodes(getCentralPaths(dir, 'boss-pizza-2'), await loadProjectForTest('boss-pizza-2', dir));
    const pizzariaNode = nodes.find((node) => node.path === 'alimenticio/pizzaria');
    assert.equal(pizzariaNode.entries.length, 1);

    await deleteLearningEntry('boss-pizza-2', { scope: 'segment', groupKey: 'alimenticio/pizzaria', entryId: saved[0].id }, dir);
    const nodesAfterDelete = await loadSegmentLearningNodes(getCentralPaths(dir, 'boss-pizza-2'), await loadProjectForTest('boss-pizza-2', dir));
    assert.equal(nodesAfterDelete.find((node) => node.path === 'alimenticio/pizzaria').entries.length, 0);
  });
});
```

This test calls a `loadProjectForTest` helper that doesn't exist yet — `loadProject`/`loadSegmentLearningNodes` aren't exported. Add a minimal exported wrapper next to the other test-only exports at the bottom of `src/content-central.js` (check the existing `export { ... }` block for the pattern, e.g. where `listProjectReferences` is exported) — export `loadSegmentLearningNodes` directly (it already takes `paths, project`, both constructible from exported helpers `getCentralPaths` and the newly-exported `async function getProjectForTest(projectId, targetDir) { return loadProject(getCentralPaths(targetDir, projectId)); }`, exported as `loadProjectForTest`.

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test`. Expected: FAIL — none of `analyzeLearningImage`, `saveLearningEntry`, `deleteLearningEntry`, `loadSegmentLearningNodes`, `loadProjectForTest` are exported yet.

- [ ] **Step 3: Implement the three functions in `src/content-central.js`**

Add near `loadSegmentLearningNodes` (from Task B1):

```js
function learningStorePath(paths, scope) {
  return scope === 'offerType' ? paths.offerTypeLearningsPath : paths.segmentLearningsPath;
}

async function readLearningStore(paths, scope) {
  if (scope === 'segment') return readSegmentLearningStore(paths);
  const stored = await readJson(paths.offerTypeLearningsPath, null);
  return stored || { schemaVersion: 1, types: {} };
}

async function writeLearningStore(paths, scope, store) {
  await writeJson(learningStorePath(paths, scope), store);
}

function learningStoreNodesKey(scope) {
  return scope === 'segment' ? 'nodes' : 'types';
}

async function analyzeLearningImage(projectId, input, targetDir = process.cwd(), now = new Date(), options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
  const groupSlug = slugify(input?.groupKey || '');
  const filename = sanitizeFilename(input?.filename || 'referencia.bin');
  const buffer = decodeDataUrl(input?.dataUrl);
  const relativePath = `assets/learning/${scope === 'segment' ? 'segment' : 'offer-type'}/${groupSlug}/${filename}`;
  const destination = join(targetDir, '_opensquad', 'content-central', 'projects', projectId, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, buffer);

  const analyzer = typeof options.learningImageAnalyzer === 'function' ? options.learningImageAnalyzer : defaultLearningImageAnalyzer;
  const context = scope === 'segment'
    ? `segmento "${input.groupKey}" da empresa ${project.name}`
    : `tipo de oferta "${input.groupKey}"`;
  const suggestedText = await analyzer(destination, context);

  return { imagePath: relativePath, suggestedText: cleanText(suggestedText || '') };
}

async function defaultLearningImageAnalyzer() {
  return '';
}

async function saveLearningEntry(projectId, input, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
    const store = scope === 'segment' ? await readSegmentLearningStore(paths) : await readLearningStore(paths, scope);
    const nodesKey = learningStoreNodesKey(scope);
    const groupKey = scope === 'segment' ? String(input.groupKey || '') : slugify(input.groupKey || '');
    const node = store[nodesKey][groupKey] || { label: input.groupKey, entries: [] };
    const entry = normalizeSegmentLearningEntry({
      bucket: input.bucket,
      kind: input.kind,
      text: input.text,
      imagePath: input.imagePath,
      source: 'manual',
    });
    node.entries = [entry, ...node.entries].slice(0, MAX_SEGMENT_LEARNING_ENTRIES);
    store[nodesKey] = { ...store[nodesKey], [groupKey]: node };
    store.schemaVersion = scope === 'segment' ? 2 : 1;
    await writeLearningStore(paths, scope, store);
    return node.entries;
  });
}

async function deleteLearningEntry(projectId, input, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
    const store = scope === 'segment' ? await readSegmentLearningStore(paths) : await readLearningStore(paths, scope);
    const nodesKey = learningStoreNodesKey(scope);
    const groupKey = scope === 'segment' ? String(input.groupKey || '') : slugify(input.groupKey || '');
    const node = store[nodesKey][groupKey];
    if (!node) return [];
    node.entries = node.entries.filter((entry) => entry.id !== input.entryId);
    store[nodesKey] = { ...store[nodesKey], [groupKey]: node };
    await writeLearningStore(paths, scope, store);
    return node.entries;
  });
}
```

Add `offerTypeLearningsPath: join(root, 'offer-type-learnings.json')` next to the existing `segmentLearningsPath` (`src/content-central.js:297`).

Export `analyzeLearningImage`, `saveLearningEntry`, `deleteLearningEntry`, `loadSegmentLearningNodes`, and add:

```js
export async function loadProjectForTest(projectId, targetDir = process.cwd()) {
  return loadProject(getCentralPaths(targetDir, projectId));
}
```

- [ ] **Step 4: Wire the real image analyzer in `content-central-server.js`**

Near `callCodexAgentText` (`src/content-central-server.js:3135`), add:

```js
async function analyzeLearningImageWithCodexAgent(imagePath, context) {
  const prompt = `Descreva em 1-2 frases o que esta imagem ensina sobre "${context}" para gerar artes publicitárias mais realistas: formato real do produto, textura, iluminação, o que evita parecer "gerado por IA". Responda só com a descrição, sem introdução.`;
  const raw = await callCodexAgentText(prompt, 'OPENSQUAD_REVIEW_TIMEOUT_MS', [imagePath]);
  return raw || '';
}
```

In the route dispatcher, add 3 new routes right after the existing `research-online` route (`src/content-central-server.js:653-659`):

```js
  if (parts.length === 5 && parts[3] === 'segment-learnings' && parts[4] === 'analyze-image') {
    const body = await readBody(req);
    const result = await analyzeLearningImage(projectId, { ...body, scope: 'segment' }, targetDir, new Date(), { learningImageAnalyzer: analyzeLearningImageWithCodexAgent });
    return sendJson(res, 200, result);
  }

  if (parts.length === 5 && parts[3] === 'segment-learnings' && parts[4] === 'entries') {
    const body = await readBody(req);
    const entries = await saveLearningEntry(projectId, { ...body, scope: 'segment' }, targetDir);
    return sendJson(res, 200, { entries });
  }

  if (parts.length === 5 && parts[3] === 'segment-learnings' && parts[4] === 'entries-delete') {
    const body = await readBody(req);
    const entries = await deleteLearningEntry(projectId, { ...body, scope: 'segment' }, targetDir);
    return sendJson(res, 200, { entries });
  }
```

Import the 3 new functions plus `loadSegmentLearningNodes` into `content-central-server.js`'s existing `import { ... } from './content-central.js'` block.

- [ ] **Step 5: Run the backend test again**

Run: `npm test`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/content-central.js src/content-central-server.js tests/content-central.test.js
git commit -m "feat(content-central): shared upload-image-analyze-confirm learning entry pipeline"
```

---

### Task 6 (B3): Client wrappers + types

**Files:**
- Modify: `content-central-app/src/api/client.ts`

**Interfaces:**
- Produces: `SegmentLearningNode` type, `analyzeLearningImage(projectId, { scope, groupKey, dataUrl, filename })`, `saveLearningEntry(projectId, { scope, groupKey, bucket, kind, text, imagePath })`, `deleteLearningEntry(projectId, { scope, groupKey, entryId })`.
- Consumes: `api<T>()` wrapper (`client.ts:314-323`), routes from Task B2.

- [ ] **Step 1: Add types and wrappers to `client.ts`**

Add near `ProjectReference` (`client.ts:147-160`):

```ts
export interface SegmentLearningEntry {
  id: string;
  bucket: "technical" | "approved" | "avoid";
  kind: "text" | "image";
  text: string;
  imagePath?: string;
  source: "auto" | "manual";
  createdAt: string;
}

export interface SegmentLearningNode {
  path: string;
  label: string;
  level: "setor" | "nicho" | "especialidade";
  entries: SegmentLearningEntry[];
}
```

Add near `researchOnline` (`client.ts:715-720`):

```ts
export function analyzeLearningImage(
  projectId: string,
  input: { scope: "segment" | "offerType"; groupKey: string; dataUrl: string; filename: string },
): Promise<{ imagePath: string; suggestedText: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/segment-learnings/analyze-image`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveLearningEntry(
  projectId: string,
  input: { scope: "segment" | "offerType"; groupKey: string; bucket: "technical" | "approved" | "avoid"; kind: "text" | "image"; text: string; imagePath?: string },
): Promise<{ entries: SegmentLearningEntry[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/segment-learnings/entries`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteLearningEntry(
  projectId: string,
  input: { scope: "segment" | "offerType"; groupKey: string; entryId: string },
): Promise<{ entries: SegmentLearningEntry[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/segment-learnings/entries-delete`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

Add `segmentLearningNodes?: SegmentLearningNode[]` to `ProjectSummary` (this needs a matching backend field — add Step 2 below).

- [ ] **Step 2: Expose `segmentLearningNodes` on the project the frontend already fetches**

In `src/content-central.js`'s `toProjectSummary` (`:3576-3609`), add (this function is `async` already? check — if not, `loadSegmentLearningNodes` is async, so this requires `toProjectSummary` to become `async` and its one caller in `listCentralProjects` to `await` it; grep `toProjectSummary(` for all call sites before editing and await each one):

```js
    segmentLearnings: normalizeSegmentLearnings(project.segmentLearnings),
    segmentLearningNodes: await loadSegmentLearningNodes(paths, project),
```

(`paths` needs to be in scope — `toProjectSummary` currently takes only `project`; change its signature to `toProjectSummary(project, paths)` and update call sites to pass `paths`.)

- [ ] **Step 3: Run backend + frontend builds to catch signature mismatches**

Run: `npm test` (repo root) then `cd content-central-app && npm run build`. Expected: both pass — `npm run build` (TypeScript) catches any missed `ProjectSummary` usage.

- [ ] **Step 4: Commit**

```bash
git add content-central-app/src/api/client.ts src/content-central.js
git commit -m "feat(content-central-app): client wrappers for the learning-entry pipeline"
```

---

### Task 7 (B4): `LearningGallery` component + `SegmentLearning` page + menu wiring

**Files:**
- Create: `content-central-app/src/components/LearningGallery.tsx`
- Create: `content-central-app/src/pages/workspace/SegmentLearning.tsx`
- Create: `content-central-app/src/pages/workspace/SegmentLearning.test.tsx`
- Modify: `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`
- Modify: `content-central-app/src/App.tsx`

**Interfaces:**
- Produces: `LearningGallery({ scope, groupKey, entries, onEntriesChange })` — renders the entry list (text or thumbnail + text), a "Adicionar texto" input+button, and a "Adicionar imagem" file input that calls `analyzeLearningImage` then shows the suggested text in an editable field with "Confirmar"/"Descartar" before calling `saveLearningEntry`. Each entry has an "Apagar" button calling `deleteLearningEntry`.
- Consumes: `analyzeLearningImage`, `saveLearningEntry`, `deleteLearningEntry`, `fileToDataUrl` (all from `client.ts`, `fileToDataUrl` already used in `Offers.tsx`).

- [ ] **Step 1: Write the failing test for `SegmentLearning.tsx`**

Create `content-central-app/src/pages/workspace/SegmentLearning.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchSequence(responses: Array<{ body: unknown; ok?: boolean }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve({ ok: response.ok !== false, text: async () => JSON.stringify(response.body) });
    }),
  );
}

function projectState(segmentLearningNodes: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", brand: {}, segmentLearningNodes }],
    globalRules: {},
  };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/aprendizado-segmento"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("SegmentLearning", () => {
  it("renders one panel per hierarchy level with its own entries", async () => {
    stubFetchSequence([{
      body: projectState([
        { path: "alimenticio", label: "Alimentício", level: "setor", entries: [{ id: "e1", bucket: "approved", kind: "text", text: "Não parecer gerado por IA", source: "manual", createdAt: "2026-08-01" }] },
        { path: "alimenticio/pizzaria", label: "Alimentício / Pizzaria", level: "nicho", entries: [] },
      ]),
    }]);
    renderPage();

    expect(await screen.findByText("Alimentício")).toBeInTheDocument();
    expect(screen.getByText("Alimentício / Pizzaria")).toBeInTheDocument();
    expect(screen.getByText("Não parecer gerado por IA")).toBeInTheDocument();
  });

  it("adds a manual text entry to the Nicho panel through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState([{ path: "alimenticio/pizzaria", label: "Alimentício / Pizzaria", level: "nicho", entries: [] }]) },
      { body: { entries: [{ id: "e2", bucket: "approved", kind: "text", text: "Esfiha tem que ser redonda", source: "manual", createdAt: "2026-08-01" }] } },
    ]);
    renderPage();

    await screen.findByText("Alimentício / Pizzaria");
    await userEvent.type(screen.getByLabelText("Novo aprendizado (texto)"), "Esfiha tem que ser redonda");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByText("Esfiha tem que ser redonda")).toBeInTheDocument();
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(call[0]).toBe("/api/projects/boss-pizzaria/segment-learnings/entries");
    expect(JSON.parse(call[1].body as string).groupKey).toBe("alimenticio/pizzaria");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd content-central-app && npm test -- SegmentLearning`. Expected: FAIL — `SegmentLearning.tsx` doesn't exist, route not registered.

- [ ] **Step 3: Build `LearningGallery.tsx`**

```tsx
import { useState } from "react";
import { analyzeLearningImage, deleteLearningEntry, fileToDataUrl, saveLearningEntry, type SegmentLearningEntry } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export function LearningGallery({
  projectId,
  scope,
  groupKey,
  entries,
  onEntriesChange,
}: {
  projectId: string;
  scope: "segment" | "offerType";
  groupKey: string;
  entries: SegmentLearningEntry[];
  onEntriesChange: (entries: SegmentLearningEntry[]) => void;
}) {
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ imagePath: string; suggestedText: string } | null>(null);
  const [pendingImageText, setPendingImageText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAddText() {
    if (!newText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveLearningEntry(projectId, { scope, groupKey, bucket: "approved", kind: "text", text: newText.trim() });
      onEntriesChange(result.entries);
      setNewText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadImage(file: File) {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const analyzed = await analyzeLearningImage(projectId, { scope, groupKey, dataUrl, filename: file.name });
      setPendingImage(analyzed);
      setPendingImageText(analyzed.suggestedText);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmImage() {
    if (!pendingImage) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveLearningEntry(projectId, { scope, groupKey, bucket: "approved", kind: "image", text: pendingImageText, imagePath: pendingImage.imagePath });
      onEntriesChange(result.entries);
      setPendingImage(null);
      setPendingImageText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(entryId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteLearningEntry(projectId, { scope, groupKey, entryId });
      onEntriesChange(result.entries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {entries.map((entry) => (
        <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
          <span>{entry.text}</span>
          <Button variant="ghost" disabled={busy} onClick={() => handleDelete(entry.id)}>Apagar</Button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          aria-label="Novo aprendizado (texto)"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Ex: não parecer gerado por IA, ser mais detalhista"
        />
        <Button disabled={busy} onClick={handleAddText}>Adicionar</Button>
      </div>
      <div style={{ marginTop: 8 }}>
        <label htmlFor={`upload-${groupKey}`}>Adicionar imagem de referência</label>
        <input
          id={`upload-${groupKey}`}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleUploadImage(e.target.files[0])}
        />
      </div>
      {pendingImage ? (
        <Card style={{ padding: 12, marginTop: 8 }}>
          <p className="muted">A IA descreveu: revise antes de confirmar.</p>
          <textarea value={pendingImageText} onChange={(e) => setPendingImageText(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button disabled={busy} onClick={handleConfirmImage}>Confirmar</Button>
            <Button variant="secondary" onClick={() => setPendingImage(null)}>Descartar</Button>
          </div>
        </Card>
      ) : null}
      {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Build `SegmentLearning.tsx`**

```tsx
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import type { SegmentLearningNode } from "@/api/client";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { LearningGallery } from "@/components/LearningGallery";

export function SegmentLearning() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [nodes, setNodes] = useState<SegmentLearningNode[]>(project.segmentLearningNodes || []);

  if (!nodes.length) {
    return (
      <div>
        <h2>Aprendizado de segmento</h2>
        <EmptyState title="Cadastre o segmento em Empresa / Raio-X" description="O aprendizado de segmento aparece aqui depois que Setor e Nicho estiverem preenchidos." />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Aprendizado de segmento</h2>
      <p className="muted">
        Setor vale para todo o ramo; Nicho e Especialidade valem só para esse recorte. Cada nível herda o que está acima dele.
      </p>
      <div style={{ display: "grid", gap: 16 }}>
        {nodes.map((node) => (
          <Card key={node.path} style={{ padding: 16 }}>
            <b>{node.label}</b>
            <LearningGallery
              projectId={project.projectId}
              scope="segment"
              groupKey={node.path}
              entries={node.entries}
              onEntriesChange={(entries) => setNodes((current) => current.map((n) => (n.path === node.path ? { ...n, entries } : n)))}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the menu and route**

In `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`, add to `SECTIONS` (after the `"empresa"` entry, `:19`):

```ts
  { to: "empresa", label: "Empresa / Raio-X", hideForCatalog: true, group: "Configuração" },
  { to: "aprendizado-segmento", label: "Aprendizado de segmento", hideForCatalog: true, group: "Configuração" },
```

In `content-central-app/src/App.tsx`, add the import and route:

```tsx
import { SegmentLearning } from "@/pages/workspace/SegmentLearning";
...
          <Route path="aprendizado-segmento" element={<SegmentLearning />} />
```

- [ ] **Step 6: Run the tests again**

Run: `cd content-central-app && npm test -- SegmentLearning`. Expected: PASS.

- [ ] **Step 7: Run the full frontend suite**

Run: `cd content-central-app && npm test`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add content-central-app/src/components/LearningGallery.tsx content-central-app/src/pages/workspace/SegmentLearning.tsx content-central-app/src/pages/workspace/SegmentLearning.test.tsx content-central-app/src/layouts/ProjectWorkspaceLayout.tsx content-central-app/src/App.tsx
git commit -m "feat(content-central-app): segment learning UI (Setor/Nicho/Especialidade panels)"
```

---

# Phase C — Per-offer-type learning (global, reuses Phase B's pipeline)

### Task 8 (C1): `offerObjective()` reads from an editable `offer-type-learnings.json`

**Files:**
- Modify: `src/content-central.js` — `offerObjective` (~L4086-4092), `formatContentTopicLines` (~L4094-4107)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `async function loadOfferTypeLearning(targetDir, type)` → `{ type, baseInstruction: string, entries: SegmentLearningEntry[] }`. Falls back to the current hardcoded strings (the 4 that exist today, the generic template for the other 6) when no override is stored — so this is a pure addition, zero behavior change until someone edits a type through the new UI.
- Produces: `async function saveOfferTypeBaseInstruction(targetDir, type, baseInstruction)`.
- Consumes: `saveLearningEntry`/`deleteLearningEntry` from Task B2 with `scope: 'offerType'`, `OFFER_TYPE_TO_PILLAR_ROLE`-style constant listing all 10 types (already exists client-side; mirror the 10 keys server-side — check `offerTypeLabel()` in `content-central.js` for the canonical list before hardcoding a duplicate).

- [ ] **Step 1: Write the failing test**

```js
test('offerObjective uses a saved baseInstruction override instead of the hardcoded default, and approved learning entries are appended to the content topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'boss-pizza-3', name: 'Boss Pizza 3', handle: '@boss3', approvalEmail: 'a@example.com' }, dir);
    await saveOfferTypeBaseInstruction(dir, 'combo', 'Combo: foco no produto, borda visível, CTA de delivery direto, nunca cortar a caixa.');
    await saveLearningEntry('boss-pizza-3', {
      scope: 'offerType',
      groupKey: 'combo',
      bucket: 'approved',
      kind: 'text',
      text: 'Anúncios de combo com preço em selo circular convertem mais.',
    }, dir);

    const loaded = await loadOfferTypeLearning(dir, 'combo');
    assert.equal(loaded.baseInstruction, 'Combo: foco no produto, borda visível, CTA de delivery direto, nunca cortar a caixa.');
    assert.equal(loaded.entries.length, 1);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test`. Expected: FAIL — `saveOfferTypeBaseInstruction`/`loadOfferTypeLearning` not defined.

- [ ] **Step 3: Implement**

Add near `offerObjective` (`src/content-central.js:4086`):

```js
async function loadOfferTypeLearning(targetDir, type) {
  const paths = getCentralPaths(targetDir, '__global__');
  const stored = await readJson(paths.offerTypeLearningsPath, null);
  const node = stored?.types?.[type];
  return {
    type,
    baseInstruction: node?.baseInstruction || defaultOfferObjectiveTemplate(type),
    entries: (node?.entries || []).map(normalizeSegmentLearningEntry),
  };
}

async function saveOfferTypeBaseInstruction(targetDir, type, baseInstruction) {
  const paths = getCentralPaths(targetDir, '__global__');
  const stored = (await readJson(paths.offerTypeLearningsPath, null)) || { schemaVersion: 1, types: {} };
  const node = stored.types[type] || { entries: [] };
  node.baseInstruction = cleanText(baseInstruction);
  stored.types = { ...stored.types, [type]: node };
  await writeJson(paths.offerTypeLearningsPath, stored);
}

function defaultOfferObjectiveTemplate(type) {
  if (type === 'combo') return `Criar oferta de combo, com preço e CTA de delivery claros.`;
  if (type === 'rodizio') return `Criar chamada para rodízio, destacando itens inclusos, preço e convite para aproveitar.`;
  if (type === 'delivery') return `Criar chamada para delivery, preço/benefício e pedido rápido.`;
  if (type === 'orientation') return `Criar post de orientação, sem parecer só promoção.`;
  return `Criar post de ${offerTypeLabel(type)}.`;
}
```

Check: `getCentralPaths(targetDir, '__global__')` — verify `getCentralPaths` doesn't require the project directory to already exist (it likely just joins path segments); if it does validate existence, use `join(targetDir, '_opensquad', 'content-central', 'offer-type-learnings.json')` directly instead (`offer-type-learnings.json` is root-level, not project-scoped — read the existing `paths.segmentLearningsPath: join(root, 'segment-learnings.json')` definition at `src/content-central.js:297` to confirm `root` there and reuse the same root, not a per-project path).

Replace `offerObjective` (`src/content-central.js:4086-4092`) — this function becomes async and its callers need `await`:

```js
async function offerObjective(offer, targetDir) {
  const learning = await loadOfferTypeLearning(targetDir, offer.type);
  return learning.baseInstruction.includes(offer.name)
    ? learning.baseInstruction
    : `${learning.baseInstruction} (${offer.name})`;
}
```

Find every call site of `offerObjective(` (`grep -n "offerObjective(" src/content-central.js`) and update to `await offerObjective(offer, targetDir)`, propagating `async`/`await` up through their own callers as needed (`buildContentTopicFromOffer`-style function around `content-central.js:4070`, and whatever calls that).

Update `formatContentTopicLines` (`src/content-central.js:4094-4107`) to append approved learning text — add one more line to the returned array, right after the existing `objective` line:

```js
    topic.objective ? `Objetivo criativo: ${topic.objective}` : '',
    topic.learningEntries?.length ? `Aprendizados registrados para este tipo de publicação: ${topic.learningEntries.join(' | ')}` : '',
```

And where the topic object is built (the function around `content-central.js:4070` that returns `{ type, label, source, offerId, ... }`), add `learningEntries: (await loadOfferTypeLearning(targetDir, offer.type)).entries.filter((e) => e.bucket === 'approved').map((e) => e.text)`.

- [ ] **Step 4: Run the test again**

Run: `npm test`. Expected: PASS. Also re-run the full suite (`npm test`) to catch any other now-broken caller of the now-async `offerObjective`.

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): editable per-offer-type base instruction + learned examples in the image prompt"
```

---

### Task 9 (C2): Routes + client wrappers for offer-type learning

**Files:**
- Modify: `src/content-central-server.js` — `GET /api/projects/:id/offer-type-learnings`, `POST /api/projects/:id/offer-type-learnings/base-instruction`; extend the Task B2 routes to accept `scope=offerType` bodies (they already do — `saveLearningEntry`/`deleteLearningEntry`/`analyzeLearningImage` all branch on `input.scope`, so the same 3 routes work if the client sends `scope: "offerType"`; no new route needed for those 3).
- Modify: `content-central-app/src/api/client.ts` — `OfferTypeLearning` type, `getOfferTypeLearnings`, `saveOfferTypeBaseInstruction` wrappers.

**Interfaces:**
- Produces: `getOfferTypeLearnings(projectId): Promise<{ types: OfferTypeLearning[] }>`, `saveOfferTypeBaseInstruction(projectId, type, baseInstruction): Promise<{ type: string; baseInstruction: string }>`.
- Consumes: `loadOfferTypeLearning`, `saveOfferTypeBaseInstruction` (server, Task C1), `OFFER_TYPE_LABELS` (client, already exists).

- [ ] **Step 1: Add the 2 routes**

In `src/content-central-server.js`, add after the Task B2 routes:

```js
  if (method === 'GET' && parts.length === 4 && parts[3] === 'offer-type-learnings') {
    const types = await Promise.all(Object.keys(OFFER_TYPE_LABELS).map((type) => loadOfferTypeLearning(targetDir, type)));
    return sendJson(res, 200, { types });
  }

  if (parts.length === 4 && parts[3] === 'offer-type-learnings') {
    const body = await readBody(req);
    await saveOfferTypeBaseInstruction(targetDir, body.type, body.baseInstruction);
    return sendJson(res, 200, { type: body.type, baseInstruction: body.baseInstruction });
  }
```

Import `OFFER_TYPE_LABELS`, `loadOfferTypeLearning`, `saveOfferTypeBaseInstruction` into `content-central-server.js` (check whether `OFFER_TYPE_LABELS` already lives in `content-central.js` and is exported — the client-side copy in `client.ts:956-967` implies a server-side source of truth for the same 10 keys; grep `OFFER_TYPE_LABELS` in `content-central.js` to confirm before adding a duplicate).

- [ ] **Step 2: Add client wrappers**

In `content-central-app/src/api/client.ts`, near the Task B3 additions:

```ts
export interface OfferTypeLearning {
  type: string;
  baseInstruction: string;
  entries: SegmentLearningEntry[];
}

export function getOfferTypeLearnings(projectId: string): Promise<{ types: OfferTypeLearning[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offer-type-learnings`);
}

export function saveOfferTypeBaseInstruction(
  projectId: string,
  type: string,
  baseInstruction: string,
): Promise<{ type: string; baseInstruction: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offer-type-learnings`, {
    method: "POST",
    body: JSON.stringify({ type, baseInstruction }),
  });
}
```

- [ ] **Step 3: Backend test for the 2 new routes**

Since these are plain HTTP routes wrapping already-tested functions (Task C1), a unit test on the underlying functions is sufficient per this repo's convention (server route tests aren't a pattern used elsewhere in `tests/content-central.test.js` — every existing test calls functions directly). Skip an HTTP-level test; Task C1's test already covers the logic these routes expose.

- [ ] **Step 4: Run backend + frontend builds**

Run: `npm test` then `cd content-central-app && npm run build`. Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js content-central-app/src/api/client.ts
git commit -m "feat(content-central): routes + client wrappers for offer-type learning"
```

---

### Task 10 (C3): "Aprendizado por tipo" panel in Ofertas

**Files:**
- Modify: `content-central-app/src/pages/workspace/Offers.tsx`
- Modify: `content-central-app/src/pages/workspace/Offers.test.tsx`

**Interfaces:**
- Consumes: `getOfferTypeLearnings`, `saveOfferTypeBaseInstruction` (Task C2), `LearningGallery` (Task B4), `OFFER_TYPE_LABELS` (already imported in `Offers.tsx`).

- [ ] **Step 1: Write the failing test**

Add to `content-central-app/src/pages/workspace/Offers.test.tsx`:

```tsx
  it("shows and edits the per-offer-type base instruction and learning gallery", async () => {
    stubFetchSequence([
      { body: projectState([RODIZIO_OFFER]) },
      {
        body: {
          types: [
            { type: "combo", baseInstruction: "Combo: foco no produto, CTA de delivery claro.", entries: [] },
            { type: "offer", baseInstruction: "Criar post de Oferta direta.", entries: [] },
          ],
        },
      },
      { body: { type: "combo", baseInstruction: "Combo: sempre mostrar a caixa fechada e aberta lado a lado." } },
    ]);
    renderOffers();

    await userEvent.click(await screen.findByRole("button", { name: "Aprendizado por tipo" }));
    expect(await screen.findByDisplayValue("Combo: foco no produto, CTA de delivery claro.")).toBeInTheDocument();

    const instructionField = screen.getByDisplayValue("Combo: foco no produto, CTA de delivery claro.");
    await userEvent.clear(instructionField);
    await userEvent.type(instructionField, "Combo: sempre mostrar a caixa fechada e aberta lado a lado.");
    await userEvent.click(screen.getAllByRole("button", { name: "Salvar" })[0]);

    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    expect(call[0]).toBe("/api/projects/boss-pizzaria/offer-type-learnings");
    expect(JSON.parse(call[1].body as string).type).toBe("combo");
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd content-central-app && npm test -- Offers`. Expected: FAIL — no "Aprendizado por tipo" button exists yet.

- [ ] **Step 3: Add the panel to `Offers.tsx`**

Add state and a toggle button near the existing `groupsOpen` toolbar button (`Offers.tsx:393-395`):

```tsx
  const [typeLearningOpen, setTypeLearningOpen] = useState(false);
  const [typeLearnings, setTypeLearnings] = useState<OfferTypeLearning[]>([]);
  const [typeLearningLoaded, setTypeLearningLoaded] = useState(false);
  const [editingInstruction, setEditingInstruction] = useState<Record<string, string>>({});
  const [savingType, setSavingType] = useState<string | null>(null);

  async function openTypeLearning() {
    setTypeLearningOpen((current) => !current);
    if (!typeLearningLoaded) {
      const result = await getOfferTypeLearnings(project.projectId);
      setTypeLearnings(result.types);
      setEditingInstruction(Object.fromEntries(result.types.map((t) => [t.type, t.baseInstruction])));
      setTypeLearningLoaded(true);
    }
  }

  async function handleSaveTypeInstruction(type: string) {
    setSavingType(type);
    try {
      await saveOfferTypeBaseInstruction(project.projectId, type, editingInstruction[type]);
      setTypeLearnings((current) => current.map((t) => (t.type === type ? { ...t, baseInstruction: editingInstruction[type] } : t)));
    } finally {
      setSavingType(null);
    }
  }
```

Add the button next to `"Grupos de ofertas"` (`Offers.tsx:393-395`):

```tsx
        <Button type="button" variant="secondary" onClick={openTypeLearning}>
          {typeLearningOpen ? "Fechar" : "Aprendizado por tipo"}
        </Button>
```

Add the panel (right after the `groupsOpen` block, before `formOpen`):

```tsx
      {typeLearningOpen ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Aprendizado por tipo de oferta</b>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Vale pra todo projeto, não só este. Instrução base é o que a IA sempre lê pra esse tipo; a galeria abaixo acumula exemplos de estrutura/composição que você aprovar.
          </p>
          <div style={{ display: "grid", gap: 16 }}>
            {typeLearnings.map((learning) => (
              <Card key={learning.type} style={{ padding: 16 }}>
                <b>{OFFER_TYPE_LABELS[learning.type] || learning.type}</b>
                <textarea
                  value={editingInstruction[learning.type] || ""}
                  onChange={(e) => setEditingInstruction((current) => ({ ...current, [learning.type]: e.target.value }))}
                />
                <Button disabled={savingType === learning.type} onClick={() => handleSaveTypeInstruction(learning.type)}>
                  {savingType === learning.type ? "Salvando..." : "Salvar"}
                </Button>
                <LearningGallery
                  projectId={project.projectId}
                  scope="offerType"
                  groupKey={learning.type}
                  entries={learning.entries}
                  onEntriesChange={(entries) => setTypeLearnings((current) => current.map((t) => (t.type === learning.type ? { ...t, entries } : t)))}
                />
              </Card>
            ))}
          </div>
        </Card>
      ) : null}
```

Add the imports: `getOfferTypeLearnings`, `saveOfferTypeBaseInstruction`, `type OfferTypeLearning` from `@/api/client`, and `LearningGallery` from `@/components/LearningGallery`.

- [ ] **Step 4: Run the test again**

Run: `cd content-central-app && npm test -- Offers`. Expected: PASS.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd content-central-app && npm test`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add content-central-app/src/pages/workspace/Offers.tsx content-central-app/src/pages/workspace/Offers.test.tsx
git commit -m "feat(content-central-app): per-offer-type learning panel in Ofertas"
```

---

## Post-implementation check (all phases)

- [ ] Run `npm test` (repo root) and `cd content-central-app && npm test` one final time, all green.
- [ ] Run `cd content-central-app && npm run build` to catch any TypeScript drift across the whole plan.
- [ ] Manually verify (dev server) that: uploading a photo in a new Oferta no longer shows it under Referências; Referências only shows logo + direção visual; `/aprendizado-segmento` renders the project's Setor/Nicho/Especialidade panels; Ofertas → "Aprendizado por tipo" shows all 10 types with editable instructions.
