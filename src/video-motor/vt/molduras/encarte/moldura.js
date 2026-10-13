/* global window, R, asset, esc, st, p, lerp */
// Encarte: the classic yellow-and-red Brazilian flyer VT (reference "Ofertas Imbatíveis").
// Stage 540×960. Zones: fixed top band y 20–104, name strip 112–160, photo box 460×440 at
// y 165–605, "de" line ~612, price badge 640–790 (x 24–460), validity strip and legal
// footer 805–900. Every frame function is pure in t.
(() => {
  const VT = window.VT;
  const E = VT.ease;
  const produto = (c) => window.PRODUTOS.find((x) => x.id === c.produto) || {};
  const loja = () => window.LOJA || {};
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  // "2026-10-18" -> { dd: '18/10', dia: 'domingo', curto: 'dom' }; null without a date.
  const validade = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    const dia = DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
    return { dd: `${m[3]}/${m[2]}`, dia, curto: dia.slice(0, 3) };
  };
  const iniciais = (nome) => String(nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  // A 2n-point star as polygon points inside an ellipse; the spikes rotate with off.
  const estrela = (cx, cy, rx, ry, n, off, miolo) => Array.from({ length: n * 2 }, (_, k) => {
    const a = (Math.PI * k) / n + off, r = k % 2 ? miolo : 1;
    return `${(cx + rx * r * Math.cos(a)).toFixed(1)},${(cy + ry * r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

  // Ground shared by the three scenes: yellow, slowly turning red rays, absolute-t angle so cuts stay continuous.
  const fundo = '<div class="enc-fundo"><div class="enc-raios" data-k="raios"></div></div>';
  const raios = (t, q) => { q('raios').style.transform = `rotate(${(t * 6).toFixed(2)}deg)`; };
  const aparece = (t, a, b) => (t >= a ? Math.min(1, (t - a) / (b - a)) : 0);

  window.MOLDURA = {
    id: 'encarte', nome: 'Encarte',
    fontes: 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@700;900&display=block',
    css: `
      #stage { background: #FFC400; }
      #vignette { display:none; }
      .enc-fundo { position:absolute; inset:0; overflow:hidden; background: radial-gradient(ellipse at 50% 36%, #FFEC6B 0%, #FFD400 45%, #FFC000 100%); }
      .enc-raios { position:absolute; left:50%; top:36%; width:1700px; height:1700px; margin:-850px 0 0 -850px;
        background: repeating-conic-gradient(rgba(227,6,19,.55) 0 7.5deg, rgba(227,6,19,0) 7.5deg 15deg);
        -webkit-mask-image: radial-gradient(circle, transparent 12%, #000 38%); mask-image: radial-gradient(circle, transparent 12%, #000 38%); }
      .enc-banda { position:absolute; left:-40px; right:-40px; top:650px; height:150px; overflow:hidden; background: linear-gradient(#B00012, #7A000C); transform: rotate(-2deg); border-top: 6px solid #fff; box-shadow: 0 -4px 0 #000, 0 8px 0 rgba(0,0,0,.3); }
      .enc-marq { position:absolute; left:0; top:92px; white-space:nowrap; font:400 40px/1 Anton, sans-serif; letter-spacing:2px; color:#FFD400; opacity:.9; }
      .enc-marq i { display:inline-block; width:300px; font-style:normal; }
      .enc-t { font-family: Anton, sans-serif; text-transform: uppercase; line-height: .95; letter-spacing: 1px; }

      /* fixed layer */
      .enc-logo { position:absolute; left:24px; top:26px; width:76px; height:76px; border-radius:50%; background:#fff; border:4px solid #E30613; display:grid; place-items:center; box-shadow:0 6px 0 rgba(0,0,0,.3); overflow:hidden; font:400 30px/1 Anton, sans-serif; color:#E30613; }
      .enc-logo img { max-width:80%; max-height:80%; }
      .enc-selo-camp { position:absolute; right:24px; top:30px; max-width:340px; padding:10px 18px 8px; border-radius:14px; background:#E30613; border:3px solid #fff; color:#FFD400; font:400 30px/1 Anton, sans-serif; text-transform:uppercase; letter-spacing:1px; text-align:center; box-shadow:0 6px 0 rgba(0,0,0,.35); transform:rotate(-4deg); }
      .enc-selo-camp.longo { font-size:24px; }
      .enc-validade { position:absolute; left:0; right:0; top:808px; text-align:center; }
      .enc-validade span { display:inline-block; padding:8px 22px; border-radius:999px; background:#000; color:#FFD400; font:900 20px/1 Inter, sans-serif; text-transform:uppercase; letter-spacing:1px; }
      .enc-legal { position:absolute; left:24px; right:24px; top:856px; text-align:center; font:700 13px/1.35 Inter, sans-serif; color:#2a1600; text-shadow:0 1px 0 rgba(255,255,255,.45); }

      /* produto */
      .enc-nome { position:absolute; left:16px; right:16px; top:112px; height:48px; display:flex; align-items:center; justify-content:center; padding:0 14px; border-radius:8px; background:#000; color:#fff; font:900 28px/1.02 Inter, sans-serif; text-transform:uppercase; text-align:center; box-shadow:0 5px 0 #E30613; overflow:hidden; }
      .enc-nome.m { font-size:22px; } .enc-nome.s { font-size:17px; }
      .enc-foto { position:absolute; left:40px; top:165px; width:460px; height:440px; display:flex; align-items:center; justify-content:center; }
      .enc-foto img { display:block; max-width:460px; max-height:440px; min-height:440px; object-fit:contain; filter: drop-shadow(0 16px 14px rgba(0,0,0,.38)); }
      .enc-foto.card img { box-sizing:border-box; padding:8px; background:#fff; border:6px solid #E30613; border-radius:16px; filter:none; box-shadow:0 14px 26px rgba(0,0,0,.4); }
      .enc-dew { position:absolute; inset:0; }
      .enc-de { position:absolute; left:150px; right:50px; top:612px; text-align:center; font:900 26px/1 Inter, sans-serif; color:#1a0000; }
      .enc-de s { text-decoration-thickness:4px; text-decoration-color:#E30613; }
      .enc-selo { position:absolute; left:26px; top:603px; padding:6px 20px 4px; border-radius:50%; background:#E30613; border:3px solid #fff; color:#FFD400; font:400 25px/1 Anton, sans-serif; letter-spacing:1px; box-shadow:0 4px 0 rgba(0,0,0,.4); }
      .enc-burst { position:absolute; left:24px; top:626px; width:436px; height:176px; opacity:0; }
      .enc-burst svg { display:block; width:100%; height:100%; overflow:visible; filter: drop-shadow(0 6px 0 rgba(0,0,0,.35)); }
      .enc-badge { position:absolute; left:24px; top:640px; width:436px; height:150px; display:flex; align-items:center; justify-content:center; opacity:0; }
      .enc-preco { padding:2px 30px 4px; border-radius:30px; background:#FFD400; border:5px solid #fff; box-shadow:0 8px 0 rgba(0,0,0,.4); font:400 110px/1 Anton, sans-serif; color:#E30613; text-shadow:0 4px 0 rgba(0,0,0,.16); }
      .enc-preco.g { font-size:88px; } .enc-preco.gg { font-size:70px; }
      .enc-preco .vt-un { color:#1a0000; text-shadow:none; font-size:.19em; }

      /* abertura */
      .enc-ab-burst { position:absolute; left:2px; top:150px; width:480px; height:480px; }
      .enc-ab-burst svg { width:100%; height:100%; overflow:visible; filter: drop-shadow(0 10px 0 rgba(0,0,0,.35)); }
      .enc-ab-t { position:absolute; left:0; width:484px; text-align:center; font:400 118px/1 Anton, sans-serif; color:#fff; text-transform:uppercase; -webkit-text-stroke:7px #7A000C; paint-order:stroke fill; text-shadow:0 8px 0 rgba(0,0,0,.35); letter-spacing:1px; }
      .enc-ab-sub { position:absolute; left:0; width:484px; text-align:center; }
      .enc-ab-sub span { display:inline-block; padding:8px 26px 6px; border-radius:14px; background:#FFD400; border:4px solid #000; color:#000; font:400 52px/1 Anton, sans-serif; text-transform:uppercase; letter-spacing:1px; box-shadow:0 7px 0 rgba(0,0,0,.4); }
      .enc-ab-loja { position:absolute; left:16px; right:16px; top:690px; height:54px; display:flex; align-items:center; justify-content:center; border-radius:8px; background:#000; color:#fff; font:900 27px/1 Inter, sans-serif; text-transform:uppercase; box-shadow:0 5px 0 #E30613; }

      /* fechamento */
      .enc-fc-so { position:absolute; left:0; width:484px; text-align:center; }
      .enc-fc-so span { display:inline-block; padding:8px 28px 6px; border-radius:12px; background:#E30613; border:3px solid #fff; color:#fff; font:400 50px/1 Anton, sans-serif; text-transform:uppercase; letter-spacing:2px; box-shadow:0 6px 0 rgba(0,0,0,.35); }
      .enc-fc-dia { position:absolute; left:0; width:484px; text-align:center; font:400 118px/1 Anton, sans-serif; color:#000; text-transform:uppercase; text-shadow:0 5px 0 #fff, 0 0 0 #fff; }
      .enc-fc-data { position:absolute; left:0; width:484px; text-align:center; font:400 112px/1 Anton, sans-serif; color:#E30613; -webkit-text-stroke:8px #fff; paint-order:stroke fill; text-shadow:0 8px 0 rgba(0,0,0,.3); }
      .enc-fc-card { position:absolute; left:24px; width:436px; top:488px; padding:16px 14px; border-radius:18px; background:#fff; border:5px solid #E30613; text-align:center; font:900 25px/1.2 Inter, sans-serif; color:#111; box-shadow:0 8px 0 rgba(0,0,0,.3); }
      .enc-fc-card small { display:block; margin-top:6px; font:700 19px/1.2 Inter, sans-serif; color:#555; }
      .enc-fc-wa { position:absolute; left:24px; width:436px; top:662px; display:flex; align-items:center; justify-content:center; gap:10px; height:84px; border-radius:999px; background:#16A34A; border:5px solid #fff; color:#fff; font:900 29px/1 Inter, sans-serif; white-space:nowrap; box-shadow:0 8px 0 rgba(0,0,0,.35); }
    `,
    fixo: {
      html: (lojaDados, campanha, marca) => {
        const v = validade(lojaDados.validoAte);
        const texto = campanha || 'Ofertas';
        const logo = marca.logo ? `<img src="${asset(marca.logo)}">` : esc(iniciais(lojaDados.nome || marca.nome));
        const valido = v ? `Válido até ${v.curto}, ${v.dd}` : (lojaDados.validade ? `Válido até ${lojaDados.validade}` : '');
        return `
          <div class="enc-logo" data-k="logo">${logo}</div>
          <div class="enc-selo-camp ${texto.length > 18 ? 'longo' : ''}" data-k="selo">${esc(texto)}</div>
          ${valido ? `<div class="enc-validade" data-k="validade"><span>${esc(valido)}</span></div>` : ''}
          <div class="enc-legal" data-k="legal">${v ? `Ofertas válidas até ${v.dd} ou enquanto durarem os estoques.` : 'Ofertas válidas enquanto durarem os estoques.'}</div>`;
      },
      // Entry in the first 0.5 s, then it only breathes.
      frame(t, q) {
        const logo = q('logo'), selo = q('selo'), val = q('validade'), legal = q('legal');
        const kl = E.snapSettle(p(t, 0, 0.4));
        st(logo, aparece(t, 0, 0.1), `scale(${lerp(3.5, 1, kl) * (1 + Math.sin(t * 2.4) * 0.018)})`);
        const ks = E.whip(p(t, 0.05, 0.5));
        st(selo, 1, `translateX(${lerp(520, 0, ks)}px) rotate(${-4 + Math.sin(t * 2.1) * 0.8}deg)`);
        if (val) { const kv = E.softLand(p(t, 0.15, 0.55)); st(val, 1, `translateY(${lerp(90, 0, kv)}px) scale(${1 + Math.sin(t * 2.6) * 0.012})`); }
        st(legal, aparece(t, 0.3, 0.55));
      },
    },
    tipos: {
      abertura: {
        html: () => {
          const resto = String(R.campanha || '').replace(/^\s*ofertas?\b\s*/i, '').trim();
          const sub = resto || loja().nome || (R.marca && R.marca.nome) || '';
          return `${fundo}
            <div class="enc-ab-burst" data-k="burst"><svg viewBox="0 0 480 480"><polygon data-k="poly" fill="#E30613" stroke="#fff" stroke-width="6" stroke-linejoin="round"/></svg></div>
            <div class="enc-ab-t" data-k="tit" style="top:288px">Ofertas</div>
            <div class="enc-ab-sub" data-k="sub" style="top:424px"><span>${esc(sub)}</span></div>
            ${resto && loja().nome ? `<div class="enc-ab-loja" data-k="loja">${esc(loja().nome)}</div>` : ''}`;
        },
        frame(t, c, q, A, s) {
          raios(t, q);
          const kb = E.softLand(p(t, s.start, s.start + 0.45));
          st(q('burst'), 1, `scale(${lerp(1.8, 1, kb)}) rotate(${(t * 7).toFixed(2)}deg)`);
          q('poly').setAttribute('points', estrela(240, 240, 228, 228, 16, 0, 0.8));
          const kt = E.snapSettle(p(t, s.start + 0.1, s.start + 0.5));
          st(q('tit'), aparece(t, s.start + 0.1, s.start + 0.18), `scale(${lerp(3.5, 1, kt) * (1 + Math.sin(t * 4) * 0.012)}) rotate(${lerp(-8, -3, kt)}deg)`);
          const ksub = E.whip(p(t, s.start + 0.4, s.start + 0.8));
          st(q('sub'), 1, `translateX(${lerp(-560, 0, ksub)}px) rotate(-2deg)`);
          if (q('loja')) st(q('loja'), aparece(t, s.start + 0.6, s.start + 0.85), `translateY(${lerp(30, 0, E.softLand(p(t, s.start + 0.6, s.start + 1)))}px)`);
          return { flash: Math.max(0, 1 - Math.abs(t - (s.start + 0.2)) * 7) * 0.5 };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.1, s: 'whoosh' }, { t: s.start + 0.4, s: 'impact' }],
      },
      produto: {
        html: (c) => {
          const pr = produto(c);
          const nome = String(pr.nome || '');
          const reais = VT.precoPartes(pr.precoTela).reais;
          return `${fundo}<div class="enc-banda"><div class="enc-marq" data-k="marq">${'<i>OFERTA ★</i>'.repeat(8)}</div></div>
            <div class="enc-nome ${nome.length > 34 ? 's' : nome.length > 22 ? 'm' : ''}" data-k="nome" data-papel="nome">${esc(nome)}</div>
            <div class="enc-foto ${pr.fotoTipo === 'moldura' ? 'card' : ''}" data-k="foto"><img data-papel="produto" src="${asset(pr.foto)}"></div>
            <div class="enc-dew" data-k="de">${VT.deHtml(pr, { classe: 'enc-de' })}</div>
            <div class="enc-selo" data-k="selo" data-papel="selo">OFERTA</div>
            <div class="enc-burst" data-k="burst"><svg viewBox="0 0 436 176"><polygon data-k="poly" fill="#E30613" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg></div>
            <div class="enc-badge" data-k="preco">${VT.precoHtml(pr, { classe: `enc-preco ${reais.length > 5 ? 'gg' : reais.length > 3 ? 'g' : ''}` })}</div>`;
        },
        frame(t, c, q, A, s) {
          raios(t, q);
          const pr = produto(c);
          const t0 = VT.momentoPreco(A, pr, s.start + 1.2);
          const k = VT.carimbo(t, t0);
          st(q('preco'), k.visivel ? 1 : 0, `scale(${k.scale}) rotate(${k.rotate}deg)`);
          // The burst lands with the stamp, its spikes keep turning.
          const kb = E.snapSettle(p(t, t0, t0 + 0.45));
          st(q('burst'), k.visivel ? 1 : 0, `scale(${lerp(1.7, 1, kb)})`);
          q('poly').setAttribute('points', estrela(218, 88, 214, 80, 16, t * 0.6, 0.8));
          st(q('marq'), t < t0 ? 1 : 0, `translateX(${-((t * 110) % 300)}px)`);
          const kn = E.whip(p(t, s.start + 0.05, s.start + 0.4));
          st(q('nome'), 1, `translateX(${lerp(-560, 0, kn)}px)`);
          // The photo rises from below, then drifts 1 → 1.03 across the scene.
          const kf = E.softLand(p(t, s.start, s.start + 0.4));
          st(q('foto'), 1, `translateY(${lerp(560, 0, kf)}px) scale(${lerp(1, 1.03, p(t, s.start, s.end))})`);
          st(q('de'), aparece(t, s.start + 0.45, s.start + 0.7), `translateY(${lerp(24, 0, E.softLand(p(t, s.start + 0.45, s.start + 0.85)))}px)`);
          const ksl = E.snapSettle(p(t, s.start + 0.5, s.start + 0.9));
          st(q('selo'), aparece(t, s.start + 0.5, s.start + 0.6), `rotate(-10deg) scale(${lerp(2.5, 1, ksl)})`);
          return { shake: k.shake * 0.6 };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'whoosh' }, { t: VT.momentoPreco(A, produto(c), s.start + 1.2), s: 'impact' }],
      },
      fechamento: {
        html: () => {
          const l = loja();
          const v = validade(l.validoAte);
          const ate = v ? `<div class="enc-fc-so" data-k="so" style="top:128px"><span>Só até</span></div>
            <div class="enc-fc-dia" data-k="dia" style="top:196px">${esc(v.dia)}</div>
            <div class="enc-fc-data" data-k="data" style="top:318px">${esc(v.dd)}</div>`
            : `<div class="enc-fc-dia" data-k="dia" style="top:220px;font-size:96px">${esc(l.validade ? `Só até ${l.validade}` : 'Corre pra cá!')}</div>`;
          return `${fundo}${ate}
            <div class="enc-fc-card" data-k="end">${esc(l.endereco || '')}${l.horario ? `<small>${esc(l.horario)}</small>` : ''}</div>
            ${l.whatsapp ? `<div class="enc-fc-wa" data-k="wa"><span>WhatsApp</span><span>${esc(l.whatsapp)}</span></div>` : ''}`;
        },
        frame(t, c, q, A, s) {
          raios(t, q);
          if (q('so')) st(q('so'), 1, `translateX(${lerp(-560, 0, E.whip(p(t, s.start, s.start + 0.35)))}px) rotate(-3deg)`);
          const kd = E.snapSettle(p(t, s.start + 0.05, s.start + 0.45));
          st(q('dia'), aparece(t, s.start + 0.05, s.start + 0.12), `scale(${lerp(3.5, 1, kd)}) rotate(${lerp(-6, -2, kd)}deg)`);
          if (q('data')) st(q('data'), 1, `translateX(${lerp(560, 0, E.whip(p(t, s.start + 0.2, s.start + 0.55)))}px) rotate(-3deg)`);
          const ke = E.softLand(p(t, s.start + 0.4, s.start + 0.8));
          st(q('end'), aparece(t, s.start + 0.4, s.start + 0.55), `translateY(${lerp(120, 0, ke)}px)`);
          if (q('wa')) {
            const kw = E.snapSettle(p(t, s.start + 0.7, s.start + 1.1));
            const pulso = t > s.start + 1.1 ? 1 + Math.sin((t - s.start) * 6) * 0.035 : 1;
            st(q('wa'), aparece(t, s.start + 0.7, s.start + 0.78), `scale(${lerp(2.5, 1, kw) * pulso})`);
          }
        },
        sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'whoosh' }, { t: s.start + 0.75, s: 'ding' }],
      },
    },
    transicao: VT.transicao.cortina('#E30613'),
  };
})();
