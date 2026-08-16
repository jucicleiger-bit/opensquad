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
  segmentGroup?: string;
  segmentCategory?: string;
  segmentSpecialty?: string;
  segment?: string;
  productsOrServices?: string;
  description?: string;
  serviceRegion?: string;
  mainDifferential?: string;
  contentGoals?: string[];
  audience?: string;
  audienceType?: "" | "b2b" | "b2c" | "mixed";
  tone?: string[];
  avoid?: string;
  positioning?: string;
  brandColors?: string;
  factualConstraints?: string;
  websiteOrInstagram?: string;
}

export interface TechnicalBase {
  sourceText?: string;
  summary?: string;
  source?: string;
  updatedAt?: string | null;
}

export const BRAND_XRAY_BLOCK_IDS = ["summary", "communication", "contentStrategy", "visualIdentity"] as const;
export const BRAND_XRAY_STRATEGIC_BLOCK_IDS = ["summary", "communication", "contentStrategy"] as const;
export type BrandXrayBlockId = (typeof BRAND_XRAY_BLOCK_IDS)[number];

export interface BrandXrayBlock {
  id: string;
  label: string;
  text: string;
  status?: string;
  source?: string;
  sources?: string[];
}

export type BrandXraySuggestionField = "audience" | "description" | "mainDifferential" | "positioning" | "tone" | "segment";

export interface BrandXrayFieldSuggestion {
  field: BrandXraySuggestionField;
  label: string;
  value: string;
  reason: string;
  source?: "ai_analysis" | "inferred_hypothesis" | "structured_fallback" | string;
  confidence?: "low" | "medium" | "high" | string;
  requiresConfirmation?: boolean;
}

export interface BrandXray {
  status?: "empty" | "generated" | "approved" | "needs_review" | string;
  source?: string;
  analysisMode?: "ai" | "fallback" | string;
  blocks: Partial<Record<BrandXrayBlockId, BrandXrayBlock>>;
  fieldSuggestions?: BrandXrayFieldSuggestion[];
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
  groupId?: string | null;
  daysOfWeek?: string[];
  photoReferenceIds?: string[];
  productTreatment?: "creative_redraw" | "exact_asset" | "";
  layoutStrength?: "strict" | "balanced" | "free" | "";
}

export const WEEKDAY_LABELS: Record<string, string> = {
  mon: "Seg",
  tue: "Ter",
  wed: "Qua",
  thu: "Qui",
  fri: "Sex",
  sat: "Sáb",
  sun: "Dom",
};
export const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const AUDIENCE_TYPE_LABELS: Record<string, string> = {
  b2b: "B2B — vende para empresas/revendedores",
  b2c: "B2C — vende direto ao consumidor final",
  mixed: "B2B e B2C — atende empresas e consumidor final",
};

