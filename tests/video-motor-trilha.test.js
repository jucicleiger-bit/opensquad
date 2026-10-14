import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { renderVideo } from '../src/video-motor/render.mjs';
import { fixtureVt } from './helpers/vt-fixture.js';

const limpar = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim();
async function comVoz(dir) {
  await mkdir(join(dir, 'voz'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=8', '-ac', '1', join(dir, 'voz', 'narracao.mp3')]);
}

test('a trecho render with a trilha has audio and the expected length', async () => {
  const dir = await fixtureVt('encarte');
  try {
    await comVoz(dir);
    const r = await renderVideo({ videoDir: dir, trecho: [0, 1.5] });
    assert.equal(probe(r.out, 'stream=codec_type').split(/\s+/).includes('audio'), true);
    assert.ok(Math.abs(Number(probe(r.out, 'format=duration')) - 1.5) < 0.15);
  } finally { await limpar(dir); }
});

test('a missing trilha still renders', async () => {
  const dir = await fixtureVt('encarte');
  try {
    await comVoz(dir);
    const roteiro = JSON.parse(await readFile(join(dir, 'roteiro.json'), 'utf8'));
    await writeFile(join(dir, 'roteiro.json'), JSON.stringify({ ...roteiro, trilha: 'nao-existe.mp3' }));
    const r = await renderVideo({ videoDir: dir, trecho: [0, 1] });
    assert.ok(r.out);
  } finally { await limpar(dir); }
});
