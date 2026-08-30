# Cloud Publish Backend — Fase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish approved Instagram/Facebook content automatically, 24h, without the local PC being on — two Supabase Edge Functions (a cron-driven publish sweep, and a secure token-save endpoint) plus the schema they need, no custom server.

**Architecture:** `pg_cron` fires the `publish-sweep` Edge Function every 5 minutes (also callable on-demand for "publish now"). It queries `content_items`/`schedules` for due, approved rows, decrypts each project's Instagram token from Supabase Vault via a `SECURITY DEFINER` RPC, generates a short-lived signed URL for the stored image, calls the Meta Graph API (logic ported near-verbatim from the existing, already-proven `squads/conteudo-multicanal/tools/meta-publish-multi.js`), and writes the result back. The same invocation then sends any due alert emails (token expiring, publish failed) via Resend, with a 24h cooldown tracked in a new table. `save-instagram-token` is a second, tiny Edge Function the future frontend calls to store/rotate a project's token — it never returns the token, and only it (via its own service-role client) can write to Vault.

**Tech Stack:** Supabase Postgres (Vault extension, `pg_cron`, `pg_net`), Supabase Edge Functions (Deno), `node --test` for the portable pure-logic modules (no Deno install required for this repo's own test suite — see Global Constraints), Resend (existing project convention, `skills/resend/SKILL.md`).

## Global Constraints

- No custom Node server for this phase — only Supabase-native pieces (Edge Functions, `pg_cron`, Vault).
- The Instagram token is never stored in a plain column, never returned by any Edge Function response, and never readable by the `anon`/`authenticated` roles — only by a `SECURITY DEFINER` RPC whose `EXECUTE` is revoked from `public`/`anon`/`authenticated`.
- Scope for this phase: `instagram_feed`, `instagram_story`, `facebook_feed`, `facebook_story` (single-image channels) only. `instagram_reels` (video) and Instagram carousel are explicitly OUT of scope — the Fase 1 migration never captured video files or multi-slide data into `content_items`, so there is nothing to publish yet for those channels. Flagged as a follow-up, not silently dropped.
- Every pure-logic module (Graph API call sequence, alert cooldown/email-content building) lives in a file with zero Deno-specific APIs (`Deno.*`) so it can be unit-tested with the existing `node --test` runner — no Deno install needed to develop or test this phase locally. Only the thin `index.ts` entrypoints use `Deno.serve`/`Deno.env`/`npm:` imports, and those are deployed+validated manually (no local Deno runtime available in this environment).
- One error per content item never aborts the rest of the sweep (same isolation pattern as the Fase 1 migration script).
- `service_role` (used internally by both Edge Functions) is a project secret, never committed, never sent to a frontend — same rule as Fase 1.

---

### Task 1: Schema + Vault RPC functions

**Files:**
- Create: `supabase/migrations/0002_publish_backend.sql`

**Interfaces:**
- Consumes: the Fase 1 schema (`projects`, `content_items`, `schedules`) already live in the user's Supabase project.
- Produces: `projects.instagram_account jsonb`, `projects.instagram_token_secret_id uuid`, `projects.instagram_token_expires_at timestamptz`; table `alert_notifications(key text primary key, last_sent_at timestamptz)`; RPC functions `set_instagram_token(p_project_id uuid, p_token text, p_expires_at timestamptz) returns void` and `get_instagram_token(p_project_id uuid) returns text` — Tasks 4 and 5 call these two RPCs by name.

No automated test for this task (same convention as Fase 1's schema task — SQL applied and verified manually against the real project, not unit-tested).

- [ ] **Step 1: write the migration SQL**

```sql
-- supabase/migrations/0002_publish_backend.sql

alter table projects add column instagram_account jsonb not null default '{}'::jsonb;
alter table projects add column instagram_token_secret_id uuid;
alter table projects add column instagram_token_expires_at timestamptz;

create table alert_notifications (
  key text primary key,
  last_sent_at timestamptz not null
);
alter table alert_notifications enable row level security;
-- No policies on purpose: only the service-role client (used exclusively
-- inside the publish-sweep Edge Function) touches this table. RLS with zero
-- policies denies anon/authenticated entirely — there is no panel surface
-- for this table, matching the design spec.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Stores/rotates a project's Instagram token in Vault. SECURITY DEFINER so
-- it can write to the vault schema; EXECUTE is revoked from anon/authenticated
-- below so only the service-role client (inside the save-instagram-token
-- Edge Function) can ever call this.
create or replace function set_instagram_token(p_project_id uuid, p_token text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select instagram_token_secret_id into v_secret_id from projects where id = p_project_id;
  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, p_token);
  else
    v_secret_id := vault.create_secret(p_token, 'instagram_token_' || p_project_id::text);
    update projects set instagram_token_secret_id = v_secret_id where id = p_project_id;
  end if;
  update projects set instagram_token_expires_at = p_expires_at where id = p_project_id;
end;
$$;
revoke execute on function set_instagram_token(uuid, text, timestamptz) from public, anon, authenticated;

-- Reads back the decrypted token for the publish-sweep Edge Function.
-- Same SECURITY DEFINER + revoked-grant pattern — nothing but the
-- service-role client can ever call this.
create or replace function get_instagram_token(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_token text;
begin
  select instagram_token_secret_id into v_secret_id from projects where id = p_project_id;
  if v_secret_id is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id;
  return v_token;
end;
$$;
revoke execute on function get_instagram_token(uuid) from public, anon, authenticated;
```

- [ ] **Step 2: apply the migration**

Paste the file's contents into the Supabase Dashboard's SQL Editor (same manual process as Fase 1's `0001_init.sql`) and run it against the real project.

- [ ] **Step 3: verify manually**

Confirm the 3 new `projects` columns exist, `alert_notifications` exists with RLS enabled, and both RPCs exist (`select proname from pg_proc where proname in ('set_instagram_token','get_instagram_token');` should return both rows).

- [ ] **Step 4: commit**

```bash
git add supabase/migrations/0002_publish_backend.sql
git commit -m "feat: add Fase 2 schema (Instagram token via Vault, alert cooldown table)"
```

---

### Task 2: Shared Meta Graph API publish module

**Files:**
- Create: `supabase/functions/_shared/meta-publish.js`
- Create: `tests/meta-publish-shared.test.js`

**Interfaces:**
- Consumes: nothing (pure module — only the global `fetch`, which tests override via a local stub HTTP server passed in through the `graphBase` parameter).
- Produces: `publishToMeta(target)` where `target = { channel, token, igId, pageId, imageUrl, caption, graphBase? }` → `{ ok: true, mediaId, containerId?, postId?, permalink }`, throwing on failure with a message naming the Graph API error. Supports `channel` values `'instagram_feed' | 'instagram_story' | 'facebook_feed' | 'facebook_story'`. Task 5 imports and calls this per due content item.

This is a near-verbatim port of the already-proven `squads/conteudo-multicanal/tools/meta-publish-multi.js` (same retry-on-transient-media-fetch-failure behavior, same two-step container→publish sequence), adapted to take credentials as explicit parameters instead of reading per-target env vars — the Edge Function calls this once per already-resolved project/token, not as a multi-account CLI.

- [ ] **Step 1: write the failing tests**

```js
// tests/meta-publish-shared.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { publishToMeta } from '../supabase/functions/_shared/meta-publish.js';

function startStubGraphServer(handler) {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, () => resolvePromise(server));
  });
}

function graphBaseFor(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test('publishToMeta instagram_feed: creates container, waits for FINISHED, publishes, fetches permalink', async () => {
  const calls = [];
  const server = await startStubGraphServer((req, res) => {
    calls.push(req.url);
    if (req.url.startsWith('/ig123/media?')) {
      res.end(JSON.stringify({ id: 'container-1' }));
    } else if (req.url.startsWith('/container-1?fields=status_code')) {
      res.end(JSON.stringify({ status_code: 'FINISHED' }));
    } else if (req.url.startsWith('/ig123/media_publish')) {
      res.end(JSON.stringify({ id: 'media-1' }));
    } else if (req.url.startsWith('/media-1?fields=permalink')) {
      res.end(JSON.stringify({ permalink: 'https://instagram.com/p/abc' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  const result = await publishToMeta({
    channel: 'instagram_feed',
    token: 'fake-token',
    igId: 'ig123',
    imageUrl: 'https://cdn.example.com/img.png',
    caption: 'Legenda de teste',
    graphBase: graphBaseFor(server),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mediaId, 'media-1');
  assert.equal(result.containerId, 'container-1');
  assert.equal(result.permalink, 'https://instagram.com/p/abc');
  server.close();
});

test('publishToMeta retries container creation on Meta\'s transient media-fetch error (code 9004, subcode 2207052)', async () => {
  let containerAttempts = 0;
  const server = await startStubGraphServer((req, res) => {
    if (req.url.startsWith('/ig123/media?')) {
      containerAttempts += 1;
      if (containerAttempts === 1) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'Falha ao baixar mídia', code: 9004, error_subcode: 2207052 } }));
        return;
      }
      res.end(JSON.stringify({ id: 'container-2' }));
    } else if (req.url.startsWith('/container-2?fields=status_code')) {
      res.end(JSON.stringify({ status_code: 'FINISHED' }));
    } else if (req.url.startsWith('/ig123/media_publish')) {
      res.end(JSON.stringify({ id: 'media-2' }));
    } else if (req.url.startsWith('/media-2?fields=permalink')) {
      res.end(JSON.stringify({ permalink: null }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  const result = await publishToMeta({
    channel: 'instagram_feed',
    token: 'fake-token',
    igId: 'ig123',
    imageUrl: 'https://cdn.example.com/img.png',
    caption: '',
    graphBase: graphBaseFor(server),
  });

  assert.equal(result.ok, true);
  assert.equal(containerAttempts, 2);
  server.close();
});

test('publishToMeta throws a descriptive error on a non-retryable Graph API failure', async () => {
  const server = await startStubGraphServer((req, res) => {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: 'Invalid OAuth access token', code: 190, fbtrace_id: 'abc123' } }));
  });

  await assert.rejects(
    () => publishToMeta({ channel: 'instagram_feed', token: 'bad', igId: 'ig123', imageUrl: 'https://cdn.example.com/img.png', graphBase: graphBaseFor(server) }),
    /Invalid OAuth access token.*code=190.*fbtrace_id=abc123/,
  );
  server.close();
});

test('publishToMeta facebook_story: photo (unpublished) then photo_stories', async () => {
  const calls = [];
  const server = await startStubGraphServer((req, res) => {
    calls.push(req.url.split('?')[0]);
    if (req.url.startsWith('/page456/photos?')) {
      res.end(JSON.stringify({ id: 'photo-1' }));
    } else if (req.url.startsWith('/page456/photo_stories')) {
      res.end(JSON.stringify({ post_id: 'story-post-1' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  const result = await publishToMeta({
    channel: 'facebook_story',
    token: 'fake-token',
    pageId: 'page456',
    imageUrl: 'https://cdn.example.com/img.png',
    graphBase: graphBaseFor(server),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mediaId, 'photo-1');
  assert.equal(result.postId, 'story-post-1');
  assert.deepEqual(calls, ['/page456/photos', '/page456/photo_stories']);
  server.close();
});

test('publishToMeta rejects an unsupported channel', async () => {
  await assert.rejects(
    () => publishToMeta({ channel: 'instagram_reels', token: 'x', igId: 'x', imageUrl: 'x' }),
    /Unsupported publish channel: instagram_reels/,
  );
});
```

- [ ] **Step 2: run tests to verify they fail**

Run: `node --test tests/meta-publish-shared.test.js`
Expected: FAIL — `../supabase/functions/_shared/meta-publish.js` does not exist.

- [ ] **Step 3: write the implementation**

```js
// supabase/functions/_shared/meta-publish.js
//
// Ported from squads/conteudo-multicanal/tools/meta-publish-multi.js — same
// proven Graph API call sequence (retry on Meta's transient media-fetch
// failure, two-step container->publish, permalink best-effort lookup) —
// adapted to take credentials as explicit parameters instead of reading
// per-target env vars, since this runs once per already-resolved
// project/token inside an Edge Function, not as a multi-account CLI.
//
// Deliberately zero Deno-specific APIs (only global `fetch`, which both
// Node and Deno provide) so this file is testable with `node --test` and
// importable as-is from a Deno Edge Function's index.ts.

const DEFAULT_GRAPH_BASE = 'https://graph.facebook.com/v25.0';
const RETRYABLE_ERROR_CODE = 9004;
const RETRYABLE_ERROR_SUBCODES = new Set([2207052]);

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function graph(path, params = {}, method = 'GET', { retries = 0, retryDelayMs = 4000, graphBase = DEFAULT_GRAPH_BASE } = {}) {
  const url = new URL(`${graphBase}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { method });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }

    if (res.ok) return json;

    const error = json?.error;
    const isRetryableMediaFetchFailure = error?.code === RETRYABLE_ERROR_CODE && RETRYABLE_ERROR_SUBCODES.has(error?.error_subcode);
    if (isRetryableMediaFetchFailure && attempt < retries) {
      await sleep(retryDelayMs);
      continue;
    }

    if (error?.message) {
      const details = [
        error.type && `type=${error.type}`,
        error.code !== undefined && `code=${error.code}`,
        error.error_subcode !== undefined && `subcode=${error.error_subcode}`,
        error.fbtrace_id && `fbtrace_id=${error.fbtrace_id}`,
      ].filter(Boolean).join(', ');
      throw new Error(`Meta API ${method} ${path} failed [${res.status}]: ${error.message}${details ? ` (${details})` : ''}`);
    }
    throw new Error(`Meta API ${method} ${path} failed [${res.status}]: ${JSON.stringify(json).slice(0, 500)}`);
  }
}

