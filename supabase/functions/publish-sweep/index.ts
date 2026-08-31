// supabase/functions/publish-sweep/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { publishToMeta } from '../_shared/meta-publish.js';
import { buildAlerts, dueAlerts } from '../_shared/alerts.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = DAY_MS;
const FAILED_ITEM_ALERT_WINDOW_DAYS = 7;
const SIGNED_URL_TTL_SECONDS = 300;

Deno.serve(async (req) => {
  // Only the project's own service_role key may call this — same key
  // pg_cron's scheduled call presents (per this plan's Task 5 Step 4).
  // The anon key is public by design, so without this check anyone holding
  // it could trigger a live Instagram publish on demand.
  const authHeader = req.headers.get('Authorization') ?? '';
  const expectedAuth = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let manualContentItemId = null;
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      manualContentItemId = body?.contentItemId || null;
    } catch { /* cron calls with no body — fine */ }
  }

  const publishResult = await runPublishPass(client, manualContentItemId);
  const alertResult = await runAlertPass(client);

  return new Response(JSON.stringify({ ok: true, publish: publishResult, alerts: alertResult }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

async function runPublishPass(client, manualContentItemId) {
  const result = { published: 0, errors: [] };

  let query = client
    .from('content_items')
    .select('id, project_id, channel, copy, media_url, metadata, schedules!inner(id, run_at, status)')
    .eq('status', 'approved')
    .eq('schedules.status', 'pending');

  query = manualContentItemId
    ? query.eq('id', manualContentItemId)
    : query.lte('schedules.run_at', new Date().toISOString());

  const { data: dueItems, error: queryError } = await query;
  if (queryError) {
    result.errors.push({ contentItemId: null, error: `failed to query due items: ${queryError.message}` });
    return result;
  }

  for (const item of dueItems || []) {
    // schedules.content_item_id is UNIQUE, so PostgREST embeds it as a
    // single object, not an array — item.schedules[0] would be undefined.
    const schedule = Array.isArray(item.schedules) ? item.schedules[0] : item.schedules;
    if (!schedule) {
      result.errors.push({ contentItemId: item.id, error: 'no schedule found for item' });
      continue;
    }

    // Atomically claim the schedule before publishing: a single publish can
    // take minutes (Instagram container polling + retries), so with cron
    // firing every 5 minutes a still-in-flight batch could otherwise get
    // selected and published a second time by the next sweep. The
    // conditional .eq('status', 'pending') means only one sweep's UPDATE
    // actually matches the row; a concurrent sweep sees 0 rows claimed.
    // ponytail: a function killed mid-flight (Edge Function timeout) can
    // leave a row stuck at 'running' forever — no stale-claim reset here;
    // add one if that's ever observed in practice.
    const { data: claimed } = await client.from('schedules')
      .update({ status: 'running' })
      .eq('id', schedule.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed?.length) continue; // another sweep already claimed this item

    try {
      await publishOneItem(client, item, schedule, result.errors);
      result.published += 1;
    } catch (err) {
      result.errors.push({ contentItemId: item.id, error: err.message });
      // Merge into the existing metadata (the full original item from the
      // Fase 1 migration lives there) — never replace the whole column, or
      // publishing wipes out contentTopic/generationContext/etc.
      // These are best-effort recovery writes: we're already inside the
      // catch for this item, so a failure here must be recorded, not
      // rethrown (there's no outer catch — rethrowing would crash the
      // whole sweep and skip runAlertPass, same failure mode as Finding 1
      // from the previous review round).
      const { error: itemErrorUpdateError } = await client.from('content_items').update({
        status: 'error',
        metadata: { ...item.metadata, publishError: err.message },
        // content_items has no auto-update trigger for this column — set it
        // explicitly so the alert pass's "recently failed" window measures
        // from the actual failure time, not row-creation time.
        updated_at: new Date().toISOString(),
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

async function publishOneItem(client, item, schedule, errors) {
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, name, instagram_account')
    .eq('id', item.project_id)
    .single();
  if (projectError || !project) throw new Error(`project not found: ${projectError?.message}`);

  const token = await getInstagramToken(client, item.project_id);
  if (!token) throw new Error('no Instagram token configured for this project');

  const { igId, pageId } = { igId: project.instagram_account?.instagramUserId, pageId: project.instagram_account?.pageId };

  // item.media_url is the Storage object path within the content-media
  // bucket (e.g. "boss-pizzaria/boss-pizzaria-2026-08-04-01.png"), not a
  // full URL — set that way by the Fase 1 migration script. createSignedUrl
  // takes that path directly; the bucket is already selected via .from(...).
  const { data: signed, error: signError } = await client.storage
    .from('content-media')
    .createSignedUrl(item.media_url, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) throw new Error(`failed to sign media URL: ${signError?.message}`);

  const publishResult = await publishToMeta({
    channel: item.channel,
    token,
    igId,
    pageId,
    imageUrl: signed.signedUrl,
    caption: item.copy || '',
  });

  // Same merge rule as the error path above — publishResult is added
  // alongside the existing metadata, never replacing it.
  const { error: itemUpdateError } = await client.from('content_items').update({
    status: 'posted',
    metadata: { ...item.metadata, publishResult },
  }).eq('id', item.id);
  // A failed status write here must throw (not be silently swallowed) so
  // it's caught and recorded like any other failure — otherwise the item
  // stays 'approved' and the next cron sweep publishes it AGAIN. Nothing
  // has been persisted as 'posted' yet at this point, so the outer catch's
  // error-metadata rewrite is still safe here.
  if (itemUpdateError) throw new Error(`published but failed to update content_items status: ${itemUpdateError.message}`);

  // The Instagram post AND the content_items 'posted' write have both
  // already succeeded at this point. A schedule-sync failure below must
  // NOT be allowed to throw up into the outer catch — that catch rewrites
  // content_items back to 'error' using the stale pre-publish metadata,
  // which would silently drop the just-written publishResult and mislabel
  // a genuinely-live post as failed (risking a false alert + duplicate
  // re-publish). Record it as its own distinct error instead and leave
  // content_items at 'posted'; the schedule row staying at 'running' is a
  // much safer failure mode.
  const { error: scheduleUpdateError } = await client.from('schedules').update({ status: 'done' }).eq('id', schedule.id);
  if (scheduleUpdateError) {
    errors.push({ contentItemId: item.id, error: `published successfully but failed to update schedule status: ${scheduleUpdateError.message}` });
  }
}

async function getInstagramToken(client, projectId) {
  const { data, error } = await client.rpc('get_instagram_token', { p_project_id: projectId });
  if (error) throw new Error(`failed to read Instagram token: ${error.message}`);
  return data;
}

async function runAlertPass(client) {
  const now = new Date();
  const { data: projects } = await client.from('projects').select('id, name, instagram_token_expires_at');
  // Bound to recently-failed items only — without this, a failed item that
  // never gets fixed alerts forever. Still re-alerts every 24h for
  // genuinely-still-broken recent failures (intended, matches the cooldown
  // design); it just stops alerting on ancient never-cleaned-up failures.
  const failedSince = new Date(now.getTime() - FAILED_ITEM_ALERT_WINDOW_DAYS * DAY_MS).toISOString();
  const { data: failedRaw } = await client
    .from('content_items')
    .select('id, project_id, channel, content_id, metadata, projects!inner(name)')
    .eq('status', 'error')
    .gte('updated_at', failedSince);

  const failedItems = (failedRaw || []).map((row) => ({
    id: row.id,
    project_id: row.project_id,
    project_name: row.projects?.name,
    content_id: row.content_id || row.id,
    channel: row.channel,
    publish_error: row.metadata?.publishError || 'erro desconhecido',
  }));

  const alerts = buildAlerts({ projects: projects || [], failedItems }, now);

  const { data: notifiedRows } = await client.from('alert_notifications').select('key, last_sent_at');
  const notified = Object.fromEntries((notifiedRows || []).map((row) => [row.key, row.last_sent_at]));

  const toSend = dueAlerts(alerts, notified, now, ALERT_COOLDOWN_MS);
  const sent = [];
  const failed = [];
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const recipient = Deno.env.get('OPENSQUAD_ALERTS_EMAIL') || 'juciclei.ger@gmail.com';

  for (const alert of toSend) {
    // No API key means no delivery attempt at all — don't mark it sent
    // (that would burn the 24h cooldown on an alert nobody received), but
    // do surface it as failed so a misconfigured deploy isn't invisible.
    if (!resendApiKey) {
      failed.push({ key: alert.key, status: null });
      continue;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'onboarding@resend.dev', to: recipient, subject: alert.subject, text: alert.body }),
    });
    // Only record as sent when Resend actually accepted it — a 4xx (bad
    // key, unverified sender, or the shared sandbox sender refusing to
    // deliver to a non-account-owner address) must not burn the cooldown
    // on an alert that was never delivered, AND must be visible in the
    // result rather than silently dropped — otherwise a misconfigured
    // sender can make every alert (including "token expired") vanish
    // forever while the sweep keeps reporting nothing's wrong.
    if (!res.ok) {
      failed.push({ key: alert.key, status: res.status });
      continue;
    }

    await client.from('alert_notifications').upsert([{ key: alert.key, last_sent_at: now.toISOString() }], { onConflict: 'key' });
    sent.push(alert.key);
  }

  return { sent, failed };
}
