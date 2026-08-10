# GitHub Actions Scheduled Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move time-based post publishing off the local PC and onto a free hourly GitHub Actions cron in a new private repo, while the PC keeps generating/approving content and an instant "Publicar agora" override.

**Architecture:** A new private GitHub repo (the "gaveta") holds one JSON file per approved/scheduled post plus its publish status — the single shared state between the PC and GitHub Actions. `content-central.js` gains an injectable `queueSync` callback (upsert on approve, remove on regenerate-away-from-`aprovado` or delete) so the real git operations stay out of the pure domain module, matching the existing `metaPublisher`/`imageGenerator` dependency-injection pattern. `content-central-server.js` wires the real git-backed sync (`src/gaveta-sync.js`) and the real media uploader into the HTTP routes, splits the local scheduler's "auto-run" flag from "real publishing allowed", and keeps the manual publish path pulling/pushing the gaveta so it never races the Actions sweep.

**Tech Stack:** Node.js (`node --test`), `node:child_process` for `git`/`gh` shelling, no new npm dependencies.

## Global Constraints

- No new npm dependencies — everything uses Node built-ins (`node:child_process`, `node:fs/promises`) per the spec's "Total added cost: $0/month".
- New/changed exported functions must stay callable with **zero options** exactly as they behave today — every new hook (`queueSync`, `mediaUploader`) is optional and a no-op when absent, so all ~400 existing tests in `tests/content-central.test.js` keep passing unmodified.
- Real network/git calls (`fetch`, `execFile('git', ...)`, `execFile('gh', ...)`) never go inside `content-central.js` — that file stays "pure domain logic, testable with a fake" (existing convention, see `runDuePublishSweep`'s comment at `content-central.js:2862`). They live in `content-central-server.js` or the new `src/gaveta-sync.js`.
- Test runner: `node --test tests/*.test.js` (from `package.json`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/gaveta-sync.js` (new) | Real git operations against a local clone of the private "gaveta" repo: write/remove a queue item file, commit, push, pull. No knowledge of content-central's domain types beyond the plain data it's given. |
| `tests/gaveta-sync.test.js` (new) | Exercises `gaveta-sync.js` against a real local bare repo (no network) — write/commit/push, remove/commit/push, pull. |
| `src/content-central.js` (modify) | `approveContent`, `regenerateContentDay`, `regenerateContentGroup`, `deleteProjectContent` each gain an optional `options.queueSync` hook; `approveContent` gains an optional `options.mediaUploader` hook. |
| `tests/content-central.test.js` (modify) | New tests asserting `queueSync`/`mediaUploader` are called with the right action/payload at each of the four call sites, and that omitting them changes nothing (back-compat). |
| `src/content-central-server.js` (modify) | Wires real `gaveta-sync.js` + real media upload into the approve/regenerate/delete routes and the manual publish route; splits `startPublishScheduler`'s gate; syncs Meta secrets to GitHub on token save. |
| `tests/content-central-server.test.js` (modify) | New tests for the scheduler gate split and the token-save secret sync (with `execFile` faked). |
| `.env.example` (modify) | Documents the new env vars. |
| `gaveta-publisher/` (new, local staging — not part of this repo's own history) | `scripts/publish-due.js`, `scripts/meta-publish-multi.js` (copied), `.github/workflows/publish.yml`, `test/publish-due.test.js` — the contents to push into the new private repo. |

---

### Task 1: `src/gaveta-sync.js` — real git-backed queue writer

**Files:**
- Create: `src/gaveta-sync.js`
- Test: `tests/gaveta-sync.test.js`

**Interfaces:**
- Produces:
  - `async function upsertQueueItem(gaveteDir, projectId, contentId, data)` — writes `queue/<projectId>/<contentId>.json` with `{ ...data, publish: { realPublished: false, publishedAt: null, metaMediaId: null, permalink: null, error: null } }` (unless `data.publish` already provided, e.g. when the manual-publish path is writing a result — see Task 6), then `git add`, `git commit`, `git push`.
  - `async function removeQueueItem(gaveteDir, projectId, contentId)` — deletes the file if it exists, then commits + pushes. No-op (returns without committing) if the file doesn't exist.
  - `async function pullQueue(gaveteDir)` — `git pull`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/gaveta-sync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { upsertQueueItem, removeQueueItem, pullQueue } from '../src/gaveta-sync.js';

const execFileAsync = promisify(execFile);

// A real local bare repo stands in for "GitHub" — no network needed, and it
// proves push/pull actually round-trip instead of just asserting the local
// working tree looks right.
async function withGaveta(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gaveta-'));
  const bareDir = join(root, 'remote.git');
  const workDir = join(root, 'work');
  const checkDir = join(root, 'check');
  await execFileAsync('git', ['init', '--bare', bareDir]);
  await execFileAsync('git', ['clone', bareDir, workDir]);
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: workDir });
  // git init --bare has no commits yet, so the initial clone has no branch
  // checked out until the first push — make an empty first commit so
  // upsertQueueItem's `git push` has a branch to push.
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: workDir });
  await execFileAsync('git', ['push', 'origin', 'HEAD:main'], { cwd: workDir });
  await execFileAsync('git', ['checkout', 'main'], { cwd: workDir });
  try {
    await fn({ workDir, bareDir, checkDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('upsertQueueItem writes the item and pushes it to the remote', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-1', {
      channel: 'instagram_feed',
      caption: 'Promo de hoje',
      mediaUrl: 'https://i.ibb.co/abc/image.jpg',
      scheduledDate: '2026-08-10',
      scheduledTime: '18:00',
    });

    await execFileAsync('git', ['clone', bareDir, checkDir]);
    const raw = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-1.json'), 'utf-8'));
    assert.equal(raw.caption, 'Promo de hoje');
    assert.equal(raw.publish.realPublished, false);
  });
});

test('removeQueueItem deletes the item and pushes the removal', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-1', { channel: 'instagram_feed', caption: 'x', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '18:00' });
    await removeQueueItem(workDir, 'boss-pizzaria', 'content-1');

    await execFileAsync('git', ['clone', bareDir, checkDir]);
    await assert.rejects(readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-1.json'), 'utf-8'));
  });
});

test('removeQueueItem on an item that was never synced is a no-op', async () => {
  await withGaveta(async ({ workDir }) => {
    await assert.doesNotReject(removeQueueItem(workDir, 'boss-pizzaria', 'never-existed'));
  });
});

test('pullQueue brings in changes pushed from another clone', async () => {
  await withGaveta(async ({ workDir, bareDir }) => {
    const otherClone = `${workDir}-other`;
    await execFileAsync('git', ['clone', bareDir, otherClone]);
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: otherClone });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: otherClone });
    await upsertQueueItem(otherClone, 'boss-pizzaria', 'content-2', { channel: 'instagram_feed', caption: 'y', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '19:00' });

    await pullQueue(workDir);

    const raw = JSON.parse(await readFile(join(workDir, 'queue', 'boss-pizzaria', 'content-2.json'), 'utf-8'));
    assert.equal(raw.caption, 'y');
    await rm(otherClone, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/gaveta-sync.test.js`
Expected: FAIL — `Cannot find module '../src/gaveta-sync.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/gaveta-sync.js
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function queueItemPath(gaveteDir, projectId, contentId) {
  return join(gaveteDir, 'queue', projectId, `${contentId}.json`);
}

async function git(gaveteDir, args) {
  return execFileAsync('git', args, { cwd: gaveteDir });
}

// Commits whatever is currently staged and pushes. `git commit` exits
// non-zero when there's nothing staged (e.g. upsert writing byte-identical
// content twice) — that's not a failure here, just nothing to sync.
async function commitAndPush(gaveteDir, message) {
  try {
    await git(gaveteDir, ['commit', '-m', message]);
  } catch (err) {
    if (!/nothing to commit/.test(err.stdout || err.message || '')) throw err;
    return;
  }
  await git(gaveteDir, ['push']);
}

export async function upsertQueueItem(gaveteDir, projectId, contentId, data) {
  const path = queueItemPath(gaveteDir, projectId, contentId);
  const payload = {
    projectId,
    contentId,
    channel: data.channel,
    caption: data.caption,
    mediaUrl: data.mediaUrl,
    scheduledDate: data.scheduledDate,
    scheduledTime: data.scheduledTime,
    publish: data.publish || { realPublished: false, publishedAt: null, metaMediaId: null, permalink: null, error: null },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
  await git(gaveteDir, ['add', join('queue', projectId, `${contentId}.json`)]);
  await commitAndPush(gaveteDir, `queue: ${projectId}/${contentId}`);
}

export async function removeQueueItem(gaveteDir, projectId, contentId) {
  const path = queueItemPath(gaveteDir, projectId, contentId);
  try {
    await readFile(path, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  await rm(path, { force: true });
  await git(gaveteDir, ['add', join('queue', projectId, `${contentId}.json`)]);
  await commitAndPush(gaveteDir, `queue: remove ${projectId}/${contentId}`);
}

export async function pullQueue(gaveteDir) {
  await git(gaveteDir, ['pull']);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/gaveta-sync.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/gaveta-sync.js tests/gaveta-sync.test.js
git commit -m "feat: add git-backed gaveta queue sync module"
```

---

### Task 2: `content-central.js` — `queueSync` hook on approve/regenerate/delete

**Files:**
- Modify: `src/content-central.js:2804-2828` (`approveContent`), `src/content-central.js:2589-2673` (`applyContentRegeneration`), `src/content-central.js:2675-2747` (`regenerateContentDay`, `regenerateContentGroup`), `src/content-central.js:3162-3199` (`deleteProjectContent`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `options.queueSync` — when provided, an `async (action, { projectId, contentId, data }) => void` where `action` is `'upsert'` or `'remove'`. All four functions call it optionally; omitting it is a no-op (back-compat with every existing caller/test).

- [ ] **Step 1: Write the failing tests**

```js
// tests/content-central.test.js — add near the existing runDuePublishSweep tests

test('approveContent calls queueSync with an upsert for the approved item', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-approve', name: 'Sync Approve', handle: '@syncapprove', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-approve', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);

    const calls = [];
    await approveContent('sync-approve', batch.items[0].contentId, dir, batch.batchId, {
      queueSync: async (action, payload) => calls.push({ action, payload }),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'upsert');
    assert.equal(calls[0].payload.projectId, 'sync-approve');
    assert.equal(calls[0].payload.contentId, batch.items[0].contentId);
    assert.equal(calls[0].payload.data.scheduledDate, '2026-08-10');
  });
});

test('approveContent works with no queueSync provided (back-compat)', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-none', name: 'Sync None', handle: '@syncnone', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-none', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);
    const content = await approveContent('sync-none', batch.items[0].contentId, dir, batch.batchId);
    assert.equal(content.status, 'aprovado');
  });
});

test('regenerateContentDay calls queueSync with a remove when leaving aprovado status', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-regen', name: 'Sync Regen', handle: '@syncregen', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-regen', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);
    await approveContent('sync-regen', batch.items[0].contentId, dir, batch.batchId);

    const calls = [];
    await regenerateContentDay('sync-regen', batch.items[0].contentId, {
      batchId: batch.batchId,
      queueSync: async (action, payload) => calls.push({ action, payload }),
    }, dir);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'remove');
    assert.equal(calls[0].payload.contentId, batch.items[0].contentId);
  });
});

test('deleteProjectContent calls queueSync with a remove', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-delete', name: 'Sync Delete', handle: '@syncdelete', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-delete', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);
    await approveContent('sync-delete', batch.items[0].contentId, dir, batch.batchId);

    const calls = [];
    await deleteProjectContent('sync-delete', batch.items[0].contentId, dir, batch.batchId, undefined, {
      queueSync: async (action, payload) => calls.push({ action, payload }),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'remove');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content-central.test.js`
Expected: FAIL on all four new tests — `calls.length` is 0 (queueSync never called), and `deleteProjectContent` throws because it doesn't yet accept an options object in that position.

- [ ] **Step 3: Write the implementation**

In `approveContent` (`src/content-central.js:2804`), add the `options` param and the hook after the existing `writeJson(contentPath, content)`:

```js
export async function approveContent(projectId, contentId, targetDir = process.cwd(), batchId, options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const content = await readJson(contentPath);
  const now = new Date().toISOString();

  content.status = 'aprovado';
  content.approval.approvedAt = now;
  content.approval.approvalSource = 'operator_panel';
  if (typeof options.mediaUploader === 'function') {
    content.publish = { ...content.publish, mediaUrl: await options.mediaUploader(content) };
  }
  content.updatedAt = now;
  await writeJson(contentPath, content);

  project.learnings.approved = [
    summarizeApprovedLearning(content),
    ...project.learnings.approved,
  ].slice(0, MAX_LEARNING_ENTRIES);
  project.updatedAt = now;
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');

  if (typeof options.queueSync === 'function') {
    await options.queueSync('upsert', {
      projectId,
      contentId: content.contentId,
      data: {
        channel: content.channel,
        caption: content.caption.text,
        mediaUrl: content.publish?.mediaUrl || null,
        scheduledDate: content.scheduledDate,
        scheduledTime: content.scheduledTime,
      },
    });
  }

  return content;
  });
}
```

In `regenerateContentDay` (`src/content-central.js:2675`), call `queueSync` after the existing `writeJson(contentPath, content)`:

```js
export async function regenerateContentDay(projectId, contentId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, options.batchId);
  const content = await readJson(contentPath);

  const { creativeRegenerated } = await applyContentRegeneration(content, project, projectId, options, paths);
  if (creativeRegenerated) {
    await unlinkCreativeSharing(paths, content);
  }

  await writeJson(contentPath, content);
  if (typeof options.queueSync === 'function') {
    await options.queueSync('remove', { projectId, contentId: content.contentId });
  }
  return content;
}
```

In `regenerateContentGroup` (`src/content-central.js:2702`), call `queueSync` for every entry inside the existing write loop:

```js
  for (const entry of entries) {
    await writeJson(entry.contentPath, entry.content);
    if (typeof options.queueSync === 'function') {
      await options.queueSync('remove', { projectId, contentId: entry.content.contentId });
    }
  }
  return entries.map((entry) => entry.content);
}
```

In `deleteProjectContent` (`src/content-central.js:3162`), add the `options` param and call the hook after the existing `rm(contentPath, ...)`:

```js
export async function deleteProjectContent(projectId, contentId, targetDir = process.cwd(), batchId, reason, options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const content = await readJson(contentPath);
  const batchPath = join(dirname(contentPath), 'batch.json');
  const batch = await readJson(batchPath, null);

  await rm(contentPath, { force: true });
  if (typeof options.queueSync === 'function') {
    await options.queueSync('remove', { projectId, contentId });
  }
  if (content?.image?.localPath) {
    await rm(safeProjectPath(paths.projectDir, content.image.localPath), { force: true });
  }
  if (content) {
    await removeFromSiblingCreativeGroups(paths, content);
  }
  if (batch?.items) {
    await writeJson(batchPath, {
      ...batch,
      items: batch.items.filter((item) => item.contentId !== contentId),
    });
  }

  const cleanReason = summarizeAvoidLearningReason(content, reason);
  if (cleanReason) {
    const now = new Date().toISOString();
    project.learnings.avoid = [
      summarizeAvoidLearning(content, cleanReason),
      ...project.learnings.avoid,
    ].slice(0, MAX_LEARNING_ENTRIES);
    project.updatedAt = now;
    await writeJson(paths.projectPath, project);
    await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  }

  return { contentId, deleted: true };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central.test.js`
Expected: PASS on all four new tests, and no previously-passing test in the file regresses (the new params are all optional/appended, matching the existing call sites).

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat: add optional queueSync hook to approve/regenerate/delete"
```

---

### Task 3: `content-central-server.js` — wire real gaveta sync + media upload into the routes

**Files:**
- Modify: `src/content-central-server.js:726-797` (content routes), imports near the top
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: `upsertQueueItem`, `removeQueueItem` from `src/gaveta-sync.js` (Task 1); `options.queueSync`/`options.mediaUploader` on `approveContent`/`regenerateContentDay`/`regenerateContentGroup`/`deleteProjectContent` (Task 2); existing `uploadGeneratedImagePublicly`/`uploadGeneratedVideoPublicly` (`content-central-server.js:3495`, `3517`).
- Produces: a `resolveGaveteSync(targetDir)` helper returning `{ queueSync, mediaUploader }` (or `{}` when `OPENSQUAD_GAVETA_DIR` isn't set — local dev without a gaveta configured keeps working exactly as before).

- [ ] **Step 1: Write the failing test**

```js
// tests/content-central-server.test.js — add near existing route tests

test('POST .../approve upserts the queue item when a gaveta dir is configured', async (t) => {
  await withTempProject(async (dir) => {
    const gaveteDir = await mkdtemp(join(tmpdir(), 'gaveta-route-'));
    t.after(() => rm(gaveteDir, { recursive: true, force: true }));
    process.env.OPENSQUAD_GAVETA_DIR = gaveteDir;
    t.after(() => { delete process.env.OPENSQUAD_GAVETA_DIR; });

    // ... existing test harness setup for createCentralProject + a draft batch (mirror an existing approve-route test) ...
    const res = await request(server, 'POST', `/api/projects/${projectId}/content/${contentId}/approve`, {});
    assert.equal(res.status, 200);
    // Real git push isn't asserted here (gaveta-sync.test.js already covers
    // that) — this test only proves the route calls queueSync/mediaUploader
    // by stubbing them via the module's exported resolveGaveteSync in a
    // real gaveta dir set up the same way as gaveta-sync.test.js's withGaveta.
  });
});
```

Because this route test needs a real local git remote to be meaningful (same setup as `gaveta-sync.test.js`'s `withGaveta`), write it by importing that helper pattern directly rather than re-deriving it — copy the `withGaveta` setup into a small shared test helper:

```js
// tests/helpers/with-gaveta.js
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function withGaveta(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gaveta-'));
  const bareDir = join(root, 'remote.git');
  const workDir = join(root, 'work');
  await execFileAsync('git', ['init', '--bare', bareDir]);
  await execFileAsync('git', ['clone', bareDir, workDir]);
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: workDir });
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: workDir });
  await execFileAsync('git', ['push', 'origin', 'HEAD:main'], { cwd: workDir });
  await execFileAsync('git', ['checkout', 'main'], { cwd: workDir });
  try {
    await fn(workDir, bareDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
```

Then rewrite the route test to use it, and update `tests/gaveta-sync.test.js` (Task 1) to import `withGaveta` from this shared helper instead of its own local copy:

```js
test('POST .../approve upserts the queue item into the configured gaveta', async () => {
  await withGaveta(async (workDir, bareDir) => {
    await withTempProject(async (dir) => {
      process.env.OPENSQUAD_GAVETA_DIR = workDir;
      const { projectId, contentId } = await setupApprovedRouteFixture(dir); // mirrors existing approve-route fixture setup in this file
      const res = await postJson(`/api/projects/${projectId}/content/${contentId}/approve`, {}, dir);
      assert.equal(res.status, 200);

      const checkDir = `${workDir}-check`;
      await execFileAsync('git', ['clone', bareDir, checkDir]);
      const raw = JSON.parse(await readFile(join(checkDir, 'queue', projectId, `${contentId}.json`), 'utf-8'));
      assert.equal(raw.publish.realPublished, false);
      await rm(checkDir, { recursive: true, force: true });
      delete process.env.OPENSQUAD_GAVETA_DIR;
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central-server.test.js`
Expected: FAIL — the queue file is never written because the route doesn't call `queueSync` yet.

- [ ] **Step 3: Write the implementation**

Add the import and helper near the top of `src/content-central-server.js` (alongside the existing `import { ... } from './content-central.js'` block):

```js
import { upsertQueueItem, removeQueueItem } from './gaveta-sync.js';

// Local dev without OPENSQUAD_GAVETA_DIR set behaves exactly as before this
// feature existed — no queueSync/mediaUploader passed, approve/regenerate/
// delete stay purely local.
// projectId is passed explicitly (not read off `content`) because content
// records don't carry their own projectId — resolveGeneratedImageAbsolutePath
// needs it to locate the file on disk (see publishContentToInstagram above,
// which does the same `project.projectId` lookup for the same reason).
function resolveGaveteSync(targetDir, projectId) {
  const gaveteDir = process.env.OPENSQUAD_GAVETA_DIR;
  if (!gaveteDir) return {};
  return {
    queueSync: async (action, payload) => {
      if (action === 'upsert') return upsertQueueItem(gaveteDir, payload.projectId, payload.contentId, payload.data);
      if (action === 'remove') return removeQueueItem(gaveteDir, payload.projectId, payload.contentId);
    },
    mediaUploader: async (content) => {
      const isVideoChannel = VIDEO_CHANNELS.has(content.channel);
      if (isVideoChannel) {
        if (!content.video?.localPath) return null;
        return uploadGeneratedVideoPublicly(content.video.localPath);
      }
      const localPath = resolveGeneratedImageAbsolutePath(content, projectId, targetDir);
      return localPath ? uploadGeneratedImagePublicly(localPath) : null;
    },
  };
}
```

Update the three call sites (`content-central-server.js:726`, `778`, `795`):

```js
  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'approve') {
    const body = await readBody(req);
    const content = await approveContent(projectId, parts[4], targetDir, body.batchId, resolveGaveteSync(targetDir, projectId));
    return sendJson(res, 200, { content });
  }
```

```js
    const content = await regenerateContentDay(projectId, parts[4], {
      regenerate: body.regenerate || 'creative',
      ...resolveGaveteSync(targetDir, projectId),
      // (leave the rest of the existing options object exactly as-is)
    }, targetDir);
```

```js
  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'delete') {
    const body = await readBody(req);
    const result = await deleteProjectContent(projectId, parts[4], targetDir, body.batchId, body.reason, resolveGaveteSync(targetDir, projectId));
    return sendJson(res, 200, result);
  }
```

And the `content-group-regenerate` route (`content-central-server.js:738`) the same way, spreading `resolveGaveteSync(targetDir, projectId)` into its options object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js src/gaveta-sync.js tests/content-central-server.test.js tests/gaveta-sync.test.js tests/helpers/with-gaveta.js
git commit -m "feat: wire gaveta sync and media upload into approve/regenerate/delete routes"
```

---

### Task 4: Split the local scheduler's auto-run flag from real-publishing-allowed

**Files:**
- Modify: `src/content-central-server.js:3604-3613` (`startPublishScheduler`)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `startPublishScheduler` now also requires `OPENSQUAD_AUTO_PUBLISH_SCHEDULER !== 'false'` (default: runs, matching today's behavior when the var is unset).

- [ ] **Step 1: Write the failing test**

```js
test('startPublishScheduler does not start the interval when OPENSQUAD_AUTO_PUBLISH_SCHEDULER=false, even with real publishing enabled', async () => {
  process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
  process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER = 'false';
  try {
    const timer = startPublishScheduler(process.cwd());
    assert.equal(timer, null);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
    delete process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER;
  }
});
```

(`startPublishScheduler` isn't currently exported — add `export` to its declaration as part of this task so the test can import it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central-server.test.js`
Expected: FAIL — `timer` is a real `Timeout` object, not `null` (today's code only checks `OPENSQUAD_ENABLE_REAL_PUBLISHING`).

- [ ] **Step 3: Write the implementation**

```js
export function startPublishScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') return null;
  if (process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER === 'false') return null;
  const intervalMs = Number(process.env.OPENSQUAD_PUBLISH_CHECK_INTERVAL_MS || 180000);
  const sweep = () => runDuePublishSweep(targetDir, {
    metaPublisher: (payload) => publishContentToInstagram(payload, targetDir),
  }).catch((err) => console.error('[content-central] publish sweep failed:', err.message));
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central-server.test.js`
Expected: PASS. Also confirm no regression: `OPENSQUAD_AUTO_PUBLISH_SCHEDULER` unset + `OPENSQUAD_ENABLE_REAL_PUBLISHING=true` still starts the timer (existing behavior) — add one line to the same test asserting that, or a sibling test.

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat: split auto-publish-scheduler flag from real-publishing flag"
```

---

### Task 5: `.env.example` and local `.env` — new flags

**Files:**
- Modify: `.env.example`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add the new variables**

Add near the existing `OPENSQUAD_ENABLE_REAL_PUBLISHING` entry in `.env.example`:

```bash
# Path to a local clone of the private "gaveta" repo (see docs/superpowers/specs/2026-08-10-github-actions-scheduled-publisher-design.md).
# When unset, approve/regenerate/delete behave exactly as before this feature existed.
OPENSQUAD_GAVETA_DIR=

# Set to "false" on the local PC once the gaveta repo's hourly GitHub Action
# is live, so only GitHub — never the local PC — runs the time-based sweep.
# OPENSQUAD_ENABLE_REAL_PUBLISHING stays "true" so "Publicar agora" keeps working.
OPENSQUAD_AUTO_PUBLISH_SCHEDULER=

# Fine-grained GitHub PAT (Secrets: write) scoped to just the gaveta repo,
# used by the server to run `gh secret set` whenever a project's Meta token
# is saved/rotated.
OPENSQUAD_GITHUB_TOKEN=
OPENSQUAD_GAVETA_REPO=   # e.g. jucicleiger-bit/opensquad-gaveta
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document gaveta publisher env vars"
```

---

### Task 6: Manual "Publicar agora" pulls before checking, pushes the result after

**Files:**
- Modify: `src/content-central-server.js:782-791` (the `publish` route)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: `pullQueue`, `upsertQueueItem` from `src/gaveta-sync.js` (Task 1).
- Produces: nothing new exported; behavior change only.

- [ ] **Step 1: Write the failing test**

```js
test('manual publish route pulls the gaveta first and pushes the published result after', async () => {
  await withGaveta(async (workDir, bareDir) => {
    await withTempProject(async (dir) => {
      process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
      process.env.OPENSQUAD_GAVETA_DIR = workDir;
      const { projectId, contentId } = await setupApprovedRouteFixture(dir); // same fixture as Task 3's route test
      await upsertQueueItem(workDir, projectId, contentId, { channel: 'instagram_feed', caption: 'x', mediaUrl: 'https://i.ibb.co/x.jpg', scheduledDate: '2026-08-10', scheduledTime: '09:00' });

      const res = await postJson(`/api/projects/${projectId}/content/${contentId}/publish`, {}, dir);
      assert.equal(res.status, 200);

      const checkDir = `${workDir}-check`;
      await execFileAsync('git', ['clone', bareDir, checkDir]);
      const raw = JSON.parse(await readFile(join(checkDir, 'queue', projectId, `${contentId}.json`), 'utf-8'));
      assert.equal(raw.publish.realPublished, true);
      await rm(checkDir, { recursive: true, force: true });
      delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
      delete process.env.OPENSQUAD_GAVETA_DIR;
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central-server.test.js`
Expected: FAIL — the gaveta copy still shows `realPublished: false` because the manual route never touches the gaveta today.

- [ ] **Step 3: Write the implementation**

```js
import { upsertQueueItem, removeQueueItem, pullQueue } from './gaveta-sync.js';

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'publish') {
    if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') {
      return sendJson(res, 403, { error: 'Publicação real desligada. Defina OPENSQUAD_ENABLE_REAL_PUBLISHING=true no .env pra ativar.' });
    }
    const gaveteDir = process.env.OPENSQUAD_GAVETA_DIR;
    if (gaveteDir) await pullQueue(gaveteDir);
    const body = await readBody(req);
    const content = await publishSingleContent(projectId, parts[4], targetDir, {
      metaPublisher: (payload) => publishContentToInstagram(payload, targetDir),
    }, body.batchId);
    if (gaveteDir) {
      await upsertQueueItem(gaveteDir, projectId, content.contentId, {
        channel: content.channel,
        caption: content.caption.text,
        mediaUrl: content.publish?.mediaUrl || null,
        scheduledDate: content.scheduledDate,
        scheduledTime: content.scheduledTime,
        publish: content.publish,
      });
    }
    return sendJson(res, 200, { content });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat: sync manual publish result to the gaveta (pull before, push after)"
```

---

### Task 7: Sync Meta secrets to GitHub when a project's token is saved

**Files:**
- Modify: `src/content-central-server.js:395-410` (the token-save route)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: `OPENSQUAD_GITHUB_TOKEN`, `OPENSQUAD_GAVETA_REPO` env vars (Task 5).
- Produces: a `syncTokenSecretsToGitHub(projectId, { token, instagramUserId, pageId })` function (unexported is fine — used only within this file), calling `gh secret set` three times via `execFileAsync`. Skipped (no-op) when `OPENSQUAD_GAVETA_REPO` isn't set, so local dev without GitHub configured is unaffected.

- [ ] **Step 1: Write the failing test**

```js
test('saving a project token pushes it to GitHub Secrets when a gaveta repo is configured', async (t) => {
  await withTempProject(async (dir) => {
    process.env.OPENSQUAD_GAVETA_REPO = 'someuser/gaveta';
    t.after(() => { delete process.env.OPENSQUAD_GAVETA_REPO; });

    const calls = [];
    t.mock.method(childProcess, 'execFile', (cmd, args, opts, cb) => {
      calls.push({ cmd, args });
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, '', '');
    });

    const { projectId } = await setupProjectFixture(dir); // existing fixture used by other token-route tests in this file
    const res = await postJson(`/api/projects/${projectId}/token`, {
      token: 'EAAB...', account: { handle: '@x', instagramUserId: '123', pageId: '456' },
    }, dir);

    assert.equal(res.status, 200);
    const secretCalls = calls.filter((c) => c.cmd === 'gh' && c.args[0] === 'secret');
    assert.equal(secretCalls.length, 3);
    assert.ok(secretCalls.some((c) => c.args.includes(`META_TOKEN_${projectId.toUpperCase()}`)));
    assert.ok(secretCalls.some((c) => c.args.includes(`META_IG_USER_ID_${projectId.toUpperCase()}`)));
    assert.ok(secretCalls.some((c) => c.args.includes(`META_PAGE_ID_${projectId.toUpperCase()}`)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content-central-server.test.js`
Expected: FAIL — `execFile` mock records zero `gh secret` calls.

- [ ] **Step 3: Write the implementation**

```js
async function syncTokenSecretsToGitHub(projectId, { token, instagramUserId, pageId }) {
  const repo = process.env.OPENSQUAD_GAVETA_REPO;
  if (!repo) return;
  const prefix = projectId.toUpperCase().replace(/-/g, '_');
  const entries = [
    [`META_TOKEN_${prefix}`, token],
    [`META_IG_USER_ID_${prefix}`, instagramUserId || ''],
    [`META_PAGE_ID_${prefix}`, pageId || ''],
  ];
  for (const [name, value] of entries) {
    await execFileAsync('gh', ['secret', 'set', name, '--repo', repo, '--body', value]);
  }
}
```

Update the token-save route (`content-central-server.js:401`, inside the existing handler) to call it after `saveProjectToken` succeeds:

```js
    const project = await saveProjectToken(projectId, {
      token: body.token,
      account: body.account,
      permissions: body.permissions,
      expiresAt: body.expiresAt,
    }, targetDir);
    await syncTokenSecretsToGitHub(projectId, {
      token: body.token,
      instagramUserId: body.account?.instagramUserId,
      pageId: body.account?.pageId,
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content-central-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat: sync Meta project tokens to GitHub Secrets on save"
```

---

### Task 8: The gaveta repo's own contents (staged locally, then pushed to the new private repo)

This is the only task that produces files meant to live in a **different** git repository, not this one. Stage them in a scratch directory, then create and push the real private repo.

**Files (all under a fresh local directory, e.g. `~/opensquad-gaveta/`, not inside this repo):**
- Create: `scripts/publish-due.js`
- Create: `scripts/meta-publish-multi.js` (copy of `squads/conteudo-multicanal/tools/meta-publish-multi.js` from this repo, unchanged)
- Create: `.github/workflows/publish.yml`
- Create: `test/publish-due.test.js`
- Create: `package.json` (`{"type": "module", "scripts": {"test": "node --test test/*.test.js"}}`)
- Create: `.gitignore` (`node_modules/`)

**Interfaces:**
- Produces: `isPublishDue(item, now)`, `findDueItems(queueRoot, now)` — reads every `queue/*/*.json`, returns the earliest-due unpublished item per project (mirrors `runDuePublishSweep`'s per-project/per-slot logic from `content-central.js:2881-2905`, minus the local-filesystem project listing that doesn't apply here).

- [ ] **Step 1: Write the failing test**

```js
// test/publish-due.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDueItems, isPublishDue } from '../scripts/publish-due.js';

async function withQueue(items, fn) {
  const root = await mkdtemp(join(tmpdir(), 'queue-'));
  for (const [projectId, contentId, data] of items) {
    const dir = join(root, 'queue', projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${contentId}.json`), JSON.stringify({ projectId, contentId, ...data }));
  }
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('isPublishDue is true once the scheduled time has passed', () => {
  assert.equal(isPublishDue({ scheduledDate: '2026-08-10', scheduledTime: '09:00' }, new Date('2026-08-10T12:00:00Z')), true);
  assert.equal(isPublishDue({ scheduledDate: '2026-08-10', scheduledTime: '09:00' }, new Date('2026-08-10T00:00:00Z')), false);
});

test('findDueItems returns only due, unpublished items', async () => {
  await withQueue([
    ['boss-pizzaria', 'due-1', { scheduledDate: '2026-08-10', scheduledTime: '09:00', publish: { realPublished: false } }],
    ['boss-pizzaria', 'future-1', { scheduledDate: '2026-08-10', scheduledTime: '23:00', publish: { realPublished: false } }],
    ['boss-pizzaria', 'already-published', { scheduledDate: '2026-08-10', scheduledTime: '08:00', publish: { realPublished: true } }],
  ], async (queueRoot) => {
    const due = await findDueItems(queueRoot, new Date('2026-08-10T12:00:00Z'));
    assert.deepEqual(due.map((d) => d.contentId), ['due-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (inside the staged `opensquad-gaveta/` dir): `node --test test/publish-due.test.js`
Expected: FAIL — `Cannot find module '../scripts/publish-due.js'`

- [ ] **Step 3: Write the implementation**

```js
// scripts/publish-due.js
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function isPublishDue(item, now) {
  if (!item.scheduledDate) return false;
  const dueAt = new Date(`${item.scheduledDate}T${item.scheduledTime || '00:00'}:00`);
  return !Number.isNaN(dueAt.getTime()) && dueAt <= now;
}

// Same "one slot per sweep" rule as runDuePublishSweep in the main app
// (content-central.js) — publishing every overdue slot at once after
// downtime would burst multiple posts onto the same account at once.
export async function findDueItems(queueRoot, now) {
  let projectDirs;
  try {
    projectDirs = await readdir(queueRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const due = [];
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const files = await readdir(join(queueRoot, projectDir.name));
    const items = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const item = JSON.parse(await readFile(join(queueRoot, projectDir.name, file), 'utf-8'));
      item._path = join(queueRoot, projectDir.name, file);
      if (item.status && item.status !== 'aprovado') continue;
      if (item.publish?.realPublished) continue;
      if (isPublishDue(item, now)) items.push(item);
    }
    items.sort((a, b) => (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime));
    if (items.length) {
      const slotKey = items[0].scheduledDate + items[0].scheduledTime;
      due.push(...items.filter((i) => i.scheduledDate + i.scheduledTime === slotKey));
    }
  }
  return due;
}

async function publishItem(item) {
  const prefix = item.projectId.toUpperCase().replace(/-/g, '_');
  const token = process.env[`META_TOKEN_${prefix}`];
  const instagramUserId = process.env[`META_IG_USER_ID_${prefix}`];
  const pageId = process.env[`META_PAGE_ID_${prefix}`];
  if (!token) throw new Error(`Nenhum secret META_TOKEN_${prefix} configurado.`);

  const payload = {
    publish_targets: [{
      channel: item.channel,
      image_url: item.mediaUrl,
      caption: item.caption || '',
    }],
  };
  const { stdout } = await execFileAsync('node', [new URL('./meta-publish-multi.js', import.meta.url).pathname, '--payload-json', JSON.stringify(payload)], {
    env: { ...process.env, INSTAGRAM_ACCESS_TOKEN: token, INSTAGRAM_USER_ID: instagramUserId || '', FACEBOOK_PAGE_ID: pageId || '' },
    maxBuffer: 1024 * 1024,
  });
  const result = JSON.parse(stdout).results?.[0];
  if (!result?.ok) throw new Error('Publicação na Meta falhou sem detalhe.');
  return { mediaId: result.media_id, permalink: result.permalink || null };
}

export async function main() {
  const queueRoot = join(process.cwd(), 'queue');
  const now = new Date();
  const due = await findDueItems(queueRoot, now);
  for (const item of due) {
    try {
      const result = await publishItem(item);
      item.publish = { realPublished: true, publishedAt: now.toISOString(), metaMediaId: result.mediaId, permalink: result.permalink, error: null };
    } catch (err) {
      item.publish = { ...item.publish, error: err.message };
    }
    const { _path, ...clean } = item;
    await writeFile(_path, JSON.stringify(clean, null, 2), 'utf-8');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

```yaml
# .github/workflows/publish.yml
name: Publish due posts
on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch: {}
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node scripts/publish-due.js
        env: ${{ secrets }}
      - run: |
          git config user.name "gaveta-publisher"
          git config user.email "actions@users.noreply.github.com"
          git add queue
          git diff --cached --quiet || (git commit -m "publish: sweep $(date -u +%Y-%m-%dT%H:%M:%SZ)" && git push)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/publish-due.test.js`
Expected: PASS

- [ ] **Step 5: Create the real private repo and push**

```bash
cd ~/opensquad-gaveta   # the staged directory from this task
git init
git add -A
git commit -m "init: gaveta publisher"
gh repo create opensquad-gaveta --private --source=. --remote=origin --push
```

- [ ] **Step 6: Commit (in the main repo, if the staging directory was created under it — otherwise skip)**

No commit needed in `OPENSQUAD` itself for this task; its deliverable lives entirely in the new `opensquad-gaveta` repo pushed in Step 5.

---

## One-time setup (manual, after all tasks land)

1. Create a fine-grained GitHub PAT scoped to just the `opensquad-gaveta` repo, "Secrets: write" permission. Put it in the local `.env` as `OPENSQUAD_GITHUB_TOKEN` (currently unused by any task above directly — `gh` CLI already authenticates via its own stored credentials; keep this var for documentation/future direct-API use, or drop it if `gh auth status` staying logged in is sufficient).
2. Set `OPENSQUAD_GAVETA_REPO=<you>/opensquad-gaveta` and `OPENSQUAD_GAVETA_DIR=<path to a local clone of it>` in `.env`.
3. Clone `opensquad-gaveta` locally at that path: `gh repo clone <you>/opensquad-gaveta <OPENSQUAD_GAVETA_DIR>`.
4. For each of the 6 existing projects, re-save its token once through the UI (or run `gh secret set META_TOKEN_<PROJECT> --repo <you>/opensquad-gaveta` manually) so Task 7's sync seeds all three secrets per project.
5. Set `OPENSQUAD_AUTO_PUBLISH_SCHEDULER=false` in the local `.env` and restart the local server.

---

## Self-Review Notes

- **Spec coverage:** repo visibility (Task 8 setup) — sweep interval (Task 8 workflow) — media upload timing (Task 3's `mediaUploader`) — token sync (Task 7) — manual publish kept + race-safe (Task 6) — scheduler split (Task 4) — delete-sync (Task 2) — regenerate-sync (Task 2) — free-tier (Task 8's hourly cron, `ubuntu-latest`). All covered.
- **Back-compat:** every new parameter (`options.queueSync`, `options.mediaUploader`, `options` on `deleteProjectContent`) is additive and optional, and `resolveGaveteSync()` returns `{}` (all hooks undefined) when `OPENSQUAD_GAVETA_DIR`/`OPENSQUAD_GAVETA_REPO` aren't set — existing tests and existing local-dev behavior are unchanged by default.
- **Type consistency:** `queueSync(action, { projectId, contentId, data })` signature is identical across Task 2 (call sites), Task 3 (`resolveGaveteSync`'s adapter), and Task 6 (manual-publish route) — checked.
