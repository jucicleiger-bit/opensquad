import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_SOCIAL_SELLING_CONFIG,
  loadSocialSellingConfig,
  loadSocialSellingState,
  withSocialSellingState,
  findDueLead,
  nextStage,
  actionForStage,
  randomDelayMs,
} from '../src/social-selling-store.js';
import { getCentralPaths } from '../src/content-central.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-social-selling-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test('loadSocialSellingConfig returns defaults with no config file, and deep-merges an override file', async () => {
  await withTempDir(async (dir) => {
    const defaults = await loadSocialSellingConfig(dir);
    assert.deepEqual(defaults, DEFAULT_SOCIAL_SELLING_CONFIG);

    const { socialSellingConfigPath, root } = getCentralPaths(dir);
    await mkdir(root, { recursive: true });
    await writeFile(socialSellingConfigPath, JSON.stringify({ hashtags: ['padariasp'], dailyLimits: { dm: 3 } }));

    const merged = await loadSocialSellingConfig(dir);
    assert.deepEqual(merged.hashtags, ['padariasp']);
    assert.equal(merged.dailyLimits.dm, 3);
    assert.equal(merged.dailyLimits.like, DEFAULT_SOCIAL_SELLING_CONFIG.dailyLimits.like);
  });
});

test('withSocialSellingState creates the state file on first write and persists mutations', async () => {
  await withTempDir(async (dir) => {
    await withSocialSellingState(dir, (state) => {
      state.leads.push({ id: '@padoca', stage: 'descoberto', nextActionAt: new Date(0).toISOString() });
    });
    const state = await loadSocialSellingState(dir);
    assert.equal(state.leads.length, 1);
    assert.equal(state.leads[0].id, '@padoca');
    assert.equal(state.paused, false);
  });
});

test('withSocialSellingState serializes concurrent writers so neither mutation is lost', async () => {
  await withTempDir(async (dir) => {
    await Promise.all([
      withSocialSellingState(dir, (state) => { state.leads.push({ id: 'a' }); }),
      withSocialSellingState(dir, (state) => { state.leads.push({ id: 'b' }); }),
    ]);
    const state = await loadSocialSellingState(dir);
    assert.equal(state.leads.length, 2);
  });
});

test('findDueLead returns the earliest non-terminal due lead, ignoring terminal stages and future ones', () => {
  const now = new Date('2026-08-25T12:00:00.000Z');
  const state = {
    leads: [
      { id: 'a', stage: 'dm_enviado', nextActionAt: '2026-08-25T00:00:00.000Z' },
      { id: 'b', stage: 'like', nextActionAt: '2026-08-26T00:00:00.000Z' },
      { id: 'c', stage: 'descoberto', nextActionAt: '2026-08-25T01:00:00.000Z' },
      { id: 'd', stage: 'comentado', nextActionAt: '2026-08-25T00:30:00.000Z' },
    ],
  };
  assert.equal(findDueLead(state, now).id, 'd');
});

test('nextStage advances through the sequence and returns null after dm_enviado', () => {
  assert.equal(nextStage('descoberto'), 'like');
  assert.equal(nextStage('like'), 'comentado');
  assert.equal(nextStage('comentado'), 'seguido');
  assert.equal(nextStage('seguido'), 'dm_enviado');
  assert.equal(nextStage('dm_enviado'), null);
});

test('actionForStage maps each stage to the action that advances it', () => {
  assert.equal(actionForStage('descoberto'), 'like');
  assert.equal(actionForStage('like'), 'comment');
  assert.equal(actionForStage('comentado'), 'follow');
  assert.equal(actionForStage('seguido'), 'dm');
  assert.equal(actionForStage('dm_enviado'), null);
});

test('randomDelayMs always stays within [min, max]', () => {
  for (let i = 0; i < 50; i += 1) {
    const value = randomDelayMs(100, 200);
    assert.ok(value >= 100 && value <= 200);
  }
});
