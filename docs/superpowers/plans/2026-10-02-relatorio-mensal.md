# Monthly Client Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each project gets a monthly report (phone-shaped pages, saved to PDF from the browser) showing what was published and the Instagram numbers behind it, plus a dashboard notice when last month's report is ready.

**Architecture:** A collector in the panel server reads the Graph API hourly and writes one metrics file per project (`metrics/instagram.json`), keyed by Instagram media id. The report is a pure function of the project's content items plus that file, rendered as a standalone HTML page on demand — there is no stored report. A `report_ready` alert rides the existing alert/dismiss mechanism.

**Tech Stack:** Node (`node --test`), React + Vite + vitest (`content-central-app`), Graph API v25.0.

Spec: `docs/superpowers/specs/2026-10-02-relatorio-mensal-design.md`
Approved mockup: `.superpowers/brainstorm/563-1790959931/content/relatorio-completo.html` (main checkout, outside git)

## Global Constraints

- Work only in the worktree for branch `relatorio-mensal`. No commit, merge or push to master.
- Nothing here publishes or sends a message; the collector only reads from Meta.
- Sending the report, server-side PDF, per-page images, WhatsApp/Facebook metrics and the cloud panel are out of scope.
- Graph API base: `https://graph.facebook.com/v25.0`. Insights permission name: `instagram_manage_insights`.
- A publication is an item with `publish.publishedAt`; it belongs to the **local** month of `publishedAt`, never to `scheduledDate`.
- Report pages are 360×640 px; colors `#0b0b0c`, `#111`, `#6b6b6b`, `#FFD100`; numbers formatted `pt-BR`.
- A closed month is open for collection through day 3 of the next month, then frozen. The notice and the "pronto" state start on day 3.
- Git commands run through the PowerShell tool (the Bash hook rewrites `git` and the worktree guard refuses it). `docs/` is git-ignored: `git add -f`.
- Backend filter: `node --test --test-name-pattern="<pattern>" tests/<file>` — the pattern flag goes BEFORE the file.
- Frontend type check is `npm run build` in `content-central-app` (`tsc --noEmit` checks nothing here).

## File Structure

- `src/content-central.js` — `metricsPath`, local date helpers, exported `readJson`/`writeJson`, the `report_ready` alert.
- `src/content-central-metrics.js` (new) — Graph API reads and the metrics file.
- `src/content-central-report.js` (new) — report data, month list, HTML.
- `src/content-central-server.js` — two read-only routes and the collector scheduler.
- `tests/content-central-metrics.test.js`, `tests/content-central-report.test.js` (new); `tests/content-central.test.js`, `tests/content-central-server.test.js`.
- `content-central-app/src/api/client.ts`, `pages/workspace/Reports.tsx` (new, + test), `App.tsx`, `layouts/ProjectWorkspaceLayout.tsx`, `pages/Dashboard.tsx`, `pages/workspace/Account.tsx`.
- `.env.example` — the two new variables.

---

### Task 1: Metrics file and collector

**Files:**
- Modify: `src/content-central.js` (`getCentralPaths`; `readJson`/`writeJson` near the bottom)
- Create: `src/content-central-metrics.js`
- Test: `tests/content-central-metrics.test.js`

**Interfaces:**
- Produces, from `src/content-central.js`: `paths.metricsPath`; `localDateKey(date) → 'YYYY-MM-DD'`; `localMonthKey(date) → 'YYYY-MM'`; `previousMonthKey('YYYY-MM') → 'YYYY-MM'`; `monthNamePt('YYYY-MM') → 'setembro'`; exported `readJson(path, fallback)` and `writeJson(path, value)`.
- Produces, from `src/content-central-metrics.js`: `INSIGHTS_PERMISSION`; `openMonths(now) → string[]`; `loadProjectMetrics(projectId, targetDir) → { schemaVersion, followers, media, months, lastDailyRun }`; `collectProjectMetrics(projectId, targetDir, { fetchImpl, now }) → { skipped, errors }`; `collectAllProjectsMetrics(targetDir, options) → [{ projectId, ... }]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/content-central-metrics.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/content-central-metrics.test.js`
Expected: FAIL — `previousMonthKey` is not exported / `content-central-metrics.js` not found.

- [ ] **Step 3: Add the helpers to `src/content-central.js`**

In `getCentralPaths`, next to `tokenSecretPath`:

```js
    // Instagram numbers for the monthly report — written only by the
    // collector in content-central-metrics.js, never by the content flows.
    metricsPath: join(projectDir, 'metrics', 'instagram.json'),
```

Right after `formatDate`:

```js
// Local-time keys: the monthly report and its metrics follow the operator's
// own calendar, and toISOString() would file a 22:00 post under the next day
// (and the last evening of a month under the next month).
export function localDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localMonthKey(date) {
  return localDateKey(date).slice(0, 7);
}

export function previousMonthKey(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return localMonthKey(new Date(year, monthNumber - 2, 1));
}

const MONTH_NAMES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function monthNamePt(month) {
  return MONTH_NAMES_PT[Number(month.split('-')[1]) - 1];
}
```

Change `async function readJson(` to `export async function readJson(` and `async function writeJson(` to `export async function writeJson(`.

- [ ] **Step 4: Create `src/content-central-metrics.js`**

```js
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getCentralPaths,
  localDateKey,
  localMonthKey,
  previousMonthKey,
  readJson,
  readProjectToken,
  writeJson,
} from './content-central.js';

const GRAPH_URL = 'https://graph.facebook.com/v25.0';
// The Graph API refuses more than 30 days between since and until.
const WINDOW_SECONDS = 30 * 86400;
const MEDIA_KINDS = { FEED: 'feed', REELS: 'reels' };

export const INSIGHTS_PERMISSION = 'instagram_manage_insights';

// Months whose numbers may still change: the current one, and the previous
// one through day 3 (Meta delivers numbers up to 48 hours late). After that
// a closed month is never rewritten, so its report always reads the same.
export function openMonths(now) {
  const current = localMonthKey(now);
  return now.getDate() <= 3 ? [current, previousMonthKey(current)] : [current];
}

export async function loadProjectMetrics(projectId, targetDir = process.cwd()) {
  const stored = await readJson(getCentralPaths(targetDir, projectId).metricsPath, null);
  return { schemaVersion: 1, followers: {}, media: {}, months: {}, lastDailyRun: null, ...(stored || {}) };
}

async function graphGet(path, params, { token, fetchImpl }) {
  const url = new URL(`${GRAPH_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set('access_token', token);
  const response = await fetchImpl(url);
  const body = await response.json();
  if (!response.ok || body?.error) {
    throw Object.assign(new Error(body?.error?.message || `Graph API respondeu ${response.status}`), { code: body?.error?.code });
  }
  return body;
}

// Media insights answer { values: [{ value }] }; account insights asked with
// metric_type=total_value answer { total_value: { value } }.
function insightValues(body) {
  const values = {};
  for (const entry of body?.data || []) {
    const value = entry.total_value?.value ?? entry.values?.[0]?.value;
    if (Number.isFinite(value)) values[entry.name] = value;
  }
  return values;
}

async function fetchAccountMonth(igUserId, month, now, context) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = Math.floor(new Date(year, monthNumber - 1, 1).getTime() / 1000);
  const end = Math.min(Math.floor(new Date(year, monthNumber, 1).getTime() / 1000), Math.floor(now.getTime() / 1000));
  const total = async (metric, since, until) => insightValues(await graphGet(`${igUserId}/insights`, {
    metric, period: 'day', metric_type: 'total_value', since, until,
  }, context))[metric] ?? 0;

  // views adds up across windows. reach counts unique accounts and cannot be
  // summed, so it is asked once, for the last 30 days of the month.
  let views = 0;
  for (let since = start; since < end; since += WINDOW_SECONDS) {
    views += await total('views', since, Math.min(since + WINDOW_SECONDS, end));
  }
  const reach = await total('reach', Math.max(start, end - WINDOW_SECONDS), end);
  return { views, reach };
}