export interface OfferGroup {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
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

export interface SegmentLearningEntry {
  id: string;
  bucket: "technical" | "approved" | "avoid";
  kind: "text" | "image";
  text: string;
  imagePath?: string;
  purpose?: "product" | "creative";
  // The project the image was actually uploaded to — segment/offer-type
  // learning stores are global (shared across projects), but the file
  // itself lives under this project's own assets directory. Only set for
  // kind: "image". Use this (not the currently open project) to build the
  // thumbnail URL.
  sourceProjectId?: string;
  source: "auto" | "manual";
  createdAt: string;
}

export interface SegmentLearningNode {
  path: string;
  label: string;
  level: "setor" | "nicho" | "especialidade";
  entries: SegmentLearningEntry[];
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

// The real facts read off a prospect's actual Instagram profile screenshot
// — never anything the AI generated. Quoted verbatim on the prospecting
// mockup's profile header (see /api/projects/:id/prospect-mockup).
export interface ProspectSource {
  handle: string | null;
  bio: string | null;
  realFollowers: number | null;
  realPosts: number | null;
  realFollowing: number | null;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  status?: string;
  mode?: string;
  projectType?: "marketing" | "catalog";
  isProspect?: boolean;
  prospectSource?: ProspectSource | null;
  approvalEmail?: string;
  timezone?: string;
  instagram?: ProjectInstagram;
  companyProfile?: unknown;
  brandInput?: BrandInput;
  brandIdentity?: BrandIdentity;
  brandXray?: BrandXray;
  brandBriefing?: unknown;
  technicalBase?: TechnicalBase;
  brand?: ProjectBrand;
  offerAssets?: ProjectReference[];
  token?: ProjectToken | null;
  contentSettings?: {
    catalogGeneralInfo?: string;
    catalogStoriesPerDay?: number;
    [key: string]: unknown;
  };
  contentStrategy?: { offers?: ProjectOffer[]; pillars?: ProjectPillar[]; offerGroups?: OfferGroup[]; [key: string]: unknown };
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

// What the AI read off the prospect's screenshot — always editable before
// generating anything, since a vision read can get a detail wrong. `null`
// fields mean "couldn't read this," never a guess.
export interface ProspectExtraction {
  businessName: string | null;
  handle: string | null;
  nicheGuess: string | null;
  bioText: string | null;
  differentiators: string[];
  realFollowers: number | null;
  realPosts: number | null;
  realFollowing: number | null;
}

export function createProspectFromScreenshot(
  dataUrl: string,
): Promise<{ project: ProjectSummary; extracted: ProspectExtraction | null }> {
  return api("/api/prospects", {
    method: "POST",
    body: JSON.stringify({ dataUrl }),
  });
}

export function prospectMockupUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/prospect-mockup`;
}

// A "segment template" (e.g. "Embalagens") is a small library of
// pre-approved, already-real (AI-photographed) art reused across every
// prospect in the same business segment — see registerSegmentTemplate in
// content-central.js. Registration is operator/script-driven for now; the
// dashboard only ever lists and consumes what's already registered.
// The art itself is fixed (never regenerated per prospect); only a live CSS
// color overlay changes per prospect, client-side, zero network call.
export interface SegmentTemplatePiece {
  key: string;
  label: string;
  channel: string;
  imagePath: string;
}

export interface SegmentTemplateSummary {
  segmentId: string;
  label: string;
  pieceCount: number;
  pieces: SegmentTemplatePiece[];
}

export function listSegmentTemplates(): Promise<{ templates: SegmentTemplateSummary[] }> {
  return api("/api/segment-templates");
}

// imagePath comes back as "images/<file>.png" — only the filename matters to
// the serving route, which resolves it against the segment's own directory.
export function segmentTemplateImageUrl(segmentId: string, imagePath: string): string {
  const filename = imagePath.split("/").pop() || "";
  return `/api/segment-templates/${encodeURIComponent(segmentId)}/images/${encodeURIComponent(filename)}`;
}

// One AI pass over the operator's bio draft in the prospecting preview —
// polishes wording only, never invents facts the draft didn't already have.
export function improveBio(
  projectId: string,
  input: { bio: string; segment?: string; businessName?: string },
): Promise<{ bio: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/improve-bio`, {
    method: "POST",
    body: JSON.stringify(input),
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
  // Scopes offer-driven topics to only these offer group(s) for this
  // generation — omit (or leave empty) to use every active offer, same as
  // before groups existed. Goal-driven topics are never affected.
  groupIds?: string[];
  // Only meaningful together with groupIds: skip goal-driven topics
  // (autoridade/engajamento/etc.) entirely, so this batch is 100% offers
  // from the selected group(s) instead of the usual interleaved mix.
  offersOnly?: boolean;
  // Optional reviewed/edited planning preview. When present, the backend
  // applies per-card subject/orientation edits to the generated drafts.
  approvedPlan?: PlannedContentSchedule;
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

export interface PlannedContentSlot {
  id: string;
  dayNumber: number;
  date: string;
  scheduledTime: string;
  channel: string;
  channelLabel: string;
  slotNumber: number;
  kind: string;
  source: string;
  label: string;
  offerId?: string | null;
  offerName?: string;
  price?: string;
  goalKey?: string;
  specialDateLabel?: string;
  reason?: string;
  extra?: boolean;
}

export interface PlannedContentDay {
  dayNumber: number;
  date: string;
  regular: PlannedContentSlot[];
  extras: PlannedContentSlot[];
}

export interface PlannedContentSchedule {
  projectId: string;
  projectName: string;
  startDate: string;
  days: number;
  regularCount: number;
  extraCount: number;
  summary: string;
  dayPlans: PlannedContentDay[];
  rules: { groupIds: string[]; offersOnly: boolean; usesBrandXray: boolean; extraDatesDoNotConsumeDailyQuota: boolean };
}

export function previewContentPlan(
  projectId: string,
  input: GenerateContentInput,
): Promise<{ plan: PlannedContentSchedule }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/plan`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface CommemorativeDate {
  date: string;
  label: string;
  kind: "holiday" | "commercial";
}

export function listCommemorativeDates(projectId: string, months = 3): Promise<{ dates: CommemorativeDate[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/commemorative-dates?months=${months}`);
}

export interface GenerateSpecialDateInput {
  date: string;
  label: string;
  // Same-shape channels (Story/Reels/Facebook Story, or Feed/Facebook Feed)
  // sent together share one generated creative instead of each paying for
  // its own — see creativeGroupKey in generateSpecialDateContent.
  channels: string[];
  offerId?: string;
  postTime?: string;
}

// A one-off creative for a national holiday or commercial date, generated
// independent of the normal offer/pillar rotation — see
// generateSpecialDateContent in content-central.js.
export function generateSpecialDateContent(
  projectId: string,
  input: GenerateSpecialDateInput,
): Promise<{ batch: { items: unknown[] } }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/generate-special-date`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface AdCopyVariation {
  angle: "dor" | "desejo" | "urgencia";
  angleLabel: string;
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
}

// The real objectives from Meta Ads Manager — each one changes the tone/CTA
// the copy generator writes (see AD_OBJECTIVE_COPY_GUIDANCE server-side).
export const AD_OBJECTIVE_LABELS: Record<string, string> = {
  whatsapp: "Tráfego para o WhatsApp",
  awareness: "Reconhecimento de marca",
  engagement: "Engajamento",
  leads: "Cadastros (Leads)",
  sales: "Vendas/Conversão",
  app_promotion: "Promoção do app",
};

// A criativo de anúncio pago (paid ad creative) — a separate concept from
// organic ContentItem: no scheduledDate, no approval, no calendar. The
// operator runs the campaign themselves in Ads Manager; this is just the
// generated creative + copy variations, ready to download/copy from.
export interface AdCreative {
  adCreativeId: string;
  projectId: string;
  objective: string;
  objectiveLabel: string;
  offerId: string | null;
  offerName: string | null;
  channel: string;
  formatLabel: string;
  title: string;
  image: {
    url?: string;
    previewUrl?: string;
    previewDataUrl?: string;
    generating?: boolean;
    aspectRatio?: string;
    dimensions?: { width: number; height: number };
  };
  variations: AdCopyVariation[];
  imageGenerationError: string | null;
  copyGenerationError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listAdCreatives(projectId: string): Promise<{ adCreatives: AdCreative[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/ad-creatives`);
}

