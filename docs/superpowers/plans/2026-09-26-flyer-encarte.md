# Flyer / encarte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Flyer` tab where the operator picks up to 12 registered offers (individually or by group), a date and channels, and gets one multi-product "encarte" art per channel format sitting in Aguardando aprovação.

**Architecture:** The flyer is a one-off content item modeled on `generateSpecialDateContent` — outside the schedule rotation, with its own date and channel list, entering the existing approval queue. Every shared function it touches gets a branch at the top for flyer topics followed by the current body unchanged, so the scheduled-content path keeps byte-identical behavior. The three prompt changes an encarte needs (all product photos instead of 2, a product grid instead of one hero, literal prices) live only inside those branches.

**Tech Stack:** Node 20 ESM (`src/content-central.js`, `src/content-central-server.js`), `node --test` for backend tests, React 19 + React Router 7 + Vitest for `content-central-app`.

**Spec:** `docs/superpowers/specs/2026-09-26-flyer-encarte-design.md`

## Global Constraints

- Branch: `worktree-flyer-encarte`. Master stays untouched until the flyer is proven in practice.
- **No behavior change on the scheduled path.** Every edit to a shared function is an early-return/branch guarded on the flyer topic, with the existing body left exactly as-is. Each task that touches a shared function carries a non-regression test proving the non-flyer path still behaves as before.
- Hard cap: **12 products per flyer**, enforced in the endpoint and in the form. A number written inside a creative structure's title ("Encarte 12 produtos") is guidance to the model only — it never changes the cap.
- The flyer must not move `nextScheduleTopicIndex` or `nextPillarSequenceIndex`.
- Backend tests: `npm test` at the repo root (`node --test tests/*.test.js`). Frontend tests: `npm test` inside `content-central-app` (`vitest run`).
- Type errors only surface via `npm run build` in `content-central-app`; `tsc --noEmit` silently checks nothing in this repo.
- Prompt text, UI copy and error messages are in Brazilian Portuguese, matching the surrounding code. Code comments are in English, matching the surrounding code.
- `docs/` is in `.gitignore` but spec/plan files are tracked — add them with `git add -f`.

---

### Task 1: Register `flyer` as a creative post type

The operator must be able to tag an uploaded creative structure as "Flyer / encarte" in Aprendizado de segmento, and the generator must recognize that type. This is pure plumbing — no flyer generation exists yet after this task, but a structure can be registered and the type round-trips.

**Files:**
- Modify: `src/content-central.js:42` (`CREATIVE_TEMPLATE_REQUIRED_POST_TYPES`), `:5132` (`supportedPostTypes`), `:8007-8012` (`deriveCreativePostType`), `:8017-8031` (`CREATIVE_POST_TYPE_LABELS`)
- Modify: `content-central-app/src/api/client.ts:228`, `:1021` (postType unions)
- Modify: `content-central-app/src/components/LearningGallery.tsx:20-35` (`POST_TYPE_LABELS`)
- Test: `tests/content-central.test.js`

**Depends-on:** none

**Interfaces:**
- Produces: post type string literal `'flyer'`, accepted by `saveLearningEntry({ purpose: 'creative', postType: 'flyer' })` and returned by `deriveCreativePostType({ source: 'flyer' })`. Tasks 2-6 all rely on this exact spelling.

- [ ] **Step 1: Write the failing test**

Add to `tests/content-central.test.js`, next to the other creative-template tests:

```js
test('a creative structure can be registered as a flyer/encarte model, and a flyer topic resolves to that post type', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'mercado-flyer-tipo', name: 'Mercado Teste' }, dir);
    await updateProjectBrandInput('mercado-flyer-tipo', {
      segmentGroup: 'Negócios locais e lojas',
      segmentCategory: 'Mercado / mercearia',
    }, dir);

    // Registering a structure tagged "flyer" must be accepted by the
    // segment-learning store's post-type whitelist.
    await registerCreativeTemplate('group:negocios-locais-e-lojas/category:mercado-mercearia', 'flyer', 'feed', dir);
    const nodes = await getSegmentLearningNodes('Negócios locais e lojas', 'Mercado / mercearia', '', dir);
    const entries = nodes.nodes.flatMap((node) => node.entries || []);
    assert.ok(
      entries.some((entry) => entry.postType === 'flyer'),
      'a structure tagged flyer must survive normalization instead of being dropped by the post-type whitelist',
    );

    // A flyer topic must resolve to the flyer post type so the flyer
    // structure above is the one matched at generation time.
    assert.equal(deriveCreativePostType({ source: 'flyer', type: 'offer' }), 'flyer');
    // Non-flyer topics keep resolving exactly as before.
    assert.equal(deriveCreativePostType({ source: 'offer', type: 'combo' }), 'combo');
    assert.equal(deriveCreativePostType({ source: 'special_date' }), 'special_date');
  });
});
```

Add `deriveCreativePostType` and `getSegmentLearningNodes` to the import block at the top of `tests/content-central.test.js` if they are not already there. `deriveCreativePostType` is currently module-private — export it in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="flyer/encarte model"`
Expected: FAIL — `deriveCreativePostType is not a function` (not exported yet).

- [ ] **Step 3: Make the change**

In `src/content-central.js`, four edits:

```js
// :42 — a flyer without a registered layout model is exactly the failure
// mode this guard exists for: the whole point of an encarte is the grid
// the operator drew, so refuse to guess one.
const CREATIVE_TEMPLATE_REQUIRED_POST_TYPES = new Set(['offer', 'combo', 'rodizio', 'delivery', 'product', 'flyer']);
```

```js
// :5132
const supportedPostTypes = new Set([...OFFER_TYPES, 'special_date', 'ad_creative', 'flyer']);
```

```js
// :8007 — export it so tests can assert the mapping directly
export function deriveCreativePostType(topic = {}) {
  // A flyer is never one of the rotation's offer types even though it
  // carries real offers: it must match the operator's flyer/encarte
  // structure, not the single-product "Oferta direta" one.
  if (topic.source === 'flyer') return 'flyer';
  if (topic.source === 'goal') return topic.type === 'product' ? 'product' : 'institutional';
  if (topic.source === 'special_date' && !topic.offerId) return 'special_date';
  if (topic.source === 'ad_creative' && !topic.offerId) return 'ad_creative';
  return OFFER_TYPES.has(topic.type) ? topic.type : 'offer';
}
```

```js
// :8029 — inside CREATIVE_POST_TYPE_LABELS, after ad_creative
  ad_creative: 'Anúncio pago',
  flyer: 'Flyer / encarte',
};
```

In `content-central-app/src/api/client.ts`, add `| "flyer"` to the end of the postType union at both `:228` and `:1021`.

In `content-central-app/src/components/LearningGallery.tsx`, add to `POST_TYPE_LABELS` after `ad_creative` (note: this map deliberately uses unaccented labels, matching its neighbors):

```ts
  flyer: "Flyer / encarte",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="flyer/encarte model"`
Expected: PASS

Run: `npm test`
Expected: PASS, no regressions.

Run: `cd content-central-app && npm run build`
Expected: builds clean.

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js content-central-app/src/api/client.ts content-central-app/src/components/LearningGallery.tsx tests/content-central.test.js
git commit -m "feat(content-central): register flyer/encarte as a creative post type

A market's encarte needs its own layout model, distinct from the
single-product 'Oferta direta' structure. Adding the post type lets the
operator tag one in Aprendizado de segmento, and makes it mandatory for
flyer generation rather than silently falling back to a guess."
```

---

### Task 2: `generateFlyerContent` and its endpoint

