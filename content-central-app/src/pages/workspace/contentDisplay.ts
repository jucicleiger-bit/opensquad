import type { ContentItem } from "@/api/client";

export const CHANNEL_LABELS: Record<string, string> = {
  instagram_feed: "Feed",
  instagram_story: "Story",
  instagram_reels: "Reels",
  facebook_feed: "FB Feed",
  facebook_story: "FB Story",
  whatsapp_status: "Status (beta)",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] || channel;
}

export const CHANNEL_FULL_LABELS: Record<string, string> = {
  instagram_story: "Instagram Stories",
  instagram_feed: "Instagram Feed",
  instagram_reels: "Instagram Reels",
  facebook_feed: "Facebook Feed",
  facebook_story: "Facebook Story",
  whatsapp_status: "WhatsApp Status (beta)",
};

export function channelFullLabel(channel: string): string {
  return CHANNEL_FULL_LABELS[channel] || channel;
}

// Feed-style channels get the 4:5 preview frame; everything else (Story,
// Reels) gets the 9:16 vertical one.
export function isFeedChannel(channel: string): boolean {
  return channel === "instagram_feed" || channel === "facebook_feed";
}

// Mirrors creativeShapeGroupForChannel() in content-central.js — channels
// that share a pixel shape end up sharing one AI-generated creative, so the
// generation screen offers a one-click way to select a whole group at once.
export const VERTICAL_CREATIVE_CHANNELS = ["instagram_story", "instagram_reels", "facebook_story", "whatsapp_status"];
export const FEED_CREATIVE_CHANNELS = ["instagram_feed", "facebook_feed"];

// Mirrors imageSource() in content-central-server.js's renderApp(): a real
// generated image (AI or local compose) prefers the hosted preview/public
// URL, undecided drafts prefer the inline placeholder data URL — checking
// generatedSource truthiness (not a specific provider string) so every
// current and future image source works the same way, so the same
// source-of-truth logic must stay in sync in both places.
export function imageSource(item: ContentItem): string | undefined {
  if (item.image?.generatedSource) {
    return item.image?.previewUrl || item.image?.url || item.image?.previewDataUrl;
  }
  return item.image?.previewDataUrl || item.image?.previewUrl || item.image?.url;
}

export type ContentBucket = "aguardando" | "aprovado" | "teste";

// A "Teste rápido" simulation is local/dry-run only — it never enters the
// real approval/publish pipeline, so it must not count as content awaiting
// approval on the Aguardando aprovação list or the dashboard's counts.
export function bucketForItem(item: ContentItem): ContentBucket {
  if (item.status === "aprovado") return "aprovado";
  if (item.status === "test_post_simulated") return "teste";
  return "aguardando";
}

export interface ContentGroup {
  leader: ContentItem;
  members: ContentItem[];
}

function groupSortKey(item: ContentItem): string {
  return `${item.scheduledDate}${item.scheduledTime || ""}`;
}

