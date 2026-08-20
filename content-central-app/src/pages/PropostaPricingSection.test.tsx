import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PropostaPricingSection } from "./PropostaPricingSection";
import type { CommercialAgency, CommercialProposal } from "@/api/client";

const AGENCY: CommercialAgency = { name: "King", logoPath: "", contactPhone: "", contactInstagram: "", about: "", updatedAt: null };
const PROPOSAL: CommercialProposal = {
  id: "prop-1",
  clientName: "Arthur Frios",
  clientLogoDataUrl: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  sections: [{ category: "Tráfego Pago", mode: "single", items: [{ catalogItemId: "basico", name: "Básico", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "mensal", price: 500, fullPrice: 0, discountedPrice: 0 }] }],
};

describe("PropostaPricingSection showWhy", () => {
  it("shows 'Por que a King' by default", () => {
    render(<PropostaPricingSection proposal={PROPOSAL} agency={AGENCY} />);
    expect(screen.getByRole("heading", { name: /Por que a King/ })).toBeInTheDocument();
  });

  it("hides 'Por que a King' when showWhy is false", () => {
    render(<PropostaPricingSection proposal={PROPOSAL} agency={AGENCY} showWhy={false} />);
    expect(screen.queryByRole("heading", { name: /Por que a King/ })).not.toBeInTheDocument();
    expect(screen.getByText("Investimento mensal")).toBeInTheDocument();
  });

  it("does not show the media-budget note on a one-time item outside Tráfego Pago — that copy only applies to ad spend", () => {
    const proposalWithSetupFee: CommercialProposal = {
      ...PROPOSAL,
      sections: [
        { category: "Criação de Conteúdo", mode: "single", items: [{ catalogItemId: "setup", name: "Configuração inicial", description: "", whatWeDeliver: [], whatClientProvides: [], billingType: "unica", price: 0, fullPrice: 250, discountedPrice: 250 }] },
      ],
    };
    render(<PropostaPricingSection proposal={proposalWithSetupFee} agency={AGENCY} />);
    expect(screen.queryByText("Investimento em mídia não incluso")).not.toBeInTheDocument();
  });
});
