# Carrossel avulso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project "Carrossel" tab to Content Central where the operator writes a briefing + picks a slide count, an AI roteiro (guided by Opensquad's existing `instagram-feed.md` carousel formats) breaks it into N slides, and each slide gets its own AI-generated image that can be regenerated individually — no calendar, no approval, no publishing.

**Architecture:** Mirrors the existing `AdCreative` pattern end to end: 1 JSON file per carousel in `content/carousels/`, fire-and-forget background generation, frontend polling. New: the JSON holds an array of independently-regenerable slides instead of one image, and the text-breakdown step is a new AI call (`carouselOutlineGenerator`) that reads `_opensquad/core/best-practices/instagram-feed.md` as prompt reference.

**Tech Stack:** Node.js (content-central.js / content-central-server.js, no framework, no build step), React + TypeScript + Vite (content-central-app), Vitest + Testing Library (frontend), Node's built-in `node:test` + `assert` (backend, per existing test files).

## Global Constraints

- Slide count is user-controlled, clamped to **2–10** (matches `skills/instagram-publisher`'s real Instagram carousel limit of 2-10 images — no point allowing a count that could never actually publish later).
- Every slide uses the **`instagram_feed`** channel and its real dimensions from the existing `imageDimensionsForChannel('instagram_feed')` — **1080×1350**, not 1080×1080. Never hardcode a different number.
- Every slide's `contentTopic.type` is `'institutional'` and `source` is `'carousel'` — this keeps `deriveCreativePostType` resolving to `'institutional'`, which is **not** in `CREATIVE_TEMPLATE_REQUIRED_POST_TYPES`, so no segment creative-template registration is required to generate real images.
- No SVG placeholder image per slide. A slide starts as `{ image: { generating: true }, contentTopic: null }` and only gets a real `prompt`/`references`/`url` once the roteiro resolves its `slideText`.
- All new backend functions live in the same 2 files the `AdCreative` functions already live in (`src/content-central.js`, `src/content-central-server.js`) — this codebase does not split by feature into new files for a concept this size (see `generateAdCreative` and neighbors).
- Never throw out of a background (`enqueue*`) job — record the error on the object and `writeJson` it, same as every existing `*GenerationError` field in this codebase.

---

## File Structure

- **Modify `src/content-central.js`**: add `carouselsDir` to `getCentralPaths`; add `generateCarousel`, `runCarouselGeneration`, `enrichCarouselSlideWithRealImage`, `buildCarouselSlideContentTopic`, `enqueueCarouselGeneration`, `regenerateCarouselSlide`, `enqueueCarouselSlideRegeneration`, `listCarousels`, `deleteCarousel`. All placed directly after the existing ad-creative block (after `deleteAdCreative`, before `enqueueBatchImageGeneration`'s helpers), following the exact same style.
- **Modify `src/content-central-server.js`**: add `readCarouselFormatsReference`, `buildCarouselOutlinePrompt`, `writeCarouselOutlineWithHermes` next to the existing `buildAdCopyPrompt`/`writeAdCopyVariationsWithHermes` block; add `carouselOutlineGenerator` to `startContentCentralServer`'s options + `context`; add 4 routes (`GET carousels`, `POST carousels`, `POST carousels-delete/:id`, `POST carousels-regenerate-slide/:carouselId/:slideId`) next to the existing ad-creatives routes.
- **Modify `tests/content-central.test.js`**: new tests for the 6 new exported functions, next to the existing `AdCreative` tests.
- **Modify `tests/content-central-server.test.js`**: new HTTP-level tests for the 4 new routes, next to the existing ad-creatives route tests.
- **Modify `content-central-app/src/api/client.ts`**: add `Carousel`/`CarouselSlide` types + `listCarousels`/`generateCarousel`/`regenerateCarouselSlide`/`deleteCarousel` functions, next to the `AdCreative` block.
- **Create `content-central-app/src/pages/workspace/Carousels.tsx`**: the new tab page, structurally mirroring `AdCreatives.tsx`.
- **Create `content-central-app/src/pages/workspace/Carousels.module.css`**: slide grid + card styles, reusing `AdCreatives.module.css`'s tokens where the shape matches.
- **Modify `content-central-app/src/App.tsx`**: new route `carrossel`.
- **Modify `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`**: new nav entry.
- **Create `content-central-app/src/pages/workspace/Carousels.test.tsx`**: mirrors `AdCreatives.test.tsx`.

---

### Task 1: Backend — carousel skeleton CRUD (create, list, delete)

**Files:**
- Modify: `src/content-central.js:381-433` (`getCentralPaths`), and a new block placed right after `deleteAdCreative` (currently ends at `src/content-central.js:2621`)
- Test: `tests/content-central.test.js` (new tests added near the existing `generateAdCreative`/`listAdCreatives`/`deleteAdCreative` tests, around line 7745-7862)

**Interfaces:**
- Produces: `getCentralPaths(targetDir, projectId).carouselsDir: string`; `generateCarousel(projectId, { briefing: string, slideCount?: number }, targetDir): Promise<Carousel>`; `listCarousels(projectId, targetDir): Promise<Carousel[]>`; `deleteCarousel(projectId, carouselId, targetDir): Promise<{ deleted: true }>`.
- `Carousel` shape produced by this task: `{ schemaVersion: 1, carouselId, projectId, briefing, format: '', slideCount, slides: CarouselSlide[], outlineGenerationError: null, status: 'generating', createdAt, updatedAt, filePath }`.
- `CarouselSlide` shape produced by this task: `{ slideId, order, role: 'content', slideText: '', contentTopic: null, contentId, channel: 'instagram_feed', formatLabel: 'Instagram Feed', image: { generating: true, prompt: '', references: [], aspectRatio: 'portrait', dimensions: { width: 1080, height: 1350 }, mimeType: 'image/png', version: 1 }, imageGenerationError: null }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/content-central.test.js`, near the other ad-creative tests. First confirm the imports at the top of the file already include `withTempProject`, `createCentralProject`, `readFile` (they do — reused unchanged); add the 4 new function names to the existing import block from `'../src/content-central.js'`:

```js
  generateCarousel,
  listCarousels,
  deleteCarousel,
```

Then the tests:

```js
test('generateCarousel creates a placeholder carousel with N generating slides, no image/roteiro yet', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-base', name: 'Boss Pizzaria' }, dir);

    const carousel = await generateCarousel('carrossel-base', { briefing: '5 dicas de pizza', slideCount: 5 }, dir);

    assert.equal(carousel.slideCount, 5);
    assert.equal(carousel.slides.length, 5);
    assert.equal(carousel.status, 'generating');
    assert.equal(carousel.format, '');
    assert.equal(carousel.outlineGenerationError, null);
    carousel.slides.forEach((slide, index) => {
      assert.equal(slide.order, index + 1);
      assert.equal(slide.channel, 'instagram_feed');
      assert.equal(slide.image.generating, true);
      assert.deepEqual(slide.image.dimensions, { width: 1080, height: 1350 });
      assert.equal(slide.contentTopic, null);
      assert.equal(slide.slideText, '');
    });
  });
});

test('generateCarousel clamps slideCount to the 2-10 range and requires a briefing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-clamp', name: 'Boss Pizzaria' }, dir);

    const tooFew = await generateCarousel('carrossel-clamp', { briefing: 'teste', slideCount: 1 }, dir);
    assert.equal(tooFew.slideCount, 2);

    const tooMany = await generateCarousel('carrossel-clamp', { briefing: 'teste', slideCount: 99 }, dir);
    assert.equal(tooMany.slideCount, 10);

    await assert.rejects(
      () => generateCarousel('carrossel-clamp', { briefing: '   ' }, dir),
      /briefing/i,
    );
  });
});

test('listCarousels and deleteCarousel round-trip real files on disk', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-lista', name: 'Boss Pizzaria' }, dir);
    const a = await generateCarousel('carrossel-lista', { briefing: 'briefing A', slideCount: 3 }, dir);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await generateCarousel('carrossel-lista', { briefing: 'briefing B', slideCount: 4 }, dir);

    const listed = await listCarousels('carrossel-lista', dir);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].carouselId, b.carouselId, 'newest first');

    await deleteCarousel('carrossel-lista', a.carouselId, dir);
    const afterDelete = await listCarousels('carrossel-lista', dir);
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].carouselId, b.carouselId);
  });
});

test('listCarousels returns an empty list for a project that never generated a carousel', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-vazio', name: 'Boss Pizzaria' }, dir);
    assert.deepEqual(await listCarousels('carrossel-vazio', dir), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central.test.js --test-name-pattern="Carousel|carousel"`
Expected: FAIL — `generateCarousel is not a function` (or similar import error).

- [ ] **Step 3: Add `carouselsDir` to `getCentralPaths`**

In `src/content-central.js`, right after the existing `adCreativesDir` line (`src/content-central.js:430`):

```js
    adCreativesDir: join(projectDir, 'content', 'ad-creatives'),
    // Carousel (avulso) — same "separate from organic content" shape as
    // ad creatives: no scheduledDate, no approval, no calendar. Each JSON
    // holds N independently-regenerable slides instead of 1 image.
    carouselsDir: join(projectDir, 'content', 'carousels'),
    tokenSecretPath: join(secretsDir, `${normalized}.token`),
```

- [ ] **Step 4: Implement `generateCarousel`, `listCarousels`, `deleteCarousel`**

In `src/content-central.js`, directly after the existing `deleteAdCreative` function (currently ends at line 2621), add:

```js
const CAROUSEL_SLIDE_COUNT_MIN = 2;
const CAROUSEL_SLIDE_COUNT_MAX = 10;

function clampCarouselSlideCount(value) {
  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric)) return CAROUSEL_SLIDE_COUNT_MIN;
  return Math.min(CAROUSEL_SLIDE_COUNT_MAX, Math.max(CAROUSEL_SLIDE_COUNT_MIN, numeric));
}

function buildCarouselSlideSkeleton(carouselId, order) {
  return {
    slideId: `${carouselId}-slide-${order}`,
    order,
    role: 'content',
    slideText: '',
    contentTopic: null,
    contentId: `${carouselId}-slide-${order}`,
    channel: 'instagram_feed',
    formatLabel: CHANNEL_LABELS.instagram_feed,
    image: {
      generating: true,
      prompt: '',
      references: [],
      aspectRatio: imageAspectRatioForChannel(),
      dimensions: imageDimensionsForChannel('instagram_feed'),
      mimeType: 'image/png',
      version: 1,
    },
    imageGenerationError: null,
  };
}

// Carrossel avulso — same "separate from organic content" shape as ad
// creatives (no scheduledDate, no approval, no calendar), but 1 JSON holds
// N independently-regenerable slides instead of 1 image. This only builds
// the placeholder skeleton synchronously (fast HTTP response); the actual
// roteiro + per-slide images are filled in by enqueueCarouselGeneration in
// the background — see that function below.
export async function generateCarousel(projectId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const briefing = String(options.briefing || '').trim();
    if (!briefing) throw new Error('Informe o briefing do carrossel.');
    const slideCount = clampCarouselSlideCount(options.slideCount);
    const carouselId = `${project.projectId}-carrossel-${Date.now()}`;
    await mkdir(paths.carouselsDir, { recursive: true });
    const filePath = join(paths.carouselsDir, `${carouselId}.json`);
    const createdAt = new Date().toISOString();
    const carousel = {
      schemaVersion: 1,
      carouselId,
      projectId: project.projectId,
      briefing,
      format: '',
      slideCount,
      slides: Array.from({ length: slideCount }, (_, index) => buildCarouselSlideSkeleton(carouselId, index + 1)),
      outlineGenerationError: null,
      status: 'generating',
      createdAt,
      updatedAt: createdAt,
      filePath,
    };
    await writeJson(filePath, carousel);
    return carousel;
  });
}

export async function listCarousels(projectId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  let files;
  try {
    files = await readdir(paths.carouselsDir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const items = await Promise.all(
    files.filter((name) => name.endsWith('.json')).map((name) => readJson(join(paths.carouselsDir, name)))
  );
  return items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function deleteCarousel(projectId, carouselId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const safeId = String(carouselId || '').replace(/[\\/]/g, '');
    if (!safeId) throw new Error('ID do carrossel inválido.');
    await rm(join(paths.carouselsDir, `${safeId}.json`), { force: true });
    return { deleted: true };
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/content-central.test.js --test-name-pattern="Carousel|carousel"`
Expected: PASS (all 4 new tests)

- [ ] **Step 6: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): add carousel skeleton create/list/delete"
```

---

### Task 2: Backend — roteiro + per-slide image generation pipeline

**Files:**
- Modify: `src/content-central.js` (new block right after Task 1's new functions)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `Carousel`/`CarouselSlide` shapes from Task 1; `generateAiImageWithReviewLoop(content, project, projectId, options)` (`src/content-central.js:5984`); `buildImagePrompt(project, globalRules, contentRules, dayNumber, context)` (`src/content-central.js:5097`); `buildImageReferencePayload(project, paths, options)` (`src/content-central.js:8302`); `getProjectLogoReference(project, paths)` (`src/content-central.js:8326`); `mapWithConcurrency`/`BATCH_IMAGE_CONCURRENCY` (`src/content-central.js:2627`).
- Produces: `enqueueCarouselGeneration(projectId, carousel, options, targetDir): void` — `options.outlineGenerator?: ({ project, briefing, slideCount }) => Promise<{ format: string, slides: { role: string, slideText: string }[] } | null>`, `options.imageGenerator?`, `options.imageReviewer?`, `options.maxCreativeAttempts?`. `regenerateCarouselSlide(projectId, carouselId, slideId, targetDir): Promise<Carousel>`. `enqueueCarouselSlideRegeneration(projectId, carouselId, slideId, options, targetDir): void`.

- [ ] **Step 1: Write the failing tests**

Add to the import block from `'../src/content-central.js'` in `tests/content-central.test.js`:

```js
  enqueueCarouselGeneration,
  regenerateCarouselSlide,
  enqueueCarouselSlideRegeneration,
```

```js
test('enqueueCarouselGeneration fills the roteiro and generates a real image per slide, isolating one slide\'s failure from the rest', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-full', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-full', { briefing: '3 dicas de pizza', slideCount: 3 }, dir);

    let imageCall = 0;
    enqueueCarouselGeneration('carrossel-full', carousel, {
      outlineGenerator: async ({ briefing, slideCount }) => {
        assert.equal(briefing, '3 dicas de pizza');
        assert.equal(slideCount, 3);
        return {
          format: 'listicle',
          slides: [
            { role: 'cover', slideText: '3 dicas de pizza' },
            { role: 'content', slideText: 'Dica 1: use forno bem quente' },
            { role: 'cta', slideText: 'Salve esse post' },
          ],
        };
      },
      imageGenerator: async (payload) => {
        imageCall += 1;
        if (payload.content.contentTopic.objective.includes('Dica 1')) {
          throw new Error('provider timeout');
        }
        return { url: `https://cdn.example.com/slide-${imageCall}.png`, mimeType: 'image/png' };
      },
    }, dir);

    // Fire-and-forget — poll disk for the background pipeline to finish.
    let reloaded;
    for (let i = 0; i < 50; i += 1) {
      reloaded = (await listCarousels('carrossel-full', dir)).find((entry) => entry.carouselId === carousel.carouselId);
      if (reloaded?.status === 'ready') break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }

    assert.equal(reloaded.status, 'ready');
    assert.equal(reloaded.format, 'listicle');
    assert.equal(reloaded.slides[0].slideText, '3 dicas de pizza');
    assert.equal(reloaded.slides[0].role, 'cover');
    assert.equal(reloaded.slides[0].image.url, 'https://cdn.example.com/slide-1.png');
    assert.equal(reloaded.slides[0].imageGenerationError, null);
    assert.match(reloaded.slides[1].imageGenerationError, /provider timeout/);
    assert.equal(reloaded.slides[2].image.url, `https://cdn.example.com/slide-${imageCall}.png`);
    assert.equal(reloaded.slides[2].imageGenerationError, null);
    reloaded.slides.forEach((slide) => assert.equal(slide.image.generating, false));
  });
});

