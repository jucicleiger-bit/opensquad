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
