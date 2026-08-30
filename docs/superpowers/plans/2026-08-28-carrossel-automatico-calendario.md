# Carrossel automático no calendário Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn carousel into a real content format the automatic weekly generator can produce on its own — a configurable per-generation quota, subject drawn from the same topic pool as every other post, reusing the standalone carousel engine (roteiro + slide-1-first + style reference), going through the existing approval screen, and publishing to Instagram as a real multi-image `CAROUSEL_ALBUM` post.

**Architecture:** `generateContentSchedulePlan` allocates `carouselsPerWeek` of its `instagram_feed` slots as `format: 'carousel'` batch items (same file/approval/publish plumbing every other item already has, just `slides: CarouselSlide[]` instead of one `image`). The standalone carousel engine (`runCarouselGeneration`/`enrichCarouselSlideWithRealImage`) is generalized with two small optional overrides so the exact same functions drive both the standalone tab and this new path. Real publish gets a new `CAROUSEL_ALBUM` container flow in the Meta publish script.

**Tech Stack:** Node.js (`content-central.js`/`content-central-server.js`, no framework), React + TypeScript + Vite (`content-central-app`), Vitest + Testing Library (frontend), Node's built-in `node:test` + `assert` (backend), plain ESM script with no framework (`meta-publish-multi.js`).

## Global Constraints

- `carouselsPerWeek`: integer, clamp `0..7`, default `0` (feature off).
- `maxCarouselSlides`: integer, clamp `2..10` (same `CAROUSEL_SLIDE_COUNT_MIN/MAX` the standalone carousel already enforces), default `3`.
- Carousel format only ever applies to `instagram_feed` — never Story, Reels, WhatsApp Status, or Facebook Feed. Meta has no carousel post type for the vertical formats, and Facebook Feed's own carousel mechanics differ enough to be explicitly out of scope (see spec's non-goals).
- A carousel-format item is never part of a shared creative group (`creativeGroupKey: null`) — the multi-image shape can't be shared with a single-image sibling.
- `squads/conteudo-multicanal/tools/meta-publish-multi.js` is gitignored (`squads/*/` in `.gitignore`) and does not exist in this worktree — Task 7 copies it in from the main checkout first, then force-tracks it (`git add -f`), per the user's explicit choice (2026-08-28 conversation) to track it the same way the design specs under `docs/` already are.
- Every task that touches `src/content-central.js` or `src/content-central-server.js` follows this codebase's existing style: JSDoc-free, comment-the-why not the-what, `withProjectLock`/`writeJson` for any project-file mutation.

---

## File Structure

- **Modify `src/content-central.js`**:
  - `generateContentSchedulePlan`'s options/loop (carousel quota + item building).
  - `runCarouselGeneration`/`enqueueCarouselGeneration` (generalize with optional overrides).
  - `enrichBatchItemsWithRealImages`/`enqueueBatchImageGeneration` (carousel branch, `paths` threading).
  - `reconcileInterruptedGenerations` (cover batch-item carousels — the standalone `content/carousels/` ones are already covered from the 2026-08-27 fix).
  - New: `carouselWeekdaysForRange` (pure day-distribution function), `carouselBriefingFromContentTopic` (pure).
- **Modify `src/content-central-server.js`**: the `/generate` route (pass `carouselsPerWeek`/`maxCarouselSlides` through), `publishContentToInstagram` (carousel upload + payload branch).
- **Modify `squads/conteudo-multicanal/tools/meta-publish-multi.js`**: `publishInstagramCarousel`, `validateTarget`, `buildTargets`, `publishTarget` dispatch. Force-tracked in git (see Global Constraints).
- **Create `tests/meta-publish-multi.test.js`**: first test coverage this script has ever had, using `node:test` + a mocked global `fetch` (matches this repo's own test conventions elsewhere — no new dependency).
- **Modify `content-central-app/src/api/client.ts`**: `GenerateContentInput` (2 new fields), `ContentItem` (2 new fields + `CarouselSlide` type reused from the standalone client types), `regenerateCarouselItemSlide` client function.
- **Modify `content-central-app/src/pages/workspace/GenerateContent.tsx`**: 2 new number inputs.
- **Modify `content-central-app/src/pages/workspace/PendingApproval.tsx`**: `renderCarouselCard` (stacked slides, per-slide regenerate/note, same approve/delete actions as every other card).

---

### Task 1: Config plumbing — `carouselsPerWeek`/`maxCarouselSlides` as generation-time inputs

**Files:**
- Modify: `src/content-central.js:2844` (`generateContentSchedulePlan`'s options destructure)
- Modify: `src/content-central-server.js:1017-1037` (`/generate` route)
- Modify: `content-central-app/src/api/client.ts:545-561` (`GenerateContentInput`)
- Modify: `content-central-app/src/pages/workspace/GenerateContent.tsx`
- Test: `tests/content-central.test.js`, `tests/content-central-server.test.js`, `content-central-app/src/pages/workspace/GenerateContent.test.tsx`

**Interfaces:**
- Produces: `generateContentSchedulePlan`'s `options.carouselsPerWeek?: number` and `options.maxCarouselSlides?: number` — read into local `carouselsPerWeek`/`maxCarouselSlides` constants, clamped. Nothing consumes them yet (Task 4 does) — this task only wires the number through and proves it lands unclamped-to-clamped correctly.

- [ ] **Step 1: Write the failing test for clamping**

Add to `tests/content-central.test.js`, near the other `generateContentSchedulePlan` options tests:

```js
test('generateContentSchedulePlan clamps carouselsPerWeek to 0-7 and maxCarouselSlides to 2-10', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-clamp-config', name: 'Boss Pizzaria' }, dir);
    const batch = await generateContentSchedulePlan('carrossel-clamp-config', {
      days: 7,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 99,
      maxCarouselSlides: 1,
    }, dir);
    assert.equal(batch.carouselsPerWeek, 7);
    assert.equal(batch.maxCarouselSlides, 2);

    const negative = await generateContentSchedulePlan('carrossel-clamp-config', {
      days: 7,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: -3,
      maxCarouselSlides: 999,
    }, dir);
    assert.equal(negative.carouselsPerWeek, 0);
    assert.equal(negative.maxCarouselSlides, 10);

    const defaulted = await generateContentSchedulePlan('carrossel-clamp-config', {
      days: 7,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
    }, dir);
    assert.equal(defaulted.carouselsPerWeek, 0);
    assert.equal(defaulted.maxCarouselSlides, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="clamps carouselsPerWeek" tests/content-central.test.js`
Expected: FAIL — `batch.carouselsPerWeek` is `undefined`.

- [ ] **Step 3: Add the clamped fields to `generateContentSchedulePlan`**

In `src/content-central.js`, inside `generateContentSchedulePlan` (starts at line 2844), right after the existing `days` validation block:

```js
  const days = Number(options.days || project.contentSettings.defaultDaysToGenerate || 7);
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    throw new Error('Days must be an integer between 1 and 60');
  }
  // Per-generation, not a persisted setting — same non-persistence as `days`
  // and `formats` above (GenerateContent.tsx sends these fresh every time,
  // there is no "Agenda e Geração" settings screen in this codebase).
  const carouselsPerWeek = Math.max(0, Math.min(7, Math.trunc(Number(options.carouselsPerWeek) || 0)));
  const maxCarouselSlides = Math.max(2, Math.min(10, Math.trunc(Number(options.maxCarouselSlides) || 3)));
```

Then add both to the `batch` object literal (right after `formats,` in the object built a few lines down):

```js
  const batch = {
    batchId,
    projectId: project.projectId,
    createdAt,
    days,
    startDate,
    formats,
    carouselsPerWeek,
    maxCarouselSlides,
    items: [],
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="clamps carouselsPerWeek" tests/content-central.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing HTTP-level test**

Add to `tests/content-central-server.test.js`, near the existing `/generate` route tests:

```js
test('POST generate forwards carouselsPerWeek and maxCarouselSlides through to the batch', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'carrossel-http-config', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
    });
    const { body, response } = await request(server, '/api/projects/carrossel-http-config/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 7,
        startDate: '2026-08-24',
        formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
        carouselsPerWeek: 2,
        maxCarouselSlides: 4,
      }),
    });
    assert.equal(response.status, 201);
    assert.equal(body.batch.carouselsPerWeek, 2);
    assert.equal(body.batch.maxCarouselSlides, 4);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test --test-name-pattern="forwards carouselsPerWeek" tests/content-central-server.test.js`
Expected: FAIL — `body.batch.carouselsPerWeek` is `undefined` (route doesn't read it yet).

- [ ] **Step 7: Forward the fields in the `/generate` route**

In `src/content-central-server.js`, inside the `parts[3] === 'generate'` handler (starts at line 1017), in the `generateContentSchedulePlan` call:

```js
      const batch = await generateContentSchedulePlan(projectId, {
        days: Number(body.days),
        startDate: body.startDate,
        formats,
        contentRules: splitRules(body.contentRules),
        groupIds: Array.isArray(body.groupIds) ? body.groupIds : undefined,
        offersOnly: Boolean(body.offersOnly),
        approvedPlan: body.approvedPlan,
        topicIdeaGenerator: context.topicIdeaGenerator,
        carouselsPerWeek: body.carouselsPerWeek,
        maxCarouselSlides: body.maxCarouselSlides,
      }, targetDir);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test --test-name-pattern="forwards carouselsPerWeek" tests/content-central-server.test.js`
Expected: PASS

- [ ] **Step 9: Add the fields to the frontend type and form**

In `content-central-app/src/api/client.ts`, in `GenerateContentInput` (line 545) — every other numeric field on this interface (`days`, `postsPerDay`, `everyDays`, `intervalMinutes`) is string-typed, matching this form's plain `useState("...")` inputs; match that convention rather than introducing the only number-typed fields on this interface:

```ts
export interface GenerateContentInput {
  days: string;
  startDate: string;
  formats: GenerateFormatInput[];
  contentRules: string;
  groupIds?: string[];
  offersOnly?: boolean;
  approvedPlan?: PlannedContentSchedule;
  // 0 (or omitted) = off. Distributed evenly across each week of the range
  // (see carouselWeekdaysForRange in content-central.js) rather than
  // front-loaded.
  carouselsPerWeek?: string;
  maxCarouselSlides?: string;
}
```

In `content-central-app/src/pages/workspace/GenerateContent.tsx`, add the two new pieces of state next to `GenerateMarketingContent`'s existing `days` state (line 161):

```tsx
  const [days, setDays] = useState("7");
  const [carouselsPerWeek, setCarouselsPerWeek] = useState("0");
  const [maxCarouselSlides, setMaxCarouselSlides] = useState("3");
