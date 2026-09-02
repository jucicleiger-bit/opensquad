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
