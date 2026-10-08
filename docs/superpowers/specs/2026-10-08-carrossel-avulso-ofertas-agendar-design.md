# Carrossel avulso: tema de oferta/assunto em alta, visual clean, planejar por mensagem, agendar

Builds on `[[2026-08-26-carrossel-avulso-design]]` and
`[[2026-08-27-carrossel-automatico-calendar-design]]`.

## Problem

The Carrossel tab has never been used for real: 0 standalone carousels in
any project, 0 automatic carousel items in any batch (checked 2026-10-08).
Reasons visible in the code:

- The theme is free text only. The operator retypes what is already
  registered in "Ofertas e assuntos", and the slides never get the offer's
  product photos or price (`buildCarouselSlideContentTopic` builds a bare
  `institutional` topic with no `photoReferenceIds`).
- There is no help picking a subject, though a web-research topic agent
  already exists (`generateTopicIdeasWithAiAndWeb`, `content-central-server.js:4479`).
- A finished carousel is a dead end: no caption, no schedule, no publish.
  Only the automatic calendar path can publish a carousel
  (`publishCarouselToInstagram`, `content-central-server.js:5147`).
- The look is the default "rich" one with a drawn title. The operator wants
  the clean carousel style most used on Instagram today.

## Goal

Four additions to the existing Carrossel tab. Nothing else on the tab changes.

1. Fill the theme from a registered offer/assunto, or from a list of trending
   subjects for the project's segment.
2. Clean visual as the carousel default.
3. Schedule a finished carousel for a date and time. It enters the calendar
   already approved and publishes on its own.
4. Plan before generating. The operator's message returns a slide-by-slide
   plan, which they adjust by message. Images are generated only once they
   ask for it (section 4).

## 1. Theme sources

The form keeps the free-text `briefing` textarea and gains two ways to fill it.

**Puxar de Ofertas e assuntos.** A select lists the project's active entries
from `normalizeProjectOffers(project.contentStrategy.offers)`, offers and
assuntos alike. Picking one fills the textarea with
`carouselBriefingFromContentTopic` applied to that entry (name, objective,
items). The operator can still edit the text. The request sends `offerId`
along with `briefing` and `slideCount`.

- `generateCarousel` stores `offerId` on the carousel (`schemaVersion` stays 1;
  the field is absent on old carousels, same as blank).
- The offer entry is reread from the project when the slides are built, not
  copied when the carousel is created, so a price edited in Ofertas before
  generation is honored.
- When `offerId` resolves, `buildCarouselSlideContentTopic` copies these offer
  fields onto every slide's topic: `offerName`, `price`, `originalPrice`,
  `priceUnit`, `photoReferenceIds`, `productTreatment`, and `type`
  (`'offer'` for an offer). This lets `buildImageReferencePayload`/
  `buildPrimaryAiImageReferences` attach the real product photos, the way
  they already do for a single offer post.
- The roteiro prompt (`buildCarouselOutlinePrompt`) also gets the offer's price
  and unit. Price/promise text may only come from what is registered, the
  rule `formatContentTopicLines` already enforces for posts.
- An `offerId` that no longer exists (deleted between selecting and
  generating) falls back to the plain briefing behavior. It never throws.
- For an agency, the entry is a service. The same flow applies: the roteiro
  breaks one big subject into N slides. A multi-offer carousel (one product
  per slide) is out of scope.

**Assuntos em alta do segmento.** A button next to the textarea calls a new
route, `POST /api/projects/:id/carousels-topic-ideas`. That route runs
`collectOnlineTopicResearchEvidence` plus one `callAiText` prompt, asking for
5 carousel-shaped subjects (`{ title, angle }`) for the segment, products and
audience in the Raio-X. The panel lists them, and clicking one fills the
textarea.

- The result is not persisted. The button is on-demand, and nothing reads the
  ideas later.
- The route errors (no AI configured, search and AI both failing) come back as
  a visible message under the button. The form stays usable.
- The prompt keeps the existing rules: no invented numbers, prices or cases,
  and no copying competitors (same lines as `buildTopicIdeasPrompt`).

## 2. Clean visual (carousel default)

Every standalone carousel slide topic gets `backgroundStyle: 'simple_brand'`
and `titleStyle: 'clean'`. These are the same two per-offer switches the
prompt builder already honors (`buildChatGptFinalCardPrompt`: background lock,
`LETRA DO TÍTULO`, `vary()` dropping "tipografia"). An offer pulled in by
`offerId` does not override them, because the carousel's look is a carousel
decision.

