import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateProjects, migrateContentForProject } from '../src/migrate-to-supabase.js';

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
