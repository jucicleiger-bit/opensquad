# Fase 4a: Cloud WhatsApp Status Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WhatsApp Status content approved from the cloud panel actually gets published — today it's captured incorrectly by `publish-sweep` (which throws `Unsupported publish channel`) and nothing else consumes it.

**Architecture:** Two independent fixes. (1) `publish-sweep` (Supabase Edge Function) stops touching `whatsapp_status` items at all. (2) A new local scheduler in `content-central-server.js`, patterned exactly after the existing `startWhatsAppPublishScheduler`, polls Supabase directly for due `whatsapp_status` items, resolves the project's local WAHA session from `project.json`, and calls the existing (unmodified) `publishContentToWhatsAppStatus`.

**Tech Stack:** Node.js (`node --test` for tests), `@supabase/supabase-js` (admin client, service-role), Deno Edge Function (TypeScript) for `publish-sweep`.

## Global Constraints

- No changes to `publishContentToWhatsAppStatus` (`src/content-central-server.js`) or to the existing 100%-local WhatsApp flow (`startWhatsAppPublishScheduler`/`runDuePublishSweep`) — both continue exactly as they are.
- No new Supabase tables/columns. Reuses `content_items`/`schedules`/`projects` exactly as the Fase 1 migration and `publish-sweep` already use them.
- Status/metadata write convention mirrors `publish-sweep/index.ts` literally: success → `content_items.status='posted'`, `metadata` **merged** with `{ publishResult }` (never replaces the column — it holds the full migrated `project.json`/item record); `schedules.status='done'`. Error → `content_items.status='error'`, `metadata` merged with `{ publishError: message }`; `schedules.status='error'`.
- Atomic claim before publishing, same pattern as `publish-sweep`: `update({status:'running'}).eq('id', schedule.id).eq('status','pending').select('id')` — an empty result means another sweep already claimed it; skip.
- A bookkeeping write failure inside the catch block (recording the error status) must never throw back up and crash the sweep for the remaining items — push it onto the same `errors` array instead (same discipline as `publish-sweep/index.ts:106-112`).
- New scheduler only activates when `OPENSQUAD_ENABLE_REAL_PUBLISHING === 'true'` **and** `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are configured (`createSupabaseAdminClient` throws if either is missing — catch that and return `null` silently, matching `startStuckMediaRetryScheduler`'s `OPENSQUAD_GAVETA_DIR` gate for an optional subsystem).
- `whatsapp_status` WAHA session lookup stays 100% local (`project.json`'s `whatsapp.sessionName`, read via `getCentralPaths(targetDir, project.slug)` — `project.slug` in Supabase is the same normalized directory name `getCentralPaths` expects as its `projectId` param, confirmed by `migrate-to-supabase.js`'s `slug = entry.name` convention). Never migrated, never looked up in Supabase.
- No test infrastructure exists anywhere in this repo for Supabase Edge Functions (Deno) — confirmed via `find supabase -iname "*test*"` returning nothing. The `publish-sweep` fix (Task 1) is a single additive `.neq()` filter with no branching logic; it is *not* worth standing up a new Deno test harness for. Covered instead by manual verification (Post-plan) and by Task 2's own full test suite of the new code path this fix unblocks.

---

### Task 1: Exclude `whatsapp_status` from `publish-sweep`

**Depends-on:** none

**Files:**
- Modify: `supabase/functions/publish-sweep/index.ts`

**Interfaces:** None — this is a self-contained query filter change, no exports affected.

- [ ] **Step 1: Add the channel exclusion**

In `runPublishPass` (around line 44), change:

```ts
  let query = client
    .from('content_items')
    .select('id, project_id, channel, copy, media_url, metadata, schedules!inner(id, run_at, status)')
    .eq('status', 'approved')
    .eq('schedules.status', 'pending');