A carousel-only `ESTILO CARROSSEL CLEAN` block is added to the prompt when
`topic.source === 'carousel'`:

- flat or light brand-color background, no textures, waves or busy graphics
- one large title, at most 1–2 short support lines
- generous margins and empty space
- small logo, same corner on every slide
- when a product photo is attached, it is the visual focus, clean cutout, no
  collage

The roteiro prompt asks for short slide text: a title of about 8 words or
fewer and at most one support line. This also fixes the dense slides from
the 27/08 feedback.

Scope: only the standalone tab gets this. The automatic calendar carousel
keeps its current look until it is decided separately.

## 3. Schedule (Agendar)

A ready carousel card (`status: 'ready'`, every slide with an image and no
`imageGenerationError`) gets an **Agendar** button that opens a small form:

- date (default: tomorrow)
- time (default: `project.contentSettings.defaultPostTime`)
- caption: generated on open by `POST /api/projects/:id/carousels-caption/:carouselId`.
  That route runs `writeAiCaptionForItem` against an in-memory item built from
  the carousel (briefing, slide texts, offer fields) and returns the text
  without saving it. The caption is editable before confirming.

Confirming calls `POST /api/projects/:id/carousels-schedule/:carouselId` with
`{ date, time, caption }`. That runs a new `scheduleCarousel(projectId,
carouselId, { date, time, caption })`, under `withProjectLock`, which:

- creates a one-off batch dir `drafts/<date>-carrossel-<token>/`, using the
  same token pattern as `generateFlyerContent` (`Date.now()` plus a counter),
  so two carousels on the same day never collide
- copies every slide image file into that batch's `images/` directory and
  points each slide's image path there, so deleting the standalone carousel
  later never breaks the scheduled post
- writes one item in the same shape as an automatic carousel item:
  `format: 'carousel'`, `channel: 'instagram_feed'`, `slides`, `carouselFormat`,
  `scheduledDate`, `scheduledTime`, `caption`, and `status: 'aprovado'` with
  approval stamped as approved by the operator
- records `scheduled: { contentId, batchId, date, time }` on the standalone
  carousel, so its card shows "Agendado para dd/mm hh:mm". Scheduling again
  creates a second post, which is allowed: the same carousel on two dates.

Publishing needs no new code. `runDuePublishSweep` already picks up approved,
due items, and `publishContentToInstagram` already branches to
`publishCarouselToInstagram` for `format === 'carousel'`.

Validation: `date` must match `YYYY-MM-DD` and `time` must match `HH:MM`. The
carousel must be ready with no failed slide; otherwise the error is
"Gere todos os slides antes de agendar."

**Known limit (accepted 2026-10-08):** the gaveta cloud publisher skips
carousel items (`content-central-server.js:180`), so a scheduled carousel only
goes out if the PC is on at the scheduled time. This also applies to
automatic carousels. Teaching gaveta to publish `CAROUSEL_ALBUM` is the next
separate step.

## 4. Plan → adjust by message → generate images

Today `POST /carousels` runs the roteiro and every image in one go. The
operator only sees the roteiro once the images are already paid for, and a
failed roteiro means delete and start over. The standalone flow becomes three
steps. The automatic calendar path keeps calling `runCarouselGeneration` in
one go, unchanged.

**Statuses.** Two new values join `'generating' | 'ready'`:
`'planning'` (roteiro call running) and `'plan_ready'` (plan shown, no
images). Existing carousels on disk already hold `generating`/`ready` and
render exactly as today.

**Plan.** `POST /api/projects/:id/carousels` with `{ briefing, slideCount,
offerId }` calls `generateCarousel`, which now creates the carousel with
`status: 'planning'`. The route then fires `enqueueCarouselPlanning` in the
background instead of `enqueueCarouselGeneration`.

- `enqueueCarouselPlanning` runs the roteiro half of `runCarouselGeneration`,
  extracted as `applyCarouselOutline`: it calls `outlineGenerator`, then fills
  `slideText`/`role`/`contentTopic` and sets `format`.
- It sets `status: 'plan_ready'` and every slide's `image.generating: false`.
  No image is generated.
- The panel polls `listCarousels` while the status is `planning`, the same
  polling that already runs during `generating`.

**Adjust.** `POST /api/projects/:id/carousels-replan/:carouselId` with
`{ message }`. This is allowed only when the status is `plan_ready`;
otherwise it returns 409 "O plano só pode ser ajustado antes de gerar as
imagens."

- Appends `{ text, at }` to a new `planMessages` array and sets
  `status: 'planning'`.
