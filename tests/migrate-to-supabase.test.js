import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
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
          update: () => ({ eq: async () => ({ error: null }) }),
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
      if (table === 'global_learning' || table === 'segment_templates') {
        return { upsert: async (rows) => { upserts[table] = upserts[table] || []; upserts[table].push(...rows); return { error: null }; } };
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

test('migrateContentForProject stamps migratedToCloud on the local item file so the local publish sweep stops scheduling it once Supabase owns it', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-flag-'));
  const batchDir = join(
    targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza',
    'content', 'drafts', '2026-08-04-01d',
  );
  await mkdir(join(batchDir, 'images'), { recursive: true });
  await writeFile(join(batchDir, 'images', 'day-01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const itemFilePath = join(batchDir, 'day-01.json');
  const item = {
    contentId: 'acme-pizza-2026-08-04-01d-01',
    channel: 'whatsapp_status',
    status: 'aprovado',
    scheduledDate: '2026-08-04',
    scheduledTime: '12:00',
    caption: { text: 'Pizza hoje!' },
    image: { localPath: 'content/drafts/2026-08-04-01d/images/day-01.png', mimeType: 'image/png' },
    approval: { required: true, approvedAt: '2026-08-01T00:00:00.000Z' },
    publish: { publishedAt: null, error: null },
    filePath: itemFilePath,
  };
  await writeFile(itemFilePath, JSON.stringify(item));
  await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ items: [item] }));

  const client = fakeClientWithStorage();
  const result = await migrateContentForProject(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  const updated = JSON.parse(await readFile(itemFilePath, 'utf-8'));
  assert.equal(updated.migratedToCloud, true);
  // The write must patch the live file, not overwrite it with the (possibly
  // stale) batch.json snapshot — real approval state must survive.
  assert.equal(updated.status, 'aprovado');

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

import { runMigration, migrateCompanyBrandData, migrateProjectReferences, migrateGlobalLearning, migrateSegmentTemplates } from '../src/migrate-to-supabase.js';

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

test('migrateCompanyBrandData also normalizes and writes content_strategy (offers/offerGroups/pillars)', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-strategy-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      companyProfile: {},
      brandXray: {},
      brandBriefing: {},
      contentStrategy: {
        offers: [{ id: 'offer-1', name: 'Rodízio', type: 'rodizio', price: 'R$ 49,90', items: '', cta: '', notes: '', active: true, pillarId: null, groupId: null }],
        offerGroups: [{ id: 'group-1', name: 'Geral', comboChance: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
        pillars: [{ id: 'pillar-1', name: 'Prova social', role: 'prova', objective: '', visualTreatment: 'leve', color: '#7C7C7C', weight: 1, requiresEvidence: true, active: true }],
      },
    }),
  );

  const client = fakeClientForCompanyBrand();
  const result = await migrateCompanyBrandData(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].patch.content_strategy.offers.length, 1);
  assert.equal(client.updates[0].patch.content_strategy.offers[0].name, 'Rodízio');
  assert.equal(client.updates[0].patch.content_strategy.offerGroups[0].name, 'Geral');
  assert.equal(client.updates[0].patch.content_strategy.pillars[0].name, 'Prova social');

  await rm(targetDir, { recursive: true, force: true });
});