async function waitForInstagramContainer(containerId, token, graphBase) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const status = await graph(`/${containerId}`, { fields: 'status_code', access_token: token }, 'GET', { graphBase });
    if (status.status_code === 'FINISHED') return status.status_code;
    if (status.status_code === 'ERROR') throw new Error(`Instagram container ${containerId} entered ERROR state`);
    await sleep(10_000);
  }
  throw new Error(`Instagram container ${containerId} did not finish within 5 minutes`);
}

async function publishInstagramFeed(target, graphBase) {
  const { token, igId, imageUrl, caption } = target;
  const container = await graph(`/${igId}/media`, { image_url: imageUrl, caption: caption || '', access_token: token }, 'POST', { retries: 2, graphBase });
  await waitForInstagramContainer(container.id, token, graphBase);
  const published = await graph(`/${igId}/media_publish`, { creation_id: container.id, access_token: token }, 'POST', { graphBase });
  let permalink = null;
  try {
    const media = await graph(`/${published.id}`, { fields: 'permalink', access_token: token }, 'GET', { graphBase });
    permalink = media.permalink || null;
  } catch { permalink = null; }
  return { ok: true, mediaId: published.id, containerId: container.id, permalink };
}

async function publishInstagramStory(target, graphBase) {
  const { token, igId, imageUrl } = target;
  const container = await graph(`/${igId}/media`, { image_url: imageUrl, media_type: 'STORIES', access_token: token }, 'POST', { retries: 2, graphBase });
  await waitForInstagramContainer(container.id, token, graphBase);
  const published = await graph(`/${igId}/media_publish`, { creation_id: container.id, access_token: token }, 'POST', { graphBase });
  return { ok: true, mediaId: published.id, containerId: container.id, permalink: null };
}

