import type { ReactNode, SVGProps } from "react";
import type { CommercialAgency, CommercialProposal } from "@/api/client";
import styles from "./ComercialPropostaImprimir.module.css";

// Simple geometric line icons, authored once and reused everywhere an icon
// is needed — matches the King mark's own black-circle/gold-glyph treatment
// instead of standing in with emoji or a mismatched icon font.
export function IconContent(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
      <circle cx="9" cy="10.5" r="1.6" />
      <path d="M4 16l4.5-4 3 2.7L16 10l4 5.5" />
    </svg>
  );
}

export function IconTarget(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconCamera(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2l1.2-1.8h6.6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v8A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5z" />
      <circle cx="12" cy="12.2" r="3.4" />
    </svg>
  );
}

function IconCoins(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <ellipse cx="9.5" cy="8" rx="5.5" ry="3" />
      <path d="M4 8v4c0 1.7 2.5 3 5.5 3S15 13.7 15 12V8" />
      <ellipse cx="14.5" cy="14" rx="5.5" ry="3" />
      <path d="M9 14v3c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-3" />
    </svg>
  );
}

export function IconCheck(props: SVGProps<SVGSVGElement>) {
  // The circle takes its fill from currentColor (the gold badge, in both
  // themes) — the checkmark stroke stays a fixed dark ink instead of white
  // so it keeps reading against a bright gold fill either way.
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="#161616" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function categoryIcon(category: string) {
  const key = category.toLowerCase();
  if (key.includes("tráfego") || key.includes("trafego") || key.includes("anúncio") || key.includes("anuncio")) return IconTarget;
  return IconContent;
}

export function IconBadge({ icon: Icon, size = 52 }: { icon: (props: SVGProps<SVGSVGElement>) => ReactNode; size?: number }) {
  return (
    <span className={styles.iconBadge} style={{ width: size, height: size }}>
      <Icon width={size * 0.46} height={size * 0.46} />
    </span>
  );
}

export function PropostaPricingSection({ proposal, agency, showWhy = true }: { proposal: CommercialProposal; agency: CommercialAgency; showWhy?: boolean }) {
  let totalMonthly = 0;
  let totalDiscount = 0;
  let hasOneTime = false;
  // A "comparison" section shows alternative plans for the client to pick
  // one of — it has no committed price yet, so it never enters the total.
  // Only "single" sections (an already-decided item) count toward what the
  // client is actually paying.
  proposal.sections
    .filter((section) => section.mode === "single")
    .forEach((section) => {
      section.items.forEach((item) => {
        if (item.billingType === "mensal") totalMonthly += item.price;
        else {
          hasOneTime = true;
          totalDiscount += Math.max(0, item.fullPrice - item.discountedPrice);
        }
      });
    });

  // Nothing is committed yet when every section is still "comparison" — no
  // real total exists to show. A blank gold box reads as broken rather than
  // "not decided yet", so fall back to the range of what's on the table.
  const comparisonMonthlyPrices = proposal.sections
    .filter((section) => section.mode === "comparison")
    .flatMap((section) => section.items.filter((item) => item.billingType === "mensal").map((item) => item.price));
  const comparisonFrom = comparisonMonthlyPrices.length ? Math.min(...comparisonMonthlyPrices) : null;

  const validUntil = new Date(new Date(proposal.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  const cards = proposal.sections.flatMap((section) =>
    section.items.map((item, index) => ({ item, category: section.category, key: `${section.category}-${index}` })),
  );

  return (
    <>
      <div className={styles.sectionLabel}>
        <span />
        <b>Solução proposta</b>
        <span />
      </div>

      <div className={styles.grid}>
        {cards.map(({ item, category, key }) => {
          const Icon = categoryIcon(category);
          return (
            <article key={key} className={styles.plan}>
              <div className={styles.planBody}>
                <IconBadge icon={Icon} />
                <p className={styles.planCategory}>{category}</p>
                <h3 className={styles.planName}>{item.name}</h3>
                {item.description ? <p className={styles.description}>{item.description}</p> : null}
                {item.whatWeDeliver.length ? (
                  <ul className={styles.list}>
                    {item.whatWeDeliver.map((line, i) => (
                      <li key={i}>
                        <IconCheck className={styles.checkMark} />
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.whatClientProvides.length ? (
                  <div className={styles.dependsOn}>
                    <IconCamera className={styles.dependsOnIcon} />
                    <div>
                      <b>Para a produção</b>
                      <ul className={styles.dependsOnList}>
                        {item.whatClientProvides.map((line, i) => <li key={i}>{line}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : null}
                {item.billingType === "unica" && category === "Tráfego Pago" ? (
                  <div className={styles.dependsOn}>
                    <IconCoins className={styles.dependsOnIcon} />
                    <div>
                      <b>Investimento em mídia não incluso</b>
                      <p className={styles.dependsOnNote}>A verba dos anúncios é paga diretamente à Meta.</p>
                    </div>
                  </div>
                ) : null}
              </div>
              <p className={styles.price}>
                {item.billingType === "mensal" ? (
                  <>R$ {item.price}<span className={styles.priceUnit}>/mês</span></>
                ) : item.discountedPrice < item.fullPrice ? (
                  <>De <s>R$ {item.fullPrice}</s> por R$ {item.discountedPrice}</>
                ) : (
                  `R$ ${item.fullPrice}`
                )}
              </p>
            </article>
          );
        })}
      </div>

      {showWhy ? (
        <section className={styles.why}>
          <h2 className={styles.whyTitle}>Por que a {agency.name}</h2>
          <ul className={styles.whyList}>
            <li><IconCheck className={styles.checkMark} />Conteúdo novo todo santo dia, sem você precisar lembrar de postar</li>
            <li><IconCheck className={styles.checkMark} />Conteúdo pensado para o seu negócio, criado de acordo com os produtos, ofertas e necessidades da {proposal.clientName}</li>
            <li><IconCheck className={styles.checkMark} />Você acompanha tudo, sem depender de reunião pra saber o que tá rolando</li>
          </ul>
        </section>
      ) : null}

      <div className={styles.investment}>
        <span className={styles.investmentLabel}>Investimento mensal</span>
        {totalMonthly > 0 ? (
          <p className={styles.investmentTotal}>R$ {totalMonthly}<span className={styles.priceUnit}>/mês</span></p>
        ) : comparisonFrom !== null ? (
          <p className={styles.investmentTotal}>A partir de R$ {comparisonFrom}<span className={styles.priceUnit}>/mês</span></p>
        ) : null}
        {hasOneTime ? <p className={styles.discount}>Investimento em mídia paga: não incluso nesta taxa</p> : null}
        {totalDiscount > 0 ? <p className={styles.discount}>Desconto de adesão: <b>R$ {totalDiscount}</b></p> : null}
      </div>

      <div className={styles.steps}>
        <span>1. Aprovação da proposta</span>
        <span className={styles.stepArrow}>→</span>
        <span>2. Envio dos acessos e materiais</span>
        <span className={styles.stepArrow}>→</span>
        <span>3. Início da produção</span>
      </div>

      <footer className={styles.summary}>
        <p className={styles.cta}>Vamos colocar a {proposal.clientName} em movimento?</p>
        <p className={styles.contact}>{agency.contactPhone} · {agency.contactInstagram}</p>
      </footer>

      <div className={styles.terms}>
        <span>Investimento: R$ {totalMonthly}/mês</span>
        <span>Pagamento: mensal</span>
        <span>Validade da proposta: {validUntil.toLocaleDateString("pt-BR")}</span>
        <span>Início: após aprovação e recebimento dos acessos</span>
      </div>

      <div className={styles.pageFooter}>
        <span>Proposta Comercial · {agency.name}</span>
      </div>
    </>
  );
}
