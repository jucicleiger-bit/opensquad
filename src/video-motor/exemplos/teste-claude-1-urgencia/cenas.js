// "Urgência x planejamento" — scenes written for this video only.
// Two moods: the urgency half is black with hazard tape, hard cuts and
// shake; the planning half is white, calm, with soft cross-fades.
// Uses the motor's helpers (st, p, eo, eio, back, lerp, esc, asset, R, S).

const Y = '#FFD100';
const ink = (t, a, b) => eio(p(t, a, b));
const foto = (n) => asset(`fotos/${n}.jpg`);
const URG = ['alarme', 'correria', 'carimbo'];
const CLARO = ['domingo', 'quadro', 'calma', 'seguir'];

// Urgency: hard cut with a white flash. Planning: slow cross-fade.
function transicao(t, s, next, i) {
  const calm = !URG.includes(s.c.tipo);
  const fin = calm ? 0.35 : 0.06;
  const tin = i ? p(t, s.start - fin / 2, s.start + fin / 2) : 1;
  const tout = next ? p(t, s.end - fin / 2, s.end + fin / 2) : 0;
  const o = calm ? Math.min(tin, 1 - tout * (URG.includes(next?.c.tipo) ? 1 : 0)) : tin;
  st(s.el, o, calm ? `scale(${lerp(1.03, 1, eo(tin))})` : 'none', {
    display: tin > 0 && tout < 1 ? 'block' : 'none', filter: 'none',
    background: CLARO.includes(s.c.tipo) ? '#F7F6F2' : '#0A0A0A', zIndex: i,
  });
}

// Caption on a black band, uppercase, the spoken word in yellow.
function legenda(t, chunk, el, k) {
  el.innerHTML = `<span class="band">${chunk.map((w) => (t >= w.t - 0.03 && t < w.t + w.d ? `<b style="color:${Y}">${esc(w.w)}</b>` : esc(w.w))).join(' ')}</span>`;
  el.style.opacity = k;
}

// Camera shake in the urgency half, keyed off hits set by the scenes.
let shakeUntil = 0;
function quadro(t) {
  const k = t < shakeUntil ? (shakeUntil - t) / 0.4 : 0;
  document.getElementById('cam').style.transform = k > 0 ? `translate(${Math.sin(t * 95) * 10 * k}px, ${Math.cos(t * 81) * 8 * k}px)` : '';
}
const hit = (t, at) => { if (t >= at && t < at + 0.4) shakeUntil = at + 0.4; };

const tape = (top) => `<div class="tape" style="top:${top}px"></div>`;

