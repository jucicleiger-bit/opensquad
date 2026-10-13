/* global window, R, asset, esc, st, p, lerp, flick */
// Neon Premium: black textured ground, red and gold neon, rising sparks, a stamped neon price
// (reference "Esquadrão da Economia"). Stage 540×960. Zones: fixed top band y 20–104, name 112–160,
// photo box 460×440 at y 165–605, "de" line ~616, price 640–790 (x 24–460), payment strip and
// legal footer 805–900. Every frame function is pure in t (sparks included: seeded, no Math.random).
(() => {
  const VT = window.VT;
  const E = VT.ease;
  const produto = (c) => window.PRODUTOS.find((x) => x.id === c.produto) || {};
  const loja = () => window.LOJA || {};
  const ddmm = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}` : ''; };
  const iniciais = (nome) => String(nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const aparece = (t, a, b) => (t >= a ? Math.min(1, (t - a) / (b - a)) : 0);

  // 40 sparks, seeded once (LCG): position at t = f(t) only, so any seek is exact.
  let semente = 20261013;
  const rnd = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  const FAISCAS = Array.from({ length: 40 }, () => ({
    x: rnd() * 540, y0: rnd() * 960, v: 22 + rnd() * 58, s: 2 + rnd() * 3.6, ouro: rnd() < 0.55,
    w: 1.5 + rnd() * 3, ph: rnd() * 6.28, dx: 6 + rnd() * 16,
  }));
  const faiscasHtml = FAISCAS.map((f) => {
    const cor = f.ouro ? '#FFC83D' : '#FF3B55';
    return `<i style="width:${f.s.toFixed(1)}px;height:${f.s.toFixed(1)}px;background:${cor};box-shadow:0 0 ${(f.s * 2.4).toFixed(1)}px ${cor}"></i>`;
  }).join('');
  const faiscas = (t, q) => {
    const filhos = q('faiscas').children;
    for (let i = 0; i < FAISCAS.length; i += 1) {
      const f = FAISCAS[i];
      const y = (((f.y0 - f.v * t) % 960) + 960) % 960;
      const borda = Math.min(1, y / 90, (960 - y) / 90);
      const pisca = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * f.w + f.ph));
      filhos[i].style.opacity = (borda * pisca).toFixed(3);
      filhos[i].style.transform = `translate(${(f.x + Math.sin(t * 0.8 + f.ph) * f.dx).toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  };

  // Ground shared by the three scenes; the red glow sits at gy (behind the product zone / the headline).
  const fundo = (gy) => `<div class="neo-fundo"><div class="neo-glow" data-k="glow" style="top:${gy}px"></div><div class="neo-hex"></div><div class="neo-faiscas" data-k="faiscas">${faiscasHtml}</div></div>`;
  const fundoFrame = (t, q) => { q('glow').style.opacity = (0.85 + 0.15 * Math.sin(t * 2.4)).toFixed(3); faiscas(t, q); };

  const HEX = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66v34M28 0v34L0 50v34l28 16 28-16V50L28 34' fill='none' stroke='rgba(255,255,255,0.07)' stroke-width='1.2'/%3E%3C/svg%3E\")";

  const FONE = '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="#fff" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
  const PIN = '<svg viewBox="0 0 24 24" width="34" height="34"><path fill="#FFC83D" d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>';

  // Campaign words as up to 3 poster lines; short connectors ("da", "de") join the next word.
  const linhasDe = (texto) => {
    const ps = String(texto || '').trim().split(/\s+/).filter(Boolean);
    const out = [];
    let pend = '';
    for (const w of ps) {
      if (w.length <= 3 && w !== ps[ps.length - 1]) { pend += `${w} `; continue; }
      out.push(pend + w); pend = '';
    }
    if (pend) out.push(pend.trim());
    while (out.length > 3) out.splice(out.length - 2, 2, `${out[out.length - 2]} ${out[out.length - 1]}`);
    return out.length ? out : ['Ofertas'];
  };

  window.MOLDURA = {
    id: 'neon', nome: 'Neon Premium',
    fontes: 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@700;900&display=block',
    css: `
      #stage { background: #0B0B0E; }
      .neo-fundo { position:absolute; inset:0; overflow:hidden; background: radial-gradient(ellipse at 50% 50%, #17121a 0%, #0B0B0E 70%); }
      .neo-glow { position:absolute; left:50%; width:760px; height:640px; margin:-320px 0 0 -380px; background: radial-gradient(ellipse at center, rgba(255,31,61,.52) 0%, rgba(214,18,48,.26) 38%, rgba(255,31,61,0) 70%); }
      .neo-hex { position:absolute; inset:0; background-image: ${HEX}; background-size:56px 100px; }
      .neo-faiscas { position:absolute; inset:0; }
      .neo-faiscas i { position:absolute; left:0; top:0; border-radius:50%; opacity:0; }
      .neo-t { font-family: Anton, sans-serif; text-transform: uppercase; }

      /* fixed layer */
      .neo-linha { position:absolute; left:24px; right:24px; height:2px; background:#ff1f3d; box-shadow:0 0 6px #ff1f3d, 0 0 16px #ff1f3d; }
      .neo-logo { position:absolute; left:24px; top:26px; width:76px; height:76px; box-sizing:border-box; border-radius:50%; background:#fff; border:3px solid #ff3b55; display:grid; place-items:center; overflow:hidden; font:400 30px/1 Anton, sans-serif; color:#d6122f; box-shadow:0 0 6px #ff1f3d, 0 0 18px #ff1f3d, inset 0 0 8px rgba(255,31,61,.55); }
      .neo-logo img { max-width:80%; max-height:80%; }
      .neo-selo { position:absolute; left:112px; right:150px; top:28px; height:72px; display:flex; align-items:center; justify-content:center; text-align:center; font:400 32px/1 Anton, sans-serif; text-transform:uppercase; letter-spacing:1.5px; color:#fff3c9; text-shadow:0 0 3px #fff, 0 0 10px #FFC400, 0 0 22px #FF9A00, 0 0 40px #FF9A00; }
      .neo-selo.m { font-size:26px; } .neo-selo.s { font-size:21px; letter-spacing:1px; }
      .neo-data { position:absolute; right:20px; top:44px; padding:8px 14px 7px; border-radius:999px; background:#d6122f; border:2px solid #ff6b80; color:#fff; font:900 15px/1 Inter, sans-serif; text-transform:uppercase; letter-spacing:.5px; white-space:nowrap; box-shadow:0 0 8px #ff1f3d, 0 0 20px rgba(255,31,61,.7); }
      .neo-pag { position:absolute; left:0; right:0; top:814px; display:flex; align-items:center; justify-content:center; gap:7px; font:700 13px/1 Inter, sans-serif; color:#c9c9d3; letter-spacing:.5px; text-transform:uppercase; }
      .neo-pag b { display:block; position:relative; width:34px; height:22px; border-radius:4px; box-shadow:0 0 6px rgba(255,255,255,.18); }
      .neo-pag b::before { content:''; position:absolute; left:0; right:0; top:4px; height:4px; background:rgba(0,0,0,.65); }
      .neo-pag b::after { content:''; position:absolute; left:4px; bottom:4px; width:8px; height:6px; border-radius:1px; background:rgba(255,230,160,.9); }
      .neo-pag b:nth-of-type(1) { background:linear-gradient(135deg,#d6122f,#7a0a14); }
      .neo-pag b:nth-of-type(2) { background:linear-gradient(135deg,#3c4a6b,#1b2236); }
      .neo-pag b:nth-of-type(3) { background:linear-gradient(135deg,#FFC83D,#b9770e); }
      .neo-pag b:nth-of-type(4) { background:linear-gradient(135deg,#8b8f9c,#41444f); }
      .neo-pag span { margin-right:6px; }
      .neo-legal { position:absolute; left:24px; right:24px; top:852px; text-align:center; font:700 13px/1.35 Inter, sans-serif; color:#9a9aa8; }

      /* produto */
      .neo-spot { position:absolute; left:20px; top:145px; width:500px; height:480px; background: radial-gradient(ellipse at center, rgba(255,255,255,.34) 0%, rgba(255,255,255,.12) 38%, rgba(255,255,255,0) 68%); }
      .neo-nome { position:absolute; left:16px; right:16px; top:112px; height:48px; display:flex; align-items:center; justify-content:center; padding:0 14px; box-sizing:border-box; color:#fff; font:900 28px/1.02 Inter, sans-serif; text-transform:uppercase; text-align:center; text-shadow:0 0 12px rgba(255,31,61,.55); }
      .neo-nome span { display:block; max-height:44px; overflow:hidden; }
      .neo-nome::after { content:''; position:absolute; left:20%; right:20%; bottom:2px; height:3px; border-radius:2px; background:#ff1f3d; box-shadow:0 0 6px #ff1f3d, 0 0 14px #ff1f3d; }
      .neo-nome.m { font-size:22px; } .neo-nome.s { font-size:17px; }
      .neo-foto { position:absolute; left:40px; top:165px; width:460px; height:440px; display:flex; align-items:center; justify-content:center; }
      .neo-foto img { display:block; max-width:460px; max-height:440px; min-height:440px; object-fit:contain; filter: drop-shadow(0 0 16px rgba(255,255,255,.22)) drop-shadow(0 14px 12px rgba(0,0,0,.65)); }
      .neo-foto.card img { box-sizing:border-box; padding:10px; background:#121217; border:3px solid #ff3b55; border-radius:14px; filter:none; box-shadow:0 0 8px #ff1f3d, 0 0 24px rgba(255,31,61,.65), inset 0 0 14px rgba(255,31,61,.25); }
      .neo-dew { position:absolute; inset:0; }
      .neo-de { position:absolute; left:24px; width:436px; top:616px; text-align:center; font:900 24px/1 Inter, sans-serif; color:#e9e9f0; }
      .neo-de s { text-decoration-thickness:3px; text-decoration-color:#ff1f3d; }
      .neo-anel { position:absolute; left:92px; top:645px; width:300px; height:140px; box-sizing:border-box; border-radius:50%; border:4px solid #ff3b55; box-shadow:0 0 10px #ff1f3d, 0 0 26px #ff1f3d, inset 0 0 14px rgba(255,31,61,.6); opacity:0; }
      .neo-badge { position:absolute; left:24px; top:640px; width:436px; height:150px; display:flex; align-items:center; justify-content:center; opacity:0; }
      .neo-preco { font:400 112px/1 Anton, sans-serif; color:#fff; letter-spacing:1px; text-shadow:0 0 6px #fff, 0 0 18px #ff1f3d, 0 0 40px #ff1f3d; }
      .neo-preco.g { font-size:96px; } .neo-preco.gg { font-size:78px; }
      .neo-preco .vt-moeda, .neo-preco .vt-cent { color:#FFC83D; text-shadow:0 0 5px rgba(255,236,170,.9), 0 0 16px #ff1f3d; }
      .neo-preco .vt-cc { max-width:150px; }
      .neo-preco .vt-un { color:#f3f3f8; text-shadow:none; font-size:.19em; white-space:normal; overflow-wrap:anywhere; letter-spacing:.5px; }

      /* abertura */
      .neo-ab-l { position:absolute; left:0; width:540px; text-align:center; font-family:Anton, sans-serif; text-transform:uppercase; line-height:1; white-space:nowrap; }
      .neo-ab-l.v { color:#ffe3e8; text-shadow:0 0 4px #fff, 0 0 12px #ff1f3d, 0 0 28px #ff1f3d, 0 0 56px #ff1f3d; }
      .neo-ab-l.o { color:#fff3c9; text-shadow:0 0 4px #fff, 0 0 12px #FFC400, 0 0 28px #FF9A00, 0 0 56px #FF9A00; }
      .neo-ab-loja { position:absolute; left:0; width:540px; top:690px; text-align:center; }
      .neo-ab-loja span { display:inline-block; box-sizing:border-box; max-width:480px; padding:10px 24px; border-radius:999px; border:3px solid #ff3b55; background:rgba(214,18,48,.14); color:#fff; font:900 24px/1 Inter, sans-serif; text-transform:uppercase; letter-spacing:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-shadow:0 0 8px #ff1f3d, 0 0 22px rgba(255,31,61,.6), inset 0 0 10px rgba(255,31,61,.3); }

      /* fechamento */
      .neo-fc-t { position:absolute; left:0; width:540px; top:176px; text-align:center; font:400 124px/1 Anton, sans-serif; text-transform:uppercase; white-space:nowrap; color:#fff3c9; text-shadow:0 0 4px #fff, 0 0 12px #FFC400, 0 0 28px #FF9A00, 0 0 56px #FF9A00; }
      .neo-fc-sub { position:absolute; left:0; width:540px; top:332px; text-align:center; font:900 20px/1 Inter, sans-serif; letter-spacing:4px; text-transform:uppercase; color:#ffe3e8; text-shadow:0 0 10px #ff1f3d; }
      .neo-fc-wa { position:absolute; left:30px; right:30px; top:378px; height:100px; box-sizing:border-box; padding:0 18px 0 14px; display:flex; align-items:center; justify-content:center; gap:16px; border-radius:999px; background:#fff; color:#111; font:900 40px/1 Inter, sans-serif; white-space:nowrap; box-shadow:0 0 8px #ff1f3d, 0 0 28px rgba(255,31,61,.75), 0 0 60px rgba(255,31,61,.4); }
      .neo-fc-wa.m { font-size:33px; }
      .neo-fc-wa i { display:grid; place-items:center; flex:none; width:68px; height:68px; border-radius:50%; background:#d6122f; box-shadow:0 0 12px rgba(255,31,61,.8); }
      .neo-fc-info { position:absolute; left:30px; right:30px; top:540px; display:flex; flex-direction:column; align-items:center; gap:30px; }
      .neo-fc-end { display:flex; align-items:center; gap:12px; max-width:470px; color:#fff; font:700 24px/1.2 Inter, sans-serif; text-align:left; }
      .neo-fc-end svg { flex:none; filter: drop-shadow(0 0 6px #FFC400); }
      .neo-fc-hor { padding:10px 22px; border-radius:999px; border:2px solid #FFC83D; color:#fff3c9; font:900 21px/1.15 Inter, sans-serif; text-align:center; text-shadow:0 0 8px rgba(255,154,0,.8); box-shadow:0 0 8px rgba(255,200,61,.55), inset 0 0 8px rgba(255,200,61,.2); }
    `,
    fixo: {
      html: (lojaDados, campanha, marca) => {
        const texto = campanha || 'Ofertas';
        const logo = marca.logo ? `<img src="${asset(marca.logo)}">` : esc(iniciais(lojaDados.nome || marca.nome));
        const dd = ddmm(lojaDados.validoAte);
        const ate = dd ? `Até ${dd}` : (lojaDados.validade ? String(lojaDados.validade).slice(0, 18) : '');
        return `
          <div class="neo-linha" data-k="l1" style="top:108px"></div>
          <div class="neo-linha" data-k="l2" style="top:803px"></div>
          <div class="neo-logo" data-k="logo">${logo}</div>
          <div class="neo-selo ${texto.length > 24 ? 's' : texto.length > 14 ? 'm' : ''}" data-k="selo"><span>${esc(texto)}</span></div>
          ${ate ? `<div class="neo-data" data-k="data">${esc(ate)}</div>` : ''}
          <div class="neo-pag" data-k="pag"><span>Aceitamos cartões</span><b></b><b></b><b></b><b></b></div>
          <div class="neo-legal" data-k="legal">${dd ? `Ofertas válidas até ${dd} ou enquanto durarem os estoques.` : 'Ofertas válidas enquanto durarem os estoques.'}</div>`;
      },
      // Entry in the first 0.6 s (the seal flickers on), then it only breathes.
      frame(t, q) {
        const e = (k) => q(k);
        for (const k of ['l1', 'l2']) st(e(k), aparece(t, 0.05, 0.2), `scaleX(${E.softLand(Math.min(1, Math.max(0, (t - 0.05) / 0.55)))})`);
        const kl = E.snapSettle(p(t, 0, 0.4));
        st(e('logo'), aparece(t, 0, 0.1), `scale(${lerp(3.5, 1, kl) * (1 + Math.sin(t * 2.4) * 0.018)})`);
        st(e('selo'), flick(t, 0.15) * (0.94 + 0.06 * Math.sin(t * 5)), 'none');
        if (e('data')) st(e('data'), 1, `translateX(${lerp(260, 0, E.whip(p(t, 0.1, 0.5)))}px) scale(${1 + Math.sin(t * 2.6) * 0.015})`);
        st(e('pag'), aparece(t, 0.3, 0.55));
        st(e('legal'), aparece(t, 0.35, 0.6));
      },
    },
    tipos: {
      abertura: {
        html: () => {
          const linhas = linhasDe(R.campanha);
          const fs = linhas.map((l) => Math.min(150, Math.floor(480 / (l.length * 0.47))));
          const alto = fs.reduce((a, b) => a + b * 1.02, 0);
          let y = 400 - alto / 2;
          const blocos = linhas.map((l, i) => { const h = `<div class="neo-ab-l ${i % 2 ? 'o' : 'v'}" data-k="l${i}" style="top:${y.toFixed(0)}px;font-size:${fs[i]}px">${esc(l)}</div>`; y += fs[i] * 1.02; return h; }).join('');
          const nome = loja().nome || (R.marca && R.marca.nome) || '';
          return `${fundo(400)}${blocos}${nome ? `<div class="neo-ab-loja" data-k="loja"><span>${esc(nome)}</span></div>` : ''}`;
        },
        frame(t, c, q, A, s) {
          fundoFrame(t, q);
          const n = linhasDe(R.campanha).length;
          let flash = 0;
          for (let i = 0; i < n; i += 1) {
            const a = s.start + 0.12 + i * 0.22;
            const k = E.snapSettle(p(t, a, a + 0.4));
            st(q(`l${i}`), flick(t, a) * (0.95 + 0.05 * Math.sin(t * 7 + i)), `scale(${lerp(1.35, 1, k)})`);
            flash = Math.max(flash, Math.max(0, 1 - Math.abs(t - (a + 0.05)) * 9) * 0.1);
          }
          if (q('loja')) st(q('loja'), aparece(t, s.start + 0.75, s.start + 0.9), `translateY(${lerp(30, 0, E.softLand(p(t, s.start + 0.75, s.start + 1.15)))}px)`);
          return { flash };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.1, s: 'zap' }, { t: s.start + 0.45, s: 'zap' }],
      },
      produto: {
        html: (c) => {
          const pr = produto(c);
          const nome = String(pr.nome || '');
          const reais = VT.precoPartes(pr.precoTela).reais;
          return `${fundo(385)}<div class="neo-spot" data-k="spot"></div>
            <div class="neo-nome ${nome.length > 34 ? 's' : nome.length > 22 ? 'm' : ''}" data-k="nome" data-papel="nome"><span>${esc(nome)}</span></div>
            <div class="neo-foto ${pr.fotoTipo === 'moldura' ? 'card' : ''}" data-k="foto"><img data-papel="produto" src="${asset(pr.foto)}"></div>
            <div class="neo-dew" data-k="de">${VT.deHtml(pr, { classe: 'neo-de' })}</div>
            <div class="neo-anel" data-k="anel"></div>
            <div class="neo-badge" data-k="preco">${VT.precoHtml(pr, { classe: `neo-preco ${reais.length > 5 ? 'gg' : reais.length > 3 ? 'g' : ''}` })}</div>`;
        },
        frame(t, c, q, A, s) {
          fundoFrame(t, q);
          const pr = produto(c);
          const t0 = VT.momentoPreco(A, pr, s.start + 1.2);
          const k = VT.carimbo(t, t0);
          st(q('preco'), k.visivel ? 1 : 0, `scale(${k.scale}) rotate(${k.rotate}deg)`);
          // The red flash ring expands behind the price as it lands.
          const kr = p(t, t0 + 0.08, t0 + 0.6);
          st(q('anel'), kr > 0 && kr < 1 ? (1 - kr) * 0.9 : 0, `scale(${lerp(0.7, 1.9, E.softLand(kr))})`);
          st(q('spot'), 0.9 + 0.1 * Math.sin(t * 2.2), 'none');
          st(q('nome'), aparece(t, s.start + 0.05, s.start + 0.2), `translateY(${lerp(-24, 0, E.softLand(p(t, s.start + 0.05, s.start + 0.45)))}px)`);
          // The photo whips in from the right with blur (the kit's passada shape), then drifts 1 → 1.02.
          const kf = E.whip(p(t, s.start + 0.02, s.start + 0.5));
          st(q('foto'), 1, `translateX(${((1 - kf) * 620).toFixed(1)}px) scale(${lerp(1, 1.02, p(t, s.start, s.end)).toFixed(4)})`, { filter: kf < 1 ? `blur(${((1 - kf) * 18).toFixed(1)}px)` : 'none' });
          st(q('de'), aparece(t, s.start + 0.45, s.start + 0.7), `translateY(${lerp(24, 0, E.softLand(p(t, s.start + 0.45, s.start + 0.85)))}px)`);
          return { shake: k.shake * 0.6 };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'zap' }, { t: VT.momentoPreco(A, produto(c), s.start + 1.2), s: 'impact' }],
      },
      fechamento: {
        html: () => {
          const l = loja();
          const wa = String(l.whatsapp || '');
          return `${fundo(470)}
            <div class="neo-fc-t" data-k="t">Anota aí!</div>
            ${wa ? `<div class="neo-fc-sub" data-k="sub">Chama no WhatsApp</div>
            <div class="neo-fc-wa ${wa.length > 13 ? 'm' : ''}" data-k="wa"><i>${FONE}</i><span>${esc(wa)}</span></div>` : ''}
            <div class="neo-fc-info" data-k="info">
              ${l.endereco ? `<div class="neo-fc-end" data-k="end">${PIN}<span>${esc(l.endereco)}</span></div>` : ''}
              ${l.horario ? `<div class="neo-fc-hor" data-k="hor">${esc(l.horario)}</div>` : ''}
            </div>`;
        },
        frame(t, c, q, A, s) {
          fundoFrame(t, q);
          const kt = E.crashIn(p(t, s.start + 0.1, s.start + 0.6));
          st(q('t'), flick(t, s.start + 0.1) * (0.95 + 0.05 * Math.sin(t * 6)), `scale(${lerp(2.6, 1, kt)})`);
          if (q('sub')) st(q('sub'), aparece(t, s.start + 0.5, s.start + 0.65), 'none');
          if (q('wa')) {
            const kw = E.snapSettle(p(t, s.start + 0.65, s.start + 1.05));
            const pulso = t > s.start + 1.05 ? 1 + Math.sin((t - s.start) * 6) * 0.025 : 1;
            st(q('wa'), aparece(t, s.start + 0.65, s.start + 0.73), `scale(${lerp(2.2, 1, kw) * pulso})`);
          }
          if (q('end')) st(q('end'), aparece(t, s.start + 0.85, s.start + 1), `translateY(${lerp(40, 0, E.softLand(p(t, s.start + 0.85, s.start + 1.25)))}px)`);
          if (q('hor')) st(q('hor'), aparece(t, s.start + 1, s.start + 1.15), `translateY(${lerp(40, 0, E.softLand(p(t, s.start + 1, s.start + 1.4)))}px)`);
          return { flash: Math.max(0, 1 - Math.abs(t - (s.start + 0.18)) * 8) * 0.25 };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'zap' }, { t: s.start + 0.45, s: 'ding' }],
      },
    },
    transicao: VT.transicao.passada,
  };
})();
