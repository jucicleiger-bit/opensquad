# Fase 4b: Cloud Remote Art Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trigger the local "Agenda e geração" content-generation wizard from the cloud panel, run it with the exact same local code (`codex-agent`, unchanged), and have the result show up in the cloud panel's Aguardando aprovação automatically.

**Architecture:** A Supabase `jobs` row (`type: 'art_generation'`) created by a new cloud-panel wizard page triggers a new local scheduler (same poll+claim pattern as `startCloudWhatsAppPublishScheduler`). The scheduler runs the existing local functions unchanged (`previewContentSchedulePlan`, `generateContentSchedulePlan`/`generateContentBatch`, `enrichBatchItemsWithRealImages`), then syncs the result to Supabase via the existing `migrateContentForProject` (idempotent upsert). Two job "modes" (`preview`, `generate`) mirror the local wizard's own preview-then-commit flow, since the preview step also needs local-only project state.

**Tech Stack:** Node.js (`node --test`), `@supabase/supabase-js`, React 19 + `react-router-dom` (cloud-panel-app), TypeScript.

## Global Constraints

- `previewContentSchedulePlan`, `generateContentSchedulePlan`, `generateContentBatch`, `enrichBatchItemsWithRealImages`, `migrateContentForProject` are all called **unchanged** — no edits to their internals in any task.
- The image generation provider stays `codex-agent` (confirmed with the operator) — generation still requires the local PC/server to be running; the cloud panel only triggers and displays results, never generates on its own.
- Exactly **one** `art_generation` job is processed per sweep call — `codex exec` is a single session; concurrent generations would mix context between them. The scheduler's own `running` overlap guard (same pattern as every other scheduler in this codebase) means this also holds across ticks.
- Job payload/result convention: `jobs.payload` starts as the request the cloud panel sent and gets **merged** (never replaced) with `plan` (preview mode) or `result` (generate mode) when the agent marks it `done`. `jobs.result_url` is unused for this job type (no single-URL result — the real result is the new `content_items` rows). On failure: `status='error'`, `error_message` set, `payload` untouched.
- The `jobs` table and its RLS policy already exist (`supabase/migrations/0001_init.sql`) — no schema migration in this plan.
- No changes to `publishContentToWhatsAppStatus`, `startCloudWhatsAppPublishScheduler`, `startWhatsAppPublishScheduler`, or `publish-sweep` — this plan only adds alongside them.
- Scope is the main "Agenda e geração" flow only — no ad creatives, carrossel avulso, datas especiais, or segment-template adaptation in this plan (see the spec's Fora de escopo).

---

### Task 1: `runDueArtGenerationJobSweep` — new module + tests

**Depends-on:** none

**Files:**
- Create: `src/cloud-art-generation.js`
- Create: `tests/cloud-art-generation.test.js`

**Interfaces:**
- Produces: `runDueArtGenerationJobSweep(targetDir, client, options = {})` →
  `Promise<{ processed: number, errors: Array<{ jobId: string|null, error: string }> }>`.
  `options.previewPlan(projectSlug, payload, targetDir)`,
  `options.generate(projectSlug, payload, targetDir)` → `{ itemCount }`,
  `options.syncProject(projectSlug, targetDir, client)` → `{ migrated, errors }`
  are all required and injectable (same style as Fase 4a's `whatsappPublisher`)
  — the caller (Task 2) always supplies real implementations.

- [ ] **Step 1: Write the failing tests**

Create `tests/cloud-art-generation.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDueArtGenerationJobSweep } from '../src/cloud-art-generation.js';

function makeAwaitable(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

function fakeClient({ pendingJobs = [], claimable = () => true }) {
  const state = { claimAttempts: [], jobUpdates: [] };
  return {
    state,
    from(table) {
      if (table !== 'jobs') throw new Error(`fakeClient: unhandled table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: (n) => makeAwaitable({ data: pendingJobs.slice(0, n), error: null }),
              }),
            }),
          }),
        }),
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
            state.jobUpdates.push({ id, patch });
            return makeAwaitable({ error: null });
          },
        }),
      };
    },
  };
}