export async function collectProjectMetrics(projectId, targetDir = process.cwd(), { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await readJson(paths.projectPath, null);
  const igUserId = project?.instagram?.instagramUserId;
  const token = project ? await readProjectToken(projectId, targetDir) : null;
  if (!igUserId || !token) return { skipped: true, errors: [] };

  const insights = (project.token?.permissions || []).includes(INSIGHTS_PERMISSION);
  const metrics = await loadProjectMetrics(projectId, targetDir);
  const context = { token, fetchImpl };
  const stamp = now.toISOString();
  const errors = [];
  // One failed call must not cost the others their numbers.
  const attempt = async (label, fn) => {
    try {
      await fn();
      return true;
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
      return false;
    }
  };

  // Stories come straight from the account, not from the local items: Meta
  // only answers while a story is live (24h), and waiting for the gaveta
  // publish result to sync back could miss that window.
  if (insights) {
    await attempt('stories', async () => {
      const live = await graphGet(`${igUserId}/stories`, { fields: 'id,timestamp' }, context);
      for (const story of live.data || []) {
        try {
          const values = insightValues(await graphGet(`${story.id}/insights`, { metric: 'views,reach,replies' }, context));
          metrics.media[story.id] = { ...metrics.media[story.id], kind: 'story', ...values, updatedAt: stamp };
        } catch (err) {
          // Code 10: Meta withholds the numbers of a story with fewer than 5 viewers.
          if (err.code !== 10) errors.push(`story ${story.id}: ${err.message}`);
        }
      }
    });
  }

  const today = localDateKey(now);
  if (metrics.lastDailyRun !== today) {
    const open = openMonths(now);

    const followersRead = await attempt('followers', async () => {
      const user = await graphGet(igUserId, { fields: 'followers_count' }, context);
      if (Number.isFinite(user.followers_count)) metrics.followers[today] = user.followers_count;
    });

    await attempt('media', async () => {
      // ponytail: no paging — 50 covers a month of feed and Reels with room
      // to spare (the largest plan has 12 feed posts). Page if a client posts more.
      const list = await graphGet(`${igUserId}/media`, {
        fields: 'id,media_product_type,like_count,comments_count,timestamp', limit: 50,
      }, context);
      for (const media of list.data || []) {
        const kind = MEDIA_KINDS[media.media_product_type];
        if (!kind || !open.includes(localMonthKey(new Date(media.timestamp)))) continue;
        const entry = { ...metrics.media[media.id], kind, updatedAt: stamp };
        if (Number.isFinite(media.like_count)) entry.likes = media.like_count;
        if (Number.isFinite(media.comments_count)) entry.comments = media.comments_count;
        if (insights) {
          await attempt(`media ${media.id}`, async () => {
            Object.assign(entry, insightValues(await graphGet(`${media.id}/insights`, { metric: 'views,reach' }, context)));
          });
        }
        metrics.media[media.id] = entry;
      }
    });

    if (insights) {
      for (const month of open) {
        await attempt(`conta ${month}`, async () => {
          metrics.months[month] = { ...(await fetchAccountMonth(igUserId, month, now, context)), updatedAt: stamp };
        });
      }
    }

    // The followers read doubles as the "Meta is reachable" signal: when it
    // fails the whole block runs again on the next tick instead of waiting
    // for tomorrow.
    if (followersRead) metrics.lastDailyRun = today;
  }

  await writeJson(paths.metricsPath, metrics);
  for (const message of errors) console.error(`[content-central] metrics ${projectId}: ${message}`);
  return { skipped: false, errors };
}

export async function collectAllProjectsMetrics(targetDir = process.cwd(), options = {}) {
  const { projectsDir } = getCentralPaths(targetDir);
  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const results = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    // projects/ also holds folders that are not projects (commercial, global-learning).
    if (!(await readJson(join(projectsDir, entry.name, 'project.json'), null))) continue;
    try {
      results.push({ projectId: entry.name, ...(await collectProjectMetrics(entry.name, targetDir, options)) });
    } catch (err) {
      console.error(`[content-central] metrics ${entry.name}: ${err.message}`);
      results.push({ projectId: entry.name, failed: err.message });
    }
  }
  return results;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/content-central-metrics.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```powershell
git add src/content-central.js src/content-central-metrics.js tests/content-central-metrics.test.js
git commit -m "feat(content-central): collect Instagram numbers into a per-project metrics file"
```

---

### Task 2: Report data and page

**Files:**
- Create: `src/content-central-report.js`
- Test: `tests/content-central-report.test.js`

**Interfaces:**
- Consumes: `creativeShapeGroupForChannel`, `localMonthKey`, `previousMonthKey`, `monthNamePt` from `src/content-central.js`; a metrics object shaped like `loadProjectMetrics` returns.
- Produces: `monthLabel('2026-08') → 'Agosto de 2026'`; `listReportMonths({ items, now }) → [{ month, label, publications, status }]` with `status` in `'parcial' | 'fechando' | 'pronto'`; `buildMonthlyReport({ project, agency, items, metrics, month, now }) → report`; `renderReportPage(report) → string`.
- `report` shape: `{ month, monthLabel, monthName, partial, partialUntil, client: { name, handle, logoUrl, initial }, agency: { name, phone, logoUrl }, totals: { publications, byChannel: [{ count, text }] }, audience: { views, reach }, followers: { total, delta }, stories: { count, measured, top: [{ imageUrl, views }], more }, feed: { count, likes, comments, items: [{ imageUrl, likes }] }, flyers: { count, items: [{ imageUrl, views }] } }`. Unknown numbers are `null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/content-central-report.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyReport, listReportMonths, monthLabel, renderReportPage } from '../src/content-central-report.js';

const project = {
  projectId: 'hygi',
  name: 'Hygi Embalagem',
  instagram: { handle: '@hygiembalagem' },
  brandIdentity: { logoPath: 'assets/logo.jpg' },
};
const agency = { name: 'King Assessoria de MKT', contactPhone: '65 98108-6707', logoPath: 'logo.jpg' };
const closedNow = new Date(2026, 9, 5, 9);

let sequence = 0;
// A published August item; local noon keeps it inside August in any timezone.
function item(overrides = {}) {
  sequence += 1;
  return {
    contentId: `c${sequence}`,
    batchId: 'lote',
    channel: 'instagram_story',
    scheduledDate: '2026-08-10',
    contentTopic: { type: 'offer' },
    image: { url: `/api/projects/hygi/assets/assets/generated/arte-${sequence}.png` },
    publish: { publishedAt: new Date(2026, 7, 10, 12).toISOString(), metaMediaId: `m${sequence}` },
    ...overrides,
  };
}

const report = (items, metrics = {}, now = closedNow, month = '2026-08') => buildMonthlyReport({ project, agency, items, metrics, month, now });

test('monthLabel writes the month the way a client reads it', () => {
  assert.equal(monthLabel('2026-08'), 'Agosto de 2026');
});

test('counts publications by the local month they went out, not by the scheduled date', () => {
  const items = [
    item({ scheduledDate: '2029-07-01' }),
    item({ channel: 'instagram_feed' }),
    item({ channel: 'facebook_feed' }),
    item({ channel: 'facebook_story' }),
    item({ publish: { publishedAt: new Date(2026, 8, 1, 12).toISOString() } }),
    item({ publish: { publishedAt: null } }),
  ];
  const result = report(items);
  assert.equal(result.totals.publications, 4);
  assert.deepEqual(result.totals.byChannel.map((chip) => chip.text), ['1 story', '1 post no feed', '2 no Facebook']);
  assert.equal(result.monthLabel, 'Agosto de 2026');
  assert.equal(result.partial, false);
});

test('shows one arte per creative group and splits stories, feed and encartes', () => {
  const items = [
    item({ creativeGroupKey: 'g1', channel: 'instagram_story' }),
    item({ creativeGroupKey: 'g1', channel: 'whatsapp_status' }),
    item({ creativeGroupKey: 'g2', channel: 'instagram_feed' }),
    item({ creativeGroupKey: 'g2', channel: 'facebook_feed' }),
    item({ batchId: 'flyer-1', creativeGroupKey: 'flyer-1::vertical', channel: 'instagram_story', contentTopic: { source: 'flyer' } }),
    item({ batchId: 'flyer-1', creativeGroupKey: 'flyer-1::feed', channel: 'instagram_feed', contentTopic: { source: 'flyer' } }),
  ];
  const result = report(items);
  assert.equal(result.totals.publications, 6);
  assert.equal(result.stories.count, 1);
  assert.equal(result.feed.count, 1);
  assert.equal(result.flyers.count, 1);
  // The encarte shows its vertical arte, served through the resized-preview route.
  assert.equal(result.flyers.items[0].imageUrl, `/api/projects/hygi/assets-preview/assets/generated/arte-${sequence - 1}.png`);
});

test('stories show the six most viewed, with the rest counted', () => {
  const items = Array.from({ length: 8 }, () => item());
  const media = Object.fromEntries(items.map((entry, index) => [entry.publish.metaMediaId, { kind: 'story', views: (index + 1) * 10 }]));
  const result = report(items, { media });
  assert.equal(result.stories.count, 8);
  assert.equal(result.stories.measured, true);
  assert.deepEqual(result.stories.top.map((story) => story.views), [80, 70, 60, 50, 40, 30]);
  assert.equal(result.stories.more, 2);
});

test('without numbers, stories show the six most recent and are marked unmeasured', () => {
  const items = Array.from({ length: 7 }, (_, index) => item({ publish: { publishedAt: new Date(2026, 7, index + 1, 12).toISOString() } }));
  const result = report(items);
  assert.equal(result.stories.measured, false);
  assert.equal(result.stories.top.length, 6);
  assert.deepEqual(result.stories.top.map((story) => story.views), [null, null, null, null, null, null]);
  assert.match(result.stories.top[0].imageUrl, new RegExp(`arte-${sequence}\\.png$`));
});

test('feed posts are ordered by likes and summed; unknown likes stay null', () => {
  const low = item({ channel: 'instagram_feed' });
  const high = item({ channel: 'instagram_feed' });
  const media = {
    [low.publish.metaMediaId]: { kind: 'feed', likes: 5, comments: 1 },
    [high.publish.metaMediaId]: { kind: 'feed', likes: 31, comments: 4 },
  };
  const measured = report([low, high], { media });
  assert.deepEqual(measured.feed.items.map((post) => post.likes), [31, 5]);
  assert.equal(measured.feed.likes, 36);
  assert.equal(measured.feed.comments, 5);

  const unmeasured = report([low, high]);
  assert.equal(unmeasured.feed.likes, null);
  assert.equal(unmeasured.feed.comments, null);
  assert.deepEqual(unmeasured.feed.items.map((post) => post.likes), [null, null]);
});

test('followers show the month-end total, and growth only when there is a base and it is positive', () => {
  const items = [item()];
  const grew = report(items, { followers: { '2026-07-31': 1247, '2026-08-15': 1260, '2026-08-31': 1284, '2026-09-02': 1300 } });
  assert.deepEqual(grew.followers, { total: 1284, delta: 37 });

  const noBase = report(items, { followers: { '2026-08-15': 1260, '2026-08-31': 1284 } });
  assert.deepEqual(noBase.followers, { total: 1284, delta: null });

  const shrank = report(items, { followers: { '2026-07-31': 1300, '2026-08-31': 1284 } });
  assert.deepEqual(shrank.followers, { total: 1284, delta: null });

  assert.deepEqual(report(items).followers, { total: null, delta: null });
});

test('profile views and reach come from the stored month and hide when zero', () => {
  const items = [item()];
  assert.deepEqual(report(items, { months: { '2026-08': { views: 9860, reach: 2140 } } }).audience, { views: 9860, reach: 2140 });
  assert.deepEqual(report(items, { months: { '2026-08': { views: 0, reach: 0 } } }).audience, { views: null, reach: null });
  assert.deepEqual(report(items).audience, { views: null, reach: null });
});

test('the current month is marked partial', () => {
  const result = report([item()], {}, new Date(2026, 7, 20, 9));
  assert.equal(result.partial, true);
  assert.equal(result.partialUntil, '20/08');
});

test('listReportMonths names each month and its state around day 3', () => {
  const items = [
    item(),
    item({ publish: { publishedAt: new Date(2026, 8, 10, 12).toISOString() } }),
    item({ publish: { publishedAt: new Date(2026, 9, 1, 12).toISOString() } }),
    item({ publish: { publishedAt: null } }),
  ];
  const states = (now) => listReportMonths({ items, now }).map((entry) => [entry.month, entry.publications, entry.status]);
  assert.deepEqual(states(new Date(2026, 9, 2, 9)), [['2026-10', 1, 'parcial'], ['2026-09', 1, 'fechando'], ['2026-08', 1, 'pronto']]);
  assert.deepEqual(states(new Date(2026, 9, 3, 9)), [['2026-10', 1, 'parcial'], ['2026-09', 1, 'pronto'], ['2026-08', 1, 'pronto']]);
  assert.equal(listReportMonths({ items, now: closedNow })[2].label, 'Agosto de 2026');
});

test('the page shows the client, the month and Brazilian-formatted numbers', () => {
  const items = Array.from({ length: 2 }, () => item());
  const html = renderReportPage(report(items, {
    months: { '2026-08': { views: 9860, reach: 2140 } },
    followers: { '2026-07-31': 1247, '2026-08-31': 1284 },
  }));
  assert.match(html, /Hygi Embalagem/);
  assert.match(html, /@hygiembalagem/);
  assert.match(html, /Agosto de 2026/);
  assert.match(html, /9\.860/);
  assert.match(html, /\+37 no mês/);
  assert.match(html, /no fim de agosto/);
  assert.match(html, /Preparado por King Assessoria de MKT · 65 98108-6707/);
  assert.match(html, /size:\s*360px 640px/);
  assert.doesNotMatch(html, /Encartes/);
  assert.doesNotMatch(html, /Posts no feed/);
});

test('the page degrades without numbers and says so for an empty month', () => {
  const plain = renderReportPage(report([item()]));
  assert.doesNotMatch(plain, /Quem viu a sua marca/);
  assert.doesNotMatch(plain, /Seguidores/);
  assert.doesNotMatch(plain, /mais vistos/);

  const empty = renderReportPage(report([]));
  assert.match(empty, /Nenhuma publicação em agosto de 2026\./);
});

test('the page escapes names coming from the project', () => {
  const html = renderReportPage(buildMonthlyReport({
    project: { ...project, name: 'Loja <b>X</b>' }, agency, items: [item()], metrics: {}, month: '2026-08', now: closedNow,
  }));
  assert.match(html, /Loja &lt;b&gt;X&lt;\/b&gt;/);
  assert.doesNotMatch(html, /Loja <b>X<\/b>/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/content-central-report.test.js`
Expected: FAIL — `content-central-report.js` not found.

- [ ] **Step 3: Create `src/content-central-report.js`**

```js
import { creativeShapeGroupForChannel, localMonthKey, monthNamePt, previousMonthKey } from './content-central.js';

const STORIES_SHOWN = 6;
const FEED_PER_PAGE = 4;
const FLYERS_PER_PAGE = 6;

// One chip per channel family, in the order the cover lists them.
const CHANNEL_CHIPS = [
  { channels: ['instagram_story'], names: ['story', 'stories'] },
  { channels: ['instagram_feed'], names: ['post no feed', 'posts no feed'] },
  { channels: ['instagram_reels'], names: ['Reel', 'Reels'] },
  { channels: ['whatsapp_status'], names: ['Status do WhatsApp', 'Status do WhatsApp'] },
  { channels: ['facebook_feed', 'facebook_story'], names: ['no Facebook', 'no Facebook'] },
];

const formatNumber = (value) => Number(value).toLocaleString('pt-BR');
const countOf = (count, [one, many]) => `${formatNumber(count)} ${count === 1 ? one : many}`;
const positive = (value) => (Number.isFinite(value) && value > 0 ? value : null);
const publishedMonth = (item) => (item.publish?.publishedAt ? localMonthKey(new Date(item.publish.publishedAt)) : null);

export function monthLabel(month) {
  const name = monthNamePt(month);
  return `${name[0].toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
}

export function listReportMonths({ items = [], now = new Date() }) {
  const counts = new Map();
  for (const item of items) {
    const month = publishedMonth(item);
    if (month) counts.set(month, (counts.get(month) || 0) + 1);
  }
  const current = localMonthKey(now);
  const previous = previousMonthKey(current);
  return [...counts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, publications]) => ({
      month,
      label: monthLabel(month),
      publications,
      // Meta delivers numbers up to 48 hours late, so last month is only
      // final on day 3.
      status: month === current ? 'parcial' : month === previous && now.getDate() < 3 ? 'fechando' : 'pronto',
    }));
}

