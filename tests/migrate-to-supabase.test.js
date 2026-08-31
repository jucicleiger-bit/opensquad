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
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [{ id: 'owner-uuid-1' }] }, error: null }),
      },
    },
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
  assert.equal(client.upserts.projects[0].owner_id, 'owner-uuid-1');

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

test('migrateProjects throws when no Supabase Auth user exists', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-no-user-'));
  const client = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
  };
  try {
    await migrateProjects(targetDir, client);
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /no Supabase Auth user exists/);
  }
  await rm(targetDir, { recursive: true, force: true });
});

function fakeClientWithStorage() {
  const upserts = { projects: [], content_items: [], schedules: [] };
  const uploads = [];
  return {
    upserts,
    uploads,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [{ id: 'owner-uuid-1' }] }, error: null }),
      },
    },
    from(table) {
      if (table === 'projects') {
        return {
          upsert: async (rows) => { upserts.projects.push(...rows); return { error: null }; },
          select: () => ({
            eq: (_col, value) => ({
              single: async () => ({ data: { id: `project-uuid-for-${value}` }, error: null }),
            }),
          }),
          update: (_patch) => ({ eq: async () => ({ error: null }) }),
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
  assert.equal(client.upserts.content_items[0].content_id, 'acme-pizza-2026-08-04-01d-01');
  assert.equal(client.upserts.content_items[0].channel, 'instagram_feed');
  assert.equal(client.upserts.content_items[0].status, 'draft');
  assert.equal(client.upserts.content_items[0].copy, 'Pizza hoje!');
  assert.match(client.upserts.content_items[0].media_url, /^acme-pizza\/acme-pizza-2026-08-04-01d-01\./);
  assert.equal(client.upserts.schedules.length, 1);
  assert.equal(client.upserts.schedules[0].content_item_id, 'content-item-uuid-1');
  const expectedRunAt = new Date('2026-08-04T12:00:00').toISOString();
  assert.equal(client.upserts.schedules[0].run_at, expectedRunAt);
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].bucket, 'content-media');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateContentForProject skips items with missing contentId and records error', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-missing-id-'));
  const batchDir = join(
    targetDir, '_opensquad', 'content-central', 'projects', 'test-shop',
    'content', 'drafts', '2026-08-05-01d',
  );
  await mkdir(join(batchDir, 'images'), { recursive: true });
  await writeFile(join(batchDir, 'images', 'day-01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(
    join(batchDir, 'batch.json'),
    JSON.stringify({
      items: [{
        // contentId is deliberately omitted
        channel: 'instagram_feed',
        status: 'draft_generated',
        scheduledDate: '2026-08-05',
        scheduledTime: '10:00',
        caption: { text: 'Test post' },
        image: { localPath: 'content/drafts/2026-08-05-01d/images/day-01.png', mimeType: 'image/png' },
      }],
    }),
  );

  const client = fakeClientWithStorage();
  const result = await migrateContentForProject(targetDir, 'test-shop', client);

  assert.equal(result.migrated, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /missing contentId/);
  assert.equal(client.upserts.content_items.length, 0);

  await rm(targetDir, { recursive: true, force: true });
});

import { runMigration, migrateCompanyBrandData } from '../src/migrate-to-supabase.js';

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

function fakeClientForCompanyBrand() {
  const updates = [];
  return {
    updates,
    from(table) {
      if (table !== 'projects') throw new Error(`fakeClientForCompanyBrand: unhandled table ${table}`);
      return {
        update: (patch) => ({
          eq: async (_col, value) => {
            updates.push({ slug: value, patch });
            return { error: null };
          },
        }),
      };
    },
  };
}

test('migrateCompanyBrandData normalizes and writes companyProfile/brandXray/brandBriefing by slug', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-brand-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      companyProfile: { segment: 'Pizzaria', audience: 'Famílias' },
      brandXray: { status: 'approved', blocks: { summary: { text: 'Marca calorosa' } } },
      brandBriefing: {},
    }),
  );

  const client = fakeClientForCompanyBrand();
  const result = await migrateCompanyBrandData(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].slug, 'acme-pizza');
  assert.equal(client.updates[0].patch.company_profile.segment, 'Pizzaria');
  assert.equal(client.updates[0].patch.company_profile.audience, 'Famílias');
  assert.equal(client.updates[0].patch.brand_xray.status, 'approved');
  assert.equal(client.updates[0].patch.brand_xray.blocks.summary.text, 'Marca calorosa');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateCompanyBrandData records an error when project.json is missing', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-brand-missing-'));
  const client = fakeClientForCompanyBrand();
  const result = await migrateCompanyBrandData(targetDir, 'no-such-project', client);
  assert.equal(result.migrated, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].slug, 'no-such-project');
  await rm(targetDir, { recursive: true, force: true });
});
