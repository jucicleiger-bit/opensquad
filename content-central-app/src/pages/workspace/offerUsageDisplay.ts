import type { OfferUsageEntry } from "@/api/client";

const dayMonth = (date: Date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;

// The line under each offer: how often it went out, when it last did, and
// the date it is already scheduled for again.
export function offerUsageText(usage: OfferUsageEntry): string {
  const parts: string[] = [];
  if (usage.publishedCount > 0 && usage.lastPublishedAt) {
    parts.push(`Última publicação: ${dayMonth(new Date(usage.lastPublishedAt))} · ${usage.publishedCount} ${usage.publishedCount === 1 ? "vez" : "vezes"}`);
  }
  if (usage.nextScheduledDate) {
    const [, month, day] = usage.nextScheduledDate.split("-");
    parts.push(`Na fila para ${day}/${month}`);
  }
  return parts.length ? parts.join(" · ") : "Ainda não saiu";
}

const isoDayMonth = (date: string) => {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
};

// The validity tag on an offer ("" = always valid). today is YYYY-MM-DD.
export function offerValidityText(offer: { validFrom?: string; validUntil?: string }, today: string): string {
  if (offer.validUntil && offer.validUntil < today) return "Vencida";
  const parts: string[] = [];
  if (offer.validFrom && offer.validFrom > today) parts.push(`Começa ${isoDayMonth(offer.validFrom)}`);
  if (offer.validUntil) parts.push(`Vence ${isoDayMonth(offer.validUntil)}`);
  return parts.join(" · ");
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
