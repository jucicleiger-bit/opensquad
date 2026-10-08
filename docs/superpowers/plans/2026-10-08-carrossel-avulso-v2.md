# Carrossel avulso v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the standalone Carrossel tab. The theme can come from a registered offer/assunto or from trending subjects. The look is clean by default. The operator plans first (adjusting by message) and only then generates images. A finished carousel can be scheduled already approved and is published by a new carousel-only sweep on the PC.

**Architecture:**

- `runCarouselGeneration` (`src/content-central.js`) splits into a roteiro half (`applyCarouselOutline`) and an image half (`generateCarouselSlideImages`). The automatic calendar path still calls the whole thing; the standalone tab calls the halves through new plan/replan/generate steps.
- Offer data and the clean style ride on the slide `contentTopic` as `offerId`/`photoReferenceIds`/`productTreatment` and `carouselStyle: 'clean'`. Every new prompt line is gated on those fields, so the batch carousel's prompts stay byte-for-byte the same.
- `scheduleCarousel` writes a normal approved batch item, the same shape the automatic carousel uses.
- `runDuePublishSweep` gets an `itemFilter` so a carousel-only scheduler can publish it.

**Tech Stack:** Node 20 ESM (`node:test`, `node:assert/strict`), React 18 + Vite + Vitest + Testing Library (`content-central-app/`).

**Spec:** `docs/superpowers/specs/2026-10-08-carrossel-avulso-ofertas-agendar-design.md`

## Global Constraints

- **Workspace:** all work happens in worktree `.claude/worktrees/carrossel-v2` (branch `worktree-carrossel-v2`). Never edit the main checkout, never touch port 3333, never merge to master. Merging is the operator's call after they test on the bench.
- **Git:** use PowerShell for git inside the worktree; Bash git is refused there. Files under `docs/` need `git add -f`.
- **Backend tests:** always run targeted, flag before file:
  `node --test --test-name-pattern="<pattern>" tests/<file>.test.js`.
  Never `npm test -- --test-name-pattern` (it silently runs the whole 2.5-min suite). Only the controller runs the full suite.
- **Frontend:** `npm test` inside `content-central-app` (vitest). Type errors only show via `npm run build` there, never `tsc --noEmit`.
- **Isolation rules:**
  - The automatic calendar carousel must behave exactly as today: every existing batch-carousel test passes unmodified.
  - New prompt text appears only when `carouselStyle`, `offer`, or `currentPlan`/`request` are passed.
  - No change to single-image posts, flyer, ad creatives, stories, WhatsApp, or gaveta code.
- **Slide topics:**
  - They keep `source: 'carousel'` and `type: 'institutional'`. Never copy an offer's `type`: it would require an offer template and attach the "Oferta direta" structure.
  - Never copy `offerName`/`price` onto a slide topic: they become every slide's "Título exato" and exact price.
- **Publish sweep:** the carousel-only sweep starts only when `OPENSQUAD_ENABLE_REAL_PUBLISHING === 'true'` AND `OPENSQUAD_AUTO_PUBLISH_SCHEDULER === 'false'`.
- **Copy:** user-facing strings are Brazilian Portuguese, exactly as written in this plan.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Waves

Tasks 1–5 all touch `src/content-central.js` and/or its test file, so they run serially. Task 6 (frontend) only touches `content-central-app/`, and its Files set is disjoint from Task 5. It depends only on the API contract, which is written into this plan, so it may run in the same wave as Task 5. Task 7 is last.

| Wave | Tasks |
|------|-------|
| 1 | Task 1 |
| 2 | Task 2 |
| 3 | Task 3 |
| 4 | Task 4 |
| 5 | Task 5, Task 6 |
| 6 | Task 7 |

## Before you start (controller)

- [ ] Create the worktree from current master:

```powershell
git worktree add .claude/worktrees/carrossel-v2 -b worktree-carrossel-v2 master
cd .claude/worktrees/carrossel-v2
npm install
cd content-central-app; npm install; cd ..
```

- [ ] Baseline: in the worktree, run the existing carousel tests and confirm they pass before any change:

```powershell
node --test --test-name-pattern="arousel|carrossel" tests/content-central.test.js
node --test --test-name-pattern="arousel|carrossel" tests/content-central-server.test.js
```

Expected: all pass.

---

### Task 1: Split the carousel engine into roteiro and image halves (no behavior change)

**Files:**
- Modify: `src/content-central.js` (`runCarouselGeneration`, currently ~lines 3219–3300)

**Interfaces:**
- Consumes: nothing new.
- Produces (internal, not exported):
  - `applyCarouselOutline(carousel, project, options, overrides = {}) => Promise<boolean>`
    - fills `format`/`slides[].role`/`slideText`/`contentTopic`
    - returns `false` without touching slides when the outline is missing or the wrong size
    - may set `carousel.outlineGenerationError` when the generator throws
  - `generateCarouselSlideImages(carousel, project, projectId, options, paths) => Promise<void>`: slide 1 alone first, then the rest with slide 1 as the style reference.
  - `runCarouselGeneration` keeps its exact signature and behavior.

- [ ] **Step 1: Replace `runCarouselGeneration` with the three functions below**

Replace the whole current `runCarouselGeneration` function (from the comment `// Full pipeline for a freshly created carousel:` through its closing `}`) with:

```js
// Roteiro half: asks the outline generator for one text per slide and fills
// slideText/role/contentTopic in place. Returns false — leaving the slides
// untouched — when the outline is missing or the wrong size, so each caller
// decides what a failure means: the one-shot pipeline marks every slide
// errored, the standalone planning step keeps the previous plan.
async function applyCarouselOutline(carousel, project, options, overrides = {}) {
  const briefing = overrides.briefing ?? carousel.briefing;
  const slideCount = overrides.slideCount ?? carousel.slideCount;
  // A standalone Carousel's own .format field IS the roteiro's visual style.
  // A batch item overloads that same field name as its 'carousel' vs
  // 'single' discriminator (reconcile, approval rendering and publish all
  // branch on it), so the batch caller passes an override that parks the
  // style in carouselFormat and never touches .format — otherwise the item
  // would sit on disk as format:"listicle" for the whole multi-minute
  // generation window and a crash mid-run would leave it stuck forever.
  const setFormat = overrides.setFormat || ((c, style) => { c.format = style; });
  let outline = null;
  if (typeof options.outlineGenerator === 'function') {
    try {
      outline = await options.outlineGenerator({ project, briefing, slideCount });
    } catch (err) {
      carousel.outlineGenerationError = err.message;
    }
  }
  if (!(outline && Array.isArray(outline.slides) && outline.slides.length === slideCount)) return false;

  setFormat(carousel, outline.format || '');
  carousel.slides.forEach((slide, index) => {
    const outlineSlide = outline.slides[index];
    slide.role = outlineSlide.role || 'content';
    slide.slideText = outlineSlide.slideText || '';
    slide.contentTopic = buildCarouselSlideContentTopic({
      project,
      order: slide.order,
      slideCount,
      slideText: slide.slideText,
    });
  });
  return true;
}

// Image half. Slide 1 goes first, alone — every other slide then gets its
// finished image as a real reference file (not just a prompt instruction),
// so the template/palette/typography actually repeats instead of each slide
// being its own independent roll of the dice. options.resolveCarouselStyleReference
// is optional and best-effort: no AI images configured, provider doesn't
// expose a local file, or slide 1 itself failed all resolve to null and
// the rest of the carousel still generates fine, just back to
// prompt-only consistency (see the "MESMO template" line in
// buildCarouselSlideContentTopic).
async function generateCarouselSlideImages(carousel, project, projectId, options, paths) {
  const [firstSlide, ...restSlides] = carousel.slides;
  if (firstSlide) {
    await enrichCarouselSlideWithRealImage(carousel, firstSlide, project, projectId, paths, options);
  }
  const styleReferencePath = typeof options.resolveCarouselStyleReference === 'function' && firstSlide
    ? await options.resolveCarouselStyleReference(firstSlide).catch(() => null)
    : null;

  await mapWithConcurrency(restSlides, BATCH_IMAGE_CONCURRENCY, (slide) => (
    enrichCarouselSlideWithRealImage(carousel, slide, project, projectId, paths, options, styleReferencePath)
  ));
}

// Full one-shot pipeline (automatic calendar carousel, and the legacy
// enqueueCarouselGeneration): roteiro, then 1 real image per slide. All
// workers share the same in-memory `carousel` object (mutating different
// slides[i]) — every writeJson call serializes the current full object, so
// concurrent writes are safe (no partial file, last write always reflects
// the freshest combined state).
async function runCarouselGeneration(carousel, project, projectId, options, paths, overrides = {}) {
  const markReady = overrides.markReady || ((c) => { c.status = 'ready'; });
  const outlineOk = await applyCarouselOutline(carousel, project, options, overrides);
  if (!outlineOk) {
    if (!carousel.outlineGenerationError) {
      carousel.outlineGenerationError = 'O roteirista de IA não retornou um roteiro válido para este carrossel (resposta vazia ou incompleta). Apague e gere de novo para tentar outra vez.';
    }
    for (const slide of carousel.slides) {
      slide.image.generating = false;
      slide.imageGenerationError = carousel.outlineGenerationError;
    }
    markReady(carousel);
    carousel.updatedAt = new Date().toISOString();
    await writeJson(carousel.filePath, carousel);
    return;
  }
  carousel.updatedAt = new Date().toISOString();
  await writeJson(carousel.filePath, carousel);

  await generateCarouselSlideImages(carousel, project, projectId, options, paths);

  markReady(carousel);
  carousel.updatedAt = new Date().toISOString();
  await writeJson(carousel.filePath, carousel);
}
```

- [ ] **Step 2: Run the carousel tests and verify nothing changed**

```powershell
node --test --test-name-pattern="arousel|carrossel" tests/content-central.test.js
node --test --test-name-pattern="arousel|carrossel" tests/content-central-server.test.js
```

Expected: the same tests pass as at baseline. This is a pure refactor, so no new test is needed.

- [ ] **Step 3: Commit**

```powershell
git add src/content-central.js
git commit -m @'
refactor(content-central): split the carousel pipeline into roteiro and image halves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 2: Plan → adjust by message → generate images (engine)

**Files:**
- Modify: `src/content-central.js`
  - `buildCarouselSlideSkeleton`, `generateCarousel`, `applyCarouselOutline`
  - new functions after `enqueueCarouselGeneration`
  - `reconcileInterruptedGenerations`
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `applyCarouselOutline`, `generateCarouselSlideImages` (Task 1).
- Produces (exported from `src/content-central.js`):
  - `enqueueCarouselPlanning(projectId, carouselId, options = {}, targetDir = process.cwd(), { request = '' } = {}) => void`. Fire-and-forget. `options.outlineGenerator` is required for a plan to come back. It ends with `status: 'plan_ready'` and either a plan or `planError`.
  - `requestCarouselReplan(projectId, carouselId, message, targetDir = process.cwd()) => Promise<{ carousel, request: string }>`
    - throws `err.code === 'CAROUSEL_CONFLICT'` unless `status === 'plan_ready'`
    - throws `'Escreva o que mudar no plano.'` when a plan exists and the message is blank
    - `request` is `''` when there is no plan yet, which means a fresh plan
  - `startCarouselImageGeneration(projectId, carouselId, targetDir = process.cwd()) => Promise<carousel>`. Throws `CAROUSEL_CONFLICT` unless `plan_ready` with every slide's `slideText` filled.
  - `enqueueCarouselImageGeneration(projectId, carouselId, options = {}, targetDir = process.cwd()) => void`. Fire-and-forget. It ends with `status: 'ready'`.
- Produces (internal):
  - `readCarousel(paths, carouselId) => Promise<carousel>`
  - `carouselHasPlan(carousel) => boolean`
  - `carouselConflict(message) => Error`
- New carousel fields: `planMessages: [{ text, at }]`, `planError: string | null`.
- New statuses: `'planning' | 'plan_ready'`.
- `generateCarousel` now returns `status: 'planning'` with every slide `image.generating: false`.
- Outline generator payload on replan only: `{ project, briefing, slideCount, currentPlan: { format, slides: [{ role, slideText }] }, request }`.

- [ ] **Step 1: Write the failing tests**

Add the four new function names to the existing `import { ... } from '../src/content-central.js'` list at the top of `tests/content-central.test.js`: `enqueueCarouselPlanning`, `requestCarouselReplan`, `startCarouselImageGeneration`, `enqueueCarouselImageGeneration`.

Update the existing test `'generateCarousel creates a placeholder carousel with N generating slides, no image/roteiro yet'`: rename it and change only the status and generating assertions, as below.

```js
test('generateCarousel creates a carousel waiting for its plan: N empty slides, nothing generating yet', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-base', name: 'Boss Pizzaria' }, dir);

    const carousel = await generateCarousel('carrossel-base', { briefing: '5 dicas de pizza', slideCount: 5 }, dir);

    assert.equal(carousel.slideCount, 5);
    assert.equal(carousel.slides.length, 5);
    assert.equal(carousel.status, 'planning');
    assert.equal(carousel.format, '');
    assert.equal(carousel.outlineGenerationError, null);
    assert.equal(carousel.planError, null);
    assert.deepEqual(carousel.planMessages, []);
    carousel.slides.forEach((slide, index) => {
      assert.equal(slide.order, index + 1);
      assert.equal(slide.channel, 'instagram_feed');
      assert.equal(slide.image.generating, false);
      assert.deepEqual(slide.image.dimensions, { width: 1080, height: 1350 });
      assert.equal(slide.contentTopic, null);
      assert.equal(slide.slideText, '');
    });
  });
});
```

Append this block after the test `'regenerateCarouselSlide and enqueueCarouselSlideRegeneration replace only the target slide\'s image'`:

```js
// Polls disk until `done(carousel)` holds — every planning/generation step
// below is fire-and-forget, same as the rest of this file's carousel tests.
async function waitForCarousel(projectId, carouselId, dir, done) {
  let carousel;
  for (let i = 0; i < 100; i += 1) {
    carousel = (await listCarousels(projectId, dir)).find((entry) => entry.carouselId === carouselId);
    if (carousel && done(carousel)) return carousel;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return carousel;
}

function fakeOutline(texts, format = 'listicle') {
  return { format, slides: texts.map((slideText, index) => ({ role: index === 0 ? 'cover' : 'content', slideText })) };
}

test('enqueueCarouselPlanning fills the plan without generating any image', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-plano', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-plano', { briefing: 'Pizza de sexta', slideCount: 2 }, dir);
    let imageCalls = 0;

    enqueueCarouselPlanning('carrossel-plano', carousel.carouselId, {
      outlineGenerator: async () => fakeOutline(['Sexta é dia de pizza', 'Peça pelo WhatsApp']),
      imageGenerator: async () => { imageCalls += 1; return { url: 'https://cdn.example.com/x.png' }; },
    }, dir);

    const planned = await waitForCarousel('carrossel-plano', carousel.carouselId, dir, (c) => c.status === 'plan_ready');
    assert.equal(planned.status, 'plan_ready');
    assert.equal(planned.format, 'listicle');
    assert.deepEqual(planned.slides.map((s) => s.slideText), ['Sexta é dia de pizza', 'Peça pelo WhatsApp']);
    assert.equal(planned.planError, null);
    planned.slides.forEach((slide) => {
      assert.equal(slide.image.generating, false);
      assert.equal(slide.image.url, undefined);
      assert.ok(slide.contentTopic);
    });
    assert.equal(imageCalls, 0, 'planning must never generate an image');
  });
});

