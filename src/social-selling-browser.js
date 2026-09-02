import { chromium } from 'playwright';
import { getCentralPaths } from './content-central.js';
import { draftSocialSellingDm } from './social-selling-ai.js';
import { draftDmWithTemplate } from './social-selling-templates.js';
import { draftDmWithOllama } from './social-selling-ollama.js';

async function draftDmForLead(lead, config) {
  if (config.useAi === false) return draftDmWithTemplate(lead, config);
  return config.aiProvider === 'ollama' ? draftDmWithOllama(lead, config) : draftSocialSellingDm(lead, config);
}

// One persistent Chromium context per server process, logged into the
// operator's own Instagram account once by hand (same idea as the
// Sherlock investigator's browser profile, but its own separate
// directory), reused by every sweep — opening a fresh browser per sweep
// would be slow and would log the account in and out constantly, which
// looks far more like a bot than one long-lived session.
let contextPromise = null;

// Requires `npx playwright install chromium` to have been run once on this
// machine before the first real (non-dry-run) use: `npm install playwright`
// installs the library but not the browser binary itself, so without it this
// call fails with "Executable doesn't exist".
function getBrowserContext(targetDir) {
  if (!contextPromise) {
    const { socialSellingBrowserProfileDir } = getCentralPaths(targetDir);
    contextPromise = chromium.launchPersistentContext(socialSellingBrowserProfileDir, { headless: false });
  }
  return contextPromise;
}

export async function closeSocialSellingBrowser() {
  if (!contextPromise) return;
  const context = await contextPromise;
  contextPromise = null;
  await context.close();
}

// Instagram routes a logged-out or flagged session to one of these — a
// far more reliable "something's wrong" signal than trying to parse
// whatever the checkpoint page happens to say this month.
function isBlockedUrl(url) {
  return /\/challenge\/|\/accounts\/suspended\/|\/accounts\/login\//.test(url);
}

function blockedError(reason) {
  return Object.assign(new Error(reason), { blocked: true, reason });
}

// Label text drifts between an English- and a Portuguese-language
// Instagram UI depending on the logged-in account's own language
// setting — try both instead of assuming one.
async function clickByAnyLabel(page, role, names) {
  for (const name of names) {
    const locator = page.getByRole(role, { name, exact: false });
    if (await locator.count()) {
      await locator.first().click();
      return true;
    }
  }
  return false;
}

async function extractPostCandidate(context, postUrl, source, foundOn) {
  const page = await context.newPage();
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
    if (isBlockedUrl(page.url())) throw blockedError('instagram_blocked');
    const authorLink = page.locator('header a[role="link"]').first();
    const href = (await authorLink.count()) ? await authorLink.getAttribute('href') : null;
    if (!href) return null;
    const handle = `@${href.replace(/\//g, '')}`;
    const captionEl = page.locator('h1, article span').first();
    const postSnippet = (await captionEl.count()) ? (await captionEl.innerText()).slice(0, 280) : '';
    return { handle, source, foundOn, postUrl, postSnippet };
  } finally {
    await page.close();
  }
}