// Same rewrite the briefing page uses: the resized preview keeps the PDF
// from carrying 2-3 MB PNGs.
function imageUrlOf(item, projectId) {
  const image = item.image || item.slides?.[0]?.image || {};
  const src = image.previewUrl || image.url || '';
  const marker = `/api/projects/${projectId}/assets/`;
  return src.startsWith(marker) ? `/api/projects/${projectId}/assets-preview/${src.slice(marker.length)}` : src;
}

// The same arte published to several channels is one group. An encarte is
// one group per batch, whatever its channels.
function groupKeyOf(item) {
  if (item.contentTopic?.source === 'flyer') return `flyer:${item.batchId}`;
  return item.creativeGroupKey || `solo:${item.contentId}`;
}

function buildGroups(published, media, projectId) {
  const byKey = new Map();
  for (const item of published) {
    const key = groupKeyOf(item);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  const metricOf = (item) => media[item.publish?.metaMediaId] || {};
  const isVertical = (item) => creativeShapeGroupForChannel(item.channel) === 'vertical';

  return [...byKey.values()].map((members) => {
    const ordered = [...members].sort((a, b) => String(a.publish.publishedAt).localeCompare(String(b.publish.publishedAt)));
    const flyer = ordered[0].contentTopic?.source === 'flyer';
    const views = ordered.map((item) => metricOf(item).views).filter(Number.isFinite);
    const feedMetric = metricOf(ordered.find((item) => item.channel === 'instagram_feed') || {});

    // The arte shown is the most viewed member's; an encarte prefers its
    // vertical arte because its page is a vertical grid.
    const withImage = ordered.filter((item) => imageUrlOf(item, projectId));
    const pool = flyer && withImage.some(isVertical) ? withImage.filter(isVertical) : withImage;
    const cover = pool.reduce((best, item) => ((metricOf(item).views ?? -1) > (metricOf(best).views ?? -1) ? item : best), pool[0]);

    return {
      shape: flyer ? 'flyer' : ordered.map((item) => creativeShapeGroupForChannel(item.channel)).find(Boolean) || null,
      publishedAt: String(ordered[0].publish.publishedAt),
      imageUrl: cover ? imageUrlOf(cover, projectId) : '',
      views: views.length ? Math.max(...views) : null,
      likes: Number.isFinite(feedMetric.likes) ? feedMetric.likes : null,
      comments: Number.isFinite(feedMetric.comments) ? feedMetric.comments : null,
    };
  });
}

function followersFor(followers, month) {
  const dates = Object.keys(followers).sort();
  const last = dates.filter((date) => date <= `${month}-31`).at(-1);
  const base = dates.filter((date) => date < `${month}-01`).at(-1);
  const total = last ? followers[last] : null;
  const delta = total !== null && base ? total - followers[base] : null;
  // A flat or shrinking month shows the total alone — a choice of tone.
  return { total, delta: delta > 0 ? delta : null };
}

export function buildMonthlyReport({ project, agency = {}, items = [], metrics = {}, month, now = new Date() }) {
  const published = items.filter((item) => publishedMonth(item) === month);
  const groups = buildGroups(published, metrics.media || {}, project.projectId);
  const byRecent = (a, b) => b.publishedAt.localeCompare(a.publishedAt);
  const sum = (list, field) => (list.length ? list.reduce((acc, group) => acc + group[field], 0) : null);

  const stories = groups.filter((group) => group.shape === 'vertical').sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || byRecent(a, b));
  const feed = groups.filter((group) => group.shape === 'feed').sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1) || byRecent(a, b));
  const flyers = groups.filter((group) => group.shape === 'flyer').sort((a, b) => byRecent(b, a));
  const top = stories.slice(0, STORIES_SHOWN);

  const partial = month === localMonthKey(now);
  const logoPath = project.brandIdentity?.logoPath;
  const monthData = metrics.months?.[month] || {};

  return {
    month,
    monthLabel: monthLabel(month),
    monthName: monthNamePt(month),
    partial,
    partialUntil: partial ? `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}` : null,
    client: {
      name: project.name,
      handle: project.instagram?.handle || '',
      logoUrl: logoPath ? `/api/projects/${project.projectId}/assets/${logoPath}` : '',
      initial: (String(project.name || '?').trim()[0] || '?').toUpperCase(),
    },
    agency: {
      name: agency.name || '',
      phone: agency.contactPhone || '',
      logoUrl: agency.logoPath ? `/api/commercial/assets/${agency.logoPath}` : '',
    },
    totals: {
      publications: published.length,
      byChannel: CHANNEL_CHIPS
        .map((chip) => ({ chip, count: published.filter((item) => chip.channels.includes(item.channel)).length }))
        .filter(({ count }) => count > 0)
        .map(({ chip, count }) => ({ count, text: countOf(count, chip.names) })),
    },
    audience: { views: positive(monthData.views), reach: positive(monthData.reach) },
    followers: followersFor(metrics.followers || {}, month),
    stories: {
      count: stories.length,
      measured: stories.some((group) => group.views !== null),
      top: top.map((group) => ({ imageUrl: group.imageUrl, views: group.views })),
      more: stories.length - top.length,
    },
    feed: {
      count: feed.length,
      likes: sum(feed.filter((group) => group.likes !== null), 'likes'),
      comments: sum(feed.filter((group) => group.comments !== null), 'comments'),
      items: feed.map((group) => ({ imageUrl: group.imageUrl, likes: group.likes })),
    },
    flyers: {
      count: flyers.length,
      items: flyers.map((group) => ({ imageUrl: group.imageUrl, views: group.views })),
    },
  };
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function chunk(list, size) {
  const pages = [];
  for (let index = 0; index < list.length; index += size) pages.push(list.slice(index, index + size));
  return pages;
}