export interface GenerateAdCreativeInput {
  objective: string;
  offerId?: string;
  format?: "story" | "feed" | "ambos";
  note?: string;
  noteMode?: "recomendacao" | "base_total";
}

export function generateAdCreative(
  projectId: string,
  input: GenerateAdCreativeInput,
): Promise<{ adCreatives: AdCreative[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/ad-creatives`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// "Regenerar só a imagem" (no note) or "Pedido de alteração" (with note —
// a targeted edit of the existing image, same mechanism organic content
// regeneration uses). Copy variations are always left untouched.
export function regenerateAdCreative(
  projectId: string,
  adCreativeId: string,
  note?: string,
): Promise<{ adCreative: AdCreative }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/ad-creatives-regenerate/${encodeURIComponent(adCreativeId)}`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function deleteAdCreative(projectId: string, adCreativeId: string): Promise<{ deleted: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/ad-creatives-delete/${encodeURIComponent(adCreativeId)}`, {
    method: "POST",
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

export function saveToken(
  projectId: string,
  token: string,
  handle: string,
): Promise<{ project: ProjectSummary; githubSyncWarning?: string }> {
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

export function analyzeTechnicalBase(projectId: string, sourceText: string): Promise<{ project: ProjectSummary; technicalBase: TechnicalBase }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/technical-base/analyze`, {
    method: "POST",
    body: JSON.stringify({ sourceText }),
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

export function analyzeLearningImage(
  input: { scope: "segment" | "offerType"; groupKey: string; dataUrl: string; filename: string; purpose?: "product" | "creative" },
): Promise<{ imagePath: string; suggestedText: string }> {
  return api(`/api/segment-learnings/analyze-image`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveLearningEntry(
  input: { scope: "segment" | "offerType"; groupKey: string; bucket: "technical" | "approved" | "avoid"; kind: "text" | "image"; text: string; imagePath?: string; purpose?: "product" | "creative" },
): Promise<{ entries: SegmentLearningEntry[] }> {
  return api(`/api/segment-learnings/entries`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteLearningEntry(
  input: { scope: "segment" | "offerType"; groupKey: string; entryId: string },
): Promise<{ entries: SegmentLearningEntry[] }> {
  return api(`/api/segment-learnings/entries-delete`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getSegmentLearningNodes(
  segmentGroup: string,
  segmentCategory: string,
  segmentSpecialty: string,
): Promise<{ nodes: SegmentLearningNode[] }> {
  const params = new URLSearchParams({ segmentGroup, segmentCategory, segmentSpecialty });
  return api(`/api/segment-learnings/nodes?${params.toString()}`);
}

export interface OfferTypeLearning {
  type: string;
  baseInstruction: string;
  entries: SegmentLearningEntry[];
  hasOverride?: boolean;
}

export function getOfferTypeLearnings(): Promise<{ types: OfferTypeLearning[] }> {
  return api(`/api/offer-type-learnings`);
}

export function saveOfferTypeBaseInstruction(
  type: string,
  baseInstruction: string,
): Promise<{ type: string; baseInstruction: string }> {
  return api(`/api/offer-type-learnings`, {
    method: "POST",
    body: JSON.stringify({ type, baseInstruction }),
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
  groupId?: string | null;
  daysOfWeek?: string[];
  active?: boolean;
  photoReferenceIds?: string[];
  productTreatment?: "creative_redraw" | "exact_asset" | "";
  layoutStrength?: "strict" | "balanced" | "free" | "";
}

export function saveOffer(projectId: string, input: SaveOfferInput): Promise<{ project: ProjectSummary; offer: ProjectOffer }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offers`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function suggestOfferDirection(
  projectId: string,
  input: Pick<SaveOfferInput, "name" | "price" | "items" | "type" | "photoReferenceIds"> & { imageDataUrl?: string },
): Promise<{ notes: string; source?: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offers/suggest-direction`, {
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

export function saveOfferGroup(projectId: string, input: { id?: string; name: string }): Promise<{ project: ProjectSummary; group: OfferGroup }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offer-groups`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteOfferGroup(projectId: string, groupId: string): Promise<{ deleted: boolean; project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offer-groups-delete`, {
    method: "POST",
    body: JSON.stringify({ groupId }),
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
  scope?: "offer";
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
  communication: "Compradores e comunicação",
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

export const SEGMENT_TREE = [
  { group: "Alimentício", categories: ["Hamburgueria", "Pizzaria", "Espetaria", "Restaurante", "Açaí / sorveteria", "Padaria / confeitaria"] },
  { group: "Negócios locais e lojas", categories: ["Casa de embalagem", "Papelaria", "Aviamentos", "Loja de roupas", "Mercado / mercearia", "Material de construção"] },
  { group: "Engenharia", categories: ["Controle tecnológico / concreto / solos / asfalto", "Construção civil / obras", "Geotecnia e fundações", "Projetos e consultoria", "Topografia"] },
  { group: "Saúde e estética", categories: ["Clínica odontológica", "Estética facial/corporal", "Barbearia", "Salão de beleza", "Clínica médica"] },
  { group: "Educação", categories: ["Curso livre", "Escola profissionalizante", "Aulas particulares", "Treinamento corporativo"] },
  { group: "Serviços profissionais", categories: ["Contabilidade", "Advocacia", "Marketing / agência", "Imobiliária", "Consultoria"] },
];

export const OFFER_TYPE_LABELS: Record<string, string> = {
  offer: "Oferta direta",
  service: "Serviço",
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
