# Vídeo animado: VT frames (molduras), music, pace and render checks

Status: approved in conversation with the operator, 2026-10-13. Builds on Vídeo animado v2 (branch `video-animado-v2`).

## Problem

The first real Oferta VT (Mercado Carvalho, 5 products) came out readable after the layout fix: a big product, a big price and no word caption. The operator's verdict was still "ficou muito simples".

We swept 40 supermarket VTs on YouTube and studied 11 frame by frame. The operator liked six of them:
- 1 Ofertas Imbatíveis
- 2 Mês da Economia
- 3 Esquadrão da Economia
- 5 Preço Baixo é Aqui
- 6 Super Serv
- 8 Pires

All the professional VTs share things ours lacks:

1. **A fixed frame that never moves.** The logo, a campaign seal ("Mês da Economia"), a validity strip and a legal footer ("enquanto durarem os estoques") stay put; only the product and the price change. This is what makes it read as a TV VT.
2. **The price set like a flyer.** A small "R$", huge reais, small raised centavos and the unit under them. It arrives stamped (with a shake and a burst behind it) or counting up.
3. **Staged products.** A shadow, a plinth or plate, sometimes two units.
4. **VT transitions.** Diagonal curtains, whip with blur, a blurred aisle, light sweeps, flying coins or %.
5. **A music bed** under the announcer. Ours has voice and effects only.
6. **Pace.** 2.5 to 3 s per product, 8 to 12 products in 30 s. Ours is 4 s per product, with at most 10.

## Goal (delivery 1)

1. **A shared motion kit** (`vt/kit.js`). It provides the flyer price, the stamp and count-up price entrances, and transitions. Its timing comes from the motionmaxxing skill's measured curves.
2. **Three frames** (molduras), each with its own fixed layer, product scene, transitions, opening, closing and music track:
   - **Encarte** (from ref 1)
   - **Diagonal** (from refs 2 and 7)
   - **Neon Premium** (from ref 3, closing "ANOTA AÍ")
3. **A music bed** from a royalty-free library. It ducks under the voice and fades out at the end.
4. **Form options for Oferta:**
   - Moldura: Encarte · Diagonal · Neon · ✨ A IA escolhe
   - Ritmo: Rápido (3 s, default) · Calmo (4 s)
   - Selo da campanha
5. **An automatic render check** at the end of stage 2. It measures every product scene and sends failures back to Claude (Criação nova) or to the operator.

Delivery 2, out of scope here: Escudo 3D (ref 5), Pedestal (ref 6) and Corredor (ref 8). Corredor needs uploading the store's own clips, with a free stock fallback.

## Decisions made with the operator

- **The frame is chosen in the form, per video.** There is also an option "✨ A IA escolhe", where Claude picks from the subject, the observação and the date.
  - The form preselects the frame of the project's most recent Oferta video, or Encarte if there is none.
- **Corridor footage (delivery 2)** comes from the store's own clips when uploaded, and from a free stock library otherwise.
- **Music** comes from a royalty-free library, one default track per frame, ducked under the announcer. Operators cannot upload their own tracks (not now).
- **Pace:** Rápido (3 s per product) is the default, and Calmo (4 s) is an option. The maximum goes up to 12 products.
- **Both creation modes use the frame.**
  - **VT padrão** is the frame assembled mechanically.
  - **Criação nova** animates freely, but the player draws the frame's fixed layer and the price comes from the kit, so neither can be dropped or retyped.

## How motionmaxxing is used

What we take from the skill:
- **The measured eases.** `softLand`, `snapSettle`, `whip`, `accelExit`, `popOver`, `crashIn` and `cruise`, as pure functions of progress.
- **The entry grammar.** Arrival decelerates from oversize (the price stamp lands from ~3.5×, 39% of the drop in the first frame and 86% by 6 frames). Exits accelerate. A counter steps per frame and lands exactly on the real value.
- **One focal point per frame.**
- **"No dead frame".**
- **The render-gate idea:** a script measures the render, and a failure is fixed, never argued. This includes its G2 "no empty frame" gate.

