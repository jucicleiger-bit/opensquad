import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { Jimp, intToRGBA } from 'jimp';

const DAY_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_MODES = new Set(['manual', 'semi_automatic', 'automatic']);
// Orthogonal to `mode` (approval workflow): `projectType` decides the
// content-generation strategy itself. 'marketing' is today's Raio-X +
// pilares + AI-art flow; 'catalog' is a direct-sale product feed (real
// photo + price, no brand voice, no AI art) — see generateCatalogSchedulePlan.
const SUPPORTED_PROJECT_TYPES = new Set(['marketing', 'catalog']);
const DEFAULT_CHANNEL = 'instagram_feed';
const DEFAULT_TIME = '09:00';
const CHANNEL_LABELS = {
  instagram_feed: 'Instagram Feed',
  instagram_story: 'Instagram Stories',
  instagram_reels: 'Instagram Reels',
  facebook_feed: 'Facebook Feed',
  facebook_story: 'Facebook Story',
};

export const OFFER_TYPES = new Set([
  'offer',
  'combo',
  'rodizio',
  'delivery',
  'product',
  'orientation',
  'desire',
  'urgency',
  'institutional',
  'social_proof',
]);

const PILLAR_ROLES = new Set(['ensina', 'prova', 'posiciona', 'convida']);
const PILLAR_VISUAL_TREATMENTS = new Set(['cru', 'leve', 'desenhado']);
const DEFAULT_PILLAR_COLOR = '#7C7C7C';

// Global, project-agnostic fallback so an offer/goal that hasn't been tagged
// with an explicit pillarId still lands on a sensible pillar role — keeps
// pillars fully opt-in (no pillar configured => no effect anywhere).
const OFFER_TYPE_TO_PILLAR_ROLE = {
  offer: 'convida',
  combo: 'convida',
  rodizio: 'convida',
  delivery: 'convida',
  product: 'convida',
  social_proof: 'prova',
  institutional: 'ensina',
  orientation: 'ensina',
  desire: 'posiciona',
  urgency: 'posiciona',
};

const GOAL_TYPE_TO_PILLAR_ROLE = {
  authority: 'ensina',
  education: 'ensina',
  relationship: 'prova',
  social_proof: 'prova',
  engagement: 'posiciona',
  brand_awareness: 'posiciona',
  show_products: 'convida',
  events: 'convida',
};

const REFERENCE_ROLES = ['layout_model', 'product_photo', 'brand_asset', 'text_parameter', 'visual_reference'];

const REFERENCE_CATEGORIES = new Set(['official_asset', 'real_product', 'visual_inspiration']);

const BRAND_BRIEFING_BLOCKS = [
  ['summary', 'Resumo da empresa'],
  ['positioning', 'Posicionamento sugerido'],
  ['audience', 'Público-alvo sugerido'],
  ['tone', 'Tom de voz sugerido'],
  ['personality', 'Personalidade da marca'],
  ['contentPillars', 'Pilares de conteúdo'],
  ['visualDirection', 'Direção visual'],
  ['differentiators', 'Diferenciais percebidos'],
  ['avoid', 'O que evitar'],
  ['missingInfo', 'Informações que ainda estão faltando'],
];

const BRAND_XRAY_BLOCKS = [
  ['summary', 'Resumo da marca'],
  ['communication', 'Comunicação recomendada'],
  ['contentStrategy', 'Estratégia de conteúdo'],
  ['visualIdentity', 'Identidade visual'],
];

const CONTENT_GOAL_LABELS = {
  sell_products: 'Vender produtos',
  sell_services: 'Vender serviços',
  promotions: 'Divulgar promoções',
  whatsapp_orders: 'Receber pedidos no WhatsApp',
  leads: 'Gerar leads',
  authority: 'Gerar autoridade',
  brand_awareness: 'Aumentar reconhecimento da marca',
  relationship: 'Criar relacionamento',
  engagement: 'Aumentar engajamento',
  events: 'Divulgar eventos',
  show_products: 'Mostrar produtos',
  education: 'Educar o público',
};

const CONTENT_GOAL_OPTIONS = new Set(Object.keys(CONTENT_GOAL_LABELS));

const AUDIENCE_TYPE_LABELS = {
  b2b: 'B2B — vende para empresas/revendedores (atacado, distribuição, fornecimento)',
  b2c: 'B2C — vende direto para o consumidor final',
};

function normalizeAudienceType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized in AUDIENCE_TYPE_LABELS ? normalized : '';
}

function audienceTypeLabel(value) {
  return AUDIENCE_TYPE_LABELS[normalizeAudienceType(value)] || '';
}

const DEFAULT_CONTENT_TOPICS = [
  {
    id: 'desejo-produto-servico',
    type: 'desire',
    label: 'Post de desejo',
    objective: 'Gerar desejo pelo produto ou serviço principal da empresa, sem inventar preço ou promoção.',
    cta: 'Conheça ou chame a empresa hoje',
  },
  {
    id: 'chamada-comercial',
    type: 'offer',
    label: 'Chamada comercial',
    objective: 'Convidar a pessoa a dar o próximo passo com a empresa usando um CTA claro e honesto.',
    cta: 'Chame para saber mais',
  },
  {
    id: 'produto-destaque',
    type: 'product',
    label: 'Produto destaque',
    objective: 'Destacar um produto, serviço ou benefício real usando as informações e referências cadastradas.',
    cta: 'Veja os detalhes',
  },
  {
    id: 'orientacao',
    type: 'orientation',
    label: 'Post de orientação',
    objective: 'Criar conteúdo útil/leve para engajamento, sem parecer só oferta repetida.',
    cta: 'Salve ou compartilhe',
  },
  {
    id: 'urgencia-hoje',
    type: 'urgency',
    label: 'Urgência do dia',
    objective: 'Criar chamada de hoje/esta noite sem promessa falsa e sem pressão exagerada.',
    cta: 'Aproveite hoje',
  },
];

// Content goals with real sales/conversion intent (checked in the Raio-X
// form). These never spawn a standalone post of their own — doing so
// without a real registered offer would force the AI to invent a price or
// promotion. Instead, marking one of these boosts how often real offer
// topics show up in the rotation (see buildTopicPool) — the client's stated
// intent still has a real, visible effect, just channeled through actual
// offers instead of invented ones. With zero offers registered, marking
// these has no effect at all, same as before.
const PRICED_INTENT_GOALS = new Set(['sell_products', 'sell_services', 'promotions', 'whatsapp_orders', 'leads']);
// How many times the offer-topic pool repeats in the interleave when a
// priced-intent goal is marked — interleaveTopics merges proportionally by
// relative position, so a larger pool naturally lands more slots without
// needing a separate weighting mechanism.
const SALES_INTENT_BOOST = 2;

// One entry per non-priced content objective (the "Objetivos do conteúdo"
// checkboxes in the Raio-X form, saved to project.brandInput.contentGoals).
// Deliberately excludes priced-intent goals (see PRICED_INTENT_GOALS above).
// buildObjective grounds each topic in already-approved Raio-X text instead
// of generic boilerplate.
const GOAL_TOPIC_TEMPLATES = {
  authority: {
    type: 'institutional',
    label: 'Post de autoridade',
    ctaDefault: 'Fale com a gente',
    buildObjective: (project, groundingText) => `Reforçar autoridade e confiança de ${project.name} no segmento${groundingText ? `, apoiado em: ${groundingText}` : ''}, mostrando conhecimento técnico ou experiência real, sem inventar prêmios, números ou clientes que não foram informados.`,
  },
  brand_awareness: {
    type: 'institutional',
    label: 'Reconhecimento de marca',
    ctaDefault: 'Conheça mais',
    buildObjective: (project, groundingText) => `Aumentar o reconhecimento da marca ${project.name}, apresentando quem é a empresa e o que ela faz${groundingText ? `, seguindo o posicionamento: ${groundingText}` : ''}, sem oferta específica neste post.`,
  },
  relationship: {
    type: 'social_proof',
    label: 'Post de relacionamento',
    ctaDefault: 'Comente aqui',
    buildObjective: (project, groundingText) => `Criar proximidade com o público de ${project.name}, tom leve e humano${groundingText ? `, coerente com: ${groundingText}` : ''}, sem parecer oferta ou anúncio.`,
  },
  engagement: {
    type: 'orientation',
    label: 'Post de engajamento',
    ctaDefault: 'Compartilhe com quem precisa ver isso',
    buildObjective: (project) => `Criar um post leve e compartilhável para ${project.name} que gere comentários ou compartilhamentos, sem parecer oferta ou anúncio.`,
  },
  education: {
    type: 'orientation',
    label: 'Post educativo',
    ctaDefault: 'Salve esse post',
    buildObjective: (project, groundingText) => `Ensinar algo útil e real sobre o segmento de ${project.name}${groundingText ? `, dentro do posicionamento: ${groundingText}` : ''}, sem inventar dado técnico não informado.`,
  },
  show_products: {
    type: 'product',
    label: 'Produto/serviço em destaque',
    ctaDefault: 'Saiba mais',
    buildObjective: (project) => `Destacar um produto ou serviço real de ${project.name} de forma visual, sem preço obrigatório neste post.`,
  },
  events: {
    type: 'institutional',
    label: 'Divulgação de evento',
    ctaDefault: 'Participe',
    buildObjective: (project) => `Divulgar um evento ou acontecimento real de ${project.name}, sem inventar data, local ou detalhe não informado.`,
  },
};

const TEST_CREATIVE_VARIATIONS = [
  {
    concept: 'oferta direta com benefício imediato',
    composition: 'produto, serviço ou benefício principal em destaque, preço/CTA quando cadastrado e poucos elementos no fundo',
    copyAngle: 'decisão rápida, valor claro e próxima ação simples',
  },
  {
    concept: 'experiência real do cliente',
    composition: 'cena de uso com pessoas, ambiente ou contexto realista mostrando o benefício principal',
    copyAngle: 'mostrar como a empresa ajuda na prática, sem promessa exagerada',
  },
  {
    concept: 'bastidor de qualidade',
    composition: 'detalhe do processo, equipe, mãos trabalhando, ferramenta, produto ou atendimento real',
    copyAngle: 'confiança, cuidado e qualidade por trás da entrega',
  },
  {
    concept: 'comparativo de valor',
    composition: 'um único destaque de preço/benefício limpo para o assunto atual, visual premium e sem poluição',
    copyAngle: 'mostrar o custo-benefício da oferta atual sem comparar com outra promoção',
  },
  {
    concept: 'chamada de fim de semana/noite',
    composition: 'ambiente com luz marcante, produto/serviço em cena e CTA discreto',
    copyAngle: 'convite para hoje à noite ou fim de semana',
  },
  {
    concept: 'produto hero sem poluição visual',
    composition: 'um produto, serviço ou benefício principal muito claro, poucos textos e marca protegida no rodapé',
    copyAngle: 'qualidade visual premium e desejo antes de preço',
  },
];

const DEFAULT_GLOBAL_RULES = [
  {
    id: 'approval-required-semi-automatic',
    type: 'approval',
    required: true,
    text: 'Não publicar sem aprovação quando o projeto estiver em modo semi-automático.',
  },
  {
    id: 'no-false-promises',
    type: 'copy',
    required: true,
    text: 'Não prometer resultado garantido, faturamento garantido, cura ou qualquer prova que não exista.',
  },
  {
    id: 'show-project-and-account',
    type: 'publishing',
    required: true,
    text: 'Sempre mostrar projeto, canal e conta/handle antes de enviar aprovação ou publicar.',
  },
  {
    id: 'visual-review-before-email',
    type: 'visual',
    required: false,
    text: 'Criativos devem passar por revisão visual antes do e-mail de aprovação.',
  },
];

export function getCentralPaths(targetDir = process.cwd(), projectId = null) {
  const root = join(targetDir, '_opensquad', 'content-central');
  const projectsDir = join(root, 'projects');
  const secretsDir = join(root, 'secrets');
  const approvalsDir = join(root, 'approvals');
  const segmentTemplatesDir = join(root, 'segment-templates');
  const paths = {
    root,
    projectsDir,
    secretsDir,
    approvalsDir,
    segmentTemplatesDir,
    segmentLearningsPath: join(root, 'segment-learnings.json'),
    offerTypeLearningsPath: join(root, 'offer-type-learnings.json'),
    globalRulesPath: join(root, 'global-rules.json'),
  };

  if (!projectId) return paths;

  const normalized = normalizeProjectId(projectId);
  const projectDir = join(projectsDir, normalized);
  return {
    ...paths,
    projectId: normalized,
    projectDir,
    projectPath: join(projectDir, 'project.json'),
    assetsDir: join(projectDir, 'assets'),
    referencesDir: join(projectDir, 'assets', 'references'),
    memoryDir: join(projectDir, 'memory'),
    manualPath: join(projectDir, 'memory', 'manual-vivo.md'),
    contentDir: join(projectDir, 'content'),
    draftsDir: join(projectDir, 'content', 'drafts'),
    approvedDir: join(projectDir, 'content', 'approved'),
    publishedDir: join(projectDir, 'content', 'published'),
    cancelledDir: join(projectDir, 'content', 'cancelled'),
    // Ad creatives (paid traffic) are a separate concept from organic content
    // above — no scheduledDate, no approval workflow, no calendar. The
    // operator runs the actual campaign themselves in Ads Manager; this is
    // just where generated creative+copy variations live until downloaded.
    adCreativesDir: join(projectDir, 'content', 'ad-creatives'),
    tokenSecretPath: join(secretsDir, `${normalized}.token`),
  };
}

export function normalizeProjectId(input) {
  const value = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!value) throw new Error('Project id is required');
  return value;
}

export function calculateTokenDaysRemaining(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) throw new Error(`Invalid token expiry date: ${expiresAt}`);
  return Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS));
}

export async function createCentralProject(options, targetDir = process.cwd()) {
  const projectId = normalizeProjectId(options?.projectId || options?.name);
  const isProspect = Boolean(options?.isProspect);
  // A prospecção never has a real token configured anyway, but forcing
  // 'manual' here makes the "this can't auto-publish" guarantee explicit
  // instead of accidental — it's a throwaway demo project, not a client.
  const mode = isProspect ? 'manual' : (options?.mode || 'semi_automatic');
  if (!SUPPORTED_MODES.has(mode)) throw new Error(`Unsupported project mode: ${mode}`);
  const projectType = options?.projectType || 'marketing';
  if (!SUPPORTED_PROJECT_TYPES.has(projectType)) throw new Error(`Unsupported project type: ${projectType}`);

  const paths = getCentralPaths(targetDir, projectId);
  await ensureBase(paths);

  return withProjectLock(targetDir, projectId, async () => {
  const existing = await readJson(paths.projectPath, null);
  if (existing) throw new Error(`Project already exists: ${projectId}`);

  const now = new Date().toISOString();
  const project = {
    schemaVersion: 1,
    projectId,
    name: options?.name || projectId,
    status: 'active',
    mode,
    projectType,
    isProspect,
    // Real facts read off the prospect's actual Instagram profile (via
    // vision) — never fabricated, only ever what the screenshot showed.
    // Kept separate from companyProfile/brandInput because those are the
    // operator's own inputs; this is what the mockup's profile header
    // quotes verbatim (follower/post counts, bio) instead of anything the
    // AI generated.
    prospectSource: isProspect ? normalizeProspectSource(options?.prospectSource) : null,
    approvalEmail: options?.approvalEmail || '',
    timezone: options?.timezone || 'America/Sao_Paulo',
    instagram: {
      handle: normalizeHandle(options?.handle || ''),
      instagramUserId: '',
      pageId: '',
    },
    companyProfile: normalizeCompanyProfile(options?.companyProfile),
    brandInput: normalizeBrandInput(options?.brandInput || options?.companyProfile),
    brandIdentity: normalizeBrandIdentity(options?.brandIdentity),
    brandXray: normalizeBrandXray(options?.brandXray),
    brandBriefing: normalizeBrandBriefing(options?.brandBriefing),
    technicalBase: normalizeTechnicalBase(options?.technicalBase),
    brand: {
      logoPath: 'assets/logo.png',
      referencesDir: 'assets/references',
      references: [],
      voice: options?.voice || '',
      visualStyle: options?.visualStyle || '',
      imageRules: normalizeRuleList(options?.imageRules || []),
    },
    token: {
      configured: false,
      masked: null,
      expiresAt: null,
      daysRemaining: null,
      lastValidatedAt: null,
      permissions: [],
      status: 'sem_token',
    },
    contentSettings: {
      defaultDaysToGenerate: Number(options?.defaultDaysToGenerate || 7),
      defaultPostTime: options?.defaultPostTime || DEFAULT_TIME,
      channels: options?.channels || [DEFAULT_CHANNEL],
      requireEmailApproval: mode !== 'automatic',
      catalogStoriesPerDay: Math.max(1, Number(options?.catalogStoriesPerDay) || 3),
      // Standing info stamped onto every catalog composition (financing
      // terms, "entrada facilitada" etc.) — one text, shared by every
      // product, edited separately from the per-product fields.
      catalogGeneralInfo: String(options?.catalogGeneralInfo || '').trim(),
    },
    contentStrategy: {
      offers: [],
      pillars: [],
      offerGroups: [],
    },
    rules: {
      project: Array.isArray(options?.projectRules) ? options.projectRules : [],
    },
    learnings: {
      approved: [],
      avoid: [],
    },
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(paths.referencesDir, { recursive: true });
  await mkdir(paths.memoryDir, { recursive: true });
  await mkdir(paths.draftsDir, { recursive: true });
  await mkdir(paths.approvedDir, { recursive: true });
  await mkdir(paths.publishedDir, { recursive: true });
  await mkdir(paths.cancelledDir, { recursive: true });
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');

  return project;
  });
}

// Permanently removes a project: its config, generated content, assets and
// the separately-stored token secret. There is no undo — callers must get
// explicit confirmation before calling this.
export async function deleteCentralProject(projectId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await readJson(paths.projectPath, null);
  if (!project) throw new Error(`Projeto não encontrado: ${projectId}`);
  await rm(paths.projectDir, { recursive: true, force: true });
  await rm(paths.tokenSecretPath, { force: true });
  return { projectId, deleted: true };
}

export async function saveProjectToken(projectId, tokenInput, targetDir = process.cwd(), now = new Date()) {
  if (!tokenInput?.token) throw new Error('Token is required');
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const expiresAt = tokenInput.expiresAt || null;
  const daysRemaining = calculateTokenDaysRemaining(expiresAt, now);

  await mkdir(dirname(paths.tokenSecretPath), { recursive: true });
  await writeFile(paths.tokenSecretPath, tokenInput.token, 'utf-8');

  project.token = {
    configured: true,
    masked: maskSecret(tokenInput.token),
    expiresAt,
    daysRemaining,
    lastValidatedAt: now.toISOString(),
    permissions: tokenInput.permissions || [],
    // daysRemaining is null when Meta reports no expiration (a permanent
    // Page/System User token) — `null <= 10` coerces to true in JS, which
    // used to mislabel those valid, never-expiring tokens as "vence_em_breve".
    status: daysRemaining === null ? 'valido' : daysRemaining === 0 ? 'expirado' : daysRemaining <= 10 ? 'vence_em_breve' : 'valido',
  };

  if (tokenInput.account) {
    project.instagram = {
      ...project.instagram,
      handle: normalizeHandle(tokenInput.account.handle || project.instagram.handle),
      instagramUserId: tokenInput.account.instagramUserId || project.instagram.instagramUserId,
      pageId: tokenInput.account.pageId || project.instagram.pageId,
    };
  }

  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  return project;
  });
}

// Reads back the raw token saved by saveProjectToken — needed by real
// publishing (Graph API calls need the actual token value, not the masked
// display string kept on project.token.masked). Returns null when the
// project has no token configured yet.
export async function readProjectToken(projectId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  try {
    const raw = await readFile(paths.tokenSecretPath, 'utf-8');
    return raw.trim() || null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function updateProjectCompanyProfile(projectId, input = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  project.companyProfile = normalizeCompanyProfile(input);
  project.brandInput = normalizeBrandInput({ ...(project.brandInput || {}), ...companyProfileToBrandInput(project.companyProfile, project.name) });
  project.brandBriefing = normalizeBrandBriefing({
    ...(project.brandBriefing || {}),
    status: project.brandBriefing?.status === 'approved' ? 'needs_review' : project.brandBriefing?.status,
  });
  project.brandXray = normalizeBrandXray({
    ...(project.brandXray || {}),
    status: project.brandXray?.status === 'approved' ? 'needs_review' : project.brandXray?.status,
  });
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return project;
  });
}

export async function updateProjectBrandInput(projectId, input = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  project.brandInput = normalizeBrandInput(input);
  project.companyProfile = brandInputToCompanyProfile(project.brandInput, project.companyProfile);
  project.brandXray = normalizeBrandXray({
    ...(project.brandXray || {}),
    status: project.brandXray?.status === 'approved' ? 'needs_review' : project.brandXray?.status,
  });
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return project;
  });
}

export async function analyzeProjectTechnicalBase(projectId, input = {}, targetDir = process.cwd(), now = new Date(), options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const sourceText = redactSensitiveText(input?.sourceText || input?.text || '');
  if (!sourceText) throw new Error('Cole um texto técnico para a IA resumir.');

  const fallbackSummary = buildTechnicalBaseSummary(project, sourceText, now);
  let summary = fallbackSummary.summary;
  if (typeof options.technicalAnalyzer === 'function') {
    try {
      const analyzed = await options.technicalAnalyzer({ project, sourceText, fallbackSummary });
      summary = cleanText(typeof analyzed === 'string' ? analyzed : analyzed?.summary) || summary;
    } catch {
      summary = fallbackSummary.summary;
    }
  }

  project.technicalBase = normalizeTechnicalBase({
    sourceText,
    summary,
    updatedAt: now.toISOString(),
    source: typeof options.technicalAnalyzer === 'function' ? 'ai_or_template' : 'template',
  });
  project.updatedAt = now.toISOString();
  await addSegmentLearning(paths, project, 'technical', project.technicalBase.summary);
  project.segmentLearnings = await loadSegmentLearningsForProject(paths, project);
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { project, technicalBase: project.technicalBase };
  });
}

export async function analyzeProjectBrandXray(projectId, input = {}, targetDir = process.cwd(), now = new Date(), options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  // The AI analyzer call below can take several real seconds — locking only
  // around the write would leave the read-then-mutate window wide open for
  // another request to interleave and silently lose one side's change.
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  if (hasBrandInputFields(input)) {
    project.brandInput = normalizeBrandInput(input);
    project.companyProfile = brandInputToCompanyProfile(project.brandInput, project.companyProfile);
  }
  const templateXray = buildSuggestedBrandXray(project, now);
  project.brandXray = typeof options.brandAnalyzer === 'function'
    ? await mergeAiBrandXray(templateXray, project, options.brandAnalyzer)
    : templateXray;
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { project, xray: project.brandXray };
  });
}

// Best-effort: overlays AI-written block text on top of the deterministic
// template. Never blocks or throws — any analyzer failure (missing
// credentials, network error, bad JSON) silently keeps the template blocks,
// so the Raio-X flow always produces a usable result.
async function mergeAiBrandXray(templateXray, project, brandAnalyzer) {
  let aiBlocks;
  try {
    aiBlocks = await brandAnalyzer({ project });
  } catch {
    return templateXray;
  }
  if (!aiBlocks || typeof aiBlocks !== 'object') return templateXray;
  const blocks = { ...templateXray.blocks };
  for (const [id, label] of BRAND_XRAY_BLOCKS) {
    const text = cleanText(aiBlocks[id]);
    if (!text) continue;
    blocks[id] = normalizeBrandXrayBlock(id, {
      label,
      text,
      sources: [...new Set([...(templateXray.blocks[id]?.sources || []), 'ai_suggestion'])],
    });
  }
  return normalizeBrandXray({ ...templateXray, blocks, source: 'ai_analysis' });
}

export async function approveProjectBrandXray(projectId, input = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const source = Object.keys(project.brandXray?.blocks || {}).length
    ? normalizeBrandXray(project.brandXray)
    : buildSuggestedBrandXray(project, now);
  const edits = input?.edits || {};
  const blocks = {};
  for (const [id, label] of BRAND_XRAY_BLOCKS) {
    const current = source.blocks[id] || normalizeBrandXrayBlock(id, { label });
    blocks[id] = normalizeBrandXrayBlock(id, {
      ...current,
      text: edits[id] !== undefined ? edits[id] : current.text,
      status: 'approved',
      approvedAt: now.toISOString(),
    });
  }
  project.brandXray = normalizeBrandXray({
    ...source,
    status: 'approved',
    source: 'ai_suggestion',
    blocks,
    generatedAt: source.generatedAt || now.toISOString(),
    approvedAt: now.toISOString(),
  });
  project.brand = {
    ...(project.brand || {}),
    visualStyle: buildConsolidatedXrayVisualDirection(project, project.brandXray),
    imageRules: normalizeRuleList(project.brand?.imageRules || []),
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { project, xray: project.brandXray };
  });
}

export async function analyzeProjectBrandBriefing(projectId, input = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const targetBlock = String(input?.block || input?.blockId || '').trim();
  const existing = normalizeBrandBriefing(project.brandBriefing);
  const generated = buildSuggestedBrandBriefing(project, now);
  const blocks = targetBlock && generated.blocks[targetBlock]
    ? { ...existing.blocks, [targetBlock]: generated.blocks[targetBlock] }
    : generated.blocks;
  project.brandBriefing = normalizeBrandBriefing({
    ...existing,
    status: 'generated',
    source: 'ai_suggestion',
    blocks,
    generatedAt: now.toISOString(),
    approvedAt: null,
  });
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { project, briefing: project.brandBriefing };
  });
}

export async function approveProjectBrandBriefing(projectId, input = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const existing = normalizeBrandBriefing(project.brandBriefing);
  const source = Object.keys(existing.blocks).length ? existing : buildSuggestedBrandBriefing(project, now);
  const edits = input?.edits || {};
  const blocks = {};
  for (const [id, label] of BRAND_BRIEFING_BLOCKS) {
    const current = source.blocks[id] || normalizeBrandBriefingBlock(id, { label });
    blocks[id] = normalizeBrandBriefingBlock(id, {
      ...current,
      text: edits[id] !== undefined ? edits[id] : current.text,
      status: 'approved',
      approvedAt: now.toISOString(),
    });
  }
  project.brandBriefing = normalizeBrandBriefing({
    ...source,
    status: 'approved',
    blocks,
    generatedAt: source.generatedAt || now.toISOString(),
    approvedAt: now.toISOString(),
  });
  project.brand = {
    ...(project.brand || {}),
    visualStyle: buildConsolidatedVisualDirection(project, project.brandBriefing),
    imageRules: normalizeRuleList(project.brand?.imageRules || []),
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { project, briefing: project.brandBriefing };
  });
}

export async function saveProjectOffer(projectId, offerInput, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const offer = normalizeProjectOffer(offerInput, now, project.contentStrategy?.offers || []);
  const currentOffers = normalizeProjectOffers(project.contentStrategy?.offers || []);
  const byId = new Map(currentOffers.map((item) => [item.id, item]));
  byId.set(offer.id, offer);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    offers: [...byId.values()],
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { project, offer };
  });
}

export async function deleteProjectOffer(projectId, offerId, targetDir = process.cwd()) {
  const id = String(offerId || '').trim();
  if (!id) throw new Error('Oferta/assunto inválido');
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const offers = normalizeProjectOffers(project.contentStrategy?.offers || []);
  const nextOffers = offers.filter((offer) => offer.id !== id);
  if (nextOffers.length === offers.length) throw new Error(`Oferta/assunto não encontrado: ${id}`);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    offers: nextOffers,
  };
  project.updatedAt = new Date().toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { deleted: true, offerId: id, project };
  });
}

export async function saveProjectOfferGroup(projectId, groupInput, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const group = normalizeProjectOfferGroup(groupInput, now, project.contentStrategy?.offerGroups || []);
  const currentGroups = normalizeProjectOfferGroups(project.contentStrategy?.offerGroups || []);
  const byId = new Map(currentGroups.map((item) => [item.id, item]));
  byId.set(group.id, group);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    offerGroups: [...byId.values()],
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { project, group };
  });
}

// Deleting a group never touches the offers that reference it (same
// precedent as deleteProjectPillar) — an offer with a stale groupId just
// stops matching any groupIds filter at generation time until reassigned,
// it never disappears or loses its other data.
export async function deleteProjectOfferGroup(projectId, groupId, targetDir = process.cwd()) {
  const id = String(groupId || '').trim();
  if (!id) throw new Error('Grupo de ofertas inválido');
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const groups = normalizeProjectOfferGroups(project.contentStrategy?.offerGroups || []);
  const nextGroups = groups.filter((group) => group.id !== id);
  if (nextGroups.length === groups.length) throw new Error(`Grupo de ofertas não encontrado: ${id}`);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    offerGroups: nextGroups,
  };
  project.updatedAt = new Date().toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { deleted: true, groupId: id, project };
  });
}


export async function saveProjectPillar(projectId, pillarInput, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const pillar = normalizeProjectPillar(pillarInput, now, project.contentStrategy?.pillars || []);
  const currentPillars = normalizeProjectPillars(project.contentStrategy?.pillars || []);
  const byId = new Map(currentPillars.map((item) => [item.id, item]));
  byId.set(pillar.id, pillar);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    pillars: [...byId.values()],
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { project, pillar };
  });
}

export async function deleteProjectPillar(projectId, pillarId, targetDir = process.cwd()) {
  const id = String(pillarId || '').trim();
  if (!id) throw new Error('Pilar inválido');
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const pillars = normalizeProjectPillars(project.contentStrategy?.pillars || []);
  const nextPillars = pillars.filter((pillar) => pillar.id !== id);
  if (nextPillars.length === pillars.length) throw new Error(`Pilar não encontrado: ${id}`);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    pillars: nextPillars,
  };
  project.updatedAt = new Date().toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { deleted: true, pillarId: id, project };
  });
}

export async function validateMetaToken(token, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  if (!token) throw new Error('Token is required');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is required to validate token');

  const url = new URL('https://graph.facebook.com/debug_token');
  url.searchParams.set('input_token', token);
  url.searchParams.set('access_token', token);

  const response = await fetchImpl(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || 'Não foi possível validar o token Meta');
  if (body?.data?.is_valid === false) throw new Error('Token Meta inválido ou expirado');

  const expiresAt = body?.data?.expires_at
    ? new Date(body.data.expires_at * 1000).toISOString()
    : null;

  return {
    expiresAt,
    daysRemaining: calculateTokenDaysRemaining(expiresAt, now),
    permissions: Array.isArray(body?.data?.scopes) ? body.data.scopes : [],
    account: await resolveMetaInstagramAccount(token, fetchImpl),
    rawStatus: body?.data?.is_valid === true ? 'validado_meta' : 'validacao_parcial',
  };
}

// The Instagram Business Account ID is never in /debug_token's payload —
// profile_id/user_id there are the Facebook user's own identifiers, not the
// connected Instagram account. It only exists behind the Facebook Page the
// token manages, so resolving it takes two more Graph API calls: list the
// token's Pages, then read each Page's linked instagram_business_account
// until one resolves. Best-effort — if this fails (missing pages_show_list
// scope, no linked Page yet, network hiccup), saveProjectToken keeps
// whatever instagramUserId/pageId the project already had instead of wiping
// it with an empty value.
async function resolveMetaInstagramAccount(token, fetchImpl) {
  try {
    const accountsUrl = new URL('https://graph.facebook.com/v25.0/me/accounts');
    accountsUrl.searchParams.set('access_token', token);
    const accountsBody = await (await fetchImpl(accountsUrl)).json();
    const pages = Array.isArray(accountsBody?.data) ? accountsBody.data : [];

    for (const page of pages) {
      if (!page?.id) continue;
      const pageUrl = new URL(`https://graph.facebook.com/v25.0/${page.id}`);
      pageUrl.searchParams.set('fields', 'instagram_business_account');
      pageUrl.searchParams.set('access_token', token);
      const pageBody = await (await fetchImpl(pageUrl)).json();
      const instagramUserId = pageBody?.instagram_business_account?.id;
      if (instagramUserId) return { instagramUserId, pageId: page.id };
    }
  } catch {
    // fall through to the empty default below
  }
  return { instagramUserId: '', pageId: '' };
}

export async function saveProjectAsset(projectId, assetInput, targetDir = process.cwd(), now = new Date(), options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const kind = assetInput?.kind === 'logo' ? 'logo' : 'reference';
  const currentReferences = normalizeProjectReferences(project);
  const filename = sanitizeFilename(assetInput?.filename || 'reference.bin');
  const buffer = decodeDataUrl(assetInput?.dataUrl);
  const mimeType = parseDataUrlMimeType(assetInput?.dataUrl);
  const ext = extname(filename) || '.bin';
  const relativePath = kind === 'logo'
    ? `assets/logo${ext.toLowerCase()}`
    : `assets/references/${filename}`;
  const destination = kind === 'logo'
    ? join(paths.assetsDir, `logo${ext.toLowerCase()}`)
    : join(paths.referencesDir, filename);

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, buffer);

  const referenceMetadata = kind === 'reference'
    ? normalizeReferenceMetadata({
        projectId: project.projectId,
        filename,
        relativePath,
        mimeType,
        bytes: buffer.length,
        role: assetInput?.role,
        usageRoles: assetInput?.usageRoles,
        weight: assetInput?.weight,
        order: assetInput?.order,
        active: assetInput?.active,
        width: assetInput?.width,
        height: assetInput?.height,
        aspectRatio: assetInput?.aspectRatio,
        referenceCategory: assetInput?.referenceCategory,
        useInNextGeneration: assetInput?.useInNextGeneration,
        instruction: assetInput?.instruction,
        createdAt: now.toISOString(),
      })
    : null;

  const isOfferScoped = kind === 'reference' && assetInput?.scope === 'offer';
  project.brand = {
    ...project.brand,
    logoPath: kind === 'logo' ? relativePath : project.brand.logoPath,
    referencesDir: 'assets/references',
    references: kind === 'reference' && !isOfferScoped
      ? upsertReferenceMetadata(currentReferences, referenceMetadata)
      : currentReferences,
    referenceFiles: kind === 'reference' && !isOfferScoped
      ? [...new Set([...(project.brand.referenceFiles || []), relativePath])]
      : project.brand.referenceFiles || [],
  };
  if (isOfferScoped) {
    const currentOfferAssets = normalizeProjectOfferAssets(project);
    project.offerAssets = upsertReferenceMetadata(currentOfferAssets, referenceMetadata);
  }
  if (kind === 'logo') {
    const extractedColors = mimeType.startsWith('image/') ? await identifyLogoColors(buffer, mimeType, options.logoColorAnalyzer) : [];
    project.brandIdentity = normalizeBrandIdentity({
      ...(project.brandIdentity || {}),
      logoPath: relativePath,
      extractedColors: extractedColors.length ? extractedColors : (project.brandIdentity?.extractedColors || []),
      analyzedAt: extractedColors.length ? now.toISOString() : (project.brandIdentity?.analyzedAt || null),
      updatedAt: now.toISOString(),
    });
  }
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);

  return {
    kind,
    filename: kind === 'logo' ? `logo${ext.toLowerCase()}` : filename,
    relativePath,
    bytes: buffer.length,
    metadata: referenceMetadata,
    project,
  };
  });
}

export async function updateProjectImageRules(projectId, input = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const imageRules = normalizeRuleList(input.imageRules ?? input.rules ?? []);
  project.brand = {
    ...project.brand,
    visualStyle: String(input.visualStyle ?? project.brand?.visualStyle ?? '').trim(),
    imageRules,
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return project;
  });
}

// Catalog-only settings that apply to every product's composition, edited
// independently of any single product (parallel to updateProjectImageRules,
// which is the marketing-mode equivalent).
export async function updateCatalogSettings(projectId, input = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  project.contentSettings = {
    ...project.contentSettings,
    catalogGeneralInfo: String(input.catalogGeneralInfo ?? project.contentSettings?.catalogGeneralInfo ?? '').trim(),
    catalogStoriesPerDay: Math.max(1, Math.min(20, Number(input.catalogStoriesPerDay) || project.contentSettings?.catalogStoriesPerDay || 3)),
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  return project;
  });
}

