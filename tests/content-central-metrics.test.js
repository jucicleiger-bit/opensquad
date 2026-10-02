import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCentralProject, getCentralPaths, previousMonthKey, saveProjectToken } from '../src/content-central.js';
import {
  collectAllProjectsMetrics,
  collectProjectMetrics,
  loadProjectMetrics,
  openMonths,
} from '../src/content-central-metrics.js';

async function withTempProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-metrics-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const WITH_INSIGHTS = ['instagram_basic', 'instagram_manage_insights'];

async function projectWithToken(dir, projectId, permissions, instagramUserId = 'ig-1') {
  await createCentralProject({ projectId, name: projectId, handle: `@${projectId}` }, dir);
  await saveProjectToken(projectId, { token: 'EAAB-token', permissions, account: { instagramUserId, pageId: 'page-1' } }, dir);
}

// Answers by Graph path and records every call, so a test can assert what
// was — and was not — asked of Meta.
function fakeGraph(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const path = url.pathname.replace('/v25.0/', '');
    calls.push(path);
    const handler = routes[path];
    const body = typeof handler === 'function' ? handler(url) : handler;
    if (body === undefined) {
      return { ok: false, status: 404, json: async () => ({ error: { message: `sem rota: ${path}`, code: 100 } }) };
    }
    return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

const mediaInsight = (values) => ({ data: Object.entries(values).map(([name, value]) => ({ name, values: [{ value }] })) });
const accountTotal = (name, value) => ({ data: [{ name, total_value: { value } }] });

test('month helpers work in local time across a year boundary', () => {
  assert.equal(previousMonthKey('2026-01'), '2025-12');
  assert.deepEqual(openMonths(new Date(2026, 9, 3, 9)), ['2026-10', '2026-09']);
  assert.deepEqual(openMonths(new Date(2026, 9, 4, 9)), ['2026-10']);
});

test('reads followers and likes once a day with a token that has no insights permission', async () => {
  await withTempProject(async (dir) => {
    await projectWithToken(dir, 'loja', ['instagram_basic']);
    const graph = fakeGraph({
      'ig-1': { followers_count: 1284 },
      'ig-1/media': { data: [
        { id: 'm1', media_product_type: 'FEED', like_count: 31, comments_count: 4, timestamp: '2026-10-05T15:00:00+0000' },
        { id: 'old', media_product_type: 'FEED', like_count: 9, comments_count: 0, timestamp: '2026-07-05T15:00:00+0000' },
        { id: 'ad', media_product_type: 'AD', like_count: 1, comments_count: 0, timestamp: '2026-10-05T15:00:00+0000' },
      ] },
    });

    await collectProjectMetrics('loja', dir, { fetchImpl: graph.fetchImpl, now: new Date(2026, 9, 6, 10) });
    await collectProjectMetrics('loja', dir, { fetchImpl: graph.fetchImpl, now: new Date(2026, 9, 6, 11) });

    const metrics = await loadProjectMetrics('loja', dir);
    assert.deepEqual(metrics.followers, { '2026-10-06': 1284 });
    assert.equal(metrics.media.m1.kind, 'feed');
    assert.equal(metrics.media.m1.likes, 31);
    assert.equal(metrics.media.m1.comments, 4);
    assert.equal(metrics.media.old, undefined);
    assert.equal(metrics.media.ad, undefined);
    assert.equal(metrics.lastDailyRun, '2026-10-06');
    // The second run of the day asks nothing: no insights, daily block done.
    assert.deepEqual(graph.calls, ['ig-1', 'ig-1/media']);
  });
});

test('stores views for live stories and skips the one Meta withholds', async () => {
  await withTempProject(async (dir) => {
    await projectWithToken(dir, 'loja', WITH_INSIGHTS);
    const graph = fakeGraph({
      'ig-1/stories': { data: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
      's1/insights': mediaInsight({ views: 412, reach: 380, replies: 2 }),
      's2/insights': { error: { message: 'Not enough viewers', code: 10 } },
      's3/insights': { error: { message: 'boom', code: 2 } },
      'ig-1': { followers_count: 900 },
      'ig-1/media': { data: [] },
      'ig-1/insights': (url) => accountTotal(url.searchParams.get('metric'), 100),
    });

    const result = await collectProjectMetrics('loja', dir, { fetchImpl: graph.fetchImpl, now: new Date(2026, 9, 6, 10) });

    const metrics = await loadProjectMetrics('loja', dir);
    assert.equal(metrics.media.s1.kind, 'story');
    assert.equal(metrics.media.s1.views, 412);
    assert.equal(metrics.media.s1.reach, 380);
    assert.equal(metrics.media.s1.replies, 2);
    assert.equal(metrics.media.s2, undefined);
    assert.equal(metrics.media.s3, undefined);
    // Only the real failure is reported, and it did not stop the rest.
    assert.deepEqual(result.errors.map((message) => message.split(':')[0]), ['story s3']);
    assert.equal(metrics.followers['2026-10-06'], 900);
  });
});

test('adds up profile views across 30-day windows and asks reach once per month', async () => {
  await withTempProject(async (dir) => {
    await projectWithToken(dir, 'loja', WITH_INSIGHTS);
    const windows = [];
    const graph = fakeGraph({
      'ig-1/stories': { data: [] },
      'ig-1': { followers_count: 900 },
      'ig-1/media': { data: [] },
      'ig-1/insights': (url) => {
        const metric = url.searchParams.get('metric');
        windows.push({ metric, span: Number(url.searchParams.get('until')) - Number(url.searchParams.get('since')) });
        return accountTotal(metric, metric === 'views' ? 1000 : 700);
      },
    });

    // 2 November: November is current, October (31 days) is still open.
    await collectProjectMetrics('loja', dir, { fetchImpl: graph.fetchImpl, now: new Date(2026, 10, 2, 9) });

    const metrics = await loadProjectMetrics('loja', dir);
    assert.equal(metrics.months['2026-10'].views, 2000);
    assert.equal(metrics.months['2026-10'].reach, 700);
    assert.equal(metrics.months['2026-11'].views, 1000);
    assert.equal(windows.filter((entry) => entry.metric === 'views').length, 3);
    assert.equal(windows.filter((entry) => entry.metric === 'reach').length, 2);
    assert.ok(windows.every((entry) => entry.span > 0 && entry.span <= 30 * 86400));
  });
});

test('a closed month is refreshed through day 3 and left alone from day 4', async () => {
  await withTempProject(async (dir) => {
    await projectWithToken(dir, 'loja', ['instagram_basic']);
    const october = (likes) => fakeGraph({
      'ig-1': { followers_count: 900 },
      'ig-1/media': { data: [{ id: 'm1', media_product_type: 'FEED', like_count: likes, comments_count: 0, timestamp: '2026-10-20T15:00:00+0000' }] },
    });

    await collectProjectMetrics('loja', dir, { fetchImpl: october(50).fetchImpl, now: new Date(2026, 10, 3, 9) });
    assert.equal((await loadProjectMetrics('loja', dir)).media.m1.likes, 50);

    await collectProjectMetrics('loja', dir, { fetchImpl: october(99).fetchImpl, now: new Date(2026, 10, 4, 9) });
    assert.equal((await loadProjectMetrics('loja', dir)).media.m1.likes, 50);
  });
});

test('the daily block runs again the same day when the followers read failed', async () => {
  await withTempProject(async (dir) => {
    await projectWithToken(dir, 'loja', ['instagram_basic']);
    const down = fakeGraph({});
    const first = await collectProjectMetrics('loja', dir, { fetchImpl: down.fetchImpl, now: new Date(2026, 9, 6, 10) });
    assert.equal((await loadProjectMetrics('loja', dir)).lastDailyRun, null);
    assert.ok(first.errors.some((message) => message.startsWith('followers')));

    const up = fakeGraph({ 'ig-1': { followers_count: 77 }, 'ig-1/media': { data: [] } });
    await collectProjectMetrics('loja', dir, { fetchImpl: up.fetchImpl, now: new Date(2026, 9, 6, 11) });
    assert.equal((await loadProjectMetrics('loja', dir)).followers['2026-10-06'], 77);
  });
});

test('collecting every project skips the ones without a token and survives a broken one', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'a-sem-token', name: 'A', handle: '@a' }, dir);
    await projectWithToken(dir, 'b-quebrado', ['instagram_basic'], 'ig-b');
    await projectWithToken(dir, 'c-ok', ['instagram_basic'], 'ig-c');
    // A folder under projects/ that is not a project (the real tree has these).
    await mkdir(join(getCentralPaths(dir).projectsDir, 'commercial'), { recursive: true });
    const broken = getCentralPaths(dir, 'b-quebrado').metricsPath;
    await mkdir(join(broken, '..'), { recursive: true });
    await writeFile(broken, 'isto não é json', 'utf-8');

    const graph = fakeGraph({ 'ig-c': { followers_count: 10 }, 'ig-c/media': { data: [] } });
    const results = await collectAllProjectsMetrics(dir, { fetchImpl: graph.fetchImpl, now: new Date(2026, 9, 6, 10) });

    assert.deepEqual(results.map((entry) => entry.projectId), ['a-sem-token', 'b-quebrado', 'c-ok']);
    assert.equal(results[0].skipped, true);
    assert.ok(results[1].failed);
    assert.equal((await loadProjectMetrics('c-ok', dir)).followers['2026-10-06'], 10);
    assert.deepEqual(graph.calls, ['ig-c', 'ig-c/media']);
  });
});
