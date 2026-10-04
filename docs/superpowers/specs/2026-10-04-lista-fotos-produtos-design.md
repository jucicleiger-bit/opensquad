# Adiantar fotos a partir de uma lista — design

Date: 2026-10-04
Status: approved in conversation, awaiting written-spec review
Environment: isolated worktree `.claude/worktrees/fotos-lista` (branch
`worktree-fotos-lista`), served on port 3399. Nothing merges to master until
the operator has tried it on a real list and says so.

## Problem

In a catalog project (supermarket), every product needs a real photo, and the
operator registers products one at a time: type the name, go find a photo on
the internet, download it, attach it. Most products are common internet
products, so the photo hunt is the slow, repetitive part.

The operator's list has only **name and price** (no barcode).

The operator does NOT want products to go in finished. Each product still has
to be reviewed one by one in the normal form, where the operator sets the
group/category, corrects the price, adds notes, marks "produto único", etc.
The goal is only to get the photo work done ahead of time.

## What it does

1. On the Produtos page of a catalog project, a new toolbar button
   **"Adiantar fotos (lista)"** opens a textarea: one product per line, e.g.
   `Coca-Cola 2L - 9,99`. The price is optional.
2. **"Buscar fotos"** turns each line into a **draft** (rascunho) holding the
   name, the price (if any) and up to 4 photo candidates found by an image
   search on the name.
3. A section **"Para revisar (N)"** appears at the top of the page. Each draft
   card shows the name, price and the first candidate photo, with two buttons:
   **Revisar** and **Descartar**.
4. **Revisar** opens the existing "+ Novo produto" form, pre-filled with name
   and price, and shows the 4 candidates above the photo field with the first
   one selected. Clicking another candidate selects it instead. The operator
   can still attach a photo from disk as today.
5. On **Salvar**, the selected candidate is downloaded by the server and
   stored as a normal `product_photo` asset, the product is created exactly as
   a manual one, and the draft is removed from the queue.
6. **Descartar** removes the draft. Nothing is downloaded.

Drafts survive closing the browser (stored in the project). Content generation
never reads drafts.

If the search finds nothing for a line, the draft is created with no
candidates; the operator attaches a photo from disk during review.

## Out of scope

- Barcode/EAN lookup.
- More than 4 candidates or a "search again with other words" button.
- Approving several drafts at once without opening the form.
- The non-catalog projects' existing "Colar lista de produtos" importer is
  left untouched.

## Design

### Data

`project.contentStrategy.offerDrafts: OfferDraft[]`, separate from `offers`:

```
OfferDraft = {
  id: string,
  name: string,
  price: string,            // "" when the line had none
  candidates: [{ imageUrl, thumbUrl }],   // 0..4
  createdAt: string,
}
```

Because drafts live outside `offers`, every existing reader (generation,
rotation, flyer, manual, cerebro) ignores them with no change.

### Server (`src/content-central.js`, `src/content-central-server.js`)

- `parseOfferDraftLines(text)` — pure function. One draft per non-empty line.
  The price is a trailing number like `9,99`, `9.99` or `R$ 9,99`, optionally
  after ` - `; everything before it is the name. Lines with no price keep the
  whole line as the name. Capped at 40 lines per submission (error message if
  more).
- `searchProductImages(query)` — fetches Bing Images HTML
  (`https://www.bing.com/images/search?q=...`) with the existing
  `SITE_FETCH_HEADERS`, extracts up to 4 `{ imageUrl (murl), thumbUrl (turl) }`
  pairs from the result `m="{...}"` attributes. Lives next to
  `searchDuckDuckGo`. No API key. If Bing changes its markup it returns `[]`
  and drafts come in without photos; swapping in a keyed API (Brave Search) is
  the upgrade path, not built now.
- `POST /api/projects/:projectId/offer-drafts` `{ text }` — parses the lines,
  searches each product **sequentially** (avoid being blocked), saves all
  drafts under the project lock, returns the project. A search failure on one
  line does not fail the batch.
- `DELETE /api/projects/:projectId/offer-drafts/:draftId` — removes one draft.
- The existing asset upload (`saveAsset`) accepts `sourceUrl` as an
  alternative to `dataUrl`: the server downloads it (http/https only, 20s
  timeout, must answer `image/*`, max 10 MB), turns it into a data URL and
  continues through the existing path, so `normalizeUploadedImageAsset`
  still converts webp/avif to PNG. If the full-size image fails, the client
  retries with the candidate's `thumbUrl`.

### Client (`content-central-app/src/pages/workspace/Offers.tsx`, `api/client.ts`)

- Toolbar button + textarea card, shown only when `isCatalog`.
- "Para revisar (N)" section listing `project.contentStrategy.offerDrafts`.
- Opening a draft: `setForm({ ...EMPTY_FORM, groupId: defaultGroupId, name, price })`,
  remember `reviewingDraft` (id + candidates + selected index), open the form.
- Submit: when `reviewingDraft` has a selected candidate, upload it via
  `saveAsset({ sourceUrl, role: "product_photo", ... })` before the existing
  offer save and add its id to `photoReferenceIds`; this also satisfies the
  "Cadastre pelo menos uma foto real do produto" check. After the offer is
  saved, delete the draft. Cancel leaves the draft in the queue.

## Error handling

- Search blocked/changed markup: draft created with no candidates, message on
  the card "sem foto encontrada — anexe na revisão".
- Download of the chosen photo fails (both full and thumb): the form shows the
  error and does not save; the operator picks another candidate or attaches
  from disk. The draft stays.
- More than 40 lines: rejected with a clear message before any search.

## Testing

- Unit: `parseOfferDraftLines` (with/without price, `R$`, comma/dot, blank
  lines, the 40-line cap); Bing result extraction against a saved HTML
  fixture.
- Server: create drafts with the search stubbed, delete a draft, generation
  candidates ignore drafts; `saveAsset` with `sourceUrl` rejects non-http and
  non-image responses.
- Client: draft card renders, Revisar pre-fills the form, saving uploads the
  chosen candidate and removes the draft.
- Manual: on port 3399 with a copy of `mercado-carvalho` (no `secrets/`, as
  in the `sabores` bench), paste a real list of ~10 products and review them.
