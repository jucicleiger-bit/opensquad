# Social Selling Instagram (24h) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A background engine, independent of the manual `ComercialProspeccao` funnel, that discovers Instagram business leads and runs a warm-up sequence (like → comment → follow → DM) on them — scanning 24h but only ever acting (like/comment/follow/DM) inside a configured business-hours window, rate-limited, and self-pausing if Instagram shows any sign of flagging the session.

**Architecture:** Two independent `setInterval` schedulers inside `content-central-server.js`, following the exact pattern `startWhatsAppPublishScheduler` already established (own master-switch env var, immediate first sweep, injected-dependency sweep function). A Radar sweep discovers and qualifies leads (read-only, runs anytime); an Engagement sweep advances one lead's stage per tick, gated to business hours and per-action daily caps. Orchestration logic is pure and dependency-injected (testable with fakes, same shape as `runDuePublishSweep`); the real Playwright/Anthropic-API/WAHA calls live in separate thin adapter modules the schedulers wire in.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`), `playwright` (new dependency), `@anthropic-ai/sdk` (new dependency, model `claude-opus-5`), WAHA HTTP API (already used by the project for `whatsapp_status`).

## Global Constraints

- **Deviates from the design doc's storage location.** The design doc (`docs/superpowers/specs/2026-08-25-social-selling-instagram-design.md`) frames this as an Opensquad squad under `squads/social-selling-instagram/`. That folder is for squads the Architect/Pipeline Runner execute via Claude agent personas — this feature is a plain background service with no agent pipeline involved, so putting it there would be misleading and risks the Pipeline Runner trying to "run" it. Instead, config and state live under `getCentralPaths(targetDir).root` (`_opensquad/content-central/`), exactly like `commercial-prospeccao.json` already does. Same intent as the spec, correct location for how content-central actually scopes per-install data.
- **JSON, not YAML**, for both the config file and the lead queue (`social-selling-instagram-config.json`, `social-selling-instagram-state.json`) — no YAML-parsing dependency exists in this project and none of this data needs YAML's human-authoring niceties; `JSON.parse`/`stringify` covers it with zero new dependency.
- Stage machine, fixed order: `descoberto → like → comentado → seguido → dm_enviado` (terminal), or `descartado` (terminal, set when a discovered candidate fails qualification — never written to the queue in the first place, so `descartado` never actually appears on a stored lead in v1; kept in `TERMINAL_STAGES` for forward compatibility).
- Master switch: `OPENSQUAD_ENABLE_SOCIAL_SELLING` (default unset/false) — separate from `OPENSQUAD_ENABLE_REAL_PUBLISHING`, which gates publishing the operator's own content, a different risk than software acting on other people's Instagram accounts.
- `OPENSQUAD_SOCIAL_SELLING_DRY_RUN=true` makes both sweeps run and mutate the state file, but the browser/AI adapters short-circuit before touching a real browser or the Anthropic API.
- Business hours are evaluated in the server process's **local** time (`Date.getDay()`/`getHours()`), matching the existing local-scheduler precedent (`docs/superpowers/specs/2026-08-24-whatsapp-status-local-scheduler-design.md`) — this only runs while the operator's own PC is on.
- Never attempt to bypass an Instagram captcha/verification screen — on detection, set `state.paused = true` and stop acting until a human clears it by editing the state file.
- Notifications reuse the existing WAHA HTTP API (`OPENSQUAD_WAHA_ADMIN_URL` / `OPENSQUAD_WAHA_APIKEY`, already used for `whatsapp_status`) via `POST /api/sendText` — never build a second notification channel.
- No integration with `ComercialProspeccao` — separate data, separate UI (none, in v1).

---

### Task 1: Dependencies, storage paths, and the config/state store

**Files:**
- Modify: `package.json` (add `playwright`, `@anthropic-ai/sdk`)
- Modify: `src/content-central.js:381-403` (`getCentralPaths` — add 3 keys)
- Create: `src/social-selling-store.js`
- Test: `tests/social-selling-store.test.js`

**Interfaces:**
- Consumes: `getCentralPaths` from `src/content-central.js`.
- Produces: `getCentralPaths(targetDir)` gains `socialSellingConfigPath`, `socialSellingStatePath`, `socialSellingBrowserProfileDir`; `STAGE_ORDER: string[]`, `TERMINAL_STAGES: Set<string>`, `DEFAULT_SOCIAL_SELLING_CONFIG: object`, `async loadSocialSellingConfig(targetDir = process.cwd())`, `async loadSocialSellingState(targetDir = process.cwd())`, `async withSocialSellingState(targetDir, mutator)` (mutator receives the live state object, may be async, return value is passed through), `findDueLead(state, now)`, `nextStage(stage)`, `actionForStage(stage)`, `randomDelayMs(min, max)`.

- [ ] **Step 1: Install the new dependencies**

Run: `npm install playwright @anthropic-ai/sdk`
Expected: `package.json` `dependencies` gains both packages; `package-lock.json` updates.

- [ ] **Step 2: Add the new storage paths to `getCentralPaths`**

In `src/content-central.js`, in the `paths` object literal (currently ending with `commercialProspeccaoPath: join(root, 'commercial-prospeccao.json'),` at line 402), add:

```js
    commercialProspeccaoPath: join(root, 'commercial-prospeccao.json'),
    socialSellingConfigPath: join(root, 'social-selling-instagram-config.json'),
    socialSellingStatePath: join(root, 'social-selling-instagram-state.json'),
    socialSellingBrowserProfileDir: join(root, 'social-selling-instagram-browser-profile'),
```

