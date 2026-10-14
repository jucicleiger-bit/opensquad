# VT Frames (Molduras), Music, Pace and Render Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Oferta videos get a professional supermarket-VT look:
- three selectable frames (Encarte, Diagonal, Neon Premium, plus "A IA escolhe");
- a flyer-style price that is stamped or counts up;
- a music bed ducked under the announcer;
- a fast or calm pace;
- an automatic render check that sends layout failures back to Claude.

**Architecture:**
- A browser-side kit (`src/video-motor/vt/kit.js`, `window.VT`) holds the price markup, the motionmaxxing eases, price entrances and transitions.
- Each frame is a script (`vt/molduras/<id>/moldura.js`, `window.MOLDURA`) that the player loads when `roteiro.moldura` is set. The player draws the frame's fixed layer itself.
- The VT padrão template becomes a thin mapping of the frame. Criação nova animates on top of it.
- A Node module (`src/video-motor/checar.mjs`) seeks the player to each price moment and measures the DOM. The jobs run it after stage 2.
- `render.mjs` mixes a looped music track ducked by the voice.

**Tech Stack:**
- Node ESM, with `node --test`.
- Playwright (Chromium) for the player.
- ffmpeg for the mix.
- React + Vite + vitest for `content-central-app`.

**Spec:** `docs/superpowers/specs/2026-10-13-video-vt-molduras-design.md`

## Global Constraints

**Where and how to work:**
- Work only in the worktree `C:/Users/jucic/OneDrive/Documentos/PROJETO/OPENSQUAD/.claude/worktrees/video-animado`, on branch `video-animado-v2`.
- **Implementers never commit and never run a git command that writes.** The controller commits each task.
- Node tests: `node --test <files>`. Full suite: `npm test` from the worktree root.
- App: `cd content-central-app && npx vitest run <file>` and `npm run build`. `tsc --noEmit` checks nothing here, so use `npm run build`.

**The stage and the safe area:**
- The stage is **540×960 CSS px**, rendered at 2×. Every coordinate in this plan is in that space.
- The Reels safe area for anything important is **x 24–460, y 110–800**.

**The check (gate):**
- product `[data-papel="produto"]` box height ≥ **432** or width ≥ **432**, effective opacity ≥ 0.9;
- price `[data-papel="preco"]` effective opacity ≥ 0.9 and box inside the safe area;
- `[data-papel="reais"]` effective font size ≥ **72 px**;
- every `[data-papel]` rotated by at most **25°**;
- no stretch longer than **0.5 s** of stills (sampled every 0.25 s) with luminance standard deviation < **6**.

**Prices:**
- On-screen prices come only from `window.PRODUTOS[i].precoTela` / `precoDeTela`, through `VT.precoHtml` / `VT.deHtml`.
- Never type a price into a frame or a template.

**Frames and pace:**
- The frame ids are `encarte`, `diagonal`, `neon`. The briefing also accepts `auto`.
- The single list of frames is `src/video-motor/vt/molduras/index.json`.
- Pace: `SEGUNDOS_POR_PRODUTO = { rapido: 3, calmo: 4 }` and `MAX_PRODUTOS = 12`.
- The fixed-duration limit is `min(12, floor((duracao − 6) / segundos))`:
  - rápido: 15 → 3, 30 → 8, 45 → 12, 60 → 12;
  - calmo: 15 → 2, 30 → 6, 45 → 9, 60 → 12.
- `campanha` is trimmed and at most 30 characters, default `"Ofertas da Semana"`.
- Rápido product falas have at most **6 words besides placeholders**.

**Music:**
- Music files live in `src/video-motor/trilhas/` (already committed, with `LICENCAS.md`).
- Default tracks: encarte `funkee-monkeee.mp3`, diagonal `midnight-funk.mp3`, neon `trap-electro-vibes.mp3`.
- Music never fails a render.

**Code style:**
- Browser scripts under `src/video-motor/` start with a `/* global ... */` line naming the browser globals they use, because `eslint.config.js` gives `src/**/*.js` the node globals only.
- Match the surrounding code: short comments that say why, Portuguese for UI and operator-facing text, English for comments.

## Waves

| Wave | Tasks | Why together |
|---|---|---|
| 1 | Task 1 (kit) ∥ Task 2 (briefing and pace) | disjoint files, no dependency |
| 2 | Task 3 (jobs stage 1) ∥ Task 4 (player and Encarte) | 3 needs 2; 4 needs 1 and 2; disjoint files |
| 3 | Task 5 (check) ∥ Task 6 (music) | 5 needs 4; 6 needs 4; disjoint files |
| 4 | Task 7 (Diagonal) ∥ Task 8 (Neon) ∥ Task 9 (jobs stage 2 check and rules) | all need 5; disjoint files |
| 5 | Task 10 (form and samples) | needs 2, 4, 7, 8 |

---

### Task 1: VT kit (`window.VT`)

**Files:**
- Create: `src/video-motor/vt/kit.js`
- Test: `tests/video-motor-vt-kit.test.js`

**Depends-on:** none

**Interfaces:**
- Produces `window.VT` (browser), loadable in Node via `vm`:
  - `VT.ease.{cruise, glide, softInOut, softLand, gentleIn, snapSettle, whip, accelExit, popOver, crashIn}` — each `(x: number 0..1) => number`.
  - `VT.precoPartes(precoTela: string) => { moeda: string, reais: string, centavos: string }`
  - `VT.unidadeTela(u: string) => string`. `'un'` → `'a unidade'`, `'kg'` → `'o quilo'`, `''` → `''`, anything else is returned as is.
  - `VT.precoHtml(produto, { classe = '' } = {}) => string`. The markup has `data-papel="preco"` on the outer element and `data-papel="reais"` on the reais span.
  - `VT.deHtml(produto, { classe = '' } = {}) => string`. Returns `''` without `precoDeTela`, otherwise an element with `data-papel="de"`.
  - `VT.carimbo(t, t0) => { visivel: boolean, scale: number, rotate: number, shake: number }`
  - `VT.contagem(t, t0, alvo: string, dur = 0.5) => string`
  - `VT.momentoPreco(A, produto, fallback: number) => number`. Gives the time of the last mention of the first word of `produto.precoFalado`, or `fallback`.
  - `VT.transicao.cortina(cor: string) => (t, s, next, i) => void` and `VT.transicao.passada(t, s, next, i) => void`. These have the player's `VIDEO.transicao` signature.
  - `VT.cssBase: string`, the structural CSS for `.vt-preco` and its parts. Frames style the look.

- [ ] **Step 1: Write the failing test** `tests/video-motor-vt-kit.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function carregarKit() {
  const ctx = { window: {}, Math, String, Number, Array, Object, JSON };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(await readFile(new URL('../src/video-motor/vt/kit.js', import.meta.url), 'utf8'), ctx);
  return ctx.VT;
}

test('precoPartes splits reais and centavos, thousands kept', async () => {
  const VT = await carregarKit();
  assert.deepEqual({ ...VT.precoPartes('R$ 13,99') }, { moeda: 'R$', reais: '13', centavos: '99' });
  assert.deepEqual({ ...VT.precoPartes('R$ 0,99') }, { moeda: 'R$', reais: '0', centavos: '99' });
  assert.deepEqual({ ...VT.precoPartes('R$ 1.299,90') }, { moeda: 'R$', reais: '1.299', centavos: '90' });
});

test('precoHtml marks preco and reais, shows the unit; deHtml only with a de price', async () => {
  const VT = await carregarKit();
  const html = VT.precoHtml({ precoTela: 'R$ 13,99', unidade: 'un' });
  assert.match(html, /data-papel="preco"/);
  assert.match(html, /data-papel="reais"[^>]*>13</);
  assert.match(html, /99/);
  assert.match(html, /a unidade/);
  assert.equal(VT.deHtml({ precoTela: 'R$ 13,99', precoDeTela: '' }), '');
  assert.match(VT.deHtml({ precoTela: 'R$ 13,99', precoDeTela: 'R$ 16,99' }), /data-papel="de"[\s\S]*R\$ 16,99/);
});

test('carimbo: hidden before t0, 3.5x at t0, lands at 1 by t0+0.4', async () => {
  const VT = await carregarKit();
  assert.equal(VT.carimbo(0.9, 1).visivel, false);
  const a = VT.carimbo(1, 1);
  assert.equal(a.visivel, true);
  assert.ok(Math.abs(a.scale - 3.5) < 1e-9);
  assert.ok(Math.abs(VT.carimbo(1.4, 1).scale - 1) < 0.01);
  assert.ok(VT.carimbo(1.1, 1).shake > 0);
  assert.equal(VT.carimbo(2, 1).shake, 0);
});

test('contagem is empty before t0, monotonic, and lands exactly on the target', async () => {
  const VT = await carregarKit();
  assert.equal(VT.contagem(0.5, 1, 'R$ 13,99'), '');
  assert.equal(VT.contagem(1.5, 1, 'R$ 13,99'), 'R$ 13,99');
  assert.equal(VT.contagem(9, 1, 'R$ 1.299,90'), 'R$ 1.299,90');
  const cents = (s) => Number(s.replace(/\D/g, ''));
  let prev = -1;
  for (let t = 1; t <= 1.5; t += 1 / 30) {
    const v = cents(VT.contagem(t, 1, 'R$ 13,99'));
    assert.ok(v >= prev, `not monotonic at ${t}`);
    prev = v;
  }
});

test('eases start at 0 and end at 1; snapSettle is mostly done early', async () => {
  const VT = await carregarKit();
  for (const [nome, f] of Object.entries(VT.ease)) {
    assert.ok(Math.abs(f(0)) < 1e-6, `${nome}(0)`);
    assert.ok(Math.abs(f(1) - 1) < 1e-6, `${nome}(1)`);
  }
  assert.ok(VT.ease.snapSettle(0.1) > 0.5);
  assert.ok(VT.ease.accelExit(0.5) < 0.2);
  assert.ok(VT.ease.popOver(0.72) > 1.05);
});

test('momentoPreco takes the last mention of the first spoken price word', async () => {
  const VT = await carregarKit();
  const ditas = { treze: [2.0, 3.5] };
  const A = (w, n = 1) => { const h = ditas[w]; if (!h || !h[n - 1]) throw new Error('não'); return h[n - 1]; };
  assert.equal(VT.momentoPreco(A, { precoFalado: 'treze e noventa e nove' }, 9), 3.5);
  assert.equal(VT.momentoPreco(A, { precoFalado: 'dez e noventa' }, 9), 9);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/video-motor-vt-kit.test.js`
Expected: FAIL (ENOENT for `src/video-motor/vt/kit.js`)

- [ ] **Step 3: Write `src/video-motor/vt/kit.js`**

