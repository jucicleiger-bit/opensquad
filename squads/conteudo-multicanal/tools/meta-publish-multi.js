#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises';

// Overridable only so tests can point the real call sequence at a local
// stub server (see tests/meta-publish-multi.test.js) — unset in production.
const GRAPH_BASE = process.env.META_GRAPH_BASE || 'https://graph.facebook.com/v25.0';
const IG_CHANNELS = new Set(['instagram_feed', 'instagram_story', 'instagram_reels']);
const FB_CHANNELS = new Set(['facebook_feed', 'facebook_story']);
const VIDEO_CHANNELS = new Set(['instagram_reels']);
const CHANNEL_LABELS = {
  instagram_feed: 'Instagram Feed',
  instagram_story: 'Instagram Story',
  instagram_reels: 'Instagram Reels',
  facebook_feed: 'Facebook Feed',
  facebook_story: 'Facebook Story',
};

function parseArgs(argv) {
  const args = {
    imageUrl: '',
    caption: '',
    targets: '',
    payloadJson: '',
    payloadFile: '',
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--image-url' && i + 1 < argv.length) args.imageUrl = argv[++i];
    else if (arg === '--caption' && i + 1 < argv.length) args.caption = argv[++i];
    else if (arg === '--targets' && i + 1 < argv.length) args.targets = argv[++i];
    else if (arg === '--payload-json' && i + 1 < argv.length) args.payloadJson = argv[++i];
    else if (arg === '--payload-file' && i + 1 < argv.length) args.payloadFile = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
  }

  return args;
}

// Meta's own crawler intermittently fails to fetch a perfectly valid,
// publicly reachable image_url (error code 9004 / subcode 2207052, "Falha
// ao baixar mídia") — confirmed by hand: the exact same URL that failed
// once succeeded a few seconds later with no code or hosting change on our
// side. Meta reports it as "is_transient: false", but it isn't in practice,
// so /media container creation gets a few automatic retries instead of
// failing the whole publish on a hiccup that would've passed on its own.
const RETRYABLE_ERROR_CODE = 9004;
const RETRYABLE_ERROR_SUBCODES = new Set([2207052]);

async function graph(path, params = {}, method = 'GET', { retries = 0, retryDelayMs = 4000 } = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
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

async function waitForInstagramContainer(containerId, token) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const status = await graph(`/${containerId}`, { fields: 'status_code', access_token: token });
    if (status.status_code === 'FINISHED') return status.status_code;
    if (status.status_code === 'ERROR') throw new Error(`Instagram container ${containerId} entered ERROR state`);
    await sleep(10_000);
  }
  throw new Error(`Instagram container ${containerId} did not finish within 5 minutes`);
}

function normalizeChannel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}

function buildTargets(args, payload) {
  const defaults = {
    image_url: payload.image_url || payload.imageUrl || args.imageUrl,
    image_urls: Array.isArray(payload.image_urls) ? payload.image_urls : undefined,
    video_url: payload.video_url || payload.videoUrl || '',
    caption: payload.caption || args.caption,
    env_prefix: payload.env_prefix || payload.envPrefix || '',
  };

  const sourceTargets = payload.publish_targets || payload.targets || payload.channels;
  if (Array.isArray(sourceTargets) && sourceTargets.length) {
    return sourceTargets.map((target) => {
      if (typeof target === 'string') {
        return { channel: normalizeChannel(target), ...defaults };
      }
      return {
        ...defaults,
        ...target,
        channel: normalizeChannel(target.channel || target.id || target.name),
        image_url: target.image_url || target.imageUrl || target.image || defaults.image_url,
        image_urls: Array.isArray(target.image_urls) ? target.image_urls : defaults.image_urls,
        video_url: target.video_url || target.videoUrl || defaults.video_url,
        caption: target.caption ?? defaults.caption,
      };
    });
  }

  const channels = (args.targets || 'instagram_feed')
    .split(',')
    .map(normalizeChannel)
    .filter(Boolean);
  return channels.map((channel) => ({ channel, ...defaults }));
}

