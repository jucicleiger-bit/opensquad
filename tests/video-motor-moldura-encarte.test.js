/* global window, document -- evaluated inside the player page */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { renderVideo, serve } from '../src/video-motor/render.mjs';
import { fixtureVt } from './helpers/vt-fixture.js';

test('the encarte frame renders the VT padrão fixture with its fixed layer and a kit price', async () => {
  const dir = await fixtureVt('encarte');
  try {
    const r = await renderVideo({ videoDir: dir, stills: [0.05, 2, 4.5, 7] });
    assert.equal(r.stills.length, 4);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('the player draws the frame fixed layer, the kit price and exposes window.CENAS', async () => {
  const dir = await fixtureVt('encarte');
  const server = await serve(dir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
    let pageError = null;
    page.on('pageerror', (err) => { pageError = err; });
    await page.goto(`http://127.0.0.1:${server.address().port}/_motor/player.html`);
    await page.evaluate(() => window.ready).catch((err) => { throw pageError || err; });
    await page.evaluate(() => window.seek(4.5));
    assert.match(await page.evaluate(() => document.getElementById('fixo').textContent), /Ofertas da Semana/);
    for (const papel of ['preco', 'reais', 'produto']) {
      assert.equal(await page.locator(`[data-papel="${papel}"]`).count(), 1, papel);
    }
    assert.equal(await page.evaluate(() => window.CENAS.length), 3);
  } finally { await browser.close(); server.close(); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
