// Caption models, picked per video with roteiro.json "legenda": "<nome>"
// (or --legenda <nome> on render.mjs). A video's own VIDEO.legenda is used
// only when no model is picked. Each model gets the current chunk of words
// [{w, t, d}], the caption element and the fade-in k; COR is the brand
// highlight (from the client's visual identity).
const COR = () => (window.R && R.marca && R.marca.cor) || '#FFD100';
const falando = (t, w) => t >= w.t - 0.03 && t < w.t + w.d;

const LEGENDAS = {
  // Plain sentence, white with a soft shadow. No effects.
  simples(t, chunk, el, k) {
    el.className = 'lg-simples';
    el.textContent = chunk.map((w) => w.w).join(' ');
    el.style.opacity = k;
  },

  // Uppercase; the spoken word sits in a brand-color box.
  karaoke(t, chunk, el, k) {
    el.className = 'lg-karaoke';
    el.innerHTML = chunk.map((w) => (falando(t, w) ? `<b style="background:${COR()}">${esc(w.w)}</b>` : `<span>${esc(w.w)}</span>`)).join(' ');
    el.style.opacity = k;
  },

  // One word at a time, big, popping in.
  pop(t, chunk, el) {
    el.className = 'lg-pop';
    const w = chunk.slice().reverse().find((x) => t >= x.t - 0.03) || chunk[0];
    const k = p(t, w.t - 0.03, w.t + 0.12);
    el.innerHTML = `<b style="color:${w.w.length > 6 ? COR() : '#fff'}">${esc(w.w)}</b>`;
    el.style.opacity = 1;
    el.firstChild.style.transform = `scale(${back(k)}) rotate(${(w.t * 7) % 2 > 1 ? -2 : 2}deg)`;
  },

  // Thick black outline; the spoken word bigger and in the brand color.
  destaque(t, chunk, el, k) {
    el.className = 'lg-destaque';
    el.innerHTML = chunk.map((w) => (falando(t, w) ? `<b style="color:${COR()};font-size:1.18em">${esc(w.w)}</b>` : `<span>${esc(w.w)}</span>`)).join(' ');
    el.style.opacity = k;
  },

  // White speech-bubble box with black text.
  caixa(t, chunk, el, k) {
    el.className = 'lg-caixa';
    el.innerHTML = `<span>${chunk.map((w) => (falando(t, w) ? `<b style="box-shadow:inset 0 -6px 0 ${COR()}">${esc(w.w)}</b>` : esc(w.w))).join(' ')}</span>`;
    el.style.opacity = k;
    el.style.transform = `scale(${lerp(0.92, 1, eo(k))})`;
  },
};

const LEGENDAS_CSS = `
  #cap.lg-simples { font: 700 30px Inter, 'Segoe UI', sans-serif !important; color: #fff !important; text-shadow: 0 2px 8px #000c !important; -webkit-text-stroke: 4px #000; paint-order: stroke fill; font-style: normal !important; text-transform: none; }
  #cap.lg-karaoke { font: 900 34px 'Montserrat', 'Segoe UI', sans-serif !important; color: #fff !important; text-transform: uppercase; font-style: normal !important; text-shadow: 0 3px 10px #000c !important; }
  #cap.lg-karaoke span { -webkit-text-stroke: 5px #000; paint-order: stroke fill; }
  #cap.lg-karaoke b { color: #000; padding: 0 8px; border-radius: 6px; text-shadow: none; }
  #cap.lg-pop { font: 900 64px 'Montserrat', 'Segoe UI', sans-serif !important; text-transform: uppercase; font-style: normal !important; text-shadow: none !important; top: 740px !important; }
  #cap.lg-pop b { display: inline-block; -webkit-text-stroke: 3px #000; paint-order: stroke fill; text-shadow: 0 6px 0 #000; }
  #cap.lg-destaque { font: 900 40px 'Montserrat', 'Segoe UI', sans-serif !important; color: #fff !important; text-transform: uppercase; font-style: normal !important; -webkit-text-stroke: 7px #000; paint-order: stroke fill; text-shadow: 0 4px 0 #000 !important; }
  #cap.lg-destaque b, #cap.lg-destaque span { -webkit-text-stroke: 7px #000; paint-order: stroke fill; }
  #cap.lg-caixa { font: 800 28px Inter, 'Segoe UI', sans-serif !important; font-style: normal !important; text-shadow: none !important; }
  #cap.lg-caixa > span { display: inline-block; background: #fff; color: #111; padding: 10px 18px; border-radius: 16px; box-shadow: 0 8px 20px #0005; }
`;
