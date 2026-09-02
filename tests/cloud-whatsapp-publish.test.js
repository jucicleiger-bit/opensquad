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