```
to:
```ts
  let query = client
    .from('content_items')
    .select('id, project_id, channel, copy, media_url, metadata, schedules!inner(id, run_at, status)')
    .eq('status', 'approved')
    .eq('schedules.status', 'pending')
    // whatsapp_status has its own local-WAHA-aware sweep
    // (startCloudWhatsAppPublishScheduler, content-central-server.js) —
    // this Edge Function only knows how to call publishToMeta
    // (Instagram/Facebook), which throws "Unsupported publish channel"
    // for whatsapp_status. Without this filter every whatsapp_status item
    // approved from the cloud panel gets captured and marked 'error' by
    // this sweep before the WhatsApp-aware one ever sees it.
    .neq('channel', 'whatsapp_status');
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/publish-sweep/index.ts
git commit -m "fix(publish-sweep): exclude whatsapp_status — it has its own local sweep"
```

---

### Task 2: `runDueCloudWhatsAppPublishSweep` — new module + tests

**Depends-on:** none (disjoint from Task 1's file; safe to run in the same
wave)

**Files:**
- Create: `src/cloud-whatsapp-publish.js`
- Create: `tests/cloud-whatsapp-publish.test.js`

**Interfaces:**
- Produces: `runDueCloudWhatsAppPublishSweep(targetDir, client, options = {})` →
  `Promise<{ published: number, errors: Array<{ contentItemId: string|null, error: string }> }>`.
  `options.whatsappPublisher` is required and injectable — a function
  `async (payload) => ({ mediaId, permalink })` where `payload` is exactly
  the `{ content, project }` shape `publishContentToWhatsAppStatus` expects
  (same injectable-publisher pattern `runDuePublishSweep` uses for
  `metaPublisher`, just without a default — the caller always supplies one,
  matching this function never being called except from
  `startCloudWhatsAppPublishScheduler`, which always provides it).
  `options.now` — optional `Date`, defaults to `new Date()` (test seam).
- Consumes: `getCentralPaths` from `./content-central.js` (unchanged,
  existing export).

- [ ] **Step 1: Write the failing tests**

Create `tests/cloud-whatsapp-publish.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDueCloudWhatsAppPublishSweep } from '../src/cloud-whatsapp-publish.js';

function makeAwaitable(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

function fakeClient({ dueItems, projectsById, claimable = () => true, signedUrlError = false }) {
  const state = { claimAttempts: [], scheduleUpdates: [], contentItemUpdates: [], signedUrlCalls: [] };

  function contentItemsTable() {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              lte: () => makeAwaitable({ data: dueItems, error: null }),
            }),
          }),
        }),
      }),
      update: (patch) => ({
        eq: (_col, id) => {
          state.contentItemUpdates.push({ id, patch });
          return makeAwaitable({ error: null });
        },
      }),
    };
  }

  function schedulesTable() {
    return {
      update: (patch) => ({
        eq: (_col1, id) => {
          if (patch.status === 'running') {
            return {
              eq: () => ({
                select: () => {
                  state.claimAttempts.push(id);
                  const ok = claimable(id);
                  return makeAwaitable({ data: ok ? [{ id }] : [], error: null });
                },
              }),
            };
          }
          state.scheduleUpdates.push({ id, patch });
          return makeAwaitable({ error: null });
        },
      }),
    };
  }

  function projectsTable() {
    return {
      select: () => ({
        eq: (_col, id) => ({
          single: async () => {
            const project = projectsById[id];
            return project ? { data: project, error: null } : { data: null, error: { message: 'not found' } };
          },
        }),
      }),
    };
  }

  return {
    state,
    from(table) {
      if (table === 'content_items') return contentItemsTable();
      if (table === 'schedules') return schedulesTable();
      if (table === 'projects') return projectsTable();
      throw new Error(`fakeClient: unhandled table ${table}`);
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path, ttl) => {
          state.signedUrlCalls.push(path);
          if (signedUrlError) return { data: null, error: { message: 'sign failed' } };
          return { data: { signedUrl: `https://signed.example/${path}?ttl=${ttl}` }, error: null };
        },
      }),
    },
  };
}

