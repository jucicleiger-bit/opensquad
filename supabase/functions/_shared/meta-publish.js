//
// Ported from squads/conteudo-multicanal/tools/meta-publish-multi.js — same
// proven Graph API call sequence (retry on Meta's transient media-fetch
// failure, two-step container->publish, permalink best-effort lookup) —
// adapted to take credentials as explicit parameters instead of reading
// per-target env vars, since this runs once per already-resolved
// project/token inside an Edge Function, not as a multi-account CLI.
//
// Deliberately zero Deno-specific APIs (only global `fetch`, which both
// Node and Deno provide) so this file is testable with `node --test` and
// importable as-is from a Deno Edge Function's index.ts.

const DEFAULT_GRAPH_BASE = 'https://graph.facebook.com/v25.0';
const RETRYABLE_ERROR_CODE = 9004;
const RETRYABLE_ERROR_SUBCODES = new Set([2207052]);

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function graph(path, params = {}, method = 'GET', { retries = 0, retryDelayMs = 4000, graphBase = DEFAULT_GRAPH_BASE } = {}) {
  const url = new URL(`${graphBase}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { method });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }

    if (res.ok) return json;

    const error = json?.error;
    const isRetryableMediaFetchFailure = error?.code === RETRYABLE_ERROR_CODE && RETRYABLE_ERROR_SUBCODES.has(error?.error_subcode);
    if (isRetryableMediaFetchFailure && attempt < retries) {
      await sleep(retryDelayMs);
      continue;
    }

    if (error?.message) {
      const details = [
        error.type && `type=${error.type}`,
        error.code !== undefined && `code=${error.code}`,
        error.error_subcode !== undefined && `subcode=${error.error_subcode}`,
        error.fbtrace_id && `fbtrace_id=${error.fbtrace_id}`,
      ].filter(Boolean).join(', ');
      throw new Error(`Meta API ${method} ${path} failed [${res.status}]: ${error.message}${details ? ` (${details})` : ''}`);
    }
    throw new Error(`Meta API ${method} ${path} failed [${res.status}]: ${JSON.stringify(json).slice(0, 500)}`);
  }
}

async function waitForInstagramContainer(containerId, token, graphBase) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const status = await graph(`/${containerId}`, { fields: 'status_code', access_token: token }, 'GET', { graphBase });
    if (status.status_code === 'FINISHED') return status.status_code;
    if (status.status_code === 'ERROR') throw new Error(`Instagram container ${containerId} entered ERROR state`);
    await sleep(10_000);
  }
  throw new Error(`Instagram container ${containerId} did not finish within 5 minutes`);
}

async function publishInstagramFeed(target, graphBase) {
  const { token, igId, imageUrl, caption } = target;
  const container = await graph(`/${igId}/media`, { image_url: imageUrl, caption: caption || '', access_token: token }, 'POST', { retries: 2, graphBase });
  await waitForInstagramContainer(container.id, token, graphBase);
  const published = await graph(`/${igId}/media_publish`, { creation_id: container.id, access_token: token }, 'POST', { graphBase });
  let permalink = null;
  try {
    const media = await graph(`/${published.id}`, { fields: 'permalink', access_token: token }, 'GET', { graphBase });
    permalink = media.permalink || null;
  } catch { permalink = null; }
  return { ok: true, mediaId: published.id, containerId: container.id, permalink };
}

async function publishInstagramStory(target, graphBase) {
  const { token, igId, imageUrl } = target;
  const container = await graph(`/${igId}/media`, { image_url: imageUrl, media_type: 'STORIES', access_token: token }, 'POST', { retries: 2, graphBase });
  await waitForInstagramContainer(container.id, token, graphBase);
  const published = await graph(`/${igId}/media_publish`, { creation_id: container.id, access_token: token }, 'POST', { graphBase });
  return { ok: true, mediaId: published.id, containerId: container.id, permalink: null };
}

async function publishFacebookFeed(target, graphBase) {
  const { token, pageId, imageUrl, caption } = target;
  const published = await graph(`/${pageId}/photos`, { url: imageUrl, caption: caption || '', published: 'true', access_token: token }, 'POST', { graphBase });
  return { ok: true, mediaId: published.id || null, postId: published.post_id || null, permalink: null };
}

async function publishFacebookStory(target, graphBase) {
  const { token, pageId, imageUrl } = target;
  const photo = await graph(`/${pageId}/photos`, { url: imageUrl, published: 'false', access_token: token }, 'POST', { graphBase });
  const story = await graph(`/${pageId}/photo_stories`, { photo_id: photo.id, access_token: token }, 'POST', { graphBase });
  return { ok: true, mediaId: photo.id || null, postId: story.post_id || null, permalink: null };
}

// target: { channel, token, igId?, pageId?, imageUrl, caption?, graphBase? }
export async function publishToMeta(target) {
  const graphBase = target.graphBase || DEFAULT_GRAPH_BASE;
  if (target.channel === 'instagram_feed') return publishInstagramFeed(target, graphBase);
  if (target.channel === 'instagram_story') return publishInstagramStory(target, graphBase);
  if (target.channel === 'facebook_feed') return publishFacebookFeed(target, graphBase);
  if (target.channel === 'facebook_story') return publishFacebookStory(target, graphBase);
  throw new Error(`Unsupported publish channel: ${target.channel}`);
}
