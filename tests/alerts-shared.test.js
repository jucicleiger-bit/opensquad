// tests/alerts-shared.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, dueAlerts } from '../supabase/functions/_shared/alerts.js';

test('buildAlerts flags an expired token', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const alerts = buildAlerts({
    projects: [{ id: 'p1', name: 'Boss Pizzaria', instagram_token_expires_at: '2026-08-30T00:00:00Z' }],
    failedItems: [],
  }, now);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'token_expired');
  assert.equal(alerts[0].key, 'token_expired:p1');
  assert.match(alerts[0].subject, /Boss Pizzaria/);
});

test('buildAlerts flags a token expiring within 10 days, with days remaining in the message', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const alerts = buildAlerts({
    projects: [{ id: 'p1', name: 'Boss Pizzaria', instagram_token_expires_at: '2026-09-05T00:00:00Z' }],
    failedItems: [],
  }, now);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'token_expiring');
  assert.match(alerts[0].body, /4 dia/);
});

test('buildAlerts does not flag a token expiring more than 10 days out', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const alerts = buildAlerts({
    projects: [{ id: 'p1', name: 'Boss Pizzaria', instagram_token_expires_at: '2026-10-01T00:00:00Z' }],
    failedItems: [],
  }, now);
  assert.equal(alerts.length, 0);
});

test('buildAlerts flags a failed publish, keyed per content item', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const alerts = buildAlerts({
    projects: [{ id: 'p1', name: 'Boss Pizzaria', instagram_token_expires_at: null }],
    failedItems: [{ id: 'ci1', project_id: 'p1', project_name: 'Boss Pizzaria', content_id: 'boss-2026-08-30-01', channel: 'instagram_feed', publish_error: 'Invalid OAuth access token' }],
  }, now);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'publish_failed');
  assert.equal(alerts[0].key, 'publish_failed:p1:boss-2026-08-30-01');
  assert.match(alerts[0].body, /Invalid OAuth access token/);
});

test('dueAlerts excludes an alert notified within the cooldown window, includes one notified before it', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const alerts = [
    { type: 'token_expired', key: 'a', subject: 's', body: 'b' },
    { type: 'token_expired', key: 'b', subject: 's', body: 'b' },
  ];
  const notified = {
    a: '2026-09-01T11:00:00Z', // 1h ago — inside a 24h cooldown
    b: '2026-08-31T10:00:00Z', // ~26h ago — outside a 24h cooldown
  };
  const result = dueAlerts(alerts, notified, now, 24 * 60 * 60 * 1000);
  assert.deepEqual(result.map((a) => a.key), ['b']);
});

test('dueAlerts includes an alert never notified before', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const alerts = [{ type: 'token_expired', key: 'never-sent', subject: 's', body: 'b' }];
  const result = dueAlerts(alerts, {}, now, 24 * 60 * 60 * 1000);
  assert.deepEqual(result.map((a) => a.key), ['never-sent']);
});