test('runDueCloudWhatsAppPublishSweep publishes a due item and marks it posted/done', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-cloud-wa-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'project.json'), JSON.stringify({ projectId: 'acme-pizza', whatsapp: { sessionName: 'acme-session' } }));

  const dueItems = [{
    id: 'item-1', project_id: 'proj-uuid-1', channel: 'whatsapp_status', copy: 'Promo hoje!',
    media_url: 'acme-pizza/2026-09-01-01.png', metadata: { contentTopic: 'promo' },
    schedules: { id: 'sched-1', run_at: '2026-09-01T10:00:00.000Z', status: 'pending' },
  }];
  const client = fakeClient({
    dueItems,
    projectsById: { 'proj-uuid-1': { id: 'proj-uuid-1', slug: 'acme-pizza' } },
  });
  const whatsappPublisher = async (payload) => {
    assert.equal(payload.content.caption.text, 'Promo hoje!');
    assert.match(payload.content.publish.mediaUrl, /^https:\/\/signed\.example/);
    assert.equal(payload.project.whatsapp.sessionName, 'acme-session');
    return { mediaId: 'waha-msg-1', permalink: null };
  };

  const result = await runDueCloudWhatsAppPublishSweep(targetDir, client, { whatsappPublisher });

  assert.equal(result.published, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.state.contentItemUpdates[0].id, 'item-1');
  assert.equal(client.state.contentItemUpdates[0].patch.status, 'posted');
  assert.equal(client.state.contentItemUpdates[0].patch.metadata.contentTopic, 'promo');
  assert.deepEqual(client.state.contentItemUpdates[0].patch.metadata.publishResult, { mediaId: 'waha-msg-1', permalink: null });
  assert.equal(client.state.scheduleUpdates[0].id, 'sched-1');
  assert.equal(client.state.scheduleUpdates[0].patch.status, 'done');

  await rm(targetDir, { recursive: true, force: true });
});

test('runDueCloudWhatsAppPublishSweep records error status when the publisher throws', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-cloud-wa-err-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'project.json'), JSON.stringify({ whatsapp: { sessionName: 'acme-session' } }));

  const dueItems = [{
    id: 'item-2', project_id: 'proj-uuid-1', channel: 'whatsapp_status', copy: 'oi',
    media_url: 'acme-pizza/x.png', metadata: {},
    schedules: { id: 'sched-2', run_at: '2026-09-01T10:00:00.000Z', status: 'pending' },
  }];
  const client = fakeClient({ dueItems, projectsById: { 'proj-uuid-1': { id: 'proj-uuid-1', slug: 'acme-pizza' } } });
  const whatsappPublisher = async () => { throw new Error('WAHA respondeu 500'); };

  const result = await runDueCloudWhatsAppPublishSweep(targetDir, client, { whatsappPublisher });

  assert.equal(result.published, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /WAHA respondeu 500/);
  assert.equal(client.state.contentItemUpdates[0].patch.status, 'error');
  assert.equal(client.state.contentItemUpdates[0].patch.metadata.publishError, 'WAHA respondeu 500');
  assert.equal(client.state.scheduleUpdates[0].patch.status, 'error');

  await rm(targetDir, { recursive: true, force: true });
});

