import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSocialSellingRadarSweep, runSocialSellingEngagementSweep } from '../src/social-selling-sweep.js';
import { loadSocialSellingState, withSocialSellingState, DEFAULT_SOCIAL_SELLING_CONFIG } from '../src/social-selling-store.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-social-selling-sweep-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test('runSocialSellingRadarSweep adds qualified candidates, skips duplicates and unqualified ones', async () => {
  await withTempDir(async (dir) => {
    const candidates = [
      { handle: '@padoca', source: 'hashtag', foundOn: 'padariasp', postUrl: 'https://instagram.com/p/1', postSnippet: 'pão fresco' },
      { handle: '@agenciax', source: 'hashtag', foundOn: 'padariasp', postUrl: 'https://instagram.com/p/2', postSnippet: 'somos agência' },
    ];
    const result = await runSocialSellingRadarSweep(dir, {
      discover: async () => candidates,
      qualify: async (candidate) => (candidate.handle === '@padoca'
        ? { approved: true, comment: 'que pão bom!' }
        : { approved: false, reason: 'agência' }),
      now: new Date('2026-08-25T12:00:00.000Z'),
    });
    assert.deepEqual(result.discovered, ['@padoca']);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'agência');
    assert.equal(result.blocked, null);

    const state = await loadSocialSellingState(dir);
    assert.equal(state.leads.length, 1);
    assert.equal(state.leads[0].stage, 'descoberto');
    assert.equal(state.leads[0].draftComment, 'que pão bom!');

    // A second sweep with the same candidate must skip it as a duplicate.
    const second = await runSocialSellingRadarSweep(dir, {
      discover: async () => candidates.slice(0, 1),
      qualify: async () => ({ approved: true }),
      now: new Date('2026-08-25T13:00:00.000Z'),
    });
    assert.deepEqual(second.discovered, []);
    assert.equal(second.skipped[0].reason, 'duplicate');
  });
});

test('runSocialSellingRadarSweep pauses the queue when discover reports a block, and does not run again once paused', async () => {
  await withTempDir(async (dir) => {
    let calls = 0;
    const discover = async () => {
      calls += 1;
      throw Object.assign(new Error('blocked'), { blocked: true, reason: 'instagram_blocked' });
    };
    const result = await runSocialSellingRadarSweep(dir, { discover, qualify: async () => ({ approved: true }) });
    assert.equal(result.blocked, 'instagram_blocked');

    const state = await loadSocialSellingState(dir);
    assert.equal(state.paused, true);
    assert.equal(state.pausedReason, 'instagram_blocked');

    await runSocialSellingRadarSweep(dir, { discover, qualify: async () => ({ approved: true }) });
    assert.equal(calls, 1); // second sweep saw state.paused and never called discover again
  });
});

test('runSocialSellingEngagementSweep does nothing outside business hours', async () => {
  await withTempDir(async (dir) => {
    const result = await runSocialSellingEngagementSweep(dir, {
      performAction: async () => { throw new Error('should not be called'); },
      now: new Date(2026, 7, 23, 10, 0), // Sunday
      config: DEFAULT_SOCIAL_SELLING_CONFIG,
    });
    assert.equal(result.reason, 'outside_business_hours');
  });
});

test('runSocialSellingEngagementSweep advances exactly one due lead, respecting the daily cap and scheduling the next step', async () => {
  await withTempDir(async (dir) => {
    const now = new Date(2026, 7, 25, 10, 0); // Tue, business hours
    await withSocialSellingState(dir, (state) => {
      state.leads.push({ id: '@padoca', handle: '@padoca', stage: 'descoberto', nextActionAt: new Date(0).toISOString(), postUrl: 'https://instagram.com/p/1' });
      state.leads.push({ id: '@later', handle: '@later', stage: 'descoberto', nextActionAt: new Date(now.getTime() + 999999).toISOString() });
    });

    let performed = null;
    const result = await runSocialSellingEngagementSweep(dir, {
      performAction: async (payload) => { performed = payload; return { ok: true }; },
      now,
      config: DEFAULT_SOCIAL_SELLING_CONFIG,
    });

    assert.equal(performed.action, 'like');
    assert.equal(performed.lead.id, '@padoca');
    assert.deepEqual(result.acted, { handle: '@padoca', action: 'like', newStage: 'like' });

    const state = await loadSocialSellingState(dir);
    const lead = state.leads.find((entry) => entry.id === '@padoca');
    assert.equal(lead.stage, 'like');
    assert.ok(new Date(lead.nextActionAt) > now);
    assert.equal(state.counters.like, 1);
  });
});

test('runSocialSellingEngagementSweep skips a due lead once its action type hits the daily cap', async () => {
  await withTempDir(async (dir) => {
    const now = new Date(2026, 7, 25, 10, 0);
    await withSocialSellingState(dir, (state) => {
      state.counters = { date: '2026-08-25', like: DEFAULT_SOCIAL_SELLING_CONFIG.dailyLimits.like };
      state.leads.push({ id: '@padoca', handle: '@padoca', stage: 'descoberto', nextActionAt: new Date(0).toISOString() });
    });
    const result = await runSocialSellingEngagementSweep(dir, {
      performAction: async () => { throw new Error('should not be called'); },
      now,
      config: DEFAULT_SOCIAL_SELLING_CONFIG,
    });
    assert.equal(result.reason, 'daily_limit_like');
  });
});

test('runSocialSellingEngagementSweep pauses on a blocked action and stops acting on subsequent ticks', async () => {
  await withTempDir(async (dir) => {
    const now = new Date(2026, 7, 25, 10, 0);
    await withSocialSellingState(dir, (state) => {
      state.leads.push({ id: '@padoca', handle: '@padoca', stage: 'descoberto', nextActionAt: new Date(0).toISOString() });
    });
    let calls = 0;
    const performAction = async () => { calls += 1; return { blocked: true, reason: 'instagram_blocked' }; };

    const first = await runSocialSellingEngagementSweep(dir, { performAction, now, config: DEFAULT_SOCIAL_SELLING_CONFIG });
    assert.equal(first.blocked, true);
    assert.equal(first.reason, 'blocked');

    const second = await runSocialSellingEngagementSweep(dir, { performAction, now, config: DEFAULT_SOCIAL_SELLING_CONFIG });
    assert.equal(second.reason, 'paused');
    assert.equal(calls, 1);
  });
});
