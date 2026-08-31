export interface BrandBlock {
  id: string;
  label: string;
  text: string;
  status: "draft" | "generated" | "approved";
  approvedAt: string | null;
}

export interface BrandDocument {
  status: "empty" | "generated" | "approved" | "needs_review";
  source: string;
  blocks: Record<string, BrandBlock>;
  generatedAt: string | null;
  approvedAt: string | null;
}

// Mirrors the real local behavior (approveProjectBrandXray/
// approveProjectBrandBriefing in src/content-central.js): approval is one
// action for the whole document — every block is approved at once, never
// block-by-block.
export function approveBrandDocument<T extends BrandDocument>(doc: T): T {
  const now = new Date().toISOString();
  const blocks: Record<string, BrandBlock> = {};
  for (const [id, block] of Object.entries(doc.blocks)) {
    blocks[id] = { ...block, status: "approved", approvedAt: now };
  }
  return { ...doc, status: "approved", approvedAt: now, blocks };
}
