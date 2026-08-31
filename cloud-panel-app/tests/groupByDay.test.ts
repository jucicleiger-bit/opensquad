// tests/groupByDay.test.ts
import { describe, it, expect } from "vitest";
import { groupByDay } from "../src/lib/groupByDay";

interface Item {
  id: string;
  date: string | null;
}

describe("groupByDay", () => {
  it("groups items by day, sorted ascending", () => {
    const items: Item[] = [
      { id: "b", date: "2026-09-02" },
      { id: "a", date: "2026-09-01" },
      { id: "c", date: "2026-09-01" },
    ];
    const result = groupByDay(items, (i) => i.date);
    expect(result.map((g) => g.day)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(result[0].items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("groups items with no date under 'Sem data', placed last", () => {
    const items: Item[] = [
      { id: "a", date: null },
      { id: "b", date: "2026-09-01" },
    ];
    const result = groupByDay(items, (i) => i.date);
    expect(result.map((g) => g.day)).toEqual(["2026-09-01", "Sem data"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupByDay<Item>([], (i) => i.date)).toEqual([]);
  });
});