test('enqueueCarouselGeneration records outlineGenerationError and marks every slide errored when the outline is invalid', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-roteiro-falho', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-roteiro-falho', { briefing: 'teste', slideCount: 2 }, dir);

    enqueueCarouselGeneration('carrossel-roteiro-falho', carousel, {
      outlineGenerator: async () => null,
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir);

    let reloaded;
    for (let i = 0; i < 50; i += 1) {
      reloaded = (await listCarousels('carrossel-roteiro-falho', dir)).find((entry) => entry.carouselId === carousel.carouselId);
      if (reloaded?.status === 'ready') break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }

    assert.equal(reloaded.status, 'ready');
    assert.match(reloaded.outlineGenerationError, /roteiro/i);
    reloaded.slides.forEach((slide) => {
      assert.equal(slide.image.generating, false);
      assert.equal(slide.imageGenerationError, reloaded.outlineGenerationError);
    });
  });
});

test('regenerateCarouselSlide and enqueueCarouselSlideRegeneration replace only the target slide\'s image', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-regen', name: 'Boss Pizzaria' }, dir);
    const carousel = await generateCarousel('carrossel-regen', { briefing: 'teste', slideCount: 2 }, dir);
    await new Promise((resolveDone) => {
      enqueueCarouselGeneration('carrossel-regen', carousel, {
        outlineGenerator: async () => ({
          format: 'listicle',
          slides: [{ role: 'cover', slideText: 'Capa' }, { role: 'cta', slideText: 'CTA' }],
        }),
        imageGenerator: async () => ({ url: 'https://cdn.example.com/original.png', mimeType: 'image/png' }),
      }, dir);
      setTimeout(resolveDone, 200);
    });

    const before = (await listCarousels('carrossel-regen', dir))[0];
    const targetSlideId = before.slides[0].slideId;

    const refreshed = await regenerateCarouselSlide('carrossel-regen', before.carouselId, targetSlideId, dir);
    assert.equal(refreshed.slides.find((s) => s.slideId === targetSlideId).image.url, 'https://cdn.example.com/original.png', 'regenerateCarouselSlide only refreshes references, image unchanged until enqueue runs');

    enqueueCarouselSlideRegeneration('carrossel-regen', before.carouselId, targetSlideId, {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/regenerated.png', mimeType: 'image/png' }),
    }, dir);

    let reloaded;
    for (let i = 0; i < 50; i += 1) {
      reloaded = (await listCarousels('carrossel-regen', dir))[0];
      const slide = reloaded.slides.find((s) => s.slideId === targetSlideId);
      if (slide?.image.url === 'https://cdn.example.com/regenerated.png' && !slide.image.generating) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }

    const changedSlide = reloaded.slides.find((s) => s.slideId === targetSlideId);
    const untouchedSlide = reloaded.slides.find((s) => s.slideId !== targetSlideId);
    assert.equal(changedSlide.image.url, 'https://cdn.example.com/regenerated.png');
    assert.equal(untouchedSlide.image.url, 'https://cdn.example.com/original.png', 'the other slide must be untouched');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central.test.js --test-name-pattern="enqueueCarouselGeneration|regenerateCarouselSlide"`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement the generation pipeline**

In `src/content-central.js`, directly after `deleteCarousel` from Task 1, add:

```js
function buildCarouselSlideContentTopic({ project, order, slideCount, slideText }) {
  return {
    id: `carousel-slide-${order}`,
    type: 'institutional',
    label: `Carrossel — slide ${order}/${slideCount}`,
    source: 'carousel',
    price: '',
    items: '',
    cta: '',
    autoGenerateCta: false,
    notes: '',
    objective: `Slide ${order} de ${slideCount} de um carrossel para ${project.name}. ${slideText}`,
  };
}

// Fills in the real prompt/references for one slide and runs the actual AI
// image generation, same shape as enrichAdCreativeWithRealImage — a failure
// is recorded on the slide instead of thrown, so one bad slide never takes
// down the rest of the carousel (see runCarouselGeneration's concurrency
// loop below).
async function enrichCarouselSlideWithRealImage(carousel, slide, project, projectId, paths, options) {
  if (typeof options.imageGenerator !== 'function') {
    slide.image.generating = false;
    await writeJson(carousel.filePath, carousel);
    return;
  }
  slide.image.prompt = buildImagePrompt(project, [], [], slide.order, {
    channel: slide.channel,
    contentTopic: slide.contentTopic,
    logoReference: getProjectLogoReference(project, paths),
  });
  slide.image.references = await buildImageReferencePayload(project, paths, { channel: slide.channel, topic: slide.contentTopic });
  try {
    await generateAiImageWithReviewLoop(slide, project, projectId, {
      imageGenerator: options.imageGenerator,
      imageReviewer: options.imageReviewer,
      channel: slide.channel,
      maxAttempts: options.maxCreativeAttempts,
    });
    slide.imageGenerationError = null;
  } catch (err) {
    slide.imageGenerationError = err.message;
  }
  slide.image.generating = false;
  await writeJson(carousel.filePath, carousel);
}

// Full pipeline for a freshly created carousel: roteiro first (decides
// slideText/role/format for every slide), then 1 real image per slide in
// bounded parallel. All 3 workers below share the same in-memory `carousel`
// object (mutating different slides[i]) — every writeJson call serializes
// the current full object, so concurrent writes are safe (no partial file,
// last write always reflects the freshest combined state; Node has no
// thread-level race on the same in-memory object).
async function runCarouselGeneration(carousel, project, projectId, options, paths) {
  let outline = null;
  if (typeof options.outlineGenerator === 'function') {
    try {
      outline = await options.outlineGenerator({ project, briefing: carousel.briefing, slideCount: carousel.slideCount });
    } catch (err) {
      carousel.outlineGenerationError = err.message;
    }
  }
  const validOutline = outline && Array.isArray(outline.slides) && outline.slides.length === carousel.slideCount;
  if (!validOutline) {
    if (!carousel.outlineGenerationError) {
      carousel.outlineGenerationError = 'O roteirista de IA não retornou um roteiro válido para este carrossel (resposta vazia ou incompleta). Apague e gere de novo para tentar outra vez.';
    }
    for (const slide of carousel.slides) {
      slide.image.generating = false;
      slide.imageGenerationError = carousel.outlineGenerationError;
    }
    carousel.status = 'ready';
    await writeJson(carousel.filePath, carousel);
    return;
  }

  carousel.format = outline.format || '';
  carousel.slides.forEach((slide, index) => {
    const outlineSlide = outline.slides[index];
    slide.role = outlineSlide.role || 'content';
    slide.slideText = outlineSlide.slideText || '';
    slide.contentTopic = buildCarouselSlideContentTopic({
      project,
      order: slide.order,
      slideCount: carousel.slideCount,
      slideText: slide.slideText,
    });
  });
  await writeJson(carousel.filePath, carousel);

  await mapWithConcurrency(carousel.slides, BATCH_IMAGE_CONCURRENCY, (slide) => (
    enrichCarouselSlideWithRealImage(carousel, slide, project, projectId, paths, options)
  ));

  carousel.status = 'ready';
  await writeJson(carousel.filePath, carousel);
}

// Fire-and-forget dispatch for the route handler — the request that created
// the carousel has already responded with the placeholder by the time this
// runs; the panel polls listCarousels for progress, same pattern as
// enqueueAdCreativeImageGeneration.
export function enqueueCarouselGeneration(projectId, carousel, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  loadProject(paths)
    .then((project) => runCarouselGeneration(carousel, project, projectId, options, paths))
    .catch((err) => {
      console.error(`[content-central] background carousel generation failed for ${projectId}/${carousel.carouselId}:`, err.message);
    });
}

// "Regenerar esse slide" — refreshes just that slide's image references
// (references can change if the project's reference library changed since
// the carousel was generated, same reasoning as regenerateAdCreative).
// Roteiro and every other slide stay untouched. The actual re-generation is
// kicked off separately by enqueueCarouselSlideRegeneration below, same
// two-step shape as regenerateAdCreative + enqueueAdCreativeImageGeneration.
export async function regenerateCarouselSlide(projectId, carouselId, slideId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const safeId = String(carouselId || '').replace(/[\\/]/g, '');
    if (!safeId) throw new Error('ID do carrossel inválido.');
    const filePath = join(paths.carouselsDir, `${safeId}.json`);
    const carousel = await readJson(filePath);
    const slide = carousel.slides.find((entry) => entry.slideId === slideId);
    if (!slide) throw new Error('Slide não encontrado.');
    if (slide.contentTopic) {
      slide.image.references = await buildImageReferencePayload(project, paths, { channel: slide.channel, topic: slide.contentTopic });
    }
    await writeJson(filePath, carousel);
    return carousel;
  });
}

