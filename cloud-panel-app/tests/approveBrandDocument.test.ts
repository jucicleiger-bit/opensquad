import { describe, it, expect } from "vitest";
import { approveBrandDocument } from "../src/lib/approveBrandDocument";

describe("approveBrandDocument", () => {
  it("approves every block and the top-level status", () => {
    const doc = {
      status: "generated",
      source: "ai_analysis",
      blocks: {
        summary: { id: "summary", label: "Resumo", text: "x", status: "generated", approvedAt: null },
        audience: { id: "audience", label: "Público", text: "y", status: "draft", approvedAt: null },
      },
      generatedAt: "2026-08-01T00:00:00.000Z",
      approvedAt: null,
    };
    const result = approveBrandDocument(doc);
    expect(result.status).toBe("approved");
    expect(result.approvedAt).not.toBeNull();
    expect(result.blocks.summary.status).toBe("approved");
    expect(result.blocks.audience.status).toBe("approved");
    expect(result.blocks.summary.approvedAt).not.toBeNull();
    expect(result.blocks.audience.approvedAt).not.toBeNull();
  });

  it("preserves block text and label, only changes status/approvedAt", () => {
    const doc = {
      status: "generated",
      source: "",
      blocks: { summary: { id: "summary", label: "Resumo", text: "conteúdo original", status: "generated", approvedAt: null } },
      generatedAt: null,
      approvedAt: null,
    };
    const result = approveBrandDocument(doc);
    expect(result.blocks.summary.text).toBe("conteúdo original");
    expect(result.blocks.summary.label).toBe("Resumo");
  });

  it("handles a document with no blocks yet", () => {
    const doc = { status: "empty", source: "", blocks: {}, generatedAt: null, approvedAt: null };
    const result = approveBrandDocument(doc);
    expect(result.status).toBe("approved");
    expect(result.blocks).toEqual({});
  });

  it("does not mutate the input object", () => {
    const doc = {
      status: "generated",
      source: "",
      blocks: { summary: { id: "summary", label: "Resumo", text: "x", status: "generated", approvedAt: null } },
      generatedAt: null,
      approvedAt: null,
    };
    approveBrandDocument(doc);
    expect(doc.status).toBe("generated");
    expect(doc.blocks.summary.status).toBe("generated");
  });
});
