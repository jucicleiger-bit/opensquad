# Cérebro: plano contratado, feriado em dia fechado, avisos do plano

Follow-up to `2026-10-04-cerebro-raio-x-horarios-design.md`, after the live
bench run on 2026-10-04 (the cérebro obeyed opening hours and the Raio-X
split but ignored the "test new hours", "sem preço" and "no repeat on
consecutive days" prompt rules, and a turn took 74 s).

## Decisions the operator made

- **Plano contratado, filled in by hand per client** (not linked to the
  Comercial catalog): stories per day, feeds per week, which channels the
  story and the feed go to, encartes per month. "Trabalhamos por dia": the
  cérebro always plans to it.
- A story is one art on Instagram, Facebook and WhatsApp Status (already
  how same-shape channels share one creative); the contract says which of
  them this client uses.
- Encartes are made by hand for now: the cérebro never generates them, it
  only reminds.
- **Closed day: no posts, except a holiday / commemorative-date post.**
- Reinforcement (option 1), shaped for clients with **few products**:
  repeating is normal; follow the rotation sequence, repeat on consecutive
  days only when no other offer is free, and propose sectors so combos can
  vary the week.

## 1. Plano contratado

`project.contractedPlan` = `{ storiesPerDay, feedsPerWeek, storyChannels,
feedChannels, flyersPerMonth }`; absent = not configured. Story channels ⊂
`instagram_story, facebook_story, whatsapp_status`; feed channels ⊂
`instagram_feed, facebook_feed`. Integers: stories 0–10, feeds 0–14,
encartes 0–31. A count above 0 needs at least one channel. All zero reads
as not configured. Own module `src/content-central-contract.js`, own route
`POST /api/projects/:id/contracted-plan`, card "Plano contratado" in
Empresa / Raio-X next to the opening hours.

`saveBrainPlan` refuses a plan that does not match it, listing every
mismatch:
- the plan's channels must be exactly the contracted ones;
- every open day has exactly `storiesPerDay` posts on each story channel;
- each Monday–Sunday week has at most `feedsPerWeek` posts on each feed
  channel, and exactly that many when the plan covers every open day of
  that week.

## 2. Skipping a slot

A plan's formats repeat every day, so "1 feed a week on the best day" needs
a way to leave days out. A slot choice gains `skip: true`; like a pin, it
spreads to the channels sharing the art. Skipped slots go to
`plan.skippedSlotIds` (generation already skips those after their rotation
turn). Works with or without opening hours.

## 3. Holiday on a closed day

Closed days still lose their regular slots, but their commemorative extras
stay, at the format's time.

## 4. Plan warnings

After building the plan, `saveBrainPlan` stores `plan.warnings`; the
`cerebro plan` command and the context print them, and the prompt tells the
cérebro to fix each one or explain it to the operator:
- an offer without a price in a sales post;
- the same offer on two consecutive days while some active offer valid on
  both days was used on neither (with few products this stays quiet);
- with opening hours set, no story (or feed) at an open hour never measured,
  while such hours exist.

## 5. Faster cérebro commands

`bin/cerebro.js` imported `content-central-brain.js` for `slotTag`, pulling
in `content-central.js` and jimp (~1.4 s per call). `CONTENT_GOAL_LABELS`,
`goalName` and `slotTag` move to a dependency-free
`src/content-central-goals.js`; the CLI imports only that.

## Prompt

Plano contratado is the fixed rule; feed per week via a daily feed format
plus `skip`; encartes only reminded; read and act on the warnings; with few
offers follow the rotation sequence and repeat only when nothing else is
free; offers without a sector can't combo, so propose sectors.

## Out of scope

Linking to the Comercial catalog, generating encartes, holidays on which
the shop closes on a normal weekday, showing the warnings in the panel.
