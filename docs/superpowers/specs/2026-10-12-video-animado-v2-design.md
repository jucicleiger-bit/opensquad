# Vídeo animado v2: Oferta (supermarket VT), formats, styles, auto duration

Status: approved in conversation with the operator, 2026-10-12.

## Problem

The "Vídeo animado" tab is now on for every project, not just King, and most clients are local stores (Mercado Carvalho, Frios Modelo, Empório). Today the tab offers only two objectives, Alcance and Anúncio, and both were written for an agency promoting itself.

What a store needs most is the classic **supermarket VT**: an announcer voice, several products one after another, each with its price ("de R$16,99 por apenas R$13,99!"), and a close with validity, address and WhatsApp.

The other gaps:
- There is no Story/WhatsApp Status format.
- There is no way to steer the visual style.
- There is no automatic duration.
- There is no institutional objective and no notice objective.

## Goal

1. **Five objectives.** Each one decides how the video closes.
2. **The Oferta objective** builds a VT from several registered offers (products), with **prices that can never be wrong**, in two creation modes:
   - **✨ Criação nova:** Claude creates a unique VT, which takes about 15 min.
   - **⚡ VT padrão:** a fixed template in the client's colours and logo. Claude writes only the narration, and production is mechanical, which takes about 5 min of machine time.
3. **A format choice:** Reels or Story/Status.
4. **An optional style.**
5. **Automatic duration.**
6. **A "Locutor de VT" voice tone.**

## Decisions made with the operator

- The objectives are Alcance, Anúncio, Oferta, Institucional and Aviso. Engajamento, Informativo, Lançamento and the rest fold into these, or go in the observação.
- **Alcance** no longer always closes with an enquete. Claude picks the closing that fits the subject: an enquete, or "salva/compartilha", plus the follow invite.
- **Story/Status** is a format, not an objective. It is shorter, always closes on WhatsApp, and never uses an enquete.
- **The products in an Oferta video:**
  - They are the registered offers (`contentStrategy.offers`), and each offer is one product.
  - The operator ticks several, up to 10.
  - A photo with a transparent background is used as is.
  - A photo on a white background has the white removed automatically, with a per-product toggle "Recortar / Moldura".
  - A photo with a real background is shown in a frame (moldura), not faked as a cutout.
