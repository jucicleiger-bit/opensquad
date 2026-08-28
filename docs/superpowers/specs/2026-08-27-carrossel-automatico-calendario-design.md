# Carrossel automático no calendário — design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Today "Carrossel avulso" (`[[2026-08-26-carrossel-avulso-design]]`) is a manual, isolated tool: the operator types a briefing by hand, no calendar slot, no email approval, no real Instagram publish. This design integrates carousel as a real content **format** the automatic weekly generator can produce on its own — with a configurable quota, drawing its subject from the same topic pool as every other post, going through the existing approval flow, and actually publishing to Instagram as a real multi-image carousel post (Graph API `CAROUSEL_ALBUM`).

**Non-goals:**
- Carousel for Story/Reels/WhatsApp Status — Meta doesn't support a carousel post on those surfaces; Feed (and Facebook Feed, same shape) only.
- Changing or removing "Carrossel avulso" — it keeps existing as-is for manual/exploratory use. This is a second, independent way to get a carousel, not a replacement.
- Per-slide approval — the whole carousel is approved/rejected as one unit, same granularity as every other content item today.

---

## Current state (what this builds on)

- `generateContentSchedulePlan` (`src/content-central.js:2844`) builds one `item` per `(day, format, slot)` in a synchronous loop, each with a single `image: { localPath, prompt, references, aspectRatio, dimensions, ... }`. Placeholder items are written to disk immediately; `enqueueBatchImageGeneration` → `enrichBatchItemsWithRealImages` fills in the real AI image in the background.
- Topic selection for each slot goes through `nextContentTopic()` (closure inside `generateContentSchedulePlan`), which pulls from `buildTopicPool`/pillar rotation/offer rotation — the same subject logic every channel already shares.
- Approval (`item.approval`) and publish (`item.publish`) are plain fields on the item; `publishContentToInstagram` (`src/content-central-server.js:4481`) uploads `content.image` and calls `squads/conteudo-multicanal/tools/meta-publish-multi.js`, which today only knows single-image (`publishInstagramFeed`) and single-video (`publishInstagramReels`) container flows — no `CAROUSEL_ALBUM`/`children` path exists anywhere in the codebase.
- The standalone carousel engine (`generateCarousel`/`runCarouselGeneration`/`enrichCarouselSlideWithRealImage`, all in `content-central.js`, built in `[[2026-08-26-carrossel-avulso-design]]` + its two follow-up commits) already solves: roteiro generation from a subject, slide-1-first sequential generation with slide 1 threaded back as a real visual reference for the rest, and a typography/consistency-tuned prompt. This design **reuses that engine**, retargeted at a batch item instead of a standalone `content/carousels/*.json` file.

---

## 1. Config surface

Two new fields on `project.contentSettings`, next to `defaultDaysToGenerate`/`catalogStoriesPerDay` (same tab: "Agenda e Geração" — not Raio-X, which holds brand facts/voice, not posting cadence):