What we do not take:
- **GSAP.** The player is already seek-safe (every frame is a pure function of `t`), so the kit ports curves, not the runtime.
- **The "never ship" taste rules that contradict the VT genre.** These are corner logo, footer bars, a held end card and a big centred price. In a VT these are the point. The VT closing holds address and WhatsApp for about 2 to 3 s.

## Architecture

### Files

```
src/video-motor/vt/kit.js                    shared helpers, sets window.VT
src/video-motor/vt/molduras/encarte/moldura.js
src/video-motor/vt/molduras/diagonal/moldura.js
src/video-motor/vt/molduras/neon/moldura.js
src/video-motor/vt/molduras/index.json       [{ id, nome, trilha }] — the single list of frames
src/video-motor/trilhas/*.mp3 + LICENCAS.md  music beds
src/video-motor/checar.mjs                   the render check (CLI: node checar.mjs <dir>; also used by the jobs)
content-central-app/public/video-molduras/<id>.mp4   muted form samples
```

### Kit (`vt/kit.js`)

It runs in the player as a classic script that sets `window.VT`. It is also loadable in Node tests by evaluating the file in a `vm` context.

- **`VT.ease.*`**: the seven eases above, as `(x) => y` with `x` in 0..1.
- **`VT.precoPartes(precoTela)`** turns `"R$ 13,99"` into `{ moeda: 'R$', reais: '13', centavos: '99' }`. It also handles `"R$ 0,99"` and `"R$ 1.299,90"`.
  - The only input is `PRODUTOS[i].precoTela`, so no price is ever typed.
- **`VT.precoHtml(produto, { classe })`** returns the flyer price markup:
  - `data-papel="preco"` on the badge, `data-papel="reais"` on the big number;
  - centavos raised, and the unit under them, from `produto.unidade` with the same labels the VT padrão uses today;
  - the "de" price, when there is one, as a struck line marked `data-papel="de"`.
- **`VT.carimbo(t, t0)`** returns `{ scale, rotate, shake }`. The price falls from 3.5× with `snapSettle` over about 0.4 s, and the frame shakes 2 to 3 frames on landing. It is invisible before `t0`.
- **`VT.contagem(t, t0, alvo, dur = 0.5)`** returns the text to show. Values step per frame with decaying steps and land exactly on `alvo` (the `precoTela` string) at `t0 + dur`.
- **Transitions** with the `VIDEO.transicao(t, s, next, i)` signature that the player already supports:
  - **`VT.transicao.cortina(cor)`**: a diagonal panel wipes across, leaving with `accelExit` and entering with `softLand`.
  - **`VT.transicao.passada`**: a whip with blur and the light streak, using `whip` and `accelExit`.

### Frames (`vt/molduras/<id>/moldura.js`)

Each sets `window.MOLDURA`:

```js
{
  id, nome, trilha,                  // trilha = file name in src/video-motor/trilhas/
  fontes, css,                       // like VIDEO.fontes / VIDEO.css
  fixo: { html(loja, campanha, marca), frame(t, q) },   // the layer that never leaves
  tipos: { abertura, produto, fechamento },             // same contract as VIDEO.tipos
  transicao,                          // VIDEO.transicao-compatible
}
```

- **The fixed layer** has the logo, the campaign seal (`campanha`), the validity strip and the legal footer "Ofertas válidas até <validade> ou enquanto durarem os estoques." It can animate in once and then breathe, but it never leaves.
- **The product scene:**
  - the photo carries `data-papel="produto"` and keeps the size rules in REGRAS.md § Oferta;
  - the price comes from `VT.precoHtml` and enters with `VT.carimbo` or `VT.contagem` on the first word of `precoFalado`;
  - the name sits in a strip;
  - a `moldura` photo type is shown in a card, never cut out.
- **The closing** shows the validity, the address, the hours and the WhatsApp. Neon uses an "ANOTA AÍ!" layout.
- **The look of each frame:**
  - **Encarte:** yellow and red, a burst behind the price, "OFERTA" oval, a radial ground.
  - **Diagonal:** a split ground (deep brand colour and yellow) on a diagonal, a price balloon, and a curtain transition in the split colours.
  - **Neon Premium:** a black textured ground, neon red and gold glow, sparks, a price in white with neon edges, and a passada transition.
  - Frame colours come from the frame. The brand colour (`R.marca.cor`) tints the accent where the frame allows it.