async function publishFacebookFeed(target, graphBase) {
  const { token, pageId, imageUrl, caption } = target;
  const published = await graph(`/${pageId}/photos`, { url: imageUrl, caption: caption || '', published: 'true', access_token: token }, 'POST', { graphBase });
  return { ok: true, mediaId: published.id || null, postId: published.post_id || null, permalink: null };
}

async function publishFacebookStory(target, graphBase) {
  const { token, pageId, imageUrl } = target;
  const photo = await graph(`/${pageId}/photos`, { url: imageUrl, published: 'false', access_token: token }, 'POST', { graphBase });
  const story = await graph(`/${pageId}/photo_stories`, { photo_id: photo.id, access_token: token }, 'POST', { graphBase });
  return { ok: true, mediaId: photo.id || null, postId: story.post_id || null, permalink: null };
}

// target: { channel, token, igId?, pageId?, imageUrl, caption?, graphBase? }
export async function publishToMeta(target) {
  const graphBase = target.graphBase || DEFAULT_GRAPH_BASE;
  if (target.channel === 'instagram_feed') return publishInstagramFeed(target, graphBase);
  if (target.channel === 'instagram_story') return publishInstagramStory(target, graphBase);
  if (target.channel === 'facebook_feed') return publishFacebookFeed(target, graphBase);
  if (target.channel === 'facebook_story') return publishFacebookStory(target, graphBase);
  throw new Error(`Unsupported publish channel: ${target.channel}`);
}
```

- [ ] **Step 4: run tests to verify they pass**

Run: `node --test tests/meta-publish-shared.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: commit**