```js
/* global window, document */
// VT kit: shared pieces for every supermarket-VT frame (vt/molduras/*).
// Timing comes from the motionmaxxing skill's measured curves (references/motion.md):
// arrivals decelerate from oversize, exits accelerate, counters step per frame
// and land on the real value. Every function is pure in t, so seek(t) stays exact.
(() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const p = (t, a, b) => clamp((t - a) / (b - a));
  const expoOut = (k) => (x) => (1 - Math.exp(-k * x)) / (1 - Math.exp(-k));

  // The measured eases, fitted to "% done at 10/25/50/75% of the move".
  const ease = {
    cruise: (x) => x,
    glide: (x) => 1 - Math.pow(1 - x, 1.7),
    softInOut: (x) => (1 - Math.cos(Math.PI * x)) / 2,
    softLand: expoOut(3.4),
    gentleIn: (x) => Math.pow(x, 2.07),
    snapSettle: expoOut(7.5),
    whip: (x) => 1 - Math.pow(1 - x, 2.5),
    accelExit: (x) => Math.pow(x, 2.6),
    // Late lean past the mark (peak ~1.08 near 0.72).
    popOver: (x) => { const c = 1.3; return x >= 1 ? 1 : 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
    // Slam: past the mark almost at once (peak 1.18 at 0.27), relaxing back.
    crashIn: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.27 ? 1.18 * Math.sin((x / 0.27) * Math.PI / 2) : 1 + 0.18 * Math.pow(1 - (x - 0.27) / 0.73, 2)),
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function precoPartes(precoTela) {
    const m = /^(R\$)\s*([\d.]+),(\d{2})$/.exec(String(precoTela || '').trim());
    return m ? { moeda: m[1], reais: m[2], centavos: m[3] } : { moeda: '', reais: String(precoTela || ''), centavos: '' };
  }

  const UNIDADES = { un: 'a unidade', kg: 'o quilo' };
  const unidadeTela = (u) => (u ? UNIDADES[u] || u : '');

  // Flyer price: small R$, huge reais, small raised centavos with the unit under them.
  function precoHtml(produto, { classe = '' } = {}) {
    const { moeda, reais, centavos } = precoPartes(produto.precoTela);
    const un = unidadeTela(produto.unidade);
    return `<div class="vt-preco ${classe}" data-papel="preco"><span class="vt-moeda">${esc(moeda)}</span><span class="vt-reais" data-papel="reais">${esc(reais)}</span><span class="vt-cc">${centavos ? `<span class="vt-cent">,${esc(centavos)}</span>` : ''}${un ? `<span class="vt-un">${esc(un)}</span>` : ''}</span></div>`;
  }

  function deHtml(produto, { classe = '' } = {}) {
    return produto.precoDeTela ? `<div class="vt-de ${classe}" data-papel="de">de <s>${esc(produto.precoDeTela)}</s> por</div>` : '';
  }

  // Stamp: falls from 3.5x (snapSettle, ~86% of the drop by 6 frames), a short shake on landing.
  function carimbo(t, t0) {
    if (t < t0) return { visivel: false, scale: 3.5, rotate: -8, shake: 0 };
    const k = ease.snapSettle(p(t, t0, t0 + 0.4));
    const shake = Math.max(0, 1 - Math.abs(t - (t0 + 0.08)) * 10);
    return { visivel: true, scale: 3.5 + (1 - 3.5) * k, rotate: -8 * (1 - k) - 3 * k, shake };
  }

  const formatar = (cents) => {
    const reais = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `R$ ${reais},${String(cents % 100).padStart(2, '0')}`;
  };

  // Counter: one value per frame (30 fps), decaying steps, exactly the target at t0+dur.
  function contagem(t, t0, alvo, dur = 0.5) {
    if (t < t0) return '';
    if (t >= t0 + dur) return alvo;
    const { reais, centavos } = precoPartes(alvo);
    const total = Number(reais.replace(/\./g, '')) * 100 + Number(centavos || 0);
    const quadros = Math.max(1, Math.ceil(dur * 30));
    const f = Math.floor((t - t0) * 30);
    return formatar(Math.round(total * ease.softLand(Math.min(1, f / quadros))));
  }

  // The new price is said last ("de dezesseis… por treze…"): last mention of its first word.
  function momentoPreco(A, produto, fallback) {
    const w = String(produto?.precoFalado || '').split(' ')[0];
    if (!w) return fallback;
    let ultimo = null;
    for (let n = 1; n < 20; n += 1) { try { ultimo = A(w, n); } catch { break; } }
    return ultimo ?? fallback;
  }

  // Transitions with the player's VIDEO.transicao(t, s, next, i) signature.
  // The player calls it for every scene inside its window; this must show the
  // scene (display) and place it, as the player's own transitions do.
  const TR = 0.32;
  function cortina(cor) {
    return (t, s, next, i) => {
      const tin = i ? p(t, s.start - TR / 2, s.start + TR / 2) : 1;
      const tout = next ? p(t, s.end - TR / 2, s.end + TR / 2) : 0;
      // The panel sweeps across on the cut: leaving accelerates, landing decelerates.
      const entra = 1 - ease.softLand(tin), sai = ease.accelExit(tout);
      Object.assign(s.el.style, { display: 'block', opacity: 1, zIndex: i, filter: 'none',
        clipPath: entra > 0.001 ? `polygon(${entra * 140}% 0, 140% 0, 140% 100%, ${entra * 140 - 40}% 100%)` : 'none',
        transform: sai > 0.001 ? `translateX(${-sai * 18}%)` : 'none' });
      let painel = s.el.querySelector(':scope > .vt-painel');
      if (!painel) { painel = document.createElement('div'); painel.className = 'vt-painel'; s.el.appendChild(painel); }
      const k = i ? 1 - Math.abs(tin * 2 - 1) : 0;
      Object.assign(painel.style, { position: 'absolute', inset: '-10% -60%', background: cor, zIndex: 99, pointerEvents: 'none',
        opacity: k > 0.001 ? 1 : 0, transform: `translateX(${lerp(120, -120, tin)}%) skewX(-18deg)` });
    };
  }
  const lerp = (a, b, x) => a + (b - a) * x;
  function passada(t, s, next, i) {
    const tin = i ? p(t, s.start - TR / 2, s.start + TR / 2) : 1;
    const tout = next ? p(t, s.end - TR / 2, s.end + TR / 2) : 0;
    const entra = 1 - ease.whip(tin), sai = ease.accelExit(tout);
    const x = entra * 620 - sai * 620;
    const blur = entra * 18 + sai * 18;
    Object.assign(s.el.style, { display: 'block', opacity: 1, zIndex: i, clipPath: 'none',
      transform: Math.abs(x) > 0.5 ? `translateX(${x}px)` : 'none', filter: blur > 0.3 ? `blur(${blur}px)` : 'none' });
  }

  const cssBase = `
    .vt-preco { display:inline-flex; align-items:flex-start; line-height:1; white-space:nowrap; }
    .vt-moeda { font-size:.32em; margin:.18em .08em 0 0; }
    .vt-reais { font-size:1em; }
    .vt-cc { display:flex; flex-direction:column; align-items:flex-start; margin:.06em 0 0 .04em; }
    .vt-cent { font-size:.45em; line-height:1; }
    .vt-un { font-size:.17em; line-height:1.1; margin-top:.15em; font-family:Inter, sans-serif; font-weight:900; text-transform:uppercase; }
  `;

  window.VT = { ease, precoPartes, unidadeTela, precoHtml, deHtml, carimbo, contagem, momentoPreco, transicao: { cortina, passada }, cssBase };
})();
```

The `cortina` panel is created once and reused, so the DOM stays the same between seeks. This keeps `seek(t)` pure. Note that `lerp` is declared after `cortina` but is only called inside the returned function, at seek time, so it is defined by then.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/video-motor-vt-kit.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Report.** Do not commit. Report the files touched.

---

### Task 2: Briefing — frame, pace and campaign; pace limits; Oferta validation

**Files:**
- Create: `src/video-motor/vt/molduras/index.json`
- Modify:
  - `src/content-central-video-produtos.js`: constants, `normalizeOferta`, `validateRoteiroOferta`;
  - `src/content-central-video.js`: `listVideos` adds `moldura`;
  - `src/content-central-video-jobs.js`: only the one line in `duracaoTexto` that uses `SEGUNDOS_POR_PRODUTO`.
- Test:
  - `tests/content-central-video-produtos.test.js`
  - `tests/content-central-video.test.js`
  - `tests/content-central-video-jobs.test.js` (only if an existing assertion breaks)

**Depends-on:** none

**Interfaces:**
- Produces:
  - `MOLDURAS` (array of `{ id, nome, trilha, descricao }`, read from `index.json`);
  - `SEGUNDOS_POR_PRODUTO = { rapido: 3, calmo: 4 }`, `MAX_PRODUTOS = 12`;
  - `produtosPorDuracao(duracao: number | 'auto', ritmo: 'rapido' | 'calmo') => number`.
- `normalizeOferta(input, disponiveis, duracao)` now returns `{ produtos, validoAte, criacao, precosEm, moldura, ritmo, campanha }`.
- `validateRoteiroOferta(roteiro, oferta)` also checks:
  - for `oferta.moldura === 'auto'`, that `roteiro.moldura` is one of the `MOLDURAS` ids;
  - for `ritmo === 'rapido'`, that each product fala has at most 6 words besides placeholders.
