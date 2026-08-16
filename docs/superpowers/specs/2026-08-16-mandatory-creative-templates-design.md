# Mandatory creative templates — design

## Problem

Today, AI creative generation decides its own composition. The operator
supplies company facts, offer data, product photos, and — optionally — a
`layout_model` reference the generator is told to loosely follow (with a
strength of `free`/`balanced`/`strict` decided by code, not the operator).
Composition still varies attempt to attempt, and an AI-scored review loop
(format/facts/brand/layout/product/visualQuality, 3-5 attempts) exists to
catch drift — but the operator experience is: many regenerations, results
that still read as generic/plain, and no visibility into which numbers or
rules are actually driving a rejection (see
`docs/content-central-creative-platform-rules.md`, written this same
session, for the full inventory of currently hardcoded rules).

The operator's diagnosis, confirmed through brainstorming: stop letting
the AI decide structure at all. Every creative is generated from an
operator-authored template — an image plus a written structure
description — for its exact post type. The AI regenerates pixels
(background, lighting, product rendering) inside that fixed structure; it
never chooses layout. With structure locked at the source, the AI-scored
review loop's job (catching structural drift) no longer exists to do, so
it's removed — a single generation goes straight to human approval, same
as any other draft today.

## Goals

- Every creative generation is driven by an operator-authored template
  scoped to (segment, post type, format shape) — never free AI-decided
  composition.
- Templates are authored directly (upload image + write the structure
  rule), not learned indirectly by approving/rejecting generated content
  after the fact.
- A segment/post-type/shape combination with no template registered
  **blocks generation** with a clear message — no silent fallback to
  today's free-form behavior.
- The AI-scored review/regeneration loop
  (`generateAiImageWithReviewLoop`'s `imageReviewer` call, the
  format/facts/brand/layout/product/visualQuality thresholds, rescue mode)
  is removed from the generation path.
- Rolls out to every project — the mechanism is global — but each
  segment only generates once it has its own templates; no cross-segment
  template sharing, no universal pool.

## Non-goals

- Not building a deterministic/no-AI templating engine (SVG/HTML
  compositing). The AI image generator (Codex) still renders every pixel;
  only the structural decision is taken away from it. (Confirmed in
  brainstorming: the operator explicitly wants "usa o Codex", structure
  locked, background/scenery still AI-generated.)