```bash
git add supabase/functions/_shared/meta-publish.js tests/meta-publish-shared.test.js
git commit -m "feat: port Meta Graph API publish logic for the cloud publish-sweep function"
```

---

### Task 3: Shared alerts module

**Files:**
- Create: `supabase/functions/_shared/alerts.js`
- Create: `tests/alerts-shared.test.js`

**Interfaces:**
- Consumes: rows shaped like what Task 5 will query from Supabase — a project row (`{ id, name, instagram_token_expires_at }`) and content-item rows with a publish error (`{ id, project_id, project_name, content_id, channel, publish_error }`).
- Produces: `buildAlerts({ projects, failedItems }, now)` → `Alert[]` (`{ type, key, subject, body }`, `type` one of `'token_expired' | 'token_expiring' | 'publish_failed'`); `dueAlerts(alerts, notified, now, cooldownMs)` → the subset of `alerts` whose cooldown has elapsed (pure, no I/O — Task 5 handles reading/writing `notified` from `alert_notifications`). Task 5 imports both.

Scope narrower than the local `listSystemAlerts` on purpose: `topic_ideas_fallback` and `media_upload_failed` are local-content-generation concerns with no equivalent in the cloud publish-sweep (which only ever touches already-approved, already-hosted content) — not ported.

- [ ] **Step 1: write the failing tests**

