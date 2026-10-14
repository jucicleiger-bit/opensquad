// Render check for Oferta videos (motionmaxxing's "a script measures, a fail is fixed"):
// seeks the player to each product's price moment and measures the page.
//   checarVideo({ videoDir }) -> { ok, falhas: [...] }
// CLI: node src/video-motor/checar.mjs <videoDir>
/* global process, console, window, document, getComputedStyle, DOMMatrix */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Jimp } from 'jimp';
import { serve } from './render.mjs';

const AREA = { x0: 24, x1: 460, y0: 110, y1: 800 };

// Runs in the page: measures one scene at time t (already seeked).
function medirCena({ indice, AREA, tarde }) {
  const s = window.CENAS[indice];
  const raiz = document.getElementById('stage').getBoundingClientRect();
  const opacidade = (el) => { let o = 1; for (let e = el; e && e.id !== 'stage'; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= Number(cs.opacity); } return o; };
  const escala = (el) => { let k = 1; for (let e = el; e && e.id !== 'stage'; e = e.parentElement) { const tr = getComputedStyle(e).transform; if (tr && tr !== 'none') { const m = new DOMMatrix(tr); k *= Math.hypot(m.a, m.b); } } return k; };
  const angulo = (el) => { let a = 0; for (let e = el; e && e.id !== 'stage'; e = e.parentElement) { const tr = getComputedStyle(e).transform; if (tr && tr !== 'none') { const m = new DOMMatrix(tr); a += Math.atan2(m.b, m.a) * 180 / Math.PI; } } return a; };
  const caixa = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - raiz.left, y: r.top - raiz.top, w: r.width, h: r.height }; };
  const nome = `Cena ${indice + 1} (${s.c.tipo})`;
  const falhas = [];
  const prod = s.el.querySelector('[data-papel="produto"]');
  if (!prod || opacidade(prod) < 0.9) falhas.push(`${nome}: produto não está visível.`);
  else { const b = caixa(prod); if (b.h < 432 && b.w < 432) falhas.push(`${nome}: produto pequeno (${Math.round(b.w)}x${Math.round(b.h)} px; precisa de 432 de altura ou de largura).`); }
  const preco = s.el.querySelector('[data-papel="preco"]');
  if (tarde) falhas.push(`${nome}: preço chega tarde demais (assenta em ${tarde.toFixed(2)}s, mas a cena corta em ${s.end.toFixed(2)}s); fale o preço mais cedo ou use "segura" na cena.`);
  else if (!preco || opacidade(preco) < 0.9) falhas.push(`${nome}: preço não está visível.`);
  else {
    const b = caixa(preco);
    if (b.x < AREA.x0 || b.x + b.w > AREA.x1 || b.y < AREA.y0 || b.y + b.h > AREA.y1) falhas.push(`${nome}: preço sai da área segura (x ${Math.round(b.x)}–${Math.round(b.x + b.w)}, y ${Math.round(b.y)}–${Math.round(b.y + b.h)}; precisa ficar em x 24–460, y 110–800).`);
    const reais = preco.querySelector('[data-papel="reais"]');
    const px = reais ? parseFloat(getComputedStyle(reais).fontSize) * escala(reais) : 0;
    if (px < 72) falhas.push(`${nome}: preço pequeno (${Math.round(px)} px; mínimo 72).`);
  }
  for (const el of s.el.querySelectorAll('[data-papel]')) {
    if (opacidade(el) < 0.5) continue;
    const a = Math.abs(((angulo(el) + 540) % 360) - 180);
    if (a > 25) falhas.push(`${nome}: texto girado demais (${Math.round(a)}°) em ${el.getAttribute('data-papel')}.`);
  }
  return falhas;
}

export async function checarVideo({ videoDir }) {
  videoDir = resolve(videoDir);
  const server = await serve(videoDir);
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
    let pageError = null;
    page.on('pageerror', (err) => { pageError = err; });
    await page.goto(`http://127.0.0.1:${server.address().port}/_motor/player.html`);
    const duracao = await page.evaluate(() => window.ready).catch((err) => { throw pageError || err; });
    const falhas = [];
    // Product scenes: 0.6 s after the price is said (75% into the scene if it never is).
    // Stay 0.2 s clear of the end: the exit transition starts at end - 0.16.
    // The stamp settles at t0 + 0.4; if that is past end - 0.2 the price geometry is not measured (tarde).
    const alvos = await page.evaluate(() => window.CENAS.map((s, i) => {
      if (s.c.produto == null) return null;
      const pr = (window.PRODUTOS || []).find((x) => x.id === s.c.produto) || {};
      const fim = s.start + (s.end - s.start) * 0.75;
      const t0 = window.VT ? window.VT.momentoPreco(s.A, pr, null) : null;
      if (t0 == null) return { i, t: fim, tarde: 0 };
      const assenta = t0 + 0.4;
      return { i, t: Math.min(t0 + 0.6, s.end - 0.2), tarde: assenta > s.end - 0.2 ? assenta : 0 };
    }).filter(Boolean));
    for (const { i, t, tarde } of alvos) {
      await page.evaluate((x) => window.seek(x), t);
      falhas.push(...await page.evaluate(medirCena, { indice: i, AREA, tarde }));
    }
    // No empty frame (motionmaxxing G2): flat stills for more than 0.5 s in a row.
    let vazioDesde = null;
    for (let t = 0; t <= duracao; t += 0.25) {
      await page.evaluate((x) => window.seek(x), t);
      const im = await Jimp.read(await page.screenshot({ type: 'png' }));
      im.resize({ w: 135, h: 240 });
      let soma = 0, soma2 = 0; const n = 135 * 240;
      im.scan(0, 0, 135, 240, (x, y, idx) => { const l = 0.299 * im.bitmap.data[idx] + 0.587 * im.bitmap.data[idx + 1] + 0.114 * im.bitmap.data[idx + 2]; soma += l; soma2 += l * l; });
      const desvio = Math.sqrt(Math.max(0, soma2 / n - (soma / n) ** 2));
      if (desvio < 6) { if (vazioDesde == null) vazioDesde = t; }
      else { if (vazioDesde != null && t - vazioDesde > 0.5) falhas.push(`Tela vazia de ${vazioDesde.toFixed(2)}s a ${t.toFixed(2)}s.`); vazioDesde = null; }
    }
    if (vazioDesde != null && duracao - vazioDesde > 0.5) falhas.push(`Tela vazia de ${vazioDesde.toFixed(2)}s a ${duracao.toFixed(2)}s.`);
    if (pageError) throw pageError;
    return { ok: falhas.length === 0, falhas };
  } finally {
    await browser?.close();
    server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('uso: node checar.mjs <pasta-do-video>'); process.exit(2); }
  const { ok, falhas } = await checarVideo({ videoDir: process.argv[2] });
  console.log(ok ? 'ok' : falhas.join('\n'));
  process.exit(ok ? 0 : 1);
}