// Caps how many online-research findings stay attached to a project at
// once. Trend research goes stale fast — each run replaces the previous
// batch of "[Pesquisa online] ..." lines instead of stacking forever, while
// leaving any rule the operator wrote by hand untouched.
//
// The tag deliberately carries no digits (no embedded date/number) — image
// rules that contain a price-shaped number get matched against the current
// post's price by filterImageRulesForTopic() and silently dropped from the
// prompt whenever they don't match (e.g. every goal-topic post, which has no
// price at all). A tag like "[Pesquisa online 2026-07-27]" would have made
// its own findings invisible on exactly those posts, with no error anywhere.
const MAX_ONLINE_RESEARCH_RULES = 6;
const ONLINE_RESEARCH_TAG_PREFIX = '[Pesquisa online]';

// Feeds real, current visual/ad trends for this project's segment into the
// image prompt — the "search online for references" capability — without
// adding a new runtime dependency to every single generation. A webResearcher
// (real implementation: Hermes CLI with its web toolset, in
// content-central-server.js) is called once, on demand, and its findings are
// folded into the same imageRules list buildImagePrompt() already reads, so
// no separate code path is needed to actually use them.
export async function researchOnlineVisualTrends(projectId, options = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  if (typeof options.webResearcher !== 'function') {
    throw new Error('Nenhum pesquisador online configurado.');
  }
  const segment = String(project.companyProfile?.segment || project.brandInput?.segment || '').trim();
  const productsOrServices = String(
    project.companyProfile?.productsOrServices || project.brandInput?.productsOrServices || ''
  ).trim();
  if (!segment && !productsOrServices) {
    throw new Error('Cadastre o segmento/produtos da empresa (aba Empresa/Raio-X) antes de pesquisar referências online.');
  }

  const findings = await options.webResearcher({ project, segment, productsOrServices });
  const cleanFindings = normalizeRuleList(findings).slice(0, MAX_ONLINE_RESEARCH_RULES);
  if (!cleanFindings.length) {
    // Resolved without throwing but with nothing usable — same silent-failure
    // shape already fixed for image/caption generation in this codebase.
    throw new Error('A pesquisa online não retornou nenhum achado aproveitável. Tente novamente em instantes.');
  }

  const taggedFindings = cleanFindings.map((line) => `${ONLINE_RESEARCH_TAG_PREFIX} ${line}`);
  const keptRules = normalizeRuleList(project.brand?.imageRules || [])
    .filter((rule) => !rule.startsWith(ONLINE_RESEARCH_TAG_PREFIX));

  project.brand = {
    ...project.brand,
    imageRules: [...taggedFindings, ...keptRules],
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  return { researchedAt: now.toISOString(), findings: taggedFindings };
  });
}

// Turns an already-generated static creative into a short vertical video
// ("Animar para Reels") — the missing piece for real Reels publishing, since
// Meta only accepts video for that channel and this system otherwise only
// ever produces still images. A videoAnimator (real implementation: local
// ffmpeg zoom/pan, in content-central-server.js) is called on demand; no new
// runtime dependency is added to routine image generation.
// Shared by the manual "Animar para Reels" button (animateContentForReels,
// throws on failure) and the automatic in-batch animation
// (enrichBatchItemsWithRealImages, catches and records the error instead) —
// both need the exact same videoAnimator-call-and-attach shape.
async function attachReelsVideo(content, project, videoAnimator, now = new Date()) {
  const result = await videoAnimator({ content, project });
  if (!result?.url) {
    // Same shape as the image/caption/research silent-failure fixes already
    // in this file — a resolved-but-empty result must not look like success.
    throw new Error('A animação não retornou um vídeo válido.');
  }
  content.video = {
    url: result.url,
    localPath: result.localPath || null,
    mimeType: result.mimeType || 'video/mp4',
    durationSeconds: result.durationSeconds || null,
    generatedAt: now.toISOString(),
    generatedSource: 'ffmpeg_zoompan',
  };
}

export async function animateContentForReels(projectId, contentId, options = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, options.batchId);
  const content = await readJson(contentPath);

  if (typeof options.videoAnimator !== 'function') {
    throw new Error('Nenhum animador de vídeo configurado.');
  }
  if (content.image?.generatedSource !== 'ai') {
    throw new Error('Este card ainda não tem uma imagem final gerada por IA para animar.');
  }

  await attachReelsVideo(content, project, options.videoAnimator, now);
  content.updatedAt = now.toISOString();
  await writeJson(contentPath, content);
  return content;
}

export async function generateContentBatch(projectId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const globalRules = await loadGlobalRules(getCentralPaths(targetDir));
  const days = Number(options.days || project.contentSettings.defaultDaysToGenerate || 7);
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    throw new Error('Days must be an integer between 1 and 60');
  }

  const channel = options.channel || project.contentSettings.channels[0] || DEFAULT_CHANNEL;
  const startDate = options.startDate || formatDate(new Date());
  const postTime = options.postTime || project.contentSettings.defaultPostTime || DEFAULT_TIME;
  const contentRules = Array.isArray(options.contentRules) ? options.contentRules : [];
  const topicCount = await contentTopicCount(project, { groupIds: options.groupIds, offersOnly: options.offersOnly }, targetDir);
  if (options.offersOnly && !topicCount) {
    throw new Error('O(s) grupo(s) selecionado(s) não têm nenhuma oferta ativa — nada pra gerar com "só esse grupo" marcado.');
  }
  const topicOffset = normalizeTopicIndex(
    options.topicOffset !== undefined ? options.topicOffset : project.contentStrategy?.nextScheduleTopicIndex,
    topicCount
  );
  const batchId = `${startDate}-${String(days).padStart(2, '0')}d-${channel}`;
  const batchDir = join(paths.draftsDir, batchId);
  const imageDir = join(batchDir, 'images');
  await mkdir(batchDir, { recursive: true });
  await mkdir(imageDir, { recursive: true });

  const batch = {
    batchId,
    projectId: project.projectId,
    createdAt: new Date().toISOString(),
    days,
    channel,
    startDate,
    items: [],
  };

  for (let index = 0; index < days; index += 1) {
    const dayNumber = index + 1;
    const scheduledDate = addDays(startDate, index);
    const dimensions = imageDimensionsForChannel(channel);
    const aspectRatio = imageAspectRatioForChannel(channel);
    const contentTopic = await buildContentTopic(project, topicOffset + index, { channel, groupIds: options.groupIds, offersOnly: options.offersOnly, weekday: weekdayFromDate(scheduledDate) }, targetDir);
    const contentId = `${project.projectId}-${scheduledDate}-${channel}`;
    const filePath = join(batchDir, `day-${String(dayNumber).padStart(2, '0')}.json`);
    const imageFileName = `day-${String(dayNumber).padStart(2, '0')}.svg`;
    const imageLocalPath = `content/drafts/${batchId}/images/${imageFileName}`;
    const item = {
      schemaVersion: 1,
      contentId,
      projectId: project.projectId,
      batchId,
      dayNumber,
      scheduledDate,
      scheduledTime: postTime,
      channel,
      formatLabel: CHANNEL_LABELS[channel] || channel,
      contentTopic,
      contentReview: buildContentReview({ channel, aspectRatio, dimensions, contentTopic }),
      status: 'draft_generated',
      title: `Dia ${dayNumber} — ${project.name}`,
      image: {
        localPath: imageLocalPath,
        prompt: buildImagePrompt(project, globalRules.rules, contentRules, dayNumber, { channel, contentTopic, logoReference: getProjectLogoReference(project, paths) }),
        references: buildImageReferencePayload(project, paths),
        aspectRatio,
        dimensions,
        generated: true,
        mimeType: 'image/svg+xml',
        version: 1,
      },
      caption: {
        text: buildCaptionDraft(project, dayNumber, contentTopic),
        version: 1,
      },
      dayRules: [],
      generationContext: {
        globalRules: globalRules.rules.map((rule) => rule.text),
        projectRules: [...project.rules.project],
        contentRules: [...contentRules],
      },
      approval: {
        required: project.mode !== 'automatic',
        emailSentAt: null,
        approvedAt: null,
        approvalSource: null,
      },
      publish: {
        publishedAt: null,
        metaMediaId: null,
        error: null,
      },
      filePath,
      createdAt: batch.createdAt,
      updatedAt: batch.createdAt,
    };
    item.image.previewDataUrl = await writeGeneratedImage(join(imageDir, imageFileName), item, project);
    await writeJson(filePath, item);
    batch.items.push(item);
  }

  await writeJson(join(batchDir, 'batch.json'), batch);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    nextScheduleTopicIndex: normalizeTopicIndex(topicOffset + days, topicCount),
  };
  await writeJson(paths.projectPath, project);
  return batch;
  });
}

const SPECIAL_DATE_BATCH_PREFIX = 'data-comemorativa';

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'data';
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) — Easter Sunday for a
// given year, used to derive Carnaval/Sexta-feira Santa/Corpus Christi below.
function easterDateString(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatDate(new Date(Date.UTC(year, month - 1, day)));
}

// The n-th weekday of a month (e.g. "2nd Sunday of May" for Dia das Mães).
// weekdayIndex0Sun follows getUTCDay() convention (0=Sunday..6=Saturday).
function nthWeekdayOfMonth(year, monthIndex0, weekdayIndex0Sun, n) {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex0, 1));
  const offset = (weekdayIndex0Sun - firstOfMonth.getUTCDay() + 7) % 7;
  return formatDate(new Date(Date.UTC(year, monthIndex0, 1 + offset + (n - 1) * 7)));
}

// The last weekday of a month (e.g. "last Friday of November" for Black
// Friday).
function lastWeekdayOfMonth(year, monthIndex0, weekdayIndex0Sun) {
  const lastOfMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  const diff = (lastOfMonth.getUTCDay() - weekdayIndex0Sun + 7) % 7;
  return formatDate(new Date(Date.UTC(year, monthIndex0, lastOfMonth.getUTCDate() - diff)));
}

// Fixed-date national holidays (month/day) — a curated set, not the full
// official calendar (e.g. state/municipal holidays are deliberately left
// out; every project sees the same national list).
const FIXED_NATIONAL_HOLIDAYS = [
  { month: 1, day: 1, label: 'Confraternização Universal' },
  { month: 4, day: 21, label: 'Tiradentes' },
  { month: 5, day: 1, label: 'Dia do Trabalho' },
  { month: 9, day: 7, label: 'Independência do Brasil' },
  { month: 10, day: 12, label: 'Nossa Senhora Aparecida' },
  { month: 11, day: 2, label: 'Finados' },
  { month: 11, day: 15, label: 'Proclamação da República' },
  { month: 12, day: 25, label: 'Natal' },
];

// Commercial/marketing dates — not official holidays, but the ones a small
// business actually wants a themed post for.
const FIXED_COMMERCIAL_DATES = [
  { month: 6, day: 12, label: 'Dia dos Namorados' },
  { month: 9, day: 15, label: 'Dia do Cliente' },
  { month: 10, day: 12, label: 'Dia das Crianças' },
];

function commemorativeDatesForYear(year) {
  const easter = easterDateString(year);
  const dates = [
    ...FIXED_NATIONAL_HOLIDAYS.map((entry) => ({
      date: formatDate(new Date(Date.UTC(year, entry.month - 1, entry.day))),
      label: entry.label,
      kind: 'holiday',
    })),
    ...FIXED_COMMERCIAL_DATES.map((entry) => ({
      date: formatDate(new Date(Date.UTC(year, entry.month - 1, entry.day))),
      label: entry.label,
      kind: 'commercial',
    })),
    { date: addDays(easter, -47), label: 'Carnaval', kind: 'holiday' },
    { date: addDays(easter, -2), label: 'Sexta-feira Santa', kind: 'holiday' },
    { date: easter, label: 'Páscoa', kind: 'commercial' },
    { date: addDays(easter, 60), label: 'Corpus Christi', kind: 'holiday' },
    { date: nthWeekdayOfMonth(year, 4, 0, 2), label: 'Dia das Mães', kind: 'commercial' },
    { date: nthWeekdayOfMonth(year, 7, 0, 2), label: 'Dia dos Pais', kind: 'commercial' },
    { date: lastWeekdayOfMonth(year, 10, 5), label: 'Black Friday', kind: 'commercial' },
  ];
  return dates;
}

// Feriados nacionais + datas comerciais relevantes (Dia das Mães, Black
// Friday etc.) dentro do intervalo [fromDateString, toDateString], para o
// operador escolher uma e gerar uma arte avulsa pra ela — ver
// generateSpecialDateContent. Datas móveis (Páscoa e derivadas, Dia das
// Mães/Pais, Black Friday) são calculadas, não hardcoded.
export function listCommemorativeDates(fromDateString, toDateString) {
  const fromYear = Number(fromDateString.slice(0, 4));
  const toYear = Number(toDateString.slice(0, 4));
  const years = [];
  for (let year = fromYear; year <= toYear; year += 1) years.push(year);
  return years
    .flatMap(commemorativeDatesForYear)
    .filter((entry) => entry.date >= fromDateString && entry.date <= toDateString)
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

async function buildSpecialDateContentTopic({ date, label, project, offer, targetDir }) {
  const idSuffix = `${date}-${slugify(label)}`;
  if (offer) {
    const offerTopic = await offerToContentTopic(offer, targetDir);
    return {
      ...offerTopic,
      id: `special-date-${idSuffix}`,
      source: 'special_date',
      specialDateLabel: label,
      objective: `Post comemorativo de ${label} para ${project.name}, aproveitando a data para gerar engajamento e movimentar o Instagram do cliente. ${offerTopic.objective || ''}`.trim(),
    };
  }
  return {
    id: `special-date-${idSuffix}`,
    type: 'institutional',
    label: `Post comemorativo — ${label}`,
    source: 'special_date',
    specialDateLabel: label,
    price: '',
    items: '',
    cta: '',
    autoGenerateCta: false,
    notes: '',
    objective: `Post comemorativo de ${label} para ${project.name}. Objetivo: reforçar a presença da marca e gerar engajamento nessa data, sem inventar oferta, preço ou promoção que não esteja cadastrada.`,
  };
}

// A one-off creative for a national holiday or commercial date, created
// entirely independent of the normal offer/pillar rotation — clicking a
// date in "Datas comemorativas" must always produce a themed post for
// exactly that date, never whatever the rotation cursor happens to be
// pointing at right now. Never touches nextScheduleTopicIndex/
// nextPillarSequenceIndex, so it has zero effect on the next regular
// scheduled batch. Reuses the same item shape generateContentBatch writes,
// so it shows up in Aguardando aprovação/Calendário/briefing exactly like
// any other card, and can optionally be tied to a real registered offer
// (options.offerId) instead of running as a purely institutional post.
export async function generateSpecialDateContent(projectId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const globalRules = await loadGlobalRules(getCentralPaths(targetDir));
  const date = String(options.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.');
  const label = String(options.label || '').trim();
  if (!label) throw new Error('Informe o nome da data comemorativa.');
  // Accepts either the original single `channel` (kept for callers that
  // still only ever want one format) or a plural `channels` list — picking
  // "Instagram Stories" + "Facebook Story" for the same date is the whole
  // point of offering multiple checkboxes, and same-shape channels must
  // share ONE generated creative instead of each burning its own AI call,
  // exactly like a regular scheduled batch already does via creativeGroupKey
  // (see generateContentSchedulePlan/enrichBatchItemsWithRealImages).
  const requestedChannels = Array.isArray(options.channels) && options.channels.length
    ? options.channels
    : [options.channel || project.contentSettings.channels[0] || DEFAULT_CHANNEL];
  const channels = [...new Set(requestedChannels)];
  const postTime = options.postTime || project.contentSettings.defaultPostTime || DEFAULT_TIME;
  const offer = options.offerId
    ? normalizeProjectOffers(project.contentStrategy?.offers || []).find((entry) => entry.id === options.offerId)
    : null;

  const batchId = `${date}-${SPECIAL_DATE_BATCH_PREFIX}-${slugify(label)}`;
  const batchDir = join(paths.draftsDir, batchId);
  const imageDir = join(batchDir, 'images');
  await mkdir(batchDir, { recursive: true });
  await mkdir(imageDir, { recursive: true });

  // Built once, outside the per-channel loop below, and reused for every
  // channel — same topic/message across formats is what makes sharing one
  // creative across a shape group correct in the first place.
  const contentTopic = await buildSpecialDateContentTopic({ date, label, project, offer, targetDir });
  const createdAt = new Date().toISOString();

  const items = [];
  for (const channel of channels) {
    const dimensions = imageDimensionsForChannel(channel);
    const aspectRatio = imageAspectRatioForChannel(channel);
    const contentId = `${project.projectId}-${date}-${slugify(label)}-${channel}`;
    const imageFileName = `day-01-${channel}.svg`;
    const filePath = join(batchDir, `day-01-${channel}.json`);
    const imageLocalPath = `content/drafts/${batchId}/images/${imageFileName}`;
    const shapeGroup = creativeShapeGroupForChannel(channel);
    const item = {
      schemaVersion: 1,
      contentId,
      projectId: project.projectId,
      batchId,
      dayNumber: 1,
      scheduledDate: date,
      scheduledTime: postTime,
      channel,
      formatLabel: CHANNEL_LABELS[channel] || channel,
      contentTopic,
      contentReview: buildContentReview({ channel, aspectRatio, dimensions, contentTopic }),
      status: 'draft_generated',
      title: `${label} — ${project.name}`,
      // Same key shape as generateContentSchedulePlan: date + shape group +
      // this occasion's own slug, so this special date's Story/Reels/
      // Facebook Story share one creative, its Feed/Facebook Feed share
      // another, without colliding with any regular scheduled batch's keys.
      creativeGroupKey: shapeGroup ? `${date}::${shapeGroup}::special::${slugify(label)}` : null,
      image: {
        localPath: imageLocalPath,
        prompt: buildImagePrompt(project, globalRules.rules, [], 1, { channel, contentTopic, logoReference: getProjectLogoReference(project, paths) }),
        references: buildImageReferencePayload(project, paths),
        aspectRatio,
        dimensions,
        generated: true,
        mimeType: 'image/svg+xml',
        version: 1,
      },
      caption: {
        text: buildCaptionDraft(project, 1, contentTopic),
        version: 1,
      },
      dayRules: [],
      generationContext: {
        globalRules: globalRules.rules.map((rule) => rule.text),
        projectRules: [...project.rules.project],
        contentRules: [],
      },
      approval: {
        required: project.mode !== 'automatic',
        emailSentAt: null,
        approvedAt: null,
        approvalSource: null,
      },
      publish: {
        publishedAt: null,
        metaMediaId: null,
        error: null,
      },
      filePath,
      createdAt,
      updatedAt: createdAt,
    };
    item.image.previewDataUrl = await writeGeneratedImage(join(imageDir, imageFileName), item, project);
    await writeJson(filePath, item);
    items.push(item);
  }

  const batch = {
    batchId,
    projectId: project.projectId,
    createdAt,
    days: 1,
    channel: channels[0],
    startDate: date,
    items,
  };
  await writeJson(join(batchDir, 'batch.json'), batch);
  return batch;
  });
}

// A "segment template" is a small library of pre-approved art (e.g. the
// packaging/"embalagens" segment's 6 Feed pieces + 3 highlight covers) that
// gets reused across future prospects in the same business segment instead
// of generating fresh AI art from scratch for every single lead — the
// operator just supplies a new logo, and the approved pieces get edited
// (palette + logo swap, same composition/product/layout) via the targeted-
// edit mechanism already used for "Pedido de alteração" (see
// generateAiImageWithCodexAgent's templateEditBasePath in
// content-central-server.js). Lives at the root level, parallel to
// projects/ — a template isn't owned by any one client project.

// Copies each piece's source image into the permanent template store and
// writes its metadata. This is an operator/registration-time action (run
// once per segment via a script), not something end users trigger from the
// dashboard in this first version — see "Fora de escopo" in the plan.
export async function registerSegmentTemplate(segmentId, { label, pieces }, targetDir = process.cwd()) {
  const id = slugify(segmentId);
  if (!id) throw new Error('Informe um id de segmento válido.');
  const normalizedLabel = String(label || '').trim();
  if (!normalizedLabel) throw new Error('Informe um nome pro segmento.');
  if (!Array.isArray(pieces) || !pieces.length) throw new Error('Informe pelo menos 1 peça pro template.');

  const paths = getCentralPaths(targetDir);
  const templateDir = join(paths.segmentTemplatesDir, id);
  const imagesDir = join(templateDir, 'images');
  await mkdir(imagesDir, { recursive: true });

  const storedPieces = [];
  for (const piece of pieces) {
    const key = slugify(piece.key || piece.label);
    if (!key) throw new Error('Cada peça precisa de uma chave (key) válida.');
    if (!piece.sourceImagePath) throw new Error(`Peça "${key}" sem sourceImagePath.`);
    const imagePath = `images/${key}.png`;
    await copyFile(piece.sourceImagePath, join(templateDir, imagePath));
    storedPieces.push({
      key,
      label: String(piece.label || key).trim(),
      channel: piece.channel || DEFAULT_CHANNEL,
      angleNote: String(piece.angleNote || '').trim(),
      imagePath,
    });
  }

  const template = {
    segmentId: id,
    label: normalizedLabel,
    pieces: storedPieces,
    createdAt: new Date().toISOString(),
  };
  await writeJson(join(templateDir, 'template.json'), template);
  return template;
}

// Resolves each piece's imagePath to an absolute path so callers never have
// to know the on-disk layout — mirrors how getProjectLogoReference etc.
// hand back ready-to-use absolute paths elsewhere in this file.
export async function loadSegmentTemplate(segmentId, targetDir = process.cwd()) {
  const id = slugify(segmentId);
  const paths = getCentralPaths(targetDir);
  const templateDir = join(paths.segmentTemplatesDir, id);
  const template = await readJson(join(templateDir, 'template.json'), null);
  if (!template) return null;
  return {
    ...template,
    pieces: template.pieces.map((piece) => ({
      ...piece,
      imageAbsolutePath: join(templateDir, piece.imagePath),
    })),
  };
}

// Powers the dashboard's segment picker — an empty/missing directory is a
// normal "no templates registered yet" state, not an error.
export async function listSegmentTemplates(targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir);
  let entries;
  try {
    entries = await readdir(paths.segmentTemplatesDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const summaries = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const template = await readJson(join(paths.segmentTemplatesDir, entry.name, 'template.json'), null);
    if (!template) continue;
    summaries.push({
      segmentId: template.segmentId,
      label: template.label,
      pieceCount: template.pieces.length,
      // Full piece list so the dashboard can render the fixed grid/highlight
      // images directly (no per-prospect AI generation) — imagePath is the
      // on-disk relative path; the server route resolves it to bytes.
      pieces: template.pieces.map((piece) => ({ key: piece.key, label: piece.label, channel: piece.channel, imagePath: piece.imagePath })),
    });
  }
  return summaries.sort((a, b) => a.label.localeCompare(b.label));
}

// Builds one draft content item from a segment-template piece — same shape
// generateSpecialDateContent writes (so listProjectContent/the prospect
// mockup renderer handle it identically), just institutional/no offer and
// with no caption (the mockup only ever shows the images, never caption
// text — see renderProspectMockupPage). The actual pixels come later, via a
// targeted edit keyed off `templateEditBasePath` set by the caller — this
// only writes the skeleton/placeholder the same way every other content
// item starts out.
export function buildSegmentTemplateContentItem(piece, project, paths) {
  const channel = piece.channel || DEFAULT_CHANNEL;
  const dimensions = imageDimensionsForChannel(channel);
  const aspectRatio = imageAspectRatioForChannel(channel);
  const contentTopic = {
    id: `segment-template-${piece.key}`,
    type: 'institutional',
    label: piece.label,
    source: 'segment_template',
    price: '',
    items: '',
    cta: '',
    autoGenerateCta: false,
    notes: '',
    objective: piece.angleNote || piece.label,
  };
  const contentId = `${project.projectId}-segment-template-${piece.key}`;
  const batchId = `segment-template-${piece.key}`;
  const batchDir = join(paths.draftsDir, batchId);
  const filePath = join(batchDir, 'day-01.json');
  const imageLocalPath = `content/drafts/${batchId}/images/day-01.svg`;
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    contentId,
    projectId: project.projectId,
    batchId,
    dayNumber: 1,
    scheduledDate: createdAt.slice(0, 10),
    scheduledTime: DEFAULT_TIME,
    channel,
    formatLabel: CHANNEL_LABELS[channel] || channel,
    contentTopic,
    contentReview: buildContentReview({ channel, aspectRatio, dimensions, contentTopic }),
    status: 'draft_generated',
    title: `${piece.label} — ${project.name}`,
    image: {
      localPath: imageLocalPath,
      prompt: `Adaptação de template de segmento (${piece.label}) a partir de uma peça já aprovada — ver templateEditBasePath.`,
      references: buildImageReferencePayload(project, paths),
      aspectRatio,
      dimensions,
      generated: true,
      mimeType: 'image/svg+xml',
      version: 1,
    },
    caption: {
      text: '',
      version: 1,
    },
    dayRules: [],
    generationContext: { globalRules: [], projectRules: [...project.rules.project], contentRules: [] },
    approval: {
      required: project.mode !== 'automatic',
      emailSentAt: null,
      approvedAt: null,
      approvalSource: null,
    },
    publish: {
      publishedAt: null,
      metaMediaId: null,
      error: null,
    },
    filePath,
    createdAt,
    updatedAt: createdAt,
  };
}

// Runs each segment-template item's targeted edit sequentially (not
// mapWithConcurrency like enrichBatchItemsWithRealImages — a handful of
// items for one new prospect, no rotation/sharing logic needed, and
// sequential keeps codex-agent turns from piling up). Same
// "record the error on the item, never abort the rest" contract as every
// other real-image enrichment in this file. Every item shares the same
// `options.note` (the palette/logo swap instruction) and `options.imageGenerator`
// — the per-piece edit base comes from `item.templateEditBasePath`, already
// set by the caller before this runs.
export async function enrichSegmentTemplateItemsForProspect(items, project, projectId, options = {}) {
  if (typeof options.imageGenerator !== 'function') return;
  for (const item of items) {
    item.image.generating = true;
    item.updatedAt = new Date().toISOString();
    await writeJson(item.filePath, item);
    try {
      await generateAiImageWithReviewLoop(item, project, projectId, {
        imageGenerator: options.imageGenerator,
        channel: item.channel,
        note: options.note,
        targetedEdit: true,
        maxAttempts: 1,
      });
      item.imageGenerationError = null;
    } catch (err) {
      item.imageGenerationError = err.message;
    }
    item.image.generating = false;
    item.updatedAt = new Date().toISOString();
    await writeJson(item.filePath, item);
  }
}

// Fire-and-forget dispatch for the route handler — same shape as
// enqueueBatchImageGeneration just above: load what's needed, run the real
// work, swallow+log any failure (the request that kicked this off has
// already responded by the time this runs). Builds the shared adaptation
// note from the project's own real extracted logo colors — never invents a
// palette if the logo hasn't been colour-analyzed yet.
export function enqueueSegmentTemplateAdaptation(projectId, segmentId, options = {}, targetDir = process.cwd()) {
  if (typeof options.imageGenerator !== 'function') return;
  const paths = getCentralPaths(targetDir, projectId);
  Promise.all([loadProject(paths), loadSegmentTemplate(segmentId, targetDir)])
    .then(([project, template]) => {
      if (!template) throw new Error(`Template de segmento "${segmentId}" não encontrado.`);
      const extractedColors = project.brandIdentity?.extractedColors || [];
      const note = [
        extractedColors.length
          ? `Troque a paleta de cor de fundo original pela nova paleta baseada na logo anexada: ${extractedColors.join(', ')}.`
          : 'Troque a paleta de cor de fundo original por uma paleta compatível com a logo anexada (segunda referência).',
        'Troque a logo/nome da marca pela logo anexada (segunda referência).',
        'Mantenha produto, ícones, layout, tipografia e composição exatamente iguais ao original — só a cor e a logo mudam.',
      ].join(' ');
      const items = template.pieces.map((piece) => {
        const item = buildSegmentTemplateContentItem(piece, project, paths);
        item.templateEditBasePath = piece.imageAbsolutePath;
        return item;
      });
      return enrichSegmentTemplateItemsForProspect(items, project, projectId, { imageGenerator: options.imageGenerator, note });
    })
    .catch((err) => {
      console.error(`[content-central] segment template adaptation failed for ${projectId}/${segmentId}:`, err.message);
    });
}

// Ad creative (paid traffic) is a separate concept from every organic
// content path above: no scheduledDate, no rotation cursor, no approval
// workflow, no calendar/publish. The operator runs the actual campaign
// themselves in Ads Manager — this only produces the creative asset plus a
// few copy variations to paste in there. Only "whatsapp" is supported for
// now; more objectives (site link, lead form) can be added the same way
// later without touching what's already here.
const AD_OBJECTIVE_LABELS = {
  whatsapp: 'Tráfego para o WhatsApp',
  awareness: 'Reconhecimento de marca',
  engagement: 'Engajamento',
  leads: 'Cadastros (Leads)',
  sales: 'Vendas/Conversão',
  app_promotion: 'Promoção do app',
};

function normalizeAdObjective(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized in AD_OBJECTIVE_LABELS ? normalized : '';
}

// Character limits (AD_COPY_LIMITS) and angle definitions live in
// content-central-server.js, next to the actual copy-generation prompt that
// uses them — this file only builds the ad creative's image/topic, not its
// copy.
// The operator's free-text idea always feeds both the copy and the image —
// "recomendacao" (default) treats it as one more input alongside the normal
// angle-based approach; "base_total" makes it the actual brief the AI must
// build around, only still allowed to pull in real brand facts (logo,
// colors, identity) it already has, not invent a different concept.
function buildAdCreativeNoteLine(note, noteMode) {
  if (!note) return '';
  if (noteMode === 'base_total') {
    return `IMPORTANTE — ideia do operador (base totalmente o criativo nisso, não use um ângulo diferente do que foi pedido; pode usar logo, cores e identidade da marca já cadastrados como apoio): "${note}"`;
  }
  return `Ideia sugerida pelo operador (use como inspiração adicional, sem abandonar o restante da direção do anúncio): "${note}"`;
}

async function buildAdCreativeContentTopic({ project, offer, objective, note, noteMode, targetDir }) {
  const id = `ad-creative-${Date.now()}`;
  const objectiveLabel = AD_OBJECTIVE_LABELS[objective];
  const noteLine = buildAdCreativeNoteLine(note, noteMode);
  if (offer) {
    const offerTopic = await offerToContentTopic(offer, targetDir);
    return {
      ...offerTopic,
      id,
      source: 'ad_creative',
      adObjective: objective,
      adNote: note || '',
      adNoteMode: noteMode || 'recomendacao',
      objective: [
        `Criativo de anúncio pago (${objectiveLabel}) para ${project.name}.`,
        offerTopic.objective || '',
        noteLine,
      ].filter(Boolean).join(' '),
    };
  }
  return {
    id,
    type: 'institutional',
    label: 'Criativo de anúncio',
    source: 'ad_creative',
    adObjective: objective,
    adNote: note || '',
    adNoteMode: noteMode || 'recomendacao',
    price: '',
    items: '',
    cta: '',
    autoGenerateCta: false,
    notes: '',
    objective: [
      `Criativo de anúncio pago (${objectiveLabel}) para ${project.name}. Sem inventar oferta, preço ou promoção que não esteja cadastrada.`,
      noteLine,
    ].filter(Boolean).join(' '),
  };
}

// Injected adCopyGenerator returns an array of angle-based variations (one
// per angle: dor, desejo, urgência — see AD_COPY_ANGLE_LABELS in
// content-central-server.js). A generator that resolves with nothing usable
// records a real error instead of leaving the ad creative silently
// copy-less, same pattern as writeAiCaptionForItem for organic captions.
async function writeAdCopyVariations(adCreative, project, options) {
  if (typeof options.adCopyGenerator !== 'function') return;
  try {
    const variations = await options.adCopyGenerator({ adCreative, project, note: options.note, noteMode: options.noteMode });
    if (Array.isArray(variations) && variations.length) {
      adCreative.variations = variations;
      adCreative.copyGenerationError = null;
    } else {
      adCreative.copyGenerationError = 'O redator de IA não retornou variações de copy (resposta vazia). Regenere para tentar de novo.';
    }
  } catch (err) {
    adCreative.copyGenerationError = err.message;
  }
}

export async function generateAdCreative(projectId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const objective = normalizeAdObjective(options.objective) || 'whatsapp';
  const offer = options.offerId
    ? normalizeProjectOffers(project.contentStrategy?.offers || []).find((entry) => entry.id === options.offerId)
    : null;
  const note = String(options.note || '').trim();
  const noteMode = options.noteMode === 'base_total' ? 'base_total' : 'recomendacao';

  // Caller (the HTTP route) resolves "Story", "Feed" or "Ambos" into one or
  // two calls to this function — each call always renders exactly one
  // format, so it stays a single AI generation per call like every other
  // image-generating path in this file.
  const channel = options.channel === 'instagram_story' ? 'instagram_story' : 'instagram_feed';
  const dimensions = imageDimensionsForChannel(channel);
  const aspectRatio = imageAspectRatioForChannel(channel);
  const contentTopic = await buildAdCreativeContentTopic({ project, offer, objective, note, noteMode, targetDir });

  const adCreativeId = `${project.projectId}-anuncio-${Date.now()}`;
  const imageDir = join(paths.adCreativesDir, 'images');
  await mkdir(paths.adCreativesDir, { recursive: true });
  await mkdir(imageDir, { recursive: true });

  const filePath = join(paths.adCreativesDir, `${adCreativeId}.json`);
  const imageFileName = `${adCreativeId}.svg`;
  const imageLocalPath = `content/ad-creatives/images/${imageFileName}`;
  const createdAt = new Date().toISOString();

  const adCreative = {
    schemaVersion: 1,
    adCreativeId,
    projectId: project.projectId,
    objective,
    objectiveLabel: AD_OBJECTIVE_LABELS[objective],
    offerId: offer?.id || null,
    offerName: offer?.name || null,
    channel,
    formatLabel: CHANNEL_LABELS[channel] || channel,
    contentTopic,
    title: offer ? `Anúncio — ${offer.name}` : `Anúncio — ${project.name}`,
    image: {
      localPath: imageLocalPath,
      prompt: buildImagePrompt(project, [], [], 1, { channel, contentTopic, logoReference: getProjectLogoReference(project, paths) }),
      references: buildImageReferencePayload(project, paths),
      aspectRatio,
      dimensions,
      generated: true,
      mimeType: 'image/svg+xml',
      version: 1,
    },
    variations: [],
    copyGenerationError: null,
    imageGenerationError: null,
    createdAt,
    updatedAt: createdAt,
    filePath,
  };
  adCreative.image.previewDataUrl = await writeGeneratedImage(join(imageDir, imageFileName), adCreative, project);
  await writeJson(filePath, adCreative);
  return adCreative;
  });
}

// Replaces the placeholder SVG with a real AI-generated ad creative and
// writes the copy variations, same "generate + review loop, record errors
// instead of throwing" shape as enrichBatchItemsWithRealImages uses for
// organic content — just for one standalone item instead of a batch.
// options.skipCopy — used by regenerateAdCreative: "Regenerar só a
// imagem"/"Pedido de alteração" only touch the image, the same way the
// organic-content regenerate flow leaves the caption alone unless asked
// otherwise. A fresh generateAdCreative always wants both.
export async function enrichAdCreativeWithRealImage(adCreative, project, projectId, options = {}) {
  if (typeof options.imageGenerator !== 'function') return;
  adCreative.image.generating = true;
  adCreative.updatedAt = new Date().toISOString();
  await writeJson(adCreative.filePath, adCreative);

  const imageWork = (async () => {
    try {
      await generateAiImageWithReviewLoop(adCreative, project, projectId, {
        imageGenerator: options.imageGenerator,
        imageReviewer: options.imageReviewer,
        channel: adCreative.channel,
        maxAttempts: options.maxCreativeAttempts,
        promptFraming: 'ad_creative',
        note: options.note,
        targetedEdit: Boolean(options.note),
      });
      adCreative.imageGenerationError = null;
    } catch (err) {
      adCreative.imageGenerationError = err.message;
    }
  })();
  const copyWork = options.skipCopy ? Promise.resolve() : writeAdCopyVariations(adCreative, project, options);
  await Promise.all([imageWork, copyWork]);

  adCreative.image.generating = false;
  adCreative.updatedAt = new Date().toISOString();
  await writeJson(adCreative.filePath, adCreative);
}