```js
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
```

- [ ] **Step 2: run tests to verify they fail**

Run: `node --test tests/alerts-shared.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: write the implementation**

```js
// supabase/functions/_shared/alerts.js
//
// Cloud equivalent of listSystemAlerts/alertNotificationKey/
// alertEmailSubject/alertEmailBody/the cooldown check in
// src/content-central.js (sendDueAlertEmails) — scoped down to what the
// cloud publish-sweep can actually see (no local-generation-only alert
// types). Zero Deno-specific APIs — same portability rule as meta-publish.js.

const TOKEN_EXPIRING_WITHIN_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysRemaining(expiresAt, now) {
  return Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
}

function subjectFor(type, projectName) {
  const icon = type === 'token_expired' ? '🔴' : type === 'token_expiring' ? '🟡' : '⚠️';
  const topic = type === 'publish_failed' ? 'falha ao publicar' : 'token da Meta';
  return `${icon} [Opensquad] ${projectName} — ${topic}`;
}

// projects: [{ id, name, instagram_token_expires_at }]
// failedItems: [{ id, project_id, project_name, content_id, channel, publish_error }]
export function buildAlerts({ projects, failedItems }, now = new Date()) {
  const alerts = [];

  for (const project of projects) {
    if (!project.instagram_token_expires_at) continue;
    const remaining = daysRemaining(project.instagram_token_expires_at, now);
    if (remaining <= 0) {
      alerts.push({
        type: 'token_expired',
        key: `token_expired:${project.id}`,
        subject: subjectFor('token_expired', project.name),
        body: `Token da Meta expirado — publicação real vai falhar até renovar.\n\nProjeto: ${project.name} (${project.id})`,
      });
    } else if (remaining <= TOKEN_EXPIRING_WITHIN_DAYS) {
      alerts.push({
        type: 'token_expiring',
        key: `token_expiring:${project.id}`,
        subject: subjectFor('token_expiring', project.name),
        body: `Token da Meta vence em ${remaining} dia(s).\n\nProjeto: ${project.name} (${project.id})`,
      });
    }
  }

  for (const item of failedItems) {
    alerts.push({
      type: 'publish_failed',
      key: `publish_failed:${item.project_id}:${item.content_id}`,
      subject: subjectFor('publish_failed', item.project_name),
      body: `Falha ao publicar "${item.content_id}" (${item.channel}): ${item.publish_error}\n\nProjeto: ${item.project_name} (${item.project_id})`,
    });
  }

  return alerts;
}