### Player changes (`player.html`)

When `roteiro.moldura` is set:
1. Load `/_motor/vt/kit.js` and then `/_motor/vt/molduras/<moldura>/moldura.js`, before `cenas.js`.
2. Add `<div id="fixo">` above `#cam` and below `#cap`, and fill it with `MOLDURA.fixo.html(LOJA, R.campanha, R.marca)`.
3. Call `MOLDURA.fixo.frame(t, q)` on every `seek(t)`.

`cenas.js` still defines `window.VIDEO`. The VT padrão template becomes a thin mapping: `window.VIDEO = { fontes, css, tipos, transicao }` from `MOLDURA`, plus `estrelas: false`. Criação nova may reuse `MOLDURA.tipos`, wrap them, or write its own types.

### Music (`render.mjs`)

- `roteiro.trilha` is forced from the frame, like the voice is.
- The final render adds the track as one more input, looped (`-stream_loop -1`), at a bed level of about −20 dB under the voice.
- It is ducked by the voice with `sidechaincompress` keyed on the narration.
- It fades out over the last 1.2 s, before the existing `loudnorm`.
- Stills and prévia are unaffected.
- A missing track file renders without music and logs a warning. It never fails the render.

**Tracks:** 8 to 10 upbeat retail beds from **Mixkit** under the Mixkit Stock Music Free License (Pixabay blocks scripted downloads).
- The controller downloads them, checks the license text, and records each track's source URL and license in `trilhas/LICENCAS.md` before the task that uses them.
- Each track is trimmed to at most 75 s and encoded at 96 kbps to keep the repo small (about 1 MB each).

### Briefing, pace and the "IA escolhe" choice

- **`oferta` gains three fields:**
  - `moldura`: `encarte | diagonal | neon | auto`. The default is the last one used in the project, then `encarte`.
  - `ritmo`: `rapido | calmo`, default `rapido`.
  - `campanha`: a trimmed string of at most 30 characters, default `"Ofertas da Semana"`.
- **Pace constants:**
  - `SEGUNDOS_POR_PRODUTO` becomes `{ rapido: 3, calmo: 4 }`, and `MAX_PRODUTOS` becomes 12.
  - The products that fit a fixed duration are `min(12, floor((duracao − 6) / segundos))`:
    - rápido: 15 s → 3, 30 s → 8, 45 s → 12, 60 s → 12;
    - calmo: 15 s → 2, 30 s → 6, 45 s → 9, 60 s → 12.
  - The app mirrors this, as it does today.
- **The roteiro gets `moldura`, `campanha`, `ritmo` and `trilha`.** They are forced from the briefing in `forcarRoteiro`, like `voz`.
  - The exception is `moldura` with `auto`. Then stage 1 asks Claude to write `"moldura": "<id>"` (one of `index.json`) in `roteiro.json`.
  - `validateRoteiroOferta` rejects a missing or unknown id. The existing single retry carries the error.
  - The chosen id is kept in `roteiro.json`, and the review screen shows it.
- **Rápido falas are short.** With `ritmo: rapido`, each product scene's fala has at most 6 words besides its placeholders (`{preco}`, `{precoDe}`, `{unidade}`), for example "Omo de setecentos gramas, {preco}!" or "Fralda IsaBaby, de {precoDe} por {preco}!". The spoken prices themselves are as long as they are.
  - `validateRoteiroOferta` checks this before expansion. The check goes through the same retry.

### Render check (`checar.mjs`)

`checarVideo({ videoDir })` opens the player like `renderVideo` does. For each scene with `produto`, it seeks to **0.6 s after `VT.momentoPreco`**: the last mention of the first word of `precoFalado`, since a "de" price is usually said first (or 75% into the scene when that word is not found) and measures in the page. It returns `{ ok, falhas: ['Cena 3 (fralda): preço sai da área segura (x 18–480).', …] }`.

