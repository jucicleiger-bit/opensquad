// "Diagnóstico antes do anúncio" — scenes written for this video only.
// A diagnostic monitor: grid screen, mono readouts, a yellow scan line that
// also wipes from one scene to the next. Ad objective: closes on WhatsApp.
// Uses the motor's helpers (st, p, eo, eio, back, lerp, esc, asset, R, S).

const Y = '#FFD100';
const ink = (t, a, b) => eio(p(t, a, b));
const foto = (n) => asset(`fotos/${n}.jpg`);

// Scan wipe: the new scene is revealed top-down behind a yellow line.
function transicao(t, s, next, i) {
  const k = i ? eio(p(t, s.start - 0.15, s.start + 0.3)) : 1;
  const out = next ? p(t, next.start + 0.3, next.start + 0.31) : 0;
  st(s.el, 1, 'none', { display: k > 0 && out < 1 ? 'block' : 'none', clipPath: k < 1 ? `inset(0 0 ${(1 - k) * 100}% 0)` : 'none', zIndex: i, filter: 'none' });
}
function quadro(t) {
  let line = document.getElementById('scan');
  if (!line) {
    line = document.createElement('div');
    line.id = 'scan';
    document.getElementById('stage').appendChild(line);
  }
  const s = S.find((x, i) => i && t > x.start - 0.15 && t < x.start + 0.3);
  if (!s) { line.style.opacity = 0; return; }
  const k = eio(p(t, s.start - 0.15, s.start + 0.3));
  line.style.opacity = 1;
  line.style.transform = `translateY(${k * 960}px)`;
}

// Caption as a terminal line: mono, the spoken word inverted.
function legenda(t, chunk, el, k) {
  el.innerHTML = `<span style="color:${Y}">›</span> ${chunk.map((w) => (t >= w.t - 0.03 && t < w.t + w.d ? `<b style="background:${Y};color:#000;padding:0 4px">${esc(w.w)}</b>` : esc(w.w))).join(' ')}<span style="opacity:${Math.floor(t * 3) % 2}">▌</span>`;
  el.style.opacity = k;
}

const grid = '<div class="abs grid"></div>';