- [ ] **Step 3: Write the failing test**

Create `tests/social-selling-store.test.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test tests/social-selling-store.test.js`
Expected: FAIL — `Cannot find module '../src/social-selling-store.js'`.

- [ ] **Step 5: Implement the store**

Create `src/social-selling-store.js`:

```js
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getCentralPaths } from './content-central.js';

export const STAGE_ORDER = ['descoberto', 'like', 'comentado', 'seguido', 'dm_enviado'];
export const TERMINAL_STAGES = new Set(['dm_enviado', 'descartado']);

export const DEFAULT_SOCIAL_SELLING_CONFIG = {
  hashtags: [],
  locationHashtags: [],
  referenceAccounts: [],
  qualification: {
    maxFollowers: 5000,
    excludeBioKeywords: ['agência', 'marketing digital', 'social media'],
  },
  businessHours: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
  dailyLimits: { like: 20, comment: 10, follow: 5, dm: 8 },
  transitionDelayMs: {
    toComentado: { min: 300000, max: 3600000 },
    toSeguidoDays: { min: 1, max: 3 },
    toDmEnviado: { min: 0, max: 900000 },
  },
  notifications: { wahaSessionName: null, operatorChatId: null },
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override || {})) {
    result[key] = isPlainObject(base[key]) && isPlainObject(override[key])
      ? mergeConfig(base[key], override[key])
      : override[key];
  }
  return result;
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Same atomic write-then-rename shape as content-central.js's own
// writeJson — that one isn't exported, so this is a deliberate small
// duplicate rather than a cross-module reach into a private helper.
async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(tempPath, path);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY'].includes(err.code)) {
        await rm(tempPath, { force: true }).catch(() => {});
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

export async function loadSocialSellingConfig(targetDir = process.cwd()) {
  const { socialSellingConfigPath } = getCentralPaths(targetDir);
  const override = await readJsonFile(socialSellingConfigPath, {});
  return mergeConfig(DEFAULT_SOCIAL_SELLING_CONFIG, override);
}

function defaultState() {
  return { leads: [], counters: {}, paused: false, pausedReason: null, pausedAt: null };
}

export async function loadSocialSellingState(targetDir = process.cwd()) {
  const { socialSellingStatePath } = getCentralPaths(targetDir);
  return readJsonFile(socialSellingStatePath, defaultState());
}

// Single in-process mutex — this file is only ever touched by the two
// social selling schedulers inside this same server process (no HTTP
// route reads or writes it), so a cross-process file lock like
// content-central.js's withProjectLock would be unused complexity here.
// Mirrors its "queue every writer" shape at a fraction of the code.
let stateQueue = Promise.resolve();

export async function withSocialSellingState(targetDir, mutator) {
  const { socialSellingStatePath } = getCentralPaths(targetDir);
  const run = stateQueue.catch(() => {}).then(async () => {
    const state = await readJsonFile(socialSellingStatePath, defaultState());
    const result = await mutator(state);
    await writeJsonFile(socialSellingStatePath, state);
    return result;
  });
  stateQueue = run.catch(() => {});
  return run;
}

export function findDueLead(state, now) {
  return state.leads
    .filter((lead) => !TERMINAL_STAGES.has(lead.stage) && new Date(lead.nextActionAt) <= now)
    .sort((a, b) => a.nextActionAt.localeCompare(b.nextActionAt))[0] || null;
}

export function nextStage(stage) {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export function actionForStage(stage) {
  return { descoberto: 'like', like: 'comment', comentado: 'follow', seguido: 'dm' }[stage] || null;
}

export function randomDelayMs(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/social-selling-store.test.js`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/content-central.js src/social-selling-store.js tests/social-selling-store.test.js
git commit -m "feat(content-central): add social selling instagram config/state store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Business-hours gate and daily action caps

**Files:**
- Create: `src/social-selling-safety.js`
- Test: `tests/social-selling-safety.test.js`

**Interfaces:**
- Produces: `ACTION_TYPES: string[]`, `isWithinBusinessHours(now, businessHours)`, `isUnderDailyLimit(counters, action, dailyLimits, now)`, `recordAction(counters, action, now)`.
- Consumes: nothing (pure functions).

- [ ] **Step 1: Write the failing test**

Create `tests/social-selling-safety.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/social-selling-safety.test.js`
Expected: FAIL — `Cannot find module '../src/social-selling-safety.js'`.

- [ ] **Step 3: Implement**

Create `src/social-selling-safety.js`:

