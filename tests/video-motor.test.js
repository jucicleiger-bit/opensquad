import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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

test('a short real render writes a non-empty trecho.mp4', async () => {
  await withFixture(async (dir) => {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '4', join(dir, 'voz', 'narracao.mp3')]);
    const result = await renderVideo({ videoDir: dir, trecho: [0, 1] });
    assert.equal(result.out, join(dir, 'trecho.mp4'));
    assert.ok((await stat(result.out)).size > 0);
  });
});

test('a render without the narration file rejects with the ffmpeg message instead of crashing', async () => {
  await withFixture(async (dir) => {
    await assert.rejects(renderVideo({ videoDir: dir, trecho: [0, 1] }), /ffmpeg/);
  });
});

test('a video folder without cenas.js fails with a clear message', async () => {
  await withFixture(async (dir) => {
    await rm(join(dir, 'cenas.js'));
    await assert.rejects(renderVideo({ videoDir: dir, stills: [0.05] }), /cenas\.js não encontrado/);
  });
});