Creates the content items: one per channel, sharing a creative across channels of the same pixel shape, with the full product list on the topic. The art itself is still produced by the unmodified prompt path at this point — Tasks 3-5 are what make it actually look like an encarte.

**Files:**
- Modify: `src/content-central.js` (new export `generateFlyerContent`, near `generateSpecialDateContent` at `:2045`)
- Modify: `src/content-central-server.js` (new route, near `generate-special-date` at `:1131`; add the import to the block at `:83`)
- Test: `tests/content-central.test.js`, `tests/content-central-server.test.js`

**Depends-on:** Task 1

**Interfaces:**
- Consumes: post type `'flyer'` from Task 1.
- Produces:
  - `generateFlyerContent(projectId, { offerIds: string[], date: string, channels?: string[], channel?: string, postTime?: string }, targetDir) => Promise<Batch>` — same batch shape `generateSpecialDateContent` returns (`{ batchId, projectId, createdAt, days, channel, startDate, items }`).
  - `contentTopic` shape for a flyer, which Tasks 3-5 branch on:
    ```js
    {
      id: 'flyer',
      source: 'flyer',          // the discriminator every later task checks
      type: 'offer',
      label: 'Flyer de ofertas',
      products: [{ offerId, name, price, priceUnit, photoReferenceIds }],
      photoReferenceIds: [...],  // union of every product's photos
      price: '', items: '', cta: '', autoGenerateCta: false, notes: '',
      objective: '...',
    }
    ```
  - Route `POST /api/projects/:projectId/generate-flyer`, body `{ offerIds, date, channels, postTime }`, responding `201 { batch }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/content-central.test.js`:

```js
test('generateFlyerContent creates one encarte item per channel shape, carrying every selected product, without touching the rotation', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'mercado-flyer', name: 'Mercado Teste' }, dir);
    await updateProjectBrandInput('mercado-flyer', {
      segmentGroup: 'Negócios locais e lojas',
      segmentCategory: 'Mercado / mercearia',
    }, dir);
    await registerCreativeTemplate('group:negocios-locais-e-lojas/category:mercado-mercearia', 'flyer', 'feed', dir);

    const arroz = (await saveProjectOffer('mercado-flyer', { name: 'Arroz 5kg', price: 'R$ 24,90', priceUnit: 'pacote' }, dir)).offer;
    const feijao = (await saveProjectOffer('mercado-flyer', { name: 'Feijão 1kg', price: 'R$ 8,49', priceUnit: 'kg' }, dir)).offer;

    // A normal batch first, so the rotation cursor sits at a real non-zero
    // position that the flyer must leave alone.
    await generateContentBatch('mercado-flyer', { days: 3, startDate: '2026-09-01', channel: 'instagram_feed' }, dir);
    const before = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'mercado-flyer');
    const cursorBefore = before.contentStrategy?.nextScheduleTopicIndex;

    const batch = await generateFlyerContent('mercado-flyer', {
      offerIds: [arroz.id, feijao.id],
      date: '2026-09-30',
      channels: ['instagram_feed', 'instagram_story'],
      postTime: '09:00',
    }, dir);

    assert.equal(batch.items.length, 2, 'one item per requested channel');
    const feed = batch.items.find((item) => item.channel === 'instagram_feed');
    const story = batch.items.find((item) => item.channel === 'instagram_story');

    assert.equal(feed.scheduledDate, '2026-09-30');
    assert.equal(feed.scheduledTime, '09:00');
    assert.equal(feed.status, 'draft_generated');
    assert.equal(feed.contentTopic.source, 'flyer');
    assert.deepEqual(
      feed.contentTopic.products.map((product) => product.name),
      ['Arroz 5kg', 'Feijão 1kg'],
      'every selected product travels on the topic, in selection order',
    );
    assert.equal(feed.contentTopic.products[0].price, 'R$ 24,90');
    assert.equal(feed.contentTopic.products[0].priceUnit, 'pacote');

    // Feed (1:1) and Story (9:16) are different pixel shapes, so they must
    // NOT share a creative — same rule the scheduled path follows.
    assert.notEqual(feed.creativeGroupKey, story.creativeGroupKey);

    const after = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'mercado-flyer');
    assert.equal(after.contentStrategy?.nextScheduleTopicIndex, cursorBefore, 'the flyer must not advance the rotation cursor');
  });
});

test('generateFlyerContent shares one creative between channels of the same pixel shape', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'mercado-flyer-shape', name: 'Mercado Teste' }, dir);
    await updateProjectBrandInput('mercado-flyer-shape', {
      segmentGroup: 'Negócios locais e lojas',
      segmentCategory: 'Mercado / mercearia',
    }, dir);
    await registerCreativeTemplate('group:negocios-locais-e-lojas/category:mercado-mercearia', 'flyer', 'vertical', dir);
    const arroz = (await saveProjectOffer('mercado-flyer-shape', { name: 'Arroz 5kg', price: 'R$ 24,90' }, dir)).offer;

    const batch = await generateFlyerContent('mercado-flyer-shape', {
      offerIds: [arroz.id],
      date: '2026-09-30',
      channels: ['instagram_story', 'whatsapp_status'],
    }, dir);

    assert.equal(batch.items.length, 2);
    assert.equal(
      batch.items[0].creativeGroupKey,
      batch.items[1].creativeGroupKey,
      'Story and WhatsApp Status are both 9:16 — one generated creative serves both',
    );
  });
});

test('generateFlyerContent rejects an empty selection and more than 12 products', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'mercado-flyer-limite', name: 'Mercado Teste' }, dir);
    const ids = [];
    for (let index = 0; index < 13; index += 1) {
      const offer = (await saveProjectOffer('mercado-flyer-limite', { name: `Produto ${index + 1}`, price: 'R$ 1,00' }, dir)).offer;
      ids.push(offer.id);
    }

    await assert.rejects(
      () => generateFlyerContent('mercado-flyer-limite', { offerIds: [], date: '2026-09-30' }, dir),
      /selecione ao menos um produto/i,
    );
    await assert.rejects(
      () => generateFlyerContent('mercado-flyer-limite', { offerIds: ids, date: '2026-09-30' }, dir),
      /no máximo 12/i,
    );
    await assert.rejects(
      () => generateFlyerContent('mercado-flyer-limite', { offerIds: [ids[0]], date: 'ontem' }, dir),
      /data inválida/i,
    );
  });
});
```

Add `generateFlyerContent` to the import block at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="generateFlyerContent"`
Expected: FAIL — `generateFlyerContent is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/content-central.js`, immediately after `generateSpecialDateContent` ends (after the closing of its `withProjectLock`, around `:2162`), add:

```js
const FLYER_BATCH_PREFIX = 'flyer';
const MAX_FLYER_PRODUCTS = 12;

