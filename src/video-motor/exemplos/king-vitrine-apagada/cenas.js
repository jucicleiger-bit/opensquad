// "Vitrine apagada" — scenes written for this video only.
// Concept: a product nobody sees is a product in the dark; posting turns
// the light on. Identity from King's Raio-X: black/white base, #FFD100 only
// for highlights, strong legible type, no visual noise. Uses the motor's
// helpers (st, p, eo, eio, back, lerp, esc, obj, asset, R).

const Y = '#FFD100';
const ink = (t, a, b) => eio(p(t, a, b));

// Lights-out cut: each scene fades up from black and drops to black.
function transicao(t, s, next, i) {
  const tin = i ? p(t, s.start - 0.08, s.start + 0.18) : 1;
  const tout = next ? p(t, s.end - 0.14, s.end) : 0;
  const o = Math.min(tin, 1 - tout);
  st(s.el, o, `scale(${lerp(1.04, 1, eo(tin))})`, { display: o > 0 ? 'block' : 'none', filter: 'none' });
}

// Captions low on the screen, the word being spoken on a yellow block
// (readable on the dark scenes and on the white one).
function legenda(t, chunk, el, k) {
  const light = S.find((s) => t >= s.start && t < s.end)?.c.tipo === 'silencio';
  el.style.color = light ? '#111' : '#fff';
  el.innerHTML = chunk.map((w) => (t >= w.t - 0.03 && t < w.t + w.d ? `<span style="background:${Y};color:#111;padding:0 6px">${esc(w.w)}</span>` : esc(w.w))).join(' ');
  el.style.opacity = k;
  el.style.transform = `translateY(${lerp(8, 0, k)}px)`;
}

const boxSlots = [[90, 520], [210, 520], [330, 520], [150, 410], [270, 410], [210, 300]];