export function enqueueCarouselSlideRegeneration(projectId, carouselId, slideId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  const safeId = String(carouselId || '').replace(/[\\/]/g, '');
  loadProject(paths)
    .then(async (project) => {
      const filePath = join(paths.carouselsDir, `${safeId}.json`);
      const carousel = await readJson(filePath);
      const slide = carousel.slides.find((entry) => entry.slideId === slideId);
      if (!slide) throw new Error('Slide não encontrado.');
      slide.image.generating = true;
      await writeJson(filePath, carousel);
      await enrichCarouselSlideWithRealImage(carousel, slide, project, projectId, paths, options);
    })
    .catch((err) => {
      console.error(`[content-central] background carousel slide regeneration failed for ${projectId}/${carouselId}/${slideId}:`, err.message);
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central.test.js --test-name-pattern="enqueueCarouselGeneration|regenerateCarouselSlide"`
Expected: PASS (all 3 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): generate carousel roteiro + per-slide images, with per-slide regenerate"
```

---

### Task 3: Server — roteiro AI prompt + generator wiring

**Files:**
- Modify: `src/content-central-server.js` (new block next to `buildAdCopyPrompt`/`writeAdCopyVariationsWithHermes`, currently `src/content-central-server.js:4056-4133`; options/context block at `src/content-central-server.js:341-382`)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: `callAiText(prompt, timeoutEnvVar)` (`src/content-central-server.js:3746`); `contentCentralPersonaLine`/`contentCentralPersonaResponsibilityLine` (imported from `./content-central-personas.js`).
- Produces: `buildCarouselOutlinePrompt({ project, briefing, slideCount, formatsReference }): string` (exported, for direct unit testing); `context.carouselOutlineGenerator: ({ project, briefing, slideCount }) => Promise<{ format, slides } | null>` available on the server's `context` object, matching the shape Task 2's `options.outlineGenerator` expects.

- [ ] **Step 1: Write the failing test**

Add near the top of `tests/content-central-server.test.js`, wherever `buildAdCopyPrompt` (if imported/tested there) or similar prompt-builder tests live — otherwise add to `tests/content-central.test.js`'s import list is wrong since this function lives in the server file; add a new small test block in `tests/content-central-server.test.js`, importing `buildCarouselOutlinePrompt` from `'../src/content-central-server.js'`:

```js
test('buildCarouselOutlinePrompt embeds the briefing, the requested slide count, and the instagram-feed.md formats reference verbatim', () => {
  const prompt = buildCarouselOutlinePrompt({
    project: { name: 'Boss Pizzaria', brandInput: { segment: 'Pizzaria' } },
    briefing: '5 dicas de pizza',
    slideCount: 5,
    formatsReference: 'CONTEUDO-DE-REFERENCIA-UNICO-12345',
  });

  assert.match(prompt, /5 dicas de pizza/);
  assert.match(prompt, /exatamente 5 slides/);
  assert.match(prompt, /CONTEUDO-DE-REFERENCIA-UNICO-12345/);
  assert.match(prompt, /Boss Pizzaria/);
  assert.match(prompt, /"format"/);
  assert.match(prompt, /"slideText"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central-server.test.js --test-name-pattern="buildCarouselOutlinePrompt"`
Expected: FAIL — `buildCarouselOutlinePrompt is not a function` (or import error).

- [ ] **Step 3: Implement the prompt builder, the Hermes caller, and the context wiring**

In `src/content-central-server.js`, directly after `writeAdCopyVariationsWithHermes` (currently ends at line 4133), add:

```js
// Reads the same carousel-format knowledge squads already use
// (_opensquad/core/best-practices/instagram-feed.md) as prompt reference —
// read from disk, never duplicated/hardcoded here. Missing file (e.g. a
// stripped-down deployment) degrades gracefully: the AI still writes a
// carousel, just without the format-specific slide-flow guidance.
async function readCarouselFormatsReference(targetDir) {
  try {
    return await readFile(join(targetDir, '_opensquad', 'core', 'best-practices', 'instagram-feed.md'), 'utf-8');
  } catch {
    return '';
  }
}

export function buildCarouselOutlinePrompt({ project, briefing, slideCount, formatsReference }) {
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
    '',
    `Gere exatamente ${slideCount} slides, cobrindo capa (role "cover"), conteúdo (role "content") e fechamento com CTA (role "cta"), na proporção que o formato escolhido pedir.`,
    'Cada "slideText" é o texto final daquele slide (headline + texto de apoio, prontos para virar a peça visual) — nunca uma instrução ou descrição do que desenhar.',
    '- Nunca inventar preço, promoção, prazo, estoque, depoimento ou dado que não foi passado no briefing.',
    '',
    'Responda APENAS com um JSON válido, sem markdown e sem texto fora do JSON, neste formato exato:',
    `{"format":"listicle","slides":[{"role":"cover","slideText":""}]}  // "slides" deve ter exatamente ${slideCount} itens, na ordem de exibição`,
  ].filter(Boolean).join('\n');
}

async function writeCarouselOutlineWithHermes({ project, briefing, slideCount, targetDir }) {
  const formatsReference = await readCarouselFormatsReference(targetDir);
  const raw = await callAiText(buildCarouselOutlinePrompt({ project, briefing, slideCount, formatsReference }), 'OPENSQUAD_COPY_TIMEOUT_MS');
  if (!raw) return null;
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.slides)) return null;
  const slides = parsed.slides
    .map((entry) => ({
      role: ['cover', 'content', 'cta'].includes(entry?.role) ? entry.role : 'content',
      slideText: String(entry?.slideText || '').trim(),
    }))
    .filter((entry) => entry.slideText);
  if (slides.length !== slideCount) return null;
  return { format: String(parsed.format || '').trim(), slides };
}
```

Then wire it into the server's options/context. In `startContentCentralServer`'s options destructure (`src/content-central-server.js:341-362`), add a new param next to `adCopyGenerator`:

```js
  adCopyGenerator = null,
  carouselOutlineGenerator = null,
