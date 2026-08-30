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