test('requestCarouselReplan + enqueueCarouselPlanning send the current plan and the request, and can change the slide count', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-ajuste', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-ajuste', { briefing: 'Pizza de sexta', slideCount: 2 }, dir);
    enqueueCarouselPlanning('carrossel-ajuste', carousel.carouselId, {
      outlineGenerator: async () => fakeOutline(['Capa', 'CTA']),
    }, dir);
    await waitForCarousel('carrossel-ajuste', carousel.carouselId, dir, (c) => c.status === 'plan_ready');

    const { carousel: pending, request } = await requestCarouselReplan('carrossel-ajuste', carousel.carouselId, 'faz com 3 slides e fala da entrega', dir);
    assert.equal(pending.status, 'planning');
    assert.equal(request, 'faz com 3 slides e fala da entrega');
    assert.equal(pending.planMessages.length, 1);
    assert.equal(pending.planMessages[0].text, 'faz com 3 slides e fala da entrega');

    let received;
    enqueueCarouselPlanning('carrossel-ajuste', carousel.carouselId, {
      outlineGenerator: async (payload) => { received = payload; return fakeOutline(['Capa', 'Entrega em 30 min', 'CTA']); },
    }, dir, { request });

    const replanned = await waitForCarousel('carrossel-ajuste', carousel.carouselId, dir, (c) => c.status === 'plan_ready');
    assert.equal(received.request, 'faz com 3 slides e fala da entrega');
    assert.deepEqual(received.currentPlan.slides.map((s) => s.slideText), ['Capa', 'CTA']);
    assert.equal(replanned.slideCount, 3);
    assert.deepEqual(replanned.slides.map((s) => s.slideText), ['Capa', 'Entrega em 30 min', 'CTA']);
    assert.deepEqual(replanned.slides.map((s) => s.order), [1, 2, 3]);
  });
});

test('a failed replan keeps the previous plan and sets planError', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-ajuste-falho', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-ajuste-falho', { briefing: 'teste', slideCount: 2 }, dir);
    enqueueCarouselPlanning('carrossel-ajuste-falho', carousel.carouselId, {
      outlineGenerator: async () => fakeOutline(['Capa', 'CTA']),
    }, dir);
    await waitForCarousel('carrossel-ajuste-falho', carousel.carouselId, dir, (c) => c.status === 'plan_ready');

    const { request } = await requestCarouselReplan('carrossel-ajuste-falho', carousel.carouselId, 'muda tudo', dir);
    enqueueCarouselPlanning('carrossel-ajuste-falho', carousel.carouselId, {
      outlineGenerator: async () => { throw new Error('timeout'); },
    }, dir, { request });

    const after = await waitForCarousel('carrossel-ajuste-falho', carousel.carouselId, dir, (c) => c.status === 'plan_ready');
    assert.deepEqual(after.slides.map((s) => s.slideText), ['Capa', 'CTA']);
    assert.equal(after.planError, 'Não consegui ajustar o plano, tente de novo.');
    assert.equal(after.outlineGenerationError, null);
  });
});

test('a failed first plan lands in plan_ready with planError and empty slides, and a retry with no message plans fresh', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-plano-falho', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-plano-falho', { briefing: 'teste', slideCount: 2 }, dir);
    enqueueCarouselPlanning('carrossel-plano-falho', carousel.carouselId, { outlineGenerator: async () => null }, dir);
    const failed = await waitForCarousel('carrossel-plano-falho', carousel.carouselId, dir, (c) => c.status === 'plan_ready');
    assert.equal(failed.planError, 'Não consegui montar o plano, tente de novo.');
    assert.ok(failed.slides.every((s) => !s.slideText));

    const { request } = await requestCarouselReplan('carrossel-plano-falho', carousel.carouselId, '', dir);
    assert.equal(request, '', 'no plan yet: a retry is a fresh plan, not an adjustment');
    let received;
    enqueueCarouselPlanning('carrossel-plano-falho', carousel.carouselId, {
      outlineGenerator: async (payload) => { received = payload; return fakeOutline(['Capa', 'CTA']); },
    }, dir, { request });
    const planned = await waitForCarousel('carrossel-plano-falho', carousel.carouselId, dir, (c) => c.status === 'plan_ready' && !c.planError);
    assert.equal(received.currentPlan, undefined);
    assert.deepEqual(planned.slides.map((s) => s.slideText), ['Capa', 'CTA']);
  });
});

test('requestCarouselReplan refuses a carousel that is not in plan_ready, and a blank message when a plan exists', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-ajuste-recusa', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-ajuste-recusa', { briefing: 'teste', slideCount: 2 }, dir);
    await assert.rejects(
      () => requestCarouselReplan('carrossel-ajuste-recusa', carousel.carouselId, 'muda', dir),
      (err) => err.code === 'CAROUSEL_CONFLICT',
    );
    enqueueCarouselPlanning('carrossel-ajuste-recusa', carousel.carouselId, { outlineGenerator: async () => fakeOutline(['Capa', 'CTA']) }, dir);
    await waitForCarousel('carrossel-ajuste-recusa', carousel.carouselId, dir, (c) => c.status === 'plan_ready');
    await assert.rejects(
      () => requestCarouselReplan('carrossel-ajuste-recusa', carousel.carouselId, '   ', dir),
      /Escreva o que mudar no plano/,
    );
  });
});

test('startCarouselImageGeneration + enqueueCarouselImageGeneration generate images from the approved plan', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-imagens', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-imagens', { briefing: 'teste', slideCount: 2 }, dir);
    await assert.rejects(
      () => startCarouselImageGeneration('carrossel-imagens', carousel.carouselId, dir),
      (err) => err.code === 'CAROUSEL_CONFLICT',
      'no plan yet',
    );
    enqueueCarouselPlanning('carrossel-imagens', carousel.carouselId, { outlineGenerator: async () => fakeOutline(['Capa do plano', 'CTA do plano']) }, dir);
    await waitForCarousel('carrossel-imagens', carousel.carouselId, dir, (c) => c.status === 'plan_ready');

    const started = await startCarouselImageGeneration('carrossel-imagens', carousel.carouselId, dir);
    assert.equal(started.status, 'generating');
    started.slides.forEach((slide) => assert.equal(slide.image.generating, true));

    const objectives = [];
    enqueueCarouselImageGeneration('carrossel-imagens', carousel.carouselId, {
      imageGenerator: async (payload) => { objectives.push(payload.content.contentTopic.objective); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
    }, dir);

    const ready = await waitForCarousel('carrossel-imagens', carousel.carouselId, dir, (c) => c.status === 'ready');
    assert.equal(ready.status, 'ready');
    ready.slides.forEach((slide) => {
      assert.equal(slide.image.generating, false);
      assert.equal(slide.image.url, 'https://cdn.example.com/x.png');
    });
    assert.ok(objectives.some((text) => text.includes('Capa do plano')));
    assert.ok(objectives.some((text) => text.includes('CTA do plano')));
  });
});

test('reconcileInterruptedGenerations turns a carousel stuck in planning into plan_ready with a retry message', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-plano-travado', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-plano-travado', { briefing: 'teste', slideCount: 2 }, dir);

    await reconcileInterruptedGenerations(dir);

    const reloaded = JSON.parse(await readFile(carousel.filePath, 'utf-8'));
    assert.equal(reloaded.status, 'plan_ready');
    assert.match(reloaded.planError, /interrompido/);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```powershell
node --test --test-name-pattern="plan|ajuste|imagens|planning" tests/content-central.test.js
```

Expected: FAIL. The new functions are not exported yet (`SyntaxError: ... does not provide an export named 'enqueueCarouselPlanning'`), which fails the whole file.

- [ ] **Step 3: Implement**

In `src/content-central.js`:

(a) `buildCarouselSlideSkeleton` gets a `generating` option. Replace its signature and the `generating: true,` line:

```js
function buildCarouselSlideSkeleton(carouselId, order, { generating = true } = {}) {
```

and inside `image: { ... }`:

```js
      generating,
```

(b) In `generateCarousel`, replace the `carousel` object literal with:

```js
    const carousel = {
      schemaVersion: 1,
      carouselId,
      projectId: project.projectId,
      briefing,
      format: '',
      slideCount,
      // Standalone carousels plan first: nothing generates until the
      // operator approves the plan (startCarouselImageGeneration).
      slides: Array.from({ length: slideCount }, (_, index) => buildCarouselSlideSkeleton(carouselId, index + 1, { generating: false })),
      planMessages: [],
      planError: null,
      outlineGenerationError: null,
      status: 'planning',
      createdAt,
      updatedAt: createdAt,
      filePath,
    };
```

(c) In `applyCarouselOutline` (Task 1), support replanning: an optional `currentPlan`/`request` sent to the generator, and a slide count that may change. Replace the block starting at `let outline = null;` up to and including `setFormat(carousel, outline.format || '');` with:

```js
  // Only a replan adds keys to the generator payload — the batch path and a
  // first plan send exactly { project, briefing, slideCount }, as before.
  const replanning = Boolean(overrides.currentPlan);
  let outline = null;
  if (typeof options.outlineGenerator === 'function') {
    try {
      outline = await options.outlineGenerator({
        project,
        briefing,
        slideCount,
        ...(replanning ? { currentPlan: overrides.currentPlan, request: overrides.request } : {}),
      });
    } catch (err) {
      carousel.outlineGenerationError = err.message;
    }
  }
  const size = Array.isArray(outline?.slides) ? outline.slides.length : 0;
  // A replan may change the count ("faz com 6 slides"); a first plan and the
  // batch path must return exactly what was asked.
  const sizeOk = replanning
    ? size >= CAROUSEL_SLIDE_COUNT_MIN && size <= CAROUSEL_SLIDE_COUNT_MAX
    : size === slideCount;
  if (!sizeOk) return false;
  if (size !== carousel.slides.length) {
    carousel.slides = Array.from({ length: size }, (_, index) => buildCarouselSlideSkeleton(carousel.carouselId, index + 1, { generating: false }));
    carousel.slideCount = size;
  }

  setFormat(carousel, outline.format || '');
```

and, in the `forEach` right below, change `slideCount,` to `slideCount: size,`.

(d) Add after `enqueueCarouselGeneration`:

```js
const CAROUSEL_PLAN_ERROR = 'Não consegui montar o plano, tente de novo.';
const CAROUSEL_REPLAN_ERROR = 'Não consegui ajustar o plano, tente de novo.';

function carouselConflict(message) {
  const err = new Error(message);
  err.code = 'CAROUSEL_CONFLICT';
  return err;
}

function carouselHasPlan(carousel) {
  return carousel.slides.length > 0 && carousel.slides.every((slide) => slide.slideText);
}

async function readCarousel(paths, carouselId) {
  const safeId = String(carouselId || '').replace(/[\\/]/g, '');
  if (!safeId) throw new Error('ID do carrossel inválido.');
  return readJson(join(paths.carouselsDir, `${safeId}.json`));
}

// Roteiro only — the standalone tab's "Planejar"/"Ajustar". A failure never
// loses work: the previous plan stays and planError says to try again.
async function runCarouselPlanning(carousel, project, options, overrides = {}) {
  const previous = { slides: carousel.slides, slideCount: carousel.slideCount, format: carousel.format };
  const planned = await applyCarouselOutline(carousel, project, options, overrides);
  if (planned) {
    carousel.planError = null;
  } else {
    Object.assign(carousel, previous);
    carousel.planError = overrides.currentPlan ? CAROUSEL_REPLAN_ERROR : CAROUSEL_PLAN_ERROR;
  }
  carousel.outlineGenerationError = null;
  carousel.status = 'plan_ready';
  carousel.updatedAt = new Date().toISOString();
  await writeJson(carousel.filePath, carousel);
}

// Fire-and-forget, same as enqueueCarouselGeneration. `request` non-empty
// means "adjust the current plan"; empty means "plan from the briefing".
export function enqueueCarouselPlanning(projectId, carouselId, options = {}, targetDir = process.cwd(), { request = '' } = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  Promise.all([loadProject(paths), readCarousel(paths, carouselId)])
    .then(([project, carousel]) => runCarouselPlanning(carousel, project, options, request
      ? {
        currentPlan: { format: carousel.format, slides: carousel.slides.map(({ role, slideText }) => ({ role, slideText })) },
        request,
      }
      : {}))
    .catch((err) => {
      console.error(`[content-central] background carousel planning failed for ${projectId}/${carouselId}:`, err.message);
    });
}

// "Ajustar" / "Tentar de novo". With no plan yet (a failed first plan) the
// message is only logged and the plan is rebuilt from the briefing.
export async function requestCarouselReplan(projectId, carouselId, message, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const carousel = await readCarousel(paths, carouselId);
    if (carousel.status !== 'plan_ready') throw carouselConflict('O plano só pode ser ajustado antes de gerar as imagens.');
    const text = String(message || '').trim();
    const hasPlan = carouselHasPlan(carousel);
    if (hasPlan && !text) throw new Error('Escreva o que mudar no plano.');
    if (text) carousel.planMessages = [...(carousel.planMessages || []), { text, at: new Date().toISOString() }];
    carousel.status = 'planning';
    carousel.planError = null;
    carousel.updatedAt = new Date().toISOString();
    await writeJson(carousel.filePath, carousel);
    return { carousel, request: hasPlan ? text : '' };
  });
}

// "Gerar imagens". A planError left by a failed adjust does not block this:
// the previous plan is intact.
export async function startCarouselImageGeneration(projectId, carouselId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const carousel = await readCarousel(paths, carouselId);
    if (carousel.status !== 'plan_ready' || !carouselHasPlan(carousel)) {
      throw carouselConflict('Monte o plano antes de gerar as imagens.');
    }
    carousel.status = 'generating';
    carousel.planError = null;
    for (const slide of carousel.slides) {
      slide.image.generating = true;
      slide.imageGenerationError = null;
    }
    carousel.updatedAt = new Date().toISOString();
    await writeJson(carousel.filePath, carousel);
    return carousel;
  });
}

export function enqueueCarouselImageGeneration(projectId, carouselId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  Promise.all([loadProject(paths), readCarousel(paths, carouselId)])
    .then(async ([project, carousel]) => {
      await generateCarouselSlideImages(carousel, project, projectId, options, paths);
      carousel.status = 'ready';
      carousel.updatedAt = new Date().toISOString();
      await writeJson(carousel.filePath, carousel);
    })
    .catch((err) => {
      console.error(`[content-central] background carousel image generation failed for ${projectId}/${carouselId}:`, err.message);
    });
}
```

(e) In `reconcileInterruptedGenerations`, inside the `for (const carousel of carousels)` loop, right after the `if (carousel.status === 'generating') { ... }` block, add:

```js
        if (carousel.status === 'planning') {
          carousel.status = 'plan_ready';
          carousel.planError = 'Planejamento interrompido (o servidor foi reiniciado). Tente de novo.';
          touched = true;
        }
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
node --test --test-name-pattern="arousel|carrossel|plan|ajuste|imagens|planning" tests/content-central.test.js
```

Expected: PASS, including every pre-existing carousel test (the batch ones and `reconcileInterruptedGenerations also clears a stuck carousel slide`).

- [ ] **Step 5: Commit**

```powershell
git add src/content-central.js tests/content-central.test.js
git commit -m @'
feat(content-central): standalone carousel plans first, adjusts by message, then generates images

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: Theme from an offer, and the clean look (engine + image prompt)

**Files:**
- Modify: `src/content-central.js`
  - `generateCarousel`, `applyCarouselOutline`, `buildCarouselSlideContentTopic`
  - `buildCreativeSpec` (~line 8058)
  - `buildChatGptFinalCardPrompt` (the `CONSISTÊNCIA DO CARROSSEL` section, ~line 8333)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `applyCarouselOutline` (Tasks 1–2), `waitForCarousel` and `fakeOutline` test helpers (Task 2), `saveProjectOffer` (existing export).
- Produces:
  - Carousel fields `offerId: string | null` and `carouselStyle: 'clean'` (standalone only).
  - Slide `contentTopic` gains `carouselStyle`, and when the offer resolves: `offerId`, `photoReferenceIds`, `productTreatment`.
  - Outline generator payload gains, only when present: `offer: { name, price, items }` and `carouselStyle: 'clean'`.
  - Internal `findCarouselOffer(project, offerId) => offer | null`, reused by Task 4.

- [ ] **Step 1: Write the failing tests**

Append after the Task 2 block in `tests/content-central.test.js`:

```js
test('a carousel pulled from an offer sends the offer to the roteiro and puts its photos (not its name/price) on every slide', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-oferta', name: 'Boss Pizzaria' }, dir);
    const { offer } = await saveProjectOffer('carrossel-oferta', {
      name: 'Pizza Calabresa',
      type: 'offer',
      price: 'R$ 49,90',
      items: 'Borda recheada',
      photoReferenceIds: ['ref-foto-calabresa'],
      productTreatment: 'faithful_enhance',
    }, dir);
    const carousel = await generateCarousel('carrossel-oferta', { briefing: 'Pizza Calabresa — Borda recheada', slideCount: 2, offerId: offer.id }, dir);
    assert.equal(carousel.offerId, offer.id);
    assert.equal(carousel.carouselStyle, 'clean');

    let received;
    enqueueCarouselPlanning('carrossel-oferta', carousel.carouselId, {
      outlineGenerator: async (payload) => { received = payload; return fakeOutline(['Calabresa por R$ 49,90', 'Peça já']); },
    }, dir);
    const planned = await waitForCarousel('carrossel-oferta', carousel.carouselId, dir, (c) => c.status === 'plan_ready');

    assert.deepEqual(received.offer, { name: 'Pizza Calabresa', price: 'R$ 49,90', items: 'Borda recheada' });
    assert.equal(received.carouselStyle, 'clean');
    planned.slides.forEach((slide) => {
      assert.equal(slide.contentTopic.offerId, offer.id);
      assert.deepEqual(slide.contentTopic.photoReferenceIds, ['ref-foto-calabresa']);
      assert.equal(slide.contentTopic.productTreatment, 'faithful_enhance');
      assert.equal(slide.contentTopic.carouselStyle, 'clean');
      assert.equal(slide.contentTopic.type, 'institutional', 'never the offer type — that would demand an offer template');
      assert.equal(slide.contentTopic.offerName, undefined, 'offerName would become every slide\'s exact title');
      assert.equal(slide.contentTopic.price, '', 'price would be stamped on every slide');
    });
  });
});

test('an offerId that no longer exists falls back to a plain briefing carousel', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-oferta-sumiu', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-oferta-sumiu', { briefing: 'teste', slideCount: 2, offerId: 'nao-existe' }, dir);
    let received;
    enqueueCarouselPlanning('carrossel-oferta-sumiu', carousel.carouselId, {
      outlineGenerator: async (payload) => { received = payload; return fakeOutline(['Capa', 'CTA']); },
    }, dir);
    const planned = await waitForCarousel('carrossel-oferta-sumiu', carousel.carouselId, dir, (c) => c.status === 'plan_ready');
    assert.equal(received.offer, undefined);
    assert.equal(planned.planError, null);
    assert.equal(planned.slides[0].contentTopic.offerId, undefined);
  });
});

test('a standalone carousel slide is built clean: simple brand background, clean title, clean carousel block in the prompt', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-clean', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-clean', { briefing: 'teste', slideCount: 2 }, dir);
    enqueueCarouselPlanning('carrossel-clean', carousel.carouselId, { outlineGenerator: async () => fakeOutline(['Capa', 'CTA']) }, dir);
    await waitForCarousel('carrossel-clean', carousel.carouselId, dir, (c) => c.status === 'plan_ready');
    await startCarouselImageGeneration('carrossel-clean', carousel.carouselId, dir);

    const seen = [];
    enqueueCarouselImageGeneration('carrossel-clean', carousel.carouselId, {
      imageGenerator: async (payload) => {
        seen.push({ prompt: payload.content.image.prompt, spec: payload.content.creativeSpec });
        return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' };
      },
    }, dir);
    await waitForCarousel('carrossel-clean', carousel.carouselId, dir, (c) => c.status === 'ready');

    assert.equal(seen.length, 2);
    seen.forEach(({ prompt, spec }) => {
      assert.equal(spec.background.style, 'simple_brand');
      assert.equal(spec.title.style, 'clean');
      assert.match(prompt, /ESTILO CARROSSEL CLEAN/);
    });
  });
});

