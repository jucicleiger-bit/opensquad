# Mandatory Creative Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AI-decided creative composition with a required operator-authored template per (segment, post type, format shape) — generation blocks when none exists — and remove the AI-scored review/regeneration loop entirely.

**Architecture:** Extend the existing segment-learning image-entry data model (`_opensquad/content-central/assets/learning/segment/<segmentKey>/`, already used for `layout_model` references) with `postType`/`shape` tags. `buildSegmentLayoutReferences` returns every matching entry instead of just the newest one; `buildPrimaryAiImageReferences` filters those candidates against the current topic's derived post type + channel shape and throws a clear error when nothing matches, otherwise rotates among matches exactly as it already does for other reference types. `buildCreativeSpec` always locks composition (`layoutStrength: 'strict'`) once a matching template exists. `generateAiImageWithReviewLoop` drops its AI-review branch entirely — one generation, straight to human approval.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`), the existing `content-central.js`/`content-central-server.js` module pair, React/TypeScript for the one frontend task.

## Global Constraints

- Branch: `content-central-creative-fixes-wip`. Do not touch `work`.
- `postType` values: `offer | institutional | special_date | ad_creative` — matches the classification `buildChatGptFinalCardPrompt` already computes from `topic.source`/`topic.offerId` (do not invent new categories).
- `shape` values: `vertical | feed` — reuse `creativeShapeGroupForChannel(channel)` verbatim, do not add a third value.
- No template matching `(postType, shape)` for a topic → the generation call throws a clear, specific error (this is the existing error-propagation path already used elsewhere in `generateAiImageWithReviewLoop` — see the `!generatedImage?.url` throw at the top of the function for the established pattern of "throw → caller records `imageGenerationError`").
- Run `npm test` (root) after every task. Run `npm run lint` (root) after Task 5 specifically, since it deletes code.
- Every `git commit` in this plan is a **separate** commit — never squash tasks together.

---

### Task 1: Tag segment learning image entries with postType + shape

**Files:**
- Modify: `src/content-central.js:3802-3820` (`normalizeSegmentLearningEntry`)
- Modify: `src/content-central.js:4140-4147` (the `normalizeSegmentLearningEntry({...})` call inside `saveLearningEntry`)
- Test: `tests/content-central.test.js` (new test near the existing `saveLearningEntry`/`analyzeLearningImage` tests, e.g. after line 748)

**Interfaces:**
- Consumes: nothing new.
- Produces: every entry object now carries `postType: string` and `shape: string` (empty string when not applicable/not an image/not creative-purpose) — Task 2 reads these two fields directly off entries loaded via `loadSegmentLearningNodes`.

- [ ] **Step 1: Write the failing test**

```js
test('saveLearningEntry tags a creative-purpose image entry with postType and shape, and strips them from any other entry kind/purpose', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'template-tags', name: 'Template Tags', handle: '@templatetags', approvalEmail: 'a@example.com' }, dir);
    const groupKey = 'group:alimenticio/category:pizzaria';

    const creativeEntries = await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
      text: 'modelo de oferta', imagePath: 'segment/x/oferta.png',
      purpose: 'creative', postType: 'offer', shape: 'vertical',
    }, dir);
    const creative = creativeEntries[0];
    assert.equal(creative.postType, 'offer');
    assert.equal(creative.shape, 'vertical');

    // A product-purpose image entry never carries these tags, even if the
    // caller sends them — postType/shape describe LAYOUT templates, and a
    // product-purpose entry isn't one (see buildSegmentLayoutReferences,
    // which only ever tags the 'creative' branch).
    const productEntries = await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
      text: 'foto de produto', imagePath: 'segment/x/produto.png',
      purpose: 'product', postType: 'offer', shape: 'vertical',
    }, dir);
    const product = productEntries.find((entry) => entry.text === 'foto de produto');
    assert.equal(product.postType, '');
    assert.equal(product.shape, '');

    // A text entry (no image at all) never carries these tags either.
    const textEntries = await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'text',
      text: 'não parecer gerado por IA', postType: 'offer', shape: 'vertical',
    }, dir);
    const textEntry = textEntries.find((entry) => entry.text === 'não parecer gerado por IA');
    assert.equal(textEntry.postType, '');
    assert.equal(textEntry.shape, '');

    // An unrecognized value gets dropped to '' instead of stored verbatim.
    const junkEntries = await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
      text: 'lixo', imagePath: 'segment/x/lixo.png',
      purpose: 'creative', postType: 'nao-existe', shape: 'quadrado',
    }, dir);
    const junk = junkEntries.find((entry) => entry.text === 'lixo');
    assert.equal(junk.postType, '');
    assert.equal(junk.shape, '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central.test.js`