// "Regenerar só a imagem" (no note) or "Pedido de alteração" (with note —
// becomes a targeted edit of the existing image, same mechanism organic
// content regeneration uses) for an ad creative already on disk. Copy
// variations are left exactly as they are; this only touches the image.
export async function regenerateAdCreative(projectId, adCreativeId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const safeId = String(adCreativeId || '').replace(/[\\/]/g, '');
    if (!safeId) throw new Error('ID do criativo inválido.');
    const filePath = join(paths.adCreativesDir, `${safeId}.json`);
    const adCreative = await readJson(filePath);
    adCreative.image.references = buildImageReferencePayload(project, paths);
    return adCreative;
  });
}

export async function listAdCreatives(projectId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  let files;
  try {
    files = await readdir(paths.adCreativesDir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const items = await Promise.all(
    files.filter((name) => name.endsWith('.json')).map((name) => readJson(join(paths.adCreativesDir, name)))
  );
  return items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function deleteAdCreative(projectId, adCreativeId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const safeId = String(adCreativeId || '').replace(/[\\/]/g, '');
    if (!safeId) throw new Error('ID do criativo inválido.');
    await rm(join(paths.adCreativesDir, `${safeId}.json`), { force: true });
    return { deleted: true };
  });
}

// How many items get a real AI image generated at once when a batch is
// scheduled. Each generation is a slow (30s-3min) external call, so a large
// batch run fully sequential could take tens of minutes; a small concurrency
// window keeps wall-clock time reasonable without hammering the provider.
const BATCH_IMAGE_CONCURRENCY = 3;

async function mapWithConcurrency(items, limit, worker) {
  let cursor = 0;
  async function runNext() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
}

// Items that share a creativeGroupKey (same day, same pixel shape, same
// slot — see generateContentSchedulePlan) get generated together as one
// unit; everything else is its own singleton unit, unchanged from before
// grouping existed.
function creativeGroupsFromItems(items) {
  const groups = new Map();
  items.forEach((item, index) => {
    const key = item.creativeGroupKey || `__singleton__${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.values()];
}

// Replaces each item's placeholder SVG with a real AI-generated image (same
// generate+review loop Teste Seguro uses) when an imageGenerator is
// injected. Failures on individual items are recorded on the item instead of
// aborting the whole batch — a scheduled week of content shouldn't be lost
// because one day's generation hit a transient error. Marks each item
// `image.generating` true/false around its own turn so the panel can poll
// the content list and show live per-card progress instead of a silent wait.
//
// Items grouped by creativeGroupKey (Story/Reels/Facebook Story, or
// Feed/Facebook Feed, same day+slot) only pay for ONE image+caption
// generation per group — the "leader" (first item in the group) runs the
// real generation, and its result is copied onto the other members so they
// all publish with the exact same creative instead of each rolling its own.
export async function enrichBatchItemsWithRealImages(batch, project, projectId, options) {
  if (typeof options.imageGenerator !== 'function') return;
  const groups = creativeGroupsFromItems(batch.items);
  await mapWithConcurrency(groups, BATCH_IMAGE_CONCURRENCY, async (group) => {
    const [leader, ...followers] = group;
    for (const item of group) {
      item.image.generating = true;
      item.updatedAt = new Date().toISOString();
      await writeJson(item.filePath, item);
    }
    const imageWork = (async () => {
      try {
        await generateAiImageWithReviewLoop(leader, project, projectId, {
          imageGenerator: options.imageGenerator,
          imageReviewer: options.imageReviewer,
          channel: leader.channel,
          maxAttempts: options.maxCreativeAttempts,
        });
        leader.imageGenerationError = null;
      } catch (err) {
        leader.imageGenerationError = err.message;
      }
    })();
    // Caption writing is independent of the final pixels, so it runs
    // alongside image generation instead of after it — same concurrency
    // slot, less total wall-clock time per card.
    const captionWork = writeAiCaptionForItem(leader, project, options);
    await Promise.all([imageWork, captionWork]);
    if (followers.length) {
      leader.creativeSharedWith = followers.map((item) => item.contentId);
      for (const follower of followers) {
        follower.image = { ...leader.image };
        follower.imageGenerationError = leader.imageGenerationError;
        follower.creativePreflight = leader.creativePreflight;
        follower.creativeReviewAttempts = leader.creativeReviewAttempts;
        follower.creativeReview = leader.creativeReview;
        follower.contentReview = leader.contentReview;
        follower.caption = { ...leader.caption };
        follower.captionGenerationError = leader.captionGenerationError;
        follower.creativeSharedWith = group.filter((item) => item !== follower).map((item) => item.contentId);
      }
    }
    // A Reels slot only ever publishes for real with an actual video (Meta
    // rejects a static image for that channel) — animate it right away
    // instead of leaving that as a manual follow-up step, the same way
    // caption writing already rides along with image generation above.
    // Works for a Reels leader or a Reels follower alike, since followers
    // just inherited a real AI image from the leader above.
    if (typeof options.videoAnimator === 'function') {
      for (const item of group) {
        if (item.channel !== 'instagram_reels' || item.image?.generatedSource !== 'ai') continue;
        try {
          await attachReelsVideo(item, project, options.videoAnimator);
          item.videoGenerationError = null;
        } catch (err) {
          item.videoGenerationError = err.message;
        }
      }
    }
    for (const item of group) {
      item.image.generating = false;
      item.updatedAt = new Date().toISOString();
      await writeJson(item.filePath, item);
    }
  });
}

// Runs the "Agente Redator" for one card, replacing the buildCaptionDraft
// skeleton with a real finished caption when a captionGenerator is
// injected. Failure keeps the skeleton — a card shouldn't lose its draft
// caption because the copy call had a transient error.
async function writeAiCaptionForItem(item, project, options) {
  if (typeof options.captionGenerator !== 'function') return;
  try {
    const text = await options.captionGenerator({ content: item, project, note: options.note });
    if (text) {
      item.caption.text = text;
      item.caption.generatedSource = 'ai';
      item.captionGenerationError = null;
    } else {
      // A generator that resolves without throwing but returns nothing
      // (empty Hermes response, timeout swallowed upstream, etc.) used to
      // leave the fill-in-the-blank skeleton in place with no error
      // recorded anywhere — the card looked "done" but showed template
      // text like "[criar chamada curta...]" straight to the client.
      item.captionGenerationError = 'O redator de IA não retornou uma legenda (resposta vazia). O rascunho abaixo ainda não foi revisado — regenere o dia para tentar de novo.';
    }
  } catch (err) {
    item.captionGenerationError = err.message;
  }
}

// Kicks off real image generation for a freshly created batch without
// blocking the HTTP response that returned it — a week of Feed+Story cards
// can take minutes end to end, so the panel gets the placeholder batch back
// immediately and polls the content list for per-card progress instead of
// the request hanging until every image finishes.
export function enqueueBatchImageGeneration(projectId, batch, options = {}, targetDir = process.cwd()) {
  if (typeof options.imageGenerator !== 'function') return;
  const paths = getCentralPaths(targetDir, projectId);
  loadProject(paths)
    .then((project) => enrichBatchItemsWithRealImages(batch, project, projectId, options))
    .catch((err) => {
      // Best-effort background job — surface nothing synchronously; a
      // project-load failure here would already have failed the request
      // that created the batch.
      console.error(`[content-central] background image generation failed for ${projectId}/${batch.batchId}:`, err.message);
    });
}

export function enqueueAdCreativeImageGeneration(projectId, adCreative, options = {}, targetDir = process.cwd()) {
  if (typeof options.imageGenerator !== 'function') return;
  const paths = getCentralPaths(targetDir, projectId);
  loadProject(paths)
    .then((project) => enrichAdCreativeWithRealImage(adCreative, project, projectId, options))
    .catch((err) => {
      console.error(`[content-central] background ad-creative generation failed for ${projectId}/${adCreative.adCreativeId}:`, err.message);
    });
}

export async function generateContentSchedulePlan(projectId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const globalRules = await loadGlobalRules(getCentralPaths(targetDir));
  const days = Number(options.days || project.contentSettings.defaultDaysToGenerate || 7);
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    throw new Error('Days must be an integer between 1 and 60');
  }

  const startDate = options.startDate || formatDate(new Date());
  const formats = normalizeScheduleFormats(options.formats || []);
  const contentRules = Array.isArray(options.contentRules) ? options.contentRules : [];
  const topicCount = await contentTopicCount(project, { groupIds: options.groupIds, offersOnly: options.offersOnly }, targetDir);
  if (options.offersOnly && !topicCount) {
    throw new Error('O(s) grupo(s) selecionado(s) não têm nenhuma oferta ativa — nada pra gerar com "só esse grupo" marcado.');
  }
  const topicOffset = normalizeTopicIndex(
    options.topicOffset !== undefined ? options.topicOffset : project.contentStrategy?.nextScheduleTopicIndex,
    topicCount
  );
  const batchId = `${startDate}-${String(days).padStart(2, '0')}d-plano-formatos`;
  const batchDir = join(paths.draftsDir, batchId);
  const imageDir = join(batchDir, 'images');
  const createdAt = new Date().toISOString();
  const batch = {
    batchId,
    projectId: project.projectId,
    createdAt,
    days,
    startDate,
    formats,
    items: [],
  };

  await mkdir(imageDir, { recursive: true });

  // Channels with the same pixel shape (Story/Reels/Facebook Story are all
  // 9:16; Feed/Facebook Feed are both 4:5) get paired up by day+slot below so
  // they can later share a single AI-generated creative instead of each
  // burning its own generation call — see creativeShapeGroupForChannel().
  // Pairing on the topic here (not just the image later) matters: siblings
  // must depict the same offer/subject or a "shared" image would show one
  // offer while the caption talks about another.
  const topicByCreativeGroupKey = new Map();
  // When the project has active pillars, topic selection becomes a two-step
  // pick: which pillar this slot represents (weighted rotation, never two
  // "convida" pillars back to back), then which topic within that pillar's
  // matching offers/goals — reusing the same flat topicCursor for the
  // within-pillar pick so no extra persisted cursor is needed per pillar.
  // Projects without pillars configured fall through to the original flat
  // round-robin untouched.
  const activePillars = normalizeProjectPillars(project.contentStrategy?.pillars || [])
    .filter((pillar) => pillar.active !== false);
  const pillarSequence = activePillars.length ? buildPillarRotationSequence(activePillars) : [];
  let pillarCursor = normalizeTopicIndex(project.contentStrategy?.nextPillarSequenceIndex, pillarSequence.length || 1);
  let topicCursor = topicOffset;
  async function nextContentTopic(channel, creativeGroupKey, weekday) {
    if (creativeGroupKey && topicByCreativeGroupKey.has(creativeGroupKey)) {
      return topicByCreativeGroupKey.get(creativeGroupKey);
    }
    let topic;
    if (pillarSequence.length) {
      const pillar = pillarSequence[pillarCursor % pillarSequence.length];
      pillarCursor += 1;
      const pool = await buildTopicPool(project, { groupIds: options.groupIds, offersOnly: options.offersOnly, weekday }, targetDir);
      const matching = pool.filter((candidate) => resolveTopicPillar(candidate, activePillars)?.id === pillar.id);
      const bucket = matching.length ? matching : pool;
      const raw = bucket[topicCursor % bucket.length];
      topicCursor += 1;
      topic = {
        ...raw,
        channel: channel || '',
        sequence: topicCursor,
        pillar: pillarSnapshotFrom(pillar),
      };
    } else {
      topic = await buildContentTopic(project, topicCursor, { channel, groupIds: options.groupIds, offersOnly: options.offersOnly, weekday }, targetDir);
      topicCursor += 1;
    }
    if (creativeGroupKey) topicByCreativeGroupKey.set(creativeGroupKey, topic);
    return topic;
  }

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const dayNumber = dayIndex + 1;
    const scheduledDate = addDays(startDate, dayIndex);
    const weekday = weekdayFromDate(scheduledDate);
    for (const format of formats) {
      if (dayIndex % format.everyDays !== 0) continue;
      for (let slotIndex = 0; slotIndex < format.postsPerDay; slotIndex += 1) {
        const slotNumber = slotIndex + 1;
        const scheduledTime = addMinutesToTime(format.startTime, slotIndex * format.intervalMinutes);
        const dimensions = imageDimensionsForChannel(format.channel);
        const aspectRatio = imageAspectRatioForChannel(format.channel);
        const shapeGroup = creativeShapeGroupForChannel(format.channel);
        const creativeGroupKey = shapeGroup ? `${scheduledDate}::${shapeGroup}::slot${slotIndex}` : null;
        const contentTopic = { ...(await nextContentTopic(format.channel, creativeGroupKey, weekday)), channel: format.channel };
        const contentId = `${project.projectId}-${scheduledDate}-${format.channel}-${String(slotNumber).padStart(2, '0')}`;
        const fileName = `day-${String(dayNumber).padStart(2, '0')}-${format.channel}-${String(slotNumber).padStart(2, '0')}`;
        const filePath = join(batchDir, `${fileName}.json`);
        const imageLocalPath = `content/drafts/${batchId}/images/${fileName}.svg`;
        const ruleLabel = `${format.label}: ${format.postsPerDay}x por dia, a cada ${format.everyDays} dia(s), intervalo ${format.intervalMinutes} min.`;
        const item = {
          schemaVersion: 1,
          contentId,
          projectId: project.projectId,
          batchId,
          dayNumber,
          slotNumber,
          scheduledDate,
          scheduledTime,
          channel: format.channel,
          formatLabel: format.label,
          contentTopic,
          creativeGroupKey,
          creativeSharedWith: null,
          contentReview: buildContentReview({ channel: format.channel, aspectRatio, dimensions, contentTopic }),
          status: 'draft_generated',
          title: `Dia ${dayNumber} · ${format.label} ${slotNumber}/${format.postsPerDay} — ${project.name}`,
          image: {
            localPath: imageLocalPath,
            prompt: buildImagePrompt(project, globalRules.rules, [...contentRules, ruleLabel], dayNumber, { channel: format.channel, formatLabel: format.label, contentTopic, logoReference: getProjectLogoReference(project, paths) }),
            references: buildImageReferencePayload(project, paths),
            aspectRatio,
            dimensions,
            generated: true,
            mimeType: 'image/svg+xml',
            version: 1,
          },
          caption: {
            text: buildCaptionDraft(project, dayNumber, contentTopic),
            version: 1,
          },
          dayRules: [],
          scheduleRule: { ...format },
          generationContext: {
            globalRules: globalRules.rules.map((rule) => rule.text),
            projectRules: [...project.rules.project],
            contentRules: [...contentRules, ruleLabel],
          },
          approval: {
            required: project.mode !== 'automatic',
            emailSentAt: null,
            approvedAt: null,
            approvalSource: null,
          },
          publish: {
            publishedAt: null,
            metaMediaId: null,
            error: null,
          },
          filePath,
          createdAt,
          updatedAt: createdAt,
        };
        item.image.previewDataUrl = await writeGeneratedImage(join(paths.projectDir, imageLocalPath), item, project);
        await writeJson(filePath, item);
        batch.items.push(item);
      }
    }
  }

  batch.items.sort((a, b) => {
    const dateOrder = a.scheduledDate.localeCompare(b.scheduledDate);
    const timeOrder = dateOrder || a.scheduledTime.localeCompare(b.scheduledTime);
    return timeOrder || a.contentId.localeCompare(b.contentId);
  });
  await writeJson(join(batchDir, 'batch.json'), batch);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    nextScheduleTopicIndex: normalizeTopicIndex(topicCursor, topicCount),
    nextPillarSequenceIndex: normalizeTopicIndex(pillarCursor, pillarSequence.length || 1),
  };
  await writeJson(paths.projectPath, project);
  return batch;
  });
}

// Same checks buildContentReview does for a photo/price safety net, scoped
// to what actually matters for a catalog product card — no CTA/pillar/type
// checks, since catalog mode has none of those concepts.
function buildCatalogContentReview({ contentTopic }) {
  const checks = [];
  const warnings = [];
  if (contentTopic?.photoReferenceIds?.length) checks.push(`${contentTopic.photoReferenceIds.length} foto(s) real(is) do produto anexada(s).`);
  else warnings.push('Produto sem foto anexada — a peça sai só com preço, sem imagem do produto.');
  if (contentTopic?.price) checks.push('Preço cadastrado.');
  else warnings.push('Produto sem preço cadastrado; não inventar preço na peça.');
  return { status: warnings.length ? 'warning' : 'ok', checks, warnings };
}

// Parallel to generateContentSchedulePlan, deliberately simpler: catalog
// projects (venda direta — celular, carro, etc.) don't have formats,
// pilares, brand goals or AI art — every day just posts the next N active
// products to Instagram Story, cycling through the catalog so every active
// item gets featured with roughly equal frequency over time. Kept as its
// own function instead of branching the marketing-mode generator so the
// (much more complex, already-tested) marketing path stays untouched.
export async function generateCatalogSchedulePlan(projectId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const days = Number(options.days || project.contentSettings.defaultDaysToGenerate || 7);
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    throw new Error('Days must be an integer between 1 and 60');
  }
  const storiesPerDay = Math.max(1, Math.min(20, Number(options.storiesPerDay || project.contentSettings.catalogStoriesPerDay || 3)));
  const startTime = normalizeTime(options.startTime || project.contentSettings.defaultPostTime || DEFAULT_TIME);
  const intervalMinutes = Math.max(0, Number(options.intervalMinutes || 90));

  const activeProducts = normalizeProjectOffers(project.contentStrategy?.offers || [])
    .filter((offer) => offer.active !== false);
  if (!activeProducts.length) {
    throw new Error('Cadastre pelo menos um produto ativo (com foto) antes de gerar o cronograma.');
  }

  const startDate = options.startDate || formatDate(new Date());
  const batchId = `${startDate}-${String(days).padStart(2, '0')}d-catalogo`;
  const batchDir = join(paths.draftsDir, batchId);
  const imageDir = join(batchDir, 'images');
  const createdAt = new Date().toISOString();
  const batch = {
    batchId,
    projectId: project.projectId,
    createdAt,
    days,
    startDate,
    formats: [{ channel: 'instagram_story', label: 'Instagram Story', postsPerDay: storiesPerDay, everyDays: 1, startTime, intervalMinutes }],
    items: [],
  };

  await mkdir(imageDir, { recursive: true });

  let productCursor = normalizeTopicIndex(project.contentStrategy?.nextCatalogTopicIndex, activeProducts.length);
  const channel = 'instagram_story';
  const dimensions = imageDimensionsForChannel(channel);
  const aspectRatio = imageAspectRatioForChannel();

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const dayNumber = dayIndex + 1;
    const scheduledDate = addDays(startDate, dayIndex);
    for (let slotIndex = 0; slotIndex < storiesPerDay; slotIndex += 1) {
      const slotNumber = slotIndex + 1;
      const scheduledTime = addMinutesToTime(startTime, slotIndex * intervalMinutes);
      const product = activeProducts[productCursor % activeProducts.length];
      productCursor += 1;
      const contentTopic = { ...(await offerToContentTopic(product, targetDir)), channel };
      const contentId = `${project.projectId}-${scheduledDate}-${channel}-${String(slotNumber).padStart(2, '0')}`;
      const fileName = `day-${String(dayNumber).padStart(2, '0')}-${channel}-${String(slotNumber).padStart(2, '0')}`;
      const filePath = join(batchDir, `${fileName}.json`);
      const imageLocalPath = `content/drafts/${batchId}/images/${fileName}.svg`;
      const item = {
        schemaVersion: 1,
        contentId,
        projectId: project.projectId,
        batchId,
        dayNumber,
        slotNumber,
        scheduledDate,
        scheduledTime,
        channel,
        formatLabel: 'Instagram Story',
        contentTopic,
        creativeGroupKey: null,
        creativeSharedWith: null,
        contentReview: buildCatalogContentReview({ contentTopic }),
        status: 'draft_generated',
        title: `Dia ${dayNumber} · Estoque ${slotNumber}/${storiesPerDay} — ${product.name}`,
        image: {
          localPath: imageLocalPath,
          prompt: 'Composição local: foto real do produto + nome/preço, sem geração por IA.',
          references: [],
          aspectRatio,
          dimensions,
          generated: true,
          mimeType: 'image/svg+xml',
          version: 1,
        },
        caption: {
          text: buildCaptionDraft(project, dayNumber, contentTopic),
          version: 1,
        },
        dayRules: [],
        scheduleRule: { channel, label: 'Instagram Story', postsPerDay: storiesPerDay, everyDays: 1, startTime, intervalMinutes },
        generationContext: { globalRules: [], projectRules: [...project.rules.project], contentRules: [] },
        approval: {
          required: project.mode !== 'automatic',
          emailSentAt: null,
          approvedAt: null,
          approvalSource: null,
        },
        publish: {
          publishedAt: null,
          metaMediaId: null,
          error: null,
        },
        filePath,
        createdAt,
        updatedAt: createdAt,
      };
      item.image.previewDataUrl = await writeGeneratedImage(join(paths.projectDir, imageLocalPath), item, project);
      await writeJson(filePath, item);
      batch.items.push(item);
    }
  }

  batch.items.sort((a, b) => {
    const dateOrder = a.scheduledDate.localeCompare(b.scheduledDate);
    const timeOrder = dateOrder || a.scheduledTime.localeCompare(b.scheduledTime);
    return timeOrder || a.contentId.localeCompare(b.contentId);
  });
  await writeJson(join(batchDir, 'batch.json'), batch);
  project.contentStrategy = {
    ...(project.contentStrategy || {}),
    nextCatalogTopicIndex: normalizeTopicIndex(productCursor, activeProducts.length),
  };
  await writeJson(paths.projectPath, project);
  return batch;
  });
}

// Parallel to enrichBatchItemsWithRealImages, deliberately simpler: catalog
// items never share a creative across channels (Story is the only channel),
// so there's no shape-grouping step — just compose each item's real photo
// locally and, same as marketing mode, let AI write the caption alongside.
// Shared by enrichCatalogItemsWithComposedImages (first generation) and
// applyContentRegeneration's catalog branch ("Regenerar" on an existing
// card) — both need the exact same content.image shape after a successful
// local compose, so the shape only needs to be kept correct in one place.
async function applyCatalogComposedImage(content, project, composer) {
  const result = await composer({ content, project });
  if (!result?.url) throw new Error('A composição local não retornou uma imagem válida.');
  content.image = {
    ...content.image,
    url: result.url,
    mimeType: result.mimeType || 'image/png',
    generated: true,
    generatedSource: 'catalog_compose',
    previewUrl: result.url,
    previewMode: 'direct_ai_css_cover',
    previewFit: 'cover',
  };
  content.imageGenerationError = null;
}

export async function enrichCatalogItemsWithComposedImages(batch, project, projectId, options) {
  if (typeof options.catalogImageComposer !== 'function') return;
  for (const item of batch.items) {
    item.image.generating = true;
    item.updatedAt = new Date().toISOString();
    await writeJson(item.filePath, item);

    const imageWork = applyCatalogComposedImage(item, project, options.catalogImageComposer)
      .catch((err) => { item.imageGenerationError = err.message; });
    const captionWork = writeAiCaptionForItem(item, project, options);
    await Promise.all([imageWork, captionWork]);

    item.image.generating = false;
    item.updatedAt = new Date().toISOString();
    await writeJson(item.filePath, item);
  }
}

// Parallel to enqueueBatchImageGeneration: catalog batches skip the AI image
// pipeline (shape-grouping, image review) entirely — just the local photo
// compositor, plus the same AI caption writer marketing batches already use.
export function enqueueCatalogImageGeneration(projectId, batch, options = {}, targetDir = process.cwd()) {
  if (typeof options.catalogImageComposer !== 'function') return;
  const paths = getCentralPaths(targetDir, projectId);
  loadProject(paths)
    .then((project) => enrichCatalogItemsWithComposedImages(batch, project, projectId, options))
    .catch((err) => {
      // Best-effort background job — surface nothing synchronously; a
      // project-load failure here would already have failed the request
      // that created the batch.
      console.error(`[content-central] background catalog image generation failed for ${projectId}/${batch.batchId}:`, err.message);
    });
}

export async function simulateTestPost(projectId, options = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  // "Teste seguro" only knows how to simulate the marketing-mode AI-art
  // pipeline — a catalog project has no AI art to test, and letting it
  // through would silently burn a real AI image call to invent a fake
  // product instead of using a real uploaded photo. Fail clearly instead.
  if (project.projectType === 'catalog') {
    throw new Error('"Teste seguro" ainda não tem suporte para projetos de catálogo. Gere e revise os cards direto em "Agenda e geração" / "Aguardando aprovação".');
  }
  const topicCount = await contentTopicCount(project, {}, targetDir);
  const topicOffset = project.contentStrategy?.nextTestTopicIndex === undefined
    ? await inferNextTestTopicIndex(paths, project, topicCount, targetDir)
    : normalizeTopicIndex(project.contentStrategy.nextTestTopicIndex, topicCount);
  const channel = options.channel || DEFAULT_CHANNEL;
  const note = options.note ? String(options.note).trim() : '';
  const runSeed = String(options.testSeed || now.toISOString());
  const variation = buildTestCreativeVariation(channel, note, runSeed);
  const batch = await generateContentBatch(projectId, {
    days: 1,
    startDate: options.startDate || formatDate(now),
    channel,
    topicOffset,
    contentRules: [
      note ? `Teste local antes de programar: ${note}` : 'Teste local antes de programar.',
      ...variation.rules,
    ],
  }, targetDir);
  const content = batch.items[0];
  const simulatedAt = now.toISOString();

  content.status = 'test_post_simulated';
  content.publish = {
    ...content.publish,
    dryRun: true,
    realPublished: false,
    simulatedAt,
    simulationNote: note,
    variationSeed: runSeed,
    creativeVariation: variation.summary,
    message: 'Simulação local: conteúdo gerado e marcado como teste. Nenhuma API de publicação foi chamada.',
  };

  if (typeof options.imageGenerator === 'function') {
    await generateAiImageWithReviewLoop(content, project, projectId, {
      imageGenerator: options.imageGenerator,
      imageReviewer: options.imageReviewer,
      note,
      channel,
      now,
      maxAttempts: options.maxCreativeAttempts,
    });
  }

  content.updatedAt = simulatedAt;

  // generateContentBatch above already ran its own load-mutate-write cycle
  // on project.json (advancing nextScheduleTopicIndex) inside its own lock,
  // which has already released by the time we get here — reusing the
  // `project` object loaded at the top of this function would silently
  // overwrite that update with a stale copy. Re-load fresh, inside our own
  // lock, right before this function's own mutation+write.
  return withProjectLock(targetDir, projectId, async () => {
    const freshProject = await loadProject(paths);
    freshProject.contentStrategy = {
      ...(freshProject.contentStrategy || {}),
      offers: normalizeProjectOffers(freshProject.contentStrategy?.offers || []),
      nextTestTopicIndex: normalizeTopicIndex(topicOffset + 1, topicCount),
    };
    freshProject.updatedAt = simulatedAt;

    await writeJson(content.filePath, content);
    await writeJson(join(dirname(content.filePath), 'batch.json'), {
      ...batch,
      items: [content],
    });
    await writeJson(paths.projectPath, freshProject);
    await writeFile(paths.manualPath, buildManual(freshProject), 'utf-8');

    return content;
  });
}

// Mutates `content` in place with a fresh image and/or caption — shared by
// regenerateContentDay (single card) and regenerateContentGroup (a whole
// shared-creative group, where this only ever runs once, on the leader,
// before its result gets copied onto the other members).
async function applyContentRegeneration(content, project, projectId, options, paths = null, targetDir = process.cwd()) {
  const regenerate = options.regenerate || 'all';
  if (options.note) content.dayRules.push(options.note);
  let creativeRegenerated = false;
  if (regenerate === 'creative' || regenerate === 'all') {
    content.image.version += 1;
    // content.contentTopic and content.image.references are snapshots taken
    // when this content was first generated — if the operator has since
    // attached a real photo to the offer (or fixed its price/name), those
    // snapshots are stale and regenerating would silently keep ignoring the
    // update. Refresh both from the project's current live state first, so
    // "regenerar" always reflects what's actually cadastrado right now.
    if (content.contentTopic?.source === 'offer' && content.contentTopic.offerId) {
      const currentOffer = (project.contentStrategy?.offers || []).find(
        (offer) => offer.id === content.contentTopic.offerId
      );
      if (currentOffer) content.contentTopic = await offerToContentTopic(currentOffer, targetDir);
    }
    if (paths) content.image.references = buildImageReferencePayload(project, paths);
    if (project.projectType === 'catalog') {
      // Catalog cards never go through AI art, including on regenerate —
      // "regenerating" just recomposes the same real photo again (useful
      // after fixing the photo/price/name on the product itself).
      if (typeof options.catalogImageComposer === 'function') {
        try {
          await applyCatalogComposedImage(content, project, options.catalogImageComposer);
          creativeRegenerated = true;
        } catch (err) {
          content.imageGenerationError = err.message;
        }
      } else {
        content.image.prompt = `${content.image.prompt}\n\nAjuste solicitado: ${options.note || 'gerar nova composição.'}`;
      }
    } else if (typeof options.imageGenerator === 'function') {
      try {
        await generateAiImageWithReviewLoop(content, project, projectId, {
          imageGenerator: options.imageGenerator,
          imageReviewer: options.imageReviewer,
          channel: content.channel,
          note: options.note || 'Gerar uma nova abordagem visual, diferente da anterior.',
          maxAttempts: options.maxCreativeAttempts,
          // An operator-typed correction (vs. the "try something different"
          // fallback above) means "fix this one thing", not "start over" —
          // let the review loop pass the existing image through as an edit
          // base on its first attempt instead of composing a new piece from
          // scratch, so the rest of the creative doesn't drift.
          targetedEdit: Boolean(options.note),
        });
        content.imageGenerationError = null;
        creativeRegenerated = true;
      } catch (err) {
        content.imageGenerationError = err.message;
      }
    } else {
      content.image.prompt = `${content.image.prompt}\n\nAjuste solicitado: ${options.note || 'gerar nova abordagem visual.'}`;
    }
  }
  if (regenerate === 'caption' || regenerate === 'all') {
    content.caption.version += 1;
    if (typeof options.captionGenerator === 'function') {
      try {
        const text = await options.captionGenerator({
          content,
          project,
          note: options.note || 'Reescrever com uma abordagem nova, diferente da anterior.',
        });
        if (text) {
          content.caption.text = text;
          content.caption.generatedSource = 'ai';
          content.captionGenerationError = null;
        } else {
          content.captionGenerationError = 'O redator de IA não retornou uma legenda (resposta vazia). O rascunho abaixo ainda não foi revisado — regenere o dia para tentar de novo.';
        }
      } catch (err) {
        content.captionGenerationError = err.message;
      }
    } else {
      content.caption.text = `${content.caption.text}\n\n[Revisão solicitada: ${options.note || 'ajustar legenda.'}]`;
    }
  }

  content.status = 'regenerated';
  content.updatedAt = new Date().toISOString();
  return { creativeRegenerated };
}

export async function regenerateContentDay(projectId, contentId, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, options.batchId);
  const content = await readJson(contentPath);

  const { creativeRegenerated } = await applyContentRegeneration(content, project, projectId, options, paths, targetDir);
  if (creativeRegenerated) {
    // A fresh, independently-generated image no longer matches whatever
    // sibling cards it used to share a creative with (if any) — clear
    // the link on both sides so their "mesmo criativo" badge doesn't
    // keep pointing at content that has since diverged.
    await unlinkCreativeSharing(paths, content);
  }

  await writeJson(contentPath, content);
  if (typeof options.queueSync === 'function') {
    await options.queueSync('remove', { projectId, contentId: content.contentId });
  }
  return content;
}

// Regenerates a whole shared-creative group (see creativeGroupKey) in one
// shot: the AI only runs once, on the leader (first contentId), and the
// result is copied onto the rest — same "one image, N channels" contract
// enrichBatchItemsWithRealImages already gives a freshly generated batch,
// now available on demand for an existing group too. Without this, the only
// way to "fix" a shared creative was to regenerate each member separately,
// which (correctly, per regenerateContentDay above) unlinks them from each
// other — turning one shared image into three different ones.
export async function regenerateContentGroup(projectId, contentIds, options = {}, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  const ids = Array.isArray(contentIds) ? contentIds.filter(Boolean) : [];
  if (!ids.length) throw new Error('Nenhum conteúdo informado para regenerar.');

  const entries = [];
  for (const id of ids) {
    const contentPath = await findContentPath(paths.draftsDir, id, options.batchId);
    entries.push({ contentPath, content: await readJson(contentPath) });
  }

  const [leaderEntry, ...followerEntries] = entries;
  const leader = leaderEntry.content;
  await applyContentRegeneration(leader, project, projectId, options, paths, targetDir);

  const regenerate = options.regenerate || 'all';
  const allContentIds = entries.map((entry) => entry.content.contentId);
  leader.creativeSharedWith = followerEntries.length
    ? followerEntries.map((entry) => entry.content.contentId)
    : null;

  for (const followerEntry of followerEntries) {
    const follower = followerEntry.content;
    if (regenerate === 'creative' || regenerate === 'all') {
      follower.image = { ...leader.image };
      follower.imageGenerationError = leader.imageGenerationError;
      follower.creativePreflight = leader.creativePreflight;
      follower.creativeReviewAttempts = leader.creativeReviewAttempts;
      follower.creativeReview = leader.creativeReview;
      follower.contentReview = leader.contentReview;
    }
    if (regenerate === 'caption' || regenerate === 'all') {
      follower.caption = { ...leader.caption };
      follower.captionGenerationError = leader.captionGenerationError;
    }
    follower.creativeSharedWith = allContentIds.filter((id) => id !== follower.contentId);
    follower.status = 'regenerated';
    follower.updatedAt = leader.updatedAt;
  }

  for (const entry of entries) {
    await writeJson(entry.contentPath, entry.content);
    if (typeof options.queueSync === 'function') {
      await options.queueSync('remove', { projectId, contentId: entry.content.contentId });
    }
  }
  return entries.map((entry) => entry.content);
}

export async function buildApprovalPayload(projectId, contentId, targetDir = process.cwd(), batchId) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const content = await readJson(contentPath);
  if (content.creativeReview?.status === 'blocked' || content.contentReview?.status === 'blocked') {
    throw new Error('Revisor de Criativo bloqueou este card. Corrija/regere a imagem antes de preparar aprovação.');
  }
  const fileName = `${content.contentId}-approval.json`;
  const jsonPath = join(paths.approvalsDir, fileName);
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    projectId: project.projectId,
    contentId: content.contentId,
    status: 'aguardando_aprovacao',
    createdAt: now,
    target: {
      projectName: project.name,
      handle: project.instagram.handle,
      channel: content.channel,
      scheduledDate: content.scheduledDate,
      scheduledTime: content.scheduledTime,
    },
    creative: {
      imageLocalPath: content.image.localPath,
      imagePrompt: content.image.prompt,
      caption: content.caption.text,
    },
    approval: {
      email: project.approvalEmail,
      requiredPhrase: 'APROVADO',
      cancelPhrase: 'CANCELAR',
      instructions: 'Responda APROVADO para publicar/agendar este conteúdo. Sem aprovação, nada é publicado.',
    },
    files: {
      json: jsonPath,
    },
  };

  await mkdir(paths.approvalsDir, { recursive: true });
  await writeJson(jsonPath, payload);

  content.status = 'aguardando_aprovacao';
  content.approval.emailPreparedAt = now;
  content.updatedAt = now;
  await writeJson(contentPath, content);

  return payload;
}

// Marks a card approved by the client — the final step before it counts as
// scheduled/ready to publish. Content stays on disk under drafts/<batch>;
// only `status` and `approval.approvedAt` change, so the "Aprovado" tab is a
// status filter over the same content list, not a physical file move.
export async function approveContent(projectId, contentId, targetDir = process.cwd(), batchId, options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const content = await readJson(contentPath);
  const now = new Date().toISOString();

  content.status = 'aprovado';
  content.approval.approvedAt = now;
  content.approval.approvalSource = 'operator_panel';
  if (typeof options.mediaUploader === 'function') {
    // A hosting hiccup (imgBB/Catbox) must not fail the whole approve or
    // hold the project lock for the upload's duration — the item still gets
    // marked aprovado, just without a public mediaUrl yet (queueSync then
    // pushes it with mediaUrl: null, a visible degraded state the operator
    // can retry, e.g. by re-approving).
    try {
      content.publish = { ...content.publish, mediaUrl: await options.mediaUploader(content) };
    } catch (err) {
      content.publish = { ...content.publish, mediaUrl: null, mediaUploadError: err.message };
    }
  }
  content.updatedAt = now;
  await writeJson(contentPath, content);

  project.learnings.approved = [
    summarizeApprovedLearning(content),
    ...project.learnings.approved,
  ].slice(0, MAX_LEARNING_ENTRIES);
  project.updatedAt = now;
  await writeJson(paths.projectPath, project);
  await addSegmentLearning(paths, project, 'approved', summarizeApprovedLearning(content));
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');

  if (typeof options.queueSync === 'function') {
    await options.queueSync('upsert', {
      projectId,
      contentId: content.contentId,
      data: {
        channel: content.channel,
        caption: content.caption.text,
        mediaUrl: content.publish?.mediaUrl || null,
        scheduledDate: content.scheduledDate,
        scheduledTime: content.scheduledTime,
      },
    });
  }

  return content;
  });
}

function summarizeApprovedLearning(content) {
  const subject = content.contentTopic?.offerName || content.contentTopic?.label || content.title || 'Post';
  const channel = CHANNEL_LABELS[content.channel] || content.channel;
  return `${subject} (${channel}, ${content.scheduledDate}): aprovado.`;
}

// A manual tweak to an otherwise-good caption ("Regenerar dia" rewrites the
// whole thing from scratch via AI) — saves the operator's own edited text
// directly, without touching the image or going through the caption
// generator at all.
export async function updateContentCaption(projectId, contentId, text, targetDir = process.cwd(), batchId) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error('Legenda não pode ficar vazia');

  const paths = getCentralPaths(targetDir, projectId);
  await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const content = await readJson(contentPath);
  const now = new Date().toISOString();

  content.caption.text = trimmed;
  content.caption.generatedSource = 'operator_edit';
  content.caption.version = (content.caption.version || 1) + 1;
  content.captionGenerationError = null;
  content.updatedAt = now;
  await writeJson(contentPath, content);

  return content;
}

// Scans every project for approved content whose scheduled date/time has
// already arrived and hasn't been published yet, then publishes each one in
// turn via the injected `metaPublisher` (the real Graph API caller lives in
// content-central-server.js — this stays pure domain logic, testable with a
// fake publisher). Sequential on purpose: publishing isn't parallelized
// across items to stay under Meta's rate limits, and each item gets its own
// try/catch — one failure doesn't block the rest of the queue, since each
// card here is an independent scheduled post (not one post fanned out
// across channels like the old squad's publisher assumed).
//
// Only the earliest due (scheduledDate, scheduledTime) slot is published per
// call — confirmed live (2026-08-08) that the scheduler only runs while this
// server process is alive (a plain setInterval, not a real background
// service), so any downtime (laptop asleep, terminal closed, a restart to
// pick up a code change) lets several slots go overdue at once; publishing
// every overdue slot in one sweep dumped multiple different Stories onto the
// client's Instagram within the same second, which read as spam/duplicates.
// Channels intentionally scheduled together (e.g. an Instagram + Facebook
// Story sharing one creative at the same slot) still publish together since
// they share the same slot key — only *different* slots get spread across
// separate sweep cycles instead of bursting out together.
export async function runDuePublishSweep(targetDir = process.cwd(), options = {}) {
  if (typeof options.metaPublisher !== 'function') return { published: [], failed: [] };
  const now = options.now || new Date();
  const published = [];
  const failed = [];

  const projects = await listCentralProjects(targetDir);
  for (const projectSummary of projects) {
    const projectId = projectSummary.projectId;
    const content = await listProjectContent(projectId, targetDir);
    const due = content
      .filter((item) => item.status === 'aprovado' && !item.publish?.realPublished && isPublishDue(item, now))
      .sort((a, b) => (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime));

    const earliestSlotKey = due.length ? due[0].scheduledDate + due[0].scheduledTime : null;
    const dueInEarliestSlot = due.filter((item) => item.scheduledDate + item.scheduledTime === earliestSlotKey);

    for (const item of dueInEarliestSlot) {
      const ok = await publishOneItem(item, projectSummary, options.metaPublisher, now);
      (ok ? published : failed).push(ok ? item.contentId : { contentId: item.contentId, error: item.publish.error });
    }
  }

  return { published, failed };
}

async function publishOneItem(item, projectSummary, metaPublisher, now) {
  // Idempotency guard: if a previous attempt's real publish already
  // succeeded but the caller's follow-up (e.g. the gaveta push in
  // publishWithGaveteSync) failed and surfaced as an error, a retry must
  // not call metaPublisher again — that would post a real duplicate.
  // runDuePublishSweep already pre-filters to !realPublished before ever
  // calling this, so this is a no-op for it; it only matters for
  // publishSingleContent's manual retry path.
  if (item.publish?.realPublished) return true;
  try {
    const result = await metaPublisher({ content: item, project: projectSummary });
    item.publish = {
      ...item.publish,
      realPublished: true,
      publishedAt: now.toISOString(),
      metaMediaId: result?.mediaId || null,
      permalink: result?.permalink || null,
      error: null,
    };
    item.updatedAt = now.toISOString();
    await writeJson(item.filePath, item);
    return true;
  } catch (err) {
    item.publish = { ...item.publish, error: err.message };
    item.updatedAt = now.toISOString();
    await writeJson(item.filePath, item);
    return false;
  }
}

// Manual/one-off publish for a single card — used by the "Publicar agora" /
// "Tentar de novo" action, bypassing the scheduled-time check that
// runDuePublishSweep applies (an explicit click means the operator wants it
// published now, regardless of the card's scheduled time).
export async function publishSingleContent(projectId, contentId, targetDir = process.cwd(), options = {}, batchId) {
  if (typeof options.metaPublisher !== 'function') throw new Error('Nenhum publicador configurado.');
  const paths = getCentralPaths(targetDir, projectId);
  await loadProject(paths);
  const projects = await listCentralProjects(targetDir);
  const projectSummary = projects.find((entry) => entry.projectId === projectId);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const item = await readJson(contentPath);

  const ok = await publishOneItem(item, projectSummary, options.metaPublisher, options.now || new Date());
  if (!ok) throw new Error(item.publish.error);
  return item;
}

// Called by publishWithGaveteSync when the pulled gaveta queue item already
// shows realPublished: true — GitHub Actions' hourly sweep beat the operator
// to it. Syncs that outcome onto the local content record instead of
// publishing again (which would be a real duplicate post). Mirrors the shape
// publishOneItem writes on a successful publish.
export async function applyExternalPublishResult(projectId, contentId, targetDir, batchId, publishResult) {
  const paths = getCentralPaths(targetDir, projectId);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const item = await readJson(contentPath);
  item.publish = {
    ...item.publish,
    realPublished: true,
    publishedAt: publishResult.publishedAt,
    metaMediaId: publishResult.metaMediaId,
    permalink: publishResult.permalink,
    error: null,
  };
  item.updatedAt = new Date().toISOString();
  await writeJson(item.filePath, item);
  return item;
}

function isPublishDue(item, now) {
  if (!item.scheduledDate) return false;
  const dueAt = new Date(`${item.scheduledDate}T${item.scheduledTime || '00:00'}:00`);
  return !Number.isNaN(dueAt.getTime()) && dueAt <= now;
}

// Read-only listing that never creates the projects/secrets/approvals tree
// or a fresh global-rules.json — unlike listCentralProjects(), which
// intentionally auto-provisions that structure for the real "/api/state"
// route so a brand new install just works. Background/startup checks
// (system alerts, the interrupted-generation sweep) have no reason to
// force that write into existence just to discover there's nothing to do,
// and doing so anyway on every server boot was hitting a Windows rmdir
// race in tests that never otherwise touch the filesystem.
async function readExistingProjectIds(targetDir) {
  const paths = getCentralPaths(targetDir);
  let entries;
  try {
    entries = await readdir(paths.projectsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

export async function listCentralProjects(targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir);
  await ensureBase(paths);

  const entries = await readdir(paths.projectsDir, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const project = await readJson(join(paths.projectsDir, entry.name, 'project.json'), null);
    if (project) projects.push(await toProjectSummary(project, paths));
  }

  return projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

// Rolls up things the operator would otherwise only notice by opening each
// project one by one: a Meta token expired/about to expire, or a scheduled
// post that failed to publish and is still sitting there unresolved.
// "Sem token configurado" and "sem validade" (permanent token) are not
// alerts — only 'expirado'/'vence_em_breve' are, matching the same status
// saveProjectToken already computes.
export async function listSystemAlerts(targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir);
  const projectIds = await readExistingProjectIds(targetDir);
  const projects = [];
  for (const projectId of projectIds) {
    const raw = await readJson(join(paths.projectsDir, projectId, 'project.json'), null);
    if (raw) projects.push(await toProjectSummary(raw, paths));
  }
  const alerts = [];

  for (const project of projects) {
    if (project.token?.status === 'expirado') {
      alerts.push({
        type: 'token_expired',
        projectId: project.projectId,
        projectName: project.name,
        message: 'Token da Meta expirado — publicação real vai falhar até renovar.',
      });
    } else if (project.token?.status === 'vence_em_breve' && Number.isFinite(project.token.daysRemaining)) {
      alerts.push({
        type: 'token_expiring',
        projectId: project.projectId,
        projectName: project.name,
        message: `Token da Meta vence em ${project.token.daysRemaining} dia(s).`,
      });
    }

    const content = await listProjectContent(project.projectId, targetDir);
    for (const item of content) {
      if (!item.publish?.error || item.publish?.realPublished) continue;
      const subject = item.contentTopic?.offerName || item.contentTopic?.label || item.title || item.contentId;
      const channel = CHANNEL_LABELS[item.channel] || item.channel;
      alerts.push({
        type: 'publish_failed',
        projectId: project.projectId,
        projectName: project.name,
        contentId: item.contentId,
        batchId: item.batchId,
        message: `Falha ao publicar "${subject}" (${channel}): ${item.publish.error}`,
      });
    }
  }

  return alerts;
}

function alertNotificationKey(alert) {
  return alert.contentId ? `${alert.type}:${alert.projectId}:${alert.contentId}` : `${alert.type}:${alert.projectId}`;
}

function alertEmailSubject(alert) {
  const icon = alert.type === 'token_expired' ? '🔴' : alert.type === 'token_expiring' ? '🟡' : '⚠️';
  const topic = alert.type === 'publish_failed' ? 'falha ao publicar' : 'token da Meta';
  return `${icon} [Opensquad] ${alert.projectName} — ${topic}`;
}

function alertEmailBody(alert) {
  return `${alert.message}\n\nProjeto: ${alert.projectName} (${alert.projectId})\n\nAbra o painel do Content Central para resolver.`;
}

// Emails the operator once per distinct issue instead of on every sweep tick
// (the alert itself is recomputed fresh every time listSystemAlerts runs, so
// without this a token expiring in N days would re-email every few minutes
// forever). A per-alert-key cooldown re-notifies periodically while the
// issue is still open (it gets more urgent as a token's expiry approaches),
// and dropping keys for alerts that disappeared means a resolved-then-
// recurring issue re-notifies immediately instead of waiting out a stale
// cooldown from before it was fixed.
export async function sendDueAlertEmails(targetDir = process.cwd(), options = {}) {
  if (typeof options.emailSender !== 'function') return { sent: [] };
  const alerts = await listSystemAlerts(targetDir);
  const paths = getCentralPaths(targetDir);
  const statePath = join(paths.root, 'alert-notifications.json');
  const notified = await readJson(statePath, {});
  const now = options.now || new Date();
  const cooldownMs = Math.max(0, Number(options.cooldownHours ?? 24)) * 60 * 60 * 1000;
  const sent = [];

  for (const alert of alerts) {
    const key = alertNotificationKey(alert);
    const lastSentAt = notified[key] ? new Date(notified[key]) : null;
    if (lastSentAt && !Number.isNaN(lastSentAt.getTime()) && now.getTime() - lastSentAt.getTime() < cooldownMs) continue;
    await options.emailSender({ subject: alertEmailSubject(alert), body: alertEmailBody(alert), alert });
    notified[key] = now.toISOString();
    sent.push(alert);
  }

  const activeKeys = new Set(alerts.map(alertNotificationKey));
  for (const key of Object.keys(notified)) {
    if (!activeKeys.has(key)) delete notified[key];
  }
  await writeJson(statePath, notified);

  return { sent };
}

// Image generation runs as a detached background promise the HTTP response
// never awaits (enqueueBatchImageGeneration) — if the server process is
// restarted (deploy, crash, manual bounce) while one is mid-flight, the
// item's `image.generating: true` flag is the last thing that ever got
// written for it: the promise chain died with the old process, so nothing
// ever sets it back to false or records an error. The card is then stuck
// showing "Gerando imagem com IA..." forever, indistinguishable from one
// that's still genuinely in progress. Call this once at server startup —
// any item still "generating" at that point necessarily belongs to a
// previous process, since this one hasn't started any generation yet.
export async function reconcileInterruptedGenerations(targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir);
  let entries;
  try {
    // Reads directly instead of going through listCentralProjects(), which
    // calls ensureBase() and unconditionally creates the whole
    // projects/secrets/approvals tree + a fresh global-rules.json — real
    // side effects this read-mostly startup check has no reason to trigger
    // for an installation (or a test's temp dir) that has no projects yet.
    entries = await readdir(paths.projectsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const fixed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const content = await listProjectContent(entry.name, targetDir);
    for (const item of content) {
      if (!item.image?.generating) continue;
      item.image.generating = false;
      item.imageGenerationError = 'Geração interrompida (o servidor foi reiniciado enquanto a imagem estava sendo criada). Clique em "Regenerar só a imagem" para tentar de novo.';
      item.updatedAt = new Date().toISOString();
      await writeJson(item.filePath, item);
      fixed.push({ projectId: entry.name, contentId: item.contentId });
    }
  }
  return fixed;
}

export async function listProjectContent(projectId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  await loadProject(paths);

  const contents = [];
  let batches;
  try {
    batches = await readdir(paths.draftsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  for (const batch of batches) {
    if (!batch.isDirectory()) continue;
    const batchDir = join(paths.draftsDir, batch.name);
    const files = await readdir(batchDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json') || file.name === 'batch.json') continue;
      const item = await readJson(join(batchDir, file.name), null);
      if (item) contents.push(item);
    }
  }

  return contents.sort((a, b) => {
    const dateOrder = a.scheduledDate.localeCompare(b.scheduledDate);
    const timeOrder = dateOrder || String(a.scheduledTime || '').localeCompare(String(b.scheduledTime || ''));
    return timeOrder || a.contentId.localeCompare(b.contentId);
  });
}

export async function deleteProjectContent(projectId, contentId, targetDir = process.cwd(), batchId, reason, options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const content = await readJson(contentPath);
  const batchPath = join(dirname(contentPath), 'batch.json');
  const batch = await readJson(batchPath, null);

  await rm(contentPath, { force: true });
  if (typeof options.queueSync === 'function') {
    await options.queueSync('remove', { projectId, contentId });
  }
  if (content?.image?.localPath) {
    await rm(safeProjectPath(paths.projectDir, content.image.localPath), { force: true });
  }
  if (content) {
    await removeFromSiblingCreativeGroups(paths, content);
  }
  if (batch?.items) {
    await writeJson(batchPath, {
      ...batch,
      items: batch.items.filter((item) => item.contentId !== contentId),
    });
  }

  const cleanReason = summarizeAvoidLearningReason(content, reason);
  if (cleanReason) {
    const now = new Date().toISOString();
    project.learnings.avoid = [
      summarizeAvoidLearning(content, cleanReason),
      ...project.learnings.avoid,
    ].slice(0, MAX_LEARNING_ENTRIES);
    project.updatedAt = now;
    await writeJson(paths.projectPath, project);
    await addSegmentLearning(paths, project, 'avoid', summarizeAvoidLearning(content, cleanReason));
    await writeFile(paths.manualPath, buildManual(project), 'utf-8');
  }

  return { contentId, deleted: true };
  });
}

function summarizeAvoidLearning(content, reason) {
  const subject = content?.contentTopic?.offerName || content?.contentTopic?.label || content?.title || 'Post';
  const channel = content ? (CHANNEL_LABELS[content.channel] || content.channel) : '';
  return channel ? `${subject} (${channel}): ${reason}` : reason;
}

function summarizeAvoidLearningReason(content, reason) {
  return [creativeReviewAvoidLearning(content), usefulOperatorAvoidReason(reason)].filter(Boolean).join('; ');
}

function usefulOperatorAvoidReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return '';
  const normalized = normalizeComparableText(text);
  if (/(^|\b)(foi )?(apenas )?(um )?teste(\b|$)/.test(normalized)) return '';
  if (/\b(vou|irei|preciso)?\s*(gerar|fazer) outro/.test(normalized)) return '';
  if (/\b(cliente pediu )?(para )?nao postar agora\b/.test(normalized)) return '';
  return text;
}

function creativeReviewAvoidLearning(content) {
  const review = content?.creativeReview;
  if (!['blocked', 'warning'].includes(review?.status)) return '';
  return [
    ...(review.errors || []),
    ...(review.warnings || []),
    review.summary,
  ].map(String).map((line) => line.trim()).filter((line) => line && usefulCreativeReviewLearning(line)).join('; ');
}

function usefulCreativeReviewLearning(line) {
  const normalized = normalizeComparableText(line);
  return !/revisor automatico indisponivel|revisao visual manual|resposta vazia|resposta incompleta|imagem precisa de revisao/.test(normalized);
}

export async function listProjectReferences(projectId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  return normalizeProjectReferences(project);
}

export async function deleteProjectReference(projectId, relativePath, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
  if (!normalizedPath.startsWith('assets/references/')) throw new Error('Referência inválida para apagar');

  const currentReferences = normalizeProjectReferences(project);
  const nextReferences = currentReferences.filter((reference) => reference.relativePath !== normalizedPath);
  if (nextReferences.length === currentReferences.length) throw new Error('Referência não encontrada');

  project.brand = {
    ...project.brand,
    references: nextReferences,
    referenceFiles: (project.brand.referenceFiles || []).filter((path) => String(path).replace(/\\/g, '/') !== normalizedPath),
  };
  project.updatedAt = now.toISOString();
  await rm(safeProjectPath(paths.projectDir, normalizedPath), { force: true });
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');

  return { relativePath: normalizedPath, deleted: true, references: nextReferences };
  });
}

export async function updateProjectReference(projectId, relativePath, input = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
  const currentReferences = normalizeProjectReferences(project);
  const existing = currentReferences.find((reference) => reference.relativePath === normalizedPath);
  if (!existing) throw new Error('Referência não encontrada');

  const updated = normalizeReferenceMetadata({
    ...existing,
    projectId: project.projectId,
    referenceCategory: input.referenceCategory ?? existing.referenceCategory,
    role: input.role ?? existing.role,
    usageRoles: input.usageRoles ?? existing.usageRoles,
    weight: input.weight ?? existing.weight,
    instruction: input.instruction ?? existing.instruction,
    useInNextGeneration: input.useInNextGeneration !== undefined ? input.useInNextGeneration : existing.useInNextGeneration,
  });

  project.brand = {
    ...project.brand,
    references: upsertReferenceMetadata(currentReferences, updated),
  };
  project.updatedAt = now.toISOString();
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');

  return { project, reference: updated };
  });
}

export async function getGlobalRules(targetDir = process.cwd()) {
  const globalRules = await loadGlobalRules(getCentralPaths(targetDir));
  return globalRules.rules;
}

async function ensureBase(paths) {
  await mkdir(paths.projectsDir, { recursive: true });
  await mkdir(paths.secretsDir, { recursive: true });
  await mkdir(paths.approvalsDir, { recursive: true });
  const globalRules = await readJson(paths.globalRulesPath, null);
  if (!globalRules) {
    await writeJson(paths.globalRulesPath, {
      schemaVersion: 1,
      rules: DEFAULT_GLOBAL_RULES,
      updatedAt: new Date().toISOString(),
    });
  }
}

async function loadGlobalRules(paths) {
  await ensureBase(paths);
  return readJson(paths.globalRulesPath);
}

// Older projects (created before this field existed) simply don't have it
// in their saved JSON yet — normalize on every load/summary instead of a
// one-off migration so nothing needs to touch disk to pick it up.
const MAX_LEARNING_ENTRIES = 20;
const MAX_SEGMENT_LEARNING_ENTRIES = 40;

// segment-learnings.json/offer-type-learnings.json are GLOBAL stores shared
// across every project — a lock keyed on whichever projectId happens to be
// making the request lets two different projects' concurrent writes take
// two different locks and race each other. Every read-modify-write of these
// files goes through this one fixed lock key instead of a per-request
// projectId (see saveLearningEntry/deleteLearningEntry/
// saveOfferTypeBaseInstruction). withProjectLock only uses this as a
// directory name under projects/ to host a lock file — it's never treated
// as a real project.
const GLOBAL_LEARNING_LOCK_ID = '__global-learning__';

function normalizeLearnings(input) {
  const approved = Array.isArray(input?.approved) ? input.approved : [];
  const avoid = Array.isArray(input?.avoid) ? input.avoid : [];
  return {
    approved: approved.slice(0, MAX_LEARNING_ENTRIES).map(String),
    avoid: avoid.slice(0, MAX_LEARNING_ENTRIES).map(String),
  };
}

const SEGMENT_LEVELS = ['setor', 'nicho', 'especialidade'];

function normalizeSegmentLearningEntry(input = {}) {
  const kind = input.kind === 'image' ? 'image' : 'text';
  return {
    id: String(input.id || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    bucket: ['technical', 'approved', 'avoid'].includes(input.bucket) ? input.bucket : 'approved',
    kind,
    text: cleanText(input.text),
    imagePath: kind === 'image' ? String(input.imagePath || '').replace(/\\/g, '/') : '',
    source: input.source === 'auto' ? 'auto' : 'manual',
    // segment-learnings.json/offer-type-learnings.json are GLOBAL (shared
    // across every project), but analyzeLearningImage saves the uploaded
    // file under the uploading project's OWN directory — so an image
    // entry's thumbnail can only be resolved through the project it was
    // actually uploaded from, not whichever project happens to be open
    // when it's displayed. Only meaningful for kind: 'image'.
    sourceProjectId: kind === 'image' ? String(input.sourceProjectId || '') : '',
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function segmentNodePaths(project) {
  const profile = normalizeCompanyProfile(project.companyProfile);
  const brandInput = normalizeBrandInput(project.brandInput || companyProfileToBrandInput(profile, project.name));
  // slugify('') falls back to the literal string 'data' (its "nothing to
  // slug" default for filenames) — checking the raw trimmed value first
  // keeps an unset field genuinely empty here instead of every no-Setor
  // project silently colliding into one shared "data" node.
  const rawGroup = cleanText(profile.segmentGroup || brandInput.segmentGroup || '');
  const rawCategory = cleanText(profile.segmentCategory || brandInput.segmentCategory || '');
  const rawSpecialty = cleanText(profile.segmentSpecialty || brandInput.segmentSpecialty || '');
  // Build cumulative paths from whichever levels are actually present, in
  // group -> category -> specialty order, without requiring group itself to
  // be set. A strict "no group means no path at all" gate would silently
  // stop sharing/isolating by category+specialty for any project that never
  // filled in Setor — which is exactly the fixture the pre-existing
  // 'segment learnings are reused only for the same selected segment
  // category/specialty' test uses (no segmentGroup, matching
  // segmentCategory/segmentSpecialty) and is required to keep passing
  // unmodified.
  //
  // Each kept segment is tagged with the field it came from (group:/
  // category:/specialty:) instead of a bare slug — two projects only share
  // a node when they have the IDENTICAL set of populated fields with
  // identical values, never merely an identical trailing slug. Without the
  // tag, group='Engenharia'+category='Solos'+specialty='' and
  // group='Engenharia'+category=''+specialty='Solos' both collapse to the
  // same 'engenharia/solos' path and silently merge two unrelated
  // businesses (one categorized under "Solos", the other specialized in it).
  const parts = [
    rawGroup ? `group:${slugify(rawGroup)}` : '',
    rawCategory ? `category:${slugify(rawCategory)}` : '',
    rawSpecialty ? `specialty:${slugify(rawSpecialty)}` : '',
  ].filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function segmentNodeLabel(project, level) {
  const profile = normalizeCompanyProfile(project.companyProfile);
  const brandInput = normalizeBrandInput(project.brandInput || companyProfileToBrandInput(profile, project.name));
  const group = cleanText(profile.segmentGroup || brandInput.segmentGroup || '');
  const category = cleanText(profile.segmentCategory || brandInput.segmentCategory || '');
  const specialty = cleanText(profile.segmentSpecialty || brandInput.segmentSpecialty || '');
  if (level === 'setor') return group;
  if (level === 'nicho') return [group, category].filter(Boolean).join(' / ');
  return [group, category, specialty].filter(Boolean).join(' / ');
}

// Legacy flat shape (buildManual/buildImagePrompt callers keep working
// unchanged) — now summed across every node in the project's ancestor
// chain instead of read from a single flat-keyed bucket, so a Setor-level
// entry (e.g. "não parecer gerado por IA") reaches every Nicho underneath
// it without being copy-pasted into each one.
//
// buildManual/buildImagePrompt (untouched by this task) call this a SECOND
// time on the already-flattened result of loadSegmentLearningsForProject
// (project.segmentLearnings has no `entries`, just plain technical/approved/
// avoid string arrays) — so this must stay idempotent on that shape, same
// as the pre-v2 implementation, or the second pass silently empties it.
function normalizeSegmentLearnings(input = {}) {
  if (!Array.isArray(input?.entries)) {
    return {
      key: cleanText(input?.key),
      label: cleanText(input?.label),
      technical: (Array.isArray(input?.technical) ? input.technical : []).slice(0, MAX_SEGMENT_LEARNING_ENTRIES).map(String),
      approved: (Array.isArray(input?.approved) ? input.approved : []).slice(0, MAX_SEGMENT_LEARNING_ENTRIES).map(String),
      avoid: (Array.isArray(input?.avoid) ? input.avoid : []).slice(0, MAX_SEGMENT_LEARNING_ENTRIES).map(String),
    };
  }
  const entries = input.entries.map(normalizeSegmentLearningEntry);
  const textFor = (bucket) => entries
    .filter((entry) => entry.bucket === bucket)
    .map((entry) => (entry.kind === 'image' ? `${entry.text} (ver referência de imagem: ${entry.imagePath})` : entry.text))
    .filter(Boolean)
    .slice(0, MAX_SEGMENT_LEARNING_ENTRIES);
  return {
    key: cleanText(input?.key),
    label: cleanText(input?.label),
    technical: textFor('technical'),
    approved: textFor('approved'),
    avoid: textFor('avoid'),
  };
}

export function migrateSegmentLearningStoreV1ToV2(v1Store) {
  const nodes = {};
  for (const segment of Object.values(v1Store?.segments || {})) {
    const parts = String(segment.label || '').split(' / ').map((part) => slugify(part)).filter(Boolean);
    if (!parts.length) continue;
    const paths = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    const deepestPath = paths[paths.length - 1];
    const labelParts = String(segment.label || '').split(' / ').map((part) => part.trim()).filter(Boolean);
    for (const path of paths) {
      if (!nodes[path]) nodes[path] = { label: labelParts.slice(0, path.split('/').length).join(' / '), entries: [] };
    }
    const entries = [];
    for (const text of segment.technical || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'technical', kind: 'text', text, source: 'auto' }));
    for (const text of segment.approved || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'approved', kind: 'text', text, source: 'auto' }));
    for (const text of segment.avoid || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'avoid', kind: 'text', text, source: 'auto' }));
    nodes[deepestPath].entries.push(...entries);
  }
  // The v1 label -> v2 node-path mapping is lossy/ambiguous (it can't
  // reconstruct which real tagged group/category/specialty a flat label
  // like "Engenharia / Controle tecnológico / solos e pavimentação"
  // belongs to), so it's read-only, in-memory sugar for legacy callers —
  // NOT a real migration. Keep the original v1 `segments` bucket around
  // verbatim so it survives being written back to disk as part of a v2
  // store (see saveLearningEntry/deleteLearningEntry/addSegmentLearning),
  // instead of silently deleting real operator-authored history on the
  // first write after this ships. loadSegmentLearningsForProject also
  // reads this bucket directly via the old flat key.
  return { schemaVersion: 2, nodes, segments: v1Store?.segments || {} };
}

function normalizeTechnicalBase(input = {}) {
  return {
    sourceText: redactSensitiveText(input?.sourceText || ''),
    summary: cleanText(input?.summary),
    source: cleanText(input?.source),
    updatedAt: input?.updatedAt || null,
  };
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b(api[_-]?key|token|secret|password|senha|authorization|bearer)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    .slice(0, 12000)
    .trim();
}

function buildTechnicalBaseSummary(project, sourceText, now = new Date()) {
  const text = redactSensitiveText(sourceText);
  const terms = extractTechnicalTerms(text);
  const firstLines = text
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => line.length >= 18)
    .slice(0, 5);
  const profile = normalizeCompanyProfile(project.companyProfile);
  const segmentLabel = projectSegmentLabel(project) || profile.segment || 'segmento não definido';
  const summary = [
    `Resumo técnico aprovado em ${now.toISOString().slice(0, 10)} para ${segmentLabel}.`,
    terms.length ? `Vocabulário/assuntos que podem orientar conteúdo: ${terms.join(', ')}.` : '',
    firstLines.length ? `Pontos práticos extraídos: ${firstLines.join(' | ')}.` : '',
    'Uso em arte/copy: transformar termos técnicos em comunicação simples, sem inventar norma, resultado, certificação, preço, prazo ou promessa não informada.',
    'Trava: não aplicar este conhecimento em outro setor/tipo de negócio/subsegmento sem a mesma categoria selecionada.',
  ].filter(Boolean).join('\n');
  return { summary };
}

function extractTechnicalTerms(text) {
  const known = [
    'CBR', 'ISC', 'limite de liquidez', 'limite de plasticidade', 'granulometria', 'compactação', 'Proctor',
    'caracterização de solo', 'ensaio de solo', 'sondagem', 'asfalto', 'concreto', 'slump', 'abatimento',
    'corpo de prova', 'resistência à compressão', 'laudo técnico', 'norma', 'ABNT', 'NBR',
  ];
  const normalized = normalizeComparableText(text);
  const found = known.filter((term) => normalized.includes(normalizeComparableText(term)));
  const nbrs = [...text.matchAll(/\bNBR\s*\d{3,6}\b/gi)].map((match) => match[0].replace(/\s+/g, ' ').toUpperCase());
  return [...new Set([...found, ...nbrs])].slice(0, 18);
}

function formatTechnicalBaseLines(input = {}, segmentLearnings = {}) {
  const base = normalizeTechnicalBase(input);
  const segmentTechnical = normalizeSegmentLearnings(segmentLearnings).technical;
  return [
    base.summary ? `Resumo técnico deste projeto: ${base.summary}` : '',
    ...segmentTechnical.map((line) => `Resumo técnico aprendido neste segmento: ${line}`),
  ].filter(Boolean);
}

function projectSegmentLabel(project = {}) {
  const profile = normalizeCompanyProfile(project.companyProfile);
  const brandInput = normalizeBrandInput(project.brandInput || companyProfileToBrandInput(profile, project.name));
  const hierarchy = [
    profile.segmentGroup || brandInput.segmentGroup,
    profile.segmentCategory || brandInput.segmentCategory,
    profile.segmentSpecialty || brandInput.segmentSpecialty,
  ].filter(Boolean).join(' / ');
  return hierarchy || (profile.segment || brandInput.segment);
}

function projectSegmentKey(project = {}) {
  return slugify(projectSegmentLabel(project));
}

async function readSegmentLearningStore(paths) {
  const stored = await readJson(paths.segmentLearningsPath, null);
  if (!stored) return { schemaVersion: 2, nodes: {} };
  // A store file that exists but was hand-edited/corrupted into `{}` (or
  // any shape missing `nodes`) would otherwise pass the schemaVersion
  // check as-is and blow up the first time a caller does
  // store.nodes[path] — defend here once instead of at every access site.
  if (stored.schemaVersion === 2) return { ...stored, nodes: stored.nodes || {} };
  return migrateSegmentLearningStoreV1ToV2(stored);
}

export async function loadSegmentLearningNodes(paths, project) {
  const store = await readSegmentLearningStore(paths);
  return segmentNodePaths(project).map((path, index) => ({
    path,
    label: segmentNodeLabel(project, SEGMENT_LEVELS[index]),
    level: SEGMENT_LEVELS[index],
    entries: (store.nodes[path]?.entries || []).map(normalizeSegmentLearningEntry),
  }));
}

function learningStorePath(paths, scope) {
  return scope === 'offerType' ? paths.offerTypeLearningsPath : paths.segmentLearningsPath;
}

async function readLearningStore(paths, scope) {
  if (scope === 'segment') return readSegmentLearningStore(paths);
  const stored = await readJson(paths.offerTypeLearningsPath, null);
  if (!stored) return { schemaVersion: 1, types: {} };
  // Same defensive fallback as readSegmentLearningStore above, for a
  // corrupted/hand-edited offer-type-learnings.json missing `types`.
  return { ...stored, types: stored.types || {} };
}

async function writeLearningStore(paths, scope, store) {
  await writeJson(learningStorePath(paths, scope), store);
}

function learningStoreNodesKey(scope) {
  return scope === 'segment' ? 'nodes' : 'types';
}

// Saves the uploaded reference image and returns the AI's suggested
// description WITHOUT touching either learning store — the operator confirms
// (possibly edits) the text in the UI first, then saveLearningEntry below
// does the actual write. Keeps "upload+analyze" and "persist" independently
// retriable instead of one all-or-nothing call.
export async function analyzeLearningImage(projectId, input, targetDir = process.cwd(), now = new Date(), options = {}) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
  const groupSlug = slugify(input?.groupKey || '');
  const filename = sanitizeFilename(input?.filename || 'referencia.bin');
  const buffer = decodeDataUrl(input?.dataUrl);
  const relativePath = `assets/learning/${scope === 'segment' ? 'segment' : 'offer-type'}/${groupSlug}/${filename}`;
  const destination = join(paths.projectDir, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, buffer);

  const analyzer = typeof options.learningImageAnalyzer === 'function' ? options.learningImageAnalyzer : defaultLearningImageAnalyzer;
  const context = scope === 'segment'
    ? `segmento "${input.groupKey}" da empresa ${project.name}`
    : `tipo de oferta "${input.groupKey}"`;
  const suggestedText = await analyzer(destination, context);

  return { imagePath: relativePath, suggestedText: cleanText(suggestedText || '') };
}

async function defaultLearningImageAnalyzer() {
  return '';
}

// scope: 'segment' treats groupKey as an OPAQUE tagged node path (e.g.
// `group:alimenticio/category:pizzaria`, as produced by segmentNodePaths())
// — it must NOT be re-slugified here, or it stops matching the keys
// loadSegmentLearningNodes()/addSegmentLearning() read/write under
// segment-learnings.json's `nodes`. scope: 'offerType' groupKeys are plain
// words ("combo", "delivery"), so slugifying is the right normalization
// there (mirrors OFFER_TYPES-style handling elsewhere in this file).
export async function saveLearningEntry(projectId, input, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, GLOBAL_LEARNING_LOCK_ID, async () => {
    const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
    const store = scope === 'segment' ? await readSegmentLearningStore(paths) : await readLearningStore(paths, scope);
    const nodesKey = learningStoreNodesKey(scope);
    const groupKey = scope === 'segment' ? String(input.groupKey || '') : slugify(input.groupKey || '');
    const node = store[nodesKey][groupKey] || { label: input.groupKey, entries: [] };
    const entry = normalizeSegmentLearningEntry({
      bucket: input.bucket,
      kind: input.kind,
      text: input.text,
      imagePath: input.imagePath,
      source: 'manual',
      sourceProjectId: paths.projectId,
    });
    node.entries = [entry, ...node.entries].slice(0, MAX_SEGMENT_LEARNING_ENTRIES);
    store[nodesKey] = { ...store[nodesKey], [groupKey]: node };
    store.schemaVersion = scope === 'segment' ? 2 : 1;
    await writeLearningStore(paths, scope, store);
    return node.entries;
  });
}

export async function deleteLearningEntry(projectId, input, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, GLOBAL_LEARNING_LOCK_ID, async () => {
    const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
    const store = scope === 'segment' ? await readSegmentLearningStore(paths) : await readLearningStore(paths, scope);
    const nodesKey = learningStoreNodesKey(scope);
    const groupKey = scope === 'segment' ? String(input.groupKey || '') : slugify(input.groupKey || '');
    const node = store[nodesKey][groupKey];
    if (!node) return [];
    node.entries = node.entries.filter((entry) => entry.id !== input.entryId);
    store[nodesKey] = { ...store[nodesKey], [groupKey]: node };
    await writeLearningStore(paths, scope, store);
    return node.entries;
  });
}

async function loadSegmentLearningsForProject(paths, project) {
  const nodePaths = segmentNodePaths(project);
  if (!nodePaths.length) return normalizeSegmentLearnings();
  const store = await readSegmentLearningStore(paths);
  const entries = nodePaths.flatMap((path) => store.nodes[path]?.entries || []);
  // Pre-v2 auto-learnings live under the old flat segment key
  // (store.segments[projectSegmentKey]) and are never migrated into the
  // new tagged-node scheme (see migrateSegmentLearningStoreV1ToV2) —
  // fold them in here so old operator-approved/rejected history keeps
  // reaching prompts instead of becoming silently unreachable.
  const legacySegment = store.segments?.[projectSegmentKey(project)];
  if (legacySegment) {
    for (const text of legacySegment.technical || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'technical', kind: 'text', text, source: 'auto' }));
    for (const text of legacySegment.approved || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'approved', kind: 'text', text, source: 'auto' }));
    for (const text of legacySegment.avoid || []) entries.push(normalizeSegmentLearningEntry({ bucket: 'avoid', kind: 'text', text, source: 'auto' }));
  }
  return normalizeSegmentLearnings({ key: nodePaths[nodePaths.length - 1], label: projectSegmentLabel(project), entries });
}

async function addSegmentLearning(paths, project, bucket, line) {
  const nodePaths = segmentNodePaths(project);
  const text = cleanText(line);
  if (!nodePaths.length || !text || !['approved', 'avoid', 'technical'].includes(bucket)) return;
  const deepestPath = nodePaths[nodePaths.length - 1];
  const store = await readSegmentLearningStore(paths);
  const node = store.nodes[deepestPath] || { label: segmentNodeLabel(project, SEGMENT_LEVELS[nodePaths.length - 1]), entries: [] };
  const entry = normalizeSegmentLearningEntry({ bucket, kind: 'text', text, source: 'auto' });
  node.entries = [entry, ...node.entries.filter((existing) => existing.text !== text)].slice(0, MAX_SEGMENT_LEARNING_ENTRIES);
  store.nodes = { ...store.nodes, [deepestPath]: node };
  store.schemaVersion = 2;
  await writeJson(paths.segmentLearningsPath, store);
}

async function loadProject(paths) {
  const project = await readJson(paths.projectPath, null);
  if (!project) throw new Error(`Project not found: ${paths.projectId}`);
  const normalized = {
    ...project,
    // Projects created before this field existed simply don't have it in
    // their saved JSON — default here on every load instead of a one-off
    // migration, same convention as the other normalized fields below.
    projectType: SUPPORTED_PROJECT_TYPES.has(project.projectType) ? project.projectType : 'marketing',
    isProspect: Boolean(project.isProspect),
    prospectSource: project.isProspect ? normalizeProspectSource(project.prospectSource) : null,
    companyProfile: normalizeCompanyProfile(project.companyProfile),
    brandInput: normalizeBrandInput(project.brandInput || companyProfileToBrandInput(project.companyProfile, project.name)),
    brandIdentity: normalizeBrandIdentity(project.brandIdentity || { logoPath: project.brand?.logoPath }),
    brandXray: normalizeBrandXray(project.brandXray),
    brandBriefing: normalizeBrandBriefing(project.brandBriefing),
    technicalBase: normalizeTechnicalBase(project.technicalBase),
    contentStrategy: {
      ...(project.contentStrategy || {}),
      offers: normalizeProjectOffers(project.contentStrategy?.offers || []),
      pillars: normalizeProjectPillars(project.contentStrategy?.pillars || []),
      offerGroups: normalizeProjectOfferGroups(project.contentStrategy?.offerGroups || []),
    },
    learnings: normalizeLearnings(project.learnings),
  };
  return {
    ...normalized,
    segmentLearnings: await loadSegmentLearningsForProject(paths, normalized),
  };
}

// Test-only wrapper — loadProject() itself isn't exported (it takes the
// already-resolved `paths`, an internal shape), this gives tests a one-call
// way to get the same normalized project loadSegmentLearningNodes expects.
export async function loadProjectForTest(projectId, targetDir = process.cwd()) {
  return loadProject(getCentralPaths(targetDir, projectId));
}

async function toProjectSummary(project, paths) {
  return {
    projectId: project.projectId,
    name: project.name,
    status: project.status,
    mode: project.mode,
    projectType: SUPPORTED_PROJECT_TYPES.has(project.projectType) ? project.projectType : 'marketing',
    isProspect: Boolean(project.isProspect),
    prospectSource: project.isProspect ? normalizeProspectSource(project.prospectSource) : null,
    approvalEmail: project.approvalEmail,
    timezone: project.timezone,
    instagram: project.instagram,
    companyProfile: normalizeCompanyProfile(project.companyProfile),
    brandInput: normalizeBrandInput(project.brandInput || companyProfileToBrandInput(project.companyProfile, project.name)),
    brandIdentity: normalizeBrandIdentity(project.brandIdentity || { logoPath: project.brand?.logoPath }),
    brandXray: normalizeBrandXray(project.brandXray),
    brandBriefing: normalizeBrandBriefing(project.brandBriefing),
    technicalBase: normalizeTechnicalBase(project.technicalBase),
    brand: project.brand,
    offerAssets: normalizeProjectOfferAssets(project),
    token: project.token,
    contentSettings: project.contentSettings,
    contentStrategy: {
      ...(project.contentStrategy || {}),
      offers: normalizeProjectOffers(project.contentStrategy?.offers || []),
      pillars: normalizeProjectPillars(project.contentStrategy?.pillars || []),
      offerGroups: normalizeProjectOfferGroups(project.contentStrategy?.offerGroups || []),
    },
    rules: project.rules,
    learnings: normalizeLearnings(project.learnings),
    segmentLearnings: normalizeSegmentLearnings(project.segmentLearnings),
    segmentLearningNodes: await loadSegmentLearningNodes(paths, project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

// contentId is built from date+channel+slot, not batchId, so two separate
// "gerar conteúdo" runs covering the same date/channel/slot produce files
// with an identical contentId in different batch folders. When the caller
// knows which batch the click came from, scope the search to that folder
// first so the action lands on the exact card the user clicked instead of
// whichever duplicate a directory scan happens to find first.
async function scanBatchDirForContentId(batchDir, contentId) {
  let files;
  try {
    files = await readdir(batchDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json') || file.name === 'batch.json') continue;
    const fullPath = join(batchDir, file.name);
    const content = await readJson(fullPath, null);
    if (content?.contentId === contentId) return fullPath;
  }
  return null;
}

async function findContentPath(draftsDir, contentId, batchId) {
  if (batchId) {
    const scoped = await scanBatchDirForContentId(join(draftsDir, batchId), contentId);
    if (scoped) return scoped;
  }
  const batches = await readdir(draftsDir, { withFileTypes: true });
  for (const batch of batches) {
    if (!batch.isDirectory() || batch.name === batchId) continue;
    const found = await scanBatchDirForContentId(join(draftsDir, batch.name), contentId);
    if (found) return found;
  }
  throw new Error(`Content day not found: ${contentId}`);
}

// Drops contentId from every sibling's creativeSharedWith list — used when a
// card stops matching what it used to share a creative with (regenerated
// individually, or deleted), so the survivors' "mesmo criativo" badge
// doesn't keep pointing at content that no longer looks the same/exists.
async function removeFromSiblingCreativeGroups(paths, content) {
  const siblingIds = Array.isArray(content.creativeSharedWith) ? content.creativeSharedWith : [];
  for (const siblingId of siblingIds) {
    try {
      const siblingPath = await findContentPath(paths.draftsDir, siblingId, content.batchId);
      const sibling = await readJson(siblingPath);
      if (Array.isArray(sibling.creativeSharedWith)) {
        const remaining = sibling.creativeSharedWith.filter((id) => id !== content.contentId);
        sibling.creativeSharedWith = remaining.length ? remaining : null;
        sibling.updatedAt = new Date().toISOString();
        await writeJson(siblingPath, sibling);
      }
    } catch {
      // Sibling file may already be gone (deleted card) — nothing to reconcile.
    }
  }
}

// Removes `content` from its creative-sharing group (if any) on both sides:
// clears its own link, and drops its contentId from every sibling that used
// to share the same image with it. Called right after a successful
// individual image regeneration, since the card no longer matches whatever
// it used to share a creative with.
async function unlinkCreativeSharing(paths, content) {
  await removeFromSiblingCreativeGroups(paths, content);
  content.creativeGroupKey = null;
  content.creativeSharedWith = null;
}

function buildManual(project) {
  const imageRules = normalizeRuleList(project.brand?.imageRules || []);
  const references = normalizeProjectReferences(project);
  const offers = normalizeProjectOffers(project.contentStrategy?.offers || []);
  const pillars = normalizeProjectPillars(project.contentStrategy?.pillars || []);
  const companyProfileLines = formatCompanyProfileLines(project.companyProfile);
  const approvedXrayLines = formatApprovedBrandXrayLines(project.brandXray);
  const technicalBaseLines = formatTechnicalBaseLines(project.technicalBase, project.segmentLearnings);
  const approvedLearnings = normalizeLearnings(project.learnings).approved;
  const avoidLearnings = normalizeLearnings(project.learnings).avoid;
  const projectTypeLine = project.projectType === 'catalog'
    ? 'Catálogo de produtos (venda direta) — posta o estoque ativo no Story automaticamente, sem Raio-X/pilares e sem arte gerada por IA (usa foto real do produto).'
    : 'Marketing de conteúdo (Raio-X, pilares e arte gerada por IA).';
  return `# Manual Vivo — ${project.name}\n\n## Tipo de projeto\n- ${projectTypeLine}\n\n## Informações básicas da empresa\n${companyProfileLines.length ? companyProfileLines.map((line) => `- ${line}`).join('\n') : '- Ainda sem informações básicas preenchidas.'}\n\n## Base técnica do segmento\n${technicalBaseLines.length ? technicalBaseLines.map((line) => `- ${line}`).join('\n') : '- Ainda sem base técnica resumida.'}\n\n## Raio-X aprovado da marca\n${approvedXrayLines.length ? approvedXrayLines.map((line) => `- ${line}`).join('\n') : '- Ainda sem Raio-X aprovado.'}\n\n## Identidade visual\n- Logo esperado em: assets/logo.png\n- Referências em: assets/references/\n- Estilo visual: ${project.brand?.visualStyle || 'adicione o estilo visual do projeto.'}\n\n## Referências visuais cadastradas\n${references.length ? references.map((reference) => `- ${reference.relativePath} (${referenceRoleLabel(reference.role)}, peso ${reference.weight}): ${reference.instruction || 'sem instrução específica.'}`).join('\n') : '- Ainda sem referências cadastradas.'}\n\n## Ofertas e assuntos cadastrados\n${offers.length ? offers.map((offer) => `- ${offer.name} (${offerTypeLabel(offer.type)}): ${offer.price || 'sem preço'}; itens: ${offer.items || 'não informado'}; CTA: ${offer.cta || 'não informado'}`).join('\n') : '- Ainda sem ofertas cadastradas.'}\n\n## Pilares de conteúdo\n${pillars.length ? pillars.map((pillar) => `- ${pillar.name} (${pillarRoleLabel(pillar.role)}, peso ${pillar.weight}, tratamento ${pillar.visualTreatment}): ${pillar.objective || 'sem objetivo descrito'}`).join('\n') : '- Ainda sem pilares cadastrados; rotação de conteúdo segue o padrão automático.'}\n\n## Regras de imagem\n${imageRules.length ? imageRules.map((rule) => `- ${rule}`).join('\n') : '- Adicione regras visuais deste projeto aqui.'}\n\n## Regras do projeto\n${project.rules.project.length ? project.rules.project.map((rule) => `- ${rule}`).join('\n') : '- Adicione regras específicas deste projeto aqui.'}\n\n## Aprendizados aprovados\n${approvedLearnings.length ? approvedLearnings.map((line) => `- ${line}`).join('\n') : '- Ainda sem conteúdos aprovados.'}\n\n## Evitar\n${avoidLearnings.length ? avoidLearnings.map((line) => `- ${line}`).join('\n') : '- Ainda sem rejeições registradas.'}\n`;
}

function buildImagePrompt(project, globalRules, contentRules, dayNumber, context = {}) {
  // Registered image rules (often seeded from an online research pass —
  // "[Pesquisa online] Composição 'mockup de resultado': notebook/celular,
  // cards, gráficos e cursores...") describe how the brand's REGULAR content
  // should look, and applied unconditionally even to a commemorative post
  // (Dia dos Pais etc.) they make it look like a business/analytics pitch
  // instead of a celebration — confirmed on a real generation for a
  // marketing-agency client whose standing rules are dashboard-themed.
  // Skip them here and say so explicitly instead, so the model doesn't fall
  // back to the brand's usual business-dashboard visual language.
  const isSpecialDateInstitutional = context.contentTopic?.source === 'special_date' && !context.contentTopic?.offerId;
  const imageRules = isSpecialDateInstitutional
    ? []
    : filterImageRulesForTopic(
      normalizeRuleList(project.brand?.imageRules || []),
      context.contentTopic,
      project
    );
  const activeReferences = sortReferencesForPrompt(normalizeProjectReferences(project))
    .filter((reference) => reference.useInNextGeneration !== false);
  const logoReferences = uniqueReferences([
    context.logoReference,
    ...activeReferences.filter((reference) => reference.role === 'brand_asset'),
  ].filter(Boolean));
  const logoReferencePaths = new Set(logoReferences.map((reference) => reference.relativePath));
  const visualReferences = activeReferences.filter((reference) => !logoReferencePaths.has(reference.relativePath));
  const { currentRules, variationRules } = splitPromptRules(contentRules);
  const companyFactLines = formatCompanyFactLines(project.companyProfile);
  const approvedXrayLines = formatApprovedBrandXrayLines(project.brandXray);
  const approvedBriefingLines = formatApprovedBrandBriefingLines(project.brandBriefing);
  const segmentLearnings = normalizeSegmentLearnings(project.segmentLearnings);
  const technicalBaseLines = formatTechnicalBaseLines(project.technicalBase, segmentLearnings);
  const consolidatedVisualDirection = approvedXrayLines.length
    ? buildConsolidatedXrayVisualDirection(project, project.brandXray)
    : buildConsolidatedVisualDirection(project, project.brandBriefing);
  const requiredGlobalRules = globalRules
    .map((rule) => (typeof rule === 'string' ? rule : rule?.text || ''))
    .filter(Boolean);
  const channelLabel = CHANNEL_LABELS[context.channel] || context.formatLabel || context.channel || 'Instagram';
  const formatInstruction = imageFormatInstructionForChannel(context.channel);
  const objective = context.objective || `Criar criativo Dia ${dayNumber} para ${channelLabel} de ${project.name}.`;

  return [
    section('OBJETIVO', [
      objective,
      context.formatLabel ? `Formato planejado: ${context.formatLabel}.` : '',
      formatInstruction,
      'Criar uma arte de anúncio/flyer simples, comercial e pronta para revisão visual.',
    ]),
    section('HIERARQUIA OBRIGATÓRIA DO PROMPT', [
      '1. Informações factuais confirmadas pelo usuário.',
      '2. Ativos oficiais.',
      '3. Informações da campanha ou publicação atual.',
      '4. Raio-X aprovado da marca ou briefing aprovado da marca.',
      '5. Fotos reais dos produtos.',
      '6. Referências visuais.',
      '7. Liberdade criativa da IA.',
      'Referência visual nunca pode alterar preço, logo, produto, nome, promoção ou informação factual.',
    ]),
    section('REGRAS DE SEGURANÇA', [
      'Não inventar logo, preço, telefone, endereço, produto, promoção ou informação que não esteja cadastrada/informada.',
      'Não alterar produto real, sabor, embalagem, cor oficial da marca ou formato solicitado.',
      'Não publicar sem aprovação quando o projeto estiver em modo manual ou semi-automático.',
      ...requiredGlobalRules,
    ]),
    section('INFORMAÇÕES FACTUAIS OBRIGATÓRIAS', [
      `Nome: ${project.name}.`,
      `Instagram: ${project.instagram.handle || 'não definido'}.`,
      `Modo de operação: ${project.mode}.`,
      ...companyFactLines,
      ...(project.rules?.project || []).map((rule) => `Regra do projeto: ${rule}`),
    ]),
    context.contentTopic ? section('ASSUNTO E TIPO DO POST', formatContentTopicLines(context.contentTopic)) : '',
    context.contentTopic?.pillar ? section('PILAR DE CONTEÚDO', formatPillarLines(context.contentTopic.pillar)) : '',
    technicalBaseLines.length
      ? section('BASE TÉCNICA DO SEGMENTO', [
        'Usar como conhecimento de contexto para acertar vocabulário, assunto e limites técnicos; não transformar em promessa, certificação ou norma inventada.',
        ...technicalBaseLines,
      ])
      : '',
    approvedXrayLines.length ? section('RAIO-X APROVADO DA MARCA', approvedXrayLines) : '',
    approvedBriefingLines.length ? section('BRIEFING APROVADO DA MARCA', approvedBriefingLines) : '',
    segmentLearnings.approved.length
      ? section('PADRÕES APROVADOS NESTE SEGMENTO', segmentLearnings.approved)
      : '',
    segmentLearnings.avoid.length
      ? section('EVITAR — APRENDIZADOS DESTE SEGMENTO', segmentLearnings.avoid)
      : '',
    normalizeLearnings(project.learnings).avoid.length
      ? section('EVITAR — APRENDIZADOS DE CONTEÚDOS REJEITADOS ANTES', normalizeLearnings(project.learnings).avoid)
      : '',
    logoReferences.length ? section('LOGO DO PROJETO', [
      'A logo/marca cadastrada deve aparecer no criativo final.',
      'Pode posicionar a logo onde ficar melhor no criativo: canto, rodapé, topo, selo ou área livre, desde que fique natural, legível e sem cortar.',
      'Usar a logo como referência visual da marca; não inventar uma logo diferente.',
      ...logoReferences.map(formatReferenceLine),
    ]) : '',
    section('REFERÊNCIAS VISUAIS DO PROJETO', visualReferences.length
      ? [
        'Usar as referências abaixo respeitando a regra automática de cada categoria, sem transformar a imagem em colagem.',
        'Referências visuais não podem contradizer o Raio-X aprovado, preços, ofertas ou fatos informados pelo usuário.',
        ...visualReferences.map(formatReferenceLine),
      ]
      : ['Nenhuma referência visual ativa cadastrada.']),
    section('DIREÇÃO VISUAL CONSOLIDADA', [
      consolidatedVisualDirection || 'Direção visual ainda não consolidada; manter aparência limpa, profissional e coerente com os fatos cadastrados.',
      isSpecialDateInstitutional
        ? 'Esta peça é uma celebração de data comemorativa, não o conteúdo comercial padrão da marca — mesmo que a marca normalmente use elementos de dashboard, gráfico, métrica, card de resultado ou mockup de tela/software, NÃO usar nada disso aqui. Priorize uma composição mais humana, calorosa e simples, mantendo as cores e a logo da marca, mas sem parecer peça de vendas ou apresentação de negócio.'
        : '',
      ...imageRules.map((rule) => `Regra de imagem: ${rule}`),
      'Criar imagem alinhada ao manual vivo do projeto, com visual limpo e sem aparência artificial/3D genérica.',
      'Se for arte promocional com preço, seguir hierarquia de anúncio profissional: título forte, oferta clara, selo de preço legível e produto/serviço apresentado com realismo.',
      'Manter qualquer texto dentro de área segura, sem encostar ou cortar nas laterais/topo/rodapé.',
      'Para Story/Reels, a composição deve preencher o canvas vertical inteiro 1080x1920; criar Story vertical nativo, não flyer quadrado ou arte 1:1 dentro do Story.',
      'Título, itens, preço, logo e CTA precisam ficar dentro de margem interna generosa; nada pode sair cortado na prévia.',
      'Se houver preço, usar um selo/card compacto, elegante e integrado ao layout; evitar retângulo branco gigante, moldura simples ou box que cubra o produto/serviço principal.',
    ]),
    section('INSTRUÇÃO DO CONTEÚDO ATUAL', currentRules.length
      ? currentRules
      : ['Sem instrução específica deste lote; criar conteúdo coerente com a marca e o formato.']),
    section('VARIAÇÃO CRIATIVA', variationRules.length
      ? variationRules
      : ['Variar composição, enquadramento e hierarquia somente quando isso não conflitar com identidade, referências e regras do projeto.']),
    section('RESTRIÇÕES FINAIS', [
      'Não inserir textos extras não solicitados e nunca deixar letras cortadas nas bordas.',
      'Não utilizar logos falsos, marcas concorrentes ou elementos de terceiros.',
      'Não deformar alimentos, produtos, embalagens, rostos, mãos, instalações ou serviços oficiais.',
      'Não alterar produto, preço ou chamada obrigatória informada na instrução atual.',
    ]),
  ].join('\n\n');
}

function buildTestCreativeVariation(channel, note, runSeed) {
  const basis = `${channel}|${note}|${runSeed}`;
  const selected = TEST_CREATIVE_VARIATIONS[hashString(basis) % TEST_CREATIVE_VARIATIONS.length];
  const channelInstruction = channel === 'instagram_story'
    ? 'Formato de teste: Story vertical 9:16. Criar composição vertical nativa, sem 1:1/quadrado central. Leitura rápida, poucos blocos, área segura nas bordas.'
    : channel === 'instagram_reels'
      ? 'Formato de teste: capa de Reels vertical 9:16. Criar composição vertical nativa, sem 1:1/quadrado central. Alto impacto no primeiro segundo, texto curto.'
      : 'Formato de teste: Feed, composição equilibrada, legível no quadrado/preview.';
  const summary = `${selected.concept} — ${selected.composition}`;
  return {
    summary,
    rules: [
      `Variação criativa de teste: ${runSeed}.`,
      `Conceito do teste: ${selected.concept}.`,
      `Composição obrigatória desta tentativa: ${selected.composition}.`,
      `Ângulo da copy/imagem: ${selected.copyAngle}.`,
      channelInstruction,
      'Não repetir exatamente o criativo anterior: mudar enquadramento, cena principal, hierarquia e distribuição dos elementos, mantendo a identidade visual do projeto.',
      note ? `Usar a observação do usuário como direção principal, mas ainda criar uma variação nova: ${note}` : 'Como o usuário não escreveu observação, escolher uma abordagem nova automaticamente para este teste.',
    ],
  };
}

// Grounds a goal-driven (non-offer) topic in already-approved Raio-X text
// instead of inventing positioning specifics.
function brandXrayGroundingText(project) {
  const xray = project.brandXray;
  if (xray?.status !== 'approved') return '';
  return xray.blocks?.communication?.text || xray.blocks?.summary?.text || '';
}

function buildGoalContentTopic(goalKey, project) {
  const template = GOAL_TOPIC_TEMPLATES[goalKey];
  if (!template) return null;
  const topic = {
    id: `goal-${goalKey}`,
    type: template.type,
    label: template.label,
    source: 'goal',
    goalKey,
    price: '',
    items: '',
    cta: '',
    autoGenerateCta: false,
    notes: '',
    objective: template.buildObjective(project, brandXrayGroundingText(project)),
  };
  topic.cta = salesGatedCta(topic, template.ctaDefault);
  return topic;
}

// Proportional zipper-merge (not concatenation) so a short batch still mixes
// both kinds of topics instead of exhausting one array before the other
// appears — e.g. [offer, goal, offer, goal, offer] rather than
// [offer, offer, offer, goal, goal].
function interleaveTopics(a, b) {
  if (!a.length) return [...b];
  if (!b.length) return [...a];
  const result = [];
  let ai = 0;
  let bi = 0;
  while (ai < a.length || bi < b.length) {
    const aRatio = ai < a.length ? ai / a.length : Infinity;
    const bRatio = bi < b.length ? bi / b.length : Infinity;
    if (aRatio <= bRatio) {
      result.push(a[ai]);
      ai += 1;
    } else {
      result.push(b[bi]);
      bi += 1;
    }
  }
  return result;
}

// Explicit rule from the operator's content briefing: never schedule two
// "convida" (sales/CTA) pillars back to back. Swaps the second offender for
// the next non-sales pillar later in the sequence when one exists — a
// best-effort safety net on top of buildPillarRotationSequence, which
// already spaces same-pillar repeats out for any non-degenerate weight mix.
function avoidConsecutiveSalesPillars(sequence) {
  const result = [...sequence];
  for (let i = 1; i < result.length; i += 1) {
    if (result[i].role === 'convida' && result[i - 1].role === 'convida') {
      const swapIndex = result.findIndex((pillar, index) => index > i && pillar.role !== 'convida');
      if (swapIndex !== -1) {
        [result[i], result[swapIndex]] = [result[swapIndex], result[i]];
      }
    }
  }
  return result;
}

// Smooth weighted round-robin (the same scheme load balancers use to spread
// weighted picks evenly instead of bursting the heaviest one at the end of
// the sequence): each pillar accumulates its weight every round, the
// highest accumulator gets picked and drops by the total weight. Keeps the
// requested proportions while naturally minimizing back-to-back repeats of
// the same pillar — this sequence is what the schedule generator walks
// (via a persisted cursor) to decide which pillar each slot represents.
function buildPillarRotationSequence(pillars) {
  const totalWeight = pillars.reduce((sum, pillar) => sum + pillar.weight, 0);
  if (!totalWeight) return [];
  const currentWeights = pillars.map(() => 0);
  const sequence = [];
  for (let round = 0; round < totalWeight; round += 1) {
    let bestIndex = 0;
    for (let i = 0; i < pillars.length; i += 1) {
      currentWeights[i] += pillars[i].weight;
      if (currentWeights[i] > currentWeights[bestIndex]) bestIndex = i;
    }
    sequence.push(pillars[bestIndex]);
    currentWeights[bestIndex] -= totalWeight;
  }
  return avoidConsecutiveSalesPillars(sequence);
}

function pillarSnapshotFrom(pillar) {
  return {
    id: pillar.id,
    name: pillar.name,
    role: pillar.role,
    objective: pillar.objective,
    visualTreatment: pillar.visualTreatment,
    color: pillar.color,
    requiresEvidence: pillar.requiresEvidence,
  };
}

// Combines active offers with the user's selected content objectives
// (project.brandInput.contentGoals) into one rotating pool, so scheduled
// content mixes sales/offer posts with authority/engagement/relationship/
// education posts instead of only ever advertising the next offer.
// DEFAULT_CONTENT_TOPICS is now a true last resort — only when a project
// has neither offers nor any goal that maps to a template.
//
// `options.groupIds`, when non-empty, scopes offers to just the requested
// offer group(s) (see saveProjectOfferGroup) — e.g. generating this week's
// schedule from only a "Black Friday" group without touching any offer's
// `active` flag. Goal-driven topics (engagement/authority/etc.) are never
// affected by this filter; only which real offers compete for slots.
//
// `options.weekday` ('mon'..'sun'), when set, additionally drops any offer
// whose own daysOfWeek doesn't include that day — e.g. a pizzeria's weekday
// rodízio price never competes for a Saturday slot, and its separate
// weekend-price offer never competes for a Tuesday slot. An offer with no
// daysOfWeek set is eligible every day, unchanged from before this existed.
// `options.offersOnly` (only meaningful together with options.groupIds) —
// "generate just this group, don't mix in the goal-driven topics
// (autoridade/engajamento/etc.)" the operator asked for as a way to run a
// batch that's 100% e.g. "Promoção fim de semana" with no institutional
// post breaking up the run. Skips goalTopics AND the DEFAULT_CONTENT_TOPICS
// fallback entirely — an empty result here (group has no active offers) is
// a real error, validated by the caller before this ever runs, not
// something to silently paper over with unrelated content.
async function buildTopicPool(project, options = {}, targetDir) {
  const groupIds = Array.isArray(options.groupIds) && options.groupIds.length ? new Set(options.groupIds) : null;
  const offerTopics = await Promise.all(
    normalizeProjectOffers(project.contentStrategy?.offers || [])
      .filter((offer) => offer.active)
      .filter((offer) => !groupIds || groupIds.has(offer.groupId))
      .filter((offer) => !options.weekday || !offer.daysOfWeek?.length || offer.daysOfWeek.includes(options.weekday))
      .map((offer) => offerToContentTopic(offer, targetDir))
  );
  if (options.offersOnly) return offerTopics;
  const goalTopics = (project.brandInput?.contentGoals || [])
    .map((goalKey) => buildGoalContentTopic(goalKey, project))
    .filter(Boolean);
  if (!offerTopics.length && !goalTopics.length) {
    return DEFAULT_CONTENT_TOPICS.map((topic) => {
      const built = { ...topic, source: 'default', cta: '' };
      return { ...built, cta: salesGatedCta(built, topic.cta) };
    });
  }
  const hasSalesIntent = (project.brandInput?.contentGoals || []).some((goalKey) => PRICED_INTENT_GOALS.has(goalKey));
  const boostedOfferTopics = hasSalesIntent && offerTopics.length
    ? Array.from({ length: SALES_INTENT_BOOST }, () => offerTopics).flat()
    : offerTopics;
  return interleaveTopics(boostedOfferTopics, goalTopics);
}

async function buildContentTopic(project, index, context = {}, targetDir) {
  const topics = await buildTopicPool(project, { groupIds: context.groupIds, offersOnly: context.offersOnly, weekday: context.weekday }, targetDir);
  const topic = topics[index % topics.length];
  return {
    ...topic,
    channel: context.channel || '',
    sequence: index + 1,
  };
}

async function contentTopicCount(project, options = {}, targetDir) {
  return (await buildTopicPool(project, options, targetDir)).length;
}

async function inferNextTestTopicIndex(paths, project, topicCount, targetDir) {
  const topics = await buildTopicPool(project, {}, targetDir);
  const latestTest = (await readDraftContents(paths.draftsDir))
    .filter((item) => item?.status === 'test_post_simulated')
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0];
  if (!latestTest?.contentTopic) return 0;
  const latestIndex = topics.findIndex((topic) => (
    (latestTest.contentTopic.offerId && topic.offerId === latestTest.contentTopic.offerId)
    || (latestTest.contentTopic.id && topic.id === latestTest.contentTopic.id)
    || (latestTest.contentTopic.offerName && topic.offerName === latestTest.contentTopic.offerName)
  ));
  if (latestIndex < 0) return 0;
  return normalizeTopicIndex(latestIndex + 1, topicCount);
}

async function readDraftContents(draftsDir) {
  const contents = [];
  let batches;
  try {
    batches = await readdir(draftsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return contents;
    throw err;
  }
  for (const batch of batches) {
    if (!batch.isDirectory()) continue;
    const batchDir = join(draftsDir, batch.name);
    const files = await readdir(batchDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json') || file.name === 'batch.json') continue;
      const item = await readJson(join(batchDir, file.name), null);
      if (item) contents.push(item);
    }
  }
  return contents;
}

function normalizeTopicIndex(value, count) {
  const safeCount = Math.max(1, Number(count) || 1);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const integer = Math.trunc(numeric);
  return ((integer % safeCount) + safeCount) % safeCount;
}

async function offerToContentTopic(offer, targetDir) {
  const learning = await loadOfferTypeLearning(targetDir, offer.type);
  return {
    id: offer.id,
    type: offer.type,
    label: offerTypeLabel(offer.type),
    source: 'offer',
    offerId: offer.id,
    offerName: offer.name,
    price: offer.price,
    items: offer.items,
    cta: offer.cta,
    autoGenerateCta: offer.autoGenerateCta,
    notes: offer.notes,
    objective: await offerObjective(offer, targetDir),
    pillarId: offer.pillarId || null,
    photoReferenceIds: Array.isArray(offer.photoReferenceIds) ? offer.photoReferenceIds : [],
    learningEntries: learning.entries.filter((entry) => entry.bucket === 'approved').map((entry) => entry.text),
  };
}

// Per-offer-type base instruction, editable through offer-type-learnings.json
// (see loadOfferTypeLearning/saveOfferTypeBaseInstruction below). No stored
// override yet => exact same hardcoded per-offer wording this function
// always returned, so existing prompts/tests stay byte-for-byte unchanged.
// A stored override is type-level (no offer name baked in, see
// defaultOfferObjectiveTemplate) — appended with "(offer name)" unless the
// operator's own text already mentions it.
async function offerObjective(offer, targetDir) {
  const learning = await loadOfferTypeLearning(targetDir, offer.type);
  if (!learning.hasOverride) return legacyOfferObjective(offer);
  return learning.baseInstruction.includes(offer.name)
    ? learning.baseInstruction
    : `${learning.baseInstruction} (${offer.name})`;
}

function legacyOfferObjective(offer) {
  if (offer.type === 'combo') return `Criar oferta de combo para ${offer.name}, com preço e CTA de delivery claros.`;
  if (offer.type === 'rodizio') return `Criar chamada para rodízio de ${offer.name}, destacando itens inclusos, preço e convite para aproveitar.`;
  if (offer.type === 'delivery') return `Criar chamada para delivery usando ${offer.name}, preço/benefício e pedido rápido.`;
  if (offer.type === 'orientation') return `Criar post de orientação usando ${offer.name} como assunto, sem parecer só promoção.`;
  return `Criar post de ${offerTypeLabel(offer.type)} para ${offer.name}.`;
}

// Name-less generic per-type default — pre-fills the editable base
// instruction shown by the (future) offer-type learning UI before the
// operator has saved a custom one. Not used for the live prompt when no
// override exists (see legacyOfferObjective, which keeps the original
// exact wording so behavior is unchanged for untouched types).
function defaultOfferObjectiveTemplate(type) {
  if (type === 'combo') return `Criar oferta de combo, com preço e CTA de delivery claros.`;
  if (type === 'rodizio') return `Criar chamada para rodízio, destacando itens inclusos, preço e convite para aproveitar.`;
  if (type === 'delivery') return `Criar chamada para delivery, preço/benefício e pedido rápido.`;
  if (type === 'orientation') return `Criar post de orientação, sem parecer só promoção.`;
  return `Criar post de ${offerTypeLabel(type)}.`;
}

// offer-type-learnings.json is global (root-level, not per-project) — every
// project shares the same editable base instruction + learned examples per
// offer type. getCentralPaths(targetDir) with no projectId only joins path
// segments (no existence check), so it's safe to call without a project
// having been created yet.
export async function loadOfferTypeLearning(targetDir = process.cwd(), type) {
  const paths = getCentralPaths(targetDir);
  const store = await readLearningStore(paths, 'offerType');
  const node = store.types?.[type];
  return {
    type,
    baseInstruction: node?.baseInstruction || defaultOfferObjectiveTemplate(type),
    hasOverride: Boolean(node?.baseInstruction),
    entries: (node?.entries || []).map(normalizeSegmentLearningEntry),
  };
}

export async function saveOfferTypeBaseInstruction(targetDir = process.cwd(), type, baseInstruction) {
  const paths = getCentralPaths(targetDir);
  return withProjectLock(targetDir, GLOBAL_LEARNING_LOCK_ID, async () => {
    const store = await readLearningStore(paths, 'offerType');
    const node = store.types[type] || { entries: [] };
    node.baseInstruction = cleanText(baseInstruction);
    store.types = { ...store.types, [type]: node };
    await writeLearningStore(paths, 'offerType', store);
  });
}

function formatContentTopicLines(topic) {
  return [
    `Tipo de publicação: ${topic.label || offerTypeLabel(topic.type)}.`,
    topic.offerName ? `Oferta/assunto obrigatório: ${topic.offerName}.` : `Assunto: ${topic.objective || topic.label}.`,
    topic.price ? `Preço obrigatório: ${topic.price}. Não alterar, arredondar ou inventar outro preço.` : 'Não inventar preço se nenhum preço foi cadastrado para este assunto.',
    topic.items ? `Itens inclusos/detalhes: ${topic.items}. Cada item listado precisa aparecer visualmente reconhecível na composição — não representar só um ou dois itens e deixar o restante de fora.` : '',
    topic.cta ? `Chamada/CTA obrigatório: ${topic.cta}.` : '',
    !topic.cta && topic.autoGenerateCta ? 'CTA automático: criar uma chamada curta, natural e contextual depois de analisar o assunto, o formato do post e a composição criada. Evitar CTA massivo, genérico ou apelativo.' : '',
    topic.notes ? `Observações/restrições: ${topic.notes}.` : '',
    topic.objective ? `Objetivo criativo: ${topic.objective}` : '',
    topic.learningEntries?.length ? `Aprendizados registrados para este tipo de publicação: ${topic.learningEntries.join(' | ')}` : '',
    'Não misturar oferta de delivery com rodízio/presencial se isso não estiver cadastrado no assunto.',
    'Variar o tipo de publicação entre os cards; não fazer todos com a mesma estrutura de oferta.',
  ];
}

function pillarTreatmentLine(visualTreatment) {
  return {
    cru: 'Tratamento visual: CRU — deve parecer print de tela ou foto real tirada na hora, sem template gráfico pesado, sem moldura decorativa, o mínimo de tratamento possível.',
    leve: 'Tratamento visual: LEVE — ajuste sutil (cor, corte, pequeno destaque), sem virar peça 100% desenhada.',
    desenhado: 'Tratamento visual: DESENHADO — arte trabalhada, com template, hierarquia visual forte e composição elaborada.',
  }[visualTreatment] || '';
}

function formatPillarLines(pillar) {
  return [
    `Pilar: ${pillar.name}${pillar.objective ? ` — ${pillar.objective}` : ''}.`,
    pillarTreatmentLine(pillar.visualTreatment),
    pillar.color ? `Cor de identificação do pilar: ${pillar.color} (usar como acento pontual; não substitui as cores oficiais da marca).` : '',
  ];
}

function buildContentReview({ channel, aspectRatio, dimensions, contentTopic }) {
  const checks = [];
  const warnings = [];
  if (channel === 'instagram_story' || channel === 'instagram_reels' || channel === 'facebook_story') {
    if (aspectRatio === 'portrait' && dimensions?.width === 1080 && dimensions?.height === 1920) {
      checks.push('Formato vertical 9:16 confirmado para Story/Reels.');
    } else {
      warnings.push('Formato vertical 9:16 não confirmado.');
    }
  }
  if (channel === 'instagram_feed' || channel === 'facebook_feed') {
    if (aspectRatio === 'portrait' && dimensions?.width === 1080 && dimensions?.height === 1350) {
      checks.push('Formato Feed 4:5 confirmado: 1080x1350.');
    } else {
      warnings.push('Formato Feed 4:5 1080x1350 não confirmado.');
    }
  }
  if (contentTopic?.price) checks.push('Preço obrigatório presente no assunto.');
  else if (contentTopic?.source === 'goal') checks.push('Post por objetivo de conteúdo; sem preço de propósito.');
  else warnings.push('Assunto sem preço cadastrado; não inventar preço no criativo.');
  if (contentTopic?.items) checks.push('Itens/detalhes presentes no assunto.');
  else if (contentTopic?.source !== 'goal') warnings.push('Assunto sem itens/detalhes cadastrados.');
  if (contentTopic?.cta) checks.push('CTA obrigatório presente no assunto.');
  else if (contentTopic?.autoGenerateCta) checks.push('CTA automático ativado para a IA escolher uma chamada contextual.');
  else warnings.push('Assunto sem CTA cadastrado.');
  if (contentTopic?.type) checks.push(`Tipo de publicação definido: ${offerTypeLabel(contentTopic.type)}.`);
  if (contentTopic?.pillar) {
    checks.push(`Pilar de conteúdo definido: ${contentTopic.pillar.name}.`);
    if (contentTopic.pillar.requiresEvidence && !contentTopic?.items && !contentTopic?.notes) {
      warnings.push(`Pilar ${contentTopic.pillar.name} exige evidência real (resultado/número); nenhum dado cadastrado nesta oferta — preencha em Itens/Observações antes de aprovar.`);
    }
  }
  return {
    status: warnings.length ? 'warning' : 'ok',
    checks,
    warnings,
  };
}

async function generateAiImageWithReviewLoop(content, project, projectId, options = {}) {
  const maxAttempts = normalizeCreativeAttemptLimit(options.maxAttempts);
  const originalPrompt = content.image.prompt;
  const rawReferences = Array.isArray(content.image.references) ? [...content.image.references] : [];
  const baseReferences = buildPrimaryAiImageReferences(
    rawReferences,
    {
      channel: options.channel || content.channel,
      topic: content.contentTopic,
      variationSeed: content.publish?.variationSeed || content.contentId || '',
      allOffers: project.contentStrategy?.offers || [],
    }
  );
  content.creativePreflight = buildCreativePreflight(content.contentTopic || {}, options.channel || content.channel, rawReferences, baseReferences);
  const basePrompt = options.promptFraming === 'ad_creative'
    ? appendAdCreativeFraming(buildChatGptFinalCardPrompt(content, project, originalPrompt, options.channel, baseReferences))
    : buildChatGptFinalCardPrompt(content, project, originalPrompt, options.channel, baseReferences);
  const baseContentReview = { ...(content.contentReview || {}) };
  const reviewAttempts = [];
  let reviewFeedback = '';
  let finalReview = null;
  let allowedAttempts = maxAttempts;
  let rescueMode = false;

  for (let attempt = 1; attempt <= allowedAttempts; attempt += 1) {
    content.image.references = rescueMode ? buildRescueImageReferences(baseReferences) : baseReferences;
    content.image.prompt = rescueMode
      ? appendCreativeRescueCorrections(basePrompt, reviewAttempts, options.channel)
      : reviewFeedback
        ? appendCreativeReviewCorrections(basePrompt, reviewAttempts)
        : basePrompt;

    const generatedImage = await options.imageGenerator({
      content,
      projectId,
      note: options.note,
      channel: options.channel,
      // Only the very first attempt of an operator-requested correction is a
      // real edit of the existing image — a rescue pass is fixing a
      // structural problem (wrong canvas/aspect ratio) that editing the same
      // broken image can't fix, and a review-retry (attempt > 1) is already
      // the AI's own correction loop, not the operator's original request.
      targetedEdit: Boolean(options.targetedEdit) && attempt === 1 && !rescueMode,
      attempt,
      maxAttempts: allowedAttempts,
      rescueMode,
      reviewFeedback,
      previousReviews: [...reviewAttempts],
    });

    if (!generatedImage?.url) {
      // A generator that resolves without throwing but with no usable url
      // (empty object, provider quirk) used to silently fall through here —
      // the card kept its local SVG placeholder forever, generatedSource
      // never became 'ai', and the caller's try/catch never fired, so
      // imageGenerationError got set to null (success!) even though no real
      // image was ever generated. Throwing routes it through the same
      // caught-and-recorded error path a thrown generator already has.
      throw new Error('O gerador de imagem não retornou uma URL de imagem (resposta vazia ou inválida).');
    }

    content.image = {
      ...content.image,
      prompt: generatedImage.prompt || content.image.prompt,
      originalPrompt,
      generated: true,
      generatedSource: 'ai',
      generationStatus: 'ai_generated',
      generationAttempts: attempt,
      mimeType: generatedImage.mimeType || 'image/png',
      url: generatedImage.url,
      previewUrl: generatedImage.url,
      previewMode: 'direct_ai_css_cover',
      previewFit: 'cover',
    };

    if (typeof options.imageReviewer !== 'function' || content.image?.generatedSource !== 'ai') break;

    finalReview = normalizeCreativeReview(await options.imageReviewer({
      content,
      project,
      projectId,
      note: options.note,
      channel: options.channel,
      attempt,
      maxAttempts,
    }), options.now);
    finalReview.attempt = attempt;
    reviewAttempts.push(finalReview);
    reviewFeedback = formatCreativeReviewFeedback(finalReview);

    if (
      finalReview.status === 'blocked'
      && attempt === allowedAttempts
      && !rescueMode
      && maxAttempts > 1
      && shouldEnterStoryRescueMode(finalReview, options.channel)
    ) {
      rescueMode = true;
      allowedAttempts = Math.min(maxAttempts + 1, 5);
      continue;
    }

    if (finalReview.status !== 'blocked' || attempt === allowedAttempts) break;
  }

  if (reviewAttempts.length) {
    content.creativeReviewAttempts = reviewAttempts;
    content.creativeReview = finalReview;
    content.contentReview = mergeCreativeReview(baseContentReview, finalReview);
  }
}

// Returns up to `count` items starting at a seed-derived offset, wrapping
// around the array — used so which layout/visual reference "wins" a
// slice(0, N) cut rotates across separate generations instead of always
// being the same array-order item.
function pickRotatingReferenceList(candidates, seed, count) {
  if (!candidates.length || count <= 0) return [];
  if (candidates.length <= count) return candidates.slice(0, count);
  const start = hashString(seed || '') % candidates.length;
  return Array.from({ length: count }, (_, index) => candidates[(start + index) % candidates.length]);
}

// A handful of visual-direction lines were written exclusively for a food
// business (pizzaria) and applied to every project regardless of segment —
// e.g. telling an engineering/inspection company's creative to look
// "gastronômico... apetitoso" (appetizing), which pushed the model toward
// generating food imagery for a non-food business. Gate the food-specific
// language behind an actual segment check instead.
const FOOD_SEGMENT_KEYWORDS = [
  'pizza', 'esfiha', 'comida', 'restaurante', 'lanchonete', 'hamburgueria',
  'hamburguer', 'padaria', 'confeitaria', 'gastronomia', 'alimenticia',
  'alimentacao', 'cafeteria', 'sorveteria', 'churrascaria', 'pizzaria',
  'delivery de comida', 'food truck', 'doceria', 'buffet',
];

function isFoodBusiness(project = {}) {
  const text = normalizeComparableText([
    project?.brandInput?.segment,
    project?.brandInput?.productsOrServices,
    project?.companyProfile?.segment,
    project?.companyProfile?.productsOrServices,
  ].filter(Boolean).join(' '));
  return FOOD_SEGMENT_KEYWORDS.some((keyword) => text.includes(keyword));
}

// Whether this project has ever had a real product/work photo uploaded
// (role "product_photo"), regardless of which subset got rotated into this
// specific generation. A project with none — an agency selling design work,
// an engineering firm selling inspections — has no physical product to
// depict, so the prompt should stop telling the AI to "invent a coherent
// product" and instead go conceptual (typography, icons, abstract shapes).
function hasAnyProductPhotoReference(project) {
  return normalizeProjectReferences(project).some((reference) => reference.role === 'product_photo');
}

function buildVisualStyleLine(project) {
  return isFoodBusiness(project)
    ? 'Visual gastronômico premium, comercial e apetitoso, com alto contraste e leitura rápida em celular.'
    : 'Visual comercial premium e profissional, coerente com o segmento real da empresa (não gastronômico, a menos que a empresa seja de alimentação), com alto contraste e leitura rápida em celular.';
}

// summarizeBrandForCreative() caps itself at 3 sentences pulled from the
// summary/communication/visualIdentity blocks in order, so a verbose summary
// block alone can exhaust that budget and silently drop the approved logo
// colors from the creative prompt. Surface them as their own line instead of
// relying on that budget.
function buildBrandColorLine(project = {}) {
  const identity = normalizeBrandIdentity(project.brandIdentity || {});
  const colors = [...identity.editedColors, ...identity.extractedColors].filter(Boolean);
  return colors.length ? `Cores da marca a respeitar: ${colors.join(', ')}.` : '';
}

function buildChatGptFinalCardPrompt(content, project, originalPrompt, channel, selectedReferences = []) {
  const topic = content.contentTopic || {};
  const targetChannel = channel || content.channel;
  // Goal-driven topics (autoridade/engajamento/educação etc.) don't have an
  // offer name to use as headline — forcing the literal company name as the
  // title on every single post reads as repetitive/robotic (the name is
  // already on the logo). Let the AI write a specific, hook-style headline
  // instead, the same way autoGenerateCta already lets it choose a CTA.
  const isGoalTopic = topic.source === 'goal';
  // An institutional special-date post (Dia dos Pais etc. with no offer
  // linked) has exactly the same problem as a goal topic — no offer name,
  // so exactTitle used to collapse to the raw project name, rendering the
  // company name as the whole headline with no actual message about the
  // occasion. Same fix, keyed off the occasion instead of the pillar topic —
  // but kept as its own case (not folded into isGoalTopic) because the tone
  // instruction differs: a pillar/authority hook is meant to sound like a
  // punchy business hook, but the same treatment on a commemorative date
  // read as a sales pitch instead of a celebration of the date itself.
  const isSpecialDateFreeTitle = topic.source === 'special_date' && !topic.offerId;
  // Same problem again, this time in the ad-creative pipeline: an
  // institutional ad (no offer linked — e.g. a brand-awareness or
  // engagement creative with no product to name) has no offer name either,
  // so exactTitle collapsed to the raw project name — worse here, since
  // project.name isn't even the real brand name for every client ("CASA DE
  // EMBALAGEM" is the project's own label; the real brand on the logo is
  // "Hygi Comércio"). Same hook-writing freedom a goal topic gets, subject
  // is the ad's real objective (Vendas/Conversão, Engajamento etc.) instead
  // of the pillar topic — the operator's own note, when given, already
  // reaches the model through the OBJETIVO section above regardless.
  const isAdCreativeFreeTitle = topic.source === 'ad_creative' && !topic.offerId;
  const isFreeTitleTopic = isGoalTopic || isSpecialDateFreeTitle || isAdCreativeFreeTitle;
  const freeTitleSubject = topic.specialDateLabel
    || (isAdCreativeFreeTitle ? AD_OBJECTIVE_LABELS[topic.adObjective] : null)
    || topic.label
    || project.name;
  const exactTitle = isFreeTitleTopic ? '' : normalizeCreativeTitle(topic.offerName || project.name);
  const exactPrice = normalizeCreativePrice(topic.price);
  const exactCta = chooseCreativeCta(topic);
  const objective = buildCreativeObjective(topic, project);
  const isVerticalStory = isVerticalStoryChannel(targetChannel);
  const useSalesHookTitle = creativeShapeGroupForChannel(targetChannel) === 'feed' && !isFreeTitleTopic && isSalesTopic(topic);
  const realUrgency = topic.type === 'urgency' ? cleanPromptText(topic.notes) : '';
  // A drawn button/selo isn't actually clickable in a Story/Reels asset —
  // the real action there happens through DM/reply, not a tap on the image
  // — so a bold CTA button reads as a UI element that does nothing. Feed
  // keeps the bold button treatment (bio link makes it a real next step);
  // vertical formats get the same CTA text folded into a small, subtitle-
  // style line instead, never a button/pill/selo.
  const useSubtleCta = isVerticalStory && Boolean(exactCta);
  const logoReferences = selectedReferences.filter((reference) => reference.role === 'brand_asset').slice(0, 1);
  const productReferences = selectedReferences.filter((reference) => reference.role === 'product_photo').slice(0, 2);
  // Only trust a photo as "this exact real product" when it's the one this
  // topic/offer explicitly linked (see buildPrimaryAiImageReferences) — a
  // pool-matched photo (legacy pizza/esfiha keyword fallback) doesn't get
  // this treatment, since we can't be sure it's the right SKU.
  const hasLinkedProductPhoto = Boolean(topic.photoReferenceIds?.length)
    && productReferences.some((reference) => topic.photoReferenceIds.includes(reference.id));
  const productFocus = detectCreativeProductFocus(topic, hasLinkedProductPhoto);
  const quantityRules = buildCreativeQuantityRules(topic, productFocus, exactTitle);
  const visualSummary = summarizeBrandForCreative(project);
  // Which single layout/visual reference to use is already rotated upstream
  // in buildPrimaryAiImageReferences (seeded per test run), so selectedReferences
  // contains at most one of each here.
  const layoutReference = selectedReferences.find((reference) => reference.role === 'layout_model');
  const visualReference = selectedReferences.find((reference) => reference.role === 'visual_reference');
  const variation = [
    extractPromptLine(originalPrompt, 'Conceito do teste:'),
    extractPromptLine(originalPrompt, 'Composição obrigatória desta tentativa:'),
    extractPromptLine(originalPrompt, 'Ângulo da copy/imagem:'),
  ].map(cleanPromptText).filter(Boolean).slice(0, 2);
  return [
    section('FORMATO', [
      imageFormatInstructionForChannel(targetChannel),
      isVerticalStory ? 'A composição deve ser nativa de Story vertical.' : '',
      isVerticalStory ? 'Não criar um flyer quadrado ou bloco central com aparência 1:1.' : '',
      isVerticalStory ? 'Distribuir os elementos ao longo da altura do canvas, aproveitando bem topo, centro e base.' : '',
      'Preencher todo o canvas; manter título, preço, CTA e logo dentro da área segura.',
    ]),
    section('OBJETIVO DO CRIATIVO', [
      // Skip the generic filler line when the topic already carries its own
      // specific objective (e.g. an offer's real name/price) — repeating a
      // vague sentence next to a specific one is pure noise, not signal.
      topic.objective ? '' : `Criar uma arte publicitária final para ${content.formatLabel || CHANNEL_LABELS[targetChannel] || targetChannel || 'Instagram'} da ${project.name}.`,
      objective,
    ]),
    section('TEXTOS OBRIGATÓRIOS', [
      isSpecialDateFreeTitle
        ? `Título: criar um título curto (até 8 palavras) com tom caloroso e comemorativo sobre "${freeTitleSubject}" — é um post de celebração da data, não uma oferta nem uma peça comercial. Pode conectar de leve com o negócio/segmento da marca, mas sem soar como anúncio, pitch de venda ou gancho de captação. Não usar apenas o nome "${project.name}" como título, o nome da marca já aparece na logo.`
        : isGoalTopic || isAdCreativeFreeTitle
          ? `Título: criar um título curto (até 8 palavras), chamativo, em formato de gancho ou pergunta específica sobre "${freeTitleSubject}" — não usar apenas o nome "${project.name}" como título, o nome da marca já aparece na logo. Ex. de estilo (adaptar ao assunto real, não copiar): pergunta direta que gera curiosidade, seguida de um subtítulo curto que reforça o valor.`
          : useSalesHookTitle
            ? `Título: criar um título-gancho curto sobre "${exactTitle}", sem inventar benefício, prazo ou desconto.`
            : `Título exato: ${exactTitle}`,
      topic.items ? `Subtítulo permitido: ${cleanPromptText(topic.items)}` : '',
      exactPrice ? `Preço exato: ${exactPrice}` : 'Preço: não inserir preço, pois não há preço cadastrado para este criativo.',
      realUrgency ? `Urgência real cadastrada: ${realUrgency}` : '',
      exactCta
        ? (useSubtleCta
          ? `CTA sutil: "${exactCta}" como texto pequeno, sem botão/selo.`
          : `CTA exato: ${exactCta}`)
        : 'Sem CTA nesta peça — não inserir nenhum botão, selo ou texto de chamada para ação (ex.: "peça agora", "chame agora", "saiba mais") na arte; é um post de conteúdo, não uma oferta.',
      topic.type ? `Tipo de publicação: ${offerTypeLabel(topic.type)}.` : '',
      [
        isFreeTitleTopic || useSalesHookTitle ? 'Não alterar preço' : 'Não alterar título, preço',
        exactCta ? ' ou CTA' : '',
        '. Não criar telefone, endereço, desconto ou informação extra.',
      ].join(''),
      realUrgency
        ? 'Não inventar outra urgência além da cadastrada.'
        : useSalesHookTitle ? 'Não criar urgência, estoque, prazo, desconto ou garantia falsa.' : '',
    ]),
    section('ATIVOS OFICIAIS', logoReferences.length ? [
      'Utilizar a logo oficial anexada.',
      'Preservar desenho, nome, cores e proporções; não redesenhar nem criar outra versão.',
      'Posicionar a logo em área natural, legível, sem corte, tamanho pequeno (~8% da largura), não dominante.',
      ...logoReferences.map((reference) => `Logo: ${reference.relativePath}`),
    ] : ['Não há logo oficial anexada; não inventar logotipo.']),
    section('PRODUTOS OU FOTOS REAIS', productReferences.length ? [
      'Utilizar as fotos reais selecionadas para esta geração.',
      'Preservar a aparência real do produto; pode recortar, ajustar luz, sombra e contraste para integrar ao layout.',
      isFoodBusiness(project)
        ? 'Não substituir por outro produto e não deformar ingredientes, bordas, queijo ou formato.'
        : 'Não substituir por outro produto/serviço e não deformar sua aparência, proporções ou identidade real.',
      ...productFocus.assetLines,
      ...quantityRules.assetLines,
      ...productReferences.map((reference) => `Foto selecionada: ${reference.relativePath}`),
    ] : hasAnyProductPhotoReference(project) ? [
      'Sem foto real selecionada nesta geração; criar produto/serviço coerente sem copiar marca de terceiros.',
      ...productFocus.assetLines,
      ...quantityRules.assetLines,
    ] : [
      // No product photo was ever uploaded for this project — treat it as a
      // service/work business with no physical product to depict, instead
      // of pushing the AI to hallucinate a generic fake product/service icon.
      'Este projeto não tem nenhuma foto real de produto ou trabalho entregue cadastrada — provavelmente vende serviço, não produto físico.',
      'Não inventar um produto físico genérico (caixa, objeto, ícone de serviço clichê). Resolver a composição com elementos gráficos conceituais: tipografia forte, formas, texturas e cores da marca como protagonistas visuais.',
      'Se houver referência de portfólio, obra ou trabalho real anexada em ATIVOS OFICIAIS/REFERÊNCIA PRINCIPAL, ela é a peça central — não substituir por outra coisa.',
      ...productFocus.assetLines,
      ...quantityRules.assetLines,
    ]),
    section('DIREÇÃO VISUAL', [
      visualSummary,
      buildVisualStyleLine(project),
      buildBrandColorLine(project),
      ...productFocus.visualLines,
      ...quantityRules.visualLines,
      isFoodBusiness(project)
        ? 'Comida: atenção real ao arroz/prato — grãos soltos, textura, brilho natural; evitar simetria/brilho de IA; luz quente e natural.'
        : 'Evitar visual infantil, plástico, artificial, genérico de IA, sobrecarregado ou com enfeites de template sem função.',
      // visualSummary above is pulled straight from the approved Raio-X
      // text, which can itself describe a business/dashboard visual style
      // as the brand's standing identity (confirmed on a real client: the
      // approved visualIdentity block literally says "priorizar mockups de
      // site/landing, quadros de diagnóstico"). That's correct for the
      // brand's regular content but reads as a sales pitch on a
      // commemorative post — override it here instead of trying to strip
      // it out of the approved block text itself.
      isSpecialDateFreeTitle
        ? 'Esta peça é uma celebração de data comemorativa, não o conteúdo comercial padrão da marca — mesmo que a direção acima descreva um estilo de dashboard, gráfico, mockup de tela/software ou "quadro de diagnóstico" como identidade visual da marca, NÃO usar nada disso aqui. Priorize uma composição mais humana, calorosa e simples, mantendo as cores e a logo da marca, mas sem parecer peça de vendas ou apresentação de negócio.'
        : '',
    ]),
    isVerticalStory ? section('ESTRUTURA VERTICAL OBRIGATÓRIA', [
      'Topo: logo + título principal.',
      quantityRules.storyCenterLine || 'Centro: produto principal como protagonista visual.',
      exactPrice ? 'Parte inferior média: preço em selo compacto e legível, preferencialmente lateral ou abaixo do produto, sem cobrir a área principal.' : '',
      exactCta
        ? `Rodapé: chamada “${exactCta}” em texto pequeno, sem botão — logo/fechamento limpo domina.`
        : 'Rodapé: fechamento visual limpo (logo ou elemento decorativo), sem botão ou selo de CTA.',
      'A composição deve ter leitura clara de cima para baixo e aproveitar topo, centro e base.',
    ]) : '',
    section('HIERARQUIA', [
      quantityRules.heroLine || productFocus.heroLine || (productReferences.length ? '1. Produto/foto real em destaque.' : '1. Produto ou benefício principal em destaque.'),
      quantityRules.heroLine && productFocus.heroLine ? productFocus.heroLine : '',
      isGoalTopic || useSalesHookTitle ? '2. Título chamativo criado pela IA (gancho curto e específico do assunto real).' : `2. Título “${exactTitle}”.`,
      exactPrice ? `3. Preço “${exactPrice}” em selo compacto de alto contraste.` : '',
      exactCta ? (useSubtleCta ? `4. Chamada sutil “${exactCta}” (sem botão).` : `4. CTA “${exactCta}”.`) : '',
      logoReferences.length ? '5. Logo oficial.' : '',
      'O produto deve ser o protagonista visual.',
      exactPrice ? 'O selo de preço não pode cobrir parte relevante do produto principal.' : '',
    ]),
    section('REFERÊNCIA PRINCIPAL', layoutReference ? [
      `Layout principal: ${layoutReference.relativePath}`,
      layoutReference.instruction ? `Direção do usuário: ${cleanPromptText(layoutReference.instruction)}` : '',
      'Usar apenas como inspiração para composição, hierarquia, enquadramento, distribuição dos elementos e tratamento do preço.',
      'Não copiar logo, nome, texto, preço, produto ou identidade da empresa presente na referência.',
      isVerticalStoryChannel(targetChannel)
        ? 'Adaptar obrigatoriamente para 9:16 Vertical; a referência não pode forçar arte quadrada.'
        : '',
      visualReference ? `Referência visual secundária opcional: ${visualReference.relativePath}` : '',
    ] : ['Sem layout principal selecionado; resolver composição livremente seguindo formato, hierarquia e direção visual.']),
    section('LIBERDADE CRIATIVA', [
      'A IA pode definir enquadramento, fundo, iluminação, tipografia, posição dos produtos, formato do selo de preço e elementos decorativos relacionados ao segmento.',
      variation.length
        ? `Variação desejada: ${variation.join(' ')}`
        : 'Composição distinta da anterior: mudar ângulo, fundo ou detalhe do prato.',
    ]),
    section('RESTRIÇÕES FINAIS', [
      isVerticalStory ? 'Não criar composição com aparência de flyer quadrado centralizado.' : '',
      exactPrice ? 'Não posicionar o preço no centro cobrindo o produto principal.' : '',
      ...productFocus.restrictionLines,
      ...quantityRules.restrictionLines,
      'Não inserir textos aleatórios, marcas concorrentes, telefone, endereço ou informações não fornecidas.',
      'Não cortar letras, preço, CTA ou logo; não usar retângulo branco gigante nem colagem de referências.',
      'A imagem deve sair pronta como anúncio final.',
    ]),
  ].filter(Boolean).join('\n\n');
}

function normalizeCreativeTitle(value) {
  return String(value || '')
    .trim()
    .replace(/\b(\d+)\s+Pizza\s+Grande\b/gi, '$1 Pizzas Grandes')
    .replace(/\b(\d+)\s+Pizzas\s+Grande\b/gi, '$1 Pizzas Grandes')
    .replace(/\s+/g, ' ') || 'Oferta da marca';
}

function normalizeCreativePrice(value) {
  const price = String(value || '').trim();
  if (!price) return '';
  if (/R\$/i.test(price)) return price.replace(/\s+/g, ' ');
  if (/^\d+[,.]\d{2}$/.test(price) || /^\d+$/.test(price)) return `R$ ${price.replace('.', ',')}`;
  return price;
}

// When the topic has a resolved pillar, its role (set by the operator per
// project) takes over from the hardcoded offer-type list — a custom
// "Convida" pillar behaves the same as combo/delivery/offer/product/rodizio
// did. Urgency posts are also sales topics when the operator registered a
// real urgent offer. Anything else (orientation, institutional, desire, or a
// pillar like "ensina"/"prova"/"posiciona") is not actually asking for an
// order, so it shouldn't carry a hard sales CTA at all.
function isSalesTopic(topic = {}) {
  if (topic.pillar) return topic.pillar.role === 'convida';
  return ['combo', 'delivery', 'offer', 'product', 'rodizio', 'urgency'].includes(topic.type);
}

// chooseCreativeCta always honors an explicit topic.cta, sales or not — that
// is correct for real registered offers, but goal/default topic templates
// (buildGoalContentTopic, DEFAULT_CONTENT_TOPICS) hardcode a "ctaDefault" per
// template regardless of type, which silently defeated the "no CTA on
// non-sales content" rule before isSalesTopic ever got a chance to run.
// Gate any templated default CTA through isSalesTopic before it becomes an
// explicit topic.cta.
function salesGatedCta(topicWithoutCta, ctaIfSales) {
  return isSalesTopic(topicWithoutCta) ? ctaIfSales : '';
}

// Explicit CTA wins. Otherwise real sales offers get a direct CTA on every
// channel; Feed used to say "Saiba mais", but that was weak for conversion.
//
// Non-sales content (orientation/institutional/relationship posts, or a
// pillar that isn't "convida") gets no CTA here at all — baking a "peça
// agora"-style button into a post whose whole point is to *not* look like a
// promotion undercuts the content. The caption still closes with its own
// natural, contextual call to action (autoGenerateCta) — that's a separate,
// softer mechanism from the hard button rendered inside the creative.
export function chooseCreativeCta(topic = {}) {
  const explicit = String(topic.cta || '').trim();
  if (explicit) return explicit;
  if (!isSalesTopic(topic)) return '';
  if (topic.type === 'rodizio') return 'Reserve agora';
  return 'Peça agora';
}

function buildCreativeObjective(topic = {}, project = {}) {
  if (topic.objective) return cleanPromptText(topic.objective);
  if (topic.type === 'combo' || topic.type === 'delivery' || topic.type === 'offer') {
    return 'Criar uma oferta direta para gerar pedidos rápidos.';
  }
  if (topic.type === 'rodizio') return 'Criar uma chamada clara para o rodízio, com apetite e urgência moderada.';
  return `Criar uma peça comercial clara e profissional para ${project.name}.`;
}

// Product-photo selection is otherwise a naive "first 2 uploaded" slice —
// with multiple product lines (e.g. pizza + esfiha) sharing one reference
// gallery, that silently keeps handing the AI photos of the wrong product
// for offers about the other one. Reuses the same "esfiha" vs "pizza"
// keyword detection as detectCreativeProductFocus so a reference tagged/
// named for the current offer's product wins the slice(0, 2) cut instead of
// whichever photo happened to be uploaded first.
function detectReferenceTopicFocus(topic = {}) {
  const text = normalizeComparableText([topic?.offerName, topic?.items, topic?.label, topic?.objective].filter(Boolean).join(' '));
  if (text.includes('esfiha')) return 'esfiha';
  if (text.includes('pizza')) return 'pizza';
  return '';
}

function prioritizeReferencesByTopic(refs, focus) {
  if (!focus) return refs;
  const matchesFocus = (reference) => normalizeComparableText(
    [reference.filename, reference.instruction].filter(Boolean).join(' ')
  ).includes(focus);
  const matching = refs.filter(matchesFocus);
  if (!matching.length) return refs;
  const rest = refs.filter((reference) => !matchesFocus(reference));
  return [...matching, ...rest];
}

function detectCreativeProductFocus(topic = {}, hasLinkedProductPhoto = false) {
  const text = normalizeComparableText([
    topic.offerName,
    topic.items,
    topic.label,
    topic.objective,
  ].filter(Boolean).join(' '));
  if (text.includes('esfiha')) {
    return {
      heroLine: '1. Esfihas reais em destaque como produto principal.',
      assetLines: [
        'O produto principal deve ser visualmente reconhecível como esfiha.',
        'Mostrar esfihas abertas com aparência realista e coerente com a oferta.',
      ],
      visualLines: [
        'O foco visual desta peça são esfihas, não pizzas.',
        'As esfihas devem ser claramente reconhecíveis como esfihas abertas.',
        'Evitar aparência de pizza grande, fatia de pizza ou mini pizza genérica.',
      ],
      restrictionLines: [
        'Não gerar produto ambíguo entre pizza e esfiha.',
      ],
    };
  }
  if (text.includes('pizza')) {
    return {
      heroLine: '1. Pizzas reais em destaque como produto principal.',
      assetLines: ['O produto principal deve ser visualmente reconhecível como pizza.'],
      visualLines: ['O foco visual desta peça são pizzas, com queijo, recheio e bordas bem definidos.'],
      restrictionLines: ['Não gerar produto ambíguo que pareça esfiha, pão ou prato genérico.'],
    };
  }
  // Generic product line: fires for any project outside the food-specific
  // branches above once a real, offer-linked photo is in play (e.g. a phone,
  // shoe or appliance reseller with many distinct real SKUs) — names the
  // exact product instead of leaving the AI to invent/guess a generic one.
  if (hasLinkedProductPhoto && topic.offerName) {
    return {
      heroLine: `1. ${topic.offerName} real (foto anexada) em destaque como produto principal.`,
      assetLines: [
        `O produto principal é exatamente o item real da foto anexada: ${topic.offerName}. Não trocar por outro modelo, cor ou versão.`,
        'Preservar fielmente formato, cor, textos, logotipos, botões e proporções reais do produto fotografado.',
      ],
      visualLines: [
        `O foco visual desta peça é o produto real fotografado (${topic.offerName}), não uma reinterpretação genérica.`,
      ],
      restrictionLines: [
        'Não substituir o produto por outro modelo, cor ou versão diferente da foto anexada. Não inventar um produto genérico no lugar da foto real.',
      ],
    };
  }
  return {
    heroLine: '',
    assetLines: [],
    visualLines: [],
    restrictionLines: [],
  };
}

function buildCreativeQuantityRules(topic = {}, productFocus = {}, exactTitle = '') {
  const quantity = detectOfferQuantity(topic);
  if (!quantity || quantity < 2) {
    return {
      heroLine: '',
      storyCenterLine: '',
      assetLines: [],
      visualLines: [],
      restrictionLines: [],
    };
  }
  const titleText = normalizeComparableText(exactTitle || topic.offerName || '');
  const sourceText = normalizeComparableText([
    topic.offerName,
    topic.items,
    productFocus.heroLine,
  ].filter(Boolean).join(' '));
  const productSingular = titleText.includes('esfiha') || sourceText.includes('esfiha') ? 'esfiha' : 'pizza';
  const productPlural = productSingular === 'esfiha' ? 'esfihas' : 'pizzas';
  const qualifier = titleText.includes('grande') ? ' grandes' : '';
  const comboLabel = `${quantity} ${productPlural}${qualifier}`;
  return {
    heroLine: `1. Combo de ${comboLabel} em destaque.`,
    storyCenterLine: `Centro: combo de ${quantity} ${productPlural} como protagonista visual.`,
    assetLines: [
      `A composição deve comunicar visualmente um combo de ${comboLabel}.`,
      `Mostrar visualmente a quantidade ${quantity}, não apenas uma ${productSingular} isolada.`,
      `Pode organizar ${quantity} ${productPlural} de forma clara e comercial, ou repetir o produto real em composição coerente para representar o combo.`,
    ],
    visualLines: [
      `A leitura visual precisa ser imediata: o usuário deve entender que a oferta inclui ${comboLabel}.`,
    ],
    restrictionLines: [
      `Não mostrar apenas uma ${productSingular} como item unitário.`,
      `Não gerar apenas uma ${productSingular} quando a oferta for combo de ${quantity} ${productPlural}.`,
    ],
  };
}

function detectOfferQuantity(topic = {}) {
  const text = String([
    topic.offerName,
    topic.items,
    topic.label,
  ].filter(Boolean).join(' '));
  const match = text.match(/\b(\d{1,2})\s+(?:pizza|pizzas|esfiha|esfihas|hamb[uú]rguer|hamb[uú]rgueres|lanche|lanches)\b/i);
  if (!match) return 0;
  const quantity = Number(match[1]);
  return Number.isFinite(quantity) ? quantity : 0;
}

function buildCreativePreflight(topic = {}, channel = '', rawReferences = [], selectedReferences = []) {
  const checks = [];
  const warnings = [];
  const originalTitle = String(topic.offerName || '').trim();
  const normalizedTitle = normalizeCreativeTitle(originalTitle);
  if (originalTitle && normalizedTitle !== originalTitle) {
    warnings.push(`Título "${originalTitle}" foi normalizado para "${normalizedTitle}" antes da geração para melhorar leitura e evitar erro de plural.`);
  }
  if (!normalizeCreativePrice(topic.price)) warnings.push('Oferta sem preço válido; a imagem não deve inventar preço.');
  const quantity = detectOfferQuantity(topic);
  if (quantity > 1) checks.push(`Oferta com quantidade detectada (${quantity}); prompt deve comunicar visualmente a quantidade do combo.`);
  if (isVerticalStoryChannel(channel)) {
    const selectedPaths = new Set(selectedReferences.map((reference) => reference.relativePath));
    const ignoredSquareLayouts = rawReferences.filter((reference) => (
      reference?.role === 'layout_model'
      && !selectedPaths.has(reference.relativePath)
      && isSquareLikeReference(reference)
    ));
    if (ignoredSquareLayouts.length) {
      checks.push(`Story: ${ignoredSquareLayouts.length} referência de layout quadrada foi ignorada/rebaixada antes de chamar o ChatGPT.`);
    }
  }
  return {
    status: warnings.length ? 'warning' : 'ok',
    checks,
    warnings,
  };
}

function summarizeBrandForCreative(project = {}) {
  const xrayBlocks = project.brandXray?.blocks || {};
  const candidates = [
    xrayBlocks.summary?.text,
    xrayBlocks.communication?.text,
    xrayBlocks.visualIdentity?.text,
    project.brand?.visualStyle,
    project.companyProfile?.segment ? `Marca do segmento ${project.companyProfile.segment}.` : '',
  ].map(cleanPromptText).filter(Boolean);
  const sentences = [];
  for (const candidate of candidates) {
    for (const sentence of candidate.split(/(?<=[.!?])\s+/)) {
      const clean = cleanPromptText(sentence);
      if (!clean || sentences.includes(clean)) continue;
      sentences.push(clean);
      if (sentences.length >= 3) return sentences.join(' ');
    }
  }
  return 'Marca comercial, confiável e fácil de entender, com visual profissional alinhado ao segmento.';
}

function cleanPromptText(value) {
  return String(value || '')
    .replace(/\bInformado pelo usuário:\s*/gi, '')
    .replace(/\bSugestão da IA:\s*/gi, '')
    .replace(/\bExtraído da logo\/identidade:\s*/gi, '')
    .replace(/\bExtraído da logo:\s*/gi, '')
    .replace(/\bSem tratar essa sugestão como fato confirmado\.?/gi, '')
    .replace(/\bDescrição livre ainda não informada\.?/gi, '')
    .replace(/\bDiferencial ainda não informado\.?/gi, '')
    .replace(/\bcores ainda não identificadas\/editadas\.?/gi, '')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:—-]+|[\s,.;:—-]+$/g, '')
    .trim();
}

function buildPrimaryAiImageReferences(references, options = {}) {
  const allowedRoles = new Set(['brand_asset', 'product_photo', 'layout_model', 'visual_reference']);
  const isStory = isVerticalStoryChannel(options.channel);
  const topicFocus = detectReferenceTopicFocus(options.topic);
  const linkedPhotoIds = new Set(options.topic?.photoReferenceIds || []);
  // Photos explicitly linked to a DIFFERENT offer (see photoReferenceIds)
  // must never be borrowed as this topic's fallback — with several distinct
  // real products in one project (e.g. a phone reseller with dozens of
  // models), a photo already claimed by "Redmi A7 Pro" showing up on a
  // "Redmi Note 15" post isn't a stylistic mismatch, it's just the wrong
  // product. Only photos nobody has claimed stay eligible for the
  // keyword-based pool fallback below (single-product businesses like one
  // pizzeria's dish photos, which were never claimed by any offer).
  const claimedByOtherOffers = new Set(
    (options.allOffers || [])
      .filter((offer) => offer.id !== options.topic?.offerId)
      .flatMap((offer) => offer.photoReferenceIds || [])
  );
  const selected = [];
  for (const reference of references) {
    const usageRoles = normalizeReferenceUsageRoles(reference.usageRoles, reference.role);
    if (usageRoles.includes('text_parameter')) continue;
    if (!allowedRoles.has(reference.role)) continue;
    selected.push(reference);
  }
  const brandAssets = selected.filter((reference) => reference.role === 'brand_asset').slice(0, 1);
  const productPool = selected.filter((reference) => reference.role === 'product_photo' && !claimedByOtherOffers.has(reference.id));
  // A topic/offer with its own explicitly linked photo(s) — e.g. a reseller
  // with dozens of visually distinct real products (phone models, shoes,
  // etc.) — must always show THAT exact product, never a guess from a
  // shared pool. The keyword-based prioritizeReferencesByTopic below only
  // knows a couple of hardcoded food terms and is the wrong tool once a
  // project has more than one kind of physical product.
  //
  // This must be matched against `selected` (every product photo, before
  // the other-offers exclusion), not `productPool` — otherwise a photo that
  // happens to already be linked to some registered offer could never be
  // explicitly requested for anything else (an institutional/ad-creative
  // topic has no offerId, so claimedByOtherOffers above treats it as
  // "belongs to every offer" and swallows nearly the whole catalog; an
  // explicit photoReferenceIds request is a deliberate pick, not a fallback
  // guess, so the "claimed by a different offer" guard — meant to stop the
  // keyword fallback from grabbing the wrong product — must not apply to it).
  const linkedPhotos = linkedPhotoIds.size
    ? selected.filter((reference) => reference.role === 'product_photo' && linkedPhotoIds.has(reference.id)).slice(0, 2)
    : [];
  const productPhotos = linkedPhotos.length
    ? linkedPhotos
    : prioritizeReferencesByTopic(productPool, topicFocus).slice(0, 2);
  const storyCompatibleLayouts = selected.filter((reference) => (
    reference.role === 'layout_model'
    && (!isStory || !isSquareLikeReference(reference))
  ));
  // Rotate which single layout/inspiration reference gets used instead of
  // always the same array-order match — with several layout references
  // uploaded, every generation (even across separate test runs) was
  // otherwise anchored to whichever one happened to be first, which is a
  // big part of why repeated tests looked near-identical.
  const layoutReferences = pickRotatingReferenceList(storyCompatibleLayouts, options.variationSeed, 1);
  const visualCandidates = selected.filter((reference) => reference.role === 'visual_reference');
  const visualReferences = pickRotatingReferenceList(visualCandidates, `${options.variationSeed || ''}-visual`, layoutReferences.length ? 0 : 1);
  return uniqueReferences([...brandAssets, ...productPhotos, ...layoutReferences, ...visualReferences]);
}

function isVerticalStoryChannel(channel) {
  return channel === 'instagram_story' || channel === 'instagram_reels' || channel === 'facebook_story';
}

// Channels that render at the exact same pixel shape can share one
// AI-generated creative instead of each paying for/waiting on its own
// generation — see the pairing logic in generateContentSchedulePlan() and
// the group-aware enrichBatchItemsWithRealImages() below.
export function creativeShapeGroupForChannel(channel) {
  if (isVerticalStoryChannel(channel)) return 'vertical';
  if (channel === 'instagram_feed' || channel === 'facebook_feed') return 'feed';
  return null;
}

function isSquareLikeReference(reference = {}) {
  const orientation = referenceOrientation(reference);
  if (orientation) return orientation === 'square';
  const text = normalizeComparableText([reference.filename, reference.relativePath, reference.instruction].filter(Boolean).join(' '));
  return text.includes('quadrado') || text.includes('square') || text.includes('1 1') || text.includes('1x1');
}

function referenceOrientation(reference = {}) {
  const explicit = String(reference.aspectRatio || reference.orientation || '').trim().toLowerCase();
  if (['square', 'quadrado', '1:1', '1x1'].includes(explicit)) return 'square';
  if (['vertical', 'portrait', 'story', '9:16', '9x16'].includes(explicit)) return 'vertical';
  if (['horizontal', 'landscape', '16:9', '16x9'].includes(explicit)) return 'horizontal';
  const width = Number(reference.width || 0);
  const height = Number(reference.height || 0);
  if (width > 0 && height > 0) {
    const ratio = width / height;
    if (Math.abs(ratio - 1) <= 0.08) return 'square';
    if (height > width) return 'vertical';
    return 'horizontal';
  }
  return '';
}

function normalizeCreativeAttemptLimit(value) {
  const numeric = Number(value || 3);
  if (!Number.isFinite(numeric)) return 3;
  return Math.min(5, Math.max(1, Math.trunc(numeric)));
}

function appendCreativeReviewCorrections(basePrompt, reviews) {
  return [
    basePrompt,
    section('CORREÇÕES OBRIGATÓRIAS DO REVISOR', [
      'A tentativa anterior foi bloqueada. Refazer a imagem obedecendo todas as correções abaixo antes de qualquer preferência estética.',
      ...reviews.flatMap((review) => [
        `Tentativa ${review.attempt || '?'} bloqueada: ${review.summary || 'corrigir imagem.'}`,
        ...(review.errors || []).map((error) => `Erro: ${error}`),
        ...(review.warnings || []).map((warning) => `Alerta: ${warning}`),
      ]),
      'Se o canal for Story/Reels, a nova imagem precisa nascer como Story vertical nativo 9:16 real; não criar arte quadrada dentro de moldura vertical.',
      'Não criar bloco central com aparência 1:1; distribuir a composição entre topo, centro e base do canvas.',
      'Reposicionar título, preço, logo e CTA para dentro da área segura, com margem interna generosa.',
      'Se houver preço, usar destaque compacto e premium; não usar retângulo branco gigante, moldura simples ou caixa cobrindo o produto/serviço principal.',
      'O produto deve continuar protagonista; se a oferta for de esfiha, o visual deve parecer esfiha aberta, não pizza ou mini pizza genérica.',
    ]),
  ].join('\n\n');
}

function appendCreativeRescueCorrections(basePrompt, reviews, channel) {
  const channelName = channel === 'instagram_reels' ? 'Reels' : 'Story';
  return [
    basePrompt,
    section(`MODO RESGATE DE ${channelName.toUpperCase()}`, [
      `As tentativas anteriores falharam por formato/canvas. Agora refazer do zero como ${channelName} vertical real 9:16, não como adaptação da arte anterior.`,
      'Ignorar completamente modelos de layout que possam induzir arte horizontal, quadrada, feed, moldura, mockup ou canvas com área central vertical.',
      'Criar uma única arte final vertical 1080x1920 preenchendo todo o canvas de Instagram Stories/Reels.',
      'Não colocar um flyer quadrado dentro do Story. Não usar canvas horizontal. Não usar moldura externa. Não deixar espaço lateral sobrando.',
      'Composição segura obrigatória: logo no topo dentro da margem, título curto dentro da margem, produto ocupando o centro/baixo sem cortar informações importantes, preço em selo compacto, CTA curto no rodapé dentro da margem.',
      'Se algum texto ficaria cortado, reduzir texto ou reposicionar; nunca cortar letras, preço, logo ou CTA.',
      'Priorizar formato correto acima de seguir referência de layout. Usar referências restantes apenas para produto/logo/estilo, não para copiar composição.',
      ...reviews.flatMap((review) => [
        `Tentativa ${review.attempt || '?'} bloqueada: ${review.summary || 'corrigir formato.'}`,
        ...(review.errors || []).map((error) => `Erro: ${error}`),
        ...(review.warnings || []).map((warning) => `Alerta: ${warning}`),
      ]),
    ]),
  ].join('\n\n');
}

// Ad creative and organic post creative want different things from the same
// composition rules — an ad has to win attention from someone who wasn't
// looking for it, in a feed full of other ads, in under a couple seconds.
// Appended on top of the normal brief (buildChatGptFinalCardPrompt already
// gives it the real logo/photo/price/hierarchy rules); this only adds the
// paid-specific direction.
function appendAdCreativeFraming(basePrompt) {
  return [
    basePrompt,
    section('ESTA É UMA PEÇA DE ANÚNCIO PAGO', [
      'Não é um post orgânico — é um anúncio que vai competir com outros anúncios pela atenção de alguém que não estava procurando por isso. Precisa parar o scroll nos primeiros 2-3 segundos.',
      'Gancho visual mais direto e de maior contraste do que um post social comum: hierarquia clara e imediata entre gancho, oferta/benefício e chamada.',
      'A chamada para ação deve deixar claro que o próximo passo é chamar no WhatsApp — pode usar um ícone de WhatsApp reconhecível na composição, sem inventar número de telefone ou qualquer contato que não esteja cadastrado.',
    ]),
  ].join('\n\n');
}

function shouldEnterStoryRescueMode(review, channel) {
  if (!isVerticalStoryChannel(channel)) return false;
  if (review?.status !== 'blocked') return false;
  const text = formatCreativeReviewFeedback(review).toLowerCase();
  return [
    'formato',
    'canvas',
    'horizontal',
    'quadrado',
    '1:1',
    '9:16',
    'vertical',
    'story',
    'stories',
    'reels',
  ].some((term) => text.includes(term));
}

function buildRescueImageReferences(references) {
  const allowedRoles = new Set(['brand_asset', 'product_photo', 'visual_reference']);
  const selected = [];
  for (const reference of references) {
    const usageRoles = normalizeReferenceUsageRoles(reference.usageRoles, reference.role);
    if (reference.role === 'layout_model' || usageRoles.includes('layout_model') || usageRoles.includes('text_parameter')) continue;
    if (!allowedRoles.has(reference.role)) continue;
    selected.push(reference);
  }
  const brandAssets = selected.filter((reference) => reference.role === 'brand_asset').slice(0, 1);
  const productPhotos = selected.filter((reference) => reference.role === 'product_photo').slice(0, 2);
  const visualReferences = selected.filter((reference) => reference.role === 'visual_reference').slice(0, Math.max(0, 2 - productPhotos.length));
  return uniqueReferences([...brandAssets, ...productPhotos, ...visualReferences]);
}

function formatCreativeReviewFeedback(review) {
  return [
    review?.summary,
    ...(review?.errors || []),
    ...(review?.warnings || []),
  ].filter(Boolean).join('\n');
}

function mergeCreativeReview(contentReview = {}, creativeReview = {}) {
  const checks = [...(contentReview.checks || []), ...(creativeReview.checks || [])];
  const warnings = [...(contentReview.warnings || [])];
  const errors = [...(contentReview.errors || []), ...(creativeReview.errors || [])];
  if (creativeReview.status === 'blocked') {
    warnings.push(`Revisor de Criativo bloqueou: ${creativeReview.summary || 'corrigir imagem antes de aprovar.'}`);
  } else if (creativeReview.status === 'warning') {
    warnings.push(`Revisor de Criativo alertou: ${creativeReview.summary || 'revisar imagem antes de aprovar.'}`);
  } else if (creativeReview.status === 'ok') {
    checks.push('Revisor de Criativo aprovou a imagem IA.');
  }
  return {
    ...contentReview,
    status: errors.length || creativeReview.status === 'blocked'
      ? 'blocked'
      : warnings.length || creativeReview.status === 'warning'
        ? 'warning'
        : 'ok',
    checks,
    warnings,
    ...(errors.length ? { errors } : {}),
  };
}

function normalizeCreativeReview(review, now = new Date()) {
  const errors = normalizeRuleList(review?.errors || []);
  const warnings = normalizeRuleList(review?.warnings || []);
  const checks = normalizeRuleList(review?.checks || []);
  const requestedStatus = String(review?.status || '').trim();
  // A malformed-but-valid-JSON response (e.g. "{}") has no status and no
  // checks/errors/warnings — that used to fall through to 'ok' by default,
  // silently treating "the reviewer didn't actually say anything" the same
  // as "the reviewer looked and approved it". Anything with zero signal
  // needs a human to look instead of sailing through as approved.
  const hasReviewSignal = ['blocked', 'warning', 'ok'].includes(requestedStatus)
    || errors.length || warnings.length || checks.length;
  const status = requestedStatus === 'blocked' || errors.length
    ? 'blocked'
    : requestedStatus === 'warning' || warnings.length
      ? 'warning'
      : hasReviewSignal
        ? 'ok'
        : 'warning';
  const defaultSummary = status === 'ok'
    ? 'Imagem aprovada na revisão automática.'
    : hasReviewSignal
      ? 'Imagem precisa de revisão.'
      : 'Revisor retornou resposta vazia/inesperada — revise manualmente antes de aprovar.';
  return {
    agent: 'Agente Revisor de Criativo',
    status,
    summary: String(review?.summary || defaultSummary).trim(),
    checks,
    warnings: hasReviewSignal ? warnings : [...warnings, 'Revisor não retornou avaliação válida (resposta vazia ou incompleta).'],
    errors,
    reviewedAt: now.toISOString(),
  };
}

function filterImageRulesForTopic(imageRules, contentTopic, project) {
  if (!contentTopic) return imageRules;
  const expectedPrices = extractPriceTokens(contentTopic.price);
  const currentOffer = normalizeComparableText([contentTopic.offerName, contentTopic.label, contentTopic.type].filter(Boolean).join(' '));
  const otherOffers = normalizeProjectOffers(project.contentStrategy?.offers || [])
    .filter((offer) => offer.active !== false)
    .filter((offer) => offer.id !== contentTopic.offerId)
    .map((offer) => normalizeComparableText([offer.name, offer.type, offer.price].filter(Boolean).join(' ')))
    .filter(Boolean);

  return imageRules.filter((rule) => {
    const normalizedRule = normalizeComparableText(rule);
    const rulePrices = extractPriceTokens(rule);
    if (!rulePrices.length) return true;
    const hasExpectedPrice = expectedPrices.some((price) => rulePrices.includes(price));
    if (!hasExpectedPrice) return false;
    if (otherOffers.some((offerText) => offerText && includesMeaningfulOfferText(normalizedRule, offerText, currentOffer))) return false;
    return true;
  });
}

function extractPriceTokens(value) {
  return [...String(value || '').matchAll(/\d+(?:[,.]\d{2})?/g)]
    .map((match) => match[0].replace(',', '.'));
}

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function includesMeaningfulOfferText(ruleText, offerText, currentOfferText) {
  const tokens = offerText
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !currentOfferText.includes(token));
  return tokens.some((token) => ruleText.includes(token));
}