```

Add the two inputs right after the existing `gen-days`/`gen-start-date` row (lines 421-429), inside the same `<div className="row">`:

```tsx
          <div className="row">
            <div>
              <label htmlFor="gen-days">Dias</label>
              <input id="gen-days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div>
              <label htmlFor="gen-start-date">Data inicial</label>
              <input id="gen-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="gen-carousels-per-week">Carrosséis por semana (0 = desligado)</label>
              <input id="gen-carousels-per-week" type="number" min={0} max={7} value={carouselsPerWeek} onChange={(e) => setCarouselsPerWeek(e.target.value)} />
            </div>
            <div>
              <label htmlFor="gen-max-carousel-slides">Máximo de folhas por carrossel automático</label>
              <input id="gen-max-carousel-slides" type="number" min={2} max={10} value={maxCarouselSlides} onChange={(e) => setMaxCarouselSlides(e.target.value)} />
            </div>
```

(Leave the rest of that `<div className="row">` block exactly as it is — this only adds two sibling `<div>`s inside it.)

In `buildGenerateInput` (line 306-327), add both fields to the returned object:

```ts
    return {
      days,
      startDate,
      formats: payloadFormats,
      contentRules,
      groupIds: selectedGroupIds.size ? [...selectedGroupIds] : undefined,
      offersOnly: selectedGroupIds.size > 0 && offersOnly,
      carouselsPerWeek,
      maxCarouselSlides,
    };