// A market's "encarte": ONE piece carrying several registered products and
// their prices, generated on demand for a campaign date instead of coming
// out of the schedule rotation. Deliberately modeled on
// generateSpecialDateContent rather than generateContentBatch — same
// one-off shape (own date, own channel list, shared creative across
// same-shape channels, lands in Aguardando aprovação like any other card)
// and the same guarantee that it never reads or advances
// nextScheduleTopicIndex/nextPillarSequenceIndex.
//
// The difference that matters: the topic carries `products` — the full
// selected list — instead of a single offer. Everything downstream that
// needs to behave differently for an encarte branches on
// `topic.source === 'flyer'`; nothing about the scheduled path changes.
export async function generateFlyerContent(projectId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const globalRules = await loadGlobalRules(getCentralPaths(targetDir));
  const date = String(options.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.');

  const requestedIds = (Array.isArray(options.offerIds) ? options.offerIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (!requestedIds.length) throw new Error('Selecione ao menos um produto para o flyer.');
  if (requestedIds.length > MAX_FLYER_PRODUCTS) {
    throw new Error(`Um flyer comporta no máximo 12 produtos — foram selecionados ${requestedIds.length}.`);
  }

  const offersById = new Map(normalizeProjectOffers(project.contentStrategy?.offers || []).map((offer) => [offer.id, offer]));
  // Preserve the operator's selection order: it is the reading order they
  // expect on the grid, and the prompt numbers the slots from it.
  const products = requestedIds.map((id) => {
    const offer = offersById.get(id);
    if (!offer) throw new Error(`Produto não encontrado no projeto: ${id}`);
    return {
      offerId: offer.id,
      name: offer.name || '',
      price: offer.price || '',
      priceUnit: offer.priceUnit || '',
      photoReferenceIds: Array.isArray(offer.photoReferenceIds) ? offer.photoReferenceIds : [],
    };
  });

  const requestedChannels = Array.isArray(options.channels) && options.channels.length
    ? options.channels
    : [options.channel || project.contentSettings.channels[0] || DEFAULT_CHANNEL];
  const channels = [...new Set(requestedChannels)];
  const postTime = options.postTime || project.contentSettings.defaultPostTime || DEFAULT_TIME;

  const batchId = `${date}-${FLYER_BATCH_PREFIX}-${slugify(String(options.label || 'ofertas'))}`;
  const batchDir = join(paths.draftsDir, batchId);
  const imageDir = join(batchDir, 'images');
  await mkdir(batchDir, { recursive: true });
  await mkdir(imageDir, { recursive: true });

  const productNames = products.map((product) => product.name).filter(Boolean).join(', ');
  const baseContentTopic = {
    id: 'flyer',
    source: 'flyer',
    // Commercially this IS an offer piece — CTA, sales framing and pillar
    // handling should treat it as one. Only the post type (and therefore
    // which registered structure it matches) is flyer-specific.
    type: 'offer',
    label: 'Flyer de ofertas',
    offerName: '',
    products,
    // The union of every product's linked photos, so the existing
    // photo-linking machinery (buildPrimaryAiImageReferences) sees them all
    // as deliberately requested rather than pool guesses.
    photoReferenceIds: [...new Set(products.flatMap((product) => product.photoReferenceIds))],
    // Deliberately blank: a flyer has no single price or item list. The
    // per-product prices live on `products` and are rendered by the flyer
    // branch of the prompt builder (see buildFlyerProductFocus).
    price: '',
    items: '',
    cta: '',
    autoGenerateCta: false,
    notes: '',
    objective: `Encarte de ofertas de ${project.name} com os produtos: ${productNames}. Todos os produtos selecionados devem aparecer na peça, cada um com o seu preço exato.`,
  };
  const createdAt = new Date().toISOString();

  const items = [];
  for (const channel of channels) {
    const dimensions = imageDimensionsForChannel(channel);
    const aspectRatio = imageAspectRatioForChannel(channel);
    const contentId = `${project.projectId}-${date}-flyer-${channel}`;
    const contentTopic = withProductRotationSeed(baseContentTopic, contentId);
    const imageFileName = `day-01-${channel}.svg`;
    const filePath = join(batchDir, `day-01-${channel}.json`);
    const imageLocalPath = `content/drafts/${batchId}/images/${imageFileName}`;
    const shapeGroup = creativeShapeGroupForChannel(channel);
    const item = {
      schemaVersion: 1,
      contentId,
      projectId: project.projectId,
      batchId,
      dayNumber: 1,
      scheduledDate: date,
      scheduledTime: postTime,
      channel,
      formatLabel: CHANNEL_LABELS[channel] || channel,
      contentTopic,
      contentReview: buildContentReview({ channel, aspectRatio, dimensions, contentTopic }),
      status: 'draft_generated',
      title: `Encarte — ${project.name}`,
      // Same key shape the scheduled path and special dates use: one
      // creative per pixel shape, so Story + WhatsApp Status share an art
      // while Feed gets its own.
      creativeGroupKey: shapeGroup ? `${batchId}::${date}::${shapeGroup}::flyer` : null,
      image: {
        localPath: imageLocalPath,
        prompt: buildImagePrompt(project, globalRules.rules, [], 1, { channel, contentTopic, logoReference: getProjectLogoReference(project, paths) }),
        references: await buildImageReferencePayload(project, paths, { channel, topic: contentTopic }),
        aspectRatio,
        dimensions,
        generated: true,
        mimeType: 'image/svg+xml',
        version: 1,
      },
      caption: {
        text: buildCaptionDraft(project, 1, contentTopic),
        version: 1,
      },
      dayRules: [],
      generationContext: {
        globalRules: globalRules.rules.map((rule) => rule.text),
        projectRules: [...project.rules.project],
        contentRules: [],
      },
      approval: {
        required: project.mode !== 'automatic',
        emailSentAt: null,
        approvedAt: null,
        approvalSource: null,
      },
      publish: {
        publishedAt: null,
        metaMediaId: null,
        error: null,
      },
      filePath,
      createdAt,
      updatedAt: createdAt,
    };
    item.image.previewDataUrl = await writeGeneratedImage(join(imageDir, imageFileName), item, project);
    await writeJson(filePath, item);
    items.push(item);
  }

  const batch = {
    batchId,
    projectId: project.projectId,
    createdAt,
    days: 1,
    channel: channels[0],
    startDate: date,
    items,
  };
  await writeJson(join(batchDir, 'batch.json'), batch);
  return batch;
  });
}
```

In `src/content-central-server.js`, add `generateFlyerContent` to the import block at `:83` (alongside `generateSpecialDateContent`), and add the route right after the `generate-special-date` block (`:1152`):

```js
  // A market's encarte: one piece with several registered products and
  // their prices, for a campaign date — see generateFlyerContent. Same
  // fire-and-forget shape as generate-special-date above: create the draft
  // items, queue the real image generation, let the panel poll.
  if (parts.length === 4 && parts[3] === 'generate-flyer') {
    const body = await readBody(req);
    const imageOptions = { imageGenerator: context.imageGenerator, imageReviewer: context.imageReviewer, captionGenerator: context.captionGenerator, videoAnimator: context.videoAnimator };
    const batch = await generateFlyerContent(projectId, {
      offerIds: body.offerIds,
      date: body.date,
      channels: (body.channel || body.channels) ? normalizeChannels(body) : undefined,
      postTime: body.postTime,
    }, targetDir);
    enqueueBatchImageGeneration(projectId, batch, imageOptions, targetDir);
    return sendJson(res, 201, { batch });
  }
