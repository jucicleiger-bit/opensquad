// supabase/functions/_shared/gaveta-dispatch.js
//
// Decides whether the gaveta-dispatch Edge Function should fire the
// opensquad-gaveta "Publish due posts" workflow right now. GitHub's own
// `schedule` cron on that workflow was seen firing only every 4-6h instead
// of hourly (2026-09-28), so posts went out hours late; pg_cron calls this
// every minute instead and only spends an Actions run when a post is due.
// Due rules mirror findDueItems in the gaveta repo's scripts/publish-due.js.
// Zero Deno-specific APIs — same portability rule as meta-publish.js.

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_GAP_MS = 20 * 60 * 1000;

// ponytail: fixed -03:00 (Brazil dropped DST in 2019); switch to an
// Intl-based zone lookup if a client outside São Paulo's offset shows up.
function dueAt(item) {
  if (!item.scheduledDate) return null;
  const at = new Date(`${item.scheduledDate}T${item.scheduledTime || '00:00'}:00-03:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

function isDue(item, now) {
  if (item.status && item.status !== 'aprovado') return false;
  if (item.publish?.realPublished) return false;
  if (!String(item.mediaUrl || '').trim()) return false;
  const at = dueAt(item);
  return Boolean(at && at <= now && now - at <= DAY_MS);
}

export function shouldDispatch({ items, latestRun, now = new Date() }) {
  const due = items.filter((item) => isDue(item, now));
  if (!due.length) return false;
  if (!latestRun) return true;
  // The workflow's concurrency group would just queue a second run behind it.
  if (latestRun.status !== 'completed') return false;
  // A failed run may have posted without saving realPublished (e.g. the
  // push lost) — firing again every minute could repost it over and over.
  // The workflow's own hourly cron still retries; once it succeeds this resumes.
  if (latestRun.conclusion === 'failure') return false;
  const lastRunAt = new Date(latestRun.created_at);
  // An item that became due after the last run started hasn't been tried yet.
  if (due.some((item) => dueAt(item) > lastRunAt)) return true;
  // Otherwise it was tried (transient Meta error) or is backlog behind the
  // one-slot-per-run rule — retry, but not every minute.
  return now - lastRunAt >= RETRY_GAP_MS;
}