function normalizeProjectOffers(offers) {
  return Array.isArray(offers)
    ? offers.map((offer) => normalizeProjectOffer(offer)).filter((offer) => offer.name)
    : [];
}

function normalizeCompanyProfile(input = {}) {
  return {
    segmentGroup: cleanText(input?.segmentGroup),
    segmentCategory: cleanText(input?.segmentCategory),
    segmentSpecialty: cleanText(input?.segmentSpecialty),
    segment: cleanText(input?.segment),
    description: cleanText(input?.description),
    audience: cleanText(input?.audience),
    audienceType: normalizeAudienceType(input?.audienceType),
    location: cleanText(input?.location),
    productsOrServices: cleanText(input?.productsOrServices),
    differentiators: cleanText(input?.differentiators),
    primaryObjective: cleanText(input?.primaryObjective),
    websiteOrInstagram: cleanText(input?.websiteOrInstagram),
    factualConstraints: cleanText(input?.factualConstraints),
    tone: normalizeUniqueTextList(input?.tone),
    contentGoals: normalizeUniqueTextList(input?.contentGoals),
    brandColors: cleanText(input?.brandColors),
    avoid: cleanText(input?.avoid),
    positioning: cleanText(input?.positioning),
  };
}

// Every field here is either exactly what was visible in the prospect's
// real screenshot or `null` — never a fabricated default (0 followers would
// be indistinguishable from "the AI couldn't read this").
function normalizeProspectSource(input = {}) {
  // Number(null) is 0, not NaN — a stored `null` (nothing extracted) must
  // stay null through a second normalization pass (loadProject re-running
  // this over an already-normalized project), not flip into a fabricated
  // "0 seguidores" the next time the project is loaded.
  const cleanCount = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
  };
  return {
    handle: cleanText(input?.handle) || null,
    bio: cleanText(input?.bio) || null,
    realFollowers: cleanCount(input?.realFollowers),
    realPosts: cleanCount(input?.realPosts),
    realFollowing: cleanCount(input?.realFollowing),
  };
}

