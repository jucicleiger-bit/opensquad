export interface ProjectToken {
  configured?: boolean;
  masked?: string;
  expiresAt?: string | null;
  daysRemaining?: number | null;
  status?: string;
  permissions?: string[];
  [key: string]: unknown;
}

export interface ProjectInstagram {
  handle?: string;
  instagramUserId?: string;
  pageId?: string;
}

export interface BrandInput {
  brandName?: string;
  segment?: string;
  productsOrServices?: string;
  description?: string;
  serviceRegion?: string;
  mainDifferential?: string;
  contentGoals?: string[];
  audience?: string;
  tone?: string[];
  avoid?: string;
  positioning?: string;
  brandColors?: string;
  factualConstraints?: string;
  websiteOrInstagram?: string;
}

export const BRAND_XRAY_BLOCK_IDS = ["summary", "communication", "contentStrategy", "visualIdentity"] as const;
export type BrandXrayBlockId = (typeof BRAND_XRAY_BLOCK_IDS)[number];

export interface BrandXrayBlock {
  id: string;
  label: string;
  text: string;
  status?: string;
  sources?: string[];
}

export interface BrandXray {
  status?: "empty" | "generated" | "approved" | "needs_review" | string;
  blocks: Partial<Record<BrandXrayBlockId, BrandXrayBlock>>;
  generatedAt?: string | null;
  approvedAt?: string | null;
}

export interface ProjectOffer {
  id: string;
  name: string;
  type: string;
  price?: string;
  items?: string;
  cta?: string;
  autoGenerateCta?: boolean;
  notes?: string;
  active?: boolean;
  pillarId?: string | null;
  photoReferenceIds?: string[];
}