window.VIDEO = {
  estrelas: false,
  fontes: 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Caveat:wght@700&family=Space+Grotesk:wght@500;700&display=block',
  transicao,
  legenda,
  css: `
    #stage { background: #070707 !important; }
    #vignette { background: radial-gradient(ellipse at 50% 45%, transparent 60%, #000a 100%) !important; }
    #cap { top: 770px !important; font: 700 34px 'Space Grotesk', sans-serif !important; font-style: normal !important; letter-spacing: -.5px; text-shadow: 0 2px 10px #000 !important; }
    .h1 { font-family: 'Archivo Black', sans-serif; color: #fff; line-height: .95; letter-spacing: -1px; }
    .sg { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #fff; }
    .bar { height: 10px; background: ${Y}; }
    .note { position: absolute; width: 230px; height: 220px; background: ${Y}; box-shadow: 0 18px 30px #0008; display: grid; place-items: center; text-align: center; font: 700 48px/1 Caveat, cursive; color: #111; padding: 18px; }
    .lit { position: absolute; inset: 0; }
  `,
  tipos: {
    // Boxes keep dropping onto a growing stack; the first is already falling on frame 0.
    chegada: {
      html: () => `
        <div class="abs h1" data-k="t" style="left:40px;top:96px;font-size:76px">TODO<br>DIA</div>
        <div class="abs bar" data-k="bar" style="left:40px;top:250px;width:220px;transform-origin:0 50%"></div>
        <div class="abs" style="left:40px;right:40px;top:640px;height:2px;background:#fff3"></div>
        ${boxSlots.map((_, i) => `<img class="abs" data-k="b${i}" src="${obj('caixa')}" style="left:0;top:0;width:120px">`).join('')}
        <div class="abs sg" data-k="tag" style="left:236px;top:248px;padding:6px 14px;background:${Y};color:#111;font-size:26px;transform-origin:50% 100%">NOVO</div>`,
      frame(t, c, q, A, s) {
        boxSlots.forEach(([x, y], i) => {
          const drop = s.start - 0.15 + i * 0.3, k = p(t, drop, drop + 0.38);
          const fall = k * k; // gravity
          const land = t > drop + 0.38 ? 1 - p(t, drop + 0.38, drop + 0.6) : 0;
          st(q(`b${i}`), k > 0 ? 1 : 0, `translate(${x}px, ${lerp(-260, y, fall)}px) scale(${1 + land * 0.12}, ${1 - land * 0.12}) rotate(${(1 - fall) * (i % 2 ? 14 : -14)}deg)`);
        });
        st(q('t'), ink(t, s.start, s.start + 0.3), `translateX(${lerp(-40, 0, ink(t, s.start, s.start + 0.3))}px)`);
        q('bar').style.transform = `scaleX(${ink(t, A('dia') - 0.1, A('dia') + 0.3)})`;
        const n = A('novo') - 0.1, k = p(t, n, n + 0.25);
        st(q('tag'), k, `translateY(-${lerp(60, 0, eo(k))}px) rotate(${lerp(-25, -8, eo(k))}deg) scale(${back(k)})`);
      },
      sfx: (c, A, s) => [...boxSlots.map((_, i) => ({ t: Math.max(0, s.start + 0.23 + i * 0.3), s: 'thud' })), { t: A('novo') - 0.1, s: 'pop' }],
    },

    // A white post composer where nothing gets written.
    silencio: {
      html: () => `
        <div class="abs" style="inset:0;background:#f4f2ec"></div>
        <div class="abs sg" data-k="head" style="left:40px;right:40px;top:110px;display:flex;justify-content:space-between;color:#111;font-size:24px;border-bottom:2px solid #ddd;padding-bottom:14px"><span>← Nova publicação</span><span style="color:#999">Compartilhar</span></div>
        <div class="abs sg" data-k="ph" style="left:40px;top:190px;font-size:40px;color:#aaa;font-weight:500"></div>
        <div class="abs" data-k="cur" style="left:40px;top:192px;width:4px;height:48px;background:#111"></div>
        <div class="abs h1" data-k="dots" style="left:0;right:0;top:380px;text-align:center;font-size:150px;color:#111;letter-spacing:12px"></div>
        <div class="abs sg" data-k="last" style="left:0;right:0;top:600px;text-align:center;font-size:24px;color:#777;font-weight:500">última publicação: <b style="color:#111">há 3 semanas</b></div>`,
      frame(t, c, q, A, s) {
        st(q('head'), ink(t, s.start, s.start + 0.3), `translateY(${lerp(-30, 0, ink(t, s.start, s.start + 0.3))}px)`);
        const text = 'Escreva uma legenda...', n = Math.round(lerp(0, text.length, p(t, s.start + 0.2, A('Instagram') + 0.6)));
        q('ph').textContent = text.slice(0, n);
        q('cur').style.opacity = Math.floor(t * 2.4) % 2 ? 0 : 1;
        q('cur').style.left = `${40 + q('ph').offsetWidth + 4}px`;
        const sil = A('silêncio');
        q('dots').textContent = '...'.slice(0, Math.max(0, Math.floor((t - sil + 0.2) / 0.22) + 1));
        st(q('dots'), t > sil - 0.2 ? 1 : 0);
        st(q('last'), ink(t, sil + 0.3, sil + 0.6));
      },
      sfx: (c, A) => [{ t: A('silêncio') - 0.2, s: 'tick' }, { t: A('silêncio') + 0.02, s: 'tick' }, { t: A('silêncio') + 0.24, s: 'tick' }],
    },

    // A flashlight sweeps a dark shelf: only a small circle is ever seen.
    lanterna: {
      html: () => `
        <img class="abs" src="${obj('vitrine')}" style="left:70px;top:130px;width:400px;filter:brightness(.07)">
        <img class="abs" data-k="lit" src="${obj('vitrine')}" style="left:70px;top:130px;width:400px">
        <div class="abs h1" data-k="q" style="left:0;right:0;top:44px;text-align:center;font-size:90px;color:${Y}">?</div>
        <div class="abs h1" data-k="nem" style="left:0;right:0;top:560px;text-align:center;font-size:64px">NEM SABEM.</div>`,
      frame(t, c, q, A, s) {
        const off = A('nem') - 0.05, k = p(t, s.start, off);
        const x = 50 + Math.sin(k * 7) * 34, y = 25 + k * 55 + Math.sin(k * 11) * 8;
        const r = lerp(90, 0, eio(p(t, off, off + 0.35)));
        q('lit').style.webkitMaskImage = `radial-gradient(circle ${r}px at ${x}% ${y}%, #000 70%, transparent 100%)`;
        st(q('q'), ink(t, s.start, s.start + 0.3), `scale(${1 + Math.max(0, Math.sin(t * 6)) * 0.06})`);
        st(q('nem'), ink(t, off + 0.25, off + 0.45), `translateY(${lerp(20, 0, ink(t, off + 0.25, off + 0.45))}px)`);
      },
      sfx: (c, A, s) => [{ t: s.start, s: 'click' }, { t: A('nem') - 0.05, s: 'click' }],
    },

    // The day's chores orbit a clock that keeps speeding up.
    relogio: {
      html: () => `
        <div class="abs h1" data-k="t1" style="left:40px;top:90px;font-size:44px;color:#fff">NÃO É FALTA<br>DE VONTADE.</div>
        <div class="abs" data-k="clock" style="left:150px;top:300px;width:240px;height:240px">
          <img src="${obj('relogio')}" style="width:100%;height:100%;object-fit:contain">
          <div data-k="hand" style="position:absolute;left:50%;top:50%;width:4px;height:100px;margin-left:-2px;background:${Y};transform-origin:50% 0;box-shadow:0 0 8px ${Y}"></div>
        </div>
        ${['ATENDER', 'REPOR', 'FORNECEDOR', 'FECHAR CAIXA', 'ENTREGA', 'WHATSAPP'].map((w, i) => `<div class="abs sg" data-k="w${i}" style="left:0;top:0;font-size:22px;padding:6px 12px;border:2px solid #fff;color:#fff;white-space:nowrap">${w}</div>`).join('')}
        <div class="abs h1" data-k="t2" style="left:40px;top:600px;font-size:44px;color:${Y}">O DIA NÃO PARA.</div>`,
      frame(t, c, q, A, s) {
        const fast = p(t, A('dia') - 0.2, A('para') + 0.2);
        const spin = (t - s.start) * lerp(2, 9, fast) + fast * fast * 6;
        q('hand').style.transform = `rotate(${180 + spin * 120}deg)`;
        const shake = fast * 3;
        st(q('clock'), ink(t, s.start, s.start + 0.35), `scale(${lerp(0.7, 1, ink(t, s.start, s.start + 0.35))}) translate(${Math.sin(t * 60) * shake}px, ${Math.cos(t * 53) * shake}px)`);
        for (let i = 0; i < 6; i += 1) {
          const ang = spin * 0.35 + (i / 6) * Math.PI * 2, rx = 200, ry = 150;
          const w = q(`w${i}`);
          st(w, ink(t, s.start + 0.1 + i * 0.08, s.start + 0.4 + i * 0.08), `translate(${270 + Math.cos(ang) * rx - w.offsetWidth / 2}px, ${420 + Math.sin(ang) * ry - 18}px)`);
        }
        st(q('t1'), ink(t, s.start, s.start + 0.3));
        st(q('t2'), ink(t, A('dia') - 0.15, A('dia') + 0.15), `translateX(${lerp(-30, 0, ink(t, A('dia') - 0.15, A('dia') + 0.15))}px)`);
      },
      sfx: (c, A, s) => Array.from({ length: 10 }, (_, i) => ({ t: s.start + 0.2 + i * 0.3 * Math.pow(0.86, i), s: 'tick' })),
    },

    // "Depois" notes keep slapping on top of each other over a month going by.
    depois: {
      html: () => `
        <div class="abs" data-k="cal" style="left:40px;top:120px;width:460px;display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
          ${Array.from({ length: 28 }, (_, i) => `<div class="sg" style="height:58px;border:1px solid #fff2;color:#fff5;font-size:16px;padding:4px;position:relative">${i + 1}<span data-k="x${i}" style="position:absolute;inset:0;display:grid;place-items:center;color:#fff6;font-size:34px;opacity:0">×</span></div>`).join('')}
        </div>
        <div class="note" data-k="n0" style="left:150px;top:230px"><span>postar no<br>Insta → <u>depois</u></span></div>
        <div class="note" data-k="n1" style="left:150px;top:230px"><span>depois</span></div>
        <div class="note" data-k="n2" style="left:150px;top:230px"><span>depois...</span></div>`,
      frame(t, c, q, A, s) {
        const days = Math.floor(lerp(0, 28, p(t, s.start, s.end)));
        for (let i = 0; i < 28; i += 1) q(`x${i}`).style.opacity = i < days ? 1 : 0;
        const hits = [A('depois', 1), A('depois', 2), A('depois', 3)];
        hits.forEach((h, i) => {
          const k = p(t, h - 0.18, h + 0.02);
          st(q(`n${i}`), k, `translate(${[-10, 30, -20][i]}px, ${[0, 40, 90][i]}px) rotate(${[-6, 5, -3][i]}deg) scale(${lerp(1.6, 1, eo(k))})`);
        });
      },
      sfx: (c, A) => [1, 2, 3].map((n) => ({ t: A('depois', n) - 0.05, s: 'thud' })),
    },

    // A sneaker dissolves into dots as the customer forgets it.
    esquece: {
      html: () => `
        <div class="abs h1" data-k="t1" style="left:40px;top:96px;font-size:46px">O CLIENTE<br>ESQUECE</div>
        <div class="abs h1" data-k="t2" style="left:40px;top:196px;font-size:46px;color:${Y}">O QUE NÃO VÊ.</div>
        <img class="abs" data-k="tenis" src="${obj('tenis')}" style="left:70px;top:300px;width:400px">`,
      frame(t, c, q, A, s) {
        const go = A('esquece') - 0.1, d = eio(p(t, go, go + 1.1));
        const el = q('tenis');
        st(el, ink(t, s.start, s.start + 0.3) * (1 - p(t, go + 0.9, go + 1.3)), `translateY(${Math.sin(t * 1.4) * 6}px) rotate(${-6 + Math.sin(t) * 2}deg)`);
        // A dot screen whose dots shrink to nothing.
        el.style.webkitMaskImage = d > 0 ? `radial-gradient(circle, #000 ${lerp(72, 0, d)}%, transparent ${lerp(73, 1, d)}%)` : 'none';
        el.style.webkitMaskSize = '10px 10px';
        st(q('t1'), ink(t, s.start, s.start + 0.3));
        st(q('t2'), ink(t, A('não') - 0.15, A('não') + 0.15));
      },
      sfx: (c, A) => [{ t: A('esquece') - 0.1, s: 'whoosh' }],
    },

    // The dark shelf finally lights up, with a flicker like a real switch.
    acende: {
      html: () => `
        <img class="abs" data-k="dark" src="${obj('vitrine')}" style="left:70px;top:130px;width:400px;filter:brightness(.07)">
        <img class="abs" data-k="lit" src="${obj('vitrine')}" style="left:70px;top:130px;width:400px;opacity:0">
        <div class="abs" data-k="glow" style="left:-60px;right:-60px;top:100px;height:800px;opacity:0;background:radial-gradient(ellipse at 50% 45%, #ffd10033, transparent 60%)"></div>
        <div class="abs h1" data-k="a" style="left:0;right:0;top:300px;text-align:center;font-size:56px">MUITOS<br>PRODUTOS.</div>
        <div class="abs h1" data-k="b" style="left:0;right:0;top:440px;text-align:center;font-size:56px;color:${Y}">POUCA<br>DIVULGAÇÃO?</div>
        <div class="abs h1" data-k="c" style="left:0;right:0;top:60px;text-align:center;font-size:44px;color:#111;background:${Y};padding:10px 0">ACENDE ESSA VITRINE.</div>`,
      frame(t, c, q, A, s) {
        const on = A('acender') - 0.05;
        const flicker = t < on ? 0 : t > on + 0.4 ? 1 : [1, 0, 1, 0.2, 1, 0.5, 1, 1][Math.floor((t - on) * 20) % 8];
        st(q('lit'), flicker, `scale(${lerp(1, 1.05, p(t, on, s.end))})`);
        st(q('dark'), 1, `scale(${lerp(1, 1.05, p(t, on, s.end))})`);
        st(q('glow'), flicker);
        const a = ink(t, A('muitos') - 0.15, A('muitos') + 0.15), b = ink(t, A('divulga') - 0.15, A('divulga') + 0.15);
        st(q('a'), a * (1 - p(t, on - 0.2, on)), `translateY(${lerp(30, 0, a)}px)`);
        st(q('b'), b * (1 - p(t, on - 0.2, on)), `translateY(${lerp(30, 0, b)}px)`);
        st(q('c'), flicker, `scaleY(${eo(p(t, on, on + 0.3))})`);
      },
      sfx: (c, A) => [{ t: A('acender') - 0.05, s: 'click' }, { t: A('acender') + 0.15, s: 'click' }, { t: A('acender') + 0.3, s: 'impact' }],
    },

    // The King logo under a single spot, the number typed out in yellow.
    contato: {
      html: () => `
        <div class="abs" data-k="spot" style="left:-40px;right:-40px;top:-40px;height:620px;background:radial-gradient(ellipse 45% 60% at 50% 30%, #ffffff22, transparent 70%)"></div>
        <div class="abs sg" data-k="q1" style="left:0;right:0;top:110px;text-align:center;font-size:30px;font-weight:500;color:#ddd">Se essa é a sua rotina,</div>
        <div class="abs" data-k="logo" style="left:0;right:0;top:180px;text-align:center"><img src="${asset(R.marca.logo)}" style="width:150px;height:150px;border-radius:22px"></div>
        <div class="abs h1" data-k="q2" style="left:0;right:0;top:360px;text-align:center;font-size:52px">CHAMA A KING<br>NO WHATSAPP</div>
        <div class="abs" data-k="num" style="left:0;right:0;top:500px;text-align:center"><span class="h1" data-k="digits" style="display:inline-block;min-width:10px;font-size:46px;color:${Y};border:3px solid ${Y};padding:10px 22px"></span></div>
        <div class="abs sg" data-k="ig" style="left:0;right:0;top:600px;text-align:center;font-size:24px;color:#aaa;font-weight:500">${esc(R.marca.instagram)}</div>`,
      frame(t, c, q, A, s) {
        const click = s.start + 0.15;
        st(q('spot'), t > click ? 1 : 0);
        st(q('q1'), ink(t, s.start, s.start + 0.3));
        st(q('logo'), t > click ? 1 : 0, `scale(${back(p(t, click, click + 0.35))})`);
        st(q('q2'), ink(t, A('chama') - 0.15, A('chama') + 0.15), `translateY(${lerp(24, 0, ink(t, A('chama') - 0.15, A('chama') + 0.15))}px)`);
        const num = R.marca.whatsapp, n = Math.round(lerp(0, num.length, p(t, A('WhatsApp') - 0.1, A('WhatsApp') + 0.9)));
        q('digits').textContent = num.slice(0, n) || ' ';
        st(q('num'), t > A('WhatsApp') - 0.12 ? 1 : 0);
        st(q('ig'), ink(t, A('WhatsApp') + 0.9, A('WhatsApp') + 1.2));
      },
      sfx: (c, A, s) => [{ t: s.start + 0.15, s: 'click' }, ...Array.from({ length: 6 }, (_, i) => ({ t: A('WhatsApp') - 0.05 + i * 0.16, s: 'tick' }))],
    },
  },
};
