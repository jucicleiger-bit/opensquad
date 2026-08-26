import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinBusinessHours, isUnderDailyLimit, recordAction } from '../src/social-selling-safety.js';

test('isWithinBusinessHours is true only on configured weekdays within the hour window', () => {
  const businessHours = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 };
  assert.equal(isWithinBusinessHours(new Date(2026, 7, 25, 10, 0), businessHours), true); // Tue Aug 25 2026, 10:00
  assert.equal(isWithinBusinessHours(new Date(2026, 7, 25, 8, 59), businessHours), false);
  assert.equal(isWithinBusinessHours(new Date(2026, 7, 25, 18, 0), businessHours), false);
  assert.equal(isWithinBusinessHours(new Date(2026, 7, 23, 10, 0), businessHours), false); // Sun Aug 23 2026
});

test('isWithinBusinessHours returns false instead of throwing when the hand-edited config has no usable days list', () => {
  const now = new Date(2026, 7, 25, 10, 0); // Tue, inside any normal window
  assert.equal(isWithinBusinessHours(now, { startHour: 9, endHour: 18 }), false);
  assert.equal(isWithinBusinessHours(now, { days: null, startHour: 9, endHour: 18 }), false);
  assert.equal(isWithinBusinessHours(now, { days: '1,2,3', startHour: 9, endHour: 18 }), false);
  assert.equal(isWithinBusinessHours(now, {}), false);
});

test('recordAction resets counters on a new day and isUnderDailyLimit respects the configured cap', () => {
  const counters = { date: '2026-08-24', like: 5 };
  const dailyLimits = { like: 5, comment: 10, follow: 5, dm: 8 };
  const now = new Date(2026, 7, 25, 10, 0);

  assert.equal(isUnderDailyLimit(counters, 'like', dailyLimits, now), true); // stale date counts as 0 so far today
  recordAction(counters, 'like', now);
  assert.equal(counters.date, '2026-08-25');
  assert.equal(counters.like, 1);
  assert.equal(isUnderDailyLimit(counters, 'like', dailyLimits, now), true);

  for (let i = 0; i < 4; i += 1) recordAction(counters, 'like', now);
  assert.equal(counters.like, 5);
  assert.equal(isUnderDailyLimit(counters, 'like', dailyLimits, now), false);
});

test('isUnderDailyLimit treats a missing limit as unlimited', () => {
  assert.equal(isUnderDailyLimit({}, 'comment', {}, new Date()), true);
});
