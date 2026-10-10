import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderVideo, MOTOR_DIR } from '../src/video-motor/render.mjs';

async function withFixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'video-motor-'));
  await cp('tests/fixtures/video-minimo', dir, { recursive: true });
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

test('MOTOR_DIR points at the motor files', async () => {
  assert.ok((await readdir(MOTOR_DIR)).includes('player.html'));
});

test('renderVideo stills draws a tiny video without page errors', async () => {
  await withFixture(async (dir) => {
    const result = await renderVideo({ videoDir: dir, stills: [0.05, 1.6] });
    assert.deepEqual(result.stills, ['t0.05.jpg', 't1.6.jpg']);
    assert.deepEqual((await readdir(join(dir, 'stills'))).sort(), ['t0.05.jpg', 't1.6.jpg']);
    assert.ok(result.duration > 2);
  });
});

test('a scene anchored to a word missing from its line fails with the player message', async () => {
  await withFixture(async (dir) => {
    const cenas = (await readFile(join(dir, 'cenas.js'), 'utf8')).replace("A('cena')", "A('inexistente')");
    await writeFile(join(dir, 'cenas.js'), cenas);
    await assert.rejects(renderVideo({ videoDir: dir, stills: [1.6] }), /inexistente/);
  });
});