function validateTarget(target) {
  if (!CHANNEL_LABELS[target.channel]) throw new Error(`Unsupported publish channel: ${target.channel}`);
  if (VIDEO_CHANNELS.has(target.channel)) {
    if (!target.video_url) throw new Error(`${CHANNEL_LABELS[target.channel]} requires video_url`);
  } else if (Array.isArray(target.image_urls)) {
    if (target.channel !== 'instagram_feed') throw new Error(`${CHANNEL_LABELS[target.channel]} does not support carousel image_urls — Feed only`);
    if (target.image_urls.length < 2 || target.image_urls.length > 10) {
      throw new Error(`Instagram carousel requires 2-10 image_urls, got ${target.image_urls.length}`);
    }
  } else if (!target.image_url) {
    throw new Error(`${CHANNEL_LABELS[target.channel]} requires image_url`);
  }
  if (target.caption && target.caption.length > 2200) {
    throw new Error(`${CHANNEL_LABELS[target.channel]} caption exceeds Instagram limit: ${target.caption.length}/2200`);
  }
}

function envName(target, key) {
  const prefix = String(target.env_prefix || target.envPrefix || '').trim().toUpperCase();
  return prefix ? `${prefix}_${key}` : key;
}

function envValue(target, key) {
  const prefixed = envName(target, key);
  return process.env[prefixed] || process.env[key];
}

function instagramToken(target) {
  const token = envValue(target, 'INSTAGRAM_ACCESS_TOKEN');
  if (!token) throw new Error(`${envName(target, 'INSTAGRAM_ACCESS_TOKEN')} is missing`);
  return token;
}

function instagramUserId(target) {
  const igId = envValue(target, 'INSTAGRAM_USER_ID');
  if (!igId) throw new Error(`${envName(target, 'INSTAGRAM_USER_ID')} is missing`);
  return igId;
}

async function facebookPageToken(target) {
  const configured = envValue(target, 'FACEBOOK_PAGE_ACCESS_TOKEN') || envValue(target, 'META_PAGE_ACCESS_TOKEN');
  if (configured) return configured;

  const fallback = envValue(target, 'INSTAGRAM_ACCESS_TOKEN');
  const pageId = envValue(target, 'FACEBOOK_PAGE_ID');
  if (!fallback) throw new Error(`${envName(target, 'FACEBOOK_PAGE_ACCESS_TOKEN')} or ${envName(target, 'INSTAGRAM_ACCESS_TOKEN')} is missing`);
  if (!pageId) throw new Error(`${envName(target, 'FACEBOOK_PAGE_ID')} is missing`);

  try {
    const page = await graph(`/${pageId}`, { fields: 'access_token', access_token: fallback });
    return page.access_token || fallback;
  } catch {
    return fallback;
  }
}

function facebookPageId(target) {
  const pageId = envValue(target, 'FACEBOOK_PAGE_ID');
  if (!pageId) throw new Error(`${envName(target, 'FACEBOOK_PAGE_ID')} is missing`);
  return pageId;
}

async function publishInstagramFeed(target) {
  const token = instagramToken(target);
  const igId = instagramUserId(target);
  const container = await graph(`/${igId}/media`, {
    image_url: target.image_url,
    caption: target.caption || '',
    access_token: token,
  }, 'POST', { retries: 2 });

  await waitForInstagramContainer(container.id, token);
  const published = await graph(`/${igId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  }, 'POST');

  let permalink = null;
  try {
    const media = await graph(`/${published.id}`, { fields: 'permalink', access_token: token });
    permalink = media.permalink || null;
  } catch {
    permalink = null;
  }

  return { channel: target.channel, ok: true, media_id: published.id, container_id: container.id, permalink };
}

// Same two-step container pattern publishInstagramFeed already uses, with
// an extra fan-out step: N child containers (one per slide, is_carousel_item
// true, no per-child caption — Meta ignores it there), then one parent
// container (media_type CAROUSEL, children, the real caption), then the
// same publish call every other channel already ends with.
async function publishInstagramCarousel(target) {
  const token = instagramToken(target);
  const igId = instagramUserId(target);

  const childIds = [];
  for (const imageUrl of target.image_urls) {
    const child = await graph(`/${igId}/media`, {
      image_url: imageUrl,
      is_carousel_item: 'true',
      access_token: token,
    }, 'POST', { retries: 2 });
    childIds.push(child.id);
  }

  const container = await graph(`/${igId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: target.caption || '',
    access_token: token,
  }, 'POST', { retries: 2 });

  await waitForInstagramContainer(container.id, token);
  const published = await graph(`/${igId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  }, 'POST');

  let permalink = null;
  try {
    const media = await graph(`/${published.id}`, { fields: 'permalink', access_token: token });
    permalink = media.permalink || null;
  } catch {
    permalink = null;
  }

  return { channel: target.channel, ok: true, media_id: published.id, container_id: container.id, permalink };
}

async function publishInstagramStory(target) {
  const token = instagramToken(target);
  const igId = instagramUserId(target);
  const container = await graph(`/${igId}/media`, {
    image_url: target.image_url,
    media_type: 'STORIES',
    access_token: token,
  }, 'POST', { retries: 2 });

  await waitForInstagramContainer(container.id, token);
  const published = await graph(`/${igId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  }, 'POST');

  return { channel: target.channel, ok: true, media_id: published.id, container_id: container.id, permalink: null };
}