```

And in the `context` object (`src/content-central-server.js:365-382`), add next to the `adCopyGenerator` entry:

```js
    adCopyGenerator: adCopyGenerator || (enableAiImages ? writeAdCopyVariationsWithHermes : null),
    carouselOutlineGenerator: carouselOutlineGenerator || (enableAiImages ? (payload) => writeCarouselOutlineWithHermes({ ...payload, targetDir }) : null),
```

Finally, import the 6 new `content-central.js` functions this whole feature needs (used by Task 4's routes) into the existing import block (`src/content-central-server.js:63-72`, next to the ad-creative imports):

```js
  deleteAdCreative,
  enqueueAdCreativeImageGeneration,
  generateAdCreative,
  regenerateAdCreative,
  deleteCarousel,
  enqueueCarouselGeneration,
  enqueueCarouselSlideRegeneration,
  generateCarousel,
  listCarousels,
  regenerateCarouselSlide,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/content-central-server.test.js --test-name-pattern="buildCarouselOutlinePrompt"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat(content-central-server): add carousel outline prompt + Hermes generator wiring"
```

---

### Task 4: Server — HTTP routes

**Files:**
- Modify: `src/content-central-server.js` (GET routes block around line 715-717; POST routes block around line 1101-1156)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: everything Task 1-3 produced (`generateCarousel`, `listCarousels`, `deleteCarousel`, `enqueueCarouselGeneration`, `regenerateCarouselSlide`, `enqueueCarouselSlideRegeneration`, `context.imageGenerator`, `context.imageReviewer`, `context.carouselOutlineGenerator`); `withServer`/`request` test helpers already used by the ad-creatives route tests.
- Produces: `GET /api/projects/:id/carousels` → `{ carousels }`; `POST /api/projects/:id/carousels` → `{ carousel }` (201); `POST /api/projects/:id/carousels-delete/:carouselId` → `{ deleted: true }`; `POST /api/projects/:id/carousels-regenerate-slide/:carouselId/:slideId` → `{ carousel }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/content-central-server.test.js`, near the existing ad-creatives route tests (around line 4190-4254):

```js
test('POST carousels creates a placeholder immediately and the background pipeline fills in the roteiro + real images', async () => {
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'carrossel-http', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
      });

      const generated = await request(server, '/api/projects/carrossel-http/carousels', {
        method: 'POST',
        body: JSON.stringify({ briefing: '3 dicas de pizza', slideCount: 3 }),
      });
      assert.equal(generated.response.status, 201);
      assert.equal(generated.body.carousel.slideCount, 3);
      assert.equal(generated.body.carousel.status, 'generating');

      const carouselId = generated.body.carousel.carouselId;
      let finalCarousel;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/carrossel-http/carousels');
        finalCarousel = body.carousels.find((entry) => entry.carouselId === carouselId);
        if (finalCarousel?.status === 'ready') break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }

      assert.equal(finalCarousel.status, 'ready');
      assert.equal(finalCarousel.format, 'listicle');
      assert.equal(finalCarousel.slides.length, 3);
      finalCarousel.slides.forEach((slide) => {
        assert.equal(slide.image.generating, false);
        assert.equal(slide.image.url, 'https://cdn.example.com/carrossel.png');
      });
    },
    {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/carrossel.png', mimeType: 'image/png' }),
      carouselOutlineGenerator: async ({ slideCount }) => ({
        format: 'listicle',
        slides: Array.from({ length: slideCount }, (_, index) => ({
          role: index === 0 ? 'cover' : index === slideCount - 1 ? 'cta' : 'content',
          slideText: `Slide ${index + 1}`,
        })),
      }),
    },
  );
});