export interface ProjectPillar {
  id: string;
  name: string;
  role: "ensina" | "prova" | "posiciona" | "convida";
  objective?: string;
  visualTreatment: "cru" | "leve" | "desenhado";
  color: string;
  weight: number;
  requiresEvidence: boolean;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const PILLAR_ROLE_LABELS: Record<string, string> = {
  ensina: "Ensina",
  prova: "Prova",
  posiciona: "Posiciona",
  convida: "Convida",
};

export const PILLAR_TREATMENT_LABELS: Record<string, string> = {
  cru: "Cru",
  leve: "Leve",
  desenhado: "Desenhado",
};

// Mirrors OFFER_TYPE_TO_PILLAR_ROLE in src/content-central.js — used only to
// preview which pillar an offer would auto-resolve to when no pillarId is
// set explicitly, so "deixar o sistema decidir" doesn't look like it did
// nothing on the offers list. The real resolution still happens server-side
// at generation time; this is a read-only preview, never sent back to save.
export const OFFER_TYPE_TO_PILLAR_ROLE: Record<string, string> = {
  offer: "convida",
  combo: "convida",
  rodizio: "convida",
  delivery: "convida",
  product: "convida",
  social_proof: "prova",
  institutional: "ensina",
  orientation: "ensina",
  desire: "posiciona",
  urgency: "posiciona",
};

export interface ProjectReference {
  id: string;
  filename: string;
  relativePath: string;
  previewUrl: string;
  mimeType: string;
  role: string;
  usageRoles: string[];
  weight: string;
  referenceCategory: string;
  automaticRule?: string;
  useInNextGeneration?: boolean;
  instruction?: string;
}

export interface ProjectBrand {
  logoPath?: string;
  references?: ProjectReference[];
  visualStyle?: string;
  imageRules?: string[];
}

export interface BrandIdentity {
  logoPath?: string;
  extractedColors?: string[];
  editedColors?: string[];
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  status?: string;
  mode?: string;
  projectType?: "marketing" | "catalog";
  approvalEmail?: string;
  timezone?: string;
  instagram?: ProjectInstagram;
  companyProfile?: unknown;
  brandInput?: BrandInput;
  brandIdentity?: BrandIdentity;
  brandXray?: BrandXray;
  brandBriefing?: unknown;
  brand?: ProjectBrand;
  token?: ProjectToken | null;
  contentSettings?: {
    catalogGeneralInfo?: string;
    catalogStoriesPerDay?: number;
    [key: string]: unknown;
  };
  contentStrategy?: { offers?: ProjectOffer[]; pillars?: ProjectPillar[]; [key: string]: unknown };
  rules?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface SystemAlert {
  type: "token_expired" | "token_expiring" | "publish_failed";
  projectId: string;
  projectName: string;
  message: string;
  contentId?: string;
  batchId?: string;
}

export interface StateResponse {
  projects: ProjectSummary[];
  globalRules: unknown;
  alerts: SystemAlert[];
}

export interface ContentImage {
  localPath?: string;
  previewDataUrl?: string;
  previewUrl?: string;
  url?: string;
  mimeType?: string;
  generatedSource?: string;
  generating?: boolean;
  dimensions?: { width?: number; height?: number };
  prompt?: string;
}

export interface ContentCaption {
  text?: string;
  generatedSource?: string;
}

export interface ContentVideo {
  url: string;
  localPath?: string | null;
  mimeType?: string;
  durationSeconds?: number | null;
  generatedAt?: string;
  generatedSource?: string;
}

export interface ContentPublish {
  publishedAt?: string | null;
  error?: string | null;
  realPublished?: boolean;
  permalink?: string;
  dryRun?: boolean;
  creativeVariation?: string;
}

export interface CreativeReview {
  status?: string;
  summary?: string;
  errors?: string[];
  warnings?: string[];
  checks?: string[];
}

export interface PillarSnapshot {
  id: string;
  name: string;
  role: "ensina" | "prova" | "posiciona" | "convida";
  objective?: string;
  visualTreatment?: string;
  color?: string;
  requiresEvidence?: boolean;
}

export interface ContentTopic {
  pillar?: PillarSnapshot;
  [key: string]: unknown;
}

export interface ContentItem {
  contentId: string;
  batchId?: string;
  dayNumber?: number;
  scheduledDate: string;
  scheduledTime?: string;
  channel: string;
  formatLabel?: string;
  status: string;
  image?: ContentImage;
  video?: ContentVideo;
  caption?: ContentCaption;
  publish?: ContentPublish;
  contentTopic?: ContentTopic;
  creativeReview?: CreativeReview;
  creativeReviewAttempts?: unknown[];
  captionGenerationError?: string | null;
  imageGenerationError?: string | null;
  videoGenerationError?: string | null;
  creativeSharedWith?: string[] | null;
  creativeGroupKey?: string | null;
}

class ApiError extends Error {}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(body.error || "Erro");
  return body as T;
}

export function getState(): Promise<StateResponse> {
  return api<StateResponse>("/api/state");
}

export function getProjectContent(projectId: string): Promise<{ content: ContentItem[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content`);
}

export interface CreateProjectInput {
  projectId?: string;
  name: string;
  handle?: string;
  approvalEmail?: string;
  mode?: string;
  projectType?: string;
}

export function createProject(input: CreateProjectInput): Promise<{ project: ProjectSummary }> {
  return api("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteProject(projectId: string): Promise<{ projectId: string; deleted: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "POST",
  });
}

export function deleteContent(projectId: string, contentId: string, batchId?: string, reason?: string): Promise<unknown> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content/${encodeURIComponent(contentId)}/delete`, {
    method: "POST",
    body: JSON.stringify({ batchId, reason }),
  });
}

export interface GenerateFormatInput {
  channel: string;
  postsPerDay: string;
  everyDays: string;
  startTime: string;
  intervalMinutes: string;
}

export interface GenerateContentInput {
  days: string;
  startDate: string;
  formats: GenerateFormatInput[];
  contentRules: string;
}

export function generateContent(
  projectId: string,
  input: GenerateContentInput,
): Promise<{ batch: { items: unknown[] } }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/generate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// For catalog (venda direta) projects: no formats/channels matrix — just
// how many days, how many stories per day, and when the first one goes out.
export interface GenerateCatalogContentInput {
  days: string;
  startDate: string;
  storiesPerDay: string;
  startTime: string;
  intervalMinutes?: string;
}

export function generateCatalogContent(
  projectId: string,
  input: GenerateCatalogContentInput,
): Promise<{ batch: { items: unknown[] } }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/generate-catalog`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function approveContent(projectId: string, contentId: string, batchId?: string): Promise<unknown> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content/${encodeURIComponent(contentId)}/approve`, {
    method: "POST",
    body: JSON.stringify({ batchId }),
  });
}

