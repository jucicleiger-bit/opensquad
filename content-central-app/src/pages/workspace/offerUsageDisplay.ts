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