Expected: FAIL — `creative.postType` is `undefined`, not `'offer'` (the field doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `normalizeSegmentLearningEntry` (content-central.js:3802), add two lines right after the existing `purpose` line (3810) and include them in the returned object:

```js
function normalizeSegmentLearningEntry(input = {}) {
  const kind = input.kind === 'image' ? 'image' : 'text';
  const purpose = kind === 'image' ? (input.purpose === 'product' ? 'product' : 'creative') : undefined;
  const isCreativeImage = kind === 'image' && purpose === 'creative';
  const postType = isCreativeImage && ['offer', 'institutional', 'special_date', 'ad_creative'].includes(input.postType)
    ? input.postType
    : '';
  const shape = isCreativeImage && ['vertical', 'feed'].includes(input.shape)
    ? input.shape
    : '';
  return {
    id: String(input.id || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    bucket: ['technical', 'approved', 'avoid'].includes(input.bucket) ? input.bucket : 'approved',
    kind,
    text: cleanText(input.text),
    imagePath: kind === 'image' ? String(input.imagePath || '').replace(/\\/g, '/') : '',
    purpose,
    postType,
    shape,
    source: input.source === 'auto' ? 'auto' : 'manual',
    sourceProjectId: kind === 'image' ? String(input.sourceProjectId || '') : '',
    createdAt: input.createdAt || new Date().toISOString(),
  };
}
```

(This replaces the old inline `purpose: kind === 'image' ? (input.purpose === 'product' ? 'product' : 'creative') : undefined,` line with the `purpose` local var computed above it, then adds `postType`/`shape`. Everything else in the function is unchanged — keep the `sourceProjectId` comment above it exactly as it is.)

`saveLearningEntry` (content-central.js:4140) already spreads the caller's raw `input` fields it cares about into `normalizeSegmentLearningEntry({...})` — add `postType: input.postType, shape: input.shape` to that call:

```js
const entry = normalizeSegmentLearningEntry({
  bucket: input.bucket,
  kind: input.kind,
  text: input.text,
  imagePath: input.imagePath,
  purpose: input.purpose,
  postType: input.postType,
  shape: input.shape,
  source: 'manual',
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/content-central.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): tag creative-purpose learning entries with postType/shape"
```

---

### Task 2: buildSegmentLayoutReferences returns every matching template, filterable by postType/shape

**Files:**
- Modify: `src/content-central.js:7422-7456` (`buildSegmentLayoutReferences`)
- Test: `tests/content-central.test.js:695-748` (rewrite — the "caps this at the single most recent" assertion is no longer true)
- Test: `tests/content-central.test.js:779-817` (rewrite — the "skips missing, does not backfill from next-oldest" test's premise no longer holds once multiple candidates are returned)
- Test: new test for the `postType`/`shape` filter

**Interfaces:**
- Consumes: `entry.postType`/`entry.shape` from Task 1.
- Produces: `buildSegmentLayoutReferences(project, paths, { postType?, shape?, random? })` now returns **every** approved creative-purpose image entry matching the given `postType`/`shape` (or every creative entry, unfiltered, when neither is passed) as an array of `role: 'layout_model'` references, each carrying `.postType`/`.shape`. The single random product-purpose reference at the end is unchanged in behavior.

- [ ] **Step 1: Write the failing tests**

Replace the test at line 695 (`'buildSegmentLayoutReferences returns only the single most recent...'`) with:

```js
test('buildSegmentLayoutReferences returns every approved creative image, newest first, skips avoid/text entries', async () => {
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
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'text', text: 'não parecer gerado por IA' }, dir, new Date());
    const avoidAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'evitar.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'Evitar isso' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'avoid', kind: 'image', text: 'Evitar isso', imagePath: avoidAnalyzed.imagePath }, dir, new Date());

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

    const project = await loadProjectForTest('pizzaria-layout', dir);
    const references = await buildSegmentLayoutReferences(project, paths);

    assert.deepEqual(
      references.map((r) => r.relativePath),
      [imagePaths.img5, imagePaths.img4, imagePaths.img3, imagePaths.img2, imagePaths.img1],
      'every approved creative image comes back, newest first — avoid/text entries excluded'
    );
    assert.ok(references.every((r) => r.role === 'layout_model'));
    assert.ok(references.every((r) => r.weight === 'medium'));
    assert.equal(
      references[0].instruction,
      'Modelo de composição aprovado no aprendizado de segmento: usar como referência de distribuição dos elementos (título, blocos de benefício, selo, hierarquia). Não copiar marca, produto ou cores da imagem de referência.'
    );
    await access(references[0].absolutePath);
  });
});
```

Replace the test at line 779 (`'...skips a missing-on-disk most recent image instead of crashing or backfilling...'`) with:

```js
test('buildSegmentLayoutReferences skips a missing-on-disk image and still returns the remaining valid ones', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pizzaria-layout-missing', name: 'Pizzaria Layout Missing', handle: '@pizzarialayoutmissing', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('pizzaria-layout-missing', {
      brandName: 'Pizzaria Layout Missing',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const groupKey = 'group:alimenticio/category:pizzaria';
    const imagePaths = {};
    for (const name of ['img1', 'img2']) {
      const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: `${name}.png` }, dir, new Date(), { learningImageAnalyzer: async () => `Descrição ${name}` });
      await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: `Descrição ${name}`, imagePath: analyzed.imagePath }, dir, new Date());
      imagePaths[name] = analyzed.imagePath;
    }

    const paths = getCentralPaths(dir, 'pizzaria-layout-missing');
    const store = JSON.parse(await readFile(paths.segmentLearningsPath, 'utf-8'));
    const node = store.nodes[groupKey];
    for (const entry of node.entries) {
      const key = Object.keys(imagePaths).find((name) => imagePaths[name] === entry.imagePath);
      entry.createdAt = `2026-01-01T00:0${['img1', 'img2'].indexOf(key)}:00.000Z`;
    }
    await writeFile(paths.segmentLearningsPath, JSON.stringify(store, null, 2));

    // Delete img2's file on disk (the newest) — it must be skipped, but
    // img1 (still on disk) must still come back, not an empty list.
    await rm(join(paths.root, 'assets', 'learning', imagePaths.img2));

    const project = await loadProjectForTest('pizzaria-layout-missing', dir);
    const references = await buildSegmentLayoutReferences(project, paths);

    assert.deepEqual(references.map((r) => r.relativePath), [imagePaths.img1]);
  });
});
```

Add a new test for the postType/shape filter, right after the rewritten test above:

```js
test('buildSegmentLayoutReferences filters creative images by postType and shape when given', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'template-filter', name: 'Template Filter', handle: '@templatefilter', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('template-filter', {
      brandName: 'Template Filter', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    const paths = getCentralPaths(dir, 'template-filter');
    const groupKey = 'group:alimenticio/category:pizzaria';
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const savedPaths = {};
    const combos = [
      ['offer-vertical', 'offer', 'vertical'],
      ['offer-feed', 'offer', 'feed'],
      ['institutional-vertical', 'institutional', 'vertical'],
    ];
    for (const [name, postType, shape] of combos) {
      const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: `${name}.png` }, dir, new Date(), { learningImageAnalyzer: async () => name });
      await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: name, imagePath: analyzed.imagePath, purpose: 'creative', postType, shape }, dir);
      savedPaths[name] = analyzed.imagePath;
    }

    const project = await loadProjectForTest('template-filter', dir);
    const offerVertical = await buildSegmentLayoutReferences(project, paths, { postType: 'offer', shape: 'vertical' });
    assert.deepEqual(offerVertical.map((r) => r.relativePath), [savedPaths['offer-vertical']]);

    const specialDate = await buildSegmentLayoutReferences(project, paths, { postType: 'special_date', shape: 'vertical' });
    assert.deepEqual(specialDate, []);

    const allUnfiltered = await buildSegmentLayoutReferences(project, paths);
    assert.equal(allUnfiltered.length, 3, 'no filter passed → every creative entry comes back, matching existing callers that never asked for a filter');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central.test.js`
Expected: the two rewritten tests FAIL (old code returns only 1 entry, and backfills nothing on missing file — both now assert different behavior); the new filter test FAILS (`buildSegmentLayoutReferences` doesn't accept `postType`/`shape` options yet, filter has no effect, `offerVertical` and `specialDate` both return all 3 unfiltered).

- [ ] **Step 3: Write minimal implementation**

Replace `buildSegmentLayoutReferences` (content-central.js:7422-7456) with:

```js
export async function buildSegmentLayoutReferences(project, paths, options = {}) {
  const nodes = await loadSegmentLearningNodes(paths, project);
  const imageEntries = nodes
    .flatMap((node) => node.entries)
    .filter((entry) => entry.bucket === 'approved' && entry.kind === 'image' && entry.imagePath);
  const creativeEntries = imageEntries
    .filter((entry) => entry.purpose !== 'product')
    .filter((entry) => !options.postType || entry.postType === options.postType)
    .filter((entry) => !options.shape || entry.shape === options.shape)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const productEntries = imageEntries.filter((entry) => entry.purpose === 'product');
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const productEntry = productEntries.length
    ? productEntries[Math.min(productEntries.length - 1, Math.max(0, Math.floor(random() * productEntries.length)))]
    : null;

  const references = [];
  for (const entry of creativeEntries) {
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
    reference.postType = entry.postType || '';
    reference.shape = entry.shape || '';
    references.push(reference);
  }
  if (productEntry) {
    const absolutePath = join(paths.root, 'assets', 'learning', productEntry.imagePath);
    if (existsSync(absolutePath)) {
      const reference = normalizeReferenceMetadata({
        id: `segment-layout-${productEntry.id}`,
        filename: productEntry.imagePath.split('/').pop(),
        relativePath: productEntry.imagePath,
        mimeType: mimeTypeFromFilename(productEntry.imagePath),
        role: 'layout_model',
        weight: 'medium',
        instruction: SEGMENT_PRODUCT_REFERENCE_INSTRUCTION,
        createdAt: productEntry.createdAt,
      });
      reference.absolutePath = absolutePath;
      reference.previewUrl = `/api/learning-assets/${productEntry.imagePath.split('/').map(encodeURIComponent).join('/')}`;
      references.push(reference);
    }
  }
  return references;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): buildSegmentLayoutReferences returns every matching template, filterable by postType/shape"
```

---

### Task 3: buildPrimaryAiImageReferences requires a matching template

**Files:**
- Modify: `src/content-central.js:5872-5944` (`buildPrimaryAiImageReferences`) — add a new `deriveCreativePostType` helper immediately above it
- Test: `tests/content-central.test.js` (new tests, via `simulateTestPost`/generation — `buildPrimaryAiImageReferences` is not exported, matches how the earlier CTA/institutional-photo fixes in this same session were tested)

**Interfaces:**
- Consumes: `entry.postType`/`entry.shape` on `layout_model` references (Task 2's `buildSegmentLayoutReferences` output, already flowing into `content.image.references` via `buildImageReferencePayload` with no changes needed there — it already spreads whatever `buildSegmentLayoutReferences` returns).
- Produces: `deriveCreativePostType(topic)` — pure function, `'offer' | 'institutional' | 'special_date' | 'ad_creative'` — reusable by later tasks/future code. `buildPrimaryAiImageReferences` now throws `Error` with a message matching `/Nenhum modelo de criativo cadastrado/` when zero `layout_model` candidates match the derived postType + shape.

- [ ] **Step 1: Write the failing tests**

```js
test('generation blocks with a clear error when no creative template matches the topic\'s postType and shape', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-modelo', name: 'Sem Modelo', handle: '@semmodelo', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sem-modelo', {
      brandName: 'Sem Modelo', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('sem-modelo', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);

    await assert.rejects(
      simulateTestPost('sem-modelo', {
        channel: 'instagram_story',
        imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
      }, dir, new Date('2026-07-20T12:00:00.000Z')),
      /Nenhum modelo de criativo cadastrado/,
    );
  });
});

test('generation proceeds once a matching creative template exists for the topic\'s postType and shape', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'com-modelo', name: 'Com Modelo', handle: '@commodelo', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('com-modelo', {
      brandName: 'Com Modelo', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('com-modelo', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'modelo-oferta.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'modelo', imagePath: analyzed.imagePath, purpose: 'creative', postType: 'offer', shape: 'vertical' }, dir);

    const generatorCalls = [];
    await simulateTestPost('com-modelo', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => { generatorCalls.push(payload); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(generatorCalls.length, 1);
    assert.match(generatorCalls[0].content.image.prompt, /modelo-oferta\.png/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central.test.js`
Expected: FAIL — both tests fail because generation currently never throws for a missing template (no such concept exists yet), so the first test's `assert.rejects` fails, and the second test's premise (a template being required to reach the generator) doesn't yet apply so it may pass or fail depending on unrelated state — treat any non-matching-error output as the expected pre-implementation failure.

- [ ] **Step 3: Write minimal implementation**

Add this new function immediately above `buildPrimaryAiImageReferences` (content-central.js:5872):

```js
// Mirrors the same classification buildChatGptFinalCardPrompt already
// computes inline as isGoalTopic/isSpecialDateFreeTitle/isAdCreativeFreeTitle
// — pulled out here as its own function so template lookup and prompt
// building never drift into disagreeing about what counts as which type.
function deriveCreativePostType(topic = {}) {
  if (topic.source === 'goal') return 'institutional';
  if (topic.source === 'special_date' && !topic.offerId) return 'special_date';
  if (topic.source === 'ad_creative' && !topic.offerId) return 'ad_creative';
  return 'offer';
}
```

In `buildPrimaryAiImageReferences`, replace the `storyCompatibleLayouts`/`layoutReferences` block (currently):

```js
  const storyCompatibleLayouts = selected.filter((reference) => (
    reference.role === 'layout_model'
    && (!isStory || !isSquareLikeReference(reference))
  ));
  // Rotate which single layout/inspiration reference gets used instead of
  // always the same array-order match — with several layout references
  // uploaded, every generation (even across separate test runs) was
  // otherwise anchored to whichever one happened to be first, which is a
  // big part of why repeated tests looked near-identical.
  const layoutReferences = pickRotatingReferenceList(storyCompatibleLayouts, options.variationSeed, 1);
```

with:

```js
  const postType = deriveCreativePostType(options.topic);
  const shape = creativeShapeGroupForChannel(options.channel);
  // A template is now mandatory, not a suggestion — an untagged legacy
  // layout_model reference (postType/shape both '') never counts as a
  // match, or generation would silently keep working exactly like before
  // this change for any project holding one, defeating the whole point.
  const matchingLayouts = selected.filter((reference) => (
    reference.role === 'layout_model'
    && (!isStory || !isSquareLikeReference(reference))
    && reference.postType === postType
    && reference.shape === shape
  ));
  if (!matchingLayouts.length) {
    throw new Error(`Nenhum modelo de criativo cadastrado para "${postType}" / "${shape || 'formato desconhecido'}" neste segmento — cadastre um modelo antes de gerar.`);
  }
  // Rotate which single layout reference gets used instead of always the
  // same array-order match — with several matching templates uploaded,
  // every generation (even across separate test runs) was otherwise
  // anchored to whichever one happened to be first.
  const layoutReferences = pickRotatingReferenceList(matchingLayouts, options.variationSeed, 1);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central.test.js`
Expected: PASS. Also re-run the full suite (`node --test tests/content-central.test.js tests/content-central-server.test.js`) — every existing test that generates a Story/Feed AI image for a project **without** a registered creative template will now fail with the new blocking error, since none of them registered one before this task. Fix each failure by adding a matching `saveLearningEntry(...)` call (same pattern as the second new test above) to that test's setup, choosing `postType`/`shape` to match the topic/channel under test. Do this file-by-file until `node --test tests/content-central.test.js tests/content-central-server.test.js` is green again — there is no shortcut here; every pre-existing AI-generation test needs its own template fixture now, because "no template = blocked" is the entire point of this task.

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js tests/content-central-server.test.js
git commit -m "feat(content-central): block AI creative generation when no matching template is registered for the topic's postType/shape"
```

---

### Task 4: layoutStrength is unconditionally strict once a template is found

**Files:**
- Modify: `src/content-central.js:5259-5270` (`buildCreativeSpec`)
- Test: `tests/content-central.test.js` — locate and rewrite the test added earlier this session for the `hasPriceOrCta`-gated conditional (search the test file for `hasPriceOrCta` or `institutional post with neither price nor CTA` in nearby test names before writing — it directly contradicts this task and must be replaced, not left alongside the new one)

**Interfaces:**
- Consumes: nothing new (still just `Boolean(layoutReference)`).
- Produces: `creativeSpec.layout.strength` is `'strict'` whenever `buildPrimaryAiImageReferences` selected a layout reference — which, after Task 3, is unconditionally true for any generation that didn't already throw.

- [ ] **Step 1: Write the failing test**

First, find and remove the existing test covering the `hasPriceOrCta` conditional gate (added earlier this session, before this plan) — search `tests/content-central.test.js` for a test whose name mentions an institutional/no-price/no-CTA topic keeping layout strength off `'strict'`, and delete that whole `test(...)` block. Then add:

```js
test('layoutStrength is strict whenever a matching creative template was found, even for a no-price/no-CTA institutional topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'strict-institucional', name: 'Strict Institucional', handle: '@strictinst', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('strict-institucional', {
      brandName: 'Strict Institucional', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'modelo-institucional.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'modelo', imagePath: analyzed.imagePath, purpose: 'creative', postType: 'institutional', shape: 'vertical' }, dir);

    const generatorCalls = [];
    await simulateTestPost('strict-institucional', {
      channel: 'instagram_story',
      goalKey: 'authority',
      imageGenerator: async (payload) => { generatorCalls.push(payload); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(generatorCalls[0].content.creativeSpec.layout.strength, 'strict');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central.test.js`
Expected: FAIL — current code still gates strict on `hasPriceOrCta`, which is `false` for this institutional/no-price/no-CTA topic, so strength comes back `'free'`.

- [ ] **Step 3: Write minimal implementation**

In `buildCreativeSpec` (content-central.js:5259), replace:

```js
  const cta = chooseCreativeCta(topic, targetChannel);
  const productTreatment = normalizeProductTreatment(topic.productTreatment, productReferences.length > 0);
  // A layout_model's zones (price selo in the base band, CTA in the
  // footer) are learned from approved OFFER cards. Forcing STRICT
  // adherence onto a topic with neither price nor CTA makes the model
  // cram title/benefit text into bands sized for elements that don't
  // exist here — the exact "benefit block invades the footer zone" defect
  // the reviewer kept flagging on institutional/goal posts. Only an offer
  // with a real price or CTA gets the strict zone lock by default.
  const hasPriceOrCta = Boolean(normalizeCreativePrice(topic.price)) || Boolean(cta);
  const layoutStrength = normalizeLayoutStrength(topic.layoutStrength, Boolean(layoutReference) && hasPriceOrCta);
```

with:

```js
  const cta = chooseCreativeCta(topic, targetChannel);
  const productTreatment = normalizeProductTreatment(topic.productTreatment, productReferences.length > 0);
  // A template is now mandatory (buildPrimaryAiImageReferences throws
  // before this function is ever called if none matched), so layoutReference
  // being present is no longer conditional on the topic having a price or
  // CTA — every generation that reaches here has an operator-authored
  // template it must follow exactly.
  const layoutStrength = normalizeLayoutStrength(topic.layoutStrength, Boolean(layoutReference));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/content-central.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): layout strength is always strict once a matching template is found, not gated on price/CTA"
```

---

### Task 5: Remove the AI-scored review/regeneration loop

**Files:**
- Modify: `src/content-central.js:5029-5166` (`generateAiImageWithReviewLoop`)
- Delete: `src/content-central.js` lines covering `normalizeCreativeAttemptLimit`, `appendCreativeReviewCorrections`, `appendCreativeRescueCorrections`, `shouldEnterStoryRescueMode`, `buildRescueImageReferences`, `CREATIVE_REVIEW_CODES`, `normalizeCreativeReviewCodes`, `shouldUseTargetedReviewRepair`, `formatCreativeReviewFeedback`, `mergeCreativeReview`, `contentHasOfficialLogoReference`, `reviewMentionsPlaceholderLogo`, `normalizeCreativeReview` (currently lines 5983-6027 and 6046-6239 — **keep** `appendAdCreativeFraming` at lines 6029-6044, sitting in between, untouched)
- Test: `tests/content-central.test.js`, `tests/content-central-server.test.js` — every test referencing attempt counts >1, rescue mode, review scores/thresholds, or `contentReview`/`creativeReview` status derived from a mocked `imageReviewer` needs deleting or rewriting

**Interfaces:**
- Consumes: nothing new.
- Produces: `generateAiImageWithReviewLoop` calls `options.imageGenerator` exactly once and never calls `options.imageReviewer`. `content.image.generationAttempts` is always `1`. `content.contentReview`/`content.creativeReview`/`content.creativeReviewAttempts` are never touched by this function (they retain whatever `buildContentReview` set upstream, unrelated to image quality).

- [ ] **Step 1: Write the failing test**

```js
test('generateAiImageWithReviewLoop (via generation) never calls imageReviewer and always generates exactly once', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-revisor', name: 'Sem Revisor', handle: '@semrevisor', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sem-revisor', {
      brandName: 'Sem Revisor', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('sem-revisor', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'modelo.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'modelo', imagePath: analyzed.imagePath, purpose: 'creative', postType: 'offer', shape: 'vertical' }, dir);

    const generatorCalls = [];
    let reviewerCalls = 0;
    await simulateTestPost('sem-revisor', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => { generatorCalls.push(payload); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
      imageReviewer: async () => { reviewerCalls += 1; return { status: 'blocked', errors: ['nunca deveria rodar'] }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(reviewerCalls, 0);
    assert.equal(generatorCalls.length, 1);
    assert.equal(generatorCalls[0].content.image.generationAttempts, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central.test.js`
Expected: FAIL — `reviewerCalls` is `1`, not `0` (current code still calls `options.imageReviewer`).

- [ ] **Step 3: Write minimal implementation**

Replace the entire body of `generateAiImageWithReviewLoop` (content-central.js:5029-5166) with:

```js
async function generateAiImageWithReviewLoop(content, project, projectId, options = {}) {
  const originalPrompt = content.image.prompt;
  const rawReferences = Array.isArray(content.image.references) ? [...content.image.references] : [];
  const baseReferences = buildPrimaryAiImageReferences(
    rawReferences,
    {
      channel: options.channel || content.channel,
      topic: content.contentTopic,
      variationSeed: content.publish?.variationSeed || content.contentId || '',
      allOffers: project.contentStrategy?.offers || [],
    }
  );
  content.creativeSpec = buildCreativeSpec(
    content,
    project,
    options.channel || content.channel,
    baseReferences
  );
  content.creativePreflight = buildCreativePreflight(content.contentTopic || {}, options.channel || content.channel, rawReferences, baseReferences);
  const basePrompt = options.promptFraming === 'ad_creative'
    ? appendAdCreativeFraming(buildChatGptFinalCardPrompt(content, project, originalPrompt, options.channel, baseReferences))
    : buildChatGptFinalCardPrompt(content, project, originalPrompt, options.channel, baseReferences);

  content.image.references = baseReferences;
  content.image.prompt = basePrompt;

  const generatedImage = await options.imageGenerator({
    content,
    projectId,
    note: options.note,
    channel: options.channel,
    targetedEdit: Boolean(options.targetedEdit),
    attempt: 1,
    maxAttempts: 1,
    rescueMode: false,
    reviewFeedback: '',
    previousReviews: [],
  });

  if (!generatedImage?.url) {
    // A generator that resolves without throwing but with no usable url
    // (empty object, provider quirk) used to silently fall through here —
    // the card kept its local SVG placeholder forever, generatedSource
    // never became 'ai', and the caller's try/catch never fired, so
    // imageGenerationError got set to null (success!) even though no real
    // image was ever generated. Throwing routes it through the same
    // caught-and-recorded error path a thrown generator already has.
    throw new Error('O gerador de imagem não retornou uma URL de imagem (resposta vazia ou inválida).');
  }

  content.image = {
    ...content.image,
    prompt: generatedImage.prompt || content.image.prompt,
    originalPrompt,
    generated: true,
    generatedSource: 'ai',
    generationStatus: 'ai_generated',
    generationAttempts: 1,
    mimeType: generatedImage.mimeType || 'image/png',
    url: generatedImage.url,
    previewUrl: generatedImage.url,
    previewMode: 'direct_ai_css_cover',
    previewFit: 'cover',
  };

  content.creativeGenerationManifest = [{
    attempt: 1,
    rescueMode: false,
    provider: generatedImage.provider || '',
    prompt: content.image.prompt,
    references: content.image.references.map((reference) => ({
      id: reference.id || '',
      role: reference.role || '',
      relativePath: reference.relativePath || '',
    })),
    resultUrl: generatedImage.url,
  }];
}
```

Then delete, in full, the twelve now-unreferenced functions/consts listed in this task's **Files** section — confirm each is truly unreferenced first with:

```bash
grep -n "normalizeCreativeAttemptLimit\|shouldEnterStoryRescueMode\|buildRescueImageReferences\|appendCreativeReviewCorrections\|appendCreativeRescueCorrections\|shouldUseTargetedReviewRepair\|formatCreativeReviewFeedback\|normalizeCreativeReviewCodes\|contentHasOfficialLogoReference\|reviewMentionsPlaceholderLogo\|normalizeCreativeReview\b\|mergeCreativeReview\|CREATIVE_REVIEW_CODES" src/content-central.js
```

Every remaining hit must be inside the block you are about to delete (its own definition) — if a hit shows up anywhere else, stop and investigate before deleting (something added after this plan was written started using one of them). Once confirmed, delete content-central.js lines 5983-6027 and 6046-6239 (leave `appendAdCreativeFraming`, lines 6029-6044, in place — it's still called by the `basePrompt` line above).

- [ ] **Step 4: Run tests, fix fallout, verify green**

Run: `node --test tests/content-central.test.js tests/content-central-server.test.js`

This will surface many failures beyond the one new test — every existing test asserting `generationAttempts > 1`, rescue-mode behavior, a blocked/warning `contentReview.status` coming from a mocked reviewer score, or a specific `creativeReviewAttempts` shape no longer applies. For each failure: if the test exists purely to cover now-removed behavior (attempt retries, threshold blocking, rescue mode, review-empty-response retry), delete the whole `test(...)` block. If the test also covers something still true (e.g. a Story/Feed CTA or logo-size prompt assertion bundled into the same test as a reviewer mock), keep the test but strip the now-irrelevant `imageReviewer` mock/assertions from it. Iterate until the full suite is green.

Also run: `npm run lint`
Fix any `no-unused-vars` this deletion surfaces (it shouldn't, if the grep in Step 3 came back clean, but confirm).

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js tests/content-central-server.test.js
git commit -m "refactor(content-central): remove the AI-scored review/regeneration loop, generate once and go straight to human approval"
```

---

### Task 6: Frontend — tag a creative-purpose upload with postType + shape

**Files:**
- Modify: `content-central-app/src/api/client.ts:182-197` (`SegmentLearningEntry` interface), `:828-830` (`saveLearningEntry` input type)
- Modify: `content-central-app/src/components/LearningGallery.tsx`
- Test: `content-central-app/src/components/LearningGallery.test.tsx` (create if it doesn't exist yet — check first)

**Interfaces:**
- Consumes: `saveLearningEntry` (existing client function, Task 1 already accepts the new fields server-side).
- Produces: nothing new consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing test (new file)**

`content-central-app/src/components/LearningGallery.test.tsx` does not exist yet (confirmed while writing this plan) — this step creates it. Mocking/rendering style below matches this project's established RTL pattern (`content-central-app/src/pages/workspace/Offers.test.tsx`): mock `@/api/client`, render with `@testing-library/react`, fire events with `@testing-library/user-event`.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LearningGallery } from "./LearningGallery";
import * as client from "@/api/client";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof client>("@/api/client");
  return {
    ...actual,
    analyzeLearningImage: vi.fn(),
    saveLearningEntry: vi.fn(),
    deleteLearningEntry: vi.fn(),
  };
});

describe("LearningGallery — creative template tagging", () => {
  it("shows postType and shape selects only for a creative-purpose pending image, and includes them in the save call", async () => {
    vi.mocked(client.analyzeLearningImage).mockResolvedValue({ imagePath: "segment/x/modelo.png", suggestedText: "modelo" });
    vi.mocked(client.saveLearningEntry).mockResolvedValue({ entries: [] });
    const user = userEvent.setup();

    render(
      <LearningGallery scope="segment" groupKey="group:x" entries={[]} onEntriesChange={() => {}} splitImagePurposes />
    );

    const file = new File(["x"], "modelo.png", { type: "image/png" });
    const creativeInput = screen.getByLabelText("Referência de estrutura de criativo") as HTMLInputElement;
    await user.upload(creativeInput, file);

    await waitFor(() => screen.getByLabelText("Tipo de post"));
    await user.selectOptions(screen.getByLabelText("Tipo de post"), "offer");
    await user.selectOptions(screen.getByLabelText("Formato"), "vertical");
    await user.click(screen.getByText("Confirmar"));

    await waitFor(() => {
      expect(client.saveLearningEntry).toHaveBeenCalledWith(
        expect.objectContaining({ postType: "offer", shape: "vertical" })
      );
    });
  });

  it("does not show postType/shape selects for a product-purpose pending image", async () => {
    vi.mocked(client.analyzeLearningImage).mockResolvedValue({ imagePath: "segment/x/produto.png", suggestedText: "produto" });
    const user = userEvent.setup();

    render(
      <LearningGallery scope="segment" groupKey="group:x" entries={[]} onEntriesChange={() => {}} splitImagePurposes />
    );

    const file = new File(["x"], "produto.png", { type: "image/png" });
    const productInput = screen.getByLabelText("Referência de produto") as HTMLInputElement;
    await user.upload(productInput, file);

    await waitFor(() => screen.getByText("Confirmar"));
    expect(screen.queryByLabelText("Tipo de post")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd content-central-app && npx vitest run src/components/LearningGallery.test.tsx`
Expected: FAIL — no "Tipo de post"/"Formato" labels exist yet.

- [ ] **Step 3: Write minimal implementation**

In `content-central-app/src/api/client.ts`, add to `SegmentLearningEntry` (after the `purpose` line, :188):

```ts
  purpose?: "product" | "creative";
  postType?: "offer" | "institutional" | "special_date" | "ad_creative";
  shape?: "vertical" | "feed";
```

And to `saveLearningEntry`'s input type (:829):

```ts
export function saveLearningEntry(
  input: { scope: "segment" | "offerType"; groupKey: string; bucket: "technical" | "approved" | "avoid"; kind: "text" | "image"; text: string; imagePath?: string; purpose?: "product" | "creative"; postType?: "offer" | "institutional" | "special_date" | "ad_creative"; shape?: "vertical" | "feed" },
): Promise<{ entries: SegmentLearningEntry[] }> {
```

In `content-central-app/src/components/LearningGallery.tsx`:

Add two new pieces of state right after `pendingImageText` (line 22):

```tsx
  const [pendingPostType, setPendingPostType] = useState<"offer" | "institutional" | "special_date" | "ad_creative" | "">("");
  const [pendingShape, setPendingShape] = useState<"vertical" | "feed" | "">("");
```

Update `handleConfirmImage` (lines 55-69) to send the two new fields and reset them, and `handleUploadImage`'s discard path — replace the whole function with:

```tsx
  async function handleConfirmImage() {
    if (!pendingImage) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveLearningEntry({
        scope, groupKey, bucket: "approved", kind: "image", text: pendingImageText, imagePath: pendingImage.imagePath, purpose: pendingImage.purpose,
        ...(pendingImage.purpose === "creative" ? { postType: pendingPostType || undefined, shape: pendingShape || undefined } : {}),
      });
      onEntriesChange(result.entries);
      setPendingImage(null);
      setPendingImageText("");
      setPendingPostType("");
      setPendingShape("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
```

Replace the discard button's `onClick` (line 151, currently `() => setPendingImage(null)`) with a handler that also clears the two new fields:

```tsx
            <Button variant="secondary" onClick={() => { setPendingImage(null); setPendingPostType(""); setPendingShape(""); }}>Descartar</Button>
```

Finally, add the two selects inside the `pendingImage` card (right after the `<textarea>` at line 148, before the button row), only when `pendingImage.purpose === "creative"`:

```tsx
          {pendingImage.purpose === "creative" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div>
                <label htmlFor="pending-post-type">Tipo de post</label>
                <select id="pending-post-type" value={pendingPostType} onChange={(e) => setPendingPostType(e.target.value as typeof pendingPostType)}>
                  <option value="">Selecione</option>
                  <option value="offer">Oferta</option>
                  <option value="institutional">Institucional</option>
                  <option value="special_date">Data comemorativa</option>
                  <option value="ad_creative">Anúncio pago</option>
                </select>
              </div>
              <div>
                <label htmlFor="pending-shape">Formato</label>
                <select id="pending-shape" value={pendingShape} onChange={(e) => setPendingShape(e.target.value as typeof pendingShape)}>
                  <option value="">Selecione</option>
                  <option value="vertical">Vertical (Stories/Reels)</option>
                  <option value="feed">Feed</option>
                </select>
              </div>
            </div>
          ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd content-central-app && npx vitest run src/components/LearningGallery.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite and commit**

Run: `cd content-central-app && npm test`
Expected: PASS (no other test references `LearningGallery`'s pendingImage internals directly, but confirm).

```bash
git add content-central-app/src/api/client.ts content-central-app/src/components/LearningGallery.tsx content-central-app/src/components/LearningGallery.test.tsx
git commit -m "feat(content-central-app): tag creative-purpose learning uploads with post type and shape"
```

---

## Final check

Run both full suites one more time from the repo root and from `content-central-app/`:

```bash
node --test tests/content-central.test.js tests/content-central-server.test.js
cd content-central-app && npm test && npm run lint
cd .. && npm run lint
```

All green before considering this plan done.