// Reels containers go through the same async processing/polling as Story
// (waitForInstagramContainer), just with media_type REELS and a video_url
// instead of an image_url — Meta only accepts video for this channel.
async function publishInstagramReels(target) {
  const token = instagramToken(target);
  const igId = instagramUserId(target);
  const container = await graph(`/${igId}/media`, {
    video_url: target.video_url,
    media_type: 'REELS',
    caption: target.caption || '',
    access_token: token,
  }, 'POST', { retries: 2 });

  await waitForInstagramContainer(container.id, token);
  const published = await graph(`/${igId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  }, 'POST');

  let permalink = null;
  try {
    const media = await graph(`/${published.id}`, { fields: 'permalink', access_token: token });
    permalink = media.permalink || null;
  } catch {
    permalink = null;
  }

  return { channel: target.channel, ok: true, media_id: published.id, container_id: container.id, permalink };
}

async function publishFacebookFeed(target) {
  const token = await facebookPageToken(target);
  const pageId = facebookPageId(target);
  const published = await graph(`/${pageId}/photos`, {
    url: target.image_url,
    caption: target.caption || '',
    published: 'true',
    access_token: token,
  }, 'POST');

  return { channel: target.channel, ok: true, media_id: published.id || null, post_id: published.post_id || null };
}

async function publishFacebookStory(target) {
  const token = await facebookPageToken(target);
  const pageId = facebookPageId(target);
  const photo = await graph(`/${pageId}/photos`, {
    url: target.image_url,
    published: 'false',
    access_token: token,
  }, 'POST');

  const story = await graph(`/${pageId}/photo_stories`, {
    photo_id: photo.id,
    access_token: token,
  }, 'POST');

  return { channel: target.channel, ok: true, media_id: photo.id || null, post_id: story.post_id || null };
}

async function publishTarget(target) {
  if (target.channel === 'instagram_feed' && Array.isArray(target.image_urls) && target.image_urls.length) return publishInstagramCarousel(target);
  if (target.channel === 'instagram_feed') return publishInstagramFeed(target);
  if (target.channel === 'instagram_story') return publishInstagramStory(target);
  if (target.channel === 'instagram_reels') return publishInstagramReels(target);
  if (target.channel === 'facebook_feed') return publishFacebookFeed(target);
  if (target.channel === 'facebook_story') return publishFacebookStory(target);
  throw new Error(`Unsupported publish channel: ${target.channel}`);
}

async function loadPayload(args) {
  if (args.payloadJson) return JSON.parse(args.payloadJson);
  if (args.payloadFile) {
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(args.payloadFile, 'utf8'));
  }
  return {};
}

async function main() {
  const args = parseArgs(process.argv);
  const payload = await loadPayload(args);
  const targets = buildTargets(args, payload);
  if (!targets.length) throw new Error('At least one publish target is required');

  targets.forEach(validateTarget);

  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      targets: targets.map((target) => ({
        channel: target.channel,
        label: CHANNEL_LABELS[target.channel],
        env_prefix: target.env_prefix || target.envPrefix || '',
        image_url_present: Boolean(target.image_url),
        video_url_present: Boolean(target.video_url),
        caption_length: (target.caption || '').length,
      })),
    }, null, 2));
    return;
  }

  const results = [];
  for (const target of targets) {
    results.push(await publishTarget(target));
  }

  console.log(JSON.stringify({ ok: true, dry_run: false, results }, null, 2));
}

main().catch((err) => {
  console.error(err.message || String(err));
  // Setting exitCode (not calling process.exit()) lets the event loop drain
  // naturally instead of forcing an abrupt termination right after an async
  // fetch — calling process.exit() here raced with libuv's handle cleanup on
  // Windows and crashed with "Assertion failed: !(handle->flags &
  // UV_HANDLE_CLOSING)" instead of exiting with the real Meta API error.
  process.exitCode = 1;
});