test('the automatic calendar carousel keeps today\'s look and outline payload: no clean block, no offer, no style', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-lote-intacto', name: 'Boss Pizzaria' }, dir);
    const batch = await generateContentSchedulePlan('carrossel-lote-intacto', {
      days: 2,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 1,
      maxCarouselSlides: 2,
    }, dir);
    const paths = getCentralPaths(dir, 'carrossel-lote-intacto');
    const project = await loadProjectForTest('carrossel-lote-intacto', dir);
    const outlinePayloads = [];
    const seen = [];

    await enrichBatchItemsWithRealImages(batch, project, 'carrossel-lote-intacto', {
      imageGenerator: async (payload) => {
        if (payload.content.contentTopic?.source === 'carousel') seen.push({ prompt: payload.content.image.prompt, spec: payload.content.creativeSpec });
        return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' };
      },
      carouselOutlineGenerator: async (payload) => {
        outlinePayloads.push(payload);
        return fakeOutline(Array.from({ length: payload.slideCount }, (_, i) => `Slide ${i + 1}`));
      },
    }, paths);

    assert.equal(outlinePayloads.length, 1);
    assert.deepEqual(Object.keys(outlinePayloads[0]).sort(), ['briefing', 'project', 'slideCount']);
    assert.ok(seen.length > 0);
    seen.forEach(({ prompt, spec }) => {
      assert.doesNotMatch(prompt, /ESTILO CARROSSEL CLEAN/);
      assert.equal(spec.background.style, 'elaborate');
      assert.equal(spec.title.style, 'lettering');
    });
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```powershell
node --test --test-name-pattern="offer|oferta|clean|look" tests/content-central.test.js
```

Expected: FAIL (`carousel.offerId` undefined, `received.offer` undefined, `spec.background.style` is `'elaborate'`). The batch test should already PASS, because it guards current behavior.

- [ ] **Step 3: Implement**

(a) In `generateCarousel`, add two fields to the `carousel` literal, right after `briefing,`:

```js
      // Re-read from the project when the plan is built (findCarouselOffer),
      // so a price edited in Ofertas before planning is honored.
      offerId: String(options.offerId || '').trim() || null,
      carouselStyle: 'clean',
```

(b) Add above `applyCarouselOutline`:

```js
function findCarouselOffer(project, offerId) {
  if (!offerId) return null;
  return normalizeProjectOffers(project.contentStrategy?.offers || []).find((offer) => offer.id === offerId) || null;
}
```

(c) In `applyCarouselOutline`, right after `const replanning = Boolean(overrides.currentPlan);`, add:

```js
  const offer = findCarouselOffer(project, carousel.offerId);
```

In the generator call, extend the spread so the payload becomes:

```js
      outline = await options.outlineGenerator({
        project,
        briefing,
        slideCount,
        ...(offer ? { offer: { name: offer.name, price: offerPriceLabel(offer), items: offer.items || '' } } : {}),
        ...(carousel.carouselStyle ? { carouselStyle: carousel.carouselStyle } : {}),
        ...(replanning ? { currentPlan: overrides.currentPlan, request: overrides.request } : {}),
      });
```

and in the `forEach`, pass the offer and style:

```js
    slide.contentTopic = buildCarouselSlideContentTopic({
      project,
      order: slide.order,
      slideCount: size,
      slideText: slide.slideText,
      offer,
      carouselStyle: carousel.carouselStyle || '',
    });
```

(d) `buildCarouselSlideContentTopic`: change the signature to `function buildCarouselSlideContentTopic({ project, order, slideCount, slideText, offer = null, carouselStyle = '' }) {`. Then add these two spreads as the last entries of the returned object, right after `isLastCarouselSlide: order === slideCount,`:

```js
    // Only the photos travel with each slide. offerName/price would become
    // every slide's "Título exato" and exact price in
    // buildChatGptFinalCardPrompt; they reach the slides through the roteiro
    // instead. type stays 'institutional' — an offer type would demand a
    // registered offer template and attach the single-product structure.
    ...(offer ? {
      offerId: offer.id,
      photoReferenceIds: Array.isArray(offer.photoReferenceIds) ? offer.photoReferenceIds : [],
      productTreatment: offer.productTreatment || '',
    } : {}),
    // Read by buildCreativeSpec and buildChatGptFinalCardPrompt. Only the
    // standalone tab sets it, so the calendar carousel keeps its look.
    ...(carouselStyle ? { carouselStyle } : {}),
```

(e) `buildCreativeSpec`: add a `cleanCarousel` constant right before `const backgroundStyle = ...`, and extend both style decisions:

```js
  const cleanCarousel = topic.source === 'carousel' && topic.carouselStyle === 'clean';
  const backgroundStyle = topic.source === 'offer'
    ? normalizeBackgroundStyle(topic.backgroundStyle)
    : topic.source === 'flyer' && topic.backgroundStyle
      ? normalizeBackgroundStyle(topic.backgroundStyle)
      : cleanCarousel
        ? 'simple_brand'
        : 'elaborate';
```

and the `title` entry:

```js
    title: {
      style: topic.source === 'offer' ? normalizeTitleStyle(topic.titleStyle) : cleanCarousel ? 'clean' : 'lettering',
    },
```

(f) `buildChatGptFinalCardPrompt`: directly after the `CONSISTÊNCIA DO CARROSSEL` ternary (the one ending `: '',`), add:

```js
    topic.source === 'carousel' && topic.carouselStyle === 'clean'
      ? section('ESTILO CARROSSEL CLEAN', [
        'Visual clean de carrossel de Instagram: fundo liso ou com degradê suave nas cores da marca, sem texturas, ondas, faixas ou grafismos carregados.',
        'Um título grande e no máximo 1 ou 2 linhas curtas de apoio — nada de parágrafo.',
        'Muito espaço vazio e margens generosas; poucos elementos por slide.',
        'Logo pequena, sempre no mesmo canto em todos os slides.',
        'Se houver foto real do produto anexada, ela é o foco visual: recorte limpo, sem colagem nem vários produtos misturados.',
      ])
      : '',
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
node --test --test-name-pattern="arousel|carrossel|offer|oferta|clean|look|plan" tests/content-central.test.js
node --test --test-name-pattern="buildCreativeSpec|title|titulo|título" tests/content-central.test.js
```

Expected: PASS. The second command guards the offer/flyer title and background tests that share `buildCreativeSpec`.

- [ ] **Step 5: Commit**

```powershell
git add src/content-central.js tests/content-central.test.js
git commit -m @'
feat(content-central): carousel theme from a registered offer, clean look by default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: Schedule as approved, caption draft, carousel-only sweep filter

**Files:**
- Modify: `src/content-central.js` (new functions after `enqueueCarouselImageGeneration`; `runDuePublishSweep` ~line 4895)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `readCarousel`, `findCarouselOffer` (Tasks 2–3), existing `writeAiCaptionForItem`, `offerPriceLabel`, `buildContentReview`, `CHANNEL_LABELS`, `imageAspectRatioForChannel`, `imageDimensionsForChannel`, `DEFAULT_TIME`.
- Produces (exported):
  - `scheduleCarousel(projectId, carouselId, { date, time, caption }, targetDir = process.cwd()) => Promise<{ item, carousel }>`
    - `item` is an approved `format: 'carousel'` batch item
    - `carousel.schedules` gets `{ contentId, batchId, date, time }` appended
  - `draftCarouselCaption(projectId, carouselId, { captionGenerator }, targetDir = process.cwd()) => Promise<string>`. Throws when there is no generator or the generator returns nothing.
  - `runDuePublishSweep(targetDir, { ..., itemFilter?: (item) => boolean })`. The optional filter is applied with the `channels` filter.

- [ ] **Step 1: Write the failing tests**

Add `scheduleCarousel` and `draftCarouselCaption` to the test file's import list. Append:

```js
// A carousel whose plan and images are already done, written straight to
// disk — scheduling only reads the finished file, it never generates.
async function writeReadyCarousel(projectId, dir, extra = {}) {
  const carousel = await generateCarousel(projectId, { briefing: 'Pizza de sexta', slideCount: 2 }, dir);
  const ready = {
    ...carousel,
    status: 'ready',
    format: 'listicle',
    slides: carousel.slides.map((slide, index) => ({
      ...slide,
      role: index === 0 ? 'cover' : 'cta',
      slideText: index === 0 ? 'Sexta é dia de pizza' : 'Peça pelo WhatsApp',
      image: { ...slide.image, generating: false, url: `/api/projects/${projectId}/assets/assets/generated/slide-${index + 1}.png` },
      imageGenerationError: null,
    })),
    ...extra,
  };
  await writeFile(carousel.filePath, JSON.stringify(ready, null, 2), 'utf-8');
  return ready;
}

test('scheduleCarousel writes an approved carousel item for the date/time with the given caption, reusing the slide images', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-agenda', name: 'Boss Pizzaria' }, dir);
    const carousel = await writeReadyCarousel('carrossel-agenda', dir);

    const { item, carousel: updated } = await scheduleCarousel('carrossel-agenda', carousel.carouselId, {
      date: '2026-10-10', time: '18:30', caption: 'Sexta tem pizza! 🍕',
    }, dir);

    assert.equal(item.format, 'carousel');
    assert.equal(item.channel, 'instagram_feed');
    assert.equal(item.status, 'aprovado');
    assert.equal(item.approval.approvalSource, 'carousel_scheduled');
    assert.ok(item.approval.approvedAt);
    assert.equal(item.scheduledDate, '2026-10-10');
    assert.equal(item.scheduledTime, '18:30');
    assert.equal(item.caption.text, 'Sexta tem pizza! 🍕');
    assert.equal(item.carouselFormat, 'listicle');
    assert.equal(item.sourceCarouselId, carousel.carouselId);
    assert.deepEqual(item.slides.map((s) => s.image.url), carousel.slides.map((s) => s.image.url));

    const listed = await listProjectContent('carrossel-agenda', dir);
    assert.ok(listed.some((entry) => entry.contentId === item.contentId), 'it is a normal calendar item');
    assert.deepEqual(updated.schedules, [{ contentId: item.contentId, batchId: item.batchId, date: '2026-10-10', time: '18:30' }]);

    // Deleting the standalone carousel must not break the scheduled post.
    await deleteCarousel('carrossel-agenda', carousel.carouselId, dir);
    const stillThere = JSON.parse(await readFile(item.filePath, 'utf-8'));
    assert.equal(stillThere.slides[0].image.url, carousel.slides[0].image.url);
  });
});

test('scheduleCarousel twice on the same day creates two distinct items', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-agenda-2x', name: 'Boss Pizzaria' }, dir);
    const carousel = await writeReadyCarousel('carrossel-agenda-2x', dir);
    const first = await scheduleCarousel('carrossel-agenda-2x', carousel.carouselId, { date: '2026-10-10', time: '09:00', caption: 'a' }, dir);
    const second = await scheduleCarousel('carrossel-agenda-2x', carousel.carouselId, { date: '2026-10-10', time: '18:00', caption: 'b' }, dir);
    assert.notEqual(first.item.contentId, second.item.contentId);
    assert.equal(second.carousel.schedules.length, 2);
  });
});

test('scheduleCarousel refuses an unfinished carousel, a bad date/time and an empty caption', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-agenda-recusa', name: 'Boss Pizzaria' }, dir);
    const planning = await generateCarousel('carrossel-agenda-recusa', { briefing: 'teste', slideCount: 2 }, dir);
    await assert.rejects(
      () => scheduleCarousel('carrossel-agenda-recusa', planning.carouselId, { date: '2026-10-10', time: '09:00', caption: 'x' }, dir),
      /Gere todos os slides antes de agendar/,
    );
    const failedSlide = await writeReadyCarousel('carrossel-agenda-recusa', dir);
    failedSlide.slides[1].imageGenerationError = 'provider timeout';
    await writeFile(failedSlide.filePath, JSON.stringify(failedSlide, null, 2), 'utf-8');
    await assert.rejects(
      () => scheduleCarousel('carrossel-agenda-recusa', failedSlide.carouselId, { date: '2026-10-10', time: '09:00', caption: 'x' }, dir),
      /Gere todos os slides antes de agendar/,
    );
    const ready = await writeReadyCarousel('carrossel-agenda-recusa', dir);
    await assert.rejects(() => scheduleCarousel('carrossel-agenda-recusa', ready.carouselId, { date: '10/10/2026', time: '09:00', caption: 'x' }, dir), /Data inválida/);
    await assert.rejects(() => scheduleCarousel('carrossel-agenda-recusa', ready.carouselId, { date: '2026-10-10', time: '9h', caption: 'x' }, dir), /Horário inválido/);
    await assert.rejects(() => scheduleCarousel('carrossel-agenda-recusa', ready.carouselId, { date: '2026-10-10', time: '09:00', caption: '  ' }, dir), /legenda/);
  });
});

test('draftCarouselCaption asks the caption writer about the carousel (its slides and offer) and returns the text without saving', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-legenda', name: 'Boss Pizzaria' }, dir);
    const { offer } = await saveProjectOffer('carrossel-legenda', { name: 'Pizza Calabresa', type: 'offer', price: 'R$ 49,90' }, dir);
    const carousel = await writeReadyCarousel('carrossel-legenda', dir, { offerId: offer.id });
    let received;
    const text = await draftCarouselCaption('carrossel-legenda', carousel.carouselId, {
      captionGenerator: async (payload) => { received = payload; return 'Legenda pronta'; },
    }, dir);
    assert.equal(text, 'Legenda pronta');
    assert.equal(received.content.format, 'carousel');
    assert.match(received.content.contentTopic.items, /Sexta é dia de pizza/);
    assert.equal(received.content.contentTopic.offerName, 'Pizza Calabresa');
    assert.equal(received.content.contentTopic.price, 'R$ 49,90');
    await assert.rejects(() => draftCarouselCaption('carrossel-legenda', carousel.carouselId, {}, dir), /legenda à mão/);
  });
});