test('runDueArtGenerationJobSweep processes a preview job and records the plan', async () => {
  const job = { id: 'job-1', payload: { mode: 'preview', projectSlug: 'acme-pizza', days: 7, startDate: '2026-09-05' } };
  const client = fakeClient({ pendingJobs: [job] });
  const plan = { projectId: 'acme-pizza', dayPlans: [] };
  const previewPlan = async (slug, payload, targetDir) => {
    assert.equal(slug, 'acme-pizza');
    assert.equal(payload.days, 7);
    assert.equal(targetDir, '/target');
    return plan;
  };
  const generate = async () => { throw new Error('should not be called'); };
  const syncProject = async () => { throw new Error('should not be called'); };

  const result = await runDueArtGenerationJobSweep('/target', client, { previewPlan, generate, syncProject });

  assert.equal(result.processed, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.state.jobUpdates[0].id, 'job-1');
  assert.equal(client.state.jobUpdates[0].patch.status, 'done');
  assert.deepEqual(client.state.jobUpdates[0].patch.payload.plan, plan);
  assert.equal(client.state.jobUpdates[0].patch.payload.mode, 'preview');
});

test('runDueArtGenerationJobSweep processes a generate job and syncs the result', async () => {
  const job = { id: 'job-2', payload: { mode: 'generate', projectSlug: 'acme-pizza', days: 7, startDate: '2026-09-05', approvedPlan: { dayPlans: [] } } };
  const client = fakeClient({ pendingJobs: [job] });
  const generate = async (slug, payload) => {
    assert.equal(slug, 'acme-pizza');
    assert.ok(payload.approvedPlan);
    return { itemCount: 5 };
  };
  const syncProject = async (slug, targetDir, supabaseClient) => {
    assert.equal(slug, 'acme-pizza');
    assert.strictEqual(supabaseClient, client);
    return { migrated: 5, errors: [] };
  };
  const previewPlan = async () => { throw new Error('should not be called'); };

  const result = await runDueArtGenerationJobSweep('/target', client, { previewPlan, generate, syncProject });

  assert.equal(result.processed, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.state.jobUpdates[0].patch.status, 'done');
  assert.deepEqual(client.state.jobUpdates[0].patch.payload.result, { itemCount: 5, syncedCount: 5, errors: [] });
});

test('runDueArtGenerationJobSweep records error status when generation throws', async () => {
  const job = { id: 'job-3', payload: { mode: 'generate', projectSlug: 'acme-pizza', days: 7 } };
  const client = fakeClient({ pendingJobs: [job] });
  const generate = async () => { throw new Error('codex exec failed'); };
  const syncProject = async () => { throw new Error('should not be called'); };
  const previewPlan = async () => { throw new Error('should not be called'); };

  const result = await runDueArtGenerationJobSweep('/target', client, { previewPlan, generate, syncProject });

  assert.equal(result.processed, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /codex exec failed/);
  assert.equal(client.state.jobUpdates[0].patch.status, 'error');
  assert.equal(client.state.jobUpdates[0].patch.error_message, 'codex exec failed');
});

