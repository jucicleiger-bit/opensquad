import { exec, execFile, spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { HorizontalAlign, VerticalAlign } from '@jimp/core';
import { SANS_16_BLACK, SANS_16_WHITE, SANS_32_BLACK, SANS_32_WHITE, SANS_64_BLACK, SANS_64_WHITE } from '@jimp/plugin-print/fonts';
import { Jimp, loadFont, measureText } from 'jimp';
import sharp from 'sharp';
import { uploadToImgBB } from '../skills/instagram-publisher/scripts/publish.js';
import {
  CONTENT_CENTRAL_PERSONAS,
  contentCentralPersonaLine,
  contentCentralPersonaResponsibilityLine,
} from './content-central-personas.js';
import {
  analyzeLearningImage,
  animateContentForReels,
  applyExternalPublishResult,
  buildApprovalPayload,
  approveContent,
  deleteLearningEntry,
  enqueueSegmentTemplateAdaptation,
  listSegmentTemplates,
  loadSegmentLearningNodesForSelection,
  analyzeProjectTechnicalBase,
  analyzeProjectBrandXray,
  analyzeProjectBrandBriefing,
  approveProjectBrandXray,
  approveProjectBrandBriefing,
  chooseCreativeCta,
  createCentralProject,
  creativeShapeGroupForChannel,
  deleteCentralProject,
  deleteCommercialCatalogItem,
  deleteCommercialPortfolioItem,
  deleteCommercialProposal,
  deleteCommercialProspect,
  duplicateCentralProject,
  getCommercialAgency,
  getCommercialProposal,
  listCommercialCatalogItems,
  listCommercialPortfolioItems,
  listCommercialProcesses,
  listCommercialProspects,
  listCommercialProposals,
  saveCommercialAgency,
  saveCommercialAgencyLogo,
  saveCommercialCatalogItem,
  saveCommercialPortfolioItem,
  saveCommercialProcess,
  saveCommercialProspect,
  saveCommercialProposal,
  deleteProjectContent,
  deleteProjectOffer,
  deleteProjectPillar,
  deleteProjectReference,
  enqueueBatchImageGeneration,
  enqueueCatalogImageGeneration,
  generateCatalogSchedulePlan,
  deleteAdCreative,
  enqueueAdCreativeImageGeneration,
  generateAdCreative,
  regenerateAdCreative,
  generateContentBatch,
  generateContentSchedulePlan,
  previewContentSchedulePlan,
  generateSpecialDateContent,
  isVerticalStoryChannel,
  listAdCreatives,
  listCommemorativeDates,
  getCentralPaths,
  getGlobalRules,
  listCentralProjects,
  listProjectContent,
  listSystemAlerts,
  loadOfferTypeLearning,
  OFFER_TYPES,
  sendDueAlertEmails,
  publishSingleContent,
  readProjectToken,
  reconcileInterruptedGenerations,
  regenerateContentDay,
  regenerateContentGroup,
  researchOnlineVisualTrends,
  runDuePublishSweep,
  saveLearningEntry,
  saveOfferTypeBaseInstruction,
  saveProjectAsset,
  saveProjectOffer,
  saveProjectOfferGroup,
  deleteProjectOfferGroup,
  saveProjectPillar,
  saveProjectToken,
  saveProjectWhatsAppInstance,
  suggestProjectPillars,
  updateCatalogSettings,
  updateContentCaption,
  updateProjectBrandInput,
  updateProjectCompanyProfile,
  updateProjectReference,
  simulateTestPost,
  updateProjectImageRules,
  validateMetaToken,
} from './content-central.js';
import { upsertQueueItem, removeQueueItem, pullQueue, readQueueItem } from './gaveta-sync.js';

export { CONTENT_CENTRAL_PERSONAS };

// Local dev without OPENSQUAD_GAVETA_DIR set behaves exactly as before this
// feature existed — no queueSync/mediaUploader passed, approve/regenerate/
// delete stay purely local.
// projectId is passed explicitly (not read off `content`) because content
// records don't carry their own projectId — resolveGeneratedImageAbsolutePath
// needs it to locate the file on disk (see publishContentToInstagram above,
// which does the same `project.projectId` lookup for the same reason).
function resolveGaveteSync(targetDir, projectId) {
  const gaveteDir = process.env.OPENSQUAD_GAVETA_DIR;
  if (!gaveteDir) return {};
  return {
    queueSync: async (action, payload) => {
      // The gaveta queue is drained by an external GitHub Actions sweep that
      // only holds Meta credentials — a whatsapp_status item pushed there
      // would sit stuck/failing forever. Skip the upsert for those channels;
      // 'remove' payloads never carry a channel and clean up items that may
      // have been queued before this guard existed, so those still go through.
      if (action === 'upsert') {
        if (WHATSAPP_CHANNELS.has(payload.data?.channel)) return null;
        return upsertQueueItem(gaveteDir, payload.projectId, payload.contentId, payload.data);
      }
      if (action === 'remove') return removeQueueItem(gaveteDir, payload.projectId, payload.contentId);
    },
    mediaUploader: async (content) => {
      const isVideoChannel = VIDEO_CHANNELS.has(content.channel);
      if (isVideoChannel) {
        if (!content.video?.localPath) return null;
        return uploadWithRetry(() => uploadGeneratedVideoPublicly(content.video.localPath));
      }
      const localPath = resolveGeneratedImageAbsolutePath(content, projectId, targetDir);
      return localPath ? uploadWithRetry(() => uploadGeneratedImagePublicly(localPath)) : null;
    },
  };
}

// Manual "Publicar agora" still runs the real publish directly from this
// PC, but the gaveta is shared state now — GitHub Actions' hourly sweep
// (or another operator) might publish the same item moments before this
// button is clicked. Pull first so publishSingleContent sees the latest
// state, push the published result after so the next sweep sees it's done
// and skips it. Extracted from the route so it's directly unit-testable
// with a fake metaPublisher — see tests/content-central-server.test.js.
export async function publishWithGaveteSync(projectId, contentId, targetDir, batchId, options = {}) {
  const gaveteDir = process.env.OPENSQUAD_GAVETA_DIR;
  const pull = options.pullQueue || pullQueue;
  const upsert = options.upsertQueueItem || upsertQueueItem;
  const readQueue = options.readQueueItem || readQueueItem;
  if (gaveteDir) await pull(gaveteDir);

  // The gaveta is shared state — GitHub Actions' hourly sweep may have
  // already published this exact item moments before this button was
  // clicked. If the freshly-pulled queue item already shows a real publish,
  // sync that fact onto the local record instead of publishing again (which
  // would be a real duplicate post — the whole reason this feature exists).
  const existingQueueItem = gaveteDir ? await readQueue(gaveteDir, projectId, contentId) : null;
  const content = existingQueueItem?.publish?.realPublished
    ? await applyExternalPublishResult(projectId, contentId, targetDir, batchId, existingQueueItem.publish)
    : await publishSingleContent(projectId, contentId, targetDir, {
        metaPublisher: options.metaPublisher || ((payload) => publishContentToInstagram(payload, targetDir)),
      }, batchId);
  if (gaveteDir) {
    await upsert(gaveteDir, projectId, content.contentId, {
      channel: content.channel,
      caption: content.caption.text,
      mediaUrl: content.publish?.mediaUrl || null,
      scheduledDate: content.scheduledDate,
      scheduledTime: content.scheduledTime,
      publish: content.publish,
    });
  }
  return content;
}

async function syncGavetePublishedContent(projectId, targetDir, content) {
  const gaveteDir = process.env.OPENSQUAD_GAVETA_DIR;
  if (!gaveteDir) return content;
  try {
    await pullQueue(gaveteDir);
    let changed = false;
    for (const item of content) {
      if (item.publish?.realPublished) continue;
      const queueItem = await readQueueItem(gaveteDir, projectId, item.contentId);
      if (!queueItem?.publish?.realPublished) continue;
      await applyExternalPublishResult(projectId, item.contentId, targetDir, item.batchId, queueItem.publish);
      changed = true;
    }
    return changed ? listProjectContent(projectId, targetDir) : content;
  } catch (err) {
    console.error('[content-central] gaveta calendar sync failed:', err.message);
    return content;
  }
}

const API_SUPPORTED_CHANNELS = new Set(['instagram_feed', 'instagram_story', 'instagram_reels', 'facebook_feed', 'facebook_story', 'whatsapp_status']);
const execFileAsync = promisify(execFile);

// execFile always pipes the child's stdin — fine for every other subprocess
// call in this file (they never read stdin), but `codex exec` specifically
// detects a piped-but-silent stdin and blocks waiting for EOF that never
// comes (confirmed: a real run hung the full length of its timeout this
// way). execFile's options don't let a caller override that; spawn's do.
function execFileNoStdin(file, args, { timeout, maxBuffer = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(arg);
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > maxBuffer) child.kill('SIGKILL');
    });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (code === 0) finish(resolvePromise, { stdout, stderr });
      else finish(reject, new Error(`Command failed with exit code ${code}: ${stderr || stdout}`.trim()));
    });
    if (timeout) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    }
  });
}

// gh secret set's value goes via stdin, not `--body <value>` as a literal
// CLI argument — args are visible to anything listing processes (ps/tasklist)
// for the life of the child, which would leak the raw Meta token. This wraps
// the raw (non-promisified) execFile so we get the child's stdin stream to
// write the secret value to, then closes it (`--body` with no value tells gh
// to read stdin).
function execFileWithStdin(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

// Pushes a project's Meta token (and IG/Page IDs) to GitHub Secrets so the
// GitHub Actions publisher always has a fresh credential — no-op when
// OPENSQUAD_GAVETA_REPO isn't set (local dev without GitHub configured).
export async function syncTokenSecretsToGitHub(projectId, { token, instagramUserId, pageId }, options = {}) {
  const repo = process.env.OPENSQUAD_GAVETA_REPO;
  if (!repo) return;
  const run = options.execFileAsync || execFileWithStdin;
  const prefix = projectId.toUpperCase().replace(/-/g, '_');
  const entries = [
    [`META_TOKEN_${prefix}`, token],
    [`META_IG_USER_ID_${prefix}`, instagramUserId || ''],
    [`META_PAGE_ID_${prefix}`, pageId || ''],
  ];
  for (const [name, value] of entries) {
    await run('gh', ['secret', 'set', name, '--repo', repo], value);
  }
}

// Test-only seam: content-central-server.js computes `execFileAsync =
// promisify(execFile)` once at import time (see above), so a global mock of
// node:child_process's execFile never reaches call sites that already
// closed over the original. This lets tests swap the function the token-save
// *route* uses without touching global module state.
let execFileAsyncForRoutes = execFileWithStdin;
export function __setExecFileAsyncForTests(fn) {
  const previous = execFileAsyncForRoutes;
  execFileAsyncForRoutes = fn;
  return previous;
}

export async function loadContentCentralEnv(targetDir = process.cwd(), env = process.env) {
  let raw;
  try {
    raw = await readFile(join(targetDir, '.env'), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return { loaded: false, keys: [] };
    throw err;
  }
  const keys = [];
  for (const line of raw.replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = unquoteEnvValue(match[2].trim());
    if (env[key] === undefined || env[key] === '') env[key] = value;
    keys.push(key);
  }
  return { loaded: true, keys };
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export async function startContentCentralServer({
  targetDir = process.cwd(),
  port = 3333,
  host = '127.0.0.1',
  openBrowser = true,
  enableAiImages = false,
  imageGenerator = null,
  imageReviewer = null,
  captionGenerator = null,
  adCopyGenerator = null,
  brandAnalyzer = null,
  pillarSuggester = null,
  logoColorAnalyzer = null,
  siteAnalyzer = null,
  webResearcher = null,
  learningImageAnalyzer = null,
  offerDirectionSuggester = null,
  videoAnimator = null,
  prospectScreenshotAnalyzer = null,
  bioImprover = null,
} = {}) {
  await loadContentCentralEnv(targetDir);
  await reconcileInterruptedGenerations(targetDir).catch((err) => console.error('[content-central] reconcile interrupted generations failed:', err.message));
  const context = {
    catalogImageComposer: (payload) => composeCatalogImage({ ...payload, targetDir }),
    imageGenerator: imageGenerator || (enableAiImages ? (payload) => generateAiImageForActiveProvider({ ...payload, targetDir }) : null),
    imageReviewer: imageReviewer || (enableAiImages ? reviewImageForActiveTextProvider : null),
    captionGenerator: captionGenerator || (enableAiImages ? writeAiCaptionWithHermes : null),
    adCopyGenerator: adCopyGenerator || (enableAiImages ? writeAdCopyVariationsWithHermes : null),
    brandAnalyzer: brandAnalyzer || (enableAiImages ? generateBrandXrayWithAi : null),
    pillarSuggester: pillarSuggester || (enableAiImages ? generatePillarSuggestionsWithAi : null),
    logoColorAnalyzer: logoColorAnalyzer || (enableAiImages ? identifyLogoColorsWithAi : null),
    siteAnalyzer: siteAnalyzer || (enableAiImages ? analyzeSiteWithAi : null),
    webResearcher: webResearcher || (enableAiImages ? researchOnlineVisualTrendsWithHermes : null),
    learningImageAnalyzer: learningImageAnalyzer || (enableAiImages ? analyzeLearningImageWithCodexAgent : null),
    offerDirectionSuggester: offerDirectionSuggester || (enableAiImages ? suggestOfferDirectionWithCodexAgent : null),
    videoAnimator: videoAnimator || (enableAiImages ? (payload) => animateImageForReelsWithFfmpeg(payload, targetDir) : null),
    prospectScreenshotAnalyzer: prospectScreenshotAnalyzer || (enableAiImages ? analyzeProspectScreenshotWithHermes : null),
    bioImprover: bioImprover || (enableAiImages ? improveProspectBioWithAi : null),
  };
  const server = createServer((req, res) => {
    handleRequest(req, res, targetDir, context).catch((err) => sendJson(res, 500, {
      error: err.message,
    }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const url = `http://${host}:${address.port}`;
  if (openBrowser) openUrl(url);
  const publishSchedulerTimer = startPublishScheduler(targetDir);
  const whatsappPublishSchedulerTimer = startWhatsAppPublishScheduler(targetDir);
  const alertEmailSchedulerTimer = startAlertEmailScheduler(targetDir);

  return {
    server,
    url,
    close: () => new Promise((resolve, reject) => {
      if (publishSchedulerTimer) clearInterval(publishSchedulerTimer);
      if (whatsappPublishSchedulerTimer) clearInterval(whatsappPublishSchedulerTimer);
      if (alertEmailSchedulerTimer) clearInterval(alertEmailSchedulerTimer);
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

async function handleRequest(req, res, targetDir, context = {}) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;
  const method = req.method || 'GET';

  // The React app (content-central-app/) is the official panel, served at "/"
  // with clean client-side routes ("/projects/:id/...", "/comercial/...").
  // The old vanilla renderApp() panel stays reachable at "/classic" as a
  // fallback for the sections not yet migrated (Referências e imagem,
  // Agenda e geração, Teste seguro) so nobody is stranded while the rewrite
  // is still in progress.
  //
  // Every real API endpoint lives under /api/ — so instead of allow-listing
  // each client-side route prefix one by one (which silently 404s any new
  // one added later on a hard navigation, e.g. opening a print view in a
  // new tab), any other GET request falls back to the SPA shell and lets
  // React Router match it client-side.
  if (method === 'GET' && route === '/classic') return sendHtml(res, renderApp());
  if (method === 'GET' && !route.startsWith('/api/')) {
    return sendReactApp(res, route === '/' ? '' : route);
  }
  if (method === 'GET' && route === '/api/state') return sendJson(res, 200, {
    projects: await listCentralProjects(targetDir),
    globalRules: await getGlobalRules(targetDir),
    alerts: await listSystemAlerts(targetDir),
  });

  // Segment templates (e.g. "embalagens") — pre-approved art reused across
  // prospects in the same business segment instead of generating from
  // scratch every time. Registration is operator/script-driven for now (see
  // registerSegmentTemplate); this only lists what's already registered, so
  // the dashboard's segment picker degrades to an empty list, never an
  // error, before the first template exists.
  if (method === 'GET' && route === '/api/segment-templates') {
    return sendJson(res, 200, { templates: await listSegmentTemplates(targetDir) });
  }

  // The fixed, already-approved art itself — served directly so the
  // dashboard's preview can show real photography with zero per-prospect AI
  // call (only a live CSS color overlay changes on top, client-side).
  if (method === 'GET' && route.startsWith('/api/segment-templates/')) {
    const segParts = route.split('/').filter(Boolean).map(decodeURIComponent);
    // ['api', 'segment-templates', segmentId, 'images', filename]
    if (segParts.length === 5 && segParts[3] === 'images') {
      return sendSegmentTemplateImage(res, targetDir, segParts[2], segParts[4]);
    }
    return sendJson(res, 404, { error: 'Not found' });
  }

  if (method === 'GET' && route.startsWith('/api/learning-assets/')) {
    return sendLearningAsset(res, targetDir, decodeURIComponent(route.slice('/api/learning-assets/'.length)));
  }

  if (method === 'POST' && route === '/api/segment-learnings/analyze-image') {
    if (typeof context.learningImageAnalyzer !== 'function') {
      return sendJson(res, 501, { error: 'Análise de imagem por IA não está disponível neste servidor.' });
    }
    const body = await readBody(req);
    const result = await analyzeLearningImage({ ...body, scope: body.scope === 'offerType' ? 'offerType' : 'segment' }, targetDir, new Date(), { learningImageAnalyzer: context.learningImageAnalyzer });
    return sendJson(res, 200, result);
  }

  if (method === 'POST' && route === '/api/segment-learnings/entries') {
    const body = await readBody(req);
    const entries = await saveLearningEntry({ ...body, scope: body.scope === 'offerType' ? 'offerType' : 'segment' }, targetDir);
    return sendJson(res, 200, { entries });
  }

  if (method === 'POST' && route === '/api/segment-learnings/entries-delete') {
    const body = await readBody(req);
    const entries = await deleteLearningEntry({ ...body, scope: body.scope === 'offerType' ? 'offerType' : 'segment' }, targetDir);
    return sendJson(res, 200, { entries });
  }

  if (method === 'GET' && route === '/api/segment-learnings/nodes') {
    const nodes = await loadSegmentLearningNodesForSelection(getCentralPaths(targetDir), {
      segmentGroup: url.searchParams.get('segmentGroup') || '',
      segmentCategory: url.searchParams.get('segmentCategory') || '',
      segmentSpecialty: url.searchParams.get('segmentSpecialty') || '',
    });
    return sendJson(res, 200, { nodes });
  }

  if (method === 'GET' && route === '/api/offer-type-learnings') {
    const types = await Promise.all([...OFFER_TYPES].map((type) => loadOfferTypeLearning(targetDir, type)));
    return sendJson(res, 200, { types });
  }

  if (method === 'POST' && route === '/api/offer-type-learnings') {
    const body = await readBody(req);
    await saveOfferTypeBaseInstruction(targetDir, body.type, body.baseInstruction);
    return sendJson(res, 200, { type: body.type, baseInstruction: body.baseInstruction });
  }

  if (method === 'POST' && route === '/api/projects') {
    const body = await readBody(req);
    const project = await createCentralProject(body, targetDir);
    return sendJson(res, 201, { project });
  }

  // Turns one screenshot of a prospect's real Instagram profile into a
  // throwaway "prospecção" project pre-filled with what the screenshot
  // actually showed — see analyzeProspectScreenshotWithHermes. The vision
  // read is best-effort: any failure there still creates the project (with
  // blank fields the operator fills in by hand) instead of failing the
  // request, same "never block the user on an AI call" contract as
  // saveProjectAsset's logo-color extraction.
  if (method === 'POST' && route === '/api/prospects') {
    const body = await readBody(req);
    const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(String(body?.dataUrl || ''));
    if (!dataUrlMatch) return sendJson(res, 400, { error: 'Envie um print (dataUrl de imagem) do perfil do prospect.' });
    const [, mimeType, base64] = dataUrlMatch;
    const buffer = Buffer.from(base64, 'base64');

    let extracted = null;
    try {
      if (typeof context.prospectScreenshotAnalyzer === 'function') {
        extracted = await context.prospectScreenshotAnalyzer({ buffer, mimeType });
      }
    } catch (err) {
      console.error('[content-central] prospect screenshot analysis failed:', err.message);
    }

    let project = await createCentralProject({
      // A failed vision read still needs a project to land in — fall back
      // to a name unique enough that a second failed upload right after
      // doesn't collide on the same slug (normalizeProjectId is
      // deterministic from the name).
      name: extracted?.businessName || `Nova prospecção ${Date.now()}`,
      handle: extracted?.handle || '',
      isProspect: true,
      companyProfile: {
        segment: extracted?.nicheGuess || '',
        description: extracted?.bioText || '',
        differentiators: (extracted?.differentiators || []).join('; '),
      },
      prospectSource: extracted ? {
        handle: extracted.handle,
        bio: extracted.bioText,
        realFollowers: extracted.realFollowers,
        realPosts: extracted.realPosts,
        realFollowing: extracted.realFollowing,
      } : null,
    }, targetDir);

    if (extracted?.avatarCrop) {
      try {
        const avatarDataUrl = await cropCircularAvatar(buffer, extracted.avatarCrop);
        if (avatarDataUrl) {
          const saved = await saveProjectAsset(project.projectId, {
            kind: 'logo',
            filename: 'logo.png',
            dataUrl: avatarDataUrl,
          }, targetDir, new Date(), { logoColorAnalyzer: context.logoColorAnalyzer });
          project = saved.project;
        }
      } catch (err) {
        console.error('[content-central] prospect avatar crop failed:', err.message);
      }
    }

    return sendJson(res, 201, { project, extracted });
  }

  if (method === 'GET' && route === '/api/commercial/catalog') {
    return sendJson(res, 200, { items: await listCommercialCatalogItems(targetDir) });
  }

  if (method === 'POST' && route === '/api/commercial/catalog') {
    const body = await readBody(req);
    const item = await saveCommercialCatalogItem(body, targetDir);
    return sendJson(res, 200, { item });
  }

  if (method === 'POST' && route.startsWith('/api/commercial/catalog/') && route.endsWith('/delete')) {
    const id = decodeURIComponent(route.slice('/api/commercial/catalog/'.length, -'/delete'.length));
    const result = await deleteCommercialCatalogItem(id, targetDir);
    return sendJson(res, 200, result);
  }

  if (method === 'GET' && route === '/api/commercial/prospeccao') {
    return sendJson(res, 200, { items: await listCommercialProspects(targetDir) });
  }

  if (method === 'POST' && route === '/api/commercial/prospeccao') {
    const body = await readBody(req);
    const item = await saveCommercialProspect(body, targetDir);
    return sendJson(res, 200, { item });
  }

  if (method === 'POST' && route.startsWith('/api/commercial/prospeccao/') && route.endsWith('/delete')) {
    const id = decodeURIComponent(route.slice('/api/commercial/prospeccao/'.length, -'/delete'.length));
    const result = await deleteCommercialProspect(id, targetDir);
    return sendJson(res, 200, result);
  }

  if (method === 'GET' && route === '/api/commercial/agency') {
    return sendJson(res, 200, { agency: await getCommercialAgency(targetDir) });
  }

  if (method === 'POST' && route === '/api/commercial/agency') {
    const body = await readBody(req);
    const agency = await saveCommercialAgency(body, targetDir);
    return sendJson(res, 200, { agency });
  }

  if (method === 'POST' && route === '/api/commercial/agency/logo') {
    const body = await readBody(req);
    const agency = await saveCommercialAgencyLogo(body, targetDir);
    return sendJson(res, 200, { agency });
  }

  if (method === 'GET' && route.startsWith('/api/commercial/assets/')) {
    return sendCommercialAsset(res, targetDir, route.slice('/api/commercial/assets/'.length));
  }

  if (method === 'GET' && route === '/api/commercial/processes') {
    return sendJson(res, 200, { processes: await listCommercialProcesses(targetDir) });
  }

  if (method === 'POST' && route === '/api/commercial/processes') {
    const body = await readBody(req);
    const process_ = await saveCommercialProcess(body, targetDir);
    return sendJson(res, 200, { process: process_ });
  }

  if (method === 'GET' && route === '/api/commercial/portfolio') {
    return sendJson(res, 200, { items: await listCommercialPortfolioItems(targetDir) });
  }

  if (method === 'POST' && route === '/api/commercial/portfolio') {
    const body = await readBody(req);
    const item = await saveCommercialPortfolioItem(body, targetDir);
    return sendJson(res, 201, { item });
  }

  if (method === 'POST' && route.startsWith('/api/commercial/portfolio/') && route.endsWith('/delete')) {
    const id = decodeURIComponent(route.slice('/api/commercial/portfolio/'.length, -'/delete'.length));
    const result = await deleteCommercialPortfolioItem(id, targetDir);
    return sendJson(res, 200, result);
  }

  if (method === 'GET' && route === '/api/commercial/proposals') {
    return sendJson(res, 200, { proposals: await listCommercialProposals(targetDir) });
  }

  if (method === 'POST' && route === '/api/commercial/proposals') {
    const body = await readBody(req);
    const proposal = await saveCommercialProposal(body, targetDir);
    return sendJson(res, 201, { proposal });
  }

  if (method === 'GET' && route.startsWith('/api/commercial/proposals/') && !route.endsWith('/delete')) {
    const id = decodeURIComponent(route.slice('/api/commercial/proposals/'.length));
    const proposal = await getCommercialProposal(id, targetDir);
    return sendJson(res, 200, { proposal });
  }

  if (method === 'POST' && route.startsWith('/api/commercial/proposals/') && route.endsWith('/delete')) {
    const id = decodeURIComponent(route.slice('/api/commercial/proposals/'.length, -'/delete'.length));
    const result = await deleteCommercialProposal(id, targetDir);
    return sendJson(res, 200, result);
  }

  const parts = route.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'api' || parts[1] !== 'projects' || !parts[2]) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const projectId = parts[2];
  if (method === 'GET' && parts.length === 4 && parts[3] === 'content') {
    const content = await listProjectContent(projectId, targetDir);
    return sendJson(res, 200, { content: await syncGavetePublishedContent(projectId, targetDir, content) });
  }

  if (method === 'GET' && parts.length >= 5 && parts[3] === 'assets') {
    return sendProjectAsset(res, targetDir, projectId, parts.slice(4).join('/'));
  }

  if (method === 'GET' && parts.length >= 5 && parts[3] === 'assets-preview') {
    return sendProjectAssetPreview(res, targetDir, projectId, parts.slice(4).join('/'));
  }

  if (method === 'GET' && parts.length === 4 && parts[3] === 'commemorative-dates') {
    const months = Math.min(12, Math.max(1, Number(url.searchParams.get('months')) || 3));
    const now = new Date();
    const from = now.toISOString().slice(0, 10);
    const toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()));
    const to = toDate.toISOString().slice(0, 10);
    return sendJson(res, 200, { dates: listCommemorativeDates(from, to) });
  }

  if (method === 'GET' && parts.length === 4 && parts[3] === 'ad-creatives') {
    return sendJson(res, 200, { adCreatives: await listAdCreatives(projectId, targetDir) });
  }

  if (method === 'GET' && parts.length === 4 && parts[3] === 'briefing') {
    const [projects, content] = await Promise.all([
      listCentralProjects(targetDir),
      listProjectContent(projectId, targetDir),
    ]);
    const project = projects.find((entry) => entry.projectId === projectId);
    if (!project) return sendJson(res, 404, { error: 'Project not found' });
    const items = content.filter((item) => item.status !== 'aprovado');
    return sendHtml(res, renderBriefingPage(project, items));
  }

  if (method === 'GET' && parts.length === 4 && parts[3] === 'prospect-mockup') {
    const [projects, content] = await Promise.all([
      listCentralProjects(targetDir),
      listProjectContent(projectId, targetDir),
    ]);
    const project = projects.find((entry) => entry.projectId === projectId);
    if (!project) return sendJson(res, 404, { error: 'Project not found' });
    const feedItems = content.filter((item) => item.channel === 'instagram_feed');
    const storyItems = content.filter((item) => item.channel === 'instagram_story');
    return sendHtml(res, renderProspectMockupPage(project, feedItems, storyItems));
  }

  if (method === 'GET' && parts.length === 5 && parts[3] === 'whatsapp-instance' && parts[4] === 'status') {
    const projects = await listCentralProjects(targetDir);
    const project = projects.find((entry) => entry.projectId === projectId);
    if (!project) return sendJson(res, 404, { error: 'Project not found' });
    const result = await getProjectWhatsAppConnectionStatus(projectId, project);
    return sendJson(res, 200, result);
  }

  if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  if (parts.length === 3) {
    const result = await deleteCentralProject(projectId, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'duplicate') {
    const body = await readBody(req);
    const project = await duplicateCentralProject(projectId, body, targetDir);
    return sendJson(res, 201, { project });
  }

  if (parts.length === 4 && parts[3] === 'token') {
    const body = await readBody(req);
    const validation = body.expiresAt
      ? {
          expiresAt: normalizeExpiry(body.expiresAt),
          permissions: body.permissions || [],
          account: body.handle ? { handle: body.handle } : undefined,
        }
      : await validateMetaToken(body.token);
    const project = await saveProjectToken(projectId, {
      token: body.token,
      expiresAt: validation.expiresAt,
      permissions: validation.permissions,
      account: {
        ...(validation.account || {}),
        ...(body.handle ? { handle: body.handle } : {}),
      },
    }, targetDir);
    let githubSyncWarning;
    try {
      await syncTokenSecretsToGitHub(projectId, {
        token: body.token,
        // The real frontend (content-central-app/src/api/client.ts) only
        // ever sends { token, handle } — never an `account` object. The real
        // IDs live on the project record, populated by validateMetaToken
        // inside saveProjectToken above; read them from its return value,
        // not from a shape the client never sends.
        instagramUserId: project.instagram?.instagramUserId,
        pageId: project.instagram?.pageId,
      }, { execFileAsync: execFileAsyncForRoutes });
    } catch (err) {
      // The token is already saved to disk at this point — a gh failure
      // (not installed/authenticated, API error) shouldn't turn a
      // successful save into a 500. Surface it as a warning instead.
      console.error(`Failed to sync GitHub secrets for project ${projectId}:`, err);
      githubSyncWarning = err.message;
    }
    return sendJson(res, 200, { project, validation, ...(githubSyncWarning ? { githubSyncWarning } : {}) });
  }

  if (parts.length === 5 && parts[3] === 'whatsapp-instance' && parts[4] === 'connect') {
    const projects = await listCentralProjects(targetDir);
    const project = projects.find((entry) => entry.projectId === projectId);
    if (!project) return sendJson(res, 404, { error: 'Project not found' });
    const result = await connectProjectWhatsAppSession(projectId, project, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'company-profile') {
    const body = await readBody(req);
    const project = await updateProjectCompanyProfile(projectId, body, targetDir);
    return sendJson(res, 200, { project });
  }

  if (parts.length === 4 && parts[3] === 'brand-input') {
    const body = await readBody(req);
    const project = await updateProjectBrandInput(projectId, body, targetDir);
    return sendJson(res, 200, { project });
  }

  if (parts.length === 5 && parts[3] === 'technical-base' && parts[4] === 'analyze') {
    const body = await readBody(req);
    const result = await analyzeProjectTechnicalBase(projectId, body, targetDir, new Date(), { technicalAnalyzer: context.technicalAnalyzer });
    return sendJson(res, 200, result);
  }

  // "Melhorar bio" — the operator's rough draft goes through one AI pass to
  // tighten/polish it; the caller drops the result straight into the same
  // state the live preview already reads from, no extra fetch needed.
  if (parts.length === 4 && parts[3] === 'improve-bio') {
    const body = await readBody(req);
    if (typeof context.bioImprover !== 'function') {
      return sendJson(res, 501, { error: 'Melhoria de bio por IA não está disponível neste servidor.' });
    }
    const bio = await context.bioImprover({
      bio: String(body.bio || ''),
      segment: String(body.segment || ''),
      businessName: String(body.businessName || ''),
    });
    if (!bio) return sendJson(res, 502, { error: 'A IA não retornou uma bio melhorada.' });
    return sendJson(res, 200, { bio });
  }

  if (parts.length === 4 && parts[3] === 'site-analyze') {
    const body = await readBody(req);
    if (typeof context.siteAnalyzer !== 'function') {
      return sendJson(res, 501, { error: 'Análise de site não está disponível neste servidor.' });
    }
    const result = await context.siteAnalyzer({ url: body.url, text: body.text });
    return sendJson(res, 200, result);
  }

  if (parts.length === 5 && parts[3] === 'brand-xray' && parts[4] === 'analyze') {
    const body = await readBody(req);
    const result = await analyzeProjectBrandXray(projectId, body, targetDir, new Date(), { brandAnalyzer: context.brandAnalyzer });
    return sendJson(res, 200, result);
  }

  if (parts.length === 5 && parts[3] === 'brand-xray' && parts[4] === 'approve') {
    const body = await readBody(req);
    const result = await approveProjectBrandXray(projectId, body, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 5 && parts[3] === 'brand-briefing' && parts[4] === 'analyze') {
    const body = await readBody(req);
    const result = await analyzeProjectBrandBriefing(projectId, body, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 5 && parts[3] === 'brand-briefing' && parts[4] === 'approve') {
    const body = await readBody(req);
    const result = await approveProjectBrandBriefing(projectId, body, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'assets') {
    const body = await normalizeUploadedImageAsset(await readBody(req));
    const asset = await saveProjectAsset(projectId, body, targetDir, new Date(), { logoColorAnalyzer: context.logoColorAnalyzer });
    return sendJson(res, 201, { asset });
  }

  if (parts.length === 4 && parts[3] === 'references-delete') {
    const body = await readBody(req);
    const result = await deleteProjectReference(projectId, body.relativePath, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'references-update') {
    const body = await readBody(req);
    const result = await updateProjectReference(projectId, body.relativePath, body, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'image-rules') {
    const body = await readBody(req);
    const project = await updateProjectImageRules(projectId, {
      visualStyle: body.visualStyle || '',
      imageRules: body.imageRules || [],
    }, targetDir);
    return sendJson(res, 200, { project });
  }

  if (parts.length === 4 && parts[3] === 'catalog-settings') {
    const body = await readBody(req);
    const project = await updateCatalogSettings(projectId, {
      catalogGeneralInfo: body.catalogGeneralInfo || '',
      catalogStoriesPerDay: body.catalogStoriesPerDay,
    }, targetDir);
    return sendJson(res, 200, { project });
  }

  if (parts.length === 4 && parts[3] === 'research-online') {
    if (typeof context.webResearcher !== 'function') {
      return sendJson(res, 501, { error: 'Pesquisa online não está disponível neste servidor.' });
    }
    const result = await researchOnlineVisualTrends(projectId, { webResearcher: context.webResearcher }, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'offers') {
    const body = await readBody(req);
    const result = await saveProjectOffer(projectId, body, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 5 && parts[3] === 'offers' && parts[4] === 'suggest-direction') {
    const body = await readBody(req);
    const imageContext = await collectOfferDirectionImagePaths(projectId, body, targetDir);
    const project = (await listCentralProjects(targetDir)).find((item) => item.projectId === projectId) || {};
    const brandInput = project.brandInput || {};
    const companyProfile = project.companyProfile || {};
    try {
      if (typeof context.offerDirectionSuggester === 'function') {
        const notes = await context.offerDirectionSuggester({
          projectId,
          name: String(body.name || ''),
          price: String(body.price || ''),
          items: String(body.items || ''),
          type: String(body.type || ''),
          audienceType: String(brandInput.audienceType || companyProfile.audienceType || ''),
          productsOrServices: String(brandInput.productsOrServices || companyProfile.productsOrServices || ''),
          segment: String(brandInput.segment || companyProfile.segment || ''),
          imagePaths: imageContext.imagePaths,
        });
        if (notes && String(notes).trim()) return sendJson(res, 200, { notes: normalizeOfferDirectionText(notes), source: 'ai' });
      }
      return sendJson(res, 200, { notes: fallbackOfferDirectionText({ ...body, audienceType: brandInput.audienceType || companyProfile.audienceType }), source: 'fallback' });
    } finally {
      await Promise.all(imageContext.tempPaths.map((filePath) => rm(filePath, { force: true }).catch(() => {})));
    }
  }

  if (parts.length === 4 && parts[3] === 'offers-delete') {
    const body = await readBody(req);
    const result = await deleteProjectOffer(projectId, body.offerId, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'offer-groups') {
    const body = await readBody(req);
    const result = await saveProjectOfferGroup(projectId, body, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'offer-groups-delete') {
    const body = await readBody(req);
    const result = await deleteProjectOfferGroup(projectId, body.groupId, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'pillars') {
    const body = await readBody(req);
    const result = await saveProjectPillar(projectId, body, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'pillars-delete') {
    const body = await readBody(req);
    const result = await deleteProjectPillar(projectId, body.pillarId, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'pillars-suggest') {
    const body = await readBody(req);
    const result = await suggestProjectPillars(projectId, { pillarSuggester: context.pillarSuggester, extraContext: body.extraContext }, targetDir);
    return sendJson(res, 200, result);
  }

  if (parts.length === 4 && parts[3] === 'generate') {
    const body = await readBody(req);
    const imageOptions = { imageGenerator: context.imageGenerator, imageReviewer: context.imageReviewer, captionGenerator: context.captionGenerator, videoAnimator: context.videoAnimator };
    if (Array.isArray(body.formats) && body.formats.length) {
      const formats = body.formats.map((format) => ({
        ...format,
        channel: normalizeChannels({ channel: format.channel })[0],
      }));
      const batch = await generateContentSchedulePlan(projectId, {
        days: Number(body.days),
        startDate: body.startDate,
        formats,
        contentRules: splitRules(body.contentRules),
        groupIds: Array.isArray(body.groupIds) ? body.groupIds : undefined,
        offersOnly: Boolean(body.offersOnly),
        approvedPlan: body.approvedPlan,
      }, targetDir);
      enqueueBatchImageGeneration(projectId, batch, imageOptions, targetDir);
      return sendJson(res, 201, { batch, batches: [batch] });
    }
    const channels = normalizeChannels(body);
    const batches = [];
    for (const channel of channels) {
      const batch = await generateContentBatch(projectId, {
        days: Number(body.days),
        startDate: body.startDate,
        channel,
        contentRules: splitRules(body.contentRules),
        groupIds: Array.isArray(body.groupIds) ? body.groupIds : undefined,
        offersOnly: Boolean(body.offersOnly),
      }, targetDir);
      enqueueBatchImageGeneration(projectId, batch, imageOptions, targetDir);
      batches.push(batch);
    }
    return sendJson(res, 201, { batch: batches[0], batches });
  }

  // Pre-generation planning step for "Agenda e geração": returns the same
  // regular slots the generator would create, plus holiday/commercial-date
  // extras for the selected period. It does not write drafts or call image AI;
  // the operator reviews this summary before clicking the real generate path.
  if (parts.length === 4 && parts[3] === 'plan') {
    const body = await readBody(req);
    const formats = Array.isArray(body.formats) && body.formats.length
      ? body.formats.map((format) => ({ ...format, channel: normalizeChannels({ channel: format.channel })[0] }))
      : [];
    const plan = await previewContentSchedulePlan(projectId, {
      days: Number(body.days),
      startDate: body.startDate,
      formats,
      groupIds: Array.isArray(body.groupIds) ? body.groupIds : undefined,
      offersOnly: Boolean(body.offersOnly),
    }, targetDir);
    return sendJson(res, 200, { plan });
  }

  // A one-off creative for a national holiday or commercial date (Dia das
  // Mães, Black Friday...), independent of the normal offer/pillar
  // rotation — see generateSpecialDateContent.
  if (parts.length === 4 && parts[3] === 'generate-special-date') {
    const body = await readBody(req);
    const imageOptions = { imageGenerator: context.imageGenerator, imageReviewer: context.imageReviewer, captionGenerator: context.captionGenerator, videoAnimator: context.videoAnimator };
    const batch = await generateSpecialDateContent(projectId, {
      date: body.date,
      label: body.label,
      // Accepts either the original singular `channel` or a plural
      // `channels` list — picking several formats for the same date must
      // reach generateSpecialDateContent as one call so it can share a
      // creative across same-shape channels, instead of the caller looping
      // and paying for a separate AI generation per format.
      channels: (body.channel || body.channels) ? normalizeChannels(body) : undefined,
      offerId: body.offerId,
      postTime: body.postTime,
    }, targetDir);
    enqueueBatchImageGeneration(projectId, batch, imageOptions, targetDir);
    return sendJson(res, 201, { batch });
  }

  // Adapts a registered segment template (see registerSegmentTemplate) for
  // this project instead of generating art from scratch — the fast path for
  // a new prospecting lead in a segment we already have approved art for.
  // Fire-and-forget, same shape as generate-special-date/ad-creatives above:
  // the panel polls listProjectContent for the resulting items.
  if (parts.length === 4 && parts[3] === 'adapt-segment-template') {
    const body = await readBody(req);
    const segmentId = String(body.segmentId || '').trim();
    if (!segmentId) return sendJson(res, 400, { error: 'Informe o segmentId do template.' });
    if (typeof context.imageGenerator !== 'function') return sendJson(res, 202, { queued: false });
    enqueueSegmentTemplateAdaptation(projectId, segmentId, { imageGenerator: context.imageGenerator }, targetDir);
    return sendJson(res, 202, { queued: true });
  }

  // Ad creatives (paid traffic) — a separate concept from every organic
  // route above: no scheduledDate, no approval, no calendar. The operator
  // runs the campaign themselves in Ads Manager; this only produces the
  // creative asset + copy variations. (GET listing lives up with the other
  // GET routes, above the POST-only guard.)
  if (parts.length === 4 && parts[3] === 'ad-creatives') {
    const body = await readBody(req);
    // "format" resolves to one or two AI generations — "ambos" runs Story
    // and Feed as two independent ad creatives (each gets its own
    // composition rules), not one image reused across both shapes.
    const channels = body.format === 'story'
      ? ['instagram_story']
      : body.format === 'both' || body.format === 'ambos'
        ? ['instagram_story', 'instagram_feed']
        : ['instagram_feed'];
    const imageOptions = {
      imageGenerator: context.imageGenerator,
      imageReviewer: context.imageReviewer,
      adCopyGenerator: context.adCopyGenerator,
      note: body.note,
      noteMode: body.noteMode,
    };
    const adCreatives = [];
    for (const channel of channels) {
      const adCreative = await generateAdCreative(projectId, {
        objective: body.objective,
        offerId: body.offerId,
        note: body.note,
        noteMode: body.noteMode,
        channel,
      }, targetDir);
      enqueueAdCreativeImageGeneration(projectId, adCreative, imageOptions, targetDir);
      adCreatives.push(adCreative);
    }
    return sendJson(res, 201, { adCreatives });
  }

  if (parts.length === 5 && parts[3] === 'ad-creatives-delete') {
    await deleteAdCreative(projectId, parts[4], targetDir);
    return sendJson(res, 200, { deleted: true });
  }

  // "Regenerar só a imagem" (no note) or "Pedido de alteração" (with note —
  // targeted edit of the existing image) for one already-generated ad
  // creative. Copy variations stay untouched.
  if (parts.length === 5 && parts[3] === 'ad-creatives-regenerate') {
    const body = await readBody(req);
    const adCreative = await regenerateAdCreative(projectId, parts[4], targetDir);
    enqueueAdCreativeImageGeneration(projectId, adCreative, {
      imageGenerator: context.imageGenerator,
      imageReviewer: context.imageReviewer,
      note: body.note,
      skipCopy: true,
    }, targetDir);
    return sendJson(res, 200, { adCreative });
  }

  // Parallel endpoint for catalog (venda direta) projects: no formats/channels
  // matrix, no AI art — generateCatalogSchedulePlan round-robins active
  // products to Instagram Story, then enqueueCatalogImageGeneration composes
  // each real product photo locally in the background.
  if (parts.length === 4 && parts[3] === 'generate-catalog') {
    const body = await readBody(req);
    const catalogOptions = { catalogImageComposer: context.catalogImageComposer, captionGenerator: context.captionGenerator };
    const batch = await generateCatalogSchedulePlan(projectId, {
      days: Number(body.days),
      startDate: body.startDate,
      storiesPerDay: Number(body.storiesPerDay),
      startTime: body.startTime,
      intervalMinutes: Number(body.intervalMinutes),
    }, targetDir);
    enqueueCatalogImageGeneration(projectId, batch, catalogOptions, targetDir);
    return sendJson(res, 201, { batch, batches: [batch] });
  }

  if (parts.length === 4 && parts[3] === 'test-post') {
    const body = await readBody(req);
    const channel = normalizeChannels({ channel: body.channel })[0];
    const content = await simulateTestPost(projectId, {
      channel,
      note: body.note || '',
      maxCreativeAttempts: normalizeTestMaxCreativeAttempts(body.maxCreativeAttempts),
      imageGenerator: context.imageGenerator,
      imageReviewer: context.imageReviewer,
    }, targetDir);
    return sendJson(res, 201, {
      content,
      message: 'Simulação criada. Não publica de verdade e não chama a API Meta.',
    });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'regenerate') {
    const body = await readBody(req);
    const content = await regenerateContentDay(projectId, parts[4], {
      regenerate: body.regenerate || 'creative',
      note: body.note || '',
      batchId: body.batchId,
      imageGenerator: context.imageGenerator,
      imageReviewer: context.imageReviewer,
      captionGenerator: context.captionGenerator,
      catalogImageComposer: context.catalogImageComposer,
      ...resolveGaveteSync(targetDir, projectId),
    }, targetDir);
    return sendJson(res, 200, { content });
  }

  if (parts.length === 4 && parts[3] === 'content-group-regenerate') {
    const body = await readBody(req);
    const items = await regenerateContentGroup(projectId, body.contentIds, {
      regenerate: body.regenerate || 'creative',
      note: body.note || '',
      batchId: body.batchId,
      imageGenerator: context.imageGenerator,
      imageReviewer: context.imageReviewer,
      captionGenerator: context.captionGenerator,
      catalogImageComposer: context.catalogImageComposer,
      ...resolveGaveteSync(targetDir, projectId),
    }, targetDir);
    return sendJson(res, 200, { items });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'caption') {
    const body = await readBody(req);
    const content = await updateContentCaption(projectId, parts[4], body.text, targetDir, body.batchId);
    return sendJson(res, 200, { content });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'animate-reels') {
    if (typeof context.videoAnimator !== 'function') {
      return sendJson(res, 501, { error: 'Animação de vídeo não está disponível neste servidor (ffmpeg não configurado).' });
    }
    const body = await readBody(req);
    const content = await animateContentForReels(projectId, parts[4], {
      batchId: body.batchId,
      videoAnimator: context.videoAnimator,
    }, targetDir);
    return sendJson(res, 200, { content });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'approval') {
    const body = await readBody(req);
    const payload = await buildApprovalPayload(projectId, parts[4], targetDir, body.batchId);
    return sendJson(res, 201, { payload });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'approve') {
    const body = await readBody(req);
    const content = await approveContent(projectId, parts[4], targetDir, body.batchId, resolveGaveteSync(targetDir, projectId));
    return sendJson(res, 200, { content });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'publish') {
    if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') {
      return sendJson(res, 403, { error: 'Publicação real desligada. Defina OPENSQUAD_ENABLE_REAL_PUBLISHING=true no .env pra ativar.' });
    }
    const body = await readBody(req);
    const content = await publishWithGaveteSync(projectId, parts[4], targetDir, body.batchId);
    return sendJson(res, 200, { content });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'delete') {
    const body = await readBody(req);
    const result = await deleteProjectContent(projectId, parts[4], targetDir, body.batchId, body.reason, resolveGaveteSync(targetDir, projectId));
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: 'Not found' });
}


function splitRules(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split('\n').map((line) => line.trim()).filter(Boolean);
}

function normalizeChannels(body) {
  const channels = Array.isArray(body.channels) ? body.channels : [body.channel || 'instagram_feed'];
  const selected = channels.map((channel) => String(channel).trim()).filter(Boolean);
  const normalized = selected.length ? selected : ['instagram_feed'];
  const unsupported = normalized.find((channel) => !API_SUPPORTED_CHANNELS.has(channel));
  if (unsupported) throw new Error(`Canal não suportado pela API atual: ${unsupported}`);
  return normalized;
}

function normalizeTestMaxCreativeAttempts(value) {
  const configured = value ?? process.env.OPENSQUAD_TEST_MAX_CREATIVE_ATTEMPTS ?? 1;
  const numeric = Number(configured);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(5, Math.max(1, Math.trunc(numeric)));
}

function normalizeExpiry(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T23:59:59.000Z`;
  return value;
}

// Shared by sendProjectAsset and sendProjectAssetPreview — resolves a
// requested relative path to the real file on disk, or null if it escapes
// the project's own asset folder.
function resolveSafeAssetPath(targetDir, projectId, relativePath) {
  const safeRelative = normalize(relativePath).replace(/^([/\\])+/, '');
  if (!safeRelative.startsWith('assets')) return { safeRelative: null, filePath: null };
  const projectRoot = resolve(targetDir, '_opensquad', 'content-central', 'projects', projectId);
  const filePath = resolve(join(projectRoot, safeRelative));
  if (!filePath.startsWith(projectRoot)) return { safeRelative: null, filePath: null };
  return { safeRelative, filePath, projectRoot };
}

function offerDirectionTempExtension(mimeType) {
  if (/jpe?g/i.test(mimeType)) return '.jpg';
  if (/webp/i.test(mimeType)) return '.webp';
  if (/gif/i.test(mimeType)) return '.gif';
  return '.png';
}

async function collectOfferDirectionImagePaths(projectId, body, targetDir) {
  const imagePaths = [];
  const tempPaths = [];
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(String(body?.imageDataUrl || ''));
  if (dataUrlMatch) {
    const [, mimeType, base64] = dataUrlMatch;
    const tempPath = join(tmpdir(), `opensquad-offer-direction-${Date.now()}-${Math.random().toString(36).slice(2)}${offerDirectionTempExtension(mimeType)}`);
    await writeFile(tempPath, Buffer.from(base64, 'base64'));
    imagePaths.push(tempPath);
    tempPaths.push(tempPath);
  }

  const ids = new Set(Array.isArray(body?.photoReferenceIds) ? body.photoReferenceIds.map(String) : []);
  if (ids.size) {
    const project = (await listCentralProjects(targetDir)).find((item) => item.projectId === projectId);
    const references = [...(project?.offerAssets || []), ...(project?.brand?.references || [])];
    for (const reference of references) {
      if (!ids.has(String(reference?.id || ''))) continue;
      const { filePath } = resolveSafeAssetPath(targetDir, projectId, reference.relativePath || '');
      if (filePath) imagePaths.push(filePath);
    }
  }
  return { imagePaths, tempPaths };
}

function normalizeOfferDirectionText(text) {
  return String(text || '')
    .replace(/^```(?:text)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function fallbackOfferDirectionText(body = {}) {
  const text = `${body.name || ''} ${body.items || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hasSealingCue = /zip ?lock|\bzip\b|lacre|adesiv|fechamento|tampa|rosca|vedac|veda/.test(text);
  if (/limp|microfibra|pano|esponja|detergente|desinfetante|rodo|vassoura|saco de lixo/.test(text)) {
    return 'Direcionamento: produto de limpeza. Tom prático e direto. Chamada sugerida: Mais praticidade na limpeza do dia a dia. Promessas básicas permitidas: praticidade, uso recorrente, apoio à rotina de limpeza. Benefícios permitidos: limpeza prática, multiuso, apoio para casa/carro/cozinha/escritório. Não prometer que não risca, antibacteriano ou qualidade superior sem comprovação.';
  }
  if (/sacola|\bsaco\b|sacos|saquinho|sacaria/.test(text)) {
    if (hasSealingCue) {
      return 'Direcionamento: embalagem para organização, proteção e fechamento no atendimento. Tom comercial e B2B. Chamada sugerida: Fechamento prático para embalar com mais segurança. Promessas básicas permitidas: praticidade, fechamento/vedação quando indicado no cadastro, organização e reposição fácil. Benefícios permitidos: apoio ao balcão/delivery, embalagem mais organizada, fechamento prático. Não prometer vedação hermética, resistência exata, impermeabilidade ou conservação superior sem comprovação.';
    }
    return 'Direcionamento: sacolas/sacos para rotina comercial e reposição. Tom direto para operação, balcão e estoque. Chamada sugerida: Sacolas resistentes para acompanhar o ritmo do seu negócio. Promessas básicas permitidas: resistência para uso comercial, reforço quando indicado no título/foto, praticidade e reposição fácil. Benefícios permitidos: apoio ao atendimento, organização do estoque, embalagem prática para o dia a dia. Não prometer carga/peso suportado, material específico, impermeabilidade ou garantia sem cadastro.';
  }
  if (/guardanapo|papel toalha|toalha interfolha/.test(text)) {
    return 'Direcionamento: descartável para atendimento, balcão e delivery. Tom prático e B2B. Chamada sugerida: Mais praticidade para servir com organização. Promessas básicas permitidas: absorção para rotina de atendimento, reposição fácil e apoio ao serviço. Benefícios permitidos: apoio ao balcão/delivery, praticidade para servir, organização da operação. Não prometer folha dupla, maciez premium, resistência molhada ou rendimento exato sem cadastro.';
  }
  if (/copo|prato|talher|canudo/.test(text)) {
    return 'Direcionamento: descartável para servir clientes com praticidade. Tom comercial e direto. Chamada sugerida: Descartáveis para manter seu atendimento sempre pronto. Promessas básicas permitidas: praticidade para servir, reposição fácil e agilidade no atendimento. Benefícios permitidos: apoio a bebidas/refeições, rotina de balcão, delivery e eventos. Não prometer resistência, material, temperatura suportada ou capacidade além do cadastrado.';
  }
  if (/marmita|pote|tampa|bandeja/.test(text)) {
    return 'Direcionamento: embalagem para organizar, montar e entregar pedidos. Tom B2B para operação. Chamada sugerida: Embalagens com fechamento prático para sua rotina. Promessas básicas permitidas: organização, fechamento prático quando houver tampa, apoio ao delivery e reposição fácil. Benefícios permitidos: montagem de pedidos, organização da operação, atendimento mais ágil. Não prometer vedação hermética, conservação superior, material, capacidade ou uso térmico sem cadastro.';
  }
  if (/filme|aluminio|papel manteiga|bobina/.test(text)) {
    return 'Direcionamento: item de apoio para embalar, separar e proteger na rotina da operação. Tom B2B e prático. Chamada sugerida: Mais praticidade para embalar no ritmo do seu negócio. Promessas básicas permitidas: praticidade para embalar, proteção básica no manuseio, organização e reposição fácil. Benefícios permitidos: apoio ao preparo, balcão/delivery e rotina de embalagem. Não prometer conservação superior, resistência, rendimento exato ou uso térmico sem cadastro.';
  }
  if (/food|marmita|pote|copo|talher|prato|guardanapo|delivery|embalagem|isopor|aluminio|filme/.test(text)) {
    return 'Direcionamento: produto para food-service/embalagem. Tom profissional e B2B. Chamada sugerida: Mais praticidade para sua operação. Promessas básicas permitidas: praticidade, economia operacional, reposição fácil, organização da rotina e apoio ao balcão/delivery. Benefícios permitidos: organização do atendimento, reposição fácil, apresentação profissional, apoio ao balcão/delivery. Não prometer certificação, material, capacidade, resistência, conservação superior ou uso térmico não cadastrado.';
  }
  return 'Direcionamento: produto/oferta comercial. Tom claro e direto. Criar 1 chamada de valor baseada apenas no nome/detalhes cadastrados. Promessas básicas permitidas: praticidade, economia de tempo e facilidade de reposição quando compatível com o cadastro. Benefícios permitidos: usar somente características escritas neste cadastro. Não prometer garantia, desempenho, material, desconto ou prova não informada.';
}

async function sendProjectAsset(res, targetDir, projectId, relativePath) {
  const { filePath } = resolveSafeAssetPath(targetDir, projectId, relativePath);
  if (!filePath) return sendJson(res, 400, { error: 'Asset inválido' });
  const body = await readFile(filePath);
  res.writeHead(200, { 'content-type': assetContentType(filePath), 'cache-control': 'no-store' });
  res.end(body);
}

async function sendCommercialAsset(res, targetDir, filename) {
  const paths = getCentralPaths(targetDir);
  const safeFile = basename(String(filename || ''));
  if (!safeFile) return sendJson(res, 400, { error: 'Asset inválido' });
  const filePath = join(paths.commercialAssetsDir, safeFile);
  let body;
  try {
    body = await readFile(filePath);
  } catch {
    return sendJson(res, 404, { error: 'Not found' });
  }
  res.writeHead(200, { 'content-type': assetContentType(filePath), 'cache-control': 'no-store' });
  res.end(body);
}

// Segment-template art is shared and reused across many prospects, but NOT
// immutable — a piece gets overwritten in place (same filename) whenever the
// operator regenerates it (new price, logo fix, swapped product, etc.), and
// a long cache here means a browser that already loaded the old bytes keeps
// showing them for a day. Confirmed live: after regenerating a piece, the
// same browser session kept rendering the stale version until this was
// changed to no-store. Same policy as sendProjectAsset above.
async function sendSegmentTemplateImage(res, targetDir, segmentId, filename) {
  const safeSegment = String(segmentId || '').replace(/[^a-z0-9-]/gi, '');
  const safeFile = basename(String(filename || ''));
  if (!safeSegment || !safeFile) return sendJson(res, 400, { error: 'Peça inválida' });
  const dir = resolve(targetDir, '_opensquad', 'content-central', 'segment-templates', safeSegment, 'images');
  const filePath = resolve(join(dir, safeFile));
  if (!filePath.startsWith(dir)) return sendJson(res, 400, { error: 'Peça inválida' });
  let body;
  try {
    body = await readFile(filePath);
  } catch {
    return sendJson(res, 404, { error: 'Peça não encontrada' });
  }
  res.writeHead(200, { 'content-type': assetContentType(filePath), 'cache-control': 'no-store' });
  res.end(body);
}

// Reference images uploaded for segment/offer-type learning entries — global
// assets with no per-project home (see analyzeLearningImage in
// content-central.js), served the same no-store way as sendProjectAsset and
// sendSegmentTemplateImage above.
async function sendLearningAsset(res, targetDir, relativePath) {
  const safeRelative = normalize(relativePath).replace(/^([/\\])+/, '');
  const learningRoot = resolve(targetDir, '_opensquad', 'content-central', 'assets', 'learning');
  const filePath = resolve(join(learningRoot, safeRelative));
  if (filePath !== learningRoot && !filePath.startsWith(learningRoot + sep)) return sendJson(res, 400, { error: 'Referência inválida' });
  let body;
  try {
    body = await readFile(filePath);
  } catch {
    return sendJson(res, 404, { error: 'Referência não encontrada' });
  }
  res.writeHead(200, { 'content-type': assetContentType(filePath), 'cache-control': 'no-store' });
  res.end(body);
}

const BRIEFING_PREVIEW_MAX_WIDTH = 640;
const BRIEFING_PREVIEW_JPEG_QUALITY = 78;

// The panel/calendar always shows the full-resolution generated PNG (2-4MB
// each — fine for one card at a time in the app). The client-facing
// presentation page shows every pending card on one page and offers a PDF
// export, so those same full-res images add up fast: a project with ~20
// pending posts produced a 50MB+ PDF before this existed. This serves a
// resized, compressed JPEG instead — generated once per source image and
// cached to disk under assets/previews/, not recomputed on every request.
async function sendProjectAssetPreview(res, targetDir, projectId, relativePath) {
  const { safeRelative, filePath, projectRoot } = resolveSafeAssetPath(targetDir, projectId, relativePath);
  if (!filePath) return sendJson(res, 400, { error: 'Asset inválido' });
  const ext = extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    // Not a raster photo we know how to shrink (e.g. the SVG placeholder
    // used before a real image finishes generating) — serve it untouched.
    return sendProjectAsset(res, targetDir, projectId, relativePath);
  }

  const previewDir = join(projectRoot, 'assets', 'previews');
  const previewPath = join(previewDir, `${safeRelative.replace(/[\\/]/g, '__')}.jpg`);
  try {
    const cached = await readFile(previewPath);
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
    return res.end(cached);
  } catch {
    // No cached preview yet — fall through and generate one.
  }

  const original = await readFile(filePath);
  const image = await Jimp.read(original);
  if (image.bitmap.width > BRIEFING_PREVIEW_MAX_WIDTH) {
    image.resize({ w: BRIEFING_PREVIEW_MAX_WIDTH });
  }
  const jpegBuffer = await image.getBuffer('image/jpeg', { quality: BRIEFING_PREVIEW_JPEG_QUALITY });
  await mkdir(previewDir, { recursive: true });
  await writeFile(previewPath, jpegBuffer).catch(() => {});
  res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
  res.end(jpegBuffer);
}

function assetContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.txt' || ext === '.md') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

// The official React panel (content-central-app/), a static SPA build served
// directly by this Node server: known asset paths are read straight from
// dist/, and every other GET route under "/" or "/projects" falls back to
// index.html so React Router's client-side routes work on a hard refresh.
const REACT_APP_DIST_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'content-central-app', 'dist');

function reactAppContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff2') return 'font/woff2';
  return assetContentType(filePath);
}

async function sendReactApp(res, subPath) {
  const cleanRelative = String(subPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const isAssetRequest = cleanRelative && extname(cleanRelative) && !cleanRelative.includes('..');
  const filePath = isAssetRequest ? resolve(REACT_APP_DIST_ROOT, cleanRelative) : resolve(REACT_APP_DIST_ROOT, 'index.html');
  if (!filePath.startsWith(REACT_APP_DIST_ROOT)) return sendJson(res, 400, { error: 'Caminho inválido' });
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': reactAppContentType(filePath) });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return sendJson(res, 404, { error: 'Painel novo não foi buildado ainda. Rode "npm run build" em content-central-app/.' });
    }
    throw err;
  }
}

// An operator's "Pedido de alteração" is a fix to one thing, not a request
// for a new piece — the full brief below (used for a from-scratch
// composition) explicitly tells the model to change "at least 3 items" on
// every pass, which is exactly what turns a small correction into an
// unrelated new image. When there's a real image to edit, skip that whole
// brief and ask for a narrow edit instead, so everything not named in the
// note stays as it was.
// The realism/anti-AI-look technique guidance below normally only reaches
// the model as part of the full from-scratch brief — a targeted edit skips
// that brief entirely (see buildAiImageGenerationPrompt), so a correction
// like "isso ficou com cara de IA" had nothing but the bare note to act on.
// Repeating it here means an edit note asking for more realism actually has
// the same concrete technique vocabulary (texture, uneven lighting, no
// plastic sheen) to work with, not just an abstract complaint.
const TARGETED_EDIT_REALISM_LINES = [
  'Ao aplicar o ajuste, evite aparência de IA: nada de plástico, brilho falso, simetria perfeita demais, textura lisa demais, letras embaralhadas ou texto duplicado.',
  'Detalhes que denunciam IA e devem ser evitados: materiais artificiais, brilho de verniz, superfícies sem imperfeições, saturação exagerada, anatomia/geometria incoerente e luz de estúdio genérica sem contexto real.',
  'Prefira: materiais e texturas realistas, pequenas imperfeições naturais, iluminação coerente com a cena e profundidade de campo plausível.',
];

function buildTargetedEditPrompt({ content, note }) {
  const isVertical = isVerticalStoryChannel(content.channel);
  return [
    'Esta é uma EDIÇÃO pontual da imagem anexada (primeira imagem de referência) — não é uma peça nova.',
    'Preserve exatamente o restante da composição: mesmo layout, mesmo produto/foto, mesmas cores, mesma tipografia, mesmo texto e a mesma posição de cada elemento.',
    'Se o pedido citar logo/marca, ajuste somente a logo: não trocar fundo, produto, cena, enquadramento, materiais, texto, preço ou CTA.',
    `Ajuste solicitado (mude apenas isso, nada mais): ${note}`,
    'Não gere uma composição nova nem varie ângulo, fundo, enquadramento ou qualquer outro elemento além do pedido acima.',
    ...TARGETED_EDIT_REALISM_LINES,
    isVertical ? 'Mantenha o formato Story vertical 9:16 exatamente como está.' : 'Mantenha o formato de Feed exatamente como está.',
    // Confirmed live (2026-08-07): the raw image_gen output doesn't always
    // land on the exact target aspect ratio, and when it doesn't, the
    // pipeline pads the gap with a blurred/stretched extension of the image
    // instead of cropping — showing up as visible blur bars on the edges of
    // real ad creatives. Same fix already proven for segment-template art.
    'Gere preenchendo o quadro inteiro de ponta a ponta, sem nenhuma barra, faixa ou borda desfocada/esticada adicionada em qualquer lado — o conteúdo precisa ir até a borda da imagem nos quatro lados.',
    'Não publique nada. Não chame API Meta. Só gere a imagem.',
    'Retorne no final apenas a URL direta da imagem gerada, sem markdown e sem explicação.',
  ].filter(Boolean).join('\n');
}

export function buildAiImageGenerationPrompt({ content, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false, targetedEdit = false } = {}) {
  if (targetedEdit && !rescueMode && note) return buildTargetedEditPrompt({ content, note });
  const referencePaths = Array.isArray(content.image?.references)
    ? content.image.references
      .filter((reference) => String(reference.mimeType || '').startsWith('image/'))
      .map((reference) => `${reference.absolutePath} (${reference.role}, peso ${reference.weight}: ${reference.instruction || 'sem instrução'})`)
    : [];
  const aspectRatio = content.image?.aspectRatio || 'portrait';
  const dimensions = content.image?.dimensions
    ? `${content.image.dimensions.width}x${content.image.dimensions.height}`
    : 'formato definido pelo briefing';
  return [
    contentCentralPersonaLine('clara'),
    contentCentralPersonaResponsibilityLine('clara'),
    'Use o ChatGPT/OpenAI Images para criar a arte final completa no formato solicitado pelo briefing.',
    `Canal solicitado no Teste seguro: ${content.formatLabel || content.channel}. Não trocar por outro canal.`,
    `Formato obrigatório: composição ${aspectRatio}; tamanho planejado: ${dimensions}.`,
    rescueMode ? 'MODO RESGATE ATIVO: a prioridade absoluta é corrigir formato/canvas. Gere do zero, sem reaproveitar a composição anterior.' : '',
    content.channel === 'instagram_story' ? 'Este teste é STORY: criar composição 9:16 vertical nativa, com topo, centro e base bem aproveitados. Não gerar Feed nem flyer quadrado centralizado.' : '',
    content.channel === 'instagram_reels' ? 'Este teste é REELS: criar composição 9:16 vertical nativa, com impacto rápido e texto curto. Não gerar Feed nem flyer quadrado centralizado.' : '',
    content.channel === 'facebook_story' ? 'Este é um Facebook Story: criar composição 9:16 vertical nativa, com topo, centro e base bem aproveitados. Não gerar Feed nem flyer quadrado centralizado.' : '',
    content.channel === 'instagram_feed' ? 'Este teste é FEED: gerar arte de Feed, não Story.' : '',
    content.channel === 'facebook_feed' ? 'Este é um Facebook Feed: gerar arte de Feed, não Story.' : '',
    referencePaths.length ? 'Se disponíveis, use as imagens de referência abaixo como base visual real, sem copiar textos, marcas ou preços não autorizados:' : '',
    referencePaths.length ? referencePaths.join('\n') : '',
    referencePaths.length ? 'As fotos de produto (product_photo) são a referência de realismo obrigatória: preserve a mesma qualidade de foto real — iluminação verdadeira de ambiente real (não estúdio genérico), textura e material reais do produto/serviço mostrado, ângulo de câmera de foto tirada por pessoa, pequenas imperfeições naturais. Pode ajustar o que o assunto pedir, mas a FOTOGRAFIA precisa parecer tirada da mesma sessão da referência, não uma composição publicitária genérica gerada do zero.' : '',
    rescueMode ? 'No modo resgate, mantenha o modelo de layout como estrutura de zonas e hierarquia. Adapte sua proporção ao canal sem copiar moldura externa, textos, marca ou produto da referência.' : '',
    'Gere um criativo final completo e bonito: layout, produto, título, preço, CTA e logo integrados na própria imagem.',
    'Não haverá overlay automático de texto depois. Tipografia, preço, CTA e logo precisam ficar bonitos, legíveis e naturais dentro da arte.',
    'Use as referências como direção visual/produto/estilo, mas não copie textos, preços, logos ou marcas das referências.',
    // Confirmed live (2026-08-07): the raw image_gen output doesn't always
    // land on the exact target aspect ratio, and when it doesn't, the
    // pipeline pads the gap with a blurred/stretched extension of the image
    // instead of cropping — showing up as visible blur bars on the edges of
    // real ad creatives. Same fix already proven for segment-template art.
    'Gere preenchendo o quadro inteiro de ponta a ponta, sem nenhuma barra, faixa ou borda desfocada/esticada adicionada em qualquer lado — o conteúdo precisa ir até a borda da imagem nos quatro lados.',
    'Não publique nada. Não chame API Meta. Só gere a imagem.',
    'Retorne no final apenas a URL direta da imagem gerada, sem markdown e sem explicação.',
    '',
    'Briefing do criativo:',
    content.image.prompt,
    note ? `Observação do usuário: ${note}` : '',
    'Estilo obrigatório: criativo publicitário profissional, coerente com o segmento e a direção visual já definidos no briefing acima (não assumir alimentação/comida a menos que o briefing diga isso), não render 3D genérico e não foto solta artificial.',
    'Importante: se o briefing contiver "Variação criativa de teste" ou "Conceito do teste", siga essa variação como prioridade. Não gere novamente o mesmo layout, mesma foto ou mesma distribuição do criativo anterior.',
    'A cada teste, mudar claramente pelo menos 3 itens: cena principal, enquadramento, acabamento, elemento visual de destaque, fundo ou sensação visual — sem contrariar modelo estrutural, oferta e marca.',
    'Evitar retângulo branco gigante, moldura simples, box de preço ruim ou qualquer texto ilegível/falso.',
    isVerticalStoryChannel(content.channel)
      ? 'Obrigatório: a arte precisa nascer como Story vertical nativo 9:16, preenchendo o canvas sem parecer flyer quadrado. Distribuir topo, centro e base; preço compacto sem cobrir o produto protagonista.'
      : '',
    reviewFeedback ? `Tentativa ${attempt} de ${maxAttempts}: refazer porque o Agente Revisor bloqueou a tentativa anterior. Corrigir obrigatoriamente:\n${reviewFeedback}` : '',
    rescueMode ? 'Regra final do modo resgate: preservar Story 9:16 real e adaptar as zonas do modelo estrutural ao canvas; nunca abandonar silenciosamente o modelo.' : '',
    'Evite aparência de IA: nada de plástico, brilho falso, simetria perfeita demais, letras embaralhadas, texto falso ou texto duplicado.',
    'Detalhes que denunciam IA e devem ser evitados: materiais artificiais, geometria incoerente, superfícies sem imperfeições, saturação exagerada e luz de estúdio genérica sem contexto real.',
    'Prefira: iluminação natural coerente com a cena, materiais/texturas plausíveis, pequenas imperfeições e profundidade de campo realista para o segmento do projeto.',
  ].filter(Boolean).join('\n');
}

export async function generateAiImageForActiveProvider(payload) {
  const provider = String(process.env.OPENSQUAD_IMAGE_PROVIDER || 'openai').trim().toLowerCase();
  if (provider === 'xai' || provider === 'grok') return generateAiImageWithXai(payload);
  if (provider === 'nous' || provider === 'nous-fal' || provider === 'fal') return generateAiImageWithNousFal(payload);
  if (provider === 'codex' || provider === 'openai-codex' || provider === 'chatgpt') return generateAiImageWithCodex(payload);
  // Opt-in alternate to 'codex' above — same account/login, different
  // transport (a real `codex exec` agent turn instead of a direct HTTP call
  // to an internal endpoint). See generateAiImageWithCodexAgent for why.
  if (provider === 'codex-agent' || provider === 'codex_agent') return generateAiImageWithCodexAgent(payload);
  return generateAiImageWithChatGpt(payload);
}

// Picks which references requestOpenAiImageEdit's `image[]` (capped at 4
// total, canvas included) actually gets. Two rules layered on top of the
// project's own array order:
// - a layout_model reference (composition inspiration borrowed from another
//   project's approved creative) must never be the sole/leading reference —
//   with no real project reference alongside it, that would silently flip a
//   from-scratch generation into "edit this foreign image". If there are no
//   non-layout references, drop layout ones entirely.
// - otherwise, reserve it one of the `capacity` slots instead of letting a
//   well-configured project's own 4+ references push it out by array
//   position alone (buildImageReferencePayload always appends it last).
export function selectOpenAiImageEditReferences(references, capacity = 4) {
  const primary = references.filter((reference) => reference.role !== 'layout_model');
  if (!primary.length) return primary;
  const layout = references.filter((reference) => reference.role === 'layout_model');
  // Only take a 2nd layout_model slot (structure + the additive segment
  // product reference) when primary still gets everything it has even
  // after reserving both slots — the operator's own logo/product photos
  // must never be displaced by the generic segment product reference.
  // Capping at 1 slot here still keeps the structure reference (it's
  // always first in `layout`, see buildSegmentLayoutReferences/
  // buildPrimaryAiImageReferences) and only drops the product reference.
  const maxLayoutSlots = primary.length <= Math.max(capacity - 2, 0) ? 2 : 1;
  const layoutSlots = Math.min(layout.length, Math.max(capacity, 0), maxLayoutSlots);
  return [...primary.slice(0, Math.max(capacity - layoutSlots, 0)), ...layout.slice(0, layoutSlots)];
}

async function generateAiImageWithChatGpt({ content, projectId, targetDir, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false, targetedEdit = false }) {
  const editBasePath = targetedEdit
    ? await resolveExistingGeneratedImagePath(content, projectId, targetDir)
    : null;
  const isTargetedEdit = Boolean(editBasePath);
  const prompt = buildAiImageGenerationPrompt({ content, note, attempt, maxAttempts, reviewFeedback, rescueMode, targetedEdit: isTargetedEdit });
  const apiKey = process.env.OPENSQUAD_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('ChatGPT/OpenAI Images não configurado. Defina OPENAI_API_KEY ou OPENSQUAD_OPENAI_API_KEY antes de gerar imagens IA.');
  }

  const model = process.env.OPENSQUAD_OPENAI_IMAGE_MODEL || 'gpt-image-1';
  const imageSize = process.env.OPENSQUAD_OPENAI_IMAGE_SIZE || openAiImageSizeForChannel(content?.channel);
  const rawReferences = Array.isArray(content.image?.references)
    ? content.image.references.filter((reference) => reference.absolutePath && String(reference.mimeType || '').startsWith('image/'))
    : [];
  // The edit canvas (when targeted) takes one of the 4 image[] slots, so
  // only the rest is available for references.
  const imageReferences = selectOpenAiImageEditReferences(rawReferences, isTargetedEdit ? 3 : 4);
  // The image being edited must lead the list — /images/edits has no other
  // way to say "this one is the canvas, the rest are just style/identity
  // references".
  const editImages = isTargetedEdit
    ? [{ absolutePath: editBasePath, mimeType: 'image/png' }, ...imageReferences]
    : imageReferences;

  const response = editImages.length
    ? await requestOpenAiImageEdit({ apiKey, model, prompt, imageSize, imageReferences: editImages })
    : await requestOpenAiImageGeneration({ apiKey, model, prompt, imageSize });
  const image = response?.data?.[0];
  if (!image?.url && !image?.b64_json) throw new Error('ChatGPT/OpenAI Images não retornou uma imagem. Tente novamente.');
  const targetDimensions = content.image?.dimensions;
  const url = await resolveOpenAiGeneratedImageUrl({ image, projectId, targetDir, targetDimensions });
  return {
    url,
    mimeType: 'image/png',
    prompt: content.image.prompt,
    provider: 'chatgpt_openai',
  };
}

async function requestOpenAiImageGeneration({ apiKey, model, prompt, imageSize }) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      size: imageSize,
      quality: process.env.OPENSQUAD_OPENAI_IMAGE_QUALITY || 'medium',
      n: 1,
    }),
  });
  return parseOpenAiImageResponse(response);
}

async function requestOpenAiImageEdit({ apiKey, model, prompt, imageSize, imageReferences }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', imageSize);
  form.append('quality', process.env.OPENSQUAD_OPENAI_IMAGE_QUALITY || 'medium');
  for (const reference of imageReferences.slice(0, 4)) {
    const buffer = await readFile(reference.absolutePath);
    const blob = new Blob([buffer], { type: reference.mimeType || 'image/png' });
    form.append('image[]', blob, String(reference.relativePath || reference.absolutePath).split(/[\\/]/).pop() || 'reference.png');
  }
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text();
    if (/image\[\]|image/i.test(text)) return requestOpenAiImageGeneration({ apiKey, model, prompt, imageSize });
    throw new Error(`ChatGPT/OpenAI Images falhou: ${text}`);
  }
  return response.json();
}

async function parseOpenAiImageResponse(response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`ChatGPT/OpenAI Images falhou: ${text}`);
  return JSON.parse(text);
}

export function openAiImageSizeForChannel(channel) {
  if (channel === 'instagram_feed' || channel === 'facebook_feed') return '1024x1536';
  if (isVerticalStoryChannel(channel)) return '1024x1536';
  return '1024x1024';
}

// xAI's Images API only accepts a fixed set of aspect_ratio strings — Instagram
// Feed's 4:5 isn't one of them, so "3:4" (0.75) is the closest supported ratio.
export function xaiAspectRatioForChannel(channel) {
  if (isVerticalStoryChannel(channel)) return '9:16';
  if (channel === 'instagram_feed' || channel === 'facebook_feed') return '3:4';
  return '1:1';
}

async function generateAiImageWithXai({ content, projectId, targetDir, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false }) {
  const prompt = buildAiImageGenerationPrompt({ content, note, attempt, maxAttempts, reviewFeedback, rescueMode });
  const apiKey = await resolveXaiAccessToken();
  if (!apiKey) {
    throw new Error('xAI/Grok Imagine não configurado. Faça login com `hermes model` (xAI OAuth/SuperGrok) ou defina XAI_API_KEY antes de gerar imagens IA.');
  }

  const model = process.env.OPENSQUAD_XAI_IMAGE_MODEL || 'grok-imagine-image';
  const resolution = process.env.OPENSQUAD_XAI_IMAGE_RESOLUTION || '1k';
  const aspectRatio = xaiAspectRatioForChannel(content?.channel);

  const response = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, prompt, aspect_ratio: aspectRatio, resolution }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`xAI/Grok Images falhou: ${text}`);
  const parsed = JSON.parse(text);
  const image = parsed?.data?.[0];
  if (!image?.url && !image?.b64_json) throw new Error('xAI/Grok Images não retornou uma imagem. Tente novamente.');

  // xAI's generated URLs are ephemeral (imgen.x.ai/xai-tmp-*, expire within
  // minutes) — fetch the bytes immediately instead of storing the raw URL.
  const rawBuffer = image.b64_json
    ? Buffer.from(image.b64_json, 'base64')
    : Buffer.from(await (await fetch(image.url)).arrayBuffer());
  const croppedBuffer = await cropOpenAiImageToChannel(rawBuffer, content.image?.dimensions);
  const url = await saveOpenAiGeneratedImage({ buffer: croppedBuffer, projectId, targetDir, filenamePrefix: 'xai' });
  return {
    url,
    mimeType: 'image/png',
    prompt: content.image.prompt,
    provider: 'xai_grok',
  };
}

// Resolves a bearer token for api.x.ai. Prefers the xAI OAuth (SuperGrok)
// credential already managed/refreshed by the Hermes agent installed on this
// machine — reusing its auth store avoids reimplementing xAI's OAuth/PKCE
// flow and token refresh here. Falls back to a plain XAI_API_KEY.
async function resolveXaiAccessToken() {
  const hermesToken = await resolveXaiAccessTokenViaHermes();
  if (hermesToken) return hermesToken;
  return process.env.XAI_API_KEY || process.env.OPENSQUAD_XAI_API_KEY || '';
}

function resolveHermesPython() {
  const hermesHome = process.env.OPENSQUAD_HERMES_AGENT_DIR
    || join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent');
  const pythonBin = process.platform === 'win32'
    ? join(hermesHome, 'venv', 'Scripts', 'python.exe')
    : join(hermesHome, 'venv', 'bin', 'python');
  return { hermesHome, pythonBin };
}

async function resolveXaiAccessTokenViaHermes() {
  const { hermesHome, pythonBin } = resolveHermesPython();
  try {
    const { stdout } = await execFileAsync(pythonBin, [
      '-c',
      'from hermes_cli.auth import resolve_xai_oauth_runtime_credentials as r; print(r().get("api_key") or "")',
    ], { cwd: hermesHome, timeout: 20000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

// Writes a genuinely tailored brand Raio-X (as opposed to the deterministic
// fill-in-the-blanks template in content-central.js) by asking a real model
// to reason about the user's own inputs. Reuses the same xAI/SuperGrok
// credential as image generation — no separate key to configure. Returns
// null on any failure (missing credentials, network error, bad JSON) so the
// caller can fall back to the template without ever blocking the user.
export async function generateBrandXrayWithAi({ project }) {
  const input = project?.brandInput || {};
  if (!input.brandName && !input.segment) return null;
  const apiKey = await resolveXaiAccessToken();
  if (!apiKey) return null;

  const identity = project.brandIdentity || {};
  const colors = [...(identity.editedColors || []), ...(identity.extractedColors || [])];

  const prompt = [
    'Você é um estrategista de marca e conteúdo para pequenos negócios locais no Brasil.',
    'Com base SOMENTE nas informações abaixo, escreva um Raio-X da marca em 4 blocos e sugira como completar campos vazios ou claramente fracos.',
    '',
    `Nome: ${input.brandName || project.name || ''}`,
    `Setor principal confirmado: ${input.segmentGroup || 'não informado'}`,
    `Tipo de negócio / nicho confirmado: ${input.segmentCategory || 'não informado'}`,
    `Especialidade / subnicho confirmado: ${input.segmentSpecialty || 'não informado'}`,
    `Segmento: ${input.segment || 'não informado'}`,
    `O que vende/oferece: ${input.productsOrServices || 'não informado'}`,
    input.description ? `Sobre a empresa: ${input.description}` : '',
    `Região de atendimento: ${input.serviceRegion || 'não informada'}`,
    `Principal diferencial: ${input.mainDifferential || 'não informado'}`,
    `Objetivos das postagens: ${(input.contentGoals || []).join(', ') || 'não informados'}`,
    `Foco comercial confirmado: ${input.audienceType || 'não informado'} (b2b=empresas/revendedores; b2c=consumidor final; mixed=ambos)`,
    input.audience ? `Público-alvo: ${input.audience}` : '',
    (input.tone || []).length ? `Tom de voz desejado: ${input.tone.join(', ')}` : '',
    input.positioning ? `Posicionamento desejado: ${input.positioning}` : '',
    input.websiteOrInstagram ? `Site/Instagram informado apenas como identificação para os criativos: ${input.websiteOrInstagram}` : '',
    input.factualConstraints ? `Fatos que PODEM ser citados (verdadeiros, informados pelo usuário): ${input.factualConstraints}` : '',
    colors.length ? `Cores da identidade visual: ${colors.join(', ')}` : '',
    input.brandColors ? `Cores da marca (descrição do usuário): ${input.brandColors}` : '',
    '',
    'Regras obrigatórias:',
    '- Não invente preço, promoção, endereço, prêmio, número de clientes ou qualquer fato que não foi informado acima.',
    '- Separe claramente, dentro do texto, o que foi informado pelo usuário do que é sugestão sua (ex: "Informado pelo usuário: ..." e "Sugestão da IA: ...").',
    '- Setor, nicho e subnicho são classificações confirmadas e vinculadas ao aprendizado externo. Não troque, corrija, amplie ou reclassifique esses campos.',
    '- Você só pode sugerir estes campos editáveis: audience, description, mainDifferential, positioning, tone e segment.',
    '- NUNCA devolva sugestões para segmentGroup, segmentCategory ou segmentSpecialty. Esses três campos são protegidos.',
    '- Em fieldSuggestions, sugira somente campos vazios ou fracos. Para segment, uma lista de produtos no lugar de uma descrição de segmento é um valor fraco.',
    '- Toda sugestão é hipótese para confirmação humana. Não trate variedade, qualidade, rapidez, preço ou atendimento como diferencial sem base nas informações fornecidas.',
    '- Se não houver base segura para sugerir um campo, omita esse campo do array em vez de inventar.',
    '- O Site/Instagram acima é apenas informativo: você NÃO acessou o perfil. Não alegue ter visto bio, feed, seguidores ou publicações.',
    '- Em communication, liste possíveis compradores específicos, decisores e situações de compra inferidos do negócio. Identifique tudo como hipótese para confirmação, não como fato.',
    '- Respeite o foco comercial: B2B fala de operação, estoque, reposição, atendimento, revenda e rotina da empresa; B2C fala com consumidor final; mixed separa os dois contextos.',
    '- Seja específico para este negócio; não escreva frases genéricas que serviriam para qualquer segmento.',
    '- Escreva em português do Brasil, tom comercial e direto, sem jargão de agência.',
    input.avoid ? `- NUNCA mencione, sugira ou aproxime-se do seguinte, o usuário pediu para evitar explicitamente: ${input.avoid}.` : '',
    '',
    'Responda APENAS com um JSON válido neste formato exato, sem markdown e sem texto fora do JSON:',
    '{"summary":"...","communication":"...","contentStrategy":"...","visualIdentity":"...","fieldSuggestions":[{"field":"audience","value":"...","reason":"...","confidence":"medium"}]}',
    '',
    '- summary: resumo da marca em 2 a 4 frases.',
    '- communication: compradores possíveis, situações de compra, posicionamento, tom de voz e personalidade recomendados.',
    '- contentStrategy: temas e direções de conteúdo coerentes com os objetivos escolhidos; diferencie venda com CTA de autoridade/educação/relacionamento/engajamento sem CTA comercial.',
    '- visualIdentity: direção visual recomendada, considerando as cores informadas (se houver) e o segmento.',
    '- fieldSuggestions: array opcional. field deve ser somente audience, description, mainDifferential, positioning, tone ou segment. value e reason são textos; confidence é low, medium ou high. Para tone, value é uma lista curta separada por vírgulas.',
  ].filter(Boolean).join('\n');

  const model = process.env.OPENSQUAD_XAI_TEXT_MODEL || 'grok-4.5';
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
    }),
  });
  if (!response.ok) return null;
  const parsed = await response.json();
  const text = parsed?.choices?.[0]?.message?.content;
  if (!text) return null;

  const jsonText = String(text).match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  try {
    const blocks = JSON.parse(jsonText);
    return {
      summary: String(blocks.summary || '').trim(),
      communication: String(blocks.communication || '').trim(),
      contentStrategy: String(blocks.contentStrategy || '').trim(),
      visualIdentity: String(blocks.visualIdentity || '').trim(),
      fieldSuggestions: Array.isArray(blocks.fieldSuggestions) ? blocks.fieldSuggestions : [],
    };
  } catch {
    return null;
  }
}

// Writes tailored content-pillar suggestions (as opposed to the generic
// Ensina/Prova/Posiciona/Convida fallback in buildSuggestedPillarsTemplate)
// by asking a real model to reason about the project's own brand info and
// already-registered offers — the same manual reasoning used to design the
// pillars for real client projects, automated. Reuses the same xAI/SuperGrok
// credential as the Raio-X analyzer. Returns null on any failure (missing
// credentials, network error, bad JSON) so the caller falls back to the
// deterministic template without ever blocking the operator.
export async function generatePillarSuggestionsWithAi({ project, extraContext = '' }) {
  const input = project?.brandInput || {};
  if (!input.brandName && !input.segment) return null;
  const apiKey = await resolveXaiAccessToken();
  if (!apiKey) return null;

  const xray = project.brandXray?.status === 'approved' ? project.brandXray.blocks : null;
  const offers = (project.contentStrategy?.offers || [])
    .filter((offer) => offer.active !== false)
    .map((offer) => `${offer.name} (${offer.type})`);

  const prompt = [
    'Você é um estrategista de conteúdo para redes sociais de pequenos negócios no Brasil.',
    'Com base SOMENTE nas informações abaixo, proponha de 3 a 5 pilares de conteúdo para este projeto — cada pilar precisa ter um "papel" estrutural fixo (ensina, prova, posiciona ou convida), mas o nome e o objetivo devem ser específicos deste negócio, não genéricos.',
    '',
    `Nome: ${input.brandName || project.name || ''}`,
    `Segmento: ${input.segment || 'não informado'}`,
    `O que vende/oferece: ${input.productsOrServices || 'não informado'}`,
    input.description ? `Sobre a empresa: ${input.description}` : '',
    `Principal diferencial: ${input.mainDifferential || 'não informado'}`,
    `Objetivos das postagens: ${(input.contentGoals || []).join(', ') || 'não informados'}`,
    xray ? `Resumo da marca (Raio-X aprovado): ${xray.summary?.text || ''}` : '',
    xray ? `Compradores e comunicação: ${xray.communication?.text || ''}` : '',
    offers.length ? `Ofertas/assuntos já cadastrados: ${offers.join('; ')}` : 'Nenhuma oferta/assunto cadastrado ainda.',
    extraContext ? `Contexto adicional informado pelo operador: ${extraContext}` : '',
    '',
    'Regras obrigatórias:',
    '- Cada pilar tem exatamente um "role": ensina, prova, posiciona ou convida (não invente outros valores).',
    '- O pilar de papel "prova" precisa de evidência real (resultado, número, depoimento). Se não houver nenhuma oferta/assunto cadastrado que sirva de evidência para esse pilar, ainda assim proponha o pilar, mas registre isso como uma pergunta em "clarifyingQuestions" pedindo esse dado ao operador — nunca invente um resultado.',
    '- Não invente preço, resultado de cliente, número ou qualquer fato que não foi informado acima.',
    '- Seja específico para este negócio; não use nomes de pilar genéricos como só "Ensina"/"Prova"/"Posiciona"/"Convida" a menos que realmente façam sentido.',
    '- "clarifyingQuestions" deve conter só perguntas realmente úteis para melhorar os pilares (ex: falta de caso real, segmento pouco claro); devolva um array vazio se não houver nenhuma.',
    '- Escreva em português do Brasil, tom direto, sem jargão de agência.',
    '',
    'Responda APENAS com um JSON válido neste formato exato, sem markdown e sem texto fora do JSON:',
    '{"pillars":[{"name":"...","role":"ensina|prova|posiciona|convida","objective":"...","visualTreatment":"cru|leve|desenhado","color":"#RRGGBB","weight":1,"requiresEvidence":false}],"clarifyingQuestions":["..."]}',
  ].filter(Boolean).join('\n');

  const model = process.env.OPENSQUAD_XAI_TEXT_MODEL || 'grok-4.5';
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
    }),
  });
  if (!response.ok) return null;
  const parsed = await response.json();
  const text = parsed?.choices?.[0]?.message?.content;
  if (!text) return null;

  const jsonText = String(text).match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  try {
    const result = JSON.parse(jsonText);
    if (!Array.isArray(result.pillars)) return null;
    return {
      pillars: result.pillars,
      clarifyingQuestions: Array.isArray(result.clarifyingQuestions) ? result.clarifyingQuestions : [],
    };
  } catch {
    return null;
  }
}

// Identifies actual brand colors in an uploaded logo using a vision-capable
// model — logos are frequently uploaded as mockup renders (plaque/sign with
// a shadow or glow backdrop), and a naive pixel histogram tends to pick the
// large neutral backdrop instead of the small but meaningful brand accent
// color. The model is explicitly told to ignore mockup/render backgrounds.
// Returns null on any failure so the caller falls back to local pixel
// extraction (content-central.js's extractDominantColors).
export async function identifyLogoColorsWithAi({ buffer, mimeType }) {
  const apiKey = await resolveXaiAccessToken();
  if (!apiKey) return null;

  const model = process.env.OPENSQUAD_XAI_VISION_MODEL || process.env.OPENSQUAD_XAI_TEXT_MODEL || 'grok-4.5';
  const dataUrl = `data:${mimeType || 'image/png'};base64,${buffer.toString('base64')}`;
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Esta é uma imagem de logo/placa de uma marca; ela pode ter um fundo de mockup/render ao redor (sombra, brilho, gradiente) — ignore completamente esse fundo. Liste de 3 a 5 cores oficiais da MARCA em si (texto, ícone, borda, símbolo). Responda APENAS com JSON válido, sem markdown: {"colors":["#RRGGBB", ...]}',
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
    }),
  });
  if (!response.ok) return null;
  const parsed = await response.json();
  const text = parsed?.choices?.[0]?.message?.content;
  if (!text) return null;

  const jsonText = String(text).match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  try {
    const colors = JSON.parse(jsonText)?.colors;
    return Array.isArray(colors) ? colors.map((color) => String(color || '').trim()) : null;
  } catch {
    return null;
  }
}

// Reads a screenshot of a prospect's real Instagram profile — same
// vision-call shape as identifyLogoColorsWithAi above, different prompt.
// Everything returned here is meant to be a literal readout of what's on
// screen (name, bio, real follower/post counts), never an invention — the
// prospecting mockup quotes these verbatim in its profile header. Returns
// null on any failure so the caller falls back to a blank form the operator
// fills in by hand instead of failing the whole "criar prospecção" request.
// The first version of this called xAI's HTTP API directly (same shape as
// identifyLogoColorsWithAi below) — but that needs its own XAI_API_KEY/
// OPENSQUAD_XAI_API_KEY, which turned out not to be configured on the
// operator's machine even though every other AI feature here (image
// generation, the creative reviewer, ad copy) already works, because those
// all go through the `hermes` CLI's own provider config instead. `hermes
// chat` genuinely supports a real local image attachment (`--image PATH`,
// confirmed via `hermes chat --help` — not a URL reference embedded in
// prompt text), so this uses that same already-working credential path
// instead of requiring a second, separately-configured one.
export async function analyzeProspectScreenshotWithHermes({ buffer, mimeType }) {
  const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  const imageFile = join(tmpdir(), `opensquad-prospect-screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await writeFile(imageFile, buffer);
  const prompt = [
    'Este é um print de tela de um perfil real do Instagram (visto pelo app no celular) — imagem anexada.',
    'Leia como uma pessoa rolando o perfil leria — não é OCR mecânico, é pra entender o que o perfil comunica.',
    'Extraia SÓ o que está literalmente visível nesse print. Não invente nada que não apareça na tela.',
    'Retorne APENAS JSON válido, sem markdown, neste formato exato:',
    '{"businessName":"","handle":"","nicheGuess":"","bioText":"","differentiators":["",""],"realFollowers":0,"realPosts":0,"realFollowing":0,"avatarCrop":{"xPct":0,"yPct":0,"sizePct":0}}',
    '- businessName: o nome do perfil como está escrito (não o @handle).',
    '- handle: o @handle exatamente como aparece.',
    '- nicheGuess: 2-4 palavras do ramo/nicho do negócio, inferido do que está visível (bio, categoria, fotos).',
    '- bioText: o texto da bio, literal.',
    '- differentiators: até 4 frases curtas, só o que está literalmente na bio/destaques (ex: "Aberto de segunda a sábado", "Melhor preço de Cuiabá") — não resuma nem invente diferencial que não esteja escrito.',
    '- realFollowers/realPosts/realFollowing: os números reais mostrados na tela, como inteiros simples (sem pontuação de milhar).',
    '- avatarCrop: a caixa delimitadora aproximada da FOTO DE PERFIL CIRCULAR, em percentual da largura/altura total da imagem do print inteiro (xPct/yPct = canto superior esquerdo da caixa, sizePct = lado da caixa quadrada que contém o círculo). Se não conseguir identificar, retorne null nesse campo.',
    'Se algum campo não estiver visível/legível no print, retorne null nesse campo em vez de adivinhar.',
  ].join('\n');

  try {
    // Same fix as the other callAiText call sites: hermes' openai-codex
    // plugin hits the same 429 usage-limit wall regardless of whether the
    // call carries an attached image, so this reads the print through the
    // real codex-agent path (which does support -i/--image for a real
    // attachment) instead of hermes' own --image flag.
    const raw = await callCodexAgentText(prompt, 'OPENSQUAD_PROSPECT_ANALYZE_TIMEOUT_MS', [imageFile]);
    if (!raw) return null;
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) return null;
    return normalizeProspectExtraction(JSON.parse(jsonText));
  } catch {
    return null;
  } finally {
    await rm(imageFile, { force: true }).catch(() => {});
  }
}

// Real counts sometimes come back as locale-formatted strings ("4.388")
// despite the prompt asking for plain integers — strip everything but
// digits rather than trust the model's number formatting.
function cleanProspectCount(value) {
  if (value === null || value === undefined) return null;
  const digitsOnly = String(value).replace(/[^\d]/g, '');
  if (!digitsOnly) return null;
  const num = Number(digitsOnly);
  return Number.isFinite(num) ? num : null;
}

function cleanProspectText(value) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

export function normalizeProspectExtraction(raw) {
  const box = raw?.avatarCrop;
  const pct = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 && num <= 100 ? num : null;
  };
  const avatarCrop = box && pct(box.xPct) !== null && pct(box.yPct) !== null && pct(box.sizePct) !== null
    ? { xPct: pct(box.xPct), yPct: pct(box.yPct), sizePct: pct(box.sizePct) }
    : null;
  return {
    businessName: cleanProspectText(raw?.businessName),
    handle: cleanProspectText(raw?.handle),
    nicheGuess: cleanProspectText(raw?.nicheGuess),
    bioText: cleanProspectText(raw?.bioText),
    differentiators: Array.isArray(raw?.differentiators)
      ? raw.differentiators.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : [],
    realFollowers: cleanProspectCount(raw?.realFollowers),
    realPosts: cleanProspectCount(raw?.realPosts),
    realFollowing: cleanProspectCount(raw?.realFollowing),
    avatarCrop,
  };
}

// Strips a raw HTML document down to plain readable text good enough to
// hand an LLM — not a real readability algorithm, just enough to drop
// script/style noise and tag soup so the prompt isn't dominated by markup.
export function htmlToReadableText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SITE_ANALYZE_MAX_CHARS = 8000;
const SITE_ANALYZE_PAGE_CHARS = 3000;
const SITE_ANALYZE_MAX_EXTRA_PAGES = 4;

// A plain Node fetch with no headers reads as an obvious bot to a lot of
// sites — this alone won't get past a real Cloudflare JS challenge, but it
// does clear simpler user-agent checks some sites use instead.
const SITE_FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

async function fetchRawHtml(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Use uma URL http:// ou https://.');
  }

  let response;
  try {
    response = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: SITE_FETCH_HEADERS });
  } catch (err) {
    throw new Error(`Não foi possível acessar essa URL: ${err.message}`, { cause: err });
  }
  if (!response.ok) throw new Error(`O site respondeu com erro (status ${response.status}).`);

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('html') && !contentType.includes('text')) {
    throw new Error('Essa URL não parece ser uma página web (html).');
  }

  const html = await response.text();
  return { html, finalUrl: response.url || parsed.toString() };
}

// Same-origin hrefs only — never follow off-site links (ads, social icons,
// payment processors) into the page text sent to the AI.
function extractInternalLinks(html, baseUrl) {
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return new Map();
  }
  const links = new Map();
  const anchorPattern = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = anchorPattern.exec(html);
  while (match !== null) {
    const [, href, innerHtml] = match;
    let absolute;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      match = anchorPattern.exec(html);
      continue;
    }
    if (absolute.startsWith(origin) && !links.has(absolute)) {
      const linkText = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      links.set(absolute, linkText);
    }
    match = anchorPattern.exec(html);
  }
  return links;
}

const RELEVANT_LINK_KEYWORDS = [
  'sobre', 'about', 'quem somos', 'institucional', 'empresa',
  'servico', 'serviço', 'service',
  'produto', 'product',
  'cardapio', 'cardápio', 'menu',
  'contato', 'contact',
];

// Picks a handful of same-site pages worth reading in addition to the one
// the operator pasted — "manda a URL principal" only gets the homepage,
// which is often just a hero banner with the real content (menu, services,
// about) one click away.
function pickRelevantLinks(linksMap, baseUrl, limit) {
  const picked = [];
  for (const [pageUrl, linkText] of linksMap) {
    if (pageUrl === baseUrl || picked.length >= limit) continue;
    const pathLower = decodeURIComponent(pageUrl).toLowerCase();
    const isRelevant = RELEVANT_LINK_KEYWORDS.some(
      (keyword) => linkText.includes(keyword) || pathLower.includes(keyword.replace(/\s+/g, '-')),
    );
    if (isRelevant) picked.push(pageUrl);
  }
  return picked;
}

export async function fetchSiteText(rawUrl) {
  const { html, finalUrl } = await fetchRawHtml(rawUrl);
  const mainText = htmlToReadableText(html);
  if (!mainText) throw new Error('Não encontrei texto legível nessa página.');

  const pages = [{ label: 'Página principal', text: mainText.slice(0, SITE_ANALYZE_PAGE_CHARS) }];

  const relevantLinks = pickRelevantLinks(extractInternalLinks(html, finalUrl), finalUrl, SITE_ANALYZE_MAX_EXTRA_PAGES);
  for (const link of relevantLinks) {
    try {
      const sub = await fetchRawHtml(link);
      const subText = htmlToReadableText(sub.html);
      if (subText) pages.push({ label: link, text: subText.slice(0, SITE_ANALYZE_PAGE_CHARS) });
    } catch {
      // Best-effort: a sub-page that 404s, times out or gets blocked just
      // gets skipped — the main page's text is still a usable result.
    }
  }

  return pages.map((page) => `=== ${page.label} ===\n${page.text}`).join('\n\n').slice(0, SITE_ANALYZE_MAX_CHARS);
}

// Imports company info (and, when the page looks like a digital menu,
// candidate offers) from a URL the operator pastes in — OR from raw text
// pasted directly, for sites protected by Cloudflare/anti-bot challenges
// that a plain server-side fetch can never pass (confirmed against a real
// anota.ai cardápio: even a realistic browser User-Agent still gets the
// Cloudflare "Attention Required" challenge page, not the menu). Same
// hermes-chat bridge as the caption pipeline, just prompted for structured
// JSON instead of prose. Extracted offers are never saved automatically:
// the panel shows them for the operator to pick before calling saveOffer,
// same as any other data entering the project.
export async function analyzeSiteWithAi({ url, text }) {
  const pastedText = String(text || '').trim();
  if (!pastedText && !String(url || '').trim()) {
    throw new Error('Informe a URL do site ou cole o texto do site/cardápio.');
  }
  const siteText = pastedText ? htmlToReadableText(pastedText).slice(0, SITE_ANALYZE_MAX_CHARS) : await fetchSiteText(url);

  const prompt = [
    'Você vai analisar o texto extraído de um site brasileiro (pode ser site institucional, cardápio digital, catálogo de WhatsApp, linktree etc.) e devolver informações estruturadas sobre a empresa.',
    '',
    'TEXTO DO SITE:',
    siteText,
    '',
    'Regras obrigatórias:',
    '- Extraia SOMENTE o que está explicitamente no texto acima. Nunca invente nome, preço, endereço, produto ou qualquer dado que não apareça.',
    '- Se não encontrar uma informação, devolva string vazia "" para o campo.',
    '- Se o texto tiver uma lista de produtos, serviços ou itens de catálogo — com ou sem preço (ex: catálogo de atacado onde o preço só é combinado por WhatsApp) — preencha "offers" com cada item encontrado. Coloque o preço no campo "price" quando ele aparecer no texto; deixe "price": "" quando não aparecer, mas ainda assim inclua o item. Só devolva "offers": [] se o texto realmente não tiver nenhuma lista de produtos/itens.',
    '- Preços devem vir exatamente como aparecem no texto (ex: "R$ 49,90"), sem recalcular ou arredondar.',
    '',
    'Responda APENAS com um JSON válido neste formato exato, sem markdown e sem texto fora do JSON:',
    '{"brandName":"","segment":"","productsOrServices":"","description":"","serviceRegion":"","mainDifferential":"","offers":[{"name":"","price":"","items":""}]}',
  ].join('\n');

  const raw = await callAiText(prompt, 'OPENSQUAD_SITE_ANALYZE_TIMEOUT_MS');
  if (!raw) throw new Error('Não foi possível analisar o site agora. Tente de novo em instantes.');

  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error('A análise não retornou um resultado legível.');

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('A análise não retornou um resultado legível.');
  }

  const cleanText = (value) => String(value || '').trim();
  return {
    brandInput: {
      brandName: cleanText(parsed.brandName),
      segment: cleanText(parsed.segment),
      productsOrServices: cleanText(parsed.productsOrServices),
      description: cleanText(parsed.description),
      serviceRegion: cleanText(parsed.serviceRegion),
      mainDifferential: cleanText(parsed.mainDifferential),
    },
    offers: Array.isArray(parsed.offers)
      ? parsed.offers
        .map((offer) => ({
          name: cleanText(offer?.name),
          price: cleanText(offer?.price),
          items: cleanText(offer?.items),
        }))
        .filter((offer) => offer.name)
      : [],
  };
}

// Nous Portal's managed FAL gateway — a separate, already-funded image
// generation path bundled into the user's Nous subscription (independent of
// xAI/SuperGrok credits or an OpenAI billing account). The async submit+poll
// dance against FAL's queue API, plus Nous OAuth auth, already lives in
// Hermes' own `fal_client`-based tool — reusing it via a Python subprocess
// avoids reimplementing that protocol here. The prompt is written to a temp
// file (not passed as an argv/stdin string) so long multi-paragraph creative
// briefs can't hit shell-escaping or argv-length limits.
export function nousFalAspectRatioForChannel(channel) {
  if (['instagram_feed', 'instagram_story', 'instagram_reels', 'facebook_feed', 'facebook_story', 'whatsapp_status'].includes(channel)) return 'portrait';
  return 'square';
}

async function callNousFalImageTool({ prompt, aspectRatio, model, referencePaths, hermesHome, pythonBin }) {
  const promptFile = join(tmpdir(), `opensquad-nous-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(promptFile, prompt, 'utf-8');
  try {
    const script = [
      'import sys, os',
      "sys.path.insert(0, '.')",
      `os.environ['FAL_IMAGE_MODEL'] = ${JSON.stringify(model)}`,
      'from tools.image_generation_tool import image_generate_tool',
      `with open(${JSON.stringify(promptFile)}, 'r', encoding='utf-8') as f:`,
      '    prompt_text = f.read()',
      `reference_paths = ${JSON.stringify(referencePaths)}`,
      `result = image_generate_tool(prompt=prompt_text, aspect_ratio=${JSON.stringify(aspectRatio)}, reference_image_urls=reference_paths)`,
      'print(result)',
    ].join('\n');
    const { stdout } = await execFileAsync(pythonBin, ['-c', script], {
      cwd: hermesHome,
      timeout: 90000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const jsonText = String(stdout || '').match(/\{[\s\S]*\}/)?.[0];
    return jsonText ? JSON.parse(jsonText) : null;
  } catch {
    return null;
  } finally {
    await rm(promptFile, { force: true }).catch(() => {});
  }
}

async function generateAiImageWithNousFal({ content, projectId, targetDir, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false }) {
  const prompt = buildAiImageGenerationPrompt({ content, note, attempt, maxAttempts, reviewFeedback, rescueMode });
  const aspectRatio = nousFalAspectRatioForChannel(content?.channel);
  const model = process.env.OPENSQUAD_NOUS_IMAGE_MODEL || 'fal-ai/gpt-image-2';
  const { hermesHome, pythonBin } = resolveHermesPython();

  // Attach a real product photo (e.g. an actual esfiha) as image-to-image
  // input when the active FAL model supports editing — a text-only "Foto
  // selecionada: <path>" mention in the prompt is not an attached image; the
  // model never sees those pixels unless we pass them here. Only
  // product_photo references are sent this way: image_generate_tool clamps
  // to each model's declared reference cap (often just 1), and the logo/
  // layout/visual references are meant as text-described inspiration, not
  // as an edit-mode source image — attaching the logo here would hijack the
  // whole generation into "edit this logo" instead of "draw this offer".
  const referencePaths = Array.isArray(content.image?.references)
    ? content.image.references
      .filter((reference) => reference.role === 'product_photo' && reference.absolutePath && String(reference.mimeType || '').startsWith('image/'))
      .slice(0, 2)
      .map((reference) => reference.absolutePath)
    : [];

  let parsed = await callNousFalImageTool({ prompt, aspectRatio, model, referencePaths, hermesHome, pythonBin });
  // Some models' /edit (image-to-image) endpoint isn't enabled on the Nous
  // managed gateway even though plain text-to-image works fine for the same
  // model — degrade to text-only instead of failing the whole generation.
  if ((!parsed?.success || !parsed?.image) && referencePaths.length) {
    parsed = await callNousFalImageTool({ prompt, aspectRatio, model, referencePaths: [], hermesHome, pythonBin });
  }
  if (!parsed?.success || !parsed?.image) throw new Error(`Nous/FAL Images falhou: ${parsed?.error || 'sem detalhes'}`);

  const rawBuffer = Buffer.from(await (await fetch(parsed.image)).arrayBuffer());
  const croppedBuffer = await cropOpenAiImageToChannel(rawBuffer, content.image?.dimensions);
  const url = await saveOpenAiGeneratedImage({ buffer: croppedBuffer, projectId, targetDir, filenamePrefix: 'nous' });
  return {
    url,
    mimeType: 'image/png',
    prompt: content.image.prompt,
    provider: 'nous_fal',
  };
}

// Shared by both Codex providers below (direct HTTP and agent transport):
// picks which of content.image.references are worth spending one of the
// provider's reference-image slots on. brand_asset/product_photo are real
// facts about the project and always come first; layout_model is borrowed
// composition inspiration from another project's approved creative, so it's
// capped to at most 1 and only fills a slot after the real references.
export function selectImageReferencesForCodex(imageReferences) {
  return [
    ...imageReferences.filter((reference) => reference.role === 'brand_asset').slice(0, 1),
    ...imageReferences.filter((reference) => reference.role === 'product_photo').slice(0, 2),
    ...imageReferences.filter((reference) => reference.role === 'layout_model').slice(0, 2),
  ];
}

// OpenAI images through the user's own ChatGPT/Codex login (OAuth), not the
// pay-per-token OPENAI_API_KEY path — this is what stays usable when the
// API billing account is capped but the ChatGPT/Codex subscription itself
// is fine. Routes through Hermes' openai-codex image_gen plugin, which talks
// to chatgpt.com/backend-api/codex (gpt-image-2) instead of api.openai.com.
// That plugin lives outside Hermes' normal package layout (a discovered
// plugin file, not an importable module path), so it's loaded via
// importlib.util.spec_from_file_location rather than a plain `import`.
async function generateAiImageWithCodex({ content, projectId, targetDir, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false, targetedEdit = false }) {
  // Resolve the existing image *before* building the prompt — if it isn't
  // actually one of our own generated assets (or is missing on disk), fall
  // back to a normal from-scratch prompt/generation instead of asking the
  // model to "edit" nothing.
  const editBasePath = targetedEdit
    ? await resolveExistingGeneratedImagePath(content, projectId, targetDir)
    : null;
  const isTargetedEdit = Boolean(editBasePath);
  const prompt = buildAiImageGenerationPrompt({ content, note, attempt, maxAttempts, reviewFeedback, rescueMode, targetedEdit: isTargetedEdit });
  const aspectRatio = nousFalAspectRatioForChannel(content?.channel);
  const { hermesHome, pythonBin } = resolveHermesPython();

  // Unlike Nous/FAL's single-reference edit endpoints, Codex's Responses API
  // accepts up to 16 input_image parts in one call, so there's no tradeoff
  // between "attach the logo" and "attach the product photo" (and one
  // layout reference) here — send all of them. The real logo goes first
  // (identity matters most and some models weight earlier reference images
  // more heavily); product photos follow, then the layout reference.
  const imageReferences = Array.isArray(content.image?.references)
    ? content.image.references.filter((reference) => reference.absolutePath && String(reference.mimeType || '').startsWith('image/'))
    : [];
  const referencePaths = selectImageReferencesForCodex(imageReferences).map((reference) => reference.absolutePath);

  const promptFile = join(tmpdir(), `opensquad-codex-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(promptFile, prompt, 'utf-8');

  let stdout;
  try {
    const script = [
      'import sys, json, importlib.util',
      "sys.path.insert(0, '.')",
      "spec = importlib.util.spec_from_file_location('codex_image_gen', 'plugins/image_gen/openai-codex/__init__.py')",
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'provider = mod.OpenAICodexImageGenProvider()',
      `with open(${JSON.stringify(promptFile)}, 'r', encoding='utf-8') as f:`,
      '    prompt_text = f.read()',
      `reference_paths = ${JSON.stringify(referencePaths)}`,
      // JSON has no way to spell Python's None — a JS null must become the
      // bare Python literal here, not the JSON text "null".
      `image_url = ${editBasePath ? JSON.stringify(editBasePath) : 'None'}`,
      `result = provider.generate(prompt=prompt_text, aspect_ratio=${JSON.stringify(aspectRatio)}, image_url=image_url, reference_image_urls=reference_paths)`,
      'print(json.dumps(result))',
    ].join('\n');
    ({ stdout } = await execFileAsync(pythonBin, ['-c', script], {
      cwd: hermesHome,
      timeout: 240000,
      maxBuffer: 10 * 1024 * 1024,
    }));
  } finally {
    await rm(promptFile, { force: true }).catch(() => {});
  }

  const jsonText = String(stdout || '').match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error('OpenAI (Codex) Images não retornou uma resposta válida.');
  const parsed = JSON.parse(jsonText);
  if (!parsed.success || !parsed.image) throw new Error(`OpenAI (Codex) Images falhou: ${parsed.error || 'sem detalhes'}`);

  const rawBuffer = await readFile(parsed.image);
  const croppedBuffer = await cropOpenAiImageToChannel(rawBuffer, content.image?.dimensions);
  const url = await saveOpenAiGeneratedImage({ buffer: croppedBuffer, projectId, targetDir, filenamePrefix: 'codex' });
  return {
    url,
    mimeType: 'image/png',
    prompt: content.image.prompt,
    provider: 'openai_codex',
  };
}

// Kept entirely separate from generateAiImageWithCodex above rather than
// replacing it, on purpose — that one calls an unofficial internal ChatGPT
// backend endpoint directly (single HTTP request pretending to be a Codex
// agent turn), which turned out to draw from a much smaller, separate usage
// bucket than a genuine interactive Codex session: a live side-by-side test
// on the very same account showed the account's own installed `imagegen`
// skill (a real `codex exec`/agent session using the built-in `image_gen`
// tool) still worked while the direct-HTTP path was already rate-limited.
// This shells out to a real `codex exec` agent turn instead, asking it to
// use that same built-in tool — same prompt content as the other providers
// (buildAiImageGenerationPrompt), just a different transport to the model.
// Opt in via OPENSQUAD_IMAGE_PROVIDER=codex-agent; the existing 'codex'
// value is untouched, so reverting is a one-line env change, not a code
// change, if this path turns out to be unreliable.
async function generateAiImageWithCodexAgent({ content, projectId, targetDir, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false, targetedEdit = false }) {
  // content.templateEditBasePath lets a caller point the edit base at a
  // file that isn't this project's own prior generation — e.g. a segment
  // template's approved reference image (see adaptSegmentTemplateForProspect)
  // — instead of the normal in-project lookup, which is URL-gated to this
  // exact project and would reject a foreign path.
  const editBasePath = targetedEdit
    ? (content.templateEditBasePath || await resolveExistingGeneratedImagePath(content, projectId, targetDir))
    : null;
  const isTargetedEdit = Boolean(editBasePath);
  const prompt = buildAiImageGenerationPrompt({ content, note, attempt, maxAttempts, reviewFeedback, rescueMode, targetedEdit: isTargetedEdit });

  const imageReferences = Array.isArray(content.image?.references)
    ? content.image.references.filter((reference) => reference.absolutePath && String(reference.mimeType || '').startsWith('image/'))
    : [];
  const referencePaths = [
    editBasePath,
    ...selectImageReferencesForCodex(imageReferences).map((reference) => reference.absolutePath),
  ].filter(Boolean);

  const outputDir = resolve(targetDir, '_opensquad', 'content-central', 'projects', projectId, 'assets', 'generated');
  await mkdir(outputDir, { recursive: true });

  // Asking the agent to copy its own output (the original approach) routes
  // through the same command-execution sandbox as any other shell command —
  // and on this Windows setup that sandbox is broken outside a real
  // interactive desktop session: every command_execution attempt failed with
  // "windows sandbox: orchestrator_helper_launch_canceled: ShellExecuteExW
  // failed to launch setup helper: 1223" (a UAC/elevation dialog with no UI
  // to answer it), confirmed via a live manual run. The image_gen tool call
  // itself is unaffected by that — it's not routed through command
  // execution — so instead of fighting the sandbox, we skip asking the agent
  // to move anything at all and read the result straight from where
  // image_gen already saves it: $CODEX_HOME/generated_images/<thread_id>/.
  const agentPrompt = [
    'Gere UMA imagem usando a ferramenta nativa "image_gen" (built-in), seguindo exatamente esta especificação:',
    '',
    prompt,
    '',
    'Não faça mais nada além disso: não peça confirmação, não explique o resultado, não gere variações extras, não crie ou copie nenhum arquivo, não rode comandos.',
  ].join('\n');

  let stdout;
  try {
    ({ stdout } = await execFileNoStdin('codex', [
      'exec',
      agentPrompt,
      '-C', outputDir,
      // The agent is instructed above to never run a command, only call
      // image_gen — so the sandbox that -s would set up protects nothing
      // here. On this machine that setup is also broken (the installed
      // Codex build is missing its codex-windows-sandbox-setup.exe
      // companion), which surfaced as a real Windows "file not found"
      // dialog every time a sandboxed command was attempted. Bypassing the
      // sandbox/approval setup entirely skips that broken step instead of
      // fighting it.
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--json',
      ...(referencePaths.length ? ['-i', ...referencePaths] : []),
    ], {
      timeout: Number(process.env.OPENSQUAD_CODEX_AGENT_TIMEOUT_MS || 300000),
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (err) {
    throw new Error(`Codex (agente) falhou: ${err.message}`, { cause: err });
  }

  const threadStartedLine = String(stdout || '').split('\n').find((line) => line.includes('"thread.started"'));
  const threadId = threadStartedLine ? JSON.parse(threadStartedLine)?.thread_id : null;
  if (!threadId) {
    throw new Error(`Codex (agente) não retornou o ID da sessão. Últimas linhas da saída: ${String(stdout || '').trim().slice(-500)}`);
  }

  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const generatedDir = join(codexHome, 'generated_images', threadId);
  let generatedFiles = [];
  for (let attemptNumber = 0; attemptNumber < 5; attemptNumber += 1) {
    generatedFiles = await readdir(generatedDir).catch(() => []);
    if (generatedFiles.length) break;
    await new Promise((resolvePromise) => { setTimeout(resolvePromise, 300); });
  }
  if (!generatedFiles.length) {
    throw new Error(`Codex (agente) não gerou nenhuma imagem em ${generatedDir}. Últimas linhas da saída: ${String(stdout || '').trim().slice(-500)}`);
  }

  const generatedStats = await Promise.all(generatedFiles.map(async (filename) => {
    const filePath = join(generatedDir, filename);
    const stats = await stat(filePath);
    return { filePath, mtimeMs: stats.mtimeMs };
  }));
  generatedStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const rawBuffer = await readFile(generatedStats[0].filePath);
  const croppedBuffer = await cropOpenAiImageToChannel(rawBuffer, content.image?.dimensions);
  const url = await saveOpenAiGeneratedImage({ buffer: croppedBuffer, projectId, targetDir, filenamePrefix: 'codexagent' });
  return {
    url,
    mimeType: 'image/png',
    prompt: content.image.prompt,
    provider: 'codex_agent',
  };
}

export async function cropOpenAiImageToChannel(sourceBuffer, targetDimensions) {
  const width = Number(targetDimensions?.width) || 0;
  const height = Number(targetDimensions?.height) || 0;
  if (!width || !height) return sourceBuffer;
  const source = await Jimp.read(sourceBuffer);
  // Never letterbox a generated creative with a blurred duplicate. That
  // makes a square/3:2 card look as if it were inside a Story and masks the
  // provider's wrong canvas from the reviewer. Fill the requested frame
  // edge-to-edge; prompt safe-zones keep required content away from crop risk.
  source.cover({ w: width, h: height });
  return source.getBuffer('image/png');
}

async function resolveOpenAiGeneratedImageUrl({ image, projectId, targetDir, targetDimensions }) {
  const rawBuffer = image.b64_json
    ? Buffer.from(image.b64_json, 'base64')
    : Buffer.from(await (await fetch(image.url)).arrayBuffer());
  const croppedBuffer = await cropOpenAiImageToChannel(rawBuffer, targetDimensions);
  return saveOpenAiGeneratedImage({ buffer: croppedBuffer, projectId, targetDir });
}

async function saveOpenAiGeneratedImage({ buffer, projectId, targetDir, filenamePrefix = 'chatgpt' }) {
  const paths = resolve(targetDir, '_opensquad', 'content-central', 'projects', projectId, 'assets', 'generated');
  await mkdir(paths, { recursive: true });
  const filename = `${filenamePrefix}-${Date.now()}.png`;
  await writeFile(join(paths, filename), buffer);
  return `/api/projects/${projectId}/assets/assets/generated/${filename}`;
}

const CATALOG_TOP_BAND_HEIGHT_RATIO = 0.12;
const CATALOG_BOTTOM_BAND_HEIGHT_RATIO = 0.2;
const CATALOG_SLANT_RATIO = 0.07;
const CATALOG_SEAL_DIAMETER_RATIO = 0.4;
const CATALOG_BANNER_FALLBACK_COLOR = 0x1b1b1bff;
const CATALOG_LOGO_CHIP_SIZE = 84;

function hexColorToJimpInt(hex, alpha = 0xff) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!match) return null;
  // Plain `<<`/`|` operate on signed 32-bit ints in JS and a color this
  // large overflows into negative territory; `>>> 0` forces it back to the
  // unsigned 32-bit RGBA value Jimp expects.
  return ((parseInt(match[1], 16) << 8) | alpha) >>> 0;
}

function colorLuminance(rgbaInt) {
  const r = (rgbaInt >>> 24) & 0xff;
  const g = (rgbaInt >>> 16) & 0xff;
  const b = (rgbaInt >>> 8) & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function darkenColor(rgbaInt, factor = 0.68) {
  const r = Math.round(((rgbaInt >>> 24) & 0xff) * factor);
  const g = Math.round(((rgbaInt >>> 16) & 0xff) * factor);
  const b = Math.round(((rgbaInt >>> 8) & 0xff) * factor);
  return ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
}

// Sum of per-channel differences — cheap and good enough to tell "genuinely
// different color" from "basically the same red, slightly darker".
function colorDistance(a, b) {
  const diff = (shift) => Math.abs(((a >>> shift) & 0xff) - ((b >>> shift) & 0xff));
  return diff(24) + diff(16) + diff(8);
}

// Prefers colors the operator manually corrected over the ones auto-detected
// from the logo — same priority order brand color fields already use
// elsewhere in this file. `secondary` drives the price seal, and logos
// often extract a whole cluster of near-identical shades of the same color
// (different anti-aliased reds off the same icon, say) — picking the first
// "second" color blindly can land the seal one shade off the banner and
// make it nearly invisible, so this skips ahead to the first extracted
// color that's actually distinct, falling back to a darkened primary if
// none of them are.
function resolveCatalogBrandColors(project) {
  const rawColors = (project.brandIdentity?.editedColors?.length
    ? project.brandIdentity.editedColors
    : project.brandIdentity?.extractedColors) || [];
  const colors = rawColors.map((hex) => hexColorToJimpInt(hex)).filter(Boolean);
  const primary = colors[0] || CATALOG_BANNER_FALLBACK_COLOR;
  const distinctSecondary = colors.slice(1).find((color) => colorDistance(color, primary) > 120);
  const secondary = distinctSecondary || darkenColor(primary);
  return { primary, secondary };
}

// Bitmap fonts only come in solid black or solid white — picking by the
// banner color's luminance keeps text readable against light or dark brands
// instead of hard-coding white and going invisible on a light background.
async function catalogTextFonts(backgroundColor) {
  const paths = colorLuminance(backgroundColor) > 150
    ? { small: SANS_16_BLACK, name: SANS_32_BLACK, price: SANS_64_BLACK }
    : { small: SANS_16_WHITE, name: SANS_32_WHITE, price: SANS_64_WHITE };
  const [small, name, price] = await Promise.all([loadFont(paths.small), loadFont(paths.name), loadFont(paths.price)]);
  return { small, name, price };
}

// Prices vary a lot in length ("R$ 999" vs "R$ 135.000,00") and the seal has
// a fixed diameter — picks the largest of the given fonts (ordered biggest
// first) whose single-line width still fits, instead of a font size that
// works for short prices but clips long ones.
function fitTextFont(fontsBiggestFirst, text, maxWidth) {
  return fontsBiggestFirst.find((font) => measureText(font, text) <= maxWidth) || fontsBiggestFirst[fontsBiggestFirst.length - 1];
}

async function resolveReferencePhotoAbsolutePaths(project, paths, photoReferenceIds) {
  const ids = Array.isArray(photoReferenceIds) ? photoReferenceIds : [];
  if (!ids.length) return [];
  const references = [
    ...(Array.isArray(project.brand?.references) ? project.brand.references : []),
    ...(Array.isArray(project.offerAssets) ? project.offerAssets : []),
  ];
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  return ids
    .map((id) => byId.get(id))
    .filter((reference) => reference?.relativePath)
    .map((reference) => join(paths.projectDir, reference.relativePath));
}

async function readImageSafely(absolutePath) {
  try {
    return await Jimp.read(absolutePath);
  } catch (err) {
    // Should be rare: normalizeUploadedImageAsset already converts anything
    // Jimp can't decode (webp, svg, ...) to PNG at upload time.
    console.error(`[content-central] composeProductStoryImage couldn't read ${absolutePath}:`, err.message);
    return null;
  }
}

// A color panel with a jagged diagonal seam instead of one flat edge —
// composited over the photo it reads as a "faixa" cutting dynamically
// across the frame. `seam: 'top'` cuts the panel's top edge (flat bottom,
// for a band anchored to the bottom of the canvas); `seam: 'bottom'` cuts
// the bottom edge (flat top, for a band anchored to the top of the canvas).
// `mirrored` flips which side the cut rises from, so alternating posts
// don't all look identical.
function buildDiagonalPanel({ width, panelHeight, slant, color, seam, mirrored }) {
  const panel = new Jimp({ width, height: panelHeight + slant, color });
  for (let i = 0; i < slant; i += 1) {
    const y = seam === 'top' ? i : panelHeight + i;
    for (let x = 0; x < width; x += 1) {
      const progress = mirrored ? 1 - x / width : x / width;
      const cutRow = seam === 'top' ? i : slant - 1 - i;
      if (cutRow < Math.round(progress * slant)) {
        panel.bitmap.data[(y * width + x) * 4 + 3] = 0;
      }
    }
  }
  return panel;
}

// A solid-color filled circle, used for the price "seal" — real dealership
// ads almost never print the price as plain text, it's a bold badge that
// pops off the rest of the composition.
function buildCircleBadge({ diameter, color }) {
  const badge = new Jimp({ width: diameter, height: diameter, color: 0x00000000 });
  const radius = diameter / 2;
  const [r, g, b] = [(color >>> 24) & 0xff, (color >>> 16) & 0xff, (color >>> 8) & 0xff];
  for (let y = 0; y < diameter; y += 1) {
    const dy = y - radius + 0.5;
    for (let x = 0; x < diameter; x += 1) {
      const dx = x - radius + 0.5;
      if (dx * dx + dy * dy <= radius * radius) {
        const idx = (y * diameter + x) * 4;
        badge.bitmap.data[idx] = r;
        badge.bitmap.data[idx + 1] = g;
        badge.bitmap.data[idx + 2] = b;
        badge.bitmap.data[idx + 3] = 255;
      }
    }
  }
  return badge;
}

// Crops the prospect's real circular profile photo out of a full profile
// screenshot, for use as a rough logo reference on the prospecting mockup —
// same zero-alpha-outside-the-radius technique as buildCircleBadge above,
// just applied to a photo crop instead of a solid fill. box is in percent
// of the full screenshot's width/height (see analyzeProspectScreenshotWithHermes
// above); returns a PNG data URL, or null if the box doesn't describe a
// real square region (never guesses a crop that wasn't actually identified).
export async function cropCircularAvatar(buffer, box) {
  if (!box) return null;
  const source = await Jimp.read(buffer);
  const { width: imgWidth, height: imgHeight } = source.bitmap;
  const size = Math.round((box.sizePct / 100) * Math.min(imgWidth, imgHeight));
  const x = Math.round((box.xPct / 100) * imgWidth);
  const y = Math.round((box.yPct / 100) * imgHeight);
  if (size < 8 || x < 0 || y < 0 || x + size > imgWidth || y + size > imgHeight) return null;

  const square = source.clone().crop({ x, y, w: size, h: size });
  const radius = size / 2;
  for (let cy = 0; cy < size; cy += 1) {
    const dy = cy - radius + 0.5;
    for (let cx = 0; cx < size; cx += 1) {
      const dx = cx - radius + 0.5;
      if (dx * dx + dy * dy > radius * radius) {
        square.bitmap.data[(cy * size + cx) * 4 + 3] = 0;
      }
    }
  }
  const pngBuffer = await square.getBuffer('image/png');
  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

// A solid-color rectangle with rounded corners — used for the name/price
// "pill" badges in the spotlight layout, and for the logo chip's colored
// border. Same per-pixel-distance technique as buildCircleBadge, just
// checked only in the four corner zones.
function buildRoundedBadge({ width, height, radius, color }) {
  const badge = new Jimp({ width, height, color: 0x00000000 });
  const r = Math.min(radius, width / 2, height / 2);
  const [red, green, blue] = [(color >>> 24) & 0xff, (color >>> 16) & 0xff, (color >>> 8) & 0xff];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inCorner = (x < r || x >= width - r) && (y < r || y >= height - r);
      let visible = true;
      if (inCorner) {
        const cx = x < r ? r : width - r;
        const cy = y < r ? r : height - r;
        const dx = x - cx + 0.5;
        const dy = y - cy + 0.5;
        visible = dx * dx + dy * dy <= r * r;
      }
      if (!visible) continue;
      const idx = (y * width + x) * 4;
      badge.bitmap.data[idx] = red;
      badge.bitmap.data[idx + 1] = green;
      badge.bitmap.data[idx + 2] = blue;
      badge.bitmap.data[idx + 3] = 255;
    }
  }
  return badge;
}

// Soft elliptical "spotlight" the product photo rests on — alpha falls off
// smoothly from center to edge (unlike buildCircleBadge's hard edge, which
// reads as a solid badge rather than a glow/light source).
function buildSpotlightGlow({ width, height, color }) {
  const glow = new Jimp({ width, height, color: 0x00000000 });
  const [r, g, b] = [(color >>> 24) & 0xff, (color >>> 16) & 0xff, (color >>> 8) & 0xff];
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y += 1) {
    const ny = cy === 0 ? 0 : (y - cy) / cy;
    for (let x = 0; x < width; x += 1) {
      const nx = cx === 0 ? 0 : (x - cx) / cx;
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist > 1) continue;
      const idx = (y * width + x) * 4;
      glow.bitmap.data[idx] = r;
      glow.bitmap.data[idx + 1] = g;
      glow.bitmap.data[idx + 2] = b;
      glow.bitmap.data[idx + 3] = Math.round(255 * Math.pow(1 - dist, 1.6));
    }
  }
  return glow;
}

// Local, deterministic, zero-cost counterpart to the AI image generators —
// catalog projects post real product photos, not AI-generated art, so this
// composites the uploaded photo(s) with a brand-colored top headline band, a
// bold circular price seal, and a bottom band (logo, standing "informações
// gerais") instead of calling any image model, and returns the same
// {url, mimeType} contract the AI providers do, so it slots into
// content.image without touching approval/calendar/publish. Layout modeled
// directly on real Brazilian car-dealership ad references: photo filling
// almost the whole frame (not floating in empty padding), price as a big
// bold seal instead of plain text, minimal dead space.
export async function composeProductStoryImage({ content, project, targetDir }) {
  const offer = content?.contentTopic || {};
  const paths = getCentralPaths(targetDir, project.projectId);
  const dimensions = content?.image?.dimensions || { width: 1080, height: 1920 };
  const width = Number(dimensions.width) || 1080;
  const height = Number(dimensions.height) || 1920;

  const { primary: brandColor, secondary: sealColor } = resolveCatalogBrandColors(project);
  const topBandHeight = Math.round(height * CATALOG_TOP_BAND_HEIGHT_RATIO);
  let bottomBandHeight = Math.round(height * CATALOG_BOTTOM_BAND_HEIGHT_RATIO);
  const slant = Math.round(width * CATALOG_SLANT_RATIO);

  const canvas = new Jimp({ width, height, color: brandColor });

  const photoPaths = await resolveReferencePhotoAbsolutePaths(project, paths, offer.photoReferenceIds);
  const photos = (await Promise.all(photoPaths.map(readImageSafely))).filter(Boolean);

  // A near-square (or landscape) photo letterboxed into a fixed tall slot
  // leaves big empty margins — the "espaço morto" the operator flagged.
  // Instead of a fixed-size photo slot, shrink it to what this specific
  // photo actually needs at full width and hand the freed-up space to the
  // bottom band (more breathing room around the price seal and general
  // info), so the composition stays tight regardless of the source photo's
  // aspect ratio. Only applies to the single-photo layout — the two-photo
  // layout already fills its slot completely via cover().
  if (photos.length === 1) {
    const maxPhotoAreaHeight = height - topBandHeight - bottomBandHeight;
    const containScale = Math.min(width / photos[0].bitmap.width, maxPhotoAreaHeight / photos[0].bitmap.height);
    const renderedPhotoHeight = Math.round(photos[0].bitmap.height * containScale);
    const slack = Math.max(0, maxPhotoAreaHeight - renderedPhotoHeight);
    // Cap how much slack the bottom band absorbs — a very landscape photo
    // (typical of car shots) has a lot of slack, and dumping all of it in
    // would just relocate the empty space into an oversized band instead
    // of removing it. Past this cap the remainder stays as (bounded, roughly
    // centered) letterboxing around the photo, which reads as an
    // intentional colored mat rather than a leftover empty block.
    const maxBottomBandHeight = Math.round(height * 0.28);
    bottomBandHeight = Math.min(maxBottomBandHeight, bottomBandHeight + slack);
  }
  const photoAreaHeight = height - topBandHeight - bottomBandHeight;

  if (photos.length) {
    // Contain (not cover) onto the brand-color canvas directly, with no
    // separate backdrop: a near-square product photo forced to "cover" a
    // tall Story slot crops the car itself badly (sides sliced off). Contain
    // keeps the whole car intact; any letterboxing shows as clean brand
    // color instead of blurred grey studio wall, which reads as intentional
    // rather than as wasted space.
    const photoY = topBandHeight - slant;
    const photoH = photoAreaHeight + slant * 2;
    if (photos.length === 1) {
      const foreground = photos[0].clone();
      foreground.background = 0x00000000;
      foreground.contain({ w: width, h: photoH });
      canvas.composite(foreground, 0, photoY);
    } else {
      // Multiple photos of the same product: a hero shot filling most of
      // the photo area and a second angle as a cropped detail strip below
      // it, instead of only ever using the first upload ("se tiver várias
      // fotos organiza pra aproveitar elas").
      const heroHeight = Math.round(photoH * 0.72);
      const hero = photos[0].clone();
      hero.background = 0x00000000;
      hero.contain({ w: width, h: heroHeight });
      canvas.composite(hero, 0, photoY);
      canvas.composite(photos[1].clone().cover({ w: width, h: photoH - heroHeight }), 0, photoY + heroHeight);
    }
  }

  // Alternates which side each diagonal seam rises from, day+slot apart, so
  // consecutive posts don't all come out visually identical.
  const mirrored = ((content?.dayNumber || 0) + (content?.slotNumber || 0)) % 2 === 1;
  const topBand = buildDiagonalPanel({ width, panelHeight: topBandHeight, slant, color: brandColor, seam: 'bottom', mirrored });
  canvas.composite(topBand, 0, 0);
  const bottomBand = buildDiagonalPanel({ width, panelHeight: bottomBandHeight, slant, color: brandColor, seam: 'top', mirrored: !mirrored });
  canvas.composite(bottomBand, 0, height - bottomBandHeight - slant);

  // Price seal: a bold circle straddling the photo/bottom-band seam, in a
  // color distinct from the band it sits on so it reads as its own badge
  // instead of blending in — the "selo grande e chamativo" from the
  // reference ads, replacing plain centered price text.
  const sealDiameter = Math.round(width * CATALOG_SEAL_DIAMETER_RATIO);
  const sealCenterY = height - bottomBandHeight;
  canvas.composite(buildCircleBadge({ diameter: sealDiameter, color: sealColor }), Math.round((width - sealDiameter) / 2), Math.round(sealCenterY - sealDiameter / 2));

  const topFonts = await catalogTextFonts(brandColor);
  const sealFonts = await catalogTextFonts(sealColor);
  const padding = 40;

  const nameText = String(offer.offerName || '').trim() || 'Produto disponível';
  const nameMaxWidth = width - padding * 2;
  canvas.print({
    font: fitTextFont([topFonts.price, topFonts.name, topFonts.small], nameText, nameMaxWidth),
    x: padding,
    y: 0,
    text: {
      text: nameText,
      alignmentX: HorizontalAlign.CENTER,
      alignmentY: VerticalAlign.MIDDLE,
    },
    maxWidth: nameMaxWidth,
    maxHeight: topBandHeight,
  });

  const sealTextInset = Math.round(sealDiameter * 0.16);
  const sealTextMaxWidth = sealDiameter - sealTextInset * 2;
  const priceText = String(offer.price || '').trim() || 'Consulte';
  const sealPriceFont = fitTextFont([sealFonts.price, sealFonts.name, sealFonts.small], priceText, sealTextMaxWidth);
  canvas.print({
    font: sealPriceFont,
    x: Math.round((width - sealDiameter) / 2) + sealTextInset,
    y: Math.round(sealCenterY - sealDiameter / 2) + sealTextInset,
    text: {
      text: priceText,
      alignmentX: HorizontalAlign.CENTER,
      alignmentY: VerticalAlign.MIDDLE,
    },
    maxWidth: sealTextMaxWidth,
    maxHeight: sealDiameter - sealTextInset * 2,
  });

  // Logo chip: small neutral badge behind the logo so it stays legible
  // regardless of what the band color underneath it is.
  const logoRelativePath = project.brand?.logoPath;
  const bottomContentTop = height - bottomBandHeight + Math.round(sealDiameter / 2) + 16;
  if (logoRelativePath) {
    const logo = await readImageSafely(join(paths.projectDir, logoRelativePath));
    if (logo) {
      const chip = new Jimp({ width: CATALOG_LOGO_CHIP_SIZE, height: CATALOG_LOGO_CHIP_SIZE, color: 0xffffffee });
      const logoImg = logo.clone();
      logoImg.background = 0x00000000;
      logoImg.contain({ w: CATALOG_LOGO_CHIP_SIZE - 20, h: CATALOG_LOGO_CHIP_SIZE - 20 });
      chip.composite(logoImg, 10, 10);
      canvas.composite(chip, padding, bottomContentTop);
    }
  }

  const generalInfo = String(project.contentSettings?.catalogGeneralInfo || '').trim();
  if (generalInfo) {
    canvas.print({
      font: topFonts.small,
      x: padding,
      y: bottomContentTop,
      text: {
        text: generalInfo,
        alignmentX: HorizontalAlign.CENTER,
        alignmentY: VerticalAlign.MIDDLE,
      },
      maxWidth: width - padding * 2,
      maxHeight: height - bottomContentTop - 16,
    });
  }

  const buffer = await canvas.getBuffer('image/png');
  const url = await saveOpenAiGeneratedImage({ buffer, projectId: project.projectId, targetDir, filenamePrefix: 'catalogo' });
  return { url, mimeType: 'image/png' };
}

// Generic on purpose — this runs for any direct-sale inventory business
// (cars, phones, furniture, whatever), never just vehicles. Segment comes
// from whatever the operator already filled in Empresa/Raio-X, if anything.
export function buildCatalogOutpaintPrompt({ project, offer }) {
  const segment = project?.companyProfile?.segment || project?.brandInput?.segment || '';
  return [
    'Complete a composição publicitária ao redor da foto real do produto anexada, para um anúncio de venda direta no Instagram Story.',
    'Não altere, não redesenhe e não substitua o produto na foto anexada — ele deve permanecer exatamente como está, na mesma cor, forma e aparência. Você pode remover ou substituir apenas o fundo/cenário ao redor dele.',
    `Negócio: "${project?.name || ''}"${segment ? ` (${segment})` : ''}. Produto: ${offer?.offerName || 'produto à venda'}.`,
    'A imagem deve parecer uma FOTOGRAFIA real de estúdio/showroom (câmera, luz, ambiente físico), não uma peça de design gráfico nem um cartaz publicitário. Pense em uma foto profissional de catálogo de revenda, não em uma arte com camadas gráficas.',
    'PROIBIDO desenhar qualquer elemento gráfico vetorial: nenhuma moldura, quadro, painel, retângulo com borda colorida, tela, cartão, HUD, medidor, velocímetro, anel, círculo decorativo, ícone ou linha neon vetorial. Nenhuma forma geométrica com contorno destacado e interior vazio, em nenhuma parte da imagem.',
    'Não deixe nenhuma área "reservada" ou em branco — preencha o quadro inteiro com a cena real. Nome, preço e qualquer texto são adicionados depois, por cima, separadamente; você não precisa (e não deve) preparar espaço para eles.',
    'O ambiente ao redor do produto deve ser só o físico real: piso, paredes, luzes, sombras, reflexos. Cores da marca podem aparecer como luz ambiente ou reflexo colorido, nunca como gráfico vetorial sobreposto.',
    'Não escreva nenhum texto, número, letra ou preço na imagem.',
    'Não adicione pessoas.',
  ].join(' ');
}

// Shells out to the same Codex/Hermes OAuth image-gen plugin
// generateAiImageWithCodex already uses — rides the operator's ChatGPT
// subscription (not the metered OPENAI_API_KEY, which has its own separate
// billing limit) and, unlike the plain text-to-image path, accepts the real
// product photo as a reference image so the model edits around it instead
// of inventing an unrelated product from scratch.
async function generateCatalogAiOutpaintImage({ prompt, photoAbsolutePaths }) {
  const { hermesHome, pythonBin } = resolveHermesPython();
  const promptFile = join(tmpdir(), `opensquad-catalog-outpaint-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(promptFile, prompt, 'utf-8');

  let stdout;
  try {
    const script = [
      'import sys, json, importlib.util',
      "sys.path.insert(0, '.')",
      "spec = importlib.util.spec_from_file_location('codex_image_gen', 'plugins/image_gen/openai-codex/__init__.py')",
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'provider = mod.OpenAICodexImageGenProvider()',
      `with open(${JSON.stringify(promptFile)}, 'r', encoding='utf-8') as f:`,
      '    prompt_text = f.read()',
      `reference_paths = ${JSON.stringify(photoAbsolutePaths)}`,
      "result = provider.generate(prompt=prompt_text, aspect_ratio='portrait', reference_image_urls=reference_paths)",
      'print(json.dumps(result))',
    ].join('\n');
    ({ stdout } = await execFileAsync(pythonBin, ['-c', script], {
      cwd: hermesHome,
      timeout: 240000,
      maxBuffer: 10 * 1024 * 1024,
    }));
  } finally {
    await rm(promptFile, { force: true }).catch(() => {});
  }

  const jsonText = String(stdout || '').match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error('Geração de imagem com IA (Codex) não retornou uma resposta válida.');
  const parsed = JSON.parse(jsonText);
  if (!parsed.success || !parsed.image) throw new Error(`Geração de imagem com IA (Codex) falhou: ${parsed.error || 'sem detalhes'}`);
  return parsed.image;
}

// Soft vertical vignette we composite ourselves behind the name/price/info
// text zones. Earlier versions asked the image model to "leave a reserved
// area" for text and picked font color by sampling whatever it drew there —
// but across repeated tries the model kept replacing that reserved area
// with a garish drawn frame, HUD circle or blank card instead of leaving it
// alone, no matter how the prohibition was phrased. Legibility is now
// guaranteed entirely in code: a dark gradient at the very top/bottom edge,
// independent of whatever the model renders underneath.
function buildEdgeGradientScrim({ width, height, edgeAlpha, fadeToward }) {
  const scrim = new Jimp({ width, height, color: 0x00000000 });
  for (let y = 0; y < height; y++) {
    const t = height <= 1 ? 1 : y / (height - 1);
    const ratio = fadeToward === 'bottom' ? 1 - t : t;
    const color = hexColorToJimpInt('000000', Math.round(edgeAlpha * 255 * ratio));
    for (let x = 0; x < width; x++) scrim.setPixelColor(color, x, y);
  }
  return scrim;
}

// AI-assisted counterpart to composeProductStoryImage — same real-photo
// contract (the product is never invented or altered), but the space
// around it is designed by the model instead of plain Jimp shapes, for
// operators who want a genuinely designed look. Text (name/price/general
// info) is still overlaid locally afterward — never trust an image model
// to render exact price digits correctly — over a scrim we draw ourselves,
// in fixed proportional zones (top strip for the name, lower-third for the
// price/info).
export async function composeCatalogAiOutpaint({ content, project, targetDir }) {
  const offer = content?.contentTopic || {};
  const paths = getCentralPaths(targetDir, project.projectId);
  const dimensions = content?.image?.dimensions || { width: 1080, height: 1920 };
  const width = Number(dimensions.width) || 1080;
  const height = Number(dimensions.height) || 1920;

  const photoPaths = await resolveReferencePhotoAbsolutePaths(project, paths, offer.photoReferenceIds);
  if (!photoPaths.length) throw new Error('Cadastre uma foto real do produto antes de gerar com IA.');

  const prompt = buildCatalogOutpaintPrompt({ project, offer });
  const generatedImagePath = await generateCatalogAiOutpaintImage({ prompt, photoAbsolutePaths: photoPaths.slice(0, 4) });
  const rawBuffer = await readFile(generatedImagePath);

  const canvas = await Jimp.read(rawBuffer);
  if (canvas.bitmap.width !== width || canvas.bitmap.height !== height) canvas.cover({ w: width, h: height });

  const topScrimHeight = Math.round(height * 0.26);
  const bottomScrimHeight = Math.round(height * 0.32);
  canvas.composite(buildEdgeGradientScrim({ width, height: topScrimHeight, edgeAlpha: 0.62, fadeToward: 'bottom' }), 0, 0);
  canvas.composite(buildEdgeGradientScrim({ width, height: bottomScrimHeight, edgeAlpha: 0.62, fadeToward: 'top' }), 0, height - bottomScrimHeight);

  // Fonts are fixed white, not sampled from the pixel underneath — the
  // scrim above guarantees a dark-enough background everywhere text lands.
  const whiteFonts = await catalogTextFonts(0x000000ff);

  const padding = 40;
  const nameText = String(offer.offerName || '').trim() || 'Produto disponível';
  const priceText = String(offer.price || '').trim() || 'Consulte o preço';
  const generalInfo = String(project.contentSettings?.catalogGeneralInfo || '').trim();

  const nameAreaTop = Math.round(height * 0.06);
  const nameAreaHeight = Math.round(height * 0.14);
  canvas.print({
    font: fitTextFont([whiteFonts.name, whiteFonts.small], nameText, width - padding * 2),
    x: padding,
    y: nameAreaTop,
    text: { text: nameText, alignmentX: HorizontalAlign.CENTER, alignmentY: VerticalAlign.MIDDLE },
    maxWidth: width - padding * 2,
    maxHeight: nameAreaHeight,
  });

  const priceAreaTop = Math.round(height * 0.74);
  const priceAreaHeight = Math.round(height * 0.14);
  const priceMaxWidth = Math.round(width * 0.4);
  canvas.print({
    font: fitTextFont([whiteFonts.price, whiteFonts.name, whiteFonts.small], priceText, priceMaxWidth),
    x: Math.round((width - priceMaxWidth) / 2),
    y: priceAreaTop,
    text: { text: priceText, alignmentX: HorizontalAlign.CENTER, alignmentY: VerticalAlign.MIDDLE },
    maxWidth: priceMaxWidth,
    maxHeight: priceAreaHeight,
  });

  if (generalInfo) {
    const infoAreaTop = Math.round(height * 0.92);
    canvas.print({
      font: whiteFonts.small,
      x: padding,
      y: infoAreaTop,
      text: { text: generalInfo, alignmentX: HorizontalAlign.CENTER, alignmentY: VerticalAlign.MIDDLE },
      maxWidth: width - padding * 2,
      maxHeight: Math.round(height * 0.06),
    });
  }

  const buffer = await canvas.getBuffer('image/png');
  const url = await saveOpenAiGeneratedImage({ buffer, projectId: project.projectId, targetDir, filenamePrefix: 'catalogo-ia' });
  return { url, mimeType: 'image/png' };
}

const CATALOG_SPOTLIGHT_BG = 0x0a0a0aff;
const CATALOG_SPOTLIGHT_LOGO_HEIGHT = 76;
const CATALOG_SPOTLIGHT_LOGO_MAX_WIDTH_RATIO = 0.5;

// Local, deterministic "product on a spotlight" layout — dark background,
// product photo resting on a soft brand-colored glow, a compact left-aligned
// name/price block underneath (not a full-width banner). Modeled on a real
// reference the operator liked, but generic per business instead of a fixed
// "Black Friday" campaign look: every accent color comes from the project's
// own logo (resolveCatalogBrandColors). composeCatalogAiOutpaint's
// model-designed backgrounds kept drawing empty reserved panels/HUD circles
// no matter how the prompt phrased the restriction, and never included the
// logo at all — this trades "AI-designed background" for "always correct,
// on-brand, nothing wasted" — same {url, mimeType} contract as the others.
export async function composeCatalogSpotlightImage({ content, project, targetDir }) {
  const offer = content?.contentTopic || {};
  const paths = getCentralPaths(targetDir, project.projectId);
  const dimensions = content?.image?.dimensions || { width: 1080, height: 1920 };
  const width = Number(dimensions.width) || 1080;
  const height = Number(dimensions.height) || 1920;
  const padding = 56;

  const { primary: accentColor } = resolveCatalogBrandColors(project);
  const canvas = new Jimp({ width, height, color: CATALOG_SPOTLIGHT_BG });

  const fontsOnDark = await catalogTextFonts(CATALOG_SPOTLIGHT_BG);
  const fontsOnAccent = await catalogTextFonts(accentColor);

  // Logo chip, top-left. White/light background — not the dark canvas
  // color — so the logo stays legible regardless of its own colors; a logo
  // with black wordmark elements would otherwise vanish against a dark
  // chip. Sized to the logo's own aspect ratio (capped at half the canvas
  // width) instead of forced into a square, which crushed wide horizontal
  // logos down to an unreadable sliver.
  let logoBottom = padding;
  const logoRelativePath = project.brand?.logoPath;
  if (logoRelativePath) {
    const logo = await readImageSafely(join(paths.projectDir, logoRelativePath));
    if (logo) {
      const innerHeight = CATALOG_SPOTLIGHT_LOGO_HEIGHT;
      const naturalAspect = logo.bitmap.width / logo.bitmap.height;
      const maxInnerWidth = Math.round(width * CATALOG_SPOTLIGHT_LOGO_MAX_WIDTH_RATIO) - 32;
      const innerWidth = Math.min(maxInnerWidth, Math.round(innerHeight * naturalAspect));
      const chipPad = 16;
      const chipWidth = innerWidth + chipPad * 2;
      const chipHeight = innerHeight + chipPad * 2;
      const chip = buildRoundedBadge({ width: chipWidth, height: chipHeight, radius: 18, color: accentColor });
      const inner = buildRoundedBadge({ width: chipWidth - 6, height: chipHeight - 6, radius: 15, color: 0xffffffff });
      chip.composite(inner, 3, 3);
      const logoImg = logo.clone();
      logoImg.background = 0x00000000;
      logoImg.contain({ w: innerWidth, h: innerHeight });
      chip.composite(logoImg, Math.round((chipWidth - logoImg.bitmap.width) / 2), Math.round((chipHeight - logoImg.bitmap.height) / 2));
      canvas.composite(chip, padding, padding);
      logoBottom = padding + chipHeight;
    }
  }

  // Product photo on its spotlight glow — takes most of the frame now that
  // name/price live in a compact block instead of a full-width banner.
  const photoAreaTop = logoBottom + 36;
  const textBlockHeight = Math.round(height * 0.22);
  const photoAreaBottom = height - textBlockHeight;
  const photoAreaHeight = Math.max(0, photoAreaBottom - photoAreaTop);

  const glowWidth = Math.round(width * 0.9);
  const glowHeight = Math.round(photoAreaHeight * 0.5);
  const glow = buildSpotlightGlow({ width: glowWidth, height: glowHeight, color: accentColor });
  canvas.composite(
    glow,
    Math.round((width - glowWidth) / 2),
    photoAreaTop + photoAreaHeight - Math.round(glowHeight * 0.75),
  );

  const photoPaths = await resolveReferencePhotoAbsolutePaths(project, paths, offer.photoReferenceIds);
  const photos = (await Promise.all(photoPaths.map(readImageSafely))).filter(Boolean);
  if (photos.length) {
    const foreground = photos[0].clone();
    foreground.background = 0x00000000;
    foreground.contain({ w: width - padding * 2, h: photoAreaHeight });
    const photoX = Math.round((width - foreground.bitmap.width) / 2);
    const photoY = photoAreaTop + Math.round((photoAreaHeight - foreground.bitmap.height) / 2);
    canvas.composite(foreground, photoX, photoY);
  }

  // Name + price as a compact, left-aligned block below the product —
  // "produto e a letra do lado/embaixo", not a giant full-width banner.
  // Only the price gets a tight accent-colored highlight sized to its own
  // text, mirroring how the reference marks just the number, not the whole
  // row.
  let textTop = photoAreaBottom + 20;
  const nameText = String(offer.offerName || '').trim() || 'Produto disponível';
  canvas.print({
    font: fontsOnDark.name,
    x: padding,
    y: textTop,
    text: { text: nameText, alignmentX: HorizontalAlign.LEFT, alignmentY: VerticalAlign.TOP },
    maxWidth: width - padding * 2,
    maxHeight: Math.round(height * 0.045),
  });
  textTop += Math.round(height * 0.05);

  const priceText = String(offer.price || '').trim() || 'Consulte o preço';
  const priceMaxWidth = width - padding * 2;
  const priceFont = fitTextFont([fontsOnAccent.price, fontsOnAccent.name], priceText, priceMaxWidth - 56);
  const priceTextWidth = measureText(priceFont, priceText);
  const priceBadgeHeight = Math.round(height * 0.07);
  const priceBadgeWidth = Math.min(priceMaxWidth, priceTextWidth + 56);
  const priceBadge = buildRoundedBadge({ width: priceBadgeWidth, height: priceBadgeHeight, radius: 14, color: accentColor });
  canvas.composite(priceBadge, padding, textTop);
  canvas.print({
    font: priceFont,
    x: padding,
    y: textTop,
    text: { text: priceText, alignmentX: HorizontalAlign.CENTER, alignmentY: VerticalAlign.MIDDLE },
    maxWidth: priceBadgeWidth,
    maxHeight: priceBadgeHeight,
  });
  textTop += priceBadgeHeight + 18;

  const generalInfo = String(project.contentSettings?.catalogGeneralInfo || '').trim();
  if (generalInfo) {
    canvas.print({
      font: fontsOnDark.small,
      x: padding,
      y: textTop,
      text: { text: generalInfo, alignmentX: HorizontalAlign.LEFT, alignmentY: VerticalAlign.TOP },
      maxWidth: width - padding * 2,
      maxHeight: Math.round(height * 0.05),
    });
  }

  const handle = String(project.instagram?.handle || '').trim();
  if (handle) {
    canvas.print({
      font: fontsOnDark.small,
      x: padding,
      y: height - Math.round(height * 0.045),
      text: { text: handle, alignmentX: HorizontalAlign.LEFT, alignmentY: VerticalAlign.MIDDLE },
      maxWidth: width - padding * 2,
      maxHeight: Math.round(height * 0.04),
    });
  }

  const buffer = await canvas.getBuffer('image/png');
  const url = await saveOpenAiGeneratedImage({ buffer, projectId: project.projectId, targetDir, filenamePrefix: 'catalogo-spotlight' });
  return { url, mimeType: 'image/png' };
}

// Default catalogImageComposer — the spotlight layout above: fully local,
// deterministic and on-brand, so it never depends on an image model's mood.
// composeCatalogAiOutpaint stays available (still exported, still tested)
// for whoever wants to opt back into AI-designed backgrounds, but it's no
// longer the automatic default after repeated real generations kept
// drawing empty reserved panels/HUD circles regardless of prompt wording.
async function composeCatalogImage(payload) {
  return composeCatalogSpotlightImage(payload);
}

// Jimp (used for all local compositing) and the OpenAI/Codex image-edit API
// can't read every format a phone or a downloaded product photo comes in as
// (webp, svg, heic, avif...). Rather than let that surface later as a
// confusing decode failure deep in compositing or AI image editing, convert
// anything Jimp doesn't natively support to PNG once, right at upload time.
const JIMP_NATIVE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/tiff']);

async function normalizeUploadedImageAsset(assetInput) {
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(String(assetInput?.dataUrl || ''));
  if (!dataUrlMatch) return assetInput;
  const [, mimeType, base64] = dataUrlMatch;
  const normalizedMimeType = mimeType.toLowerCase();
  // References also accept non-image files (pdf, txt, md, doc...) as text
  // parameters — only images need format normalization here.
  if (!normalizedMimeType.startsWith('image/') || JIMP_NATIVE_IMAGE_MIME_TYPES.has(normalizedMimeType)) return assetInput;

  const sourceBuffer = Buffer.from(base64, 'base64');
  let pngBuffer;
  try {
    pngBuffer = await sharp(sourceBuffer).png().toBuffer();
  } catch (err) {
    throw new Error(`Não foi possível processar essa imagem (${mimeType}): ${err.message}`, { cause: err });
  }

  const baseName = String(assetInput?.filename || 'imagem').replace(/\.[^./\\]+$/, '');
  return {
    ...assetInput,
    filename: `${baseName}.png`,
    dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
  };
}

export function buildAiImageReviewPrompt({ content, project, note, attachedAsFile = false } = {}) {
  const expected = content?.contentTopic || {};
  const spec = content?.creativeSpec || {};
  const comparisonReferences = Array.isArray(content?.image?.references)
    ? selectImageReferencesForCodex(content.image.references)
      .filter((reference) => reference.absolutePath && String(reference.mimeType || '').startsWith('image/'))
    : [];
  const attachmentManifest = comparisonReferences
    .map((reference, index) => `Anexo ${index + 2}: ${reference.role} — ${reference.relativePath || reference.filename || reference.id || 'referência'}.`);
  return [
    contentCentralPersonaLine('renata'),
    contentCentralPersonaResponsibilityLine('renata'),
    attachedAsFile
      ? 'Analise visualmente a imagem final anexada a este turno antes de qualquer aprovação/publicação.'
      : `Analise visualmente a imagem final abaixo antes de qualquer aprovação/publicação.\nImagem: ${content?.image?.url || ''}`,
    attachedAsFile ? 'Anexo 1: criativo final que deve ser revisado.' : '',
    attachedAsFile && attachmentManifest.length ? attachmentManifest.join('\n') : '',
    '',
    'Dados obrigatórios do card:',
    `Projeto: ${project?.name || ''}`,
    `Canal: ${content?.formatLabel || content?.channel || ''}`,
    `Título/oferta autorizada: ${expected.offerName || 'não definido'}`,
    `Preço autorizado: ${expected.price || 'não definido'}`,
    `Itens autorizados: ${expected.items || 'não definidos'}`,
    `Observações/restrições obrigatórias: ${expected.notes || 'nenhuma'}`,
    `CTA autorizado: ${chooseCreativeCta(expected, content?.channel) || 'nenhum — post de conteúdo, não deve ter botão/selo de CTA na arte'}`,
    `Tratamento do produto: ${spec.product?.treatment || 'sem referência de produto'}`,
    `Força do modelo estrutural: ${spec.layout?.strength || 'livre'}`,
    spec.layout?.zones?.length ? `Zonas obrigatórias do layout:\n${spec.layout.zones.map((zone) => `- ${zone}`).join('\n')}` : '',
    note ? `Observação do usuário: ${note}` : '',
    '',
    'Bloqueie com status "blocked" se encontrar qualquer um destes problemas:',
    '- texto principal, preço, logo ou CTA cortado nas bordas;',
    '- quando houver logo oficial cadastrada/anexada, se a arte mostrar placeholder de marca/logo (ex.: “SUA MARCA”, “YOUR LOGO”, “LOGO AQUI”) em vez da logo real;',
    '- preço diferente do preço autorizado;',
    '- oferta extra não pertencente ao assunto atual, como rodízio em card de combo ou combo em card de rodízio;',
    '- qualquer item listado em "Itens autorizados" (ex: um combo com 4 produtos) que não apareça visualmente reconhecível na peça — todos os itens listados precisam estar representados, não só parte deles;',
    '- texto embaralhado, ilegível ou com palavra importante faltando;',
    '- formato visual claramente incompatível com o canal solicitado.',
    '- se Story/Reels parecer quadrado ou 1:1, mesmo dentro de prévia vertical;',
    '- se Story/Reels tiver massa visual concentrada apenas no centro, pouco uso da área superior e inferior ou aparência de card 1:1 dentro de 9:16;',
    '- barras, faixas ou bordas desfocadas/esticadas nas laterais, topo ou base da imagem (sinal de que a arte não preencheu o quadro inteiro);',
    '- preço em box/moldura grande demais, simples demais, desalinhado ou cobrindo o produto principal;',
    '- se o selo de preço cobrir mais destaque que o produto, esconder parte importante do produto ou ficar dominante demais no centro;',
    '- se o produto final pertencer a outra categoria, versão incompatível ou quantidade diferente da referência/oferta;',
    '- em produto fiel melhorado ou foto exata, se cenário, comida, objetos de fundo ou elementos do segmento tiverem mais destaque que o produto real;',
    '- se houver layout_model e a ordem de leitura, zonas ou hierarquia principais não forem obedecidas;',
    '',
    'Para Story/Reels, aprove somente se a peça parecer nativa de Story vertical: topo, centro e base usados com hierarquia clara, sem flyer quadrado centralizado.',
    'Se a marca aparecer como placeholder, não trate como alerta leve: retorne status "blocked" e inclua o erro para refazer a imagem com a logo oficial.',
    spec.product?.treatment === 'creative_redraw'
      ? 'Redesenho criativo é permitido e não deve ser bloqueado por diferenças cosméticas de rótulo; bloqueie apenas se mudar categoria, silhueta reconhecível, cores principais ou quantidade.'
      : '',
    spec.product?.treatment === 'faithful_enhance'
      ? 'No modo faithful_enhance, aceite melhorias de recorte, luz, sombra e limpeza, mas bloqueie se a embalagem/produto mudar ou se o cenário virar protagonista.'
      : '',
    spec.product?.treatment === 'exact_asset'
      ? 'No modo exact_asset, compare rigorosamente embalagem, rótulo, marca, cores e proporções com a foto de produto anexada.'
      : '',
    '',
    'Use códigos objetivos nos problemas encontrados:',
    'WRONG_ASPECT_RATIO, STORY_CANVAS_MISMATCH, LAYOUT_MISMATCH, PLACEHOLDER_LOGO, LOGO_MISMATCH, WRONG_PRICE, MISSING_INFORMATION, TEXT_UNREADABLE, PRODUCT_MISMATCH, VISUAL_QUALITY_LOW.',
    'Dê notas inteiras de 0 a 100 para: format, facts, brand, layout, product e visualQuality.',
    'Nunca retorne status ok se houver qualquer item em errors ou código bloqueante.',
    '',
    'Retorne somente JSON válido neste formato:',
    '{"status":"ok|warning|blocked","summary":"resumo curto","codes":["WRONG_PRICE"],"scores":{"format":0,"facts":0,"brand":0,"layout":0,"product":0,"visualQuality":0},"checks":["..."],"warnings":["..."],"errors":["..."]}',
  ].filter(Boolean).join('\n');
}

// Derives the generated image's real absolute file path from the content
// item's own on-disk location — content.filePath is always
// <targetDir>/_opensquad/content-central/..., so targetDir never has to be
// threaded separately through the generation/review call chain just for
// this lookup.
export function resolveContentImageAbsolutePath(content) {
  const filePath = String(content?.filePath || '');
  const marker = '_opensquad';
  const idx = filePath.lastIndexOf(marker);
  const projectId = content?.projectId;
  const imageUrl = String(content?.image?.url || '');
  if (idx === -1 || !projectId) return null;
  const targetDir = filePath.slice(0, idx).replace(/[\\/]+$/, '');
  const urlMarker = `/api/projects/${projectId}/assets/`;
  if (!imageUrl.startsWith(urlMarker)) return null;
  const { filePath: absolutePath } = resolveSafeAssetPath(targetDir, projectId, imageUrl.slice(urlMarker.length));
  return absolutePath;
}

// Replaces reviewAiImageWithHermes below — that path (a) only ever gave the
// reviewer a URL mentioned in text, never real pixels (Hermes had nothing to
// actually look at through the 'openai-codex' provider chat), and (b)
// crashed with a UnicodeDecodeError inside its own subprocess handling
// whenever the prompt contained Portuguese accented characters — confirmed
// live (2026-08-07) on real ad-creative review calls, which meant "revisão
// automática" silently never ran and every card fell back to "revise
// manualmente" without anyone reading the actual image. This attaches the
// real generated file via codex exec's vision support (-i), the same
// mechanism already proven reliable for prospect-screenshot reading.
async function reviewAiImageWithCodexAgent({ content, project, note }) {
  if (!content.image?.url) return null;
  const imagePath = resolveContentImageAbsolutePath(content);
  if (!imagePath) return null;
  const prompt = buildAiImageReviewPrompt({ content, project, note, attachedAsFile: true });
  const comparisonPaths = selectImageReferencesForCodex(content.image?.references || [])
    .filter((reference) => reference.absolutePath && String(reference.mimeType || '').startsWith('image/'))
    .map((reference) => reference.absolutePath)
    .filter((referencePath) => referencePath && referencePath !== imagePath);
  // An empty response here used to ship the card with no real review at
  // all — a transient hiccup (the CLI call returning null) silently became
  // "warning, review it yourself later" and the card went out anyway. Retry
  // a couple of times first; only fall back to the manual-review warning
  // once the reviewer has genuinely failed 3 times in a row.
  let raw = null;
  for (let attempt = 1; attempt <= 3 && !raw; attempt += 1) {
    raw = await callCodexAgentText(prompt, 'OPENSQUAD_REVIEW_TIMEOUT_MS', [imagePath, ...comparisonPaths]);
  }
  if (!raw) {
    return {
      status: 'warning',
      summary: 'Revisor automático indisponível (a IA não retornou resposta após 3 tentativas).',
      checks: [],
      warnings: ['Faça revisão visual manual antes de aprovar.'],
      errors: [],
    };
  }
  return parseReviewJson(raw);
}

// Same dispatch pattern/env var as callAiText — OPENSQUAD_TEXT_PROVIDER=hermes
// reverts the reviewer back to the old hermes-chat path in one line, no code
// change, if the codex-agent path ever needs to be backed out.
function reviewImageForActiveTextProvider(payload) {
  const provider = String(process.env.OPENSQUAD_TEXT_PROVIDER || 'codex-agent').trim().toLowerCase();
  if (provider === 'hermes') return reviewAiImageWithHermes(payload);
  return reviewAiImageWithCodexAgent(payload);
}

// Kept working and in place (not deleted) as the documented rollback for
// reviewAiImageWithCodexAgent above — same reversibility contract as every
// other hermes/codex-agent pair in this file.
async function reviewAiImageWithHermes({ content, project, note }) {
  if (!content.image?.url) return null;
  const prompt = buildAiImageReviewPrompt({ content, project, note });

  try {
    const { stdout } = await execFileAsync('hermes', [
      'chat',
      '-q',
      prompt,
      '-Q',
      '--provider', process.env.OPENSQUAD_HERMES_PROVIDER || 'openai-codex',
      '-m', process.env.OPENSQUAD_HERMES_MODEL || 'gpt-5.5',
      '--ignore-rules',
      '--source', 'tool',
      '--max-turns', '4',
    ], {
      timeout: Number(process.env.OPENSQUAD_REVIEW_TIMEOUT_MS || 120000),
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: '1' },
    });
    return parseReviewJson(stdout);
  } catch (err) {
    return {
      status: 'warning',
      summary: `Revisor automático indisponível: ${err.message}`,
      checks: [],
      warnings: ['Faça revisão visual manual antes de aprovar.'],
      errors: [],
    };
  }
}

// Shared one-shot hermes-chat text call used by the caption pipeline below.
// Returns trimmed plain text, or null on any failure — callers decide their
// own fallback (keep a draft, skip a stage, etc.). Kept working and in
// place (not deleted) as the documented rollback for callCodexAgentText
// below — same reversibility contract as the image providers: if the
// agent-based path ever needs to be backed out, callers just switch back to
// calling this function again, no other code changes required.
async function callHermesChatText(prompt, timeoutEnvVar) {
  try {
    const { stdout } = await execFileAsync('hermes', [
      'chat',
      '-q',
      prompt,
      '-Q',
      '--provider', process.env.OPENSQUAD_HERMES_PROVIDER || 'openai-codex',
      '-m', process.env.OPENSQUAD_HERMES_MODEL || 'gpt-5.5',
      '--ignore-rules',
      '--source', 'tool',
      '--max-turns', '4',
    ], {
      timeout: Number(process.env[timeoutEnvVar] || 120000),
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: '1' },
    });
    const text = String(stdout || '').trim();
    return text || null;
  } catch {
    return null;
  }
}

// Same fix as generateAiImageWithCodexAgent, for text: callHermesChatText
// above goes through Hermes' own 'openai-codex' plugin, which calls the same
// unofficial internal backend-api endpoint that hit the 429 usage-limit wall
// for images — confirmed live (2026-08-06) that this exact call
// ("hermes chat ... --provider openai-codex") still 429s even after the
// image fix, since it's a separate code path hitting the same restricted
// bucket. This instead shells out to a real `codex exec` agent turn (the
// mechanism proven NOT subject to that limit) and reads its final message
// back from -o/--output-last-message instead of stdout, since a plain text
// answer has no generated_images directory to read from the way an image
// does.
async function callCodexAgentText(prompt, timeoutEnvVar, imagePaths = []) {
  const outputFile = join(tmpdir(), `opensquad-codex-agent-text-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  try {
    await execFileNoStdin('codex', [
      'exec',
      prompt,
      '-C', tmpdir(),
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-o', outputFile,
      ...(imagePaths.length ? ['-i', ...imagePaths] : []),
    ], {
      timeout: Number(process.env[timeoutEnvVar] || 120000),
      maxBuffer: 1024 * 1024,
    });
    const text = await readFile(outputFile, 'utf-8').catch(() => '');
    return text.trim() || null;
  } catch {
    return null;
  } finally {
    await rm(outputFile, { force: true }).catch(() => {});
  }
}

// Default `learningImageAnalyzer` for analyzeLearningImage() (content-central.js)
// — kept here rather than in content-central.js to keep that file free of
// codex-shelling code, matching the existing analyzer/reviewer separation in
// this file (reviewAiImageWithCodexAgent, analyzeProspectScreenshotWithHermes).
async function analyzeLearningImageWithCodexAgent(imagePath, context, purpose = '') {
  const prompt = purpose === 'creative'
    ? `Analise esta imagem como REFERÊNCIA DE ESTRUTURA DE CRIATIVO para "${context}". Responda em português, em 4-7 linhas objetivas, somente sobre layout e hierarquia: posição do logo, chamada principal, produto, benefícios, preço, CTA, selos, blocos, contraste e ordem de leitura. Não descreva o produto específico, carne, alimento, textura, marmoreio, gordura, alecrim, sal, iluminação de produto ou cenário visual como aprendizado principal. Responda só com a estrutura, sem introdução.`
    : `Descreva em 1-2 frases o que esta imagem ensina sobre "${context}" para gerar artes publicitárias mais realistas: formato real do produto, textura, iluminação, o que evita parecer "gerado por IA". Responda só com a descrição, sem introdução.`;
  const raw = await callCodexAgentText(prompt, 'OPENSQUAD_REVIEW_TIMEOUT_MS', [imagePath]);
  return raw || '';
}

async function suggestOfferDirectionWithCodexAgent({ name, price, items, type, audienceType, productsOrServices, segment, imagePaths = [] }) {
  const prompt = [
    'Você é um estrategista de Direct Response para pequenos comércios no Brasil.',
    'Analise o título, preço, detalhes e, se anexada, a foto real do produto. Gere um direcionamento curto para preencher o campo OBSERVAÇÕES do cadastro antes de salvar a oferta.',
    '',
    `Nome/título: ${name || 'não informado'}`,
    `Preço: ${price || 'não informado'}`,
    `Detalhes cadastrados: ${items || 'não informado'}`,
    `Tipo: ${type || 'não informado'}`,
    `Raio-X público: ${audienceType || 'não informado'}`,
    `Raio-X segmento: ${segment || 'não informado'}`,
    `Raio-X produtos/serviços: ${productsOrServices || 'não informado'}`,
    '',
    'Regras:',
    '- Responda em português do Brasil, texto simples, sem markdown e sem introdução.',
    '- Não invente promessa técnica, certificação, material, capacidade, desempenho ou garantia que não esteja visível/dito.',
    '- Pode fazer promessas comerciais básicas quando forem sustentadas pelo produto/categoria: praticidade, economia de tempo, economia operacional, reposição fácil, organização da rotina, agilidade no atendimento e apoio ao delivery/balcão.',
    '- Use promessas reais por família do produto quando forem plausíveis pelo título/foto: limpeza pode falar em limpar/remover gordura quando a categoria indicar; guardanapos/papel toalha podem falar em absorção/servir; copos/pratos/talheres podem falar em servir com praticidade; filmes/alumínio/bobinas podem falar em embalar/proteger/separar; potes/marmitas/tampas podem falar em organização/fechamento; sacolas/sacos podem falar em resistência para rotina comercial e reforço quando indicado.',
    '- Vedação/fechamento só para itens com zip, lacre, adesivo, tampa ou fechamento cadastrado. Não chame fechamento comum de vedação hermética sem prova.',
    '- Se a foto ou título indicar categoria provável, use isso como tom/direcionamento, mas marque benefícios como seguros/prováveis.',
    '- Se o Raio-X público for B2B, priorize linguagem de negócio: operação, reposição, balcão, delivery, estoque, revenda, atacado e rotina da empresa; evite falar como consumidor final/doméstico.',
    '- Criar 1 chamada principal curta de benefício/vantagem antes do preço.',
    '- Listar até 3 benefícios permitidos e seguros para o criativo.',
    '- Incluir uma restrição de segurança: o que NÃO prometer.',
    '',
    'Formato obrigatório em 3 a 5 linhas:',
    'Direcionamento: ...',
    'Chamada sugerida: ...',
    'Promessas básicas permitidas: ...',
    'Benefícios permitidos: ...',
    'Não prometer: ...',
  ].join('\n');
  return await callCodexAgentText(prompt, 'OPENSQUAD_REVIEW_TIMEOUT_MS', imagePaths) || '';
}

// Same dispatch pattern as generateAiImageForActiveProvider — codex-agent is
// the default now that it's confirmed working where Hermes' openai-codex
// plugin 429s, but OPENSQUAD_TEXT_PROVIDER=hermes reverts every text call
// site (site analysis, captions, ad copy) back to callHermesChatText with a
// one-line env change, no code change.
async function callAiText(prompt, timeoutEnvVar) {
  const provider = String(process.env.OPENSQUAD_TEXT_PROVIDER || 'codex-agent').trim().toLowerCase();
  if (provider === 'hermes') return callHermesChatText(prompt, timeoutEnvVar);
  return callCodexAgentText(prompt, timeoutEnvVar);
}

const ONLINE_RESEARCH_MAX_RESULTS = 6;
const ONLINE_RESEARCH_MAX_PAGES = 3;
const ONLINE_RESEARCH_PAGE_CHARS = 1800;

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function decodeDuckDuckGoResultUrl(rawHref) {
  const href = decodeHtmlAttribute(rawHref);
  try {
    const parsed = new URL(href.startsWith('//') ? `https:${href}` : href);
    return parsed.searchParams.get('uddg') || parsed.toString();
  } catch {
    return href;
  }
}

function extractDuckDuckGoResults(html) {
  const results = [];
  const seen = new Set();
  const anchorPattern = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = anchorPattern.exec(html);
  while (match && results.length < ONLINE_RESEARCH_MAX_RESULTS) {
    const start = match.index;
    const end = anchorPattern.lastIndex;
    const next = html.slice(end).search(/<a[^>]+class=["'][^"']*result__a/i);
    const block = html.slice(start, next >= 0 ? end + next : Math.min(html.length, end + 2500));
    const url = decodeDuckDuckGoResultUrl(match[1]);
    if (!url || seen.has(url)) {
      match = anchorPattern.exec(html);
      continue;
    }
    seen.add(url);
    const title = htmlToReadableText(match[2]);
    const snippetMatch = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch ? htmlToReadableText(snippetMatch[1]) : '';
    results.push({ title, url, snippet });
    match = anchorPattern.exec(html);
  }
  return results;
}

async function searchDuckDuckGo(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: SITE_FETCH_HEADERS });
  if (!response.ok) throw new Error(`DuckDuckGo respondeu com status ${response.status}.`);
  return extractDuckDuckGoResults(await response.text());
}

async function collectOnlineVisualResearchEvidence({ segment, productsOrServices }) {
  const base = [segment, productsOrServices].filter(Boolean).join(' ').trim();
  const queries = [
    `${base} anúncio Instagram tendências visuais promoção`,
    `${base} posts promocionais Instagram referências visuais`,
  ];
  const found = [];
  const seen = new Set();
  for (const query of queries) {
    try {
      for (const result of await searchDuckDuckGo(query)) {
        if (!result.url || seen.has(result.url)) continue;
        seen.add(result.url);
        found.push({ query, ...result });
        if (found.length >= ONLINE_RESEARCH_MAX_RESULTS) break;
      }
    } catch (err) {
      console.error('[content-central] online reference search failed:', err.message);
    }
    if (found.length >= ONLINE_RESEARCH_MAX_RESULTS) break;
  }
  if (!found.length) throw new Error('A pesquisa online não encontrou resultados legíveis agora. Tente novamente em instantes.');

  let fetchedPages = 0;
  for (const result of found) {
    if (fetchedPages >= ONLINE_RESEARCH_MAX_PAGES) break;
    try {
      const { html } = await fetchRawHtml(result.url);
      const text = htmlToReadableText(html).slice(0, ONLINE_RESEARCH_PAGE_CHARS);
      if (text) {
        result.pageText = text;
        fetchedPages += 1;
      }
    } catch {
      // Search snippets are still real evidence; many social/ad-library pages
      // block anonymous fetches, so a blocked page should not discard the
      // whole research run.
    }
  }
  return found;
}

function formatOnlineResearchEvidence(evidence) {
  return evidence.map((item, index) => [
    `Fonte ${index + 1}: ${item.title || 'sem título'}`,
    `URL: ${item.url}`,
    item.snippet ? `Resumo do buscador: ${item.snippet}` : '',
    item.pageText ? `Trecho navegado: ${item.pageText}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

// Real "webResearcher" injected into researchOnlineVisualTrends() — collects
// live search results and fetches reachable pages directly from Node, avoiding
// the Hermes web-tool/Firecrawl dependency that may be disabled on the user's
// machine. The LLM only summarizes the collected evidence into visual
// PATTERNS (color, composition, typography), never competitor brand/logo/copy.
async function researchOnlineVisualTrendsWithHermes({ segment, productsOrServices }) {
  const evidence = await collectOnlineVisualResearchEvidence({ segment, productsOrServices });
  const prompt = buildOnlineVisualResearchPrompt({ segment, productsOrServices, evidence });
  const result = await callAiText(prompt, 'OPENSQUAD_RESEARCH_TIMEOUT_MS');
  if (!result) throw new Error('A pesquisa online coletou fontes, mas não conseguiu resumir direções visuais agora. Tente novamente em instantes.');
  return result;
}

function buildOnlineVisualResearchPrompt({ segment, productsOrServices, evidence = [] }) {
  return [
    'Você vai transformar evidências reais de busca/navegação em direções visuais para uma IA de imagem.',
    '',
    `Segmento: ${segment || 'não informado'}`,
    `Produtos/serviços: ${productsOrServices || 'não informado'}`,
    '',
    'EVIDÊNCIAS REAIS COLETADAS AGORA:',
    formatOnlineResearchEvidence(evidence),
    '',
    'IMPORTANTE: use só como inspiração de padrão visual, nunca como cópia. Não descreva nem cite marca, logo, texto ou preço específico de nenhum concorrente — resuma só o PADRÃO (ex: "fundo escuro com foto do produto centralizada e preço em selo circular colorido").',
    'Se as evidências forem mais sobre ideias de post do que sobre estética, extraia apenas padrões visuais seguros que apareçam nelas. Não diga que não pode pesquisar; a busca já foi feita pelo sistema.',
    '',
    'Responda em texto simples, uma descoberta por linha (sem markdown, sem numeração, sem títulos), entre 3 e 6 linhas, cada uma uma direção visual acionável e específica que a IA de geração de imagem deste projeto deveria seguir.',
  ].join('\n');
}

// Caption pipeline reusing two real personas already written for the
// "conteudo-multicanal" squad (squads/conteudo-multicanal/agents/) instead
// of an invented one: Sofia Social writes the first draft, then Dante
// Conteúdo (direct-response optimizer) audits and sharpens it — same two
// specialists, same hermes-chat bridge already proven by
// reviewAiImageWithHermes, just applied to text instead of image review.
// Captions previously only ever got a fill-in-the-blank skeleton from
// buildCaptionDraft; this replaces that with real, ready-to-publish copy.
export async function writeAiCaptionWithHermes({ content, project, note }) {
  const draft = await callAiText(
    buildSofiaSocialCaptionPrompt({ content, project, note }),
    'OPENSQUAD_COPY_TIMEOUT_MS'
  );
  if (!draft) return null;

  const optimized = await callAiText(
    buildDanteOptimizerPrompt({ content, project, draft }),
    'OPENSQUAD_COPY_OPTIMIZE_TIMEOUT_MS'
  );
  return optimized || draft;
}

// "Melhorar bio" for the instant prospecting preview — a single AI pass over
// the operator's draft, same callAiText dispatch (free codex-agent by
// default) as every other text generation site. Deliberately not allowed to
// invent facts (address, phone, promos, numbers) that aren't already in the
// draft — only rewrites what's there for clarity/persuasion, same discipline
// InstagramMockup itself follows for counts that were never confirmed.
function buildBioImprovePrompt({ bio, segment, businessName }) {
  return [
    'Melhore esta bio de Instagram para ficar mais atrativa e persuasiva, mantendo o formato curto de bio (poucas linhas, sem parágrafos longos, no máximo ~150 caracteres).',
    '',
    `Negócio: ${businessName || 'não informado'}`,
    `Segmento: ${segment || 'não informado'}`,
    `Bio atual: ${bio || '(vazia)'}`,
    '',
    'IMPORTANTE: não invente fatos que não estejam na bio atual (endereço, telefone, promoção, prêmio, número de clientes, anos de mercado etc.) — só reescreva o que já está lá de forma mais clara e atrativa. Pode usar emoji com moderação se combinar com o tom do negócio.',
    '',
    'Responda só com o texto final da bio, sem aspas, sem explicação, sem markdown.',
  ].join('\n');
}

export async function improveProspectBioWithAi({ bio, segment, businessName }) {
  const result = await callAiText(buildBioImprovePrompt({ bio, segment, businessName }), 'OPENSQUAD_BIO_IMPROVE_TIMEOUT_MS');
  return result ? result.trim() : null;
}

const AD_COPY_ANGLE_LABELS = { dor: 'Dor', desejo: 'Desejo/Resultado', urgencia: 'Urgência' };

// 125 characters is where Feed/Stories truncates primaryText behind "ver
// mais" on mobile — not a hard technical cap, just the point where the rest
// goes unseen unless the reader taps through. Budgeting for ~200 lets a
// second sentence (a concrete benefit/detail) follow the hook without
// relying on that tap; the prompt below still requires the hook alone to
// close inside the first ~100 chars so the truncated preview still works.
const AD_COPY_LIMITS = { headline: 40, primaryText: 200, description: 30 };

// Each real Meta objective wants a different kind of ask — a Vendas ad can
// push hard for a purchase, an Engajamento ad should invite a reaction
// instead of a sale, a Reconhecimento ad shouldn't hard-sell at all. This is
// the thing that actually changes copy tone when the objective changes.
const AD_OBJECTIVE_COPY_GUIDANCE = {
  whatsapp: 'CTA direto pro WhatsApp (ex: "Chame agora no WhatsApp"). Tom comercial, sem enrolação.',
  awareness: 'Sem venda dura — o objetivo é ser lembrado/reconhecido, não fechar agora. CTA suave (ex: "Conheça a [marca]", "Siga pra ver mais"), foco em identidade/diferencial, não em urgência de compra.',
  engagement: 'CTA que convida reação, não compra (ex: "Comenta aqui embaixo", "Marca quem também curte isso"). Tom de conversa, não de anúncio de venda.',
  leads: 'CTA de cadastro (ex: "Cadastre-se", "Garanta sua vaga", "Fale com a gente e receba mais informações"). Foco em baixar a barreira de entrada, não em fechar venda na hora.',
  sales: 'CTA direto de compra/pedido (ex: "Compre agora", "Peça já", "Garanta o seu"). Pode usar urgência real (sem inventar prazo/estoque).',
  app_promotion: 'CTA de instalação/uso do app (ex: "Baixe o app", "Instale agora"). Foco no benefício de usar pelo app.',
};

export function buildAdCopyPrompt({ adCreative, project, note, noteMode }) {
  const topic = adCreative.contentTopic || {};
  const subject = topic.offerName || `${project.name} (institucional)`;
  const objectiveGuidance = AD_OBJECTIVE_COPY_GUIDANCE[adCreative.objective] || AD_OBJECTIVE_COPY_GUIDANCE.whatsapp;
  const isBaseTotal = noteMode === 'base_total' && note;
  // Same learnings the organic image prompt already reads (buildImagePrompt
  // in content-central.js) — copy never saw this signal before, even though
  // it's the one place a wrong angle costs real media spend, not just a
  // rejected post.
  const avoidLearnings = Array.isArray(project.learnings?.avoid) ? project.learnings.avoid : [];
  const approvedLearnings = Array.isArray(project.learnings?.approved) ? project.learnings.approved : [];
  const learningLines = [
    ...avoidLearnings.map((line) => `- Evitar (motivo real já registrado numa rejeição anterior): ${line}`),
    ...approvedLearnings.map((line) => `- Já aprovado antes, pode reforçar o que funcionou: ${line}`),
  ];
  return [
    contentCentralPersonaLine('diego'),
    contentCentralPersonaResponsibilityLine('diego'),
    isBaseTotal
      ? 'Escreva 3 variações de anúncio para o mesmo criativo, todas baseadas na MESMA ideia central do operador (veja "Ideia do operador" abaixo) — varie a redação e o gancho de abertura, não o conceito. Ainda assim, rotule cada uma com o ângulo que mais combina (dor, desejo ou urgencia).'
      : 'Escreva 3 variações de anúncio para o mesmo criativo, cada uma partindo de um ângulo diferente: "dor" (o problema/incômodo que o produto resolve), "desejo" (o resultado/benefício que a pessoa quer) e "urgencia" (motivo real para agir agora, sem inventar prazo/estoque que não existe).',
    'Cada variação precisa soar como um anúncio de verdade, não como três textos genéricos com uma palavra trocada — mude o gancho, não só o adjetivo.',
    '',
    'EMPRESA',
    `- Nome: ${project.name}`,
    `- Segmento: ${project.brandInput?.segment || project.companyProfile?.segment || 'não informado'}`,
    audienceTypeToneLine(project),
    '',
    'ANÚNCIO',
    `- Assunto: ${subject}`,
    topic.price ? `- Preço: ${topic.price}` : '- Preço: não informado — não inventar preço nem desconto.',
    topic.items ? `- Itens/detalhes: ${topic.items}` : '',
    `- Objetivo: ${adCreative.objectiveLabel || 'Tráfego para o WhatsApp'}. ${objectiveGuidance}`,
    note ? `- Ideia do operador (${isBaseTotal ? 'baseie tudo nela' : 'use como inspiração adicional'}): ${note}` : '',
    '',
    learningLines.length ? 'APRENDIZADOS DE CONTEÚDOS ANTERIORES DESTE PROJETO' : '',
    ...learningLines,
    learningLines.length ? '' : '',
    'REGRAS',
    '- Nunca inventar preço, promoção, prazo, quantidade em estoque, depoimento, avaliação ou número que não foi passado acima.',
    '- Clareza acima de esperteza: frase direta em vez de trocadilho. Linguagem específica do negócio, não genérica.',
    `- "headline" (título, aparece abaixo da imagem): no máximo ${AD_COPY_LIMITS.headline} caracteres.`,
    `- "primaryText" (texto principal, aparece acima da imagem): no máximo ${AD_COPY_LIMITS.primaryText} caracteres, em até 2 frases. A 1ª frase sozinha precisa fechar o gancho completo em até uns 100 caracteres (é o que aparece no feed/story antes do "ver mais" no celular); a 2ª frase é opcional e reforça um detalhe concreto (prazo, quantidade, diferencial) antes do CTA.`,
    `- "description" (linha curta de apoio abaixo do título, pode não aparecer em todo lugar): no máximo ${AD_COPY_LIMITS.description} caracteres.`,
    '- "cta" é uma chamada curta coerente com o objetivo acima, nunca um link ou telefone inventado.',
    '',
    'Responda APENAS com um JSON válido, sem markdown e sem texto fora do JSON, neste formato exato:',
    '[{"angle":"dor","headline":"","primaryText":"","description":"","cta":""},{"angle":"desejo","headline":"","primaryText":"","description":"","cta":""},{"angle":"urgencia","headline":"","primaryText":"","description":"","cta":""}]',
  ].filter(Boolean).join('\n');
}

async function writeAdCopyVariationsWithHermes({ adCreative, project, note, noteMode }) {
  const raw = await callAiText(buildAdCopyPrompt({ adCreative, project, note, noteMode }), 'OPENSQUAD_COPY_TIMEOUT_MS');
  if (!raw) return null;
  const jsonText = raw.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonText) return null;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const cleanText = (value, limit) => {
    const text = String(value || '').trim();
    return limit ? text.slice(0, limit + 20) : text;
  };
  return parsed
    .map((entry) => ({
      angle: AD_COPY_ANGLE_LABELS[entry?.angle] ? entry.angle : 'dor',
      angleLabel: AD_COPY_ANGLE_LABELS[entry?.angle] || AD_COPY_ANGLE_LABELS.dor,
      headline: cleanText(entry?.headline, AD_COPY_LIMITS.headline),
      primaryText: cleanText(entry?.primaryText, AD_COPY_LIMITS.primaryText),
      description: cleanText(entry?.description, AD_COPY_LIMITS.description),
      cta: cleanText(entry?.cta),
    }))
    .filter((entry) => entry.headline && entry.primaryText);
}

function audienceTypeToneLine(project) {
  const audienceType = project.brandInput?.audienceType || project.companyProfile?.audienceType;
  if (audienceType === 'b2b') {
    return '- Foco comercial: B2B — quem lê é dono/gerente/comprador de outro negócio (revenda, atacado, operação). Tom consultivo e direto, sem hype de consumidor final, sem urgência artificial nem linguagem de e-commerce; fale de reposição, disponibilidade, praticidade para a operação dele.';
  }
  if (audienceType === 'b2c') {
    return '- Foco comercial: B2C — quem lê é o consumidor final. Pode usar desejo, benefício pessoal e um tom mais caloroso, sem precisar soar corporativo.';
  }
  return '';
}

export function buildSofiaSocialCaptionPrompt({ content, project, note }) {
  const topic = content.contentTopic || {};
  const subject = topic.offerName || topic.objective || topic.label || 'este post';
  return [
    contentCentralPersonaLine('sofia'),
    contentCentralPersonaResponsibilityLine('sofia'),
    'Escreva a legenda FINAL deste post — não é rascunho, é o texto que vai direto pro Instagram.',
    '',
    'EMPRESA',
    `- Nome: ${project.name}`,
    `- Segmento: ${project.brandInput?.segment || project.companyProfile?.segment || 'não informado'}`,
    `- Direção de tom aprovada: ${topic.objective || 'tom comercial, próximo e confiável, coerente com o segmento.'}`,
    audienceTypeToneLine(project),
    '',
    'POST',
    `- Canal: ${content.formatLabel || content.channel}`,
    `- Tipo de post: ${topic.label || 'publicação'}`,
    `- Assunto: ${subject}`,
    topic.price ? `- Preço: ${topic.price}` : '',
    topic.items ? `- Itens/detalhes: ${topic.items}` : '',
    `- CTA obrigatório (usar exatamente este sentido, pode adaptar a frase mas não o CTA): ${topic.cta || 'chamada simples e honesta'}`,
    note ? `- Observação para este post: ${note}` : '',
    '',
    'REGRAS',
    '- Nunca inventar preço, promoção, endereço, telefone ou qualquer informação que não foi passada acima.',
    '- Se não há preço informado, não inventar preço nem sugerir desconto.',
    '- Gancho forte na primeira linha — prende atenção sem ser clickbait vazio.',
    '- Corpo curto, direto, linguagem natural brasileira, sem parecer texto de robô ou anúncio genérico.',
    '- Terminar com o CTA de forma natural, não robótica.',
    '- Pode incluir de 2 a 5 hashtags relevantes no final, só se fizer sentido para o post.',
    '- Responda APENAS com o texto final da legenda — sem aspas, sem markdown, sem explicação antes ou depois.',
  ].filter(Boolean).join('\n');
}

export function buildDanteOptimizerPrompt({ content, project, draft }) {
  const topic = content.contentTopic || {};
  return [
    contentCentralPersonaLine('dante'),
    contentCentralPersonaResponsibilityLine('dante'),
    'Sua tarefa: auditar a legenda abaixo e devolver a versão otimizada, garantindo que ela tenha gancho forte, promessa clara, uma dor ou desejo real, conexão com a oferta e um CTA simples.',
    '',
    'MÉTODO DE ANÁLISE (aplicar mentalmente, não escrever a análise)',
    '1. Gancho: a primeira frase faz parar?',
    '2. Promessa: a pessoa entende o benefício?',
    '3. Especificidade: é específico deste negócio ou serviria pra qualquer um?',
    '4. Dor/desejo: toca uma motivação real?',
    '5. Objeções: remove dúvida ou desculpa?',
    '6. CTA: diz claramente o próximo passo?',
    '7. Canal: está adequado ao formato?',
    '8. Verdade: evita exagero, promessa de resultado garantido ou prova inventada?',
    '',
    'LEGENDA A OTIMIZAR',
    draft,
    '',
    'DADOS REAIS DESTE POST (não pode contradizer nem inventar além disso)',
    `- Empresa: ${project.name}`,
    topic.price ? `- Preço: ${topic.price}` : '- Preço: não informado — não inventar preço nem desconto.',
    `- CTA obrigatório: ${topic.cta || 'chamada simples e honesta'}`,
    '',
    'REGRAS DE SEGURANÇA',
    '- Não prometer renda ou resultado garantido.',
    '- Não inventar depoimento, número, autoridade, preço ou garantia que não esteja nos dados acima.',
    '- Não usar escassez falsa.',
    '- Se faltar prova para uma afirmação, remova a afirmação em vez de inventar prova.',
    '- Preservar tom humano e útil — persuasão sem parecer golpe.',
    audienceTypeToneLine(project),
    '',
    'Responda APENAS com o texto final da legenda otimizada — sem aspas, sem markdown, sem explicação, sem mostrar a análise ou o score.',
  ].filter(Boolean).join('\n');
}

const META_PUBLISH_SCRIPT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'squads', 'conteudo-multicanal', 'tools', 'meta-publish-multi.js');
const PUBLISHABLE_CHANNELS = new Set(['instagram_feed', 'instagram_story', 'instagram_reels', 'facebook_feed', 'facebook_story']);
const VIDEO_CHANNELS = new Set(['instagram_reels']);
const FACEBOOK_CHANNELS = new Set(['facebook_feed', 'facebook_story']);
const WHATSAPP_CHANNELS = new Set(['whatsapp_status']);

// Turns a served asset URL (/api/projects/{id}/assets/assets/generated/x.png)
// back into the real file on disk — the same convention sendProjectAsset
// already uses to serve it, just reversed.
function resolveGeneratedImageAbsolutePath(content, projectId, targetDir) {
  const url = content.image?.url || '';
  const marker = `/api/projects/${projectId}/assets/`;
  if (!url.startsWith(marker)) return null;
  const relativePath = url.slice(marker.length);
  const projectRoot = resolve(targetDir, '_opensquad', 'content-central', 'projects', projectId);
  return resolve(join(projectRoot, relativePath));
}

// Same resolution as above, plus an existence check — used to hand the
// existing image to the AI provider as an edit base for a targeted
// correction. Returns null (never throws) for anything that isn't a real
// file on disk, so a stale/foreign/missing URL just falls back to a normal
// fresh generation instead of failing the whole regenerate.
async function resolveExistingGeneratedImagePath(content, projectId, targetDir) {
  const filePath = resolveGeneratedImageAbsolutePath(content, projectId, targetDir);
  if (!filePath) return null;
  try {
    await access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

// Real "videoAnimator" injected into animateContentForReels() — "Animar
// para Reels". Takes the already-generated static creative and renders a
// short vertical MP4, entirely local via ffmpeg: no AI video model, no
// per-call cost, deterministic output. Meta's Reels endpoint only cares
// that it receives a valid video file — it has no opinion on how that
// video was produced.
const REELS_ANIMATION_DURATION_SECONDS = 7;
const REELS_ANIMATION_FPS = 30;

// Every generated creative follows the same vertical structure the image
// prompt enforces (ESTRUTURA VERTICAL OBRIGATÓRIA): logo/título no topo,
// produto no centro, CTA/preço no rodapé. Instead of a flat centered zoom
// (which ignores that structure entirely), the animation glides the crop
// window down through those three zones while it zooms in — a guided tour
// of the ad instead of a generic Ken Burns effect. No per-image analysis
// needed: the layout is already known because this system dictated it.
const REELS_PAN_TOP_FOCUS = 0.22; // logo/título
const REELS_PAN_BOTTOM_FOCUS = 0.82; // CTA/preço, short of the very edge

// A single soft light streak crossing the frame once, about a third of the
// way into the clip — the cheapest "doesn't look like a static zoom" cue
// available with zero per-image analysis and zero AI video cost. Kept
// narrow + blurred + brief so it reads as a glint, not a wash. A plain
// alpha overlay is used deliberately instead of a screen/additive blend:
// screen blend looked better in isolated single-frame tests, but corrupted
// color across the whole clip on the real multi-second zoompan render (a
// genuine ffmpeg color-range bug hit during testing, not a mistake in the
// filter itself) — not worth the fragility for a decorative effect.
const REELS_SHINE_START_SECONDS = REELS_ANIMATION_DURATION_SECONDS * (2.2 / 7);
const REELS_SHINE_DURATION_SECONDS = 1.3;

export async function animateImageForReelsWithFfmpeg({ content, project }, targetDir) {
  const localImagePath = resolveGeneratedImageAbsolutePath(content, project.projectId, targetDir);
  if (!localImagePath) throw new Error('Imagem gerada não encontrada localmente para animar.');

  const outputDir = resolve(targetDir, '_opensquad', 'content-central', 'projects', project.projectId, 'assets', 'generated');
  await mkdir(outputDir, { recursive: true });
  const filename = `reels-${Date.now()}.mp4`;
  const outputPath = join(outputDir, filename);

  const frames = REELS_ANIMATION_DURATION_SECONDS * REELS_ANIMATION_FPS;
  // Pan target as a fraction of image height, sliding linearly from the
  // top focus to the bottom focus across the whole clip.
  const panFraction = `(${REELS_PAN_TOP_FOCUS}+${(REELS_PAN_BOTTOM_FOCUS - REELS_PAN_TOP_FOCUS).toFixed(2)}*on/${frames - 1})`;
  // Clamped so the crop window never leaves the image — at zoom≈1 there's
  // no slack to pan at all (min/max collapse to ~0), so the pan naturally
  // only becomes visible as the zoom-in progresses, instead of snapping to
  // an offset the first frame can't actually support.
  const yExpr = `min(max(ih*${panFraction}-(ih/zoom/2),0),ih-ih/zoom)`;
  const zoomFilter = [
    `zoompan=z='min(zoom+0.0022,1.35)'`,
    `d=${frames}`,
    `x='iw/2-(iw/zoom/2)'`,
    `y='${yExpr}'`,
    `s=1080x1920`,
    `fps=${REELS_ANIMATION_FPS}`,
  ].join(':');
  const shineProgress = `min(1,max(0,(t-${REELS_SHINE_START_SECONDS})/${REELS_SHINE_DURATION_SECONDS}))`;
  const filterComplex = [
    `[0:v]${zoomFilter}[base]`,
    `[1:v]format=rgba,colorchannelmixer=aa=0.5,gblur=sigma=18[shine]`,
    `[base][shine]overlay=x='-200+1500*${shineProgress}':y='-200+400*${shineProgress}':format=auto[outv]`,
  ].join(';');

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-loop', '1',
      '-i', localImagePath,
      '-f', 'lavfi',
      '-i', `color=c=0xFFFBEF:s=110x2400:d=${REELS_ANIMATION_DURATION_SECONDS}`,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-t', String(REELS_ANIMATION_DURATION_SECONDS),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      outputPath,
    ], { timeout: Number(process.env.OPENSQUAD_ANIMATE_TIMEOUT_MS || 120000) });
  } catch (err) {
    throw new Error(`ffmpeg falhou ao animar a imagem: ${err.message}`, { cause: err });
  }

  return {
    url: `/api/projects/${project.projectId}/assets/assets/generated/${filename}`,
    localPath: outputPath,
    mimeType: 'video/mp4',
    durationSeconds: REELS_ANIMATION_DURATION_SECONDS,
  };
}

// Free, no-key fallback host used when IMGBB_API_KEY isn't configured — same
// service and multipart contract as squads/conteudo-multicanal/tools/gmail-approval-poller.py
// (upload_direct_image).
async function uploadToCatbox(localPath) {
  const absolutePath = resolve(localPath);
  const fileBuffer = await readFile(absolutePath);
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', new Blob([fileBuffer]), basename(absolutePath));
  const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
  const text = (await res.text()).trim();
  if (!res.ok || !text) throw new Error(`Catbox upload falhou [${res.status}]: ${text.slice(0, 200)}`);
  return text;
}

// Second free, no-key host — tried only when Catbox itself is unreachable
// (confirmed in production: Catbox can have outages where every request
// resets mid-TLS-handshake, which previously surfaced as an opaque "fetch
// failed" with no way to recover without a manual retry later). Verified
// directly against a real generated video: returns a direct URL serving
// the correct video/mp4 content-type, not an HTML preview page.
async function uploadToUguu(localPath) {
  const absolutePath = resolve(localPath);
  const fileBuffer = await readFile(absolutePath);
  const form = new FormData();
  form.append('files[]', new Blob([fileBuffer]), basename(absolutePath));
  const res = await fetch('https://uguu.se/upload', { method: 'POST', body: form });
  const text = (await res.text()).trim();
  if (!res.ok || !text) throw new Error(`uguu.se upload falhou [${res.status}]: ${text.slice(0, 200)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`uguu.se upload retornou resposta inesperada: ${text.slice(0, 200)}`);
  }
  const url = parsed?.files?.[0]?.url;
  if (!url) throw new Error(`uguu.se upload não retornou uma URL válida: ${text.slice(0, 200)}`);
  return url;
}

async function uploadToFreeHost(localPath) {
  try {
    return await uploadToCatbox(localPath);
  } catch (catboxErr) {
    try {
      return await uploadToUguu(localPath);
    } catch (uguuErr) {
      throw new Error(
        `Catbox e uguu.se falharam ao hospedar o arquivo (Catbox: ${catboxErr.message}; uguu.se: ${uguuErr.message}).`,
        { cause: uguuErr }
      );
    }
  }
}

// Same safety check as gmail-approval-poller.py's check_direct_image_url —
// never trust a hosting URL is safe to hand to the Meta Graph API without
// confirming it actually serves image bytes.
async function isDirectImageUrl(url) {
  try {
    const res = await fetch(url);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    return res.ok && contentType.startsWith('image/');
  } catch {
    return false;
  }
}

export async function uploadGeneratedImagePublicly(localPath) {
  const apiKey = process.env.IMGBB_API_KEY;
  const url = apiKey ? await uploadToImgBB(localPath, apiKey) : await uploadToFreeHost(localPath);
  if (!(await isDirectImageUrl(url))) {
    throw new Error(`Imagem hospedada em ${url} não respondeu como imagem — não é seguro publicar na Meta.`);
  }
  return url;
}

// Same idea as isDirectImageUrl, for the Reels video upload path — imgBB
// doesn't host video at all, so this always goes through Catbox regardless
// of IMGBB_API_KEY.
async function isDirectVideoUrl(url) {
  try {
    const res = await fetch(url);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    return res.ok && contentType.startsWith('video/');
  } catch {
    return false;
  }
}

export async function uploadGeneratedVideoPublicly(localPath) {
  const url = await uploadToFreeHost(localPath);
  if (!(await isDirectVideoUrl(url))) {
    throw new Error(`Vídeo hospedado em ${url} não respondeu como vídeo — não é seguro publicar na Meta.`);
  }
  return url;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A hosting hiccup (imgBB/Catbox CDN not yet propagated when Meta or the
// operator's own re-fetch checks it) is the exact same transient failure
// publishContentToInstagram already retries through at publish time — this
// gives the approve-time upload the identical settle-delay + retry
// treatment (same env vars, same shape), so it self-heals here too instead
// of leaving the item stuck with mediaUrl: null until someone notices.
async function uploadWithRetry(uploadFn) {
  const maxAttempts = Math.max(1, Number(process.env.OPENSQUAD_PUBLISH_RETRY_ATTEMPTS || 3));
  const retryDelayMs = Math.max(0, Number(process.env.OPENSQUAD_PUBLISH_RETRY_DELAY_MS || 4000));
  const settleDelayMs = Math.max(0, Number(process.env.OPENSQUAD_PUBLISH_SETTLE_DELAY_MS || 2500));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await delay(settleDelayMs);
      return await uploadFn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) await delay(retryDelayMs * attempt);
    }
  }
  throw lastError;
}

// The real "metaPublisher" injected into runDuePublishSweep — everything
// that actually talks to the outside world (imgBB upload, the Meta Graph
// API subprocess) lives here, kept out of content-central.js so the
// scheduling/due-item logic stays testable with a fake.
//
// Meta's crawler sometimes fetches the freshly-uploaded image URL before the
// host's CDN has fully propagated it and rejects it with "Only photo or
// video can be accepted as media type" (subcode 2207052), even though the
// same URL serves the image correctly moments later. A short settle delay
// plus a couple of retries (re-uploading a fresh URL each time) lets that
// transient race self-heal within the same scheduled attempt, instead of
// leaving the post stuck until the next sweep cycle.
async function publishContentToInstagram({ content, project }, targetDir) {
  if (WHATSAPP_CHANNELS.has(content.channel)) {
    return publishContentToWhatsAppStatus({ content, project }, targetDir);
  }
  if (!PUBLISHABLE_CHANNELS.has(content.channel)) {
    throw new Error(`Canal "${content.channel}" ainda não tem publicação real suportada (só Instagram/Facebook Feed, Story e Reels hoje).`);
  }
  const isVideoChannel = VIDEO_CHANNELS.has(content.channel);
  const localImagePath = isVideoChannel ? null : resolveGeneratedImageAbsolutePath(content, project.projectId, targetDir);
  if (!isVideoChannel && !localImagePath) throw new Error('Imagem gerada não encontrada para publicar.');
  if (isVideoChannel && !content.video?.localPath) {
    throw new Error('Este Reels ainda não tem vídeo gerado — clique em "Animar para Reels" antes de aprovar a publicação real.');
  }

  const token = await readProjectToken(project.projectId, targetDir);
  if (!token) throw new Error('Nenhum token Meta cadastrado para este projeto.');

  const isFacebookChannel = FACEBOOK_CHANNELS.has(content.channel);
  const instagramUserId = project.instagram?.instagramUserId;
  const pageId = project.instagram?.pageId;
  if (isFacebookChannel && !pageId) {
    throw new Error('Projeto sem Facebook Page ID cadastrado — valide o token na aba "Conta e token" com uma conta ligada a uma Página do Facebook.');
  }
  if (!isFacebookChannel && !instagramUserId) {
    throw new Error('Projeto sem Instagram User ID cadastrado — valide o token na aba "Conta e token".');
  }

  const maxAttempts = Math.max(1, Number(process.env.OPENSQUAD_PUBLISH_RETRY_ATTEMPTS || 3));
  const retryDelayMs = Math.max(0, Number(process.env.OPENSQUAD_PUBLISH_RETRY_DELAY_MS || 4000));
  const settleDelayMs = Math.max(0, Number(process.env.OPENSQUAD_PUBLISH_SETTLE_DELAY_MS || 2500));

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // approveContent's mediaUploader hook already uploaded and validated
      // this exact file at approve time — reuse that URL on the first
      // attempt instead of uploading it again (saves a redundant upload and
      // keeps this publish's mediaUrl from drifting from what's in the
      // gaveta). A retry (attempt > 1) still uploads fresh, in case the
      // reused URL itself was the problem.
      const mediaUrl = attempt === 1 && content.publish?.mediaUrl
        ? content.publish.mediaUrl
        : isVideoChannel
          ? await uploadGeneratedVideoPublicly(content.video.localPath)
          : await uploadGeneratedImagePublicly(localImagePath);
      await delay(settleDelayMs);
      const payload = {
        publish_targets: [{
          channel: content.channel,
          ...(isVideoChannel ? { video_url: mediaUrl } : { image_url: mediaUrl }),
          caption: content.caption?.text || '',
        }],
      };
      const { stdout } = await execFileAsync('node', [META_PUBLISH_SCRIPT, '--payload-json', JSON.stringify(payload)], {
        timeout: Number(process.env.OPENSQUAD_PUBLISH_TIMEOUT_MS || 300000),
        maxBuffer: 1024 * 1024,
        // meta-publish-multi.js resolves the Facebook Page's own access
        // token from FACEBOOK_PAGE_ID + this same Instagram token when no
        // dedicated FACEBOOK_PAGE_ACCESS_TOKEN is set — no separate Facebook
        // credential storage needed on our side.
        env: { ...process.env, INSTAGRAM_ACCESS_TOKEN: token, INSTAGRAM_USER_ID: instagramUserId || '', FACEBOOK_PAGE_ID: pageId || '' },
      });
      const parsed = JSON.parse(stdout);
      const result = parsed.results?.[0];
      if (!result?.ok) throw new Error('Publicação na Meta falhou sem detalhe.');
      return { mediaId: result.media_id, permalink: result.permalink || null };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) await delay(retryDelayMs * attempt);
    }
  }
  throw lastError;
}

const WAHA_SESSION_PREFIX = 'opensquad-';

// WAHA Core uses one global API key for every call — admin (create/status)
// and publish alike — unlike Evolution's split of a public server URL plus
// a separate per-instance token. See the design spec's accepted trade-off:
// this loses Evolution's per-project key isolation, but WAHA Core doesn't
// support scoped session tokens (only WAHA Plus does).
function wahaConfig() {
  const url = process.env.OPENSQUAD_WAHA_ADMIN_URL;
  const apiKey = process.env.OPENSQUAD_WAHA_APIKEY;
  if (!url || !apiKey) throw new Error('Servidor WAHA não configurado — contate o administrador.');
  return { url: url.replace(/\/$/, ''), apiKey };
}

// Creates the session on first connect, restarts it if it fell over
// (FAILED/STOPPED), or just re-fetches its current QR otherwise — same
// button, same route, all three cases. A session already WORKING is left
// alone (nothing to scan, and restarting it would drop a live connection).
async function connectProjectWhatsAppSession(projectId, project, targetDir) {
  const { url, apiKey } = wahaConfig();
  const sessionName = `${WAHA_SESSION_PREFIX}${projectId}`;
  const headers = { 'X-Api-Key': apiKey };

  let status;
  const statusRes = await fetch(`${url}/api/sessions/${sessionName}`, { headers });
  if (statusRes.status === 404) {
    const createRes = await fetch(`${url}/api/sessions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sessionName, config: {} }),
    });
    if (!createRes.ok) throw new Error(`WAHA respondeu ${createRes.status}: ${await createRes.text()}`);
    const startRes = await fetch(`${url}/api/sessions/${sessionName}/start`, { method: 'POST', headers });
    if (!startRes.ok) throw new Error(`WAHA respondeu ${startRes.status}: ${await startRes.text()}`);
    status = 'STARTING';
  } else if (!statusRes.ok) {
    throw new Error(`WAHA respondeu ${statusRes.status}: ${await statusRes.text()}`);
  } else {
    status = (await statusRes.json()).status;
  }

  let updatedProject = project;
  // Covers both a never-connected project (no whatsapp block yet) AND a
  // project still carrying the old Evolution shape ({ instanceName,
  // maskedApiKey }, configured: true, no sessionName) — either way,
  // sessionName not matching what this connect just resolved means the
  // stored record needs updating, not just the "configured" flag.
  if (project.whatsapp?.sessionName !== sessionName) {
    updatedProject = await saveProjectWhatsAppInstance(projectId, { sessionName }, targetDir);
  }

  if (status === 'WORKING') return { qrcode: null, project: updatedProject };

  if (status === 'FAILED' || status === 'STOPPED') {
    const restartRes = await fetch(`${url}/api/sessions/${sessionName}/restart`, { method: 'POST', headers });
    if (!restartRes.ok) throw new Error(`WAHA respondeu ${restartRes.status}: ${await restartRes.text()}`);
  }

  const qrRes = await fetch(`${url}/api/${sessionName}/auth/qr?format=image`, { headers });
  if (!qrRes.ok) throw new Error(`WAHA respondeu ${qrRes.status}: ${await qrRes.text()}`);
  const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
  const qrcode = `data:image/png;base64,${qrBuffer.toString('base64')}`;

  return { qrcode, project: updatedProject };
}

// Connection state is never persisted (see Global Constraints) — always
// asked live so a phone-side logout or session expiry shows up immediately
// instead of a stale "connected" the operator has no reason to distrust.
async function getProjectWhatsAppConnectionStatus(projectId, project) {
  if (!project.whatsapp?.configured) return { connected: false, state: 'not_configured' };
  const { url, apiKey } = wahaConfig();
  const sessionName = project.whatsapp.sessionName;
  const res = await fetch(`${url}/api/sessions/${sessionName}`, { headers: { 'X-Api-Key': apiKey } });
  if (!res.ok) throw new Error(`WAHA respondeu ${res.status}: ${await res.text()}`);
  const parsed = await res.json();
  const state = parsed.status || 'unknown';
  return { connected: state === 'WORKING', state };
}

// The real "whatsappPublisher" for the beta WhatsApp Status channel — a
// single direct HTTP call, unlike Meta's meta-publish-multi.js subprocess
// (which exists to orchestrate multiple publish_targets in one call; this
// is always exactly one target). Short timeout, no retry loop: re-hitting a
// call that might hang doesn't recover from a transient blip, it just
// triples the wait for the same failure — same reasoning as before.
export async function publishContentToWhatsAppStatus({ content, project }, targetDir) {
  const sessionName = project.whatsapp?.sessionName;
  if (!sessionName) {
    throw new Error('Sessão WAHA não configurada para este projeto — configure na aba "Conta e token".');
  }
  const { url, apiKey } = wahaConfig();

  // content.publish?.mediaUrl (already-hosted URL, e.g. from a prior publish
  // attempt) short-circuits the local-file lookup/upload entirely — only
  // fall back to resolving+uploading the generated image on disk when no
  // hosted URL is already known.
  let mediaUrl = content.publish?.mediaUrl;
  if (!mediaUrl) {
    const localImagePath = resolveGeneratedImageAbsolutePath(content, project.projectId, targetDir);
    if (!localImagePath) throw new Error('Imagem gerada não encontrada para publicar.');
    mediaUrl = await uploadGeneratedImagePublicly(localImagePath);
  }
  const timeoutMs = Number(process.env.OPENSQUAD_WHATSAPP_PUBLISH_TIMEOUT_MS || 90000);
  try {
    const res = await fetch(`${url}/api/${sessionName}/status/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({
        file: { mimetype: 'image/png', url: mediaUrl },
        caption: content.caption?.text || '',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`WAHA respondeu ${res.status}: ${await res.text()}`);
    const parsed = await res.json();
    return { mediaId: parsed.id || null, permalink: null };
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new Error('Canal beta instável — WAHA não respondeu a tempo.', { cause: err });
    }
    throw err;
  }
}

export function startPublishScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') return null;
  if (process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER === 'false') return null;
  const intervalMs = Number(process.env.OPENSQUAD_PUBLISH_CHECK_INTERVAL_MS || 180000);
  const sweep = () => runDuePublishSweep(targetDir, {
    metaPublisher: (payload) => publishContentToInstagram(payload, targetDir),
  }).catch((err) => console.error('[content-central] publish sweep failed:', err.message));
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}

// Independent of startPublishScheduler/OPENSQUAD_AUTO_PUBLISH_SCHEDULER —
// Instagram/Facebook publish exclusively via the opensquad-gaveta GitHub
// Action now; this is whatsapp_status's own local sweep, since WAHA has no
// public address the Action could reach. Runs whenever the local server
// does, gated only by the same real-publishing master switch. channels:
// WHATSAPP_CHANNELS keeps this sweep from ever seeing (let alone touching)
// an Instagram/Facebook item that happens to be due in the same project.
export function startWhatsAppPublishScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') return null;
  const intervalMs = Number(process.env.OPENSQUAD_PUBLISH_CHECK_INTERVAL_MS || 180000);
  const sweep = () => runDuePublishSweep(targetDir, {
    metaPublisher: (payload) => publishContentToWhatsAppStatus(payload, targetDir),
    channels: WHATSAPP_CHANNELS,
  }).catch((err) => console.error('[content-central] whatsapp publish sweep failed:', err.message));
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}

// Reuses the same authenticated Gmail account the old squads' approval/
// reminder emails already send from (google_api.py, via the Hermes agent's
// own venv) instead of wiring up a second credential (Resend, SMTP, etc.)
// just for this.
const GOOGLE_WORKSPACE_SCRIPT = join(
  process.env.LOCALAPPDATA || '',
  'hermes', 'skills', 'productivity', 'google-workspace', 'scripts', 'google_api.py'
);

async function sendAlertEmailViaGoogleWorkspace({ subject, body }) {
  const { pythonBin } = resolveHermesPython();
  const recipient = process.env.OPENSQUAD_ALERTS_EMAIL || 'juciclei.ger@gmail.com';
  await execFileAsync(pythonBin, [
    GOOGLE_WORKSPACE_SCRIPT, 'gmail', 'send',
    '--to', recipient,
    '--subject', subject,
    '--body', body,
  ], {
    timeout: Number(process.env.OPENSQUAD_ALERT_EMAIL_TIMEOUT_MS || 30000),
  });
}

function startAlertEmailScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_ALERT_EMAILS === 'false') return null;
  const intervalMs = Number(process.env.OPENSQUAD_ALERT_EMAIL_CHECK_INTERVAL_MS || 900000);
  const sweep = () => sendDueAlertEmails(targetDir, {
    emailSender: sendAlertEmailViaGoogleWorkspace,
  }).catch((err) => console.error('[content-central] alert email sweep failed:', err.message));
  const timer = setInterval(sweep, intervalMs);
  sweep();
  return timer;
}

function parseReviewJson(stdout) {
  const raw = String(stdout || '').trim();
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1]
    || raw.match(/```\s*([\s\S]*?)```/i)?.[1]
    || raw;
  const jsonText = fenced.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error('Revisor não retornou JSON.');
  return JSON.parse(jsonText);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function briefingImageSource(item) {
  if (item.image?.generatedSource) return item.image?.previewUrl || item.image?.url || item.image?.previewDataUrl || '';
  return item.image?.previewDataUrl || item.image?.previewUrl || item.image?.url || '';
}

// Rewrites one of our own served asset URLs to the resized-preview route
// (see sendProjectAssetPreview) so the presentation page — and the PDF it
// prints to — stays a reasonable size instead of embedding the full 2-4MB
// generated PNGs. Anything that isn't one of our own asset URLs (a data:
// placeholder, or an external URL in tests) passes through untouched.
function briefingPreviewImageSource(item, projectId) {
  const src = briefingImageSource(item);
  const marker = `/api/projects/${projectId}/assets/`;
  return src && src.startsWith(marker) ? `/api/projects/${projectId}/assets-preview/${src.slice(marker.length)}` : src;
}

const IG_ICON_HEART = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 6.6a5.5 5.5 0 0 0-7.8 0L12 7.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-5.8z"/></svg>';
const IG_ICON_COMMENT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 8.7 8.7 0 0 1-3.8-.9L3 21l1.9-5.3a8.4 8.4 0 0 1-.9-3.7A8.4 8.4 0 0 1 12.6 3a8.4 8.4 0 0 1 8.4 8.5z"/></svg>';
const IG_ICON_SHARE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
const IG_ICON_BOOKMARK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';

function briefingUsername(project) {
  return String(project?.instagram?.handle || project?.name || 'sua_marca').replace(/^@/, '');
}

function briefingAvatarInitial(project) {
  return (String(project?.name || '?').trim()[0] || '?').toUpperCase();
}

// A phone-screenshot mockup — real Instagram chrome (top bar, avatar,
// action icons), not just a bare rounded-corner image frame — so the client
// sees the post the same way it'll actually look once it's live, the same
// treatment reference agency decks use. Feed and Story get different real
// Instagram chrome (a Feed post has a top app bar + icon row below the
// image; a Story has its progress bar/handle/close overlaid on the image
// itself), so this branches on `variant` instead of using one generic frame.
function renderIgMockup(item, project, variant) {
  const src = briefingPreviewImageSource(item, project.projectId);
  const image = src
    ? `<img src="${escapeHtml(src)}" alt="Prévia do card">`
    : '<div class="ig-empty">Sem imagem de prévia</div>';
  const username = escapeHtml(briefingUsername(project));
  const initial = escapeHtml(briefingAvatarInitial(project));

  if (variant === 'story') {
    return `<div class="ig-mock ig-mock-story">
      <div class="ig-story-progress"><span></span></div>
      <div class="ig-story-header">
        <span class="ig-avatar ig-avatar-sm">${initial}</span>
        <span class="ig-story-user">${username}</span>
        <span class="ig-story-time">agora</span>
        <span class="ig-story-close">&#10005;</span>
      </div>
      <div class="ig-image ig-image-story">${image}</div>
    </div>`;
  }

  return `<div class="ig-mock ig-mock-feed">
    <div class="ig-topbar">
      <span class="ig-wordmark">Instagram</span>
      <span class="ig-topicons">${IG_ICON_HEART}${IG_ICON_SHARE}</span>
    </div>
    <div class="ig-postheader">
      <span class="ig-avatar">${initial}</span>
      <span class="ig-username">${username}</span>
    </div>
    <div class="ig-image ig-image-feed">${image}</div>
    <div class="ig-actionbar">
      ${IG_ICON_HEART}${IG_ICON_COMMENT}${IG_ICON_SHARE}
      <span class="ig-spacer"></span>
      ${IG_ICON_BOOKMARK}
    </div>
  </div>`;
}

// Standalone read-only page (not part of the main SPA tabs) listing every
// card not yet approved for a project, with a one-click approve per card —
// the link an operator can open with/for the client during a review call
// instead of sending a raw JSON file.
// Cards that share the same AI creative (see creativeGroupKey /
// enrichBatchItemsWithRealImages in content-central.js — Story+Reels+Facebook
// Story, or Feed+Facebook Feed, on the same day/slot) are visually identical:
// same image, same caption. Repeating that as N separate cards just because
// N channels will publish it reads as clutter and makes the client click
// "aprovar" N times for what looks like one post. Group them into a single
// card with one tag per channel and one approve button that approves all of
// them at once.
function groupBriefingItems(items) {
  const byKey = new Map();
  items.forEach((item, index) => {
    const key = item.creativeGroupKey || `__solo__${index}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  });
  const sortKey = (item) => `${item.scheduledDate}${item.scheduledTime || ''}`;
  const groups = [...byKey.values()].map((members) => {
    const sorted = [...members].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return { leader: sorted[0], members: sorted };
  });
  groups.sort((a, b) => sortKey(a.leader).localeCompare(sortKey(b.leader)));
  return groups;
}

const BRIEFING_MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// Client-facing date, matched to how an agency would write it on a proposal
// slide ("20 de julho de 2026") rather than the raw ISO date an operator
// works with internally.
function formatBriefingDate(dateStr) {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return `${parsed.getDate()} de ${BRIEFING_MONTH_NAMES[parsed.getMonth()]} de ${parsed.getFullYear()}`;
}

// This page is a presentation artifact only — it shows the client what's
// coming, it does not let them (or anyone browsing the link) change real
// system state. The actual approve decision always happens inside the
// operator's own panel (PendingApproval), never from a page that could be
// forwarded outside the team.
function renderBriefingGroupCard(group, project, variant) {
  const leader = group.leader;
  const channelTags = group.members.map((member) => `<span class="pill">${escapeHtml(member.formatLabel || member.channel)}</span>`).join('');
  return `<div class="briefing-card">
      <div class="ig-mock-wrap">${renderIgMockup(leader, project, variant)}</div>
      <div class="briefing-body">
        <div class="briefing-status">Aguardando aprovação</div>
        <div class="briefing-date">Dia ${escapeHtml(leader.dayNumber)} · ${escapeHtml(formatBriefingDate(leader.scheduledDate))}${leader.scheduledTime ? ` · ${escapeHtml(leader.scheduledTime)}` : ''}</div>
        <div class="briefing-meta">${channelTags}</div>
        <h3 class="briefing-caption-label">Descrição da publicação</h3>
        <div class="briefing-caption">${escapeHtml(leader.caption?.text || 'Sem legenda')}</div>
      </div>
    </div>`;
}

function renderBriefingSection(title, groups, project, variant) {
  if (!groups.length) return '';
  return `<section class="briefing-section">
    <h2 class="briefing-section-title">${escapeHtml(title)}</h2>
    <div class="briefing-section-list">${groups.map((group) => renderBriefingGroupCard(group, project, variant)).join('')}</div>
  </section>`;
}

function renderBriefingPage(project, items) {
  const groups = groupBriefingItems(items);
  const storyGroups = groups.filter((group) => creativeShapeGroupForChannel(group.leader.channel) !== 'feed');
  const feedGroups = groups.filter((group) => creativeShapeGroupForChannel(group.leader.channel) === 'feed');
  const sections = `${renderBriefingSection('Stories, Reels e Facebook Story', storyGroups, project, 'story')}${renderBriefingSection('Feed e Facebook Feed', feedGroups, project, 'feed')}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(project.name)} — próximos posts</title>
<style>
:root{color-scheme:dark;--bg:#050508;--accent:#8b6bff;--accent-2:#ff5fb8;--accent-gradient:linear-gradient(135deg,var(--accent) 0%,#c15fff 48%,var(--accent-2) 100%);--line:rgba(255,255,255,.09);--soft:#d6d4e0;--muted:#94939f;--text:#f8f7fb}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;line-height:1.55;padding:28px 20px 60px}
header{max-width:920px;margin:0 auto 26px}
header h1{margin:0 0 8px;font-size:clamp(24px,3vw,32px);letter-spacing:-.03em}
header p{margin:0;color:var(--muted)}
.wrap{max-width:920px;margin:0 auto;display:grid;gap:28px}
.briefing-section-title{margin:0 0 14px;font-size:18px;letter-spacing:-.02em;color:var(--soft)}
.briefing-section-list{display:grid;gap:8px}
.briefing-card+.briefing-card{border-top:1px solid var(--line)}
.briefing-card{display:grid;grid-template-columns:minmax(200px,260px) minmax(0,1fr);gap:18px;background:transparent;padding:10px 0;transition:opacity .3s ease}
.ig-mock-wrap{display:flex;align-items:flex-start;justify-content:center;padding:14px}
.ig-mock{width:100%;max-width:220px;border-radius:20px;overflow:hidden;background:#fff;color:#111;box-shadow:0 20px 44px rgba(0,0,0,.45)}
.ig-image{background:#000;display:grid;place-items:center;color:#888;font-size:12px;overflow:hidden}
.ig-image img{width:100%;height:100%;object-fit:cover;display:block}
.ig-image-feed{aspect-ratio:4/5}
.ig-image-story{aspect-ratio:9/16}
.ig-empty{padding:16px;text-align:center}
.ig-topbar{display:flex;align-items:center;justify-content:space-between;padding:10px 12px}
.ig-wordmark{font-family:'Segoe Script','Brush Script MT',cursive;font-style:italic;font-size:22px;font-weight:700}
.ig-topicons{display:flex;gap:14px;color:#111}
.ig-topicons svg,.ig-actionbar svg{display:block}
.ig-postheader{display:flex;align-items:center;gap:8px;padding:0 12px 10px}
.ig-avatar{width:28px;height:28px;border-radius:999px;background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:800;flex:0 0 auto}
.ig-username{font-size:13px;font-weight:700}
.ig-actionbar{display:flex;align-items:center;gap:14px;padding:10px 12px;color:#111}
.ig-spacer{flex:1}
.ig-mock-story{position:relative}
/* Real Instagram Stories keep this header to a thin single row (progress
   bar + a small avatar/username/time line) right at the very top edge —
   the earlier version here was tall enough, with a wide dark gradient
   band, that it fought with the creative's own title text underneath
   (which the image prompt already places near the top of the canvas).
   Kept small and the gradient limited to just behind the row itself. */
.ig-mock-story::before{content:'';position:absolute;top:0;left:0;right:0;height:34px;background:linear-gradient(to bottom,rgba(0,0,0,.4),transparent);z-index:1;pointer-events:none}
.ig-story-progress{position:absolute;top:5px;left:8px;right:8px;height:2px;border-radius:999px;background:rgba(255,255,255,.35);z-index:2}
.ig-story-progress span{display:block;width:60%;height:100%;border-radius:999px;background:#fff}
.ig-story-header{position:absolute;top:11px;left:8px;right:8px;display:flex;align-items:center;gap:5px;z-index:2;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7)}
.ig-avatar-sm{width:16px;height:16px;font-size:8px}
.ig-story-user{font-size:10px;font-weight:700}
.ig-story-time{font-size:9px;opacity:.85}
.ig-story-close{margin-left:auto;font-size:12px;opacity:.9}
.briefing-status{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;color:var(--soft);background:rgba(255,255,255,.04);margin-bottom:10px}
.briefing-date{font-size:16px;font-weight:750;letter-spacing:-.01em;margin-bottom:10px}
.briefing-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.pill{border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;color:var(--soft)}
.briefing-caption-label{margin:0 0 8px;font-size:14px;font-weight:750;color:var(--soft)}
.briefing-caption{white-space:pre-wrap;background:rgba(0,0,0,.24);border:1px solid var(--line);border-radius:14px;padding:12px;color:var(--soft)}
.empty-state{max-width:920px;margin:60px auto;text-align:center;color:var(--muted)}
.download-pdf{min-height:42px;border:1px solid var(--line);border-radius:12px;background:transparent;color:var(--text);font-weight:700;padding:0 16px;cursor:pointer;margin-top:12px}
.download-pdf:hover{border-color:var(--accent)}
@media(max-width:640px){.briefing-card{grid-template-columns:1fr}}
@media print{
  body{background:#fff;color:#111;padding:0}
  body::before,body::after{display:none}
  .download-pdf{display:none}
  .briefing-card{break-inside:avoid;page-break-inside:avoid}
  .briefing-card+.briefing-card{border-top-color:#e5e5e5}
  .ig-mock{box-shadow:none;border:1px solid #eee}
  .ig-image{background:#f4f4f4}
  .briefing-status{border-color:#ccc;color:#333;background:#f4f4f4}
  .pill{border-color:#ccc;color:#333}
  .briefing-caption-label{color:#111}
  .briefing-caption{background:#f7f7f7;border-color:#eee;color:#111}
  .briefing-section-title{color:#111}
  header p{color:#555}
}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(project.name)} — próximos posts</h1>
  <p>${escapeHtml(project.instagram?.handle || '')} · prévia para alinhar com o cliente antes de publicar. A aprovação em si acontece no painel interno.</p>
  <button class="download-pdf" onclick="window.print()">Baixar em PDF</button>
</header>
<div class="wrap">
${items.length ? sections : '<div class="empty-state"><b>Nenhum card aguardando aprovação agora.</b><br>Prepare a aprovação de um card na Central de Conteúdo para ele aparecer aqui.</div>'}
</div>
</body>
</html>`;
}

// A number the prospect's real profile actually showed — displayed exactly
// as Instagram itself would ("4.388"), never a fabricated stat. `null`
// (nothing extracted/typed) renders as "—", never as 0 — 0 would claim the
// account genuinely has zero followers instead of "we don't know".
function formatProspectCount(value) {
  return Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—';
}

function prospectGridImage(item, projectId) {
  const src = briefingPreviewImageSource(item, projectId);
  return src
    ? `<div class="ig-grid-cell"><img src="${escapeHtml(src)}" alt="Post gerado"></div>`
    : '<div class="ig-grid-cell ig-grid-cell-empty">Gerando…</div>';
}

function prospectHighlightBubble(item, projectId, index) {
  const src = briefingPreviewImageSource(item, projectId);
  // A segment-template highlight piece carries a real short label (e.g.
  // "Produtos") on its contentTopic — use it when present instead of the
  // generic "Destaque N" every from-scratch story item still falls back to.
  const label = String(item.contentTopic?.label || '').trim() || (index === 0 ? 'Destaque' : `Destaque ${index + 1}`);
  return `<div class="ig-highlight">
    <div class="ig-highlight-ring">${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}">` : ''}</div>
    <span>${escapeHtml(label)}</span>
  </div>`;
}

// The actual sales artifact for the "Instagram Sempre Ativo" prospecting
// pitch: not a list of separate post cards (that's renderBriefingPage,
// built for a real client reviewing real scheduled posts) but a single
// screen that reads like the prospect's OWN profile, reformulated — a
// header quoting their real name/bio/follower counts (project.prospectSource,
// never the AI's own invention) topped with freshly generated content in
// the exact shape Instagram itself displays it (highlight circles, 3-col
// grid). Reuses the same .ig-* chrome primitives as renderIgMockup/
// renderBriefingPage above instead of inventing a second visual language.
export function renderProspectMockupPage(project, feedItems, storyItems) {
  const source = project.prospectSource || {};
  const username = escapeHtml(briefingUsername(project));
  const initial = escapeHtml(briefingAvatarInitial(project));
  // project.brand.logoPath is eagerly defaulted to 'assets/logo.png' at
  // project creation regardless of whether a file was ever saved there —
  // rendering an <img> against it unconditionally shows a broken-image icon
  // for every prospect whose avatar crop failed/was skipped. brandIdentity's
  // logoPath starts genuinely empty and is only ever set inside
  // saveProjectAsset on a real upload, so it's the reliable "a real file
  // exists" signal.
  const logoPath = project.brandIdentity?.logoPath;
  const avatarSrc = logoPath ? `/api/projects/${project.projectId}/assets/${logoPath}` : '';
  const avatar = avatarSrc
    ? `<img src="${escapeHtml(avatarSrc)}" alt="Foto de perfil">`
    : `<span class="ig-profile-avatar-fallback">${initial}</span>`;

  const highlights = storyItems.length
    ? `<div class="ig-highlights">${storyItems.map((item, index) => prospectHighlightBubble(item, project.projectId, index)).join('')}</div>`
    : '';
  const grid = feedItems.length
    ? `<div class="ig-grid">${feedItems.map((item) => prospectGridImage(item, project.projectId)).join('')}</div>`
    : '<div class="empty-state"><b>Ainda gerando os posts de demonstração…</b><br>Atualize a página em alguns instantes.</div>';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(project.name)} — como o Instagram poderia ficar</title>
<style>
:root{color-scheme:dark;--bg:#050508;--accent:#8b6bff;--accent-2:#ff5fb8;--line:rgba(255,255,255,.09);--soft:#d6d4e0;--muted:#94939f;--text:#f8f7fb}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;line-height:1.55;padding:28px 20px 60px}
header{max-width:420px;margin:0 auto 18px;text-align:center}
header h1{margin:0 0 8px;font-size:clamp(20px,3vw,26px);letter-spacing:-.03em}
header p{margin:0;color:var(--muted);font-size:14px}
.download-pdf{min-height:42px;border:1px solid var(--line);border-radius:12px;background:transparent;color:var(--text);font-weight:700;padding:0 16px;cursor:pointer;margin-top:14px}
.download-pdf:hover{border-color:var(--accent)}
.ig-profile-mock{max-width:420px;margin:0 auto;background:#fff;color:#111;border-radius:26px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5)}
.ig-profile-topbar{padding:12px 16px;font-weight:700;font-size:15px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:8px}
.ig-profile-header{display:flex;align-items:center;gap:22px;padding:18px 16px 6px}
.ig-profile-avatar{width:78px;height:78px;border-radius:999px;flex:0 0 auto;overflow:hidden;background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af);display:grid;place-items:center}
.ig-profile-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.ig-profile-avatar-fallback{color:#fff;font-size:26px;font-weight:800}
.ig-profile-stats{display:flex;gap:22px;flex:1}
.ig-profile-stats div{text-align:center}
.ig-profile-stats b{display:block;font-size:17px;font-weight:800}
.ig-profile-stats span{display:block;font-size:12px;color:#666}
.ig-profile-name{padding:10px 16px 2px;font-weight:800;font-size:14px}
.ig-profile-bio{padding:0 16px 14px;font-size:13px;color:#222;white-space:pre-wrap}
.ig-highlights{display:flex;gap:14px;padding:4px 16px 16px;overflow-x:auto}
.ig-highlight{display:flex;flex-direction:column;align-items:center;gap:5px;flex:0 0 auto;width:64px}
.ig-highlight-ring{width:58px;height:58px;border-radius:999px;padding:2px;background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af);overflow:hidden}
.ig-highlight-ring img{width:100%;height:100%;object-fit:cover;border-radius:999px;display:block;border:2px solid #fff}
.ig-highlight span{font-size:10px;color:#444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:64px}
.ig-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;border-top:1px solid #f0f0f0}
.ig-grid-cell{aspect-ratio:1/1;background:#000;overflow:hidden}
.ig-grid-cell img{width:100%;height:100%;object-fit:cover;display:block}
.ig-grid-cell-empty{display:grid;place-items:center;color:#999;font-size:11px;background:#f4f4f4}
.empty-state{padding:24px 16px;text-align:center;color:#666;font-size:13px}
@media(max-width:460px){.ig-profile-mock{border-radius:0}body{padding:16px 0 40px}}
@media print{
  body{background:#fff;color:#111;padding:0}
  .download-pdf{display:none}
  .ig-profile-mock{box-shadow:none;border:1px solid #eee}
  header p{color:#555}
}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(project.name)} — como o Instagram poderia ficar</h1>
  <p>Mockup de demonstração, a partir do perfil real de @${username || 'prospect'}.</p>
  <button class="download-pdf" onclick="window.print()">Baixar em PDF</button>
</header>
<div class="ig-profile-mock">
  <div class="ig-profile-topbar">${username}</div>
  <div class="ig-profile-header">
    <div class="ig-profile-avatar">${avatar}</div>
    <div class="ig-profile-stats">
      <div><b>${formatProspectCount(source.realPosts)}</b><span>publicações</span></div>
      <div><b>${formatProspectCount(source.realFollowers)}</b><span>seguidores</span></div>
      <div><b>${formatProspectCount(source.realFollowing)}</b><span>seguindo</span></div>
    </div>
  </div>
  <div class="ig-profile-name">${escapeHtml(project.name)}</div>
  ${source.bio ? `<div class="ig-profile-bio">${escapeHtml(source.bio)}</div>` : ''}
  ${highlights}
  ${grid}
</div>
</body>
</html>`;
}

function openUrl(url) {
  const command = platform() === 'win32'
    ? `start "" "${url}"`
    : platform() === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
}

function renderApp() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Central de Conteúdo Opensquad</title>
<style>
:root{color-scheme:dark;--bg:#07070a;--bg-soft:#0a0a0d;--panel:#0e0e12;--surface:rgba(255,255,255,.04);--surface-2:rgba(255,255,255,.06);--surface-3:rgba(255,255,255,.08);--line:rgba(255,255,255,.09);--line-strong:rgba(255,255,255,.16);--muted:#94939f;--text:#f8f7fb;--soft:#d6d4e0;--faint:#68667a;--accent:#8b6bff;--accent-strong:#a78bff;--accent-2:#ff5fb8;--accent-3:#4fd1ff;--accent-gradient:linear-gradient(135deg,var(--accent) 0%,#c15fff 48%,var(--accent-2) 100%);--accent-warm:#facc15;--ok:#22c55e;--bad:#ef4444;--warn:#f59e0b;--radius-sm:10px;--radius:16px;--radius-lg:24px;--shadow:0 24px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);--button-h:44px;--ease:cubic-bezier(.16,1,.3,1)}
*{box-sizing:border-box}html{scroll-behavior:smooth}input[type=checkbox],input[type=radio]{accent-color:var(--accent);width:16px;height:16px;min-height:0;flex:0 0 auto}
@keyframes driftA{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(3vw,2vh) scale(1.08)}}
@keyframes driftB{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-4vw,-3vh) scale(1.05)}}
body{margin:0;min-height:100vh;background:#050508;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:15px;line-height:1.55;font-feature-settings:"cv01","ss03";text-rendering:geometricPrecision;position:relative;overflow-x:hidden}
body::before,body::after{content:'';position:fixed;z-index:0;border-radius:50%;filter:blur(90px);pointer-events:none;opacity:.5}
body::before{top:-18vh;left:-10vw;width:56vw;height:56vw;background:radial-gradient(circle,rgba(139,107,255,.5),transparent 68%);animation:driftA 26s ease-in-out infinite}
body::after{bottom:-24vh;right:-14vw;width:52vw;height:52vw;background:radial-gradient(circle,rgba(255,95,184,.32),transparent 68%);animation:driftB 30s ease-in-out infinite}
@media(prefers-reduced-motion:reduce){body::before,body::after{animation:none}}
header,main{position:relative;z-index:1}
button,input,select,textarea{font:inherit}button{min-height:44px;border:1px solid transparent;border-radius:12px;background:var(--accent-gradient);background-size:160% 160%;color:#fff;font-weight:750;padding:0 16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 10px 30px rgba(139,107,255,.28),inset 0 1px 0 rgba(255,255,255,.16);transition:transform .22s var(--ease),border-color .22s var(--ease),background-position .4s var(--ease),filter .2s ease,box-shadow .22s var(--ease)}button:hover{filter:brightness(1.08);transform:translateY(-2px);background-position:100% 40%;box-shadow:0 16px 38px rgba(139,107,255,.36),inset 0 1px 0 rgba(255,255,255,.2)}button:active{transform:translateY(0)}button:disabled{opacity:.6;cursor:wait;transform:none}button.secondary,.action-secondary{background:var(--surface-2);color:var(--soft);border-color:var(--line);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}button.secondary:hover,.action-secondary:hover{background:var(--surface-3);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}button.ghost{background:transparent;color:var(--soft);border-color:var(--line);box-shadow:none}button.ghost:hover{background:var(--surface);box-shadow:none}button.danger{background:rgba(239,68,68,.13);border-color:rgba(239,68,68,.34);color:#fecaca;box-shadow:none}.action-primary{background:var(--accent-gradient);background-size:160% 160%;color:#fff}.full-width{width:100%}.button-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:center}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:999px;animation:spin .8s linear infinite;vertical-align:-2px}button.secondary .spinner{border-color:#fafafa55;border-top-color:#fafafa}@keyframes spin{to{transform:rotate(360deg)}}
header{padding:20px 28px;border-bottom:1px solid var(--line);background:rgba(6,6,9,.66);backdrop-filter:blur(22px) saturate(140%);position:sticky;top:0;z-index:20}.hero{display:flex;justify-content:space-between;gap:18px;align-items:center;max-width:1540px;margin:0 auto}.hero-brand{display:flex;align-items:center;gap:14px}.hero-mark{width:42px;height:42px;border-radius:13px;flex:0 0 auto;background:var(--accent-gradient);background-size:160% 160%;box-shadow:0 8px 24px rgba(139,107,255,.4),inset 0 1px 0 rgba(255,255,255,.3);display:grid;place-items:center;font-weight:800;font-size:17px;color:#fff}.panel-kicker{margin:0 0 6px;background:var(--accent-gradient);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.16em}.hero h1{margin:0 0 6px;font-size:clamp(26px,2.6vw,36px);letter-spacing:-.05em;line-height:1.04;font-weight:800}.sub{color:var(--muted);margin:0;max-width:820px;line-height:1.6;font-size:14px}.hero-metrics{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:10px;min-width:390px}.metric{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05);transition:border-color .2s var(--ease),background .2s var(--ease)}.metric:hover{border-color:var(--line-strong);background:var(--surface-2)}.metric b{display:block;font-size:18px;letter-spacing:-.02em}.metric span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.wrap.design-shell{display:grid;grid-template-columns:280px 216px minmax(0,1fr);gap:18px;max-width:1540px;margin:0 auto;padding:18px 22px 42px;align-items:start}.card{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.022)),rgba(14,14,18,.55);backdrop-filter:blur(20px) saturate(140%);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow);transition:border-color .25s var(--ease),box-shadow .25s var(--ease),transform .25s var(--ease)}.sidebar{position:sticky;top:96px;padding:18px 18px 28px;max-height:calc(100vh - 114px);overflow:auto;scrollbar-width:thin}.workspace-main{display:grid;gap:16px;min-width:0}.workspace-main>.card{min-width:0;max-width:100%}.selected-card{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:18px 20px;position:relative;overflow:hidden}.selected-card::before{content:'';position:absolute;inset:0;background:radial-gradient(140% 100% at 0% 0%,rgba(139,107,255,.14),transparent 55%);pointer-events:none}.selected-info{line-height:1.7;min-width:0;overflow-wrap:anywhere;position:relative}.quick-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;min-width:0;max-width:100%;flex:1 1 360px;position:relative}.quick-actions button{width:100%}.section-nav{position:sticky;top:96px;max-height:calc(100vh - 114px);overflow:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:4px;padding:12px}.tab-button{white-space:nowrap;background:transparent;color:var(--muted);border-color:transparent;box-shadow:none;min-height:40px;padding:0 14px;transition:color .2s ease,background .2s ease;width:100%;justify-content:flex-start;text-align:left}.tab-button:hover{color:var(--soft);background:var(--surface)}.tab-button.active{background:var(--accent-gradient);background-size:160% 160%;border-color:transparent;color:#fff;box-shadow:0 8px 22px rgba(139,107,255,.32),inset 0 1px 0 rgba(255,255,255,.18)}.tab-panel{display:none;padding:22px;animation:panelIn .35s var(--ease)}.tab-panel.active{display:block}@keyframes panelIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.tab-panel{animation:none}}.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:14px}.stat-card{border:1px solid var(--line);background:var(--surface);border-radius:16px;padding:14px 16px}.stat-card b{display:block;font-size:26px;letter-spacing:-.02em}.stat-card span{display:block;color:var(--muted);font-size:12px;margin-top:4px}.checklist{display:grid;gap:8px;margin-top:12px}.checklist-item{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:12px 14px}.checklist-item .check-icon{width:26px;height:26px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font-size:13px;font-weight:800;border:1px solid var(--line-strong)}.checklist-item.done .check-icon{background:rgba(34,197,94,.18);color:#86efac;border-color:rgba(34,197,94,.4)}.checklist-item:not(.done) .check-icon{color:var(--muted)}.checklist-item .check-label{flex:1;min-width:0}.checklist-item .check-title{font-weight:700}.checklist-item .check-desc{color:var(--muted);font-size:12px;margin-top:2px}
.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.section-title h2,.section-title h3{margin:0;letter-spacing:-.03em;line-height:1.15}.section-title h2{font-size:24px}.section-title h3{font-size:18px}.section-heading{margin:22px 0 4px;letter-spacing:-.02em}.step,.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 9px;color:var(--soft);font-size:12px;font-weight:700;background:rgba(255,255,255,.035);line-height:1.2}.step{text-transform:uppercase;letter-spacing:.08em;color:var(--accent-warm)}.pill.ok,.ok{color:#86efac}.pill.bad,.bad{color:#fecaca}.muted{color:var(--muted)}hr{border:0;border-top:1px solid var(--line);margin:18px 0}
label{display:block;color:var(--soft);font-weight:680;font-size:13px;margin:12px 0 6px}input,select,textarea{width:100%;border:1px solid var(--line);background:rgba(255,255,255,.035);color:var(--text);border-radius:12px;padding:11px 12px;outline:none;min-height:44px}textarea{min-height:118px;resize:vertical;line-height:1.55}input:focus,select:focus,textarea:focus{border-color:rgba(139,107,255,.72);box-shadow:0 0 0 4px rgba(139,107,255,.16)}input::placeholder,textarea::placeholder{color:#6f7480}.field-card{background:rgba(255,255,255,.025);border:1px solid var(--line);border-radius:18px;padding:16px;transition:border-color .2s var(--ease)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.notice,.guide-box,.empty-state{border:1px solid var(--line);background:rgba(255,255,255,.035);border-radius:18px;padding:15px 16px;line-height:1.65}.guide-box{border-style:dashed}.empty-state{text-align:center;color:var(--muted)}.status-line{min-height:24px;color:var(--muted);margin-top:10px}.toast{display:none;position:fixed;right:22px;bottom:22px;background:#111216;border:1px solid var(--line-strong);color:var(--text);padding:14px 16px;border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.42);z-index:50;max-width:420px}.projects{display:grid;gap:10px}.project{padding:14px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.025);cursor:pointer;transition:background .2s var(--ease),border-color .2s var(--ease),transform .2s var(--ease),box-shadow .2s var(--ease)}.project:hover{background:var(--surface-2);border-color:var(--line-strong);transform:translateY(-1px)}.project.active{background:linear-gradient(135deg,rgba(139,107,255,.16),rgba(255,95,184,.1));border-color:rgba(167,139,255,.5);box-shadow:0 8px 26px rgba(139,107,255,.18);transform:translateY(-1px)}.project-pills{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.project-pills .pill{font-size:11px;padding:3px 8px}.project-pills .pill.ok{color:#86efac;border-color:rgba(34,197,94,.35)}
details#createProjectDetails>div{overflow:hidden;animation:detailsIn .3s var(--ease)}@keyframes detailsIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
.step-card{display:flex;align-items:center;justify-content:center;text-align:center;min-height:76px;border-radius:18px;padding:14px!important}.journey{display:flex;flex-wrap:wrap;gap:10px}.journey-step{flex:1 1 170px;justify-content:flex-start;align-items:center;gap:12px;padding:14px 16px!important;border-radius:16px;background:var(--surface);border:1px solid var(--line);color:var(--soft);text-align:left}.journey-step:hover{background:var(--surface-2);border-color:var(--line-strong);transform:translateY(-2px)}.journey-step.action-primary{background:var(--accent-gradient);background-size:160% 160%;border-color:transparent;color:#fff}.journey-num{width:26px;height:26px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;background:var(--surface-3);color:var(--text);border:1px solid var(--line-strong)}.journey-step.action-primary .journey-num{background:rgba(255,255,255,.24);border-color:rgba(255,255,255,.3);color:#fff}.journey-label{font-size:13px;font-weight:700}.reference-panel{margin-top:16px;border:1px solid var(--line);border-radius:22px;padding:16px;background:rgba(255,255,255,.022)}.reference-toolbar{display:grid;grid-template-columns:1.15fr 1.5fr .55fr;gap:12px;align-items:end}.reference-meta{display:flex;flex-wrap:wrap;gap:6px}.reference-gallery{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.brand-xray-grid{grid-template-columns:repeat(2,minmax(320px,1fr));gap:16px;align-items:stretch}.brand-xray-intro{grid-column:1/-1;border:1px solid var(--line);border-radius:18px;background:rgba(113,112,255,.08);padding:14px 16px;color:var(--soft);line-height:1.65}.reference-card{overflow:hidden;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.03);transition:border-color .25s var(--ease),transform .25s var(--ease),box-shadow .25s var(--ease)}.reference-card:hover{border-color:var(--line-strong);transform:translateY(-3px);box-shadow:0 16px 34px rgba(0,0,0,.35)}.reference-card:hover .reference-thumb img{transform:scale(1.06)}.brand-xray-card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));border-color:var(--line-strong);position:relative}.brand-xray-card::before{content:'';position:absolute;top:0;left:18px;right:18px;height:2px;background:var(--accent-gradient);border-radius:0 0 4px 4px}.brand-xray-card .reference-body{padding:18px}.brand-xray-card .reference-name{font-size:17px;margin-bottom:10px}.brand-xray-card textarea{min-height:220px;overflow:hidden;resize:none;background:rgba(0,0,0,.18);line-height:1.7;font-size:14px;padding:13px 14px}.brand-xray-source-note{margin:10px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.reference-thumb{height:150px;background:#09090b;display:grid;place-items:center;color:var(--muted);border-bottom:1px solid var(--line);overflow:hidden}.reference-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .4s var(--ease)}.reference-body{padding:14px}.reference-name{font-weight:800;margin-bottom:8px}.reference-note{color:var(--muted);font-size:13px;line-height:1.55;margin-top:8px}.format-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}.format-card{border:1px solid var(--line);background:rgba(255,255,255,.028);border-radius:20px;padding:15px;transition:border-color .25s var(--ease),background .25s var(--ease)}.format-card:has(input:checked){border-color:rgba(139,107,255,.4);background:rgba(139,107,255,.06)}.format-card>label:first-child{display:flex;align-items:center;gap:9px;margin-top:0;font-size:15px;color:var(--text)}.content-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:14px}.days{display:grid;gap:14px}.content-card{display:grid;grid-template-columns:minmax(220px,320px) minmax(0,1fr);gap:18px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.026);padding:14px;transition:border-color .25s var(--ease),box-shadow .25s var(--ease)}.content-card:hover{border-color:var(--line-strong);box-shadow:0 16px 34px rgba(0,0,0,.3)}.content-card:hover .content-preview img{transform:scale(1.04)}.content-preview{position:relative;overflow:hidden;border-radius:18px;background:#050506;display:grid;place-items:center;color:var(--muted);border:1px solid var(--line);min-height:300px}.content-preview img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s var(--ease)}.content-preview.channel-instagram_story,.content-preview.channel-instagram_reels{aspect-ratio:9/16;max-height:620px}.content-preview.channel-instagram_feed{aspect-ratio:4/5}.content-preview.empty{padding:20px;text-align:center}.generating-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;background:rgba(5,5,8,.72);backdrop-filter:blur(2px);color:#fff;font-weight:700;font-size:13px;text-align:center;padding:16px}.content-meta{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 12px}.caption-box,.prompt-box{white-space:pre-wrap;background:rgba(0,0,0,.24);border:1px solid var(--line);border-radius:16px;padding:13px;color:var(--soft);line-height:1.62}.prompt-box{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#cbd5e1;max-height:420px;overflow:auto}details summary{cursor:pointer;color:var(--soft);font-weight:750;margin:10px 0 8px}.sidebar-summary{display:flex;justify-content:space-between;align-items:center;font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--text);margin:0 0 4px;list-style:revert}#createProjectDetails[open] .sidebar-summary{margin-bottom:2px}.card-actions{display:flex;justify-content:flex-end;margin-top:10px}button.card-delete{min-height:32px;padding:0 10px;font-size:12px;font-weight:650;background:transparent;border-color:transparent;color:var(--muted);box-shadow:none}button.card-delete:hover{color:#fecaca;border-color:rgba(239,68,68,.34);background:rgba(239,68,68,.1)}
@media(max-width:1180px){.wrap.design-shell{grid-template-columns:1fr}.sidebar{position:static;max-height:none}.section-nav{position:static;max-height:none;flex-direction:row;overflow-x:auto;flex-wrap:nowrap;margin-bottom:16px}.section-nav .tab-button{width:auto}.hero{align-items:flex-start}.hero-metrics{min-width:0}.format-grid{grid-template-columns:1fr}.mini-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:980px){.brand-xray-grid{grid-template-columns:1fr}}@media(max-width:760px){header{padding:18px}.hero,.selected-card,.content-toolbar{display:grid}.hero-metrics{grid-template-columns:1fr 1fr}.wrap.design-shell{padding:14px}.grid,.row,.reference-toolbar,.content-card{grid-template-columns:1fr}.mini-grid{grid-template-columns:1fr}.tab-panel{padding:16px}.quick-actions{justify-content:stretch}.quick-actions button{width:100%}}
</style>
</head>
<body class="app-body">
<header>
  <div class="hero">
    <div class="hero-brand"><div class="hero-mark" aria-hidden="true">C</div><div><p class="panel-kicker">Painel local · seguro · revisável</p><h1>Central de Conteúdo Opensquad</h1><p class="sub">Crie conteúdos com referências, ofertas reais, teste seguro e revisão visual antes de qualquer aprovação.</p></div></div>
    <div class="hero-metrics"><div class="metric"><b id="metricProjects">0</b><span>projetos</span></div><div class="metric"><b id="metricSelected">--</b><span>selecionado</span></div><div class="metric"><b>Dry-run</b><span>não publica sozinho</span></div></div>
  </div>
</header>
<main class="wrap design-shell">
  <aside class="card sidebar">
    <details id="createProjectDetails">
      <summary class="sidebar-summary">Novo projeto<span class="step">setup</span></summary>
      <div style="margin-top:12px">
        <label>ID curto</label><input id="projectId" placeholder="cliente-teste">
        <label>Nome</label><input id="name" placeholder="Cliente Teste">
        <label>Instagram</label><input id="handle" placeholder="@cliente">
        <label>E-mail de aprovação</label><input id="approvalEmail" value="juciclei.ger@gmail.com">
        <label>Modo</label><select id="mode"><option value="semi_automatic">semi-automático</option><option value="manual">manual</option><option value="automatic">automático</option></select>
        <button class="action-primary full-width" style="margin-top:14px" onclick="createProject()">Criar projeto</button>
      </div>
    </details>
    <hr>
    <div class="section-title"><h2>Projetos</h2><span class="pill" id="projectCountPill">0</span></div>
    <div id="projects" class="projects"></div>
  </aside>
  <nav class="card section-nav" aria-label="Seções do painel">
    <button class="tab-button active" data-tab="overview" onclick="switchTab('overview')">Visão geral</button>
    <button class="tab-button" data-tab="company" onclick="switchTab('company')">Empresa / Raio-X</button>
    <button class="tab-button" data-tab="references" onclick="switchTab('references')">Referências e imagem</button>
    <button class="tab-button" data-tab="offers" onclick="switchTab('offers')">Ofertas e assuntos</button>
    <button class="tab-button" data-tab="generate" onclick="switchTab('generate')">Agenda e geração</button>
    <button class="tab-button" data-tab="test" onclick="switchTab('test')">Teste seguro</button>
    <button class="tab-button" data-tab="content" onclick="switchTab('content')">Conteúdos gerados</button>
    <button class="tab-button" data-tab="account" onclick="switchTab('account')">Conta e token</button>
  </nav>
  <section class="workspace-main">
    <div class="card selected-card">
      <div><div class="section-title"><h2>Projeto selecionado</h2><span class="step">controle</span></div><div id="selected" class="selected-info muted">Selecione ou crie um projeto.</div></div>
      <div class="quick-actions"><button class="action-primary" onclick="switchTab('generate')">Gerar conteúdo</button><button class="secondary" onclick="switchTab('content')">Ver conteúdos</button><button class="ghost" onclick="switchTab('references')">Referências</button></div>
    </div>
    <section id="tab-overview" class="card tab-panel active">
      <div class="section-title"><h2>Visão geral</h2><span class="step">comece aqui</span></div>
      <div id="overviewStats" class="stat-grid"></div>
      <h3 class="section-heading">Checklist do projeto</h3>
      <div id="overviewChecklist" class="checklist"></div>
    </section>
    <section id="tab-company" class="card tab-panel">
      <div class="section-title"><h2>Empresa / Raio-X</h2><span class="step">coleta rápida</span></div>
      <div class="notice"><b>Fluxo simples:</b><br><span class="muted">Você informa os fatos e objetivos. A IA organiza o contexto, sugere compradores, tom e estratégia de conteúdo. A identidade visual continua na aba Referências e imagem.</span></div>
      <div id="projectReadiness" class="notice muted" style="margin-top:10px">Selecione um projeto para ver o que já está pronto.</div>
      <h3 class="section-heading">1. Informações básicas</h3>
      <div class="grid">
        <div>
          <label>Nome da marca</label><input id="brandName" placeholder="Ex: Boss Pizzaria">
          <label>Segmento</label><input id="brandSegment" placeholder="Ex: pizzaria, advogado, dentista, loja de roupas">
          <label>O que a empresa vende ou oferece?</label><textarea id="brandProductsOrServices" placeholder="Ex: rodízio de pizzas, delivery, bebidas e atendimento no salão"></textarea>
        </div>
        <div>
          <label>Conte um pouco sobre a empresa</label><textarea id="brandDescription" placeholder="Opcional. Ex: Somos uma pizzaria familiar localizada em Várzea Grande."></textarea>
          <label>Região de atendimento</label><input id="brandServiceRegion" placeholder="Ex: Várzea Grande/MT">
          <label>Principal diferencial</label><input id="brandMainDifferential" placeholder="Opcional. Ex: pizza bem recheada e ambiente familiar">
        </div>
      </div>
      <h3 class="section-heading">2. Logo e identidade</h3>
      <div class="grid">
        <div class="field-card">
          <label>Envie a logo da marca</label><input type="file" id="brandLogoFile" accept="image/*">
          <button class="secondary full-width" style="margin-top:8px" onclick="uploadBrandLogo()">Enviar logo</button>
        </div>
        <div id="logoColorPreview" class="notice"><b>Cores identificadas na logo</b><br><span class="muted">Envie a logo. A primeira versão preserva a logo e permite editar cores no bloco de Identidade visual do Raio-X.</span></div>
      </div>
      <h3 class="section-heading">3. Objetivos do conteúdo</h3>
      <p class="muted">O que você quer alcançar com as postagens?</p>
      <div id="contentGoalButtons" class="button-row">
        <button type="button" class="secondary" data-content-goal="sell_products">Vender produtos</button>
        <button type="button" class="secondary" data-content-goal="sell_services">Vender serviços</button>
        <button type="button" class="secondary" data-content-goal="promotions">Divulgar promoções</button>
        <button type="button" class="secondary" data-content-goal="whatsapp_orders">Receber pedidos no WhatsApp</button>
        <button type="button" class="secondary" data-content-goal="leads">Gerar leads</button>
        <button type="button" class="secondary" data-content-goal="authority">Gerar autoridade</button>
        <button type="button" class="secondary" data-content-goal="brand_awareness">Aumentar reconhecimento da marca</button>
        <button type="button" class="secondary" data-content-goal="relationship">Criar relacionamento</button>
        <button type="button" class="secondary" data-content-goal="engagement">Aumentar engajamento</button>
        <button type="button" class="secondary" data-content-goal="events">Divulgar eventos</button>
        <button type="button" class="secondary" data-content-goal="show_products">Mostrar produtos</button>
        <button type="button" class="secondary" data-content-goal="education">Educar o público</button>
      </div>
      <button id="analyzeBrandButton" class="action-primary full-width" style="margin-top:14px" onclick="analyzeBrandXray()">Salvar e analisar minha marca</button>
      <h3 class="section-heading">Estratégia sugerida pelo Raio-X</h3>
      <div id="brandXrayBlocks" class="reference-gallery muted">Preencha as informações, escolha objetivos e clique em “Analisar minha marca”.</div>
      <div class="button-row" style="margin-top:12px"><button class="action-primary" onclick="approveBrandXray()">Aprovar estratégia da marca</button></div>
      <details class="field-card" style="margin-top:14px"><summary>Configurações avançadas</summary><p class="muted">O briefing antigo continua compatível por baixo para projetos já criados, mas não aparece no fluxo principal.</p></details>
    </section>
    <section id="tab-references" class="card tab-panel">
      <div class="section-title"><h2>Imagem e identidade visual</h2><span class="step">visual</span></div>
      <p class="muted">Este é o lugar que define a aparência dos criativos. O Raio-X fornece o contexto estratégico; logo, cores, direção e referências são controladas aqui.</p>
      <div class="grid" style="margin-bottom:14px"><div class="notice"><b>Ativos oficiais da marca</b><br><span class="muted">Logo, mascote, cardápio, embalagem e identidade oficial. Preservar exatamente como enviado.</span></div><div class="notice"><b>Fotos reais e produtos</b><br><span class="muted">Pizza, prato, ambiente, equipe ou embalagem real. Preservar aparência real, sem trocar produto.</span></div><div class="notice"><b>Inspirações visuais</b><br><span class="muted">Flyer, layout, fotografia, composição ou paleta. Usar só como inspiração; não copiar marcas, textos ou preços.</span></div></div>
      <div class="grid">
        <div class="field-card">
          <h3>Ativo oficial principal</h3>
          <label>Arquivo de logo</label><input type="file" id="logoFile" accept="image/*">
          <button class="secondary full-width" style="margin-top:8px" onclick="uploadLogo()">Enviar logo</button>
          <div class="guide-box" style="margin-top:12px"><b>Regra automática:</b><br><span class="muted">Usar exatamente como foi enviado. Não redesenhar, reinterpretar, alterar cores, trocar textos ou criar versão parecida.</span></div>
        </div>
        <div class="field-card">
          <h3>Direção visual dos criativos</h3>
          <label>Direção visual usada nas novas imagens</label><textarea id="visualStyle" placeholder="Descreva composição, fotografia, cores e clima visual desejados."></textarea>
          <details class="field-card" style="margin-top:10px"><summary>Configurações avançadas</summary><label>Regras técnicas extras para o ChatGPT</label><textarea id="imageRules" placeholder="Use só quando necessário. Ex: texto curto, área segura, não inventar preço."></textarea></details>
          <button class="secondary full-width" style="margin-top:8px" onclick="saveImageRules()">Salvar direção visual</button>
        </div>
      </div>
      <div class="reference-panel">
        <div class="section-title"><h3>Criativos, modelos, fotos ou parâmetros</h3><span class="pill">categoria + regra automática</span></div>
        <input type="file" id="referenceFile" accept="image/*,.pdf,.txt,.md,.doc,.docx" multiple>
        <div class="reference-toolbar">
          <div><label>Categoria da referência</label><select id="referenceCategory"><option value="official_asset">Ativos oficiais da marca</option><option value="real_product">Fotos reais e produtos</option><option value="visual_inspiration" selected>Inspirações visuais</option></select></div>
          <div><label>Observação curta</label><input id="referenceInstruction" placeholder="Ex: usar só hierarquia / preservar produto / seguir clima visual"></div>
          <div><label class="pill" style="margin-top:28px"><input type="checkbox" id="referenceUseInNextGeneration" checked> Usar na próxima geração</label></div>
        </div>
        <div id="referenceAutomaticRule" class="guide-box" style="margin-top:10px">Regra automática: utilizar apenas como inspiração visual. Não copiar logos, nomes, textos, preços, produtos ou elementos exclusivos da referência.</div>
        <details class="field-card" style="margin-top:10px"><summary>Configurações avançadas</summary><label>Função técnica</label><div class="reference-meta" style="gap:8px"><label class="pill"><input type="checkbox" name="referenceUsageRoles" value="layout_model"> Modelo visual que gostei</label><label class="pill"><input type="checkbox" name="referenceUsageRoles" value="product_photo"> Foto real do produto</label><label class="pill"><input type="checkbox" name="referenceUsageRoles" value="text_parameter"> Exemplo de texto/oferta</label><label class="pill"><input type="checkbox" name="referenceUsageRoles" value="visual_reference" checked> Inspiração visual</label><label class="pill"><input type="checkbox" name="referenceUsageRoles" value="brand_asset"> Ativo oficial/logo</label></div><label>Prioridade</label><select id="referenceWeight"><option value="medium">Médio</option><option value="high">Alto</option><option value="low">Baixo</option></select></details>
        <button class="secondary full-width" style="margin-top:10px" onclick="uploadReferences()">Enviar referências</button>
        <div id="referenceGallery" class="reference-gallery muted">Selecione um projeto para ver as referências.</div>
      </div>
    </section>
    <section id="tab-offers" class="card tab-panel">
      <div class="section-title"><h2>Ofertas e assuntos</h2><span class="step">estratégia</span></div>
      <p class="muted">Cadastre assuntos reais como combo, rodízio, delivery, produto destaque ou orientação. O calendário alterna esses tipos para não gerar sempre o mesmo criativo.</p>
      <div class="grid">
        <div>
          <label>Nome da oferta/assunto</label><input id="offerName" placeholder="Ex: Combo 3 pizzas">
          <label>Tipo de publicação</label><select id="offerType"><option value="combo">Combo / promoção</option><option value="rodizio">Rodízio</option><option value="delivery">Delivery</option><option value="offer">Oferta direta</option><option value="service">Serviço</option><option value="product">Produto destaque</option><option value="orientation">Post de orientação</option><option value="desire">Post de desejo</option><option value="urgency">Urgência / hoje tem</option><option value="institutional">Institucional</option><option value="social_proof">Prova social</option></select>
          <label>Preço</label><input id="offerPrice" placeholder="Ex: R$99,00">
        </div>
        <div>
          <label>Itens inclusos/detalhes</label><textarea id="offerItems" placeholder="Ex: 3 pizzas selecionadas / pizzas salgadas, doces e massas"></textarea>
          <label>Chamada/CTA</label><input id="offerCta" placeholder="Ex: Peça agora no delivery / Aproveite o rodízio hoje">
          <label class="pill" style="margin:8px 0 10px;width:max-content"><input type="checkbox" id="offerAutoCta"> Se CTA ficar vazio, deixar a IA escolher o que mais combina</label>
          <label>Observações</label><input id="offerNotes" placeholder="Ex: presencial no salão, não prometer frete grátis">
        </div>
      </div>
      <div class="button-row" style="margin-top:10px">
        <button id="offerSaveButton" class="secondary full-width" onclick="saveOffer()">Salvar oferta/assunto</button>
        <button id="offerCancelEditButton" class="secondary" style="display:none" onclick="cancelEditOffer()">Cancelar edição</button>
      </div>
      <div class="notice" style="margin-top:14px"><b>Como será usado:</b><br><span class="muted">Ao gerar vários cards, cada item recebe um tipo: combo, rodízio, delivery, orientação etc. O prompt trava preço e itens. Se o CTA estiver vazio e marcado como automático, a IA escolhe uma chamada curta que combine com o post, sem ficar massiva.</span></div>
      <div id="offersList" class="reference-gallery muted">Selecione um projeto para ver as ofertas cadastradas.</div>
    </section>
    <section id="tab-generate" class="card tab-panel">
      <div class="section-title"><h2>Agenda e geração</h2><span class="step">conteúdo</span></div>
      <div class="row"><div><label>Dias</label><input id="days" type="number" value="7" min="1" max="60"></div><div><label>Data inicial</label><input id="startDate" type="date"></div></div>
      <h3 class="section-heading">Organizar por formato</h3>
      <p class="muted">Configure quantas vezes por dia e o intervalo. Use “Dia sim/dia não” no Feed colocando A cada 2 dias.</p>
      <div class="format-grid">
        <div class="format-card"><label><input type="checkbox" name="channels" value="instagram_story" data-format checked> Instagram Stories</label><div class="row"><div><label>Vezes por dia</label><input id="instagram_story_count" type="number" value="3" min="1" max="12"></div><div><label>A cada quantos dias</label><input id="instagram_story_every" type="number" value="1" min="1" max="30"></div></div><div class="row"><div><label>Horário inicial</label><input id="instagram_story_time" type="time" value="09:00"></div><div><label>Intervalo em minutos</label><input id="instagram_story_interval" type="number" value="240" min="0" max="1440"></div></div></div>
        <div class="format-card"><label><input type="checkbox" name="channels" value="instagram_feed" data-format checked> Instagram Feed</label><div class="row"><div><label>Vezes por dia</label><input id="instagram_feed_count" type="number" value="1" min="1" max="12"></div><div><label>A cada quantos dias</label><input id="instagram_feed_every" type="number" value="2" min="1" max="30"><small class="muted">Dia sim/dia não = 2</small></div></div><div class="row"><div><label>Horário inicial</label><input id="instagram_feed_time" type="time" value="12:00"></div><div><label>Intervalo em minutos</label><input id="instagram_feed_interval" type="number" value="0" min="0" max="1440"></div></div></div>
        <div class="format-card"><label><input type="checkbox" name="channels" value="instagram_reels" data-format> Instagram Reels</label><div class="row"><div><label>Vezes por dia</label><input id="instagram_reels_count" type="number" value="1" min="1" max="12"></div><div><label>A cada quantos dias</label><input id="instagram_reels_every" type="number" value="1" min="1" max="30"></div></div><div class="row"><div><label>Horário inicial</label><input id="instagram_reels_time" type="time" value="18:00"></div><div><label>Intervalo em minutos</label><input id="instagram_reels_interval" type="number" value="0" min="0" max="1440"></div></div></div>
      </div>
      <label>Regra só deste lote</label><textarea id="contentRules" placeholder="Ex: tom mais emocional, foco em autoridade..."></textarea>
      <div id="noOffersWarning" class="notice" style="margin-top:10px;display:none;border-color:rgba(245,158,11,.5)"><b>Nenhum assunto/oferta cadastrado para este projeto.</b><br><span class="muted">Sem isso, o conteúdo sai genérico (a IA improvisa um tipo de post padrão, tipo "urgência do dia", que pode não fazer sentido pro seu negócio). Vá em "Ofertas e assuntos" e cadastre pelo menos um — se a empresa não tem oferta com preço, use os tipos "Institucional", "Prova social", "Produto/serviço destaque" ou "Post de orientação".</span></div>
      <div class="notice" style="margin-top:10px"><b>Isso já gera a imagem final com IA para cada card.</b><br><span class="muted">Cada imagem leva de ~30s a alguns minutos, então um lote com vários dias/formatos pode demorar — a tela fica ocupada até terminar. Se algum card não gostar, dá pra regenerar só a imagem dele depois, sem refazer o lote inteiro.</span></div>
      <button id="generateButton" class="action-primary full-width" style="margin-top:10px" onclick="generateContent()">Gerar conteúdos</button>
    </section>
    <section id="tab-test" class="card tab-panel">
      <div class="section-title"><h2>Teste rápido antes de programar</h2><span class="step">dry-run</span></div>
      <div class="notice"><b>Não publica de verdade.</b><br><span class="muted">Gera um conteúdo e simula a postagem localmente para testar o fluxo antes de programar/publicar. Modo estável: usa a imagem IA real, sem overlay automático, borda ou miniatura aplicada pelo sistema.</span></div>
      <div id="nextTestTopic" class="notice" style="margin-top:10px"><b>Próximo assunto:</b><br><span class="muted">Selecione um projeto para ver qual oferta será usada no próximo teste.</span></div>
      <div class="grid" style="margin-top:12px"><div><label>Canal do teste</label><select id="testChannel"><option value="instagram_story" selected>Instagram Stories</option><option value="instagram_feed">Instagram Feed</option><option value="instagram_reels">Instagram Reels</option></select></div><div><label>Ideia/observação do teste</label><textarea id="testNote" placeholder="Ex: criar um post teste para ver o fluxo antes de programar"></textarea></div></div>
      <button id="testPostButton" class="action-secondary full-width" style="margin-top:10px" onclick="testPost()">Gerar conteúdo + simular postagem</button>
      <div id="testPostStatus" class="status-line"></div>
      <div id="testResult" class="empty-state" style="margin-top:14px"><b>Nenhum teste gerado ainda.</b><br>A imagem e a legenda do teste vão aparecer aqui nesta aba.</div>
    </section>
    <section id="tab-content" class="card tab-panel">
      <div class="content-toolbar"><div><h2>Conteúdos gerados</h2><p class="muted" id="contentSummary" style="margin:6px 0 0">Nenhum conteúdo carregado ainda.</p></div><button class="secondary" onclick="selectedProjectId?loadContent():toast('Selecione um projeto',true)">Atualizar</button></div>
      <nav class="tabs content-subtabs" style="margin-bottom:14px" aria-label="Etapa do conteúdo">
        <button class="tab-button active" data-substatus="aguardando" onclick="switchContentView('aguardando')">Aguardando aprovação</button>
        <button class="tab-button" data-substatus="aprovado" onclick="switchContentView('aprovado')">Aprovado</button>
      </nav>
      <div id="briefingBar" class="notice" style="margin-bottom:14px;display:none"><b>Enviar para o cliente aprovar:</b><br><span class="muted">Abre uma página com todos os cards aguardando aprovação (imagem + legenda + preço/CTA) para revisar com o cliente e aprovar.</span><div style="margin-top:10px"><button class="action-primary" onclick="openBriefing()">Abrir briefing de aprovação</button></div></div>
      <div id="daysList" class="days muted">Nenhum conteúdo gerado ainda.</div>
    </section>
    <section id="tab-account" class="card tab-panel">
      <div class="section-title"><h2>Conta e token</h2><span class="step">segurança</span></div>
      <div class="notice"><b>Token seguro:</b><br><span class="muted">Cole o token apenas neste painel local. O sistema valida os dias de validade usando só o token. Não precisa informar data manualmente.</span></div>
      <div class="grid" style="margin-top:12px"><div><label>Token Meta</label><input id="token" type="password" placeholder="cole o token aqui"></div><div><label>Handle</label><input id="tokenHandle" placeholder="@cliente"></div></div>
      <button class="secondary full-width" style="margin-top:12px" onclick="saveToken()">Validar token e salvar</button>
    </section>
  </section>
</main>
<div id="toast" class="toast"></div>
<script>
let state={projects:[]};let selectedProjectId=null;let contentView='aguardando';let lastContent=[];let generationPollTimer=null;let editingOfferId=null;let editingReferencePath=null;
function currentProject(){return state.projects.find(p=>p.projectId===selectedProjectId)}
const $=id=>document.getElementById(id);
async function api(path,options={}){const res=await fetch(path,{headers:{'content-type':'application/json'},...options});const text=await res.text();const body=text?JSON.parse(text):{};if(!res.ok)throw new Error(body.error||'Erro');return body}
function toast(msg,bad=false){const el=$('toast');el.style.display='block';el.style.borderColor=bad?'#7f1d1d':'#3f3f46';el.textContent=msg;setTimeout(()=>el.style.display='none',4500)}
function setButtonBusy(id,busy,label){const btn=$(id);if(!btn)return;btn.dataset.label=btn.dataset.label||btn.innerHTML;btn.disabled=busy;btn.innerHTML=busy?'<span class="spinner"></span>'+label:btn.dataset.label}
function esc(value){return String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
function switchTab(name){document.querySelectorAll('.tab-button').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===name));document.querySelectorAll('.tab-panel').forEach(panel=>panel.classList.toggle('active',panel.id==='tab-'+name));if(name==='content'&&selectedProjectId)loadContent().catch(e=>toast(e.message,true))}
function imageSource(item){if(item.image?.generatedSource)return item.image?.previewUrl||item.image?.url||item.image?.previewDataUrl;return item.image?.previewDataUrl||item.image?.previewUrl||item.image?.url}
function previewClass(item){return 'content-preview channel-'+esc(item?.channel||'instagram_feed')}
function generatingOverlay(item){return item?.image?.generating?'<div class="generating-overlay"><span class="spinner"></span>Gerando imagem com IA...</div>':''}
function renderImagePreview(item,alt){const imageSrc=imageSource(item);const overlay=generatingOverlay(item);if(!imageSrc)return '<div class="'+previewClass(item)+' empty">'+(overlay||'Sem imagem de prévia ainda')+'</div>';return '<div class="'+previewClass(item)+'"><img alt="'+esc(alt||'Imagem gerada')+'" src="'+esc(imageSrc)+'">'+overlay+'</div>'}
function renderTestLoading(channel){const box=$('testResult');if(!box)return;const label={instagram_story:'Instagram Stories',instagram_feed:'Instagram Feed',instagram_reels:'Instagram Reels'}[channel]||channel;box.className='content-card';box.innerHTML='<div class="content-preview channel-'+esc(channel)+' empty"><span><span class="spinner"></span>Preparando '+esc(label)+'...</span></div><div><div class="section-title"><h3>Gerando publicação de teste</h3><span class="pill">'+esc(label)+'</span></div><div class="notice"><b>Teste seguro em andamento.</b><br><span class="muted">Vamos criar a imagem, revisar o criativo e manter tudo em dry-run. Se o Agente Revisor bloquear por enquadramento, texto cortado ou preço ruim, a imagem será refeita automaticamente. Se Story/Reels continuar com canvas errado após 3 tentativas, entra um modo resgate extra sem modelos de layout. Nada será publicado sem aprovação.</span></div></div>'}
let sidebarAutoToggled=false;
async function load(){state=await api('/api/state');$('metricProjects').textContent=state.projects.length;$('projectCountPill').textContent=state.projects.length;renderProjects();if(!sidebarAutoToggled){$('createProjectDetails').open=state.projects.length===0;sidebarAutoToggled=true}if(selectedProjectId)await loadContent()}
function renderProjects(){const box=$('projects');box.innerHTML=state.projects.length?'':'<p class="muted">Nenhum projeto criado.</p>';state.projects.forEach(p=>{const div=document.createElement('div');div.className='project '+(p.projectId===selectedProjectId?'active':'');div.onclick=()=>selectProject(p.projectId);const xrayOk=p.brandXray?.status==='approved';div.innerHTML='<b>'+esc(p.name)+'</b><br><span class="muted">'+esc(p.instagram.handle)+' · '+esc(p.mode)+'</span><div class="project-pills"><span class="pill'+(p.token.configured?' ok':'')+'">'+(p.token.configured?p.token.daysRemaining+'d token':'sem token')+'</span><span class="pill'+(xrayOk?' ok':'')+'">'+(xrayOk?'Raio-X ok':'Raio-X pendente')+'</span></div>';box.appendChild(div)})}
function selectedCheckboxValues(name){return [...document.querySelectorAll('input[name="'+name+'"]:checked')].map(input=>input.value)}
function setCheckedValues(name,values=[]){const set=new Set(Array.isArray(values)?values:[]);document.querySelectorAll('input[name="'+name+'"]').forEach(input=>{input.checked=set.has(input.value)})}
function setGoalButtons(values=[]){const set=new Set(Array.isArray(values)?values:[]);document.querySelectorAll('[data-content-goal]').forEach(btn=>{const active=set.has(btn.dataset.contentGoal);btn.classList.toggle('action-primary',active);btn.classList.toggle('secondary',!active)})}
document.querySelectorAll('[data-content-goal]').forEach(btn=>{btn.onclick=()=>{btn.classList.toggle('action-primary');btn.classList.toggle('secondary')}})
function selectedContentGoals(){return [...document.querySelectorAll('[data-content-goal].action-primary')].map(btn=>btn.dataset.contentGoal)}
function fillBrandInput(p={}){const input=p.brandInput||{};$('brandName').value=input.brandName||p.name||'';$('brandSegment').value=input.segment||p.companyProfile?.segment||'';$('brandProductsOrServices').value=input.productsOrServices||p.companyProfile?.productsOrServices||'';$('brandDescription').value=input.description||p.companyProfile?.description||'';$('brandServiceRegion').value=input.serviceRegion||p.companyProfile?.location||'';$('brandMainDifferential').value=input.mainDifferential||p.companyProfile?.differentiators||'';setGoalButtons(input.contentGoals||p.companyProfile?.contentGoals||[]);renderLogoIdentity(p)}
function renderLogoIdentity(p={}){const box=$('logoColorPreview');if(!box)return;const identity=p.brandIdentity||{};const colors=[...(identity.editedColors||[]),...(identity.extractedColors||[])];box.innerHTML='<b>Cores identificadas na logo</b><br><span class="muted">'+(colors.length?esc(colors.join(', ')):'Envie a logo. A primeira versão preserva a logo e permite editar cores no bloco de Identidade visual do Raio-X.')+'</span>'+(identity.logoPath?'<br><span class="pill">logo enviada</span>':'')}
function sourceLabel(source){return{ai_analysis:'análise por IA',ai_suggestion:'sugestão da IA',structured_fallback:'pré-análise local',inferred_hypothesis:'hipótese para confirmar',user_input:'informado pela empresa',logo_identity:'extraído da logo'}[source]||source}
function renderProjectReadiness(p){const box=$('projectReadiness');if(!box)return;const input=p?.brandInput||{};const basicsOk=Boolean(input.brandName&&input.segment&&input.productsOrServices);const logoOk=Boolean(p?.brandIdentity?.logoPath);const goalsOk=Boolean((input.contentGoals||[]).length);const xrayOk=p?.brandXray?.status==='approved';const offersOk=Boolean((p?.contentStrategy?.offers||[]).filter(offer=>offer.active!==false).length);const referencesOk=Boolean((p?.brand?.references||[]).length);const items=[['Informações básicas preenchidas',basicsOk],['Logo enviada',logoOk],['Objetivos do conteúdo escolhidos',goalsOk],[xrayOk?'Raio-X aprovado':'Raio-X ainda não usado',xrayOk],['Ofertas cadastradas',offersOk],['Referências cadastradas',referencesOk]];box.classList.remove('muted');box.innerHTML='<b>Projeto: '+esc(p?.name||'')+'</b><br>'+items.map(([label,ok])=>(ok?'✅':'⚠️')+' '+esc(label)).join('<br>')}
function autoGrowTextareas(root=document){root.querySelectorAll('textarea[data-xray-block]').forEach(area=>{area.style.height='auto';area.style.height=Math.max(220,area.scrollHeight+2)+'px';area.oninput=()=>{area.style.height='auto';area.style.height=Math.max(220,area.scrollHeight+2)+'px'}})}
function renderBrandXray(p){const box=$('brandXrayBlocks');if(!box)return;const xray=p?.brandXray||{};const blocks=xray.blocks||{};const ids=['summary','communication','contentStrategy'];const labels={summary:'Resumo da marca',communication:'Compradores e comunicação',contentStrategy:'Estratégia de conteúdo'};const hasBlocks=ids.some(id=>blocks[id]?.text);box.classList.toggle('muted',!hasBlocks);box.classList.toggle('brand-xray-grid',hasBlocks);const modeNote=xray.analysisMode==='ai'?'Análise estratégica feita pela IA.':'Pré-análise local: confirme as hipóteses antes de aprovar.';box.innerHTML=hasBlocks?'<div class="brand-xray-intro"><b>Revise a estratégia sugerida.</b><br><span class="muted">'+esc(modeNote)+' A identidade visual continua na aba Referências e imagem.</span></div>':'Preencha as informações, escolha objetivos e clique em “Salvar e analisar minha marca”.';ids.forEach(id=>{const block=blocks[id];if(!block)return;const sources=Array.isArray(block.sources)&&block.sources.length?block.sources:[block.source||xray.source||'structured_fallback'];const card=document.createElement('div');card.className='reference-card brand-xray-card';card.innerHTML='<div class="reference-body"><div class="reference-name">'+esc(labels[id]||block.label||id)+'</div><div class="reference-meta"><span class="pill">'+esc(block.status||xray.status||'gerado')+'</span>'+sources.map(source=>'<span class="pill">'+esc(sourceLabel(source))+'</span>').join('')+'</div><textarea aria-label="'+esc(labels[id]||block.label||id)+'" data-xray-block="'+esc(id)+'">'+esc(block.text||'')+'</textarea><div class="brand-xray-source-note">Confirme as hipóteses antes de aprovar. Sugestões não são fatos nem promessas.</div></div>';box.appendChild(card)});autoGrowTextareas(box)}
async function selectProject(id){selectedProjectId=id;const p=state.projects.find(x=>x.projectId===id);if(!p)return;$('metricSelected').textContent=p.name.split(' ')[0]||p.projectId;$('tokenHandle').value=p.instagram.handle||'';$('visualStyle').value=p.brand?.visualStyle||'';$('imageRules').value=(p.brand?.imageRules||[]).join('\\n');fillBrandInput(p);renderBrandXray(p);renderProjectReadiness(p);$('selected').innerHTML='<b>'+esc(p.name)+'</b><br>Conta: '+esc(p.instagram.handle)+'<br>Modo: '+esc(p.mode)+'<br>Segmento: '+esc(p.brandInput?.segment||p.companyProfile?.segment||'Raio-X não preenchido')+'<br>Raio-X: '+esc(p.brandXray?.status||'empty')+'<br>Token: '+(p.token.configured?esc(p.token.masked)+' · '+p.token.daysRemaining+' dias':'não cadastrado')+'<br><span class="muted">Pasta local: _opensquad/content-central/projects/'+esc(p.projectId)+'</span>';renderReferences(p);renderOffers(p);renderNextTestTopic(p);renderProjects();const activeOfferCount=(p.contentStrategy?.offers||[]).filter(offer=>offer.active!==false).length;const offersWarningBox=$('noOffersWarning');if(offersWarningBox)offersWarningBox.style.display=activeOfferCount?'none':'block';await loadContent()}
function referenceRoleLabel(role){return{brand_asset:'Ativo oficial/logo',product_photo:'Foto real do produto',layout_model:'Modelo visual que gostei',text_parameter:'Exemplo de texto/oferta',visual_reference:'Inspiração visual'}[role]||'Inspiração visual'}
function referenceCategoryLabel(category){return{official_asset:'Ativos oficiais da marca',real_product:'Fotos reais e produtos',visual_inspiration:'Inspirações visuais'}[category]||'Inspirações visuais'}
function referenceAutomaticRule(category){return{official_asset:'Preservar exatamente o ativo enviado. Não redesenhar, reinterpretar, alterar textos, cores ou proporções importantes.',real_product:'Preservar a aparência real. É permitido recortar, ajustar iluminação e integrar à composição, mas não substituir por outro produto.',visual_inspiration:'Utilizar apenas como inspiração visual. Não copiar logos, nomes, textos, preços, produtos ou elementos exclusivos da referência.'}[category]||'Utilizar apenas como inspiração visual. Não copiar informações factuais da referência.'}
function referenceRoleLabels(ref){const roles=Array.isArray(ref.usageRoles)&&ref.usageRoles.length?ref.usageRoles:[ref.role];return roles.map(referenceRoleLabel).join(', ')}
function offerTypeLabel(type){return{offer:'Oferta direta',service:'Serviço',combo:'Combo / promoção',rodizio:'Rodízio',delivery:'Delivery',product:'Produto destaque',orientation:'Post de orientação',desire:'Post de desejo',urgency:'Urgência / hoje tem',institutional:'Institucional',social_proof:'Prova social'}[type]||'Oferta direta'}
function renderNextTestTopic(p){const el=$('nextTestTopic');if(!el)return;const offers=(p?.contentStrategy?.offers||[]).filter(offer=>offer.active!==false);if(!offers.length){const goals=p?.brandInput?.contentGoals||[];el.innerHTML=goals.length?'<b>Próximo assunto do Teste seguro:</b><br><span class="muted">Nenhuma oferta cadastrada, mas você marcou objetivos de conteúdo — o teste vai gerar um post baseado neles (autoridade, engajamento etc.) até você cadastrar ofertas.</span>':'<b>Próximo assunto do Teste seguro:</b><br><span class="muted">Nenhuma oferta nem objetivo de conteúdo cadastrado. O teste vai usar assuntos genéricos até você cadastrar pelo menos um.</span>';return}const raw=Number(p.contentStrategy?.nextTestTopicIndex||0);const index=Number.isFinite(raw)?((Math.trunc(raw)%offers.length)+offers.length)%offers.length:0;const offer=offers[index];el.innerHTML='<b>Próximo assunto do Teste seguro:</b><br><span class="muted">'+esc(offer.name)+' · '+esc(offerTypeLabel(offer.type))+(offer.price?' · '+esc(offer.price):'')+'. Depois do teste, ele avança para a próxima oferta ativa.</span>'}
function referenceEditFormHtml(ref){const category=ref.referenceCategory||'visual_inspiration';const weight=ref.weight||'medium';return '<div class="field-card" style="margin-top:10px"><label>Categoria da referência</label><select data-edit-category><option value="official_asset"'+(category==='official_asset'?' selected':'')+'>Ativos oficiais da marca</option><option value="real_product"'+(category==='real_product'?' selected':'')+'>Fotos reais e produtos</option><option value="visual_inspiration"'+(category==='visual_inspiration'?' selected':'')+'>Inspirações visuais</option></select><label>Observação curta</label><input data-edit-instruction value="'+esc(ref.instruction||'')+'"><label class="pill" style="margin:8px 0;width:max-content"><input type="checkbox" data-edit-use'+(ref.useInNextGeneration===false?'':' checked')+'> Usar na próxima geração</label><label>Prioridade</label><select data-edit-weight><option value="low"'+(weight==='low'?' selected':'')+'>Baixo</option><option value="medium"'+(weight==='medium'?' selected':'')+'>Médio</option><option value="high"'+(weight==='high'?' selected':'')+'>Alto</option></select><div class="button-row" style="margin-top:8px"><button class="action-primary" data-save-reference>Salvar</button><button class="secondary" data-cancel-reference>Cancelar</button></div></div>'}
function renderReferences(p){const refs=p.brand?.references||[];const box=$('referenceGallery');if(!box)return;box.classList.toggle('muted',!refs.length);box.innerHTML=refs.length?'':'Nenhuma referência enviada ainda.';refs.forEach(ref=>{const isImage=String(ref.mimeType||'').startsWith('image/');const isEditing=ref.relativePath===editingReferencePath;const card=document.createElement('div');card.className='reference-card';const actionsHtml=isEditing?'':'<div class="card-actions"><button class="secondary" data-edit-reference>Editar</button><button class="card-delete" data-delete-reference>Apagar referência</button></div>';card.innerHTML='<div class="reference-thumb">'+(isImage?'<img alt="'+esc(ref.filename)+'" src="'+esc(ref.previewUrl)+'">':'<span>'+esc(ref.filename)+'</span>')+'</div><div class="reference-body"><div class="reference-name">'+esc(ref.filename)+'</div><div class="reference-meta"><span class="pill">'+esc(referenceCategoryLabel(ref.referenceCategory))+'</span><span class="pill">'+esc(referenceRoleLabels(ref))+'</span><span class="pill">'+(ref.useInNextGeneration===false?'não usar':'usar próxima')+'</span><span class="pill">prioridade '+esc(ref.weight)+'</span></div><div class="reference-note"><b>Regra automática:</b> '+esc(ref.automaticRule||referenceAutomaticRule(ref.referenceCategory))+'<br><b>Obs:</b> '+esc(ref.instruction||'Sem observação específica.')+'</div>'+(isEditing?referenceEditFormHtml(ref):'')+actionsHtml+'</div>';if(isEditing){card.querySelector('[data-save-reference]').onclick=(event)=>{event.stopPropagation();saveReferenceEdit(ref.relativePath,card)};card.querySelector('[data-cancel-reference]').onclick=(event)=>{event.stopPropagation();cancelEditReference()}}else{card.querySelector('[data-edit-reference]').onclick=(event)=>{event.stopPropagation();editReference(ref.relativePath)};card.querySelector('[data-delete-reference]').onclick=(event)=>{event.stopPropagation();deleteReference(ref.relativePath)}}box.appendChild(card)})}
function editReference(relativePath){editingReferencePath=relativePath;renderReferences(currentProject())}
function cancelEditReference(){editingReferencePath=null;renderReferences(currentProject())}
async function saveReferenceEdit(relativePath,card){const referenceCategory=card.querySelector('[data-edit-category]').value;const instruction=card.querySelector('[data-edit-instruction]').value;const useInNextGeneration=card.querySelector('[data-edit-use]').checked;const weight=card.querySelector('[data-edit-weight]').value;try{await api('/api/projects/'+selectedProjectId+'/references-update',{method:'POST',body:JSON.stringify({relativePath,referenceCategory,instruction,useInNextGeneration,weight})});editingReferencePath=null;toast('Referência atualizada');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
function renderOffers(p){const offers=p.contentStrategy?.offers||[];const box=$('offersList');if(!box)return;box.classList.toggle('muted',!offers.length);box.innerHTML=offers.length?'':'Nenhuma oferta/assunto cadastrado ainda.';offers.forEach(offer=>{const card=document.createElement('div');card.className='reference-card';const ctaLabel=offer.cta|| (offer.autoGenerateCta?'IA escolhe automaticamente':'não informado');card.innerHTML='<div class="reference-body"><div class="reference-name">'+esc(offer.name)+'</div><div class="reference-meta"><span class="pill">'+esc(offerTypeLabel(offer.type))+'</span><span class="pill">'+esc(offer.price||'sem preço')+'</span><span class="pill">'+(offer.active===false?'inativo':'ativo')+'</span>'+(offer.autoGenerateCta?'<span class="pill">CTA automático</span>':'')+'</div><div class="reference-note"><b>Itens:</b> '+esc(offer.items||'não informado')+'<br><b>CTA:</b> '+esc(ctaLabel)+'<br><b>Obs:</b> '+esc(offer.notes||'sem observação')+'</div><div class="card-actions"><button class="secondary" data-edit-offer>Editar</button><button class="card-delete" data-delete-offer>Apagar oferta/assunto</button></div></div>';card.querySelector('[data-edit-offer]').onclick=(event)=>{event.stopPropagation();editOffer(offer.id)};card.querySelector('[data-delete-offer]').onclick=(event)=>{event.stopPropagation();deleteOffer(offer.id)};box.appendChild(card)})}
async function createProject(){try{const body={projectId:$('projectId').value,name:$('name').value,handle:$('handle').value,approvalEmail:$('approvalEmail').value,mode:$('mode').value};const res=await api('/api/projects',{method:'POST',body:JSON.stringify(body)});selectedProjectId=res.project.projectId;toast('Projeto criado');$('createProjectDetails').open=false;await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
function brandInputBody(){return{brandName:$('brandName').value,segment:$('brandSegment').value,productsOrServices:$('brandProductsOrServices').value,description:$('brandDescription').value,serviceRegion:$('brandServiceRegion').value,mainDifferential:$('brandMainDifferential').value,contentGoals:selectedContentGoals()}}
async function saveBrandInput(){if(!selectedProjectId)return toast('Selecione um projeto',true);const body=brandInputBody();if(!body.brandName||!body.segment||!body.productsOrServices)return toast('Preencha nome, segmento e o que a empresa vende/oferece',true);await api('/api/projects/'+selectedProjectId+'/brand-input',{method:'POST',body:JSON.stringify(body)})}
async function saveCompanyProfile(){return saveBrandInput()}
function xrayEdits(){const edits={};document.querySelectorAll('[data-xray-block]').forEach(input=>{edits[input.dataset.xrayBlock]=input.value});return edits}
async function analyzeBrandXray(){if(!selectedProjectId)return toast('Selecione um projeto',true);setButtonBusy('analyzeBrandButton',true,'Analisando...');try{await saveBrandInput();await api('/api/projects/'+selectedProjectId+'/brand-xray/analyze',{method:'POST',body:JSON.stringify({})});toast('Raio-X da marca gerado');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}finally{setButtonBusy('analyzeBrandButton',false)}}
async function approveBrandXray(){if(!selectedProjectId)return toast('Selecione um projeto',true);try{await api('/api/projects/'+selectedProjectId+'/brand-xray/approve',{method:'POST',body:JSON.stringify({edits:xrayEdits()})});toast('Estratégia da marca aprovada');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function saveToken(){if(!selectedProjectId)return toast('Selecione um projeto',true);try{const res=await api('/api/projects/'+selectedProjectId+'/token',{method:'POST',body:JSON.stringify({token:$('token').value,handle:$('tokenHandle').value})});$('token').value='';toast('Token validado e salvo: '+(res.project.token.daysRemaining??'?')+' dias restantes');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
function selectedReferenceUsageRoles(){const roles=selectedCheckboxValues('referenceUsageRoles');return roles.length?roles:['visual_reference']}
function roleForCategory(category,usageRoles){if(category==='official_asset')return'brand_asset';if(category==='real_product')return'product_photo';return usageRoles[0]||'visual_reference'}
async function uploadAsset(kind,file){if(!selectedProjectId)return toast('Selecione um projeto',true);const dataUrl=await fileToDataUrl(file);const usageRoles=selectedReferenceUsageRoles();const category=$('referenceCategory')?.value||'visual_inspiration';return api('/api/projects/'+selectedProjectId+'/assets',{method:'POST',body:JSON.stringify({kind,filename:file.name,dataUrl,role:roleForCategory(category,usageRoles),usageRoles,referenceCategory:kind==='logo'?'official_asset':category,useInNextGeneration:$('referenceUseInNextGeneration')?.checked!==false,weight:$('referenceWeight')?.value,instruction:$('referenceInstruction')?.value})})}
async function uploadLogo(){const file=$('logoFile').files[0];if(!file)return toast('Escolha um arquivo de logo',true);try{await uploadAsset('logo',file);$('logoFile').value='';toast('Logo enviado');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function uploadBrandLogo(){const file=$('brandLogoFile').files[0];if(!file)return toast('Escolha um arquivo de logo',true);try{if(!selectedProjectId)return toast('Selecione um projeto',true);const dataUrl=await fileToDataUrl(file);await api('/api/projects/'+selectedProjectId+'/assets',{method:'POST',body:JSON.stringify({kind:'logo',filename:file.name,dataUrl,role:'brand_asset',usageRoles:['brand_asset'],referenceCategory:'official_asset',useInNextGeneration:true,instruction:'Logo oficial da marca. Preservar exatamente como enviado.'})});$('brandLogoFile').value='';toast('Logo enviado');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function uploadReferences(){const files=[...$('referenceFile').files];if(!files.length)return toast('Escolha pelo menos uma referência',true);try{for(const file of files)await uploadAsset('reference',file);$('referenceFile').value='';$('referenceInstruction').value='';toast(files.length+' referência(s) enviada(s)');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function deleteReference(relativePath){if(!selectedProjectId)return toast('Selecione um projeto',true);if(!confirm('Apagar esta referência do projeto?'))return;try{await api('/api/projects/'+selectedProjectId+'/references-delete',{method:'POST',body:JSON.stringify({relativePath})});if(editingReferencePath===relativePath)editingReferencePath=null;toast('Referência apagada');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function saveImageRules(){if(!selectedProjectId)return toast('Selecione um projeto',true);try{await api('/api/projects/'+selectedProjectId+'/image-rules',{method:'POST',body:JSON.stringify({visualStyle:$('visualStyle').value,imageRules:$('imageRules').value})});toast('Direção visual salva');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
function setOfferFormEditMode(active){const btn=$('offerSaveButton');if(btn)btn.textContent=active?'Salvar edição':'Salvar oferta/assunto';const cancelBtn=$('offerCancelEditButton');if(cancelBtn)cancelBtn.style.display=active?'inline-flex':'none'}
function editOffer(offerId){const p=currentProject();if(!p)return;const offer=(p.contentStrategy?.offers||[]).find(o=>o.id===offerId);if(!offer)return;editingOfferId=offerId;$('offerName').value=offer.name||'';$('offerType').value=offer.type||'offer';$('offerPrice').value=offer.price||'';$('offerItems').value=offer.items||'';$('offerCta').value=offer.cta||'';$('offerAutoCta').checked=!!offer.autoGenerateCta;$('offerNotes').value=offer.notes||'';setOfferFormEditMode(true);switchTab('offers');$('offerName').scrollIntoView({behavior:'smooth',block:'center'})}
function cancelEditOffer(){editingOfferId=null;$('offerName').value='';$('offerType').value='offer';$('offerPrice').value='';$('offerItems').value='';$('offerCta').value='';$('offerAutoCta').checked=false;$('offerNotes').value='';setOfferFormEditMode(false)}
async function saveOffer(){if(!selectedProjectId)return toast('Selecione um projeto',true);try{const body={name:$('offerName').value,type:$('offerType').value,price:$('offerPrice').value,items:$('offerItems').value,cta:$('offerCta').value,autoGenerateCta:$('offerAutoCta').checked,notes:$('offerNotes').value};if(editingOfferId)body.id=editingOfferId;await api('/api/projects/'+selectedProjectId+'/offers',{method:'POST',body:JSON.stringify(body)});$('offerName').value='';$('offerPrice').value='';$('offerItems').value='';$('offerCta').value='';$('offerAutoCta').checked=false;$('offerNotes').value='';toast(editingOfferId?'Oferta/assunto atualizado':'Oferta/assunto salvo');editingOfferId=null;setOfferFormEditMode(false);await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function deleteOffer(offerId){if(!selectedProjectId)return toast('Selecione um projeto',true);if(!confirm('Apagar esta oferta/assunto? Ela não será usada nas próximas gerações.'))return;try{await api('/api/projects/'+selectedProjectId+'/offers-delete',{method:'POST',body:JSON.stringify({offerId})});if(editingOfferId===offerId)cancelEditOffer();toast('Oferta/assunto apagado');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
function scheduleFormats(){return [...document.querySelectorAll('input[data-format]:checked')].map(input=>{const channel=input.value;return{channel,postsPerDay:$(channel+'_count').value,everyDays:$(channel+'_every').value,startTime:$(channel+'_time').value,intervalMinutes:$(channel+'_interval').value}})}
async function generateContent(){if(!selectedProjectId)return toast('Selecione um projeto',true);const formats=scheduleFormats();if(!formats.length)return toast('Marque pelo menos um formato',true);setButtonBusy('generateButton',true,'Organizando agenda...');try{const res=await api('/api/projects/'+selectedProjectId+'/generate',{method:'POST',body:JSON.stringify({days:$('days').value,startDate:$('startDate').value,formats,contentRules:$('contentRules').value})});toast('Agenda criada: '+res.batch.items.length+' item(ns). Gerando as imagens de IA agora — acompanhe na aba Conteúdos gerados.');switchTab('content');contentView='aguardando';await loadContent()}catch(e){toast(e.message,true)}finally{setButtonBusy('generateButton',false)}}
function renderCreativeReview(item){const review=item?.creativeReview;if(!review)return '<div class="notice" style="margin:10px 0"><b>Agente Revisor de Criativo:</b><br><span class="muted">Ainda sem revisão automática. Revise visualmente antes de aprovar.</span></div>';const cls=review.status==='blocked'?'bad':(review.status==='ok'?'ok':'');const attempts=Array.isArray(item.creativeReviewAttempts)?item.creativeReviewAttempts.length:Number(item.image?.generationAttempts||review.attempt||1);const retryNote=attempts>1?'<div class="pill ok" style="margin-top:8px">Refeito automaticamente '+attempts+' tentativa(s) até esta revisão</div>':'';const errors=(review.errors||[]).map(e=>'<li>'+esc(e)+'</li>').join('');const warnings=(review.warnings||[]).map(w=>'<li>'+esc(w)+'</li>').join('');const checks=(review.checks||[]).map(c=>'<li>'+esc(c)+'</li>').join('');return '<div class="notice" style="margin:10px 0"><b>Agente Revisor de Criativo:</b> <span class="pill '+cls+'">'+esc(review.status||'warning')+'</span><br><span class="muted">'+esc(review.summary||'Sem resumo')+'</span>'+retryNote+(errors?'<ul style="margin:8px 0 0 18px;color:#fecaca">'+errors+'</ul>':'')+(warnings?'<ul style="margin:8px 0 0 18px;color:#fde68a">'+warnings+'</ul>':'')+(checks?'<details style="margin-top:8px"><summary>Checks aprovados</summary><ul>'+checks+'</ul></details>':'')+'</div>'}
function renderTestPreview(item){const box=$('testResult');if(!box)return;if(!item){box.className='empty-state';box.innerHTML='<b>Nenhum teste gerado ainda.</b><br>A imagem e a legenda do teste vão aparecer aqui nesta aba.';return}const sourceLabel=item.image?.generatedSource==='ai'?'imagem IA desenhada pelo ChatGPT':'prévia local';const preview=renderImagePreview(item,'Imagem gerada no teste');const variation=item.publish?.creativeVariation?'<div class="notice" style="margin:10px 0"><b>Variação deste teste:</b><br><span class="muted">'+esc(item.publish.creativeVariation)+'</span></div>':'';const review=renderCreativeReview(item);box.className='content-card';box.innerHTML=preview+'<div><div class="section-title"><h3>Último teste gerado</h3><span class="pill">'+esc(item.formatLabel||item.channel)+'</span></div><div class="content-meta"><span class="pill">Fonte: '+esc(sourceLabel)+'</span><span class="pill">tamanho: '+esc(item.image?.dimensions?.width||'')+'x'+esc(item.image?.dimensions?.height||'')+'</span><span class="pill">dry-run: '+esc(item.publish?.dryRun!==false?'sim':'não')+'</span><span class="pill">publicado: '+esc(item.publish?.realPublished?'sim':'não')+'</span></div>'+variation+review+'<div class="caption-box">'+esc(item.caption?.text||'Sem legenda')+'</div><details style="margin-top:10px"><summary>Prompt do criativo</summary><div class="prompt-box">'+esc(item.image?.prompt||'Sem prompt')+'</div></details></div>'}
function renderLatestTestPreview(content){const latest=[...(content||[])].reverse().find(item=>item.status==='test_post_simulated'||item.publish?.dryRun===true);renderTestPreview(latest)}
async function testPost(){if(!selectedProjectId)return toast('Selecione um projeto',true);const channel=$('testChannel').value;$('testPostStatus').textContent='Gerando imagem IA e revisando automaticamente. Pode levar alguns minutos se o revisor mandar refazer. Não feche esta tela.';renderTestLoading(channel);setButtonBusy('testPostButton',true,'Gerando e revisando...');try{const res=await api('/api/projects/'+selectedProjectId+'/test-post',{method:'POST',body:JSON.stringify({channel,note:$('testNote').value})});const attempts=Number(res.content.image?.generationAttempts||res.content.creativeReviewAttempts?.length||1);const retryInfo=attempts>1?' Refeito automaticamente em '+attempts+' tentativa(s).':'';const source=res.content.image?.generatedSource==='ai'?'Imagem IA gerada, revisada e enquadrada no tamanho do canal.':'Simulação criada com prévia local.';toast(source+retryInfo+' Não publicou de verdade.');renderTestPreview(res.content);switchTab('test');await loadContent()}catch(e){toast(e.message,true)}finally{setButtonBusy('testPostButton',false);$('testPostStatus').textContent=''}}
function bucketForItem(item){return item.status==='aprovado'?'aprovado':'aguardando'}
function setContentView(view){contentView=view;document.querySelectorAll('.content-subtabs .tab-button').forEach(btn=>btn.classList.toggle('active',btn.dataset.substatus===view))}
function switchContentView(view){setContentView(view);renderContentList()}
function openBriefing(){if(!selectedProjectId)return toast('Selecione um projeto',true);window.open('/api/projects/'+selectedProjectId+'/briefing','_blank')}
function renderOverviewDashboard(p){const statsBox=$('overviewStats');if(!statsBox||!p)return;const counts={aguardando:0,aprovado:0};lastContent.forEach(item=>{const bucket=bucketForItem(item);counts[bucket]=(counts[bucket]||0)+1});const refCount=p.brand?.references?.length||0;const offerCount=(p.contentStrategy?.offers||[]).length;statsBox.innerHTML='<div class="stat-card"><b>'+counts.aguardando+'</b><span>Aguardando aprovação</span></div><div class="stat-card"><b>'+counts.aprovado+'</b><span>Aprovados</span></div><div class="stat-card"><b>'+refCount+'</b><span>Referências cadastradas</span></div><div class="stat-card"><b>'+offerCount+'</b><span>Ofertas/assuntos</span></div>';const items=[{done:p.brandXray?.status==='approved',title:'Raio-X da empresa',desc:p.brandXray?.status==='approved'?'Aprovado':'Ainda não aprovado',tab:'company'},{done:refCount>0,title:'Referências visuais',desc:refCount>0?refCount+' referência(s) enviada(s)':'Nenhuma referência enviada ainda',tab:'references'},{done:offerCount>0,title:'Ofertas e assuntos',desc:offerCount>0?offerCount+' cadastrado(s)':'Nenhuma oferta/assunto cadastrado',tab:'offers'},{done:p.token?.configured===true,title:'Token do Instagram',desc:p.token?.configured?'Configurado':'Ainda não cadastrado',tab:'account'},{done:lastContent.length>0,title:'Primeiro conteúdo gerado',desc:lastContent.length>0?lastContent.length+' card(s) no total':'Nenhum conteúdo gerado ainda',tab:'generate'}];const checklistBox=$('overviewChecklist');if(checklistBox)checklistBox.innerHTML=items.map(item=>'<div class="checklist-item '+(item.done?'done':'')+'" style="cursor:pointer" onclick="switchTab(&#39;'+item.tab+'&#39;)"><span class="check-icon">'+(item.done?'✓':'')+'</span><span class="check-label"><span class="check-title">'+esc(item.title)+'</span><span class="check-desc">'+esc(item.desc)+'</span></span></div>').join('')}
async function loadContent(){const data=await api('/api/projects/'+selectedProjectId+'/content');lastContent=data.content;renderLatestTestPreview(lastContent);renderContentList();const currentProject=state.projects.find(x=>x.projectId===selectedProjectId);renderOverviewDashboard(currentProject);const stillGenerating=lastContent.some(item=>item.image?.generating);if(stillGenerating)startGenerationPolling();else stopGenerationPolling()}
function startGenerationPolling(){if(generationPollTimer)return;generationPollTimer=setInterval(async()=>{try{await loadContent()}catch(e){}},3000)}
function stopGenerationPolling(){if(!generationPollTimer)return;clearInterval(generationPollTimer);generationPollTimer=null}
function rowKey(item){return esc(item.batchId)+'__'+esc(item.contentId)}
function renderPublishStatus(item,bucket){if(bucket!=='aprovado')return '';const p=item.publish||{};if(p.realPublished){const link=p.permalink?' · <a href="'+esc(p.permalink)+'" target="_blank" rel="noopener">ver post</a>':'';return '<div class="notice" style="margin:10px 0"><b>Publicado no Instagram</b> '+esc(p.publishedAt?new Date(p.publishedAt).toLocaleString('pt-BR'):'')+link+'</div>'}if(p.error){return '<div class="notice" style="margin:10px 0;border-color:rgba(239,68,68,.5)"><b>Falha ao publicar:</b><br><span class="muted">'+esc(p.error)+'</span></div>'}return '<div class="notice" style="margin:10px 0"><span class="muted">Aguardando o horário agendado (Dia '+esc(item.dayNumber)+' · '+esc(item.scheduledDate)+' · '+esc(item.scheduledTime||'')+') pra publicar automaticamente.</span></div>'}
function buildCardElement(item){const div=document.createElement('div');div.className='content-card';const key=rowKey(item);const bucket=bucketForItem(item);const sourceLabel=item.image?.generating?'gerando agora...':(item.image?.generatedSource==='ai'?'imagem IA desenhada pelo ChatGPT':'prévia local');const captionSourceLabel=item.caption?.generatedSource==='ai'?'escrita pelo Agente Redator':'rascunho';const preview=renderImagePreview(item,'Prévia gerada');const review=renderCreativeReview(item);const publishStatus=renderPublishStatus(item,bucket);const actions=[];actions.push('<button class="secondary" data-action="regen-image" id="regen-image-'+key+'">Regenerar só a imagem</button>');actions.push('<button class="secondary" data-action="regen-all" id="regen-all-'+key+'">Regenerar dia</button>');if(bucket==='aguardando')actions.push('<button class="action-primary" data-action="approve" id="approve-'+key+'">Aprovar</button>');if(bucket==='aprovado'&&!item.publish?.realPublished)actions.push('<button class="action-primary" data-action="publish" id="publish-'+key+'">'+(item.publish?.error?'Tentar publicar de novo':'Publicar agora')+'</button>');actions.push('<button class="danger" data-action="delete">Apagar</button>');div.innerHTML=preview+'<div><div class="section-title"><h3>Dia '+esc(item.dayNumber)+' · '+esc(item.scheduledDate)+' · '+esc(item.scheduledTime||'')+'</h3><span class="pill">'+esc(item.formatLabel||item.channel)+'</span></div><div class="content-meta"><span class="pill">'+esc(item.contentId)+'</span><span class="pill">'+esc(item.status)+'</span><span class="pill">Fonte: '+esc(sourceLabel)+'</span><span class="pill">tamanho: '+esc(item.image?.dimensions?.width||'')+'x'+esc(item.image?.dimensions?.height||'')+'</span><span class="pill">Legenda: '+esc(captionSourceLabel)+'</span></div>'+review+publishStatus+'<div class="caption-box">'+esc(item.caption?.text||'Sem legenda')+'</div><details style="margin-top:10px"><summary>Prompt do criativo</summary><div class="prompt-box">'+esc(item.image?.prompt||'Sem prompt')+'</div></details><label>Ajuste deste dia</label><textarea id="note-'+key+'" placeholder="Ex: mais emocional, menos vendedor"></textarea><div class="button-row">'+actions.join('')+'</div></div>';div.querySelector('[data-action="regen-image"]').onclick=()=>regen(item.contentId,'creative',item.batchId);div.querySelector('[data-action="regen-all"]').onclick=()=>regen(item.contentId,'all',item.batchId);const approveBtn=div.querySelector('[data-action="approve"]');if(approveBtn)approveBtn.onclick=()=>approveCard(item.contentId,item.batchId);const publishBtn=div.querySelector('[data-action="publish"]');if(publishBtn)publishBtn.onclick=()=>publishCard(item.contentId,item.batchId);div.querySelector('[data-action="delete"]').onclick=()=>deleteContent(item.contentId,item.batchId);return div}
function formatAgendaDateHeading(dateStr){const parsed=new Date(dateStr+'T00:00:00');if(isNaN(parsed))return dateStr;const weekday=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][parsed.getDay()];return weekday+' · '+dateStr}
function renderContentList(){const box=$('daysList');const items=lastContent.filter(item=>bucketForItem(item)===contentView);const counts={aguardando:0,aprovado:0};lastContent.forEach(item=>{counts[bucketForItem(item)]+=1});const generatingCount=lastContent.filter(item=>item.image?.generating).length;const genNote=generatingCount?' · '+generatingCount+' imagem(ns) sendo gerada(s) agora':'';$('contentSummary').textContent=lastContent.length?counts.aguardando+' aguardando aprovação · '+counts.aprovado+' aprovado(s)'+genNote:'Nenhum conteúdo gerado ainda.';$('briefingBar').style.display=contentView==='aguardando'&&counts.aguardando>0?'block':'none';box.classList.toggle('muted',!items.length);if(!items.length){box.innerHTML='<div class="empty-state"><b>'+(lastContent.length?'Nenhum card nesta etapa.':'Nenhum conteúdo gerado ainda.')+'</b><br>'+(lastContent.length?'Troque de aba acima para ver os outros cards.':'Vá na aba “Agenda e geração” para criar os primeiros cards.')+'</div>';return}box.innerHTML='';if(contentView==='aprovado'){const byDate=new Map();items.slice().sort((a,b)=>(a.scheduledDate+String(a.scheduledTime||'')).localeCompare(b.scheduledDate+String(b.scheduledTime||''))).forEach(item=>{const list=byDate.get(item.scheduledDate)||[];list.push(item);byDate.set(item.scheduledDate,list)});byDate.forEach((dateItems,dateStr)=>{const heading=document.createElement('h3');heading.className='section-heading';heading.textContent=formatAgendaDateHeading(dateStr);box.appendChild(heading);dateItems.forEach(item=>box.appendChild(buildCardElement(item)))});return}items.forEach(item=>box.appendChild(buildCardElement(item)))}
async function deleteContent(contentId,batchId){if(!selectedProjectId)return toast('Selecione um projeto',true);if(!confirm('Apagar este conteúdo gerado?'))return;try{await api('/api/projects/'+selectedProjectId+'/content/'+contentId+'/delete',{method:'POST',body:JSON.stringify({batchId})});toast('Conteúdo apagado');await loadContent()}catch(e){toast(e.message,true)}}
async function regen(contentId,mode,batchId){const key=esc(batchId)+'__'+esc(contentId);const btnId=(mode==='creative'?'regen-image-':'regen-all-')+key;const busyLabel=mode==='creative'?'Gerando imagem...':'Regenerando...';setButtonBusy(btnId,true,busyLabel);if(mode==='creative')toast('Gerando nova imagem com IA — pode levar de 30s a alguns minutos.');try{await api('/api/projects/'+selectedProjectId+'/content/'+contentId+'/regenerate',{method:'POST',body:JSON.stringify({regenerate:mode,batchId,note:$('note-'+key).value})});toast(mode==='creative'?'Imagem regenerada':'Dia regenerado');await loadContent()}catch(e){toast(e.message,true)}finally{setButtonBusy(btnId,false)}}
async function approveCard(contentId,batchId){const key=esc(batchId)+'__'+esc(contentId);const btnId='approve-'+key;setButtonBusy(btnId,true,'Aprovando...');try{await api('/api/projects/'+selectedProjectId+'/content/'+contentId+'/approve',{method:'POST',body:JSON.stringify({batchId})});toast('Card aprovado.');setContentView('aprovado');await loadContent()}catch(e){toast(e.message,true)}finally{setButtonBusy(btnId,false)}}
async function publishCard(contentId,batchId){const key=esc(batchId)+'__'+esc(contentId);const btnId='publish-'+key;setButtonBusy(btnId,true,'Publicando...');try{await api('/api/projects/'+selectedProjectId+'/content/'+contentId+'/publish',{method:'POST',body:JSON.stringify({batchId})});toast('Publicado no Instagram.');await loadContent()}catch(e){toast(e.message,true)}finally{setButtonBusy(btnId,false)}}
load().catch(e=>toast(e.message,true));
</script>
</body>
</html>`;
}
