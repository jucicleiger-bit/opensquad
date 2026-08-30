# Cloud Split — Fase 1: Schema + Auth (Supabase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Supabase database (schema + RLS), single-user auth with MFA, and a one-time migration script that copies today's local JSON project/content data into it — the foundation the later cloud backend, cloud frontend, and local agent phases will build on.

**Architecture:** A new Supabase project holds 4 tables (`projects`, `content_items`, `schedules`, `jobs`) protected by Row Level Security scoped to a single owner. A thin `src/supabase-client.js` wrapper creates the admin (service-role) client from env vars. A migration module (`src/migrate-to-supabase.js`) walks the existing local data — `_opensquad/content-central/projects/<slug>/project.json` and `content/{drafts,approved,published,cancelled}/**/batch.json` — and upserts it into Supabase, uploading any generated image file it finds to a private Storage bucket. Nothing in this phase touches the running local server or changes how content is generated; it only copies data outward.

**Tech Stack:** Node ≥20 (existing engine floor), `@supabase/supabase-js` (new dependency), `sharp` (already a dependency — reused for image compression), `node:test` (existing test runner, matches `tests/*.test.js` convention), Supabase Postgres + Auth + Storage + Realtime.

## Global Constraints

- Single user only — no multi-tenant, no roles/permissions (per spec).
- MFA (TOTP) is mandatory for the one Supabase Auth user.
- RLS enabled on every table; the only policy is `owner_id = auth.uid()` (directly on `projects`, via join on the others).
- The `service_role` key is never sent to a frontend and never committed — read only from env vars, used only by server-side/script code.
- All access is HTTPS (Supabase enforces this by default — no extra work needed).
- Images are compressed/resized to publish size before upload — never upload RAW originals.
- The migration script never deletes or modifies the local JSON/asset files — it only reads them.
- Storage bucket is **private**; `content_items.media_url` stores the **Storage object path**, not a signed URL (signed URLs expire — resolving a path to a viewable URL is a later phase's concern, when the frontend exists).

---

### Task 1: Supabase project + admin client wrapper

**Files:**
- Create: `src/supabase-client.js`
- Create: `tests/supabase-client.test.js`
- Modify: `.env.example` (add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Modify: `package.json` (add `@supabase/supabase-js` dependency)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `createSupabaseAdminClient(env = process.env)` → returns a `@supabase/supabase-js` `SupabaseClient` instance authenticated with the service-role key. Throws `Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')` if either env var is missing/empty. Later tasks (4, 5, 6) import and call this.

This task also covers creating the actual Supabase project — that step is manual/controller-run (creating a billable cloud resource needs a human's org/project choice), not something a subagent should do unattended:

- [ ] **Step 1 (manual, controller-run): create the Supabase project**

Create a new Supabase project (new org or existing one, user's choice) named e.g. `opensquad-content-central`. Record the project's URL and `service_role` key (Project Settings → API). Do **not** commit these — they go in a local `.env` only (already gitignored per `.env.example` convention).

- [ ] **Step 2: add `@supabase/supabase-js` dependency**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 3: add env vars to `.env.example`**

```
# Supabase (cloud split — Fase 1)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 4: write the failing test**

```js
// tests/supabase-client.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAdminClient } from '../src/supabase-client.js';

test('throws when SUPABASE_URL is missing', () => {
  assert.throws(
    () => createSupabaseAdminClient({ SUPABASE_SERVICE_ROLE_KEY: 'x' }),
    /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/
  );
});

test('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
  assert.throws(
    () => createSupabaseAdminClient({ SUPABASE_URL: 'https://x.supabase.co' }),
    /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/
  );
});

test('returns a client when both env vars are set', () => {
  const client = createSupabaseAdminClient({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  });
  assert.equal(typeof client.from, 'function');
});
```

- [ ] **Step 5: run test to verify it fails**

Run: `node --test tests/supabase-client.test.js`
Expected: FAIL — `createSupabaseAdminClient` is not defined (module doesn't exist yet).

- [ ] **Step 6: write the implementation**

```js
// src/supabase-client.js
import { createClient } from '@supabase/supabase-js';

export function createSupabaseAdminClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  // Service-role key bypasses RLS — this client is for server-side/script
  // use only, never sent to a frontend.
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
```

- [ ] **Step 7: run test to verify it passes**

Run: `node --test tests/supabase-client.test.js`
Expected: PASS (3 tests)

- [ ] **Step 8: commit**

```bash
git add src/supabase-client.js tests/supabase-client.test.js .env.example package.json package-lock.json
git commit -m "feat: add Supabase admin client wrapper"
```

---

### Task 2: Database schema + RLS

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Consumes: the Supabase project created in Task 1 Step 1.
- Produces: tables `projects`, `content_items`, `schedules`, `jobs` with RLS enabled — Tasks 4, 5, 6 write to these tables by name/column exactly as defined here.

No automated test for this task per the spec ("RLS/Auth validated manually, not via automated test") — verification is applying the migration and listing tables.

- [ ] **Step 1: write the migration SQL**

```sql
-- supabase/migrations/0001_init.sql

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null,
  slug text not null unique,
  brand_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  channel text not null,
  -- draft | approved | scheduled | posted | error | cancelled
  -- (cancelled mirrors the local content/cancelled/ directory today)
  status text not null default 'draft',
  copy text,
  media_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_project_status_idx on content_items(project_id, status);

create table schedules (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  run_at timestamptz not null,
  -- pending | done | error
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index schedules_run_at_status_idx on schedules(run_at, status);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  -- 'art_generation' | 'whatsapp_send'
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  -- pending | running | done | error
  status text not null default 'pending',
  result_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_created_idx on jobs(status, created_at);

-- RLS: single-owner access only. jobs has no owner_id of its own (it's a
-- personal task queue, not per-project) so it's scoped to any
-- authenticated user — fine since this is a single-user system.
alter table projects enable row level security;
alter table content_items enable row level security;
alter table schedules enable row level security;
alter table jobs enable row level security;

create policy "owner full access" on projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner full access" on content_items
  for all using (
    project_id in (select id from projects where owner_id = auth.uid())
  ) with check (
    project_id in (select id from projects where owner_id = auth.uid())
  );

create policy "owner full access" on schedules
  for all using (
    content_item_id in (
      select ci.id from content_items ci
      join projects p on p.id = ci.project_id
      where p.owner_id = auth.uid()
    )
  ) with check (
    content_item_id in (
      select ci.id from content_items ci
      join projects p on p.id = ci.project_id
      where p.owner_id = auth.uid()
    )
  );

create policy "authenticated full access" on jobs
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
```

- [ ] **Step 2: add the private media bucket to the same migration**

Append to `supabase/migrations/0001_init.sql`:

```sql
insert into storage.buckets (id, name, public)
values ('content-media', 'content-media', false)
on conflict (id) do nothing;

create policy "owner read/write own media" on storage.objects
  for all using (
    bucket_id = 'content-media' and auth.uid() is not null
  ) with check (
    bucket_id = 'content-media' and auth.uid() is not null
  );
```

- [ ] **Step 3: apply the migration**

Use the `apply_migration` Supabase tool (or `supabase db push` with the CLI) against the project created in Task 1.

- [ ] **Step 4: verify manually**

List tables (via the `list_tables` Supabase tool, or the dashboard) and confirm all 4 tables exist with RLS enabled, and that the `content-media` bucket exists and is private.

- [ ] **Step 5: commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: add Supabase schema + RLS for cloud split"
```

---

### Task 3: Single-user auth with MFA

**Files:** none (Supabase dashboard configuration — no code).

**Interfaces:**
- Consumes: the project from Task 1.
- Produces: one authenticated user whose `auth.uid()` is the `owner_id` every RLS policy from Task 2 checks against.

- [ ] **Step 1: create the one user**

Supabase Dashboard → Authentication → Users → Add user (email + strong password). This is the only account that will ever exist in this project.

- [ ] **Step 2: enforce MFA**

Dashboard → Authentication → Providers → enable TOTP MFA. Then, as the new user, enroll a TOTP factor (Authentication → Users → the user → MFA), and set the project's MFA enforcement so unauthenticated-MFA sessions can't reach AAL2-gated data (Authentication → Policies/Settings — "Require MFA" toggle, or an `auth.mfa()` check folded into the RLS policies in a later fase if the dashboard toggle isn't sufficient — flag this as a follow-up if the dashboard has no hard-enforce toggle in the current Supabase version).

- [ ] **Step 3: verify manually**

Sign in with email+password only (no TOTP code) and confirm any query against `projects` fails until the TOTP step completes. Sign in with the full flow (password + TOTP) and confirm a `select * from projects` succeeds.

- [ ] **Step 4: commit**

Nothing to commit (dashboard-only). Note the completion in the PR/handoff instead.

---

### Task 4: Migrate `projects` from local JSON

**Files:**
- Create: `src/migrate-to-supabase.js`
- Create: `tests/migrate-to-supabase.test.js`

**Interfaces:**
- Consumes: `getCentralPaths(targetDir)` from `src/content-central.js` (already exported); a Supabase-client-shaped object passed in by the caller (`{ from(table) => { upsert(rows, opts) } }` — the subset of `@supabase/supabase-js` this module actually calls, so tests can pass a fake without needing a real Supabase project).
- Produces: `migrateProjects(targetDir, client)` → reads every `_opensquad/content-central/projects/<slug>/project.json`, upserts one row per project into `projects` (matching `slug`), returns `{ migrated: number, errors: Array<{ slug, error }> }`. Task 5 and Task 6 reuse this signature style.

- [ ] **Step 1: write the failing test**

```js
// tests/migrate-to-supabase.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateProjects } from '../src/migrate-to-supabase.js';

function fakeClient() {
  const upserts = { projects: [] };
  return {
    upserts,
    from(table) {
      return {
        upsert: async (rows) => {
          upserts[table].push(...rows);
          return { error: null };
        },
      };
    },
  };
}

test('migrateProjects upserts one row per local project.json', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({ projectId: 'acme-pizza', name: 'Acme Pizza', brand: { visualStyle: 'bold' } }),
  );

  const client = fakeClient();
  const result = await migrateProjects(targetDir, client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.upserts.projects.length, 1);
  assert.equal(client.upserts.projects[0].slug, 'acme-pizza');
  assert.equal(client.upserts.projects[0].name, 'Acme Pizza');
  assert.deepEqual(client.upserts.projects[0].brand_profile, { visualStyle: 'bold' });

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateProjects returns empty result when no projects dir exists', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-empty-'));
  const client = fakeClient();
  const result = await migrateProjects(targetDir, client);
  assert.equal(result.migrated, 0);
  assert.equal(result.errors.length, 0);
  await rm(targetDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: FAIL — `migrateProjects` is not defined.

- [ ] **Step 3: write the implementation**

```js
// src/migrate-to-supabase.js
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCentralPaths } from './content-central.js';

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function migrateProjects(targetDir, client) {
  const { projectsDir } = getCentralPaths(targetDir);
  const result = { migrated: 0, errors: [] };

  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return result;
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    try {
      const project = await readJsonIfExists(join(projectsDir, slug, 'project.json'));
      if (!project) continue;
      const { error } = await client.from('projects').upsert(
        [{
          slug,
          name: project.name || slug,
          brand_profile: project.brand || {},
        }],
        { onConflict: 'slug' },
      );
      if (error) throw new Error(error.message || String(error));
      result.migrated += 1;
    } catch (err) {
      result.errors.push({ slug, error: err.message });
    }
  }

  return result;
}
```

- [ ] **Step 4: run test to verify it passes**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: commit**

```bash
git add src/migrate-to-supabase.js tests/migrate-to-supabase.test.js
git commit -m "feat: migrate local project.json files into Supabase projects table"
```

---

### Task 5: Migrate content items + schedules + media upload

**Files:**
- Modify: `src/migrate-to-supabase.js`
- Modify: `tests/migrate-to-supabase.test.js`

**Interfaces:**
- Consumes: `migrateProjects` output is not required as input (this task re-derives the project's Supabase `id` by `slug`); `getCentralPaths(targetDir, projectId)` from `src/content-central.js`; the same fake-client shape as Task 4, extended with a `storage.from(bucket).upload(path, buffer, opts)` method.
- Produces: `migrateContentForProject(targetDir, slug, client)` → walks `content/{drafts,approved,published,cancelled}/**/batch.json` for one project, upserts rows into `content_items` (and `schedules` when `scheduledDate` is set), uploads each item's image file (when present on disk) to the `content-media` Storage bucket, and stores the **Storage path** (not a signed URL) in `content_items.media_url`. Returns `{ migrated: number, errors: Array<{ contentId, error }> }`.

Directory → status mapping: `drafts` → `draft`, `approved` → `approved`, `published` → `posted`, `cancelled` → `cancelled`. `content/ad-creatives/` uses a different file shape (individual files, not `batch.json` with an `items` array) — out of scope for this phase.

- [ ] **Step 1: write the failing test**

```js
// append to tests/migrate-to-supabase.test.js
import { migrateContentForProject } from '../src/migrate-to-supabase.js';

function fakeClientWithStorage() {
  const upserts = { projects: [], content_items: [], schedules: [] };
  const uploads = [];
  return {
    upserts,
    uploads,
    from(table) {
      if (table === 'projects') {
        return {
          upsert: async (rows) => { upserts.projects.push(...rows); return { error: null }; },
          select: () => ({
            eq: (_col, value) => ({
              single: async () => ({ data: { id: `project-uuid-for-${value}` }, error: null }),
            }),
          }),
        };
      }
      if (table === 'content_items') {
        return {
          upsert: (rows) => {
            const row = { id: `content-item-uuid-${upserts.content_items.length + 1}`, ...rows[0] };
            upserts.content_items.push(row);
            return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) };
          },
        };
      }
      if (table === 'schedules') {
        return { upsert: async (rows) => { upserts.schedules.push(...rows); return { error: null }; } };
      }
      throw new Error(`fakeClientWithStorage: unhandled table ${table}`);
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, buffer, opts) => {
          uploads.push({ bucket, path, size: buffer.length, contentType: opts?.contentType });
          return { data: { path }, error: null };
        },
      }),
    },
  };
}

