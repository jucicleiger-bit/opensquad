// "O que a King faz pelo seu negócio" — scenes written for this video only.
// A pitch-deck presentation: numbered slides that push up like a deck,
// alternating black and white pages, yellow only on highlights and the
// final CTA page. Real material from Mercado Carvalho and Frios Modelo.
// Uses the motor's helpers (st, p, eo, eio, back, lerp, esc, asset, R, S).

const Y = '#FFD100';
const ink = (t, a, b) => eio(p(t, a, b));
const foto = (n) => asset(`fotos/${n}.jpg`);
const CLAROS = ['raiox', 'encarte', 'publica', 'fecho'];
const corDe = (tipo) => (tipo === 'fecho' ? Y : CLAROS.includes(tipo) ? '#F4F3EF' : '#0B0B0B');

// Deck push: the old page slides up and away, the new one rises under it.
function transicao(t, s, next, i) {
  const tin = i ? eio(p(t, s.start - 0.2, s.start + 0.2)) : 1;
  const tout = next ? eio(p(t, s.end - 0.2, s.end + 0.2)) : 0;
  const y = 960 * (1 - tin) - 960 * tout;
  st(s.el, 1, `translateY(${y}px)`, { display: tin > 0 && tout < 1 ? 'block' : 'none', filter: 'none', background: corDe(s.c.tipo) });
}

// Caption in the deck's type, the spoken word underlined; dark on light pages.
function legenda(t, chunk, el, k) {
  const tipo = S.find((s) => t >= s.start - 0.2 && t < s.end - 0.2)?.c.tipo; // the page under the caption mid-push
  const claro = CLAROS.includes(tipo);
  const mark = tipo === 'fecho' ? '#111' : Y;
  el.style.color = claro ? '#111' : '#fff';
  el.innerHTML = chunk.map((w) => (t >= w.t - 0.03 && t < w.t + w.d ? `<span style="box-shadow:inset 0 -8px 0 ${mark}">${esc(w.w)}</span>` : esc(w.w))).join(' ');
  el.style.opacity = k;
  el.style.transform = `translateY(${lerp(10, 0, eo(k))}px)`;
}

// Slide chrome: section label, deck name, page number and a huge outlined number.
const chrome = (n, label, claro) => `
  <div class="abs mono" style="left:30px;top:30px;font-size:17px;color:${claro ? '#111' : '#fff'}">${n} / ${label}</div>
  <div class="abs mono" style="right:30px;top:30px;font-size:15px;color:${claro ? '#777' : '#888'}">KING · APRESENTAÇÃO</div>
  <div class="abs mono" style="right:30px;bottom:30px;font-size:15px;color:${claro ? '#777' : '#888'}">${n}/06</div>
  <div class="abs big" data-k="num" style="right:-10px;top:40px;-webkit-text-stroke:2px ${claro ? '#0000001a' : '#ffffff1f'}">${n}</div>`;
const enterNum = (q, t, s) => st(q('num'), ink(t, s.start, s.start + 0.5), `translateX(${lerp(60, 0, ink(t, s.start, s.start + 0.5))}px)`);