window.VIDEO = {
  estrelas: false,
  fontes: 'https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=JetBrains+Mono:wght@500;700&display=block',
  transicao,
  legenda,
  quadro,
  css: `
    #stage { background: #06080A !important; }
    #vignette { background: radial-gradient(ellipse at 50% 45%, transparent 55%, #000c 100%) !important; }
    .scene { background: #06080A; }
    .grid { inset: 0; background-image: linear-gradient(#ffffff0a 1px, transparent 1px), linear-gradient(90deg, #ffffff0a 1px, transparent 1px); background-size: 36px 36px; }
    #scan { position: absolute; left: 0; right: 0; top: -2px; height: 4px; background: ${Y}; box-shadow: 0 0 18px ${Y}, 0 0 40px ${Y}; z-index: 59; opacity: 0; }
    #cap { left: 34px !important; right: 34px !important; text-align: left !important; top: 800px !important; font: 700 27px 'JetBrains Mono', monospace !important; font-style: normal !important; color: #e8e8e8 !important; text-shadow: none !important; }
    .so { font-family: Sora, sans-serif; font-weight: 800; letter-spacing: -1px; line-height: 1; color: #fff; }
    .mo { font-family: 'JetBrains Mono', monospace; font-weight: 700; }
    .coin { position: absolute; width: 64px; height: 64px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff3b0, ${Y} 45%, #b8860b); display: grid; place-items: center; font: 800 22px Sora; color: #6b4f00; box-shadow: inset 0 -4px 0 #0003; }
  `,
  tipos: {
    // The question, already on screen at frame 0, then a 3-2-1 countdown.
    pergunta: {
      html: () => `${grid}
        <div class="abs mo" style="left:34px;top:60px;color:${Y};font-size:18px">● REC · CHECAGEM RÁPIDA</div>
        <div class="abs so" data-k="t" style="left:34px;top:260px;font-size:74px">ANTES DO<br><span style="color:${Y}">ANÚNCIO</span>…</div>
        <div class="abs" data-k="ring" style="left:340px;top:520px;width:150px;height:150px">
          <svg viewBox="0 0 100 100" style="width:100%;height:100%;transform:rotate(-90deg)"><circle cx="50" cy="50" r="44" fill="none" stroke="#ffffff22" stroke-width="7"/>
            <circle data-k="arc" cx="50" cy="50" r="44" fill="none" stroke="${Y}" stroke-width="7" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg>
          <div class="abs so" data-k="n" style="inset:0;display:grid;place-items:center;font-size:64px">3</div></div>`,
      frame(t, c, q, A, s) {
        st(q('t'), 1, `translateY(${lerp(16, 0, ink(t, 0, 0.4))}px)`);
        const r = A('responde') - 0.1, k = p(t, r, s.end);
        st(q('ring'), ink(t, r - 0.2, r));
        q('arc').style.strokeDashoffset = k * 100;
        q('n').textContent = Math.max(1, 3 - Math.floor(k * 3));
      },
      sfx: (c, A, s) => [0, 1, 2].map((i) => ({ t: A('responde') - 0.1 + i * ((s.end - A('responde')) / 3), s: 'tick' })),
    },

    // The business goes through the scanner while four checks come up "?".
    scan: {
      html: () => `${grid}
        <div class="abs mo" style="left:34px;top:60px;color:#888;font-size:16px">EXAME DO NEGÓCIO</div>
        <div class="abs" style="left:34px;top:100px;width:200px;height:356px;border:2px solid #ffffff33;overflow:hidden">
          <img src="${foto('rotina')}" style="width:100%;height:100%;object-fit:cover;filter:grayscale(.6) brightness(.8)">
          <div data-k="beam" style="position:absolute;left:0;right:0;height:3px;background:${Y};box-shadow:0 0 14px ${Y}"></div></div>
        ${['OFERTA CLARA', 'PÚBLICO CERTO', 'DESTINO DO CLIQUE', 'MENSAGEM QUE CONVENCE'].map((w, i) => `<div class="abs" data-k="r${i}" style="left:250px;right:30px;top:${100 + i * 92}px;border:2px solid #ffffff22;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span class="mo" style="color:#fff;font-size:17px">${w}</span><span class="so" data-k="q${i}" style="font-size:30px;color:${Y}">?</span></div>`).join('')}
        <div class="abs mo" data-k="sum" style="left:34px;top:490px;right:30px;color:${Y};font-size:20px">4 PERGUNTAS · 4 RESPOSTAS?</div>`,
      frame(t, c, q, A, s) {
        q('beam').style.top = `${((t - s.start) * 160) % 356}px`;
        ['oferta', 'quem', 'clica', 'mensagem'].forEach((w, i) => {
          const a = A(w) - 0.25, k = p(t, a, a + 0.25);
          st(q(`r${i}`), k, `translateX(${lerp(40, 0, eo(k))}px)`, { borderColor: k > 0 && (i === 3 || t < A(['quem', 'clica', 'mensagem'][i]) - 0.25) ? Y : '#ffffff22' });
          q(`q${i}`).style.opacity = Math.floor(t * 3) % 2 ? 1 : 0.35;
        });
        st(q('sum'), ink(t, A('enfeita') - 0.2, A('enfeita') + 0.1));
      },
      sfx: (c, A) => ['oferta', 'quem', 'clica', 'mensagem'].map((w) => ({ t: A(w) - 0.25, s: 'tick' })),
    },

    // Coins drop into the dark as the light switches off.
    escuro: {
      html: () => `
        ${Array.from({ length: 9 }, (_, i) => `<div class="coin" data-k="c${i}" style="left:${60 + (i * 53) % 400}px;top:0">R$</div>`).join('')}
        <div class="abs" data-k="dark" style="inset:0;background:radial-gradient(circle at 50% 75%, transparent 0, #000 70%)"></div>
        <div class="abs so" data-k="t1" style="left:34px;top:120px;font-size:48px">ANUNCIAR SEM SABER</div>
        <div class="abs so" data-k="t2" style="left:34px;top:420px;font-size:70px">É DINHEIRO<br><span style="color:${Y}">NO ESCURO.</span></div>`,
      frame(t, c, q, A, s) {
        st(q('t1'), ink(t, s.start, s.start + 0.3));
        for (let i = 0; i < 9; i += 1) {
          const b = s.start + 0.15 + i * 0.22, k = p(t, b, b + 1.1);
          st(q(`c${i}`), k > 0 ? 1 - k * 0.9 : 0, `translateY(${lerp(-80, 820, k * k)}px) rotate(${k * 300 * (i % 2 ? 1 : -1)}deg)`);
        }
        const off = A('escuro') - 0.1;
        q('dark').style.opacity = t < off ? 0.25 : t < off + 0.3 ? [1, 0.3, 1, 0.5, 1][Math.floor((t - off) * 16) % 5] : 1;
        const k2 = ink(t, A('dinheiro') - 0.2, A('dinheiro') + 0.2);
        st(q('t2'), k2, `translateY(${lerp(20, 0, k2)}px)`);
      },
      sfx: (c, A, s) => [...[0, 2, 4, 6].map((i) => ({ t: s.start + 0.5 + i * 0.22, s: 'tick' })), { t: A('escuro') - 0.1, s: 'click' }],
    },

    // The King order: diagnosis first, then the ad.
    ordem: {
      html: () => `${grid}
        <div class="abs mo" style="left:34px;top:60px;color:#888;font-size:16px">O JEITO KING</div>
        <div class="abs" data-k="a" style="left:34px;right:34px;top:170px;border:3px solid ${Y};padding:22px;display:flex;gap:18px;align-items:center">
          <span class="so" style="font-size:72px;color:${Y}">1</span><span class="so" style="font-size:44px">DIAGNÓSTICO</span></div>
        <div class="abs so" data-k="arrow" style="left:0;right:0;top:330px;text-align:center;font-size:60px;color:${Y}">↓</div>
        <div class="abs" data-k="b" style="left:34px;right:34px;top:420px;border:3px solid #ffffff44;padding:22px;display:flex;gap:18px;align-items:center">
          <span class="so" style="font-size:72px;color:#fff">2</span><span class="so" style="font-size:44px">ANÚNCIO</span></div>`,
      frame(t, c, q, A, s) {
        const a = p(t, A('diagnóstico') - 0.25, A('diagnóstico') + 0.05);
        st(q('a'), Math.max(0.3, a), `scale(${a > 0 ? back(a) : 1})`, { background: a > 0.5 ? '#ffd10014' : 'transparent' });
        st(q('arrow'), ink(t, A('Depois') - 0.2, A('Depois')), `translateY(${Math.sin(t * 6) * 6}px)`);
        const b = p(t, A('anúncio') - 0.25, A('anúncio') + 0.05);
        st(q('b'), Math.max(0.3, b), `scale(${b > 0 ? back(b) : 1})`, { borderColor: b > 0.5 ? '#fff' : '#ffffff44' });
      },
      sfx: (c, A) => [{ t: A('diagnóstico') - 0.25, s: 'pop' }, { t: A('anúncio') - 0.25, s: 'pop' }],
    },

    // A heartbeat line runs across the monitor and lands on the number.
    cta: {
      html: () => `${grid}
        <div class="abs" data-k="logo" style="left:34px;top:120px;display:flex;gap:14px;align-items:center"><img src="${asset(R.marca.logo)}" style="width:72px;height:72px;border-radius:14px"><span class="mo" style="color:#bbb;font-size:18px">${esc(R.marca.instagram)}</span></div>
        <svg class="abs" viewBox="0 0 540 200" style="left:0;top:250px;width:540px;height:200px">
          <path data-k="ecg" d="M0 100 L150 100 L175 100 L190 40 L210 165 L228 70 L242 100 L540 100" fill="none" stroke="${Y}" stroke-width="5" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" style="filter:drop-shadow(0 0 8px ${Y})"/></svg>
        <div class="abs so" data-k="t" style="left:34px;top:470px;font-size:46px">VAMOS OLHAR O SEU<br>NEGÓCIO <span style="color:${Y}">JUNTOS?</span></div>
        <div class="abs" data-k="num" style="left:34px;top:610px"><span class="mo" style="display:inline-block;white-space:nowrap;background:${Y};color:#000;font-size:30px;padding:10px 16px">WHATSAPP · ${esc(R.marca.whatsapp)}</span></div>`,
      frame(t, c, q, A, s) {
        st(q('logo'), ink(t, s.start, s.start + 0.3));
        q('ecg').style.strokeDashoffset = 100 - ink(t, s.start, s.start + 1.2) * 100;
        const n = p(t, A('WhatsApp') - 0.15, A('WhatsApp') + 0.15);
        st(q('num'), n, `scale(${back(n)})`);
        st(q('t'), ink(t, A('olhar') - 0.2, A('olhar') + 0.15));
      },
      sfx: (c, A, s) => [{ t: s.start + 0.45, s: 'zap' }, { t: A('WhatsApp') - 0.15, s: 'impact' }, { t: A('juntos'), s: 'ding' }],
    },
  },
};
