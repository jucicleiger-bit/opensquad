// src/cloud-art-generation.js
//
// Cloud-driven counterpart to the local "Agenda e geração" wizard: reads
// due art_generation jobs from Supabase (created by the cloud panel),
// runs the SAME local generation code unchanged (previewContentSchedulePlan
// / generateContentBatch / generateContentSchedulePlan / codex-agent image
// generation), and syncs the result back to Supabase via
// migrateContentForProject — the cloud panel can only trigger, never
// generate on its own, since generation needs the local codex-agent
// session. Same reasoning as startCloudWhatsAppPublishScheduler.
//
// Processes exactly one job per sweep call — codex exec is one session;
// running two generations concurrently would mix context between them.
export async function runDueArtGenerationJobSweep(targetDir, client, options = {}) {
  const { previewPlan, generate, syncProject } = options;
  const result = { processed: 0, errors: [] };
  if (typeof previewPlan !== 'function' || typeof generate !== 'function' || typeof syncProject !== 'function') {
    return result;
  }

  const { data: jobs, error: queryError } = await client
    .from('jobs')
    .select('id, payload')
    .eq('type', 'art_generation')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);
  if (queryError) {
    result.errors.push({ jobId: null, error: `failed to query due jobs: ${queryError.message}` });
    return result;
  }
  const job = (jobs || [])[0];
  if (!job) return result;

  const { data: claimed } = await client.from('jobs')
    .update({ status: 'running' })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id');
  if (!claimed?.length) return result; // another sweep already claimed this job

  const payload = job.payload || {};
  try {
    if (payload.mode === 'preview') {
      const plan = await previewPlan(payload.projectSlug, payload, targetDir);
      const { error: updateError } = await client.from('jobs').update({
        status: 'done',
        payload: { ...payload, plan },
      }).eq('id', job.id);
      if (updateError) throw new Error(`preview succeeded but failed to record result: ${updateError.message}`);
    } else if (payload.mode === 'generate') {
      const { itemCount } = await generate(payload.projectSlug, payload, targetDir);
      const syncResult = await syncProject(payload.projectSlug, targetDir, client);
      const { error: updateError } = await client.from('jobs').update({
        status: 'done',
        payload: { ...payload, result: { itemCount, syncedCount: syncResult.migrated, errors: syncResult.errors } },
      }).eq('id', job.id);
      if (updateError) throw new Error(`generation succeeded but failed to record result: ${updateError.message}`);
    } else {
      throw new Error(`unknown job mode: ${payload.mode}`);
    }
    result.processed += 1;
  } catch (err) {
    result.errors.push({ jobId: job.id, error: err.message });
    const { error: errorUpdateError } = await client.from('jobs').update({
      status: 'error',
      error_message: err.message,
    }).eq('id', job.id);
    if (errorUpdateError) {
      result.errors.push({ jobId: job.id, error: `failed to record error status: ${errorUpdateError.message}` });
    }
  }

  return result;
}
