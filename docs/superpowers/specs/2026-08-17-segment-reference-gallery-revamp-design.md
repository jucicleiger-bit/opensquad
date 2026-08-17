# Segment reference gallery revamp — design

## Problem

`AprendizadoSegmento.tsx` loads Setor + Nicho as separate `SegmentLearningNode`s
and renders one full `LearningGallery` card per node
(`content-central-app/src/pages/AprendizadoSegmento.tsx:83-95`). With
`splitImagePurposes` on, each of those cards renders its own complete
"Referencias de produto" section — so the operator sees the same section
title, upload control, and empty state twice on one screen, once per
hierarchy level, with no indication they're two different scopes.

Separately, `CreativeStructureGallery`'s "Formato" field (Story/Feed) is
required to save a structure (`canConfirmCreative`/`canSaveEdit` in
`LearningGallery.tsx:125-126`), forcing the operator to duplicate a
structure that actually works for both shapes.

Separately, the operator has no visibility into which registered creative
structure (if any) drove a given AI generation, or whether the registered
product-reference photo was used at all — and, per investigation below,
today it never is.

**A dependency was found during design, not before it:** the segment
"Referencias de produto" pool is currently wired to be permanently inert
during generation. This was a deliberate decision recorded in
`docs/superpowers/specs/2026-08-16-mandatory-creative-templates-design.md`
("Known limitations" — "leave this exactly as it is"). This design
reverses that specific decision at the operator's request (see Part B) —
everything else in that doc stays in effect.

## Goals

