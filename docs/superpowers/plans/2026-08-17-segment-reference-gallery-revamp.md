# Segment Reference Gallery Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dedupe the segment "Referencias de produto" gallery to one section per segment tree, make a creative structure's Formato (shape) optional, revive the segment product-reference photo as a real (additive, non-blocking) texture reference during AI generation, and show which structure/product reference a generated creative actually used.

**Architecture:** Backend (`src/content-central.js`) tags each segment-learning reference with a `referenceKind` (`'segment_structure'` | `'segment_product'`), relaxes the mandatory-template shape match to treat a blank shape as "works for both", and adds the product reference as a second, non-blocking `layout_model` reference. `generateAiImageWithReviewLoop` records what was actually used onto the content item. Frontend: `content-central-app` gets a new `ProductReferenceGallery` component (parallel to the existing `CreativeStructureGallery`) to fix the duplication, a card-grid layout for structures, an optional Formato field, and two new pills on the approval card.

**Tech Stack:** Node.js (`node:test`, CommonJS-free ESM) for the backend; React 19 + TypeScript + Vitest + Testing Library for `content-central-app`.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-08-17-segment-reference-gallery-revamp-design.md`. This plan amends `docs/superpowers/specs/2026-08-16-mandatory-creative-templates-design.md` on exactly two points (shape-match relaxation, product-reference revival) — everything else in that doc stays in effect, including the mandatory-template blocking behavior itself.
- All operator-facing UI copy is Portuguese, matching the rest of `content-central-app`.
- Backend tests run with `node --test tests/content-central.test.js` (or `tests/content-central-server.test.js` where noted) from the repo root. Frontend tests run with `npx vitest run <file>` from `content-central-app/`.
- Follow existing file conventions: `LearningGallery.tsx` uses inline `style={{...}}`, not CSS modules — do not introduce a new stylesheet for the card grid.
- TDD: write the failing test before the implementation in every task below.
- Commit after each task with the message given in that task's final step. Do not squash tasks together.

---

## Suggested wave grouping (parallel-subagent-driven-development)

- **Wave 1** (no shared files, no dependency): Task 1, Task 4.
- **Wave 2** (each depends on its wave-1 counterpart; the two tasks don't share files with each other): Task 2, Task 5.
- **Wave 3** (depends on Task 2's field names): Task 3.

If executing serially instead, just run Task 1 → 2 → 3 → 4 → 5 in order — 1/2/3 and 4/5 are independent chains that happen to interleave fine either way.

---

### Task 1: Backend — tag reference kind, relax shape match, add the product-reference lane

**Files:**
- Modify: `src/content-central.js:7197-7255` (`buildSegmentLayoutReferences`)
- Modify: `src/content-central.js:5876-5960` (`buildPrimaryAiImageReferences`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: nothing new — same `buildSegmentLayoutReferences(project, paths, options)` and internal `buildPrimaryAiImageReferences(references, options)` signatures as today.
- Produces: every reference `buildSegmentLayoutReferences` returns now carries `referenceKind: 'segment_structure' | 'segment_product'`. `buildPrimaryAiImageReferences`'s returned array may now contain a `referenceKind: 'segment_product'` entry alongside (or without) a `referenceKind: 'segment_structure'` one. Task 2 reads `referenceKind` off `baseReferences` to populate `content.creativeStructureUsed`/`content.usedSegmentProductReference`.

- [ ] **Step 1: Write the failing tests**

Add these four tests to `tests/content-central.test.js`, right after the existing `test('buildSegmentLayoutReferences returns nothing when the project has no Setor/Nicho set', ...)` block (around line 987):

```js
test('buildSegmentLayoutReferences tags creative entries segment_structure and the product entry segment_product', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'kind-tags', name: 'Kind Tags', handle: '@kindtags', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('kind-tags', {
      brandName: 'Kind Tags', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    const paths = getCentralPaths(dir, 'kind-tags');
    const groupKey = 'group:alimenticio/category:pizzaria';
    await registerCreativeTemplate(groupKey, 'offer', 'vertical', dir, 'estrutura.png');

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'produto.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'produto' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: 'mussarela derretendo', imagePath: analyzed.imagePath, purpose: 'product' }, dir);

    const project = await loadProjectForTest('kind-tags', dir);
    const references = await buildSegmentLayoutReferences(project, paths);

    const structureRef = references.find((r) => r.referenceKind === 'segment_structure');
    const productRef = references.find((r) => r.referenceKind === 'segment_product');
    assert.ok(structureRef, 'creative entry keeps its segment_structure tag');
    assert.ok(productRef, 'product entry gets tagged segment_product');
    assert.equal(structureRef.role, 'layout_model');
    assert.equal(productRef.role, 'layout_model');
  });
});

