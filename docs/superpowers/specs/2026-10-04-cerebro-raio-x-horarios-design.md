# Cérebro: follows the Raio-X, knows the topic bank, works in opening hours, learns posting times

Follow-up to `2026-10-03-cerebro-do-projeto-design.md`, after the operator
tested the cérebro on the Mercado Carvalho bench on 2026-10-04.

## What the test showed

- Asked for a two-day plan (6 posts) with the Raio-X at Venda 85%, the
  preview gave 5 sales slots and 1 brand-awareness slot; the cérebro pinned
  an offer on every slot, including the brand one. Nothing stops it: the
  prompt has no rule, the server accepts an offer pin on any slot, and the
  percentages reach the cérebro as raw JSON
  (`{"sales":85,"brand_awareness":5,...}`).
- The cérebro never sees the topic bank (`contentStrategy.topicIdeas`), the
  approved brand analysis (`brandXray`), the audience or the approved
  learnings. It only sees the topic the preview already picked per slot.
- There is no opening-hours data anywhere. "No posts on Sunday" lived as a
  free-text notebook line (one written by a test, not by the client).
- The collector (`src/content-central-metrics.js`) already stores reach and
  views per Instagram media id every hour, but throws away the post's
  `timestamp`, so nothing can be said about which posting hour works.