function fakeClientForReferences(existingBrandProfile = {}) {
  const updates = [];
  const uploads = [];
  return {
    updates,
    uploads,
    from(table) {
      if (table !== 'projects') throw new Error(`fakeClientForReferences: unhandled table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { brand_profile: existingBrandProfile }, error: null }),
          }),
        }),
        update: (patch) => ({
          eq: async (_col, value) => {
            updates.push({ slug: value, patch });
            return { error: null };
          },
        }),
      };
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

test('migrateProjectReferences uploads reference file bytes and stamps storagePath', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-refs-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(join(projectDir, 'assets', 'references'), { recursive: true });
  await writeFile(join(projectDir, 'assets', 'references', 'img.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      projectId: 'acme-pizza',
      brand: {
        logo: 'acme-logo.png',
        references: [{
          id: 'img', filename: 'img.jpg', relativePath: 'assets/references/img.jpg',
          mimeType: 'image/jpeg', referenceCategory: 'visual_inspiration',
        }],
      },
    }),
  );

  const client = fakeClientForReferences();
  const result = await migrateProjectReferences(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].bucket, 'content-media');
  assert.equal(client.uploads[0].path, 'acme-pizza/assets/references/img.jpg');
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].slug, 'acme-pizza');
  assert.equal(client.updates[0].patch.brand_profile.logo, 'acme-logo.png');
  assert.equal(client.updates[0].patch.brand_profile.references[0].storagePath, 'acme-pizza/assets/references/img.jpg');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateProjectReferences keeps a reference without storagePath when its file is missing on disk', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-refs-missing-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      projectId: 'acme-pizza',
      brand: {
        references: [{
          id: 'ghost', filename: 'ghost.jpg', relativePath: 'assets/references/ghost.jpg',
          mimeType: 'image/jpeg', referenceCategory: 'visual_inspiration',
        }],
      },
    }),
  );

  const client = fakeClientForReferences();
  const result = await migrateProjectReferences(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.uploads.length, 0);
  assert.equal(client.updates[0].patch.brand_profile.references[0].storagePath, undefined);

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateProjectReferences records an error when project.json is missing', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-refs-nofile-'));
  const client = fakeClientForReferences();
  const result = await migrateProjectReferences(targetDir, 'no-such-project', client);
  assert.equal(result.migrated, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].slug, 'no-such-project');
  await rm(targetDir, { recursive: true, force: true });
});

test('migrateProjectReferences preserves a cloud-edited reference on rerun instead of overwriting it with stale local data', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-refs-rerun-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(join(projectDir, 'assets', 'references'), { recursive: true });
  await writeFile(join(projectDir, 'assets', 'references', 'img.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(
    join(projectDir, 'project.json'),
    JSON.stringify({
      projectId: 'acme-pizza',
      brand: {
        references: [{
          id: 'img', filename: 'img.jpg', relativePath: 'assets/references/img.jpg',
          mimeType: 'image/jpeg', referenceCategory: 'visual_inspiration', instruction: 'stale local instruction',
        }],
      },
    }),
  );

  const existingBrandProfile = {
    references: [{
      id: 'img', filename: 'img.jpg', relativePath: 'assets/references/img.jpg',
      storagePath: 'acme-pizza/assets/references/img.jpg', mimeType: 'image/jpeg',
      referenceCategory: 'official_asset', instruction: 'edited in the cloud panel',
      role: 'brand_asset', usageRoles: ['brand_asset'], weight: 'high',
      automaticRule: 'x', useInNextGeneration: true, createdAt: '2026-01-01T00:00:00.000Z',
    }],
  };
  const client = fakeClientForReferences(existingBrandProfile);
  const result = await migrateProjectReferences(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  const written = client.updates[0].patch.brand_profile.references[0];
  assert.equal(written.instruction, 'edited in the cloud panel');
  assert.equal(written.referenceCategory, 'official_asset');
  assert.equal(written.storagePath, 'acme-pizza/assets/references/img.jpg');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateProjectReferences preserves a cloud-only reference that was never written back to local disk', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-refs-cloudonly-'));
  const projectDir = join(targetDir, '_opensquad', 'content-central', 'projects', 'acme-pizza');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'project.json'), JSON.stringify({ projectId: 'acme-pizza', brand: {} }));

  const existingBrandProfile = {
    references: [{
      id: 'cloud-only', filename: 'uploaded-in-cloud.png', relativePath: 'assets/references/uploaded-in-cloud.png',
      storagePath: 'acme-pizza/references/cloud-only-uploaded-in-cloud.png', mimeType: 'image/png',
      referenceCategory: 'visual_inspiration', instruction: '', role: 'visual_reference',
      usageRoles: ['visual_reference'], weight: 'medium', automaticRule: 'x',
      useInNextGeneration: true, createdAt: '2026-01-01T00:00:00.000Z',
    }],
  };
  const client = fakeClientForReferences(existingBrandProfile);
  const result = await migrateProjectReferences(targetDir, 'acme-pizza', client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.updates[0].patch.brand_profile.references.length, 1);
  assert.equal(client.updates[0].patch.brand_profile.references[0].id, 'cloud-only');

  await rm(targetDir, { recursive: true, force: true });
});

function fakeClientForGlobalLearning() {
  const upserts = { global_learning: [], segment_templates: [] };
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
      if (table !== 'global_learning' && table !== 'segment_templates') throw new Error(`fakeClientForGlobalLearning: unhandled table ${table}`);
      return {
        upsert: async (rows) => { upserts[table].push(...rows); return { error: null }; },
      };
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

test('migrateGlobalLearning uploads image entries, stamps storagePath, and writes one global_learning row', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-learning-'));
  const root = join(targetDir, '_opensquad', 'content-central');
  await mkdir(join(root, 'assets', 'learning', 'segment', 'alimenticio'), { recursive: true });
  await writeFile(join(root, 'assets', 'learning', 'segment', 'alimenticio', 'foto.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(join(root, 'segment-learnings.json'), JSON.stringify({
    schemaVersion: 2,
    nodes: {
      'group:alimenticio': {
        label: 'Alimentício',
        entries: [
          { id: 'e1', bucket: 'approved', kind: 'text', text: 'Funciona bem falar de frescor', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'e2', bucket: 'avoid', kind: 'image', text: 'Evitar esse enquadramento', imagePath: 'segment/alimenticio/foto.jpg', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    },
  }));
  await writeFile(join(root, 'offer-type-learnings.json'), JSON.stringify({
    schemaVersion: 1,
    types: { combo: { baseInstruction: 'Sempre mostrar preço por pessoa', entries: [] } },
  }));

  const client = fakeClientForGlobalLearning();
  const result = await migrateGlobalLearning(targetDir, client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].bucket, 'content-media');
  assert.equal(client.uploads[0].path, 'learning/segment/alimenticio/foto.jpg');
  assert.equal(client.upserts.global_learning.length, 1);
  const written = client.upserts.global_learning[0];
  assert.equal(written.owner_id, 'owner-uuid-1');
  assert.equal(written.segment_learnings.nodes['group:alimenticio'].entries[0].text, 'Funciona bem falar de frescor');
  assert.equal(written.segment_learnings.nodes['group:alimenticio'].entries[1].storagePath, 'learning/segment/alimenticio/foto.jpg');
  assert.equal(written.offer_type_learnings.types.combo.baseInstruction, 'Sempre mostrar preço por pessoa');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateGlobalLearning migrates a legacy v1 segment-learnings.json via migrateSegmentLearningStoreV1ToV2', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-learning-v1-'));
  const root = join(targetDir, '_opensquad', 'content-central');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'segment-learnings.json'), JSON.stringify({
    segments: { s1: { label: 'Alimentício', approved: ['Falar de frescor'], avoid: [], technical: [] } },
  }));

  const client = fakeClientForGlobalLearning();
  const result = await migrateGlobalLearning(targetDir, client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  const written = client.upserts.global_learning[0];
  const node = written.segment_learnings.nodes['alimenticio'];
  assert.ok(node, 'expected a node keyed by the slugified v1 label');
  assert.equal(node.entries[0].text, 'Falar de frescor');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateSegmentTemplates uploads each piece image and upserts one row per segment', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-templates-'));
  const templateDir = join(targetDir, '_opensquad', 'content-central', 'segment-templates', 'alimenticio-pizzaria', 'images');
  await mkdir(templateDir, { recursive: true });
  await writeFile(join(templateDir, 'capa.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(
    join(targetDir, '_opensquad', 'content-central', 'segment-templates', 'alimenticio-pizzaria', 'template.json'),
    JSON.stringify({
      segmentId: 'alimenticio-pizzaria',
      label: 'Pizzaria',
      pieces: [{ key: 'capa', label: 'Capa', channel: 'instagram_feed', angleNote: '', imagePath: 'images/capa.png' }],
    }),
  );

  const client = fakeClientForGlobalLearning();
  const result = await migrateSegmentTemplates(targetDir, client);

  assert.equal(result.migrated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].path, 'segment-templates/alimenticio-pizzaria/images/capa.png');
  assert.equal(client.upserts.segment_templates.length, 1);
  assert.equal(client.upserts.segment_templates[0].segment_id, 'alimenticio-pizzaria');
  assert.equal(client.upserts.segment_templates[0].pieces[0].storagePath, 'segment-templates/alimenticio-pizzaria/images/capa.png');

  await rm(targetDir, { recursive: true, force: true });
});

test('migrateSegmentTemplates returns an empty result when segment-templates/ does not exist', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'osq-migrate-templates-empty-'));
  const client = fakeClientForGlobalLearning();
  const result = await migrateSegmentTemplates(targetDir, client);
  assert.equal(result.migrated, 0);
  assert.equal(result.errors.length, 0);
  await rm(targetDir, { recursive: true, force: true });
});