// Items that share a creativeGroupKey (same day, same pixel shape, same
// slot — see enrichBatchItemsWithRealImages in content-central.js) were
// generated as one shared creative: same image, same caption. Mirrors
// groupBriefingItems() in content-central-server.js so the approval screen
// and the client-facing briefing group cards the same way.
export function groupSameCreativeItems(items: ContentItem[]): ContentGroup[] {
  const byKey = new Map<string, ContentItem[]>();
  items.forEach((item, index) => {
    const key = item.creativeGroupKey || `__solo__${index}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else byKey.set(key, [item]);
  });
  const groups = [...byKey.values()].map((members) => {
    const sorted = [...members].sort((a, b) => groupSortKey(a).localeCompare(groupSortKey(b)));
    return { leader: sorted[0], members: sorted };
  });
  groups.sort((a, b) => groupSortKey(a.leader).localeCompare(groupSortKey(b.leader)));
  return groups;
}

export interface StatusMeta {
  label: string;
  dotClass: "dotAguardando" | "dotAprovado" | "dotPublicado" | "dotErro";
  chipClass?: "chipPublicado";
}

export function statusMeta(item: ContentItem): StatusMeta {
  if (item.image?.generating) return { label: "Gerando imagem com IA...", dotClass: "dotAguardando" };
  if (item.publish?.realPublished) return { label: "Publicado", dotClass: "dotPublicado", chipClass: "chipPublicado" };
  if (item.publish?.error) return { label: "Falha ao publicar", dotClass: "dotErro" };
  if (bucketForItem(item) === "aprovado") return { label: "Aprovado", dotClass: "dotAprovado" };
  return { label: "Aguardando aprovação", dotClass: "dotAguardando" };
}

export type ContentPipelineTone = "done" | "active" | "waiting" | "blocked";

export interface ContentPipelineStep {
  id: "copy" | "direct_response" | "creative_direction" | "image" | "review";
  agent: string;
  label: string;
  detail: string;
  tone: ContentPipelineTone;
}

function captionTone(item: ContentItem): ContentPipelineTone {
  if (item.captionGenerationError) return "blocked";
  if (item.caption?.text?.trim()) return "done";
  return "waiting";
}

function imageTone(item: ContentItem): ContentPipelineTone {
  if (item.imageGenerationError) return "blocked";
  if (item.image?.generating) return "active";
  if (imageSource(item)) return "done";
  return "waiting";
}

function reviewTone(item: ContentItem): ContentPipelineTone {
  const review = item.creativeReview;
  if (review?.status === "blocked" || review?.errors?.length) return "blocked";
  if (review?.status === "ok") return "done";
  if (review?.status || review?.warnings?.length) return "active";
  return "waiting";
}

// Visible, read-only snapshot of the real generation path in src/content-central-server.js:
// Sofia drafts the social copy, Dante optimizes it for direct response, Clara
// turns the approved brief into the visual direction/prompt, the image provider
// renders it, and Renata blocks/approves the creative review before the operator
// publishes. The data is derived from the persisted ContentItem; no new backend
// state is invented just to draw this UI.
export function contentPipelineSteps(item: ContentItem): ContentPipelineStep[] {
  const hasCaption = Boolean(item.caption?.text?.trim());
  const hasPrompt = Boolean(item.image?.prompt?.trim());
  const hasImage = Boolean(imageSource(item));
  const review = item.creativeReview;

  return [
    {
      id: "copy",
      agent: "Sofia",
      label: "Copy",
      detail: item.captionGenerationError ? "Erro ao criar legenda" : hasCaption ? "Legenda criada" : "Aguardando legenda",
      tone: captionTone(item),
    },
    {
      id: "direct_response",
      agent: "Dante",
      label: "Direct response",
      detail: item.captionGenerationError ? "Otimização não concluída" : hasCaption ? "Gancho e CTA revisados" : "Aguardando copy",
      tone: captionTone(item),
    },
    {
      id: "creative_direction",
      agent: "Clara",
      label: "Direção criativa",
      detail: hasPrompt ? "Prompt visual pronto" : item.imageGenerationError ? "Briefing visual travou" : item.image?.generating ? "Direção em uso" : "Aguardando briefing visual",
      tone: hasPrompt ? "done" : item.imageGenerationError ? "blocked" : item.image?.generating ? "active" : "waiting",
    },
    {
      id: "image",
      agent: "Imagem",
      label: "Arte final",
      detail: item.imageGenerationError ? "Imagem falhou" : item.image?.generating ? "Gerando imagem" : hasImage ? "Imagem pronta" : "Sem imagem ainda",
      tone: imageTone(item),
    },
    {
      id: "review",
      agent: "Renata",
      label: "Revisão",
      detail: review?.summary || (review?.status === "ok" ? "Criativo aprovado" : review?.status === "blocked" ? "Criativo bloqueado" : hasImage ? "Aguardando revisão" : "Aguardando imagem"),
      tone: reviewTone(item),
    },
  ];
}