- `listVideos` items gain `moldura: string | null` (the briefing's `oferta.moldura`, else null).
- `PRODUTOS_POR_DURACAO` is removed. Grep for its users and switch them to `produtosPorDuracao`.

- [ ] **Step 1: Create `src/video-motor/vt/molduras/index.json`**

```json
[
  { "id": "encarte", "nome": "Encarte", "trilha": "funkee-monkeee.mp3", "descricao": "encarte clássico amarelo e vermelho, preço em explosão com selo OFERTA" },
  { "id": "diagonal", "nome": "Diagonal", "trilha": "midnight-funk.mp3", "descricao": "tela dividida na diagonal (cor da marca e amarelo), preço em balão, cortina diagonal entre produtos" },
  { "id": "neon", "nome": "Neon Premium", "trilha": "trap-electro-vibes.mp3", "descricao": "fundo preto premium com neon vermelho e dourado, faíscas, fecho ANOTA AÍ" }
]
```

- [ ] **Step 2: Write the failing tests.** Add them to `tests/content-central-video-produtos.test.js`, adapting the imports at the top of the file:

```js
import { MOLDURAS, SEGUNDOS_POR_PRODUTO, MAX_PRODUTOS, produtosPorDuracao, normalizeOferta, validateRoteiroOferta } from '../src/content-central-video-produtos.js';

test('pace: seconds per product and the products that fit each duration', () => {
  assert.deepEqual(SEGUNDOS_POR_PRODUTO, { rapido: 3, calmo: 4 });
  assert.equal(MAX_PRODUTOS, 12);
  assert.deepEqual([15, 30, 45, 60].map((d) => produtosPorDuracao(d, 'rapido')), [3, 8, 12, 12]);
  assert.deepEqual([15, 30, 45, 60].map((d) => produtosPorDuracao(d, 'calmo')), [2, 6, 9, 12]);
  assert.equal(produtosPorDuracao('auto', 'calmo'), 12);
});

test('MOLDURAS lists encarte, diagonal and neon with their tracks', () => {
  assert.deepEqual(MOLDURAS.map((m) => m.id), ['encarte', 'diagonal', 'neon']);
  assert.ok(MOLDURAS.every((m) => m.nome && m.trilha && m.descricao));
});

test('normalizeOferta: frame, pace and campaign with defaults and limits', () => {
  const disp = [{ id: 'a', nome: 'A', preco: 100, precoDe: null, unidade: '', foto: 'x.png', fotoTipo: 'transparente' }];
  const base = { produtos: [{ id: 'a' }], validoAte: '' };
  const o = normalizeOferta(base, disp, 'auto');
  assert.equal(o.moldura, 'encarte');
  assert.equal(o.ritmo, 'rapido');
  assert.equal(o.campanha, 'Ofertas da Semana');
  const o2 = normalizeOferta({ ...base, moldura: 'auto', ritmo: 'calmo', campanha: '  Mês da Economia da Família Carvalho Supermercados  ' }, disp, 'auto');
  assert.equal(o2.moldura, 'auto');
  assert.equal(o2.ritmo, 'calmo');
  assert.equal(o2.campanha, 'Mês da Economia da Família Carv');
  assert.equal(o2.campanha.length, 30);
  assert.equal(normalizeOferta({ ...base, ritmo: 'turbo' }, disp, 'auto').ritmo, 'rapido');
  assert.throws(() => normalizeOferta({ ...base, moldura: 'xadrez' }, disp, 'auto'), /Moldura desconhecida/);
});

test('normalizeOferta enforces the pace limit for a fixed duration', () => {
  const disp = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, nome: `P${i}`, preco: 100, precoDe: null, unidade: '', foto: 'x.png', fotoTipo: 'transparente' }));
  const nove = { produtos: disp.map((p) => ({ id: p.id })), validoAte: '' };
  assert.throws(() => normalizeOferta({ ...nove, ritmo: 'rapido' }, disp, 30), /30s cabe até 8 produtos/);
  assert.doesNotThrow(() => normalizeOferta({ ...nove, ritmo: 'rapido' }, disp, 45));
});

test('validateRoteiroOferta: auto frame needs a known id in the roteiro', () => {
  const oferta = { produtos: [{ id: 'a', nome: 'A', preco: 100, precoDe: null, unidade: '' }], validoAte: '', criacao: 'nova', moldura: 'auto', ritmo: 'calmo' };
  const cenas = [{ tipo: 'p', produto: 'a', fala: 'A por {preco}!' }];
  assert.match(validateRoteiroOferta({ cenas }, oferta).join(' '), /moldura/);
  assert.match(validateRoteiroOferta({ moldura: 'xadrez', cenas }, oferta).join(' '), /moldura/);
  assert.deepEqual(validateRoteiroOferta({ moldura: 'neon', cenas }, oferta), []);
  assert.deepEqual(validateRoteiroOferta({ cenas }, { ...oferta, moldura: 'encarte' }), []);
});

test('validateRoteiroOferta: rápido product falas have at most 6 words besides placeholders', () => {
  const oferta = { produtos: [{ id: 'a', nome: 'A', preco: 100, precoDe: 200, unidade: 'kg' }], validoAte: '', criacao: 'nova', moldura: 'encarte', ritmo: 'rapido' };
  const ok = [{ tipo: 'p', produto: 'a', fala: 'Fralda IsaBaby, de {precoDe} por {preco} {unidade}!' }];
  const longa = [{ tipo: 'p', produto: 'a', fala: 'Olha que maravilha essa fralda IsaBaby por {preco}!' }];
  assert.deepEqual(validateRoteiroOferta({ cenas: ok }, oferta), []);
  assert.match(validateRoteiroOferta({ cenas: longa }, oferta).join(' '), /Cena 1: .*6 palavras/);
  assert.deepEqual(validateRoteiroOferta({ cenas: longa }, { ...oferta, ritmo: 'calmo' }), []);
});
```

Also add a test to `tests/content-central-video.test.js` that `listVideos` includes `moldura`. Follow how that file already creates an Oferta video; if it has no Oferta helper, use a non-Oferta video and assert `moldura === null`, then an Oferta one and assert `'encarte'`.

- [ ] **Step 3: Run them and see them fail**

Run: `node --test tests/content-central-video-produtos.test.js tests/content-central-video.test.js`
Expected: FAIL (`MOLDURAS`/`produtosPorDuracao` not exported, etc.)

- [ ] **Step 4: Implement in `src/content-central-video-produtos.js`.** Replace the constants near the top, lines 10–13:

```js
import { readFileSync } from 'node:fs';

export const MAX_PRODUTOS = 12;
export const SEGUNDOS_POR_PRODUTO = { rapido: 3, calmo: 4 };
// The one list of VT frames; the motor's vt/molduras/<id>/ folders follow it.
export const MOLDURAS = JSON.parse(readFileSync(new URL('./video-motor/vt/molduras/index.json', import.meta.url), 'utf8'));
const MOLDURA_IDS = new Set(MOLDURAS.map((m) => m.id));
const CAMPANHA_PADRAO = 'Ofertas da Semana';

// Opening and closing take about 6 s; the rest is products at the chosen pace.
export function produtosPorDuracao(duracao, ritmo) {
  if (duracao === 'auto') return MAX_PRODUTOS;
  return Math.min(MAX_PRODUTOS, Math.floor((Number(duracao) - 6) / SEGUNDOS_POR_PRODUTO[ritmo]));
}
```

Keep any other constants that sat on lines 10–13 (read them first).

In `normalizeOferta`, read the new fields before the limit check, and use them:

```js
  const ritmo = input?.ritmo === 'calmo' ? 'calmo' : 'rapido';
  const moldura = String(input?.moldura || 'encarte');
  if (moldura !== 'auto' && !MOLDURA_IDS.has(moldura)) throw httpError(400, 'Moldura desconhecida.');
  const campanha = String(input?.campanha ?? '').trim().slice(0, 30) || CAMPANHA_PADRAO;
  const limite = produtosPorDuracao(duracao, ritmo);
  if (duracao !== 'auto' && lista.length > limite) throw httpError(400, `${duracao}s cabe até ${limite} produtos.`);
```

Its return value gains `moldura, ritmo, campanha`.

In `validateRoteiroOferta`, after the per-scene loop, add:

```js
  if (oferta.moldura === 'auto' && !MOLDURA_IDS.has(String(roteiro?.moldura || ''))) {
    erros.push(`Escolha a moldura: escreva "moldura" no roteiro.json com um destes: ${[...MOLDURA_IDS].join(', ')}.`);
  }
```

Inside the per-scene loop, after the existing checks, add:

```js
    // Rápido: about 3 s per product, so only the name and the price.
    if (p && oferta.ritmo === 'rapido') {
      const palavras = (fala.replace(MARCADOR, ' ').match(/[\p{L}\d]+/gu) || []).length;
      if (palavras > 6) erros.push(`Cena ${i + 1}: no ritmo rápido a fala do produto tem no máximo 6 palavras além do preço (tem ${palavras}).`);
    }
```

In `src/content-central-video.js` `listVideos`, add `moldura: video.briefing.oferta?.moldura || null` to the pushed object.

In `src/content-central-video-jobs.js` `duracaoTexto`, the Oferta branch becomes:

```js
  if (b.oferta) {
    const n = b.oferta.produtos.length;
    const s = SEGUNDOS_POR_PRODUTO[b.oferta.ritmo] || SEGUNDOS_POR_PRODUTO.rapido;
    return `automática (cerca de ${s}s por produto × ${n} + uns 6s de abertura e fechamento ≈ ${n * s + 6}s)`;
  }
```

- [ ] **Step 5: Run the tests and fix any existing assertion that encoded the old 10/4s/`PRODUTOS_POR_DURACAO` values.** Update those assertions to the new values, not the code.

Run: `node --test tests/content-central-video-produtos.test.js tests/content-central-video.test.js tests/content-central-video-jobs.test.js tests/content-central-video-server.test.js`
Expected: PASS

- [ ] **Step 6: Report.** Do not commit.

---

### Task 3: Jobs stage 1 — force frame, campaign, pace and track; prompt lines; PEDIDO-roteiro

**Files:**
- Modify:
  - `src/content-central-video-jobs.js`: `forcarRoteiro`, `stagePrompt`;
  - `src/video-motor/PEDIDO-roteiro.md`.
- Test: `tests/content-central-video-jobs.test.js`

**Depends-on:** Task 2

**Interfaces:**
- Consumes `MOLDURAS` (Task 2), and `oferta.moldura`, `oferta.ritmo` and `oferta.campanha` on the briefing.
- Produces, for Oferta videos, a `roteiro.json` with:
  - `moldura` (an id; Claude's pick when the briefing says `auto`);
  - `campanha`;
  - `ritmo`;
  - `trilha` (the file name from `MOLDURAS` for that frame).
- `forcarRoteiro` keeps these on every call, including the stage 2 re-force.

- [ ] **Step 1: Write the failing tests.** Add them to `tests/content-central-video-jobs.test.js`, reusing the existing `withProject`, `comOferta`, `ofertaBriefing` and `ofertaRunner` helpers:

```js
test('Oferta stage 1 forces frame, campaign, pace and the frame track into roteiro.json', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por {preco}!']), renderer: async () => ({}) });
    const video = await createVideo('king', { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, moldura: 'neon', ritmo: 'calmo', campanha: 'Mês da Economia' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const r = JSON.parse(await readFile(join(videoDir(dir, 'king', video.id), 'roteiro.json'), 'utf8'));
    assert.equal(r.moldura, 'neon');
    assert.equal(r.campanha, 'Mês da Economia');
    assert.equal(r.ritmo, 'calmo');
    assert.equal(r.trilha, 'trap-electro-vibes.mp3');
    assert.match(calls[0].prompt, /Moldura: Neon Premium/);
    assert.match(calls[0].prompt, /ritmo calmo \(4s por produto\)/);
    assert.match(calls[0].prompt, /selo da campanha "Mês da Economia"/);
  });
});

test('Oferta with moldura auto: the prompt lists the frames, Claude picks one, the track follows it', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const runner = async (args) => {
      await ofertaRunner(calls, ['Fralda por {preco}!'])(args);
      const p = join(args.cwd, 'roteiro.json');
      const r = JSON.parse(await readFile(p, 'utf8'));
      await writeFile(p, JSON.stringify({ ...r, moldura: 'diagonal' }));
      return { text: 'ok' };
    };
    const jobs = createVideoJobs({ targetDir: dir, runner, renderer: async () => ({}) });
    const video = await createVideo('king', { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, moldura: 'auto' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.match(calls[0].prompt, /Moldura: você escolhe/);
    assert.match(calls[0].prompt, /encarte: encarte clássico/);
    const r = JSON.parse(await readFile(join(videoDir(dir, 'king', video.id), 'roteiro.json'), 'utf8'));
    assert.equal(r.moldura, 'diagonal');
    assert.equal(r.trilha, 'midnight-funk.mp3');
  });
});

test('Oferta with moldura auto and no pick: one retry, then erro', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por {preco}!']), renderer: async () => ({}) });
    const video = await createVideo('king', { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, moldura: 'auto' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.equal(calls.length, 2);
    assert.match((await readVideo('king', video.id, dir)).erro, /moldura/);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/content-central-video-jobs.test.js`
Expected: the 3 new tests FAIL

- [ ] **Step 3: Implement.** Import `MOLDURAS` from `./content-central-video-produtos.js`.

In `stagePrompt`, after the existing `Oferta:` line, add one more line when `b.oferta`:

```js
    ...(b.oferta ? [linhaMoldura(b.oferta)] : []),
```

with:

```js
const NOMES_RITMO = { rapido: 'rápido', calmo: 'calmo' };
function linhaMoldura(o) {
  const ritmo = `ritmo ${NOMES_RITMO[o.ritmo] || 'rápido'} (${SEGUNDOS_POR_PRODUTO[o.ritmo] || 3}s por produto)`;
  const selo = `selo da campanha "${o.campanha || 'Ofertas da Semana'}"`;
  if (o.moldura === 'auto') {
    return `Moldura: você escolhe pelo assunto, a observação e a época; escreva "moldura": "<id>" no roteiro.json, um de: ${MOLDURAS.map((m) => `${m.id}: ${m.descricao}`).join('; ')}. ${ritmo}, ${selo}.`;
  }
  const m = MOLDURAS.find((x) => x.id === o.moldura) || MOLDURAS[0];
  return `Moldura: ${m.nome} (${m.id}), ${ritmo}, ${selo}.`;
}
```

In `forcarRoteiro`, add at the end, before `return roteiro`:

```js
  if (briefing.oferta) {
    const o = briefing.oferta;
    // "auto" keeps Claude's pick (validated before this); anything else comes from the briefing.
    if (o.moldura !== 'auto') roteiro.moldura = o.moldura;
    roteiro.campanha = o.campanha;
    roteiro.ritmo = o.ritmo;
    roteiro.trilha = (MOLDURAS.find((m) => m.id === roteiro.moldura) || MOLDURAS[0]).trilha;
  }
```

`validateRoteiroOferta` (Task 2) already rejects a missing or unknown pick for `auto`, and the existing single retry passes that error back.

In `src/video-motor/PEDIDO-roteiro.md`, add this paragraph at the end:

```markdown
**Oferta — moldura e ritmo:** a linha "Moldura" do pedido diz a moldura do VT (o visual fixo: fundo, logo, selo da campanha, validade) e o ritmo. Se ela disser "você escolhe", escreva `"moldura": "<id>"` no `roteiro.json` com a moldura que combina com o assunto e a época. No **ritmo rápido** (3 s por produto), a fala de cada produto tem no máximo 6 palavras além dos marcadores: só o nome curto e o preço ("Omo de setecentos gramas, {preco}!", "Fralda IsaBaby, de {precoDe} por {preco}!"). No **calmo** (4 s) cabe uma frase a mais.
```

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/content-central-video-jobs.test.js tests/content-central-video-produtos.test.js`
Expected: PASS

- [ ] **Step 5: Report.** Do not commit.

---

### Task 4: Player loads the frame; the Encarte frame; VT padrão maps the frame

**Files:**
- Modify:
  - `src/video-motor/player.html`
  - `src/video-motor/modelos/vt-padrao/cenas.js` (rewrite)
  - `tests/video-motor.test.js` (the existing vt-padrao test)
- Create:
  - `src/video-motor/vt/molduras/encarte/moldura.js`
  - `tests/helpers/vt-fixture.js` (the shared frame fixture; a helper module, not a test file, so importing it never re-runs tests)
  - `tests/video-motor-moldura-encarte.test.js`

**Depends-on:** Task 1, Task 2

**Interfaces:**
- Consumes `window.VT` (Task 1) and `index.json` (Task 2).
- The player, when `R.moldura` is set:
  1. Loads `/_motor/vt/kit.js`.
  2. Loads `/_motor/vt/molduras/${R.moldura}/moldura.js`.
  3. Injects `VT.cssBase + MOLDURA.css` and the `MOLDURA.fontes` link.
  4. Fills `#fixo` with `MOLDURA.fixo.html(LOJA, R.campanha, R.marca)`.
  5. Calls `MOLDURA.fixo.frame(t, qFixo)` on every seek, where `qFixo(k)` is `#fixo [data-k="k"]`.
  6. Only then loads `cenas.js`.
- It sets `window.CENAS = S` after `build()`. Each element is `{ c, type, el, q, A, i, start, end }`; `checar.mjs` (Task 5) reads it.
- **`MOLDURA` contract**, which every frame follows exactly:

```js
window.MOLDURA = {
  id: 'encarte', nome: 'Encarte',
  fontes: 'https://fonts.googleapis.com/css2?...', css: `...`,
  fixo: { html: (loja, campanha, marca) => '...', frame: (t, q) => {} },
  tipos: { abertura: {html, frame, sfx}, produto: {html, frame, sfx}, fechamento: {html, frame, sfx} },
  transicao: (t, s, next, i) => {},
};
```

- A `produto` type marks the product image `data-papel="produto"`. It renders the price only through `VT.precoHtml` (inside an element the frame animates with `VT.carimbo` or `VT.contagem` at `VT.momentoPreco(A, pr, s.start + 1.2)`), and the "de" price through `VT.deHtml`. It marks the name strip `data-papel="nome"` and any text badge (like "OFERTA") `data-papel="selo"`.
- **Layout zones for every frame**, in stage px:

| Zone | Where |
|---|---|
| Fixed top band (logo, campaign seal) | y 20–104 |
| Name strip | y 112–160 |
| Product photo box | 460×440 centred, y 165–605 |
| "de" line | y ~612 |
| Price badge | y 640–790, x within 24–460 |
| Validity strip and legal footer | y 805–900 (below the safe area: secondary information, repeated in the closing) |

**Design of Encarte** (reference: "Ofertas Imbatíveis" — classic yellow and red Brazilian flyer):
- **Ground:** radial yellow (#FFD400 → #FFB800) with red rays rotating slowly (cruise, about 6°/s), and a red band behind the price zone.
- **Fixed layer:**
  - logo in a white circle (76 px) at top-left x 24;
  - the campaign seal top-right in a red rounded tag with yellow Anton uppercase text, rotated −4°;
  - validity strip "Válido até dom, 19/10" (from `loja.validoAte`, formatted `dd/mm` with the weekday from `loja.validade`) in a black pill;
  - legal footer "Ofertas válidas até dd/mm ou enquanto durarem os estoques." at 13 px.
  - The fixed layer enters in the first 0.5 s (logo snapSettle from 3.5×, seal whip from the right), then only breathes.
- **Product:**
  - the name in a black strip with white Inter 900 uppercase;
  - the photo enters from below with softLand over 0.4 s, with a soft drop shadow and a gentle cruise drift (scale 1 → 1.03 across the scene);
  - a `moldura` photo sits in a white card with a 6 px red border.
- **Price:**
  - a red 16-point burst (SVG polygon) behind a yellow badge with red text;
  - Anton reais at **110 px**;
  - a small red oval "OFERTA" tag (`data-papel="selo"`) above-left of the badge;
  - the badge enters with `VT.carimbo`, the burst rotates slowly, and the screen shakes using `carimbo().shake`, returned as `{ shake }`.
- **Opening:** "OFERTAS" / campaign text crashing in from 3.5× (snapSettle), a red burst behind it and the store name.
- **Closing:** validity big ("Só até domingo, 19/10"), the address, the hours, and a green WhatsApp pill with the number, pulsing.
- **Transition:** `VT.transicao.cortina('#E30613')`.
- **sfx:** `whoosh` at scene start, `impact` at the price moment, `ding` on the closing pill.

- [ ] **Step 1: Write the shared fixture `tests/helpers/vt-fixture.js` and the failing test `tests/video-motor-moldura-encarte.test.js`**

`tests/helpers/vt-fixture.js`:

```js
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Jimp } from 'jimp';
import { MOTOR_DIR } from '../../src/video-motor/render.mjs';

// The VT padrão fixture with a given frame, ready to render. The caller removes the folder.
export async function fixtureVt(moldura) {
  const dir = await mkdtemp(join(tmpdir(), `vt-${moldura}-`));
  await cp('tests/fixtures/vt-padrao', dir, { recursive: true });
  await cp(join(MOTOR_DIR, 'modelos', 'vt-padrao', 'cenas.js'), join(dir, 'cenas.js'));
  await mkdir(join(dir, 'fotos'), { recursive: true });
  const im = new Jimp({ width: 300, height: 400, color: 0x00000000 });
  for (let y = 20; y < 380; y++) for (let x = 40; x < 260; x++) im.setPixelColor(0x2266ccff, x, y);
  await im.write(join(dir, 'fotos', 'produto-a.png'));
  const r = JSON.parse(await readFile(join(dir, 'roteiro.json'), 'utf8'));
  await writeFile(join(dir, 'roteiro.json'), JSON.stringify({ ...r, moldura, campanha: 'Ofertas da Semana', ritmo: 'rapido', trilha: 'funkee-monkeee.mp3', legendas: false }));
  return dir;
}
```

(`cp('tests/fixtures/vt-padrao', …)` is relative to the worktree root, where `npm test` runs.)

`tests/video-motor-moldura-encarte.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { renderVideo } from '../src/video-motor/render.mjs';
import { fixtureVt } from './helpers/vt-fixture.js';

test('the encarte frame renders the VT padrão fixture with its fixed layer and a kit price', async () => {
  const dir = await fixtureVt('encarte');
  try {
    const r = await renderVideo({ videoDir: dir, stills: [0.05, 2, 4.5, 7] });
    assert.equal(r.stills.length, 4);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
```

Add a second test in the same file that opens the player through the same local server `renderVideo` uses. Use its `serve` logic: export `serve` from `render.mjs` if it is not exported, which is a small change to `render.mjs` allowed in this task. Then:
1. Go to `/_motor/player.html`, await `window.ready`, and seek to 4.5.
2. Assert that `#fixo` has text containing `Ofertas da Semana`.
3. Assert that `[data-papel="preco"]`, `[data-papel="reais"]` and `[data-papel="produto"]` exist in the produto scene.
4. Assert that `window.CENAS.length === 3`.

If exporting `serve` collides with Task 6, which also edits `render.mjs` in a later wave, keep the change to one added `export` keyword.

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/video-motor-moldura-encarte.test.js`
Expected: FAIL (the template still draws the old VT, and there is no `#fixo` or `CENAS`)

- [ ] **Step 3: Player changes in `src/video-motor/player.html`**
1. Add `#fixo { position: absolute; inset: 0; z-index: 56; pointer-events: none; }` to the style, and `<div id="fixo"></div>` right after `<div id="flash"></div>`.
2. Add a loader and use it for `cenas.js` too:

```js
const carregar = (src, erro) => new Promise((ok, rej) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => rej(new Error(erro)); document.head.appendChild(sc); });
```

3. In `window.ready`, after `window.LOJA = …` and before `cenas.js`:

```js
  // VT frames (Oferta): the kit and the chosen frame come before cenas.js, which may build on them.
  // The frame's fixed layer (logo, campaign, validity) is drawn here, so no cenas.js can drop it.
  if (R.moldura) {
    await carregar('/_motor/vt/kit.js', 'vt/kit.js não encontrado');
    await carregar(`/_motor/vt/molduras/${encodeURIComponent(R.moldura)}/moldura.js`, `moldura "${R.moldura}" não encontrada`);
    if (MOLDURA.fontes) {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: MOLDURA.fontes });
      await new Promise((ok) => { link.onload = ok; link.onerror = ok; document.head.appendChild(link); });
    }
    document.head.insertAdjacentHTML('beforeend', `<style>${VT.cssBase}${MOLDURA.css || ''}</style>`);
    $('fixo').innerHTML = MOLDURA.fixo.html(window.LOJA, R.campanha || '', R.marca || {});
  }
```

4. After `build(…)`, add `window.CENAS = S;`.
5. In `seek(t)`, after `VIDEO.quadro?.(t);`, add:

```js
  if (window.MOLDURA) MOLDURA.fixo.frame(t, (k) => $('fixo').querySelector(`[data-k="${k}"]`));
```

6. Replace the inline cenas.js promise with `await carregar(asset('cenas.js'), 'cenas.js não encontrado na pasta do vídeo');`.

`MOLDURA` and `VT` are globals set by the loaded scripts. Reference them as `window.MOLDURA` and `window.VT`, or declare them where the player declares its other globals.

- [ ] **Step 4: Rewrite `src/video-motor/modelos/vt-padrao/cenas.js`**

```js
/* global window */
// VT padrão: the chosen frame (window.MOLDURA, loaded by the player from
// roteiro.moldura) assembled as is. Every price comes from produtos.json
// through the kit; Claude writes only the lines. Scenes: abertura, produto × N, fechamento.
window.VIDEO = { estrelas: false, tipos: window.MOLDURA.tipos, transicao: window.MOLDURA.transicao };
```

- [ ] **Step 5: Write `src/video-motor/vt/molduras/encarte/moldura.js`** to the design above. Use this skeleton, and fill every `html` and `frame` to the design:

```js
/* global window, R, asset, esc, st, p, eo, lerp, back */
// Encarte: the classic yellow-and-red Brazilian flyer VT (reference "Ofertas Imbatíveis").
(() => {
  const VT = window.VT;
  const produto = (c) => window.PRODUTOS.find((x) => x.id === c.produto) || {};
  const ddmm = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
  window.MOLDURA = {
    id: 'encarte', nome: 'Encarte',
    fontes: 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@700;900&display=block',
    css: `/* ground, fixed layer, name strip, photo box, burst, badge, closing — see the design */`,
    fixo: {
      html: (loja, campanha, marca) => `...logo (marca.logo via asset), data-k="selo" campaign, data-k="validade", data-k="legal"...`,
      frame(t, q) { /* entry in the first 0.5 s, then a breath */ },
    },
    tipos: {
      abertura: { html: () => `...`, frame(t, c, q, A, s) { /* crash-in */ }, sfx: (c, A, s) => [{ t: s.start + 0.1, s: 'whoosh' }, { t: s.start + 0.4, s: 'impact' }] },
      produto: {
        html: (c) => { const pr = produto(c); return `
          <div class="enc-nome" data-k="nome" data-papel="nome">${esc(pr.nome)}</div>
          <div class="enc-foto ${pr.fotoTipo === 'moldura' ? 'card' : ''}" data-k="foto"><img data-papel="produto" src="${asset(pr.foto)}"></div>
          ${VT.deHtml(pr, { classe: 'enc-de' })}
          <div class="enc-selo" data-k="selo" data-papel="selo">OFERTA</div>
          <div class="enc-burst" data-k="burst"></div>
          <div class="enc-badge" data-k="preco">${VT.precoHtml(pr, { classe: 'enc-preco' })}</div>`; },
        frame(t, c, q, A, s) {
          const pr = produto(c);
          const t0 = VT.momentoPreco(A, pr, s.start + 1.2);
          const k = VT.carimbo(t, t0);
          st(q('preco'), k.visivel ? 1 : 0, `scale(${k.scale}) rotate(${k.rotate}deg)`);
          // …photo entry (softLand), name strip, burst spin, selo pop…
          return { shake: k.shake * 0.6 };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'whoosh' }, { t: VT.momentoPreco(A, produto(c), s.start + 1.2), s: 'impact' }],
      },
      fechamento: { html: () => `...`, frame(t, c, q, A, s) {}, sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'whoosh' }, { t: s.start + 0.75, s: 'ding' }] },
    },
    transicao: VT.transicao.cortina('#E30613'),
  };
})();
```

The image itself carries `data-papel="produto"`, so its own box, with its own aspect ratio, is what gets measured. Size the img with `max-width:460px; max-height:440px` inside the 460×440 box, so a tall bottle reaches 440 tall and a wide pack reaches 460 wide. Both pass the ≥ 432 rule.

The player's helpers (`st`, `p`, `eo`, `lerp`, `back`, `esc`, `asset`) and `R`, `PRODUTOS` and `LOJA` are page globals, as the existing `cenas.js` files already use them.

- [ ] **Step 6: Update the existing test** `the vt-padrao template renders a small VT without page errors` in `tests/video-motor.test.js`. After copying the fixture, it must write `moldura: 'encarte'` into the copy's `roteiro.json`, because the template now needs a frame.

- [ ] **Step 7: Run them and look.**

Run: `node --test tests/video-motor-moldura-encarte.test.js tests/video-motor.test.js`
Expected: PASS

Then render stills of the fixture for a visual check: write a scratch script in your own temp folder that imports `fixtureVt` from `tests/helpers/vt-fixture.js` and calls `fixtureVt('encarte')` and `renderVideo({ videoDir, stills: [0.3, 1.0, 3.3, 4.5, 6.5] })`. **Open every still** and describe each one in one sentence in the report.
- Fix anything that looks broken: overlaps, text cut at an edge, empty areas, a price not inside x 24–460.
- The look must read as a professional flyer VT, not a slide.

- [ ] **Step 8: Report.** Do not commit. Include the one-sentence still descriptions and the still file paths.

---

### Task 5: Render check (`checar.mjs`)

**Files:**
- Create:
  - `src/video-motor/checar.mjs`
  - `tests/video-motor-checar.test.js`

**Depends-on:** Task 4

**Interfaces:**
- Consumes `window.CENAS`, `window.VT.momentoPreco` and `window.PRODUTOS` from the player (Task 4), and `serve` exported from `render.mjs` (Task 4).
- Produces `export async function checarVideo({ videoDir }) => Promise<{ ok: boolean, falhas: string[] }>`.
- CLI: `node src/video-motor/checar.mjs <dir>` prints `ok` (exit 0) or one failure per line (exit 1).
- **Failure messages** (Portuguese, prefixed `Cena N (<tipo>): `):
  - `produto pequeno (WxH px; precisa de 432 de altura ou de largura).`
  - `produto não está visível.`
  - `preço não está visível.`
  - `preço sai da área segura (x A–B, y C–D; precisa ficar em x 24–460, y 110–800).`
  - `preço pequeno (N px; mínimo 72).`
  - `texto girado demais (N°) em <papel>.`
  - The empty-frame failure has no scene prefix: `Tela vazia de Xs a Ys.`

- [ ] **Step 1: Write the failing tests** `tests/video-motor-checar.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checarVideo } from '../src/video-motor/checar.mjs';
import { fixtureVt } from './helpers/vt-fixture.js';

const limpar = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

test('the encarte VT padrão passes the check', async () => {
  const dir = await fixtureVt('encarte');
  try {
    const r = await checarVideo({ videoDir: dir });
    assert.deepEqual(r, { ok: true, falhas: [] });
  } finally { await limpar(dir); }
});

test('a small product and a price outside the safe area fail with both messages', async () => {
  const dir = await fixtureVt('encarte');
  try {
    // Same scenes, but the product is tiny and the price sits at x 480.
    await writeFile(join(dir, 'cenas.js'), `
      window.VIDEO = { estrelas: false, transicao: MOLDURA.transicao, tipos: { ...MOLDURA.tipos, produto: {
        html: (c) => { const pr = PRODUTOS[0]; return '<img data-papel="produto" src="' + asset(pr.foto) + '" style="position:absolute;left:200px;top:300px;width:80px;height:80px">'
          + '<div style="position:absolute;left:480px;top:600px;font:100px Anton">' + VT.precoHtml(pr) + '</div>'; },
        frame() {}, sfx: () => [] } } };`);
    const r = await checarVideo({ videoDir: dir });
    assert.equal(r.ok, false);
    assert.ok(r.falhas.some((f) => /Cena 2 \(produto\): produto pequeno/.test(f)), r.falhas.join('\n'));
    assert.ok(r.falhas.some((f) => /Cena 2 \(produto\): preço sai da área segura/.test(f)), r.falhas.join('\n'));
  } finally { await limpar(dir); }
});

test('a blank stretch longer than half a second fails as tela vazia', async () => {
  const dir = await fixtureVt('encarte');
  try {
    // No frame (so no fixed layer), and an opening that draws nothing on black for its whole line (~2 s).
    const roteiro = JSON.parse(await readFile(join(dir, 'roteiro.json'), 'utf8'));
    delete roteiro.moldura;
    await writeFile(join(dir, 'roteiro.json'), JSON.stringify(roteiro));
    await writeFile(join(dir, 'cenas.js'), `
      const texto = (s) => ({ html: () => '<div style="position:absolute;top:400px;width:540px;text-align:center;color:#fff;font:60px sans-serif">' + s + '</div>', frame() {}, sfx: () => [] });
      window.VIDEO = { estrelas: false, css: '#stage{background:#000}', tipos: { abertura: { html: () => '', frame() {}, sfx: () => [] }, produto: texto('produto'), fechamento: texto('fim') } };`);
    const r = await checarVideo({ videoDir: dir });
    assert.ok(r.falhas.some((f) => /^Tela vazia de 0\.00s/.test(f)), r.falhas.join('\n'));
  } finally { await limpar(dir); }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/video-motor-checar.test.js`
Expected: FAIL (`checar.mjs` does not exist)

- [ ] **Step 3: Write `src/video-motor/checar.mjs`**

```js
// Render check for Oferta videos (motionmaxxing's "a script measures, a fail is fixed"):
// seeks the player to each product's price moment and measures the page.
//   checarVideo({ videoDir }) -> { ok, falhas: [...] }
// CLI: node src/video-motor/checar.mjs <videoDir>
/* global process, console, window, document, getComputedStyle, DOMMatrix */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Jimp } from 'jimp';
import { serve } from './render.mjs';

const AREA = { x0: 24, x1: 460, y0: 110, y1: 800 };

// Runs in the page: measures one scene at time t (already seeked).
function medirCena(indice, AREA) {
  const s = window.CENAS[indice];
  const raiz = document.getElementById('stage').getBoundingClientRect();
  const opacidade = (el) => { let o = 1; for (let e = el; e && e.id !== 'stage'; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= Number(cs.opacity); } return o; };
  const escala = (el) => { let k = 1; for (let e = el; e && e.id !== 'stage'; e = e.parentElement) { const tr = getComputedStyle(e).transform; if (tr && tr !== 'none') { const m = new DOMMatrix(tr); k *= Math.hypot(m.a, m.b); } } return k; };
  const angulo = (el) => { let a = 0; for (let e = el; e && e.id !== 'stage'; e = e.parentElement) { const tr = getComputedStyle(e).transform; if (tr && tr !== 'none') { const m = new DOMMatrix(tr); a += Math.atan2(m.b, m.a) * 180 / Math.PI; } } return a; };
  const caixa = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - raiz.left, y: r.top - raiz.top, w: r.width, h: r.height }; };
  const nome = `Cena ${indice + 1} (${s.c.tipo})`;
  const falhas = [];
  const prod = s.el.querySelector('[data-papel="produto"]');
  if (!prod || opacidade(prod) < 0.9) falhas.push(`${nome}: produto não está visível.`);
  else { const b = caixa(prod); if (b.h < 432 && b.w < 432) falhas.push(`${nome}: produto pequeno (${Math.round(b.w)}x${Math.round(b.h)} px; precisa de 432 de altura ou de largura).`); }
  const preco = s.el.querySelector('[data-papel="preco"]');
  if (!preco || opacidade(preco) < 0.9) falhas.push(`${nome}: preço não está visível.`);
  else {
    const b = caixa(preco);
    if (b.x < AREA.x0 || b.x + b.w > AREA.x1 || b.y < AREA.y0 || b.y + b.h > AREA.y1) falhas.push(`${nome}: preço sai da área segura (x ${Math.round(b.x)}–${Math.round(b.x + b.w)}, y ${Math.round(b.y)}–${Math.round(b.y + b.h)}; precisa ficar em x 24–460, y 110–800).`);
    const reais = preco.querySelector('[data-papel="reais"]');
    const px = reais ? parseFloat(getComputedStyle(reais).fontSize) * escala(reais) : 0;
    if (px < 72) falhas.push(`${nome}: preço pequeno (${Math.round(px)} px; mínimo 72).`);
  }
  for (const el of s.el.querySelectorAll('[data-papel]')) {
    if (opacidade(el) < 0.5) continue;
    const a = Math.abs(((angulo(el) + 540) % 360) - 180);
    if (a > 25) falhas.push(`${nome}: texto girado demais (${Math.round(a)}°) em ${el.getAttribute('data-papel')}.`);
  }
  return falhas;
}

export async function checarVideo({ videoDir }) {
  videoDir = resolve(videoDir);
  const server = await serve(videoDir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
    let pageError = null;
    page.on('pageerror', (err) => { pageError = err; });
    await page.goto(`http://127.0.0.1:${server.address().port}/_motor/player.html`);
    const duracao = await page.evaluate(() => window.ready).catch((err) => { throw pageError || err; });
    const falhas = [];
    // Product scenes: 0.6 s after the price is said (75% into the scene if it never is).
    const alvos = await page.evaluate(() => window.CENAS.map((s, i) => {
      if (s.c.produto == null) return null;
      const pr = (window.PRODUTOS || []).find((x) => x.id === s.c.produto) || {};
      const fim = s.start + (s.end - s.start) * 0.75;
      const t0 = window.VT ? window.VT.momentoPreco(s.A, pr, null) : null;
      return { i, t: t0 == null ? fim : Math.min(t0 + 0.6, s.end - 0.05) };
    }).filter(Boolean));
    for (const { i, t } of alvos) {
      await page.evaluate((x) => window.seek(x), t);
      falhas.push(...await page.evaluate(medirCena, i, AREA));
    }
    // No empty frame (motionmaxxing G2): flat stills for more than 0.5 s in a row.
    let vazioDesde = null;
    for (let t = 0; t <= duracao; t += 0.25) {
      await page.evaluate((x) => window.seek(x), t);
      const im = await Jimp.read(await page.screenshot({ type: 'png' }));
      im.resize({ w: 135, h: 240 });
      let soma = 0, soma2 = 0; const n = 135 * 240;
      im.scan(0, 0, 135, 240, (x, y, idx) => { const l = 0.299 * im.bitmap.data[idx] + 0.587 * im.bitmap.data[idx + 1] + 0.114 * im.bitmap.data[idx + 2]; soma += l; soma2 += l * l; });
      const desvio = Math.sqrt(Math.max(0, soma2 / n - (soma / n) ** 2));
      if (desvio < 6) { if (vazioDesde == null) vazioDesde = t; }
      else { if (vazioDesde != null && t - vazioDesde > 0.5) falhas.push(`Tela vazia de ${vazioDesde.toFixed(2)}s a ${t.toFixed(2)}s.`); vazioDesde = null; }
    }
    if (vazioDesde != null && duracao - vazioDesde > 0.5) falhas.push(`Tela vazia de ${vazioDesde.toFixed(2)}s a ${duracao.toFixed(2)}s.`);
    if (pageError) throw pageError;
    return { ok: falhas.length === 0, falhas };
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, falhas } = await checarVideo({ videoDir: process.argv[2] });
  console.log(ok ? 'ok' : falhas.join('\n'));
  process.exit(ok ? 0 : 1);
}
```

Check the Jimp API against the version in `package.json`, which is Jimp 1.x: `Jimp.read(buffer)`, `image.resize({ w, h })`, `image.scan`. Adapt the calls if the installed version differs.

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/video-motor-checar.test.js`
Expected: PASS

If the encarte fixture fails the check, the frame breaks a rule. Report the failure list as a concern (status DONE_WITH_CONCERNS) instead of loosening the check.

- [ ] **Step 5: Report.** Do not commit.

---

### Task 6: Music bed in the final render

**Files:**
- Modify: `src/video-motor/render.mjs` (the audio mix only)
- Test: `tests/video-motor-trilha.test.js` (create)

**Depends-on:** Task 4. It needs the frame fixture, and `serve` is already exported by Task 4.

**Interfaces:**
- Consumes `roteiro.json` → `trilha` (a file name in `src/video-motor/trilhas/`).
- Behaviour:
  - The final render and `trecho` mix the track, looped from 0 (from `t0` for a trecho);
  - it is ducked by the voice;
  - it fades out over the last 1.2 s;
  - the bed sits at `volume=0.32` before ducking.
- A missing file logs `aviso: trilha <nome> não encontrada; vídeo sem música` and renders without it.

- [ ] **Step 1: Write the failing test** `tests/video-motor-trilha.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { renderVideo } from '../src/video-motor/render.mjs';
import { fixtureVt } from './helpers/vt-fixture.js';

const limpar = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim();
async function comVoz(dir) {
  await mkdir(join(dir, 'voz'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=8', '-ac', '1', join(dir, 'voz', 'narracao.mp3')]);
}
// Mean volume (dB) of the first second of the audio of a file.
const volume = (file) => Number(/mean_volume: (-?[\d.]+) dB/.exec(execFileSync('ffmpeg', ['-hide_banner', '-t', '1', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString() + '')?.[1]);

test('a trecho render with a trilha has audio and the expected length', async () => {
  const dir = await fixtureVt('encarte');
  try {
    await comVoz(dir);
    const r = await renderVideo({ videoDir: dir, trecho: [0, 1.5] });
    assert.equal(probe(r.out, 'stream=codec_type').split(/\s+/).includes('audio'), true);
    assert.ok(Math.abs(Number(probe(r.out, 'format=duration')) - 1.5) < 0.15);
  } finally { await limpar(dir); }
});

test('a missing trilha still renders', async () => {
  const dir = await fixtureVt('encarte');
  try {
    await comVoz(dir);
    const roteiro = JSON.parse(await readFile(join(dir, 'roteiro.json'), 'utf8'));
    await writeFile(join(dir, 'roteiro.json'), JSON.stringify({ ...roteiro, trilha: 'nao-existe.mp3' }));
    const r = await renderVideo({ videoDir: dir, trecho: [0, 1] });
    assert.ok(r.out);
  } finally { await limpar(dir); }
});
```

`volume` is a helper for your own manual check that the music is present but below the voice. It is not asserted, because loudness is not stable across ffmpeg builds. Delete it if unused.

- [ ] **Step 2: Run them.** The first test may already pass without music, since the voice gives an audio stream. That is fine: the behaviour test is the manual listening in Step 4. Make sure both pass after the change.

Run: `node --test tests/video-motor-trilha.test.js`

- [ ] **Step 3: Implement in `renderVideo` (final render branch).** Read the roteiro once:

```js
    const roteiro = JSON.parse(await readFile(join(videoDir, 'roteiro.json'), 'utf8'));
    const trilha = roteiro.trilha ? join(MOTOR_DIR, 'trilhas', roteiro.trilha) : null;
    const comTrilha = Boolean(trilha && existsSync(trilha));
    if (trilha && !comTrilha) console.warn(`aviso: trilha ${roteiro.trilha} não encontrada; vídeo sem música`);
```

Restructure the filter graph so that the voices and the effects mix into `[mix0]`, the voice alone also feeds the sidechain, and the music is ducked by it.
- The voice tracks are the first `voz.length` entries of `tracks` with `vol: 1`. Keep that order and tag each track with `tipo: 'voz' | 'sfx'`.
- When `comTrilha` is set, add the music as the last input, with `'-stream_loop', '-1', '-i', trilha` placed before it in the args.

```js
    const ivoz = tracks.map((tr, i) => (tr.tipo === 'voz' ? `[a${i}]` : null)).filter(Boolean);
    const isfx = tracks.map((tr, i) => (tr.tipo === 'sfx' ? `[a${i}]` : null)).filter(Boolean);
    const m = tracks.length + 1; // ffmpeg input index of the music (0 is the video pipe)
    const partes = [delays.join(';')];
    // Voices are split: one copy for the mix, one as the key that ducks the music.
    partes.push(`${ivoz.join('')}amix=inputs=${ivoz.length}:normalize=0,asplit=2[voz][chave]`);
    let finais = '[voz]';
    if (isfx.length) { partes.push(`${isfx.join('')}amix=inputs=${isfx.length}:normalize=0[sfx]`); finais += '[sfx]'; }
    if (comTrilha) {
      partes.push(`[${m}:a]atrim=start=${Math.max(0, t0)},asetpts=PTS-STARTPTS,atrim=0:${length},aformat=sample_rates=44100:channel_layouts=stereo,volume=0.32,afade=t=out:st=${Math.max(0, length - 1.2)}:d=1.2[musica]`);
      partes.push('[musica][chave]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[fundo]');
      finais += '[fundo]';
    } else partes.push('[chave]anullsink');
    const n = 1 + (isfx.length ? 1 : 0) + (comTrilha ? 1 : 0);
    const mix = `${partes.join(';')};${finais}amix=inputs=${n}:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
```

`duration=first` makes the voice stream decide the length, and `-t` still cuts the output. If there are no voice tracks, which cannot happen in a finished video but guard anyway, fall back to the old single `amix` of all tracks.

Add the music input to the ffmpeg args after the other inputs:

```js
      ...tracks.flatMap((tr) => ['-i', tr.file]), ...(comTrilha ? ['-stream_loop', '-1', '-i', trilha] : []),
```

- [ ] **Step 4: Run the tests and listen once**

Run: `node --test tests/video-motor-trilha.test.js tests/video-motor.test.js`
Expected: PASS

Then render a 6 s trecho of the fixture with voice and music into your temp folder, and check two things:
- `volume` on a stretch with voice compared with one without voice: the music should drop while the sine plays;
- that the file has audio.

Put the numbers in the report.

- [ ] **Step 5: Report.** Do not commit.

---

### Task 7: The Diagonal frame

**Files:**
- Create:
  - `src/video-motor/vt/molduras/diagonal/moldura.js`
  - `tests/video-motor-moldura-diagonal.test.js`

**Depends-on:** Task 5

**Interfaces:**
- Follows the `MOLDURA` contract and layout zones from Task 4 exactly.
- Consumes `window.VT` (Task 1) and `checarVideo` (Task 5).
- Reference: "Mês da Economia" and "Oferta do Dia".

**Design:**
- **Ground:** a diagonal split. The upper-left triangle is a deep brand red, `R.marca.cor` darkened about 35%, or #7A0A14 if there is none. The lower-right is yellow #FFC400. The split line runs from (540, 120) to (0, 760). There is a soft paper texture (repeating-linear-gradient noise at 4% opacity).
- **Fixed layer:**
  - the logo in a white rounded square at top-left;
  - the campaign seal top-right in a two-line Anton block, white on the red side with a yellow underline;
  - a validity strip as a red pill bottom-left;
  - the legal footer.
- **Product:**
  - the name in white Inter 900 on the red side, left-aligned at x 32, y 112–160;
  - the photo box centred on the split line, entering with softLand from the yellow side;
  - a `moldura` photo sits in a white card with a 10 px radius.
- **Price:** a red speech balloon (CSS rounded rect plus an SVG tail pointing to the product) with yellow Anton reais at **104 px**, entering with `VT.contagem` (count-up 0.5 s from `VT.momentoPreco`) while the balloon scales in with snapSettle from 0.6. The "de" line sits above it, white on red.
- **Opening:** the split line wipes in (the diagonal grows from a point with softLand), then the campaign seal slams in (crashIn).
- **Closing:** the split flips (yellow top, red bottom) to show the address and hours on yellow and the WhatsApp pill on red.
- **Transition:** `VT.transicao.cortina('#FFC400')` (a yellow panel in the brand diagonal).
- **sfx:** `whoosh` at scene start, `tick` while counting (3 ticks spread across the count), `impact` when the count lands.

- [ ] **Step 1: Write the failing test** `tests/video-motor-moldura-diagonal.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { renderVideo } from '../src/video-motor/render.mjs';
import { checarVideo } from '../src/video-motor/checar.mjs';
import { fixtureVt } from './helpers/vt-fixture.js';

test('the diagonal frame renders the VT padrão fixture and passes the check', async () => {
  const dir = await fixtureVt('diagonal');
  try {
    const r = await renderVideo({ videoDir: dir, stills: [0.05, 2, 4.5, 7] });
    assert.equal(r.stills.length, 4);
    assert.deepEqual(await checarVideo({ videoDir: dir }), { ok: true, falhas: [] });
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
```

- [ ] **Step 2: Run it and see it fail** (frame not found).

Run: `node --test tests/video-motor-moldura-diagonal.test.js`

- [ ] **Step 3: Write `moldura.js`** to the design, using the Task 4 skeleton shape: `id: 'diagonal'`, `nome: 'Diagonal'`, the price entrance through `VT.contagem` writing into the reais and centavos spans. When the count text changes, update the `.vt-reais` and `.vt-cent` text from `VT.precoPartes(VT.contagem(...))`, so the `data-papel` elements stay the same nodes.

- [ ] **Step 4: Run it, then render stills and look**, as in Task 4 Step 7. Describe every still in one sentence in the report.

- [ ] **Step 5: Report.** Do not commit.

---

### Task 8: The Neon Premium frame

**Files:**
- Create:
  - `src/video-motor/vt/molduras/neon/moldura.js`
  - `tests/video-motor-moldura-neon.test.js`

**Depends-on:** Task 5

**Interfaces:** the same as Task 7, with id `neon` and nome `Neon Premium`. Reference: "Esquadrão da Economia".

**Design:**
- **Ground:** near-black #0B0B0E with a hex or texture pattern (CSS repeating-conic-gradient at 5%) and a red radial glow behind the product zone. Seeded sparks: about 40 small gold and red particles rising, as a pure function of `t` (seeded positions, `y = (y0 − v·t) mod 960`).
- **Fixed layer:**
  - the logo top-left with a red neon ring;
  - the campaign seal top-centre in gold neon Anton (text-shadow layers), flickering once on entry (the player's `flick` helper);
  - a date pill top-right in red ("Até 19/10");
  - the legal footer and the payment strip "Aceitamos cartões" with simple CSS card shapes. No real brand logos.
- **Product:**
  - the name in white Inter 900 with a thin red underline;
  - the photo under a spotlight (a radial white glow behind it), entering with `whip` from the right with blur, using the kit `passada` shape inside the scene;
  - a `moldura` photo sits in a dark card with a red neon border.
- **Price:** white Anton reais at **112 px** with red neon edges (text-shadow 0 0 6px #fff, 0 0 18px #ff1f3d, 0 0 40px #ff1f3d), "R$" and centavos in gold, entering with `VT.carimbo` plus a red flash ring expanding behind it on landing.
- **Opening:** "ESQUADRÃO"-style big neon campaign text assembling with flick, red and gold.
- **Closing:**
  - "ANOTA AÍ!" in big gold neon;
  - the WhatsApp number in a large white pill with a phone icon (inline SVG);
  - a small map-pin icon (inline SVG) with the address;
  - the hours.
- **Transition:** `VT.transicao.passada`.
- **sfx:** `zap` at scene start, `impact` on the price landing, `ding` on "ANOTA AÍ".

- [ ] **Step 1: Write the failing test** `tests/video-motor-moldura-neon.test.js`. It is the same as Task 7's test, with `'neon'`.

- [ ] **Step 2: Run it and see it fail.**

Run: `node --test tests/video-motor-moldura-neon.test.js`

- [ ] **Step 3: Write `moldura.js`** to the design.

- [ ] **Step 4: Run it, render stills and look.** Describe every still in one sentence.

- [ ] **Step 5: Report.** Do not commit.

---

### Task 9: Jobs run the check after stage 2; rules and the production request

**Files:**
- Modify:
  - `src/content-central-video-jobs.js` (`createVideoJobs`, `etapaProducao`)
  - `src/video-motor/PEDIDO-producao.md`
  - `src/video-motor/REGRAS.md` (§ Oferta)
- Test: `tests/content-central-video-jobs.test.js`

**Depends-on:** Task 3, Task 5

**Interfaces:**
- Consumes `checarVideo({ videoDir }) => { ok, falhas }` (Task 5).
- `createVideoJobs({ …, checador })` gains an injectable `checador`. Its default is `async (opts) => (await import('./video-motor/checar.mjs')).checarVideo(opts)`.
- **For Oferta videos only**, after the stills render in `etapaProducao`:
  - **nova:** if the check fails, rerun the Claude runner **once** with `erroAnterior` set to `Conferência automática reprovou:\n` plus the failures. Re-apply the same post-runner steps (restore `produtos.json`, check `cenas.js` freshness against the retry's start time, re-force the roteiro, re-render the stills), then check again. If it still fails, throw `Error('A conferência automática reprovou a prévia:\n' + falhas.join('\n'))`.
  - **padrão:** if the check fails, throw the same error at once. There is no Claude to retry.
- Non-Oferta videos never run the check.

- [ ] **Step 1: Write the failing tests.** Add them to `tests/content-central-video-jobs.test.js`. Also add `checador: async () => ({ ok: true, falhas: [] })` to the two existing Oferta stage 2 tests ("VT padrão stage 2 never calls Claude…" and "Oferta nova stage 2: Claude cannot change produtos.json…"), so they never launch a browser.

```js
function producaoOferta(calls) {
  return async ({ prompt, cwd }) => {
    calls.push(prompt);
    if (/# Etapa 1/.test(prompt)) return ofertaRunner([], ['Fralda por {preco}!'])({ prompt, cwd });
    await writeFile(join(cwd, 'cenas.js'), '// cenas');
    await mkdir(join(cwd, 'voz'), { recursive: true });
    await writeFile(join(cwd, 'voz', 'tempos.json'), JSON.stringify({ cenas: [{ words: [{ w: 'a', t: 0.1, d: 0.2 }] }] }));
    return { text: 'ok' };
  };
}
async function ateProducao(dir, jobs, briefing = ofertaBriefing) {
  const video = await createVideo('king', briefing, dir);
  await jobs.enqueue('king', video.id, 'roteiro');
  await jobs.idle();
  await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
  await jobs.enqueue('king', video.id, 'producao');
  await jobs.idle();
  return readVideo('king', video.id, dir);
}

test('Oferta nova: a failed check reruns stage 2 once with the failures, then passes', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    let n = 0;
    const checador = async () => (n++ === 0 ? { ok: false, falhas: ['Cena 2 (p): produto pequeno (80x80 px; precisa de 432 de altura ou de largura).'] } : { ok: true, falhas: [] });
    const jobs = createVideoJobs({ targetDir: dir, runner: producaoOferta(calls), renderer: async () => ({}), checador });
    const v = await ateProducao(dir, jobs);
    assert.equal(v.status, STATUS.PREVIA_PRONTA);
    const etapa2 = calls.filter((p) => /# Etapa 2/.test(p));
    assert.equal(etapa2.length, 2);
    assert.match(etapa2[1], /Conferência automática reprovou:[\s\S]*produto pequeno/);
  });
});

test('Oferta nova: a check that fails twice ends in erro with the list', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const checador = async () => ({ ok: false, falhas: ['Cena 2 (p): preço pequeno (40 px; mínimo 72).'] });
    const jobs = createVideoJobs({ targetDir: dir, runner: producaoOferta([]), renderer: async () => ({}), checador });
    const v = await ateProducao(dir, jobs);
    assert.equal(v.status, STATUS.ERRO);
    assert.match(v.erro, /conferência automática reprovou a prévia[\s\S]*preço pequeno/i);
  });
});