function formatCompanyProfileLines(input = {}) {
  const profile = normalizeCompanyProfile(input);
  return [
    profile.segmentGroup ? `Setor principal: ${profile.segmentGroup}.` : '',
    profile.segmentCategory ? `Categoria selecionada: ${profile.segmentCategory}.` : '',
    profile.segmentSpecialty ? `Especialidade/subsegmento: ${profile.segmentSpecialty}.` : '',
    profile.segment ? `Segmento: ${profile.segment}.` : '',
    profile.description ? `Descrição da empresa: ${profile.description}.` : '',
    profile.productsOrServices ? `O que vende/presta: ${profile.productsOrServices}.` : '',
    profile.audienceType ? `Foco comercial: ${audienceTypeLabel(profile.audienceType)}.` : '',
    profile.audience ? `Público-alvo: ${profile.audience}.` : '',
    profile.location ? `Região/cidade: ${profile.location}.` : '',
    profile.differentiators ? `Diferenciais: ${profile.differentiators}.` : '',
    profile.primaryObjective ? `Objetivo principal da comunicação: ${profile.primaryObjective}.` : '',
    profile.websiteOrInstagram ? `Site/Instagram informado: ${profile.websiteOrInstagram}.` : '',
    profile.factualConstraints ? `Informações que não podem ser inventadas: ${profile.factualConstraints}.` : '',
    profile.positioning ? `Posicionamento desejado: ${profile.positioning}.` : '',
    profile.tone.length ? `Tom de voz: ${profile.tone.join(', ')}.` : '',
    profile.contentGoals.length ? `Interesses/objetivos das postagens: ${profile.contentGoals.map(companyContentGoalLabel).join(', ')}.` : '',
    profile.brandColors ? `Cores/identidade desejada: ${profile.brandColors}.` : '',
    profile.avoid ? `Evitar: ${profile.avoid}.` : '',
  ].filter(Boolean);
}

