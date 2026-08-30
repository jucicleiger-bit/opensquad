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