const thumb = (imageUrl, badge) => `<div class="th">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="">` : '<div class="noimg"></div>'}${badge ? `<b>${escapeHtml(badge)}</b>` : ''}</div>`;
const stat = (value, label) => (value === null ? '' : `<div class="stat"><div class="n">${formatNumber(value)}</div><div class="t">${label}</div></div>`);

const REPORT_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#1a1a1d;color:#111;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;line-height:1.25;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 20px;background:#0b0b0c;color:#fff;font-size:14px}
.bar button{background:#FFD100;color:#111;border:0;border-radius:8px;padding:9px 16px;font-weight:700;font-size:14px;cursor:pointer}
.pages{display:flex;flex-wrap:wrap;gap:20px;justify-content:center;padding:24px 16px 48px}
.page{width:360px;height:640px;background:#fff;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.top{background:#0b0b0c;color:#fff;padding:15px 20px;display:flex;align-items:center;gap:11px;font-size:15px;min-height:63px}
.top img{width:33px;height:33px;border-radius:7px;object-fit:cover}
.body{padding:23px 23px 20px;flex:1;display:flex;flex-direction:column;min-height:0}
.kicker{font-size:14px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#6b6b6b}
.month{font-size:35px;font-weight:800;letter-spacing:-.02em;margin-top:3px}
.partial{font-size:14px;color:#6b6b6b;margin-top:4px}
.client{display:flex;align-items:center;gap:13px;margin-top:20px}
.client img,.client .initial{width:57px;height:57px;border-radius:50%;border:1px solid #ddd;object-fit:cover;flex:0 0 auto}
.client .initial{display:flex;align-items:center;justify-content:center;background:#0b0b0c;color:#fff;font-weight:800;font-size:24px}
.client b{display:block;font-size:20px}
.client span{font-size:16px;color:#6b6b6b}
.hero{margin-top:auto}
.hero .num{font-size:127px;font-weight:800;letter-spacing:-.04em;line-height:.9}
.hero .lbl{font-size:21px;font-weight:600;margin-top:7px}
.mark{background:#FFD100;padding:0 8px;border-radius:5px}
.chips{display:flex;gap:10px;margin-top:17px;flex-wrap:wrap}
.chip{font-size:16px;font-weight:600;border:1.5px solid #111;border-radius:99px;padding:5px 13px}
h2{font-size:25px;font-weight:800;letter-spacing:-.01em;margin:0 0 5px}
.sub{font-size:16px;color:#555;margin:0 0 15px}
.stat{margin:12px 0 22px}
.stat .n{font-size:63px;font-weight:800;letter-spacing:-.03em;line-height:1}
.stat .t{font-size:17.5px;color:#333;margin-top:5px}
.delta{display:inline-block;font-size:16.5px;font-weight:700;background:#FFD100;border-radius:99px;padding:3px 13px;margin-left:10px;vertical-align:middle;letter-spacing:0}
hr{border:0;border-top:1px solid #e3e3e3;margin:0 0 20px}
.grid{display:grid;gap:8px}
.g3{grid-template-columns:repeat(3,1fr)}
.g2{grid-template-columns:repeat(2,1fr);gap:10px}
.th{position:relative}
.th img,.th .noimg{width:100%;display:block;border-radius:7px;object-fit:cover;background:#eee}
.g3 .th img,.g3 .th .noimg{aspect-ratio:9/16}
.g2 .th img,.g2 .th .noimg{aspect-ratio:4/5}
.th b{position:absolute;left:5px;bottom:5px;background:rgba(11,11,12,.82);color:#fff;font-size:13px;font-weight:700;border-radius:5px;padding:2px 7px}
.more{font-size:16.5px;color:#555;margin-top:15px;text-align:center}
.foot{margin-top:auto;font-size:14px;color:#6b6b6b;border-top:1px solid #e3e3e3;padding-top:12px}
.empty{margin:auto;font-size:20px;color:#555;text-align:center}
@page{size:360px 640px;margin:0}
@media print{body{background:#fff}.bar{display:none}.pages{display:block;padding:0}.page{border-radius:0;box-shadow:none;break-after:page}.page:last-child{break-after:auto}}
`;