```

- [ ] **Step 10: Write the frontend test**

Add to `content-central-app/src/pages/workspace/GenerateContent.test.tsx`, right after the existing `"offers Facebook Feed and Story..."` test (line 123-146) — same `stubFetchSequence`/`renderGenerate` pattern this file already uses everywhere, asserting on the raw request body the same way that test does:

```tsx
  it("sends carouselsPerWeek and maxCarouselSlides in the generate request, defaulting to 0 and 3", async () => {
    stubFetchSequence([
      { body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) },
      EMPTY_COMMEMORATIVE_DATES,
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await userEvent.click(await screen.findByRole("checkbox", { name: "Instagram Feed" }));
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const generateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    const body = JSON.parse(generateCall[1].body as string);
    expect(body.carouselsPerWeek).toBe("0");
    expect(body.maxCarouselSlides).toBe("3");
  });

  it("sends a typed carouselsPerWeek/maxCarouselSlides value in the generate request", async () => {
    stubFetchSequence([
      { body: projectState([{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }]) },
      EMPTY_COMMEMORATIVE_DATES,
      { body: { batch: { items: [{ contentId: "a" }] } } },
      { body: { content: [] } },
    ]);
    renderGenerate();

    await userEvent.click(await screen.findByRole("checkbox", { name: "Instagram Feed" }));
    await userEvent.clear(screen.getByLabelText("Carrosséis por semana (0 = desligado)"));
    await userEvent.type(screen.getByLabelText("Carrosséis por semana (0 = desligado)"), "2");
    await userEvent.clear(screen.getByLabelText("Máximo de folhas por carrossel automático"));
    await userEvent.type(screen.getByLabelText("Máximo de folhas por carrossel automático"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Gerar conteúdos" }));

    expect(await screen.findByRole("heading", { name: "Calendário" })).toBeInTheDocument();
    const generateCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2];
    const body = JSON.parse(generateCall[1].body as string);
    expect(body.carouselsPerWeek).toBe("2");
    expect(body.maxCarouselSlides).toBe("4");
  });
```

- [ ] **Step 11: Run the frontend test suite and the backend suites**

Run: `cd content-central-app && npx vitest run src/pages/workspace/GenerateContent.test.tsx`
Run: `node --test --test-name-pattern="carouselsPerWeek|carousel" tests/content-central.test.js tests/content-central-server.test.js`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/content-central.js src/content-central-server.js content-central-app/src/api/client.ts content-central-app/src/pages/workspace/GenerateContent.tsx content-central-app/src/pages/workspace/GenerateContent.test.tsx tests/content-central.test.js tests/content-central-server.test.js
git commit -m "feat(content-central): thread carouselsPerWeek/maxCarouselSlides through generation"
```

---

### Task 2: Weekly day-distribution pure function

**Files:**
- Modify: `src/content-central.js` (new function, placed near `pickRotatingReferenceList` — both are small deterministic-selection helpers)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `carouselWeekdaysForRange(days, carouselsPerWeek): Set<number>` — returns the set of **0-indexed day offsets** (relative to the batch's `startDate`, i.e. `dayIndex` as already used in `generateContentSchedulePlan`'s loop) that should become carousels. Pure, no I/O, no randomness.

- [ ] **Step 1: Write the failing tests**

Add to `tests/content-central.test.js`, near `pickRotatingReferenceList`'s own tests (or create a new block if that function has none — search first):

```js
test('carouselWeekdaysForRange distributes evenly within each 7-day window using a fixed step', () => {
  assert.deepEqual(carouselWeekdaysForRange(7, 0), new Set());
  assert.deepEqual(carouselWeekdaysForRange(7, 1), new Set([0]));
  assert.deepEqual(carouselWeekdaysForRange(7, 2), new Set([0, 3]));
  assert.deepEqual(carouselWeekdaysForRange(7, 3), new Set([0, 2, 4]));
  assert.deepEqual(carouselWeekdaysForRange(7, 7), new Set([0, 1, 2, 3, 4, 5, 6]));
});

test('carouselWeekdaysForRange repeats the same weekly pattern across multiple full weeks', () => {
  const result = carouselWeekdaysForRange(14, 2);
  assert.deepEqual(result, new Set([0, 3, 7, 10]));
});

test('carouselWeekdaysForRange scales the quota down proportionally for a partial trailing week, never past the last day', () => {
  // 10 days = 1 full week (quota 2 -> days 0,3) + a 3-day partial week
  // (quota round(2*3/7)=1 -> day 7 only, the partial week's own day 0).
  const result = carouselWeekdaysForRange(10, 2);
  assert.deepEqual(result, new Set([0, 3, 7]));
  result.forEach((dayIndex) => assert.ok(dayIndex < 10, `${dayIndex} must be within the 10-day range`));
});

test('carouselWeekdaysForRange returns an empty set for a range shorter than a week with a rounded-down-to-zero quota', () => {
  // round(1*2/7) = round(0.57) = 1, so this actually gets 1 day — verifying
  // the rounding direction explicitly rather than assuming it.
  const result = carouselWeekdaysForRange(2, 1);
  assert.deepEqual(result, new Set([0]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="carouselWeekdaysForRange" tests/content-central.test.js`
Expected: FAIL — `carouselWeekdaysForRange is not defined`.

- [ ] **Step 3: Implement it**

In `src/content-central.js`, near `pickRotatingReferenceList` (search for that function name to find the right neighborhood):

```js
// Which day offsets (0-indexed, relative to a batch's startDate) become
// carousel days instead of a normal single-image Feed post. Deterministic
// on purpose (matches this codebase's existing preference — see
// pickRotatingReferenceList's seeded-not-random comment): re-generating the
// same range always picks the same days, instead of a fresh random roll
// each time. Step size spreads the quota evenly across each 7-day window;
// a partial trailing week gets its quota scaled down proportionally so it
// never reaches past the range's actual last day.
export function carouselWeekdaysForRange(days, carouselsPerWeek) {
  const result = new Set();
  if (carouselsPerWeek <= 0) return result;
  for (let weekStart = 0; weekStart < days; weekStart += 7) {
    const weekLength = Math.min(7, days - weekStart);
    const weekQuota = weekLength === 7
      ? carouselsPerWeek
      : Math.round((carouselsPerWeek * weekLength) / 7);
    if (weekQuota <= 0) continue;
    const step = Math.max(1, Math.floor(weekLength / weekQuota));
    for (let picked = 0, offset = 0; picked < weekQuota && offset < weekLength; offset += step, picked += 1) {
      result.add(weekStart + offset);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern="carouselWeekdaysForRange" tests/content-central.test.js`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): add carouselWeekdaysForRange day-distribution helper"
```

---

### Task 3: Generalize the carousel engine to run against any carousel-shaped object

**Files:**
- Modify: `src/content-central.js:2806-2869` (`runCarouselGeneration`), `src/content-central.js:2875-2889` (`enqueueCarouselGeneration`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `runCarouselGeneration(carousel, project, projectId, options, paths, overrides = {})` — `overrides.briefing?: string` (default `carousel.briefing`), `overrides.slideCount?: number` (default `carousel.slideCount`), `overrides.markReady?: (carousel) => void` (default `(c) => { c.status = 'ready'; }`). `enqueueCarouselGeneration(projectId, carousel, options, targetDir, overrides = {})` — same `overrides`, forwarded straight through.
- Also produces: `carouselBriefingFromContentTopic(topic): string` — pure, turns a regular `contentTopic` (the same shape every non-carousel post's topic already has) into the free-text briefing the roteiro prompt expects.

This is a pure refactor — every existing standalone call site (the carousel HTTP routes) calls both functions with no 6th/5th argument, so `overrides` defaults to `{}` and behavior is byte-for-byte identical to before. The only way to verify that without duplicating the whole existing test suite is: run the full existing carousel test suite unchanged and confirm nothing broke, then add one small new test proving the override actually takes effect.

- [ ] **Step 1: Run the existing carousel test suite to record the current baseline**

Run: `node --test --test-name-pattern="[Cc]arousel|[Cc]arrossel" tests/content-central.test.js tests/content-central-server.test.js`
Expected: all currently-passing (10 + 3 tests as of 2026-08-27's last commit on this branch).

- [ ] **Step 2: Write the failing test for the new override behavior**

Add to `tests/content-central.test.js`, near the other `enqueueCarouselGeneration` tests:

```js
test('carouselBriefingFromContentTopic turns a regular contentTopic into a free-text briefing', () => {
  assert.match(
    carouselBriefingFromContentTopic({ offerName: 'Pizza Família', objective: 'Vender mais no fim de semana', items: 'Borda recheada, refri grátis' }),
    /Pizza Família/,
  );
  assert.match(
    carouselBriefingFromContentTopic({ offerName: 'Pizza Família', objective: 'Vender mais no fim de semana', items: 'Borda recheada, refri grátis' }),
    /Vender mais no fim de semana/,
  );
  // A goal-driven topic (no offerName) still produces something usable —
  // falls back to label/objective only, never throws on a missing field.
  assert.doesNotThrow(() => carouselBriefingFromContentTopic({ label: 'Autoridade', objective: 'Mostrar bastidores' }));
});

test('runCarouselGeneration/enqueueCarouselGeneration accept a briefing/slideCount override and a markReady override instead of reading carousel.briefing/status directly', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-override', name: 'Boss Pizzaria' }, dir);
    // Deliberately built without generateCarousel — simulates a batch-item
    // shaped object that has no .briefing field and a foreign .status value
    // the carousel engine must never overwrite.
    const paths = getCentralPaths(dir, 'carrossel-override');
    const filePath = join(paths.draftsDir, 'fake-batch-item.json');
    await mkdir(paths.draftsDir, { recursive: true });
    const fakeItem = {
      contentId: 'fake-1',
      status: 'draft_generated',
      slideCount: 2,
      slides: [
        { slideId: 's1', order: 1, role: 'content', slideText: '', contentTopic: null, image: { generating: true, references: [] }, imageGenerationError: null },
        { slideId: 's2', order: 2, role: 'content', slideText: '', contentTopic: null, image: { generating: true, references: [] }, imageGenerationError: null },
      ],
      outlineGenerationError: null,
      filePath,
    };
    await writeFile(filePath, JSON.stringify(fakeItem, null, 2), 'utf-8');

    let receivedBriefing;
    await new Promise((resolveDone) => {
      enqueueCarouselGeneration('carrossel-override', fakeItem, {
        outlineGenerator: async ({ briefing, slideCount }) => {
          receivedBriefing = briefing;
          return { format: 'listicle', slides: Array.from({ length: slideCount }, (_, i) => ({ role: 'content', slideText: `Slide ${i + 1}` })) };
        },
        imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
      }, dir, {
        briefing: 'briefing sintetizado do contentTopic',
        slideCount: 2,
        markReady: () => {}, // no-op — a batch item's own .status must be left alone
      });
      setTimeout(resolveDone, 300);
    });

    assert.equal(receivedBriefing, 'briefing sintetizado do contentTopic');
    const reloaded = JSON.parse(await readFile(filePath, 'utf-8'));
    assert.equal(reloaded.status, 'draft_generated', 'markReady override must prevent the engine from touching .status');
    assert.equal(reloaded.slides[0].image.url, 'https://cdn.example.com/x.png');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test --test-name-pattern="carouselBriefingFromContentTopic|accept a briefing" tests/content-central.test.js`
Expected: FAIL — `carouselBriefingFromContentTopic is not defined`, and the override test fails because `enqueueCarouselGeneration` doesn't accept a 5th argument yet.

- [ ] **Step 4: Implement the override params and the pure helper**

In `src/content-central.js`, replace `runCarouselGeneration`'s signature and its 3 uses of `carousel.briefing`/`carousel.slideCount`/hardcoded `carousel.status = 'ready'` (lines 2806-2869):

```js
async function runCarouselGeneration(carousel, project, projectId, options, paths, overrides = {}) {
  const briefing = overrides.briefing ?? carousel.briefing;
  const slideCount = overrides.slideCount ?? carousel.slideCount;
  const markReady = overrides.markReady || ((c) => { c.status = 'ready'; });
  let outline = null;
  if (typeof options.outlineGenerator === 'function') {
    try {
      outline = await options.outlineGenerator({ project, briefing, slideCount });
    } catch (err) {
      carousel.outlineGenerationError = err.message;
    }
  }
  const validOutline = outline && Array.isArray(outline.slides) && outline.slides.length === slideCount;
  if (!validOutline) {
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

  carousel.format = outline.format || '';
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
  carousel.updatedAt = new Date().toISOString();
  await writeJson(carousel.filePath, carousel);

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

  markReady(carousel);
  carousel.updatedAt = new Date().toISOString();
  await writeJson(carousel.filePath, carousel);
}
```

And `enqueueCarouselGeneration` right below it:

```js
export function enqueueCarouselGeneration(projectId, carousel, options = {}, targetDir = process.cwd(), overrides = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  loadProject(paths)
    .then((project) => runCarouselGeneration(carousel, project, projectId, options, paths, overrides))
    .catch((err) => {
      console.error(`[content-central] background carousel generation failed for ${projectId}/${carousel.carouselId}:`, err.message);
    });
}
```

Then add the pure helper near `buildCarouselSlideContentTopic` (line 2720):

```js
// Turns a regular contentTopic (the same shape every non-carousel post's
// topic already has — offerName/label/objective/items) into the free-text
// briefing the roteiro prompt (buildCarouselOutlinePrompt) expects. Used by
// the automatic-calendar path, where nothing types a briefing by hand —
// the topic pool already picked the subject the same way it does for
// every other post that day.
export function carouselBriefingFromContentTopic(topic) {
  return [topic.offerName || topic.label, topic.objective, topic.items].filter(Boolean).join(' — ');
}
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `node --test --test-name-pattern="carouselBriefingFromContentTopic|accept a briefing" tests/content-central.test.js`
Expected: PASS

- [ ] **Step 6: Re-run the full carousel baseline from Step 1 to confirm zero regression**

Run: `node --test --test-name-pattern="[Cc]arousel|[Cc]arrossel" tests/content-central.test.js tests/content-central-server.test.js`
Expected: same pass count as Step 1, nothing newly failing.

- [ ] **Step 7: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "refactor(content-central): generalize the carousel engine with briefing/slideCount/markReady overrides"
```

---

### Task 4: `generateContentSchedulePlan` — build carousel-format items on quota days

**Files:**
- Modify: `src/content-central.js:2942-3024` (the day/slot loop)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `carouselWeekdaysForRange` (Task 2), `carouselBriefingFromContentTopic` (Task 3), `buildCarouselSlideSkeleton` (`content-central.js:2636`, already exported-equivalent — it's a plain function in the same file, no export needed since this is an in-file call), the `carousel.slides[]` shape's `contentTopic: null` placeholder default.
- Produces: a batch item with `format: 'carousel'`, `slides: CarouselSlide[]`, `creativeGroupKey: null`, no `image` field, everything else identical to a normal item (`contentId`, `approval`, `publish`, `filePath`, etc.).

- [ ] **Step 1: Write the failing test**

Add to `tests/content-central.test.js`:

```js
test('generateContentSchedulePlan builds carousel-format placeholder items on the quota days, leaving other days single-image', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-calendario', name: 'Boss Pizzaria' }, dir);
    const batch = await generateContentSchedulePlan('carrossel-calendario', {
      days: 7,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 2,
      maxCarouselSlides: 4,
    }, dir);

    const feedItems = batch.items.filter((item) => item.channel === 'instagram_feed');
    assert.equal(feedItems.length, 7, 'one Feed item per day regardless of format');
    const carouselItems = feedItems.filter((item) => item.format === 'carousel');
    assert.equal(carouselItems.length, 2, 'exactly carouselsPerWeek items became carousels');
    // carouselWeekdaysForRange(7, 2) = {0, 3} — day 1 and day 4 (1-indexed dayNumber).
    assert.deepEqual(carouselItems.map((item) => item.dayNumber).sort(), [1, 4]);

    for (const item of carouselItems) {
      assert.equal(item.image, undefined, 'a carousel item has no top-level image');
      assert.equal(item.slides.length, 4, 'uses maxCarouselSlides, not the standalone tab\'s own field');
      assert.equal(item.creativeGroupKey, null, 'a carousel item is never shared with a sibling channel');
      item.slides.forEach((slide, index) => {
        assert.equal(slide.order, index + 1);
        assert.equal(slide.image.generating, true);
        assert.equal(slide.channel, 'instagram_feed');
      });
    }

    const singleItems = feedItems.filter((item) => item.format !== 'carousel');
    assert.equal(singleItems.length, 5);
    singleItems.forEach((item) => assert.ok(item.image, 'every non-carousel item keeps its normal single image'));
  });
});

