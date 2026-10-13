/* global window, R, asset, esc, st, p, lerp */
// Diagonal: deep-brand-red / yellow diagonal-split VT (references "Mês da Economia" and
// "Oferta do Dia"). Stage 540×960. Zones: fixed top band y 20–104, name 112–160, photo box
// 460×440 at y 165–605, "de" pill ~616, price balloon 656–790 (x 24–460), validity pill and
// legal bar 808–912. The split runs (540,120)→(0,760); the closing flips it (yellow top, red
// bottom). Every frame function is pure in t.
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
  const aparece = (t, a, b) => (t >= a ? Math.min(1, (t - a) / (b - a)) : 0);

  // Brand colors: the vivid brand red, and it darkened ~35% for the red ground.
  const HEX = /^#([\da-f]{6})$/i;
  const escurece = (hex, k) => {
    const n = parseInt(HEX.exec(hex)[1], 16);
    return `#${[n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('')}`;
  };
  const cores = (marca) => {
    const cor = marca && HEX.test(marca.cor || '') ? marca.cor : null;
    return `--vm:${cor ? escurece(cor, 0.65) : '#7A0A14'};--vm2:${cor ? escurece(cor, 0.4) : '#4A0610'};--vv:${cor || '#E30613'}`;
  };
  const raiz = (marca, dentro) => `<div class="dg" style="${cores(marca)}">${dentro}</div>`;

  // Text broken into at most max lines; words of up to 3 letters ride with the next word.
  const linhas = (txt, max) => {
    const out = []; let pend = '';
    for (const w of String(txt || '').trim().split(/\s+/).filter(Boolean)) {
      pend = pend ? `${pend} ${w}` : w;
      if (w.length > 3) { out.push(pend); pend = ''; }
    }
    if (pend) { if (out.length) out[out.length - 1] += ` ${pend}`; else out.push(pend); }
    while (out.length > max) out.splice(max - 1, 2, `${out[max - 1]} ${out[max]}`);
    return out;
  };

  // The ground. mode 'a': red top-left, yellow bottom-right; mode 'b' (closing): flipped.
  // k (0..1) grows the split line from its first point.
  const LIN = { a: [[540, 120], [0, 760]], b: [[0, 350], [540, 770]] };
  const OFF = { a: [11, 9], b: [9, -11] };
  const chao = (q, modo, k) => {
    const [[x1, y1], [x2, y2]] = LIN[modo];
    const xk = lerp(x1, x2, k), yk = lerp(y1, y2, k);
    const pts = modo === 'a' ? [[0, 0], [540, 0], [x1, y1], [xk, yk]] : [[0, y1], [xk, yk], [540, 960], [0, 960]];
    q('verm').style.clipPath = `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
    const set = (el, a, b, c, d) => { el.setAttribute('x1', a); el.setAttribute('y1', b); el.setAttribute('x2', c); el.setAttribute('y2', d); };
    set(q('lin'), x1, y1, xk.toFixed(1), yk.toFixed(1));
    set(q('lin2'), x1 + OFF[modo][0], y1 + OFF[modo][1], (xk + OFF[modo][0]).toFixed(1), (yk + OFF[modo][1]).toFixed(1));
  };
  const fundo = () => `<div class="dg-amarelo"><div class="dg-pontos"></div></div>
    <div class="dg-sombra"><div class="dg-verm" data-k="verm"></div></div>
    <svg class="dg-linhas" viewBox="0 0 540 960"><line data-k="lin2" stroke="var(--vm2)" stroke-width="4" stroke-linecap="round"/><line data-k="lin" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>
    <div class="dg-papel"></div>`;

  window.MOLDURA = {
    id: 'diagonal', nome: 'Diagonal',
    fontes: 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@700;900&display=block',
    css: `
      #stage { background: #FFC400; }
      #vignette { display:none; }
      .dg { position:absolute; inset:0; }
      .dg-amarelo { position:absolute; inset:0; background: radial-gradient(ellipse at 78% 82%, #FFD84A 0%, #FFC400 55%, #F2AE00 100%); }
      .dg-pontos { position:absolute; inset:0; background: radial-gradient(circle, rgba(214,140,0,.5) 2.2px, transparent 2.8px) 0 0 / 16px 16px;
        -webkit-mask-image: linear-gradient(135deg, transparent 38%, #000 90%); mask-image: linear-gradient(135deg, transparent 38%, #000 90%); }
      .dg-sombra { position:absolute; inset:0; filter: drop-shadow(7px 9px 0 rgba(90,40,0,.22)); }
      .dg-verm { position:absolute; inset:0; background: radial-gradient(ellipse at 22% 18%, var(--vv) -60%, var(--vm) 60%, var(--vm2) 130%); }
      .dg-linhas { position:absolute; inset:0; width:540px; height:960px; }
      .dg-papel { position:absolute; inset:0; pointer-events:none;
        background: repeating-linear-gradient(0deg, rgba(0,0,0,.04) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0,0,0,.04) 0 1px, transparent 1px 5px); }
      .dg-an { font-family: Anton, sans-serif; text-transform: uppercase; }

      /* fixed layer */
      .dg-logo { position:absolute; left:24px; top:24px; width:76px; height:76px; border-radius:16px; background:#fff; display:grid; place-items:center; box-shadow:0 6px 0 rgba(0,0,0,.3); overflow:hidden; font:400 30px/1 Anton, sans-serif; color:var(--vm); }
      .dg-logo img { max-width:82%; max-height:82%; }
      .dg-selo { position:absolute; right:22px; top:26px; max-width:330px; padding:7px 16px 11px; border-radius:6px; background:var(--vm2); border:3px solid #fff; color:#fff; font:400 28px/1.02 Anton, sans-serif; text-transform:uppercase; letter-spacing:1px; text-align:center; box-shadow:0 6px 0 rgba(0,0,0,.35); }
      .dg-selo.longo { font-size:22px; }
      .dg-selo i { display:block; font-style:normal; }
      .dg-selo b { position:absolute; left:14px; right:14px; bottom:5px; height:5px; border-radius:3px; background:#FFC400; }
      .dg-valid { position:absolute; left:24px; top:810px; padding:9px 20px 8px; border-radius:999px; background:var(--vv); border:3px solid #fff; color:#fff; font:900 17px/1 Inter, sans-serif; text-transform:uppercase; letter-spacing:.5px; box-shadow:0 5px 0 rgba(0,0,0,.35); }
      .dg-legal { position:absolute; left:0; right:0; top:868px; height:44px; padding:0 24px; display:flex; align-items:center; justify-content:center; background:rgba(26,0,6,.86); color:#fff; font:700 13px/1.3 Inter, sans-serif; text-align:center; }

      /* produto */
      .dg-nome { position:absolute; left:16px; top:112px; max-width:482px; min-height:48px; display:flex; align-items:center; padding-left:10px; border-left:6px solid #FFC400; color:#fff; font:900 34px/1 Inter, sans-serif; text-transform:uppercase; text-shadow:0 3px 0 rgba(0,0,0,.35); }
      .dg-nome.m { font-size:28px; } .dg-nome.s { font-size:23px; } .dg-nome.xs { font-size:19px; line-height:1.02; }
      .dg-halo { position:absolute; left:20px; top:175px; width:500px; height:420px; border-radius:50%; background: radial-gradient(circle, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 68%); }
      .dg-foto { position:absolute; left:40px; top:165px; width:460px; height:440px; display:flex; align-items:center; justify-content:center; }
      .dg-foto img { display:block; max-width:460px; max-height:440px; min-height:440px; object-fit:contain; filter: drop-shadow(0 16px 14px rgba(0,0,0,.4)); }
      .dg-foto.card img { box-sizing:border-box; padding:8px; background:#fff; border-radius:10px; filter:none; box-shadow:0 14px 26px rgba(0,0,0,.42); }
      .dg-dew { position:absolute; inset:0; }
      .dg-de { position:absolute; left:34px; top:616px; padding:7px 16px 6px; border-radius:999px; background:var(--vm2); border:3px solid #fff; color:#fff; font:900 20px/1 Inter, sans-serif; box-shadow:0 4px 0 rgba(0,0,0,.35); }
      .dg-de s { text-decoration-thickness:3px; text-decoration-color:#FFC400; }
      .dg-balao { position:absolute; left:24px; top:656px; width:436px; height:134px; display:flex; align-items:center; justify-content:center; box-sizing:border-box; border-radius:34px; background:var(--vv); border:5px solid #fff; box-shadow:0 8px 0 var(--vm2); opacity:0; }
      .dg-cauda { position:absolute; right:84px; top:-36px; width:62px; height:42px; overflow:visible; }
      .dg-preco { font:400 104px/1 Anton, sans-serif; color:#FFC400; text-shadow:0 5px 0 rgba(0,0,0,.28); }
      .dg-preco.g { font-size:88px; } .dg-preco.gg { font-size:76px; }
      .dg-preco .vt-moeda { color:#fff; text-shadow:none; }
      .dg-preco .vt-un { color:#fff; text-shadow:none; font-size:.17em; max-width:96px; white-space:normal; }

      /* abertura */
      .dg-ab-t { position:absolute; left:30px; width:500px; font-family:Anton, sans-serif; color:#fff; text-transform:uppercase; line-height:.95; letter-spacing:1px; -webkit-text-stroke:8px var(--vm2); paint-order:stroke fill; text-shadow:0 9px 0 rgba(0,0,0,.3); white-space:nowrap; }
      .dg-ab-loja { position:absolute; left:26px; top:566px; max-width:330px; padding:10px 22px 8px; border-radius:8px; background:#fff; color:var(--vm); font:400 38px/1 Anton, sans-serif; text-transform:uppercase; letter-spacing:1px; box-shadow:0 7px 0 var(--vm2); }
      .dg-ab-selo { position:absolute; left:340px; top:548px; width:176px; height:176px; border-radius:50%; background:var(--vv); border:6px solid #fff; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; font:400 34px/1.02 Anton, sans-serif; text-transform:uppercase; text-align:center; box-shadow:0 8px 0 var(--vm2); }
      .dg-ab-selo small { font:900 15px/1 Inter, sans-serif; letter-spacing:1px; color:#FFC400; margin-bottom:4px; }

      /* fechamento */
      .dg-fc-so { position:absolute; left:26px; top:128px; padding:8px 22px 6px; border-radius:8px; background:var(--vv); border:3px solid #fff; color:#fff; font:400 44px/1 Anton, sans-serif; text-transform:uppercase; letter-spacing:2px; box-shadow:0 6px 0 var(--vm2); }
      .dg-fc-dia { position:absolute; left:26px; right:20px; top:190px; font:400 124px/1 Anton, sans-serif; color:var(--vm); text-transform:uppercase; text-shadow:0 6px 0 #fff; white-space:nowrap; }
      .dg-fc-data { position:absolute; left:26px; right:20px; top:318px; font:400 116px/1 Anton, sans-serif; color:var(--vv); -webkit-text-stroke:8px #fff; paint-order:stroke fill; text-shadow:0 8px 0 rgba(0,0,0,.25); white-space:nowrap; }
      .dg-fc-card { position:absolute; left:24px; width:436px; top:470px; box-sizing:border-box; padding:16px 18px; border-radius:10px; background:#fff; border-left:10px solid var(--vv); color:#1a0006; font:900 25px/1.2 Inter, sans-serif; box-shadow:0 8px 0 rgba(0,0,0,.3); }
      .dg-fc-card small { display:block; margin-top:6px; font:700 19px/1.2 Inter, sans-serif; color:#5a4a4d; }
      .dg-fc-wa { position:absolute; left:24px; width:436px; top:702px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; gap:10px; height:76px; border-radius:999px; background:#16A34A; border:5px solid #fff; color:#fff; font:900 28px/1 Inter, sans-serif; white-space:nowrap; box-shadow:0 7px 0 rgba(0,0,0,.35); }
      .dg-fc-ig { position:absolute; right:24px; top:816px; color:#fff; font:400 26px/1 Anton, sans-serif; letter-spacing:1px; }
    `,
    fixo: {
      html: (lojaDados, campanha, marca) => {
        const v = validade(lojaDados.validoAte);
        const ls = linhas(campanha || 'Ofertas', 2);
        const logo = marca.logo ? `<img src="${asset(marca.logo)}">` : esc(iniciais(lojaDados.nome || marca.nome));
        const valido = v ? `Válido até ${v.curto}, ${v.dd}` : (lojaDados.validade ? `Válido até ${lojaDados.validade}` : '');
        return raiz(marca, `
          <div class="dg-logo" data-k="logo">${logo}</div>
          <div class="dg-selo ${Math.max(...ls.map((l) => l.length)) > 12 ? 'longo' : ''}" data-k="selo">${ls.map((l) => `<i>${esc(l)}</i>`).join('')}<b></b></div>
          ${valido ? `<div class="dg-valid" data-k="validade">${esc(valido)}</div>` : ''}
          <div class="dg-legal" data-k="legal">${v ? `Ofertas válidas até ${v.dd} ou enquanto durarem os estoques.` : 'Ofertas válidas enquanto durarem os estoques.'}</div>`);
      },
      // Entry in the first second (the seal slams in after the logo), then it only breathes.
      frame(t, q) {
        const kl = E.snapSettle(p(t, 0, 0.4));
        st(q('logo'), aparece(t, 0, 0.1), `scale(${lerp(3, 1, kl) * (1 + Math.sin(t * 2.4) * 0.015)})`);
        const ks = E.crashIn(p(t, 0.45, 0.95));
        st(q('selo'), t >= 0.45 ? 1 : 0, `scale(${lerp(2.6, 1, ks)}) rotate(${lerp(-10, -3, ks) + Math.sin(t * 2.1) * 0.6}deg)`);
        if (q('validade')) st(q('validade'), 1, `translateX(${lerp(-320, 0, E.softLand(p(t, 0.2, 0.7)))}px) scale(${1 + Math.sin(t * 2.6) * 0.012})`);
        st(q('legal'), 1, `translateY(${lerp(60, 0, E.softLand(p(t, 0.3, 0.8)))}px)`);
      },
    },
    tipos: {
      abertura: {
        html: () => {
          const m = R.marca || {};
          const ls = linhas(R.campanha || 'Ofertas', 3);
          const mx = Math.max(...ls.map((l) => l.length));
          const fs = mx <= 7 ? 132 : mx <= 9 ? 112 : mx <= 11 ? 94 : mx <= 13 ? 78 : 62;
          const nome = loja().nome || m.nome || '';
          return raiz(m, `${fundo()}
            ${ls.map((l, n) => `<div class="dg-ab-t" data-k="t${n}" style="top:${150 + n * fs * 0.98}px;font-size:${fs}px">${esc(l)}</div>`).join('')}
            ${nome ? `<div class="dg-ab-loja" data-k="loja">${esc(nome)}</div>` : ''}
            <div class="dg-ab-selo" data-k="sel"><small>CONFIRA</small>agora</div>`);
        },
        frame(t, c, q, A, s) {
          const kd = E.softLand(p(t, s.start, s.start + 0.8));
          chao(q, 'a', kd);
          for (let n = 0; q(`t${n}`); n += 1) {
            const k = E.snapSettle(p(t, s.start + 0.35 + n * 0.14, s.start + 0.8 + n * 0.14));
            st(q(`t${n}`), aparece(t, s.start + 0.35 + n * 0.14, s.start + 0.42 + n * 0.14), `translateX(${lerp(-60, 0, k)}px) scale(${lerp(2.6, 1, k)}) rotate(-5deg)`);
          }
          if (q('loja')) st(q('loja'), 1, `translateX(${lerp(-600, 0, E.whip(p(t, s.start + 0.9, s.start + 1.3)))}px) rotate(-3deg)`);
          const ke = E.snapSettle(p(t, s.start + 1.1, s.start + 1.5));
          st(q('sel'), aparece(t, s.start + 1.1, s.start + 1.18), `scale(${lerp(2.4, 1, ke)}) rotate(${lerp(-24, -10, ke) + Math.sin(t * 3) * 1.5}deg)`);
          return { flash: Math.max(0, 1 - Math.abs(t - (s.start + 0.5)) * 7) * 0.4 };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.1, s: 'whoosh' }, { t: s.start + 0.5, s: 'impact' }, { t: s.start + 1.15, s: 'pop' }],
      },
      produto: {
        html: (c) => {
          const pr = produto(c);
          const nome = String(pr.nome || '');
          const reais = VT.precoPartes(pr.precoTela).reais;
          return raiz(R.marca, `${fundo()}
            <div class="dg-halo"></div>
            <div class="dg-nome ${nome.length > 28 ? 'xs' : nome.length > 22 ? 's' : nome.length > 16 ? 'm' : ''}" data-k="nome" data-papel="nome">${esc(nome)}</div>
            <div class="dg-foto ${pr.fotoTipo === 'moldura' ? 'card' : ''}" data-k="foto"><img data-papel="produto" src="${asset(pr.foto)}"></div>
            <div class="dg-dew" data-k="de">${VT.deHtml(pr, { classe: 'dg-de' })}</div>
            <div class="dg-balao" data-k="preco"><svg class="dg-cauda" viewBox="0 0 62 42"><polyline points="4.4,39 22,3 55.4,39" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><polygon points="4.4,39 22,3 55.4,39 55.4,47 4.4,47" style="fill:var(--vv)"/></svg>${VT.precoHtml(pr, { classe: `dg-preco ${reais.length > 6 ? 'gg' : reais.length > 5 ? 'g' : ''}` })}</div>`);
        },
        frame(t, c, q, A, s) {
          chao(q, 'a', 1);
          const pr = produto(c);
          const t0 = VT.momentoPreco(A, pr, s.start + 1.2);
          // The price counts up for 0.5 s into the same .vt-reais / .vt-cent nodes, then lands.
          const partes = VT.precoPartes(VT.contagem(t, t0, pr.precoTela, 0.5) || pr.precoTela);
          const reais = q('preco').querySelector('.vt-reais'), cent = q('preco').querySelector('.vt-cent');
          if (reais.textContent !== partes.reais) reais.textContent = partes.reais;
          if (cent && cent.textContent !== `,${partes.centavos}`) cent.textContent = `,${partes.centavos}`;
          const kp = E.snapSettle(p(t, t0, t0 + 0.4));
          const respira = t > t0 + 0.5 ? 1 + Math.sin((t - t0) * 5) * 0.012 : 1;
          st(q('preco'), t >= t0 ? 1 : 0, `scale(${lerp(0.6, 1, kp) * respira}) rotate(-2deg)`);
          // The photo comes in from the yellow side, then drifts 1 → 1.03 across the scene.
          const kf = E.softLand(p(t, s.start, s.start + 0.5));
          st(q('foto'), aparece(t, s.start, s.start + 0.06), `translate(${lerp(300, 0, kf)}px, ${lerp(340, 0, kf)}px) rotate(${lerp(6, 0, kf)}deg) scale(${lerp(1, 1.03, p(t, s.start, s.end))})`);
          st(q('nome'), 1, `translateX(${lerp(-560, 0, E.whip(p(t, s.start + 0.05, s.start + 0.4)))}px)`);
          st(q('de'), aparece(t, s.start + 0.45, s.start + 0.65), `translateY(${lerp(24, 0, E.softLand(p(t, s.start + 0.45, s.start + 0.85)))}px) rotate(-2deg)`);
          return { shake: VT.carimbo(t, t0 + 0.5).shake * 0.5 };
        },
        sfx: (c, A, s) => {
          const t0 = VT.momentoPreco(A, produto(c), s.start + 1.2);
          return [{ t: s.start + 0.05, s: 'whoosh' }, { t: t0 + 0.1, s: 'tick' }, { t: t0 + 0.25, s: 'tick' }, { t: t0 + 0.4, s: 'tick' }, { t: t0 + 0.5, s: 'impact' }];
        },
      },
      fechamento: {
        html: () => {
          const l = loja(), m = R.marca || {};
          const v = validade(l.validoAte);
          const ate = v ? `<div class="dg-fc-so" data-k="so">Só até</div>
            <div class="dg-fc-dia" data-k="dia">${esc(v.dia)}</div>
            <div class="dg-fc-data" data-k="data">${esc(v.dd)}</div>`
            : `<div class="dg-fc-dia" data-k="dia" style="top:230px;font-size:96px">${esc(l.validade ? `Só até ${l.validade}` : 'Corre pra cá!')}</div>`;
          return raiz(m, `${fundo()}${ate}
            <div class="dg-fc-card" data-k="end">${esc(l.endereco || '')}${l.horario ? `<small>${esc(l.horario)}</small>` : ''}</div>
            ${l.whatsapp ? `<div class="dg-fc-wa" data-k="wa"><span>WhatsApp</span><span>${esc(l.whatsapp)}</span></div>` : ''}
            ${m.instagram ? `<div class="dg-fc-ig">${esc(m.instagram)}</div>` : ''}`);
        },
        frame(t, c, q, A, s) {
          chao(q, 'b', E.softLand(p(t, s.start, s.start + 0.6)));
          if (q('so')) st(q('so'), 1, `translateX(${lerp(-560, 0, E.whip(p(t, s.start + 0.1, s.start + 0.45)))}px) rotate(-3deg)`);
          const kd = E.snapSettle(p(t, s.start + 0.15, s.start + 0.55));
          st(q('dia'), aparece(t, s.start + 0.15, s.start + 0.22), `scale(${lerp(3, 1, kd)}) rotate(${lerp(-6, -2, kd)}deg)`);
          if (q('data')) st(q('data'), 1, `translateX(${lerp(600, 0, E.whip(p(t, s.start + 0.3, s.start + 0.65)))}px) rotate(-2deg)`);
          st(q('end'), aparece(t, s.start + 0.5, s.start + 0.65), `translateY(${lerp(120, 0, E.softLand(p(t, s.start + 0.5, s.start + 0.9)))}px)`);
          if (q('wa')) {
            const kw = E.snapSettle(p(t, s.start + 0.7, s.start + 1.1));
            const pulso = t > s.start + 1.1 ? 1 + Math.sin((t - s.start) * 6) * 0.035 : 1;
            st(q('wa'), aparece(t, s.start + 0.7, s.start + 0.78), `scale(${lerp(2.5, 1, kw) * pulso})`);
          }
        },
        sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'whoosh' }, { t: s.start + 0.75, s: 'ding' }],
      },
    },
    transicao: VT.transicao.cortina('#FFC400'),
  };
})();