test('carousels-delete removes it from the listing, and carousels-regenerate-slide replaces only the target slide', async () => {
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'carrossel-http-2', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
      });
      const generated = await request(server, '/api/projects/carrossel-http-2/carousels', {
        method: 'POST',
        body: JSON.stringify({ briefing: 'teste', slideCount: 2 }),
      });
      const carouselId = generated.body.carousel.carouselId;

      let ready;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/carrossel-http-2/carousels');
        ready = body.carousels.find((entry) => entry.carouselId === carouselId);
        if (ready?.status === 'ready') break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      const targetSlideId = ready.slides[0].slideId;
      const otherSlideId = ready.slides[1].slideId;

      const regenerated = await request(server, `/api/projects/carrossel-http-2/carousels-regenerate-slide/${carouselId}/${targetSlideId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      assert.equal(regenerated.response.status, 200);

      let final;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/carrossel-http-2/carousels');
        final = body.carousels.find((entry) => entry.carouselId === carouselId);
        const slide = final.slides.find((s) => s.slideId === targetSlideId);
        if (slide?.image.url === 'https://cdn.example.com/regen.png' && !slide.image.generating) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      assert.equal(final.slides.find((s) => s.slideId === targetSlideId).image.url, 'https://cdn.example.com/regen.png');
      assert.equal(final.slides.find((s) => s.slideId === otherSlideId).image.url, 'https://cdn.example.com/original.png');

      const deleted = await request(server, `/api/projects/carrossel-http-2/carousels-delete/${carouselId}`, { method: 'POST' });
      assert.equal(deleted.response.status, 200);
      const { body: afterDelete } = await request(server, '/api/projects/carrossel-http-2/carousels');
      assert.equal(afterDelete.carousels.length, 0);
    },
    {
      // Task 2's regenerate path never sends a `note` — unlike ad creatives,
      // there's no edit-note UI for a carousel slide in this plan (it's a
      // plain "regenerate this slide" click). So the original-vs-regenerated
      // image is distinguished by call order instead: the 2 slides from
      // `POST carousels` are calls 1-2 (concurrency 2, but both resolve
      // synchronously here so call order is still deterministic array
      // order), and the later `carousels-regenerate-slide` call is always
      // call 3.
      imageGenerator: (() => {
        let call = 0;
        return async () => {
          call += 1;
          return {
            url: call <= 2 ? 'https://cdn.example.com/original.png' : 'https://cdn.example.com/regen.png',
            mimeType: 'image/png',
          };
        };
      })(),
      carouselOutlineGenerator: async ({ slideCount }) => ({
        format: 'listicle',
        slides: Array.from({ length: slideCount }, (_, index) => ({ role: 'content', slideText: `Slide ${index + 1}` })),
      }),
    },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central-server.test.js --test-name-pattern="carousel"`
Expected: FAIL — 404 (route not found) or similar.

- [ ] **Step 3: Add the routes**

In `src/content-central-server.js`, in the GET routes block, directly after the existing `ad-creatives` GET route (line 715-717):

```js
  if (method === 'GET' && parts.length === 4 && parts[3] === 'carousels') {
    return sendJson(res, 200, { carousels: await listCarousels(projectId, targetDir) });
  }
```

In the POST routes block, directly after the existing `ad-creatives-regenerate` route (ends at line 1156):

```js
  // Carrossel avulso — separate from every organic/ad-creative route above:
  // no scheduledDate, no approval, no calendar, no publish. 1 briefing + N
  // slide count in, N independently-regenerable slides out.
  if (parts.length === 4 && parts[3] === 'carousels') {
    const body = await readBody(req);
    const briefing = String(body.briefing || '').trim();
    if (!briefing) return sendJson(res, 400, { error: 'Informe o briefing do carrossel.' });
    const carousel = await generateCarousel(projectId, { briefing, slideCount: body.slideCount }, targetDir);
    enqueueCarouselGeneration(projectId, carousel, {
      imageGenerator: context.imageGenerator,
      imageReviewer: context.imageReviewer,
      outlineGenerator: context.carouselOutlineGenerator,
    }, targetDir);
    return sendJson(res, 201, { carousel });
  }

  if (parts.length === 5 && parts[3] === 'carousels-delete') {
    await deleteCarousel(projectId, parts[4], targetDir);
    return sendJson(res, 200, { deleted: true });
  }

  if (parts.length === 6 && parts[3] === 'carousels-regenerate-slide') {
    const carousel = await regenerateCarouselSlide(projectId, parts[4], parts[5], targetDir);
    enqueueCarouselSlideRegeneration(projectId, parts[4], parts[5], {
      imageGenerator: context.imageGenerator,
      imageReviewer: context.imageReviewer,
    }, targetDir);
    return sendJson(res, 200, { carousel });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central-server.test.js --test-name-pattern="carousel"`
Expected: PASS (both new tests)

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat(content-central-server): add carousel HTTP routes"
```

---

### Task 5: Frontend — API client

**Files:**
- Modify: `content-central-app/src/api/client.ts` (new block next to the `AdCreative` block, `content-central-app/src/api/client.ts:660-749`)

**Interfaces:**
- Produces: `Carousel`, `CarouselSlide` TS interfaces; `listCarousels(projectId): Promise<{ carousels: Carousel[] }>`; `generateCarousel(projectId, input: { briefing: string; slideCount: number }): Promise<{ carousel: Carousel }>`; `regenerateCarouselSlide(projectId, carouselId, slideId): Promise<{ carousel: Carousel }>`; `deleteCarousel(projectId, carouselId): Promise<{ deleted: boolean }>`.

This task has no independent runtime behavior to test (it's typed fetch wrappers, exactly like the existing `AdCreative` ones which have no dedicated unit tests either — they're exercised through the page's tests in Task 7). Write it directly, no separate test step.

- [ ] **Step 1: Add the types and functions**

In `content-central-app/src/api/client.ts`, directly after `deleteAdCreative` (currently ends at line 749), add:

```ts
// Carrossel avulso — same "separate from organic content" shape as
// AdCreative: no scheduledDate, no approval, no calendar. 1 carousel holds
// N independently-regenerable slides instead of 1 image.
export interface CarouselSlide {
  slideId: string;
  order: number;
  role: "cover" | "content" | "cta";
  slideText: string;
  image: {
    url?: string;
    previewUrl?: string;
    generating?: boolean;
    aspectRatio?: string;
    dimensions?: { width: number; height: number };
  };
  imageGenerationError: string | null;
}

export interface Carousel {
  carouselId: string;
  projectId: string;
  briefing: string;
  format: string;
  slideCount: number;
  slides: CarouselSlide[];
  outlineGenerationError: string | null;
  status: "generating" | "ready";
  createdAt: string;
  updatedAt: string;
}

export function listCarousels(projectId: string): Promise<{ carousels: Carousel[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels`);
}

export interface GenerateCarouselInput {
  briefing: string;
  slideCount: number;
}

export function generateCarousel(
  projectId: string,
  input: GenerateCarouselInput,
): Promise<{ carousel: Carousel }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function regenerateCarouselSlide(
  projectId: string,
  carouselId: string,
  slideId: string,
): Promise<{ carousel: Carousel }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels-regenerate-slide/${encodeURIComponent(carouselId)}/${encodeURIComponent(slideId)}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function deleteCarousel(projectId: string, carouselId: string): Promise<{ deleted: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/carousels-delete/${encodeURIComponent(carouselId)}`, {
    method: "POST",
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd content-central-app && npm run build`
Expected: PASS, no TypeScript errors (per this project's known gotcha: `tsc --noEmit` alone silently checks nothing here — always use `npm run build`).

- [ ] **Step 3: Commit**

```bash
git add content-central-app/src/api/client.ts
git commit -m "feat(content-central-app): add carousel API client functions"
```

---

### Task 6: Frontend — Carousels page

**Files:**
- Create: `content-central-app/src/pages/workspace/Carousels.tsx`
- Create: `content-central-app/src/pages/workspace/Carousels.module.css`

**Interfaces:**
- Consumes: `Carousel`, `CarouselSlide`, `listCarousels`, `generateCarousel`, `regenerateCarouselSlide`, `deleteCarousel` from Task 5; `WorkspaceContext` from `@/layouts/ProjectWorkspaceLayout`; `Button`, `Card`, `EmptyState`, `ImageLightbox`, `Skeleton` from `@/components/*` (same imports `AdCreatives.tsx` uses).
- Produces: `export function Carousels()` — a React component, wired into routing by Task 7.

This task's behavior is fully covered by Task 7's `Carousels.test.tsx` (mirroring how `AdCreatives.tsx` has no separate unit test file — it's tested through `AdCreatives.test.tsx` at the routed-page level). Write the component directly; Task 7 verifies it.

- [ ] **Step 1: Write `Carousels.module.css`**

```css
.list {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.card {
  padding: 20px;
}

.slideGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.slide {
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}

.slidePhoto {
  position: relative;
  aspect-ratio: 4 / 5;
  background: #050506;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  padding: 8px;
}

.slidePhoto img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.slideFooter {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slideRole {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
```

- [ ] **Step 2: Write `Carousels.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  deleteCarousel,
  generateCarousel,
  listCarousels,
  regenerateCarouselSlide,
  type Carousel,
  type CarouselSlide,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Skeleton } from "@/components/Skeleton";
import styles from "./Carousels.module.css";

const ROLE_LABELS: Record<CarouselSlide["role"], string> = {
  cover: "Capa",
  content: "Conteúdo",
  cta: "CTA",
};

function slideSource(slide: CarouselSlide): string | null {
  return slide.image.url || slide.image.previewUrl || null;
}

interface SlideActionState {
  busy: boolean;
  error: string | null;
}

const IDLE_SLIDE_STATE: SlideActionState = { busy: false, error: null };

export function Carousels() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [carousels, setCarousels] = useState<Carousel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState("");
  const [slideCount, setSlideCount] = useState(6);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [slideState, setSlideState] = useState<Record<string, SlideActionState>>({});
  const [preview, setPreview] = useState<{ src: string; title: string; fileName: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listCarousels(project.projectId);
      setCarousels(data.carousels);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [project.projectId]);

  useEffect(() => {
    setCarousels(null);
    refresh();
  }, [refresh]);

  // Roteiro + images finish in the background — poll while any carousel is
  // still generating, same pattern as AdCreatives.
  useEffect(() => {
    if (!carousels?.some((entry) => entry.status === "generating")) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [carousels, refresh]);

  function stateFor(slideId: string): SlideActionState {
    return slideState[slideId] || IDLE_SLIDE_STATE;
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await generateCarousel(project.projectId, { briefing, slideCount });
      setBriefing("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(carouselId: string) {
    if (!confirm("Apagar este carrossel?")) return;
    setDeletingId(carouselId);
    try {
      await deleteCarousel(project.projectId, carouselId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRegenerateSlide(carouselId: string, slideId: string) {
    setSlideState((current) => ({ ...current, [slideId]: { busy: true, error: null } }));
    try {
      await regenerateCarouselSlide(project.projectId, carouselId, slideId);
      await refresh();
      setSlideState((current) => ({ ...current, [slideId]: IDLE_SLIDE_STATE }));
    } catch (err) {
      setSlideState((current) => ({ ...current, [slideId]: { busy: false, error: (err as Error).message } }));
    }
  }

  if (!carousels) {
    return <Skeleton height={200} />;
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-xs)" }}>Carrossel</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        Carrossel avulso — separado da agenda orgânica: sem calendário, sem aprovação. Escreva o tema e escolha
        quantas folhas; a IA escreve o roteiro e gera 1 imagem por folha.
      </p>

      <Card style={{ padding: 20 }}>
        <label htmlFor="carousel-briefing">Tema do carrossel</label>
        <textarea
          id="carousel-briefing"
          placeholder="Ex: 5 dicas para escolher a pizza certa"
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
        />
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
          onClick={handleGenerate}
        >
          {generating ? "Gerando carrossel..." : "Gerar carrossel"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>

      {carousels.length === 0 ? (
        <div style={{ marginTop: 20 }}>
          <EmptyState title="Nenhum carrossel ainda" description="Gere o primeiro usando o formulário acima." />
        </div>
      ) : (
        <div className={styles.list}>
          {carousels.map((carousel) => (
            <Card key={carousel.carouselId} className={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>{carousel.briefing}</h3>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {carousel.format ? <span className="pill">{carousel.format}</span> : null}
                  <span className="pill">{carousel.slideCount} folhas</span>
                </div>
              </div>
              {carousel.outlineGenerationError ? (
                <div className="pill bad" style={{ marginTop: 8 }}>⚠ {carousel.outlineGenerationError}</div>
              ) : null}

              <div className={styles.slideGrid}>
                {carousel.slides.map((slide) => {
                  const src = slideSource(slide);
                  const state = stateFor(slide.slideId);
                  return (
                    <div key={slide.slideId} className={styles.slide}>
                      <div className={styles.slidePhoto}>
                        {src ? (
                          <img
                            src={src}
                            alt={slide.slideText || `Slide ${slide.order}`}
                            loading="lazy"
                            onClick={() => setPreview({ src, title: slide.slideText || `Slide ${slide.order}`, fileName: `${slide.slideId}.png` })}
                          />
                        ) : slide.image.generating ? (
                          <span>Gerando imagem...</span>
                        ) : (
                          <span>Sem imagem ainda</span>
                        )}
                      </div>
                      <div className={styles.slideFooter}>
                        <span className={styles.slideRole}>{ROLE_LABELS[slide.role]}</span>
                        {slide.imageGenerationError ? (
                          <div className="pill bad">⚠ {slide.imageGenerationError}</div>
                        ) : null}
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={state.busy || slide.image.generating}
                          onClick={() => handleRegenerateSlide(carousel.carouselId, slide.slideId)}
                        >
                          {state.busy ? "Regenerando..." : "Regenerar esse slide"}
                        </Button>
                        {state.error ? <div className="pill bad">{state.error}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.actions}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={deletingId === carousel.carouselId}
                  onClick={() => handleDelete(carousel.carouselId)}
                >
                  {deletingId === carousel.carouselId ? "Apagando..." : "Apagar"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {preview ? (
        <ImageLightbox
          src={preview.src}
          alt={preview.title}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd content-central-app && npm run build`
Expected: PASS, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add content-central-app/src/pages/workspace/Carousels.tsx content-central-app/src/pages/workspace/Carousels.module.css
git commit -m "feat(content-central-app): add Carousels page"
```

---

### Task 7: Frontend — routing, nav entry, and page tests

**Files:**
- Modify: `content-central-app/src/App.tsx`
- Modify: `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx:17-29`
- Create: `content-central-app/src/pages/workspace/Carousels.test.tsx`

**Interfaces:**
- Consumes: `Carousels` component from Task 6.

- [ ] **Step 1: Write the failing tests**

Create `content-central-app/src/pages/workspace/Carousels.test.tsx`:

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
      return Promise.resolve({
        ok: response.ok !== false,
        text: async () => JSON.stringify(response.body),
      });
    }),
  );
}

function projectState() {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [] } }],
    globalRules: {},
  };
}

function renderCarousels() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/carrossel"]}>
      <App />
    </MemoryRouter>,
  );
}

const CAROUSEL_FIXTURE = {
  carouselId: "boss-pizzaria-carrossel-1",
  projectId: "boss-pizzaria",
  briefing: "5 dicas de pizza",
  format: "listicle",
  slideCount: 2,
  slides: [
    {
      slideId: "boss-pizzaria-carrossel-1-slide-1",
      order: 1,
      role: "cover",
      slideText: "5 dicas de pizza",
      image: { url: "/api/projects/boss-pizzaria/assets/assets/generated/slide1.png", generating: false },
      imageGenerationError: null,
    },
    {
      slideId: "boss-pizzaria-carrossel-1-slide-2",
      order: 2,
      role: "cta",
      slideText: "Salve esse post",
      image: { url: "/api/projects/boss-pizzaria/assets/assets/generated/slide2.png", generating: false },
      imageGenerationError: null,
    },
  ],
  outlineGenerationError: null,
  status: "ready",
  createdAt: "2026-08-26T12:00:00.000Z",
  updatedAt: "2026-08-26T12:00:00.000Z",
};

describe("Carousels", () => {
  it("shows an empty state when no carousel has been generated yet", async () => {
    stubFetchSequence([{ body: projectState() }, { body: { carousels: [] } }]);
    renderCarousels();

    expect(await screen.findByRole("heading", { name: "Carrossel" })).toBeInTheDocument();
    expect(await screen.findByText("Nenhum carrossel ainda")).toBeInTheDocument();
  });

  it("generates a new carousel with the typed briefing and slide count through the real endpoint", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [] } },
      { body: { carousel: CAROUSEL_FIXTURE } },
      { body: { carousels: [CAROUSEL_FIXTURE] } },
    ]);
    renderCarousels();

    await screen.findByText("Nenhum carrossel ainda");
    await userEvent.type(screen.getByLabelText("Tema do carrossel"), "5 dicas de pizza");
    await userEvent.clear(screen.getByLabelText("Quantidade de folhas"));
    await userEvent.type(screen.getByLabelText("Quantidade de folhas"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Gerar carrossel" }));

    expect(await screen.findByText("5 dicas de pizza")).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const generateCall = calls.find(([url, options]) => url === "/api/projects/boss-pizzaria/carousels" && options?.method === "POST");
    expect(generateCall).toBeTruthy();
    expect(JSON.parse(generateCall![1].body as string)).toEqual({ briefing: "5 dicas de pizza", slideCount: 2 });
  });

  it("shows every slide with its role, regenerates one slide through the real endpoint, and deletes the carousel", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const regeneratedSlide = { ...CAROUSEL_FIXTURE.slides[0], image: { url: "/api/projects/boss-pizzaria/assets/assets/generated/slide1-novo.png", generating: false } };
    const regeneratedCarousel = { ...CAROUSEL_FIXTURE, slides: [regeneratedSlide, CAROUSEL_FIXTURE.slides[1]] };

    stubFetchSequence([
      { body: projectState() },
      { body: { carousels: [CAROUSEL_FIXTURE] } },
      { body: { carousel: regeneratedCarousel } },
      { body: { carousels: [regeneratedCarousel] } },
      { body: { deleted: true } },
      { body: { carousels: [] } },
    ]);
    renderCarousels();

    expect(await screen.findByText("Capa")).toBeInTheDocument();
    expect(screen.getByText("CTA")).toBeInTheDocument();

    const regenerateButtons = screen.getAllByRole("button", { name: "Regenerar esse slide" });
    await userEvent.click(regenerateButtons[0]);

    let calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const regenerateCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/carousels-regenerate-slide/boss-pizzaria-carrossel-1/boss-pizzaria-carrossel-1-slide-1");
    expect(regenerateCall).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(await screen.findByText("Nenhum carrossel ainda")).toBeInTheDocument();
    calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const deleteCall = calls.find(([url]) => url === "/api/projects/boss-pizzaria/carousels-delete/boss-pizzaria-carrossel-1");
    expect(deleteCall).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd content-central-app && npm test -- Carousels.test.tsx`
Expected: FAIL — route `/projects/boss-pizzaria/carrossel` renders nothing matching (404/redirect), nav entry missing.

- [ ] **Step 3: Wire the route and nav entry**

In `content-central-app/src/App.tsx`, add the import next to `AdCreatives`:

```tsx
import { Carousels } from "@/pages/workspace/Carousels";
```

And the route, next to `anuncios` (`content-central-app/src/App.tsx:54`):

```tsx
          <Route path="anuncios" element={<AdCreatives />} />
          <Route path="carrossel" element={<Carousels />} />
```

In `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`, add the nav entry next to `anuncios` (`content-central-app/src/layouts/ProjectWorkspaceLayout.tsx:24`):

```tsx
  { to: "anuncios", label: "Criativos de Anúncio", group: "Conteúdo" },
  { to: "carrossel", label: "Carrossel", group: "Conteúdo" },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd content-central-app && npm test -- Carousels.test.tsx`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Run the full frontend test suite and build to check for regressions**

Run: `cd content-central-app && npm test && npm run build`
Expected: PASS — no existing test broken by the new route/nav entry.

- [ ] **Step 6: Commit**

```bash
git add content-central-app/src/App.tsx content-central-app/src/layouts/ProjectWorkspaceLayout.tsx content-central-app/src/pages/workspace/Carousels.test.tsx
git commit -m "feat(content-central-app): wire Carousels tab into routing and nav"
```

---

## Final verification

After all 7 tasks:

- [ ] Run: `node --test tests/content-central.test.js tests/content-central-server.test.js` — full backend suite passes.
- [ ] Run: `cd content-central-app && npm test` — full frontend suite passes.
- [ ] Run: `cd content-central-app && npm run build` — no TypeScript errors.
- [ ] Manually confirm the spec's out-of-scope list is still true: no route or code path in this diff touches `skills/instagram-publisher`, publishing, scheduling, or approval.
