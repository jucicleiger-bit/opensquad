import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getCentralPaths,
  localDateKey,
  localMonthKey,
  previousMonthKey,
  readJson,
  readProjectToken,
  writeJson,
} from './content-central.js';

const GRAPH_URL = 'https://graph.facebook.com/v25.0';
// The Graph API refuses more than 30 days between since and until.
const WINDOW_SECONDS = 30 * 86400;
const MEDIA_KINDS = { FEED: 'feed', REELS: 'reels' };

export const INSIGHTS_PERMISSION = 'instagram_manage_insights';

// Months whose numbers may still change: the current one, and the previous
// one through day 3 (Meta delivers numbers up to 48 hours late). After that
// a closed month is never rewritten, so its report always reads the same.
export function openMonths(now) {
  const current = localMonthKey(now);
  return now.getDate() <= 3 ? [current, previousMonthKey(current)] : [current];
}

export async function loadProjectMetrics(projectId, targetDir = process.cwd()) {
  const stored = await readJson(getCentralPaths(targetDir, projectId).metricsPath, null);
  return { schemaVersion: 1, followers: {}, media: {}, months: {}, lastDailyRun: null, ...(stored || {}) };
}

async function graphGet(path, params, { token, fetchImpl }) {
  const url = new URL(`${GRAPH_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set('access_token', token);
  const response = await fetchImpl(url);
  const body = await response.json();
  if (!response.ok || body?.error) {
    throw Object.assign(new Error(body?.error?.message || `Graph API respondeu ${response.status}`), { code: body?.error?.code });
  }
  return body;
}

// Media insights answer { values: [{ value }] }; account insights asked with
// metric_type=total_value answer { total_value: { value } }.
function insightValues(body) {
  const values = {};
  for (const entry of body?.data || []) {
    const value = entry.total_value?.value ?? entry.values?.[0]?.value;
    if (Number.isFinite(value)) values[entry.name] = value;
  }
  return values;
}

async function fetchAccountMonth(igUserId, month, now, context) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = Math.floor(new Date(year, monthNumber - 1, 1).getTime() / 1000);
  const end = Math.min(Math.floor(new Date(year, monthNumber, 1).getTime() / 1000), Math.floor(now.getTime() / 1000));
  const total = async (metric, since, until) => insightValues(await graphGet(`${igUserId}/insights`, {
    metric, period: 'day', metric_type: 'total_value', since, until,
  }, context))[metric] ?? 0;

  // views adds up across windows. reach counts unique accounts and cannot be
  // summed, so it is asked once, for the last 30 days of the month.
  let views = 0;
  for (let since = start; since < end; since += WINDOW_SECONDS) {
    views += await total('views', since, Math.min(since + WINDOW_SECONDS, end));
  }
  const reach = await total('reach', Math.max(start, end - WINDOW_SECONDS), end);
  return { views, reach };
}

export async function collectProjectMetrics(projectId, targetDir = process.cwd(), { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await readJson(paths.projectPath, null);
  const igUserId = project?.instagram?.instagramUserId;
  const token = project ? await readProjectToken(projectId, targetDir) : null;
  if (!igUserId || !token) return { skipped: true, errors: [] };

  const insights = (project.token?.permissions || []).includes(INSIGHTS_PERMISSION);
  const metrics = await loadProjectMetrics(projectId, targetDir);
  const context = { token, fetchImpl };
  const stamp = now.toISOString();
  const errors = [];
  // One failed call must not cost the others their numbers.
  const attempt = async (label, fn) => {
    try {
      await fn();
      return true;
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
      return false;
    }
  };

  // Stories come straight from the account, not from the local items: Meta
  // only answers while a story is live (24h), and waiting for the gaveta
  // publish result to sync back could miss that window.
  if (insights) {
    await attempt('stories', async () => {
      const live = await graphGet(`${igUserId}/stories`, { fields: 'id,timestamp' }, context);
      for (const story of live.data || []) {
        try {
          const values = insightValues(await graphGet(`${story.id}/insights`, { metric: 'views,reach,replies' }, context));
          metrics.media[story.id] = {
            ...metrics.media[story.id], kind: 'story', ...(story.timestamp ? { postedAt: story.timestamp } : {}), ...values, updatedAt: stamp,
          };
        } catch (err) {
          // Code 10: Meta withholds the numbers of a story with fewer than 5 viewers.
          if (err.code !== 10) errors.push(`story ${story.id}: ${err.message}`);
        }
      }
    });
  }

  const today = localDateKey(now);
  if (metrics.lastDailyRun !== today) {
    const open = openMonths(now);

    const followersRead = await attempt('followers', async () => {
      const user = await graphGet(igUserId, { fields: 'followers_count' }, context);
      if (Number.isFinite(user.followers_count)) metrics.followers[today] = user.followers_count;
    });

    await attempt('media', async () => {
      // ponytail: no paging — 50 covers a month of feed and Reels with room
      // to spare (the largest plan has 12 feed posts). Page if a client posts more.
      const list = await graphGet(`${igUserId}/media`, {
        fields: 'id,media_product_type,like_count,comments_count,timestamp', limit: 50,
      }, context);
      for (const media of list.data || []) {
        const kind = MEDIA_KINDS[media.media_product_type];
        if (!kind || !open.includes(localMonthKey(new Date(media.timestamp)))) continue;
        const entry = { ...metrics.media[media.id], kind, postedAt: media.timestamp, updatedAt: stamp };
        if (Number.isFinite(media.like_count)) entry.likes = media.like_count;
        if (Number.isFinite(media.comments_count)) entry.comments = media.comments_count;
        if (insights) {
          await attempt(`media ${media.id}`, async () => {
            Object.assign(entry, insightValues(await graphGet(`${media.id}/insights`, { metric: 'views,reach' }, context)));
          });
        }
        metrics.media[media.id] = entry;
      }
    });

    if (insights) {
      for (const month of open) {
        await attempt(`conta ${month}`, async () => {
          metrics.months[month] = { ...(await fetchAccountMonth(igUserId, month, now, context)), updatedAt: stamp };
        });
      }
    }

    // The followers read doubles as the "Meta is reachable" signal: when it
    // fails the whole block runs again on the next tick instead of waiting
    // for tomorrow.
    if (followersRead) metrics.lastDailyRun = today;
  }

  await writeJson(paths.metricsPath, metrics);
  for (const message of errors) console.error(`[content-central] metrics ${projectId}: ${message}`);
  return { skipped: false, errors };
}

const DAY_MS = 86400000;

// Reach by kind and local posting hour, for the cérebro to learn which hours
// work. Only posts at least a day old: a story's reach is still growing
// before that. Stories that went out before postedAt was kept get their time
// from the content item that published them.
export function buildPostingTimeStats(metrics, items = [], now = new Date()) {
  const publishedAt = new Map(items
    .filter((item) => item.publish?.metaMediaId && item.publish?.publishedAt)
    .map((item) => [String(item.publish.metaMediaId), item.publish.publishedAt]));
  const groups = new Map();
  for (const [id, media] of Object.entries(metrics?.media || {})) {
    const posted = new Date(media.postedAt || publishedAt.get(id) || NaN);
    if (Number.isNaN(posted.getTime()) || now - posted < DAY_MS || !Number.isFinite(media.reach)) continue;
    const key = `${media.kind}::${posted.getHours()}`;
    const group = groups.get(key) || { kind: media.kind, hour: posted.getHours(), reaches: [] };
    group.reaches.push(media.reach);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ kind, hour, reaches }) => ({
      kind,
      hour,
      count: reaches.length,
      avgReach: Math.round(reaches.reduce((total, value) => total + value, 0) / reaches.length),
      best: Math.max(...reaches),
      worst: Math.min(...reaches),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.hour - b.hour);
}

export async function collectAllProjectsMetrics(targetDir = process.cwd(), options = {}) {
  const { projectsDir } = getCentralPaths(targetDir);
  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const results = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    // projects/ also holds folders that are not projects (commercial, global-learning).
    if (!(await readJson(join(projectsDir, entry.name, 'project.json'), null))) continue;
    try {
      results.push({ projectId: entry.name, ...(await collectProjectMetrics(entry.name, targetDir, options)) });
    } catch (err) {
      console.error(`[content-central] metrics ${entry.name}: ${err.message}`);
      results.push({ projectId: entry.name, failed: err.message });
    }
  }
  return results;
}