- Calls the outline generator in the background with two new optional
  inputs: `currentPlan` (format plus `[{ role, slideText }]`) and `request`
  (the message).
- `buildCarouselOutlinePrompt` gets an "AJUSTE PEDIDO PELO OPERADOR" block
  when they are present: keep everything the request doesn't touch, change
  only what was asked, never invent price or data.
- The slide count may change only if the request asks for it. The new count
  is the returned length, clamped to `CAROUSEL_SLIDE_COUNT_MIN..MAX`, and
  slides are rebuilt with `buildCarouselSlideSkeleton`.
- `writeCarouselOutlineWithHermes` stops requiring `slides.length ===
  slideCount` on a replan, and accepts any length inside the clamp. A first
  plan still requires the exact count.

**Replan failure keeps the previous plan.** The previous slides are kept
untouched, `planError` is set to "Não consegui ajustar o plano, tente de
novo.", and the status goes back to `plan_ready`. `planError` is cleared on
the next successful plan or replan.

A failed **first** plan (no previous plan) also lands in `plan_ready`, with
`planError` set and empty slides. The panel then shows a "Tentar de novo"
button, which re-runs planning with the same briefing. Delete-and-recreate is
never required.

**Generate images.** `POST /api/projects/:id/carousels-generate/:carouselId`.
Allowed only when the status is `plan_ready`, every slide has `slideText`, and
there is no `planError`; otherwise 409.

- Sets `status: 'generating'` and every slide's `image.generating: true`.
- Fires the image half of `runCarouselGeneration`, extracted as
  `generateCarouselSlideImages`: slide 1 first, then the rest with slide 1
  as the style reference, then `status: 'ready'`.

`runCarouselGeneration` becomes `applyCarouselOutline` followed by
`generateCarouselSlideImages`, so the batch path behaves exactly as before.

**Panel (`Carousels.tsx`).**

- The form's textarea is labeled "O que você quer neste carrossel?". The
  offer select and the trending button fill it, as in section 1. The button
  reads **Planejar**.
- A `plan_ready` card shows:
  - the operator's messages, in order
  - one card per slide (role label plus `slideText`)
  - the `planError`, when present
  - a "O que mudar?" textarea with an **Ajustar** button
  - a **Gerar imagens** button
- A `planning` card shows "Planejando…" over the previous plan when there is one.
- `generating`/`ready` cards render as today, plus Agendar (section 3).

## Testing

Tests go in `tests/content-central.test.js` and
`tests/content-central-server.test.js`, plus the `Carousels.test.tsx` panel
test.

- With `offerId`, slide topics carry the offer's `photoReferenceIds` and price,
  and the roteiro prompt contains the price. With an unknown `offerId`, the
  carousel generates exactly as without one.
- Standalone slide topics have `backgroundStyle: 'simple_brand'` and
  `titleStyle: 'clean'`, and the built prompt contains the clean block.
- `scheduleCarousel` writes an `aprovado` carousel item with the right
  date/time/caption, with image files copied and not regenerated (the image
  generator is never called). It refuses a carousel with a failed or missing
  slide. Two schedules of the same carousel on the same day produce two
  distinct items.
- `runDuePublishSweep` publishes the scheduled item through the carousel
  path. This reuses the existing carousel publish test setup.
- Topic-ideas route: returns the ideas list; an AI failure gives a readable
  error, not a 500.
- Plan: creating a carousel runs the outline only. The status ends at
  `plan_ready`, slides have text, and the image generator is never called.
- Replan: the prompt contains the current plan and the request, and
  `planMessages` grows by one. A requested count change (3 → 6) rebuilds
  6 slides. A failed replan keeps the previous slides and sets `planError`.
  Replanning while `generating`/`ready` returns 409.
- Generate: allowed only from a clean `plan_ready`; images follow the plan's
  `slideText` and the status ends at `ready`. The batch carousel path still
  produces the same item as before (the existing tests stay green).
- Panel: the offer select fills the textarea and sends `offerId`; clicking an
  idea fills the textarea; Planejar shows the plan; Ajustar sends the message;
  Gerar imagens is disabled while `planError` is set; Agendar is hidden until
  the carousel is ready, and then shows the scheduled label.

## Out of scope

- gaveta publishing carousels (next step, see Known limit)
- multi-offer carousel (one product per slide)
- a Clean/Rico style picker
- reordering slides, or editing slide text directly on the card (adjusting
  by message covers it)
- a full chat with the Cérebro about the carousel (the operator chose the
  quick in-tab adjust)
- changing the automatic calendar carousel's look or config
