// "O que colocar na bio" — scenes written for this video only.
// Editorial, magazine-like: white paper, serif headlines, numbered yellow
// badges. A real client (Mercado Carvalho) profile is the worked example.
// Uses the motor's helpers (st, p, eo, eio, back, lerp, esc, asset, R, S).

const Y = '#FFD100';
const ink = (t, a, b) => eio(p(t, a, b));
const foto = (n) => asset(`fotos/${n}`);

// Paper swap: the new page slides in from the right, slightly turned.
function transicao(t, s, next, i) {
  const tin = i ? eio(p(t, s.start - 0.2, s.start + 0.25)) : 1;
  const tout = next ? eio(p(t, s.end - 0.2, s.end + 0.25)) : 0;
  const x = 600 * (1 - tin) - 600 * tout, r = 5 * (1 - tin) - 5 * tout;
  st(s.el, 1, `translateX(${x}px) rotate(${r}deg)`, { display: tin > 0 && tout < 1 ? 'block' : 'none', filter: 'none', zIndex: i, background: '#FBFAF7', boxShadow: '0 0 40px #0003' });
}

// Caption in black; the spoken word turns serif italic with a yellow underline.
function legenda(t, chunk, el, k) {
  el.innerHTML = chunk.map((w) => (t >= w.t - 0.03 && t < w.t + w.d ? `<span class="sp">${esc(w.w)}</span>` : esc(w.w))).join(' ');
  el.style.opacity = k;
}

const BIO = [
  ['🛒 Mercado de bairro: hortifrúti, açougue e mercearia', 'O QUE VENDE'],
  ['🏠 Pra sua casa e a sua família', 'PRA QUEM'],
  ['📍 Pedra 90 e região · Cuiabá', 'ONDE'],
  ['⭐ Tudo em uma compra só, pertinho de você', 'POR QUE VOCÊ'],
  ['📲 Peça pelo WhatsApp 👇 wa.me/mercadocarvalho', 'CONTATO'],
];

// The client's profile card; the bio lines are switched on by the scenes.
const perfil = (bad) => `
  <div class="abs prof" data-k="prof">
    <div style="display:flex;align-items:center;gap:16px">
      <img src="${foto('carvalho-logo.png')}" style="width:86px;height:86px;border-radius:50%;object-fit:contain;background:#fff;border:3px solid #eee">
      <div class="ws" style="display:flex;gap:18px;font-size:14px;color:#111;text-align:center"><div><b style="display:inline-block;width:34px;height:12px;background:#eee;border-radius:6px"></b><br>posts</div><div><b style="display:inline-block;width:34px;height:12px;background:#eee;border-radius:6px"></b><br>seguidores</div><div><b style="display:inline-block;width:34px;height:12px;background:#eee;border-radius:6px"></b><br>seguindo</div></div>
    </div>
    <div class="ws" style="margin-top:12px;font-weight:700;font-size:17px;color:#111">Mercado Carvalho</div>
    ${bad ? '<div class="ws" style="font-size:17px;color:#111;margin-top:4px">Bem-vindos à nossa loja 🙏</div>'
    : BIO.map(([l], i) => `<div class="ws bl" data-k="l${i}" style="font-size:16px;color:#111;margin-top:5px;position:relative">${l}</div>`).join('')}
  </div>`;

