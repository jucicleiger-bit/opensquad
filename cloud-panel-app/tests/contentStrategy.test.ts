import { describe, it, expect } from "vitest";
import { upsertById, removeById } from "../src/lib/contentStrategy";

interface Item { id: string; name: string; extra?: string }

describe("upsertById", () => {
  it("appends a new item when its id isn't in the list", () => {
    const list: Item[] = [{ id: "a", name: "A" }];
    const result = upsertById(list, { id: "b", name: "B" });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ id: "b", name: "B" });
  });

  it("replaces the item in place (same position) when its id already exists", () => {
    const list: Item[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    const result = upsertById(list, { id: "a", name: "A updated" });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "a", name: "A updated" });
    expect(result[1]).toEqual({ id: "b", name: "B" });
  });

  it("does not mutate the input list", () => {
    const list: Item[] = [{ id: "a", name: "A" }];
    upsertById(list, { id: "a", name: "changed" });
    expect(list[0].name).toBe("A");
  });
});

describe("removeById", () => {
  it("removes the matching item", () => {
    const list: Item[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    const result = removeById(list, "a");
    expect(result).toEqual([{ id: "b", name: "B" }]);
  });

  it("returns an equivalent list when the id isn't found", () => {
    const list: Item[] = [{ id: "a", name: "A" }];
    const result = removeById(list, "nope");
    expect(result).toEqual(list);
  });
});
