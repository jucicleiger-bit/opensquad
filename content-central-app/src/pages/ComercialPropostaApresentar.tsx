import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  commercialAssetUrl,
  getCommercialAgency,
  getCommercialProposal,
  listCommercialPortfolio,
  listCommercialProcesses,
  type CommercialAgency,
  type CommercialPortfolioItem,
  type CommercialProcess,
  type CommercialProposal,
} from "@/api/client";
import { PropostaPricingSection } from "./PropostaPricingSection";
import styles from "./ComercialPropostaImprimir.module.css";
import apresentarStyles from "./ComercialPropostaApresentar.module.css";

export function ComercialPropostaApresentar() {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<CommercialProposal | null>(null);
  const [agency, setAgency] = useState<CommercialAgency | null>(null);
  const [processes, setProcesses] = useState<CommercialProcess[]>([]);
  const [portfolio, setPortfolio] = useState<CommercialPortfolioItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (!id) return;
    Promise.all([getCommercialProposal(id), getCommercialAgency(), listCommercialProcesses(), listCommercialPortfolio()])
      .then(([proposalRes, agencyRes, processesRes, portfolioRes]) => {
        setProposal(proposalRes.proposal);
        setAgency(agencyRes.agency);
        setProcesses(processesRes.processes);
        setPortfolio(portfolioRes.items);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!proposal || !agency) return null;

  const categories = [...new Set(proposal.sections.map((section) => section.category))];

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

        <h1 className={styles.title}>Apresentação</h1>
        <p className={styles.subtitle}>Pra {proposal.clientName}</p>

        {agency.about ? (
          <section className={apresentarStyles.about}>
            <h2 className={styles.whyTitle}>Sobre a {agency.name}</h2>
            <p className={apresentarStyles.aboutText}>{agency.about}</p>
          </section>
        ) : null}

        {categories.map((category) => {
          const process = processes.find((entry) => entry.category === category);
          const images = portfolio.filter((item) => item.category === category);
          if (!process?.text && images.length === 0) return null;
          return (
            <section key={category} className={apresentarStyles.categorySection}>
              <h2 className={styles.whyTitle}>{category}</h2>
              {process?.text ? <p className={apresentarStyles.processText}>{process.text}</p> : null}
              {images.length ? (
                <div className={apresentarStyles.portfolioGrid}>
                  {images.map((image) => (
                    <figure key={image.id} className={apresentarStyles.portfolioItem}>
                      <img src={commercialAssetUrl(image.imagePath)} alt={image.caption || category} />
                      {image.caption ? <figcaption>{image.caption}</figcaption> : null}
                    </figure>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}

        <PropostaPricingSection proposal={proposal} agency={agency} />
      </div>
    </div>
  );
}
