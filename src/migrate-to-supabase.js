import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
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
  const iso = new Date(`${item.scheduledDate}T${time}:00Z`);
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
          const mediaUrl = await uploadItemMedia(client, projectDir, slug, item);
          const { data: insertedItem, error: itemError } = await client
            .from('content_items')
            .upsert([{
              project_id: projectRow.id,
              channel: item.channel,
              status,
              copy: item.caption?.text || null,
              media_url: mediaUrl,
              metadata: item,
            }])
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
            }]);
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
