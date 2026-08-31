import { describe, it, expect } from "vitest";
import { segmentNodePathsFromFields, segmentNodeLabelFromFields, segmentNodesForProject } from "../src/lib/segmentLearning";

describe("segmentNodePathsFromFields", () => {
  it("builds one tagged path per populated level, group first", () => {
    expect(segmentNodePathsFromFields("Alimentício", "Pizzaria", "Delivery")).toEqual([
      "group:alimenticio",
      "group:alimenticio/category:pizzaria",
      "group:alimenticio/category:pizzaria/specialty:delivery",
    ]);
  });

  it("skips an empty group but still returns paths for the populated fields (positional quirk, matches local)", () => {
    expect(segmentNodePathsFromFields("", "Pizzaria", "Delivery")).toEqual([
      "category:pizzaria",
      "category:pizzaria/specialty:delivery",
    ]);
  });

  it("returns an empty array when nothing is populated", () => {
    expect(segmentNodePathsFromFields("", "", "")).toEqual([]);
  });
});

describe("segmentNodeLabelFromFields", () => {
  it("returns just the group for level=setor", () => {
    expect(segmentNodeLabelFromFields("Alimentício", "Pizzaria", "", "setor")).toBe("Alimentício");
  });

  it("returns group/category for level=nicho", () => {
    expect(segmentNodeLabelFromFields("Alimentício", "Pizzaria", "", "nicho")).toBe("Alimentício / Pizzaria");
  });

  it("returns the empty group when group is unset, even at level=setor (positional quirk, matches local)", () => {
    expect(segmentNodeLabelFromFields("", "Pizzaria", "Delivery", "setor")).toBe("");
  });
});

describe("segmentNodesForProject", () => {
  it("zips paths with levels positionally, reproducing local's quirk for a missing group", () => {
    const nodes = segmentNodesForProject("", "Pizzaria", "Delivery");
    expect(nodes).toEqual([
      { path: "category:pizzaria", label: "", level: "setor" },
      { path: "category:pizzaria/specialty:delivery", label: "Pizzaria", level: "nicho" },
    ]);
  });

  it("labels correctly when all 3 fields are populated", () => {
    const nodes = segmentNodesForProject("Alimentício", "Pizzaria", "Delivery");
    expect(nodes.map((n) => n.label)).toEqual(["Alimentício", "Alimentício / Pizzaria", "Alimentício / Pizzaria / Delivery"]);
  });
});
