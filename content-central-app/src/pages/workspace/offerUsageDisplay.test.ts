import { describe, expect, it } from "vitest";
import { offerUsageText } from "./offerUsageDisplay";

describe("offerUsageText", () => {
  it("says an offer never went out", () => {
    expect(offerUsageText({ publishedCount: 0, lastPublishedAt: null, nextScheduledDate: null })).toBe("Ainda não saiu");
  });

  it("gives the last publication and how many times, and the next date in line", () => {
    expect(offerUsageText({ publishedCount: 3, lastPublishedAt: "2026-09-28T13:00:00.000Z", nextScheduledDate: "2026-10-08" })).toBe(
      "Última publicação: 28/09 · 3 vezes · Na fila para 08/10",
    );
    expect(offerUsageText({ publishedCount: 1, lastPublishedAt: "2026-09-28T13:00:00.000Z", nextScheduledDate: null })).toBe(
      "Última publicação: 28/09 · 1 vez",
    );
  });

  it("names the next date for an offer that is scheduled but never went out", () => {
    expect(offerUsageText({ publishedCount: 0, lastPublishedAt: null, nextScheduledDate: "2026-10-08" })).toBe("Na fila para 08/10");
  });
});