function formatCompanyFactLines(input = {}) {
  const profile = normalizeCompanyProfile(input);
  const lines = [
    profile.segmentGroup ? `Setor principal selecionado pelo operador: ${profile.segmentGroup}.` : '',
    profile.segmentCategory ? `Categoria selecionada pelo operador: ${profile.segmentCategory}.` : '',
    profile.segmentSpecialty ? `Especialidade/subsegmento selecionado: ${profile.segmentSpecialty}.` : '',
    profile.segment ? `Segmento informado: ${profile.segment}.` : '',
    (profile.segmentGroup || profile.segmentCategory || profile.segmentSpecialty) ? 'Trava de segmento: não misturar com outro setor, tipo de negócio ou subsegmento técnico parecido se ele não estiver descrito nos produtos/serviços atuais.' : '',
    profile.description ? `Descrição fornecida: ${profile.description}.` : '',
    profile.productsOrServices ? `Produtos/serviços informados: ${profile.productsOrServices}.` : '',
    profile.audienceType ? `Foco comercial informado: ${audienceTypeLabel(profile.audienceType)}.` : '',
    profile.location ? `Região/cidade informada: ${profile.location}.` : '',
    profile.differentiators ? `Diferenciais conhecidos: ${profile.differentiators}.` : '',
    profile.audience ? `Público conhecido pelo usuário: ${profile.audience}.` : '',
    profile.primaryObjective ? `Objetivo principal informado: ${profile.primaryObjective}.` : '',
    profile.websiteOrInstagram ? `Site/Instagram informado: ${profile.websiteOrInstagram}.` : '',
    profile.brandColors ? `Cores/identidade informadas: ${profile.brandColors}.` : '',
    profile.factualConstraints ? `Informações que não podem ser inventadas: ${profile.factualConstraints}.` : '',
    profile.avoid ? `Evitar por pedido do usuário: ${profile.avoid}.` : '',
  ].filter(Boolean);
  return lines.length ? lines : ['Raio-X factual ainda não preenchido; criar com base apenas nos dados cadastrados e não assumir segmento, público ou promessa.'];
}