test('runDuePublishSweep with an itemFilter publishes only the due carousel, leaving a due single-image post alone', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-varredura', name: 'Boss Pizzaria', handle: '@boss', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('carrossel-varredura', { days: 1, startDate: '2026-07-20', postTime: '09:00' }, dir);
    await approveContent('carrossel-varredura', batch.items[0].contentId, dir, batch.batchId);
    const carousel = await writeReadyCarousel('carrossel-varredura', dir);
    const { item } = await scheduleCarousel('carrossel-varredura', carousel.carouselId, { date: '2026-07-20', time: '09:00', caption: 'x' }, dir);

    const published = [];
    const result = await runDuePublishSweep(dir, {
      now: new Date('2026-07-20T12:00:00.000Z'),
      metaPublisher: async ({ content }) => { published.push(content.contentId); return { mediaId: 'm-1' }; },
      itemFilter: (entry) => entry.format === 'carousel',
    });

    assert.deepEqual(published, [item.contentId]);
    assert.deepEqual(result.published, [item.contentId]);
    const single = JSON.parse(await readFile(batch.items[0].filePath, 'utf-8'));
    assert.ok(!single.publish.realPublished, 'the single-image post belongs to gaveta, not this sweep');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```powershell
node --test --test-name-pattern="scheduleCarousel|draftCarouselCaption|itemFilter" tests/content-central.test.js
```

Expected: FAIL (missing exports, which fails the whole file).

- [ ] **Step 3: Implement**

(a) In `runDuePublishSweep`, right after the line `if (options.channels) content = content.filter((item) => options.channels.has(item.channel));`, add:

```js
    if (options.itemFilter) content = content.filter(options.itemFilter);
```

(b) After `enqueueCarouselImageGeneration`, add:

```js
// The post's own topic (caption writer, calendar card). Unlike a slide's
// topic, the offer name and price belong here — the caption may name them.
function carouselPostTopic(carousel, project) {
  const offer = findCarouselOffer(project, carousel.offerId);
  return {
    id: 'carousel-post',
    type: 'institutional',
    source: 'carousel',
    label: `Carrossel — ${project.name}`,
    offerId: offer?.id || null,
    offerName: offer?.name || '',
    price: offer ? offerPriceLabel(offer) : '',
    items: carousel.slides.map((slide) => slide.slideText).filter(Boolean).join(' | '),
    cta: offer?.cta || '',
    autoGenerateCta: !offer?.cta,
    notes: '',
    objective: carousel.briefing,
  };
}

function carouselIsFinished(carousel) {
  return carousel.status === 'ready'
    && carousel.slides.length > 0
    && carousel.slides.every((slide) => slide.image?.url && !slide.image.generating && !slide.imageGenerationError);
}

// "Agendar" opens with a caption already written; nothing is saved here.
export async function draftCarouselCaption(projectId, carouselId, options = {}, targetDir = process.cwd()) {
  if (typeof options.captionGenerator !== 'function') throw new Error('Redator de IA não configurado — escreva a legenda à mão.');
  const paths = getCentralPaths(targetDir, projectId);
  const [project, carousel] = await Promise.all([loadProject(paths), readCarousel(paths, carouselId)]);
  const item = {
    channel: 'instagram_feed',
    formatLabel: CHANNEL_LABELS.instagram_feed,
    format: 'carousel',
    briefing: carousel.briefing,
    slides: carousel.slides,
    contentTopic: carouselPostTopic(carousel, project),
    caption: { text: '', version: 1 },
  };
  await writeAiCaptionForItem(item, project, options);
  if (!item.caption.text) throw new Error(item.captionGenerationError || 'O redator de IA não retornou uma legenda.');
  return item.caption.text;
}

let carouselScheduleCounter = 0;

// "Agendar": the finished carousel becomes a normal calendar item, already
// approved (the operator reviewed every slide here), in the same shape the
// automatic calendar carousel uses — so the calendar, the approval screens and
// publishCarouselToInstagram need nothing new. Slide images already live in
// the project's generated assets and deleteCarousel removes only the JSON, so
// the slides are cloned, not their files.
export async function scheduleCarousel(projectId, carouselId, input = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const carousel = await readCarousel(paths, carouselId);
    if (!carouselIsFinished(carousel)) throw new Error('Gere todos os slides antes de agendar.');
    const date = String(input.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.');
    const time = String(input.time || project.contentSettings?.defaultPostTime || DEFAULT_TIME).trim();
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Horário inválido.');
    const caption = String(input.caption || '').trim();
    if (!caption) throw new Error('Escreva a legenda antes de agendar.');

    // Same uniqueness reasoning as flyerBatchTokenCounter.
    const batchId = `${date}-carrossel-${Date.now()}-${carouselScheduleCounter++}`;
    const batchDir = join(paths.draftsDir, batchId);
    await mkdir(batchDir, { recursive: true });
    const contentId = `${project.projectId}-${batchId}`;
    const filePath = join(batchDir, 'day-01-instagram_feed-01.json');
    const now = new Date().toISOString();
    const contentTopic = carouselPostTopic(carousel, project);
    const item = {
      schemaVersion: 1,
      contentId,
      projectId: project.projectId,
      batchId,
      dayNumber: 1,
      slotNumber: 1,
      scheduledDate: date,
      scheduledTime: time,
      channel: 'instagram_feed',
      formatLabel: CHANNEL_LABELS.instagram_feed,
      contentTopic,
      creativeGroupKey: null,
      creativeSharedWith: null,
      contentReview: buildContentReview({
        channel: 'instagram_feed',
        aspectRatio: imageAspectRatioForChannel(),
        dimensions: imageDimensionsForChannel('instagram_feed'),
        contentTopic,
      }),
      status: 'aprovado',
      title: `Carrossel — ${project.name}`,
      format: 'carousel',
      briefing: carousel.briefing,
      carouselFormat: carousel.format || '',
      slideCount: carousel.slides.length,
      slides: structuredClone(carousel.slides),
      outlineGenerationError: null,
      caption: { text: caption, version: 1 },
      dayRules: [],
      generationContext: { globalRules: [], projectRules: [...(project.rules?.project || [])], contentRules: [] },
      approval: { required: false, emailSentAt: null, approvedAt: now, approvalSource: 'carousel_scheduled' },
      publish: { publishedAt: null, metaMediaId: null, error: null },
      sourceCarouselId: carousel.carouselId,
      filePath,
      createdAt: now,
      updatedAt: now,
    };
    await writeJson(filePath, item);
    await writeJson(join(batchDir, 'batch.json'), {
      batchId,
      projectId: project.projectId,
      createdAt: now,
      days: 1,
      channel: 'instagram_feed',
      startDate: date,
      items: [item],
    });

    carousel.schedules = [...(carousel.schedules || []), { contentId, batchId, date, time }];
    carousel.updatedAt = now;
    await writeJson(carousel.filePath, carousel);
    return { item, carousel };
  });
}
```

- [ ] **Step 4: Run to verify they pass, plus the existing publish-sweep tests**

```powershell
node --test --test-name-pattern="scheduleCarousel|draftCarouselCaption|itemFilter|runDuePublishSweep|arousel|carrossel" tests/content-central.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/content-central.js tests/content-central.test.js
git commit -m @'
feat(content-central): schedule a finished carousel as an approved calendar post

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 5: Server: outline prompt, routes, trending subjects, carousel publish scheduler

**Files:**
- Modify: `src/content-central-server.js`
  - import list from `./content-central.js`
  - `startContentCentralServer` options, context and timers (~lines 393–488)
  - carousel POST routes (~line 1404)
  - `buildCarouselOutlinePrompt` and `writeCarouselOutlineWithHermes` (~lines 4675–4721)
  - new `generateCarouselTopicIdeasWithAiAndWeb` near `generateTopicIdeasWithAiAndWeb` (~line 4479)
  - new `startCarouselPublishScheduler` after `startWhatsAppPublishScheduler` (~line 5444)
- Modify: `src/content-central.js`: export `projectTopicIdeaContext` (add `export` to its declaration, ~line 6641)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes (from `src/content-central.js`): `generateCarousel` (now accepts `offerId`), `enqueueCarouselPlanning`, `requestCarouselReplan`, `startCarouselImageGeneration`, `enqueueCarouselImageGeneration`, `scheduleCarousel`, `draftCarouselCaption`, `projectTopicIdeaContext`, `runDuePublishSweep` with `itemFilter`.
- Produces HTTP API (all `POST`, JSON). Errors are `{ error }`, with 409 for `CAROUSEL_CONFLICT` and 400 otherwise unless stated.

| Route | Body | 2xx response | Notes |
|-------|------|--------------|-------|
| `/api/projects/:id/carousels` | `{ briefing, slideCount, offerId? }` | 201 `{ carousel }` | carousel has `status: 'planning'`; planning starts in the background |
| `/api/projects/:id/carousels-replan/:carouselId` | `{ message }` | 200 `{ carousel }` | |
| `/api/projects/:id/carousels-generate/:carouselId` | none | 200 `{ carousel }` | |
| `/api/projects/:id/carousels-topic-ideas` | none | 200 `{ ideas: [{ title, angle }] }` | 400 when no generator is configured; 502 when it fails |
| `/api/projects/:id/carousels-caption/:carouselId` | none | 200 `{ caption }` | |
| `/api/projects/:id/carousels-schedule/:carouselId` | `{ date, time, caption }` | 200 `{ item, carousel }` | |

- Also produces:
  - `startContentCentralServer` option `carouselTopicIdeaGenerator`. Tests inject it; production defaults to `generateCarouselTopicIdeasWithAiAndWeb` when `enableAiImages`.
  - Exported `startCarouselPublishScheduler(targetDir) => Timer | null`.
  - `buildCarouselOutlinePrompt({ project, briefing, slideCount, formatsReference, offer?, carouselStyle?, currentPlan?, request? })`.

- [ ] **Step 1: Write the failing tests**

Add `startCarouselPublishScheduler` to the test file's import list from `../src/content-central-server.js`. Then:

**Update** `'POST carousels creates a placeholder immediately and the background pipeline fills in the roteiro + real images'`. Replace its body inside `async (_dir, server) => { ... }` from `const generated = ...` to the end of the callback with:

```js
      const generated = await request(server, '/api/projects/carrossel-http/carousels', {
        method: 'POST',
        body: JSON.stringify({ briefing: '3 dicas de pizza', slideCount: 3 }),
      });
      assert.equal(generated.response.status, 201);
      assert.equal(generated.body.carousel.slideCount, 3);
      assert.equal(generated.body.carousel.status, 'planning');

      const carouselId = generated.body.carousel.carouselId;
      const waitFor = async (done) => {
        let found;
        for (let i = 0; i < 100; i += 1) {
          const { body } = await request(server, '/api/projects/carrossel-http/carousels');
          found = body.carousels.find((entry) => entry.carouselId === carouselId);
          if (found && done(found)) return found;
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
        return found;
      };

      const planned = await waitFor((c) => c.status === 'plan_ready');
      assert.equal(planned.slides[0].slideText, 'Slide 1');
      assert.ok(planned.slides.every((slide) => !slide.image.url), 'no image before "Gerar imagens"');

      const started = await request(server, `/api/projects/carrossel-http/carousels-generate/${carouselId}`, { method: 'POST' });
      assert.equal(started.response.status, 200);

      const finalCarousel = await waitFor((c) => c.status === 'ready');
      assert.equal(finalCarousel.format, 'listicle');
      assert.equal(finalCarousel.slides.length, 3);
      finalCarousel.slides.forEach((slide) => {
        assert.equal(slide.image.generating, false);
        assert.equal(slide.image.url, 'https://cdn.example.com/carrossel.png');
      });
```

Rename that test to `'POST carousels plans first; carousels-generate then fills in real images'`.

**Update** `'carousels-delete removes it from the listing, and carousels-regenerate-slide replaces only the target slide'`. Replace its `let ready; for (...) { ... }` wait loop with plan → generate → ready:

```js
      const waitFor = async (done) => {
        let found;
        for (let i = 0; i < 100; i += 1) {
          const { body } = await request(server, '/api/projects/carrossel-http-2/carousels');
          found = body.carousels.find((entry) => entry.carouselId === carouselId);
          if (found && done(found)) return found;
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
        return found;
      };
      await waitFor((c) => c.status === 'plan_ready');
      await request(server, `/api/projects/carrossel-http-2/carousels-generate/${carouselId}`, { method: 'POST' });
      const ready = await waitFor((c) => c.status === 'ready');
```

Leave the rest of the test as is.

**Add**, after that test:

```js
test('carousels-replan adjusts a planned carousel and is refused (409) once images are being generated', async () => {
  const outlineCalls = [];
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', { method: 'POST', body: JSON.stringify({ projectId: 'carrossel-replan-http', name: 'Boss Pizzaria', handle: '@boss', approvalEmail: 'a@example.com' }) });
      const { body } = await request(server, '/api/projects/carrossel-replan-http/carousels', { method: 'POST', body: JSON.stringify({ briefing: 'teste', slideCount: 2 }) });
      const carouselId = body.carousel.carouselId;
      const waitFor = async (done) => {
        let found;
        for (let i = 0; i < 100; i += 1) {
          const list = await request(server, '/api/projects/carrossel-replan-http/carousels');
          found = list.body.carousels.find((entry) => entry.carouselId === carouselId);
          if (found && done(found)) return found;
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
        return found;
      };
      await waitFor((c) => c.status === 'plan_ready');

      const replan = await request(server, `/api/projects/carrossel-replan-http/carousels-replan/${carouselId}`, { method: 'POST', body: JSON.stringify({ message: 'fala da entrega' }) });
      assert.equal(replan.response.status, 200);
      const replanned = await waitFor((c) => c.status === 'plan_ready' && c.planMessages.length === 1);
      assert.equal(outlineCalls.at(-1).request, 'fala da entrega');
      assert.equal(replanned.slides[1].slideText, 'Ajustado 2');

      await request(server, `/api/projects/carrossel-replan-http/carousels-generate/${carouselId}`, { method: 'POST' });
      const refused = await request(server, `/api/projects/carrossel-replan-http/carousels-replan/${carouselId}`, { method: 'POST', body: JSON.stringify({ message: 'muda' }) });
      assert.equal(refused.response.status, 409);
    },
    {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
      carouselOutlineGenerator: async (payload) => {
        outlineCalls.push(payload);
        const prefix = payload.request ? 'Ajustado' : 'Slide';
        return { format: 'listicle', slides: [1, 2].map((n) => ({ role: 'content', slideText: `${prefix} ${n}` })) };
      },
    },
  );
});

test('carousels-topic-ideas returns the injected ideas, 400 without AI, 502 when the research fails', async () => {
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', { method: 'POST', body: JSON.stringify({ projectId: 'carrossel-ideias', name: 'Boss Pizzaria', handle: '@boss', approvalEmail: 'a@example.com' }) });
      const ok = await request(server, '/api/projects/carrossel-ideias/carousels-topic-ideas', { method: 'POST' });
      assert.equal(ok.response.status, 200);
      assert.deepEqual(ok.body.ideas, [{ title: '5 erros ao pedir pizza', angle: 'lista' }]);
    },
    { carouselTopicIdeaGenerator: async ({ project }) => { assert.equal(project.projectId, 'carrossel-ideias'); return [{ title: '5 erros ao pedir pizza', angle: 'lista' }]; } },
  );
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', { method: 'POST', body: JSON.stringify({ projectId: 'carrossel-ideias-sem-ia', name: 'Boss', handle: '@boss', approvalEmail: 'a@example.com' }) });
    const noAi = await request(server, '/api/projects/carrossel-ideias-sem-ia/carousels-topic-ideas', { method: 'POST' });
    assert.equal(noAi.response.status, 400);
  });
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', { method: 'POST', body: JSON.stringify({ projectId: 'carrossel-ideias-falha', name: 'Boss', handle: '@boss', approvalEmail: 'a@example.com' }) });
      const failed = await request(server, '/api/projects/carrossel-ideias-falha/carousels-topic-ideas', { method: 'POST' });
      assert.equal(failed.response.status, 502);
      assert.match(failed.body.error, /sem resultado/);
    },
    { carouselTopicIdeaGenerator: async () => { throw new Error('sem resultado'); } },
  );
});