```

- [ ] **Step 4: Write the endpoint test**

Add to `tests/content-central-server.test.js`, following the shape of the existing `generate-special-date` test:

```js
test('POST generate-flyer creates encarte drafts for the selected products', async () => {
  await withServer(async ({ request, dir }) => {
    await createCentralProject({ projectId: 'mercado-http', name: 'Mercado Teste' }, dir);
    await updateProjectBrandInput('mercado-http', {
      segmentGroup: 'Negócios locais e lojas',
      segmentCategory: 'Mercado / mercearia',
    }, dir);
    const arroz = (await saveProjectOffer('mercado-http', { name: 'Arroz 5kg', price: 'R$ 24,90' }, dir)).offer;

    const created = await request('POST', '/api/projects/mercado-http/generate-flyer', {
      offerIds: [arroz.id],
      date: '2026-09-30',
      channels: ['instagram_feed'],
      postTime: '09:00',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.batch.items.length, 1);
    assert.equal(created.body.batch.items[0].contentTopic.source, 'flyer');
    assert.equal(created.body.batch.items[0].contentTopic.products[0].name, 'Arroz 5kg');

    const empty = await request('POST', '/api/projects/mercado-http/generate-flyer', {
      offerIds: [],
      date: '2026-09-30',
    });
    assert.equal(empty.status, 500);
  });
});
```

Match the helper names (`withServer`, `request`) to whatever the neighboring tests in that file already use — read one before writing this. If the file's error-path tests assert a status other than 500 for a thrown generator error, match that instead.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="generateFlyerContent"`
Expected: PASS

Run: `npm test -- --test-name-pattern="generate-flyer"`
Expected: PASS

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/content-central.js src/content-central-server.js tests/content-central.test.js tests/content-central-server.test.js
git commit -m "feat(content-central): generate a flyer/encarte from selected offers

Markets run campaigns on a date with a chosen set of products, which the
schedule rotation cannot express. generateFlyerContent mirrors
generateSpecialDateContent — one-off, own date, own channels, shared
creative per pixel shape, straight into Aguardando aprovação — but carries
the full product list on the topic instead of a single offer."
```

---

### Task 3: Send every selected product's photo, not two

Two separate `.slice(0, 2)` caps currently throttle product photos: one picking which references travel with the item, another picking which ones the prompt describes. A 12-product encarte needs all of them, each labeled with the product it belongs to — without the label the model attaches the wrong price to the wrong photo.

**Files:**
- Modify: `src/content-central.js:8081`, `:8095` (`buildPrimaryAiImageReferences`), `:7286` (inside `buildChatGptFinalCardPrompt`)
- Test: `tests/content-central.test.js`

**Depends-on:** Task 2

**Interfaces:**
- Consumes: `contentTopic.source === 'flyer'` and `contentTopic.products` from Task 2.
- Produces: no new exports. This task only raises two limits; the prompt text that names each product and price is Task 4's deliverable.

- [ ] **Step 1: Write the failing test**

```js
test('a flyer sends every selected product photo, each labeled with its own product and price — while a normal offer still caps at two', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'mercado-fotos', name: 'Mercado Teste' }, dir);
    await updateProjectBrandInput('mercado-fotos', {
      segmentGroup: 'Negócios locais e lojas',
      segmentCategory: 'Mercado / mercearia',
    }, dir);
    await registerCreativeTemplate('group:negocios-locais-e-lojas/category:mercado-mercearia', 'flyer', 'feed', dir);

    // Four real product photos, each linked to its own offer.
    const products = [
      { name: 'Arroz 5kg', price: 'R$ 24,90', unit: 'pacote' },
      { name: 'Feijão 1kg', price: 'R$ 8,49', unit: 'kg' },
      { name: 'Café 500g', price: 'R$ 17,90', unit: 'pacote' },
      { name: 'Açúcar 1kg', price: 'R$ 4,29', unit: 'kg' },
    ];
    const offerIds = [];
    for (const product of products) {
      const reference = await saveProjectReference('mercado-fotos', {
        filename: `${slugify(product.name)}.png`,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        role: 'product_photo',
      }, dir);
      const offer = (await saveProjectOffer('mercado-fotos', {
        name: product.name,
        price: product.price,
        priceUnit: product.unit,
        photoReferenceIds: [reference.reference.id],
      }, dir)).offer;
      offerIds.push(offer.id);
    }

    const batch = await generateFlyerContent('mercado-fotos', {
      offerIds,
      date: '2026-09-30',
      channels: ['instagram_feed'],
    }, dir);

    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'mercado-fotos');
    const paths = getCentralPaths(dir, 'mercado-fotos');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'mercado-fotos', {
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: 'https://cdn.example.com/encarte.png', mimeType: 'image/png' };
      },
    }, paths);

    const sentReferences = calls[0].content.image.references;
    const productPhotos = sentReferences.filter((reference) => reference.role === 'product_photo');
    assert.equal(productPhotos.length, 4, 'all four product photos must travel — the 2-photo cap is for single-hero pieces');

    // The prompt text that names each product next to its own price is
    // Task 4's job (buildFlyerProductFocus); this task only proves the
    // photos are no longer thrown away before they get there.
  });
});

test('a normal single-offer topic still caps product photos at two', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'oferta-normal-fotos', name: 'Boss Pizzaria' }, dir);
    await updateProjectBrandInput('oferta-normal-fotos', { brandName: 'Boss Pizzaria', segment: 'pizzaria' }, dir);
    const referenceIds = [];
    for (let index = 0; index < 4; index += 1) {
      const reference = await saveProjectReference('oferta-normal-fotos', {
        filename: `pizza-${index}.png`,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        role: 'product_photo',
      }, dir);
      referenceIds.push(reference.reference.id);
    }
    await saveProjectOffer('oferta-normal-fotos', {
      name: 'Pizza Grande',
      price: 'R$ 49,90',
      photoReferenceIds: referenceIds,
    }, dir);

    const batch = await generateContentBatch('oferta-normal-fotos', {
      days: 1,
      startDate: '2026-09-01',
      channel: 'instagram_feed',
    }, dir);

    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'oferta-normal-fotos');
    const paths = getCentralPaths(dir, 'oferta-normal-fotos');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'oferta-normal-fotos', {
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: 'https://cdn.example.com/pizza.png', mimeType: 'image/png' };
      },
    }, paths);

    const productPhotos = calls[0].content.image.references.filter((reference) => reference.role === 'product_photo');
    assert.ok(productPhotos.length <= 2, 'the scheduled path must keep its 2-photo cap — this is the non-regression guard');
  });
});
```

Check the real signature and return shape of the reference-upload helper before writing these (`saveProjectReference` vs whatever the neighboring reference tests call) and match it — several tests in this file already upload a `product_photo`, so copy one of those verbatim rather than inventing the call.

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npm test -- --test-name-pattern="every selected product photo"`
Expected: FAIL — only 2 product photos sent.

Run: `npm test -- --test-name-pattern="still caps product photos at two"`
Expected: PASS already (this is the guard that must never break).

- [ ] **Step 3: Write the implementation**

In `src/content-central.js`, in `buildPrimaryAiImageReferences` (`:8081` and `:8095`), replace the two hardcoded slices with a flyer-aware limit:

```js
  // A flyer is the one piece that legitimately needs every linked photo:
  // each product on the encarte grid shows its own. Single-hero pieces keep
  // the 2-photo cap that stops the prompt from fighting over protagonists.
  const productPhotoLimit = options.topic?.source === 'flyer' ? MAX_FLYER_PRODUCTS : 2;
  const linkedPhotos = linkedPhotoIds.size
    ? selected.filter((reference) => reference.role === 'product_photo' && linkedPhotoIds.has(reference.id)).slice(0, productPhotoLimit)
    : [];
```

and:

```js
  const productPhotos = linkedPhotos.length
    ? linkedPhotos
    : options.topic?.source === 'goal'
      ? []
      : prioritizeReferencesByTopic(productPool, topicFocus).slice(0, productPhotoLimit);
```

In `buildChatGptFinalCardPrompt` (`:7286`), the same treatment:

```js
  // Mirrors the limit in buildPrimaryAiImageReferences — a flyer describes
  // every product photo it was sent, everything else describes at most two.
  const productReferences = selectedReferences
    .filter((reference) => reference.role === 'product_photo')
    .slice(0, topic.source === 'flyer' ? MAX_FLYER_PRODUCTS : 2);
```