test('runDueArtGenerationJobSweep skips a job another sweep already claimed', async () => {
  const job = { id: 'job-4', payload: { mode: 'preview', projectSlug: 'acme-pizza', days: 7 } };
  const client = fakeClient({ pendingJobs: [job], claimable: () => false });
  let called = false;
  const previewPlan = async () => { called = true; return {}; };
  const generate = async () => ({ itemCount: 0 });
  const syncProject = async () => ({ migrated: 0, errors: [] });

  const result = await runDueArtGenerationJobSweep('/target', client, { previewPlan, generate, syncProject });

  assert.equal(result.processed, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(called, false);
  assert.equal(client.state.jobUpdates.length, 0);
});

test('runDueArtGenerationJobSweep processes at most one job per call', async () => {
  const jobs = [
    { id: 'job-5a', payload: { mode: 'preview', projectSlug: 'acme-pizza', days: 7 } },
    { id: 'job-5b', payload: { mode: 'preview', projectSlug: 'other-project', days: 3 } },
  ];
  const client = fakeClient({ pendingJobs: jobs });
  let callCount = 0;
  const previewPlan = async () => { callCount += 1; return {}; };
  const generate = async () => { throw new Error('should not be called'); };
  const syncProject = async () => { throw new Error('should not be called'); };

  const result = await runDueArtGenerationJobSweep('/target', client, { previewPlan, generate, syncProject });

  assert.equal(result.processed, 1);
  assert.equal(callCount, 1);
  assert.equal(client.state.jobUpdates.length, 1);
  assert.equal(client.state.jobUpdates[0].id, 'job-5a');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/cloud-art-generation.test.js`
Expected: FAIL — `Cannot find module '../src/cloud-art-generation.js'`.

- [ ] **Step 3: Implement `src/cloud-art-generation.js`**

```js
// src/cloud-art-generation.js
//
// Cloud-driven counterpart to the local "Agenda e geração" wizard: reads
// due art_generation jobs from Supabase (created by the cloud panel),
// runs the SAME local generation code unchanged (previewContentSchedulePlan
// / generateContentBatch / generateContentSchedulePlan / codex-agent image
// generation), and syncs the result back to Supabase via
// migrateContentForProject — the cloud panel can only trigger, never
// generate on its own, since generation needs the local codex-agent
// session. Same reasoning as startCloudWhatsAppPublishScheduler.
//
// Processes exactly one job per sweep call — codex exec is one session;
// running two generations concurrently would mix context between them.
export async function runDueArtGenerationJobSweep(targetDir, client, options = {}) {
  const { previewPlan, generate, syncProject } = options;
  const result = { processed: 0, errors: [] };
  if (typeof previewPlan !== 'function' || typeof generate !== 'function' || typeof syncProject !== 'function') {
    return result;
  }

  const { data: jobs, error: queryError } = await client
    .from('jobs')
    .select('id, payload')
    .eq('type', 'art_generation')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);
  if (queryError) {
    result.errors.push({ jobId: null, error: `failed to query due jobs: ${queryError.message}` });
    return result;
  }
  const job = (jobs || [])[0];
  if (!job) return result;

  const { data: claimed } = await client.from('jobs')
    .update({ status: 'running' })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id');
  if (!claimed?.length) return result; // another sweep already claimed this job

  const payload = job.payload || {};
  try {
    if (payload.mode === 'preview') {
      const plan = await previewPlan(payload.projectSlug, payload, targetDir);
      const { error: updateError } = await client.from('jobs').update({
        status: 'done',
        payload: { ...payload, plan },
      }).eq('id', job.id);
      if (updateError) throw new Error(`preview succeeded but failed to record result: ${updateError.message}`);
    } else if (payload.mode === 'generate') {
      const { itemCount } = await generate(payload.projectSlug, payload, targetDir);
      const syncResult = await syncProject(payload.projectSlug, targetDir, client);
      const { error: updateError } = await client.from('jobs').update({
        status: 'done',
        payload: { ...payload, result: { itemCount, syncedCount: syncResult.migrated, errors: syncResult.errors } },
      }).eq('id', job.id);
      if (updateError) throw new Error(`generation succeeded but failed to record result: ${updateError.message}`);
    } else {
      throw new Error(`unknown job mode: ${payload.mode}`);
    }
    result.processed += 1;
  } catch (err) {
    result.errors.push({ jobId: job.id, error: err.message });
    const { error: errorUpdateError } = await client.from('jobs').update({
      status: 'error',
      error_message: err.message,
    }).eq('id', job.id);
    if (errorUpdateError) {
      result.errors.push({ jobId: job.id, error: `failed to record error status: ${errorUpdateError.message}` });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/cloud-art-generation.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/cloud-art-generation.js tests/cloud-art-generation.test.js
git commit -m "feat: cloud-driven art generation job sweep (Supabase jobs, local codex-agent)"
```

---

### Task 2: Wire the scheduler into `content-central-server.js`

**Depends-on:** Task 1 (imports `runDueArtGenerationJobSweep`)

**Files:**
- Modify: `src/content-central.js:5481` (export `loadProject`)
- Modify: `src/content-central-server.js`

**Interfaces:** Consumes `runDueArtGenerationJobSweep` (Task 1),
`createSupabaseAdminClient` (`./supabase-client.js`, already imported by
Fase 4a's whatsapp scheduler — reused, not re-imported), and
`migrateContentForProject` (`./migrate-to-supabase.js`, newly imported
here).

- [ ] **Step 1: Export `loadProject` from `content-central.js`**

`loadProject` exists but is private — this task needs it to load the
project record before calling `enrichBatchItemsWithRealImages` (which
needs the full project object, not just its id). Change:
```js
async function loadProject(paths) {
```
to:
```js
export async function loadProject(paths) {
```
(`src/content-central.js:5481` — no other change to the function body.)

- [ ] **Step 2: Import the newly-needed pieces into `content-central-server.js`**

Add `enrichBatchItemsWithRealImages,` right before the existing
`generateContentBatch,` line, and `loadProject,` right after the existing
`loadOfferTypeLearning,` line, in the big `from './content-central.js'`
import block (both already-adjacent alphabetically to their new
neighbors — no other reordering needed).

Then, near the top of the file (after the existing
`import { runDueCloudWhatsAppPublishSweep } from './cloud-whatsapp-publish.js';`
line from Fase 4a), add:
```js
import { runDueArtGenerationJobSweep } from './cloud-art-generation.js';
import { migrateContentForProject } from './migrate-to-supabase.js';
```
(`createSupabaseAdminClient` is already imported from Fase 4a — reuse it,
don't add a second import line for it.)

- [ ] **Step 3: Add `runCloudArtGeneration` and `startCloudArtGenerationScheduler`**

Immediately after `startCloudWhatsAppPublishScheduler`'s closing `}`
(the function Fase 4a added, right before `startStuckMediaRetryScheduler`'s
comment block), add:

```js
// Composes the same branching the HTTP /generate handler uses (formats
// present -> generateContentSchedulePlan; else -> per-channel
// generateContentBatch loop — see the 'generate' route above), then
// AWAITS the real image generation directly
// (enrichBatchItemsWithRealImages, the same function
// enqueueBatchImageGeneration calls fire-and-forget) instead of firing it
// in the background: this job must not report 'done' until the images
// actually exist, or migrateContentForProject would sync drafts with no
// media_url yet.
async function runCloudArtGeneration(projectSlug, payload, context, targetDir) {
  const paths = getCentralPaths(targetDir, projectSlug);
  const project = await loadProject(paths);
  const imageOptions = {
    imageGenerator: context.imageGenerator,
    imageReviewer: context.imageReviewer,
    captionGenerator: context.captionGenerator,
    videoAnimator: context.videoAnimator,
    carouselOutlineGenerator: context.carouselOutlineGenerator,
    resolveCarouselStyleReference: (slideContent) => resolveExistingGeneratedImagePath(slideContent, projectSlug, targetDir),
  };
  let itemCount = 0;
  if (Array.isArray(payload.formats) && payload.formats.length) {
    const batch = await generateContentSchedulePlan(projectSlug, {
      days: Number(payload.days),
      startDate: payload.startDate,
      formats: payload.formats,
      contentRules: splitRules(payload.contentRules),
      groupIds: Array.isArray(payload.groupIds) ? payload.groupIds : undefined,
      offersOnly: Boolean(payload.offersOnly),
      approvedPlan: payload.approvedPlan,
      topicIdeaGenerator: context.topicIdeaGenerator,
      carouselsPerWeek: payload.carouselsPerWeek,
      maxCarouselSlides: payload.maxCarouselSlides,
    }, targetDir);
    await enrichBatchItemsWithRealImages(batch, project, projectSlug, imageOptions, paths);
    itemCount = batch.items?.length || 0;
  } else {
    const channels = normalizeChannels(payload);
    for (const channel of channels) {
      const batch = await generateContentBatch(projectSlug, {
        days: Number(payload.days),
        startDate: payload.startDate,
        channel,
        contentRules: splitRules(payload.contentRules),
        groupIds: Array.isArray(payload.groupIds) ? payload.groupIds : undefined,
        offersOnly: Boolean(payload.offersOnly),
        topicIdeaGenerator: context.topicIdeaGenerator,
      }, targetDir);
      await enrichBatchItemsWithRealImages(batch, project, projectSlug, imageOptions, paths);
      itemCount += batch.items?.length || 0;
    }
  }
  return { itemCount };
}

// Cloud-driven counterpart to the local "Agenda e geração" wizard's
// generate button — see runCloudArtGeneration above for what it runs.
// Takes `context` (unlike the other schedulers) because it needs the same
// imageGenerator/imageReviewer/captionGenerator/etc. the HTTP /generate
// handler already assembles at server startup.
export function startCloudArtGenerationScheduler(targetDir, context) {
  if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') return null;
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch {
    return null;
  }
  // Shorter interval than the publish schedulers (180000ms default) — a
  // human is waiting for the preview to appear on screen here, not a
  // background cron.
  const intervalMs = Number(process.env.OPENSQUAD_JOB_CHECK_INTERVAL_MS || 15000);
  let running = false;
  const sweep = () => {
    if (running) return;
    running = true;
    runDueArtGenerationJobSweep(targetDir, client, {
      previewPlan: (projectSlug, payload, dir) => previewContentSchedulePlan(projectSlug, {
        days: Number(payload.days),
        startDate: payload.startDate,
        formats: Array.isArray(payload.formats) ? payload.formats : [],
        groupIds: Array.isArray(payload.groupIds) ? payload.groupIds : undefined,
        offersOnly: Boolean(payload.offersOnly),
        topicIdeaGenerator: context.topicIdeaGenerator,
      }, dir),
      generate: (projectSlug, payload, dir) => runCloudArtGeneration(projectSlug, payload, context, dir),
      syncProject: (projectSlug, dir, supabaseClient) => migrateContentForProject(dir, projectSlug, supabaseClient),
    }).catch((err) => console.error('[content-central] cloud art generation sweep failed:', err.message))
      .finally(() => { running = false; });
  };
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}
```

- [ ] **Step 4: Wire into server startup and shutdown**

Change:
```js
  const cloudWhatsAppPublishSchedulerTimer = startCloudWhatsAppPublishScheduler(targetDir);
```
to:
```js
  const cloudWhatsAppPublishSchedulerTimer = startCloudWhatsAppPublishScheduler(targetDir);
  const cloudArtGenerationSchedulerTimer = startCloudArtGenerationScheduler(targetDir, context);
```
(this line is already after `context` is built, same as the whatsapp
scheduler call — `context` is in scope here.)

Change:
```js
      if (cloudWhatsAppPublishSchedulerTimer) clearInterval(cloudWhatsAppPublishSchedulerTimer);
```
to:
```js
      if (cloudWhatsAppPublishSchedulerTimer) clearInterval(cloudWhatsAppPublishSchedulerTimer);
      if (cloudArtGenerationSchedulerTimer) clearInterval(cloudArtGenerationSchedulerTimer);
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS except the 2 pre-existing, unrelated failures already
documented in Fase 4a's ledger (SPA-fallback missing-build-artifact test,
Windows-only EPERM lock-file race) — no new failures.

- [ ] **Step 6: Commit**

```bash
git add src/content-central.js src/content-central-server.js
git commit -m "feat: start the cloud art generation job scheduler alongside the whatsapp one"
```

---

### Task 3: Cloud panel — "Gerar conteúdo" wizard page

**Depends-on:** none (talks to Supabase `jobs` directly, no dependency on
Task 1/2's code being present in this repo checkout to build/typecheck —
disjoint files, safe to build in the same wave as Task 1)

**Files:**
- Create: `cloud-panel-app/src/pages/GenerateContent.tsx`
- Modify: `cloud-panel-app/src/App.tsx`
- Modify: `cloud-panel-app/src/layouts/ProjectWorkspaceLayout.tsx`

**Interfaces:** Reads/writes the `jobs` table directly via the existing
`supabase` client (`@/lib/supabaseClient`) — no new backend HTTP route,
`jobs`' RLS policy is already "any authenticated user" (`0001_init.sql`).

- [ ] **Step 1: Create `GenerateContent.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

const CHANNEL_LABELS: Record<string, string> = {
  instagram_feed: "Feed",
  instagram_story: "Story",
  instagram_reels: "Reels",
  facebook_feed: "FB Feed",
  facebook_story: "FB Story",
  whatsapp_status: "Status (beta)",
};

interface FormatState {
  channel: string;
  enabled: boolean;
  postsPerDay: string;
  everyDays: string;
  startTime: string;
  intervalMinutes: string;
}

// Mirrors content-central-app/src/pages/workspace/GenerateContent.tsx's
// DEFAULT_FORMATS verbatim — same defaults, same channel set, so a
// remote-triggered generation behaves the same as a local one out of the
// box.
const DEFAULT_FORMATS: FormatState[] = [
  { channel: "instagram_story", enabled: true, postsPerDay: "3", everyDays: "1", startTime: "09:00", intervalMinutes: "240" },
  { channel: "instagram_feed", enabled: true, postsPerDay: "1", everyDays: "2", startTime: "12:00", intervalMinutes: "0" },
  { channel: "instagram_reels", enabled: false, postsPerDay: "1", everyDays: "1", startTime: "18:00", intervalMinutes: "0" },
  { channel: "facebook_feed", enabled: false, postsPerDay: "1", everyDays: "2", startTime: "12:00", intervalMinutes: "0" },
  { channel: "facebook_story", enabled: false, postsPerDay: "1", everyDays: "1", startTime: "09:00", intervalMinutes: "240" },
  { channel: "whatsapp_status", enabled: false, postsPerDay: "1", everyDays: "1", startTime: "09:00", intervalMinutes: "0" },
];

interface OfferGroup {
  id: string;
  name: string;
}

interface PlannedContentSlot {
  id: string;
  dayNumber: number;
  date: string;
  scheduledTime: string;
  channel: string;
  channelLabel: string;
  slotNumber: number;
  kind: string;
  source: string;
  label: string;
  offerId?: string | null;
  offerName?: string;
  reason?: string;
  extra?: boolean;
}

interface PlannedContentDay {
  dayNumber: number;
  date: string;
  regular: PlannedContentSlot[];
  extras: PlannedContentSlot[];
}

interface PlannedContentSchedule {
  projectId: string;
  projectName: string;
  startDate: string;
  days: number;
  regularCount: number;
  extraCount: number;
  summary: string;
  dayPlans: PlannedContentDay[];
  rules: { groupIds: string[]; offersOnly: boolean; usesBrandXray: boolean; extraDatesDoNotConsumeDailyQuota: boolean };
}

interface JobResult {
  itemCount: number;
  syncedCount: number;
  errors: Array<{ contentId?: string | null; error: string }>;
}

type Stage = "form" | "waiting-preview" | "preview" | "waiting-generate" | "done" | "error";

interface JobRequestFields {
  projectSlug: string;
  days: number;
  startDate: string;
  formats: Array<Omit<FormatState, "enabled">>;
  contentRules: string;
  groupIds: string[];
  offersOnly: boolean;
  carouselsPerWeek: string;
  maxCarouselSlides: string;
}

export function GenerateContent() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [days, setDays] = useState("7");
  const [startDate, setStartDate] = useState("");
  const [formats, setFormats] = useState<FormatState[]>(DEFAULT_FORMATS);
  const [contentRules, setContentRules] = useState("");
  const [offerGroups, setOfferGroups] = useState<OfferGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [offersOnly, setOffersOnly] = useState(false);
  const [carouselsPerWeek, setCarouselsPerWeek] = useState("0");
  const [maxCarouselSlides, setMaxCarouselSlides] = useState("6");

  const [stage, setStage] = useState<Stage>("form");
  const [plan, setPlan] = useState<PlannedContentSchedule | null>(null);
  const [editedSlots, setEditedSlots] = useState<Record<string, { label: string; reason: string }>>({});
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("projects").select("content_strategy").eq("id", project.id).single().then(({ data }) => {
      const groups = data?.content_strategy?.offerGroups;
      setOfferGroups(Array.isArray(groups) ? groups.map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })) : []);
    });
  }, [project.id]);

  function toggleFormat(channel: string) {
    setFormats((prev) => prev.map((format) => (format.channel === channel ? { ...format, enabled: !format.enabled } : format)));
  }
  function updateFormat(channel: string, field: keyof FormatState, value: string) {
    setFormats((prev) => prev.map((format) => (format.channel === channel ? { ...format, [field]: value } : format)));
  }

  function requestFields(): JobRequestFields {
    return {
      projectSlug: project.slug,
      days: Number(days),
      startDate,
      formats: formats.filter((format) => format.enabled).map(({ channel, postsPerDay, everyDays, startTime, intervalMinutes }) => ({ channel, postsPerDay, everyDays, startTime, intervalMinutes })),
      contentRules,
      groupIds: selectedGroupIds,
      offersOnly,
      carouselsPerWeek,
      maxCarouselSlides,
    };
  }

  async function pollJob(id: string, onDone: (payload: Record<string, unknown>) => void) {
    const { data, error: queryError } = await supabase.from("jobs").select("status, payload, error_message").eq("id", id).single();
    if (queryError) {
      setError(queryError.message);
      setStage("error");
      return;
    }
    if (data.status === "done") {
      onDone(data.payload as Record<string, unknown>);
      return;
    }
    if (data.status === "error") {
      setError(data.error_message || "Falha na geração.");
      setStage("error");
      return;
    }
    setTimeout(() => pollJob(id, onDone), 3000);
  }

  async function submitPreview(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const payload = { mode: "preview", ...requestFields() };
    const { data, error: insertError } = await supabase.from("jobs").insert([{ type: "art_generation", payload }]).select("id").single();
    if (insertError) {
      setError(insertError.message);
      setStage("error");
      return;
    }
    setStage("waiting-preview");
    pollJob(data.id, (donePayload) => {
      setPlan(donePayload.plan as PlannedContentSchedule);
      setEditedSlots({});
      setStage("preview");
    });
  }

  async function approvePlan() {
    if (!plan) return;
    setError(null);
    const approvedPlan = {
      ...plan,
      dayPlans: plan.dayPlans.map((day) => ({
        ...day,
        regular: day.regular.map((slot) => ({ ...slot, ...editedSlots[slot.id] })),
      })),
    };
    const payload = { mode: "generate", ...requestFields(), approvedPlan };
    const { data, error: insertError } = await supabase.from("jobs").insert([{ type: "art_generation", payload }]).select("id").single();
    if (insertError) {
      setError(insertError.message);
      setStage("error");
      return;
    }
    setStage("waiting-generate");
    pollJob(data.id, (donePayload) => {
      setResult(donePayload.result as JobResult);
      setStage("done");
    });
  }

  if (stage === "waiting-preview" || stage === "waiting-generate") {
    return (
      <Card style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 var(--space-sm)" }}>Gerar conteúdo</h2>
        <p className="muted">
          {stage === "waiting-preview" ? "Montando a prévia no seu PC..." : "Gerando o conteúdo no seu PC (pode levar alguns minutos)..."}
        </p>
      </Card>
    );
  }

  if (stage === "error") {
    return (
      <Card style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 var(--space-sm)" }}>Gerar conteúdo</h2>
        <p style={{ color: "var(--bad)" }}>{error}</p>
        <Button variant="secondary" onClick={() => setStage("form")}>Tentar de novo</Button>
      </Card>
    );
  }

  if (stage === "done") {
    return (
      <Card style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 var(--space-sm)" }}>Gerar conteúdo</h2>
        <p>{result?.itemCount ?? 0} peças geradas, {result?.syncedCount ?? 0} sincronizadas.</p>
        {result?.errors?.length ? (
          <ul>
            {result.errors.map((err, index) => <li key={index} className="muted">{err.error}</li>)}
          </ul>
        ) : null}
        <a href={`/projects/${project.id}/aguardando`}>Ver em Aguardando aprovação</a>
      </Card>
    );
  }

  if (stage === "preview" && plan) {
    return (
      <div>
        <h2 style={{ margin: "0 0 var(--space-lg)" }}>Gerar conteúdo — prévia</h2>
        <p className="muted">{plan.summary}</p>
        {plan.dayPlans.map((day) => (
          <Card key={day.dayNumber} style={{ padding: 20, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{day.date}</h3>
            {[...day.regular, ...day.extras].map((slot) => (
              <div key={slot.id} className="field-card" style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="muted">{slot.channelLabel} · {slot.scheduledTime}</div>
                <input
                  type="text"
                  value={editedSlots[slot.id]?.label ?? slot.label}
                  onChange={(e) => setEditedSlots((prev) => ({ ...prev, [slot.id]: { label: e.target.value, reason: prev[slot.id]?.reason ?? slot.reason ?? "" } }))}
                />
                <textarea
                  placeholder="Orientação (opcional)"
                  value={editedSlots[slot.id]?.reason ?? slot.reason ?? ""}
                  onChange={(e) => setEditedSlots((prev) => ({ ...prev, [slot.id]: { label: prev[slot.id]?.label ?? slot.label, reason: e.target.value } }))}
                />
              </div>
            ))}
          </Card>
        ))}
        <div className="button-row">
          <Button onClick={approvePlan}>Aprovar e gerar</Button>
          <Button variant="secondary" onClick={() => setStage("form")}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Gerar conteúdo</h2>
      <Card style={{ padding: 20 }}>
        <form onSubmit={submitPreview} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label>
              Dias
              <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <label>
              Data inicial
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
          </div>

          <div>
            <strong>Formatos</strong>
            {formats.map((format) => (
              <div key={format.channel} className="field-card" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={format.enabled} onChange={() => toggleFormat(format.channel)} />
                  {CHANNEL_LABELS[format.channel] || format.channel}
                </label>
                {format.enabled ? (
                  <>
                    <input type="number" min={1} value={format.postsPerDay} onChange={(e) => updateFormat(format.channel, "postsPerDay", e.target.value)} title="Posts por dia" style={{ width: 60 }} />
                    <input type="number" min={1} value={format.everyDays} onChange={(e) => updateFormat(format.channel, "everyDays", e.target.value)} title="A cada N dias" style={{ width: 60 }} />
                    <input type="time" value={format.startTime} onChange={(e) => updateFormat(format.channel, "startTime", e.target.value)} />
                    <input type="number" min={0} value={format.intervalMinutes} onChange={(e) => updateFormat(format.channel, "intervalMinutes", e.target.value)} title="Intervalo (min)" style={{ width: 70 }} />
                  </>
                ) : null}
              </div>
            ))}
          </div>

          <label>
            Regras de conteúdo
            <textarea value={contentRules} onChange={(e) => setContentRules(e.target.value)} />
          </label>

          {offerGroups.length ? (
            <div>
              <strong>Grupos de oferta</strong>
              {offerGroups.map((group) => (
                <label key={group.id} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={(e) => setSelectedGroupIds((prev) => (e.target.checked ? [...prev, group.id] : prev.filter((id) => id !== group.id)))}
                  />
                  {group.name}
                </label>
              ))}
              <label>
                <input type="checkbox" checked={offersOnly} onChange={(e) => setOffersOnly(e.target.checked)} /> Só ofertas selecionadas (sem posts de autoridade/engajamento)
              </label>
            </div>
          ) : null}

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label>
              Carrosséis por semana
              <input type="number" min={0} value={carouselsPerWeek} onChange={(e) => setCarouselsPerWeek(e.target.value)} />
            </label>
            <label>
              Máx. slides por carrossel
              <input type="number" min={2} max={10} value={maxCarouselSlides} onChange={(e) => setMaxCarouselSlides(e.target.value)} />
            </label>
          </div>

          <Button type="submit">Ver prévia</Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Route**

In `cloud-panel-app/src/App.tsx`, add the import:
```tsx
import { GenerateContent } from "@/pages/GenerateContent";
```
and, inside the `/projects/:projectId` route's children, add:
```tsx
          <Route path="gerar" element={<GenerateContent />} />
```
(anywhere among the existing sibling `<Route>` children — order doesn't matter, React Router matches by path.)

- [ ] **Step 3: Nav entry**

In `cloud-panel-app/src/layouts/ProjectWorkspaceLayout.tsx`, change:
```tsx
  { to: "aguardando", label: "Aguardando aprovação", group: "Conteúdo" },
```
to:
```tsx
  { to: "gerar", label: "Gerar conteúdo", group: "Conteúdo" },
  { to: "aguardando", label: "Aguardando aprovação", group: "Conteúdo" },
```

- [ ] **Step 4: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean, zero errors.

Run: `npx vitest run`
Expected: PASS, same test count as before (this task adds no new test
file — `GenerateContent.tsx` has no injectable seam of its own to unit
test the way the backend module does; its logic is a thin wrapper around
`supabase.from('jobs')` calls, already exercised end-to-end by Task 2's
backend tests via the shared job contract).

- [ ] **Step 5: Commit**

```bash
git add cloud-panel-app/src/pages/GenerateContent.tsx cloud-panel-app/src/App.tsx cloud-panel-app/src/layouts/ProjectWorkspaceLayout.tsx
git commit -m "feat(cloud-panel): add Gerar conteúdo wizard, triggers remote art generation jobs"
```

---

## Post-plan (controller, not a subagent task)

After all 3 tasks land and the final review is clean:

1. Manual end-to-end verification: with the local server running
   (`OPENSQUAD_ENABLE_REAL_PUBLISHING=true`, `SUPABASE_URL`/
   `SUPABASE_SERVICE_ROLE_KEY` set), open the cloud panel's "Gerar
   conteúdo" page for a real project, submit the form, confirm the
   preview appears within ~15s (one scheduler tick), edit a slot, approve,
   confirm generation completes and the new items show up in Aguardando
   aprovação with real `codex-agent`-generated images.
2. Deploy `cloud-panel-app` to Vercel (`npx vercel --yes --prod`).
3. Report to the user; this closes out Fase 4b's core flow. The
   remaining generators (ad creatives, carrossel avulso, datas especiais,
   segment-template adaptation) stay local-only unless a future phase
   picks them up.