test('carousels-caption drafts a caption and carousels-schedule turns the finished carousel into an approved calendar post', async () => {
  await withServer(
    async (dir, server) => {
      await request(server, '/api/projects', { method: 'POST', body: JSON.stringify({ projectId: 'carrossel-agendar-http', name: 'Boss Pizzaria', handle: '@boss', approvalEmail: 'a@example.com' }) });
      const { body } = await request(server, '/api/projects/carrossel-agendar-http/carousels', { method: 'POST', body: JSON.stringify({ briefing: 'teste', slideCount: 2 }) });
      const carouselId = body.carousel.carouselId;
      const waitFor = async (done) => {
        let found;
        for (let i = 0; i < 100; i += 1) {
          const list = await request(server, '/api/projects/carrossel-agendar-http/carousels');
          found = list.body.carousels.find((entry) => entry.carouselId === carouselId);
          if (found && done(found)) return found;
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
        return found;
      };
      await waitFor((c) => c.status === 'plan_ready');
      await request(server, `/api/projects/carrossel-agendar-http/carousels-generate/${carouselId}`, { method: 'POST' });
      await waitFor((c) => c.status === 'ready');

      const caption = await request(server, `/api/projects/carrossel-agendar-http/carousels-caption/${carouselId}`, { method: 'POST' });
      assert.equal(caption.response.status, 200);
      assert.equal(caption.body.caption, 'Legenda do carrossel');

      const bad = await request(server, `/api/projects/carrossel-agendar-http/carousels-schedule/${carouselId}`, { method: 'POST', body: JSON.stringify({ date: 'amanhã', time: '09:00', caption: 'x' }) });
      assert.equal(bad.response.status, 400);
      assert.match(bad.body.error, /Data inválida/);

      const scheduled = await request(server, `/api/projects/carrossel-agendar-http/carousels-schedule/${carouselId}`, { method: 'POST', body: JSON.stringify({ date: '2026-10-10', time: '18:30', caption: 'Legenda final' }) });
      assert.equal(scheduled.response.status, 200);
      assert.equal(scheduled.body.item.status, 'aprovado');
      assert.equal(scheduled.body.item.format, 'carousel');
      assert.equal(scheduled.body.carousel.schedules.length, 1);
    },
    {
      imageGenerator: (() => {
        let n = 0;
        return async () => { n += 1; return { url: `https://cdn.example.com/s${n}.png`, mimeType: 'image/png' }; };
      })(),
      captionGenerator: async () => 'Legenda do carrossel',
      carouselOutlineGenerator: async () => ({ format: 'listicle', slides: [{ role: 'cover', slideText: 'Capa' }, { role: 'cta', slideText: 'CTA' }] }),
    },
  );
});

test('buildCarouselOutlinePrompt adds the offer, the clean rule and the replan block only when given, and is unchanged otherwise', () => {
  const base = { project: { name: 'Boss Pizzaria', brandInput: { segment: 'Pizzaria' } }, briefing: 'Pizza de sexta', slideCount: 3, formatsReference: 'REF' };
  const plain = buildCarouselOutlinePrompt(base);
  assert.equal(buildCarouselOutlinePrompt({ ...base, offer: undefined, carouselStyle: undefined, currentPlan: undefined, request: undefined }), plain);
  assert.doesNotMatch(plain, /Estilo clean|PLANO ATUAL|OFERTA\/ASSUNTO/);

  const rich = buildCarouselOutlinePrompt({
    ...base,
    offer: { name: 'Pizza Calabresa', price: 'R$ 49,90', items: 'Borda recheada' },
    carouselStyle: 'clean',
    currentPlan: { format: 'listicle', slides: [{ role: 'cover', slideText: 'Capa antiga' }, { role: 'cta', slideText: 'CTA antigo' }] },
    request: 'troca a capa',
  });
  assert.match(rich, /Pizza Calabresa/);
  assert.match(rich, /R\$ 49,90/);
  assert.match(rich, /Estilo clean/);
  assert.match(rich, /PLANO ATUAL/);
  assert.match(rich, /1\. \[cover\] Capa antiga/);
  assert.match(rich, /troca a capa/);
  assert.doesNotMatch(rich, /exatamente 3 slides/, 'a replan may change the count');
});

test('startCarouselPublishScheduler only starts while real publishing is on and the general scheduler is off', async () => {
  delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
  assert.equal(startCarouselPublishScheduler(process.cwd()), null);

  process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
  delete process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER;
  try {
    assert.equal(startCarouselPublishScheduler(process.cwd()), null, 'general sweep on: it already publishes carousels, never run both');
  } finally {
    delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
  }

  process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
  process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER = 'false';
  // Real publishing is on here: never point it at process.cwd() (the main
  // checkout holds live client projects) — same rule as the tests above.
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-server-'));
  try {
    const timer = startCarouselPublishScheduler(dir);
    assert.notEqual(timer, null);
    clearInterval(timer);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
    delete process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
```

- [ ] **Step 2: Run to verify they fail**

```powershell
node --test --test-name-pattern="arousel|carrossel" tests/content-central-server.test.js
```

Expected: FAIL (missing export `startCarouselPublishScheduler`, which fails the whole file).

- [ ] **Step 3: Implement**

(a) `src/content-central.js`: change `function projectTopicIdeaContext(project = {}) {` to `export function projectTopicIdeaContext(project = {}) {`.

(b) `src/content-central-server.js` import list from `./content-central.js`: add `enqueueCarouselPlanning`, `requestCarouselReplan`, `startCarouselImageGeneration`, `enqueueCarouselImageGeneration`, `scheduleCarousel`, `draftCarouselCaption`, `projectTopicIdeaContext`. Remove `enqueueCarouselGeneration` only if nothing else in the file uses it (check with Grep first; the route below stops using it).

(c) `startContentCentralServer`:
- add `carouselTopicIdeaGenerator = null,` to the destructured options, after `topicIdeaGenerator = null,`
- add to `context`, after `topicIdeaGenerator`:

```js
    carouselTopicIdeaGenerator: carouselTopicIdeaGenerator || (enableAiImages ? generateCarouselTopicIdeasWithAiAndWeb : null),
```

- after `const whatsappPublishSchedulerTimer = startWhatsAppPublishScheduler(targetDir);` add:

```js
  const carouselPublishSchedulerTimer = startCarouselPublishScheduler(targetDir);
```

- in `close`, after the `whatsappPublishSchedulerTimer` line, add:

```js
      if (carouselPublishSchedulerTimer) clearInterval(carouselPublishSchedulerTimer);
```

(d) Replace the existing `if (parts.length === 4 && parts[3] === 'carousels') { ... }` route (and its comment) with:

```js
  // Carrossel avulso: plan first (roteiro only), adjust by message, then
  // "Gerar imagens"; a finished carousel can be scheduled as an approved post.
  if (parts.length === 4 && parts[3] === 'carousels') {
    const body = await readBody(req);
    const briefing = String(body.briefing || '').trim();
    if (!briefing) return sendJson(res, 400, { error: 'Informe o briefing do carrossel.' });
    const carousel = await generateCarousel(projectId, { briefing, slideCount: body.slideCount, offerId: body.offerId }, targetDir);
    enqueueCarouselPlanning(projectId, carousel.carouselId, { outlineGenerator: context.carouselOutlineGenerator }, targetDir);
    return sendJson(res, 201, { carousel });
  }

  if (parts.length === 5 && parts[3] === 'carousels-replan') {
    const body = await readBody(req).catch(() => ({}));
    try {
      const { carousel, request } = await requestCarouselReplan(projectId, parts[4], body.message, targetDir);
      enqueueCarouselPlanning(projectId, carousel.carouselId, { outlineGenerator: context.carouselOutlineGenerator }, targetDir, { request });
      return sendJson(res, 200, { carousel });
    } catch (err) {
      return sendCarouselError(res, err);
    }
  }

  if (parts.length === 5 && parts[3] === 'carousels-generate') {
    try {
      const carousel = await startCarouselImageGeneration(projectId, parts[4], targetDir);
      enqueueCarouselImageGeneration(projectId, carousel.carouselId, {
        imageGenerator: context.imageGenerator,
        imageReviewer: context.imageReviewer,
        // Real cross-slide consistency: slide 1's own generated file becomes
        // an attached reference for the rest (null for anything not local).
        resolveCarouselStyleReference: (slideContent) => resolveExistingGeneratedImagePath(slideContent, projectId, targetDir),
      }, targetDir);
      return sendJson(res, 200, { carousel });
    } catch (err) {
      return sendCarouselError(res, err);
    }
  }

  if (parts.length === 4 && parts[3] === 'carousels-topic-ideas') {
    if (typeof context.carouselTopicIdeaGenerator !== 'function') {
      return sendJson(res, 400, { error: 'IA não configurada para pesquisar assuntos.' });
    }
    try {
      const project = await loadProject(getCentralPaths(targetDir, projectId));
      const ideas = await context.carouselTopicIdeaGenerator({ project });
      return sendJson(res, 200, { ideas });
    } catch (err) {
      return sendJson(res, 502, { error: err.message });
    }
  }

  if (parts.length === 5 && parts[3] === 'carousels-caption') {
    try {
      const caption = await draftCarouselCaption(projectId, parts[4], { captionGenerator: context.captionGenerator }, targetDir);
      return sendJson(res, 200, { caption });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (parts.length === 5 && parts[3] === 'carousels-schedule') {
    const body = await readBody(req).catch(() => ({}));
    try {
      const { item, carousel } = await scheduleCarousel(projectId, parts[4], { date: body.date, time: body.time, caption: body.caption }, targetDir);
      return sendJson(res, 200, { item, carousel });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }
```

Confirm with Grep that `loadProject` and `getCentralPaths` are already imported in this file (they are used near `generateContentSchedulePlan`'s caller, ~line 5530). If not, add them to the import list.

(e) Add near `sendJson`'s other small helpers (or right above `handleRequest`):

```js
function sendCarouselError(res, err) {
  return sendJson(res, err.code === 'CAROUSEL_CONFLICT' ? 409 : 400, { error: err.message });
}
```

(f) Replace `buildCarouselOutlinePrompt` with:

```js
export function buildCarouselOutlinePrompt({ project, briefing, slideCount, formatsReference, offer, carouselStyle, currentPlan, request }) {
  // Every optional block below is '' when its input is absent (dropped by
  // filter(Boolean)), so the calendar carousel's prompt is unchanged.
  return [
    contentCentralPersonaLine('sofia'),
    contentCentralPersonaResponsibilityLine('sofia'),
    'Você é a roteirista responsável por transformar um briefing em um carrossel de Instagram.',
    '',
    'REFERÊNCIA DE FORMATOS DE CARROSSEL (escolha o mais adequado ao briefing; use como guia de estrutura, não copie o texto de exemplo)',
    formatsReference || '(referência não disponível — use seu próprio critério editorial)',
    '',
    'EMPRESA',
    `- Nome: ${project.name}`,
    `- Segmento: ${project.brandInput?.segment || project.companyProfile?.segment || 'não informado'}`,
    '',
    'BRIEFING DO OPERADOR',
    briefing,
    offer ? 'OFERTA/ASSUNTO CADASTRADO (única fonte de nome, preço e detalhes — usar exatamente assim)' : '',
    offer ? `- Nome: ${offer.name}` : '',
    offer?.price ? `- Preço: ${offer.price}` : '',
    offer?.items ? `- Detalhes: ${offer.items}` : '',
    currentPlan ? `PLANO ATUAL (formato: ${currentPlan.format || 'livre'})` : '',
    ...(currentPlan ? currentPlan.slides.map((slide, index) => `${index + 1}. [${slide.role}] ${slide.slideText}`) : []),
    currentPlan ? 'AJUSTE PEDIDO PELO OPERADOR' : '',
    currentPlan ? request : '',
    currentPlan ? 'Refaça o plano aplicando só esse ajuste: mantenha tudo que o pedido não mencionar.' : '',
    '',
    currentPlan
      ? 'Mantenha a mesma quantidade de slides do plano atual, a não ser que o ajuste peça outra quantidade (mínimo 2, máximo 10). O plano continua com capa (role "cover"), conteúdo (role "content") e fechamento com CTA (role "cta").'
      : `Gere exatamente ${slideCount} slides, cobrindo capa (role "cover"), conteúdo (role "content") e fechamento com CTA (role "cta"), na proporção que o formato escolhido pedir.`,
    'Cada "slideText" é o texto final daquele slide (headline + texto de apoio, prontos para virar a peça visual) — nunca uma instrução ou descrição do que desenhar.',
    carouselStyle === 'clean' ? '- Estilo clean: cada slide com um título de no máximo ~8 palavras e no máximo 1 linha curta de apoio. Nada de parágrafo.' : '',
    '- Nunca inventar preço, promoção, prazo, estoque, depoimento ou dado que não foi passado no briefing.',
    '',
    'Responda APENAS com um JSON válido, sem markdown e sem texto fora do JSON, neste formato exato:',
    currentPlan
      ? '{"format":"listicle","slides":[{"role":"cover","slideText":""}]}  // "slides" na ordem de exibição'
      : `{"format":"listicle","slides":[{"role":"cover","slideText":""}]}  // "slides" deve ter exatamente ${slideCount} itens, na ordem de exibição`,
  ].filter(Boolean).join('\n');
}
```

(g) In `writeCarouselOutlineWithHermes`:
- change the signature to `async function writeCarouselOutlineWithHermes({ project, briefing, slideCount, targetDir, offer, carouselStyle, currentPlan, request }) {`
- pass the extras into the prompt: `buildCarouselOutlinePrompt({ project, briefing, slideCount, formatsReference, offer, carouselStyle, currentPlan, request })`
- change `if (slides.length !== slideCount) return null;` to:

```js
  // A replan may change the count; the engine (applyCarouselOutline) checks
  // the 2-10 range itself.
  if (!currentPlan && slides.length !== slideCount) return null;
```

(h) After `generateTopicIdeasWithAiAndWeb`, add:

```js
function buildCarouselTopicIdeasPrompt({ project, raioX, evidence = [] }) {
  return [
    'Você é um agente editorial do Content Central. Sugira assuntos para um CARROSSEL de Instagram (vários slides lidos em sequência).',
    '',
    'RAIO-X DA MARCA',
    `Empresa: ${project.name}`,
    `Segmento: ${raioX.segment}`,
    `Produtos/serviços: ${raioX.productsOrServices}`,
    `Público: ${raioX.audience}`,
    '',
    evidence.length ? 'PESQUISA ONLINE RECENTE / EVIDÊNCIA COLETADA' : '',
    evidence.length ? formatOnlineResearchEvidence(evidence) : '',
    '',
    'REGRAS',
    '- Exatamente 5 assuntos, cada um rendendo de 4 a 8 slides (lista, passo a passo, mito x verdade, antes e depois, perguntas frequentes).',
    '- Assuntos que o público desse segmento está buscando ou comentando agora; concretos e específicos, nada genérico.',
    '- Não inventar números, provas, cases, prêmios, garantias, preço ou resultado financeiro.',
    '- Pode usar a pesquisa online só como inspiração de dúvidas/tendências; não copiar títulos, marcas nem concorrentes.',
    '',
    'Responda APENAS com JSON válido neste formato:',
    '{"ideas":[{"title":"","angle":""}]}',
  ].filter(Boolean).join('\n');
}

// "Assuntos em alta do segmento" on the Carrossel tab — on demand, nothing
// stored. Same web evidence the topic-idea bank uses.
async function generateCarouselTopicIdeasWithAiAndWeb({ project }) {
  const raioX = projectTopicIdeaContext(project);
  const evidence = await collectOnlineTopicResearchEvidence({
    segment: raioX.segment,
    productsOrServices: raioX.productsOrServices,
    audience: raioX.audience,
  });
  const raw = await callAiText(buildCarouselTopicIdeasPrompt({ project, raioX, evidence }), 'OPENSQUAD_TOPIC_IDEAS_TIMEOUT_MS');
  let parsed = null;
  try {
    parsed = extractFirstJsonObject(raw);
  } catch {
    parsed = null;
  }
  const ideas = (Array.isArray(parsed?.ideas) ? parsed.ideas : [])
    .map((idea) => ({ title: String(idea?.title || '').trim(), angle: String(idea?.angle || '').trim() }))
    .filter((idea) => idea.title)
    .slice(0, 5);
  if (!ideas.length) throw new Error('A pesquisa não trouxe assuntos agora. Tente de novo em instantes.');
  return ideas;
}
```

(i) After `startWhatsAppPublishScheduler`, add:

```js
// Carousels only. gaveta skips them (isGavetaItem in startGavetaSyncScheduler)
// and production runs with OPENSQUAD_AUTO_PUBLISH_SCHEDULER=false, so without
// this an approved carousel only went out through "Publicar agora". Starts
// only while the general sweep is off — that sweep already publishes
// carousels, and two sweeps on the same item could post it twice.
export function startCarouselPublishScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') return null;
  if (process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER !== 'false') return null;
  const intervalMs = Number(process.env.OPENSQUAD_PUBLISH_CHECK_INTERVAL_MS || 180000);
  // Same overlap guard as the other publish sweeps.
  let running = false;
  const sweep = () => {
    if (running) return;
    running = true;
    runDuePublishSweep(targetDir, {
      metaPublisher: (payload) => publishContentToInstagram(payload, targetDir),
      itemFilter: (item) => item.format === 'carousel',
    }).catch((err) => console.error('[content-central] carousel publish sweep failed:', err.message))
      .finally(() => { running = false; });
  };
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}
```

- [ ] **Step 4: Run to verify they pass**

```powershell
node --test --test-name-pattern="arousel|carrossel|Scheduler" tests/content-central-server.test.js
node --test --test-name-pattern="arousel|carrossel" tests/content-central.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/content-central.js src/content-central-server.js tests/content-central-server.test.js
git commit -m @'
feat(content-central-server): carousel plan/adjust/generate/schedule routes, trending subjects, carousel publish sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 6: Carrossel tab: pull from offer, trending subjects, plan/adjust, schedule

**Files:**
- Modify: `content-central-app/src/api/client.ts` (carousel section, ~lines 902–980)
- Modify: `content-central-app/src/pages/workspace/Carousels.tsx`
- Modify: `content-central-app/src/pages/workspace/Carousels.module.css`
- Test: `content-central-app/src/pages/workspace/Carousels.test.tsx`

**Interfaces:**
- Consumes the HTTP API from Task 5 (the table in Task 5's Interfaces).
- Produces (client.ts):
  - `replanCarousel(projectId, carouselId, message)`
  - `generateCarouselImages(projectId, carouselId)`
  - `getCarouselTopicIdeas(projectId)`
  - `draftCarouselCaption(projectId, carouselId)`
  - `scheduleCarousel(projectId, carouselId, { date, time, caption })`
  - extended `Carousel`/`GenerateCarouselInput` types

- [ ] **Step 1: Write the failing tests**

In `Carousels.test.tsx`:

(0) Change the first import to `import { fireEvent, render, screen } from "@testing-library/react";`.

(a) Change `projectState()` to include one offer:

```tsx
function projectState() {
  return {
    projects: [{
      projectId: "boss-pizzaria",
      name: "Boss Pizzaria",
      contentSettings: { defaultPostTime: "18:00" },
      contentStrategy: { offers: [{ id: "pizza-calabresa", name: "Pizza Calabresa", type: "offer", items: "Borda recheada", active: true }] },
    }],
    globalRules: {},
  };
}
```

(b) In `"generates a new carousel with the typed briefing and slide count through the real endpoint"`:
- rename to `"plans a new carousel with the typed briefing and slide count through the real endpoint"`
- change `getByLabelText("Tema do carrossel")` to `getByLabelText("O que você quer neste carrossel?")`
- change the button name `"Gerar carrossel"` to `"Planejar"`

The body assertion `toEqual({ briefing: "5 dicas de pizza", slideCount: 2 })` stays: there is no `offerId` when none is picked.

(c) Add these fixtures and tests inside the `describe`:

```tsx
  const PLAN_FIXTURE = {
    ...CAROUSEL_FIXTURE,
    status: "plan_ready",
    planError: null,
    planMessages: [{ text: "fala da entrega", at: "2026-10-08T12:00:00.000Z" }],
    slides: CAROUSEL_FIXTURE.slides.map((slide) => ({ ...slide, image: { generating: false } })),
  };

  it("pulls the theme from a registered offer and sends its offerId", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [] } },
      { body: { carousel: { ...PLAN_FIXTURE, status: "planning" } } },
      { body: { carousels: [] } },
    ]);
    renderCarousels();
    await screen.findByText("Nenhum carrossel ainda");

    await userEvent.selectOptions(screen.getByLabelText("Puxar de Ofertas e assuntos"), "pizza-calabresa");
    expect(screen.getByLabelText("O que você quer neste carrossel?")).toHaveValue("Pizza Calabresa — Borda recheada");
    await userEvent.click(screen.getByRole("button", { name: "Planejar" }));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const planCall = calls.find(([url, options]) => url === "/api/projects/boss-pizzaria/carousels" && options?.method === "POST");
    expect(JSON.parse(planCall![1].body as string)).toEqual({ briefing: "Pizza Calabresa — Borda recheada", slideCount: 6, offerId: "pizza-calabresa" });
  });

  it("lists trending subjects and fills the theme with the one clicked", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [] } },
      { body: { ideas: [{ title: "5 erros ao pedir pizza", angle: "lista do que evitar" }] } },
    ]);
    renderCarousels();
    await screen.findByText("Nenhum carrossel ainda");

    await userEvent.click(screen.getByRole("button", { name: "Assuntos em alta do segmento" }));
    await userEvent.click(await screen.findByRole("button", { name: "5 erros ao pedir pizza" }));
    expect(screen.getByLabelText("O que você quer neste carrossel?")).toHaveValue("5 erros ao pedir pizza — lista do que evitar");
  });

  it("shows the plan with the operator's messages and sends an adjustment", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [PLAN_FIXTURE] } },
      { body: { carousel: { ...PLAN_FIXTURE, status: "planning" } } },
      { body: { carousels: [{ ...PLAN_FIXTURE, status: "planning" }] } },
    ]);
    renderCarousels();

    expect(await screen.findByText("fala da entrega")).toBeInTheDocument();
    expect(screen.getByText("Salve esse post")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("O que mudar?"), "troca a capa");
    await userEvent.click(screen.getByRole("button", { name: "Ajustar" }));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const replanCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/carousels-replan/boss-pizzaria-carrossel-1");
    expect(JSON.parse(replanCall![1].body as string)).toEqual({ message: "troca a capa" });
    expect(await screen.findByText("Planejando…")).toBeInTheDocument();
  });

  it("generates the images from the plan", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [PLAN_FIXTURE] } },
      { body: { carousel: { ...CAROUSEL_FIXTURE, status: "generating" } } },
      { body: { carousels: [CAROUSEL_FIXTURE] } },
    ]);
    renderCarousels();

    await userEvent.click(await screen.findByRole("button", { name: "Gerar imagens" }));
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls.some(([url]) => url === "/api/projects/boss-pizzaria/carousels-generate/boss-pizzaria-carrossel-1")).toBe(true);
    // The plan view also shows role labels, so check for a real slide image.
    expect(await screen.findByAltText("5 dicas de pizza")).toBeInTheDocument();
  });

  it("schedules a finished carousel with a drafted caption", async () => {
    const scheduled = { ...CAROUSEL_FIXTURE, schedules: [{ contentId: "c-1", batchId: "b-1", date: "2026-10-10", time: "18:00" }] };
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [CAROUSEL_FIXTURE] } },
      { body: { caption: "Legenda pronta" } },
      { body: { item: {}, carousel: scheduled } },
      { body: { carousels: [scheduled] } },
    ]);
    renderCarousels();

    await userEvent.click(await screen.findByRole("button", { name: "Agendar" }));
    expect(await screen.findByDisplayValue("Legenda pronta")).toBeInTheDocument();
    expect(screen.getByLabelText("Horário")).toHaveValue("18:00");
    // Typing into a date input is unreliable in jsdom; set it directly.
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-10" } });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar agendamento" }));

    expect(await screen.findByText("Agendado para 10/10 18:00")).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const scheduleCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/carousels-schedule/boss-pizzaria-carrossel-1");
    expect(JSON.parse(scheduleCall![1].body as string)).toEqual({ date: "2026-10-10", time: "18:00", caption: "Legenda pronta" });
  });
```

- [ ] **Step 2: Run to verify they fail**

```powershell
cd content-central-app; npx vitest run src/pages/workspace/Carousels.test.tsx; cd ..
```

Expected: FAIL (labels/buttons not found).

- [ ] **Step 3: Implement `client.ts`**

Replace the `Carousel` interface, the `GenerateCarouselInput` interface, and the comment above `CarouselSlide`. Add the new functions after `deleteCarousel`:

```ts
// Carrossel avulso — plan first (roteiro only), adjust by message, then
// generate images; a finished one can be scheduled as an approved post.
```

```ts
export interface CarouselPlanMessage {
  text: string;
  at: string;
}

export interface CarouselSchedule {
  contentId: string;
  batchId: string;
  date: string;
  time: string;
}

export interface Carousel {
  carouselId: string;
  projectId: string;
  briefing: string;
  offerId?: string | null;
  carouselStyle?: string;
  format: string;
  slideCount: number;
  slides: CarouselSlide[];
  outlineGenerationError: string | null;
  planMessages?: CarouselPlanMessage[];
  planError?: string | null;
  schedules?: CarouselSchedule[];
  status: "planning" | "plan_ready" | "generating" | "ready";
  createdAt: string;
  updatedAt: string;
}
```

```ts
export interface GenerateCarouselInput {
  briefing: string;
  slideCount: number;
  offerId?: string;
}
```

```ts
export function replanCarousel(projectId: string, carouselId: string, message: string): Promise<{ carousel: Carousel }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels-replan/${encodeURIComponent(carouselId)}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function generateCarouselImages(projectId: string, carouselId: string): Promise<{ carousel: Carousel }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels-generate/${encodeURIComponent(carouselId)}`, {
    method: "POST",
  });
}

export interface CarouselTopicIdea {
  title: string;
  angle: string;
}

export function getCarouselTopicIdeas(projectId: string): Promise<{ ideas: CarouselTopicIdea[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels-topic-ideas`, { method: "POST" });
}

export function draftCarouselCaption(projectId: string, carouselId: string): Promise<{ caption: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels-caption/${encodeURIComponent(carouselId)}`, {
    method: "POST",
  });
}

export interface ScheduleCarouselInput {
  date: string;
  time: string;
  caption: string;
}

export function scheduleCarousel(
  projectId: string,
  carouselId: string,
  input: ScheduleCarouselInput,
): Promise<{ item: ContentItem; carousel: Carousel }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels-schedule/${encodeURIComponent(carouselId)}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 4: Implement `Carousels.tsx`**

(a) Imports: add `draftCarouselCaption`, `generateCarouselImages`, `getCarouselTopicIdeas`, `replanCarousel`, `scheduleCarousel`, `type CarouselTopicIdea` to the `@/api/client` import.

(b) Helpers above `export function Carousels()`:

```tsx
function tomorrowIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatScheduleLabel(date: string, time: string): string {
  return `Agendado para ${date.slice(8, 10)}/${date.slice(5, 7)} ${time}`;
}

function carouselIsFinished(carousel: Carousel): boolean {
  return carousel.status === "ready"
    && carousel.slides.length > 0
    && carousel.slides.every((slide) => Boolean(slideSource(slide)) && !slide.image.generating && !slide.imageGenerationError);
}

interface ScheduleFormState {
  carouselId: string;
  date: string;
  time: string;
  caption: string;
  loadingCaption: boolean;
  saving: boolean;
  error: string | null;
}
```

(c) New state inside the component, after `feedPreviewId`:

```tsx
  const [offerId, setOfferId] = useState("");
  const [ideas, setIdeas] = useState<CarouselTopicIdea[] | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [replanText, setReplanText] = useState<Record<string, string>>({});
  const [planBusyId, setPlanBusyId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState | null>(null);
  const offers = (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false);
```

(d) The polling condition also covers planning:

```tsx
    if (!carousels?.some((entry) => entry.status === "planning" || entry.status === "generating" || entry.slides.some((s) => s.image.generating))) return;
```

(e) Rename `handleGenerate` to `handlePlan` and send `offerId` when picked:

```tsx
  async function handlePlan() {
    setGenerating(true);
    setError(null);
    try {
      await generateCarousel(project.projectId, { briefing, slideCount, ...(offerId ? { offerId } : {}) });
      setBriefing("");
      setOfferId("");
      setIdeas(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function handlePickOffer(id: string) {
    setOfferId(id);
    const offer = offers.find((entry) => entry.id === id);
    if (offer) setBriefing([offer.name, offer.items].filter(Boolean).join(" — "));
  }

  async function handleTrendingIdeas() {
    setIdeasLoading(true);
    setIdeasError(null);
    try {
      const data = await getCarouselTopicIdeas(project.projectId);
      setIdeas(data.ideas);
    } catch (err) {
      setIdeasError((err as Error).message);
    } finally {
      setIdeasLoading(false);
    }
  }

  function handlePickIdea(idea: CarouselTopicIdea) {
    setOfferId("");
    setBriefing([idea.title, idea.angle].filter(Boolean).join(" — "));
  }

  // Empty message = "Tentar de novo" on a carousel that has no plan yet.
  async function handleReplan(carouselId: string, message: string) {
    setPlanBusyId(carouselId);
    setError(null);
    try {
      await replanCarousel(project.projectId, carouselId, message);
      setReplanText((current) => ({ ...current, [carouselId]: "" }));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlanBusyId(null);
    }
  }

  async function handleGenerateImages(carouselId: string) {
    setPlanBusyId(carouselId);
    setError(null);
    try {
      await generateCarouselImages(project.projectId, carouselId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPlanBusyId(null);
    }
  }

  async function openSchedule(carouselId: string) {
    const form: ScheduleFormState = {
      carouselId,
      date: tomorrowIso(),
      time: String(project.contentSettings?.defaultPostTime || "09:00"),
      caption: "",
      loadingCaption: true,
      saving: false,
      error: null,
    };
    setScheduleForm(form);
    try {
      const { caption } = await draftCarouselCaption(project.projectId, carouselId);
      setScheduleForm((current) => (current?.carouselId === carouselId ? { ...current, caption, loadingCaption: false } : current));
    } catch (err) {
      setScheduleForm((current) => (current?.carouselId === carouselId
        ? { ...current, loadingCaption: false, error: `Não consegui escrever a legenda: ${(err as Error).message}` }
        : current));
    }
  }

  async function confirmSchedule() {
    if (!scheduleForm) return;
    setScheduleForm({ ...scheduleForm, saving: true, error: null });
    try {
      await scheduleCarousel(project.projectId, scheduleForm.carouselId, {
        date: scheduleForm.date,
        time: scheduleForm.time,
        caption: scheduleForm.caption.trim(),
      });
      setScheduleForm(null);
      await refresh();
    } catch (err) {
      setScheduleForm((current) => (current ? { ...current, saving: false, error: (err as Error).message } : current));
    }
  }
```

(f) Intro text and form. Replace the intro `<p className="muted" ...>` content and the whole form `<Card>`:

```tsx
      <p className="muted" style={{ marginBottom: 16 }}>
        Carrossel avulso: diga o que você quer, ajuste o plano slide por slide e só então gere as imagens. Pronto, dá
        pra agendar — ele entra no calendário já aprovado.
      </p>

      <Card style={{ padding: 20 }}>
        <label htmlFor="carousel-offer">Puxar de Ofertas e assuntos</label>
        <select id="carousel-offer" value={offerId} onChange={(e) => handlePickOffer(e.target.value)}>
          <option value="">— Nenhum (escrever à mão) —</option>
          {offers.map((offer) => (
            <option key={offer.id} value={offer.id}>{offer.name}</option>
          ))}
        </select>

        <label htmlFor="carousel-briefing" style={{ marginTop: 12 }}>O que você quer neste carrossel?</label>
        <textarea
          id="carousel-briefing"
          placeholder="Ex: carrossel da pizza calabresa, foco no delivery de sexta"
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
        />
        <Button type="button" variant="secondary" style={{ marginTop: 8 }} disabled={ideasLoading} onClick={handleTrendingIdeas}>
          {ideasLoading ? "Pesquisando..." : "Assuntos em alta do segmento"}
        </Button>
        {ideasError ? <div className="pill bad" style={{ marginTop: 8 }}>{ideasError}</div> : null}
        {ideas?.length ? (
          <ul className={styles.ideas}>
            {ideas.map((idea) => (
              <li key={idea.title}>
                <button type="button" className={styles.ideaButton} onClick={() => handlePickIdea(idea)}>{idea.title}</button>
                {idea.angle ? <span className="muted"> — {idea.angle}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <label htmlFor="carousel-slide-count" style={{ marginTop: 12 }}>
          Quantidade de folhas
        </label>
        <input
          id="carousel-slide-count"
          type="number"
          min={2}
          max={10}
          value={slideCount}
          onChange={(e) => setSlideCount(Number(e.target.value))}
        />

        <Button
          type="button"
          className="full-width"
          style={{ marginTop: 10 }}
          disabled={generating || !briefing.trim()}
          onClick={handlePlan}
        >
          {generating ? "Planejando..." : "Planejar"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>
```

(g) Inside each carousel `<Card>`, right after the `outlineGenerationError` pill, branch on planning vs images. Wrap the existing `<div className={styles.slideGrid}>…</div>` and `<div className={styles.actions}>…</div>` so they render only when `!inPlanning`, and add the plan view before them:

```tsx
              {(() => {
                const inPlanning = carousel.status === "planning" || carousel.status === "plan_ready";
                if (!inPlanning) return null;
                const hasPlan = carousel.slides.length > 0 && carousel.slides.every((slide) => slide.slideText);
                const text = replanText[carousel.carouselId] || "";
                const busy = planBusyId === carousel.carouselId;
                return (
                  <div className={styles.plan}>
                    {carousel.planMessages?.length ? (
                      <ul className={styles.planMessages}>
                        {carousel.planMessages.map((message) => (
                          <li key={message.at}>{message.text}</li>
                        ))}
                      </ul>
                    ) : null}
                    {carousel.status === "planning" ? <p className="muted">Planejando…</p> : null}
                    {hasPlan ? (
                      <ol className={styles.planList}>
                        {carousel.slides.map((slide) => (
                          <li key={slide.slideId}>
                            <span className={styles.slideRole}>{ROLE_LABELS[slide.role]}</span> {slide.slideText}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {carousel.planError ? <div className="pill bad">⚠ {carousel.planError}</div> : null}
                    {carousel.status === "plan_ready" && hasPlan ? (
                      <>
                        <label htmlFor={`replan-${carousel.carouselId}`}>O que mudar?</label>
                        <textarea
                          id={`replan-${carousel.carouselId}`}
                          placeholder="Ex: troca o slide 3 pra falar do tempo de entrega"
                          value={text}
                          onChange={(e) => setReplanText((current) => ({ ...current, [carousel.carouselId]: e.target.value }))}
                        />
                        <div className={styles.actions}>
                          <Button type="button" variant="secondary" disabled={busy || !text.trim()} onClick={() => handleReplan(carousel.carouselId, text.trim())}>
                            Ajustar
                          </Button>
                          <Button type="button" disabled={busy} onClick={() => handleGenerateImages(carousel.carouselId)}>
                            Gerar imagens
                          </Button>
                        </div>
                      </>
                    ) : null}
                    {carousel.status === "plan_ready" && !hasPlan ? (
                      <Button type="button" variant="secondary" disabled={busy} onClick={() => handleReplan(carousel.carouselId, "")}>
                        Tentar de novo
                      </Button>
                    ) : null}
                    <div className={styles.actions}>
                      <Button type="button" variant="ghost" disabled={deletingId === carousel.carouselId} onClick={() => handleDelete(carousel.carouselId)}>
                        {deletingId === carousel.carouselId ? "Apagando..." : "Apagar"}
                      </Button>
                    </div>
                  </div>
                );
              })()}
```

Then wrap the existing slide grid and actions:

```tsx
              {carousel.status === "planning" || carousel.status === "plan_ready" ? null : (
                <>
                  {/* existing <div className={styles.slideGrid}>…</div> unchanged */}
                  {/* existing <div className={styles.actions}>…</div>, with the Agendar button added — see (h) */}
                </>
              )}
```

(h) In the existing actions row of the images view, add before "Visualizar como no feed":

```tsx
                <Button type="button" disabled={!carouselIsFinished(carousel)} onClick={() => openSchedule(carousel.carouselId)}>
                  Agendar
                </Button>
```

After that actions `<div>`, still inside the fragment, add the schedule labels and form:

```tsx
                  {carousel.schedules?.length ? (
                    <div className={styles.actions}>
                      {carousel.schedules.map((schedule) => (
                        <span key={schedule.contentId} className="pill">{formatScheduleLabel(schedule.date, schedule.time)}</span>
                      ))}
                    </div>
                  ) : null}
                  {scheduleForm?.carouselId === carousel.carouselId ? (
                    <div className={styles.scheduleForm}>
                      <label htmlFor="schedule-date">Data</label>
                      <input id="schedule-date" type="date" value={scheduleForm.date} onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })} />
                      <label htmlFor="schedule-time">Horário</label>
                      <input id="schedule-time" type="time" value={scheduleForm.time} onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })} />
                      <label htmlFor="schedule-caption">Legenda</label>
                      <textarea
                        id="schedule-caption"
                        rows={6}
                        placeholder={scheduleForm.loadingCaption ? "Escrevendo a legenda..." : "Escreva a legenda do post"}
                        value={scheduleForm.caption}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, caption: e.target.value })}
                      />
                      {scheduleForm.error ? <div className="pill bad">{scheduleForm.error}</div> : null}
                      <p className="muted" style={{ fontSize: 12 }}>
                        Entra no calendário já aprovado. Sai no horário se o PC estiver ligado.
                      </p>
                      <div className={styles.actions}>
                        <Button
                          type="button"
                          disabled={scheduleForm.saving || scheduleForm.loadingCaption || !scheduleForm.caption.trim() || !scheduleForm.date || !scheduleForm.time}
                          onClick={confirmSchedule}
                        >
                          {scheduleForm.saving ? "Agendando..." : "Confirmar agendamento"}
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setScheduleForm(null)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : null}
```

(i) `Carousels.module.css`: append:

```css
.ideas {
  margin: 8px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 4px;
}

.ideaButton {
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent, inherit);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.plan {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.planMessages {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--muted);
}

.planList {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
}

.scheduleForm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
```

- [ ] **Step 5: Run the tests and the type-checking build**

```powershell
cd content-central-app; npx vitest run src/pages/workspace/Carousels.test.tsx; npm run build; cd ..
```

Expected: tests PASS, and the build finishes with no TypeScript errors. If `project.contentSettings?.defaultPostTime` errors as `unknown`, the `String(...)` wrapper in `openSchedule` already handles it. Keep it.

- [ ] **Step 6: Commit**

```powershell
git add content-central-app/src/api/client.ts content-central-app/src/pages/workspace/Carousels.tsx content-central-app/src/pages/workspace/Carousels.module.css content-central-app/src/pages/workspace/Carousels.test.tsx
git commit -m @'
feat(content-central-app): Carrossel tab pulls from offers/trending subjects, plans by message, schedules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 7: Full verification and the test bench (controller, with the operator)

**Files:** none in git. The bench data lives in the worktree's gitignored `_opensquad/content-central/`.

- [ ] **Step 1: Full suites.** In the worktree, run:

```powershell
npm test
cd content-central-app; npm test; npm run build; cd ..
```

Expected: all pass, except possibly the known intermittent Windows `ENOTEMPTY` temp-dir flake (`content central server serves only supported API channels`), which also fails on master. Re-run that file once to confirm it is the flake.

- [ ] **Step 2: Build the bench data.** From the main checkout, copy into the worktree's `_opensquad/content-central/`:
- `projects/mercado-carvalho/` and `projects/king-assessoria-mkt/`: only `project.json`, `assets/` and `memory/`
- the central root `assets/` (layout templates live in `assets/learning/`)
- `segment-learnings.json` and `offer-type-learnings.json` if present, and `segment-templates/`

Do NOT copy `secrets/`, `approvals/`, or either project's `content/`.

In each copied `project.json`, delete the `whatsapp`, `token` and `instagram` keys.

- [ ] **Step 3: Bench `.env`.** The worktree's `.env` holds exactly these lines, with the values copied from the main `.env`:

```
OPENSQUAD_IMAGE_PROVIDER=<same as main .env>
TZ=<same as main .env>
```

Nothing else: no `OPENSQUAD_ENABLE_REAL_PUBLISHING`, no gaveta, no Supabase, no WAHA. With these absent, no publish, sync or cloud sweep can start.

- [ ] **Step 4: Start the bench** as a background task (it dies after 2 hours; tell the operator):

```powershell
node bin/opensquad.js content serve 3397
```

Check `http://127.0.0.1:3397` responds. Never touch 3333.

- [ ] **Step 5: Walk the operator through it** on `mercado-carvalho` (an offer with photos) and `king-assessoria-mkt` (a service):
1. Puxar de Ofertas e assuntos
2. Assuntos em alta
3. Planejar
4. Ajustar ("troca o slide 2…", "faz com 5 slides")
5. Gerar imagens, then judge the clean look and whether the product photo is real
6. Agendar: check the caption and that it appears in Calendário as approved

Publishing itself cannot run on the bench (no token, publishing off). It is covered by the Task 4/5 tests.

- [ ] **Step 6: Stop.** Report the results. Merging to master and restarting production (rebuild the app, then the operator restarts 3333 in their own terminal) happen only on the operator's word.