window.VIDEO = {
  estrelas: false,
  fontes: 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@600;800&display=block',
  transicao,
  legenda,
  quadro,
  css: `
    #stage { background: #0A0A0A !important; }
    #vignette { display: none; }
    #cap { top: 790px !important; font: 700 34px Oswald, sans-serif !important; font-style: normal !important; text-transform: uppercase; text-shadow: none !important; color: #fff !important; letter-spacing: .5px; }
    .band { display: inline-block; background: #000; padding: 6px 16px; }
    .os { font-family: Oswald, sans-serif; font-weight: 700; text-transform: uppercase; line-height: .95; }
    .in { font-family: Inter, sans-serif; font-weight: 800; }
    .tape { position: absolute; left: -40px; right: -40px; height: 34px; background: repeating-linear-gradient(-45deg, ${Y} 0 26px, #111 26px 52px); }
    .ph { position: absolute; background: #fff; padding: 8px 8px 26px; box-shadow: 0 16px 36px #000a; }
    .ph img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .card { position: absolute; border-radius: 12px; overflow: hidden; box-shadow: 0 12px 26px #0003; background: #fff; }
    .card img { display: block; width: 100%; height: 100%; object-fit: cover; }
  `,
  tipos: {
    // Friday 19:00 lock screen; the "you posted nothing" reminder drops in.
    alarme: {
      html: () => `${tape(0)}${tape(926)}
        <div class="abs os" data-k="dia" style="left:0;right:0;top:170px;text-align:center;color:#bbb;font-size:30px;font-weight:500">SEXTA-FEIRA</div>
        <div class="abs os" data-k="hora" style="left:0;right:0;top:210px;text-align:center;color:#fff;font-size:170px">19:00</div>
        <div class="abs" data-k="ban" style="left:30px;right:30px;top:470px;background:#1c1c1c;border-radius:20px;padding:16px 18px;display:flex;gap:14px;align-items:center;box-shadow:0 12px 30px #000">
          <div style="width:52px;height:52px;border-radius:12px;background:${Y};display:grid;place-items:center;font-size:30px">📅</div>
          <div class="in" style="color:#fff;font-size:21px;line-height:1.3">Lembrete<br><span style="font-weight:600;color:#ccc">Você não postou nada essa semana.</span></div></div>
        <div class="abs os" data-k="grito" style="left:0;right:0;top:640px;text-align:center;color:${Y};font-size:58px">NÃO POSTEI NADA!</div>`,
      frame(t, c, q, A, s) {
        document.querySelectorAll('.tape').forEach((el) => { el.style.backgroundPosition = `${t * 120}px 0`; });
        const tick = Math.floor(t * 2) % 2;
        q('hora').textContent = tick ? '19:00' : '19 00';
        const b = p(t, A('susto') - 0.2, A('susto') + 0.15);
        st(q('ban'), b, `translateY(${lerp(-260, 0, eo(b))}px)`);
        const g = p(t, A('nossa') - 0.05, A('nossa') + 0.15);
        st(q('grito'), g, `scale(${back(g)}) rotate(-3deg)`);
        hit(t, A('nossa') - 0.05);
      },
      sfx: (c, A) => [{ t: A('susto') - 0.2, s: 'ding' }, { t: A('nossa') - 0.05, s: 'impact' }],
    },

    // Any photo, any caption, posted in a rush — on a fast stopwatch.
    correria: {
      html: () => `${tape(0)}
        <div class="abs os" data-k="clock" style="right:30px;top:52px;color:${Y};font-size:40px">00:00</div>
        ${[['espeto-antes', 40, 120, -9], ['bacon-antes', 250, 150, 7], ['galao-antes', 120, 300, -4]].map(([n, x, y, r], i) => `<div class="ph" data-k="f${i}" style="left:${x}px;top:${y}px;width:230px;height:200px;--r:${r}deg"><img src="${foto(n)}"></div>`).join('')}
        <div class="abs" data-k="box" style="left:30px;right:30px;top:560px;background:#fff;border-radius:14px;padding:14px 16px;min-height:64px"><span class="in" data-k="txt" style="font-size:26px;color:#111;font-weight:600"></span><span data-k="cur" style="display:inline-block;width:3px;height:28px;background:#111;vertical-align:middle"></span></div>
        <div class="abs in" data-k="btn" style="left:30px;right:30px;top:660px;text-align:center;background:#3897f0;color:#fff;border-radius:12px;padding:14px;font-size:24px">Publicar</div>`,
      frame(t, c, q, A, s) {
        q('clock').textContent = `00:${String(Math.floor((t - s.start) * 9) % 60).padStart(2, '0')}`;
        [A('qualquer'), A('foto'), A('foto') + 0.3].forEach((a, i) => {
          const k = p(t, a - 0.12, a + 0.05);
          st(q(`f${i}`), k > 0 ? 1 : 0, `scale(${lerp(1.6, 1, k)}) rotate(var(--r))`);
          hit(t, a + 0.05);
        });
        const msg = 'promoçao hj vem!!! 🔥🔥';
        const n = Math.round(lerp(0, msg.length, p(t, A('escreve') - 0.1, A('coisa') + 0.3)));
        q('txt').textContent = [...msg].slice(0, n).join('');
        q('cur').style.opacity = Math.floor(t * 6) % 2;
        const b = p(t, A('posta') - 0.1, A('posta') + 0.15);
        st(q('btn'), 1, `scale(${1 - Math.sin(b * Math.PI) * 0.08})`, { background: t > A('posta') + 0.05 ? '#1f6fbf' : '#3897f0' });
        if (t > A('posta') + 0.05) q('btn').textContent = 'Publicado ✓';
      },
      sfx: (c, A) => [{ t: A('qualquer') - 0.12, s: 'thud' }, { t: A('foto') - 0.12, s: 'thud' }, { t: A('foto') + 0.18, s: 'thud' }, ...Array.from({ length: 8 }, (_, i) => ({ t: A('escreve') + i * 0.11, s: 'tick' })), { t: A('posta') - 0.05, s: 'click' }],
    },

    // The verdict, stamped in hazard tape.
    carimbo: {
      html: () => `${tape(0)}${tape(926)}
        <div class="abs os" data-k="a" style="left:0;right:0;top:300px;text-align:center;color:#fff;font-size:52px">ISSO É POSTAR POR</div>
        <div class="abs" data-k="b" style="left:40px;right:40px;top:380px;text-align:center;padding:18px 0;background:repeating-linear-gradient(-45deg, ${Y} 0 30px, #111 30px 60px)">
          <span class="os" style="background:#0A0A0A;color:${Y};font-size:76px;padding:0 16px">URGÊNCIA</span></div>`,
      frame(t, c, q, A, s) {
        document.querySelectorAll('.tape').forEach((el) => { el.style.backgroundPosition = `${t * 120}px 0`; });
        st(q('a'), ink(t, s.start, s.start + 0.25));
        const k = p(t, A('urgência') - 0.12, A('urgência') + 0.08);
        st(q('b'), k, `scale(${lerp(2.2, 1, eo(k))}) rotate(${lerp(-12, -4, k)}deg)`);
        hit(t, A('urgência') + 0.08);
      },
      sfx: (c, A) => [{ t: A('urgência') - 0.05, s: 'impact' }],
    },

    // Sunday morning, calm: the empty week waits to be planned.
    domingo: {
      html: () => `
        <div class="abs" data-k="sol" style="left:330px;top:90px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle, ${Y} 0 55%, #ffd10033 56%, transparent 72%)"></div>
        <div class="abs os" data-k="d" style="left:40px;top:150px;color:#111;font-size:30px;font-weight:500">DOMINGO · 9:00 ☕</div>
        <div class="abs os" data-k="t" style="left:40px;top:200px;color:#111;font-size:68px;line-height:1.08">A SEMANA<br>INTEIRA<br><span style="background:${Y};padding:0 10px">PRONTA.</span></div>
        <div class="abs" data-k="board" style="left:40px;right:40px;top:520px;display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
          ${['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((d) => `<div style="height:150px;border:2px dashed #0002;border-radius:10px;text-align:center;padding-top:8px" class="in"><span style="font-size:14px;color:#888">${d}</span></div>`).join('')}</div>`,
      frame(t, c, q, A, s) {
        st(q('sol'), 1, `translateY(${lerp(80, 0, eo(p(t, s.start, s.start + 1.5)))}px)`);
        st(q('d'), ink(t, s.start, s.start + 0.3));
        const tt = ink(t, A('imagina') - 0.2, A('imagina') + 0.2);
        st(q('t'), tt, `translateY(${lerp(20, 0, tt)}px)`);
        st(q('board'), ink(t, A('semana') - 0.4, A('semana')));
      },
      sfx: (c, A) => [{ t: A('tudo') - 0.3, s: 'whoosh' }],
    },

    // Real Stories drop into Monday, Wednesday and Friday.
    quadro: {
      html: () => `
        <div class="abs os" style="left:40px;top:90px;color:#111;font-size:44px">PLANO DA SEMANA</div>
        <div class="abs" style="left:24px;right:24px;top:180px;display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
          ${['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((d) => `<div style="height:420px;border:2px dashed #0002;border-radius:10px;text-align:center;padding-top:8px" class="in"><span style="font-size:14px;color:#888">${d}</span></div>`).join('')}</div>
        ${[['s1', 0, 'OFERTA'], ['data', 2, 'BASTIDOR'], ['s4', 4, 'NOVIDADE']].map(([n, col, lab], i) => `<div class="abs" data-k="c${i}" style="left:${24 + col * 70.3 - 30}px;top:220px;width:130px">
            <div class="card" style="position:relative;width:130px;height:231px"><img src="${foto(n)}"></div>
            <div class="in" style="margin-top:8px;text-align:center;font-size:16px;background:#111;color:${Y};padding:4px 0">${lab}</div></div>`).join('')}`,
      frame(t, c, q, A, s) {
        ['Oferta', 'bastidor', 'novidade'].forEach((w, i) => {
          const k = p(t, A(w) - 0.2, A(w) + 0.15);
          st(q(`c${i}`), k, `translateY(${lerp(-60, i % 2 ? 40 : 0, eo(k))}px) rotate(${lerp(-8, [-3, 2, -2][i], eo(k))}deg)`, { zIndex: 2 + i });
        });
      },
      sfx: (c, A) => ['Oferta', 'bastidor', 'novidade'].map((w) => ({ t: A(w) - 0.2, s: 'pop' })),
    },

    // The calm verdict: a check, and the word underlined.
    calma: {
      html: () => `
        <div class="abs" data-k="ok" style="left:0;right:0;top:220px;margin:auto;width:140px;height:140px;border-radius:50%;background:#111;display:grid;place-items:center;color:${Y};font:900 80px Inter">✓</div>
        <div class="abs os" style="left:0;right:0;top:400px;text-align:center;color:#111;font-size:52px" data-k="a">ISSO É POSTAR COM</div>
        <div class="abs os" style="left:0;right:0;top:470px;text-align:center;color:#111;font-size:66px" data-k="b"><span data-k="u" style="background:linear-gradient(${Y},${Y}) no-repeat 0 88%/0% 35%">PLANEJAMENTO.</span></div>`,
      frame(t, c, q, A, s) {
        const k = p(t, s.start, s.start + 0.4);
        st(q('ok'), k, `scale(${back(k)})`);
        st(q('a'), ink(t, s.start + 0.1, s.start + 0.4));
        st(q('b'), ink(t, A('planejamento') - 0.2, A('planejamento') + 0.1));
        q('u').style.backgroundSize = `${ink(t, A('planejamento'), A('planejamento') + 0.5) * 100}% 35%`;
      },
      sfx: (c, A, s) => [{ t: s.start, s: 'ding' }],
    },

    // A Stories-style poll card: comment 1, 2 or 3.
    enquete: {
      html: () => `
        <div class="abs" style="left:40px;right:40px;top:110px;background:#fff;border-radius:26px;padding:26px 22px 22px;box-shadow:0 18px 40px #000a" data-k="card">
          <div class="in" style="font-size:30px;color:#111;text-align:center;margin-bottom:18px">E aí na sua loja? 👇</div>
          ${['Posto na urgência', 'Eu planejo', 'Nem posto 😅'].map((o, i) => `<div data-k="o${i}" class="in" style="display:flex;align-items:center;gap:14px;margin-top:12px;border:3px solid #eee;border-radius:16px;padding:14px 16px;font-size:26px;color:#111">
              <span style="width:44px;height:44px;border-radius:50%;background:${Y};display:grid;place-items:center;font-size:24px">${i + 1}</span>${o}</div>`).join('')}
        </div>
        <div class="abs in" data-k="com" style="left:0;right:0;top:560px;text-align:center;color:#fff;font-size:30px">💬 Comenta <span style="color:${Y}">1, 2 ou 3</span></div>`,
      frame(t, c, q, A, s) {
        const k = p(t, s.start, s.start + 0.35);
        st(q('card'), k, `translateY(${lerp(40, 0, eo(k))}px) scale(${back(k)})`);
        ['um', 'Dois', 'Três'].forEach((w, i) => {
          const on = t >= A(w) - 0.1;
          const nxt = ['Dois', 'Três'][i];
          const active = on && (!nxt || t < A(nxt) - 0.1);
          st(q(`o${i}`), on ? 1 : 0.35, `scale(${active ? 1.04 : 1})`, { borderColor: active ? Y : '#eee' });
        });
        const cm = p(t, A('Comenta') - 0.15, A('Comenta') + 0.15);
        st(q('com'), cm, `scale(${back(cm)})`);
      },
      sfx: (c, A) => [{ t: A('Comenta') - 0.15, s: 'pop' }, ...['um', 'Dois', 'Três'].map((w) => ({ t: A(w) - 0.1, s: 'tick' }))],
    },

    // The King profile: "Seguir" turns into "Seguindo".
    seguir: {
      html: () => `
        <div class="abs" data-k="pf" style="left:40px;right:40px;top:200px;background:#fff;border-radius:24px;padding:24px;box-shadow:0 14px 34px #0002;text-align:center">
          <img src="${asset(R.marca.logo)}" style="width:110px;height:110px;border-radius:50%;background:#111;border:4px solid ${Y}">
          <div class="in" style="font-size:28px;color:#111;margin-top:12px">${esc(R.marca.instagram)}</div>
          <div class="in" style="font-size:19px;color:#666;font-weight:600;margin-top:6px">Organização da sua divulgação</div>
          <div class="in" data-k="btn" style="margin:18px auto 0;width:260px;padding:14px;border-radius:12px;font-size:24px;background:#3897f0;color:#fff">Seguir</div>
        </div>
        <div class="abs" data-k="tap" style="left:240px;top:520px;width:60px;height:60px;border-radius:50%;border:4px solid ${Y}"></div>`,
      frame(t, c, q, A, s) {
        const k = p(t, s.start, s.start + 0.4);
        st(q('pf'), k, `translateY(${lerp(40, 0, eo(k))}px)`);
        const tp = p(t, A('Segue') + 0.1, A('Segue') + 0.45);
        st(q('tap'), tp > 0 && tp < 1 ? 1 - tp : 0, `scale(${lerp(0.4, 1.6, tp)})`);
        const on = t > A('Segue') + 0.2;
        q('btn').textContent = on ? 'Seguindo ✓' : 'Seguir';
        q('btn').style.background = on ? '#eee' : '#3897f0';
        q('btn').style.color = on ? '#111' : '#fff';
      },
      sfx: (c, A) => [{ t: A('Segue') + 0.15, s: 'click' }, { t: A('divulgação'), s: 'ding' }],
    },
  },
};
