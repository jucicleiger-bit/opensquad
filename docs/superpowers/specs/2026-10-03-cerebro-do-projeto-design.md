# Cérebro do projeto — design

Date: 2026-10-03
Status: approved in conversation, awaiting spec review

## Goal

Each Content Central project gets its own planning agent (the "cérebro"),
the operator's single point of conversation for that client. The operator
says what the week should be ("foca no sorteio que acaba sexta, sobe venda
pra 70%"), the cérebro builds the week's plan (times, which offers, which
combos), the operator asks for adjustments, the cérebro sends the corrected
plan, and the operator approves. Approval runs the existing generation.

Only the operator uses it, only on this PC (it runs the local Claude Code).

## Findings that shape the design

- Offers already have `daysOfWeek`, `groupId`, `pillarId`, `active`;
  Raio-X already has `contentGoalWeights` (the % split); schedule formats
  already have posts/day, start time, interval. A preview step
  (`POST /api/projects/:id/plan`, `previewContentSchedulePlan`) and an
  approved-plan pass-through on `POST /api/projects/:id/generate` exist.
- Offers have no date validity.
- `pickComboPartner` pairs only within the same `groupId`, but groups mix
  sector and campaign (Mercado Carvalho: "Produtos geral", 30% combo), so a
  combo can join hygiene with food.
- `applyApprovedPlanOverrideToTopic` only rewrites label/reason text. The
  offer (price, photo) still comes from the rotation picker, so a plan that
  says "Thursday: offer X" is not honored.
- The server already shells out to AI CLIs (`execFileNoStdin`, codex);
  `claude` 2.1.288 is installed.

## 1. Data changes

**Offer validity.** Two new optional offer fields, `validFrom` and
`validUntil` (`YYYY-MM-DD`, inclusive). Empty means always valid (today's
behavior). An offer whose window does not contain the slot's date is not
eligible for that slot, in the rotation picker and as a combo partner. The
same check sits next to the existing weekday check (`fitsWeekday` /
`buildTopicPool`), so every caller goes through it. Offers page gets two
date inputs and shows "Vence dd/mm" / "Vencida".

**Offer sector.** New optional offer field `sector` (free text, e.g.
"Hortifruti", "Higiene", "Mercearia"), compared trimmed and
case-insensitively. `pickComboPartner` additionally requires both offers to
have the same sector; an offer with no sector counts as sector "" and only
pairs with other sector-less offers. Offers page gets a sector input with a
datalist of the project's existing sectors.

**Plan slots carry offers.** An approved-plan regular slot may carry
`offerIds`: one id (single offer) or two ids (combo). In
`generateContentSchedulePlan`, a slot with valid `offerIds` builds its topic
from those offers (`offerToContentTopic` / `buildComboOfferTopic`) instead
of the picker. Validation, server-side: ids must exist and be active, valid
on that date and weekday; a pair must share a sector and pass the existing
combo eligibility (not `uniqueProposal`, no flavors, not itself a combo).
An invalid slot fails the request with a message naming the slot — it never
silently falls back. Label/reason overrides keep working as today.

## 2. How the cérebro runs

- New endpoint `POST /api/projects/:id/brain/messages` `{ text }`. The
  server runs `claude -p <text> --output-format json` with
  `--resume <sessionId>` when the project has one, else a new session whose
  id is stored. Working dir: repo root. Timeout 5 minutes.
- System prompt (`--append-system-prompt`): role (administrator of this
  client's planning, Portuguese, plain language), the project id, the rules
  of what it may do directly vs propose (section 3), and how to call the
  `cerebro` command. The first message of a session also carries a context
  snapshot: notebook, offers (with sector, validity, usage line), groups,
  Raio-X goal weights, schedule formats, what is upcoming in the queue.
- Tool access is limited with `--allowedTools` to `Bash(node bin/cerebro.js:*)`
  plus read-only `Read` — no Edit/Write. `bin/cerebro.js` is a thin CLI that
  calls the local server's HTTP API (port from env, default 3333), so all
  existing validation and project locks apply. Subcommands:
  - `context <project>` — the snapshot above, as text.
  - `plan <project> <json>` — the json carries `startDate`, `days` and
    `formats` (channel, posts/day, start time, interval — the same shape
    GenerateContent.tsx sends; formats are not persisted anywhere today, so
    the cérebro decides them, and the client's usual schedule lives in the
    notebook). Builds the week via the existing `/plan` preview, then applies the cérebro's slot choices (`offerIds`, label,
    reason, time) and saves it as the project's current draft plan.
  - `propose <project> <json>` — records a pending proposal (section 3).
- One message at a time per project: a second message while one is running
  gets HTTP 409 "O cérebro ainda está respondendo".
- Conversation stored in the project dir as `brain/chat.json`
  (`sessionId`, messages with role, text, time, attached plan/proposal ids).

## 3. What it does alone vs proposes

- **Direct:** the week's draft plan (`brain/plan.json`): days, times,
  which offer or combo per slot. It can rebuild it as often as asked.
  Nothing is generated until the operator approves.
- **Proposes, waits for "Aplicar":** offer changes (validity, sector,
  active, group), Raio-X goal weights, notebook edits. A proposal
  (`brain/proposals.json`) holds a list of changes, each with `before` and
  `after`, and status `pending | applied | rejected`. Applying calls the
  same server functions the Offers/Company pages use. If the data changed
  since the proposal (current value ≠ `before`), applying that change is
  refused with a message, the rest still apply.
- **Notebook** (`brain/notebook.md`): permanent client notes the cérebro
  reads every session. When something said now contradicts an old note, it
  proposes the replacement ("substituir X por Y") as a notebook proposal —
  never edits silently. The operator can also edit it directly in the UI.

## 4. Screen

New workspace tab "Cérebro" (`content-central-app/src/pages/workspace/Brain.tsx`).
- Left: chat. Proposals render inline as cards ("antes → depois",
  Aplicar / Recusar). A spinner while the cérebro answers.
- Right: current draft plan grouped by day (time, channel, offer or combo,
  label), with "Aprovar e gerar", which sends it as `approvedPlan` to the
  existing `/generate` with the plan's formats. Below it, the notebook,
  editable.

## 5. Errors

- `claude` missing, not logged in, non-zero exit or timeout: the chat shows
  the error text as a system message; no project data changes; the session
  id is kept so the next message resumes.
- Malformed `plan`/`propose` input from the cérebro: the CLI prints the
  server's validation error so the cérebro can correct itself in the same
  turn.
- Approving a plan whose offers became invalid since (deleted, expired,
  paused) fails with the slot named; the operator asks the cérebro to redo it.

## 6. Tests

- Validity: offer outside window is skipped by picker and combo partner;
  empty window unchanged.
- Sector: combo never pairs different sectors; sector-less pairs only with
  sector-less.
- Plan `offerIds`: single and combo slots produce those offers in the
  generated items; invalid ids/sector mismatch/expired fail naming the slot.
- Proposals: apply, reject, stale `before` refused.
- Brain endpoint with the `claude` runner injected as a fake (no real CLI
  in tests): session id stored and reused, 409 on concurrent message,
  error path writes no project data.
- Brain.tsx: renders chat, proposal card actions, plan approve call.

## Out of scope

Cloud panel (`cloud-panel-app`), client-facing use, auto-generation
without approval, performance metrics as planning input (no insights are
collected yet).