export function renderReportPage(report) {
  const { client, agency, audience, followers, stories, feed, flyers } = report;
  const inner = `${client.name} · ${report.monthName}`;
  const pages = [];

  if (report.totals.publications === 0) {
    pages.push({ top: agency.name, body: `<p class="empty">Nenhuma publicação em ${escapeHtml(report.monthLabel.toLowerCase())}.</p>` });
  } else {
    const avatar = client.logoUrl
      ? `<img src="${escapeHtml(client.logoUrl)}" alt="">`
      : `<span class="initial">${escapeHtml(client.initial)}</span>`;
    const total = report.totals.publications;
    pages.push({
      top: agency.name,
      body: `<div class="kicker">Relatório mensal</div>
        <div class="month">${escapeHtml(report.monthLabel)}</div>
        ${report.partial ? `<div class="partial">Parcial até ${escapeHtml(report.partialUntil)}</div>` : ''}
        <div class="client">${avatar}<div><b>${escapeHtml(client.name)}</b><span>${escapeHtml(client.handle)}</span></div></div>
        <div class="hero">
          <div class="num">${formatNumber(total)}</div>
          <div class="lbl"><span class="mark">${total === 1 ? 'publicação' : 'publicações'}</span> no mês</div>
          <div class="chips">${report.totals.byChannel.map((chip) => `<span class="chip">${escapeHtml(chip.text)}</span>`).join('')}</div>
        </div>`,
    });

    const audienceBlock = audience.views !== null || audience.reach !== null
      ? `<h2>Quem viu a sua marca</h2>${stat(audience.views, 'visualizações do perfil no mês')}${stat(audience.reach, 'contas alcançadas')}`
      : '';
    const followersBlock = followers.total !== null
      ? `${audienceBlock ? '<hr>' : ''}<h2>Seguidores</h2><div class="stat"><div class="n">${formatNumber(followers.total)}${followers.delta !== null ? `<span class="delta">+${formatNumber(followers.delta)} no mês</span>` : ''}</div><div class="t">${report.partial ? `em ${escapeHtml(report.partialUntil)}` : `no fim de ${escapeHtml(report.monthName)}`}</div></div>`
      : '';
    if (audienceBlock || followersBlock) pages.push({ top: inner, body: `${audienceBlock}${followersBlock}` });

    if (stories.count > 0) {
      const ranked = stories.measured && stories.more > 0 ? ` · os ${stories.top.length} mais vistos` : '';
      pages.push({
        top: inner,
        body: `<h2>Stories</h2><p class="sub">${formatNumber(stories.count)} no mês${ranked}</p>
          <div class="grid g3">${stories.top.map((story) => thumb(story.imageUrl, story.views !== null ? formatNumber(story.views) : '')).join('')}</div>
          ${stories.more > 0 ? `<div class="more">e mais ${countOf(stories.more, ['story', 'stories'])}</div>` : ''}`,
      });
    }

    const feedSub = [
      `${formatNumber(feed.count)} no mês`,
      feed.likes !== null ? countOf(feed.likes, ['curtida', 'curtidas']) : '',
      feed.comments !== null ? countOf(feed.comments, ['comentário', 'comentários']) : '',
    ].filter(Boolean).join(' · ');
    for (const posts of chunk(feed.items, FEED_PER_PAGE)) {
      pages.push({
        top: inner,
        body: `<h2>Posts no feed</h2><p class="sub">${feedSub}</p>
          <div class="grid g2">${posts.map((post) => thumb(post.imageUrl, post.likes !== null ? countOf(post.likes, ['curtida', 'curtidas']) : '')).join('')}</div>`,
      });
    }

    for (const sheets of chunk(flyers.items, FLYERS_PER_PAGE)) {
      pages.push({
        top: inner,
        body: `<h2>Encartes</h2><p class="sub">${formatNumber(flyers.count)} no mês</p>
          <div class="grid g3">${sheets.map((sheet) => thumb(sheet.imageUrl, sheet.views !== null ? formatNumber(sheet.views) : '')).join('')}</div>`,
      });
    }
  }

  if (agency.name) {
    pages[pages.length - 1].body += `<div class="foot">Preparado por ${escapeHtml(agency.name)}${agency.phone ? ` · ${escapeHtml(agency.phone)}` : ''}</div>`;
  }

  const logo = agency.logoUrl ? `<img src="${escapeHtml(agency.logoUrl)}" alt="">` : '';
  const title = `${client.name} — relatório de ${report.monthLabel.toLowerCase()}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="bar"><span>${escapeHtml(title)}</span><button type="button" onclick="window.print()">Salvar PDF</button></div>
<main class="pages">
${pages.map((page) => `<section class="page"><div class="top">${logo}<span>${escapeHtml(page.top)}</span></div><div class="body">${page.body}</div></section>`).join('\n')}
</main>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/content-central-report.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/content-central-report.js tests/content-central-report.test.js
git commit -m "feat(content-central): build the monthly report from published items and stored numbers"
```

---

### Task 3: Routes and the collector scheduler

**Files:**
- Modify: `src/content-central-server.js` (imports; next to the `briefing` route; next to `startAlertEmailScheduler`; `startContentCentralServer`)
- Modify: `.env.example`
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: `collectAllProjectsMetrics`, `loadProjectMetrics`, `INSIGHTS_PERMISSION` (Task 1); `buildMonthlyReport`, `listReportMonths`, `renderReportPage` (Task 2).
- Produces: `GET /api/projects/:projectId/reports → { months: [{ month, label, publications, status }], insightsEnabled: boolean }`; `GET /api/projects/:projectId/report?month=YYYY-MM → text/html` (400 on a bad month, 404 on an unknown project).

- [ ] **Step 1: Write the failing test**

Append to `tests/content-central-server.test.js`:

```js
test('content central lists report months and serves the monthly report page', async () => {
  await withServer(async (dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'relato', name: 'Loja Relato', handle: '@relato' }),
    });
    const batchDir = join(dir, '_opensquad', 'content-central', 'projects', 'relato', 'content', 'drafts', 'lote-1');
    await mkdir(batchDir, { recursive: true });
    await writeFile(join(batchDir, 'day-01-instagram_story.json'), JSON.stringify({
      contentId: 'relato-1',
      batchId: 'lote-1',
      channel: 'instagram_story',
      scheduledDate: '2026-08-10',
      scheduledTime: '09:00',
      contentTopic: { type: 'offer' },
      caption: { text: '' },
      publish: { publishedAt: new Date(2026, 7, 10, 12).toISOString(), realPublished: true, metaMediaId: 'm1' },
    }), 'utf-8');

    const list = await request(server, '/api/projects/relato/reports');
    assert.equal(list.response.status, 200);
    assert.deepEqual(list.body.months.map((entry) => [entry.month, entry.publications, entry.status]), [['2026-08', 1, 'pronto']]);
    assert.equal(list.body.insightsEnabled, false);

    const page = await realFetch(`${server.url}/api/projects/relato/report?month=2026-08`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    assert.match(html, /Loja Relato/);
    assert.match(html, /Agosto de 2026/);

    assert.equal((await request(server, '/api/projects/relato/report?month=agosto')).response.status, 400);
    assert.equal((await request(server, '/api/projects/nao-existe/report?month=2026-08')).response.status, 404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="lists report months" tests/content-central-server.test.js`
Expected: FAIL — the `reports` request answers 404 (no such route).

- [ ] **Step 3: Add the routes and the scheduler**

Imports at the top of `src/content-central-server.js`, after the `content-central-personas.js` import:

```js
import { collectAllProjectsMetrics, INSIGHTS_PERMISSION, loadProjectMetrics } from './content-central-metrics.js';
import { buildMonthlyReport, listReportMonths, renderReportPage } from './content-central-report.js';
```

Right after the `prospect-mockup` route in `handleRequest`:

```js
  if (method === 'GET' && parts.length === 4 && (parts[3] === 'reports' || parts[3] === 'report')) {
    const project = await loadProject(getCentralPaths(targetDir, projectId)).catch(() => null);
    if (!project) return sendJson(res, 404, { error: 'Project not found' });
    const items = await listProjectContent(projectId, targetDir);

    if (parts[3] === 'reports') {
      return sendJson(res, 200, {
        months: listReportMonths({ items }),
        insightsEnabled: (project.token?.permissions || []).includes(INSIGHTS_PERMISSION),
      });
    }

    const month = url.searchParams.get('month') || '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return sendJson(res, 400, { error: 'Informe o mês no formato AAAA-MM.' });
    const [metrics, agency] = await Promise.all([loadProjectMetrics(projectId, targetDir), getCommercialAgency(targetDir)]);
    return sendHtml(res, renderReportPage(buildMonthlyReport({ project, agency, items, metrics, month })));
  }
```

Right before `startAlertEmailScheduler`:

```js
// Reads Instagram numbers for the monthly report. On by default, unlike
// publishing: it only reads from Meta. Hourly because a story's numbers
// exist only while it is live (24h) — see content-central-metrics.js.
function startInstagramMetricsScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_METRICS === 'false') return null;
  const intervalMs = Number(process.env.OPENSQUAD_METRICS_CHECK_INTERVAL_MS || 3600000);
  let running = false;
  const sweep = () => {
    if (running) return;
    running = true;
    collectAllProjectsMetrics(targetDir)
      .catch((err) => console.error('[content-central] metrics sweep failed:', err.message))
      .finally(() => { running = false; });
  };
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}
```

In `startContentCentralServer`, after `const alertEmailSchedulerTimer = …`:

```js
  const instagramMetricsSchedulerTimer = startInstagramMetricsScheduler(targetDir);
```

and in `close`, next to the other `clearInterval` lines:

```js
      if (instagramMetricsSchedulerTimer) clearInterval(instagramMetricsSchedulerTimer);
```

In `.env.example`, after the `OPENSQUAD_ALERT_EMAIL_CHECK_INTERVAL_MS` line:

```
# Central de Conteúdo — coleta dos números do Instagram para o relatório
# mensal (seguidores, curtidas e, com a permissão instagram_manage_insights
# no token, visualizações e alcance). Ligada por padrão: só lê dados da Meta.
# Roda de hora em hora porque o número de um story só existe enquanto ele
# está no ar (24h).
# OPENSQUAD_ENABLE_METRICS=false
# OPENSQUAD_METRICS_CHECK_INTERVAL_MS=3600000
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-name-pattern="lists report months" tests/content-central-server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/content-central-server.js tests/content-central-server.test.js
git add -f .env.example
git commit -m "feat(content-central): serve the monthly report and run the numbers collector hourly"
```

(`.env.example` is tracked; `-f` is harmless if it is not ignored.)

---

### Task 4: "Relatório pronto" notice

**Files:**
- Modify: `src/content-central.js` (`listSystemAlerts`, `alertNotificationKey`, `alertEmailSubject`, `sendDueAlertEmails`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `localMonthKey`, `previousMonthKey`, `monthNamePt` (Task 1); the existing `dismissSystemAlert`.
- Produces: alert `{ type: 'report_ready', projectId, projectName, month: 'YYYY-MM', message, key: 'report_ready:<projectId>:<YYYY-MM>' }`; `listSystemAlerts(targetDir, { now })`.

- [ ] **Step 1: Write the failing test**

Add to `tests/content-central.test.js`, after the "a dismissed alert stays closed" test (`mkdir`, `writeFile`, `join`, `listSystemAlerts`, `sendDueAlertEmails`, `dismissSystemAlert` are already imported there):

```js
test('last month\'s report is announced from day 3 on, emailed once, and can be closed', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'rel-aviso', name: 'Aviso', handle: '@aviso' }, dir);
    const batchDir = join(dir, '_opensquad', 'content-central', 'projects', 'rel-aviso', 'content', 'drafts', 'lote-1');
    await mkdir(batchDir, { recursive: true });
    await writeFile(join(batchDir, 'day-01-instagram_story.json'), JSON.stringify({
      contentId: 'rel-aviso-1',
      batchId: 'lote-1',
      channel: 'instagram_story',
      scheduledDate: '2026-09-10',
      publish: { publishedAt: new Date(2026, 8, 10, 12).toISOString(), realPublished: true },
    }), 'utf-8');

    // Day 2: Meta may still be delivering last month's numbers.
    assert.deepEqual(await listSystemAlerts(dir, { now: new Date(2026, 9, 2, 9) }), []);

    const [alert] = await listSystemAlerts(dir, { now: new Date(2026, 9, 3, 9) });
    assert.equal(alert.type, 'report_ready');
    assert.equal(alert.month, '2026-09');
    assert.equal(alert.key, 'report_ready:rel-aviso:2026-09');
    assert.equal(alert.message, 'Relatório de setembro pronto.');

    // In November, September is no longer last month.
    assert.deepEqual(await listSystemAlerts(dir, { now: new Date(2026, 10, 5, 9) }), []);

    const emails = [];
    const emailSender = async (email) => emails.push(email.subject);
    await sendDueAlertEmails(dir, { emailSender, now: new Date(2026, 9, 3, 9) });
    await sendDueAlertEmails(dir, { emailSender, now: new Date(2026, 9, 10, 9) });
    assert.equal(emails.length, 1);
    assert.match(emails[0], /Aviso — relatório de setembro pronto/);

    await dismissSystemAlert(alert.key, dir);
    assert.deepEqual(await listSystemAlerts(dir, { now: new Date(2026, 9, 12, 9) }), []);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="report is announced" tests/content-central.test.js`
Expected: FAIL — `alert` is undefined on day 3.

- [ ] **Step 3: Implement the notice**

In `listSystemAlerts`, right after `const alerts = [];`:

```js
  const now = options.now || new Date();
  // From day 3 on: Meta delivers last month's numbers up to 48 hours late.
  const reportMonth = now.getDate() >= 3 ? previousMonthKey(localMonthKey(now)) : null;
```

Inside the per-project loop, right after `const content = await listProjectContent(project.projectId, targetDir);`:

```js
    if (reportMonth && content.some((item) => item.publish?.publishedAt && localMonthKey(new Date(item.publish.publishedAt)) === reportMonth)) {
      alerts.push({
        type: 'report_ready',
        projectId: project.projectId,
        projectName: project.name,
        month: reportMonth,
        message: `Relatório de ${monthNamePt(reportMonth)} pronto.`,
      });
    }
```

Replace `alertNotificationKey`:

```js
function alertNotificationKey(alert) {
  // The month keeps each report's notice distinct: closing September's must
  // not hide October's.
  const subject = alert.contentId || alert.month;
  return subject ? `${alert.type}:${alert.projectId}:${subject}` : `${alert.type}:${alert.projectId}`;
}
```

In `alertEmailSubject`, replace the `icon` and `topic` assignments:

```js
  const icon = alert.type === 'token_expired' || alert.type === 'whatsapp_disconnected' ? '🔴'
    : alert.type === 'token_expiring' ? '🟡'
    : alert.type === 'report_ready' ? '📊'
    : '⚠️';
  const topic = alert.type === 'publish_failed' ? 'falha ao publicar'
    : alert.type === 'media_upload_failed' ? 'falha ao hospedar imagem'
    : alert.type === 'whatsapp_disconnected' ? 'WhatsApp desconectado'
    : alert.type === 'report_ready' ? `relatório de ${monthNamePt(alert.month)} pronto`
    : 'token da Meta';
```

In `sendDueAlertEmails`, replace the cooldown line inside the loop:

```js
    // A report being ready is news once; the other alerts get more urgent
    // while they stay open, so they repeat after the cooldown.
    const sentBefore = lastSentAt && !Number.isNaN(lastSentAt.getTime());
    if (sentBefore && (alert.type === 'report_ready' || now.getTime() - lastSentAt.getTime() < cooldownMs)) continue;
```

- [ ] **Step 4: Run the alert tests to verify they pass**

Run: `node --test --test-name-pattern="report is announced|alert" tests/content-central.test.js`
Expected: PASS — the new test and every existing alert test.

- [ ] **Step 5: Check no existing test is a calendar time bomb**

The notice depends on today's date, so a test that publishes "last month" and expects no alerts would start failing on day 3. Temporarily change `now.getDate() >= 3` to `now.getDate() >= 1` in `listSystemAlerts`, then:

Run: `npm test`
Expected: only "report is announced from day 3 on" fails (its day-2 assertion). Any other failure is a test that needs `{ now }` pinned — fix that test. Then restore `>= 3` and confirm with `git diff src/content-central.js` that the line is back.

- [ ] **Step 6: Commit**

```powershell
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): announce last month's report on the dashboard from day 3"
```

---

### Task 5: Panel — Relatórios tab, notice button, permission hint

**Files:**
- Modify: `content-central-app/src/api/client.ts`
- Create: `content-central-app/src/pages/workspace/Reports.tsx`, `Reports.test.tsx`
- Modify: `content-central-app/src/App.tsx`, `src/layouts/ProjectWorkspaceLayout.tsx`, `src/pages/Dashboard.tsx`, `src/pages/workspace/Account.tsx`
- Test: `Reports.test.tsx`, `src/pages/Dashboard.test.tsx`, `src/pages/workspace/Account.test.tsx`

**Interfaces:**
- Consumes: `GET /api/projects/:projectId/reports`, `GET /api/projects/:projectId/report?month=` (Task 3); alert type `report_ready` (Task 4).
- Produces: `ReportMonth`, `getReports(projectId)`, `reportUrl(projectId, month)` in `client.ts`; the `relatorios` route.

- [ ] **Step 1: Write the failing tests**

Create `content-central-app/src/pages/workspace/Reports.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchSequence(responses: Array<{ body: unknown; ok?: boolean }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve({
        ok: response.ok !== false,
        text: async () => JSON.stringify(response.body),
      });
    }),
  );
}

const state = {
  projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", instagram: { handle: "@boss" }, token: null }],
  globalRules: {},
};

function renderReports() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/relatorios"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Reports", () => {
  it("lists each month with its state and a link to the report", async () => {
    stubFetchSequence([
      { body: state },
      {
        body: {
          months: [
            { month: "2026-10", label: "Outubro de 2026", publications: 1, status: "parcial" },
            { month: "2026-09", label: "Setembro de 2026", publications: 27, status: "pronto" },
          ],
          insightsEnabled: true,
        },
      },
    ]);
    renderReports();

    expect(await screen.findByText("Setembro de 2026")).toBeInTheDocument();
    expect(screen.getByText("27 publicações")).toBeInTheDocument();
    expect(screen.getByText("1 publicação")).toBeInTheDocument();
    expect(screen.getByText("Pronto")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Abrir relatório" });
    expect(links[1]).toHaveAttribute("href", "/api/projects/boss-pizzaria/report?month=2026-09");
    expect(links[1]).toHaveAttribute("target", "_blank");
    expect(screen.queryByText(/não tem a permissão de alcance/)).not.toBeInTheDocument();
  });

  it("warns when the token cannot read reach, and says so when there is nothing yet", async () => {
    stubFetchSequence([{ body: state }, { body: { months: [], insightsEnabled: false } }]);
    renderReports();

    expect(await screen.findByText("Nenhum relatório ainda")).toBeInTheDocument();
    expect(screen.getByText(/não tem a permissão de alcance/)).toBeInTheDocument();
  });
});
```

Add to `content-central-app/src/pages/Dashboard.test.tsx`, after the "says why when an alert cannot be closed" test:

```tsx
  it("opens the reports tab from a report-ready alert", async () => {
    stubFetch({
      projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", token: {}, brandXray: { status: "empty" } }],
      globalRules: {},
      alerts: [
        {
          type: "report_ready",
          key: "report_ready:boss-pizzaria:2026-09",
          month: "2026-09",
          projectId: "boss-pizzaria",
          projectName: "Boss Pizzaria",
          message: "Relatório de setembro pronto.",
        },
      ],
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    const open = await screen.findByRole("link", { name: "Abrir" });
    expect(open).toHaveAttribute("href", "/projects/boss-pizzaria/relatorios");
    expect(screen.queryByRole("button", { name: "Resolver" })).not.toBeInTheDocument();
  });
```

Add to `content-central-app/src/pages/workspace/Account.test.tsx`, inside `describe("Account", …)`:

```tsx
  it("says when the token cannot read reach, and stays quiet when it can", async () => {
    const token = { configured: true, masked: "••••1234", expiresAt: null, status: "valido" };
    stubFetchSequence([{ body: projectState({ token: { ...token, permissions: ["instagram_basic"] } }) }]);
    renderAccount();
    expect(await screen.findByText(/não tem a permissão instagram_manage_insights/)).toBeInTheDocument();
  });

  it("shows no reach warning for a token with the insights permission", async () => {
    const token = { configured: true, masked: "••••1234", expiresAt: null, status: "valido" };
    stubFetchSequence([{ body: projectState({ token: { ...token, permissions: ["instagram_basic", "instagram_manage_insights"] } }) }]);
    renderAccount();
    expect(await screen.findByText("••••1234")).toBeInTheDocument();
    expect(screen.queryByText(/não tem a permissão instagram_manage_insights/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `content-central-app`): `npx vitest run src/pages/workspace/Reports.test.tsx src/pages/Dashboard.test.tsx src/pages/workspace/Account.test.tsx`
Expected: FAIL — no `relatorios` route, no "Abrir" link, no permission text.

- [ ] **Step 3: Implement the panel changes**

`content-central-app/src/api/client.ts` — in `SystemAlert`, extend the type union and add the field:

```ts
  type: "token_expired" | "token_expiring" | "publish_failed" | "media_upload_failed" | "topic_ideas_fallback" | "whatsapp_disconnected" | "report_ready";
```

```ts
  month?: string;
```

After `prospectMockupUrl`:

```ts
export interface ReportMonth {
  month: string;
  label: string;
  publications: number;
  status: "parcial" | "fechando" | "pronto";
}

export function getReports(projectId: string): Promise<{ months: ReportMonth[]; insightsEnabled: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/reports`);
}

// The report is a standalone server page (like the prospect mockup), opened
// in its own tab so the browser's print dialog can save it as a PDF.
export function reportUrl(projectId: string, month: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/report?month=${encodeURIComponent(month)}`;
}
```

Create `content-central-app/src/pages/workspace/Reports.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { getReports, reportUrl, type ReportMonth } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

const STATUS_LABELS: Record<ReportMonth["status"], string> = {
  parcial: "Parcial — mês em andamento",
  fechando: "Fechando — números completos no dia 3",
  pronto: "Pronto",
};

export function Reports() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [months, setMonths] = useState<ReportMonth[] | null>(null);
  const [insightsEnabled, setInsightsEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReports(project.projectId)
      .then((result) => {
        if (cancelled) return;
        setMonths(result.months);
        setInsightsEnabled(result.insightsEnabled);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectId]);

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Relatórios</h2>

      {!insightsEnabled ? (
        <div className="notice" style={{ marginBottom: 20 }}>
          Este token não tem a permissão de alcance. O relatório sai sem visualizações. Veja Conta e token.
        </div>
      ) : null}

      {error ? (
        <div className="pill bad">{error}</div>
      ) : months === null ? (
        <Skeleton height={140} />
      ) : months.length === 0 ? (
        <EmptyState title="Nenhum relatório ainda" description="O relatório de um mês aparece aqui depois da primeira publicação." />
      ) : (
        <div className="stack-sm">
          {months.map((entry) => (
            <Card
              key={entry.month}
              style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
            >
              <div>
                <b>{entry.label}</b>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {`${entry.publications} ${entry.publications === 1 ? "publicação" : "publicações"}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className={`pill ${entry.status === "pronto" ? "ok" : ""}`}>{STATUS_LABELS[entry.status]}</span>
                <a href={reportUrl(project.projectId, entry.month)} target="_blank" rel="noreferrer">
                  <Button type="button" variant="secondary">
                    Abrir relatório
                  </Button>
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

`content-central-app/src/App.tsx` — import `Reports` next to the other workspace pages and add, after the `calendario` route:

```tsx
          <Route path="relatorios" element={<Reports />} />
```

`content-central-app/src/layouts/ProjectWorkspaceLayout.tsx` — in `SECTIONS`, after the `calendario` entry:

```tsx
  { to: "relatorios", label: "Relatórios", group: "Conteúdo" },
```

`content-central-app/src/pages/Dashboard.tsx` — replace the `<Link …>…</Link>` inside the alert row:

```tsx
                  <Link
                    to={`/projects/${alert.projectId}/${
                      alert.type === "report_ready"
                        ? "relatorios"
                        : alert.type === "publish_failed" || alert.type === "media_upload_failed"
                          ? "calendario"
                          : "conta"
                    }`}
                  >
                    <Button type="button" variant="secondary">
                      {alert.type === "report_ready" ? "Abrir" : "Resolver"}
                    </Button>
                  </Link>
```

`content-central-app/src/pages/workspace/Account.tsx` — inside the "Status atual" card, right after the closing `</div>` of the pills row:

```tsx
        {tokenInfo?.configured && !(tokenInfo.permissions || []).includes("instagram_manage_insights") ? (
          <div className="notice" style={{ marginTop: 12 }}>
            Este token não tem a permissão instagram_manage_insights. O relatório mensal sai sem visualizações e alcance. Para
            incluir, gere o token de novo marcando essa permissão.
          </div>
        ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (in `content-central-app`): `npx vitest run src/pages/workspace/Reports.test.tsx src/pages/Dashboard.test.tsx src/pages/workspace/Account.test.tsx src/layouts/ProjectWorkspaceLayout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check the app**

Run (in `content-central-app`): `npm run build`
Expected: build succeeds with no TypeScript error.

- [ ] **Step 6: Commit**

```powershell
git add content-central-app/src
git commit -m "feat(content-central-app): Relatórios tab, report notice button and reach-permission hint"
```

---

### Task 6: Whole-feature verification

**Files:**
- Modify: none expected (fixes only if a check fails).

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full backend suite and lint**

Run: `npm test` then `npm run lint`
Expected: every test passes (745 before this work, plus the new ones); lint clean.

- [ ] **Step 2: Full frontend suite**

Run (in `content-central-app`): `npm run test`
Expected: every test passes.

- [ ] **Step 3: See the real page with real pilot data**

Copy one pilot project into the worktree (data is git-ignored there; the original is not touched), without secrets:

```powershell
$src = "C:\Users\jucic\OneDrive\Documentos\PROJETO\OPENSQUAD\_opensquad\content-central"
$dst = ".\_opensquad\content-central"
New-Item -ItemType Directory -Force "$dst\projects" | Out-Null
Copy-Item -Recurse "$src\projects\casa-de-embalagem" "$dst\projects\casa-de-embalagem"
Copy-Item "$src\commercial-agency.json" "$dst\commercial-agency.json"
Copy-Item -Recurse "$src\commercial-assets" "$dst\commercial-assets"
```

Start the server on a port that is not production's, with the collector and publishing off:

Run: `$env:OPENSQUAD_ENABLE_METRICS='false'; node bin/opensquad.js content serve 3398`
Open `http://127.0.0.1:3398/api/projects/casa-de-embalagem/report?month=2026-08`.
Expected: cover with Hygi's real August total, a Stories page with the six most recent artes and no numbers, a feed page, no audience page — the reduced layout, matching the approved mockup's structure. Take a screenshot and compare against `relatorio-completo.html`.

- [ ] **Step 4: Check the PDF**

Print the page to PDF with headless Chromium (`--print-to-pdf`, no header/footer) and read it with `pypdf`.
Expected: one PDF page per report page, each 360×640 CSS px (270×480 pt).

- [ ] **Step 5: Update the code graph**

Run: `graphify update .`

- [ ] **Step 6: Commit the spec and plan with the branch**

```powershell
git add -f docs/superpowers/specs/2026-10-02-relatorio-mensal-design.md docs/superpowers/plans/2026-10-02-relatorio-mensal.md
git commit -m "docs(content-central): design and plan for the monthly client report"
```

- [ ] **Step 7: Hand the live validation to the operator**

These need the operator and a real token, so they are reported, not done:

- Regenerate King's token with `instagram_manage_insights`, let one collection run, and confirm in `metrics/instagram.json`: followers, live-story views, the month totals — and that the id `/stories` returns equals the one stored in `publish.metaMediaId`.
- Confirm the Graph API accepts the 30-day windows and answers `total_value` in the shape the collector reads.