- `carouselsPerWeek` (integer, default `0` = feature off, clamp `0..7`)
- `maxCarouselSlides` (integer, default `3`, clamp `2..10` — same hard limit `CAROUSEL_SLIDE_COUNT_MIN/MAX` the standalone carousel already enforces, kept lower by default since an automatic weekly carousel is meant to be a light, frequent format, not the avulso's up-to-10-slide deep dive)

Validated/defaulted wherever the rest of `contentSettings` is currently read and normalized (see the pattern at `content-central.js:1591` — `updateCatalogSettings` — for the catalog-mode equivalent; the marketing-mode settings path is pinned exactly during planning).

## 2. Data model — carousel as a batch item

A carousel-format item is the **same item shape** every other content item already has (`contentId`, `batchId`, `scheduledDate`, `channel: 'instagram_feed'`, `contentTopic`, `approval`, `publish`, `filePath`, ...), with two differences:

- New field `format: 'single' | 'carousel'` (default `'single'` — every existing item implicitly stays `'single'`, no migration needed for old data).
- When `format === 'carousel'`: no `image` field. Instead, `slides: CarouselSlide[]` — reusing the exact `CarouselSlide` shape the standalone feature already defines (`slideId`, `order`, `role`, `slideText`, `contentTopic`, `image: {...}`, `imageGenerationError`), plus `carouselFormat: string` (the roteiro's chosen format, e.g. `"listicle"` — same field the standalone `Carousel.format` already holds).

This item still lives in the same per-day batch file the loop at `content-central.js:2966` already writes (`content/drafts/<batchId>/day-XX-instagram_feed-01.json`) — no new directory, no new file convention. `content/carousels/` (the standalone feature's storage) is untouched and unrelated.

## 3. Scheduling — which days become carousel

Inside `generateContentSchedulePlan`'s day/slot loop, for the `instagram_feed` format specifically: before building a normal single-image item, decide if this `(scheduledDate, slotNumber)` is one of this week's carousel slots.

- Quota is weekly, not per-batch: `carouselsPerWeek` carousels distributed evenly across the 7 weekdays of each week the batch covers (a `days: 14` generation with `carouselsPerWeek: 2` produces 2 carousels in week 1 and 2 in week 2, not 4 in week 1). Distribution is deterministic, not random (matches this codebase's existing preference — see `pickRotatingReferenceList`'s seeded-not-random comment): within each 7-day window, step size `= floor(7 / carouselsPerWeek)`, picking `dayIndexInWeek = 0, step, 2*step, ...` until `carouselsPerWeek` days are picked. E.g. `carouselsPerWeek: 2` → weekdays 0 and 3; `carouselsPerWeek: 3` → weekdays 0, 2, 4. A partial trailing week (batch length not a multiple of 7) gets its quota scaled down proportionally (`round(carouselsPerWeek * remainingDays / 7)`), never picking a day past the batch's actual last day.
- `carouselsPerWeek` clamped to `0..7` — asking for more than 7 carousels in a 7-day week is nonsensical; treat as "every day".
- If a chosen carousel day's `instagram_feed` format slot doesn't exist in that generation's `formats` (operator generated a batch with only Story, no Feed) — the quota silently has nothing to attach to that day; skip it rather than inventing a Feed slot the operator didn't ask for. `maxCarouselSlides === 0`-equivalent (quota `0`) is the existing, already-correct "feature off" behavior — no other special case needed.
- The chosen day's `nextContentTopic(...)` call happens exactly as today (same pool, same pillar/offer rotation) — the resulting `contentTopic` becomes the carousel's subject. A new small helper turns that topic into the outline generator's `briefing` string (reusing `contentTopic.objective`/`label`/`items`, the same fields `buildCarouselSlideContentTopic` already reads for the standalone flow) — the operator never types anything for an automatic carousel.
- `slideCount` for these items = `project.contentSettings.maxCarouselSlides` (clamped), not operator-chosen per generation like the standalone tab.

## 4. Generation pipeline

The placeholder-then-background-fill split stays: the synchronous loop writes a `format: 'carousel'` item with `slides` in `{ generating: true }` skeleton state (same shape `buildCarouselSlideSkeleton` already produces), batch response returns immediately.

`enrichBatchItemsWithRealImages` (`content-central.js:2513`, the background worker `enqueueBatchImageGeneration` calls) gets a branch: an item with `format === 'carousel'` skips the existing single-image `imageWork`/`captionWork` pair entirely and instead runs the **same roteiro-then-slide-1-then-rest-with-reference pipeline** `runCarouselGeneration` already implements — extracted so both the standalone route and this batch path call the same underlying function against different item shapes (the function only needs `{ slides, slideCount, briefing }` on its subject, which both a standalone `Carousel` and a batch item can provide). Caption generation for the carousel's own post text still runs exactly as it does for every other item today — a carousel post has one caption, same as a single-image one.

Concurrency: a batch with several carousel days generates each carousel's slide-1-then-rest sequentially per carousel, but different carousels' pipelines can run in parallel with each other and with the batch's other single-image items, same `BATCH_IMAGE_CONCURRENCY`-bounded pattern already governing the rest of `enrichBatchItemsWithRealImages`.

## 5. Approval

`item.approval`/the email-approval flow stay structurally the same (one `approved`/`rejected` decision per item, same fields). The rendering changes: wherever the approval email/review page today embeds `item.image`'s single preview, it branches on `item.format` — `'carousel'` renders all N `slides[].image` stacked vertically, in order, each labeled with its role (Capa/Conteúdo/CTA) — a plain list of images, not the standalone tab's swipe/scroll-snap `CarouselPreview` component. One approve/reject action still covers the entire carousel, not per-slide. Porting the swipe-style feed preview into the review screen is real, but separate, follow-up scope — out of this design.

## 6. Real publish — Graph API `CAROUSEL_ALBUM`

New `publishInstagramCarousel(target)` in `squads/conteudo-multicanal/tools/meta-publish-multi.js`, alongside the existing `publishInstagramFeed`/`publishInstagramStory`/`publishInstagramReels` (`meta-publish-multi.js:191-250`). Same two-step container pattern those already use, with an extra fan-out step:

1. For each slide's `image_url`, create a child media container with `is_carousel_item: true` (no caption on children — Meta ignores it there anyway).
2. Create one parent container with `media_type: 'CAROUSEL'`, `children: <comma-separated child container ids>`, and the post's real caption.
3. Publish the parent container's `creation_id` — same publish call every other channel already uses.

`publishContentToInstagram` (`content-central-server.js:4481`) branches on `content.format === 'carousel'`: uploads every slide's local image (parallel `uploadGeneratedImagePublicly` calls, same function already used for single images), builds the `publish_targets[0]` payload as `{ channel, image_urls: [...], caption }` instead of `{ image_url, caption }`, and `meta-publish-multi.js`'s `publishTarget` dispatches to `publishInstagramCarousel` when `image_urls` (plural) is present instead of `image_url`.

Retry semantics (`maxAttempts`/`retryDelayMs`/`settleDelayMs`) stay identical — a failed carousel publish retries the whole thing (re-upload + re-create every child container) rather than trying to resume from a partial child-container state, same all-or-nothing shape the existing retry loop already has for single images.

## Error handling

- **Outline/roteiro fails** (same failure mode `runCarouselGeneration` already handles for the standalone flow): the item's `slides` all get `imageGenerationError` set to the roteiro error, `format` stays `'carousel'`, item still reaches a terminal, reviewable state instead of hanging — approval screen shows the error same as any other generation failure today.
- **One slide's image fails**: isolated per-slide, same as the standalone flow — the carousel still reaches "ready" with N-1 real slides and one errored slot the operator can regenerate individually before approving (reuses the existing per-slide regenerate machinery, exposed through whichever review UI ships with this — see open question below).
- **Publish fails mid-way** (e.g. child container 3 of 5 fails): whole publish attempt fails and retries per the existing retry loop; no partial-carousel is ever left "half published" on Meta since nothing is published until the final parent-container publish call, which only happens after every child container succeeded.

## Testing

Same layers this codebase already tests at:
- `content-central.js`: unit tests for the weekly quota's day-distribution function (given `days` + `carouselsPerWeek`, which exact days get picked — deterministic, so exact-match assertions), and for the extracted shared roteiro-then-slides pipeline being callable against a plain batch-item-shaped object (not just a standalone `Carousel`).
- `content-central-server.js`: HTTP-level test that a generated batch's carousel day produces a `format: 'carousel'` item with real (mocked) slide images, and that `publishContentToInstagram` on a `format: 'carousel'` item calls `meta-publish-multi.js` with `image_urls` (plural).
- `meta-publish-multi.js` (check whichever test file already covers `publishInstagramFeed`/`publishInstagramStory` for the existing pattern): `publishInstagramCarousel` creates N child containers then 1 parent, asserts the exact Graph API call sequence against a mocked `graphRequest`.

## Open question for the implementation plan

- Exact function/route that currently persists marketing-mode `contentSettings` (the catalog-mode equivalent is `updateCatalogSettings`, `content-central.js:1591`) — pin the real call site before writing tasks. Everything else in this design (data model, distribution algorithm, approval rendering, publish flow) is fully specified above.