test('runDueCloudWhatsAppPublishSweep skips an item another sweep already claimed', async () => {
  const dueItems = [{
    id: 'item-3', project_id: 'proj-uuid-1', channel: 'whatsapp_status', copy: 'oi',
    media_url: 'acme-pizza/x.png', metadata: {},
    schedules: { id: 'sched-3', run_at: '2026-09-01T10:00:00.000Z', status: 'pending' },
  }];
  const client = fakeClient({ dueItems, projectsById: {}, claimable: () => false });
  let called = false;
  const whatsappPublisher = async () => { called = true; return {}; };

  const result = await runDueCloudWhatsAppPublishSweep('/unused', client, { whatsappPublisher });

  assert.equal(result.published, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(called, false);
  assert.equal(client.state.contentItemUpdates.length, 0);
});

test('runDueCloudWhatsAppPublishSweep errors clearly when no local WAHA session is configured, without signing media', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-cloud-wa-nosession-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'project.json'), JSON.stringify({ projectId: 'acme-pizza' }));

  const dueItems = [{
    id: 'item-4', project_id: 'proj-uuid-1', channel: 'whatsapp_status', copy: 'oi',
    media_url: 'acme-pizza/x.png', metadata: {},
    schedules: { id: 'sched-4', run_at: '2026-09-01T10:00:00.000Z', status: 'pending' },
  }];
  const client = fakeClient({ dueItems, projectsById: { 'proj-uuid-1': { id: 'proj-uuid-1', slug: 'acme-pizza' } } });
  const whatsappPublisher = async () => { throw new Error('should not be called'); };

  const result = await runDueCloudWhatsAppPublishSweep(targetDir, client, { whatsappPublisher });

  assert.equal(result.published, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /Sessão WAHA não configurada/);
  assert.equal(client.state.signedUrlCalls.length, 0);
  assert.equal(client.state.contentItemUpdates[0].patch.status, 'error');

  await rm(targetDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/cloud-whatsapp-publish.test.js`
Expected: FAIL — `Cannot find module '../src/cloud-whatsapp-publish.js'`.

- [ ] **Step 3: Implement `src/cloud-whatsapp-publish.js`**

```js
// src/cloud-whatsapp-publish.js
//
// Cloud-aware counterpart to runDuePublishSweep's whatsapp_status path:
// that one only ever reads local project.json content/schedules. Content
// approved from the cloud panel (Approval.tsx) lives in Supabase instead —
// this reads due whatsapp_status items directly from there, resolves the
// project's local WAHA session from project.json (never migrated, stays
// 100% local by design), and calls the existing, unmodified
// publishContentToWhatsAppStatus. Mirrors publish-sweep/index.ts's query
// shape, atomic claim, and status/metadata write convention exactly, so
// the two sweeps (Meta via publish-sweep, WhatsApp via this) stay
// consistent for anything reading content_items/schedules downstream.
import { readFile } from 'node:fs/promises';
import { getCentralPaths } from './content-central.js';

const SIGNED_URL_TTL_SECONDS = 300;

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function runDueCloudWhatsAppPublishSweep(targetDir, client, options = {}) {
  const now = options.now || new Date();
  const whatsappPublisher = options.whatsappPublisher;
  const result = { published: 0, errors: [] };
  if (typeof whatsappPublisher !== 'function') return result;

  const { data: dueItems, error: queryError } = await client
    .from('content_items')
    .select('id, project_id, channel, copy, media_url, metadata, schedules!inner(id, run_at, status)')
    .eq('channel', 'whatsapp_status')
    .eq('status', 'approved')
    .eq('schedules.status', 'pending')
    .lte('schedules.run_at', now.toISOString());
  if (queryError) {
    result.errors.push({ contentItemId: null, error: `failed to query due items: ${queryError.message}` });
    return result;
  }

  for (const item of dueItems || []) {
    // schedules.content_item_id is UNIQUE, so PostgREST embeds it as a
    // single object, not an array — same as publish-sweep/index.ts.
    const schedule = Array.isArray(item.schedules) ? item.schedules[0] : item.schedules;
    if (!schedule) {
      result.errors.push({ contentItemId: item.id, error: 'no schedule found for item' });
      continue;
    }

    const { data: claimed } = await client.from('schedules')
      .update({ status: 'running' })
      .eq('id', schedule.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed?.length) continue; // another sweep already claimed this item

    try {
      await publishOneCloudWhatsAppItem(client, item, schedule, targetDir, whatsappPublisher, result.errors);
      result.published += 1;
    } catch (err) {
      result.errors.push({ contentItemId: item.id, error: err.message });
      const { error: itemErrorUpdateError } = await client.from('content_items').update({
        status: 'error',
        metadata: { ...item.metadata, publishError: err.message },
      }).eq('id', item.id);
      if (itemErrorUpdateError) {
        result.errors.push({ contentItemId: item.id, error: `failed to record error status on content_items: ${itemErrorUpdateError.message}` });
      }
      const { error: scheduleErrorUpdateError } = await client.from('schedules').update({ status: 'error' }).eq('id', schedule.id);
      if (scheduleErrorUpdateError) {
        result.errors.push({ contentItemId: item.id, error: `failed to record error status on schedules: ${scheduleErrorUpdateError.message}` });
      }
    }
  }

  return result;
}

async function publishOneCloudWhatsAppItem(client, item, schedule, targetDir, whatsappPublisher, errors) {
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, slug')
    .eq('id', item.project_id)
    .single();
  if (projectError || !project) throw new Error(`project not found: ${projectError?.message}`);

  // WAHA session lives only in project.json, never migrated to Supabase —
  // checked here, before generating a signed URL, so a project with no
  // session configured fails fast instead of wasting a signed-URL call.
  // Same message publishContentToWhatsAppStatus itself would throw
  // internally if it got this far with an empty whatsapp block.
  const { projectPath } = getCentralPaths(targetDir, project.slug);
  const localProject = await readJsonIfExists(projectPath);
  const sessionName = localProject?.whatsapp?.sessionName;
  if (!sessionName) {
    throw new Error('Sessão WAHA não configurada para este projeto — configure na aba "Conta e token".');
  }

  const { data: signed, error: signError } = await client.storage
    .from('content-media')
    .createSignedUrl(item.media_url, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) throw new Error(`failed to sign media URL: ${signError?.message}`);

  const publishResult = await whatsappPublisher({
    content: { caption: { text: item.copy || '' }, publish: { mediaUrl: signed.signedUrl } },
    project: { projectId: project.slug, whatsapp: { sessionName } },
  });

  const { error: itemUpdateError } = await client.from('content_items').update({
    status: 'posted',
    metadata: { ...item.metadata, publishResult },
  }).eq('id', item.id);
  if (itemUpdateError) throw new Error(`published but failed to update content_items status: ${itemUpdateError.message}`);

  // Publish + content_items write both already succeeded — a schedule-sync
  // failure here must not throw up into the outer catch (which would
  // rewrite content_items back to 'error' using stale metadata, mislabeling
  // a genuinely-live post as failed). Push onto the caller's errors array
  // instead and leave content_items at 'posted'; the schedule row staying
  // at 'running' is the much safer failure mode — publish-sweep/index.ts
  // uses this exact same reasoning for its own 'done' write.
  const { error: scheduleUpdateError } = await client.from('schedules').update({ status: 'done' }).eq('id', schedule.id);
  if (scheduleUpdateError) {
    errors.push({ contentItemId: item.id, error: `published successfully but failed to update schedule status: ${scheduleUpdateError.message}` });
  }
}
```

Note the `errors` parameter: `publishOneCloudWhatsAppItem`'s signature is
`(client, item, schedule, targetDir, whatsappPublisher, errors)`, and its
one call site in `runDueCloudWhatsAppPublishSweep` (in the `try` block
above) passes `result.errors` — this is why the schedule-write failure
above can be recorded without throwing: it pushes onto the same array the
outer function already returns, instead of landing in the `catch` that
handles genuine publish failures.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/cloud-whatsapp-publish.test.js`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/cloud-whatsapp-publish.js tests/cloud-whatsapp-publish.test.js
git commit -m "feat: cloud-aware WhatsApp Status publish sweep (Supabase-sourced, local WAHA session)"
```

---

### Task 3: Wire the new scheduler into `content-central-server.js`

**Depends-on:** Task 2 (imports `runDueCloudWhatsAppPublishSweep`).

**Files:**
- Modify: `src/content-central-server.js`

**Interfaces:** Consumes `runDueCloudWhatsAppPublishSweep` (Task 2) and
`createSupabaseAdminClient` from `./supabase-client.js` (existing, unchanged).

- [ ] **Step 1: Add imports**

Near the top of `src/content-central-server.js`, after the existing
`import { uploadToImgBB } from '../skills/instagram-publisher/scripts/publish.js';` line, add:

```js
import { runDueCloudWhatsAppPublishSweep } from './cloud-whatsapp-publish.js';
import { createSupabaseAdminClient } from './supabase-client.js';
```

- [ ] **Step 2: Add `startCloudWhatsAppPublishScheduler`**

Immediately after `startWhatsAppPublishScheduler`'s closing `}` (around
line 4930, right before the `startStuckMediaRetryScheduler` comment block),
add:

```js
// Cloud-aware counterpart to startWhatsAppPublishScheduler: that one only
// ever sees local project.json content/schedules. Content approved from
// the cloud panel (Approval.tsx) lives in Supabase instead, and nothing
// local was consuming that state before this existed — a whatsapp_status
// item approved from the cloud panel just sat there forever. Same WAHA
// session lookup as the local flow (project.json's whatsapp.sessionName),
// same publishContentToWhatsAppStatus call, unmodified — this only adds
// the Supabase-side due-item lookup and result bookkeeping around it.
export function startCloudWhatsAppPublishScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') return null;
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch {
    // No SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY configured — this operator
    // hasn't set up the cloud panel; stay silent, same reasoning as
    // startStuckMediaRetryScheduler's OPENSQUAD_GAVETA_DIR gate for an
    // optional subsystem not every local install uses.
    return null;
  }
  const intervalMs = Number(process.env.OPENSQUAD_PUBLISH_CHECK_INTERVAL_MS || 180000);
  // Same overlap guard as startWhatsAppPublishScheduler — a slow WAHA call
  // can outlast intervalMs.
  let running = false;
  const sweep = () => {
    if (running) return;
    running = true;
    runDueCloudWhatsAppPublishSweep(targetDir, client, {
      whatsappPublisher: (payload) => publishContentToWhatsAppStatus(payload, targetDir),
    }).catch((err) => console.error('[content-central] cloud whatsapp publish sweep failed:', err.message))
      .finally(() => { running = false; });
  };
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}
```

- [ ] **Step 3: Wire into server startup and shutdown**

Change:
```js
  const publishSchedulerTimer = startPublishScheduler(targetDir);
  const whatsappPublishSchedulerTimer = startWhatsAppPublishScheduler(targetDir);