// tone/audience/avoid/positioning/brandColors/factualConstraints/
// websiteOrInstagram used to live only on the parallel companyProfile
// structure, which no UI (old or new) ever wrote to and which the real
// Raio-X generator never read — so an operator filling them in had zero
// effect on anything. They're real, load-bearing fields (formatCompanyProfileLines/
// formatCompanyFactLines already format them into prompt text); they were
// just never wired to a writable, read path. brandInput is the schema every
// real save/generate path actually uses, so they live here now.
function normalizeBrandInput(input = {}) {
  return {
    brandName: cleanText(input?.brandName || input?.name),
    segmentGroup: cleanText(input?.segmentGroup),
    segmentCategory: cleanText(input?.segmentCategory),
    segmentSpecialty: cleanText(input?.segmentSpecialty),
    segment: cleanText(input?.segment),
    productsOrServices: cleanText(input?.productsOrServices),
    description: cleanText(input?.description),
    serviceRegion: cleanText(input?.serviceRegion || input?.location),
    mainDifferential: cleanText(input?.mainDifferential || input?.differentiators),
    contentGoals: normalizeContentGoalList(input?.contentGoals),
    audience: cleanText(input?.audience),
    audienceType: normalizeAudienceType(input?.audienceType),
    tone: normalizeUniqueTextList(input?.tone),
    avoid: cleanText(input?.avoid),
    positioning: cleanText(input?.positioning),
    brandColors: cleanText(input?.brandColors),
    factualConstraints: cleanText(input?.factualConstraints),
    websiteOrInstagram: cleanText(input?.websiteOrInstagram),
  };
}

function normalizeContentGoalList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map((item) => String(item || '').trim()).filter((item) => CONTENT_GOAL_OPTIONS.has(item)))];
}

// Best-effort brand color identification for a logo image, so "Cores
// identificadas na logo" is a real result instead of a permanent placeholder.
// Prefers a vision-capable AI analyzer when one is injected — logos are
// often uploaded as mockup renders with a shadow/glow background, and a
// model can tell "this is the mockup backdrop, not a brand color" in a way
// plain pixel statistics can't. Falls back to local dominant-color
// extraction (extractDominantColors) when no analyzer is available or it
// fails, so this never blocks the upload.
async function identifyLogoColors(buffer, mimeType, logoColorAnalyzer) {
  if (typeof logoColorAnalyzer === 'function') {
    try {
      const aiColors = await logoColorAnalyzer({ buffer, mimeType });
      if (Array.isArray(aiColors) && aiColors.length) {
        return aiColors.filter((color) => /^#[0-9a-fA-F]{6}$/.test(String(color || '').trim())).slice(0, MAX_EXTRACTED_COLORS);
      }
    } catch {
      // fall through to local extraction
    }
  }
  return extractDominantColors(buffer);
}

// Best-effort dominant-color extraction from a logo image, so "Cores
// identificadas na logo" is a real result instead of a permanent placeholder.
// Downsamples to keep this fast, buckets similar shades together (nearby RGB
// values collapse into the same swatch), and skips near-white/near-black/
// near-transparent pixels since those are almost always background, not
// brand color. Never throws — a corrupt/unsupported image just yields no
// colors, and the caller keeps whatever was there before.
const COLOR_QUANTIZE_STEP = 24;
const COLOR_SAMPLE_SIZE = 48;
const MAX_EXTRACTED_COLORS = 5;

async function extractDominantColors(buffer, maxColors = MAX_EXTRACTED_COLORS) {
  try {
    const image = await Jimp.read(buffer);
    image.resize({ w: COLOR_SAMPLE_SIZE, h: COLOR_SAMPLE_SIZE });
    const counts = new Map();
    for (let y = 0; y < image.bitmap.height; y += 1) {
      for (let x = 0; x < image.bitmap.width; x += 1) {
        const { r, g, b, a } = intToRGBA(image.getPixelColor(x, y));
        if (a < 40) continue;
        if (r > 240 && g > 240 && b > 240) continue;
        const key = [quantizeColorChannel(r), quantizeColorChannel(g), quantizeColorChannel(b)].join(',');
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    // Rank by frequency weighted toward chroma (max-min channel spread), not
    // raw frequency alone — otherwise a large neutral black/white/gray
    // backdrop (very common in logo mockups/plaques) always wins over the
    // actual, smaller-area brand accent color a human would call "the" color.
    const scored = [...counts.entries()].map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const brightness = (r + g + b) / 3;
      const neutralPenalty = chroma < 20 ? 0.15 : 1;
      const extremePenalty = (brightness < 25 || brightness > 235) ? 0.4 : 1;
      return { key, score: count * neutralPenalty * extremePenalty };
    });
    return scored
      .sort((left, right) => right.score - left.score)
      .slice(0, maxColors)
      .map(({ key }) => rgbKeyToHex(key));
  } catch {
    return [];
  }
}

function quantizeColorChannel(value) {
  return Math.min(255, Math.round(value / COLOR_QUANTIZE_STEP) * COLOR_QUANTIZE_STEP);
}

function rgbKeyToHex(key) {
  return '#' + key.split(',').map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hasBrandInputFields(input = {}) {
  return ['brandName', 'segmentGroup', 'segmentCategory', 'segmentSpecialty', 'segment', 'productsOrServices', 'description', 'serviceRegion', 'mainDifferential', 'contentGoals']
    .some((key) => Object.prototype.hasOwnProperty.call(input || {}, key));
}

function brandInputToCompanyProfile(input = {}, existingProfile = {}) {
  const brandInput = normalizeBrandInput(input);
  const existing = normalizeCompanyProfile(existingProfile);
  return normalizeCompanyProfile({
    ...existing,
    segmentGroup: brandInput.segmentGroup,
    segmentCategory: brandInput.segmentCategory,
    segmentSpecialty: brandInput.segmentSpecialty,
    segment: brandInput.segment,
    description: brandInput.description,
    location: brandInput.serviceRegion,
    productsOrServices: brandInput.productsOrServices,
    differentiators: brandInput.mainDifferential,
    primaryObjective: brandInput.contentGoals.map(contentGoalLabel).join(', '),
    contentGoals: brandInput.contentGoals,
    audience: brandInput.audience,
    audienceType: brandInput.audienceType,
    tone: brandInput.tone,
    avoid: brandInput.avoid,
    positioning: brandInput.positioning,
    brandColors: brandInput.brandColors,
    factualConstraints: brandInput.factualConstraints,
    websiteOrInstagram: brandInput.websiteOrInstagram,
  });
}

function companyProfileToBrandInput(profileInput = {}, fallbackName = '') {
  const profile = normalizeCompanyProfile(profileInput);
  return normalizeBrandInput({
    brandName: fallbackName,
    segmentGroup: profile.segmentGroup,
    segmentCategory: profile.segmentCategory,
    segmentSpecialty: profile.segmentSpecialty,
    segment: profile.segment,
    productsOrServices: profile.productsOrServices,
    description: profile.description,
    serviceRegion: profile.location,
    audience: profile.audience,
    audienceType: profile.audienceType,
    tone: profile.tone,
    avoid: profile.avoid,
    positioning: profile.positioning,
    brandColors: profile.brandColors,
    factualConstraints: profile.factualConstraints,
    websiteOrInstagram: profile.websiteOrInstagram,
    mainDifferential: profile.differentiators,
    contentGoals: profile.contentGoals,
  });
}

function normalizeBrandIdentity(input = {}) {
  return {
    logoPath: cleanText(input?.logoPath),
    extractedColors: normalizeUniqueTextList(input?.extractedColors),
    editedColors: normalizeUniqueTextList(input?.editedColors),
    complementaryPalette: normalizeUniqueTextList(input?.complementaryPalette),
    visualTraits: normalizeUniqueTextList(input?.visualTraits),
    analyzedAt: input?.analyzedAt || null,
    updatedAt: input?.updatedAt || null,
  };
}

function normalizeBrandXray(input = {}) {
  const rawBlocks = input?.blocks || {};
  const blocks = {};
  for (const [id, label] of BRAND_XRAY_BLOCKS) {
    if (rawBlocks[id]) blocks[id] = normalizeBrandXrayBlock(id, { label, ...rawBlocks[id] });
  }
  return {
    status: ['empty', 'generated', 'approved', 'needs_review'].includes(input?.status) ? input.status : (Object.keys(blocks).length ? 'generated' : 'empty'),
    source: input?.source || '',
    blocks,
    generatedAt: input?.generatedAt || null,
    approvedAt: input?.approvedAt || null,
  };
}

function normalizeBrandXrayBlock(id, input = {}) {
  const fallbackLabel = BRAND_XRAY_BLOCKS.find(([blockId]) => blockId === id)?.[1] || id;
  return {
    id,
    label: input.label || fallbackLabel,
    text: cleanText(input.text),
    source: input.source || 'ai_suggestion',
    sources: Array.isArray(input.sources) ? input.sources : [],
    status: ['draft', 'generated', 'approved'].includes(input.status) ? input.status : 'generated',
    approvedAt: input.approvedAt || null,
  };
}

function buildSuggestedBrandXray(project, now = new Date()) {
  const input = normalizeBrandInput(project.brandInput || companyProfileToBrandInput(project.companyProfile, project.name));
  const identity = normalizeBrandIdentity(project.brandIdentity || { logoPath: project.brand?.logoPath });
  const name = input.brandName || project.name;
  const segment = input.segment || 'segmento ainda não informado';
  const products = input.productsOrServices || 'produtos ou serviços ainda não detalhados';
  const region = input.serviceRegion || 'região ainda não informada';
  const differential = input.mainDifferential || 'diferencial ainda não informado';
  const goals = input.contentGoals.map(contentGoalLabel);
  const goalText = goals.length ? goals.join(', ') : 'objetivos ainda não escolhidos';
  const colors = [...identity.editedColors, ...identity.extractedColors].filter(Boolean);
  const colorText = colors.length ? colors.join(', ') : 'cores ainda não identificadas/editadas';
  const audienceText = input.audience || 'público-alvo ainda não informado';
  const toneText = input.tone.length ? input.tone.join(', ') : null;
  const positioningText = input.positioning || null;
  const brandColorsText = input.brandColors || null;
  const websiteText = input.websiteOrInstagram || null;
  const factualConstraintsText = input.factualConstraints || null;
  const avoidText = input.avoid || null;
  const blocks = {
    summary: normalizeBrandXrayBlock('summary', {
      label: 'Resumo da marca',
      text: [
        `Informado pelo usuário: ${name} atua em ${segment}, oferece ${products} e atende ${region}. ${input.description || 'Descrição livre ainda não informada.'}`,
        websiteText ? `Site/Instagram informado: ${websiteText}.` : null,
        'Sugestão da IA: a marca provavelmente conversa com pessoas interessadas nesses produtos/serviços na região, sem tratar essa sugestão como fato confirmado.',
      ].filter(Boolean).join(' '),
      sources: ['user_input', 'ai_suggestion'],
    }),
    communication: normalizeBrandXrayBlock('communication', {
      label: 'Comunicação recomendada',
      text: [
        `Informado pelo usuário: principal diferencial — ${differential}. Público-alvo — ${audienceText}.`,
        positioningText ? `Posicionamento desejado pelo usuário: ${positioningText}.` : null,
        toneText ? `Tom de voz desejado pelo usuário: ${toneText}.` : null,
        `Sugestão da IA: posicionamento local claro, confiável e comercial; tom próximo, convidativo, simples de entender e adequado ao segmento ${segment}; personalidade acolhedora, marcante e confiável.`,
      ].filter(Boolean).join(' '),
      sources: ['user_input', 'ai_suggestion'],
    }),
    contentStrategy: normalizeBrandXrayBlock('contentStrategy', {
      label: 'Estratégia de conteúdo',
      text: [
        `Informado pelo usuário: objetivos do conteúdo — ${goalText}.`,
        factualConstraintsText ? `Fatos que podem ser citados (informados pelo usuário): ${factualConstraintsText}.` : null,
        `Sugestão da IA: priorizar temas de produtos/serviços (${products}), ofertas reais, bastidores, prova social, datas comemorativas e chamadas para ação compatíveis com os objetivos escolhidos, sem inventar preço, promoção ou promessa.`,
        avoidText ? `Restrição do usuário — NUNCA abordar: ${avoidText}.` : null,
      ].filter(Boolean).join(' '),
      sources: ['user_input', 'ai_suggestion'],
    }),
    visualIdentity: normalizeBrandXrayBlock('visualIdentity', {
      label: 'Identidade visual',
      text: [
        `Extraído da logo/identidade: ${colorText}.`,
        brandColorsText ? `Cores da marca descritas pelo usuário: ${brandColorsText}.` : null,
        `Sugestão da IA: direção visual coerente com ${segment}, com produto/serviço em destaque, alto contraste, boa leitura e poucos elementos. Evitar visual que contradiga a logo, alterar símbolo/textos/proporções, não inventar informações comerciais pela logo e não usar referências visuais como fatos.`,
      ].filter(Boolean).join(' '),
      sources: ['logo_identity', 'ai_suggestion'],
    }),
  };
  return normalizeBrandXray({
    status: 'generated',
    source: 'ai_suggestion',
    blocks,
    generatedAt: now.toISOString(),
    approvedAt: null,
  });
}

// Deterministic fallback so "sugerir pilares" always returns something
// usable even without an AI analyzer configured — same role as
// buildSuggestedBrandXray for the Raio-X flow. An injected pillarSuggester
// is expected to replace these with names/objectives tailored to the real
// business (see suggestProjectPillars below).
function buildSuggestedPillarsTemplate(project) {
  const input = normalizeBrandInput(project.brandInput || companyProfileToBrandInput(project.companyProfile, project.name));
  const name = input.brandName || project.name;
  const segment = input.segment || 'seu segmento';
  const products = input.productsOrServices || 'seus produtos/serviços';
  const now = new Date();
  return [
    {
      name: 'Ensina', role: 'ensina',
      objective: `Dica prática sobre ${products}, útil pra quem já pensa em ${segment}.`,
      visualTreatment: 'leve', color: '#2563EB', weight: 3,
    },
    {
      name: 'Prova', role: 'prova',
      objective: `Resultado real, bastidor ou depoimento que comprove a qualidade de ${name}.`,
      visualTreatment: 'cru', color: '#059669', weight: 2, requiresEvidence: true,
    },
    {
      name: 'Posiciona', role: 'posiciona',
      objective: `Opinião ou diferencial de ${name} dentro do segmento ${segment}.`,
      visualTreatment: 'leve', color: '#111111', weight: 2,
    },
    {
      name: 'Convida', role: 'convida',
      objective: `Chamada direta pra conhecer/comprar ${products}.`,
      visualTreatment: 'leve', color: '#E63946', weight: 1,
    },
  ].map((pillar) => normalizeProjectPillar(pillar, now, []));
}

// Preview-only (never writes to disk) — mirrors analyzeProjectBrandXray's
// template+AI-overlay shape, but returns a reviewable candidate list instead
// of saved state, since pillars (unlike Raio-X blocks) are a variable-length
// list the operator picks from rather than fixed keys to merge in place.
export async function suggestProjectPillars(projectId, options = {}, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  const project = await loadProject(paths);
  const template = buildSuggestedPillarsTemplate(project);
  if (typeof options.pillarSuggester !== 'function') {
    return { pillars: template, clarifyingQuestions: [], source: 'template' };
  }
  try {
    const ai = await options.pillarSuggester({ project, extraContext: options.extraContext || '' });
    if (!ai?.pillars?.length) return { pillars: template, clarifyingQuestions: [], source: 'template' };
    const pillars = ai.pillars
      .map((pillar) => {
        try {
          return normalizeProjectPillar(pillar, now, []);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!pillars.length) return { pillars: template, clarifyingQuestions: [], source: 'template' };
    const clarifyingQuestions = Array.isArray(ai.clarifyingQuestions)
      ? ai.clarifyingQuestions.map((q) => String(q || '').trim()).filter(Boolean)
      : [];
    return { pillars, clarifyingQuestions, source: 'ai_suggestion' };
  } catch {
    return { pillars: template, clarifyingQuestions: [], source: 'template' };
  }
}

function formatApprovedBrandXrayLines(input = {}) {
  const xray = normalizeBrandXray(input);
  if (xray.status !== 'approved') return [];
  return BRAND_XRAY_BLOCKS
    .map(([id, label]) => xray.blocks[id]?.text ? `${label}: ${xray.blocks[id].text}` : '')
    .filter(Boolean);
}

function buildConsolidatedXrayVisualDirection(project, xrayInput = {}) {
  const xray = normalizeBrandXray(xrayInput);
  if (xray.status !== 'approved') return cleanText(project.brand?.visualStyle || '');
  const visual = xray.blocks.visualIdentity?.text || '';
  const communication = xray.blocks.communication?.text || '';
  return [
    'Raio-X visual aprovado:',
    visual,
    communication ? `Comunicação: ${communication}` : '',
    'Preservar integralmente a logo original; não alterar textos, símbolos, cores essenciais ou proporções.',
  ].filter(Boolean).join(' ');
}

function normalizeBrandBriefing(input = {}) {
  const blocks = {};
  const rawBlocks = input?.blocks || {};
  for (const [id, label] of BRAND_BRIEFING_BLOCKS) {
    if (rawBlocks[id]) blocks[id] = normalizeBrandBriefingBlock(id, { label, ...rawBlocks[id] });
  }
  return {
    status: ['empty', 'generated', 'approved', 'needs_review'].includes(input?.status) ? input.status : (Object.keys(blocks).length ? 'generated' : 'empty'),
    source: input?.source || '',
    blocks,
    generatedAt: input?.generatedAt || null,
    approvedAt: input?.approvedAt || null,
  };
}

function normalizeBrandBriefingBlock(id, input = {}) {
  const fallbackLabel = BRAND_BRIEFING_BLOCKS.find(([blockId]) => blockId === id)?.[1] || id;
  return {
    id,
    label: input.label || fallbackLabel,
    text: cleanText(input.text),
    source: input.source || 'ai_suggestion',
    status: ['draft', 'generated', 'approved'].includes(input.status) ? input.status : 'generated',
    approvedAt: input.approvedAt || null,
  };
}

function buildSuggestedBrandBriefing(project, now = new Date()) {
  const profile = normalizeCompanyProfile(project.companyProfile);
  const segment = profile.segment || 'segmento ainda não informado';
  const products = profile.productsOrServices || 'produtos/serviços ainda não detalhados';
  const audience = profile.audience || 'público local a definir';
  const differentiators = profile.differentiators || 'diferenciais ainda pouco detalhados';
  const objective = profile.primaryObjective || 'gerar comunicação comercial clara sem inventar informações';
  const avoid = [profile.factualConstraints, profile.avoid].filter(Boolean).join('; ') || 'não inventar preços, promessas, horários, garantias ou informações não fornecidas';
  const visualBase = profile.brandColors
    ? `usar ${profile.brandColors}, com visual limpo, legível e coerente com ${segment}`
    : `visual profissional coerente com ${segment}, com contraste forte, boa leitura e poucos elementos`;
  const suggestions = {
    summary: `${project.name} atua em ${segment}. ${profile.description || `A empresa oferece ${products}.`} Objetivo informado: ${objective}.`,
    positioning: `Posicionamento sugerido: marca local de ${segment}, confiável e comercial, destacando ${differentiators}.`,
    audience: `Público-alvo sugerido: ${audience}.`,
    tone: 'Tom de voz sugerido: claro, próximo, comercial, seguro e fácil de entender.',
    personality: `Personalidade da marca: profissional, acessível, memorável e alinhada ao segmento ${segment}.`,
    contentPillars: [
      `Produtos/serviços: ${products}`,
      'Autoridade e orientação',
      'Prova social e bastidores',
      'Ofertas/assuntos reais cadastrados',
      'Datas especiais e chamadas locais',
    ].join('\n'),
    visualDirection: `Direção visual sugerida: ${visualBase}. Priorizar produto/serviço principal em destaque, hierarquia clara, texto curto e área segura.`,
    differentiators: `Diferenciais percebidos: ${differentiators}.`,
    avoid: `Evitar: ${avoid}.`,
    missingInfo: missingCompanyInfo(profile).join('\n') || 'Nenhuma informação crítica faltando para começar; revisar detalhes específicos de cada campanha antes de gerar.',
  };
  const blocks = {};
  for (const [id, label] of BRAND_BRIEFING_BLOCKS) {
    blocks[id] = normalizeBrandBriefingBlock(id, {
      label,
      text: suggestions[id],
      source: 'ai_suggestion',
      status: 'generated',
    });
  }
  return normalizeBrandBriefing({
    status: 'generated',
    source: 'ai_suggestion',
    blocks,
    generatedAt: now.toISOString(),
    approvedAt: null,
  });
}

function missingCompanyInfo(profile) {
  const missing = [];
  if (!profile.audience) missing.push('Público conhecido ainda não foi informado com detalhes.');
  if (!profile.brandColors) missing.push('Cores/identidade visual ainda não foram informadas.');
  if (!profile.factualConstraints && !profile.avoid) missing.push('Restrições do que não pode ser inventado ainda não foram detalhadas.');
  if (!profile.websiteOrInstagram) missing.push('Site ou Instagram ainda não foi informado no Raio-X.');
  return missing;
}

function formatApprovedBrandBriefingLines(input = {}) {
  const briefing = normalizeBrandBriefing(input);
  if (briefing.status !== 'approved') return [];
  return BRAND_BRIEFING_BLOCKS
    .map(([id, label]) => briefing.blocks[id]?.text ? `${label}: ${briefing.blocks[id].text}` : '')
    .filter(Boolean);
}

function buildConsolidatedVisualDirection(project, briefingInput = {}) {
  const briefing = normalizeBrandBriefing(briefingInput);
  if (briefing.status !== 'approved') return cleanText(project.brand?.visualStyle || '');
  const profile = normalizeCompanyProfile(project.companyProfile);
  const parts = [
    'Direção visual consolidada:',
    briefing.blocks.visualDirection?.text,
    profile.brandColors ? `Cores/identidade informadas: ${profile.brandColors}.` : '',
    briefing.blocks.tone?.text ? `Comunicação: ${briefing.blocks.tone.text}` : '',
    briefing.blocks.avoid?.text,
    'Utilizar o logo/ativos oficiais sem modificações e preservar produtos/fotos reais quando enviados.',
  ].filter(Boolean);
  return parts.join(' ');
}

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeUniqueTextList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))];
}

