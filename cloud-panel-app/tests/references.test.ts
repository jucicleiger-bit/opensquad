import { describe, it, expect } from "vitest";
import { roleForCategory, automaticRuleForCategory, buildReferenceStoragePath } from "../src/lib/references";

describe("roleForCategory", () => {
  it("maps official_asset to brand_asset", () => {
    expect(roleForCategory("official_asset")).toBe("brand_asset");
  });
  it("maps real_product to product_photo", () => {
    expect(roleForCategory("real_product")).toBe("product_photo");
  });
  it("maps visual_inspiration and anything unknown to visual_reference", () => {
    expect(roleForCategory("visual_inspiration")).toBe("visual_reference");
    expect(roleForCategory("bogus")).toBe("visual_reference");
  });
});

describe("automaticRuleForCategory", () => {
  it("returns the official_asset rule text", () => {
    expect(automaticRuleForCategory("official_asset")).toMatch(/Preservar exatamente o ativo enviado/);
  });
  it("returns the real_product rule text", () => {
    expect(automaticRuleForCategory("real_product")).toMatch(/Preservar a aparência real/);
  });
  it("returns the visual_inspiration rule text for that category and as the default", () => {
    expect(automaticRuleForCategory("visual_inspiration")).toMatch(/Utilizar apenas como inspiração visual/);
    expect(automaticRuleForCategory("bogus")).toMatch(/Utilizar apenas como inspiração visual/);
  });
});

describe("buildReferenceStoragePath", () => {
  it("builds slug/references/id-filename", () => {
    expect(buildReferenceStoragePath("acme-pizza", "abc123", "logo.png")).toBe("acme-pizza/references/abc123-logo.png");
  });
});
