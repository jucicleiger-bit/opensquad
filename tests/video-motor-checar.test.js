import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checarVideo } from '../src/video-motor/checar.mjs';
import { fixtureVt } from './helpers/vt-fixture.js';

const limpar = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

test('the encarte VT padrão passes the check', async () => {
  const dir = await fixtureVt('encarte');
  try {
    const r = await checarVideo({ videoDir: dir });
    assert.deepEqual(r, { ok: true, falhas: [] });
  } finally { await limpar(dir); }
});

test('a small product and a price outside the safe area fail with both messages', async () => {
  const dir = await fixtureVt('encarte');
  try {
    // Same scenes, but the product is tiny and the price sits at x 480.
    await writeFile(join(dir, 'cenas.js'), `
      window.VIDEO = { estrelas: false, transicao: MOLDURA.transicao, tipos: { ...MOLDURA.tipos, produto: {
        html: (c) => { const pr = PRODUTOS[0]; return '<img data-papel="produto" src="' + asset(pr.foto) + '" style="position:absolute;left:200px;top:300px;width:80px;height:80px">'
          + '<div style="position:absolute;left:480px;top:600px;font:100px Anton">' + VT.precoHtml(pr) + '</div>'; },
        frame() {}, sfx: () => [] } } };`);
    const r = await checarVideo({ videoDir: dir });
    assert.equal(r.ok, false);
    assert.ok(r.falhas.some((f) => /Cena 2 \(produto\): produto pequeno/.test(f)), r.falhas.join('\n'));
    assert.ok(r.falhas.some((f) => /Cena 2 \(produto\): preço sai da área segura/.test(f)), r.falhas.join('\n'));
  } finally { await limpar(dir); }
});

test('a blank stretch longer than half a second fails as tela vazia', async () => {
  const dir = await fixtureVt('encarte');
  try {
    // No frame (so no fixed layer), and an opening that draws nothing on black for its whole line (~2 s).
    const roteiro = JSON.parse(await readFile(join(dir, 'roteiro.json'), 'utf8'));
    delete roteiro.moldura;
    await writeFile(join(dir, 'roteiro.json'), JSON.stringify(roteiro));
    await writeFile(join(dir, 'cenas.js'), `
      const texto = (s) => ({ html: () => '<div style="position:absolute;top:400px;width:540px;text-align:center;color:#fff;font:60px sans-serif">' + s + '</div>', frame() {}, sfx: () => [] });
      window.VIDEO = { estrelas: false, css: '#stage{background:#000}', tipos: { abertura: { html: () => '', frame() {}, sfx: () => [] }, produto: texto('produto'), fechamento: texto('fim') } };`);
    const r = await checarVideo({ videoDir: dir });
    assert.ok(r.falhas.some((f) => /^Tela vazia de 0\.00s/.test(f)), r.falhas.join('\n'));
  } finally { await limpar(dir); }
});

test('a price said too late for the stamp to settle fails as preço chega tarde demais, without geometry noise', async () => {
  const dir = await fixtureVt('encarte');
  try {
    // "treze" is the last word of the product line and the next scene opens 0.3 s later, so the cut comes before the stamp settles.
    const arq = join(dir, 'voz', 'tempos.json');
    const tempos = JSON.parse(await readFile(arq, 'utf8'));
    const trz = tempos.cenas[1].words.findIndex((w) => w.w === 'treze');
    tempos.cenas[1].words = tempos.cenas[1].words.slice(0, trz + 1);
    const t0 = tempos.cenas[1].words[trz].t;
    const desloca = t0 + 0.3 - tempos.cenas[2].words[0].t;
    for (const w of tempos.cenas[2].words) w.t = Number((w.t + desloca).toFixed(2));
    await writeFile(arq, JSON.stringify(tempos));
    const r = await checarVideo({ videoDir: dir });
    assert.ok(r.falhas.some((f) => /^Cena 2 \(produto\): preço chega tarde demais \(assenta em \d+\.\d\ds, mas a cena corta em \d+\.\d\ds\)/.test(f)), r.falhas.join('\n'));
    assert.ok(!r.falhas.some((f) => /Cena 2 .*(sai da área segura|preço não está visível)/.test(f)), r.falhas.join('\n'));
  } finally { await limpar(dir); }
});