`MAX_FLYER_PRODUCTS` is declared in Task 2 near `generateFlyerContent`. If it sits below these functions in the file, move the `const` up to the module's other constants (near `CREATIVE_TEMPLATE_REQUIRED_POST_TYPES` at `:42`) so it is defined before use.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="product photo"`
Expected: both PASS.

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): send every product photo for a flyer, labeled per product

Two caps throttled product photos at two — correct for a single-hero
piece, wrong for a twelve-product encarte. Flyer topics now send every
linked photo, each carrying its own product name and exact price, because
unlabeled photos next to loose prices is how the model misprices items."
```

---

### Task 4: A product grid instead of one hero product

`detectCreativeProductFocus` picks one item out of a multi-item offer and instructs the model not to swap it — the opposite of what an encarte needs. Flyer topics get a grid brief: numbered slots, one product and one exact price each, all of them present, none promoted above the rest.

**Files:**
- Modify: `src/content-central.js:7802` (`detectCreativeProductFocus`), and the `PRODUTOS`/restriction sections it feeds inside `buildChatGptFinalCardPrompt`
- Test: `tests/content-central.test.js`

**Depends-on:** Task 3

**Interfaces:**
- Consumes: `flyerProductLabelFor` and the flyer topic shape from Tasks 2-3.
- Produces: `buildFlyerProductFocus(topic) => { heroLine, assetLines, visualLines, restrictionLines }` — the same four-field shape `detectCreativeProductFocus` already returns, so every consumer downstream is unchanged.

- [ ] **Step 1: Write the failing test**

```js
test('a flyer briefs the model as a product grid with literal prices, never as one hero product', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'mercado-grade', name: 'Mercado Teste' }, dir);
    await updateProjectBrandInput('mercado-grade', {
      segmentGroup: 'Negócios locais e lojas',
      segmentCategory: 'Mercado / mercearia',
    }, dir);
    await registerCreativeTemplate('group:negocios-locais-e-lojas/category:mercado-mercearia', 'flyer', 'feed', dir);

    const arroz = (await saveProjectOffer('mercado-grade', { name: 'Arroz 5kg', price: 'R$ 24,90', priceUnit: 'pacote' }, dir)).offer;
    const feijao = (await saveProjectOffer('mercado-grade', { name: 'Feijão 1kg', price: 'R$ 8,49', priceUnit: 'kg' }, dir)).offer;
    const cafe = (await saveProjectOffer('mercado-grade', { name: 'Café 500g', price: '', priceUnit: '' }, dir)).offer;

    const batch = await generateFlyerContent('mercado-grade', {
      offerIds: [arroz.id, feijao.id, cafe.id],
      date: '2026-09-30',
      channels: ['instagram_feed'],
    }, dir);

    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'mercado-grade');
    const paths = getCentralPaths(dir, 'mercado-grade');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'mercado-grade', {
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: 'https://cdn.example.com/encarte.png', mimeType: 'image/png' };
      },
    }, paths);
    const prompt = calls[0].content.image.prompt;

    // The grid, numbered in selection order.
    assert.match(prompt, /1\.\s*Arroz 5kg\s*—\s*R\$ 24,90/);
    assert.match(prompt, /2\.\s*Feijão 1kg\s*—\s*R\$ 8,49/);
    assert.match(prompt, /3\.\s*Café 500g/);

    // All present, none promoted.
    assert.match(prompt, /todos os 3 produtos/i, 'must state the exact count so a missing item is a visible failure');
    assert.match(prompt, /nenhum produto em destaque exclusivo/i);

    // Literal prices, and no invented one for the product without a price.
    assert.match(prompt, /exatamente como escrito/i);
    assert.match(prompt, /não arredondar/i);
    assert.match(prompt, /Café 500g.*sem preço cadastrado/is, 'a product with no price must be called out, not given an invented one');

    // The single-hero instruction must be absent.
    assert.doesNotMatch(prompt, /Não trocar .* por outro produto listado na oferta/i);
    assert.doesNotMatch(prompt, /como produto principal/i);
  });
});

test('a normal multi-item offer still gets the single-hero brief', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'oferta-heroi', name: 'Boss Pizzaria' }, dir);
    await updateProjectBrandInput('oferta-heroi', { brandName: 'Boss Pizzaria', segment: 'pizzaria' }, dir);
    await saveProjectOffer('oferta-heroi', {
      name: 'Combo',
      price: 'R$ 49,90',
      items: 'Pizza grande, refrigerante 2L',
    }, dir);

    const batch = await generateContentBatch('oferta-heroi', {
      days: 1,
      startDate: '2026-09-01',
      channel: 'instagram_feed',
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'oferta-heroi');
    const paths = getCentralPaths(dir, 'oferta-heroi');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'oferta-heroi', {
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: 'https://cdn.example.com/combo.png', mimeType: 'image/png' };
      },
    }, paths);

    assert.match(calls[0].content.image.prompt, /produto principal/i, 'the scheduled path must keep its hero-product brief — non-regression guard');
  });
});
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npm test -- --test-name-pattern="product grid with literal prices"`
Expected: FAIL — no grid lines in the prompt.

Run: `npm test -- --test-name-pattern="single-hero brief"`
Expected: PASS already.

- [ ] **Step 3: Write the implementation**

In `src/content-central.js`, add immediately before `detectCreativeProductFocus` (`:7802`):

```js
function flyerProducts(topic = {}) {
  return topic.source === 'flyer' && Array.isArray(topic.products) ? topic.products : [];
}

// An encarte is a grid, not a hero shot. Every selected product gets its
// own numbered slot with its own exact price; naming the total count makes
// a dropped product a visible failure rather than a silent one. Prices go
// in verbatim — a model that "tidies" R$ 8,49 into R$ 8,50 has published a
// wrong price in a market's window.
function buildFlyerProductFocus(topic = {}) {
  const products = flyerProducts(topic);
  const lines = products.map((product, index) => {
    const unit = product.priceUnit ? ` (${product.priceUnit})` : '';
    return product.price
      ? `${index + 1}. ${product.name} — ${product.price}${unit}`
      : `${index + 1}. ${product.name} — sem preço cadastrado: não exibir preço para este produto`;
  });
  const missingPrice = products.filter((product) => !product.price).map((product) => product.name);
  return {
    heroLine: `Encarte de ofertas em grade com todos os ${products.length} produtos abaixo, cada um com seu preço:\n${lines.join('\n')}`,
    assetLines: [
      'Cada produto da lista ocupa o seu próprio espaço na grade, com o nome e o preço legíveis ao lado ou abaixo dele.',
      'Usar a foto real anexada de cada produto no espaço correspondente a ele.',
    ],
    visualLines: [
      `A peça mostra todos os ${products.length} produtos da lista, nenhum produto em destaque exclusivo sobre os outros.`,
      'Composição de encarte: grade organizada, leitura rápida, preços com peso visual alto.',
    ],
    restrictionLines: [
      'Escrever cada preço exatamente como escrito na lista: não arredondar, não alterar centavos, não converter e não inventar preço.',
      'Não omitir nenhum produto da lista e não acrescentar produto que não esteja nela.',
      'Não associar o preço de um produto a outro produto.',
      missingPrice.length
        ? `Os seguintes produtos estão sem preço cadastrado e devem aparecer sem preço nenhum: ${missingPrice.join(', ')}.`
        : '',
    ].filter(Boolean),
  };
}
```

Then add the branch as the first statement of `detectCreativeProductFocus`:

```js
function detectCreativeProductFocus(topic = {}, hasLinkedProductPhoto = false, productTreatment = 'creative_redraw') {
  // A flyer has no protagonist by definition — every product on the grid
  // is equally the subject. The multi-product hero logic below would pick
  // one and instruct the model not to swap it, which is the exact opposite
  // of what an encarte needs.
  if (topic.source === 'flyer') return buildFlyerProductFocus(topic);
  const multiProduct = multiProductFocus(topic);
  // ... rest unchanged
```

Run the test and read the failure output: `heroLine` is consumed inside `buildChatGptFinalCardPrompt`'s `PRODUTOS` section, which may prefix it with `1. ` itself or otherwise reshape it. Adjust `heroLine` (dropping the leading numbering, or emitting the list through `assetLines` instead) until the asserted `1. Arroz 5kg — R$ 24,90` appears once and correctly in the built prompt. Do not change how non-flyer focuses are rendered.

Also confirm `buildCreativeQuantityRules` (`:7887`) is inert for a flyer: it reads `detectOfferQuantity(topic)`, and a flyer topic has no `items` string, so it should return the empty shape. If it fires (producing pizza/esfiha combo wording), add the same `topic.source === 'flyer'` early return there, returning its empty shape.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="product grid with literal prices"`
Expected: PASS

Run: `npm test -- --test-name-pattern="single-hero brief"`
Expected: PASS

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): brief a flyer as a product grid, not a hero product

