# Segment-Learning Images as Real Layout References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approved images already uploaded to Aprendizado de Segmento start acting as real visual composition references (`role: 'layout_model'`) for AI image generation, instead of contributing only their text description — scoped by the project's own Setor/Nicho/Especialidade so different segments never share layout references.

**Architecture:** A new `buildSegmentLayoutReferences(project, paths)` helper reads the project's applicable segment-learning nodes (already computed by the existing `loadSegmentLearningNodes`), picks the 3 most recent `bucket: 'approved'`, `kind: 'image'` entries across those nodes, and turns each into a reference object with `role: 'layout_model'` pointing at the image's real file under the global learning-assets directory. `buildImageReferencePayload` (the function every image-generation path already calls to build `image.references`) becomes async and appends this helper's output to what it already returns — no new UI, no new storage shape, no new route.

**Tech Stack:** Node.js (native `node:test`), existing `content-central.js` module — no new dependencies.

## Global Constraints

- Cap layout references at 3 (most recent, by `createdAt`, across all applicable segment nodes combined) — fixed, no per-entry toggle yet (see spec's ponytail note).
- Reference `weight` is `'medium'`, matching how other `layout_model` references already behave in this codebase.
- Instruction text is fixed and identical for every entry: `Modelo de composição aprovado no aprendizado de segmento: usar como referência de distribuição dos elementos (título, blocos de benefício, selo, hierarquia). Não copiar marca, produto ou cores da imagem de referência.`
- Only applies to real AI image generation — catalog-mode (venda direta) projects never call the AI generator, so they're untouched by construction (no special-casing needed).
- A missing image file on disk is skipped silently, never throws.

---

## Task 1: `buildSegmentLayoutReferences` helper (standalone, testable on its own)

**Files:**
- Modify: `src/content-central.js` (new code inserted immediately before `function buildImageReferencePayload(project, paths) {` at line 6503)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `loadSegmentLearningNodes(paths, project)` (already exists, `src/content-central.js:3707`, returns `[{ path, label, level, entries }]` where each `entry` is the shape from `normalizeSegmentLearningEntry`: `{ id, bucket, kind, text, imagePath, source, sourceProjectId, createdAt }`). `normalizeReferenceMetadata(input)` (already exists, `src/content-central.js:6449`). `mimeTypeFromFilename(filename)` (already exists, `src/content-central.js:6761`). `existsSync`, `join` (already imported at the top of `content-central.js`).
- Produces: `export async function buildSegmentLayoutReferences(project, paths): Promise<Reference[]>` — each `Reference` has at least `{ role: 'layout_model', weight: 'medium', instruction: string, relativePath: string, absolutePath: string, mimeType: string, previewUrl: string }`. Task 2 imports and calls this from `buildImageReferencePayload`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/content-central.test.js`. First, add `buildSegmentLayoutReferences` to the import block from `../src/content-central.js` (alphabetically, right after `buildSegmentTemplateContentItem`):

```js
  buildSegmentLayoutReferences,
```

Then add these two tests (place them near the other segment-learning tests, e.g. right after the `analyzeLearningImage/saveLearningEntry/deleteLearningEntry work without a project...` test):

```js
test('buildSegmentLayoutReferences returns the 3 most recent approved images from the project\'s own segment nodes, skips avoid/text entries and missing files', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pizzaria-layout', name: 'Pizzaria Layout', handle: '@pizzarialayout', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('pizzaria-layout', {
      brandName: 'Pizzaria Layout',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const groupKey = 'group:alimenticio/category:pizzaria';
    const imagePaths = {};
    for (const name of ['img1', 'img2', 'img3', 'img4', 'img5']) {
      const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: `${name}.png` }, dir, new Date(), { learningImageAnalyzer: async () => `Descrição ${name}` });
      await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: `Descrição ${name}`, imagePath: analyzed.imagePath }, dir, new Date());
      imagePaths[name] = analyzed.imagePath;
    }
    // A non-image approved entry and an "avoid" image entry — both must be
    // excluded even though they'll be stamped as the most recent below.
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'text', text: 'não parecer gerado por IA' }, dir, new Date());
    const avoidAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'evitar.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'Evitar isso' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'avoid', kind: 'image', text: 'Evitar isso', imagePath: avoidAnalyzed.imagePath }, dir, new Date());

    // Stamp deterministic createdAt so recency order is unambiguous: the
    // avoid image and the text entry are made the two MOST recent overall,
    // so if the bucket/kind filter were broken, they'd show up in the
    // result instead of being excluded.
    const paths = getCentralPaths(dir, 'pizzaria-layout');
    const store = JSON.parse(await readFile(paths.segmentLearningsPath, 'utf-8'));
    const node = store.nodes[groupKey];
    const stampOrder = ['img1', 'img2', 'img3', 'img4', 'img5', 'evitar', 'não parecer gerado por IA'];
    for (const entry of node.entries) {
      const key = entry.kind === 'image' ? Object.keys(imagePaths).find((name) => imagePaths[name] === entry.imagePath) || 'evitar' : entry.text;
      const index = stampOrder.indexOf(key);
      entry.createdAt = `2026-01-01T00:0${index}:00.000Z`;
    }
    await writeFile(paths.segmentLearningsPath, JSON.stringify(store, null, 2));

    // Delete img5's file on disk (the newest approved image) to prove a
    // missing file is skipped instead of crashing or being backfilled.
    await rm(join(paths.root, 'assets', 'learning', imagePaths.img5));

    const project = await loadProjectForTest('pizzaria-layout', dir);
    const references = await buildSegmentLayoutReferences(project, paths);

    assert.equal(references.length, 2, 'img5 missing on disk, img4/img3 are the next 2 most recent valid ones');
    assert.deepEqual(references.map((r) => r.relativePath), [imagePaths.img4, imagePaths.img3]);
    assert.ok(references.every((r) => r.role === 'layout_model'));
    assert.ok(references.every((r) => r.weight === 'medium'));
    assert.equal(
      references[0].instruction,
      'Modelo de composição aprovado no aprendizado de segmento: usar como referência de distribuição dos elementos (título, blocos de benefício, selo, hierarquia). Não copiar marca, produto ou cores da imagem de referência.'
    );
    await access(references[0].absolutePath);
  });
});