test('a structure with no Formato set matches generation for both vertical and feed channels', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'formato-livre', name: 'Formato Livre', handle: '@formatolivre', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('formato-livre', {
      brandName: 'Formato Livre', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('formato-livre', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', '', dir, 'universal.png');

    const story = await simulateTestPost('formato-livre', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.equal(story.imageGenerationError, null);

    const feed = await simulateTestPost('formato-livre', {
      channel: 'instagram_feed',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-21T12:00:00.000Z'));
    assert.equal(feed.imageGenerationError, null);
  });
});

test('a registered product reference alone never satisfies the mandatory creative-template match', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'so-produto', name: 'So Produto', handle: '@soproduto', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('so-produto', {
      brandName: 'So Produto', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('so-produto', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'produto.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'produto' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'mussarela derretendo', imagePath: analyzed.imagePath, purpose: 'product' }, dir);

    const content = await simulateTestPost('so-produto', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.match(content.imageGenerationError, /Nenhum modelo de criativo cadastrado/);
  });
});

test('a registered product reference rides along as an additional reference when a matching structure exists', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'estrutura-mais-produto', name: 'Estrutura Mais Produto', handle: '@emp', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('estrutura-mais-produto', {
      brandName: 'Estrutura Mais Produto', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('estrutura-mais-produto', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    const groupKey = 'group:alimenticio/category:pizzaria';
    await registerCreativeTemplate(groupKey, 'offer', 'vertical', dir, 'estrutura.png');

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'produto.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'produto' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: 'mussarela derretendo', imagePath: analyzed.imagePath, purpose: 'product' }, dir);

    const content = await simulateTestPost('estrutura-mais-produto', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(content.imageGenerationError, null);
    const kinds = content.image.references.map((r) => r.referenceKind).filter(Boolean);
    assert.deepEqual(kinds.sort(), ['segment_product', 'segment_structure']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/content-central.test.js`
Expected: the four new tests FAIL — `referenceKind` is `undefined` on every reference today, so the first assertion fails; the shape-blank test fails because `instagram_feed` still throws "Nenhum modelo de criativo cadastrado" (blank shape doesn't match `'feed'` yet); the "product reference rides along" test fails because today's `matchingLayouts`/return array never includes a product reference (see the 2026-08-16 spec's "Known limitations").

- [ ] **Step 3: Tag `referenceKind` in `buildSegmentLayoutReferences`**

In `src/content-central.js`, inside the `for (const entry of creativeEntries)` loop (around line 7229), add one line right after the existing `reference.shape = entry.shape || '';`:

```js
    reference.title = entry.title || '';
    reference.absolutePath = absolutePath;
    reference.previewUrl = `/api/learning-assets/${entry.imagePath.split('/').map(encodeURIComponent).join('/')}`;
    reference.postType = entry.postType || '';
    reference.shape = entry.shape || '';
    reference.referenceKind = 'segment_structure';
    references.push(reference);
```

In the `if (productEntry)` block (around line 7249), add one line right after the existing `reference.previewUrl` assignment:

```js
      reference.absolutePath = absolutePath;
      reference.previewUrl = `/api/learning-assets/${productEntry.imagePath.split('/').map(encodeURIComponent).join('/')}`;
      reference.referenceKind = 'segment_product';
      references.push(reference);
```

- [ ] **Step 4: Relax the shape match and add the product-reference lane in `buildPrimaryAiImageReferences`**

Replace the block from the `const postType = ...` line through the final `return uniqueReferences(...)` line (`src/content-central.js:5935-5959`) with:

```js
  const postType = deriveCreativePostType(options.topic);
  const shape = creativeShapeGroupForChannel(options.channel);
  // A template is mandatory, not a suggestion — only a segment_structure-
  // tagged reference (an operator-authored creative structure with
  // postType set) counts as a match; a segment_product reference or a
  // legacy untagged layout_model reference never does, or generation
  // would silently keep working exactly like before this change for any
  // project holding one, defeating the whole point. A structure's shape
  // is optional though — left blank by the operator, it's tagged "works
  // for both" and matches whichever shape this generation needs.
  const matchingLayouts = selected.filter((reference) => (
    reference.role === 'layout_model'
    && reference.referenceKind === 'segment_structure'
    && (!isStory || !isSquareLikeReference(reference))
    && reference.postType === postType
    && (!reference.shape || reference.shape === shape)
  ));
  if (!matchingLayouts.length) {
    const postTypeLabel = CREATIVE_POST_TYPE_LABELS[postType] || postType;
    const shapeLabel = shape ? (CREATIVE_SHAPE_LABELS[shape] || shape) : 'formato desconhecido';
    throw new Error(`Nenhum modelo de criativo cadastrado para "${postTypeLabel}" / "${shapeLabel}" neste segmento — cadastre um modelo antes de gerar.`);
  }
  // Rotate which single layout reference gets used instead of always the
  // same array-order match — with several matching templates uploaded,
  // every generation (even across separate test runs) was otherwise
  // anchored to whichever one happened to be first.
  const layoutReferences = pickRotatingReferenceList(matchingLayouts, options.variationSeed, 1);
  // Additive, not gated on a structure match existing: a registered
  // segment product-reference photo (texture/plausibility guidance, e.g.
  // "this is what real mozzarella pull looks like") rides along whenever
  // present. It never blocks generation and never competes with the
  // mandatory structure match above.
  const segmentProductReferences = selected.filter((reference) => (
    reference.role === 'layout_model' && reference.referenceKind === 'segment_product'
  )).slice(0, 1);
  const visualCandidates = selected.filter((reference) => reference.role === 'visual_reference');
  const visualReferences = pickRotatingReferenceList(visualCandidates, `${options.variationSeed || ''}-visual`, layoutReferences.length ? 0 : 1);
  return uniqueReferences([...brandAssets, ...productPhotos, ...layoutReferences, ...segmentProductReferences, ...visualReferences]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/content-central.test.js`
Expected: PASS — all four new tests, plus every pre-existing test in the file (the shape-exact-match and mandatory-blocking tests around lines 946-1041 must still pass unchanged, since a *tagged* exact shape still matches exactly and a missing structure still blocks).

- [ ] **Step 6: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): tag segment references by kind, allow a shape-agnostic creative structure, revive the product reference as an additive AI generation input"
```

---

### Task 2: Backend — record which structure/product reference a generation actually used

**Files:**
- Modify: `src/content-central.js:5071-5148` (`generateAiImageWithReviewLoop`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `reference.referenceKind` on `baseReferences` entries, from Task 1.
- Produces: `content.creativeStructureUsed: { title: string; postType: string; shape: string } | null` and `content.usedSegmentProductReference: boolean`, set on every content item that goes through `generateAiImageWithReviewLoop` (initial generation and regeneration alike, since both call this same function). Task 3 reads these two fields off `ContentItem` in the frontend.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `tests/content-central.test.js`, right after the `test('generation proceeds once a matching creative template exists for the topic\'s postType and shape', ...)` block (around line 1041):

```js
test('records which creative structure was used and whether a segment product reference rode along', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'registra-uso', name: 'Registra Uso', handle: '@registrauso', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('registra-uso', {
      brandName: 'Registra Uso', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('registra-uso', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    const groupKey = 'group:alimenticio/category:pizzaria';

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const structure = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'estrutura.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'estrutura' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', title: 'Oferta vertical com preco', text: 'modelo', imagePath: structure.imagePath, purpose: 'creative', postType: 'offer', shape: 'vertical' }, dir);

    const productPhoto = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'produto.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'produto' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: 'mussarela derretendo', imagePath: productPhoto.imagePath, purpose: 'product' }, dir);

    const content = await simulateTestPost('registra-uso', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.deepEqual(content.creativeStructureUsed, { title: 'Oferta vertical com preco', postType: 'offer', shape: 'vertical' });
    assert.equal(content.usedSegmentProductReference, true);

    const persisted = JSON.parse(await readFile(content.filePath, 'utf-8'));
    assert.deepEqual(persisted.creativeStructureUsed, { title: 'Oferta vertical com preco', postType: 'offer', shape: 'vertical' });
    assert.equal(persisted.usedSegmentProductReference, true);
  });
});

test('creativeStructureUsed and usedSegmentProductReference reflect no product reference registered', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-produto', name: 'Sem Produto', handle: '@semproduto', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sem-produto', {
      brandName: 'Sem Produto', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('sem-produto', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir, 'estrutura.png');

    const content = await simulateTestPost('sem-produto', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.deepEqual(content.creativeStructureUsed, { title: '', postType: 'offer', shape: 'vertical' });
    assert.equal(content.usedSegmentProductReference, false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/content-central.test.js`
Expected: both new tests FAIL — `content.creativeStructureUsed` and `content.usedSegmentProductReference` are `undefined` today.

- [ ] **Step 3: Record the fields in `generateAiImageWithReviewLoop`**

In `src/content-central.js`, right after the existing `content.image.references = baseReferences;` / `content.image.prompt = basePrompt;` lines (around line 5094-5095), add:

```js
  content.image.references = baseReferences;
  content.image.prompt = basePrompt;

  const structureReference = baseReferences.find((reference) => reference.referenceKind === 'segment_structure');
  content.creativeStructureUsed = structureReference
    ? { title: structureReference.title || '', postType: structureReference.postType || '', shape: structureReference.shape || '' }
    : null;
  content.usedSegmentProductReference = baseReferences.some((reference) => reference.referenceKind === 'segment_product');

  const generatedImage = await options.imageGenerator({
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/content-central.test.js`
Expected: PASS, including the full pre-existing suite.

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): record which creative structure and whether a product reference was used on each generated content item"
```

---

### Task 3: Frontend — show which structure/product reference was used on the approval card

**Files:**
- Modify: `content-central-app/src/api/client.ts:337-358` (`ContentItem` interface)
- Modify: `content-central-app/src/pages/workspace/PendingApproval.tsx`
- Test: `content-central-app/src/pages/workspace/PendingApproval.test.tsx`

**Interfaces:**
- Consumes: `content.creativeStructureUsed` / `content.usedSegmentProductReference` from Task 2, returned as-is (content items are stored/returned as plain JSON, no serialization step to update).
- Produces: nothing further downstream — this is the terminal UI task for Part B/C of the spec.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `content-central-app/src/pages/workspace/PendingApproval.test.tsx`, right after the `it("does not show a pillar pill when the topic has no resolved pillar", ...)` block (around line 105):

```tsx
  it("shows which creative structure was used and whether a segment product reference rode along", async () => {
    stubFetchSequence([
      { body: PROJECT_STATE },
      {
        body: {
          content: [
            baseItem({
              creativeStructureUsed: { title: "Oferta vertical com preco", postType: "offer", shape: "vertical" },
              usedSegmentProductReference: true,
            }),
          ],
        },
      },
    ]);

    renderPendingApproval();

    expect(await screen.findByText("Estrutura: Oferta vertical com preco")).toBeInTheDocument();
    expect(screen.getByText("Referencia de produto: usada")).toBeInTheDocument();
  });

  it("does not show creative-reference pills when the fields are absent", async () => {
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [baseItem()] } }]);

    renderPendingApproval();

    await screen.findByText("Legenda aguardando aprovação");
    expect(screen.queryByText(/^Estrutura:/)).toBeNull();
    expect(screen.queryByText("Referencia de produto: usada")).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `content-central-app/`): `npx vitest run src/pages/workspace/PendingApproval.test.tsx`
Expected: the first new test FAILS (`findByText("Estrutura: ...")` never resolves — `ContentItem` doesn't even have the field yet and nothing renders it). The second passes trivially today (no regression to protect yet), but keep it — it locks the "no noise" requirement once the pills exist.

- [ ] **Step 3: Add the fields to `ContentItem`**

In `content-central-app/src/api/client.ts`, in the `ContentItem` interface (around line 356-357), add two fields after the existing `creativeGroupKey`:

```ts
  creativeSharedWith?: string[] | null;
  creativeGroupKey?: string | null;
  creativeStructureUsed?: { title: string; postType?: string; shape?: string } | null;
  usedSegmentProductReference?: boolean;
}
```

- [ ] **Step 4: Render the pills in `PendingApproval.tsx`**

Add this helper function right after the existing `renderPillarPill` function (around line 251):

```tsx
  // Surfaces which segment-learning creative structure (if any) and
  // whether a registered product-reference photo actually reached this
  // generation — so the operator can tell at a glance whether the
  // registered "raio-x" references were used, without digging into logs.
  function renderCreativeReferencePills(item: ContentItem) {
    const structure = item.creativeStructureUsed;
    if (!structure && !item.usedSegmentProductReference) return null;
    return (
      <>
        {structure ? <span className="pill">Estrutura: {structure.title || "sem nome"}</span> : null}
        {item.usedSegmentProductReference ? <span className="pill">Referencia de produto: usada</span> : null}
      </>
    );
  }
```

Then call it right next to the existing `{renderPillarPill(leader)}` in `renderGroupCard` (around line 357) and `{renderPillarPill(item)}` in `renderSoloCard` (around line 461):

```tsx
              {renderPillarPill(leader)}
              {renderCreativeReferencePills(leader)}
```

```tsx
            {renderPillarPill(item)}
            {renderCreativeReferencePills(item)}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `content-central-app/`): `npx vitest run src/pages/workspace/PendingApproval.test.tsx`
Expected: PASS, including the full pre-existing file.

- [ ] **Step 6: Commit**

```bash
git add content-central-app/src/api/client.ts content-central-app/src/pages/workspace/PendingApproval.tsx content-central-app/src/pages/workspace/PendingApproval.test.tsx
git commit -m "feat(content-central-app): show which creative structure and whether a product reference was used on the approval card"
```

---

### Task 4: Frontend — Formato becomes optional, creative structures render as a card grid

**Files:**
- Modify: `content-central-app/src/components/LearningGallery.tsx:125-126` (`canConfirmCreative`/`canSaveEdit`), `:260-263` (structures container)
- Test: `content-central-app/src/components/LearningGallery.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed by other tasks — Task 5 edits the same file but a disjoint region (product-reference plumbing), sequenced after this task to avoid a two-writer collision on `LearningGallery.tsx`.

- [ ] **Step 1: Write the failing test**

In `content-central-app/src/components/LearningGallery.test.tsx`, replace the existing `it("requires a structure name, post type and shape before saving a creative structure", ...)` test (lines 26-57) with:

```tsx
  it("requires a structure name and post type before saving a creative structure — Formato stays optional", async () => {
    stubFetchSequence([
      { body: { imagePath: "segment/x/modelo.png", suggestedText: "modelo" } },
      { body: { entries: [] } },
    ]);
    const user = userEvent.setup();

    render(
      <LearningGallery scope="segment" groupKey="group:x" entries={[]} onEntriesChange={() => {}} splitImagePurposes />,
    );

    const file = new File(["x"], "modelo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Nova estrutura de criativo"), file);

    await waitFor(() => screen.getByLabelText("Nome da estrutura"));
    expect(screen.getByText("Salvar referencia")).toBeDisabled();

    await user.type(screen.getByLabelText("Nome da estrutura"), "Oferta vertical");
    expect(screen.getByText("Salvar referencia")).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Tipo de post"), "offer");
    expect(screen.getByText("Salvar referencia")).toBeEnabled();

    await user.click(screen.getByText("Salvar referencia"));

    await waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      expect(calls[1][0]).toBe("/api/segment-learnings/entries");
      const payload = JSON.parse(calls[1][1].body as string);
      expect(payload.title).toBe("Oferta vertical");
      expect(payload.postType).toBe("offer");
      expect(payload.shape).toBe("");
      expect(payload.purpose).toBe("creative");
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `content-central-app/`): `npx vitest run src/components/LearningGallery.test.tsx`
Expected: FAILS — `expect(screen.getByText("Salvar referencia")).toBeEnabled()` fails after only Nome+Tipo de post are filled, because `canConfirmCreative` still requires `pendingShape` too.

- [ ] **Step 3: Drop the shape requirement**

In `content-central-app/src/components/LearningGallery.tsx`, replace lines 125-126:

```tsx
  const canConfirmCreative = pendingImage?.purpose !== "creative" || (pendingStructureTitle.trim() && pendingPostType && pendingShape);
  const canSaveEdit = editingStructure.title.trim() && editingStructure.postType && editingStructure.shape;
```

with:

```tsx
  const canConfirmCreative = pendingImage?.purpose !== "creative" || (pendingStructureTitle.trim() && pendingPostType);
  const canSaveEdit = editingStructure.title.trim() && editingStructure.postType;
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `content-central-app/`): `npx vitest run src/components/LearningGallery.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the card grid**

Add this test to `content-central-app/src/components/LearningGallery.test.tsx`, right after the `it("renders named creative structures with postType and shape pills", ...)` test:

```tsx
  it("lays out multiple creative structures as a grid, not a single-column stack", () => {
    const { container } = render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          { id: "1", bucket: "approved", kind: "image", title: "Oferta vertical", text: "modelo 1", imagePath: "segment/x/a.png", purpose: "creative", postType: "offer", shape: "vertical", source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "2", bucket: "approved", kind: "image", title: "Institucional", text: "modelo 2", imagePath: "segment/x/b.png", purpose: "creative", postType: "institutional", shape: "feed", source: "manual", createdAt: "2026-01-02T00:00:00.000Z" },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
      />,
    );

    const grid = container.querySelector('[style*="grid-template-columns"]');
    expect(grid).not.toBeNull();
    expect(grid?.children).toHaveLength(2);
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run (from `content-central-app/`): `npx vitest run src/components/LearningGallery.test.tsx`
Expected: FAILS — today's container is a plain `className="stack-sm"` div with no `grid-template-columns` inline style.

- [ ] **Step 7: Make the structures container a grid**

In `content-central-app/src/components/LearningGallery.tsx`, replace the opening of the structures list (around line 260-261):

```tsx
          {creativeStructures.length ? (
            <div className="stack-sm">
```

with:

```tsx
          {creativeStructures.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-sm)" }}>
```

(the closing `</div>` and everything inside — image, title, pills, description, edit/apagar buttons, the inline edit form — stays exactly as it is today; only the wrapping container changes from a vertical stack to a grid).

- [ ] **Step 8: Run the test to verify it passes**

Run (from `content-central-app/`): `npx vitest run src/components/LearningGallery.test.tsx`
Expected: PASS, including the full pre-existing file.

- [ ] **Step 9: Commit**

```bash
git add content-central-app/src/components/LearningGallery.tsx content-central-app/src/components/LearningGallery.test.tsx
git commit -m "feat(content-central-app): make a creative structure's Formato optional and lay structures out as a card grid"
```

---

### Task 5: Frontend — dedupe "Referencias de produto" into one scoped section

**Files:**
- Modify: `content-central-app/src/components/LearningGallery.tsx` (props signature, render order, new exported `ProductReferenceGallery`)
- Modify: `content-central-app/src/pages/AprendizadoSegmento.tsx`
- Test: `content-central-app/src/components/LearningGallery.test.tsx`
- Test: `content-central-app/src/pages/AprendizadoSegmento.test.tsx`

**Interfaces:**
- Consumes: the `LearningGallery` component and its props from Task 4's version of the file (this task adds to, not replaces, Task 4's edits — run this task after Task 4 lands).
- Produces: new exported `ProductReferenceGallery({ scope, nodes, onNodeEntriesChange })` component, structurally identical in contract to the existing `CreativeStructureGallery`. `LearningGallery` gains a `showProductReferences?: boolean` prop (default `true`).

- [ ] **Step 1: Write the failing tests — component-level**

Add these two tests to `content-central-app/src/components/LearningGallery.test.tsx`, at the end of the `describe` block:

```tsx
  it("hides the product-reference section when showProductReferences is false", () => {
    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[]}
        onEntriesChange={() => {}}
        splitImagePurposes
        showProductReferences={false}
      />,
    );

    expect(screen.queryByText("Referencias de produto")).toBeNull();
  });

  it("still shows Aprovado/Evitar buckets and the general text field on a per-node card even when the product-reference section is hidden", () => {
    render(
      <LearningGallery
        scope="segment"
        groupKey="group:x"
        entries={[
          { id: "t1", bucket: "approved", kind: "text", text: "nota geral", source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
        ]}
        onEntriesChange={() => {}}
        splitImagePurposes
        showCreativeStructures={false}
        showProductReferences={false}
      />,
    );

    expect(screen.getByText("nota geral")).toBeInTheDocument();
    expect(screen.getByLabelText("Novo aprendizado em texto")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `content-central-app/`): `npx vitest run src/components/LearningGallery.test.tsx`
Expected: the first new test FAILS with a TypeScript/prop-mismatch or simply renders the section anyway — `showProductReferences` doesn't exist on the component yet, so passing it has no effect and the section still renders. The second test currently PASSES already (no regression to protect yet, but keep it to lock the decoupling this task introduces).

- [ ] **Step 3: Add `showProductReferences` and decouple the product-reference section from `onlyCreativeStructures`**

In `content-central-app/src/components/LearningGallery.tsx`, replace the `LearningGallery` function signature (lines 94-110):

```tsx
export function LearningGallery({
  scope,
  groupKey,
  entries,
  onEntriesChange,
  splitImagePurposes = false,
  showCreativeStructures = true,
  onlyCreativeStructures = false,
}: {
  scope: "segment" | "offerType";
  groupKey: string;
  entries: SegmentLearningEntry[];
  onEntriesChange: (entries: SegmentLearningEntry[]) => void;
  splitImagePurposes?: boolean;
  showCreativeStructures?: boolean;
  onlyCreativeStructures?: boolean;
}) {
```

with:

```tsx
export function LearningGallery({
  scope,
  groupKey,
  entries,
  onEntriesChange,
  splitImagePurposes = false,
  showCreativeStructures = true,
  showProductReferences = true,
  onlyCreativeStructures = false,
}: {
  scope: "segment" | "offerType";
  groupKey: string;
  entries: SegmentLearningEntry[];
  onEntriesChange: (entries: SegmentLearningEntry[]) => void;
  splitImagePurposes?: boolean;
  showCreativeStructures?: boolean;
  showProductReferences?: boolean;
  onlyCreativeStructures?: boolean;
}) {
```

Then replace the render block from the product-reference section through the end of the `{!onlyCreativeStructures ? ... : null}` block (`content-central-app/src/components/LearningGallery.tsx:324-380`, i.e. everything from `{!onlyCreativeStructures ? (` down to its matching `) : null}` just before `{pendingImage ? (`) with:

```tsx
      {splitImagePurposes && showProductReferences ? (
        <section className="field-card stack-sm">
          <div>
            <h3>Referencias de produto</h3>
            <p className="muted" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--text-sm)" }}>
              Fotos reais ou guias de produto. Elas ajudam o produto, nao definem layout.
            </p>
          </div>
          {productReferences.map((entry) => (
            <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "48px minmax(0, 1fr) auto", gap: "var(--space-sm)", alignItems: "center", paddingBottom: "var(--space-xs)", borderBottom: "1px solid var(--line)" }}>
              {entry.imagePath ? <img src={previewSrc(entry)} alt={entry.text || "Referencia de produto"} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 10 }} /> : <span />}
              <span>{entry.text}</span>
              <Button variant="ghost" disabled={busy} onClick={() => handleDelete(entry.id)}>Apagar</Button>
            </div>
          ))}
          <div>
            <label htmlFor={`upload-product-${groupKey}`}>Nova referencia de produto</label>
            <input id={`upload-product-${groupKey}`} type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && handleUploadImage(event.target.files[0], "product")} />
          </div>
        </section>
      ) : null}

      {!onlyCreativeStructures ? (
        <>
          {buckets.map(({ key, label }) => {
            const currentEntries = bucketEntries.filter((entry) => entry.bucket === key);
            if (!currentEntries.length) return null;
            return (
              <section key={key} className="stack-sm">
                <h3>{label}</h3>
                {currentEntries.map((entry) => (
                  <div key={entry.id} style={{ display: "grid", gridTemplateColumns: entry.kind === "image" ? "48px minmax(0, 1fr) auto" : "minmax(0, 1fr) auto", gap: "var(--space-sm)", alignItems: "center", padding: "var(--space-xs) 0", borderBottom: "1px solid var(--line)" }}>
                    {entry.kind === "image" && entry.imagePath ? <img src={previewSrc(entry)} alt={entry.text || "Referencia de aprendizado"} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 10 }} /> : null}
                    <span>{entry.text}</span>
                    <Button variant="ghost" disabled={busy} onClick={() => handleDelete(entry.id)}>Apagar</Button>
                  </div>
                ))}
              </section>
            );
          })}

          <div className="actions-row">
            <input
              aria-label="Novo aprendizado em texto"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              placeholder="Ex: nao parecer gerado por IA, ser mais detalhista"
            />
            <Button disabled={busy} onClick={handleAddText}>Adicionar texto</Button>
          </div>
          {!splitImagePurposes ? (
            <div>
              <label htmlFor={`upload-${groupKey}`}>Adicionar imagem de referencia</label>
              <input id={`upload-${groupKey}`} type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && handleUploadImage(event.target.files[0])} />
            </div>
          ) : null}
        </>
      ) : null}
```

(This is the same JSX as before, just split into two independently-gated blocks: the product-reference `<section>` is now gated purely by `splitImagePurposes && showProductReferences`, and the buckets/text-add/bottom-upload block is now gated purely by `onlyCreativeStructures` — no more nesting one inside the other.)

- [ ] **Step 4: Update `CreativeStructureGallery` to keep hiding product references**

`CreativeStructureGallery`'s render used to get product references suppressed as a side effect of `onlyCreativeStructures`. Now that the two are decoupled, it needs to say so explicitly. In `content-central-app/src/components/LearningGallery.tsx`, inside `CreativeStructureGallery` (around line 82-89), change:

```tsx
      <LearningGallery
        scope={scope}
        groupKey={selectedNode.path}
        entries={selectedNode.entries}
        onEntriesChange={(entries) => onNodeEntriesChange(selectedNode.path, entries)}
        splitImagePurposes
        onlyCreativeStructures
      />
```

to:

```tsx
      <LearningGallery
        scope={scope}
        groupKey={selectedNode.path}
        entries={selectedNode.entries}
        onEntriesChange={(entries) => onNodeEntriesChange(selectedNode.path, entries)}
        splitImagePurposes
        showProductReferences={false}
        onlyCreativeStructures
      />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `content-central-app/`): `npx vitest run src/components/LearningGallery.test.tsx`
Expected: PASS, including the full pre-existing file (in particular, every existing `CreativeStructureGallery`-driven behavior is unchanged since it now explicitly asks for the same suppression it used to get implicitly).

- [ ] **Step 6: Write the failing test — `AprendizadoSegmento` dedupe**

In `content-central-app/src/pages/AprendizadoSegmento.test.tsx`, replace the `it("shows one creative-structure panel and keeps product references inside each segment level", ...)` test (lines 32-64) with:

```tsx
  it("shows one creative-structure panel and one product-reference panel, each with a Setor/Nicho scope selector", async () => {
    stubFetchSequence([
      {
        body: {
          nodes: [
            { path: "group:alimenticio", label: "Alimenticio", level: "setor", entries: [] },
            {
              path: "group:alimenticio/category:pizzaria",
              label: "Alimenticio / Pizzaria",
              level: "nicho",
              entries: [
                { id: "e1", bucket: "approved", kind: "text", text: "Esfiha tem que ser redonda", source: "manual", createdAt: "2026-08-01" },
                { id: "e2", bucket: "approved", kind: "image", imagePath: "segment/group-alimenticio/esfiha.png", text: "Esfiha redonda", source: "manual", createdAt: "2026-08-01" },
              ],
            },
          ],
        },
      },
    ]);
    renderPage();

    await userEvent.selectOptions(await screen.findByLabelText("Setor"), "Alimentício");
    await userEvent.selectOptions(screen.getByLabelText("Nicho"), "Pizzaria");
    await userEvent.click(screen.getByRole("button", { name: "Ver aprendizado" }));

    expect(await screen.findByText("Esfiha tem que ser redonda")).toBeInTheDocument();
    expect(screen.getByAltText("Esfiha redonda")).toHaveAttribute("src", "/api/learning-assets/segment/group-alimenticio/esfiha.png");
    expect(screen.getAllByLabelText("Nova estrutura de criativo")).toHaveLength(1);
    expect(screen.getAllByLabelText("Nova referencia de produto")).toHaveLength(1);
    expect(screen.getByLabelText("Salvar e editar estruturas em")).toBeInTheDocument();
    expect(screen.getByLabelText("Salvar e editar referencias de produto em")).toBeInTheDocument();
    expect(screen.queryByText("Criativo")).toBeNull();
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(decodeURIComponent(call[0])).toContain("segmentGroup=Alimentício");
  });
```

- [ ] **Step 7: Run the test to verify it fails**

Run (from `content-central-app/`): `npx vitest run src/pages/AprendizadoSegmento.test.tsx`
Expected: FAILS — `getAllByLabelText("Nova referencia de produto")` still finds 2 elements (one per node card), and `getByLabelText("Salvar e editar referencias de produto em")` finds none (no such component exists yet).

- [ ] **Step 8: Add `ProductReferenceGallery` and use it in `AprendizadoSegmento`**

In `content-central-app/src/components/LearningGallery.tsx`, add this new exported component right after `CreativeStructureGallery` (after its closing `}` around line 92):

```tsx
export function ProductReferenceGallery({
  scope,
  nodes,
  onNodeEntriesChange,
}: {
  scope: "segment" | "offerType";
  nodes: SegmentLearningNode[];
  onNodeEntriesChange: (path: string, entries: SegmentLearningEntry[]) => void;
}) {
  const [selectedPath, setSelectedPath] = useState("");
  const selectedNode = nodes.find((node) => node.path === selectedPath) || nodes[nodes.length - 1];

  useEffect(() => {
    if (!nodes.length) return;
    setSelectedPath((current) => (nodes.some((node) => node.path === current) ? current : nodes[nodes.length - 1].path));
  }, [nodes]);

  if (!selectedNode) return null;

  return (
    <div className="stack-md">
      {nodes.length > 1 ? (
        <div>
          <label htmlFor="product-reference-node">Salvar e editar referencias de produto em</label>
          <select id="product-reference-node" value={selectedNode.path} onChange={(event) => setSelectedPath(event.target.value)}>
            {nodes.map((node) => (
              <option key={node.path} value={node.path}>{node.label}</option>
            ))}
          </select>
          <p className="muted" style={{ margin: "var(--space-xs) 0 0", fontSize: "var(--text-sm)" }}>
            Referencias salvas no Setor valem para todo o ramo; no Nicho ou Especialidade, ficam mais específicas.
          </p>
        </div>
      ) : null}
      <LearningGallery
        scope={scope}
        groupKey={selectedNode.path}
        entries={selectedNode.entries}
        onEntriesChange={(entries) => onNodeEntriesChange(selectedNode.path, entries)}
        splitImagePurposes
        showCreativeStructures={false}
        onlyCreativeStructures
      />
    </div>
  );
}
```

In `content-central-app/src/pages/AprendizadoSegmento.tsx`, update the import (line 6):

```tsx
import { CreativeStructureGallery, LearningGallery, ProductReferenceGallery } from "@/components/LearningGallery";
```

Then replace the block from the `<Card style={{ padding: 16 }}>` that renders `CreativeStructureGallery` through the end of the `nodes.map` (lines 72-95) with:

```tsx
          <Card style={{ padding: 16 }}>
            <h2>Estruturas de criativo</h2>
            <p className="muted" style={{ margin: "var(--space-2xs) 0 var(--space-md)" }}>
              Cadastre aqui os modelos de layout que a IA pode seguir. Cada estrutura precisa ter nome e tipo de post.
            </p>
            <CreativeStructureGallery
              scope="segment"
              nodes={nodes}
              onNodeEntriesChange={(path, entries) => setNodes((current) => (current || []).map((node) => (node.path === path ? { ...node, entries } : node)))}
            />
          </Card>
          <Card style={{ padding: 16 }}>
            <h2>Referencias de produto</h2>
            <p className="muted" style={{ margin: "var(--space-2xs) 0 var(--space-md)" }}>
              Fotos reais ou guias de produto (textura, montagem, combos). Ajudam a IA a entender como o produto realmente se parece — nao definem layout.
            </p>
            <ProductReferenceGallery
              scope="segment"
              nodes={nodes}
              onNodeEntriesChange={(path, entries) => setNodes((current) => (current || []).map((node) => (node.path === path ? { ...node, entries } : node)))}
            />
          </Card>
          {nodes.map((node) => (
            <Card key={node.path} style={{ padding: 16 }}>
              <b>{node.label}</b>
              <LearningGallery
                scope="segment"
                groupKey={node.path}
                entries={node.entries}
                splitImagePurposes
                showCreativeStructures={false}
                showProductReferences={false}
                onEntriesChange={(entries) => setNodes((current) => (current || []).map((n) => (n.path === node.path ? { ...n, entries } : n)))}
              />
            </Card>
          ))}
```

- [ ] **Step 9: Run the test to verify it passes**

Run (from `content-central-app/`): `npx vitest run src/pages/AprendizadoSegmento.test.tsx`
Expected: PASS, including the second pre-existing test in the file (`"sends purpose=creative when analyzing an uploaded creative-structure reference"`), which is unaffected since it only exercises a single-node Setor with no Nicho.

- [ ] **Step 10: Run the full frontend test suite**

Run (from `content-central-app/`): `npx vitest run`
Expected: PASS across the whole app — this task touches a shared component (`LearningGallery.tsx`) consumed by `AprendizadoSegmento.tsx` and `AprendizadoTipoOferta.tsx`, so a full run catches any collateral break in the latter (which passes no `splitImagePurposes`/`showCreativeStructures` override, so its product-reference section — gated by `splitImagePurposes && showProductReferences` — was already off before this task and stays off now).

- [ ] **Step 11: Commit**

```bash
git add content-central-app/src/components/LearningGallery.tsx content-central-app/src/components/LearningGallery.test.tsx content-central-app/src/pages/AprendizadoSegmento.tsx content-central-app/src/pages/AprendizadoSegmento.test.tsx
git commit -m "feat(content-central-app): dedupe Referencias de produto into one Setor/Nicho-scoped panel, matching Estruturas de criativo"
```

---

## Self-Review

**Spec coverage:**
- "Referencias de produto" appears once with a scope selector → Task 5.
- Structures render as a card grid → Task 4.
- Formato optional, blank matches both shapes → Task 4 (frontend gate) + Task 1 (backend match).
- Product reference reaches AI generation, additive/non-blocking, texture-only instruction (unchanged text) → Task 1.
- Generated creative records structure/product usage → Task 2.
- Approval card shows the usage pills → Task 3.
- Non-goals (no card treatment for product refs, no per-image avoid/use text binding, `AprendizadoTipoOferta` untouched, `visual_reference`/project `layout_model` untouched) — none of the five tasks touch any of those.

**Placeholder scan:** none found — every step has literal code, exact file/line anchors, and runnable test commands.

**Type consistency:** `referenceKind: 'segment_structure' | 'segment_product'` (Task 1) → read the same way in Task 2 → `creativeStructureUsed`/`usedSegmentProductReference` (Task 2) → same field names and shape in `ContentItem` (Task 3). `showProductReferences` (Task 5) is additive to Task 4's unchanged props; `onlyCreativeStructures` keeps its name but its scope narrows (documented in Task 5 Step 3-4) — `CreativeStructureGallery` is updated in the same task to keep its existing behavior under the new, narrower semantics.
