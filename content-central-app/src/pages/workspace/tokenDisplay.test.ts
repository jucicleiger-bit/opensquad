import { describe, expect, it } from "vitest";
import { tokenExpiryMeta } from "./tokenDisplay";

describe("tokenExpiryMeta", () => {
  it("reports no token configured when there's no token at all", () => {
    expect(tokenExpiryMeta(null)).toEqual({ label: "Sem token configurado", tone: "muted" });
    expect(tokenExpiryMeta({ configured: false } as never)).toEqual({
      label: "Sem token configurado",
      tone: "muted",
    });
  });

  it("reports a configured token with no known expiration as valid, not missing", () => {
    // Meta reports expires_at: 0 for permanent Page/System User tokens, which
    // the backend stores as expiresAt: null — that's still a real, working
    // token, so it must not read as "Sem token configurado".
    expect(
      tokenExpiryMeta({ configured: true, masked: "****abcd", expiresAt: null, daysRemaining: null } as never),
    ).toEqual({ label: "Token configurado (sem validade)", tone: "ok" });
  });

  it("reports an expired token", () => {
    const meta = tokenExpiryMeta({
      configured: true,
      masked: "****abcd",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    } as never);
    expect(meta).toEqual({ label: "Token expirado", tone: "bad" });
  });

  it("reports hours remaining for a token expiring within a day", () => {
    const meta = tokenExpiryMeta({
      configured: true,
      masked: "****abcd",
      expiresAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    } as never);
    expect(meta.tone).toBe("bad");
    expect(meta.label).toMatch(/Expira em \dh/);
  });

  it("reports days remaining with a warn tone when close to expiring", () => {
    const meta = tokenExpiryMeta({
      configured: true,
      masked: "****abcd",
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    } as never);
    expect(meta.tone).toBe("warn");
    expect(meta.label).toBe("Expira em 5 dias");
  });

  it("reports days remaining with an ok tone when far from expiring", () => {
    const meta = tokenExpiryMeta({
      configured: true,
      masked: "****abcd",
      expiresAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
    } as never);
    expect(meta.tone).toBe("ok");
    expect(meta.label).toBe("Expira em 40 dias");
  });
});
