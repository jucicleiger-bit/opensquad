import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { commercialAssetUrl, getCommercialAgency, getCommercialProposal, type CommercialAgency, type CommercialProposal } from "@/api/client";
import { PropostaPricingSection } from "./PropostaPricingSection";
import styles from "./ComercialPropostaImprimir.module.css";

// The subtitle reads as a promise ("presença digital") rather than a raw
// category name ("Criação de Conteúdo") for the two categories this system
// ships with today — any other category name falls back to itself, so a
// custom category never renders blank or broken.
function categoryBenefit(category: string) {
  const key = category.toLowerCase();
  if (key.includes("conteúdo") || key.includes("conteudo")) return "Presença digital constante";
  if (key.includes("tráfego") || key.includes("trafego") || key.includes("anúncio") || key.includes("anuncio")) return "crescimento real no Instagram";
  return category;
}

export function ComercialPropostaImprimir() {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<CommercialProposal | null>(null);
  const [agency, setAgency] = useState<CommercialAgency | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (!id) return;
    Promise.all([getCommercialProposal(id), getCommercialAgency()])
      .then(([proposalRes, agencyRes]) => {
        setProposal(proposalRes.proposal);
        setAgency(agencyRes.agency);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!proposal || !agency) return null;

  const subtitle = [...new Set(proposal.sections.map((section) => categoryBenefit(section.category)))].join(" + ");

  return (
    <div className={styles.page} data-theme={theme}>
      <div className={styles.controls}>
        <div className={styles.themeSwitch}>
          <button type="button" className={theme === "light" ? styles.themeActive : styles.themeOption} onClick={() => setTheme("light")}>
            Claro
          </button>
          <button type="button" className={theme === "dark" ? styles.themeActive : styles.themeOption} onClick={() => setTheme("dark")}>
            Escuro
          </button>
        </div>
        <button
          type="button"
          className={styles.printButton}
          onClick={() => {
            // Playfair Display loads async (via @import) — printing before it
            // swaps in captures the fallback font on whatever text happened
            // to lay out first. document.fonts.ready resolves once every
            // requested face has finished loading, so the print always fires
            // after the swap instead of racing it. Falls back to an
            // immediate print where the Font Loading API isn't available
            // (older browsers, and jsdom in tests).
            if (document.fonts?.ready) {
              document.fonts.ready.then(() => window.print()).catch(() => window.print());
            } else {
              window.print();
            }
          }}
        >
          Imprimir / Salvar como PDF
        </button>
        {theme === "dark" ? (
          <p className={styles.themeHint}>
            No tela de impressão, ative "Gráficos de segundo plano" pra o fundo preto sair no PDF.
          </p>
        ) : null}
      </div>

      <div className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.brand}>
            {agency.logoPath ? <img src={commercialAssetUrl(agency.logoPath)} alt={agency.name} className={styles.agencyLogo} /> : null}
            <span className={styles.brandName}>{agency.name}</span>
          </div>
          <div className={styles.client}>
            <span className={styles.clientLabel}>Cliente</span>
            <div className={styles.clientRow}>
              {proposal.clientLogoDataUrl ? <img src={proposal.clientLogoDataUrl} alt={proposal.clientName} className={styles.clientLogo} /> : null}
              <span className={styles.clientName}>{proposal.clientName}</span>
            </div>
          </div>
        </header>

        <h1 className={styles.title}>Proposta Comercial</h1>
        <p className={styles.subtitle}>{subtitle}</p>
        <p className={styles.intro}>
          Uma proposta pensada pra manter a {proposal.clientName} ativa e em crescimento nas redes sociais — sem
          complicação e sem letra miúda.
        </p>

        <PropostaPricingSection proposal={proposal} agency={agency} />
      </div>
    </div>
  );
}