export function publishContent(projectId: string, contentId: string, batchId?: string): Promise<unknown> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content/${encodeURIComponent(contentId)}/publish`, {
    method: "POST",
    body: JSON.stringify({ batchId }),
  });
}

export function regenerateContent(
  projectId: string,
  contentId: string,
  input: { regenerate: "creative" | "all"; note?: string; batchId?: string },
): Promise<{ content: ContentItem }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content/${encodeURIComponent(contentId)}/regenerate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function regenerateContentGroup(
  projectId: string,
  contentIds: string[],
  input: { regenerate: "creative" | "all"; note?: string; batchId?: string },
): Promise<{ items: ContentItem[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content-group-regenerate`, {
    method: "POST",
    body: JSON.stringify({ ...input, contentIds }),
  });
}

export function animateForReels(projectId: string, contentId: string, batchId?: string): Promise<{ content: ContentItem }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content/${encodeURIComponent(contentId)}/animate-reels`, {
    method: "POST",
    body: JSON.stringify({ batchId }),
  });
}

export function updateCaption(
  projectId: string,
  contentId: string,
  text: string,
  batchId?: string,
): Promise<{ content: ContentItem }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/content/${encodeURIComponent(contentId)}/caption`, {
    method: "POST",
    body: JSON.stringify({ text, batchId }),
  });
}

export function saveToken(projectId: string, token: string, handle: string): Promise<{ project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/token`, {
    method: "POST",
    body: JSON.stringify({ token, handle }),
  });
}

export function saveBrandInput(projectId: string, input: BrandInput): Promise<{ project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/brand-input`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface SiteOfferCandidate {
  name: string;
  price: string;
  items: string;
}

export interface SiteAnalysisResult {
  brandInput: BrandInput;
  offers: SiteOfferCandidate[];
}

export function analyzeSite(projectId: string, input: { url?: string; text?: string }): Promise<SiteAnalysisResult> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/site-analyze`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface OnlineResearchResult {
  researchedAt: string;
  findings: string[];
}

export function researchOnline(projectId: string): Promise<OnlineResearchResult> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/research-online`, {
    method: "POST",
    body: "{}",
  });
}

export function analyzeBrandXray(projectId: string, input: BrandInput): Promise<{ project: ProjectSummary; xray: BrandXray }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/brand-xray/analyze`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function approveBrandXray(
  projectId: string,
  edits: Partial<Record<BrandXrayBlockId, string>>,
): Promise<{ project: ProjectSummary; xray: BrandXray }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/brand-xray/approve`, {
    method: "POST",
    body: JSON.stringify({ edits }),
  });
}

export interface SaveOfferInput {
  id?: string;
  name: string;
  type: string;
  price?: string;
  items?: string;
  cta?: string;
  autoGenerateCta?: boolean;
  notes?: string;
  pillarId?: string | null;
  active?: boolean;
  photoReferenceIds?: string[];
}

export function saveOffer(projectId: string, input: SaveOfferInput): Promise<{ project: ProjectSummary; offer: ProjectOffer }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offers`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteOffer(projectId: string, offerId: string): Promise<{ deleted: boolean; project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offers-delete`, {
    method: "POST",
    body: JSON.stringify({ offerId }),
  });
}

export interface SavePillarInput {
  id?: string;
  name: string;
  role: string;
  objective?: string;
  visualTreatment?: string;
  color?: string;
  weight?: number;
  requiresEvidence?: boolean;
  active?: boolean;
}

export function savePillar(projectId: string, input: SavePillarInput): Promise<{ project: ProjectSummary; pillar: ProjectPillar }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/pillars`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deletePillar(projectId: string, pillarId: string): Promise<{ deleted: boolean; project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/pillars-delete`, {
    method: "POST",
    body: JSON.stringify({ pillarId }),
  });
}

export interface SuggestedPillar {
  id: string;
  name: string;
  role: "ensina" | "prova" | "posiciona" | "convida";
  objective?: string;
  visualTreatment: "cru" | "leve" | "desenhado";
  color: string;
  weight: number;
  requiresEvidence: boolean;
}

export interface SuggestPillarsResult {
  pillars: SuggestedPillar[];
  clarifyingQuestions: string[];
  source: "template" | "ai_suggestion";
}