window.VIDEO = {
  estrelas: false,
  fontes: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Work+Sans:wght@500;700&display=block',
  transicao,
  legenda,
  css: `
    #stage { background: #E9E6DF !important; }
    #vignette { display: none; }
    #cap { top: 800px !important; font: 700 30px 'Work Sans', sans-serif !important; font-style: normal !important; color: #111 !important; text-shadow: none !important; }
    .sp { font-family: 'DM Serif Display', serif; font-style: italic; font-weight: 400; font-size: 36px; box-shadow: inset 0 -6px 0 ${Y}; }
    .se { font-family: 'DM Serif Display', serif; color: #111; line-height: 1.02; letter-spacing: -.5px; }
    .ws { font-family: 'Work Sans', sans-serif; font-weight: 500; }
    .prof { left: 24px; width: 384px; top: 236px; zoom: 1.28; background: #fff; border: 1px solid #e6e3dc; border-radius: 22px; padding: 22px; box-shadow: 0 16px 36px #0001; }
    .badge { position: absolute; width: 44px; height: 44px; border-radius: 50%; background: ${Y}; display: grid; place-items: center; font: 400 26px 'DM Serif Display', serif; color: #111; box-shadow: 0 4px 10px #0002; }
    .ex { position: absolute; font: 500 13px 'Work Sans'; color: #999; letter-spacing: 1px; }
  `,
  tipos: {
    // The bio is the first thing a visitor reads: the eye lands on it.
    olhar: {
      html: () => `
        <div class="abs se" data-k="t" style="left:34px;top:110px;font-size:58px">Todo mundo<br>lê a <i style="box-shadow:inset 0 -12px 0 ${Y}">bio</i> primeiro.</div>
        ${perfil(true)}
        <div class="abs" data-k="eye" style="left:220px;top:440px;font-size:64px">👀</div>`,
      frame(t, c, q, A, s) {
        st(q('t'), 1, `translateY(${lerp(14, 0, ink(t, 0, 0.4))}px)`);
        const e = p(t, A('bio') - 0.4, A('bio'));
        st(q('eye'), e, `translate(${lerp(120, 0, eo(e))}px, ${lerp(-120, 0, eo(e))}px) scale(${back(e)})`);
      },
      sfx: (c, A) => [{ t: A('bio') - 0.4, s: 'whoosh' }],
    },

    // A generic bio, and the visitor swipes away.
    ruim: {
      html: () => `
        <div class="abs se" style="left:34px;top:110px;font-size:52px">E se ela diz só…</div>
        <div class="abs" data-k="wrap" style="inset:0">${perfil(true)}</div>
        <div class="abs" data-k="hand" style="left:380px;top:520px;font-size:70px">👆</div>
        <div class="abs se" data-k="bye" style="left:0;right:0;top:620px;text-align:center;font-size:48px"><i>…tchau.</i> 👋</div>`,
      frame(t, c, q, A, s) {
        const sw = eio(p(t, A('embora') - 0.4, A('embora') + 0.1));
        st(q('wrap'), 1 - sw * 0.85, `translateX(${-520 * sw}px) rotate(${-8 * sw}deg)`);
        const h = p(t, A('pessoa') - 0.3, A('embora') + 0.1);
        st(q('hand'), h > 0 && h < 1 ? 1 : 0, `translateX(${-260 * eio(h)}px)`);
        st(q('bye'), ink(t, A('embora') + 0.05, A('embora') + 0.3));
      },
      sfx: (c, A) => [{ t: A('embora') - 0.4, s: 'whoosh' }],
    },

    // "Write this down": a big serif 5 in a yellow ring.
    anota: {
      html: () => `
        <div class="abs" data-k="ring" style="left:0;right:0;top:170px;margin:auto;width:300px;height:300px;border-radius:50%;background:${Y};display:grid;place-items:center">
          <span class="se" style="font-size:230px">5</span></div>
        <div class="abs se" data-k="t" style="left:0;right:0;top:520px;text-align:center;font-size:60px">itens <i>que não</i><br>podem faltar ✍️</div>`,
      frame(t, c, q, A, s) {
        const k = p(t, s.start, s.start + 0.35);
        st(q('ring'), k, `scale(${back(k)}) rotate(${lerp(-30, 0, eo(k))}deg)`);
        st(q('t'), ink(t, A('cinco') - 0.2, A('cinco') + 0.15));
      },
      sfx: (c, A, s) => [{ t: s.start, s: 'pop' }],
    },

    // The worked example: Mercado Carvalho's bio, one line per item.
    itens: {
      html: () => `
        <div class="abs se" data-k="h" style="left:34px;top:110px;font-size:52px"></div>
        <div class="ex" style="left:34px;top:270px">EXEMPLO · MERCADO CARVALHO</div>
        ${perfil(false)}
        ${BIO.map((_, i) => `<div class="badge" data-k="b${i}" style="left:6px;top:0">${i + 1}</div>`).join('')}`,
      frame(t, c, q, A, s) {
        const marks = ['Um', 'Dois', 'Três', 'Quatro', 'Cinco'].map((w) => A(w));
        const cur = marks.reduce((n, m, i) => (t >= m - 0.15 ? i : n), -1);
        q('h').innerHTML = cur < 0 ? '' : `<span style="color:#bbb">${cur + 1}.</span> ${['O que você vende', 'Pra quem', 'Onde você atende', 'Por que você', 'Como falar com você'][cur]}`;
        st(q('h'), cur < 0 ? 0 : ink(t, marks[cur] - 0.15, marks[cur] + 0.1));
        BIO.forEach((_, i) => {
          const k = p(t, marks[i] - 0.1, marks[i] + 0.3);
          const line = q(`l${i}`);
          st(line, i <= cur ? 1 : 0.12, `translateX(${lerp(20, 0, eo(k))}px)`, { background: i === cur ? '#ffd10055' : 'transparent' });
          const top = line.getBoundingClientRect().top;
          st(q(`b${i}`), k, `translateY(${top - 12}px) scale(${back(k)})`);
        });
      },
      sfx: (c, A) => ['Um', 'Dois', 'Três', 'Quatro', 'Cinco'].map((w) => ({ t: A(w) - 0.1, s: 'pop' })),
    },

    // The finished bio, with a seal.
    pronta: {
      html: () => `
        <div class="abs se" data-k="t" style="left:34px;top:110px;font-size:54px">Agora sim: uma bio<br>que <i style="box-shadow:inset 0 -12px 0 ${Y}">trabalha</i> por você.</div>
        ${perfil(false)}
        <div class="abs" data-k="seal" style="left:350px;top:250px;width:150px;height:150px;border-radius:50%;background:#111;color:${Y};display:grid;place-items:center;text-align:center;font:400 30px/1 'DM Serif Display';transform:rotate(-12deg)">5/5<br><span style="font:700 14px 'Work Sans'">COMPLETA</span></div>`,
      frame(t, c, q, A, s) {
        st(q('t'), ink(t, s.start, s.start + 0.35));
        const k = p(t, A('sim') - 0.1, A('sim') + 0.25);
        st(q('seal'), k, `rotate(-12deg) scale(${lerp(1.8, 1, eo(k))})`);
      },
      sfx: (c, A) => [{ t: A('sim') - 0.05, s: 'impact' }],
    },

    // The poll: how many of the five does yours have? Then follow King.
    enquete: {
      html: () => `
        <div class="abs se" data-k="t" style="left:34px;top:110px;font-size:62px">E a sua?<br>Tem os <i style="box-shadow:inset 0 -12px 0 ${Y}">cinco</i>?</div>
        <div class="abs" data-k="chips" style="left:34px;right:34px;top:340px;display:grid;grid-template-columns:repeat(6,1fr);gap:10px">
          ${[0, 1, 2, 3, 4, 5].map((n) => `<div data-k="n${n}" style="aspect-ratio:1;border-radius:16px;border:3px solid #111;display:grid;place-items:center;font:400 46px 'DM Serif Display';color:#111;background:#fff">${n}</div>`).join('')}</div>
        <div class="abs ws" data-k="com" style="left:34px;top:440px;font-size:28px;font-weight:700;color:#111">💬 Comenta quantos a sua tem</div>
        <div class="abs" data-k="kg" style="left:34px;right:34px;top:540px;background:#111;border-radius:18px;padding:16px;display:flex;align-items:center;gap:14px">
          <img src="${asset(R.marca.logo)}" style="width:58px;height:58px;border-radius:50%">
          <div class="ws" style="color:#fff;font-size:19px;font-weight:700">${esc(R.marca.instagram)}<br><span style="font-weight:500;color:#bbb;font-size:15px">mais dicas assim</span></div>
          <div class="ws" data-k="btn" style="margin-left:auto;background:${Y};color:#111;font-weight:700;padding:10px 16px;border-radius:10px;font-size:18px">Seguir</div></div>`,
      frame(t, c, q, A, s) {
        st(q('t'), ink(t, s.start, s.start + 0.35));
        for (let n = 0; n <= 5; n += 1) {
          const k = p(t, s.start + 0.2 + n * 0.08, s.start + 0.45 + n * 0.08);
          // A quick "scan" across the numbers while the question is asked.
          const lit = Math.floor((t - A('Tem')) * 8) % 6 === n && t > A('Tem') && t < A('Comenta');
          st(q(`n${n}`), k, `scale(${back(k)})`, { background: lit ? Y : '#fff' });
        }
        const cm = p(t, A('Comenta') - 0.15, A('Comenta') + 0.15);
        st(q('com'), cm, `translateY(${lerp(16, 0, eo(cm))}px)`);
        const kg = p(t, A('segue') - 0.2, A('segue') + 0.15);
        st(q('kg'), kg, `translateY(${lerp(30, 0, eo(kg))}px)`);
        const on = t > A('King') + 0.1;
        q('btn').textContent = on ? 'Seguindo ✓' : 'Seguir';
        q('btn').style.background = on ? '#333' : Y;
        q('btn').style.color = on ? '#fff' : '#111';
      },
      sfx: (c, A) => [{ t: A('Comenta') - 0.15, s: 'pop' }, { t: A('King') + 0.1, s: 'click' }, { t: A('assim'), s: 'ding' }],
    },
  },
};