detectCreativeProductFocus picks one item out of a multi-item offer and
tells the model not to swap it. For an encarte that is backwards: every
product is equally the subject. Flyer topics get numbered slots, one exact
price each, an explicit product count so a dropped item is visible, and a
literal-price rule — a model that tidies R$ 8,49 into R$ 8,50 has printed
a wrong price in a market's window."
```

---

### Task 5: Flag missing prices and photos before generation

The operator should see, on the card itself, that three of the twelve products have no price and two have no photo — rather than discovering it in the generated art. Mirrors `buildCatalogContentReview`, and feeds the review/warning surface the approval screen already renders.

**Files:**
- Modify: `src/content-central.js` (new `buildFlyerContentReview` near `buildCatalogContentReview` at `:3780`; branch inside `buildContentReview`)
- Test: `tests/content-central.test.js`

**Depends-on:** Task 4

**Interfaces:**
- Consumes: the flyer topic shape from Task 2.
- Produces: `buildFlyerContentReview({ contentTopic }) => { status: 'ok' | 'warning', checks: string[], warnings: string[] }`, returned by `buildContentReview` when the topic is a flyer.

- [ ] **Step 1: Write the failing test**

```js
test('a flyer item warns about products missing a price or a photo, and passes clean when all are complete', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'mercado-review', name: 'Mercado Teste' }, dir);
    await updateProjectBrandInput('mercado-review', {
      segmentGroup: 'Negócios locais e lojas',
      segmentCategory: 'Mercado / mercearia',
    }, dir);
    await registerCreativeTemplate('group:negocios-locais-e-lojas/category:mercado-mercearia', 'flyer', 'feed', dir);

    const photo = await saveProjectReference('mercado-review', {
      filename: 'arroz.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      role: 'product_photo',
    }, dir);
    const completo = (await saveProjectOffer('mercado-review', {
      name: 'Arroz 5kg', price: 'R$ 24,90', photoReferenceIds: [photo.reference.id],
    }, dir)).offer;
    const semPreco = (await saveProjectOffer('mercado-review', { name: 'Feijão 1kg', price: '' }, dir)).offer;

    const comProblema = await generateFlyerContent('mercado-review', {
      offerIds: [completo.id, semPreco.id],
      date: '2026-09-30',
      channels: ['instagram_feed'],
    }, dir);
    const review = comProblema.items[0].contentReview;
    assert.equal(review.status, 'warning');
    assert.ok(review.warnings.some((warning) => /Feijão 1kg/.test(warning) && /preço/i.test(warning)));
    assert.ok(review.warnings.some((warning) => /Feijão 1kg/.test(warning) && /foto/i.test(warning)));
    assert.ok(review.checks.some((check) => /2 produto/.test(check)));

    const limpo = await generateFlyerContent('mercado-review', {
      offerIds: [completo.id],
      date: '2026-10-01',
      channels: ['instagram_feed'],
    }, dir);
    assert.equal(limpo.items[0].contentReview.status, 'ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="warns about products missing a price"`
Expected: FAIL — the review is the generic one, with no per-product warnings.

- [ ] **Step 3: Write the implementation**

In `src/content-central.js`, next to `buildCatalogContentReview` (`:3780`):

```js
// The operator's last chance to notice that three of the twelve products
// have no price before the art comes back wrong. Scoped to what an encarte
// can actually get wrong — no CTA/pillar/type checks, since a flyer has a
// product list rather than a single offer.
function buildFlyerContentReview({ contentTopic }) {
  const products = Array.isArray(contentTopic?.products) ? contentTopic.products : [];
  const checks = [`${products.length} produto(s) selecionado(s) para o encarte.`];
  const warnings = [];
  const semPreco = products.filter((product) => !product.price).map((product) => product.name);
  const semFoto = products.filter((product) => !(product.photoReferenceIds || []).length).map((product) => product.name);
  if (semPreco.length) warnings.push(`Sem preço cadastrado: ${semPreco.join(', ')} — a peça sai sem preço para esse(s) produto(s).`);
  else checks.push('Todos os produtos com preço cadastrado.');
  if (semFoto.length) warnings.push(`Sem foto cadastrada: ${semFoto.join(', ')} — o produto será desenhado a partir do nome.`);
  else checks.push('Todos os produtos com foto real anexada.');
  return { status: warnings.length ? 'warning' : 'ok', checks, warnings };
}
```

Add the branch as the first statement of `buildContentReview`:

```js
function buildContentReview({ channel, aspectRatio, dimensions, contentTopic }) {
  if (contentTopic?.source === 'flyer') return buildFlyerContentReview({ contentTopic });
  // ... rest unchanged
```

Read `buildContentReview`'s real signature and return shape before editing — if it returns extra fields (channel/dimension metadata) that the approval screen depends on, spread them into the flyer review rather than dropping them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="warns about products missing a price"`
Expected: PASS

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): review a flyer for products missing price or photo

Twelve products is enough that a missing price is easy to overlook until
it comes back in the art. The flyer review names the incomplete products
on the card itself, the same way the catalog review already does."
```

---

### Task 6: Teach the visual reviewer to check every product and price

The AI reviewer that inspects the finished art currently verifies one `Preço autorizado` against the piece. On an encarte there are up to twelve prices, and a single wrong one is exactly the failure this whole feature has to survive. The reviewer gets the full product list and a blocking rule per product.

**Files:**
- Modify: `src/content-central-server.js:3640-3705` (`buildAiImageReviewPrompt` — the "Dados obrigatórios do card" block and the blocking list)
- Test: `tests/content-central-server.test.js`

**Depends-on:** Task 5

**Interfaces:**
- Consumes: the flyer topic shape from Task 2.
- Produces: no new exports — `buildAiImageReviewPrompt` is already exported and its signature is unchanged.

- [ ] **Step 1: Write the failing test**

```js
test('the visual reviewer gets every flyer product and price, and blocks on any of them being wrong or missing', () => {
  const prompt = buildAiImageReviewPrompt({
    project: { name: 'Mercado Teste' },
    content: {
      channel: 'instagram_feed',
      formatLabel: 'Instagram Feed',
      image: { url: 'https://cdn.example.com/encarte.png' },
      contentTopic: {
        source: 'flyer',
        type: 'offer',
        label: 'Flyer de ofertas',
        price: '',
        items: '',
        products: [
          { offerId: 'a', name: 'Arroz 5kg', price: 'R$ 24,90', priceUnit: 'pacote', photoReferenceIds: [] },
          { offerId: 'b', name: 'Feijão 1kg', price: 'R$ 8,49', priceUnit: 'kg', photoReferenceIds: [] },
        ],
      },
    },
  });

  assert.match(prompt, /Arroz 5kg\s*—\s*R\$ 24,90/);
  assert.match(prompt, /Feijão 1kg\s*—\s*R\$ 8,49/);
  assert.match(prompt, /2 produtos/, 'the reviewer must know the expected count to notice a dropped product');
  assert.match(prompt, /preço diferente do preço autorizado para aquele produto/i);
  assert.match(prompt, /produto da lista que não apareça/i);
  assert.match(prompt, /produto que não esteja na lista/i);
});