| Check | Pass |
|---|---|
| Product size | `[data-papel="produto"]` (the image itself, so its own aspect counts) box height ≥ 432 px (45% of 960) or width ≥ 432 px (80% of 540), and effective opacity ≥ 0.9. REGRAS.md's "55% da altura" becomes "45% da altura ou 80% da largura": a tall bottle and a wide biscuit pack can both fill their own direction |
| Price visible | `[data-papel="preco"]` effective opacity ≥ 0.9 |
| Price in the safe area | the price box lies within x 24–460 and y 110–800 |
| Price size | the computed font-size of `[data-papel="reais"]` ≥ 72 px, scaled by the element's transform |
| Readable text | every `[data-papel]` element is rotated by at most 25° (from its transform matrix) |
| No empty frame | stills every 0.25 s at a quarter size; none of them has a luminance standard deviation below 6 for more than 0.5 s in a row (motionmaxxing G2) |

Effective opacity and transforms are computed by walking up from the element to `#stage`.

**Where it runs:**
- **The CLI** is `node <MOTOR>/checar.mjs <dir>`. It prints `ok` or the failures, and exits 1 on failure. (It lives in its own file, not as a `render.mjs` flag, so the music change to `render.mjs` and the check can be built in parallel.)
- **Criação nova:**
  - Step 4 of `PEDIDO-producao.md` tells Claude to run it and fix `cenas.js` until it prints `ok`. Claude quotes the output in `NOTAS.md`.
  - The job then runs `checarVideo` itself after the runner. On failure it reruns stage 2 once, passing the failures as `erroAnterior`.
  - If it still fails, the video goes to `erro` with the list, and the operator sees it with "Tentar de novo".
- **VT padrão:** the job runs it too. A failure is a bug, so the video goes to `erro` with the list, and tests keep all three frames passing.

### Form (`VideoAnimado.tsx`)

Inside the Oferta section, after the product picker:
- **Moldura:** tiles with the muted looping sample (`/video-molduras/<id>.mp4`), the same pattern as the caption tiles, plus a "✨ A IA escolhe" tile.
- **Ritmo:** a segmented control, Rápido (3 s) · Calmo (4 s).
- **Selo da campanha:** a text input with the placeholder and default "Ofertas da Semana", at most 30 characters.
- **The summary line** includes the frame name and the pace.
- **The products-per-duration limit** follows the pace.

The form samples are about 6 s each, rendered once from a fixture with the VT padrão at 360×640, muted, and committed.

### Rules and prompts

- **REGRAS.md § Oferta** gains a "Moldura" subsection:
  - the fixed layer is drawn by the player and cannot be removed;
  - the price is always `VT.precoHtml` with `VT.carimbo` or `VT.contagem`;
  - transitions come from the frame or the kit;
  - mark the product photo `data-papel="produto"`;
  - run `node <MOTOR>/checar.mjs .`.
- **PEDIDO-roteiro.md** covers `moldura: auto` and the short rápido falas.
- **PEDIDO-producao.md** step 4 adds the `checar.mjs` loop.

## Error handling

- An unknown `moldura` in the briefing returns 400 "Moldura desconhecida." A bad `ritmo` falls back to `rapido`, and a long `campanha` is cut to 30 characters.
- A frame file that is missing or throws shows up as a page error in render or check, and that becomes the stage error, as today.
- Music problems never fail a render.

## Testing

- **Kit (Node, `vm`):**
  - `precoPartes` handles `R$ 13,99`, `R$ 0,99` and `R$ 1.299,90`;
  - `contagem` lands exactly on the target at `t0 + dur` and is monotonic;
  - `carimbo` is 3.5× at `t0`, 1 at `t0 + 0.4`, and hidden before `t0`.
- **The three frames:** the VT padrão fixture renders stills and passes `checarVideo` for each frame.
- **The check catches failures:** a fixture `cenas.js` with a small product and a price at x 480 fails with both messages.
- **Music:** a fixture render with `trilha` has an audio stream and runs the same length. A missing track still renders.
- **Briefing:**
  - moldura, ritmo and campanha are normalized;
  - the pace limits table above holds;
  - with `auto`, the roteiro is validated for an id, and an unknown id is rejected;
  - a rápido fala with more than 6 words besides its placeholders is rejected.
- **Jobs:**
  - a failing check reruns stage 2 once with the failures, then sets `erro`;
  - VT padrão runs the check.
- **Form (vitest):**
  - the frame tiles show, and "A IA escolhe" posts `auto`;
  - the default is the last Oferta video's frame;
  - the pace changes the limit text;
  - campanha is posted.
