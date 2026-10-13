// VT padrão: the fixed supermarket VT. Reads window.PRODUTOS / window.LOJA
// (produtos.json) and R.marca (roteiro.json); every price on screen comes
// from the data, never from text. Scenes: abertura, produto × N, fechamento.
(() => {
  const cor = (R.marca && R.marca.cor) || '#E11D2E';
  const produto = (c) => window.PRODUTOS.find((p) => p.id === c.produto) || {};
  // The new price pops on its last mention (the "de" price is usually said first).
  const ultimaVez = (A, w, fallback) => {
    try { let n = 1; for (;;) { try { A(w, n + 1); n += 1; } catch { return A(w, n); } } } catch { return fallback; }
  };
  const primeira = (s) => String(s || '').split(' ')[0];

  window.VIDEO = {
    estrelas: false,
    fontes: 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@700;900&display=swap',
    // The stage is 540×960 CSS px (rendered at 2×). The caption band starts at
    // top 612px, so prices and the WhatsApp button stay above ~600px.
    css: `
      #stage { background: radial-gradient(circle at 50% 35%, ${cor} 0%, #120406 78%); }
      .vt-faixa { position:absolute; left:-30px; right:-30px; height:75px; background:#FFD100; transform:rotate(-6deg); box-shadow:0 6px 0 rgba(0,0,0,.25); }
      .vt-titulo { position:absolute; left:0; right:0; text-align:center; font:400 75px/0.95 Anton, sans-serif; color:#fff; text-transform:uppercase; text-shadow:0 5px 0 rgba(0,0,0,.35); }
      .vt-sub { position:absolute; left:0; right:0; text-align:center; font:900 27px Inter, sans-serif; color:#120406; text-transform:uppercase; }
      .vt-logo { position:absolute; left:50%; width:140px; height:140px; margin-left:-70px; border-radius:50%; background:#fff; display:grid; place-items:center; box-shadow:0 9px 20px rgba(0,0,0,.4); }
      .vt-logo img { max-width:78%; max-height:78%; }
      .vt-foto { position:absolute; left:50%; top:118px; width:380px; height:320px; margin-left:-190px; box-sizing:border-box; display:grid; place-items:center; }
      .vt-foto img { max-width:380px; max-height:320px; filter:drop-shadow(0 15px 20px rgba(0,0,0,.45)); }
      .vt-foto.moldura { background:#fff; border-radius:24px; padding:16px; box-shadow:0 15px 30px rgba(0,0,0,.45); }
      .vt-foto.moldura img { max-width:348px; max-height:288px; border-radius:12px; filter:none; }
      .vt-nome { position:absolute; left:30px; right:30px; top:34px; text-align:center; font:900 36px/1.05 Inter, sans-serif; color:#fff; text-transform:uppercase; text-shadow:0 3px 0 rgba(0,0,0,.35); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .vt-de { position:absolute; left:0; right:0; top:444px; text-align:center; font:900 28px Inter, sans-serif; color:#fff; opacity:.85; }
      .vt-de s { text-decoration-thickness:4px; text-decoration-color:#FFD100; }
      .vt-preco { position:absolute; left:50%; top:480px; transform-origin:50% 50%; padding:4px 24px; margin-left:-160px; width:320px; border-radius:18px; background:#FFD100; color:#120406; text-align:center; font:400 78px/1 Anton, sans-serif; box-shadow:0 8px 0 rgba(0,0,0,.3); }
      .vt-preco small { font:900 18px/1.1 Inter, sans-serif; display:block; margin-top:5px; }
      .vt-info { position:absolute; left:35px; right:35px; text-align:center; font:900 26px/1.25 Inter, sans-serif; color:#fff; }
      .vt-whats { position:absolute; left:50%; top:440px; margin-left:-210px; width:420px; box-sizing:border-box; padding:16px 10px; border-radius:999px; background:#25D366; color:#fff; text-align:center; white-space:nowrap; font:900 28px Inter, sans-serif; box-shadow:0 8px 0 rgba(0,0,0,.25); }
    `,
    tipos: {
      abertura: {
        html: () => `
          ${R.marca && R.marca.logo ? `<div class="vt-logo" data-k="logo" style="top:40px"><img src="${asset(R.marca.logo)}"></div>` : ''}
          <div class="vt-faixa" data-k="faixa" style="top:235px"></div>
          <div class="vt-sub" data-k="sub" style="top:257px">${esc((window.LOJA && window.LOJA.nome) || (R.marca && R.marca.nome) || '')}</div>
          <div class="vt-titulo" data-k="tit" style="top:350px">Ofertas<br>da semana</div>`,
        frame(t, c, q, A, s) {
          const k = p(t, s.start, s.start + 0.5);
          if (q('logo')) st(q('logo'), k, `scale(${back(k)})`);
          st(q('faixa'), 1, `rotate(-6deg) translateX(${lerp(-600, 0, eo(p(t, s.start + 0.1, s.start + 0.45)))}px)`);
          st(q('sub'), p(t, s.start + 0.3, s.start + 0.5));
          const kt = p(t, s.start + 0.35, s.start + 0.8);
          st(q('tit'), kt, `scale(${lerp(1.6, 1, eo(kt)) + Math.sin(t * 6) * 0.01})`);
          return { flash: Math.max(0, 1 - Math.abs(t - (s.start + 0.4)) * 6) * 0.5 };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.1, s: 'whoosh' }, { t: s.start + 0.4, s: 'impact' }],
      },
      produto: {
        html: (c) => {
          const pr = produto(c);
          return `
            <div class="vt-nome" data-k="nome" style="font-size:${String(pr.nome || '').length > 24 ? 28 : 36}px">${esc(pr.nome)}</div>
            <div class="vt-foto ${pr.fotoTipo === 'moldura' ? 'moldura' : ''}" data-k="foto"><img src="${asset(pr.foto)}"></div>
            ${pr.precoDeTela ? `<div class="vt-de" data-k="de">de <s>${esc(pr.precoDeTela)}</s> por</div>` : ''}
            <div class="vt-preco" data-k="preco">${esc(pr.precoTela)}${pr.unidade ? `<small>${esc(pr.unidade === 'un' ? 'a unidade' : pr.unidade === 'kg' ? 'o quilo' : pr.unidade)}</small>` : ''}</div>`;
        },
        frame(t, c, q, A, s) {
          const pr = produto(c);
          const kf = eo(p(t, s.start, s.start + 0.45));
          st(q('foto'), kf, `translateY(${lerp(250, 0, kf)}px) rotate(${lerp(-12, 0, kf)}deg) scale(${1 + Math.sin(t * 2.2) * 0.015})`);
          st(q('nome'), p(t, s.start + 0.1, s.start + 0.35), `translateY(${lerp(-20, 0, eo(p(t, s.start + 0.1, s.start + 0.35)))}px)`);
          const tPreco = ultimaVez(A, primeira(pr.precoFalado), s.start + 1.2);
          if (q('de')) st(q('de'), p(t, s.start + 0.5, s.start + 0.7));
          const kp = p(t, tPreco - 0.05, tPreco + 0.3);
          st(q('preco'), kp ? 1 : 0, `scale(${kp ? back(kp) * (1 + Math.sin(t * 7) * 0.02) : 0.2}) rotate(-3deg)`);
          return { shake: Math.max(0, 1 - Math.abs(t - tPreco) * 5) * 0.6 };
        },
        sfx: (c, A, s) => {
          const pr = produto(c);
          return [{ t: s.start + 0.05, s: 'whoosh' }, { t: ultimaVez(A, primeira(pr.precoFalado), s.start + 1.2), s: 'impact' }];
        },
      },
      fechamento: {
        html: () => {
          const l = window.LOJA || {};
          return `
            <div class="vt-titulo" data-k="tit" style="top:110px;font-size:60px">${l.validade ? 'Só até<br>' + esc(l.validade) : 'Corre pra cá!'}</div>
            <div class="vt-info" data-k="end" style="top:290px">${esc(l.endereco || '')}${l.horario ? `<br><span style="font-size:20px;opacity:.85">${esc(l.horario)}</span>` : ''}</div>
            ${l.whatsapp ? `<div class="vt-whats" data-k="wa">WhatsApp ${esc(l.whatsapp)}</div>` : ''}`;
        },
        frame(t, c, q, A, s) {
          const k = eo(p(t, s.start, s.start + 0.4));
          st(q('tit'), k, `scale(${lerp(0.6, 1, k)})`);
          st(q('end'), p(t, s.start + 0.4, s.start + 0.7));
          if (q('wa')) { const kw = p(t, s.start + 0.7, s.start + 1); st(q('wa'), kw, `scale(${kw ? back(kw) * (1 + Math.sin(t * 5) * 0.02) : 0.5})`); }
        },
        sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'whoosh' }, { t: s.start + 0.75, s: 'ding' }],
      },
    },
  };
})();
