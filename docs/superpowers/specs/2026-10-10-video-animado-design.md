# Vídeo animado: Reels written per subject, produced inside Content Central

Builds on the hand-run prototype in `videos/` (2026-10-08 → 2026-10-10):
`videos/_motor/` (motor), `videos/_motor/REGRAS.md` (rules), and the approved
example videos `king-vitrine-apagada`, `king-do-balcao-pro-story`,
`king-apresentacao` and `teste-claude-{1-urgencia,2-diagnostico,3-bio}`.

## Problem

Animated Reels for King are produced today only by Claude in a Claude Code
conversation, on demand: subject → script for approval → voice → per-video
scene code → stills review → render. The result is approved ("ficou muito
bom"), but none of it is in the system. The operator cannot start a video,
review a script or download a result without a chat session, and the motor
lives outside git in `videos/`.

## Goal

A "Vídeo animado" tab, enabled per project (King only for now), that runs the
same flow the prototype proved, with the same quality bar:

1. New video: subject, objective, duration, voice tone, caption model.
2. Stage 1, script: Claude Code writes the script; the operator reviews it scene
   by scene, edits it, or asks for an adjustment.
3. Stage 2, production: voice, objects, per-video scene code, stills, and
   Claude's own check against the quality rules. The operator approves the
   preview or asks for an adjustment.
4. Stage 3, final video: background render, then play, download MP4, copy the
   post caption and the narration text.

Out of scope, recorded for later: sending to the Reels queue, recorded-video
mode, and "motion no apresentador".

## Decisions already made with the operator

- **Every video is new**: structure, scenes, metaphors, objects, transitions,
  background, type and closing come from that subject and narrative. Fixed per
  brand: logo, visual identity, WhatsApp, and Raio-X tone when useful
  (`REGRAS.md` § Princípio, § Fixo da marca).
- **Writer: Claude Code**, invoked locally (the `claude` CLI on this PC), not
  the Anthropic API. It uses the operator's Claude Code subscription.
  Codex/ChatGPT is kept for images, because its quota runs out fast.
- **Two objectives**: `alcance` closes with a comment poll (enquete) plus a
  follow invite, 20–45 s. `anuncio` follows pain → solution → proof → offer
  and closes on WhatsApp, 15–30 s.
- **Voice chain**: Gemini TTS (`gemini-3.8-flash-tts`, voice Puck, "criador"
  or "vendedor" direction) → Gemini Live
  (`gemini-2.5-flash-native-audio-latest`) → Edge Brian. Word times come
  from faster-whisper (`alinhar.py`) when the voice doesn't provide them. The
  narration is one continuous take with silences cut to 0.22 s.
- **Captions**: five models (`simples`, `karaoke`, `pop`, `destaque`,
  `caixa`), plus `do vídeo` (the scene code's own caption) and `sem
  legenda`. They are chosen per video, with no default model.
- **Real material first** (rule 10). For King the material comes from client
  projects, preferring Mercado Carvalho and Frios Modelo (`arthur-frios`).
  The operator approved showing their work.
- **Scripts are approved before production.**

## Design

### Enabling and project settings

A new optional block in `project.json`:

```json
"videoAnimado": { "ativo": true, "projetosDeMaterial": ["mercado-carvalho", "arthur-frios"] }
```

The tab shows only when `videoAnimado.ativo` is true. `projetosDeMaterial`
lists the projects whose approved Stories and raw photos may be offered to
Claude as material (King has no product content of its own). Brand data
(logo, WhatsApp, Instagram, colors, tone) is read from the project's
existing `brand`, `brandIdentity`, `companyProfile` and `brandXray`, not
duplicated.

### Motor moves into the repo

`videos/_motor/` → `src/video-motor/`, tracked and tested:

- `player.html`, `legendas.js`: as today. Asset paths take a base URL
  instead of assuming `/<pasta>/`, so the render server can serve the motor
  and the video folder from different roots.
- `render.mjs`: exported as `renderVideo({ pasta, stills?, trecho?, legenda? })`
  with the same behaviour. The CLI entry stays for manual use.
- `tts.py`, `alinhar.py`, `gen-images.mjs`, `cutout.py`: unchanged apart from
  paths. The brand logo is copied into the video folder (`fotos/logo.png`)
  instead of being read from `_motor/marcas/`.
- `REGRAS.md`: the rules file.
- `exemplos/`: the `cenas.js` and `roteiro.json` of the approved examples,
  code only and no photos, which Claude reads as format examples.
- `PEDIDO-roteiro.md`, `PEDIDO-producao.md`: the instructions for each stage
  (below). They derive from `videos/_motor/PEDIDO-CODEX.md`.

The old block-based types (`blocos.js`, the neon scene types in
`player.html`) are not carried over. New videos always bring their own
`cenas.js`.

### Storage

```
_opensquad/content-central/projects/<id>/videos/<videoId>/
  video.json        # briefing, status, history, timestamps, errors
  roteiro.json      # scenes: tipo, fala, descricao (what appears), segura?
  cenas.js          # stage 2 output
  fotos/ objetos/   # real material copied in, generated objects
  voz/              # narracao.mp3, tempos.json, narracao.txt
  stills/           # preview images
  legenda-post.txt  # post caption written in stage 2
  NOTAS.md          # Claude's notes (concept, checks done)
  <videoId>.mp4     # stage 3 output
```

`video.json` statuses: `roteiro_gerando` → `roteiro_pronto` →
`producao_gerando` → `previa_pronta` → `render_gerando` → `pronto`. Side
statuses: `erro` (with message), `aguardando_limite` (Claude Code usage limit)
and `interrompido` (server restarted mid-job).

### New module `src/content-central-video.js`

- **Briefing → stage 1.** It builds the prompt from `PEDIDO-roteiro.md`, the
  briefing, `REGRAS.md`, the brand/Raio-X summary, and a **material
  inventory**. The inventory lists the approved Stories and raw photos of
  `projetosDeMaterial` (paths, product name, channel), built like the
  2026-10-08 survey of `content/**/*.json` items with `image.references`.
  Claude Code runs in the video folder, writes `roteiro.json` with a
  `descricao` per scene, and copies the chosen material into `fotos/`. Stage
  1 does no voice and no render.
- **Script validation (code, not model).** Every scene has `tipo`, `fala` and
  `descricao`. Estimated duration is spoken words ÷ 2.6 words/s; the UI warns
  when it is more than 15% off target. The first scene and the closing match
  the objective (the closing must ask a question for `alcance`, or mention
  WhatsApp for `anuncio`); a mismatch is a warning, not a block.
- **Stage 2.** The prompt comes from `PEDIDO-producao.md` plus the approved
  `roteiro.json`. Claude Code runs `tts.py` exactly once, generates objects
  through `gen-images.mjs` only if needed, writes `cenas.js`, renders stills
  through `renderVideo({ stills })`, looks at them, and fixes the scene code
  until rules 1–10 hold. It then writes `legenda-post.txt` and `NOTAS.md`.
  After it finishes, the module checks mechanically that the stills render
  without page errors, that every `A('palavra')` anchor resolves (the player
  throws otherwise), and that the voice used is recorded.
- **Adjustments.** "Pedir ajuste" on either stage re-runs that stage with the
  current files plus the operator's text. Manual edits to the script are saved
  before an adjustment runs.
- **Stage 3.** `renderVideo()` produces the full MP4 in the module's own
  process. Claude is not involved.
- **Queue.** One job at a time across all projects; Claude Code, Whisper and
  the renderer all compete for the same CPU. The queue survives page reloads
  because its state lives in `video.json`. On server start, any `*_gerando`
  status becomes `interrompido` and can be resumed.

### Invoking Claude Code

The same shape as content-central's `codex-agent` path
(`execFileNoStdin('codex', ['exec', …])`, `content-central-server.js`):

```
claude -p "<prompt>" --model opus --permission-mode bypassPermissions --output-format json
```

It runs with `cwd` set to the video folder, `--add-dir src/video-motor`, and
a 45 min timeout. The runner is injected so tests can replace it. A usage-limit
reply sets `aguardando_limite`, with the reset time when the message gives
one. Any other non-zero exit sets `erro` with the last lines of output.

### Server endpoints (`content-central-server.js`)

| Method | Path | Does |
|---|---|---|
| GET | `/api/projects/:id/videos` | list (status, duration, dates) |
| POST | `/api/projects/:id/videos` | create from briefing, queue stage 1 |
| GET | `/api/projects/:id/videos/:vid` | full state: briefing, status, script, stills list, files |
| PUT | `/api/projects/:id/videos/:vid/roteiro` | save edited scenes (only in `roteiro_pronto`) |
| POST | `/api/projects/:id/videos/:vid/ajuste` | `{ etapa, pedido }`, re-run stage 1 or 2 |
| POST | `/api/projects/:id/videos/:vid/aprovar-roteiro` | queue stage 2 |
| POST | `/api/projects/:id/videos/:vid/aprovar-previa` | queue stage 3 |
| POST | `/api/projects/:id/videos/:vid/retomar` | resume `erro`/`interrompido`/`aguardando_limite` |
| GET | `/api/projects/:id/videos/:vid/arquivo/:nome` | MP4, stills, narration text, post caption |
| DELETE | `/api/projects/:id/videos/:vid` | delete the video folder |

All of them return 404 when `videoAnimado.ativo` is not true for the project.

### UI: `content-central-app/src/pages/workspace/VideoAnimado.tsx`

- A new `SECTIONS` entry in `ProjectWorkspaceLayout.tsx` (group "Conteúdo"),
  shown only when `project.videoAnimado?.ativo`, with a route in `App.tsx`.
- **List**: one card per video with status, objective, duration, date and the
  next action ("revisar roteiro", "ver prévia", "baixar").
- **New video form**: subject (free text, or a picker over "Ofertas e
  assuntos" and the Banco de assuntos, which are already in the project
  summary); objective (alcance/anúncio); duration (15/30/45/60); tone
  (criador/vendedor); caption (the five models, "do vídeo", "sem legenda");
  notes.
- **Script view**: one card per scene showing the line (editable), what
  appears, and its estimated seconds. Cards can be removed and reordered.
  There is a total-vs-target time bar, a "Pedir ajuste" text box, and
  "Aprovar roteiro".
- **Preview view**: a stills grid, the narration audio player, the voice used,
  `NOTAS.md`, "Pedir ajuste" and "Aprovar prévia".
- **Final view**: a video player, "Baixar MP4", the post caption with a copy
  button, and the narration text.
- **While a job runs**: status text with elapsed time, polled like the
  Cérebro "thinking" state. Leaving the tab doesn't stop the job.

### Error handling

| Case | Behaviour |
|---|---|
| Claude Code usage limit | `aguardando_limite`; message plus "Tentar de novo" |
| Claude Code fails or times out | `erro` with the output tail; "Tentar de novo" |
| Gemini TTS quota | automatic Live → Brian chain; voice used shown in preview |
| Codex quota (objects) | stage 2 continues without that object, and NOTAS says so |
| Stills page error / bad anchor | `erro` with the player message; "Pedir ajuste" passes it to Claude |
| Server restart mid-job | `interrompido`; "Retomar" |

## Testing

- `tests/content-central-video.test.js` (node --test, the existing pattern):
  storage and status transitions, queue serialisation, prompt contents
  (rules, briefing, brand, inventory), material inventory from fixture
  projects, script validation and duration estimate, and runner outcomes
  (success, usage limit, failure) through an injected fake runner.
- `tests/content-central-server.test.js`: the new endpoints, including the
  404 when the feature is off and status guards (e.g. PUT script outside
  `roteiro_pronto`).
- `VideoAnimado.test.tsx` (vitest, like `Carousels.test.tsx`): the
  conditional tab, form, script editing and timing bar, and the per-status
  views.
- Motor smoke test: `renderVideo({ stills })` on a tiny fixture video (two
  scenes, pre-made `tempos.json`, no network) produces stills with no page
  error.
- Run the whole suite with `npm test`, and type-check the app with `npm run
  build` (`tsc --noEmit` checks nothing here).

## Build notes

- Work in a git worktree: master carries uncommitted Calendar and carousel-v2
  changes. Git in a worktree session needs PowerShell; `docs/` needs
  `git add -f`.
- `videos/` stays where it is as the prototype and archive. The
  `.env` key `OPENSQUAD_GEMINI_API_KEY` is already present.
- Restarting production (port 3333) is the operator's call, in their cmd
  window; Claude does not restart it in the background.