test('buildSegmentLayoutReferences returns nothing when the project has no Setor/Nicho set', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-segmento', name: 'Sem Segmento', handle: '@semsegmento', approvalEmail: 'a@example.com' }, dir);
    const paths = getCentralPaths(dir, 'sem-segmento');
    const project = await loadProjectForTest('sem-segmento', dir);
    const references = await buildSegmentLayoutReferences(project, paths);
    assert.deepEqual(references, []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central.test.js 2>&1 | grep -A5 "buildSegmentLayoutReferences"`
Expected: FAIL — `buildSegmentLayoutReferences is not a function` (or `undefined`) for both new tests.

- [ ] **Step 3: Implement `buildSegmentLayoutReferences`**

In `src/content-central.js`, insert this immediately before the existing `function buildImageReferencePayload(project, paths) {` (currently at line 6503):

```js
const MAX_SEGMENT_LAYOUT_REFERENCES = 3;

const SEGMENT_LAYOUT_REFERENCE_INSTRUCTION = 'Modelo de composição aprovado no aprendizado de segmento: usar como referência de distribuição dos elementos (título, blocos de benefício, selo, hierarquia). Não copiar marca, produto ou cores da imagem de referência.';

// Approved reference images from the project's own Aprendizado de Segmento
// nodes (Setor/Nicho/Especialidade) — reused as real composition
// references for AI image generation (role: 'layout_model'), scoped by
// segment so a pizzaria's generations never see a Casa de Embalagem
// approved image or vice versa: both are global stores, but partitioned by
// segment node (see segmentNodePathsFromFields). Capped to the most recent
// MAX_SEGMENT_LAYOUT_REFERENCES across all applicable nodes combined — a
// missing file is skipped, not backfilled from the next-oldest candidate.
// ponytail: fixed recency cap, no per-entry "use as reference" toggle — add
// one if the automatic cut ever needs finer control.
export async function buildSegmentLayoutReferences(project, paths) {
  const nodes = await loadSegmentLearningNodes(paths, project);
  const imageEntries = nodes
    .flatMap((node) => node.entries)
    .filter((entry) => entry.bucket === 'approved' && entry.kind === 'image' && entry.imagePath)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, MAX_SEGMENT_LAYOUT_REFERENCES);

  const references = [];
  for (const entry of imageEntries) {
    const absolutePath = join(paths.root, 'assets', 'learning', entry.imagePath);
    if (!existsSync(absolutePath)) continue;
    const reference = normalizeReferenceMetadata({
      id: `segment-layout-${entry.id}`,
      filename: entry.imagePath.split('/').pop(),
      relativePath: entry.imagePath,
      mimeType: mimeTypeFromFilename(entry.imagePath),
      role: 'layout_model',
      weight: 'medium',
      instruction: SEGMENT_LAYOUT_REFERENCE_INSTRUCTION,
      createdAt: entry.createdAt,
    });
    reference.absolutePath = absolutePath;
    reference.previewUrl = `/api/learning-assets/${entry.imagePath.split('/').map(encodeURIComponent).join('/')}`;
    references.push(reference);
  }
  return references;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central.test.js 2>&1 | grep -B2 -A15 "buildSegmentLayoutReferences"`
Expected: both new tests PASS.

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass (this task only adds a new exported function — nothing existing calls it yet).

- [ ] **Step 6: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): add buildSegmentLayoutReferences, segment-scoped layout image references"
```

---

## Task 2: Wire `buildSegmentLayoutReferences` into `buildImageReferencePayload`

**Files:**
- Modify: `src/content-central.js` (7 call sites of `buildImageReferencePayload`, the function itself, `buildSegmentTemplateContentItem`, `enqueueSegmentTemplateAdaptation`)
- Test: `tests/content-central.test.js` (fix one pre-existing synchronous call, add the cross-segment isolation test)

**Interfaces:**
- Consumes: `buildSegmentLayoutReferences(project, paths)` from Task 1.
- Produces: `buildImageReferencePayload` becomes `async function buildImageReferencePayload(project, paths): Promise<Reference[]>` (was sync). Every caller in this file now `await`s it.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/content-central.test.js`, near the existing `'image prompt requires uploaded logo to appear and uses product visual and layout references'` test:

```js
test('generated image prompts only include layout references from the SAME segment — a pizzaria never sees Casa de Embalagem\'s approved image and vice versa', async () => {
  await withTempProject(async (dir) => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    await createCentralProject({ projectId: 'pizzaria-cruz', name: 'Pizzaria Cruz', handle: '@pizzariacruz', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('pizzaria-cruz', {
      brandName: 'Pizzaria Cruz', segmentGroup: 'Alimentício', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    const pizzaAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'pizza-layout.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'Layout de pizza' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'Layout de pizza', imagePath: pizzaAnalyzed.imagePath }, dir, new Date());
    await saveProjectOffer('pizzaria-cruz', { name: 'Pizza Grande', type: 'offer', price: 'R$ 45' }, dir);

    await createCentralProject({ projectId: 'casa-embalagem', name: 'Casa de Embalagem', handle: '@casaembalagem', approvalEmail: 'b@example.com' }, dir);
    await updateProjectBrandInput('casa-embalagem', {
      brandName: 'Casa de Embalagem', segmentGroup: 'Negócios locais e lojas', segmentCategory: 'Casa de embalagem', segment: 'casa de embalagem', productsOrServices: 'embalagens',
    }, dir);
    const embalagemAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:negocios-locais-e-lojas/category:casa-de-embalagem', dataUrl, filename: 'embalagem-layout.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'Layout de embalagem' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:negocios-locais-e-lojas/category:casa-de-embalagem', bucket: 'approved', kind: 'image', text: 'Layout de embalagem', imagePath: embalagemAnalyzed.imagePath }, dir, new Date());
    await saveProjectOffer('casa-embalagem', { name: 'Papel Alumínio 100m', type: 'offer', price: 'R$ 62,40' }, dir);

    const pizzaBatch = await generateContentBatch('pizzaria-cruz', { days: 1, startDate: '2026-07-20', channel: 'instagram_story' }, dir);
    const embalagemBatch = await generateContentBatch('casa-embalagem', { days: 1, startDate: '2026-07-20', channel: 'instagram_story' }, dir);

    const pizzaRefs = pizzaBatch.items[0].image.references.filter((r) => r.role === 'layout_model');
    const embalagemRefs = embalagemBatch.items[0].image.references.filter((r) => r.role === 'layout_model');

    assert.equal(pizzaRefs.length, 1);
    assert.match(pizzaRefs[0].relativePath, /pizza-layout\.png$/);
    assert.equal(embalagemRefs.length, 1);
    assert.match(embalagemRefs[0].relativePath, /embalagem-layout\.png$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/content-central.test.js 2>&1 | grep -A10 "only include layout references"`
Expected: FAIL — `references` won't include any `layout_model` entries yet (or will error, since `buildImageReferencePayload` isn't awaited anywhere yet and Task 1's helper isn't wired in).

- [ ] **Step 3: Make `buildImageReferencePayload` async and call the new helper**

In `src/content-central.js`, replace the current body:

```js
function buildImageReferencePayload(project, paths) {
  const logoReference = getProjectLogoReference(project, paths);
  const references = uniqueReferences([
    logoReference,
    ...sortReferencesForPrompt([
      ...normalizeProjectReferences(project),
      ...normalizeProjectOfferAssets(project),
    ]),
  ].filter(Boolean));
  return references
    .filter((reference) => reference.useInNextGeneration !== false)
    .filter((reference) => String(reference.mimeType || '').startsWith('image/'))
    .map((reference) => ({
    ...reference,
    absolutePath: join(paths.projectDir, reference.relativePath),
  }));
}
```

with:

```js
async function buildImageReferencePayload(project, paths) {
  const logoReference = getProjectLogoReference(project, paths);
  const references = uniqueReferences([
    logoReference,
    ...sortReferencesForPrompt([
      ...normalizeProjectReferences(project),
      ...normalizeProjectOfferAssets(project),
    ]),
  ].filter(Boolean));
  const projectReferences = references
    .filter((reference) => reference.useInNextGeneration !== false)
    .filter((reference) => String(reference.mimeType || '').startsWith('image/'))
    .map((reference) => ({
      ...reference,
      absolutePath: join(paths.projectDir, reference.relativePath),
    }));
  const layoutReferences = await buildSegmentLayoutReferences(project, paths);
  return [...projectReferences, ...layoutReferences];
}
```

- [ ] **Step 4: Await every call site in the same file**

All 7 call sites already sit inside `async function`s (verified: `generateContentBatch`, `generateSpecialDateContent`, `generateAdCreative`, `regenerateAdCreative`, `generateContentSchedulePlan`, `applyContentRegeneration` are already `async`; `buildSegmentTemplateContentItem` is not — handled in Step 5 below). For each of these lines, add `await`:

`src/content-central.js:1217`
```js
        references: buildImageReferencePayload(project, paths),
```
→
```js
        references: await buildImageReferencePayload(project, paths),
```

`src/content-central.js:1478` — same change (`generateSpecialDateContent`).

`src/content-central.js:1914` — same change (`generateAdCreative`).

`src/content-central.js:1984`
```js
    adCreative.image.references = buildImageReferencePayload(project, paths);
```
→
```js
    adCreative.image.references = await buildImageReferencePayload(project, paths);
```

`src/content-central.js:2302` — same change as 1217 (`generateContentSchedulePlan`).

`src/content-central.js:2664`
```js
    if (paths) content.image.references = buildImageReferencePayload(project, paths);
```
→
```js
    if (paths) content.image.references = await buildImageReferencePayload(project, paths);
```

- [ ] **Step 5: Make `buildSegmentTemplateContentItem` async and fix its one caller**

`buildSegmentTemplateContentItem` (line 1637) is the one non-async caller. Change its signature and the one line inside it:

```js
export function buildSegmentTemplateContentItem(piece, project, paths) {
```
→
```js
export async function buildSegmentTemplateContentItem(piece, project, paths) {
```

and (line 1676):
```js
      references: buildImageReferencePayload(project, paths),
```
→
```js
      references: await buildImageReferencePayload(project, paths),
```

Its only caller, inside `enqueueSegmentTemplateAdaptation` (around line 1759-1763):

```js
      const items = template.pieces.map((piece) => {
        const item = buildSegmentTemplateContentItem(piece, project, paths);
        item.templateEditBasePath = piece.imageAbsolutePath;
        return item;
      });
      return enrichSegmentTemplateItemsForProspect(items, project, projectId, { imageGenerator: options.imageGenerator, note });
```
→
```js
      return Promise.all(template.pieces.map(async (piece) => {
        const item = await buildSegmentTemplateContentItem(piece, project, paths);
        item.templateEditBasePath = piece.imageAbsolutePath;
        return item;
      })).then((items) => enrichSegmentTemplateItemsForProspect(items, project, projectId, { imageGenerator: options.imageGenerator, note }));
```

- [ ] **Step 6: Fix the one pre-existing test that calls `buildSegmentTemplateContentItem` synchronously**

In `tests/content-central.test.js`, around line 6230:

```js
    const items = template.pieces.map((piece) => {
      const item = buildSegmentTemplateContentItem(piece, project, paths);
      item.templateEditBasePath = piece.imageAbsolutePath;
      return item;
    });
```
→
```js
    const items = await Promise.all(template.pieces.map(async (piece) => {
      const item = await buildSegmentTemplateContentItem(piece, project, paths);
      item.templateEditBasePath = piece.imageAbsolutePath;
      return item;
    }));
```

- [ ] **Step 7: Run the new integration test to verify it passes**

Run: `node --test tests/content-central.test.js 2>&1 | grep -A10 "only include layout references"`
Expected: PASS.

- [ ] **Step 8: Run the full backend suite**

Run: `npm test`
Expected: all tests pass, including the segment-template ones touched in Step 6 and every other `image.references`/`layout_model` test already in the suite (they must keep passing unchanged — this task is purely additive to what `buildImageReferencePayload` returns).

- [ ] **Step 9: Rebuild the frontend dist (backend response shape only changed additively, but keep the running server's bundle current per established practice in this repo)**

Run: `cd content-central-app && npm run build`
Expected: build succeeds (no frontend source changed in this plan, but a stale `dist/` has bitten this project before — rebuilding is a no-op safety check here since no `.tsx`/`.ts` file changed).

- [ ] **Step 10: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): use approved segment-learning images as real layout_model references in AI generation"
```
