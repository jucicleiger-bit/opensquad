import type { ContentItem } from "@/api/client";

export const CHANNEL_LABELS: Record<string, string> = {
  instagram_feed: "Feed",
  instagram_story: "Story",
  instagram_reels: "Reels",
  facebook_feed: "FB Feed",
  facebook_story: "FB Story",
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
export const VERTICAL_CREATIVE_CHANNELS = ["instagram_story", "instagram_reels", "facebook_story"];
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

export type ContentBucket = "aguardando" | "aprovado";

export function bucketForItem(item: ContentItem): ContentBucket {
  return item.status === "aprovado" ? "aprovado" : "aguardando";
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
}

export function statusMeta(item: ContentItem): StatusMeta {
  if (item.image?.generating) return { label: "Gerando imagem com IA...", dotClass: "dotAguardando" };
  if (item.publish?.realPublished) return { label: "Publicado", dotClass: "dotPublicado" };
  if (item.publish?.error) return { label: "Falha ao publicar", dotClass: "dotErro" };
  if (bucketForItem(item) === "aprovado") return { label: "Aprovado", dotClass: "dotAprovado" };
  return { label: "Aguardando aprovação", dotClass: "dotAguardando" };
}