export function suggestPillars(projectId: string, input: { extraContext?: string } = {}): Promise<SuggestPillarsResult> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/pillars-suggest`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface SaveAssetInput {
  kind: "logo" | "reference";
  filename: string;
  dataUrl: string;
  role?: string;
  usageRoles?: string[];
  referenceCategory?: string;
  useInNextGeneration?: boolean;
  weight?: string;
  instruction?: string;
}

export interface SavedAsset {
  kind: "logo" | "reference";
  filename: string;
  relativePath: string;
  bytes: number;
  metadata: ProjectReference | null;
  project: ProjectSummary;
}

export function saveAsset(projectId: string, input: SaveAssetInput): Promise<{ asset: SavedAsset }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/assets`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteReference(projectId: string, relativePath: string): Promise<{ deleted: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/references-delete`, {
    method: "POST",
    body: JSON.stringify({ relativePath }),
  });
}

export interface UpdateReferenceInput {
  referenceCategory?: string;
  role?: string;
  usageRoles?: string[];
  instruction?: string;
  useInNextGeneration?: boolean;
  weight?: string;
}

export function updateReference(
  projectId: string,
  relativePath: string,
  input: UpdateReferenceInput,
): Promise<{ project: ProjectSummary; reference: ProjectReference }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/references-update`, {
    method: "POST",
    body: JSON.stringify({ relativePath, ...input }),
  });
}

export function saveImageRules(projectId: string, visualStyle: string, imageRules: string): Promise<{ project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/image-rules`, {
    method: "POST",
    body: JSON.stringify({ visualStyle, imageRules }),
  });
}

// Catalog-only settings that apply to every product's composition (financing
// terms, "entrada facilitada" etc.), edited once for the whole project.
export function saveCatalogSettings(
  projectId: string,
  input: { catalogGeneralInfo?: string; catalogStoriesPerDay?: number },
): Promise<{ project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/catalog-settings`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function testPost(projectId: string, channel: string, note: string): Promise<{ content: ContentItem; message: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/test-post`, {
    method: "POST",
    body: JSON.stringify({ channel, note }),
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const CONTENT_GOAL_LABELS: Record<string, string> = {
  sell_products: "Vender produtos",
  sell_services: "Vender serviços",
  promotions: "Divulgar promoções",
  whatsapp_orders: "Receber pedidos no WhatsApp",
  leads: "Gerar leads",
  authority: "Gerar autoridade",
  brand_awareness: "Aumentar reconhecimento da marca",
  relationship: "Criar relacionamento",
  engagement: "Aumentar engajamento",
  events: "Divulgar eventos",
  show_products: "Mostrar produtos",
  education: "Educar o público",
};

export const BRAND_XRAY_BLOCK_LABELS: Record<BrandXrayBlockId, string> = {
  summary: "Resumo da marca",
  communication: "Comunicação recomendada",
  contentStrategy: "Estratégia de conteúdo",
  visualIdentity: "Identidade visual",
};

export const PROJECT_MODE_LABELS: Record<string, string> = {
  semi_automatic: "semi-automático",
  manual: "manual",
  automatic: "automático",
};

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  marketing: "Marketing de conteúdo",
  catalog: "Catálogo de produtos (venda direta)",
};

export const OFFER_TYPE_LABELS: Record<string, string> = {
  offer: "Oferta direta",
  combo: "Combo / promoção",
  rodizio: "Rodízio",
  delivery: "Delivery",
  product: "Produto destaque",
  orientation: "Post de orientação",
  desire: "Post de desejo",
  urgency: "Urgência / hoje tem",
  institutional: "Institucional",
  social_proof: "Prova social",
};

export const REFERENCE_CATEGORY_LABELS: Record<string, string> = {
  official_asset: "Ativos oficiais da marca",
  real_product: "Fotos reais e produtos",
  visual_inspiration: "Inspirações visuais",
};

export const REFERENCE_ROLE_LABELS: Record<string, string> = {
  brand_asset: "Logo/marca",
  product_photo: "Foto/produto",
  layout_model: "Modelo de layout",
  text_parameter: "Parâmetro textual",
  visual_reference: "Referência visual",
};

export const REFERENCE_AUTOMATIC_RULES: Record<string, string> = {
  official_asset:
    "Preservar exatamente o ativo enviado. Não redesenhar, reinterpretar, alterar textos, cores ou proporções importantes.",
  real_product: "Preservar a aparência real. É permitido recortar, ajustar iluminação e integrar à composição, mas não substituir por outro produto.",
  visual_inspiration:
    "Utilizar apenas como inspiração visual. Não copiar logos, nomes, textos, preços, produtos ou elementos exclusivos da referência.",
};

export function roleForReferenceCategory(category: string, usageRoles: string[]): string {
  if (category === "official_asset") return "brand_asset";
  if (category === "real_product") return "product_photo";
  return usageRoles[0] || "visual_reference";
}