- Smaller: an offer with no price (Treto chocolate) went into two sales
  posts without a warning; the same offer repeated on consecutive days; goal
  slot labels repeat themselves ("Reconhecimento de marca — X — Reconhecimento
  de marca — X").

## Decisions the operator made

- Posting times: **test and learn**. While an hour has fewer than 3 measured
  posts, the cérebro deliberately varies times to learn and says which posts
  are tests; once hours have 3+ measured posts it concentrates on the best
  ones and cites the numbers.
- Opening hours become a field of the Raio-X, set per weekday. The cérebro
  always plans inside them. They apply **only to the cérebro**: "Agenda e
  geração" keeps free times and only shows a warning for a time outside them.

## 1. Opening hours in the Raio-X

`project.businessHours`, one entry per weekday (`mon` … `sun`), each a list of
0–2 `{ "from": "HH:MM", "to": "HH:MM" }` periods; an empty list means closed.
Absent field means "not configured".

Example (Mercado Carvalho):

```json
{ "mon": [{"from":"07:00","to":"11:00"},{"from":"13:00","to":"20:00"}],
  "tue": [...same...], "wed": [...], "thu": [...], "fri": [...],
  "sat": [{"from":"07:00","to":"12:00"}],
  "sun": [] }
```

- Edited in the Raio-X page (`Company.tsx`), next to the goal weights: one
  row per weekday with a "Fechado" toggle and up to two periods.
- Saved through the existing project update route; validated on the server
  (HH:MM, `from < to`, periods not overlapping, at most 2 per day).
- `saveBrainPlan` drops the slots of closed days (a plan's formats repeat
  every day, so a closed Wednesday can't be avoided by the formats alone) and
  records their ids in `plan.skippedSlotIds`; generation runs the rotation for
  them and then skips them, so the remaining slots keep what the preview
  showed. A slot at a closed hour of an open day is refused, naming the slot,
  so the cérebro moves it. Commemorative extras at a closed hour move to the
  day's first opening time; extras of closed days are dropped. When
  `businessHours` is absent the check is skipped and the cérebro is told to
  ask the operator to configure it.
- Not the social-selling `businessHours` (one window for the agency's own
  outreach, `src/social-selling-safety.js`); separate shape, separate module
  `src/content-central-business-hours.js`.
- "Agenda e geração": when hours are configured, slots outside them get a
  warning line in the preview; nothing is blocked.

## 2. The Raio-X mix is binding

- `applyPlanSlotChoices` refuses `offerIds` on a slot whose `source` is not
  `offer`: "O horário X é de <objetivo> pelo Raio-X; oferta só entra em
  horário de venda." The preview stays the only place that decides the
  sales/goal split.
- In the context, the percentages are written out in Portuguese ("Venda 85%,
  Reconhecimento de marca 5%, Autoridade 4%, Relacionamento 6%"), and every
  plan line says which goal the slot belongs to.

## 3. The cérebro knows the whole Raio-X

New context sections built in `buildBrainContext`:

- **Raio-X da marca**: the approved `brandXray` blocks (summary text only),
  trimmed to a fixed size so the prompt stays bounded.
- **O que evitar**: `learnings.avoid` and `segmentLearnings.avoid`, capped
  at 10. (`learnings.approved` is left out: today it only holds automatic
  "X (canal, data): aprovado." lines, which say nothing to plan with.)
- **Banco de assuntos**: every item of `topicIdeas.goals.*.items` with its
  id, title and complement, marked "já saiu em DD/MM" when content used it.
- **Horário de funcionamento**: the configured periods per weekday, or "não
  configurado".

A slot choice gains `topicId`: on a goal slot the cérebro may pick any topic
of **that slot's goal** from the bank; the server rejects a topic of another
goal or an unknown id. The chosen topic replaces the slot's topic the same
way the preview's own pick would, so generation is unchanged.

## 4. Posting time per slot

A slot choice gains `time` ("HH:MM"). The new time is applied to every slot
sharing that slot's art (same date, shape and slot index — the groups
`resolveGroupPins` already builds), so Story/Reels/Status siblings move
together. The time must fall inside opening hours (section 1).

Generation today recomputes each slot's time from the format and re-runs the
rotation for unpinned slots, so it must change too: when the approved plan
carries a slot's `scheduledTime` or `topicId`, generation uses them (the
rotation still runs for that slot first, so the other slots don't shift), and
it skips `skippedSlotIds`. A `topicId` that no longer exists fails before
anything is written, like a bad offer pin.

## 5. Performance by posting hour

- Collector: each media entry also stores `postedAt` (the Graph `timestamp`
  already requested). Entries without it (stories that are no longer live)
  get it from the content item whose `publish.metaMediaId` matches, at read
  time; no migration.
- `buildPostingTimeStats(projectId)` (in `content-central-metrics.js`):
  posts at least 24 h old, grouped by kind (story, feed, reels) and local
  hour (the same timezone the scheduler uses for `scheduledTime`), each group
  with count, average reach, best and worst. Reach is the measure.
- Context section **Desempenho por horário (Instagram)** lists the groups,
  marks those with fewer than 3 posts as "em teste", and lists the open hours
  never tried.
- Prompt rules: while untested open hours remain, put about 1 in 3 posts at a
  new hour and say which posts are tests; with 3+ measured posts per hour,
  prefer the best hours and cite the numbers; never treat a single post as a
  conclusion. No weekday split yet.

## 6. Smaller fixes

- Prompt: an offer "sem preço" in a sales slot must be pointed out to the
  operator.
- Prompt: don't put the same offer on consecutive days or in the same hour
  twice; when offers run short, say so instead of repeating.
- Goal slot labels stop repeating the goal name and topic twice.

## Out of scope

- Showing the hour table on screen (it lives in the cérebro's chat).
- Instagram `online_followers` (Meta requires 100+ followers; Carvalho has 87).
- WhatsApp Status numbers.
- Weekday-by-hour analysis.

## Testing

- `businessHours` validation; `saveBrainPlan` drops closed-day slots into
  `skippedSlotIds`, refuses out-of-hours slots, moves extras, skips the check
  when absent; generation skips `skippedSlotIds`.
- Offer pin on a goal slot rejected; topic of the wrong goal rejected;
  right topic applied.
- `time` moves every sibling sharing the art; generation uses it.
- `buildPostingTimeStats` from fixture metrics: 24 h cut-off, grouping,
  `postedAt` fallback from `publish.metaMediaId`, "em teste" under 3.
- Context contains the new sections and the percentages in Portuguese.
- Raio-X page: edit and save the hours, "Fechado" toggle.