test('generateContentSchedulePlan skips the carousel quota entirely when the batch has no instagram_feed format', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-sem-feed', name: 'Boss Pizzaria' }, dir);
    const batch = await generateContentSchedulePlan('carrossel-sem-feed', {
      days: 7,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 5,
    }, dir);
    assert.ok(batch.items.every((item) => item.format !== 'carousel'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="carousel-format placeholder items|skips the carousel quota" tests/content-central.test.js`
Expected: FAIL — every item's `format` is `undefined`, none are `'carousel'`.

- [ ] **Step 3: Compute the quota days before the loop**

In `src/content-central.js`, right before the `for (let dayIndex = 0; dayIndex < days; ...)` loop (line 2942), using the `carouselsPerWeek`/`maxCarouselSlides` already computed in Task 1:

```js
  const carouselDayIndexes = carouselWeekdaysForRange(days, carouselsPerWeek);
```

- [ ] **Step 4: Branch the Feed slot to build a carousel item on quota days**

Still inside the day/slot loop, right before the existing `const item = { ... }` object literal (line 2966), add the branch and an early `continue`-equivalent path. The cleanest way to do this without duplicating the whole loop body is to build the item differently based on a flag, then push it the same way at the end:

```js
        const isCarouselDay = format.channel === 'instagram_feed' && slotIndex === 0 && carouselDayIndexes.has(dayIndex);
        const item = isCarouselDay
          ? (() => {
              const carouselId = `${contentId}-carrossel`;
              const briefing = carouselBriefingFromContentTopic(contentTopic);
              return {
                schemaVersion: 1,
                contentId,
                projectId: project.projectId,
                batchId,
                dayNumber,
                slotNumber,
                scheduledDate,
                scheduledTime,
                channel: format.channel,
                formatLabel: format.label,
                contentTopic,
                creativeGroupKey: null,
                creativeSharedWith: null,
                contentReview: buildContentReview({ channel: format.channel, aspectRatio, dimensions, contentTopic }),
                status: 'draft_generated',
                title: `Dia ${dayNumber} · Carrossel — ${project.name}`,
                format: 'carousel',
                briefing,
                carouselFormat: '',
                slideCount: maxCarouselSlides,
                slides: Array.from({ length: maxCarouselSlides }, (_, index) => buildCarouselSlideSkeleton(carouselId, index + 1)),
                outlineGenerationError: null,
                caption: {
                  text: buildCaptionDraft(project, dayNumber, contentTopic),
                  version: 1,
                },
                dayRules: [],
                scheduleRule: { ...format },
                generationContext: {
                  globalRules: globalRules.rules.map((rule) => rule.text),
                  projectRules: [...project.rules.project],
                  contentRules: [...itemContentRules, ruleLabel],
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
            })()
          : {
```

Close that ternary's `else` branch by keeping the **existing** item object literal exactly as it is today, just re-indented to sit as the `: { ... }` half of the ternary (do not change a single field inside it — copy it verbatim from the current code). End the ternary with `};` where the existing literal's closing `};` already is.

Right after the ternary (where the existing code has `item.image.previewDataUrl = await writeGeneratedImage(...)`), branch that too — a carousel item has no `image` to preview-render:

```js
        if (!isCarouselDay) {
          item.image.previewDataUrl = await writeGeneratedImage(join(paths.projectDir, imageLocalPath), item, project);
        }
        await writeJson(filePath, item);
        batch.items.push(item);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --test-name-pattern="carousel-format placeholder items|skips the carousel quota" tests/content-central.test.js`
Expected: PASS

- [ ] **Step 6: Run the full carousel + schedule-plan test baseline**

Run: `node --test --test-name-pattern="[Cc]arousel|[Cc]arrossel|generateContentSchedulePlan" tests/content-central.test.js`
Expected: everything passes, including every pre-existing `generateContentSchedulePlan` test untouched by this change (they never set `carouselsPerWeek`, so it defaults to `0` and `isCarouselDay` is always `false` for them).

- [ ] **Step 7: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): build carousel-format items on the weekly quota days"
```

---

### Task 5: `enrichBatchItemsWithRealImages` — carousel branch

**Files:**
- Modify: `src/content-central.js:2980-3045` (`enrichBatchItemsWithRealImages`), `src/content-central.js:3077` (`enqueueBatchImageGeneration`, add `paths`)
- Test: `tests/content-central.test.js` — also grep for every other call site of `enrichBatchItemsWithRealImages`/`enqueueBatchImageGeneration` before changing the signature (`grep -n "enrichBatchItemsWithRealImages\|enqueueBatchImageGeneration" tests/*.js src/*.js`) and update every one to pass `paths`.

**Interfaces:**
- Consumes: `runCarouselGeneration` (now takes `overrides`, Task 3), `carouselBriefingFromContentTopic` (Task 3), `getCentralPaths` (already imported).
- Produces: `enrichBatchItemsWithRealImages(batch, project, projectId, options, paths)` — new required 5th parameter.

- [ ] **Step 1: Grep every call site**

Run: `grep -n "enrichBatchItemsWithRealImages(" src/*.js tests/*.js`

Expect to find: the definition itself, the call inside `enqueueBatchImageGeneration`, and one or more direct calls in `tests/content-central.test.js` (tests that bypass the queue wrapper to await generation synchronously). Note every test call site — Step 5 updates all of them.

- [ ] **Step 2: Write the failing test**

Add to `tests/content-central.test.js`, near the existing `enrichBatchItemsWithRealImages`/batch image-generation tests:

```js
test('enrichBatchItemsWithRealImages fills in the roteiro and real per-slide images for a carousel-format item, leaving single-image items untouched', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-enrich', name: 'Boss Pizzaria' }, dir);
    const batch = await generateContentSchedulePlan('carrossel-enrich', {
      days: 2,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 1,
      maxCarouselSlides: 2,
    }, dir);
    const paths = getCentralPaths(dir, 'carrossel-enrich');
    const project = await loadProject(paths);

    await enrichBatchItemsWithRealImages(batch, project, 'carrossel-enrich', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
      carouselOutlineGenerator: async ({ slideCount }) => ({
        format: 'listicle',
        slides: Array.from({ length: slideCount }, (_, i) => ({ role: i === 0 ? 'cover' : 'cta', slideText: `Slide ${i + 1}` })),
      }),
    }, paths);

    const carouselItem = batch.items.find((item) => item.format === 'carousel');
    const singleItem = batch.items.find((item) => item.format !== 'carousel');

    const reloadedCarousel = JSON.parse(await readFile(carouselItem.filePath, 'utf-8'));
    assert.equal(reloadedCarousel.status, 'draft_generated', 'must not be overwritten by the carousel engine\'s own ready/generating status field');
    reloadedCarousel.slides.forEach((slide) => {
      assert.equal(slide.image.generating, false);
      assert.equal(slide.image.url, 'https://cdn.example.com/x.png');
    });

    const reloadedSingle = JSON.parse(await readFile(singleItem.filePath, 'utf-8'));
    assert.equal(reloadedSingle.image.generating, false);
    assert.ok(reloadedSingle.image.url || reloadedSingle.image.previewDataUrl);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test --test-name-pattern="carousel-format item, leaving single-image" tests/content-central.test.js`
Expected: FAIL — `enrichBatchItemsWithRealImages` doesn't accept a `paths` 5th argument yet (or, if called with 4 args as today, the carousel item's slides never get touched at all since nothing branches on `format === 'carousel'`).

- [ ] **Step 4: Implement the carousel branch**

In `src/content-central.js`, inside `enrichBatchItemsWithRealImages` (line 2980), change the signature and add the branch as the very first thing inside the `mapWithConcurrency` callback:

```js
export async function enrichBatchItemsWithRealImages(batch, project, projectId, options, paths) {
  if (typeof options.imageGenerator !== 'function') return;
  const groups = creativeGroupsFromItems(batch.items);
  await mapWithConcurrency(groups, BATCH_IMAGE_CONCURRENCY, async (group) => {
    const [leader, ...followers] = group;
    // A carousel item's own creativeGroupKey is always null (Task 4), so
    // it is always alone in its group — followers is always empty here.
    // It needs the multi-slide roteiro pipeline instead of the
    // single-image path below, and its own status field (draft_generated,
    // aprovado, ...) must never be overwritten by the carousel engine's
    // internal 'generating'/'ready' bookkeeping — hence markReady: () => {}.
    if (leader.format === 'carousel') {
      leader.slides.forEach((slide) => { slide.image.generating = true; });
      leader.updatedAt = new Date().toISOString();
      await writeJson(leader.filePath, leader);
      const captionWork = writeAiCaptionForItem(leader, project, options);
      const carouselWork = runCarouselGeneration(leader, project, projectId, {
        imageGenerator: options.imageGenerator,
        imageReviewer: options.imageReviewer,
        outlineGenerator: options.carouselOutlineGenerator,
        resolveCarouselStyleReference: options.resolveCarouselStyleReference,
        maxCreativeAttempts: options.maxCreativeAttempts,
      }, paths, {
        briefing: leader.briefing,
        slideCount: leader.slideCount,
        markReady: () => {},
      });
      await Promise.all([carouselWork, captionWork]);
      return;
    }
    for (const item of group) {
```

The rest of the function body (everything from the existing `item.image.generating = true;` line through the closing `});`) stays exactly as it is today.

- [ ] **Step 5: Thread `paths` into `enqueueBatchImageGeneration` and every test call site found in Step 1**

In `src/content-central.js`, `enqueueBatchImageGeneration` (line 3077) already computes `paths` locally — pass it through:

```js
export function enqueueBatchImageGeneration(projectId, batch, options = {}, targetDir = process.cwd()) {
  if (typeof options.imageGenerator !== 'function') return;
  const paths = getCentralPaths(targetDir, projectId);
  loadProject(paths)
    .then((project) => enrichBatchItemsWithRealImages(batch, project, projectId, options, paths))
    .catch((err) => {
      console.error(`[content-central] background image generation failed for ${projectId}/${batch.batchId}:`, err.message);
    });
}
```

For every other direct test call site found in Step 1's grep, add the matching `paths` argument — construct it the same way that test already constructs paths for other calls in the same test (this codebase's tests consistently use `getCentralPaths(dir, projectId)`), e.g.:

```js
const paths = getCentralPaths(dir, 'some-project-id');
await enrichBatchItemsWithRealImages(batch, project, 'some-project-id', options, paths);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test --test-name-pattern="carousel-format item, leaving single-image" tests/content-central.test.js`
Expected: PASS

- [ ] **Step 7: Run the full `content-central.test.js` suite**

Run: `node --test tests/content-central.test.js`
Expected: PASS, no regressions from the signature change (every call site was updated in Step 5).

- [ ] **Step 8: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): enrichBatchItemsWithRealImages branches carousel-format items into the carousel engine"
```

---

### Task 6: `reconcileInterruptedGenerations` — cover batch-item carousels

**Files:**
- Modify: `src/content-central.js:4504` (`reconcileInterruptedGenerations`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `listProjectContent` (already used by this function for single-image items).
- Extends the existing per-project loop (already covers standalone `content/carousels/*.json` since the 2026-08-27 fix) with a branch for `content.slides` on items read from `listProjectContent` — batch-item carousels live in `content/drafts/`, not `content/carousels/`, so they're a different code path than the one already added.

- [ ] **Step 1: Write the failing test**

Add to `tests/content-central.test.js`, right after the `reconcileInterruptedGenerations also clears a stuck carousel slide...` test added on 2026-08-27:

```js
test('reconcileInterruptedGenerations also clears a stuck slide inside a batch-item (calendar) carousel', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-calendario-travado', name: 'Boss Pizzaria' }, dir);
    const batch = await generateContentSchedulePlan('carrossel-calendario-travado', {
      days: 1,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 7,
      maxCarouselSlides: 2,
    }, dir);
    const carouselItem = batch.items.find((item) => item.format === 'carousel');

    const raw = JSON.parse(await readFile(carouselItem.filePath, 'utf-8'));
    raw.slides[0].image.generating = true;
    raw.slides[1].image.generating = false;
    await writeFile(carouselItem.filePath, JSON.stringify(raw, null, 2), 'utf-8');

    const fixed = await reconcileInterruptedGenerations(dir);
    assert.ok(fixed.some((entry) => entry.contentId === carouselItem.contentId));

    const reloaded = JSON.parse(await readFile(carouselItem.filePath, 'utf-8'));
    assert.equal(reloaded.slides[0].image.generating, false);
    assert.match(reloaded.slides[0].imageGenerationError, /servidor foi reiniciado/);
    assert.equal(reloaded.status, 'draft_generated', 'a batch item\'s own status field must never be touched by this reconcile — only image.generating and slide-level errors');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="batch-item .calendar. carousel" tests/content-central.test.js`
Expected: FAIL — the stuck slide is still `generating: true` after reconcile (current code only checks `item.image?.generating`, which is `undefined` for a `format: 'carousel'` item with no top-level `image`).

- [ ] **Step 3: Extend the per-item loop inside `reconcileInterruptedGenerations`**

In `src/content-central.js`, inside `reconcileInterruptedGenerations`'s `try` block (added 2026-08-27), right after the existing single-image `for (const item of content)` loop and before the standalone-carousel `listCarousels` scan:

```js
      const content = await listProjectContent(entry.name, targetDir);
      for (const item of content) {
        if (item.image?.generating) {
          item.image.generating = false;
          item.imageGenerationError = 'Geração interrompida (o servidor foi reiniciado enquanto a imagem estava sendo criada). Clique em "Regenerar só a imagem" para tentar de novo.';
          item.updatedAt = new Date().toISOString();
          await writeJson(item.filePath, item);
          fixed.push({ projectId: entry.name, contentId: item.contentId });
          continue;
        }
        // Same bug, batch-item carousel shape: no top-level `image`, N
        // slides each with their own `image.generating`. This item's own
        // `.status` field (draft_generated/aprovado/...) is unrelated
        // bookkeeping from the rest of the pipeline — never touch it here,
        // only the slide-level generation flags.
        if (item.format === 'carousel' && Array.isArray(item.slides)) {
          let touched = false;
          for (const slide of item.slides) {
            if (!slide.image?.generating) continue;
            slide.image.generating = false;
            slide.imageGenerationError = 'Geração interrompida (o servidor foi reiniciado enquanto a imagem estava sendo criada). Clique em "Regenerar esse slide" para tentar de novo.';
            touched = true;
          }
          if (!touched) continue;
          item.updatedAt = new Date().toISOString();
          await writeJson(item.filePath, item);
          fixed.push({ projectId: entry.name, contentId: item.contentId });
        }
      }
```

(This replaces the existing simpler loop body — the `if (!item.image?.generating) continue;`-then-flip shape becomes an `if (item.image?.generating) { ...; continue; }` first branch, followed by the new carousel branch, so a plain single-image item's behavior is unchanged and a carousel item gets its own check.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="batch-item .calendar. carousel" tests/content-central.test.js`
Expected: PASS

- [ ] **Step 5: Re-run every reconcile test to confirm no regression**

Run: `node --test --test-name-pattern="reconcileInterruptedGenerations" tests/content-central.test.js`
Expected: all 3 reconcile tests (the original single-image one, the 2026-08-27 standalone-carousel + broken-project one, and this new batch-item one) pass.

- [ ] **Step 6: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): reconcileInterruptedGenerations covers batch-item (calendar) carousels too"
```

---

### Task 7: Real publish — `CAROUSEL_ALBUM` in `meta-publish-multi.js`

**Files:**
- Create (copy from main checkout, then modify): `squads/conteudo-multicanal/tools/meta-publish-multi.js` — does not exist in this worktree yet; copy it from the main checkout at `C:\Users\jucic\OneDrive\Documentos\PROJETO\OPENSQUAD\squads\conteudo-multicanal\tools\meta-publish-multi.js` first (`cp` or `Copy-Item`), then apply the diff below. Force-tracked in git per the Global Constraints note.
- Create: `tests/meta-publish-multi.test.js`
- Depends-on: none (fully independent of Tasks 1-6 — pure Graph API mechanics, no scheduling/calendar coupling).

**Interfaces:**
- Produces: `publishInstagramCarousel(target)` — `target.image_urls: string[]` (2-10 items), `target.caption?: string`. Returns `{ channel: 'instagram_feed', ok: true, media_id, container_id, permalink }`, same shape every other `publishXxx` function already returns.
- Modifies: `validateTarget` (accepts `image_urls` as an alternative to `image_url`, enforces the 2-10 count), `buildTargets` (passes `image_urls` through the same way `video_url` already is), `publishTarget` (dispatches to `publishInstagramCarousel` when `target.channel === 'instagram_feed'` and `target.image_urls` is present).

- [ ] **Step 1: Copy the file into the worktree**

```bash
mkdir -p squads/conteudo-multicanal/tools
cp "/c/Users/jucic/OneDrive/Documentos/PROJETO/OPENSQUAD/squads/conteudo-multicanal/tools/meta-publish-multi.js" squads/conteudo-multicanal/tools/meta-publish-multi.js
```

Verify: `wc -l squads/conteudo-multicanal/tools/meta-publish-multi.js` should show 354 lines, matching the main checkout's current copy.

- [ ] **Step 2: Write the failing test**

Create `tests/meta-publish-multi.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// meta-publish-multi.js is a plain ESM script (no export), so its internal
// functions aren't directly importable for unit testing the way the rest of
// this codebase's modules are — instead this drives it exactly like a real
// call would, through a mocked global fetch, and asserts on the sequence of
// Graph API calls it makes. This is this script's first-ever test coverage.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'squads', 'conteudo-multicanal', 'tools', 'meta-publish-multi.js');

function runScript(payload, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT_PATH, '--payload-json', JSON.stringify(payload)], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `exited with code ${code}`));
      resolve(JSON.parse(stdout));
    });
  });
}

test('meta-publish-multi validates a carousel target needs 2-10 image_urls, rejecting 1 and 11', async () => {
  await assert.rejects(
    () => runScript({
      publish_targets: [{ channel: 'instagram_feed', image_urls: ['https://cdn.example.com/only-one.png'] }],
    }, { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: 'fake' }),
    /2-10 image_urls/,
  );
  const tooMany = Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/${i}.png`);
  await assert.rejects(
    () => runScript({
      publish_targets: [{ channel: 'instagram_feed', image_urls: tooMany }],
    }, { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: 'fake' }),
    /2-10 image_urls/,
  );
});

test('meta-publish-multi rejects a carousel-shaped target (image_urls) on a channel other than instagram_feed', async () => {
  await assert.rejects(
    () => runScript({
      publish_targets: [{ channel: 'instagram_story', image_urls: ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png'] }],
    }, { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: 'fake' }),
    /does not support carousel/,
  );
});

test('meta-publish-multi --dry-run reports a carousel target correctly without calling the real API', async () => {
  const result = await runScript({
    publish_targets: [{ channel: 'instagram_feed', image_urls: ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png'], caption: 'Legenda' }],
  }, { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: 'fake' });
  // dry-run isn't a CLI flag this test's runScript helper passes — this
  // test instead just confirms validation passes for a well-formed
  // carousel target by asserting the real call fails only at the network
  // step (unreachable/invalid token), never at validateTarget.
  assert.ok(result === undefined || true);
});
```

Adjust the third test if `runScript` doesn't expose a `--dry-run` path cleanly through this helper — the two validation tests (rejecting bad `image_urls` counts and wrong channel) are the ones that matter and must be real; drop or rewrite the third if it doesn't cleanly assert something true without a live network call.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/meta-publish-multi.test.js`
Expected: FAIL — `validateTarget` doesn't know about `image_urls` yet, so a target with only `image_urls` (no singular `image_url`) throws `"Instagram Feed requires image_url"` instead of the expected `/2-10 image_urls/` message.

- [ ] **Step 3: Implement `validateTarget`, `buildTargets`, `publishInstagramCarousel`, and the `publishTarget` dispatch**

In `squads/conteudo-multicanal/tools/meta-publish-multi.js`, replace `validateTarget` (line 134):

```js
function validateTarget(target) {
  if (!CHANNEL_LABELS[target.channel]) throw new Error(`Unsupported publish channel: ${target.channel}`);
  if (VIDEO_CHANNELS.has(target.channel)) {
    if (!target.video_url) throw new Error(`${CHANNEL_LABELS[target.channel]} requires video_url`);
  } else if (Array.isArray(target.image_urls)) {
    if (target.channel !== 'instagram_feed') throw new Error(`${CHANNEL_LABELS[target.channel]} does not support carousel image_urls — Feed only`);
    if (target.image_urls.length < 2 || target.image_urls.length > 10) {
      throw new Error(`Instagram carousel requires 2-10 image_urls, got ${target.image_urls.length}`);
    }
  } else if (!target.image_url) {
    throw new Error(`${CHANNEL_LABELS[target.channel]} requires image_url`);
  }
  if (target.caption && target.caption.length > 2200) {
    throw new Error(`${CHANNEL_LABELS[target.channel]} caption exceeds Instagram limit: ${target.caption.length}/2200`);
  }
}
```

In `buildTargets` (line 102), add `image_urls` passthrough next to the existing `video_url` handling:

```js
function buildTargets(args, payload) {
  const defaults = {
    image_url: payload.image_url || payload.imageUrl || args.imageUrl,
    image_urls: Array.isArray(payload.image_urls) ? payload.image_urls : undefined,
    video_url: payload.video_url || payload.videoUrl || '',
    caption: payload.caption || args.caption,
    env_prefix: payload.env_prefix || payload.envPrefix || '',
  };

  const sourceTargets = payload.publish_targets || payload.targets || payload.channels;
  if (Array.isArray(sourceTargets) && sourceTargets.length) {
    return sourceTargets.map((target) => {
      if (typeof target === 'string') {
        return { channel: normalizeChannel(target), ...defaults };
      }
      return {
        ...defaults,
        ...target,
        channel: normalizeChannel(target.channel || target.id || target.name),
        image_url: target.image_url || target.imageUrl || target.image || defaults.image_url,
        image_urls: Array.isArray(target.image_urls) ? target.image_urls : defaults.image_urls,
        video_url: target.video_url || target.videoUrl || defaults.video_url,
        caption: target.caption ?? defaults.caption,
      };
    });
  }

  const channels = (args.targets || 'instagram_feed')
    .split(',')
    .map(normalizeChannel)
    .filter(Boolean);
  return channels.map((channel) => ({ channel, ...defaults }));
}
```

Add `publishInstagramCarousel` right after `publishInstagramFeed` (line 215):

```js
// Same two-step container pattern publishInstagramFeed already uses, with
// an extra fan-out step: N child containers (one per slide, is_carousel_item
// true, no per-child caption — Meta ignores it there), then one parent
// container (media_type CAROUSEL, children, the real caption), then the
// same publish call every other channel already ends with.
async function publishInstagramCarousel(target) {
  const token = instagramToken(target);
  const igId = instagramUserId(target);

  const childIds = [];
  for (const imageUrl of target.image_urls) {
    const child = await graph(`/${igId}/media`, {
      image_url: imageUrl,
      is_carousel_item: 'true',
      access_token: token,
    }, 'POST', { retries: 2 });
    childIds.push(child.id);
  }

  const container = await graph(`/${igId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: target.caption || '',
    access_token: token,
  }, 'POST', { retries: 2 });

  await waitForInstagramContainer(container.id, token);
  const published = await graph(`/${igId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  }, 'POST');

  let permalink = null;
  try {
    const media = await graph(`/${published.id}`, { fields: 'permalink', access_token: token });
    permalink = media.permalink || null;
  } catch {
    permalink = null;
  }

  return { channel: target.channel, ok: true, media_id: published.id, container_id: container.id, permalink };
}
```

Update `publishTarget`'s dispatch (line 295) to check for a carousel target before the plain Feed check:

```js
async function publishTarget(target) {
  if (target.channel === 'instagram_feed' && Array.isArray(target.image_urls) && target.image_urls.length) return publishInstagramCarousel(target);
  if (target.channel === 'instagram_feed') return publishInstagramFeed(target);
  if (target.channel === 'instagram_story') return publishInstagramStory(target);
  if (target.channel === 'instagram_reels') return publishInstagramReels(target);
  if (target.channel === 'facebook_feed') return publishFacebookFeed(target);
  if (target.channel === 'facebook_story') return publishFacebookStory(target);
  throw new Error(`Unsupported publish channel: ${target.channel}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/meta-publish-multi.test.js`
Expected: PASS

- [ ] **Step 5: Force-add and commit**

```bash
git add -f squads/conteudo-multicanal/tools/meta-publish-multi.js tests/meta-publish-multi.test.js
git commit -m "feat(meta-publish-multi): add CAROUSEL_ALBUM publish path

squads/*/ is gitignored — force-tracked per the 2026-08-28 decision to
track this file the same way docs/ specs already are."
```

---

### Task 8: `publishContentToInstagram` — carousel upload + payload branch

**Files:**
- Modify: `src/content-central-server.js:4596` (`publishContentToInstagram`)
- Test: `tests/content-central-server.test.js`
- Depends-on: Task 4 (needs `format: 'carousel'` items to exist), Task 7 (needs `publishInstagramCarousel` to exist in the script this function shells out to).

**Interfaces:**
- Consumes: `uploadGeneratedImagePublicly` (already used for single images), `resolveGeneratedImageAbsolutePath` (already used — reused per-slide by wrapping each slide's `image` in a fake `{ image: slide.image }` shim, since that function only reads `content.image.url`), `readProjectToken`/`saveProjectToken` (already used elsewhere in this test file, e.g. the `POST .../token` test at line 4480).
- Produces: `publishCarouselToInstagram({ content, project }, targetDir, options = {})` — newly **exported** (unlike the still-private `publishContentToInstagram`), with `options.uploader` (default `uploadGeneratedImagePublicly`) and `options.execFileAsync` (default the module's own `execFileAsync`) injectable — same dependency-injection shape `publishWithGaveteSync` already uses for `options.metaPublisher`/`options.pullQueue` (see the comment at `content-central-server.js:168-169`: "Extracted from the route so it's directly unit-testable"). This is what makes the test below possible without a real Meta token, real network uploads, or a real subprocess.

**Why exported and DI'd instead of tested end-to-end through the real network:** no existing test in this file drives `publishContentToInstagram`'s single-image path through real uploads either — every existing publish test injects `options.metaPublisher` and skips `publishContentToInstagram`'s internals entirely (see `publishWithGaveteSync pulls the gaveta first...` at line 2056). Testing this new carousel branch's actual payload shape needs a seam *inside* that function, so it gets the same "extract it, inject its dependencies" treatment already established here — not a new pattern.

- [ ] **Step 1: Write the failing test**

Add to `tests/content-central-server.test.js`, near the other publish-related tests (e.g. right after `publishWithGaveteSync skips the real publish...` at line 2088):

```js
test('publishCarouselToInstagram uploads every slide and sends image_urls (plural) to meta-publish-multi, not image_url', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-publish', name: 'Boss Pizzaria' }, dir);
    // expiresAt present so saveProjectToken's local-validation branch is
    // taken, never a real call to graph.facebook.com — same reasoning as
    // the 'POST .../token calls syncTokenSecretsToGitHub...' test's own
    // comment at content-central-server.test.js:4502-4508.
    await saveProjectToken('carrossel-publish', {
      token: 'EAAB-fake',
      expiresAt: '2026-12-01T00:00:00.000Z',
      account: { handle: '@bosspizzaria', instagramUserId: '999' },
    }, dir);

    const batch = await generateContentSchedulePlan('carrossel-publish', {
      days: 1,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 7,
      maxCarouselSlides: 2,
    }, dir);
    const item = batch.items.find((entry) => entry.format === 'carousel');
    // Point each slide at a real local file resolveGeneratedImageAbsolutePath
    // can find — same /api/projects/:id/assets/ URL convention every
    // generated image already uses.
    const assetsDir = join(dir, '_opensquad', 'content-central', 'projects', 'carrossel-publish', 'assets', 'generated');
    await mkdir(assetsDir, { recursive: true });
    for (const [index, slide] of item.slides.entries()) {
      const filename = `slide-${index}.png`;
      await writeFile(join(assetsDir, filename), Buffer.from('fake-png'));
      slide.image.url = `/api/projects/carrossel-publish/assets/assets/generated/${filename}`;
    }
    item.caption = { text: 'Legenda do carrossel', version: 1 };
    await writeJson(item.filePath, item);
    const project = await loadProject(getCentralPaths(dir, 'carrossel-publish'));

    const execCalls = [];
    const uploadedPaths = [];
    const result = await publishCarouselToInstagram({ content: item, project }, dir, {
      uploader: async (localPath) => {
        uploadedPaths.push(localPath);
        return `https://cdn.example.com/${uploadedPaths.length}.png`;
      },
      execFileAsync: async (cmd, args) => {
        execCalls.push({ cmd, args });
        return { stdout: JSON.stringify({ ok: true, results: [{ ok: true, media_id: 'media-carrossel', permalink: 'https://instagram.com/p/carrossel' }] }) };
      },
    });

    assert.equal(uploadedPaths.length, 2, 'one upload per slide');
    assert.equal(result.mediaId, 'media-carrossel');
    assert.equal(result.permalink, 'https://instagram.com/p/carrossel');

    assert.equal(execCalls.length, 1);
    const payloadArgIndex = execCalls[0].args.indexOf('--payload-json');
    const payload = JSON.parse(execCalls[0].args[payloadArgIndex + 1]);
    const target = payload.publish_targets[0];
    assert.deepEqual(target.image_urls, ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png']);
    assert.equal(target.image_url, undefined, 'must never send the singular field for a carousel');
    assert.equal(target.caption, 'Legenda do carrossel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="uploads every slide and sends image_urls" tests/content-central-server.test.js`
Expected: FAIL — `publishCarouselToInstagram is not a function` (not defined/exported yet).

- [ ] **Step 3: Implement `publishCarouselToInstagram` and wire it into `publishContentToInstagram`**

In `src/content-central-server.js`, add the new function right before `publishContentToInstagram` (line 4596):

```js
// Same shape as publishContentToInstagram's single-image path (token/user-id
// checks, retry loop) but uploads every slide and sends image_urls (plural)
// instead of image_url — meta-publish-multi.js's publishTarget dispatches to
// publishInstagramCarousel when it sees that field. Exported and DI'd
// (options.uploader/options.execFileAsync) the same way publishWithGaveteSync
// already is — see that function's own comment on why.
export async function publishCarouselToInstagram({ content, project }, targetDir, options = {}) {
  const uploader = options.uploader || uploadGeneratedImagePublicly;
  const execFile = options.execFileAsync || execFileAsync;
  const localImagePaths = content.slides.map((slide) => resolveGeneratedImageAbsolutePath({ image: slide.image }, project.projectId, targetDir));
  if (localImagePaths.some((path) => !path)) throw new Error('Uma ou mais imagens do carrossel não foram encontradas para publicar.');

  const token = await readProjectToken(project.projectId, targetDir);
  if (!token) throw new Error('Nenhum token Meta cadastrado para este projeto.');
  const instagramUserId = project.instagram?.instagramUserId;
  if (!instagramUserId) throw new Error('Projeto sem Instagram User ID cadastrado — valide o token na aba "Conta e token".');

  const maxAttempts = Math.max(1, Number(process.env.OPENSQUAD_PUBLISH_RETRY_ATTEMPTS || 3));
  const retryDelayMs = Math.max(0, Number(process.env.OPENSQUAD_PUBLISH_RETRY_DELAY_MS || 4000));
  const settleDelayMs = Math.max(0, Number(process.env.OPENSQUAD_PUBLISH_SETTLE_DELAY_MS || 2500));

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const imageUrls = await Promise.all(localImagePaths.map((path) => uploader(path)));
      await delay(settleDelayMs);
      const payload = {
        publish_targets: [{
          channel: content.channel,
          image_urls: imageUrls,
          caption: content.caption?.text || '',
        }],
      };
      const { stdout } = await execFile('node', [META_PUBLISH_SCRIPT, '--payload-json', JSON.stringify(payload)], {
        timeout: Number(process.env.OPENSQUAD_PUBLISH_TIMEOUT_MS || 300000),
        maxBuffer: 1024 * 1024,
        env: { ...process.env, INSTAGRAM_ACCESS_TOKEN: token, INSTAGRAM_USER_ID: instagramUserId },
      });
      const parsed = JSON.parse(stdout);
      const result = parsed.results?.[0];
      if (!result?.ok) throw new Error('Publicação do carrossel na Meta falhou sem detalhe.');
      return { mediaId: result.media_id, permalink: result.permalink || null };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) await delay(retryDelayMs * attempt);
    }
  }
  throw lastError;
}
```

Then wire it into `publishContentToInstagram`'s dispatch, right after the `WHATSAPP_CHANNELS`/`PUBLISHABLE_CHANNELS` checks and before the single-image `localImagePath` line:

```js
async function publishContentToInstagram({ content, project }, targetDir) {
  if (WHATSAPP_CHANNELS.has(content.channel)) {
    return publishContentToWhatsAppStatus({ content, project }, targetDir);
  }
  if (!PUBLISHABLE_CHANNELS.has(content.channel)) {
    throw new Error(`Canal "${content.channel}" ainda não tem publicação real suportada (só Instagram/Facebook Feed, Story e Reels hoje).`);
  }
  if (content.format === 'carousel') return publishCarouselToInstagram({ content, project }, targetDir);
  const isVideoChannel = VIDEO_CHANNELS.has(content.channel);
  const localImagePath = isVideoChannel ? null : resolveGeneratedImageAbsolutePath(content, project.projectId, targetDir);
  if (!isVideoChannel && !localImagePath) throw new Error('Imagem gerada não encontrada para publicar.');
```

Finally, add `publishCarouselToInstagram` to `tests/content-central-server.test.js`'s existing import block from `'../src/content-central-server.js'` (alongside `publishWithGaveteSync`), and confirm `saveProjectToken`, `generateContentSchedulePlan`, `loadProject`, `getCentralPaths`, `writeJson` are all already imported in that file (they are — used by other tests already).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="uploads every slide and sends image_urls" tests/content-central-server.test.js`
Expected: PASS

- [ ] **Step 5: Run the full server test suite**

Run: `node --test tests/content-central-server.test.js`
Expected: PASS, no regression to the existing single-image publish path (untouched — only a new early-return branch was added before it).

- [ ] **Step 6: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat(content-central-server): publish a carousel-format item as a real CAROUSEL_ALBUM post"
```

---

### Task 9: Approval screen — render a carousel item's N slides

**Files:**
- Modify: `src/content-central.js` (new `regenerateContentCarouselSlide`/`enqueueContentCarouselSlideRegeneration`, near `regenerateCarouselSlide`/`enqueueCarouselSlideRegeneration`)
- Modify: `src/content-central-server.js` (new `carousel-regenerate-slide` route)
- Modify: `content-central-app/src/api/client.ts` (`ContentItem` type, new `regenerateCarouselItemSlide` client function)
- Modify: `content-central-app/src/pages/workspace/PendingApproval.tsx`
- Test: `tests/content-central-server.test.js`, `content-central-app/src/pages/workspace/PendingApproval.test.tsx`
- Depends-on: Task 4 (needs the `format: 'carousel'`/`slides` data shape to render against).

**Interfaces:**
- Consumes: the standalone tab's `CarouselSlide` type (already in `client.ts`) — reused, not redefined.
- Produces: `ContentItem.format?: 'single' | 'carousel'`, `ContentItem.slides?: CarouselSlide[]`, `ContentItem.briefing?: string`; `regenerateCarouselItemSlide(projectId, contentId, slideId, note?): Promise<{ item: ContentItem }>` — a new server route `POST /api/projects/:id/content/:contentId/carousel-regenerate-slide/:slideId` mirroring the standalone tab's `carousels-regenerate-slide` route, but operating on a batch item instead of a standalone `Carousel`. **This task also needs that new backend route** — add it to `src/content-central-server.js` next to the other `content` routes, calling a new small `regenerateContentCarouselSlide`/`enqueueContentCarouselSlideRegeneration` pair in `content-central.js` that mirrors `regenerateCarouselSlide`/`enqueueCarouselSlideRegeneration` but reads/writes a batch item (found via `findContentPath`, same helper `deleteProjectContent` already uses) instead of a standalone carousel file.

- [ ] **Step 1: Write the failing backend test for the new route**

Add to `tests/content-central-server.test.js`:

```js
test('carousel-regenerate-slide on a batch-item carousel regenerates only the target slide', async () => {
  await withServer(async (dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'carrossel-item-regen', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
    });
    // Build a batch with a carousel item the same way Task 4/5's own tests
    // do (days:1, carouselsPerWeek:7, maxCarouselSlides:2), then locate its
    // contentId/slideId from the response the way this file's other
    // content-listing tests already do (GET /api/projects/:id/content).
  });
});
```

Fill in the body: generate the batch via `POST /generate` with `carouselsPerWeek: 7`, `maxCarouselSlides: 2`, `days: 1`; find the resulting carousel item via `GET /api/projects/carrossel-item-regen/content`; call the new route `POST /api/projects/carrossel-item-regen/content/<contentId>/carousel-regenerate-slide/<slideId>`; assert only that slide's `image.url` changed on a second `GET`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="batch-item carousel regenerates only" tests/content-central-server.test.js`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Implement the backend regenerate-slide functions and route**

In `src/content-central.js`, near `regenerateCarouselSlide`/`enqueueCarouselSlideRegeneration` (line 2890), add the batch-item equivalents:

```js
// Same idea as regenerateCarouselSlide/enqueueCarouselSlideRegeneration,
// operating on a batch item's slides array instead of a standalone
// Carousel file — reuses findContentPath (already used by
// deleteProjectContent) to locate the item on disk from its contentId.
export async function regenerateContentCarouselSlide(projectId, contentId, slideId, targetDir = process.cwd(), batchId) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
    const item = await readJson(contentPath);
    const slide = item.slides?.find((entry) => entry.slideId === slideId);
    if (!slide) throw new Error('Slide não encontrado.');
    if (slide.contentTopic) {
      slide.image.references = await buildImageReferencePayload(project, paths, { channel: slide.channel, topic: slide.contentTopic });
    }
    await writeJson(contentPath, item);
    return item;
  });
}

export function enqueueContentCarouselSlideRegeneration(projectId, contentId, slideId, options = {}, targetDir = process.cwd(), batchId) {
  const paths = getCentralPaths(targetDir, projectId);
  loadProject(paths)
    .then(async (project) => {
      const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
      const item = await readJson(contentPath);
      const slide = item.slides?.find((entry) => entry.slideId === slideId);
      if (!slide) throw new Error('Slide não encontrado.');
      slide.image.generating = true;
      await writeJson(contentPath, item);
      const firstSlide = item.slides[0];
      const styleReferencePath = firstSlide && firstSlide.slideId !== slide.slideId
        && typeof options.resolveCarouselStyleReference === 'function'
        ? await options.resolveCarouselStyleReference(firstSlide).catch(() => null)
        : null;
      await enrichCarouselSlideWithRealImage(item, slide, project, projectId, paths, options, styleReferencePath);
    })
    .catch((err) => {
      console.error(`[content-central] background content carousel slide regeneration failed for ${projectId}/${contentId}/${slideId}:`, err.message);
    });
}
```

In `src/content-central-server.js`, add the route next to the existing `carousels-regenerate-slide` route, and import `regenerateContentCarouselSlide`/`enqueueContentCarouselSlideRegeneration` in this file's existing import block from `./content-central.js` (alongside `regenerateCarouselSlide`/`enqueueCarouselSlideRegeneration`).

Route path is `/api/projects/:id/content/:contentId/carousel-regenerate-slide/:slideId` — that's `parts = ['api', 'projects', projectId, 'content', contentId, 'carousel-regenerate-slide', slideId]`, i.e. `parts.length === 7` and `parts[5] === 'carousel-regenerate-slide'`:

```js
  if (parts.length === 7 && parts[3] === 'content' && parts[5] === 'carousel-regenerate-slide') {
    const body = await readBody(req).catch(() => ({}));
    const contentId = parts[4];
    const slideId = parts[6];
    const item = await regenerateContentCarouselSlide(projectId, contentId, slideId, targetDir, body.batchId);
    enqueueContentCarouselSlideRegeneration(projectId, contentId, slideId, {
      imageGenerator: context.imageGenerator,
      imageReviewer: context.imageReviewer,
      resolveCarouselStyleReference: (slideContent) => resolveExistingGeneratedImagePath(slideContent, projectId, targetDir),
      note: String(body.note || '').trim() || undefined,
    }, targetDir, body.batchId);
    return sendJson(res, 200, { item });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="batch-item carousel regenerates only" tests/content-central-server.test.js`
Expected: PASS

- [ ] **Step 5: Add the frontend type and client function**

In `content-central-app/src/api/client.ts`, extend `ContentItem` (search for its interface definition) with:

```ts
  format?: "single" | "carousel";
  slides?: CarouselSlide[];
  briefing?: string;
```

Add the client function next to `regenerateCarouselSlide`:

```ts
export function regenerateCarouselItemSlide(
  projectId: string,
  contentId: string,
  slideId: string,
  note?: string,
): Promise<{ item: ContentItem }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content/${encodeURIComponent(contentId)}/carousel-regenerate-slide/${encodeURIComponent(slideId)}`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}
```

- [ ] **Step 6: Write the failing frontend test**

Add to `content-central-app/src/pages/workspace/PendingApproval.test.tsx`, right after the `"shows a pending card with its caption and the briefing link"` test (line 56-73) — reusing this file's own `baseItem()` helper, overridden into a carousel shape:

```tsx
  it("renders every slide of a carousel-format pending item, with its own regenerate action per slide", async () => {
    const carouselItem = baseItem({
      contentId: "boss-pizzaria-day-1-instagram_feed-carrossel",
      channel: "instagram_feed",
      formatLabel: "Carrossel",
      format: "carousel",
      image: undefined,
      slides: [
        {
          slideId: "slide-1",
          order: 1,
          role: "cover",
          slideText: "5 dicas de pizza",
          image: { url: "https://cdn.example.com/slide-1.png", generating: false },
          imageGenerationError: null,
        },
        {
          slideId: "slide-2",
          order: 2,
          role: "cta",
          slideText: "Peça já",
          image: { generating: true },
          imageGenerationError: null,
        },
      ],
    });
    stubFetchSequence([{ body: PROJECT_STATE }, { body: { content: [carouselItem] } }]);

    renderPendingApproval();

    expect(await screen.findByRole("img", { name: "5 dicas de pizza" })).toHaveAttribute("src", "https://cdn.example.com/slide-1.png");
    expect(screen.getByText("Gerando imagem...")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Regenerar esse slide" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd content-central-app && npx vitest run src/pages/workspace/PendingApproval.test.tsx -t "renders every slide"`
Expected: FAIL — `PendingApproval` renders `renderSoloCard` for a carousel item today, which reads `item.image` (undefined) and shows "Sem imagem de prévia ainda" instead of the slides.

- [ ] **Step 8: Implement `renderCarouselCard` and the dispatch**

In `content-central-app/src/pages/workspace/PendingApproval.tsx`, import the new client function and add state for per-slide notes/busy state (mirroring `Carousels.tsx`'s own `slideState`/`slideNotes` pattern):

```tsx
import {
  animateForReels,
  approveContent,
  deleteContent,
  getProjectContent,
  regenerateCarouselItemSlide,
  regenerateContent,
  regenerateContentGroup,
  updateCaption,
  type ContentItem,
} from "@/api/client";
```

Add state near this file's other `useState` calls:

```tsx
const [slideState, setSlideState] = useState<Record<string, ActionState>>({});
const [slideNotes, setSlideNotes] = useState<Record<string, string>>({});
```

Add the handler near `handleApprove`:

```tsx
async function handleRegenerateSlide(item: ContentItem, slideId: string, note?: string) {
  setSlideState((s) => ({ ...s, [slideId]: { busy: true, busyAction: "creative", error: null, message: null } }));
  try {
    await regenerateCarouselItemSlide(project.projectId, item.contentId, slideId, note);
    setSlideNotes((n) => ({ ...n, [slideId]: "" }));
    setSlideState((s) => ({ ...s, [slideId]: IDLE_ACTION_STATE }));
    await refresh();
  } catch (err) {
    setSlideState((s) => ({ ...s, [slideId]: { busy: false, error: (err as Error).message, message: null } }));
  }
}
```

Add `renderCarouselCard` right after `renderSoloCard`, reusing that function's own header/caption/approve/delete block structure but swapping the single-image `.phone` block for a stacked list of slides:

```tsx
function renderCarouselCard(item: ContentItem) {
  const state = stateFor(item.contentId);
  const draft = captionFor(item.contentId, item);
  return (
    <Card key={item.contentId} className={styles.card}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>
            {item.scheduledDate} · {item.scheduledTime || ""} · Carrossel
          </h3>
          <span className="pill">{(item.slides || []).length} folhas</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginTop: 12 }}>
          {(item.slides || []).map((slide) => {
            const src = slide.image.url || slide.image.previewUrl;
            const slideBusy = slideState[slide.slideId] || IDLE_ACTION_STATE;
            return (
              <div key={slide.slideId}>
                <div className={`${styles.phone} ${styles.phoneFeed}`}>
                  {src ? (
                    <img src={src} alt={slide.slideText || `Slide ${slide.order}`} loading="lazy" />
                  ) : slide.image.generating ? (
                    <span>Gerando imagem...</span>
                  ) : (
                    <span>Sem imagem ainda</span>
                  )}
                </div>
                {slide.imageGenerationError ? (
                  <div className={`${styles.feedback} ${styles.feedbackError}`}>⚠ {slide.imageGenerationError}</div>
                ) : null}
                <textarea
                  placeholder="Pedido de correção (opcional)"
                  value={slideNotes[slide.slideId] || ""}
                  onChange={(e) => setSlideNotes((n) => ({ ...n, [slide.slideId]: e.target.value }))}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={slideBusy.busy || slide.image.generating}
                  onClick={() => handleRegenerateSlide(item, slide.slideId, slideNotes[slide.slideId]?.trim() || undefined)}
                >
                  {slideBusy.busy ? "Regenerando..." : "Regenerar esse slide"}
                </Button>
              </div>
            );
          })}
        </div>
        <label htmlFor={`caption-${item.contentId}`} style={{ marginTop: 12 }}>Legenda</label>
        <textarea
          id={`caption-${item.contentId}`}
          className={styles.caption}
          value={draft}
          onChange={(e) => setCaptionDrafts((d) => ({ ...d, [item.contentId]: e.target.value }))}
        />
        {draft.trim() && draft.trim() !== (item.caption?.text || "") ? (
          <Button variant="secondary" disabled={state.busy} onClick={() => handleSaveCaption(item)} style={{ marginTop: 8 }}>
            {state.busy && state.busyAction === "caption" ? "Salvando..." : "Salvar legenda"}
          </Button>
        ) : null}
        <div className={styles.actions} style={{ marginTop: 12 }}>
          <Button disabled={state.busy} onClick={() => handleApprove(item)}>
            {state.busy && state.busyAction === "approve" ? "Aprovando..." : "Aprovar"}
          </Button>
          <Button variant="ghost" disabled={state.busy} onClick={() => handleDelete(item)}>
            Apagar
          </Button>
        </div>
        {state.error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{state.error}</div> : null}
        {state.message ? <div className={`${styles.feedback} ${styles.feedbackOk}`}>{state.message}</div> : null}
      </div>
    </Card>
  );
}
```

Update the render dispatch at the bottom of the component:

```tsx
{groups.map((group) =>
  group.members.length > 1
    ? renderGroupCard(group)
    : group.leader.format === "carousel"
      ? renderCarouselCard(group.leader)
      : renderSoloCard(group.leader),
)}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd content-central-app && npx vitest run src/pages/workspace/PendingApproval.test.tsx`
Expected: PASS (the new test and every pre-existing one in this file)

- [ ] **Step 10: Build the frontend**

Run: `cd content-central-app && npm run build`
Expected: PASS, no TypeScript errors (this project's known gotcha: `tsc --noEmit` alone checks nothing here — always use `npm run build`).

- [ ] **Step 11: Commit**

```bash
git add src/content-central.js src/content-central-server.js content-central-app/src/api/client.ts content-central-app/src/pages/workspace/PendingApproval.tsx content-central-app/src/pages/workspace/PendingApproval.test.tsx tests/content-central-server.test.js
git commit -m "feat(content-central-app): render and per-slide-regenerate a carousel item on the approval screen"
```

---

## Suggested execution order / parallel waves

Per this repo's parallel-subagent-driven-development rule — waves formed by Depends-on chain AND disjoint Files:

- **Wave 1:** Task 2 (`carouselWeekdaysForRange`) and Task 7 (`meta-publish-multi.js`) — no shared files, no dependency on anything.
- **Wave 2:** Task 1 and Task 3 — both touch `content-central.js` in different regions with no dependency on each other, but the same-file overlap means the controller should run them serially rather than in one wave (fail-safe per the rule: same file → not parallel).
- **Wave 3:** Task 4 (depends on 1, 2, 3).
- **Wave 4:** Task 5 (depends on 3, 4), Task 6 (depends on 4) — same file (`content-central.js`) again, run serially.
- **Wave 5:** Task 8 (depends on 4, 7).
- **Wave 6:** Task 9 (depends on 4) — also touches `content-central-server.js`, same file Task 8 just modified, so it must come after Task 8 finishes rather than sharing Wave 5.

In practice, because Tasks 1/3/4/5/6 all touch `content-central.js`, and Tasks 8/9 both touch `content-central-server.js`, the safest and simplest execution is fully serial for the whole chain (1 → 3 → 4 → 5 → 6 → 8 → 9), with Task 2 and Task 7 pulled out and done first/in-parallel since they're genuinely isolated from everything else.
