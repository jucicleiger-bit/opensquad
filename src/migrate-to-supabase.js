import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { getCentralPaths, normalizeCompanyProfile, normalizeBrandXray, normalizeBrandBriefing, normalizeProjectOffers, normalizeProjectOfferGroups, normalizeProjectPillars, normalizeProjectReferences, migrateSegmentLearningStoreV1ToV2, normalizeSegmentLearningEntry } from './content-central.js';
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

  const { data: currentRow, error: fetchError } = await client
    .from('projects')
    .select('brand_profile')
    .eq('slug', slug)
    .single();
  if (fetchError) {
    result.errors.push({ slug, error: fetchError.message || String(fetchError) });
    return result;
  }
  const currentBrandProfile = currentRow?.brand_profile && typeof currentRow.brand_profile === 'object' ? currentRow.brand_profile : {};
  const currentReferences = Array.isArray(currentBrandProfile.references) ? currentBrandProfile.references : [];
  const currentById = new Map(currentReferences.map((reference) => [reference.id, reference]));

  const { projectDir } = getCentralPaths(targetDir, slug);
  const localReferences = normalizeProjectReferences(project);
  const seenIds = new Set();
  const merged = [];

  for (const reference of localReferences) {
    seenIds.add(reference.id);
    const existing = currentById.get(reference.id);
    if (existing) {
      // Already migrated before — the cloud copy may have been edited via
      // the References page since, so it wins for every editable field.
      // Only bring in a fresh storagePath if this run actually uploaded
      // one; otherwise keep whatever the cloud copy already has.
      try {
        const storagePath = await uploadReferenceFile(client, projectDir, slug, reference);
        merged.push(storagePath ? { ...existing, storagePath } : existing);
      } catch (err) {
        result.errors.push({ slug, reference: reference.relativePath, error: err.message });
        merged.push(existing);
      }
      continue;
    }
    // New reference the cloud has never seen — bring it in with the
    // normalized local metadata.
    try {
      const storagePath = await uploadReferenceFile(client, projectDir, slug, reference);
      merged.push(storagePath ? { ...reference, storagePath } : reference);
    } catch (err) {
      result.errors.push({ slug, reference: reference.relativePath, error: err.message });
      merged.push(reference);
    }
  }

  // References that exist only in the cloud (added via the References
  // page, never written back to local disk) are preserved untouched.
  for (const reference of currentReferences) {
    if (!seenIds.has(reference.id)) merged.push(reference);
  }

  const { error } = await client
    .from('projects')
    .update({ brand_profile: { ...currentBrandProfile, ...project.brand, references: merged } })
    .eq('slug', slug);
  if (error) {
    result.errors.push({ slug, error: error.message || String(error) });
    return result;
  }

  result.migrated += 1;
  return result;
}

function contentTypeForFilename(filename) {
  const ext = String(filename).split('.').pop()?.toLowerCase() || '';
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  }[ext] || 'application/octet-stream';
}

async function lookUpOwnerId(client) {
  const { data: usersData, error: usersError } = await client.auth.admin.listUsers();
  if (usersError) throw new Error(`failed to look up the owner user: ${usersError.message}`);
  if (!usersData.users.length) throw new Error('no Supabase Auth user exists yet — create the single owner user before migrating');
  return usersData.users[0].id;
}

function toSegmentLearningsV2(stored) {
  if (!stored) return { schemaVersion: 2, nodes: {} };
  if (stored.schemaVersion === 2) return { ...stored, nodes: stored.nodes || {} };
  return migrateSegmentLearningStoreV1ToV2(stored);
}

async function uploadLearningEntryImage(client, root, entry) {
  if (entry.kind !== 'image' || !entry.imagePath) return null;
  const fullPath = join(root, 'assets', 'learning', entry.imagePath);
  if (!existsSync(fullPath)) return null;
  const buffer = await readFile(fullPath);
  const storagePath = `learning/${entry.imagePath}`;
  const { error } = await client.storage.from('content-media').upload(storagePath, buffer, {
    contentType: contentTypeForFilename(entry.imagePath),
    upsert: true,
  });
  if (error) throw new Error(error.message || String(error));
  return storagePath;
}

async function withEntryStoragePaths(client, root, entries, errors) {
  const result = [];
  for (const entry of entries) {
    try {
      const storagePath = await uploadLearningEntryImage(client, root, entry);
      result.push(storagePath ? { ...entry, storagePath } : entry);
    } catch (err) {
      errors.push({ entryId: entry.id, error: err.message });
      result.push(entry);
    }
  }
  return result;
}