- **The voice tone:** "Locutor de VT" is a new tone, preselected for Oferta. The existing tones stay selectable.
- **Both creation modes** exist, chosen per video when the objective is Oferta.
- **Time per product** starts at about 4 s and is a single tunable constant. The operator will judge it on real videos and shorten it if it drags.
- **Out of scope:** the "Usar ideia da IA" subject button (subject suggestions and the Cérebro already cover it), and the "Cinematográfico" style (the motor animates; it doesn't film).

## Design

### Briefing (`normalizeBriefing` in `src/content-central-video.js`)

| Field | Values | Notes |
|---|---|---|
| `objetivo` | `alcance`, `anuncio`, `oferta`, `institucional`, `aviso` | |
| `formato` | `reels` (default), `status` | |
| `estilo` | `livre` (default), `dinamico`, `mercado`, `premium`, `informativo` | Ignored when `oferta.criacao` is `padrao` |
| `duracao` | `15`, `30`, `45`, `60`, `'auto'` | |
| `tom` | `criador`, `vendedor`, `locutor` | |
| `legenda`, `observacao`, `assunto` | unchanged | For Oferta, the UI pre-fills `assunto` with "Ofertas da semana", and the operator can edit it |
| `oferta` | `{ produtos: [{ id, foto: 'recorte' \| 'moldura' }], validoAte: 'YYYY-MM-DD' \| '', criacao: 'nova' \| 'padrao' }` | Required when `objetivo` is `oferta`; rejected otherwise. Holds 1 to 10 products |

**Validation for `oferta`:**
- Every id must be an existing offer in the project with a parseable price and a photo.
- A fixed duration must fit the product count:
  - `PRODUTOS_POR_DURACAO = { 15: 2, 30: 5, 45: 8, 60: 10 }`;
  - `auto` always fits up to 10.
- Any violation is a 400 with a Portuguese message.

**The snapshot.** `createVideo` stores a snapshot of each product in `video.json` → `briefing.oferta.produtos[i]`: `{ id, nome, preco, precoDe, unidade, fotoOrigem, foto, fotoTipo }`, plus `precosEm`, the creation date. Prices never change under a video after it is created, and the UI shows "preços de DD/MM".

### Prices (new, pure, in `src/content-central-video.js`)

- **`parsePreco(text)`**
  - Accepts "R$ 13,99", "13,99", "R$ 1.234,50", "4,49" and similar.
  - Returns cents as an integer, or `null`.
  - "R297", "" and null give `null`, and that product is shown as unusable: "preço inválido, corrija no cadastro".
- **`precoPorExtenso(centavos)`** returns pt-BR spoken text:
  - 1399 → "treze e noventa e nove"
  - 99 → "noventa e nove centavos"
  - 29700 → "duzentos e noventa e sete reais"
  - 123450 → "mil duzentos e trinta e quatro e cinquenta"
  
  The convention: "reais" is spoken only when there are no cents; a value under one real says "centavos".
- **`precoNaTela(centavos)`** returns "R$ 13,99".

### Plan-time adjustments (2026-10-12, after reading the code)

These override the sections below where they differ.

- **Products module.** Prices, photo classification, the white-background cutout, placeholders and validation live in one new module, `src/content-central-video-produtos.js`. The cutout uses Jimp (already a dependency) in Node; `cutout.py` is untouched.
- **Picker data.** A new route, `GET /api/projects/:id/videos/produtos`, returns every offer with its usable state for the picker: price shown on screen, photo type, and the reason it is disabled.
- **Placeholders.**
  - `{nome}` is dropped. Claude writes product names the way they are spoken.
  - A fala in an Oferta video must contain **no digits at all**, because numbers break the Whisper alignment.
- **Expansion runs once, at the end of stage 1.**
  - `roteiro-modelo.json` keeps the placeholder version, and `roteiro.json` holds the expanded text.
  - The review screen shows and edits the expanded text. On save, the server checks that each product scene still contains its spoken price.
  - An ajuste of the roteiro starts from `roteiro-modelo.json`.
- **VT padrão structure.** The scene `tipo`s are exactly `abertura`, then one `produto` per product, then `fechamento`. Stage 1 validation enforces this.
- **VT padrão stage 2** runs `tts.py` itself, through an injectable `narrador` so tests can stub it. It writes `legenda-post.txt` mechanically. A visual ajuste on the prévia is a 400.

### Narration placeholders and validation (Oferta only)

In `roteiro.json`, each product scene carries `"produto": "<offer id>"`. Its `fala` uses placeholders instead of numbers:
- `{nome}`
- `{preco}`
- `{precoDe}`, allowed only when the product has a "de" price
- `{unidade}`

A `{validade}` placeholder is allowed anywhere when `validoAte` is set.

**After stage 1**, `validateRoteiroOferta(roteiro, oferta)` checks that:
- every selected product has at least one scene with its id and `{preco}` in the fala;
- there are no unknown ids or placeholders;
- there is no `{precoDe}` for a product without one;
- no fala contains a raw price number (regex on digits followed by `,dd`).

**On failure**, stage 1 automatically reruns once and passes the error to Claude (the existing `erroAnterior` path). If the rerun fails too, the stage ends in `erro` with the message.

**Expansion.** `expandirFalas(roteiro, produtos, validoAte)` replaces the placeholders, with prices spoken via `precoPorExtenso` and the date spoken as "até domingo, dia 19". It runs:
- in `readVideoState`, so the review screen shows the real text;
- before TTS in stage 2. `tts.py` gets a `roteiro.json` whose falas are already expanded, and the raw version is kept as `roteiro-modelo.json`.

When the operator edits a fala on the review screen, they edit the placeholder version, which the UI shows with the placeholders highlighted.

### Product photos (`prepareFolder`, Oferta only)

Each selected product produces `fotos/produto-<id>.png`:
- **Transparent** (alpha in the corners): copied as is.
- **White background** (all four corners near-white, or `foto: 'recorte'`): a white-background cutout is applied. New mode in `cutout.py`: `--branco`.
  - It flood-fills from the borders only, with a tolerance, so white inside the product stays.
  - It feathers the edge by 1 px.
- **Moldura** (a real background, or `foto: 'moldura'`): copied as is, with `fotoTipo: 'moldura'`, and the motor/Claude shows it in a frame.

`produtos.json` in the video folder holds the snapshot plus `foto` and `fotoTipo`, together with `loja`:
- `nome`, `endereco` from `companyProfile.address`;
- `whatsapp` from settings, then `companyProfile.contact`;
- `horario` summarised from `businessHours` when present;
- `validoAte`.

The player exposes `window.PRODUTOS` and `window.LOJA`. On-screen prices **must** come from `PRODUTOS[i].precoTela` and `.precoDeTela`, never typed. PEDIDO and REGRAS say so.

### Creation modes

- **✨ `nova`:** the current 3-stage flow, with the Oferta additions in PEDIDO-roteiro and PEDIDO-producao and the style hint.
- **⚡ `padrao`:**
  - **Stage 1:** Claude writes `roteiro.json` (the narration only) with a fixed structure: one `abertura` scene, one scene per product, and one `fechamento` scene. Validation as above.
  - **Stage 2 is mechanical, with no Claude call:**
    1. `tts.py` runs.
    2. The template `src/video-motor/modelos/vt-padrao/cenas.js` is copied into the video folder.
    3. Stills are taken with `renderVideo({ stills })`.
  - **The template** reads `PRODUTOS`, `LOJA`, `marca.json` and the word timings:
    - the abertura shows the logo plate and "OFERTAS DA SEMANA";
    - each product scene has the product flying in, then the "de" price struck through, then the new price popping on `{preco}`'s first word;
    - the fechamento shows the validity, the address and the WhatsApp;
    - it uses the brand's `marca.cor`, and photos in moldura go in a rounded card.
  - **An ajuste on the prévia:** narration ajustes go back to stage 1. A visual ajuste is not offered in padrão; the UI hides the prévia's ajuste box and shows "VT padrão: para mudar o visual, use Criação nova".
  - **Stage 3:** unchanged.

### Formats, styles, durations, tone

- **`formato: 'status'`:**
  - REGRAS gains a section saying the video is shorter, closes on WhatsApp and has no enquete, and that the caption can sit lower (no Reels UI overlay).
  - Auto duration targets 15–30 s.
- **`estilo`:** a one-paragraph direction per value in REGRAS. `mercado` means an encarte look, with big prices, yellow/red, and bursts. `livre` adds nothing.
- **`duracao: 'auto'`:**
  - The target is `null`; the review time bar shows the total without a target marker.
  - For Oferta, PEDIDO asks for about `SEGUNDOS_POR_PRODUTO` (4) per product plus about 8 s of opening and close. `SEGUNDOS_POR_PRODUTO` is one constant, so it can be tuned after the operator watches real videos.
  - For the other objectives, PEDIDO asks for 20–45 s, or 15–30 s on Status.
- **`tom: 'locutor'`:** a new `DIRECOES.locutor`: "Leia como locutor de comercial de supermercado na TV/rádio: muita energia, sorriso na voz, ritmo rápido, ênfase forte nos nomes dos produtos e nos preços…".
- **Objectives in REGRAS § Objetivo do vídeo:**
  - **Alcance:** enquete *or* salva/compartilha, plus the follow invite.
  - **Anúncio:** unchanged.
  - **Oferta:** products, then validity, address and WhatsApp.
  - **Institucional:** the brand plus the follow invite; no price, no hard sell.
  - **Aviso:** short and direct, with the notice, then the opening hours or the address; no sale, no enquete.

### UI (`VideoAnimado.tsx`)

The form, in this order:
1. Assunto.
2. Objetivo, with 5 option cards.
3. *Oferta block*, shown only for Oferta:
   - **Product picker:** cards with photo, name, price, and "de" price.
     - Unusable products are disabled with their reason: "sem preço", "preço inválido", "sem foto".
     - White-background products show a "Recortar / Moldura" toggle.
     - Photos with a real background show "vai em moldura".
     - A counter shows how many are picked against the duration limit.
   - **Válido até:** a date input, pre-filled with the earliest `validUntil` among the picked products.
   - **Criação:** ✨ Nova / ⚡ VT padrão.
4. Formato: Reels / Story-Status.
5. Duração: 15/30/45/60/Automático ✨.
6. Tom: 3 cards, with a voice sample for the locutor too.
7. Estilo: hidden for VT padrão.
8. Legenda.
9. Observação.

The sticky summary bar includes the product count.

**On the review screen:**
- Oferta product scenes show the product thumbnail and the expanded fala.
- There is an "editar texto" mode that shows the placeholders.

The **new tone sample** is `public/video-vozes/locutor.mp3`: a 10 s Gemini sample, made once with the new direction.

### Error handling

| Situation | Behaviour |
|---|---|
| An offer is deleted or edited after the video was created | The video uses its snapshot; nothing changes |
| An offer is deleted between opening the form and submitting | 400, "Produto não encontrado: <nome>" |
| A product is unusable (no price, invalid price, no photo) | It can't be picked (UI), and it is a 400 at the API |
| The white cutout eats the product | The operator sees it in the prévia and switches that product to Moldura, then regenerates |
| Placeholder validation fails | One automatic rerun with the error passed to Claude, then `erro` |
| Too many products for the duration | Blocked in the UI, 400 at the API |
| The Gemini quota runs out | The existing fallback to Gemini Live keeps the same direction |

## Testing

- **Unit** (`node --test`):
  - `parsePreco` (valid and invalid forms);
  - `precoPorExtenso` (0,99 / 1,00 / 4,49 / 13,99 / 297,00 / 1.234,50);
  - `normalizeBriefing` (new fields, the Oferta rules, the limits);
  - `validateRoteiroOferta` (each failure type);
  - `expandirFalas`;
  - the photo classification;
  - `cutout.py --branco` on a fixture: a dark square on white keeps its centre and gets transparent corners;
  - the `padrao` stage 2 never calls the runner and copies the template;
  - the `vt-padrao` template renders the fixture via `renderVideo` stills.
- **UI** (vitest):
  - the 5 objectives;
  - the Oferta block shows only for Oferta;
  - disabled products show their reasons;
  - the duration limit counter;
  - "Válido até" is pre-filled;
  - Estilo is hidden for padrão;
  - the posted body shape.
- **E2E with the operator:**
  - a VT padrão for Mercado Carvalho (4–5 products);
  - a Criação nova for Frios Modelo;
  - check the time per product, and tune `SEGUNDOS_POR_PRODUTO`.

## Build order

1. **Base:**
   - the 5 objectives, formato, estilo, `duracao: 'auto'` and `tom: 'locutor'`;
   - REGRAS/PEDIDO updates;
   - the locutor sample;
   - the UI for these.
2. **Product data:**
   - `parsePreco`/`precoPorExtenso`/`precoNaTela`;
   - the Oferta briefing and its snapshot;
   - photo classification plus `cutout.py --branco`;
   - `produtos.json`/`window.PRODUTOS`;
   - placeholders, `validateRoteiroOferta` and `expandirFalas`.
3. **Oferta ✨ nova:** the product picker UI, the PEDIDO additions, and the review screen for product scenes.
4. **Oferta ⚡ padrão:** the `vt-padrao` template, the mechanical stage 2, and the UI rules for padrão.
5. **E2E with the operator,** then tune the time per product.
