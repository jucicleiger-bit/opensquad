// tests/gaveta-dispatch-shared.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDispatch } from '../supabase/functions/_shared/gaveta-dispatch.js';

const now = new Date('2026-09-28T20:41:00Z'); // 16:41 in Cuiabá (UTC-4)
const dueStory = {
  scheduledDate: '2026-09-28',
  scheduledTime: '16:40',
  mediaUrl: 'https://i.ibb.co/x.png',
  publish: { realPublished: false, error: null },
};
const completedRun = (createdAt, conclusion = 'success') => ({ status: 'completed', conclusion, created_at: createdAt });

test('dispatches as soon as an item reaches its Cuiabá wall-clock time', () => {
  assert.equal(shouldDispatch({ items: [dueStory], latestRun: completedRun('2026-09-28T20:00:00Z'), now }), true);
  assert.equal(shouldDispatch({ items: [dueStory], latestRun: null, now }), true);
});

test('does not dispatch before the scheduled time', () => {
  const early = new Date('2026-09-28T20:39:00Z'); // 16:39 in Cuiabá
  assert.equal(shouldDispatch({ items: [dueStory], latestRun: null, now: early }), false);
});

test('ignores published, unapproved, media-less and over-24h-stale items', () => {
  const items = [
    { ...dueStory, publish: { realPublished: true } },
    { ...dueStory, status: 'rascunho' },
    { ...dueStory, mediaUrl: '' },
    { ...dueStory, scheduledDate: '2026-09-27', scheduledTime: '16:00' },
  ];
  assert.equal(shouldDispatch({ items, latestRun: null, now }), false);
});

test('never stacks a dispatch on a run that is still queued or in progress', () => {
  const running = { status: 'in_progress', conclusion: null, created_at: '2026-09-28T20:40:30Z' };
  assert.equal(shouldDispatch({ items: [dueStory], latestRun: running, now }), false);
});

test('a run that started after the item was due already had its chance: retry only after the gap', () => {
  const triedAt = completedRun('2026-09-28T20:40:10Z');
  assert.equal(shouldDispatch({ items: [dueStory], latestRun: triedAt, now }), false);
  const later = new Date('2026-09-28T21:00:30Z');
  assert.equal(shouldDispatch({ items: [dueStory], latestRun: triedAt, now: later }), true);
});

test('stays hands-off after a failed run, since its publish result may not have been saved', () => {
  const failed = completedRun('2026-09-28T19:00:00Z', 'failure');
  assert.equal(shouldDispatch({ items: [dueStory], latestRun: failed, now }), false);
});

test('reads scheduled times as Cuiabá time, not São Paulo', () => {
  // 16:40 São Paulo would already be past at 19:41Z; 16:40 Cuiabá is 20:40Z.
  assert.equal(shouldDispatch({ items: [dueStory], latestRun: null, now: new Date('2026-09-28T19:41:00Z') }), false);
});
