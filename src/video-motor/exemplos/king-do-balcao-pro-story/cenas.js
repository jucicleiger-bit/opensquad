// "Do balcão pro Story" — scenes written for this video only.
// A light design desk; real before/after pairs from clients' approved
// Stories; Instagram-Stories language (cube swipe, progress bars, link
// sticker). Identity from King's Raio-X: black/white, #FFD100 highlights.
// Uses the motor's helpers (st, p, eo, eio, back, lerp, esc, asset, R, S).

const Y = '#FFD100';
const ink = (t, a, b) => eio(p(t, a, b));
const foto = (n) => asset(`fotos/${n}.jpg`);
// Main example (Mercado Carvalho) and the cube faces (Frios Modelo + Carvalho).
const MAIN = 'espeto';
const FACES = [['bacon', 'FRIOS', 'frios'], ['galao', 'BEBIDAS', 'bebidas'], ['bolacha', 'MERCEARIA', 'mercearia']];
// A raw photo that isn't 9:16, posted as-is: blurred copy behind, photo in the middle.
const crua = (n) => `<div style="position:absolute;inset:0;background:url(${foto(n)}) center/cover;filter:blur(18px) brightness(.8);transform:scale(1.2)"></div><img src="${foto(n)}" style="position:relative;object-fit:contain">`;

// Stories cube: the old face turns away around its right edge, the new one
// turns in around its left edge.
function transicao(t, s, next, i) {
  const tin = i ? eio(p(t, s.start - 0.18, s.start + 0.22)) : 1;
  const tout = next ? eio(p(t, s.end - 0.18, s.end + 0.22)) : 0;
  let tr = '', origin = '50% 50%', shade = 1;
  if (tin < 1) { tr = `translateX(${540 * (1 - tin)}px) rotateY(${85 * (1 - tin)}deg)`; origin = '0% 50%'; shade = lerp(0.6, 1, tin); }
  if (tout > 0) { tr = `translateX(${-540 * tout}px) rotateY(${-85 * tout}deg)`; origin = '100% 50%'; shade = lerp(1, 0.6, tout); }
  const visible = tin > 0 && tout < 1;
  st(s.el, 1, tr || 'none', { display: visible ? 'block' : 'none', transformOrigin: origin, filter: shade < 1 ? `brightness(${shade})` : 'none' });
}

// Caption as a Stories text sticker: black pill, spoken word in yellow.
function legenda(t, chunk, el, k) {
  el.innerHTML = `<span class="pill-cap">${chunk.map((w) => (t >= w.t - 0.03 && t < w.t + w.d ? `<b style="color:${Y}">${esc(w.w)}</b>` : esc(w.w))).join(' ')}</span>`;
  el.style.opacity = k;
  el.style.transform = `scale(${lerp(0.9, 1, eo(k))})`;
}

// Story progress bars across the top, one per scene, like a real Story.
function quadro(t) {
  let bars = document.getElementById('bars');
  if (!bars) {
    bars = document.createElement('div');
    bars.id = 'bars';
    bars.innerHTML = S.map(() => '<i><u></u></i>').join('');
    document.getElementById('stage').appendChild(bars);
  }
  [...bars.children].forEach((b, i) => { b.firstChild.style.width = `${p(t, S[i].start, S[i].end) * 100}%`; });
}

// A hand-drawn marker loop (SVG ellipse that draws itself).
const loop = (k, cx, cy, rx, ry) => `<svg class="abs" data-k="${k}" viewBox="0 0 540 960" style="left:0;top:0;width:540px;height:960px;overflow:visible">
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${Y}" stroke-width="7" stroke-linecap="round" transform="rotate(-8 ${cx} ${cy})" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>`;
const draw = (svg, k) => { svg.querySelector('ellipse').style.strokeDashoffset = 100 - k * 100; };