```
to:
```js
  const publishSchedulerTimer = startPublishScheduler(targetDir);
  const whatsappPublishSchedulerTimer = startWhatsAppPublishScheduler(targetDir);
  const cloudWhatsAppPublishSchedulerTimer = startCloudWhatsAppPublishScheduler(targetDir);
```

Change:
```js
      if (publishSchedulerTimer) clearInterval(publishSchedulerTimer);
      if (whatsappPublishSchedulerTimer) clearInterval(whatsappPublishSchedulerTimer);
```
to:
```js
      if (publishSchedulerTimer) clearInterval(publishSchedulerTimer);
      if (whatsappPublishSchedulerTimer) clearInterval(whatsappPublishSchedulerTimer);
      if (cloudWhatsAppPublishSchedulerTimer) clearInterval(cloudWhatsAppPublishSchedulerTimer);
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions, all Task 2 tests included.

- [ ] **Step 5: Commit**

```bash
git add src/content-central-server.js
git commit -m "feat: start the cloud WhatsApp Status publish scheduler alongside the local one"
```

---

## Post-plan (controller, not a subagent task)

After all 3 tasks land and the final review is clean:

1. Manual verification of Task 1 (no automated Deno test exists for
   `publish-sweep` — see Global Constraints): approve a `whatsapp_status`
   item in the cloud panel, trigger `publish-sweep` manually (`curl` its
   endpoint or wait for the pg_cron tick), and confirm via Supabase
   Studio / `query_logs` that the item's `schedules` row is untouched by
   `publish-sweep` (still `pending`, not flipped to `error`).
2. End-to-end check with real WAHA: approve a `whatsapp_status` item in
   the cloud panel for a project with a connected WAHA session, run the
   local server with `OPENSQUAD_ENABLE_REAL_PUBLISHING=true`, and confirm
   the new scheduler picks it up within one interval and it actually
   posts.
3. Report to the user; this closes out Fase 4a. Fase 4b (remote art
   generation) is the next, separate phase — not started by this plan.