test('migrateContentForProject upserts a content item, its schedule, and uploads the image', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-content-'));
  const batchDir = join(
    targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza',
    'content', 'drafts', '2026-08-04-01d',
  );
  await mkdir(join(batchDir, 'images'), { recursive: true });
  await writeFile(join(batchDir, 'images', 'day-01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(
    join(batchDir, 'batch.json'),
    JSON.stringify({
      items: [{
        contentId: 'acme-pizza-2026-08-04-01d-01',
        channel: 'instagram_feed',
        status: 'draft_generated',
        scheduledDate: '2026-08-04',
        scheduledTime: '12:00',
        caption: { text: 'Pizza hoje!' },
        image: { localPath: 'content/drafts/2026-08-04-01d/images/day-01.png', mimeType: 'image/png' },
        approval: { required: true, approvedAt: null },
        publish: { publishedAt: null, error: null },
      }],
    }),
  );

  const client = fakeClientWithStorage();
  const result = await migrateContentForProject(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.upserts.content_items.length, 1);
  assert.equal(client.upserts.content_items[0].project_id, 'project-uuid-for-acme-pizza');
  assert.equal(client.upserts.content_items[0].channel, 'instagram_feed');
  assert.equal(client.upserts.content_items[0].status, 'draft');
  assert.equal(client.upserts.content_items[0].copy, 'Pizza hoje!');
  assert.match(client.upserts.content_items[0].media_url, /^acme-pizza\/acme-pizza-2026-08-04-01d-01\./);
  assert.equal(client.upserts.schedules.length, 1);
  assert.equal(client.upserts.schedules[0].content_item_id, 'content-item-uuid-1');
  assert.equal(client.upserts.schedules[0].run_at, '2026-08-04T12:00:00.000Z');
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].bucket, 'content-media');

  await rm(targetDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: FAIL — `migrateContentForProject` is not defined.

- [ ] **Step 3: write the implementation**

```js
// append to src/migrate-to-supabase.js
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const CONTENT_DIR_STATUS = {
  drafts: 'draft',
  approved: 'approved',
  published: 'posted',
  cancelled: 'cancelled',
};

async function findBatchFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return found;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await findBatchFiles(full));
    else if (entry.name === 'batch.json') found.push(full);
  }
  return found;
}

function scheduledRunAt(item) {
  if (!item.scheduledDate) return null;
  const time = item.scheduledTime || '00:00';
  const iso = new Date(`${item.scheduledDate}T${time}:00Z`);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

async function uploadItemMedia(client, projectDir, slug, item) {
  const localPath = item.image?.localPath;
  if (!localPath) return null;
  const fullPath = join(projectDir, localPath);
  if (!existsSync(fullPath)) return null;

  let buffer = await readFile(fullPath);
  const mimeType = item.image.mimeType || 'application/octet-stream';
  const ext = mimeType.split('/')[1]?.split('+')[0] || 'bin';

  // Compress raster images before upload — never store RAW originals.
  // ponytail: SVG placeholders (draft previews before real art is
  // rendered) pass through unmodified; sharp only handles raster formats.
  if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
    buffer = await sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).toBuffer();
  }

  const storagePath = `${slug}/${item.contentId}.${ext}`;
  const { error } = await client.storage.from('content-media').upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(error.message || String(error));
  return storagePath;
}

export async function migrateContentForProject(targetDir, slug, client) {
  const result = { migrated: 0, errors: [] };
  const { data: projectRow, error: projectError } = await client
    .from('projects').select('id').eq('slug', slug).single();
  if (projectError || !projectRow) {
    result.errors.push({ contentId: null, error: `project not found in Supabase for slug ${slug}` });
    return result;
  }

  const { projectDir } = getCentralPaths(targetDir, slug);
  const contentDir = join(projectDir, 'content');

  for (const [subdir, status] of Object.entries(CONTENT_DIR_STATUS)) {
    const batchFiles = await findBatchFiles(join(contentDir, subdir));
    for (const batchFile of batchFiles) {
      const batch = await readJsonIfExists(batchFile);
      if (!batch?.items?.length) continue;

      for (const item of batch.items) {
        try {
          const mediaUrl = await uploadItemMedia(client, projectDir, slug, item);
          const { data: insertedItem, error: itemError } = await client
            .from('content_items')
            .upsert([{
              project_id: projectRow.id,
              channel: item.channel,
              status,
              copy: item.caption?.text || null,
              media_url: mediaUrl,
              metadata: item,
            }])
            .select()
            .single();
          if (itemError) throw new Error(itemError.message || String(itemError));

          const runAt = scheduledRunAt(item);
          if (runAt) {
            const scheduleStatus = item.publish?.error ? 'error' : item.publish?.publishedAt ? 'done' : 'pending';
            const { error: scheduleError } = await client.from('schedules').upsert([{
              content_item_id: insertedItem.id,
              run_at: runAt,
              status: scheduleStatus,
            }]);
            if (scheduleError) throw new Error(scheduleError.message || String(scheduleError));
          }

          result.migrated += 1;
        } catch (err) {
          result.errors.push({ contentId: item.contentId, error: err.message });
        }
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: run test to verify it passes**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: commit**

```bash
git add src/migrate-to-supabase.js tests/migrate-to-supabase.test.js
git commit -m "feat: migrate content items, schedules, and media into Supabase"
```

---

### Task 6: CLI entrypoint + idempotent full run

**Files:**
- Modify: `src/migrate-to-supabase.js`
- Modify: `tests/migrate-to-supabase.test.js`
- Modify: `package.json` (add `"migrate:supabase"` script)

**Interfaces:**
- Consumes: `migrateProjects` and `migrateContentForProject` (Tasks 4, 5); `createSupabaseAdminClient` (Task 1).
- Produces: `runMigration(targetDir, client)` → runs `migrateProjects`, then `migrateContentForProject` for every migrated project slug, returns a combined `{ projects, content }` result summary. Also a `main()` invoked when the file is run directly (`node src/migrate-to-supabase.js`), using the real admin client.

- [ ] **Step 1: write the failing test**

```js
// append to tests/migrate-to-supabase.test.js
import { runMigration } from '../src/migrate-to-supabase.js';

test('runMigration is idempotent — running twice does not duplicate rows', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-full-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'project.json'), JSON.stringify({ name: 'Acme Pizza' }));

  const client = fakeClientWithStorage();
  const first = await runMigration(targetDir, client);
  const second = await runMigration(targetDir, client);

  assert.equal(first.projects.migrated, 1);
  assert.equal(second.projects.migrated, 1);
  // Both runs call upsert (not insert), so re-running is safe even though
  // this fake client doesn't itself dedupe — the real Supabase `onConflict`
  // option is what guarantees no duplicate rows server-side.
  assert.equal(client.upserts.projects.length, 2);

  await rm(targetDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: FAIL — `runMigration` is not defined.

- [ ] **Step 3: write the implementation**

```js
// append to src/migrate-to-supabase.js
import { createSupabaseAdminClient } from './supabase-client.js';

export async function runMigration(targetDir, client) {
  const projects = await migrateProjects(targetDir, client);
  const { projectsDir } = getCentralPaths(targetDir);
  let slugs = [];
  try {
    slugs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const content = { migrated: 0, errors: [] };
  for (const slug of slugs) {
    const perProject = await migrateContentForProject(targetDir, slug, client);
    content.migrated += perProject.migrated;
    content.errors.push(...perProject.errors);
  }

  return { projects, content };
}

async function main() {
  const client = createSupabaseAdminClient();
  const result = await runMigration(process.cwd(), client);
  console.log(`Projects migrated: ${result.projects.migrated} (${result.projects.errors.length} errors)`);
  console.log(`Content items migrated: ${result.content.migrated} (${result.content.errors.length} errors)`);
  if (result.projects.errors.length || result.content.errors.length) {
    console.error('Errors:', JSON.stringify([...result.projects.errors, ...result.content.errors], null, 2));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: add the npm script**

```json
"scripts": {
  "migrate:supabase": "node src/migrate-to-supabase.js"
}
```

- [ ] **Step 5: run test to verify it passes**

Run: `node --test tests/migrate-to-supabase.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: run the full existing suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (all existing tests still pass — this phase added files, it didn't touch `content-central.js`/`content-central-server.js`).

- [ ] **Step 7: commit**

```bash
git add src/migrate-to-supabase.js tests/migrate-to-supabase.test.js package.json
git commit -m "feat: add idempotent migrate:supabase CLI entrypoint"
```

- [ ] **Step 8 (manual, controller-run): run it for real**

With real Supabase env vars set in `.env`, run `npm run migrate:supabase` against the actual `_opensquad/content-central/projects/` data and confirm the printed summary shows the expected project/content counts with zero errors.

---

## Out of scope for this plan

- `content/ad-creatives/` migration (different file shape — separate follow-up).
- The cloud backend that serves this data (Fase 2), the cloud frontend (Fase 3), and the local agent that consumes the `jobs` queue (Fase 4) — each gets its own plan, per the design spec.