test('VT padrão: a failed check is an error at once (no Claude in stage 2)', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const runner = async ({ prompt, cwd }) => {
      calls.push(prompt);
      await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'abertura', fala: 'Ofertas!', descricao: 'a' }, { tipo: 'produto', produto: 'fralda', fala: 'Fralda por {preco}!', descricao: 'b' }, { tipo: 'fechamento', fala: 'Chama no WhatsApp!', descricao: 'c' }] }));
      return { text: 'ok' };
    };
    const narrador = async (vdir) => { await mkdir(join(vdir, 'voz'), { recursive: true }); await writeFile(join(vdir, 'voz', 'tempos.json'), JSON.stringify({ cenas: [{ words: [{ w: 'Ofertas', t: 0.05, d: 0.3 }] }, { words: [{ w: 'Fralda', t: 1, d: 0.3 }] }, { words: [{ w: 'Chama', t: 3, d: 0.3 }] }] })); };
    const checador = async () => ({ ok: false, falhas: ['x'] });
    const jobs = createVideoJobs({ targetDir: dir, runner, narrador, renderer: async () => ({}), checador });
    const v = await ateProducao(dir, jobs, { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, criacao: 'padrao' } });
    assert.equal(v.status, STATUS.ERRO);
    assert.equal(calls.length, 1);
  });
});