window.VIDEO = {
  estrelas: false,
  fontes: 'https://fonts.googleapis.com/css2?family=Unbounded:wght@700;900&family=Manrope:wght@600;800&display=block',
  transicao,
  legenda,
  quadro,
  css: `
    #stage { background-color: #EFEDE6 !important; background-image: linear-gradient(#0000000d 1px, transparent 1px), linear-gradient(90deg, #0000000d 1px, transparent 1px) !important; background-size: 30px 30px !important; }
    #vignette { display: none; }
    #cam { perspective: 1400px !important; }
    .scene { background-color: #EFEDE6; background-image: linear-gradient(#0000000d 1px, transparent 1px), linear-gradient(90deg, #0000000d 1px, transparent 1px); background-size: 30px 30px; }
    #cap { top: 806px !important; font: 800 30px Manrope, sans-serif !important; font-style: normal !important; text-shadow: none !important; color: #fff !important; }
    .pill-cap { display: inline-block; background: #111; padding: 8px 18px; border-radius: 16px; }
    #bars { position: absolute; left: 14px; right: 14px; top: 12px; display: flex; gap: 5px; z-index: 70; }
    #bars i { flex: 1; height: 4px; border-radius: 3px; background: #0000001f; overflow: hidden; }
    #bars u { display: block; height: 100%; background: #111; text-decoration: none; }
    .un { font-family: Unbounded, sans-serif; font-weight: 900; color: #111; letter-spacing: -1px; line-height: 1; }
    .mr { font-family: Manrope, sans-serif; font-weight: 800; color: #111; }
    .card { position: absolute; background: #fff; padding: 10px 10px 34px; box-shadow: 0 18px 40px #0003; }
    .card img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .tag { position: absolute; font: 800 22px Manrope, sans-serif; background: ${Y}; color: #111; padding: 6px 12px; white-space: nowrap; }
    .story { position: absolute; border-radius: 18px; overflow: hidden; box-shadow: 0 22px 50px #0004; background: #111; }
    .story img { display: block; width: 100%; height: 100%; object-fit: cover; }
  `,
  tipos: {
    // A phone gallery; the client's raw photo is picked out of the grid.
    galeria: {
      html: () => `
        <div class="abs mr" style="left:30px;top:40px;font-size:22px;color:#777">Galeria · Recentes</div>
        ${Array.from({ length: 12 }, (_, i) => `<div class="abs" data-k="g${i}" style="left:${30 + (i % 3) * 162}px;top:${84 + Math.floor(i / 3) * 162}px;width:154px;height:154px;border-radius:8px;background:${['#d8d4ca', '#cfcabd', '#dcd8cf'][i % 3]}"></div>`).join('')}
        <div class="card" data-k="pick" style="left:30px;top:84px;width:154px;height:154px;padding:0;box-shadow:none"><img src="${foto(`${MAIN}-antes`)}"></div>
        <div class="abs mr" data-k="file" style="left:0;right:0;top:560px;text-align:center;font-size:20px;color:#666;font-weight:600">IMG-20260929-WA0007.jpg · 96 KB</div>`,
      frame(t, c, q, A, s) {
        const k = eio(p(t, s.start + 0.15, s.start + 0.8));
        for (let i = 0; i < 12; i += 1) st(q(`g${i}`), lerp(1, 0.25, k));
        // From its grid cell to the middle of the desk, tilting as it lands.
        st(q('pick'), 1, `translate(${lerp(0, 120, k)}px, ${lerp(0, 40, k)}px) rotate(${lerp(0, -5, k)}deg)`, {
          width: `${lerp(154, 300, k)}px`, height: `${lerp(154, 406, k)}px`, padding: `${lerp(0, 10, k)}px ${lerp(0, 10, k)}px ${lerp(0, 34, k)}px`, boxShadow: k > 0.1 ? '0 18px 40px #0003' : 'none',
        });
        st(q('file'), ink(t, A('produto') - 0.3, A('produto')));
      },
      sfx: (c, A, s) => [{ t: s.start + 0.15, s: 'pop' }],
    },

    // Yellow marker loops call out what is wrong with the photo.
    marcacoes: {
      html: () => `
        <div class="card" data-k="ph" style="left:110px;top:150px;width:320px;height:430px;transform:rotate(-3deg)"><img src="${foto(`${MAIN}-antes`)}"></div>
        ${loop('l0', 250, 250, 135, 85)}${loop('l1', 360, 430, 85, 120)}${loop('l2', 270, 600, 165, 42)}
        <div class="tag" data-k="t0" style="left:260px;top:120px">sem nome</div>
        <div class="tag" data-k="t1" style="left:380px;top:560px">sem preço</div>
        <div class="tag" data-k="t2" style="left:40px;top:650px">sem chamada</div>`,
      frame(t, c, q, A, s) {
        st(q('ph'), 1, `rotate(-3deg) scale(${lerp(1, 1.04, p(t, s.start, s.end))})`);
        ['balcão', 'correria', 'jeito'].forEach((w, i) => {
          const at = A(w) - 0.15;
          draw(q(`l${i}`), eo(p(t, at, at + 0.35)));
          const k = p(t, at + 0.2, at + 0.45);
          st(q(`t${i}`), k, `rotate(${[-4, 3, -2][i]}deg) scale(${back(k)})`);
        });
      },
      sfx: (c, A) => ['balcão', 'correria', 'jeito'].map((w) => ({ t: A(w) - 0.1, s: 'tick' })),
    },

    // Layout guides draw, then the finished Story fills in band by band.
    montagem: {
      html: () => `
        <div class="card" data-k="raw" style="left:24px;top:620px;width:110px;height:136px;padding:5px 5px 18px;transform:rotate(-8deg)"><img src="${foto(`${MAIN}-antes`)}"></div>
        <div class="abs" style="left:120px;top:96px;width:300px;height:533px;border:2px dashed #0003;border-radius:18px"></div>
        ${[0.25, 0.7].map((y, i) => `<div class="abs" data-k="h${i}" style="left:120px;top:${96 + 533 * y}px;width:300px;height:2px;background:${Y};transform-origin:0 50%"></div>`).join('')}
        <div class="abs" data-k="v" style="left:150px;top:96px;width:2px;height:533px;background:${Y};transform-origin:50% 0"></div>
        ${[[0, 25], [25, 70], [70, 100]].map(([a, b], i) => `<div class="story" data-k="b${i}" style="left:120px;top:96px;width:300px;height:533px;clip-path:inset(${a}% 0 ${100 - b}% 0);border-radius:18px"><img src="${foto(`${MAIN}-depois`)}"></div>`).join('')}
        <div class="abs mr" data-k="lbl" style="left:0;right:0;top:648px;text-align:center;font-size:22px">montando o Story…</div>`,
      frame(t, c, q, A, s) {
        const g = ink(t, s.start + 0.1, s.start + 0.5);
        q('h0').style.transform = `scaleX(${g})`; q('h1').style.transform = `scaleX(${g})`; q('v').style.transform = `scaleY(${g})`;
        ['olha', 'fazer', 'ela'].forEach((w, i) => {
          const k = eo(p(t, A(w) - 0.2, A(w) + 0.15));
          st(q(`b${i}`), k, `translateX(${lerp(i % 2 ? 60 : -60, 0, k)}px)`);
        });
        const done = p(t, A('ela'), A('ela') + 0.2);
        ['h0', 'h1', 'v'].forEach((k) => { q(k).style.opacity = 1 - done; });
        st(q('lbl'), ink(t, s.start, s.start + 0.3));
        q('lbl').textContent = done > 0.5 ? 'pronto ✓' : 'montando o Story…';
      },
      sfx: (c, A) => ['olha', 'fazer', 'ela'].map((w) => ({ t: A(w) - 0.2, s: 'click' })),
    },

    // Before/after slider: the yellow handle drags across, then holds in the middle.
    regua: {
      html: () => `
        <div class="abs un" data-k="t1" style="left:0;right:0;top:40px;text-align:center;font-size:32px">MESMO PRODUTO.</div>
        <div class="abs un" data-k="t2" style="left:0;right:0;top:40px;text-align:center;font-size:32px">OUTRA <span style="background:${Y};padding:0 8px">PRESENÇA.</span></div>
        <div class="story" style="left:105px;top:100px;width:330px;height:587px"><img src="${foto(`${MAIN}-depois`)}"></div>
        <div class="story" data-k="before" style="left:105px;top:100px;width:330px;height:587px;box-shadow:none;display:grid">${crua(`${MAIN}-antes`)}</div>
        <div class="abs" data-k="handle" style="left:105px;top:100px;width:6px;height:587px;margin-left:-3px;background:${Y}">
          <div style="position:absolute;left:-22px;top:270px;width:50px;height:50px;border-radius:50%;background:${Y};box-shadow:0 6px 16px #0004;display:grid;place-items:center;font:900 22px Manrope">↔</div></div>
        <div class="abs mr" style="left:118px;top:112px;background:#111;color:#fff;padding:4px 10px;font-size:18px">ANTES</div>
        <div class="abs mr" style="left:338px;top:112px;background:${Y};padding:4px 10px;font-size:18px">DEPOIS</div>`,
      frame(t, c, q, A, s) {
        const a = A('Mesmo') - 0.1, b = A('produto') + 0.3, o = A('Outra'), pr = A('presença') + 0.4;
        let x = 100;
        if (t >= a) x = lerp(100, 18, eio(p(t, a, b)));
        if (t >= b) x = lerp(18, 78, eio(p(t, b, o)));
        if (t >= o) x = lerp(78, 50, eio(p(t, o, pr)));
        q('before').style.clipPath = `inset(0 ${100 - x}% 0 0)`;
        q('handle').style.transform = `translateX(${330 * x / 100}px)`;
        st(q('t1'), 1 - p(t, o - 0.15, o));
        st(q('t2'), ink(t, o - 0.1, o + 0.2), `scale(${back(p(t, o - 0.1, o + 0.2))})`);
      },
      sfx: (c, A) => [{ t: A('Mesmo') - 0.1, s: 'whoosh' }, { t: A('produto') + 0.3, s: 'whoosh' }, { t: A('presença') - 0.1, s: 'impact' }],
    },

    // More real Stories turn in like a Stories cube, each with its raw photo.
    cubo: {
      html: () => `${FACES.map(([n], i) => `<div class="abs" data-k="F${i}" style="left:105px;top:110px;width:330px;height:587px;transform-style:preserve-3d">
            <div class="story" style="left:0;top:0;width:330px;height:587px"><img src="${foto(`${n}-depois`)}"></div>
            <div class="card" data-k="R${i}" style="left:-70px;top:400px;width:140px;height:120px;padding:5px 5px 22px"><img src="${foto(`${n}-antes`)}" style="object-fit:contain;background:#fff"></div>
            <div class="abs mr" style="left:-66px;top:530px;font-size:16px;color:#444;transform:rotate(-6deg)">antes</div>
          </div>`).join('')}
        ${FACES.map(([, label], i) => `<div class="tag" data-k="c${i}" style="left:0;right:0;margin:auto;width:max-content;top:52px;font-size:24px">${label}</div>`).join('')}`,
      frame(t, c, q, A, s) {
        // Face i is on screen from its turn-in (at the previous word) to the next turn.
        const turns = FACES.slice(1).map(([, , w]) => eio(p(t, A(w) - 0.35, A(w) + 0.05)));
        FACES.forEach((_, i) => {
          const tin = i ? turns[i - 1] : 1, tout = turns[i] ?? 0;
          let tr = 'none', origin = '50% 50%';
          if (tin < 1) { tr = `translateX(${330 * (1 - tin)}px) rotateY(${80 * (1 - tin)}deg)`; origin = '0% 50%'; }
          if (tout > 0) { tr = `translateX(${-330 * tout}px) rotateY(${-80 * tout}deg)`; origin = '100% 50%'; }
          st(q(`F${i}`), tin > 0 && tout < 1 ? 1 : 0, tr, { transformOrigin: origin });
          const shown = i ? A(FACES[i][2]) + 0.1 : s.start + 0.3;
          st(q(`R${i}`), ink(t, shown, shown + 0.3), 'rotate(-6deg)');
        });
        FACES.forEach(([, , w], i) => {
          const at = A(w) - 0.1, end = FACES[i + 1] ? A(FACES[i + 1][2]) - 0.1 : s.end + 1;
          const k = p(t, at, at + 0.2);
          st(q(`c${i}`), t < end ? k : 0, `rotate(${[-3, 2, -2][i]}deg) scale(${back(k)})`);
        });
      },
      sfx: (c, A) => [...FACES.slice(1).map(([, , w]) => ({ t: A(w) - 0.35, s: 'whoosh' })), ...FACES.map(([, , w]) => ({ t: A(w) - 0.1, s: 'pop' }))],
    },

    // The whole service in one line: photo + info in, ready Story out.
    fluxo: {
      html: () => `
        <div class="abs" data-k="m1" style="left:40px;top:60px;background:#fff;border-radius:16px 16px 16px 4px;padding:8px;box-shadow:0 8px 20px #0002"><img src="${foto(`${MAIN}-antes`)}" style="display:block;width:124px;height:154px;object-fit:cover;border-radius:10px"></div>
        <div class="abs mr" data-k="m2" style="left:180px;top:150px;width:320px;background:#fff;border-radius:16px 16px 16px 4px;padding:12px 16px;font-size:21px;font-weight:600;box-shadow:0 8px 20px #0002">Espeto assado com mandioca, R$ 7,99 👍</div>
        <svg class="abs" data-k="arrow" viewBox="0 0 540 960" style="left:0;top:0;width:540px;height:960px">
          <path d="M150 250 C 160 330, 230 330, 250 390" fill="none" stroke="#111" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          <path d="M232 380 L252 396 L262 372" fill="none" stroke="#111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="story" data-k="out" style="left:180px;top:390px;width:200px;height:356px"><img src="${foto(`${MAIN}-depois`)}"></div>
        <div class="abs mr" data-k="ok" style="left:250px;top:690px;background:${Y};padding:8px 14px;font-size:22px;box-shadow:0 8px 20px #0003">✓ pronto pra postar</div>`,
      frame(t, c, q, A, s) {
        const m1 = p(t, s.start + 0.1, s.start + 0.4), m2 = p(t, A('informações') - 0.2, A('informações') + 0.1);
        st(q('m1'), m1, `translateY(${lerp(30, 0, eo(m1))}px) scale(${back(m1)})`);
        st(q('m2'), m2, `translateY(${lerp(30, 0, eo(m2))}px) scale(${back(m2)})`);
        const ar = eo(p(t, A('devolve') - 0.2, A('devolve') + 0.3));
        q('arrow').querySelector('path').style.strokeDashoffset = 100 - ar * 100;
        q('arrow').querySelectorAll('path')[1].style.opacity = ar > 0.95 ? 1 : 0;
        const o = p(t, A('Story') - 0.2, A('Story') + 0.15);
        st(q('out'), o, `rotate(${lerp(10, 3, eo(o))}deg) scale(${back(o)})`);
        const k = p(t, A('postar') - 0.15, A('postar') + 0.1);
        st(q('ok'), k, `rotate(-4deg) scale(${back(k)})`);
      },
      sfx: (c, A, s) => [{ t: s.start + 0.1, s: 'pop' }, { t: A('informações') - 0.2, s: 'pop' }, { t: A('devolve') - 0.2, s: 'whoosh' }, { t: A('postar') - 0.15, s: 'ding' }],
    },

    // An empty photo frame for the viewer's own product, then a link sticker.
    adesivo: {
      html: () => `
        <div class="abs" data-k="frame" style="left:150px;top:90px;width:240px;height:300px;border:4px dashed #111;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#fff8">
          <div data-k="cam" style="font-size:64px">📷</div><div class="un" style="font-size:22px;text-align:center">SUA FOTO<br>AQUI</div>
          ${[MAIN, 'bacon', 'galao'].map((n, i) => `<img data-k="f${i}" src="${foto(`${n}-antes`)}" style="position:absolute;inset:8px;width:calc(100% - 16px);height:calc(100% - 16px);object-fit:cover;border-radius:8px;opacity:0">`).join('')}</div>
        <div class="abs" data-k="logo" style="left:0;right:0;top:420px;text-align:center"><img src="${asset(R.marca.logo)}" style="width:110px;height:110px;border-radius:20px;background:#111;box-shadow:0 10px 24px #0003"></div>
        <div class="abs" data-k="stk" style="left:0;right:0;top:560px;text-align:center">
          <span style="display:inline-flex;align-items:center;gap:10px;background:#fff;border-radius:14px;padding:12px 20px;box-shadow:0 10px 26px #0003;font:800 28px Manrope;color:#111">
            <span style="background:${Y};border-radius:8px;padding:2px 8px;font-size:22px">🔗</span>WHATSAPP · ${esc(R.marca.whatsapp)}</span></div>
        <div class="abs mr" data-k="ig" style="left:0;right:0;top:640px;text-align:center;font-size:22px;color:#555;font-weight:600">${esc(R.marca.instagram)}</div>`,
      frame(t, c, q, A, s) {
        const drop = p(t, s.start, s.start + 0.45);
        const lift = eio(p(t, A('Manda') - 0.2, A('Manda') + 0.3));
        st(q('frame'), Math.min(1, drop * 3), `translateY(${lerp(-400, 0, drop * drop) - lift * 10}px) rotate(${lerp(-14, -4, drop)}deg) scale(${lerp(1.15, 1, drop) * lerp(1, 0.9, lift)})`);
        q('frame').style.borderStyle = Math.floor(t * 6) % 2 ? 'dashed' : 'dotted';
        q('cam').style.transform = `translateY(${Math.sin(t * 5) * 5}px)`;
        // "seu produto?": a few real raw photos flash through the empty frame.
        const pr = A('produto') - 0.2;
        [0, 1, 2].forEach((i) => { const a = pr + i * 0.22; q(`f${i}`).style.opacity = t >= a && t < a + 0.22 + (i === 2 ? 0.3 : 0) ? 1 : 0; });
        const l = p(t, A('King') - 0.2, A('King') + 0.1);
        st(q('logo'), l, `scale(${back(l)})`);
        const k = p(t, A('WhatsApp') - 0.15, A('WhatsApp') + 0.15);
        st(q('stk'), k, `rotate(${lerp(-12, -3, eo(k))}deg) scale(${back(k)})`);
        st(q('ig'), ink(t, A('WhatsApp') + 0.4, A('WhatsApp') + 0.7));
      },
      sfx: (c, A, s) => [{ t: s.start + 0.35, s: 'thud' }, { t: A('King') - 0.2, s: 'pop' }, { t: A('WhatsApp') - 0.15, s: 'click' }],
    },
  },
};
