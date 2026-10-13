/* global window, document */
// VT kit: shared pieces for every supermarket-VT frame (vt/molduras/*).
// Timing comes from the motionmaxxing skill's measured curves (references/motion.md):
// arrivals decelerate from oversize, exits accelerate, counters step per frame
// and land on the real value. Every function is pure in t, so seek(t) stays exact.
(() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const p = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
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