export async function migrateGlobalLearning(targetDir, client) {
  const result = { migrated: 0, errors: [] };
  const { root, segmentLearningsPath, offerTypeLearningsPath } = getCentralPaths(targetDir);
  const ownerId = await lookUpOwnerId(client);

  const rawSegmentStore = await readJsonIfExists(segmentLearningsPath);
  const segmentStore = toSegmentLearningsV2(rawSegmentStore);
  const segmentNodes = {};
  for (const [path, node] of Object.entries(segmentStore.nodes)) {
    const entries = (node.entries || []).map(normalizeSegmentLearningEntry);
    segmentNodes[path] = { label: node.label, entries: await withEntryStoragePaths(client, root, entries, result.errors) };
  }

  const rawOfferTypeStore = await readJsonIfExists(offerTypeLearningsPath);
  const offerTypeTypes = {};
  for (const [type, node] of Object.entries(rawOfferTypeStore?.types || {})) {
    const entries = (node.entries || []).map(normalizeSegmentLearningEntry);
    offerTypeTypes[type] = {
      baseInstruction: node.baseInstruction || '',
      entries: await withEntryStoragePaths(client, root, entries, result.errors),
    };
  }

  const { error } = await client
    .from('global_learning')
    .upsert([{
      owner_id: ownerId,
      segment_learnings: { nodes: segmentNodes },
      offer_type_learnings: { types: offerTypeTypes },
    }], { onConflict: 'owner_id' });
  if (error) {
    result.errors.push({ error: error.message || String(error) });
    return result;
  }

  result.migrated += 1;
  return result;
}

export async function migrateSegmentTemplates(targetDir, client) {
  const result = { migrated: 0, errors: [] };
  const { segmentTemplatesDir } = getCentralPaths(targetDir);
  const ownerId = await lookUpOwnerId(client);

  let dirEntries;
  try {
    dirEntries = await readdir(segmentTemplatesDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return result;
    throw err;
  }

  for (const dirEntry of dirEntries) {
    if (!dirEntry.isDirectory()) continue;
    const segmentId = dirEntry.name;
    const templateDir = join(segmentTemplatesDir, segmentId);
    const template = await readJsonIfExists(join(templateDir, 'template.json'));
    if (!template) continue;

    const pieces = [];
    for (const piece of template.pieces || []) {
      try {
        const fullPath = join(templateDir, piece.imagePath);
        let storagePath;
        if (existsSync(fullPath)) {
          const buffer = await readFile(fullPath);
          storagePath = `segment-templates/${segmentId}/${piece.imagePath}`;
          const { error: uploadError } = await client.storage.from('content-media').upload(storagePath, buffer, {
            contentType: contentTypeForFilename(piece.imagePath),
            upsert: true,
          });
          if (uploadError) throw new Error(uploadError.message || String(uploadError));
        }
        pieces.push(storagePath ? { ...piece, storagePath } : piece);
      } catch (err) {
        result.errors.push({ segmentId, piece: piece.key, error: err.message });
        pieces.push(piece);
      }
    }

    const { error } = await client
      .from('segment_templates')
      .upsert([{ owner_id: ownerId, segment_id: segmentId, label: template.label, pieces }], { onConflict: 'owner_id,segment_id' });
    if (error) {
      result.errors.push({ segmentId, error: error.message || String(error) });
      continue;
    }
    result.migrated += 1;
  }

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

  const globalLearning = await migrateGlobalLearning(targetDir, client);
  const segmentTemplates = await migrateSegmentTemplates(targetDir, client);

  return { projects, content, companyBrand, references, globalLearning, segmentTemplates };
}

async function main() {
  const client = createSupabaseAdminClient();
  const result = await runMigration(process.cwd(), client);
  console.log(`Projects migrated: ${result.projects.migrated} (${result.projects.errors.length} errors)`);
  console.log(`Content items migrated: ${result.content.migrated} (${result.content.errors.length} errors)`);
  console.log(`Company/brand data migrated: ${result.companyBrand.migrated} (${result.companyBrand.errors.length} errors)`);
  console.log(`Reference files migrated: ${result.references.migrated} (${result.references.errors.length} errors)`);
  console.log(`Global learning migrated: ${result.globalLearning.migrated} (${result.globalLearning.errors.length} errors)`);
  console.log(`Segment templates migrated: ${result.segmentTemplates.migrated} (${result.segmentTemplates.errors.length} errors)`);
  const allErrors = [...result.projects.errors, ...result.content.errors, ...result.companyBrand.errors, ...result.references.errors, ...result.globalLearning.errors, ...result.segmentTemplates.errors];
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
