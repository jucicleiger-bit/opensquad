import { exec, execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { platform, tmpdir } from 'node:os';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { HorizontalAlign, VerticalAlign } from '@jimp/core';
import { SANS_16_BLACK, SANS_16_WHITE, SANS_32_BLACK, SANS_32_WHITE, SANS_64_BLACK, SANS_64_WHITE } from '@jimp/plugin-print/fonts';
import { Jimp, loadFont, measureText } from 'jimp';
import sharp from 'sharp';
import { uploadToImgBB } from '../skills/instagram-publisher/scripts/publish.js';
import {
  animateContentForReels,
  buildApprovalPayload,
  approveContent,
  analyzeProjectBrandXray,
  analyzeProjectBrandBriefing,
  approveProjectBrandXray,
  approveProjectBrandBriefing,
  chooseCreativeCta,
  createCentralProject,
  creativeShapeGroupForChannel,
  deleteCentralProject,
  deleteProjectContent,
  deleteProjectOffer,
  deleteProjectPillar,
  deleteProjectReference,
  enqueueBatchImageGeneration,
  enqueueCatalogImageGeneration,
  generateCatalogSchedulePlan,
  generateContentBatch,
  generateContentSchedulePlan,
  getCentralPaths,
  getGlobalRules,
  listCentralProjects,
  listProjectContent,
  listSystemAlerts,
  sendDueAlertEmails,
  publishSingleContent,
  readProjectToken,
  reconcileInterruptedGenerations,
  regenerateContentDay,
  regenerateContentGroup,
  researchOnlineVisualTrends,
  runDuePublishSweep,
  saveProjectAsset,
  saveProjectOffer,
  saveProjectPillar,
  saveProjectToken,
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

const API_SUPPORTED_CHANNELS = new Set(['instagram_feed', 'instagram_story', 'instagram_reels', 'facebook_feed', 'facebook_story']);
const execFileAsync = promisify(execFile);

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
  brandAnalyzer = null,
  pillarSuggester = null,
  logoColorAnalyzer = null,
  siteAnalyzer = null,
  webResearcher = null,
  videoAnimator = null,
} = {}) {
  await loadContentCentralEnv(targetDir);
  await reconcileInterruptedGenerations(targetDir).catch((err) => console.error('[content-central] reconcile interrupted generations failed:', err.message));
  const context = {
    catalogImageComposer: (payload) => composeCatalogImage({ ...payload, targetDir }),
    imageGenerator: imageGenerator || (enableAiImages ? (payload) => generateAiImageForActiveProvider({ ...payload, targetDir }) : null),
    imageReviewer: imageReviewer || (enableAiImages ? reviewAiImageWithHermes : null),
    captionGenerator: captionGenerator || (enableAiImages ? writeAiCaptionWithHermes : null),
    brandAnalyzer: brandAnalyzer || (enableAiImages ? generateBrandXrayWithAi : null),
    pillarSuggester: pillarSuggester || (enableAiImages ? generatePillarSuggestionsWithAi : null),
    logoColorAnalyzer: logoColorAnalyzer || (enableAiImages ? identifyLogoColorsWithAi : null),
    siteAnalyzer: siteAnalyzer || (enableAiImages ? analyzeSiteWithAi : null),
    webResearcher: webResearcher || (enableAiImages ? researchOnlineVisualTrendsWithHermes : null),
    videoAnimator: videoAnimator || (enableAiImages ? (payload) => animateImageForReelsWithFfmpeg(payload, targetDir) : null),
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
  const alertEmailSchedulerTimer = startAlertEmailScheduler(targetDir);

  return {
    server,
    url,
    close: () => new Promise((resolve, reject) => {
      if (publishSchedulerTimer) clearInterval(publishSchedulerTimer);
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
  // with clean client-side routes ("/projects/:id/..."). The old vanilla
  // renderApp() panel stays reachable at "/classic" as a fallback for the
  // sections not yet migrated (Referências e imagem, Agenda e geração, Teste
  // seguro) so nobody is stranded while the rewrite is still in progress.
  if (method === 'GET' && route === '/classic') return sendHtml(res, renderApp());
  if (method === 'GET' && (route === '/' || route.startsWith('/assets/') || route === '/projects' || route.startsWith('/projects/'))) {
    return sendReactApp(res, route === '/' ? '' : route);
  }
  if (method === 'GET' && route === '/api/state') return sendJson(res, 200, {
    projects: await listCentralProjects(targetDir),
    globalRules: await getGlobalRules(targetDir),
    alerts: await listSystemAlerts(targetDir),
  });

  if (method === 'POST' && route === '/api/projects') {
    const body = await readBody(req);
    const project = await createCentralProject(body, targetDir);
    return sendJson(res, 201, { project });
  }

  const parts = route.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'api' || parts[1] !== 'projects' || !parts[2]) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const projectId = parts[2];
  if (method === 'GET' && parts.length === 4 && parts[3] === 'content') {
    return sendJson(res, 200, { content: await listProjectContent(projectId, targetDir) });
  }

  if (method === 'GET' && parts.length >= 5 && parts[3] === 'assets') {
    return sendProjectAsset(res, targetDir, projectId, parts.slice(4).join('/'));
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

  if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  if (parts.length === 3) {
    const result = await deleteCentralProject(projectId, targetDir);
    return sendJson(res, 200, result);
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
    return sendJson(res, 200, { project, validation });
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

  if (parts.length === 4 && parts[3] === 'offers-delete') {
    const body = await readBody(req);
    const result = await deleteProjectOffer(projectId, body.offerId, targetDir);
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
      }, targetDir);
      enqueueBatchImageGeneration(projectId, batch, imageOptions, targetDir);
      batches.push(batch);
    }
    return sendJson(res, 201, { batch: batches[0], batches });
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
    const content = await approveContent(projectId, parts[4], targetDir, body.batchId);
    return sendJson(res, 200, { content });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'publish') {
    if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') {
      return sendJson(res, 403, { error: 'Publicação real desligada. Defina OPENSQUAD_ENABLE_REAL_PUBLISHING=true no .env pra ativar.' });
    }
    const body = await readBody(req);
    const content = await publishSingleContent(projectId, parts[4], targetDir, {
      metaPublisher: (payload) => publishContentToInstagram(payload, targetDir),
    }, body.batchId);
    return sendJson(res, 200, { content });
  }

  if (parts.length === 6 && parts[3] === 'content' && parts[5] === 'delete') {
    const body = await readBody(req);
    const result = await deleteProjectContent(projectId, parts[4], targetDir, body.batchId, body.reason);
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

async function sendProjectAsset(res, targetDir, projectId, relativePath) {
  const safeRelative = normalize(relativePath).replace(/^([/\\])+/, '');
  if (!safeRelative.startsWith('assets')) return sendJson(res, 400, { error: 'Asset inválido' });
  const projectRoot = resolve(targetDir, '_opensquad', 'content-central', 'projects', projectId);
  const filePath = resolve(join(projectRoot, safeRelative));
  if (!filePath.startsWith(projectRoot)) return sendJson(res, 400, { error: 'Asset inválido' });
  const body = await readFile(filePath);
  res.writeHead(200, { 'content-type': assetContentType(filePath), 'cache-control': 'no-store' });
  res.end(body);
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

export function buildAiImageGenerationPrompt({ content, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false } = {}) {
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
    rescueMode ? 'No modo resgate, as referências permitidas são apenas logo/produto/estilo. Não usar nem copiar modelo de layout, distribuição horizontal, moldura, mockup ou arte quadrada de referência.' : '',
    'Gere um criativo final completo e bonito: layout, produto, título, preço, CTA e logo integrados na própria imagem.',
    'Não haverá overlay automático de texto depois. Tipografia, preço, CTA e logo precisam ficar bonitos, legíveis e naturais dentro da arte.',
    'Use as referências como direção visual/produto/estilo, mas não copie textos, preços, logos ou marcas das referências.',
    'Não publique nada. Não chame API Meta. Só gere a imagem.',
    'Retorne no final apenas a URL direta da imagem gerada, sem markdown e sem explicação.',
    '',
    'Briefing do criativo:',
    content.image.prompt,
    note ? `Observação do usuário: ${note}` : '',
    'Estilo obrigatório: criativo publicitário profissional, coerente com o segmento e a direção visual já definidos no briefing acima (não assumir alimentação/comida a menos que o briefing diga isso), não render 3D genérico e não foto solta artificial.',
    'Importante: se o briefing contiver "Variação criativa de teste" ou "Conceito do teste", siga essa variação como prioridade. Não gere novamente o mesmo layout, mesma foto ou mesma distribuição do criativo anterior.',
    'A cada teste, mudar claramente pelo menos 3 itens: cena principal, enquadramento, posição do preço/título, elemento de comida em destaque, fundo ou sensação visual.',
    'Evitar retângulo branco gigante, moldura simples, box de preço ruim ou qualquer texto ilegível/falso.',
    content.channel === 'instagram_story' || content.channel === 'instagram_reels' || content.channel === 'facebook_story'
      ? 'Obrigatório: a arte precisa nascer como Story vertical nativo 9:16, preenchendo o canvas sem parecer flyer quadrado. Distribuir topo, centro e base; preço compacto sem cobrir o produto protagonista.'
      : '',
    reviewFeedback ? `Tentativa ${attempt} de ${maxAttempts}: refazer porque o Agente Revisor bloqueou a tentativa anterior. Corrigir obrigatoriamente:\n${reviewFeedback}` : '',
    rescueMode ? 'Regra final do modo resgate: se houver conflito entre referência visual e Story 9:16 real, ignore a referência e preserve o Story 9:16 real.' : '',
    'Evite aparência de IA: nada de plástico, brilho falso, comida perfeita/simétrica demais, letras embaralhadas, texto falso ou texto duplicado.',
    'Detalhes que denunciam IA e devem ser evitados: queijo com brilho artificial demais, ingredientes distribuídos de forma simétrica/perfeita como render 3D, pele/crosta sem nenhuma imperfeição, saturação de cor exagerada tipo anúncio genérico de banco de imagens, sombra e luz "estúdio perfeito" sem ambiente real.',
    'Prefira: iluminação um pouco mais quente/natural, ingredientes espalhados de forma levemente irregular como comida de verdade, fundo/mesa com textura real (madeira, mármore, tecido), leve profundidade de campo como foto tirada com celular ou câmera em ambiente real de pizzaria.',
  ].filter(Boolean).join('\n');
}

export async function generateAiImageForActiveProvider(payload) {
  const provider = String(process.env.OPENSQUAD_IMAGE_PROVIDER || 'openai').trim().toLowerCase();
  if (provider === 'xai' || provider === 'grok') return generateAiImageWithXai(payload);
  if (provider === 'nous' || provider === 'nous-fal' || provider === 'fal') return generateAiImageWithNousFal(payload);
  if (provider === 'codex' || provider === 'openai-codex' || provider === 'chatgpt') return generateAiImageWithCodex(payload);
  return generateAiImageWithChatGpt(payload);
}

async function generateAiImageWithChatGpt({ content, projectId, targetDir, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false }) {
  const prompt = buildAiImageGenerationPrompt({ content, note, attempt, maxAttempts, reviewFeedback, rescueMode });
  const apiKey = process.env.OPENSQUAD_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('ChatGPT/OpenAI Images não configurado. Defina OPENAI_API_KEY ou OPENSQUAD_OPENAI_API_KEY antes de gerar imagens IA.');
  }

  const model = process.env.OPENSQUAD_OPENAI_IMAGE_MODEL || 'gpt-image-1';
  const imageSize = process.env.OPENSQUAD_OPENAI_IMAGE_SIZE || openAiImageSizeForChannel(content?.channel);
  const imageReferences = Array.isArray(content.image?.references)
    ? content.image.references.filter((reference) => reference.absolutePath && String(reference.mimeType || '').startsWith('image/'))
    : [];

  const response = imageReferences.length
    ? await requestOpenAiImageEdit({ apiKey, model, prompt, imageSize, imageReferences })
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
  if (channel === 'instagram_story' || channel === 'instagram_reels' || channel === 'facebook_story') return '1024x1536';
  return '1024x1024';
}

// xAI's Images API only accepts a fixed set of aspect_ratio strings — Instagram
// Feed's 4:5 isn't one of them, so "3:4" (0.75) is the closest supported ratio.
export function xaiAspectRatioForChannel(channel) {
  if (channel === 'instagram_story' || channel === 'instagram_reels' || channel === 'facebook_story') return '9:16';
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
    'Com base SOMENTE nas informações abaixo, escreva um Raio-X da marca em 4 blocos.',
    '',
    `Nome: ${input.brandName || project.name || ''}`,
    `Segmento: ${input.segment || 'não informado'}`,
    `O que vende/oferece: ${input.productsOrServices || 'não informado'}`,
    input.description ? `Sobre a empresa: ${input.description}` : '',
    `Região de atendimento: ${input.serviceRegion || 'não informada'}`,
    `Principal diferencial: ${input.mainDifferential || 'não informado'}`,
    `Objetivos das postagens: ${(input.contentGoals || []).join(', ') || 'não informados'}`,
    input.audience ? `Público-alvo: ${input.audience}` : '',
    (input.tone || []).length ? `Tom de voz desejado: ${input.tone.join(', ')}` : '',
    input.positioning ? `Posicionamento desejado: ${input.positioning}` : '',
    input.websiteOrInstagram ? `Site/Instagram: ${input.websiteOrInstagram}` : '',
    input.factualConstraints ? `Fatos que PODEM ser citados (verdadeiros, informados pelo usuário): ${input.factualConstraints}` : '',
    colors.length ? `Cores da identidade visual: ${colors.join(', ')}` : '',
    input.brandColors ? `Cores da marca (descrição do usuário): ${input.brandColors}` : '',
    '',
    'Regras obrigatórias:',
    '- Não invente preço, promoção, endereço, prêmio, número de clientes ou qualquer fato que não foi informado acima.',
    '- Separe claramente, dentro do texto, o que foi informado pelo usuário do que é sugestão sua (ex: "Informado pelo usuário: ..." e "Sugestão da IA: ...").',
    '- Seja específico para este negócio; não escreva frases genéricas que serviriam para qualquer segmento.',
    '- Escreva em português do Brasil, tom comercial e direto, sem jargão de agência.',
    input.avoid ? `- NUNCA mencione, sugira ou aproxime-se do seguinte, o usuário pediu para evitar explicitamente: ${input.avoid}.` : '',
    '',
    'Responda APENAS com um JSON válido neste formato exato, sem markdown e sem texto fora do JSON:',
    '{"summary":"...","communication":"...","contentStrategy":"...","visualIdentity":"..."}',
    '',
    '- summary: resumo da marca em 2 a 4 frases.',
    '- communication: posicionamento, tom de voz e personalidade recomendados.',
    '- contentStrategy: temas/pilares de conteúdo recomendados, coerentes com os objetivos escolhidos.',
    '- visualIdentity: direção visual recomendada, considerando as cores informadas (se houver) e o segmento.',
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
    xray ? `Comunicação recomendada: ${xray.communication?.text || ''}` : '',
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
    '- Se o texto tiver uma lista de produtos/pratos com preço (cardápio, catálogo), preencha "offers" com cada item encontrado. Caso contrário, devolva "offers": [].',
    '- Preços devem vir exatamente como aparecem no texto (ex: "R$ 49,90"), sem recalcular ou arredondar.',
    '',
    'Responda APENAS com um JSON válido neste formato exato, sem markdown e sem texto fora do JSON:',
    '{"brandName":"","segment":"","productsOrServices":"","description":"","serviceRegion":"","mainDifferential":"","offers":[{"name":"","price":"","items":""}]}',
  ].join('\n');

  const raw = await callHermesChatText(prompt, 'OPENSQUAD_SITE_ANALYZE_TIMEOUT_MS');
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
  if (['instagram_feed', 'instagram_story', 'instagram_reels', 'facebook_feed', 'facebook_story'].includes(channel)) return 'portrait';
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

// OpenAI images through the user's own ChatGPT/Codex login (OAuth), not the
// pay-per-token OPENAI_API_KEY path — this is what stays usable when the
// API billing account is capped but the ChatGPT/Codex subscription itself
// is fine. Routes through Hermes' openai-codex image_gen plugin, which talks
// to chatgpt.com/backend-api/codex (gpt-image-2) instead of api.openai.com.
// That plugin lives outside Hermes' normal package layout (a discovered
// plugin file, not an importable module path), so it's loaded via
// importlib.util.spec_from_file_location rather than a plain `import`.
async function generateAiImageWithCodex({ content, projectId, targetDir, note, attempt = 1, maxAttempts = 1, reviewFeedback = '', rescueMode = false }) {
  const prompt = buildAiImageGenerationPrompt({ content, note, attempt, maxAttempts, reviewFeedback, rescueMode });
  const aspectRatio = nousFalAspectRatioForChannel(content?.channel);
  const { hermesHome, pythonBin } = resolveHermesPython();

  // Unlike Nous/FAL's single-reference edit endpoints, Codex's Responses API
  // accepts up to 16 input_image parts in one call, so there's no tradeoff
  // between "attach the logo" and "attach the product photo" here — send
  // both. The real logo goes first (identity matters most and some models
  // weight earlier reference images more heavily); product photos follow.
  const imageReferences = Array.isArray(content.image?.references)
    ? content.image.references.filter((reference) => reference.absolutePath && String(reference.mimeType || '').startsWith('image/'))
    : [];
  const referencePaths = [
    ...imageReferences.filter((reference) => reference.role === 'brand_asset').slice(0, 1),
    ...imageReferences.filter((reference) => reference.role === 'product_photo').slice(0, 2),
  ].map((reference) => reference.absolutePath);

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
      `result = provider.generate(prompt=prompt_text, aspect_ratio=${JSON.stringify(aspectRatio)}, reference_image_urls=reference_paths)`,
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

const EXTENDED_BACKGROUND_BLUR_RADIUS = 48;

export async function cropOpenAiImageToChannel(sourceBuffer, targetDimensions) {
  const width = Number(targetDimensions?.width) || 0;
  const height = Number(targetDimensions?.height) || 0;
  if (!width || !height) return sourceBuffer;
  const source = await Jimp.read(sourceBuffer);

  const backdrop = source.clone().cover({ w: width, h: height }).blur(EXTENDED_BACKGROUND_BLUR_RADIUS);

  const foreground = source.clone();
  foreground.background = 0x00000000;
  foreground.contain({ w: width, h: height });

  return backdrop.composite(foreground, 0, 0).getBuffer('image/png');
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
  const references = Array.isArray(project.brand?.references) ? project.brand.references : [];
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

export function buildAiImageReviewPrompt({ content, project, note } = {}) {
  const expected = content?.contentTopic || {};
  return [
    'Você é o Agente Revisor de Criativo da Central de Conteúdo Opensquad.',
    'Analise visualmente a imagem final abaixo antes de qualquer aprovação/publicação.',
    `Imagem: ${content?.image?.url || ''}`,
    '',
    'Dados obrigatórios do card:',
    `Projeto: ${project?.name || ''}`,
    `Canal: ${content?.formatLabel || content?.channel || ''}`,
    `Título/oferta autorizada: ${expected.offerName || 'não definido'}`,
    `Preço autorizado: ${expected.price || 'não definido'}`,
    `Itens autorizados: ${expected.items || 'não definidos'}`,
    `CTA autorizado: ${chooseCreativeCta(expected, content?.channel) || 'nenhum — post de conteúdo, não deve ter botão/selo de CTA na arte'}`,
    note ? `Observação do usuário: ${note}` : '',
    '',
    'Bloqueie com status "blocked" se encontrar qualquer um destes problemas:',
    '- texto principal, preço, logo ou CTA cortado nas bordas;',
    '- preço diferente do preço autorizado;',
    '- oferta extra não pertencente ao assunto atual, como rodízio em card de combo ou combo em card de rodízio;',
    '- texto embaralhado, ilegível ou com palavra importante faltando;',
    '- formato visual claramente incompatível com o canal solicitado.',
    '- se Story/Reels parecer quadrado ou 1:1, mesmo dentro de prévia vertical;',
    '- se Story/Reels tiver massa visual concentrada apenas no centro, pouco uso da área superior e inferior ou aparência de card 1:1 dentro de 9:16;',
    '- preço em box/moldura grande demais, simples demais, desalinhado ou cobrindo o produto principal;',
    '- se o selo de preço cobrir mais destaque que o produto, esconder parte importante do produto ou ficar dominante demais no centro;',
    '- se a oferta disser esfiha e imagem parecer pizza, mini pizza genérica, fatia de pizza ou produto ambíguo;',
    '- se a oferta disser combo e imagem mostrar item único sem leitura clara de combo;',
    '',
    'Para Story/Reels, aprove somente se a peça parecer nativa de Story vertical: topo, centro e base usados com hierarquia clara, sem flyer quadrado centralizado.',
    'Para ofertas de esfiha, aprove somente se o produto for claramente reconhecível como esfiha aberta e coerente com o combo.',
    '',
    'Retorne somente JSON válido neste formato:',
    '{"status":"ok|warning|blocked","summary":"resumo curto","checks":["..."],"warnings":["..."],"errors":["..."]}',
  ].filter(Boolean).join('\n');
}

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
// own fallback (keep a draft, skip a stage, etc.).
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

// Real "webResearcher" injected into researchOnlineVisualTrends() — pulls
// current visual/ad trends for the project's segment using Hermes' own
// web search & scraping toolset (already enabled by default on this
// machine), so the image prompt gets real "what's working right now"
// context instead of a generic guess. Findings are explicitly scoped to
// visual PATTERNS (color, composition, typography), never a specific
// competitor's brand/logo/copy, so they stay inspiration rather than
// something the creative reviewer would need to police as copying.
async function researchOnlineVisualTrendsWithHermes({ segment, productsOrServices }) {
  const prompt = buildOnlineVisualResearchPrompt({ segment, productsOrServices });
  const { stdout } = await execFileAsync('hermes', [
    'chat',
    '-q',
    prompt,
    '-Q',
    '-t', 'web',
    '--provider', process.env.OPENSQUAD_HERMES_PROVIDER || 'openai-codex',
    '-m', process.env.OPENSQUAD_HERMES_MODEL || 'gpt-5.5',
    '--ignore-rules',
    '--source', 'tool',
    '--max-turns', '8',
  ], {
    timeout: Number(process.env.OPENSQUAD_RESEARCH_TIMEOUT_MS || 180000),
    maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  return String(stdout || '').trim();
}

function buildOnlineVisualResearchPrompt({ segment, productsOrServices }) {
  return [
    'Pesquise na internet agora (use busca e navegação real, não invente) tendências visuais atuais de anúncios/posts para o segmento abaixo.',
    '',
    `Segmento: ${segment || 'não informado'}`,
    `Produtos/serviços: ${productsOrServices || 'não informado'}`,
    '',
    'Procure por anúncios ativos de concorrentes/negócios parecidos (ex: Biblioteca de Anúncios da Meta) e posts de contas de referência do mesmo nicho, olhando o que está sendo usado agora em termos de cor, composição, tipografia e estilo de imagem.',
    '',
    'IMPORTANTE: isso é só inspiração de padrão visual, nunca cópia. Não descreva nem cite marca, logo, texto ou preço específico de nenhum concorrente — resuma só o PADRÃO (ex: "fundo escuro com foto do produto centralizada e preço em selo circular colorido").',
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
async function writeAiCaptionWithHermes({ content, project, note }) {
  const draft = await callHermesChatText(
    buildSofiaSocialCaptionPrompt({ content, project, note }),
    'OPENSQUAD_COPY_TIMEOUT_MS'
  );
  if (!draft) return null;

  const optimized = await callHermesChatText(
    buildDanteOptimizerPrompt({ content, project, draft }),
    'OPENSQUAD_COPY_OPTIMIZE_TIMEOUT_MS'
  );
  return optimized || draft;
}

function buildSofiaSocialCaptionPrompt({ content, project, note }) {
  const topic = content.contentTopic || {};
  const subject = topic.offerName || topic.objective || topic.label || 'este post';
  return [
    // Persona adapted from squads/conteudo-multicanal/agents/social-copywriter.custom.md
    // ("Sofia Social — Copywriter Social"): same identity/responsibilities,
    // without the squad's file-output conventions (output/social-posts.md
    // etc.) which don't apply to Content Central's own data model.
    'Você é Sofia Social, copywriter especialista em posts, legendas e conteúdo social para redes como Instagram.',
    'Você escreve com clareza, utilidade e cria CTAs adequados ao objetivo de cada post, adaptando a linguagem ao canal.',
    'Escreva a legenda FINAL deste post — não é rascunho, é o texto que vai direto pro Instagram.',
    '',
    'EMPRESA',
    `- Nome: ${project.name}`,
    `- Segmento: ${project.brandInput?.segment || project.companyProfile?.segment || 'não informado'}`,
    `- Direção de tom aprovada: ${topic.objective || 'tom comercial, próximo e confiável, coerente com o segmento.'}`,
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

function buildDanteOptimizerPrompt({ content, project, draft }) {
  const topic = content.contentTopic || {};
  return [
    // Persona adapted from squads/conteudo-multicanal/agents/direct-response-content-optimizer.custom.md
    // ("Dante Conteúdo — Otimizador Direct Response"): same identity, 10-point
    // method and safety rules, without the squad's project-specific mentions
    // (a fixed price/guarantee from a different client) and file-output
    // conventions, neither of which apply here.
    'Você é Dante Conteúdo, especialista em transformar conteúdo social em conteúdo com intenção comercial clara, sem perder naturalidade e sem deixar "vendedor demais".',
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
    '',
    'Responda APENAS com o texto final da legenda otimizada — sem aspas, sem markdown, sem explicação, sem mostrar a análise ou o score.',
  ].filter(Boolean).join('\n');
}

const META_PUBLISH_SCRIPT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'squads', 'conteudo-multicanal', 'tools', 'meta-publish-multi.js');
const PUBLISHABLE_CHANNELS = new Set(['instagram_feed', 'instagram_story', 'instagram_reels', 'facebook_feed', 'facebook_story']);
const VIDEO_CHANNELS = new Set(['instagram_reels']);
const FACEBOOK_CHANNELS = new Set(['facebook_feed', 'facebook_story']);

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
      const mediaUrl = isVideoChannel
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

function startPublishScheduler(targetDir) {
  if (process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING !== 'true') return null;
  const intervalMs = Number(process.env.OPENSQUAD_PUBLISH_CHECK_INTERVAL_MS || 180000);
  const sweep = () => runDuePublishSweep(targetDir, {
    metaPublisher: (payload) => publishContentToInstagram(payload, targetDir),
  }).catch((err) => console.error('[content-central] publish sweep failed:', err.message));
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

function renderBriefingGroupCard(group) {
  const leader = group.leader;
  const src = briefingImageSource(leader);
  const preview = src
    ? `<div class="briefing-preview channel-${escapeHtml(leader.channel || 'instagram_feed')}"><img src="${escapeHtml(src)}" alt="Prévia do card"></div>`
    : '<div class="briefing-preview empty">Sem imagem de prévia</div>';
  const channelTags = group.members.map((member) => `<span class="pill">${escapeHtml(member.formatLabel || member.channel)}</span>`).join('');
  const approveLabel = group.members.length > 1 ? `Aprovar estes ${group.members.length} formatos` : 'Aprovar este card';
  const approvalPayload = group.members.map((member) => ({ contentId: member.contentId, batchId: member.batchId }));
  return `<div class="briefing-card">
      ${preview}
      <div class="briefing-body">
        <div class="briefing-meta"><span class="pill">Dia ${escapeHtml(leader.dayNumber)} · ${escapeHtml(leader.scheduledDate)} ${escapeHtml(leader.scheduledTime || '')}</span>${channelTags}</div>
        <div class="briefing-caption">${escapeHtml(leader.caption?.text || 'Sem legenda')}</div>
        <button class="briefing-approve" data-items='${escapeHtml(JSON.stringify(approvalPayload))}' onclick="approveBriefingCard(this)">${escapeHtml(approveLabel)}</button>
      </div>
    </div>`;
}

function renderBriefingSection(title, groups) {
  if (!groups.length) return '';
  return `<section class="briefing-section">
    <h2 class="briefing-section-title">${escapeHtml(title)}</h2>
    <div class="briefing-section-list">${groups.map(renderBriefingGroupCard).join('')}</div>
  </section>`;
}

function renderBriefingPage(project, items) {
  const groups = groupBriefingItems(items);
  const storyGroups = groups.filter((group) => creativeShapeGroupForChannel(group.leader.channel) !== 'feed');
  const feedGroups = groups.filter((group) => creativeShapeGroupForChannel(group.leader.channel) === 'feed');
  const sections = `${renderBriefingSection('Stories, Reels e Facebook Story', storyGroups)}${renderBriefingSection('Feed e Facebook Feed', feedGroups)}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Briefing de aprovação — ${escapeHtml(project.name)}</title>
<style>
:root{color-scheme:dark;--bg:#050508;--accent:#8b6bff;--accent-2:#ff5fb8;--accent-gradient:linear-gradient(135deg,var(--accent) 0%,#c15fff 48%,var(--accent-2) 100%);--line:rgba(255,255,255,.09);--soft:#d6d4e0;--muted:#94939f;--text:#f8f7fb}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;line-height:1.55;padding:28px 20px 60px}
header{max-width:920px;margin:0 auto 26px}
header h1{margin:0 0 8px;font-size:clamp(24px,3vw,32px);letter-spacing:-.03em}
header p{margin:0;color:var(--muted)}
.wrap{max-width:920px;margin:0 auto;display:grid;gap:28px}
.briefing-section-title{margin:0 0 14px;font-size:18px;letter-spacing:-.02em;color:var(--soft)}
.briefing-section-list{display:grid;gap:20px}
.briefing-card{display:grid;grid-template-columns:minmax(180px,260px) minmax(0,1fr);gap:18px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.03);padding:16px;transition:opacity .3s ease}
.briefing-preview{border-radius:16px;overflow:hidden;background:#000;display:grid;place-items:center;min-height:200px;color:var(--muted)}
.briefing-preview img{width:100%;height:100%;object-fit:cover;display:block}
.briefing-preview.channel-instagram_story,.briefing-preview.channel-instagram_reels,.briefing-preview.channel-facebook_story{aspect-ratio:9/16}
.briefing-preview.channel-instagram_feed,.briefing-preview.channel-facebook_feed{aspect-ratio:4/5}
.briefing-preview.empty{padding:16px;text-align:center}
.briefing-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.pill{border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;color:var(--soft)}
.briefing-caption{white-space:pre-wrap;background:rgba(0,0,0,.24);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:14px;color:var(--soft)}
.briefing-approve{min-height:42px;border:none;border-radius:12px;background:var(--accent-gradient);color:#fff;font-weight:750;padding:0 16px;cursor:pointer}
.briefing-approve:disabled{opacity:.55;cursor:default}
.empty-state{max-width:920px;margin:60px auto;text-align:center;color:var(--muted)}
.download-pdf{min-height:42px;border:1px solid var(--line);border-radius:12px;background:transparent;color:var(--text);font-weight:700;padding:0 16px;cursor:pointer;margin-top:12px}
.download-pdf:hover{border-color:var(--accent)}
@media(max-width:640px){.briefing-card{grid-template-columns:1fr}}
@media print{
  body{background:#fff;color:#111;padding:0}
  body::before,body::after{display:none}
  .briefing-approve,.download-pdf{display:none}
  .briefing-card{border-color:#ddd;background:#fff;break-inside:avoid;page-break-inside:avoid}
  .briefing-preview{background:#f4f4f4}
  .pill{border-color:#ccc;color:#333}
  .briefing-caption{background:#f7f7f7;border-color:#eee;color:#111}
  .briefing-section-title{color:#111}
  header p{color:#555}
}
</style>
</head>
<body>
<header>
  <h1>Briefing de aprovação — ${escapeHtml(project.name)}</h1>
  <p>${escapeHtml(project.instagram?.handle || '')} · revise cada card abaixo e aprove o que estiver pronto para publicar.</p>
  <button class="download-pdf" onclick="window.print()">Baixar em PDF</button>
</header>
<div class="wrap">
${items.length ? sections : '<div class="empty-state"><b>Nenhum card aguardando aprovação agora.</b><br>Prepare a aprovação de um card na Central de Conteúdo para ele aparecer aqui.</div>'}
</div>
<script>
async function approveBriefingCard(btn){
  var items = JSON.parse(btn.dataset.items);
  btn.disabled = true;
  btn.textContent = 'Aprovando...';
  try {
    for (var i = 0; i < items.length; i++) {
      var res = await fetch('/api/projects/${escapeHtml(project.projectId)}/content/' + items[i].contentId + '/approve', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ batchId: items[i].batchId }) });
      if (!res.ok) throw new Error('Falha ao aprovar');
    }
    btn.closest('.briefing-card').style.opacity = '0.4';
    btn.textContent = 'Aprovado ✓';
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Erro — tentar de novo';
  }
}
</script>
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
      <div class="notice"><b>Fluxo simples:</b><br><span class="muted">Você informa só o básico. A IA organiza, sugere a comunicação e monta o Raio-X da marca para usar na criação de posts.</span></div>
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
      <button id="analyzeBrandButton" class="action-primary full-width" style="margin-top:14px" onclick="analyzeBrandXray()">Analisar minha marca</button>
      <h3 class="section-heading">Raio-X da marca</h3>
      <div id="brandXrayBlocks" class="reference-gallery muted">Preencha as informações, escolha objetivos e clique em “Analisar minha marca”.</div>
      <div class="button-row" style="margin-top:12px"><button class="action-primary" onclick="approveBrandXray()">Usar este Raio-X</button></div>
      <details class="field-card" style="margin-top:14px"><summary>Configurações avançadas</summary><p class="muted">O briefing antigo continua compatível por baixo para projetos já criados, mas não aparece no fluxo principal.</p></details>
    </section>
    <section id="tab-references" class="card tab-panel">
      <div class="section-title"><h2>Painel de referências</h2><span class="step">visual</span></div>
      <p class="muted">Referência não deve disputar com o Raio-X. Separe ativos oficiais, fotos reais/produtos e inspirações visuais. O prompt aplica uma regra automática para cada categoria.</p>
      <div class="grid" style="margin-bottom:14px"><div class="notice"><b>Ativos oficiais da marca</b><br><span class="muted">Logo, mascote, cardápio, embalagem e identidade oficial. Preservar exatamente como enviado.</span></div><div class="notice"><b>Fotos reais e produtos</b><br><span class="muted">Pizza, prato, ambiente, equipe ou embalagem real. Preservar aparência real, sem trocar produto.</span></div><div class="notice"><b>Inspirações visuais</b><br><span class="muted">Flyer, layout, fotografia, composição ou paleta. Usar só como inspiração; não copiar marcas, textos ou preços.</span></div></div>
      <div class="grid">
        <div class="field-card">
          <h3>Ativo oficial principal</h3>
          <label>Arquivo de logo</label><input type="file" id="logoFile" accept="image/*">
          <button class="secondary full-width" style="margin-top:8px" onclick="uploadLogo()">Enviar logo</button>
          <div class="guide-box" style="margin-top:12px"><b>Regra automática:</b><br><span class="muted">Usar exatamente como foi enviado. Não redesenhar, reinterpretar, alterar cores, trocar textos ou criar versão parecida.</span></div>
        </div>
        <div class="field-card">
          <h3>Direção visual consolidada</h3>
          <label>Resumo visual gerado/aprovado</label><textarea id="visualStyle" placeholder="Depois de aprovar o briefing, este campo recebe um resumo consolidado. Você pode editar, mas não precisa escrever do zero."></textarea>
          <details class="field-card" style="margin-top:10px"><summary>Configurações avançadas</summary><label>Regras técnicas extras para o ChatGPT</label><textarea id="imageRules" placeholder="Use só quando necessário. Ex: texto curto, área segura, não inventar preço."></textarea></details>
          <button class="secondary full-width" style="margin-top:8px" onclick="saveImageRules()">Salvar direção visual consolidada</button>
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
          <label>Tipo de publicação</label><select id="offerType"><option value="combo">Combo / promoção</option><option value="rodizio">Rodízio</option><option value="delivery">Delivery</option><option value="offer">Oferta direta</option><option value="product">Produto destaque</option><option value="orientation">Post de orientação</option><option value="desire">Post de desejo</option><option value="urgency">Urgência / hoje tem</option><option value="institutional">Institucional</option><option value="social_proof">Prova social</option></select>
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
function sourceLabel(source){return{ai_suggestion:'sugestão da IA',user_input:'informado pelo usuário',logo_identity:'extraído da logo'}[source]||source}
function renderProjectReadiness(p){const box=$('projectReadiness');if(!box)return;const input=p?.brandInput||{};const basicsOk=Boolean(input.brandName&&input.segment&&input.productsOrServices);const logoOk=Boolean(p?.brandIdentity?.logoPath);const goalsOk=Boolean((input.contentGoals||[]).length);const xrayOk=p?.brandXray?.status==='approved';const offersOk=Boolean((p?.contentStrategy?.offers||[]).filter(offer=>offer.active!==false).length);const referencesOk=Boolean((p?.brand?.references||[]).length);const items=[['Informações básicas preenchidas',basicsOk],['Logo enviada',logoOk],['Objetivos do conteúdo escolhidos',goalsOk],[xrayOk?'Raio-X aprovado':'Raio-X ainda não usado',xrayOk],['Ofertas cadastradas',offersOk],['Referências cadastradas',referencesOk]];box.classList.remove('muted');box.innerHTML='<b>Projeto: '+esc(p?.name||'')+'</b><br>'+items.map(([label,ok])=>(ok?'✅':'⚠️')+' '+esc(label)).join('<br>')}
function autoGrowTextareas(root=document){root.querySelectorAll('textarea[data-xray-block]').forEach(area=>{area.style.height='auto';area.style.height=Math.max(220,area.scrollHeight+2)+'px';area.oninput=()=>{area.style.height='auto';area.style.height=Math.max(220,area.scrollHeight+2)+'px'}})}
function renderBrandXray(p){const box=$('brandXrayBlocks');if(!box)return;const xray=p?.brandXray||{};const blocks=xray.blocks||{};const ids=['summary','communication','contentStrategy','visualIdentity'];const labels={summary:'Resumo da marca',communication:'Comunicação recomendada',contentStrategy:'Estratégia de conteúdo',visualIdentity:'Identidade visual'};const hasBlocks=Object.keys(blocks).length;box.classList.toggle('muted',!hasBlocks);box.classList.toggle('brand-xray-grid',hasBlocks);box.innerHTML=hasBlocks?'<div class="brand-xray-intro"><b>Revise os 4 blocos do Raio-X.</b><br><span class="muted">Agora o texto aparece maior, em duas colunas, sem cards espremidos. Edite direto no campo se quiser e depois clique em “Usar este Raio-X”.</span></div>':'Preencha as informações, escolha objetivos e clique em “Analisar minha marca”.';ids.forEach(id=>{const block=blocks[id];if(!block)return;const sources=Array.isArray(block.sources)&&block.sources.length?block.sources:[block.source||'ai_suggestion'];const card=document.createElement('div');card.className='reference-card brand-xray-card';card.innerHTML='<div class="reference-body"><div class="reference-name">'+esc(labels[id]||block.label||id)+'</div><div class="reference-meta"><span class="pill">'+esc(block.status||xray.status||'gerado')+'</span>'+sources.map(source=>'<span class="pill">'+esc(sourceLabel(source))+'</span>').join('')+'</div><textarea aria-label="'+esc(labels[id]||block.label||id)+'" data-xray-block="'+esc(id)+'">'+esc(block.text||'')+'</textarea><div class="brand-xray-source-note">Dica: mantenha fatos confirmados separados de sugestões da IA. Não transforme sugestão em promessa.</div></div>';box.appendChild(card)});autoGrowTextareas(box)}
async function selectProject(id){selectedProjectId=id;const p=state.projects.find(x=>x.projectId===id);if(!p)return;$('metricSelected').textContent=p.name.split(' ')[0]||p.projectId;$('tokenHandle').value=p.instagram.handle||'';$('visualStyle').value=p.brand?.visualStyle||'';$('imageRules').value=(p.brand?.imageRules||[]).join('\\n');fillBrandInput(p);renderBrandXray(p);renderProjectReadiness(p);$('selected').innerHTML='<b>'+esc(p.name)+'</b><br>Conta: '+esc(p.instagram.handle)+'<br>Modo: '+esc(p.mode)+'<br>Segmento: '+esc(p.brandInput?.segment||p.companyProfile?.segment||'Raio-X não preenchido')+'<br>Raio-X: '+esc(p.brandXray?.status||'empty')+'<br>Token: '+(p.token.configured?esc(p.token.masked)+' · '+p.token.daysRemaining+' dias':'não cadastrado')+'<br><span class="muted">Pasta local: _opensquad/content-central/projects/'+esc(p.projectId)+'</span>';renderReferences(p);renderOffers(p);renderNextTestTopic(p);renderProjects();const activeOfferCount=(p.contentStrategy?.offers||[]).filter(offer=>offer.active!==false).length;const offersWarningBox=$('noOffersWarning');if(offersWarningBox)offersWarningBox.style.display=activeOfferCount?'none':'block';await loadContent()}
function referenceRoleLabel(role){return{brand_asset:'Ativo oficial/logo',product_photo:'Foto real do produto',layout_model:'Modelo visual que gostei',text_parameter:'Exemplo de texto/oferta',visual_reference:'Inspiração visual'}[role]||'Inspiração visual'}
function referenceCategoryLabel(category){return{official_asset:'Ativos oficiais da marca',real_product:'Fotos reais e produtos',visual_inspiration:'Inspirações visuais'}[category]||'Inspirações visuais'}
function referenceAutomaticRule(category){return{official_asset:'Preservar exatamente o ativo enviado. Não redesenhar, reinterpretar, alterar textos, cores ou proporções importantes.',real_product:'Preservar a aparência real. É permitido recortar, ajustar iluminação e integrar à composição, mas não substituir por outro produto.',visual_inspiration:'Utilizar apenas como inspiração visual. Não copiar logos, nomes, textos, preços, produtos ou elementos exclusivos da referência.'}[category]||'Utilizar apenas como inspiração visual. Não copiar informações factuais da referência.'}
function referenceRoleLabels(ref){const roles=Array.isArray(ref.usageRoles)&&ref.usageRoles.length?ref.usageRoles:[ref.role];return roles.map(referenceRoleLabel).join(', ')}
function offerTypeLabel(type){return{offer:'Oferta direta',combo:'Combo / promoção',rodizio:'Rodízio',delivery:'Delivery',product:'Produto destaque',orientation:'Post de orientação',desire:'Post de desejo',urgency:'Urgência / hoje tem',institutional:'Institucional',social_proof:'Prova social'}[type]||'Oferta direta'}
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
async function approveBrandXray(){if(!selectedProjectId)return toast('Selecione um projeto',true);try{await api('/api/projects/'+selectedProjectId+'/brand-xray/approve',{method:'POST',body:JSON.stringify({edits:xrayEdits()})});toast('Raio-X aprovado e pronto para gerar conteúdos');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function saveToken(){if(!selectedProjectId)return toast('Selecione um projeto',true);try{const res=await api('/api/projects/'+selectedProjectId+'/token',{method:'POST',body:JSON.stringify({token:$('token').value,handle:$('tokenHandle').value})});$('token').value='';toast('Token validado e salvo: '+(res.project.token.daysRemaining??'?')+' dias restantes');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
function selectedReferenceUsageRoles(){const roles=selectedCheckboxValues('referenceUsageRoles');return roles.length?roles:['visual_reference']}
function roleForCategory(category,usageRoles){if(category==='official_asset')return'brand_asset';if(category==='real_product')return'product_photo';return usageRoles[0]||'visual_reference'}
async function uploadAsset(kind,file){if(!selectedProjectId)return toast('Selecione um projeto',true);const dataUrl=await fileToDataUrl(file);const usageRoles=selectedReferenceUsageRoles();const category=$('referenceCategory')?.value||'visual_inspiration';return api('/api/projects/'+selectedProjectId+'/assets',{method:'POST',body:JSON.stringify({kind,filename:file.name,dataUrl,role:roleForCategory(category,usageRoles),usageRoles,referenceCategory:kind==='logo'?'official_asset':category,useInNextGeneration:$('referenceUseInNextGeneration')?.checked!==false,weight:$('referenceWeight')?.value,instruction:$('referenceInstruction')?.value})})}
async function uploadLogo(){const file=$('logoFile').files[0];if(!file)return toast('Escolha um arquivo de logo',true);try{await uploadAsset('logo',file);$('logoFile').value='';toast('Logo enviado');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function uploadBrandLogo(){const file=$('brandLogoFile').files[0];if(!file)return toast('Escolha um arquivo de logo',true);try{if(!selectedProjectId)return toast('Selecione um projeto',true);const dataUrl=await fileToDataUrl(file);await api('/api/projects/'+selectedProjectId+'/assets',{method:'POST',body:JSON.stringify({kind:'logo',filename:file.name,dataUrl,role:'brand_asset',usageRoles:['brand_asset'],referenceCategory:'official_asset',useInNextGeneration:true,instruction:'Logo oficial da marca. Preservar exatamente como enviado.'})});$('brandLogoFile').value='';toast('Logo enviado');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function uploadReferences(){const files=[...$('referenceFile').files];if(!files.length)return toast('Escolha pelo menos uma referência',true);try{for(const file of files)await uploadAsset('reference',file);$('referenceFile').value='';$('referenceInstruction').value='';toast(files.length+' referência(s) enviada(s)');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function deleteReference(relativePath){if(!selectedProjectId)return toast('Selecione um projeto',true);if(!confirm('Apagar esta referência do projeto?'))return;try{await api('/api/projects/'+selectedProjectId+'/references-delete',{method:'POST',body:JSON.stringify({relativePath})});if(editingReferencePath===relativePath)editingReferencePath=null;toast('Referência apagada');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
async function saveImageRules(){if(!selectedProjectId)return toast('Selecione um projeto',true);try{await api('/api/projects/'+selectedProjectId+'/image-rules',{method:'POST',body:JSON.stringify({visualStyle:$('visualStyle').value,imageRules:$('imageRules').value})});toast('Regras de imagem salvas');await load();await selectProject(selectedProjectId)}catch(e){toast(e.message,true)}}
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
