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
    assert.equal(state.leads.length, 2); // the rejected one is stored too, as descartado
    const approved = state.leads.find((lead) => lead.id === '@padoca');
    assert.equal(approved.stage, 'descoberto');
    assert.equal(approved.draftComment, 'que pão bom!');
    assert.equal(approved.profileUrl, 'https://www.instagram.com/padoca/');

    const rejected = state.leads.find((lead) => lead.id === '@agenciax');
    assert.equal(rejected.stage, 'descartado');
    assert.equal(rejected.discardedReason, 'agência');

    // A second sweep with the same candidates must skip both as duplicates
    // and never call qualify again (each call is a paid AI request).
    let qualifyCalls = 0;
    const second = await runSocialSellingRadarSweep(dir, {
      discover: async () => candidates,
      qualify: async () => { qualifyCalls += 1; return { approved: true }; },
      now: new Date('2026-08-25T13:00:00.000Z'),
    });
    assert.deepEqual(second.discovered, []);
    assert.equal(qualifyCalls, 0);
    assert.deepEqual(second.skipped.map((entry) => entry.reason), ['duplicate', 'duplicate']);
  });
});

test('runSocialSellingRadarSweep jitters the first action of new leads instead of making them all due at once', async () => {
  await withTempDir(async (dir) => {
    const now = new Date('2026-08-25T12:00:00.000Z');
    await runSocialSellingRadarSweep(dir, {
      discover: async () => Array.from({ length: 5 }, (unused, i) => ({ handle: `@lead${i}`, source: 'hashtag', foundOn: 'padariasp', postUrl: `https://instagram.com/p/${i}` })),
      qualify: async () => ({ approved: true, comment: 'oi' }),
      now,
      config: { ...DEFAULT_SOCIAL_SELLING_CONFIG, initialActionDelayMs: { min: 60000, max: 1800000 } },
    });
    const state = await loadSocialSellingState(dir);
    assert.equal(state.leads.length, 5);
    for (const lead of state.leads) {
      const dueAt = new Date(lead.nextActionAt).getTime();
      assert.ok(dueAt >= now.getTime() + 60000, `${lead.id} is due too early`);
      assert.ok(dueAt <= now.getTime() + 1800000, `${lead.id} is due too late`);
    }
    assert.ok(new Set(state.leads.map((lead) => lead.nextActionAt)).size > 1, 'all leads got the same nextActionAt');
  });
});

test('runSocialSellingRadarSweep starts reference-mined leads at comentado, since no post of their own was ever liked or commented', async () => {
  await withTempDir(async (dir) => {
    await runSocialSellingRadarSweep(dir, {
      discover: async () => [
        { handle: '@fromtag', source: 'hashtag', foundOn: 'padariasp', postUrl: 'https://instagram.com/p/1' },
        { handle: '@fromref', source: 'reference_mining', foundOn: '@concorrente', postUrl: 'https://instagram.com/p/ref' },
      ],
      qualify: async () => ({ approved: true, comment: 'que pão bom!' }),
      now: new Date('2026-08-25T12:00:00.000Z'),
    });
    const state = await loadSocialSellingState(dir);
    const fromTag = state.leads.find((lead) => lead.id === '@fromtag');
    const fromRef = state.leads.find((lead) => lead.id === '@fromref');

    assert.equal(fromTag.stage, 'descoberto');
    assert.equal(fromTag.draftComment, 'que pão bom!');

    assert.equal(fromRef.stage, 'comentado'); // next action: follow
    assert.equal(fromRef.draftComment, null);
    assert.equal(fromRef.profileUrl, 'https://www.instagram.com/fromref/');
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
    assert.equal(first.blockedReason, 'instagram_blocked'); // the actual cause, for the operator's notification

    const second = await runSocialSellingEngagementSweep(dir, { performAction, now, config: DEFAULT_SOCIAL_SELLING_CONFIG });
    assert.equal(second.reason, 'paused');
    assert.equal(calls, 1);
  });
});

test('runSocialSellingEngagementSweep pushes a failing lead forward instead of retrying it on every tick, and gives up after 3 attempts', async () => {
  await withTempDir(async (dir) => {
    const now = new Date(2026, 7, 25, 10, 0);
    await withSocialSellingState(dir, (state) => {
      state.leads.push({ id: '@broken', handle: '@broken', stage: 'descoberto', nextActionAt: new Date(0).toISOString() });
      state.leads.push({ id: '@queued', handle: '@queued', stage: 'descoberto', nextActionAt: new Date(1).toISOString() });
    });
    const performAction = async ({ lead }) => {
      if (lead.id === '@broken') throw new Error('Like button not found');
      return { ok: true };
    };

    const first = await runSocialSellingEngagementSweep(dir, { performAction, now, config: DEFAULT_SOCIAL_SELLING_CONFIG });
    assert.equal(first.reason, 'action_failed');
    assert.equal(first.error, 'Like button not found');
    assert.equal(first.handle, '@broken');
    assert.equal(first.giveUp, undefined);

    let state = await loadSocialSellingState(dir);
    let broken = state.leads.find((lead) => lead.id === '@broken');
    assert.equal(broken.attempts, 1);
    assert.equal(broken.stage, 'descoberto');
    assert.ok(new Date(broken.nextActionAt) > now, 'a failed lead must leave the due queue, or it blocks every lead behind it');
    assert.equal(state.paused, false); // a missing selector is not an Instagram block

    // The lead queued behind it now gets its turn instead of being starved.
    const next = await runSocialSellingEngagementSweep(dir, { performAction, now, config: DEFAULT_SOCIAL_SELLING_CONFIG });
    assert.equal(next.acted.handle, '@queued');

    // Two more failures (its nextActionAt is forced back to due each time).
    let last;
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      await withSocialSellingState(dir, (current) => {
        current.leads.find((lead) => lead.id === '@broken').nextActionAt = new Date(0).toISOString();
      });
      last = await runSocialSellingEngagementSweep(dir, { performAction, now, config: DEFAULT_SOCIAL_SELLING_CONFIG });
    }

    assert.equal(last.reason, 'action_failed');
    assert.equal(last.giveUp, true);
    state = await loadSocialSellingState(dir);
    broken = state.leads.find((lead) => lead.id === '@broken');
    assert.equal(broken.attempts, 3);
    assert.equal(broken.stage, 'descartado');
    assert.equal(broken.discardedReason, 'action_failed_repeatedly');

    // descartado is terminal: the lead is never picked up again.
    await withSocialSellingState(dir, (current) => {
      current.leads.find((lead) => lead.id === '@queued').stage = 'dm_enviado';
    });
    const after = await runSocialSellingEngagementSweep(dir, { performAction, now, config: DEFAULT_SOCIAL_SELLING_CONFIG });
    assert.equal(after.reason, 'no_due_lead');
  });
});

test('runSocialSellingEngagementSweep clears the attempt counter once an action succeeds', async () => {
  await withTempDir(async (dir) => {
    const now = new Date(2026, 7, 25, 10, 0);
    await withSocialSellingState(dir, (state) => {
      state.leads.push({ id: '@padoca', handle: '@padoca', stage: 'descoberto', nextActionAt: new Date(0).toISOString(), attempts: 2 });
    });
    await runSocialSellingEngagementSweep(dir, {
      performAction: async () => ({ ok: true }),
      now,
      config: DEFAULT_SOCIAL_SELLING_CONFIG,
    });
    const state = await loadSocialSellingState(dir);
    assert.equal(state.leads[0].attempts, 0);
  });
});