test('a non-flyer card keeps the single authorized price line', () => {
  const prompt = buildAiImageReviewPrompt({
    project: { name: 'Boss Pizzaria' },
    content: {
      channel: 'instagram_feed',
      formatLabel: 'Instagram Feed',
      image: { url: 'https://cdn.example.com/pizza.png' },
      contentTopic: { source: 'offer', type: 'combo', offerName: 'Combo', price: 'R$ 49,90', items: 'Pizza, refrigerante' },
    },
  });
  assert.match(prompt, /Preço autorizado: R\$ 49,90/);
  assert.doesNotMatch(prompt, /produtos do encarte/i, 'the flyer block must not leak into normal cards');
});
```

Add `buildAiImageReviewPrompt` to the test file's import block if it is not already there. Before writing, call the function once with a minimal non-flyer fixture and read the output — if it needs more of `content`/`spec` than shown above to run, extend both fixtures equally rather than special-casing the flyer one.

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npm test -- --test-name-pattern="visual reviewer gets every flyer product"`
Expected: FAIL — no product list in the prompt.

Run: `npm test -- --test-name-pattern="keeps the single authorized price line"`
Expected: PASS already.

- [ ] **Step 3: Write the implementation**

In `src/content-central-server.js`, inside `buildAiImageReviewPrompt`, before the returned array, derive the flyer block:

```js
  // An encarte carries up to twelve prices; the single "Preço autorizado"
  // line below can only verify one. Hand the reviewer the whole list, so a
  // wrong price on product 7 is a block rather than an approval.
  const flyerProducts = expected?.source === 'flyer' && Array.isArray(expected.products) ? expected.products : [];
  const flyerProductLines = flyerProducts.map((product, index) => {
    const unit = product.priceUnit ? ` (${product.priceUnit})` : '';
    return product.price
      ? `${index + 1}. ${product.name} — ${product.price}${unit}`
      : `${index + 1}. ${product.name} — sem preço autorizado: não pode aparecer preço nenhum para este produto`;
  });
```

Then, in the "Dados obrigatórios do card" block, replace the three single-offer lines with flyer-aware versions (keeping the existing wording exactly for every non-flyer card):

```js
    flyerProducts.length
      ? `Produtos do encarte (${flyerProducts.length} produtos, todos obrigatórios):\n${flyerProductLines.join('\n')}`
      : `Título/oferta autorizada: ${expected.offerName || 'não definido'}`,
    flyerProducts.length ? '' : `Preço autorizado: ${expected.price || 'não definido'}`,
    flyerProducts.length ? '' : `Itens autorizados: ${expected.items || 'não definidos'}`,
```

And in the blocking list, add three flyer-only lines (empty strings for every other card, which the surrounding `.filter(Boolean)` already drops — confirm that filter exists before relying on it):

```js
    flyerProducts.length ? '- preço diferente do preço autorizado para aquele produto específico da lista;' : '',
    flyerProducts.length ? `- qualquer produto da lista que não apareça visualmente na peça — os ${flyerProducts.length} produtos precisam estar todos presentes;` : '',
    flyerProducts.length ? '- qualquer produto que não esteja na lista aparecendo na peça;' : '',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="visual reviewer"`
Expected: PASS

Run: `npm test -- --test-name-pattern="keeps the single authorized price line"`
Expected: PASS

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat(content-central): review every flyer product and price, not one

The visual reviewer verified a single authorized price. An encarte has up
to twelve, and one wrong price is the failure this feature most has to
survive, so the reviewer now gets the full list, the expected count, and a
blocking rule for a wrong, missing or invented product."
```

---

### Task 7: The Flyer tab

The operator-facing half: pick a group or individual offers (capped at 12), channels, date and time; generate; watch the list of generated flyers.

**Files:**
- Create: `content-central-app/src/pages/workspace/Flyer.tsx`, `content-central-app/src/pages/workspace/Flyer.module.css`, `content-central-app/src/pages/workspace/Flyer.test.tsx`
- Modify: `content-central-app/src/api/client.ts` (add `generateFlyer`), `content-central-app/src/App.tsx:58` (route), `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx:25` (nav)

**Depends-on:** Task 2

**Interfaces:**
- Consumes: `POST /api/projects/:projectId/generate-flyer` from Task 2.
- Produces: `generateFlyer(projectId, { offerIds, date, channels, postTime }) => Promise<{ batch: { items: ContentItem[] } }>` in `client.ts`.

- [ ] **Step 1: Write the failing test**

Create `content-central-app/src/pages/workspace/Flyer.test.tsx`. Open `Carousels.test.tsx` first and copy its render harness verbatim — the `useOutletContext` mock, the `fetch` stubbing helper and the `WorkspaceContext` fixture — then write:

```tsx
test("selects a whole offer group and posts the flyer request", async () => {
  // project fixture: two groups, four offers, two of them in "Encarte da semana"
  renderPage();
  await screen.findByText("Encarte da semana");

  await userEvent.click(screen.getByLabelText("Encarte da semana"));
  expect(screen.getByText("2 de 12 produtos selecionados")).toBeInTheDocument();

  await userEvent.click(screen.getByLabelText("Instagram Feed"));
  await userEvent.type(screen.getByLabelText("Data de publicação"), "2026-09-30");
  await userEvent.click(screen.getByRole("button", { name: "Gerar flyer" }));

  const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/generate-flyer"));
  expect(request).toBeDefined();
  const body = JSON.parse(String(request![1]?.body));
  expect(body.offerIds).toEqual(["offer-1", "offer-2"]);
  expect(body.channels).toEqual(["instagram_feed"]);
  expect(body.date).toBe("2026-09-30");
});