window.VIDEO = {
  estrelas: false,
  fontes: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=IBM+Plex+Mono:wght@500;600&display=block',
  transicao,
  legenda,
  css: `
    #stage { background: #0B0B0B !important; }
    #vignette { display: none; }
    #cap { top: 820px !important; font: 800 30px 'Bricolage Grotesque', sans-serif !important; font-style: normal !important; text-shadow: none !important; }
    .h { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; letter-spacing: -1.5px; line-height: .95; }
    .mono { font-family: 'IBM Plex Mono', monospace; font-weight: 600; letter-spacing: 1px; }
    .big { font: 800 260px/1 'Bricolage Grotesque', sans-serif; color: transparent; letter-spacing: -8px; }
    .shot { position: absolute; border-radius: 14px; overflow: hidden; box-shadow: 0 18px 40px #0006; }
    .shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .hl { background: linear-gradient(${Y}, ${Y}) no-repeat 0 85% / var(--w, 0%) 40%; }
  `,
  tipos: {
    // The first line is already on screen at frame 0.
    abertura: {
      html: () => `
        <div class="abs mono" style="left:30px;top:30px;font-size:17px;color:#888">KING ASSESSORIA MKT</div>
        <div class="abs h" data-k="a" style="left:36px;top:250px;font-size:62px;color:#fff">VOCÊ CUIDA<br>DA LOJA.</div>
        <div class="abs h" data-k="b" style="left:36px;top:430px;font-size:46px;color:#fff">A GENTE CUIDA DE<br>FAZER ELA <span class="hl" data-k="hl" style="color:#fff">APARECER.</span></div>
        <div class="abs" data-k="logo" style="left:36px;top:690px;display:flex;align-items:center;gap:12px"><img src="${asset(R.marca.logo)}" style="width:54px;height:54px;border-radius:10px"><span class="mono" style="color:#aaa;font-size:16px">${esc(R.marca.instagram)}</span></div>`,
      frame(t, c, q, A, s) {
        st(q('a'), 1, `translateY(${lerp(14, 0, ink(t, 0, 0.5))}px)`);
        const b = ink(t, A('A') - 0.15, A('A') + 0.25);
        st(q('b'), b, `translateY(${lerp(30, 0, b)}px)`);
        q('hl').style.setProperty('--w', `${ink(t, A('aparecer') - 0.05, A('aparecer') + 0.35) * 100}%`);
        q('hl').style.color = t > A('aparecer') + 0.2 ? '#111' : '#fff';
        st(q('logo'), ink(t, A('aparecer'), A('aparecer') + 0.3));
      },
      sfx: (c, A) => [{ t: A('aparecer') - 0.05, s: 'impact' }],
    },

    // A checklist ticks off as each item is named.
    raiox: {
      html: () => `${chrome('01', 'RAIO-X', true)}
        <div class="abs h" data-k="t" style="left:36px;top:150px;font-size:50px;color:#111">A GENTE<br>CONHECE SEU<br>NEGÓCIO.</div>
        ${['Produtos', 'Ofertas', 'Tom de voz', 'Pilares de conteúdo'].map((w, i) => `<div class="abs mono" data-k="r${i}" style="left:36px;top:${380 + i * 82}px;display:flex;align-items:center;gap:18px;font-size:30px;color:#111">
            <span data-k="b${i}" style="width:44px;height:44px;border:3px solid #111;display:grid;place-items:center;font:900 30px sans-serif">✓</span>${w}</div>`).join('')}`,
      frame(t, c, q, A, s) {
        enterNum(q, t, s);
        const tt = ink(t, A('conhece') - 0.3, A('conhece') + 0.1);
        st(q('t'), tt, `translateY(${lerp(24, 0, tt)}px)`);
        const at = [A('produtos'), A('ofertas'), A('jeito'), A('cliente')];
        at.forEach((a, i) => {
          st(q(`r${i}`), ink(t, s.start + 0.4 + i * 0.12, s.start + 0.7 + i * 0.12) * (t < a - 0.1 ? 0.35 : 1));
          const k = p(t, a - 0.1, a + 0.12);
          q(`b${i}`).style.background = k > 0 ? Y : 'transparent';
          q(`b${i}`).style.color = k > 0 ? '#111' : 'transparent';
          q(`b${i}`).style.transform = `scale(${k > 0 ? back(k) : 1})`;
        });
      },
      sfx: (c, A) => ['produtos', 'ofertas', 'jeito', 'cliente'].map((w) => ({ t: A(w) - 0.1, s: 'tick' })),
    },

    // Real Stories ride a conveyor, one per weekday.
    esteira: {
      html: () => `${chrome('02', 'TODO DIA', false)}
        <div class="abs h" data-k="t" style="left:36px;top:110px;font-size:52px;color:#fff">STORY NOVO,<br><span style="color:${Y}">TODO DIA.</span></div>
        <div class="abs" data-k="belt" style="left:0;top:330px;height:420px;width:2000px">
          ${['s1', 's2', 's3', 's4', 's5', 's6', 's1', 's2'].map((n, i) => `<div class="abs mono" style="left:${i * 200}px;top:0;width:180px;text-align:center;color:${Y};font-size:18px">${['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM', 'SEG'][i]}</div>
            <div class="shot" style="left:${i * 200}px;top:34px;width:180px;height:320px"><img src="${foto(n)}"></div>`).join('')}
        </div>`,
      frame(t, c, q, A, s) {
        enterNum(q, t, s);
        st(q('belt'), 1, `translateX(${40 - (t - s.start) * 170}px)`);
        const tt = ink(t, A('todo') - 0.3, A('todo') + 0.1);
        st(q('t'), tt, `translateY(${lerp(24, 0, tt)}px)`);
      },
      sfx: (c, A) => [{ t: A('Story') - 0.1, s: 'pop' }],
    },

    // The real weekly flyer, its products lighting up one by one.
    encarte: {
      html: () => `${chrome('03', 'ENCARTE', true)}
        <div class="shot" data-k="enc" style="left:36px;top:110px;width:270px;height:480px"><img src="${foto('encarte')}">
          ${[0, 1, 2, 3, 4, 5].map((i) => `<div data-k="c${i}" style="position:absolute;left:${[5, 51][i % 2]}%;top:${[19.5, 43.5, 67.5][Math.floor(i / 2)]}%;width:44%;height:23%;border:4px solid ${Y};border-radius:10px;box-shadow:0 0 0 3px #111"></div>`).join('')}
        </div>
        <div class="abs h" data-k="ate" style="left:330px;top:150px;font-size:34px;color:#111">ATÉ</div>
        <div class="abs h" data-k="n" style="left:322px;top:180px;font-size:170px;color:#111">12</div>
        <div class="abs h" data-k="pr" style="left:330px;top:350px;font-size:34px;color:#111">PRODUTOS<br><span class="mono" style="font-size:18px;color:#777">por semana</span></div>
        <div class="abs mono" data-k="ig" style="left:330px;top:470px;background:#111;color:#fff;padding:8px 14px;font-size:20px">Instagram ✓</div>
        <div class="abs mono" data-k="wa" style="left:330px;top:530px;background:${Y};color:#111;padding:8px 14px;font-size:20px">Status WhatsApp ✓</div>`,
      frame(t, c, q, A, s) {
        enterNum(q, t, s);
        const e = ink(t, s.start, s.start + 0.45);
        st(q('enc'), e, `rotate(${lerp(6, -2, e)}deg) scale(${lerp(0.92, 1, e)})`);
        for (let i = 0; i < 6; i += 1) {
          const a = A('encarte') + 0.1 + i * 0.16;
          q(`c${i}`).style.opacity = t >= a && t < a + 0.5 ? 1 : 0;
        }
        const n = A('doze') - 0.1;
        st(q('ate'), ink(t, n - 0.3, n));
        st(q('n'), ink(t, n, n + 0.2), `scale(${back(p(t, n, n + 0.3))})`);
        q('n').textContent = Math.max(1, Math.round(lerp(1, 12, eo(p(t, n, n + 0.6)))));
        st(q('pr'), ink(t, A('produtos') - 0.2, A('produtos') + 0.1));
        [['ig', 'Instagram'], ['wa', 'Status']].forEach(([k, w]) => { const kk = p(t, A(w) - 0.15, A(w) + 0.1); st(q(k), kk, `scale(${back(kk)})`); });
      },
      sfx: (c, A) => [{ t: A('doze') - 0.1, s: 'zap' }, { t: A('Instagram') - 0.15, s: 'pop' }, { t: A('Status') - 0.15, s: 'pop' }],
    },

    // Institutional posts and a special date fan out like a hand of cards.
    leque: {
      html: () => `${chrome('04', 'SUA MARCA', false)}
        <div class="abs h" data-k="t" style="left:36px;top:110px;font-size:46px;color:#fff">QUEM É<br><span style="color:${Y}">A SUA LOJA.</span></div>
        ${['data', 'rotina', 'compra'].map((n, i) => `<div class="shot" data-k="f${i}" style="left:165px;top:290px;width:210px;height:373px;transform-origin:50% 120%"><img src="${foto(n)}"></div>`).join('')}`,
      frame(t, c, q, A, s) {
        enterNum(q, t, s);
        const open = [A('Data'), A('post'), A('mostra')];
        open.forEach((a, i) => {
          const k = eo(p(t, a - 0.2, a + 0.25));
          const ang = [-16, 0, 16][i], dx = [-120, 0, 120][i];
          st(q(`f${i}`), k, `translateX(${dx * k}px) rotate(${ang * k}deg) translateY(${lerp(80, 0, k)}px)`, { zIndex: i === 1 ? 3 : 2 });
        });
        const tt = ink(t, A('quem') - 0.3, A('quem') + 0.1);
        st(q('t'), tt, `translateY(${lerp(24, 0, tt)}px)`);
      },
      sfx: (c, A) => ['Data', 'post', 'mostra'].map((w) => ({ t: A(w) - 0.2, s: 'pop' })),
    },

    // Tap "Aprovar", then the posts drop into their time slots.
    publica: {
      html: () => `${chrome('05', 'PUBLICAÇÃO', true)}
        <div class="abs" data-k="card" style="left:36px;top:110px;width:230px;background:#fff;border:2px solid #111;border-radius:16px;padding:12px;box-shadow:0 14px 30px #0002">
          <div style="height:287px;border-radius:10px;overflow:hidden"><img src="${foto('feed')}" style="width:100%;height:100%;object-fit:cover"></div>
          <div data-k="btn" class="mono" style="margin-top:12px;text-align:center;padding:10px;border-radius:10px;background:#111;color:#fff;font-size:20px">Aprovar</div>
        </div>
        <div class="abs" data-k="tap" style="left:120px;top:440px;width:60px;height:60px;border-radius:50%;border:4px solid ${Y}"></div>
        ${['08:00', '12:00', '18:00'].map((h, i) => `<div class="abs mono" style="left:300px;top:${130 + i * 150}px;font-size:22px;color:#111">${h}</div>
          <div class="abs" style="left:300px;top:${160 + i * 150}px;width:200px;height:2px;background:#0002"></div>
          <div class="shot" data-k="p${i}" style="left:390px;top:${100 + i * 150}px;width:76px;height:135px"><img src="${foto(['s3', 's5', 'feed'][i])}"></div>`).join('')}
        <div class="abs h" data-k="sem" style="left:36px;top:560px;font-size:34px;color:#111">SEM LARGAR<br>O <span style="box-shadow:inset 0 -12px 0 ${Y}">BALCÃO.</span></div>`,
      frame(t, c, q, A, s) {
        enterNum(q, t, s);
        st(q('card'), ink(t, s.start, s.start + 0.4), `translateY(${lerp(30, 0, ink(t, s.start, s.start + 0.4))}px)`);
        const ap = A('aprova');
        const tap = p(t, ap - 0.1, ap + 0.35);
        st(q('tap'), tap > 0 && tap < 1 ? 1 - tap : 0, `scale(${lerp(0.4, 1.6, tap)})`);
        const ok = t > ap + 0.05;
        q('btn').textContent = ok ? 'Aprovado ✓' : 'Aprovar';
        q('btn').style.background = ok ? Y : '#111';
        q('btn').style.color = ok ? '#111' : '#fff';
        for (let i = 0; i < 3; i += 1) {
          const a = A('publica') - 0.1 + i * 0.3, k = p(t, a, a + 0.3);
          st(q(`p${i}`), k > 0 ? 1 : 0, `translateY(${lerp(-200, 0, k * k)}px) rotate(${lerp(-10, 0, k)}deg)`);
        }
        const sm = ink(t, A('sem') - 0.2, A('sem') + 0.15);
        st(q('sem'), sm, `translateY(${lerp(20, 0, sm)}px)`);
      },
      sfx: (c, A) => [{ t: A('aprova') - 0.05, s: 'click' }, ...[0, 1, 2].map((i) => ({ t: A('publica') + 0.15 + i * 0.3, s: 'thud' }))],
    },

    // Two growth paths: follows coming in, and WhatsApp messages arriving.
    anuncios: {
      html: () => `${chrome('06', 'ANÚNCIOS', false)}
        <div class="abs h" data-k="t" style="left:36px;top:110px;font-size:50px;color:#fff">HORA DE<br><span style="color:${Y}">CRESCER.</span></div>
        <div class="abs mono" style="left:36px;top:290px;color:#888;font-size:17px">SEGUIDORES</div>
        ${[0, 1, 2].map((i) => `<div class="abs" data-k="u${i}" style="left:36px;top:${325 + i * 74}px;width:220px;display:flex;align-items:center;gap:10px;background:#1a1a1a;border-radius:12px;padding:10px">
            <span style="width:40px;height:40px;border-radius:50%;background:#333;display:grid;place-items:center;font-size:22px">${['🧑', '👩', '🧔'][i]}</span>
            <span data-k="fb${i}" class="mono" style="margin-left:auto;font-size:15px;padding:6px 10px;border-radius:8px;background:${Y};color:#111">Seguir</span></div>`).join('')}
        <div class="abs mono" style="left:290px;top:290px;color:#888;font-size:17px">WHATSAPP</div>
        ${['Oi! Vi o anúncio 👋', 'Ainda tem a oferta?', 'Vocês entregam?'].map((m, i) => `<div class="abs" data-k="m${i}" style="left:290px;top:${325 + i * 96}px;max-width:220px;background:#1f3d2b;color:#e8ffe8;border-radius:14px 14px 14px 4px;padding:10px 14px;font:600 16px 'IBM Plex Mono'">${m}</div>`).join('')}`,
      frame(t, c, q, A, s) {
        enterNum(q, t, s);
        const tt = ink(t, A('crescer') - 0.3, A('crescer') + 0.1);
        st(q('t'), tt, `translateY(${lerp(24, 0, tt)}px)`);
        for (let i = 0; i < 3; i += 1) {
          const a = A('seguidor') - 0.3 + i * 0.25, k = p(t, a, a + 0.25);
          st(q(`u${i}`), k, `translateX(${lerp(-40, 0, eo(k))}px)`);
          const f = t > a + 0.35;
          q(`fb${i}`).textContent = f ? 'Seguindo ✓' : 'Seguir';
          q(`fb${i}`).style.background = f ? '#333' : Y;
          q(`fb${i}`).style.color = f ? '#fff' : '#111';
          const b = A('cliente') - 0.2 + i * 0.35, m = p(t, b, b + 0.25);
          st(q(`m${i}`), m, `translateY(${lerp(20, 0, eo(m))}px) scale(${back(m)})`);
        }
      },
      sfx: (c, A) => [...[0, 1, 2].map((i) => ({ t: A('seguidor') + 0.05 + i * 0.25, s: 'tick' })), ...[0, 1, 2].map((i) => ({ t: A('cliente') - 0.2 + i * 0.35, s: 'pop' }))],
    },

    // The last page is the only yellow one: logo, question, number.
    fecho: {
      html: () => `
        <div class="abs mono" style="left:30px;top:30px;font-size:17px;color:#111">KING ASSESSORIA MKT</div>
        <div class="abs" data-k="logo" style="left:36px;top:150px"><img src="${asset(R.marca.logo)}" style="width:120px;height:120px;border-radius:20px;background:#111"></div>
        <div class="abs h" data-k="q" style="left:36px;top:310px;font-size:64px;color:#111">VAMOS<br>CONVERSAR?</div>
        <div class="abs" data-k="num" style="left:36px;top:480px"><span class="h" style="display:inline-block;background:#111;color:#fff;padding:14px 22px;border-radius:14px;font-size:42px">${esc(R.marca.whatsapp)}</span></div>
        <div class="abs mono" data-k="sub" style="left:36px;top:580px;font-size:20px;color:#111">WhatsApp · ${esc(R.marca.instagram)}</div>`,
      frame(t, c, q, A, s) {
        const l = p(t, s.start + 0.1, s.start + 0.45);
        st(q('logo'), l, `scale(${back(l)})`);
        const qq = ink(t, s.start + 0.2, s.start + 0.55);
        st(q('q'), qq, `translateY(${lerp(30, 0, qq)}px)`);
        const n = p(t, A('Chama') - 0.15, A('Chama') + 0.15);
        st(q('num'), n, `scale(${back(n) * (1 + Math.max(0, Math.sin((t - A('Chama')) * 5)) * 0.03 * (n === 1 ? 1 : 0))})`);
        st(q('sub'), ink(t, A('WhatsApp') - 0.1, A('WhatsApp') + 0.2));
      },
      sfx: (c, A, s) => [{ t: s.start + 0.1, s: 'pop' }, { t: A('Chama') - 0.15, s: 'impact' }, { t: A('WhatsApp'), s: 'ding' }],
    },
  },
};