function companyContentGoalLabel(value) {
  return {
    product: 'Produto',
    service: 'Serviço',
    offer: 'Oferta',
    authority: 'Autoridade',
    education: 'Educativo',
    desire: 'Desejo',
    social_proof: 'Prova social',
    institutional: 'Institucional',
    urgency: 'Urgência',
    backstage: 'Bastidores',
    engagement: 'Engajamento',
  }[value] || value;
}

function contentGoalLabel(value) {
  return CONTENT_GOAL_LABELS[value] || companyContentGoalLabel(value);
}

function normalizePhotoReferenceIds(value) {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const ids = [];
  for (const entry of raw) {
    const id = String(entry || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function normalizeProjectOffer(input, now = new Date(), existingOffers = []) {
  const name = String(input?.name || '').trim();
  if (!name) throw new Error('Nome da oferta é obrigatório');
  const id = String(input?.id || uniqueOfferId(name, existingOffers)).trim();
  const requestedType = String(input?.type || 'offer').trim();
  const type = OFFER_TYPES.has(requestedType) ? requestedType : 'offer';
  const createdAt = input?.createdAt || now.toISOString();
  return {
    id,
    name,
    type,
    price: String(input?.price || '').trim(),
    items: String(input?.items || '').trim(),
    cta: String(input?.cta || '').trim(),
    autoGenerateCta: input?.autoGenerateCta === true,
    notes: String(input?.notes || '').trim(),
    active: input?.active === false ? false : true,
    pillarId: String(input?.pillarId || '').trim() || null,
    // Groups let the operator organize offers/products (e.g. "Geral",
    // "Black Friday") and later choose which group(s) drive a specific
    // schedule generation, without touching each offer's `active` flag —
    // see generateContentSchedulePlan/generateContentBatch's groupIds option.
    groupId: String(input?.groupId || '').trim() || null,
    // Empty = valid every day (unchanged default behavior). Non-empty scopes
    // this offer to only compete for a slot on those weekdays — e.g. a
    // pizzeria's weekday rodízio price vs its separate weekend price, each
    // as its own offer. See buildTopicPool's weekday filter.
    daysOfWeek: normalizeDaysOfWeek(input?.daysOfWeek),
    // Catalog-mode projects (venda direta) tie an offer/product to one or
    // more uploaded reference photos, unlike marketing-mode offers which
    // just draw from the general reference pool. Each id points at a
    // reference's `id`. Accepts either the array or (legacy/simple callers)
    // a single photoReferenceId, so both shapes normalize to the same field.
    photoReferenceIds: normalizePhotoReferenceIds(input?.photoReferenceIds ?? input?.photoReferenceId),
    createdAt,
    updatedAt: now.toISOString(),
  };
}

function normalizeProjectPillar(input, now = new Date(), existingPillars = []) {
  const name = String(input?.name || '').trim();
  if (!name) throw new Error('Nome do pilar é obrigatório');
  const id = String(input?.id || uniquePillarId(name, existingPillars)).trim();
  const requestedRole = String(input?.role || 'ensina').trim();
  const role = PILLAR_ROLES.has(requestedRole) ? requestedRole : 'ensina';
  const requestedTreatment = String(input?.visualTreatment || 'leve').trim();
  const visualTreatment = PILLAR_VISUAL_TREATMENTS.has(requestedTreatment) ? requestedTreatment : 'leve';
  const weight = Math.max(1, Math.round(Number(input?.weight)) || 1);
  const createdAt = input?.createdAt || now.toISOString();
  return {
    id,
    name,
    role,
    objective: String(input?.objective || '').trim(),
    visualTreatment,
    color: /^#[0-9a-fA-F]{6}$/.test(String(input?.color || '').trim()) ? input.color.trim() : DEFAULT_PILLAR_COLOR,
    weight,
    requiresEvidence: input?.requiresEvidence === undefined ? role === 'prova' : input.requiresEvidence === true,
    active: input?.active === false ? false : true,
    createdAt,
    updatedAt: now.toISOString(),
  };
}

function normalizeProjectPillars(pillars) {
  if (!Array.isArray(pillars)) return [];
  return pillars
    .map((pillar) => {
      try {
        return normalizeProjectPillar(pillar, new Date(pillar.updatedAt || pillar.createdAt || Date.now()), []);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function uniquePillarId(name, existingPillars = []) {
  const base = normalizeProjectId(name);
  const ids = new Set(existingPillars.map((pillar) => pillar.id));
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function pillarRoleLabel(role) {
  return {
    ensina: 'Ensina',
    prova: 'Prova',
    posiciona: 'Posiciona',
    convida: 'Convida',
  }[role] || role;
}

// Resolves which pillar (if any) a content topic belongs to: explicit
// pillarId on the offer wins, otherwise fall back to the global type/goal
// role table, otherwise no pillar (fully backward compatible).
function resolveTopicPillar(topic, pillars) {
  if (!Array.isArray(pillars) || !pillars.length) return null;
  const activePillars = pillars.filter((pillar) => pillar.active !== false);
  if (!activePillars.length) return null;
  if (topic?.pillarId) {
    const explicit = activePillars.find((pillar) => pillar.id === topic.pillarId);
    if (explicit) return explicit;
  }
  const role = topic?.source === 'goal'
    ? GOAL_TYPE_TO_PILLAR_ROLE[topic?.type]
    : OFFER_TYPE_TO_PILLAR_ROLE[topic?.type];
  if (!role) return null;
  return activePillars.find((pillar) => pillar.role === role) || null;
}

function uniqueOfferId(name, existingOffers = []) {
  const base = normalizeProjectId(name);
  const ids = new Set(existingOffers.map((offer) => offer.id));
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function normalizeProjectOfferGroup(input, now = new Date(), existingGroups = []) {
  const name = String(input?.name || '').trim();
  if (!name) throw new Error('Nome do grupo é obrigatório');
  const id = String(input?.id || uniqueOfferGroupId(name, existingGroups)).trim();
  const createdAt = input?.createdAt || now.toISOString();
  return {
    id,
    name,
    createdAt,
    updatedAt: now.toISOString(),
  };
}

function normalizeProjectOfferGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((group) => {
      try {
        return normalizeProjectOfferGroup(group, new Date(group.updatedAt || group.createdAt || Date.now()), []);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function uniqueOfferGroupId(name, existingGroups = []) {
  const base = normalizeProjectId(name);
  const ids = new Set(existingGroups.map((group) => group.id));
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function offerTypeLabel(type) {
  return {
    offer: 'Oferta direta',
    combo: 'Combo / promoção',
    rodizio: 'Rodízio',
    delivery: 'Delivery',
    product: 'Produto destaque',
    orientation: 'Post de orientação',
    desire: 'Post de desejo',
    urgency: 'Urgência / hoje tem',
    institutional: 'Institucional',
    social_proof: 'Prova social',
  }[type] || 'Oferta direta';
}

function section(title, lines) {
  return [title, ...lines.map((line) => String(line || '').trim()).filter(Boolean).map((line) => `- ${line}`)].join('\n');
}

function splitPromptRules(contentRules) {
  const variationPrefixes = [
    'Variação criativa de teste:',
    'Conceito do teste:',
    'Composição obrigatória desta tentativa:',
    'Ângulo da copy/imagem:',
    'Formato de teste:',
    'Não repetir exatamente o criativo anterior:',
    'Como o usuário não escreveu observação,',
    'Usar a observação do usuário como direção principal,',
  ];
  const currentRules = [];
  const variationRules = [];
  for (const rule of normalizeRuleList(contentRules)) {
    if (variationPrefixes.some((prefix) => rule.startsWith(prefix))) variationRules.push(rule);
    else currentRules.push(rule);
  }
  return { currentRules, variationRules };
}

function sortReferencesForPrompt(references) {
  const weightPriority = { high: 0, medium: 1, low: 2 };
  return [...references].sort((a, b) => (
    (weightPriority[a.weight] ?? 9) - (weightPriority[b.weight] ?? 9)
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || a.relativePath.localeCompare(b.relativePath)
  ));
}

function formatReferenceLine(reference) {
  const usageRoles = normalizeReferenceUsageRoles(reference.usageRoles, reference.role);
  return [
    `${reference.relativePath}`,
    `categoria: ${referenceCategoryLabel(reference.referenceCategory)}`,
    usageRoles.length > 1 ? `funções: ${usageRoles.map(referenceRoleLabel).join(', ')}` : `função: ${referenceRoleLabel(reference.role)}`,
    reference.weight ? `peso: ${reference.weight}` : '',
    reference.automaticRule ? `regra automática: ${reference.automaticRule}` : '',
    reference.instruction ? `instrução: ${reference.instruction}` : '',
  ].filter(Boolean).join(' — ');
}

function referenceCategoryLabel(category) {
  return {
    official_asset: 'Ativos oficiais',
    real_product: 'Fotos reais dos produtos',
    visual_inspiration: 'Referências visuais',
  }[category] || 'Referências visuais';
}

function referenceRoleLabel(role) {
  return {
    brand_asset: 'Logo/marca',
    product_photo: 'Foto/produto',
    layout_model: 'Modelo de layout',
    text_parameter: 'Parâmetro textual',
    visual_reference: 'Referência visual',
  }[role] || 'Referência visual';
}

function normalizeReferenceUsageRoles(value, fallbackRole = 'visual_reference') {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const roles = raw
    .map((role) => String(role).trim())
    .map((role) => (role === 'official_asset' ? 'brand_asset' : role))
    .filter((role) => REFERENCE_ROLES.includes(role));
  const fallback = REFERENCE_ROLES.includes(fallbackRole) ? fallbackRole : 'visual_reference';
  return [...new Set(roles.length ? roles : [fallback])];
}

function normalizeProjectReferences(project) {
  const existing = Array.isArray(project.brand?.references) ? project.brand.references : [];
  const migrated = Array.isArray(project.brand?.referenceFiles)
    ? project.brand.referenceFiles.map((relativePath) => normalizeReferenceMetadata({
        projectId: project.projectId,
        filename: String(relativePath).split('/').pop(),
        relativePath,
        role: 'visual_reference',
        weight: 'medium',
      }))
    : [];
  const byPath = new Map();
  for (const reference of [...migrated, ...existing]) {
    const normalized = normalizeReferenceMetadata({ projectId: project.projectId, ...reference });
    byPath.set(normalized.relativePath, normalized);
  }
  return [...byPath.values()];
}

function normalizeProjectOfferAssets(project) {
  const existing = Array.isArray(project.offerAssets) ? project.offerAssets : [];
  const byPath = new Map();
  for (const reference of existing) {
    const normalized = normalizeReferenceMetadata({ projectId: project.projectId, ...reference });
    byPath.set(normalized.relativePath, normalized);
  }
  return [...byPath.values()];
}

function upsertReferenceMetadata(references, next) {
  const byPath = new Map(references.map((reference) => [reference.relativePath, reference]));
  byPath.set(next.relativePath, next);
  return [...byPath.values()];
}

function normalizeReferenceMetadata(input) {
  const relativePath = String(input.relativePath || '').replace(/\\/g, '/');
  const filename = sanitizeFilename(input.filename || relativePath.split('/').pop() || 'reference.bin');
  const referenceCategory = normalizeReferenceCategory(input.referenceCategory, input.role);
  const requestedRole = roleForReferenceCategory(referenceCategory, input.role);
  const role = REFERENCE_ROLES.includes(requestedRole)
    ? requestedRole
    : 'visual_reference';
  const usageRoles = normalizeReferenceUsageRoles(input.usageRoles, role);
  const weight = ['low', 'medium', 'high'].includes(input.weight) ? input.weight : 'medium';
  return {
    id: String(input.id || relativePath || filename).replace(/[^a-zA-Z0-9_-]+/g, '-'),
    filename,
    relativePath,
    previewUrl: input.projectId && relativePath ? `/api/projects/${input.projectId}/assets/${relativePath}` : input.previewUrl || '',
    mimeType: input.mimeType || mimeTypeFromFilename(filename),
    bytes: Number(input.bytes || 0),
    width: Number(input.width || 0),
    height: Number(input.height || 0),
    aspectRatio: String(input.aspectRatio || '').trim(),
    role,
    usageRoles,
    referenceCategory,
    automaticRule: automaticReferenceRule(referenceCategory),
    useInNextGeneration: input.useInNextGeneration === false || input.active === false ? false : true,
    weight,
    instruction: String(input.instruction || '').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function normalizeReferenceCategory(value, role = '') {
  const requested = String(value || '').trim();
  if (REFERENCE_CATEGORIES.has(requested)) return requested;
  if (role === 'brand_asset' || role === 'official_asset') return 'official_asset';
  if (role === 'product_photo' || role === 'real_product') return 'real_product';
  return 'visual_inspiration';
}

function roleForReferenceCategory(category, fallbackRole = '') {
  if (category === 'official_asset') return 'brand_asset';
  if (category === 'real_product') return 'product_photo';
  const normalizedFallback = fallbackRole === 'official_asset' ? 'brand_asset' : fallbackRole;
  return REFERENCE_ROLES.includes(normalizedFallback) ? normalizedFallback : 'visual_reference';
}

function automaticReferenceRule(category) {
  return {
    official_asset: 'Preservar exatamente o ativo enviado. Não redesenhar, reinterpretar, alterar textos, cores ou proporções importantes.',
    real_product: 'Preservar a aparência real. É permitido recortar, ajustar iluminação e integrar à composição, mas não substituir por outro produto.',
    visual_inspiration: 'Utilizar apenas como inspiração visual. Não copiar logos, nomes, textos, preços, produtos ou elementos exclusivos da referência.',
  }[category] || 'Utilizar apenas como inspiração visual. Não copiar informações factuais da referência.';
}

function buildImageReferencePayload(project, paths) {
  const logoReference = getProjectLogoReference(project, paths);
  const references = uniqueReferences([
    logoReference,
    ...sortReferencesForPrompt([
      ...normalizeProjectReferences(project),
      ...normalizeProjectOfferAssets(project),
    ]),
  ].filter(Boolean));
  return references
    .filter((reference) => reference.useInNextGeneration !== false)
    .filter((reference) => String(reference.mimeType || '').startsWith('image/'))
    .map((reference) => ({
    ...reference,
    absolutePath: join(paths.projectDir, reference.relativePath),
  }));
}

function getProjectLogoReference(project, paths) {
  const logoPath = String(project.brand?.logoPath || '').replace(/\\/g, '/');
  if (!logoPath) return null;
  const absolutePath = join(paths.projectDir, logoPath);
  if (!existsSync(absolutePath)) return null;
  return normalizeReferenceMetadata({
    projectId: project.projectId,
    filename: logoPath.split('/').pop() || 'logo.png',
    relativePath: logoPath,
    mimeType: mimeTypeFromFilename(logoPath),
    role: 'brand_asset',
    weight: 'high',
    instruction: 'Logo/marca cadastrada do projeto. Deve aparecer no criativo onde ficar melhor visualmente.',
    createdAt: project.updatedAt || new Date(0).toISOString(),
  });
}

function uniqueReferences(references) {
  const byPath = new Map();
  for (const reference of references) {
    if (!reference?.relativePath) continue;
    byPath.set(reference.relativePath, reference);
  }
  return [...byPath.values()];
}

function buildCaptionDraft(project, dayNumber, contentTopic = null) {
  if (contentTopic) {
    return [
      `Dia ${dayNumber}: ${contentTopic.label || offerTypeLabel(contentTopic.type)} para ${project.name}.`,
      `Assunto: ${contentTopic.offerName || contentTopic.objective || contentTopic.label}.`,
      contentTopic.price ? `Preço: ${contentTopic.price}.` : 'Preço: não informar preço se não estiver cadastrado.',
      contentTopic.items ? `Itens/detalhes: ${contentTopic.items}.` : '',
      `Gancho: [criar chamada curta alinhada ao assunto]`,
      `Corpo: [explicar a oferta/assunto sem inventar informações]`,
      `CTA: ${contentTopic.cta || (contentTopic.autoGenerateCta ? '[IA deve sugerir uma chamada curta, natural e contextual para este post]' : '[chamada simples, sem promessa falsa]')}`,
      contentTopic.notes ? `Observação: ${contentTopic.notes}` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    `Dia ${dayNumber}: rascunho de legenda para ${project.name}.`,
    'Gancho: [preencher com promessa segura e específica]',
    'Corpo: [explicar a ideia do post seguindo as regras do projeto]',
    'CTA: [chamada simples, sem promessa falsa]',
  ].join('\n');
}

function normalizeScheduleFormats(formats) {
  const normalized = formats
    .filter((format) => format?.enabled !== false)
    .map((format) => {
      const channel = format.channel || DEFAULT_CHANNEL;
      const postsPerDay = Number(format.postsPerDay || 1);
      const everyDays = Number(format.everyDays || 1);
      const intervalMinutes = Number(format.intervalMinutes || 0);
      if (!Number.isInteger(postsPerDay) || postsPerDay < 1 || postsPerDay > 12) {
        throw new Error('Vezes por dia deve ser entre 1 e 12');
      }
      if (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 30) {
        throw new Error('Intervalo de dias deve ser entre 1 e 30');
      }
      if (!Number.isInteger(intervalMinutes) || intervalMinutes < 0 || intervalMinutes > 1440) {
        throw new Error('Intervalo em minutos deve ser entre 0 e 1440');
      }
      return {
        channel,
        label: CHANNEL_LABELS[channel] || channel,
        postsPerDay,
        everyDays,
        startTime: normalizeTime(format.startTime || DEFAULT_TIME),
        intervalMinutes,
      };
    });
  return normalized.length ? normalized : [{
    channel: DEFAULT_CHANNEL,
    label: CHANNEL_LABELS[DEFAULT_CHANNEL],
    postsPerDay: 1,
    everyDays: 1,
    startTime: DEFAULT_TIME,
    intervalMinutes: 0,
  }];
}

function normalizeRuleList(value) {
  if (Array.isArray(value)) return value.map((rule) => String(rule).trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split('\n').map((rule) => rule.trim()).filter(Boolean);
}

function normalizeTime(value) {
  const match = String(value || DEFAULT_TIME).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Horário inválido: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Horário inválido: ${value}`);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function addMinutesToTime(time, minutesToAdd) {
  const [hours, minutes] = normalizeTime(time).split(':').map(Number);
  const total = (hours * 60 + minutes + minutesToAdd) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Organic content always has a dayNumber/scheduledDate/scheduledTime; an ad
// creative has none of those (no scheduling concept applies to it) — show
// its objective there instead of "Dia undefined".
function placeholderSubtitle(content) {
  if (content.dayNumber === undefined) return content.objectiveLabel || 'Criativo de anúncio';
  return `Dia ${content.dayNumber} · ${content.scheduledDate} · ${content.scheduledTime}`;
}

async function writeGeneratedImage(path, content, project) {
  const fallbackHook = extractPromptLine(content.image?.prompt, 'Conceito do teste:') || 'Rascunho visual gerado';
  const colorPair = pickFallbackColors(content.image?.prompt || content.contentId || '');
  const { width, height } = imageDimensionsForChannel(content.channel);
  const margin = Math.round(width * 0.067);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${colorPair[0]}"/><stop offset="1" stop-color="${colorPair[1]}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${height - margin * 2}" rx="48" fill="#09090bd6" stroke="#facc15" stroke-width="8"/>
  <text x="${margin + 38}" y="${margin + 108}" fill="#facc15" font-size="54" font-family="Arial, sans-serif" font-weight="700">${escapeXml(content.formatLabel || CHANNEL_LABELS[content.channel] || content.channel)}</text>
  <text x="${margin + 38}" y="${margin + 210}" fill="#ffffff" font-size="66" font-family="Arial, sans-serif" font-weight="800">${escapeXml(project.name)}</text>
  <text x="${margin + 38}" y="${margin + 302}" fill="#d4d4d8" font-size="38" font-family="Arial, sans-serif">${escapeXml(placeholderSubtitle(content))}</text>
  <text x="${margin + 38}" y="${margin + 410}" fill="#ffffff" font-size="44" font-family="Arial, sans-serif">${escapeXml(truncateSvgText(fallbackHook, 34))}</text>
  <text x="${margin + 38}" y="${margin + 486}" fill="#d4d4d8" font-size="34" font-family="Arial, sans-serif">Use como prévia/teste antes de publicar.</text>
  <text x="${margin + 38}" y="${height - margin - 52}" fill="#a1a1aa" font-size="30" font-family="Arial, sans-serif">${escapeXml(project.instagram.handle || '')}</text>
</svg>`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, svg, 'utf-8');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageDimensionsForChannel(channel) {
  if (isVerticalStoryChannel(channel)) return { width: 1080, height: 1920 };
  return { width: 1080, height: 1350 };
}

function imageAspectRatioForChannel() {
  return 'portrait';
}

function imageFormatInstructionForChannel(channel) {
  if (channel === 'instagram_story') {
    return 'Formato obrigatório: Instagram Stories 9:16 vertical real, 1080x1920. No ChatGPT/OpenAI, criar composição vertical nativa; não gerar 1:1/quadrado, 3:2 ou 16:9. Não centralizar flyer 1:1 em canvas vertical.';
  }
  if (channel === 'instagram_reels') {
    return 'Formato obrigatório: capa de Reels 9:16 vertical real, 1080x1920. No ChatGPT/OpenAI, criar composição vertical nativa; não gerar 1:1/quadrado, 3:2 ou 16:9. Não centralizar flyer 1:1 em canvas vertical.';
  }
  if (channel === 'facebook_story') {
    return 'Formato obrigatório: Facebook Story 9:16 vertical real, 1080x1920. No ChatGPT/OpenAI, criar composição vertical nativa; não gerar 1:1/quadrado, 3:2 ou 16:9. Não centralizar flyer 1:1 em canvas vertical.';
  }
  if (channel === 'facebook_feed') {
    return 'Formato obrigatório: Facebook Feed vertical 4:5, 1080x1350, usar aspect_ratio portrait na geração de imagem; não gerar Story se o canal for Feed.';
  }
  return 'Formato obrigatório: Instagram Feed vertical 4:5, 1080x1350, usar aspect_ratio portrait na geração de imagem; não gerar Story se o canal for Feed.';
}

function extractPromptLine(prompt, label) {
  // Every rule line in the assembled prompt is bulleted by section() as
  // `- <text>` — match/strip that leading bullet, or this silently never
  // matches anything and the caller's variation text always falls back to
  // a generic default.
  const line = String(prompt || '').split('\n').find((entry) => entry.trim().replace(/^-\s*/, '').startsWith(label));
  if (!line) return '';
  return line.trim().replace(/^-\s*/, '').replace(label, '').replace(/^\s*/, '').replace(/[.。]+$/, '');
}

function truncateSvgText(value, maxLength) {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function pickFallbackColors(seed) {
  const pairs = [
    ['#111827', '#facc15'],
    ['#1f1208', '#dc2626'],
    ['#0f172a', '#f97316'],
    ['#18181b', '#a16207'],
    ['#111111', '#991b1b'],
    ['#0c0a09', '#eab308'],
  ];
  return pairs[hashString(seed) % pairs.length];
}

function hashString(value) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

function normalizeHandle(handle) {
  if (!handle) return '';
  const trimmed = String(handle).trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function sanitizeFilename(filename) {
  const ext = extname(String(filename)).toLowerCase();
  const base = String(filename)
    .replace(/\.[^.]*$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'arquivo';
  return `${base}${ext || '.bin'}`;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/);
  if (!match) throw new Error('Arquivo inválido para upload');
  return Buffer.from(match[1], 'base64');
}

function parseDataUrlMimeType(dataUrl) {
  return String(dataUrl || '').match(/^data:([^;]+);base64,/)?.[1] || 'application/octet-stream';
}

function safeProjectPath(projectDir, relativePath) {
  const cleanRelative = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRelative || cleanRelative.includes('..')) throw new Error('Caminho inválido');
  const root = resolve(projectDir);
  const target = resolve(root, cleanRelative);
  if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
    throw new Error('Caminho fora do projeto');
  }
  return target;
}

function mimeTypeFromFilename(filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.txt' || ext === '.md') return 'text/plain';
  return 'application/octet-stream';
}

function maskSecret(value) {
  const secret = String(value);
  return `****${secret.slice(-4)}`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(date);
}

const WEEKDAY_CODES = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
// getUTCDay() order (0=Sunday..6=Saturday) — index maps directly.
const WEEKDAY_BY_INDEX = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function weekdayFromDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return WEEKDAY_BY_INDEX[date.getUTCDay()];
}

function normalizeDaysOfWeek(value) {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set(raw.map((item) => String(item || '').trim().toLowerCase()).filter((item) => WEEKDAY_CODES.has(item)))];
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT' && arguments.length > 1) return fallback;
    throw err;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  // Write to a temp file in the same directory, then rename over the real
  // path — rename is atomic on the same filesystem, so a crash mid-write
  // (this session's dev server has died mid-request more than once) can
  // never leave the real file truncated/corrupted; readers either see the
  // old complete file or the new complete file, never a partial one.
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  // On Windows, rename-over-an-existing-file transiently fails with EPERM
  // if anything else (antivirus, a search indexer, another process's brief
  // read handle) has the destination open at that exact instant — a real,
  // reproducible failure under this project's own concurrent per-item
  // writes, not a hypothetical. It clears within milliseconds, so retry a
  // few times with a short backoff instead of letting a transient OS-level
  // lock surface as a generation failure.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(tempPath, path);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY'].includes(err.code)) {
        await rm(tempPath, { force: true }).catch(() => {});
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

// Serializes every "load project.json, mutate in memory, write it back"
// cycle against the same project — Node's event loop can still interleave
// two concurrent requests at any `await` inside such a cycle (a Raio-X
// analysis or web-research call can sit for several seconds between the
// read and the write), and without this, whichever write lands last
// silently wins with no error, quietly dropping the other request's
// change. Keyed by targetDir+projectId since tests run many isolated
// temp-dir projects with the same id.
//
// This in-memory queue only protects two requests inside THIS process — it
// does nothing for two separate server processes pointed at the same
// targetDir (which really happens: a temp preview server on an alternate
// port next to the operator's own running instance). The file lock below
// adds that cross-process guarantee; the in-memory queue stays because it's
// what keeps a single busy process from making concurrent processes acquire
// attempts for work it already knows is serialized, and it's what queues up
// fairly instead of every waiter racing the filesystem at once.
const projectLocks = new Map();

// A lock file older than this is treated as abandoned by a crashed process,
// not a slow-but-alive operation — the Raio-X/web-research AI calls above
// can legitimately hold the lock for tens of seconds, so this has to be
// generous enough that a real one never gets its lock stolen out from
// under it mid-write.
const LOCK_STALE_MS = 120_000;
const LOCK_POLL_MS = 50;

async function acquireProjectFileLock(paths) {
  await mkdir(paths.projectDir, { recursive: true }).catch(() => {});
  const lockPath = join(paths.projectDir, '.lock');
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n${new Date().toISOString()}`, { flag: 'wx' });
      return lockPath;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const info = await stat(lockPath).catch(() => null);
      if (!info || Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        // Either it was just released (stat raced the other side's rm — try
        // again immediately) or it's stale enough to reclaim outright.
        await rm(lockPath, { force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
}

function withProjectLock(targetDir, projectId, fn) {
  const key = `${targetDir}::${projectId}`;
  const previous = projectLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    const paths = getCentralPaths(targetDir, projectId);
    const lockPath = await acquireProjectFileLock(paths);
    try {
      return await fn();
    } finally {
      await rm(lockPath, { force: true });
    }
  });
  projectLocks.set(key, run.catch(() => {}));
  return run;
}