test("refuses more than 12 products", async () => {
  // project fixture: 13 individual offers, none grouped
  renderPage();
  for (const offer of await screen.findAllByRole("checkbox", { name: /^Produto / })) {
    await userEvent.click(offer);
  }
  expect(screen.getByText("12 de 12 produtos selecionados")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Gerar flyer" })).toBeEnabled();
  // the 13th click was refused, not silently accepted
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(12);
});

test("requires at least one product and one channel before generating", async () => {
  renderPage();
  await screen.findByText("0 de 12 produtos selecionados");
  expect(screen.getByRole("button", { name: "Gerar flyer" })).toBeDisabled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd content-central-app && npm test -- Flyer`
Expected: FAIL — module `./Flyer` not found.

- [ ] **Step 3: Add the API client function**

In `content-central-app/src/api/client.ts`, next to the other one-off generators:

```ts
export function generateFlyer(
  projectId: string,
  input: { offerIds: string[]; date: string; channels: string[]; postTime?: string },
): Promise<{ batch: { items: ContentItem[] } }> {
  return api(`/api/projects/${projectId}/generate-flyer`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

Match the surrounding functions' exact style (some use a different helper or path prefix) — read two neighbors before writing this.

- [ ] **Step 4: Write the page**

Create `content-central-app/src/pages/workspace/Flyer.tsx`. Read `Carousels.tsx` first and match its imports, error handling and `Card`/`Button`/`EmptyState` usage; the selection logic below is the part that is specific to this page.

```tsx
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { CHANNEL_LABELS, generateFlyer } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import styles from "./Flyer.module.css";

const MAX_FLYER_PRODUCTS = 12;

export function Flyer() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [selected, setSelected] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [postTime, setPostTime] = useState(project.contentSettings?.defaultPostTime || "09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const offers = useMemo(
    () => (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false),
    [project],
  );
  const groups = project.contentStrategy?.offerGroups || [];
  const full = selected.length >= MAX_FLYER_PRODUCTS;

  // A group checkbox is a bulk toggle over its own offers, nothing more —
  // the request always travels as an explicit offerIds list, so a group
  // edited later never silently changes a flyer already generated.
  function toggleGroup(groupId: string) {
    const ids = offers.filter((offer) => offer.groupId === groupId).map((offer) => offer.id);
    const allIn = ids.every((id) => selected.includes(id));
    setSelected((current) => {
      if (allIn) return current.filter((id) => !ids.includes(id));
      const merged = [...current];
      for (const id of ids) {
        if (!merged.includes(id) && merged.length < MAX_FLYER_PRODUCTS) merged.push(id);
      }
      return merged;
    });
  }

  function toggleOffer(offerId: string) {
    setSelected((current) => {
      if (current.includes(offerId)) return current.filter((id) => id !== offerId);
      if (current.length >= MAX_FLYER_PRODUCTS) return current;
      return [...current, offerId];
    });
  }

  function toggleChannel(channel: string) {
    setChannels((current) => (
      current.includes(channel) ? current.filter((entry) => entry !== channel) : [...current, channel]
    ));
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      await generateFlyer(project.projectId, { offerIds: selected, date, channels, postTime });
      setDone(true);
      setSelected([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canGenerate = selected.length > 0 && channels.length > 0 && Boolean(date) && !busy;

  return (
    <div>
      <h1 style={{ margin: "0 0 var(--space-2xs)" }}>Flyer</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Monte um encarte com até 12 produtos já cadastrados em Ofertas. Ele vai direto para Aguardando aprovação.
      </p>

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <h2>Produtos</h2>
        <p className={styles.counter}>{selected.length} de {MAX_FLYER_PRODUCTS} produtos selecionados</p>

        {groups.map((group) => {
          const ids = offers.filter((offer) => offer.groupId === group.id).map((offer) => offer.id);
          return (
            <label key={group.id} className={styles.group}>
              <input
                type="checkbox"
                checked={ids.length > 0 && ids.every((id) => selected.includes(id))}
                onChange={() => toggleGroup(group.id)}
              />
              {group.name}
            </label>
          );
        })}

        {offers.map((offer) => (
          <label key={offer.id} className={styles.offer}>
            <input
              type="checkbox"
              checked={selected.includes(offer.id)}
              disabled={full && !selected.includes(offer.id)}
              onChange={() => toggleOffer(offer.id)}
            />
            <span>{offer.name}</span>
            <span className="muted">
              {offer.price || "sem preço"}
              {offer.priceUnit ? ` / ${offer.priceUnit}` : ""}
              {(offer.photoReferenceIds || []).length ? "" : " · sem foto"}
            </span>
          </label>
        ))}
      </Card>

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <h2>Publicação</h2>
        {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
          <label key={value} className={styles.channel}>
            <input type="checkbox" checked={channels.includes(value)} onChange={() => toggleChannel(value)} />
            {label}
          </label>
        ))}
        <label htmlFor="flyer-date">Data de publicação</label>
        <input id="flyer-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <label htmlFor="flyer-time">Horário</label>
        <input id="flyer-time" type="time" value={postTime} onChange={(event) => setPostTime(event.target.value)} />
      </Card>

      {error ? <p className="error">{error}</p> : null}
      {done ? <p className="muted">Flyer gerado. Ele está em Aguardando aprovação.</p> : null}
      <Button onClick={handleGenerate} disabled={!canGenerate}>
        {busy ? "Gerando..." : "Gerar flyer"}
      </Button>
    </div>
  );
}
```

`CHANNEL_LABELS` may not be exported from `client.ts` yet — check, and export the existing map rather than duplicating it here. If the workspace context does not carry `contentSettings`, drop the `postTime` default to a literal `"09:00"`.

Create `Flyer.module.css` with `.counter`, `.group`, `.offer` and `.channel`, following `Carousels.module.css` for spacing tokens and label layout.

The list of already-generated flyers is deliberately left out of this task: `PendingApproval` already shows them, and a second list is only worth building once the generate flow has been used for real.

- [ ] **Step 5: Wire the route and the nav**

In `content-central-app/src/App.tsx`, after the `carrossel` route at `:58`:

```tsx
          <Route path="flyer" element={<Flyer />} />
```

plus the import at the top of the file, matching the surrounding import style.

In `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`, after the `carrossel` entry at `:25`:

```tsx
  { to: "flyer", label: "Flyer", group: "Conteúdo" },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd content-central-app && npm test -- Flyer`
Expected: PASS

Run: `cd content-central-app && npm test`
Expected: PASS, no regressions.

Run: `cd content-central-app && npm run build`
Expected: builds clean.

- [ ] **Step 7: Commit**

```bash
git add content-central-app/src/pages/workspace/Flyer.tsx content-central-app/src/pages/workspace/Flyer.module.css content-central-app/src/pages/workspace/Flyer.test.tsx content-central-app/src/api/client.ts content-central-app/src/App.tsx content-central-app/src/layouts/ProjectWorkspaceLayout.tsx
git commit -m "feat(content-central-app): add the Flyer tab

Pick a whole offer group or individual products (capped at 12), channels,
date and time; generate; the encarte lands in Aguardando aprovação. The
cap disables further checkboxes rather than dropping the extra silently."
```

---

## Wave plan

Per `.claude/rules/parallel-subagent-driven-development.md`, tasks share a wave only when their `Files` sets are disjoint and neither is in the other's `Depends-on` chain.

- **Wave 1:** Task 1
- **Wave 2:** Task 2
- **Wave 3:** Task 3 and Task 7 together — Task 3 is backend-only (`src/content-central.js`), Task 7 is frontend-only (`content-central-app/**`), and both depend only on work already landed. Disjoint files, no shared dependency.
- **Wave 4:** Task 4
- **Wave 5:** Task 5
- **Wave 6:** Task 6

Tasks 3, 4 and 5 all modify `src/content-central.js`, so they never share a wave. The controller commits each task's changes itself; implementers leave their work in the tree.

---

## Manual verification

After Task 7, with the server running against a scratch project:

1. Register a creative structure in Aprendizado de segmento under `Negócios locais e lojas / Mercado / mercearia`, tagged "Flyer / encarte", shape Feed, titled e.g. "Encarte 12 produtos, grade 4x3".
2. Register 8-12 offers with real prices, units and photos, all in one group.
3. Open the Flyer tab, select the group, pick Instagram Feed + WhatsApp Status, set a date, generate.
4. Confirm two items appear in Aguardando aprovação — one 1:1, one 9:16 — each showing every selected product with its correct price.
5. Note how many products and prices the model actually got right. That number is the input to the plan-B decision in the spec's risk section.

Record the result; if prices are wrong often enough to be unusable, the HTML-render path in the spec's risk section is the next move, and nothing built here is discarded.