// alerts: Alert[]; notified: { [key]: isoTimestamp }
export function dueAlerts(alerts, notified, now, cooldownMs) {
  return alerts.filter((alert) => {
    const lastSentAt = notified[alert.key] ? new Date(notified[alert.key]) : null;
    if (!lastSentAt || Number.isNaN(lastSentAt.getTime())) return true;
    return now.getTime() - lastSentAt.getTime() >= cooldownMs;
  });
}
```

- [ ] **Step 4: run tests to verify they pass**

Run: `node --test tests/alerts-shared.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: commit**

```bash
git add supabase/functions/_shared/alerts.js tests/alerts-shared.test.js
git commit -m "feat: add cloud alert-building and cooldown logic for the publish sweep"
```

---

### Task 4: `save-instagram-token` Edge Function

**Files:**
- Create: `supabase/functions/save-instagram-token/index.ts`

**Interfaces:**
- Consumes: `set_instagram_token` RPC from Task 1.
- Produces: an HTTP endpoint (`POST` with a Supabase user JWT in `Authorization`) the future Fase 3 frontend calls with `{ projectId, token, expiresAt, account: { handle, instagramUserId, pageId } }`. Returns `{ ok: true, expiresAt, status }` — never echoes the token back.

No `node --test` coverage for this task — it's a thin Deno HTTP handler with no meaningfully testable pure logic beyond what Task 1/2/3 already cover; correctness is verified by the manual deploy-and-call step below (same convention as Fase 1's dashboard-only Task 3).

- [ ] **Step 1: write the Edge Function**

```ts
// supabase/functions/save-instagram-token/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
  }

  // Verify the caller is the authenticated owner (not just any request with
  // the anon key) using a client scoped to their JWT — this call fails if
  // the JWT is invalid/expired, before any Vault write happens.
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { projectId, token, expiresAt, account } = body || {};
  if (!projectId || !token) {
    return new Response(JSON.stringify({ error: 'projectId and token are required' }), { status: 400 });
  }

  // Service-role client — the only one allowed to call set_instagram_token
  // (EXECUTE is revoked from anon/authenticated in the migration).
  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (account) {
    const { error: accountError } = await adminClient
      .from('projects')
      .update({ instagram_account: account })
      .eq('id', projectId);
    if (accountError) {
      return new Response(JSON.stringify({ error: `failed to save Instagram account info: ${accountError.message}` }), { status: 500 });
    }
  }

  const { error: rpcError } = await adminClient.rpc('set_instagram_token', {
    p_project_id: projectId,
    p_token: token,
    p_expires_at: expiresAt || null,
  });
  if (rpcError) {
    return new Response(JSON.stringify({ error: `failed to save token: ${rpcError.message}` }), { status: 500 });
  }

  const status = !expiresAt ? 'valido' : (new Date(expiresAt).getTime() - Date.now()) <= 0 ? 'expirado'
    : (new Date(expiresAt).getTime() - Date.now()) <= 10 * 24 * 60 * 60 * 1000 ? 'vence_em_breve' : 'valido';

  return new Response(JSON.stringify({ ok: true, expiresAt: expiresAt || null, status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: commit**

```bash
git add supabase/functions/save-instagram-token/index.ts
git commit -m "feat: add save-instagram-token Edge Function"
```

- [ ] **Step 3 (manual, controller-run): deploy and verify**

Deploy this function via the Supabase Dashboard's Edge Functions editor (paste `index.ts`'s contents into a new function named `save-instagram-token`) — no Supabase CLI is available in this environment. Call it once with a real project id and a throwaway/test token value, confirm it returns `{ ok: true, ... }`, and confirm in the SQL Editor that `projects.instagram_token_secret_id` is now set for that project and `select decrypted_secret from vault.decrypted_secrets where id = <that id>` returns the token value back (proving the round trip works) before deleting that test row's secret.

---

### Task 5: `publish-sweep` Edge Function + cron scheduling

**Files:**
- Create: `supabase/functions/publish-sweep/index.ts`

**Interfaces:**
- Consumes: `publishToMeta` (Task 2), `buildAlerts`/`dueAlerts` (Task 3), `get_instagram_token` RPC (Task 1).
- Produces: an HTTP endpoint callable by `pg_cron` (no due-item filter — sweeps everything due) or manually with `{ contentItemId }` in the POST body (publishes that one item immediately, ignoring its schedule time).

No `node --test` coverage for this task either, for the same reason as Task 4 — all its meaningfully testable logic already lives in Tasks 2/3's pure modules; this file is Supabase-client wiring + Deno glue, verified by the manual step below.

- [ ] **Step 1: write the Edge Function**

```ts
// supabase/functions/publish-sweep/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { publishToMeta } from '../_shared/meta-publish.js';
import { buildAlerts, dueAlerts } from '../_shared/alerts.js';

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SIGNED_URL_TTL_SECONDS = 300;