test('non-Oferta videos never run the check', async () => {
  await withProject(async (dir) => {
    let chamadas = 0;
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner([]), renderer: async () => ({}), checador: async () => { chamadas += 1; return { ok: true, falhas: [] }; } });
    const video = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
    await jobs.enqueue('king', video.id, 'producao');
    await jobs.idle();
    assert.equal(chamadas, 0);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/content-central-video-jobs.test.js`

- [ ] **Step 3: Implement.** Restructure `etapaProducao`.
- Move the Claude branch (runner, `produtos.json` restore, `cenas.js` freshness), the roteiro re-force, the falas check and the stills render into one inner function: `produzir(erro, desde)` for nova, or `montar()` for padrão.
- Run the check after it:

```js
    if (oferta) {
      let r = await checador({ videoDir: dir });
      if (!r.ok && oferta.criacao !== 'padrao') {
        await produzir(`Conferência automática reprovou:\n${r.falhas.join('\n')}`, Date.now());
        r = await checador({ videoDir: dir });
      }
      if (!r.ok) throw new Error(`A conferência automática reprovou a prévia:\n${r.falhas.join('\n')}`);
    }
```

Keep the existing order and checks inside `produzir`: the runner, the `produtos.json` restore, the `cenas.js` fresh-since-`desde` check, the `legenda-post.txt` rebuild, the tempos check, the falas and re-force, and the stills render.
- For the retry, the tempos check uses the ajuste rule, which only requires tempos to exist, because the voice is not regenerated.

- [ ] **Step 4: Update the rules.** In `src/video-motor/PEDIDO-producao.md`, replace step 4 with:

```markdown
4. Confira: `node <MOTOR>/render.mjs . --stills 0.05,<vários instantes>` e olhe as imagens em `stills/`. Compare com as regras de qualidade 1 a 10. Numa **Oferta**, rode também `node <MOTOR>/checar.mjs .` e corrija o `cenas.js` até ele imprimir `ok` (ele mede o tamanho do produto, o preço na área segura e legível, texto girado e tela vazia). Cole a saída do `checar.mjs` no `NOTAS.md`: não escreva "conferido" sem o resultado. Se o pedido traz "Conferência automática reprovou", corrija exatamente aqueles itens.
```

In `src/video-motor/REGRAS.md` § Oferta:
- Replace the product-size bullet's "pelo menos 55% da altura do palco (≥ 520 px) ou 80% da largura" with "pelo menos 432 px de altura (45% do palco) ou 432 px de largura (80%) — a própria imagem do produto, marcada `data-papel=\"produto\"`".
- Add after the layout bullets:

```markdown
- **Moldura** (`roteiro.moldura`): o player carrega `vt/kit.js` (`window.VT`) e `vt/molduras/<id>/moldura.js` (`window.MOLDURA`) antes do `cenas.js` e desenha sozinho a camada fixa (logo, selo da campanha, validade, rodapé). Você não remove nem cobre essa camada. Pode reaproveitar `MOLDURA.tipos` e `MOLDURA.transicao` ou criar os seus tipos por cima, mas:
  - o preço é sempre `VT.precoHtml(produto)` (e o "de" `VT.deHtml(produto)`), entrando com `VT.carimbo` ou `VT.contagem` no `VT.momentoPreco(A, produto, …)`;
  - a imagem do produto leva `data-papel="produto"`; faixas de nome `data-papel="nome"`; selos com texto `data-papel="selo"`;
  - as curvas de movimento estão em `VT.ease` (medidas em filmes profissionais): chegada desacelera (`softLand`, `snapSettle`), saída acelera (`accelExit`), nada nasce do zero — chega de um tamanho maior e assenta.
  - Antes de entregar: `node <MOTOR>/checar.mjs .` tem que imprimir `ok`.
```

- [ ] **Step 5: Run the whole video suite**

Run: `node --test tests/content-central-video.test.js tests/content-central-video-jobs.test.js tests/content-central-video-server.test.js tests/content-central-video-produtos.test.js`
Expected: PASS

- [ ] **Step 6: Report.** Do not commit.

---

### Task 10: Form — frame tiles, pace, campaign seal; last-used default; samples

**Files:**
- Modify:
  - `content-central-app/src/api/client.ts` (types)
  - `content-central-app/src/pages/workspace/VideoAnimado.tsx`
  - `content-central-app/src/pages/workspace/VideoAnimado.module.css` (only if new classes are needed; reuse the caption tile classes)
  - `content-central-app/src/pages/workspace/VideoAnimado.test.tsx`
- Create:
  - `content-central-app/public/video-molduras/encarte.mp4`
  - `content-central-app/public/video-molduras/diagonal.mp4`
  - `content-central-app/public/video-molduras/neon.mp4`

**Depends-on:** Task 2, Task 4, Task 7, Task 8

**Interfaces:**
- **`VideoOfertaInput`** gains:
  - `moldura: "encarte" | "diagonal" | "neon" | "auto"`
  - `ritmo: "rapido" | "calmo"`
  - `campanha: string`
- `VideoOfertaSnapshot` gains the same fields.
- `VideoSummary` gains `moldura: string | null`.
- `NovoVideo` gets a new prop, `ultimaMoldura: VideoOfertaInput["moldura"] | null`. The parent computes it from `videos`: the newest summary with `objetivo === "oferta"` and a `moldura`.
- **App constants** (mirroring the server):
  - `MOLDURAS = [{ v: "encarte", nome: "Encarte" }, { v: "diagonal", nome: "Diagonal" }, { v: "neon", nome: "Neon Premium" }]` plus the auto tile `{ v: "auto", nome: "✨ A IA escolhe" }`;
  - `SEGUNDOS = { rapido: 3, calmo: 4 }`;
  - `limiteProdutos(duracao, ritmo)` with the formula from Global Constraints (auto → 12). It replaces `LIMITE_PRODUTOS`.

- [ ] **Step 1: Write the failing tests.** Add them to `VideoAnimado.test.tsx`, following the file's existing helpers (`abrirForm`, `stubApi`) and the way it already picks Oferta products:

```tsx
  it("Oferta shows the frame tiles, defaults to encarte, and posts frame, pace and campaign", async () => {
    // abrirForm with the products stub, pick Oferta and one product, as the existing Oferta tests do.
    // expect radio "Encarte" checked; click "Neon Premium"; click "Calmo (4 s)";
    // type "Mês da Economia" into the textbox named "Selo da campanha"; submit;
    // assert the POST body oferta has { moldura: "neon", ritmo: "calmo", campanha: "Mês da Economia" }.
  });

  it("the frame defaults to the last Oferta video's frame", async () => {
    // stub listVideos with [{ ..., objetivo: "oferta", moldura: "diagonal", criadoEm: newest }, { ..., objetivo: "oferta", moldura: "neon", criadoEm: older }]
    // open the form, pick Oferta: radio "Diagonal" is checked.
  });

  it("A IA escolhe posts auto", async () => { /* click "✨ A IA escolhe", submit, body oferta.moldura === "auto" */ });

  it("the pace changes the product limit text", async () => {
    // duration 30: "0 de 8" with Rápido; click Calmo: "0 de 6".
  });
```

Write these out fully in the file's style, using the real helpers. The comments above say exactly what each one asserts.

- [ ] **Step 2: Run them and see them fail**

Run: `cd content-central-app && npx vitest run src/pages/workspace/VideoAnimado.test.tsx`

- [ ] **Step 3: Implement.**
- Inside the Oferta `Secao`, after the Criação radiogroup, add three groups:
  - **a radiogroup "Moldura"** with tiles like the Legenda tiles: a muted looping `<video src="/video-molduras/<id>.mp4">` using the existing `mudo` ref trick, the name, and a short help. The auto tile has no video; it shows "✨" large and the help "A IA escolhe pela época e pelo assunto";
  - **a segmented "Ritmo"** with "Rápido (3 s)" and "Calmo (4 s)";
  - **a text input** labelled "Selo da campanha", with `maxLength={30}` and placeholder "Ofertas da Semana".
- State: `moldura` (initial `ultimaMoldura ?? "encarte"`), `ritmo` (`"rapido"`), `campanha` (`""`). The body sends `campanha: campanha.trim() || "Ofertas da Semana"`.
- `limite` uses `limiteProdutos(b.duracao, ritmo)`.
- The summary (`resumoCompleto`) gains the frame name and the pace name for Oferta.
- In the parent, pass `ultimaMoldura` computed from `videos`.
- In the review screen, where `video.briefing.oferta` is shown, add the frame name. Use `roteiro.moldura` when the briefing says `auto` and the roteiro exists; otherwise show "A IA escolhe".

- [ ] **Step 4: Render the three samples.** For each frame, use a scratch script in your temp folder:
1. Build the frame fixture with `fixtureVt(id)` from `tests/helpers/vt-fixture.js`.
2. Render stills every 1/15 s from 0 to the fixture's duration (`renderVideo({ videoDir, stills: [...] })`).
3. Assemble them with `ffmpeg -framerate 15 -i <stills pattern> -vf scale=360:640 -an -c:v libx264 -pix_fmt yuv420p -crf 28 -movflags +faststart content-central-app/public/video-molduras/<id>.mp4`. Name the stills with a zero-padded index (copy them into a numbered sequence) so ffmpeg's `%04d` pattern works.

Keep each file under about 400 KB, and look at one frame of each.

- [ ] **Step 5: Run the tests and build**

Run:
- `cd content-central-app && npx vitest run src/pages/workspace/VideoAnimado.test.tsx && npm run build`
- `node --test tests/content-central-video.test.js`

Expected: PASS and a successful build

- [ ] **Step 6: Report.** Do not commit. List the three sample sizes.

---

## After all tasks

**The controller:**
1. Runs `npm test` (the full root suite).
2. Runs a real E2E on bench 3399 with the operator: a Carvalho Oferta video for each frame in VT padrão (fast, no Claude in stage 2), then one Criação nova with "A IA escolhe".
3. Checks the music and voice balance by ear with the operator.
4. Updates the `king_neon_video_pipeline` memory.