- Not building a "free model" fallback for segments with no template yet.
  Operator explicitly deferred this ("nem que mais pra frente eu coloque
  modelo livre... deixa assim por enquanto").
- Not touching offer/product-photo selection, rotation, or the
  creative_redraw treatment — unchanged.
- Not touching the CTA-button-only-on-ads policy, the reviewer-retry, or
  the other fixes already committed on this branch (`3a4dc5e`) for
  anything **other than** layout strength — this design's "always strict
  when a template exists" supersedes that commit's conditional
  (price/CTA-gated) strict logic specifically.

## Design

### Data model: creative template

A new entry type, stored alongside (and reusing the storage location of)
today's segment-learning assets
(`_opensquad/content-central/assets/learning/segment/<segmentKey>/`).
Today's segment learning entry already carries an image + free-text
instruction + `purpose` (`'creative'` supported already via
`normalizeLearningImagePurpose`/`learningImageAnalysisContext`). This
reuses that shape and adds two required fields:

- `postType`: one of `offer | institutional | special_date | ad_creative`
  — derived the same way the prompt builder already derives
  `isGoalTopic`/`isSpecialDateFreeTitle`/`isAdCreativeFreeTitle` from
  `topic.source`/`topic.type`, so tagging a template reuses that existing
  classification instead of inventing a new one.
- `shape`: `vertical | feed` — reuses
  `creativeShapeGroupForChannel(channel)`, already used to decide which
  channels can share one generated creative.

A template entry is authored directly: upload an image, write the
structure rule as free text (same shape as today's `layout_model`
`instruction` field), tag postType + shape. No approval-of-generated-
content step required to create one — that path still exists separately
for the organic "Aprovado"/"Evitar" learning gallery, untouched by this
design.

### Generation flow

In `buildPrimaryAiImageReferences` (content-central.js):

1. Derive `postType` from the topic the same way the prompt builder
   already does (`topic.source === 'goal'` → institutional,
   `topic.source === 'special_date' && !topic.offerId` → special_date,
   `topic.source === 'ad_creative' && !topic.offerId` → ad_creative,
   else → offer).
2. Look up templates matching `(segmentKey, postType, shape)`.
3. **None found** → the generation call fails with a clear, specific
   error (e.g. `Nenhum modelo de criativo cadastrado para {postType} /
   {shape} neste segmento — cadastre um modelo antes de gerar.`),
   surfaced to the operator in the generation UI. This replaces silent
   fallback to free composition entirely for this code path.
4. **One or more found** → rotate-select one using the existing
   `pickRotatingReferenceList` (same seeded rotation already used for
   `layout_model`/`visual_reference` selection — no new selection
   mechanism).

In `buildCreativeSpec` (content-central.js):

- `layoutStrength` becomes unconditionally `'strict'` whenever a matching
  template was found for this generation. This **replaces** the
  `hasPriceOrCta` gate added earlier today on branch `3a4dc5e` — that gate
  existed to stop STRICT from being forced onto institutional posts with
  no price/CTA zones to fill; under this design every generation with a
  template is intentionally, unconditionally structure-locked, so the
  gate's job is now handled upstream by "no template → blocked" instead.

The existing `creativeLayoutZones()` generic percentage bands (0-18/18-
68/68-86/86-100 etc.) stay in the prompt as a secondary/generic scaffold —
harmless, and the prompt already places the template's own instruction
text above them in priority (`REFERÊNCIA PRINCIPAL` section already reads
"Direção do usuário" from the reference's `instruction` field before the
generic zone list). No change needed there.

### Review loop removal

In `generateAiImageWithReviewLoop` (content-central.js):

- Stop calling `options.imageReviewer`. Generation runs once
  (`maxAttempts` effectively 1 for the quality-review purpose — the
  attempt loop itself can stay as infrastructure for a future non-quality
  retry reason, but nothing in this design drives a second attempt).
- `shouldEnterStoryRescueMode` and the rescue-mode branch become
  unreachable once `finalReview` is never populated — no separate removal
  needed, dead code falls away naturally. (Follow-up cleanup, not part of
  this change, can delete the now-dead rescue-mode code once this ships
  and proves out.)
- `content.contentReview`/`content.creativeReview` drop the
  score/threshold fields entirely; the card's review state becomes purely
  "generated, awaiting human approval" — same as content that already
  skips AI review today (e.g. catalog-project recomposed photos).

`normalizeCreativeReview`, its `thresholds` object, and
`buildAiImageReviewPrompt` (content-central-server.js) become dead code
under this flow — left in place (not deleted) as part of this change,
since deleting a whole review subsystem is a separate decision from
wiring it out of the default path; a follow-up cleanup can remove it once
the new flow is proven.

### What doesn't change

- Offer/product selection, rotation seeds, `creative_redraw` treatment,
  CTA policy (ad-only button, subtle elsewhere — committed on `3a4dc5e`),
  the reviewer-retry-3x fix (moot once the reviewer call is removed, but
  left as-is rather than reverted — harmless dead code on the now-unused
  path).
- Brand assets (logo), brand colors, manual vivo / Raio-X text inputs —
  still folded into the prompt exactly as today.

## Rollout

The mechanism ships enabled for every project (no per-project flag) —
each segment simply blocks on generation until its own templates exist.
This branch (`content-central-creative-fixes-wip`) is where it's built
and tested, on a separate dev-server port from the production working
copy, before any of this reaches `work`/production. CASA DE EMBALAGEM is
the first segment to get real templates authored once the mechanism
works.

## Testing

- `buildPrimaryAiImageReferences` (or its caller) returns/throws a clear
  blocking result when no template matches `(segmentKey, postType,
  shape)` — covers all four postTypes and both shapes.
- Matching template found → `layoutStrength` is `'strict'` regardless of
  whether the topic has a price/CTA (supersedes the existing
  `hasPriceOrCta`-gated test from `3a4dc5e`).
- Multiple templates for the same `(segmentKey, postType, shape)` rotate
  via the existing seeded rotation, not always the same one.
- `generateAiImageWithReviewLoop` never calls `imageReviewer`; produced
  content has no score/threshold fields and reaches `draft_generated`
  after exactly one generation call.
- Existing reviewer-loop tests (attempt counts, rescue mode, threshold
  blocking) that assert the now-removed behavior get deleted or
  rewritten to assert the new single-attempt, no-review behavior.

## Open follow-ups (explicitly deferred, not in scope here)

- A "free model" fallback for segments without templates yet.
- Deleting the now-dead reviewer infrastructure
  (`normalizeCreativeReview`, thresholds, `buildAiImageReviewPrompt`,
  rescue mode) instead of leaving it unreferenced.
- A dedicated "Modelos de criativo" management UI in content-central-app
  (upload + tag + write rule) — this design covers the data model and
  generation-side lookup; the authoring UI is implementation-plan scope,
  not architecture-decision scope.