- "Referencias de produto" appears once per segment tree (with a
  Setor/Nicho scope selector, same UX as the existing "Estruturas de
  criativo" selector), not once per node card.
- "Estruturas de criativo" renders as a card grid (image, name,
  postType/shape pills, description) instead of a stacked list.
- A structure's "Formato" (Story/Feed) becomes optional — left blank, it
  matches generation for both shapes. "Tipo de post" stays required.
- The segment product-reference photo actually reaches AI generation as a
  texture/plausibility reference — explicitly **not** as a literal
  "use only this exact photo" lock. It never gates generation the way a
  missing structure template does; it's purely additive when present.
- A generated creative records which structure (if any) and whether a
  product reference was used, and the operator-facing approval card shows
  it.

## Non-goals

- Not touching the mandatory-template blocking behavior itself (no
  structure match for `postType`+`shape` still throws and blocks
  generation, per the 2026-08-16 design) — only the shape-matching rule
  within it (exact → optional-blank-matches-both) and the addition of the
  separate, non-blocking product-reference lane.
- Not adding a "nome"/card treatment to product references (confirmed:
  structures only get the card grid; product references stay a simple
  photo+caption list).
- Not touching `AprendizadoTipoOferta.tsx`'s gallery (offer-type learning)
  — it has one node per offer type already, no duplication there.
- Not binding the generic "Adicionar texto" (Aprovado/Evitar/Base
  tecnica) to individual product-reference images — confirmed it stays a
  separate, general note mechanism.
- Not changing `visual_reference` ("Inspiração visual") or project-level
  `layout_model` references — still inert per the prior design, untouched
  here.

## Design

### A. Frontend — dedupe + card grid (`LearningGallery.tsx`, `AprendizadoSegmento.tsx`)

- `LearningGallery` gets a new prop `showProductReferences` (default
  `true`), mirroring the existing `showCreativeStructures`. In
  `AprendizadoSegmento.tsx`'s per-node cards it's passed `false` (same
  place `showCreativeStructures={false}` is already passed today).
- New exported component `ProductReferenceGallery`, structurally parallel
  to `CreativeStructureGallery`: same node-scope `<select>`
  ("Salvar e editar referencias de produto em"), renders one
  `LearningGallery` scoped to the selected node with
  `onlyCreativeStructures` inverted (i.e. only the product-reference
  section, structures and buckets both off). Rendered once in
  `AprendizadoSegmento.tsx`, next to `CreativeStructureGallery`, above the
  `nodes.map` loop.
- `CreativeStructureGallery`'s entry list (`LearningGallery.tsx:260-313`)
  changes from a stacked `stack-sm` column to a CSS grid of cards
  (`repeat(auto-fill, minmax(220px, 1fr))` or similar) — each card keeps
  the existing image/title/pills/description/edit/apagar, just laid out
  as a grid tile instead of a full-width row.
- "Formato" stops being required:
  - `canConfirmCreative` (`LearningGallery.tsx:125`) drops `pendingShape`
    from the condition — becomes
    `pendingImage?.purpose !== "creative" || (pendingStructureTitle.trim() && pendingPostType)`.
  - `canSaveEdit` (`LearningGallery.tsx:126`) drops `.shape` —
    `editingStructure.title.trim() && editingStructure.postType`.
  - Both `<select>`s for Formato stay in the UI (still settable), just no
    longer block save when left on "Selecione". `SHAPE_LABELS` gets no
    new entry — blank stored value already means "both", no third enum
    value needed.
  - Card grid shows the Formato pill only when set; unset renders no
    shape pill (implicitly "both").

### B. Backend — tag reference kind, relax shape match, revive product reference

In `buildSegmentLayoutReferences` (`content-central.js:7197-7255`):

- Creative-purpose entries get `reference.referenceKind = 'segment_structure'`
  (alongside the existing `reference.title`/`postType`/`shape` assignment
  at lines 7229-7233).
- The product entry gets `reference.referenceKind = 'segment_product'`
  (new — added next to its existing `absolutePath`/`previewUrl`
  assignment around line 7249-7250). Its instruction text
  (`SEGMENT_PRODUCT_REFERENCE_INSTRUCTION`, line 7183) already says
  "use como inspiração... não copie esta foto específica" — matches the
  operator's ask exactly, unchanged.

In `buildPrimaryAiImageReferences` (`content-central.js:5876-5960`):

- `matchingLayouts` (line 5941-5946): add
  `reference.referenceKind === 'segment_structure'` to the filter (so a
  product-purpose entry can never accidentally satisfy the mandatory-
  template check), and relax the shape check from
  `reference.shape === shape` to `(!reference.shape || reference.shape === shape)`.
  `postType` stays an exact-match requirement — unchanged. Comment at
  5937-5940 gets updated to reflect that blank `shape` is now a
  deliberate "applies to both" tag, not a legacy-untagged case to reject.
- New line after `layoutReferences` (5956): a `segmentProductReferences`
  lane — `selected.filter(r => r.role === 'layout_model' && r.referenceKind === 'segment_product').slice(0, 1)`.
  Included unconditionally when present (no postType/shape gate, no
  effect on the mandatory-template blocking check — purely additive).
  Added into the final `uniqueReferences([...])` call (line 5959),
  alongside `layoutReferences`.
- No change needed to `selectOpenAiImageEditReferences`
  (`content-central-server.js:1440-1446`) — it already reserves up to 2
  `layout_model`-role slots, which now covers "structure + product"
  together instead of just "structure" alone.

In `generateAiImageWithReviewLoop` (`content-central.js:5071-5148`), after
`baseReferences` is built and assigned to `content.image.references`
(line 5094):

- `content.creativeStructureUsed = structureRef ? { title: structureRef.title, postType: structureRef.postType, shape: structureRef.shape } : null`,
  where `structureRef = baseReferences.find(r => r.referenceKind === 'segment_structure')`.
- `content.usedSegmentProductReference = baseReferences.some(r => r.referenceKind === 'segment_product')`.
- Both fields persist on the content item exactly like
  `creativeGenerationManifest` already does today (no extra
  serialization step — content items are stored/returned as plain JSON).

### C. Frontend — show usage on the approval card

- `ContentItem` (`content-central-app/src/api/client.ts:337-358`) gains:
  ```ts
  creativeStructureUsed?: { title: string; postType?: string; shape?: string } | null;
  usedSegmentProductReference?: boolean;
  ```
- `PendingApproval.tsx`'s `renderGroupCard`/`renderSoloCard` add a small
  pill row near the existing pillar/format pills:
  `Estrutura: {title}` when `creativeStructureUsed` is set, and
  `Referencia de produto: usada` when `usedSegmentProductReference` is
  true. Neither pill renders when absent — no "not used" noise on cards
  from segments that don't have a product reference registered.

## Testing

- `buildSegmentLayoutReferences`: creative entries carry
  `referenceKind: 'segment_structure'`; the product entry carries
  `referenceKind: 'segment_product'`.
- `buildPrimaryAiImageReferences`:
  - A structure tagged with blank `shape` matches both `vertical` and
    `feed` generation calls for the same `postType`.
  - A structure tagged with a specific `shape` still only matches that
    shape (no regression).
  - A registered product-purpose entry never satisfies the mandatory-
    template check by itself (missing/blocking error still thrown when
    only a product reference exists, no structure).
  - When both a matching structure and a product reference exist, the
    returned reference list contains both (`referenceKind` values
    `'segment_structure'` and `'segment_product'`), and
    `selectOpenAiImageEditReferences` keeps both under the 2-slot
    `layout_model` reservation.
- `generateAiImageWithReviewLoop`: `content.creativeStructureUsed` and
  `content.usedSegmentProductReference` reflect what `baseReferences`
  actually contained for that generation call.
- Frontend: `AprendizadoSegmento` renders exactly one "Referencias de
  produto" section regardless of node count; saving a structure with no
  Formato selected succeeds; `PendingApproval` renders the usage pills
  when the fields are present and omits them when absent.

## Relationship to prior specs

This design amends two specific points from
`2026-08-16-mandatory-creative-templates-design.md`:

- Its shape-matching rule (`reference.shape === shape`, exact) becomes
  optional-blank-matches-both. `postType` exact-matching is untouched.
- Its "Known limitations" note that the segment product-reference hint is
  permanently inert is reversed — it's revived as a non-blocking,
  additive `layout_model` reference. The other two mechanisms named in
  that note (`visual_reference` and project-level `layout_model`
  references) are **not** touched by this design and remain inert, per
  that doc's explicit "leave this exactly as it is" decision for them.