Deno.serve(async (req) => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let manualContentItemId = null;
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      manualContentItemId = body?.contentItemId || null;
    } catch { /* cron calls with no body — fine */ }
  }

  const publishResult = await runPublishPass(client, manualContentItemId);
  const alertResult = await runAlertPass(client);

  return new Response(JSON.stringify({ ok: true, publish: publishResult, alerts: alertResult }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

async function runPublishPass(client, manualContentItemId) {
  const result = { published: 0, errors: [] };

  let query = client
    .from('content_items')
    .select('id, project_id, channel, copy, media_url, metadata, schedules!inner(id, run_at, status)')
    .eq('status', 'approved')
    .eq('schedules.status', 'pending');

  query = manualContentItemId
    ? query.eq('id', manualContentItemId)
    : query.lte('schedules.run_at', new Date().toISOString());

  const { data: dueItems, error: queryError } = await query;
  if (queryError) {
    result.errors.push({ contentItemId: null, error: `failed to query due items: ${queryError.message}` });
    return result;
  }

  for (const item of dueItems || []) {
    try {
      await publishOneItem(client, item);
      result.published += 1;
    } catch (err) {
      result.errors.push({ contentItemId: item.id, error: err.message });
      // Merge into the existing metadata (the full original item from the
      // Fase 1 migration lives there) — never replace the whole column, or
      // publishing wipes out contentTopic/generationContext/etc.
      await client.from('content_items').update({
        status: 'error',
        metadata: { ...item.metadata, publishError: err.message },
      }).eq('id', item.id);
      await client.from('schedules').update({ status: 'error' }).eq('id', item.schedules[0].id);
    }
  }

  return result;
}

async function publishOneItem(client, item) {
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, name, instagram_account')
    .eq('id', item.project_id)
    .single();
  if (projectError || !project) throw new Error(`project not found: ${projectError?.message}`);

  const token = await getInstagramToken(client, item.project_id);
  if (!token) throw new Error('no Instagram token configured for this project');

  const { igId, pageId } = { igId: project.instagram_account?.instagramUserId, pageId: project.instagram_account?.pageId };

  // item.media_url is the Storage object path within the content-media
  // bucket (e.g. "boss-pizzaria/boss-pizzaria-2026-08-04-01.png"), not a
  // full URL — set that way by the Fase 1 migration script. createSignedUrl
  // takes that path directly; the bucket is already selected via .from(...).
  const { data: signed, error: signError } = await client.storage
    .from('content-media')
    .createSignedUrl(item.media_url, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) throw new Error(`failed to sign media URL: ${signError?.message}`);

  const publishResult = await publishToMeta({
    channel: item.channel,
    token,
    igId,
    pageId,
    imageUrl: signed.signedUrl,
    caption: item.copy || '',
  });

  // Same merge rule as the error path above — publishResult is added
  // alongside the existing metadata, never replacing it.
  await client.from('content_items').update({
    status: 'posted',
    metadata: { ...item.metadata, publishResult },
  }).eq('id', item.id);
  await client.from('schedules').update({ status: 'done' }).eq('id', item.schedules[0].id);
}

async function getInstagramToken(client, projectId) {
  const { data, error } = await client.rpc('get_instagram_token', { p_project_id: projectId });
  if (error) throw new Error(`failed to read Instagram token: ${error.message}`);
  return data;
}

async function runAlertPass(client) {
  const now = new Date();
  const { data: projects } = await client.from('projects').select('id, name, instagram_token_expires_at');
  const { data: failedRaw } = await client
    .from('content_items')
    .select('id, project_id, channel, content_id, metadata, projects!inner(name)')
    .eq('status', 'error');

  const failedItems = (failedRaw || []).map((row) => ({
    id: row.id,
    project_id: row.project_id,
    project_name: row.projects?.name,
    content_id: row.content_id || row.id,
    channel: row.channel,
    publish_error: row.metadata?.publishError || 'erro desconhecido',
  }));

  const alerts = buildAlerts({ projects: projects || [], failedItems }, now);

  const { data: notifiedRows } = await client.from('alert_notifications').select('key, last_sent_at');
  const notified = Object.fromEntries((notifiedRows || []).map((row) => [row.key, row.last_sent_at]));

  const toSend = dueAlerts(alerts, notified, now, ALERT_COOLDOWN_MS);
  const sent = [];
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const recipient = Deno.env.get('OPENSQUAD_ALERTS_EMAIL') || 'juciclei.ger@gmail.com';

  for (const alert of toSend) {
    if (resendApiKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'onboarding@resend.dev', to: recipient, subject: alert.subject, text: alert.body }),
      });
    }
    await client.from('alert_notifications').upsert([{ key: alert.key, last_sent_at: now.toISOString() }], { onConflict: 'key' });
    sent.push(alert.key);
  }

  return { sent };
}
```

- [ ] **Step 2: commit**

```bash
git add supabase/functions/publish-sweep/index.ts
git commit -m "feat: add publish-sweep Edge Function (Instagram/Facebook auto-publish + alerts)"
```

- [ ] **Step 3 (manual, controller-run): deploy, set secrets, verify**

1. Deploy via the Dashboard's Edge Functions editor (paste `index.ts`, name it `publish-sweep`).
2. Set the `RESEND_API_KEY` and `OPENSQUAD_ALERTS_EMAIL` secrets for the function (Dashboard → Edge Functions → Secrets — `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are already auto-injected by Supabase, no need to set those).
3. Approve one real content item in `content_items` (via SQL Editor: `update content_items set status = 'approved' where id = '<a real id with a pending schedule>';`) and call the deployed function manually with `{"contentItemId": "<that id>"}` — confirm it actually posts to Instagram (check the account) and that `content_items.status` becomes `'posted'`.

- [ ] **Step 4 (manual, controller-run): schedule the cron sweep**

Once the function's deployed URL and the project's `service_role` key are known, paste and run in the SQL Editor:

```sql
select cron.schedule(
  'publish-sweep-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := '<the deployed publish-sweep function URL>',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <the project service_role key>',
      'Content-Type', 'application/json'
    )
  );
  $$
);
```

Verify with `select * from cron.job;` that the job is registered, and check back after ~10 minutes that `cron.job_run_details` shows successful runs.

---

## Out of scope / next

- `instagram_reels` (video) and Instagram carousel publishing — blocked on the Fase 1 migration script not capturing video files or multi-slide data; needs its own follow-up plan once that's addressed.
- Automatic Instagram token refresh before expiry (today: manual re-paste via `save-instagram-token` when the alert email arrives).
- Fase 3: the actual cloud frontend that calls `save-instagram-token` and shows the alert/publish state — this phase only builds the backend pieces it will call.
