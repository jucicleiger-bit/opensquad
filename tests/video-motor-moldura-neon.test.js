import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { renderVideo } from '../src/video-motor/render.mjs';
import { checarVideo } from '../src/video-motor/checar.mjs';
import { fixtureVt } from './helpers/vt-fixture.js';

test('the neon frame renders the VT padrão fixture and passes the check', async () => {
  const dir = await fixtureVt('neon');
  try {
    const r = await renderVideo({ videoDir: dir, stills: [0.05, 2, 4.5, 7] });
    assert.equal(r.stills.length, 4);
    assert.deepEqual(await checarVideo({ videoDir: dir }), { ok: true, falhas: [] });
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
