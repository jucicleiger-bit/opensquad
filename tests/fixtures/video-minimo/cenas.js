// Minimal two-scene video used by the motor smoke test.
window.VIDEO = {
  estrelas: false,
  tipos: {
    um: {
      html: () => '<div class="abs" data-k="t" style="left:40px;top:300px;font:900 60px sans-serif;color:#fff">OLÁ</div>',
      frame(t, c, q, A) { q('t').style.opacity = t >= A('mundo') ? 1 : 0.5; },
      sfx: () => [],
    },
    dois: {
      html: () => '<div class="abs" data-k="t" style="left:40px;top:300px;font:900 60px sans-serif;color:#FFD100">CENA 2</div>',
      frame(t, c, q, A) { q('t').style.opacity = t >= A('cena') ? 1 : 0.5; },
      sfx: () => [],
    },
  },
};