// v1 discovery: hashtag search (config.hashtags) plus a handful of
// hashtags standing in for location targeting (config.locationHashtags,
// e.g. "saopaulozonasul") — Instagram's real location pages need a
// numeric place id that isn't resolvable from a plain city name without
// a separate, fragile lookup, so location targeting rides on hashtags
// instead of a broken geo-search. Reference-account mining
// (config.referenceAccounts) covers the higher-intent source: people
// already engaging with a similar business's latest post.
export async function discoverSocialSellingCandidates(config, { targetDir, dryRun = false } = {}) {
  if (dryRun) return [];
  const context = await getBrowserContext(targetDir);
  const candidates = [];

  for (const tag of [...config.hashtags, ...config.locationHashtags]) {
    const page = await context.newPage();
    try {
      await page.goto(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`, { waitUntil: 'domcontentloaded' });
      if (isBlockedUrl(page.url())) throw blockedError('instagram_blocked');
      const links = await page.locator('a[href*="/p/"]').all();
      const postUrls = new Set();
      for (const link of links.slice(0, 10)) {
        const href = await link.getAttribute('href');
        if (href) postUrls.add(new URL(href, 'https://www.instagram.com').toString());
      }
      for (const postUrl of postUrls) {
        const candidate = await extractPostCandidate(context, postUrl, 'hashtag', tag);
        if (candidate) candidates.push(candidate);
      }
    } finally {
      await page.close();
    }
  }

  for (const reference of config.referenceAccounts) {
    const page = await context.newPage();
    try {
      const handle = reference.replace(/^@/, '');
      await page.goto(`https://www.instagram.com/${encodeURIComponent(handle)}/`, { waitUntil: 'domcontentloaded' });
      if (isBlockedUrl(page.url())) throw blockedError('instagram_blocked');
      const latestPost = page.locator('a[href*="/p/"]').first();
      if (!(await latestPost.count())) continue;
      const postHref = await latestPost.getAttribute('href');
      await latestPost.click();
      if (isBlockedUrl(page.url())) throw blockedError('instagram_blocked');
      await clickByAnyLabel(page, 'link', ['likes', 'curtidas']);
      const likers = await page.locator('div[role="dialog"] a[role="link"]').all();
      for (const liker of likers.slice(0, 10)) {
        const href = await liker.getAttribute('href');
        if (!href) continue;
        candidates.push({
          handle: `@${href.replace(/\//g, '')}`,
          source: 'reference_mining',
          foundOn: reference,
          postUrl: new URL(postHref, 'https://www.instagram.com').toString(),
          postSnippet: '',
        });
      }
    } finally {
      await page.close();
    }
  }

  return candidates;
}

// Executes exactly one engagement step for one lead. `action` is
// whatever social-selling-sweep.js decided is next (`like` | `comment` |
// `follow` | `dm`); the result tells the sweep whether to advance the
// lead's stage or treat this as a block that must pause everything.
export async function performSocialSellingAction({ lead, action, config }, { targetDir, dryRun = false } = {}) {
  if (dryRun) return { ok: true };
  const context = await getBrowserContext(targetDir);
  const page = await context.newPage();
  try {
    // like/comment must happen on the specific post the lead was found on;
    // follow/dm are profile-level controls (the Follow button and the Message
    // control only exist on a profile page) and must happen on the lead's own
    // profile — never on whatever post surfaced them, which for a
    // reference-mined lead belongs to the reference account, not to them.
    const profileUrl = lead.profileUrl || `https://www.instagram.com/${String(lead.handle || '').replace(/^@/, '')}/`;
    await page.goto(action === 'follow' || action === 'dm' ? profileUrl : lead.postUrl, { waitUntil: 'domcontentloaded' });
    if (isBlockedUrl(page.url())) return { blocked: true, reason: 'instagram_blocked' };

    // A control we can't find is a selector/UI-copy problem, not evidence the
    // account is flagged — throw a plain error so the sweep retries this one
    // lead (and eventually drops it) instead of pausing the whole engine.
    if (action === 'like') {
      if (!(await clickByAnyLabel(page, 'button', ['Like', 'Curtir']))) throw new Error('Like button not found');
      return { ok: true };
    }

    if (action === 'comment') {
      const box = page.getByPlaceholder(/add a comment|adicione um comentário/i);
      if (!(await box.count())) throw new Error('Comment box not found');
      await box.click();
      await box.fill(lead.draftComment || '');
      if (!(await clickByAnyLabel(page, 'button', ['Post', 'Publicar']))) throw new Error('Post button not found');
      return { ok: true };
    }

    if (action === 'follow') {
      const followed = await clickByAnyLabel(page, 'button', ['Follow', 'Seguir']);
      if (!followed) return { blocked: true, reason: 'follow_button_not_found' };
      const draftDm = await draftDmForLead(lead, config);
      return { ok: true, draftDm };
    }

    if (action === 'dm') {
      const opened = await clickByAnyLabel(page, 'link', ['Message', 'Mensagem']);
      if (!opened) return { blocked: true, reason: 'message_button_not_found' };
      const box = page.getByPlaceholder(/message\.\.\.|mensagem\.\.\./i);
      await box.click();
      await box.fill(lead.draftDm || '');
      await page.keyboard.press('Enter');
      return { ok: true };
    }

    return { blocked: true, reason: `unknown_action_${action}` };
  } catch (err) {
    if (err.blocked) return { blocked: true, reason: err.reason };
    throw err;
  } finally {
    await page.close();
  }
}
