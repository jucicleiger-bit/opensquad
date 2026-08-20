import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { commercialAssetUrl, getCommercialAgency, getCommercialProposal, type CommercialAgency, type CommercialProposal } from "@/api/client";
import styles from "./ComercialPropostaImprimir.module.css";

export function ComercialPropostaImprimir() {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<CommercialProposal | null>(null);
  const [agency, setAgency] = useState<CommercialAgency | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  let totalMonthly = 0;
  let totalDiscount = 0;
  proposal.sections.forEach((section) => {
    section.items.forEach((item) => {
      if (item.billingType === "mensal") totalMonthly += item.price;
      else totalDiscount += Math.max(0, item.fullPrice - item.discountedPrice);
    });
  });

  return (
    <div className={styles.page}>
      <button type="button" className={styles.printButton} onClick={() => window.print()}>
        Imprimir / Salvar como PDF
      </button>

      <header className={styles.header}>
        <div className={styles.brand}>
          {agency.logoPath ? <img src={commercialAssetUrl(agency.logoPath)} alt={agency.name} className={styles.agencyLogo} /> : null}
          <span>{agency.name}</span>
        </div>
        <div className={styles.client}>
          {proposal.clientLogoDataUrl ? <img src={proposal.clientLogoDataUrl} alt={proposal.clientName} className={styles.clientLogo} /> : null}
          <span>{proposal.clientName}</span>
        </div>
      </header>

      <h1 className={styles.title}>Proposta comercial</h1>

      {proposal.sections.map((section) => (
        <section key={section.category} className={styles.section}>
          <h2 className={styles.sectionTitle}>{section.category}</h2>
          <div className={section.mode === "comparison" ? styles.comparisonGrid : styles.singleGrid}>
            {section.items.map((item, index) => (
              <article key={index} className={styles.plan}>
                <h3>{item.name}</h3>
                {item.description ? <p className={styles.description}>{item.description}</p> : null}
                {item.whatWeDeliver.length ? (
                  <ul className={styles.list}>
                    {item.whatWeDeliver.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                ) : null}
                {item.whatClientProvides.length ? (
                  <div className={styles.dependsOn}>
                    <b>Depende de você:</b>
                    <ul className={styles.list}>
                      {item.whatClientProvides.map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                  </div>
                ) : null}
                <p className={styles.price}>
                  {item.billingType === "mensal" ? (
                    `R$ ${item.price}/mês`
                  ) : item.discountedPrice < item.fullPrice ? (
                    <>De <s>R$ {item.fullPrice}</s> por <b>R$ {item.discountedPrice}</b></>
                  ) : (
                    `R$ ${item.fullPrice}`
                  )}
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}

      <footer className={styles.summary}>
        {totalMonthly > 0 ? <p>Total mensal: <b>R$ {totalMonthly}</b></p> : null}
        {totalDiscount > 0 ? <p className={styles.discount}>Desconto de adesão: <b>R$ {totalDiscount}</b></p> : null}
        <p className={styles.contact}>{agency.contactPhone} {agency.contactInstagram}</p>
      </footer>
    </div>
  );
}
