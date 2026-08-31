import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { getCentralPaths, normalizeCompanyProfile, normalizeBrandXray, normalizeBrandBriefing, normalizeProjectOffers, normalizeProjectOfferGroups, normalizeProjectPillars, normalizeProjectReferences } from './content-central.js';
import { createSupabaseAdminClient } from './supabase-client.js';

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

  // Fetch the single owner user from auth
  const { data: usersData, error: usersError } = await client.auth.admin.listUsers();
  if (usersError) throw new Error(`failed to look up the owner user: ${usersError.message}`);
  if (!usersData.users.length) throw new Error('no Supabase Auth user exists yet — create the single owner user before migrating');
  const ownerId = usersData.users[0].id;

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
          owner_id: ownerId,
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
  const iso = new Date(`${item.scheduledDate}T${time}:00`);
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
  // A compression failure (corrupt/unrecognized bytes) falls back to the
  // original buffer rather than losing the whole item over a thumbnail.
  if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
    try {
      buffer = await sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).toBuffer();
    } catch (err) {
      console.warn(`sharp failed to compress ${item.contentId}, uploading original: ${err.message}`);
    }
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
      let batch;
      try {
        batch = await readJsonIfExists(batchFile);
      } catch (err) {
        result.errors.push({ contentId: null, error: `failed to read ${batchFile}: ${err.message}` });
        continue;
      }
      if (!batch?.items?.length) continue;

      for (const item of batch.items) {
        try {
          if (!item.contentId) {
            result.errors.push({ contentId: null, error: `missing contentId in batch ${batchFile}` });
            continue;
          }
          const mediaUrl = await uploadItemMedia(client, projectDir, slug, item);
          const { data: insertedItem, error: itemError } = await client
            .from('content_items')
            .upsert([{
              project_id: projectRow.id,
              content_id: item.contentId,
              channel: item.channel,
              status,
              copy: item.caption?.text || null,
              media_url: mediaUrl,
              metadata: item,
            }], { onConflict: 'project_id,content_id' })
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
            }], { onConflict: 'content_item_id' });
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

export async function migrateCompanyBrandData(targetDir, slug, client) {
  const result = { migrated: 0, errors: [] };
  const { projectsDir } = getCentralPaths(targetDir);
  const project = await readJsonIfExists(join(projectsDir, slug, 'project.json'));
  if (!project) {
    result.errors.push({ slug, error: 'project.json not found' });
    return result;
  }

  const { error } = await client
    .from('projects')
    .update({
      company_profile: normalizeCompanyProfile(project.companyProfile),
      brand_xray: normalizeBrandXray(project.brandXray),
      brand_briefing: normalizeBrandBriefing(project.brandBriefing),
      content_strategy: {
        offers: normalizeProjectOffers(project.contentStrategy?.offers),
        offerGroups: normalizeProjectOfferGroups(project.contentStrategy?.offerGroups),
        pillars: normalizeProjectPillars(project.contentStrategy?.pillars),
      },
    })
    .eq('slug', slug);
  if (error) {
    result.errors.push({ slug, error: error.message || String(error) });
    return result;
  }

  result.migrated += 1;
  return result;
}

async function uploadReferenceFile(client, projectDir, slug, reference) {
  const fullPath = join(projectDir, reference.relativePath);
  if (!existsSync(fullPath)) return null;

  const buffer = await readFile(fullPath);
  const storagePath = `${slug}/${reference.relativePath}`;
  const { error } = await client.storage.from('content-media').upload(storagePath, buffer, {
    contentType: reference.mimeType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(error.message || String(error));
  return storagePath;
}

export async function migrateProjectReferences(targetDir, slug, client) {
  const result = { migrated: 0, errors: [] };
  const { projectsDir } = getCentralPaths(targetDir);
  const project = await readJsonIfExists(join(projectsDir, slug, 'project.json'));
  if (!project) {
    result.errors.push({ slug, error: 'project.json not found' });
    return result;
  }

  const { projectDir } = getCentralPaths(targetDir, slug);
  const references = normalizeProjectReferences(project);
  const withStorage = [];
  for (const reference of references) {
    try {
      const storagePath = await uploadReferenceFile(client, projectDir, slug, reference);
      withStorage.push(storagePath ? { ...reference, storagePath } : reference);
    } catch (err) {
      result.errors.push({ slug, reference: reference.relativePath, error: err.message });
      withStorage.push(reference);
    }
  }

  const { error } = await client
    .from('projects')
    .update({ brand_profile: { ...project.brand, references: withStorage } })
    .eq('slug', slug);
  if (error) {
    result.errors.push({ slug, error: error.message || String(error) });
    return result;
  }

  result.migrated += 1;
  return result;
}

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
  const companyBrand = { migrated: 0, errors: [] };
  const references = { migrated: 0, errors: [] };
  for (const slug of slugs) {
    const perProject = await migrateContentForProject(targetDir, slug, client);
    content.migrated += perProject.migrated;
    content.errors.push(...perProject.errors);

    const perProjectBrand = await migrateCompanyBrandData(targetDir, slug, client);
    companyBrand.migrated += perProjectBrand.migrated;
    companyBrand.errors.push(...perProjectBrand.errors);

    const perProjectReferences = await migrateProjectReferences(targetDir, slug, client);
    references.migrated += perProjectReferences.migrated;
    references.errors.push(...perProjectReferences.errors);
  }

  return { projects, content, companyBrand, references };
}

async function main() {
  const client = createSupabaseAdminClient();
  const result = await runMigration(process.cwd(), client);
  console.log(`Projects migrated: ${result.projects.migrated} (${result.projects.errors.length} errors)`);
  console.log(`Content items migrated: ${result.content.migrated} (${result.content.errors.length} errors)`);
  console.log(`Company/brand data migrated: ${result.companyBrand.migrated} (${result.companyBrand.errors.length} errors)`);
  console.log(`Reference files migrated: ${result.references.migrated} (${result.references.errors.length} errors)`);
  const allErrors = [...result.projects.errors, ...result.content.errors, ...result.companyBrand.errors, ...result.references.errors];
  if (allErrors.length) {
    console.error('Errors:', JSON.stringify(allErrors, null, 2));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
