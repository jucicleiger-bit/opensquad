import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

const OFFER_TYPES = new Set([
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

// One entry per non-priced content objective (the "Objetivos do conteúdo"
// checkboxes in the Raio-X form, saved to project.brandInput.contentGoals).
// Deliberately excludes priced-intent goals (sell_products, sell_services,
// promotions, whatsapp_orders, leads) — those stay satisfied by real
// registered offers so the AI never invents a sales CTA without a real
// offer behind it. buildObjective grounds each topic in already-approved
// Raio-X text instead of generic boilerplate.
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
  const paths = {
    root,
    projectsDir,
    secretsDir,
    approvalsDir,
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
  const mode = options?.mode || 'semi_automatic';
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

  project.brand = {
    ...project.brand,
    logoPath: kind === 'logo' ? relativePath : project.brand.logoPath,
    referencesDir: 'assets/references',
    references: kind === 'reference'
      ? upsertReferenceMetadata(currentReferences, referenceMetadata)
      : currentReferences,
    referenceFiles: kind === 'reference'
      ? [...new Set([...(project.brand.referenceFiles || []), relativePath])]
      : project.brand.referenceFiles || [],
  };
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
  const topicCount = contentTopicCount(project);
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
    const contentTopic = buildContentTopic(project, topicOffset + index, { channel });
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
  const topicCount = contentTopicCount(project);
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
  function nextContentTopic(channel, creativeGroupKey) {
    if (creativeGroupKey && topicByCreativeGroupKey.has(creativeGroupKey)) {
      return topicByCreativeGroupKey.get(creativeGroupKey);
    }
    let topic;
    if (pillarSequence.length) {
      const pillar = pillarSequence[pillarCursor % pillarSequence.length];
      pillarCursor += 1;
      const pool = buildTopicPool(project);
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
      topic = buildContentTopic(project, topicCursor, { channel });
      topicCursor += 1;
    }
    if (creativeGroupKey) topicByCreativeGroupKey.set(creativeGroupKey, topic);
    return topic;
  }

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const dayNumber = dayIndex + 1;
    const scheduledDate = addDays(startDate, dayIndex);
    for (const format of formats) {
      if (dayIndex % format.everyDays !== 0) continue;
      for (let slotIndex = 0; slotIndex < format.postsPerDay; slotIndex += 1) {
        const slotNumber = slotIndex + 1;
        const scheduledTime = addMinutesToTime(format.startTime, slotIndex * format.intervalMinutes);
        const dimensions = imageDimensionsForChannel(format.channel);
        const aspectRatio = imageAspectRatioForChannel(format.channel);
        const shapeGroup = creativeShapeGroupForChannel(format.channel);
        const creativeGroupKey = shapeGroup ? `${scheduledDate}::${shapeGroup}::slot${slotIndex}` : null;
        const contentTopic = { ...nextContentTopic(format.channel, creativeGroupKey), channel: format.channel };
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
      const contentTopic = { ...offerToContentTopic(product), channel };
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
  const topicCount = contentTopicCount(project);
  const topicOffset = project.contentStrategy?.nextTestTopicIndex === undefined
    ? await inferNextTestTopicIndex(paths, project, topicCount)
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
async function applyContentRegeneration(content, project, projectId, options) {
  const regenerate = options.regenerate || 'all';
  if (options.note) content.dayRules.push(options.note);
  let creativeRegenerated = false;
  if (regenerate === 'creative' || regenerate === 'all') {
    content.image.version += 1;
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

  const { creativeRegenerated } = await applyContentRegeneration(content, project, projectId, options);
  if (creativeRegenerated) {
    // A fresh, independently-generated image no longer matches whatever
    // sibling cards it used to share a creative with (if any) — clear
    // the link on both sides so their "mesmo criativo" badge doesn't
    // keep pointing at content that has since diverged.
    await unlinkCreativeSharing(paths, content);
  }

  await writeJson(contentPath, content);
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
  await applyContentRegeneration(leader, project, projectId, options);

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
export async function approveContent(projectId, contentId, targetDir = process.cwd(), batchId) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const content = await readJson(contentPath);
  const now = new Date().toISOString();

  content.status = 'aprovado';
  content.approval.approvedAt = now;
  content.approval.approvalSource = 'operator_panel';
  content.updatedAt = now;
  await writeJson(contentPath, content);

  project.learnings.approved = [
    summarizeApprovedLearning(content),
    ...project.learnings.approved,
  ].slice(0, MAX_LEARNING_ENTRIES);
  project.updatedAt = now;
  await writeJson(paths.projectPath, project);
  await writeFile(paths.manualPath, buildManual(project), 'utf-8');

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

    for (const item of due) {
      const ok = await publishOneItem(item, projectSummary, options.metaPublisher, now);
      (ok ? published : failed).push(ok ? item.contentId : { contentId: item.contentId, error: item.publish.error });
    }
  }

  return { published, failed };
}

async function publishOneItem(item, projectSummary, metaPublisher, now) {
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
    if (project) projects.push(toProjectSummary(project));
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
    if (raw) projects.push(toProjectSummary(raw));
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

export async function deleteProjectContent(projectId, contentId, targetDir = process.cwd(), batchId, reason) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
  const project = await loadProject(paths);
  const contentPath = await findContentPath(paths.draftsDir, contentId, batchId);
  const content = await readJson(contentPath);
  const batchPath = join(dirname(contentPath), 'batch.json');
  const batch = await readJson(batchPath, null);

  await rm(contentPath, { force: true });
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

  const cleanReason = String(reason || '').trim();
  if (cleanReason) {
    const now = new Date().toISOString();
    project.learnings.avoid = [
      summarizeAvoidLearning(content, cleanReason),
      ...project.learnings.avoid,
    ].slice(0, MAX_LEARNING_ENTRIES);
    project.updatedAt = now;
    await writeJson(paths.projectPath, project);
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

function normalizeLearnings(input) {
  const approved = Array.isArray(input?.approved) ? input.approved : [];
  const avoid = Array.isArray(input?.avoid) ? input.avoid : [];
  return {
    approved: approved.slice(0, MAX_LEARNING_ENTRIES).map(String),
    avoid: avoid.slice(0, MAX_LEARNING_ENTRIES).map(String),
  };
}

async function loadProject(paths) {
  const project = await readJson(paths.projectPath, null);
  if (!project) throw new Error(`Project not found: ${paths.projectId}`);
  return {
    ...project,
    // Projects created before this field existed simply don't have it in
    // their saved JSON — default here on every load instead of a one-off
    // migration, same convention as the other normalized fields below.
    projectType: SUPPORTED_PROJECT_TYPES.has(project.projectType) ? project.projectType : 'marketing',
    companyProfile: normalizeCompanyProfile(project.companyProfile),
    brandInput: normalizeBrandInput(project.brandInput || companyProfileToBrandInput(project.companyProfile, project.name)),
    brandIdentity: normalizeBrandIdentity(project.brandIdentity || { logoPath: project.brand?.logoPath }),
    brandXray: normalizeBrandXray(project.brandXray),
    brandBriefing: normalizeBrandBriefing(project.brandBriefing),
    contentStrategy: {
      ...(project.contentStrategy || {}),
      offers: normalizeProjectOffers(project.contentStrategy?.offers || []),
      pillars: normalizeProjectPillars(project.contentStrategy?.pillars || []),
    },
    learnings: normalizeLearnings(project.learnings),
  };
}

function toProjectSummary(project) {
  return {
    projectId: project.projectId,
    name: project.name,
    status: project.status,
    mode: project.mode,
    projectType: SUPPORTED_PROJECT_TYPES.has(project.projectType) ? project.projectType : 'marketing',
    approvalEmail: project.approvalEmail,
    timezone: project.timezone,
    instagram: project.instagram,
    companyProfile: normalizeCompanyProfile(project.companyProfile),
    brandInput: normalizeBrandInput(project.brandInput || companyProfileToBrandInput(project.companyProfile, project.name)),
    brandIdentity: normalizeBrandIdentity(project.brandIdentity || { logoPath: project.brand?.logoPath }),
    brandXray: normalizeBrandXray(project.brandXray),
    brandBriefing: normalizeBrandBriefing(project.brandBriefing),
    brand: project.brand,
    token: project.token,
    contentSettings: project.contentSettings,
    contentStrategy: {
      ...(project.contentStrategy || {}),
      offers: normalizeProjectOffers(project.contentStrategy?.offers || []),
      pillars: normalizeProjectPillars(project.contentStrategy?.pillars || []),
    },
    rules: project.rules,
    learnings: normalizeLearnings(project.learnings),
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
  const approvedLearnings = normalizeLearnings(project.learnings).approved;
  const avoidLearnings = normalizeLearnings(project.learnings).avoid;
  const projectTypeLine = project.projectType === 'catalog'
    ? 'Catálogo de produtos (venda direta) — posta o estoque ativo no Story automaticamente, sem Raio-X/pilares e sem arte gerada por IA (usa foto real do produto).'
    : 'Marketing de conteúdo (Raio-X, pilares e arte gerada por IA).';
  return `# Manual Vivo — ${project.name}\n\n## Tipo de projeto\n- ${projectTypeLine}\n\n## Informações básicas da empresa\n${companyProfileLines.length ? companyProfileLines.map((line) => `- ${line}`).join('\n') : '- Ainda sem informações básicas preenchidas.'}\n\n## Raio-X aprovado da marca\n${approvedXrayLines.length ? approvedXrayLines.map((line) => `- ${line}`).join('\n') : '- Ainda sem Raio-X aprovado.'}\n\n## Identidade visual\n- Logo esperado em: assets/logo.png\n- Referências em: assets/references/\n- Estilo visual: ${project.brand?.visualStyle || 'adicione o estilo visual do projeto.'}\n\n## Referências visuais cadastradas\n${references.length ? references.map((reference) => `- ${reference.relativePath} (${referenceRoleLabel(reference.role)}, peso ${reference.weight}): ${reference.instruction || 'sem instrução específica.'}`).join('\n') : '- Ainda sem referências cadastradas.'}\n\n## Ofertas e assuntos cadastrados\n${offers.length ? offers.map((offer) => `- ${offer.name} (${offerTypeLabel(offer.type)}): ${offer.price || 'sem preço'}; itens: ${offer.items || 'não informado'}; CTA: ${offer.cta || 'não informado'}`).join('\n') : '- Ainda sem ofertas cadastradas.'}\n\n## Pilares de conteúdo\n${pillars.length ? pillars.map((pillar) => `- ${pillar.name} (${pillarRoleLabel(pillar.role)}, peso ${pillar.weight}, tratamento ${pillar.visualTreatment}): ${pillar.objective || 'sem objetivo descrito'}`).join('\n') : '- Ainda sem pilares cadastrados; rotação de conteúdo segue o padrão automático.'}\n\n## Regras de imagem\n${imageRules.length ? imageRules.map((rule) => `- ${rule}`).join('\n') : '- Adicione regras visuais deste projeto aqui.'}\n\n## Regras do projeto\n${project.rules.project.length ? project.rules.project.map((rule) => `- ${rule}`).join('\n') : '- Adicione regras específicas deste projeto aqui.'}\n\n## Aprendizados aprovados\n${approvedLearnings.length ? approvedLearnings.map((line) => `- ${line}`).join('\n') : '- Ainda sem conteúdos aprovados.'}\n\n## Evitar\n${avoidLearnings.length ? avoidLearnings.map((line) => `- ${line}`).join('\n') : '- Ainda sem rejeições registradas.'}\n`;
}

function buildImagePrompt(project, globalRules, contentRules, dayNumber, context = {}) {
  const imageRules = filterImageRulesForTopic(
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
    approvedXrayLines.length ? section('RAIO-X APROVADO DA MARCA', approvedXrayLines) : '',
    approvedBriefingLines.length ? section('BRIEFING APROVADO DA MARCA', approvedBriefingLines) : '',
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
function buildTopicPool(project) {
  const offerTopics = normalizeProjectOffers(project.contentStrategy?.offers || [])
    .filter((offer) => offer.active)
    .map(offerToContentTopic);
  const goalTopics = (project.brandInput?.contentGoals || [])
    .map((goalKey) => buildGoalContentTopic(goalKey, project))
    .filter(Boolean);
  if (!offerTopics.length && !goalTopics.length) {
    return DEFAULT_CONTENT_TOPICS.map((topic) => {
      const built = { ...topic, source: 'default', cta: '' };
      return { ...built, cta: salesGatedCta(built, topic.cta) };
    });
  }
  return interleaveTopics(offerTopics, goalTopics);
}

function buildContentTopic(project, index, context = {}) {
  const topics = buildTopicPool(project);
  const topic = topics[index % topics.length];
  return {
    ...topic,
    channel: context.channel || '',
    sequence: index + 1,
  };
}

function contentTopicCount(project) {
  return buildTopicPool(project).length;
}

async function inferNextTestTopicIndex(paths, project, topicCount) {
  const topics = buildTopicPool(project);
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

function offerToContentTopic(offer) {
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
    objective: offerObjective(offer),
    pillarId: offer.pillarId || null,
    photoReferenceIds: Array.isArray(offer.photoReferenceIds) ? offer.photoReferenceIds : [],
  };
}

function offerObjective(offer) {
  if (offer.type === 'combo') return `Criar oferta de combo para ${offer.name}, com preço e CTA de delivery claros.`;
  if (offer.type === 'rodizio') return `Criar chamada para rodízio de ${offer.name}, destacando itens inclusos, preço e convite para aproveitar.`;
  if (offer.type === 'delivery') return `Criar chamada para delivery usando ${offer.name}, preço/benefício e pedido rápido.`;
  if (offer.type === 'orientation') return `Criar post de orientação usando ${offer.name} como assunto, sem parecer só promoção.`;
  return `Criar post de ${offerTypeLabel(offer.type)} para ${offer.name}.`;
}

function formatContentTopicLines(topic) {
  return [
    `Tipo de publicação: ${topic.label || offerTypeLabel(topic.type)}.`,
    topic.offerName ? `Oferta/assunto obrigatório: ${topic.offerName}.` : `Assunto: ${topic.objective || topic.label}.`,
    topic.price ? `Preço obrigatório: ${topic.price}. Não alterar, arredondar ou inventar outro preço.` : 'Não inventar preço se nenhum preço foi cadastrado para este assunto.',
    topic.items ? `Itens inclusos/detalhes: ${topic.items}.` : '',
    topic.cta ? `Chamada/CTA obrigatório: ${topic.cta}.` : '',
    !topic.cta && topic.autoGenerateCta ? 'CTA automático: criar uma chamada curta, natural e contextual depois de analisar o assunto, o formato do post e a composição criada. Evitar CTA massivo, genérico ou apelativo.' : '',
    topic.notes ? `Observações/restrições: ${topic.notes}.` : '',
    topic.objective ? `Objetivo criativo: ${topic.objective}` : '',
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
    }
  );
  content.creativePreflight = buildCreativePreflight(content.contentTopic || {}, options.channel || content.channel, rawReferences, baseReferences);
  const basePrompt = buildChatGptFinalCardPrompt(content, project, originalPrompt, options.channel, baseReferences);
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
  const exactTitle = isGoalTopic ? '' : normalizeCreativeTitle(topic.offerName || project.name);
  const exactPrice = normalizeCreativePrice(topic.price);
  const exactCta = chooseCreativeCta(topic, targetChannel);
  const objective = buildCreativeObjective(topic, project);
  const isVerticalStory = isVerticalStoryChannel(targetChannel);
  // A drawn button/selo isn't actually clickable in a Story/Reels asset —
  // the real action there happens through DM/reply, not a tap on the image
  // — so a bold CTA button reads as a UI element that does nothing. Feed
  // keeps the bold button treatment (bio link makes it a real next step);
  // vertical formats get the same CTA text folded into a small, subtitle-
  // style line instead, never a button/pill/selo.
  const useSubtleCta = isVerticalStory && Boolean(exactCta);
  const productFocus = detectCreativeProductFocus(topic);
  const quantityRules = buildCreativeQuantityRules(topic, productFocus, exactTitle);
  const visualSummary = summarizeBrandForCreative(project);
  const logoReferences = selectedReferences.filter((reference) => reference.role === 'brand_asset').slice(0, 1);
  const productReferences = selectedReferences.filter((reference) => reference.role === 'product_photo').slice(0, 2);
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
      isGoalTopic
        ? `Título: criar um título curto (até 8 palavras), chamativo, em formato de gancho ou pergunta específica sobre "${topic.label}" — não usar apenas o nome "${project.name}" como título, o nome da marca já aparece na logo. Ex. de estilo (adaptar ao assunto real, não copiar): pergunta direta que gera curiosidade, seguida de um subtítulo curto que reforça o valor.`
        : `Título exato: ${exactTitle}`,
      topic.items ? `Subtítulo permitido: ${cleanPromptText(topic.items)}` : '',
      exactPrice ? `Preço exato: ${exactPrice}` : 'Preço: não inserir preço, pois não há preço cadastrado para este criativo.',
      exactCta
        ? (useSubtleCta
          ? `CTA sutil: "${exactCta}" como texto pequeno, sem botão/selo.`
          : `CTA exato: ${exactCta}`)
        : 'Sem CTA nesta peça — não inserir nenhum botão, selo ou texto de chamada para ação (ex.: "peça agora", "chame agora", "saiba mais") na arte; é um post de conteúdo, não uma oferta.',
      topic.type ? `Tipo de publicação: ${offerTypeLabel(topic.type)}.` : '',
      [
        isGoalTopic ? 'Não alterar preço' : 'Não alterar título, preço',
        exactCta ? ' ou CTA' : '',
        '. Não criar telefone, endereço, desconto ou informação extra.',
      ].join(''),
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
      'Evitar visual infantil, plástico, artificial, genérico de IA, sobrecarregado ou com enfeites de template sem função.',
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
      isGoalTopic ? '2. Título chamativo criado pela IA (gancho ou pergunta específica do objetivo do post).' : `2. Título “${exactTitle}”.`,
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
      variation.length ? `Variação desejada: ${variation.join(' ')}` : 'Criar uma composição nova, limpa e profissional.',
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
// did. Anything else (orientation, institutional, desire, urgency, or a
// pillar like "ensina"/"prova"/"posiciona") is not actually asking for an
// order, so it shouldn't carry a hard sales CTA at all.
function isSalesTopic(topic = {}) {
  if (topic.pillar) return topic.pillar.role === 'convida';
  return ['combo', 'delivery', 'offer', 'product', 'rodizio'].includes(topic.type);
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

// Feed (Instagram/Facebook) is browsed as a brand's ongoing content, not
// clicked through mid-scroll the way a Story is swiped — pushing the same
// hard "Peça agora" action call onto every Feed post reads as pushy for a
// channel that's mostly about staying present, not converting on the spot.
// Story/Reels keep the direct action CTA; Feed gets a softer one, unless the
// offer explicitly set its own CTA (that choice is respected on every
// channel, feed included).
//
// Non-sales content (orientation/institutional/relationship posts, or a
// pillar that isn't "convida") gets no CTA here at all — baking a "peça
// agora"-style button into a post whose whole point is to *not* look like a
// promotion undercuts the content. The caption still closes with its own
// natural, contextual call to action (autoGenerateCta) — that's a separate,
// softer mechanism from the hard button rendered inside the creative.
export function chooseCreativeCta(topic = {}, channel = '') {
  const explicit = String(topic.cta || '').trim();
  if (explicit) return explicit;
  if (!isSalesTopic(topic)) return '';
  if (creativeShapeGroupForChannel(channel) === 'feed') return 'Saiba mais';
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

function detectCreativeProductFocus(topic = {}) {
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
  const selected = [];
  for (const reference of references) {
    const usageRoles = normalizeReferenceUsageRoles(reference.usageRoles, reference.role);
    if (usageRoles.includes('text_parameter')) continue;
    if (!allowedRoles.has(reference.role)) continue;
    selected.push(reference);
  }
  const brandAssets = selected.filter((reference) => reference.role === 'brand_asset').slice(0, 1);
  const productPhotos = prioritizeReferencesByTopic(
    selected.filter((reference) => reference.role === 'product_photo'),
    topicFocus
  ).slice(0, 2);
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
    segment: cleanText(input?.segment),
    description: cleanText(input?.description),
    audience: cleanText(input?.audience),
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

function formatCompanyProfileLines(input = {}) {
  const profile = normalizeCompanyProfile(input);
  return [
    profile.segment ? `Segmento: ${profile.segment}.` : '',
    profile.description ? `Descrição da empresa: ${profile.description}.` : '',
    profile.productsOrServices ? `O que vende/presta: ${profile.productsOrServices}.` : '',
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
    profile.segment ? `Segmento informado: ${profile.segment}.` : '',
    profile.description ? `Descrição fornecida: ${profile.description}.` : '',
    profile.productsOrServices ? `Produtos/serviços informados: ${profile.productsOrServices}.` : '',
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
    segment: cleanText(input?.segment),
    productsOrServices: cleanText(input?.productsOrServices),
    description: cleanText(input?.description),
    serviceRegion: cleanText(input?.serviceRegion || input?.location),
    mainDifferential: cleanText(input?.mainDifferential || input?.differentiators),
    contentGoals: normalizeContentGoalList(input?.contentGoals),
    audience: cleanText(input?.audience),
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
  return ['brandName', 'segment', 'productsOrServices', 'description', 'serviceRegion', 'mainDifferential', 'contentGoals']
    .some((key) => Object.prototype.hasOwnProperty.call(input || {}, key));
}

function brandInputToCompanyProfile(input = {}, existingProfile = {}) {
  const brandInput = normalizeBrandInput(input);
  const existing = normalizeCompanyProfile(existingProfile);
  return normalizeCompanyProfile({
    ...existing,
    segment: brandInput.segment,
    description: brandInput.description,
    location: brandInput.serviceRegion,
    productsOrServices: brandInput.productsOrServices,
    differentiators: brandInput.mainDifferential,
    primaryObjective: brandInput.contentGoals.map(contentGoalLabel).join(', '),
    contentGoals: brandInput.contentGoals,
    audience: brandInput.audience,
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
    segment: profile.segment,
    productsOrServices: profile.productsOrServices,
    description: profile.description,
    serviceRegion: profile.location,
    audience: profile.audience,
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
    ...sortReferencesForPrompt(normalizeProjectReferences(project)),
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
  <text x="${margin + 38}" y="${margin + 302}" fill="#d4d4d8" font-size="38" font-family="Arial, sans-serif">Dia ${content.dayNumber} · ${escapeXml(content.scheduledDate)} · ${escapeXml(content.scheduledTime)}</text>
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
const projectLocks = new Map();

function withProjectLock(targetDir, projectId, fn) {
  const key = `${targetDir}::${projectId}`;
  const previous = projectLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  projectLocks.set(key, run.catch(() => {}));
  return run;
}
