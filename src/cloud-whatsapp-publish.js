// src/cloud-whatsapp-publish.js
//
// Cloud-aware counterpart to runDuePublishSweep's whatsapp_status path:
// that one only ever reads local project.json content/schedules. Content
// approved from the cloud panel (Approval.tsx) lives in Supabase instead —
// this reads due whatsapp_status items directly from there, resolves the
// project's local WAHA session from project.json (never migrated, stays
// 100% local by design), and calls the existing, unmodified
// publishContentToWhatsAppStatus. Mirrors publish-sweep/index.ts's query
// shape, atomic claim, and status/metadata write convention exactly, so
// the two sweeps (Meta via publish-sweep, WhatsApp via this) stay
// consistent for anything reading content_items/schedules downstream.
import { readFile } from 'node:fs/promises';
import { getCentralPaths } from './content-central.js';

const SIGNED_URL_TTL_SECONDS = 300;

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function runDueCloudWhatsAppPublishSweep(targetDir, client, options = {}) {
  const now = options.now || new Date();
  const whatsappPublisher = options.whatsappPublisher;
  const result = { published: 0, errors: [] };
  if (typeof whatsappPublisher !== 'function') return result;

  const { data: dueItems, error: queryError } = await client
    .from('content_items')
    .select('id, project_id, channel, copy, media_url, metadata, schedules!inner(id, run_at, status)')
    .eq('channel', 'whatsapp_status')
    .eq('status', 'approved')
    .eq('schedules.status', 'pending')
    .lte('schedules.run_at', now.toISOString());
  if (queryError) {
    result.errors.push({ contentItemId: null, error: `failed to query due items: ${queryError.message}` });
    return result;
  }

  for (const item of dueItems || []) {
    // schedules.content_item_id is UNIQUE, so PostgREST embeds it as a
    // single object, not an array — same as publish-sweep/index.ts.
    const schedule = Array.isArray(item.schedules) ? item.schedules[0] : item.schedules;
    if (!schedule) {
      result.errors.push({ contentItemId: item.id, error: 'no schedule found for item' });
      continue;
    }

    const { data: claimed } = await client.from('schedules')
      .update({ status: 'running' })
      .eq('id', schedule.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed?.length) continue; // another sweep already claimed this item

    try {
      await publishOneCloudWhatsAppItem(client, item, schedule, targetDir, whatsappPublisher, result.errors);
      result.published += 1;
    } catch (err) {
      result.errors.push({ contentItemId: item.id, error: err.message });
      const { error: itemErrorUpdateError } = await client.from('content_items').update({
        status: 'error',
        metadata: { ...item.metadata, publishError: err.message },
      }).eq('id', item.id);
      if (itemErrorUpdateError) {
        result.errors.push({ contentItemId: item.id, error: `failed to record error status on content_items: ${itemErrorUpdateError.message}` });
      }
      const { error: scheduleErrorUpdateError } = await client.from('schedules').update({ status: 'error' }).eq('id', schedule.id);
      if (scheduleErrorUpdateError) {
        result.errors.push({ contentItemId: item.id, error: `failed to record error status on schedules: ${scheduleErrorUpdateError.message}` });
      }
    }
  }

  return result;
}

async function publishOneCloudWhatsAppItem(client, item, schedule, targetDir, whatsappPublisher, errors) {
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, slug')
    .eq('id', item.project_id)
    .single();
  if (projectError || !project) throw new Error(`project not found: ${projectError?.message}`);

  // WAHA session lives only in project.json, never migrated to Supabase —
  // checked here, before generating a signed URL, so a project with no
  // session configured fails fast instead of wasting a signed-URL call.
  // Same message publishContentToWhatsAppStatus itself would throw
  // internally if it got this far with an empty whatsapp block.
  const { projectPath } = getCentralPaths(targetDir, project.slug);
  const localProject = await readJsonIfExists(projectPath);
  const sessionName = localProject?.whatsapp?.sessionName;
  if (!sessionName) {
    throw new Error('Sessão WAHA não configurada para este projeto — configure na aba "Conta e token".');
  }

  const { data: signed, error: signError } = await client.storage
    .from('content-media')
    .createSignedUrl(item.media_url, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) throw new Error(`failed to sign media URL: ${signError?.message}`);

  const publishResult = await whatsappPublisher({
    content: { caption: { text: item.copy || '' }, publish: { mediaUrl: signed.signedUrl } },
    project: { projectId: project.slug, whatsapp: { sessionName } },
  });

  const { error: itemUpdateError } = await client.from('content_items').update({
    status: 'posted',
    metadata: { ...item.metadata, publishResult },
  }).eq('id', item.id);
  if (itemUpdateError) throw new Error(`published but failed to update content_items status: ${itemUpdateError.message}`);

  // Publish + content_items write both already succeeded — a schedule-sync
  // failure here must not throw up into the outer catch (which would
  // rewrite content_items back to 'error' using stale metadata, mislabeling
  // a genuinely-live post as failed). Push onto the caller's errors array
  // instead and leave content_items at 'posted'; the schedule row staying
  // at 'running' is the much safer failure mode — publish-sweep/index.ts
  // uses this exact same reasoning for its own 'done' write.
  const { error: scheduleUpdateError } = await client.from('schedules').update({ status: 'done' }).eq('id', schedule.id);
  if (scheduleUpdateError) {
    errors.push({ contentItemId: item.id, error: `published successfully but failed to update schedule status: ${scheduleUpdateError.message}` });
  }
}
