# Unique-proposal offer flag (opt out of combo pairing)

## Problem

`docs/superpowers/specs/2026-08-25-combo-offer-pairing-design.md` (shipped) added `comboChance` per offer group: a
scheduled draw can randomly pair the primary offer with a same-group
sibling into one combo arte (`pickComboPartner` /
`src/content-central.js:5793`). The candidate filter there only checks
`groupId`/`id`/`type !== 'combo'`/weekday — there is no way to mark an
individual product as "never combine this one," so a flagship/one-of-a-kind
offer in a group with `comboChance > 0` can be pulled into a combo (as
either the primary or the partner) just like any other product in that
group.

## Goal

Let the operator flag an individual offer as a unique proposal. Such an
offer never takes part in combo pairing, in either role: it never gets a
random partner pulled in when it's drawn as the primary offer (always
posts alone), and it's never picked as the partner for another offer's
combo.

## Data model

New field on `normalizeProjectOffer` (`src/content-central.js:7863`):

```
uniqueProposal: boolean  // default false
```

Default `false` — every existing offer stays exactly as eligible for combo
pairing as it is today; the operator opts specific products out one at a
time. No change to `saveProjectOffer`/the `offers` HTTP route: both already
pass the raw input straight through to `normalizeProjectOffer`
(`src/content-central-server.js:936-938`).

## Selection logic — `pickComboPartner` (`src/content-central.js:5793`)

Two changes, both blocking on the flag in whichever role it appears:

1. Early-return guard, alongside the existing `primary.type === 'combo'`
   check: `if (primary.type === 'combo' || primary.uniqueProposal || !primary.groupId) return null;`
   — a unique-proposal offer drawn as the primary never pulls in a partner.
2. Candidate filter gains `&& !offer.uniqueProposal` alongside the existing
   `groupId`/`id`/`type !== 'combo'`/`fitsWeekday` checks — a unique-proposal
   offer is never picked as anyone else's partner.

No other function changes: `buildComboOfferTopic`, the mandatory-combo-template
rule, and the photo-cap logic are all unaffected — this only shrinks the
candidate/eligibility surface `pickComboPartner` already filters.

## Frontend

**Types (`content-central-app/src/api/client.ts`):** `uniqueProposal?: boolean`
added to `ProjectOffer` (`:86-102`) and `SaveOfferInput` (`:963-979`).

**Form (`content-central-app/src/pages/workspace/Offers.tsx`):**
- `EMPTY_FORM` (`:42-57`) gains `uniqueProposal: false`.
- A checkbox "Proposta única (nunca combinar)" right after the existing
  "Ativo"/"Em estoque" checkbox (`:737-745`), same styling/pattern, bound
  to `form.uniqueProposal`.
- `handleEdit` (`:364-384`) populates it from `offer.uniqueProposal || false`.
- The submit payload already spreads the whole `form` object
  (`:351`, `const payload = { ...form, ... }`) — no extra wiring needed for
  the value to reach `saveOffer`.

**List display:** a pill "proposta única" next to the existing
active/pillar/weekday pills (`:900-917`) when `offer.uniqueProposal` is
true, same `<span className="pill">` pattern.

## Testing

- Backend: a group with `comboChance: 100` and two offers, one flagged
  `uniqueProposal: true` — (a) when the flagged offer is drawn as primary,
  the topic stays `type: 'offer'` (no partner pulled in) even though a
  same-group sibling exists; (b) when the *other* (non-flagged) offer is
  drawn as primary, the flagged offer is never selected as its partner
  (assert over enough draws, or with a 2-offer group where the only
  possible partner is the flagged one, that no combo topic is ever
  produced).
- Frontend: the checkbox renders, defaults unchecked, round-trips through
  `handleEdit` when editing an offer that has it set, and is included in
  the save payload.

## Out of scope

- No group-level "block all combos" toggle — that's just `comboChance: 0`,
  already shipped.
- No bulk-flagging UI — one checkbox per offer, same granularity as
  `active`/`daysOfWeek`.
