import type { ProjectToken } from "@/api/client";

export interface TokenExpiryMeta {
  label: string;
  tone: "ok" | "warn" | "bad" | "muted";
}

// Reads the raw expiresAt directly instead of trusting the pre-rounded
// daysRemaining integer: Math.ceil() on a token expiring in a few hours
// still reports "1 dia restante", which reads as "a full day left" when
// it's actually almost expired. Computing from the real timestamp lets us
// say "expira hoje" / "expira em Nh" for the same-day case instead.
export function tokenExpiryMeta(token: ProjectToken | null | undefined): TokenExpiryMeta {
  if (!token?.configured) return { label: "Sem token configurado", tone: "muted" };
  // Meta reports no expiration for some tokens (permanent Page/System User
  // tokens) — that's a valid, configured token, not a missing one.
  if (!token.expiresAt) return { label: "Token configurado (sem validade)", tone: "ok" };

  const diffMs = new Date(token.expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return { label: "Token expirado", tone: "bad" };

  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 24) return { label: `Expira em ${Math.max(1, Math.round(diffHours))}h`, tone: "bad" };

  // Ceil (not floor) here, matching the backend's own daysRemaining
  // convention (calculateTokenDaysRemaining) — a partial day still counts
  // as a full day remaining, and floor would flakily undercount by one
  // the instant any time elapses between when expiresAt was set and now.
  const diffDays = Math.ceil(diffHours / 24);
  if (diffDays === 1) return { label: "Expira amanhã", tone: "warn" };
  if (diffDays <= 10) return { label: `Expira em ${diffDays} dias`, tone: "warn" };
  return { label: `Expira em ${diffDays} dias`, tone: "ok" };
}