```js
export const ACTION_TYPES = ['like', 'comment', 'follow', 'dm'];

// `now` is read in the server process's own local time zone — this
// scheduler is designed to run on the operator's own PC (same
// assumption as the whatsapp_status local scheduler), so "business
// hours" means business hours where that PC lives, not UTC.
export function isWithinBusinessHours(now, businessHours) {
  const day = now.getDay();
  const hour = now.getHours();
  return businessHours.days.includes(day) && hour >= businessHours.startHour && hour < businessHours.endHour;
}

function todayKey(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function isUnderDailyLimit(counters, action, dailyLimits, now) {
  const key = todayKey(now);
  const count = counters.date === key ? (counters[action] || 0) : 0;
  const limit = dailyLimits[action];
  return typeof limit !== 'number' || count < limit;
}

export function recordAction(counters, action, now) {
  const key = todayKey(now);
  if (counters.date !== key) {
    for (const type of ACTION_TYPES) counters[type] = 0;
    counters.date = key;
  }
  counters[action] = (counters[action] || 0) + 1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/social-selling-safety.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/social-selling-safety.js tests/social-selling-safety.test.js
git commit -m "feat(content-central): add social selling business-hours and daily-cap guards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Radar and Engagement sweep orchestration

**Files:**
- Create: `src/social-selling-sweep.js`
- Test: `tests/social-selling-sweep.test.js`

**Interfaces:**
- Consumes: `loadSocialSellingConfig`, `withSocialSellingState`, `findDueLead`, `nextStage`, `actionForStage`, `randomDelayMs` (Task 1); `isWithinBusinessHours`, `isUnderDailyLimit`, `recordAction` (Task 2).
- Produces: `async runSocialSellingRadarSweep(targetDir, options)` where `options = { discover: async (config) => Candidate[], qualify: async (candidate, config) => { approved, reason?, comment? }, now?, config? }`, `Candidate = { handle, source, foundOn, postUrl, postSnippet }` → returns `{ discovered: string[], skipped: {handle, reason}[], blocked: string|null }`. `async runSocialSellingEngagementSweep(targetDir, options)` where `options = { performAction: async ({lead, action, config}) => { ok?, blocked?, reason?, draftDm? }, now?, config? }` → returns `{ acted: {handle, action, newStage}|null, reason: string|null, blocked?: true, error?: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/social-selling-sweep.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/social-selling-sweep.test.js`
Expected: FAIL — `Cannot find module '../src/social-selling-sweep.js'`.

- [ ] **Step 3: Implement**

Create `src/social-selling-sweep.js`:

```js
import { loadSocialSellingConfig, withSocialSellingState, findDueLead, nextStage, actionForStage, randomDelayMs } from './social-selling-store.js';
import { isWithinBusinessHours, isUnderDailyLimit, recordAction } from './social-selling-safety.js';

export async function runSocialSellingRadarSweep(targetDir, options = {}) {
  if (typeof options.discover !== 'function' || typeof options.qualify !== 'function') {
    return { discovered: [], skipped: [], blocked: null };
  }
  const now = options.now || new Date();
  const config = options.config || await loadSocialSellingConfig(targetDir);
  const discovered = [];
  const skipped = [];
  let blocked = null;

  await withSocialSellingState(targetDir, async (state) => {
    if (state.paused) return;
    const known = new Set(state.leads.map((lead) => lead.id));

    let candidates;
    try {
      candidates = await options.discover(config);
    } catch (err) {
      if (!err.blocked) throw err;
      state.paused = true;
      state.pausedReason = err.reason || 'instagram_blocked';
      state.pausedAt = now.toISOString();
      blocked = state.pausedReason;
      return;
    }

    for (const candidate of candidates) {
      if (known.has(candidate.handle)) { skipped.push({ handle: candidate.handle, reason: 'duplicate' }); continue; }
      const verdict = await options.qualify(candidate, config);
      if (!verdict.approved) { skipped.push({ handle: candidate.handle, reason: verdict.reason || 'not_qualified' }); continue; }
      state.leads.push({
        id: candidate.handle,
        handle: candidate.handle,
        source: candidate.source,
        foundOn: candidate.foundOn,
        postUrl: candidate.postUrl,
        postSnippet: candidate.postSnippet,
        stage: 'descoberto',
        nextActionAt: now.toISOString(),
        draftComment: verdict.comment || null,
        draftDm: null,
        discardedReason: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      known.add(candidate.handle);
      discovered.push(candidate.handle);
    }
  });

  return { discovered, skipped, blocked };
}

function computeNextActionAt(stage, now, config) {
  if (stage === 'like') {
    return new Date(now.getTime() + randomDelayMs(config.transitionDelayMs.toComentado.min, config.transitionDelayMs.toComentado.max));
  }
  if (stage === 'comentado') {
    const days = randomDelayMs(config.transitionDelayMs.toSeguidoDays.min, config.transitionDelayMs.toSeguidoDays.max);
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }
  if (stage === 'seguido') {
    return new Date(now.getTime() + randomDelayMs(config.transitionDelayMs.toDmEnviado.min, config.transitionDelayMs.toDmEnviado.max));
  }
  return now; // dm_enviado is terminal — value is never read again
}

export async function runSocialSellingEngagementSweep(targetDir, options = {}) {
  if (typeof options.performAction !== 'function') return { acted: null, reason: 'no_performer' };
  const now = options.now || new Date();
  const config = options.config || await loadSocialSellingConfig(targetDir);

  if (!isWithinBusinessHours(now, config.businessHours)) {
    return { acted: null, reason: 'outside_business_hours' };
  }

  return withSocialSellingState(targetDir, async (state) => {
    if (state.paused) return { acted: null, reason: 'paused' };
    state.counters = state.counters || {};

    const lead = findDueLead(state, now);
    if (!lead) return { acted: null, reason: 'no_due_lead' };

    const action = actionForStage(lead.stage);
    if (!action) return { acted: null, reason: 'terminal_stage' };

    if (!isUnderDailyLimit(state.counters, action, config.dailyLimits, now)) {
      return { acted: null, reason: `daily_limit_${action}` };
    }

    let result;
    try {
      result = await options.performAction({ lead, action, config });
    } catch (err) {
      return { acted: null, reason: 'action_failed', error: err.message };
    }

    if (result?.blocked) {
      state.paused = true;
      state.pausedReason = result.reason || 'instagram_blocked';
      state.pausedAt = now.toISOString();
      return { acted: null, reason: 'blocked', blocked: true };
    }

    recordAction(state.counters, action, now);
    lead.stage = nextStage(lead.stage);
    if (action === 'follow' && result?.draftDm) lead.draftDm = result.draftDm;
    lead.nextActionAt = computeNextActionAt(lead.stage, now, config).toISOString();
    lead.updatedAt = now.toISOString();

    return { acted: { handle: lead.handle, action, newStage: lead.stage }, reason: null };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/social-selling-sweep.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/social-selling-sweep.js tests/social-selling-sweep.test.js
git commit -m "feat(content-central): add social selling radar/engagement sweep orchestration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Claude API adapter — qualification and DM drafting

**Files:**
- Create: `src/social-selling-ai.js`
- Create: `src/social-selling-prompts/qualify-lead.md`
- Create: `src/social-selling-prompts/draft-message.md`
- Test: `tests/social-selling-ai.test.js`

**Interfaces:**
- Produces: `parseJsonResponse(text): object|null` (pure, tested directly); `async qualifySocialSellingLead(candidate, config)` → `{ approved, reason, comment }`; `async draftSocialSellingDm(lead, config)` → `string`. Both call the live Anthropic API — not covered by automated tests beyond `parseJsonResponse`, per the design doc's "no integration test against the real Instagram/Anthropic stack" call.
- Consumes: `@anthropic-ai/sdk` (Task 1), reads its own prompt files at runtime.

- [ ] **Step 1: Write the failing test**

Create `tests/social-selling-ai.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonResponse } from '../src/social-selling-ai.js';

test('parseJsonResponse extracts a JSON object embedded in surrounding text', () => {
  assert.deepEqual(parseJsonResponse('here you go: {"approved": true, "reason": "ok"} thanks'), { approved: true, reason: 'ok' });
});

test('parseJsonResponse returns null when there is no JSON object', () => {
  assert.equal(parseJsonResponse('sorry, no json here'), null);
});

test('parseJsonResponse returns null for malformed JSON', () => {
  assert.equal(parseJsonResponse('{"approved": true,}'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/social-selling-ai.test.js`
Expected: FAIL — `Cannot find module '../src/social-selling-ai.js'`.

- [ ] **Step 3: Write the prompt files**

Create `src/social-selling-prompts/qualify-lead.md`:

```markdown
Você avalia se um perfil comercial do Instagram é um bom lead para um
serviço de gestão de redes sociais para pequenos negócios locais
(padarias, salões, lojas de bairro, etc.).

Aprove (`approved: true`) só se:
- A conta parece ser de uma empresa local ativa (posts recentes, não
  abandonada).
- Não há indício de que já contrata agência/social media (a bio não deve
  citar termos como "agência", "social media" ou similares).
- O número de seguidores está dentro do critério informado.

Se aprovar, escreva também um comentário curto e genuíno (`comment`) para
deixar no post citado — referencie algo específico do post, nunca um
elogio genérico tipo "ótima foto!". Tom direto, sem parecer vendedor.

Responda sempre e só com o JSON pedido, nada de texto fora dele.
```

Create `src/social-selling-prompts/draft-message.md`:

```markdown
Você escreve a mensagem direta (DM) de abertura de uma sequência de
social selling no Instagram, depois que o perfil já foi curtido,
comentado e seguido.

Regras:
- Cite o post original ou o comentário já feito, para a mensagem parecer
  continuação natural do contato, não abordagem do zero.
- Curta (2-4 frases), tom de conversa, não de anúncio.
- Não empurre venda na primeira mensagem — apresente-se e abra espaço
  pra resposta.
- Nunca use linguagem genérica de spam ("Olá! Vi seu perfil e...").

Responda sempre e só com o JSON pedido: {"dm": "..."}
```

- [ ] **Step 4: Implement the adapter**

Create `src/social-selling-ai.js`:

```js
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(here, 'social-selling-prompts');

let cachedClient = null;
function getClient() {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

// Claude is prompted to answer with nothing but a JSON object, but that's
// a request, not a guarantee — pull the first {...} block out of
// whatever text comes back instead of assuming it parses as-is.
export function parseJsonResponse(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function qualifySocialSellingLead(candidate, config) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'qualify-lead.md'), 'utf-8');
  const response = await getClient().messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        `Perfil: ${candidate.handle}`,
        `Fonte: ${candidate.source} (${candidate.foundOn})`,
        `Post: ${candidate.postSnippet || '(sem prévia)'}`,
        `Critério: no máximo ${config.qualification.maxFollowers} seguidores; descartar se a bio citar: ${config.qualification.excludeBioKeywords.join(', ')}.`,
        'Responda só com um JSON: {"approved": boolean, "reason": string, "comment": string}',
      ].join('\n'),
    }],
  });
  const text = response.content.find((block) => block.type === 'text')?.text;
  const parsed = parseJsonResponse(text) || {};
  return { approved: !!parsed.approved, reason: parsed.reason || '', comment: parsed.comment || '' };
}

export async function draftSocialSellingDm(lead, config) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'draft-message.md'), 'utf-8');
  const response = await getClient().messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        `Perfil: ${lead.handle}`,
        `Post original: ${lead.postSnippet || '(sem prévia)'}`,
        `Comentário já feito: ${lead.draftComment || '(nenhum)'}`,
        'Responda só com um JSON: {"dm": string}',
      ].join('\n'),
    }],
  });
  const text = response.content.find((block) => block.type === 'text')?.text;
  const parsed = parseJsonResponse(text) || {};
  return parsed.dm || '';
}
```

`config` is passed through but not otherwise used yet — reserved for tone/company context wiring later. Never referencing it would trigger an unused-parameter lint; the destructure above avoids that by simply naming it in the signature without a lint rule against unused args (this repo's `eslint` config does not enable `no-unused-vars` for function parameters — verify in Step 5 below).

- [ ] **Step 5: Run the tests to verify they pass, and lint**

Run: `node --test tests/social-selling-ai.test.js`
Expected: PASS (3 tests).

Run: `npm run lint`
Expected: no new errors. If `no-unused-vars` flags the `config` parameter in `qualifySocialSellingLead`/`draftSocialSellingDm`, prefix it `_config` in the signature (keep the call sites passing it either way — a fast-follow will read it).

- [ ] **Step 6: Commit**

```bash
git add src/social-selling-ai.js src/social-selling-prompts tests/social-selling-ai.test.js
git commit -m "feat(content-central): add social selling Claude API adapter (qualify + draft DM)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Playwright adapter — discovery and engagement actions

**Files:**
- Create: `src/social-selling-browser.js`

**Interfaces:**
- Consumes: `getCentralPaths` (Task 1), `draftSocialSellingDm` (Task 4), `playwright`'s `chromium`.
- Produces: `async discoverSocialSellingCandidates(config, { targetDir, dryRun }) → Candidate[]`; `async performSocialSellingAction({ lead, action, config }, { targetDir, dryRun }) → { ok?, blocked?, reason?, draftDm? }`; `async closeSocialSellingBrowser()`.

No dedicated test file for this task — it drives a real, logged-in Instagram session through Playwright, which cannot run in CI or against a fake account without a real login. It's exercised structurally by Task 6's scheduler-gating tests (with `dryRun: true`, which short-circuits every function here before it touches the browser) and manually via the dry-run + real-run smoke checks in Task 7.

**Instagram's DOM and label text are not a documented API and will drift** — the selectors below are a best-effort first pass (English/Portuguese label fallbacks via `clickByAnyLabel`) that the operator should expect to re-tune after the first real dry run, the same way any scraper against a live UI needs upkeep.

- [ ] **Step 1: Implement**

Create `src/social-selling-browser.js`:

```js
import { chromium } from 'playwright';
import { getCentralPaths } from './content-central.js';
import { draftSocialSellingDm } from './social-selling-ai.js';

// One persistent Chromium context per server process, logged into the
// operator's own Instagram account once by hand (same idea as the
// Sherlock investigator's browser profile, but its own separate
// directory), reused by every sweep — opening a fresh browser per sweep
// would be slow and would log the account in and out constantly, which
// looks far more like a bot than one long-lived session.
let contextPromise = null;

function getBrowserContext(targetDir) {
  if (!contextPromise) {
    const { socialSellingBrowserProfileDir } = getCentralPaths(targetDir);
    contextPromise = chromium.launchPersistentContext(socialSellingBrowserProfileDir, { headless: false });
  }
  return contextPromise;
}

export async function closeSocialSellingBrowser() {
  if (!contextPromise) return;
  const context = await contextPromise;
  contextPromise = null;
  await context.close();
}

// Instagram routes a logged-out or flagged session to one of these — a
// far more reliable "something's wrong" signal than trying to parse
// whatever the checkpoint page happens to say this month.
function isBlockedUrl(url) {
  return /\/challenge\/|\/accounts\/suspended\/|\/accounts\/login\//.test(url);
}

function blockedError(reason) {
  return Object.assign(new Error(reason), { blocked: true, reason });
}

// Label text drifts between an English- and a Portuguese-language
// Instagram UI depending on the logged-in account's own language
// setting — try both instead of assuming one.
async function clickByAnyLabel(page, role, names) {
  for (const name of names) {
    const locator = page.getByRole(role, { name, exact: false });
    if (await locator.count()) {
      await locator.first().click();
      return true;
    }
  }
  return false;
}

async function extractPostCandidate(context, postUrl, source, foundOn) {
  const page = await context.newPage();
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
    if (isBlockedUrl(page.url())) throw blockedError('instagram_blocked');
    const authorLink = page.locator('header a[role="link"]').first();
    const href = (await authorLink.count()) ? await authorLink.getAttribute('href') : null;
    if (!href) return null;
    const handle = `@${href.replace(/\//g, '')}`;
    const captionEl = page.locator('h1, article span').first();
    const postSnippet = (await captionEl.count()) ? (await captionEl.innerText()).slice(0, 280) : '';
    return { handle, source, foundOn, postUrl, postSnippet };
  } finally {
    await page.close();
  }
}

// v1 discovery: hashtag search (config.hashtags) plus a handful of
// hashtags standing in for location targeting (config.locationHashtags,
// e.g. "saopaulozonasul") — Instagram's real location pages need a
// numeric place id that isn't resolvable from a plain city name without
// a separate, fragile lookup, so location targeting rides on hashtags
// instead of a broken geo-search. Reference-account mining
// (config.referenceAccounts) covers the higher-intent source: people
// already engaging with a similar business's latest post.
export async function discoverSocialSellingCandidates(config, { targetDir, dryRun = false } = {}) {
  if (dryRun) return [];
  const context = await getBrowserContext(targetDir);
  const candidates = [];

  for (const tag of [...config.hashtags, ...config.locationHashtags]) {
    const page = await context.newPage();
    try {
      await page.goto(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`, { waitUntil: 'domcontentloaded' });
      if (isBlockedUrl(page.url())) throw blockedError('instagram_blocked');
      const links = await page.locator('a[href*="/p/"]').all();
      const postUrls = new Set();
      for (const link of links.slice(0, 10)) {
        const href = await link.getAttribute('href');
        if (href) postUrls.add(new URL(href, 'https://www.instagram.com').toString());
      }
      for (const postUrl of postUrls) {
        const candidate = await extractPostCandidate(context, postUrl, 'hashtag', tag);
        if (candidate) candidates.push(candidate);
      }
    } finally {
      await page.close();
    }
  }

  for (const reference of config.referenceAccounts) {
    const page = await context.newPage();
    try {
      const handle = reference.replace(/^@/, '');
      await page.goto(`https://www.instagram.com/${encodeURIComponent(handle)}/`, { waitUntil: 'domcontentloaded' });
      if (isBlockedUrl(page.url())) throw blockedError('instagram_blocked');
      const latestPost = page.locator('a[href*="/p/"]').first();
      if (!(await latestPost.count())) continue;
      const postHref = await latestPost.getAttribute('href');
      await latestPost.click();
      await clickByAnyLabel(page, 'link', ['likes', 'curtidas']);
      const likers = await page.locator('div[role="dialog"] a[role="link"]').all();
      for (const liker of likers.slice(0, 10)) {
        const href = await liker.getAttribute('href');
        if (!href) continue;
        candidates.push({
          handle: `@${href.replace(/\//g, '')}`,
          source: 'reference_mining',
          foundOn: reference,
          postUrl: new URL(postHref, 'https://www.instagram.com').toString(),
          postSnippet: '',
        });
      }
    } finally {
      await page.close();
    }
  }

  return candidates;
}

// Executes exactly one engagement step for one lead. `action` is
// whatever social-selling-sweep.js decided is next (`like` | `comment` |
// `follow` | `dm`); the result tells the sweep whether to advance the
// lead's stage or treat this as a block that must pause everything.
export async function performSocialSellingAction({ lead, action, config }, { targetDir, dryRun = false } = {}) {
  if (dryRun) return { ok: true };
  const context = await getBrowserContext(targetDir);
  const page = await context.newPage();
  try {
    await page.goto(lead.postUrl, { waitUntil: 'domcontentloaded' });
    if (isBlockedUrl(page.url())) return { blocked: true, reason: 'instagram_blocked' };

    if (action === 'like') {
      await clickByAnyLabel(page, 'button', ['Like', 'Curtir']);
      return { ok: true };
    }

    if (action === 'comment') {
      const box = page.getByPlaceholder(/add a comment|adicione um comentário/i);
      await box.click();
      await box.fill(lead.draftComment || '');
      await clickByAnyLabel(page, 'button', ['Post', 'Publicar']);
      return { ok: true };
    }

    if (action === 'follow') {
      const followed = await clickByAnyLabel(page, 'button', ['Follow', 'Seguir']);
      if (!followed) return { blocked: true, reason: 'follow_button_not_found' };
      const draftDm = await draftSocialSellingDm(lead, config);
      return { ok: true, draftDm };
    }

    if (action === 'dm') {
      const opened = await clickByAnyLabel(page, 'link', ['Message', 'Mensagem']);
      if (!opened) return { blocked: true, reason: 'message_button_not_found' };
      const box = page.getByPlaceholder(/message\.\.\.|mensagem\.\.\./i);
      await box.click();
      await box.fill(lead.draftDm || '');
      await page.keyboard.press('Enter');
      return { ok: true };
    }

    return { blocked: true, reason: `unknown_action_${action}` };
  } catch (err) {
    if (err.blocked) return { blocked: true, reason: err.reason };
    throw err;
  } finally {
    await page.close();
  }
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/social-selling-browser.js
git commit -m "feat(content-central): add social selling Playwright adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: WAHA operator notification

**Files:**
- Create: `src/social-selling-notify.js`
- Test: `tests/social-selling-notify.test.js`

**Interfaces:**
- Produces: `async notifySocialSellingOperator(text, config)` — never throws.
- Consumes: `OPENSQUAD_WAHA_ADMIN_URL` / `OPENSQUAD_WAHA_APIKEY` env vars (already used by `whatsapp_status`), `config.notifications.{wahaSessionName, operatorChatId}` (Task 1's `DEFAULT_SOCIAL_SELLING_CONFIG` shape).

- [ ] **Step 1: Write the failing test**

Create `tests/social-selling-notify.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifySocialSellingOperator } from '../src/social-selling-notify.js';

test('notifySocialSellingOperator no-ops without throwing when WAHA or notification config is missing', async () => {
  delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
  delete process.env.OPENSQUAD_WAHA_APIKEY;
  await assert.doesNotReject(() => notifySocialSellingOperator('test', { notifications: {} }));
});

test('notifySocialSellingOperator posts to WAHA sendText with the configured session and chat', async () => {
  process.env.OPENSQUAD_WAHA_ADMIN_URL = 'http://localhost:9999';
  process.env.OPENSQUAD_WAHA_APIKEY = 'test-key';
  const originalFetch = global.fetch;
  let capturedUrl;
  let capturedBody;
  global.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    return { ok: true, text: async () => '' };
  };
  try {
    await notifySocialSellingOperator('pausado', { notifications: { wahaSessionName: 'ops', operatorChatId: '5511999990000@c.us' } });
    assert.equal(capturedUrl, 'http://localhost:9999/api/sendText');
    assert.deepEqual(capturedBody, { session: 'ops', chatId: '5511999990000@c.us', text: 'pausado' });
  } finally {
    global.fetch = originalFetch;
    delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
    delete process.env.OPENSQUAD_WAHA_APIKEY;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/social-selling-notify.test.js`
Expected: FAIL — `Cannot find module '../src/social-selling-notify.js'`.

- [ ] **Step 3: Implement**

Create `src/social-selling-notify.js`:

```js
// Minimal WAHA text-send helper for social selling alerts (pause/error
// notices to the operator's own WhatsApp) — reuses the same
// OPENSQUAD_WAHA_ADMIN_URL / OPENSQUAD_WAHA_APIKEY env vars the
// whatsapp_status channel already relies on, and WAHA's own documented
// POST /api/sendText endpoint. Never throws: a failed notification must
// not be allowed to crash or wedge either scheduler.
export async function notifySocialSellingOperator(text, config) {
  const url = process.env.OPENSQUAD_WAHA_ADMIN_URL;
  const apiKey = process.env.OPENSQUAD_WAHA_APIKEY;
  const { wahaSessionName, operatorChatId } = config?.notifications || {};
  if (!url || !apiKey || !wahaSessionName || !operatorChatId) {
    console.error('[content-central] social selling notification skipped (WAHA or notifications.* not configured):', text);
    return;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ session: wahaSessionName, chatId: operatorChatId, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error('[content-central] social selling WAHA notification failed:', res.status, await res.text());
  } catch (err) {
    console.error('[content-central] social selling WAHA notification failed:', err.message);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/social-selling-notify.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/social-selling-notify.js tests/social-selling-notify.test.js
git commit -m "feat(content-central): add social selling WAHA operator notifications

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the two schedulers into the server bootstrap

**Files:**
- Modify: `src/content-central-server.js` (imports; two new exported scheduler functions near `startStuckMediaRetryScheduler`; bootstrap in `startContentCentralServer`; `close()`)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: `runSocialSellingRadarSweep`, `runSocialSellingEngagementSweep` (Task 3); `discoverSocialSellingCandidates`, `performSocialSellingAction`, `closeSocialSellingBrowser` (Task 5); `qualifySocialSellingLead` (Task 4); `notifySocialSellingOperator` (Task 6); `loadSocialSellingConfig` (Task 1).
- Produces: `export function startSocialSellingRadarScheduler(targetDir)`, `export function startSocialSellingEngagementScheduler(targetDir)` — both return a timer or `null`, gated on `OPENSQUAD_ENABLE_SOCIAL_SELLING === 'true'`, same shape as `startWhatsAppPublishScheduler`.

- [ ] **Step 1: Write the failing test**

In `tests/content-central-server.test.js`, add to the import block from `../src/content-central-server.js` (near `startWhatsAppPublishScheduler,` at line 37):

```js
  startSocialSellingRadarScheduler,
  startSocialSellingEngagementScheduler,
```

Then add these tests right after the existing `startStuckMediaRetryScheduler` test block (after line 4337):

```js
test('startSocialSellingRadarScheduler does not start when OPENSQUAD_ENABLE_SOCIAL_SELLING is not true', async () => {
  delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
  const timer = startSocialSellingRadarScheduler(process.cwd());
  assert.equal(timer, null);
});

test('startSocialSellingRadarScheduler starts an interval when OPENSQUAD_ENABLE_SOCIAL_SELLING=true, independent of OPENSQUAD_ENABLE_REAL_PUBLISHING', async () => {
  delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
  process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING = 'true';
  process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN = 'true';
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-social-selling-server-'));
  try {
    const timer = startSocialSellingRadarScheduler(dir);
    assert.notEqual(timer, null);
    clearInterval(timer);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
    delete process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('startSocialSellingEngagementScheduler does not start when OPENSQUAD_ENABLE_SOCIAL_SELLING is not true', async () => {
  delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
  const timer = startSocialSellingEngagementScheduler(process.cwd());
  assert.equal(timer, null);
});

test('startSocialSellingEngagementScheduler starts an interval when OPENSQUAD_ENABLE_SOCIAL_SELLING=true', async () => {
  process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING = 'true';
  process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN = 'true';
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-social-selling-server-'));
  try {
    const timer = startSocialSellingEngagementScheduler(dir);
    assert.notEqual(timer, null);
    clearInterval(timer);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
    delete process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
```

(`mkdtemp`, `rm`, `tmpdir`, `join` are already imported in this file for the existing scheduler tests.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/content-central-server.test.js --test-name-pattern="SocialSelling"`
Expected: FAIL — import error, `startSocialSellingRadarScheduler` is not exported.

- [ ] **Step 3: Add the imports**

In `src/content-central-server.js`, add near the top with the other local module imports:

```js
import { runSocialSellingRadarSweep, runSocialSellingEngagementSweep } from './social-selling-sweep.js';
import { discoverSocialSellingCandidates, performSocialSellingAction, closeSocialSellingBrowser } from './social-selling-browser.js';
import { qualifySocialSellingLead } from './social-selling-ai.js';
import { notifySocialSellingOperator } from './social-selling-notify.js';
import { loadSocialSellingConfig } from './social-selling-store.js';
```

- [ ] **Step 4: Add the two scheduler functions**

In `src/content-central-server.js`, right after `startStuckMediaRetryScheduler` (after line 4719, before the `GOOGLE_WORKSPACE_SCRIPT` block):

```js
// Own master switch, separate from OPENSQUAD_ENABLE_REAL_PUBLISHING —
// that one gates publishing content the operator wrote; this one gates
// software acting on other people's Instagram accounts on the
// operator's behalf, a materially different risk. Stays 'false' until
// turned on on purpose, after a dry run (OPENSQUAD_SOCIAL_SELLING_DRY_RUN).
export function startSocialSellingRadarScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING !== 'true') return null;
  const intervalMs = Number(process.env.OPENSQUAD_SOCIAL_SELLING_RADAR_INTERVAL_MS || 1800000);
  const dryRun = process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN === 'true';
  const sweep = () => runSocialSellingRadarSweep(targetDir, {
    discover: (config) => discoverSocialSellingCandidates(config, { targetDir, dryRun }),
    qualify: (candidate, config) => qualifySocialSellingLead(candidate, config),
  }).then(async (result) => {
    if (result.blocked) {
      const config = await loadSocialSellingConfig(targetDir);
      await notifySocialSellingOperator(`Social selling (radar) pausado: ${result.blocked}. Verifique a conta manualmente.`, config);
    }
  }).catch((err) => console.error('[content-central] social selling radar sweep failed:', err.message));
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}

// Business-hours + daily-cap gated by runSocialSellingEngagementSweep
// itself — this scheduler just ticks it frequently so a due lead is
// picked up promptly once its window opens.
export function startSocialSellingEngagementScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING !== 'true') return null;
  const intervalMs = Number(process.env.OPENSQUAD_SOCIAL_SELLING_ENGAGEMENT_INTERVAL_MS || 300000);
  const dryRun = process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN === 'true';
  const sweep = () => runSocialSellingEngagementSweep(targetDir, {
    performAction: (payload) => performSocialSellingAction(payload, { targetDir, dryRun }),
  }).then(async (result) => {
    if (result.blocked) {
      const config = await loadSocialSellingConfig(targetDir);
      await notifySocialSellingOperator(`Social selling (engajamento) pausado: ${result.reason}. Verifique a conta manualmente.`, config);
    }
  }).catch((err) => console.error('[content-central] social selling engagement sweep failed:', err.message));
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}
```

- [ ] **Step 5: Wire into bootstrap and close()**

In `src/content-central-server.js`, in `startContentCentralServer`, add after the existing `stuckMediaRetrySchedulerTimer` line (line 397):

```js
  const stuckMediaRetrySchedulerTimer = startStuckMediaRetryScheduler(targetDir);
  const socialSellingRadarSchedulerTimer = startSocialSellingRadarScheduler(targetDir);
  const socialSellingEngagementSchedulerTimer = startSocialSellingEngagementScheduler(targetDir);
```

And in the returned `close()` (lines 402-408), add before `server.close(...)`:

```js
      if (stuckMediaRetrySchedulerTimer) clearInterval(stuckMediaRetrySchedulerTimer);
      if (socialSellingRadarSchedulerTimer) clearInterval(socialSellingRadarSchedulerTimer);
      if (socialSellingEngagementSchedulerTimer) clearInterval(socialSellingEngagementSchedulerTimer);
      closeSocialSellingBrowser().catch(() => {});
      server.close((err) => (err ? reject(err) : resolve()));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/content-central-server.test.js --test-name-pattern="SocialSelling"`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat(content-central-server): wire social selling schedulers into the bootstrap

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Full-suite verification and manual dry run

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `npm test`
Expected: all pass, no regressions (this repo's `node --test tests/*.test.js` glob already picks up every new `tests/social-selling-*.test.js` file automatically).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Fill in real configuration**

Before enabling anything, create `_opensquad/content-central/social-selling-instagram-config.json` in the actual content-central working directory (not this repo) with real values for `hashtags`, `locationHashtags` and/or `referenceAccounts` (empty by default — the Radar sweep has nothing to scan until these are filled in), and `notifications.wahaSessionName` / `notifications.operatorChatId` if WAHA alerts are wanted. Only the fields being overridden need to be present — everything else falls back to `DEFAULT_SOCIAL_SELLING_CONFIG`.

- [ ] **Step 4: Dry-run smoke check**

Set `OPENSQUAD_ENABLE_SOCIAL_SELLING=true` and `OPENSQUAD_SOCIAL_SELLING_DRY_RUN=true` in the content-central `.env`, start the server, and confirm in the logs that both schedulers tick without error and `social-selling-instagram-state.json` is created (empty leads, since dry-run discovery returns nothing). This confirms the wiring end to end with zero real browser/API/Instagram activity.

- [ ] **Step 5: First real run, supervised**

Log into the operator's real Instagram account once in the persistent browser profile at `_opensquad/content-central/social-selling-instagram-browser-profile/` (the browser opens visibly — `headless: false` — the first time `OPENSQUAD_SOCIAL_SELLING_DRY_RUN` is unset and a sweep actually runs). Turn dry-run off, watch the first few Radar and Engagement ticks with the browser window visible, and confirm the `clickByAnyLabel` selectors in `src/social-selling-browser.js` actually find Instagram's current Like/Comment/Follow/Message controls — adjust the label arrays there if the account's UI language or Instagram's own copy doesn't match.
```
