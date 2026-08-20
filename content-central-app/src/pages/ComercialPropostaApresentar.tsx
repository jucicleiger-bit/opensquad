import { Fragment, useEffect, useState, type SVGProps } from "react";
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

const FIXED_CATEGORIES = new Set(["Criação de Conteúdo", "Tráfego Pago"]);

const DEFAULT_ABOUT = "A King Assessoria de Mkt ajuda negócios locais a manterem suas redes ativas, organizadas e profissionais. Criamos, publicamos e gerenciamos campanhas para que a presença digital aconteça sem depender da correria da equipe interna.";

const CONTENT_FLOW = [
  { number: "01", title: "Entendemos", text: "Produtos, serviços, público, promoções e necessidades." },
  { number: "02", title: "Planejamos", text: "Definimos o que comunicar e organizamos os conteúdos." },
  { number: "03", title: "Criamos", text: "Produzimos artes e materiais alinhados à identidade da empresa." },
  { number: "04", title: "Publicamos", text: "Organizamos e programamos as publicações." },
];

const TRAFFIC_STEPS = [
  { number: "01", title: "Definimos o objetivo", text: "Seguidores, alcance, mensagens, produtos ou campanhas." },
  { number: "02", title: "Definimos o público", text: "Região, perfil de cliente e segmentação." },
  { number: "03", title: "Criamos a campanha", text: "Configuração, criativos e estrutura de anúncios." },
  { number: "04", title: "Acompanhamos", text: "Monitoramento dos resultados e ajustes quando necessário." },
];

const WHY_CARDS = [
  { title: "Conteúdo pensado para o negócio", text: "Produtos, ofertas, campanhas e necessidades orientam o que será criado." },
  { title: "Presença constante", text: "Sua empresa continua ativa nas redes sem depender da correria da equipe." },
  { title: "Mais comodidade", text: "Criação, organização e publicação ficam sob nossa operação." },
  { title: "Conteúdo e tráfego integrados", text: "Presença orgânica e mídia paga trabalhando dentro da mesma estratégia." },
];

function IconCrown(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 70" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" {...props}>
      <path d="M6 60 L14 16 L34 38 L50 8 L66 38 L86 16 L94 60 Z" />
      <path d="M6 60 H94" />
    </svg>
  );
}

function IconChat(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 5.5h16v10H9.5L5 19.5V15.5H4z" />
    </svg>
  );
}

function IconPhone(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" {...props}>
      <path d="M5 19V10M12 19V5M19 19v-6" />
    </svg>
  );
}

function PageHeader({ agency, proposal }: { agency: CommercialAgency; proposal: CommercialProposal }) {
  return (
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
  );
}

function PortfolioGallery({ images, category }: { images: CommercialPortfolioItem[]; category: string }) {
  if (!images.length) return null;
  return (
    <>
      <p className={apresentarStyles.kicker}>Exemplos de conteúdo</p>
      <div className={apresentarStyles.portfolioGrid}>
        {images.map((image) => (
          <figure key={image.id} className={apresentarStyles.portfolioItem}>
            <img src={commercialAssetUrl(image.imagePath)} alt={image.caption || category} />
            {image.caption ? <figcaption>{image.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
    </>
  );
}

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
  const proposalHasTraffic = categories.includes("Tráfego Pago");
  const fallbackCategories = categories.filter((category) => !FIXED_CATEGORIES.has(category));
  const contentImages = portfolio.filter((item) => item.category === "Criação de Conteúdo");

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
        {/* 1. Capa */}
        <section className={`${apresentarStyles.printSection} ${apresentarStyles.cover}`}>
          <div className={apresentarStyles.coverDepthA} />
          <div className={apresentarStyles.coverDepthB} />
          <div className={apresentarStyles.coverArc} />
          <div className={apresentarStyles.coverCorner} />
          <IconCrown className={apresentarStyles.coverCrown} />
          <div className={apresentarStyles.coverBrand}>
            {agency.logoPath ? <img src={commercialAssetUrl(agency.logoPath)} alt={agency.name} className={apresentarStyles.coverLogo} /> : null}
            <div className={apresentarStyles.coverBrandNames}>
              <span className={apresentarStyles.coverBrandName}>{agency.name.split(" ")[0]}</span>
              <span className={apresentarStyles.coverBrandSuffix}>{agency.name.split(" ").slice(1).join(" ")}</span>
            </div>
          </div>
          <div className={apresentarStyles.coverIconRow}>
            <span className={apresentarStyles.coverIconCircle}><IconChat width={15} height={15} /></span>
            <span className={apresentarStyles.coverIconDivider} />
            <span className={apresentarStyles.coverIconCircle}><IconPhone width={15} height={15} /></span>
            <span className={apresentarStyles.coverIconDivider} />
            <span className={apresentarStyles.coverIconCircle}><IconChart width={15} height={15} /></span>
          </div>
          <p className={apresentarStyles.coverServices}>Conteúdo <span>•</span> Redes Sociais <span>•</span> Tráfego Pago</p>
          <h1 className={apresentarStyles.coverHeadline}>
            Marketing sem<br />complicação para<br /><span className={apresentarStyles.coverHeadlineAccent}>negócios locais</span>
          </h1>
          <hr className={apresentarStyles.coverRule} />
          <p className={apresentarStyles.coverIntro}>
            Criação, publicação e mídia paga em uma operação simples para manter sua empresa <span className={apresentarStyles.coverIntroAccent}>presente sem</span> transformar marketing em mais uma <span className={apresentarStyles.coverIntroAccent}>tarefa</span> da rotina.
          </p>
          <div className={apresentarStyles.coverPrepared}>
            <p className={apresentarStyles.coverPreparedLabel}>Apresentação preparada para</p>
            <div className={apresentarStyles.coverClientRow}>
              {proposal.clientLogoDataUrl ? (
                <span className={apresentarStyles.coverClientLogoBox}>
                  <img src={proposal.clientLogoDataUrl} alt={proposal.clientName} />
                </span>
              ) : null}
              <span className={apresentarStyles.coverClientName}>{proposal.clientName}</span>
            </div>
          </div>
        </section>

        {/* 2. Quem somos */}
        <section className={apresentarStyles.printSection}>
          <PageHeader agency={agency} proposal={proposal} />
          <h2 className={apresentarStyles.pageTitle}>A gente cuida da presença digital. Você cuida do seu negócio.</h2>
          <p className={apresentarStyles.pageIntro}>{agency.about || DEFAULT_ABOUT}</p>
          <div className={apresentarStyles.cardGrid}>
            <div className={apresentarStyles.miniCard}>
              <span className={apresentarStyles.letterBadge}>C</span>
              <p className={apresentarStyles.kicker}>Conteúdo</p>
              <p className={apresentarStyles.miniCardText}>Materiais pensados para produtos, ofertas, campanhas e necessidades do negócio.</p>
              <p className={apresentarStyles.miniCardFooter}>Conteúdo alinhado ao que você precisa comunicar.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <span className={apresentarStyles.letterBadge}>P</span>
              <p className={apresentarStyles.kicker}>Publicação</p>
              <p className={apresentarStyles.miniCardText}>Organização e programação do conteúdo para manter a marca presente com frequência.</p>
              <p className={apresentarStyles.miniCardFooter}>Menos preocupação com a rotina de postagem.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <span className={apresentarStyles.letterBadge}>T</span>
              <p className={apresentarStyles.kicker}>Tráfego Pago</p>
              <p className={apresentarStyles.miniCardText}>Campanhas para ampliar alcance, atrair público e gerar novas oportunidades.</p>
              <p className={apresentarStyles.miniCardFooter}>Mais pessoas certas vendo sua marca.</p>
            </div>
          </div>
          <div className={apresentarStyles.calloutBox}>
            <span className={apresentarStyles.calloutKicker}>O que entregamos de verdade</span>
            <h3 className={apresentarStyles.calloutTitle}>Presença digital sem ocupar sua rotina.</h3>
            <p className={apresentarStyles.calloutText}>A estratégia acontece com processo, frequência e acompanhamento — sem você precisar lembrar todos os dias do que publicar ou anunciar.</p>
          </div>
        </section>

        {/* 3. Criação de Conteúdo */}
        <section className={apresentarStyles.printSection}>
          <PageHeader agency={agency} proposal={proposal} />
          <h2 className={apresentarStyles.pageTitle}>Seu conteúdo sem virar mais uma tarefa pra você</h2>
          <p className={apresentarStyles.pageIntro}>Nós cuidamos do processo de conteúdo do início à publicação.</p>
          <div className={apresentarStyles.flow}>
            {CONTENT_FLOW.map((step, i) => (
              <Fragment key={step.number}>
                <div className={apresentarStyles.flowStep}>
                  <span className={apresentarStyles.flowNumber}>{step.number}</span>
                  <p className={apresentarStyles.flowTitle}>{step.title}</p>
                  <p className={apresentarStyles.flowText}>{step.text}</p>
                </div>
                {i < CONTENT_FLOW.length - 1 ? <span className={apresentarStyles.flowArrow}>→</span> : null}
              </Fragment>
            ))}
          </div>
          <div className={apresentarStyles.flowHighlight}>
            <span className={apresentarStyles.flowNumber}>05</span>
            <div>
              <p className={apresentarStyles.flowHighlightTitle}>Você acompanha</p>
              <p className={apresentarStyles.flowHighlightText}>Clareza sobre o que está sendo produzido e publicado, sem precisar cuidar da operação.</p>
            </div>
          </div>
          <PortfolioGallery images={contentImages} category="Criação de Conteúdo" />
        </section>

        {/* 4. Tráfego Pago */}
        <section className={apresentarStyles.printSection}>
          <PageHeader agency={agency} proposal={proposal} />
          <h2 className={apresentarStyles.pageTitle}>Tráfego pago para ampliar seu alcance</h2>
          <p className={apresentarStyles.pageIntro}>Colocamos sua empresa na frente de novas pessoas com campanhas planejadas de acordo com o objetivo do negócio.</p>
          <div className={apresentarStyles.trafficLayout}>
            <div className={apresentarStyles.trafficSteps}>
              {TRAFFIC_STEPS.map((step) => (
                <div key={step.number} className={apresentarStyles.trafficStep}>
                  <span className={apresentarStyles.trafficStepNumber}>{step.number}</span>
                  <p className={apresentarStyles.trafficStepTitle}>{step.title}</p>
                  <p className={apresentarStyles.trafficStepText}>{step.text}</p>
                </div>
              ))}
            </div>
            <div className={apresentarStyles.trafficPanels}>
              <div className={apresentarStyles.calloutBoxDark}>
                <span className={apresentarStyles.calloutKicker}>Mais alcance</span>
                <h3 className={apresentarStyles.calloutTitle}>A campanha tem um objetivo claro.</h3>
                <p className={apresentarStyles.calloutText}>Nada de anunciar por anunciar. O investimento é direcionado conforme a meta definida para cada campanha.</p>
              </div>
              <div className={apresentarStyles.calloutBox}>
                <span className={apresentarStyles.calloutKicker}>Investimento em mídia</span>
                <h3 className={apresentarStyles.calloutTitle}>Você decide quanto quer investir.</h3>
                <p className={apresentarStyles.calloutText}>A verba dos anúncios é paga diretamente à Meta e fica separada do valor da nossa gestão.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Fallback: dynamic per-category content for anything not fixed above */}
        {fallbackCategories.map((category) => {
          const process = processes.find((entry) => entry.category === category);
          const images = portfolio.filter((item) => item.category === category);
          if (!process?.text && images.length === 0) return null;
          return (
            <section key={category} className={`${apresentarStyles.printSection} ${apresentarStyles.categorySection}`}>
              <PageHeader agency={agency} proposal={proposal} />
              <h2 className={apresentarStyles.pageTitle}>{category}</h2>
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

        {/* 5. Por que a King */}
        <section className={apresentarStyles.printSection}>
          <PageHeader agency={agency} proposal={proposal} />
          <h2 className={apresentarStyles.pageTitle}>Por que escolher a King?</h2>
          <p className={apresentarStyles.pageIntro}>Uma operação pensada para manter sua empresa ativa sem aumentar a complexidade da rotina.</p>
          <div className={apresentarStyles.cardGrid}>
            {WHY_CARDS.map((card, i) => (
              <div key={card.title} className={apresentarStyles.miniCard}>
                <span className={apresentarStyles.flowNumber}>{String(i + 1).padStart(2, "0")}</span>
                <p className={apresentarStyles.miniCardTitle}>{card.title === "Conteúdo pensado para o negócio" ? `${card.title} da ${proposal.clientName}` : card.title}</p>
                <p className={apresentarStyles.miniCardText}>{card.text}</p>
              </div>
            ))}
          </div>
          <div className={apresentarStyles.calloutBoxDark}>
            <span className={apresentarStyles.calloutKicker}>O resultado esperado</span>
            <h3 className={apresentarStyles.calloutTitle}>Uma presença digital mais organizada, consistente e fácil de acompanhar.</h3>
          </div>
        </section>

        {/* 6. Divisória */}
        <section className={`${apresentarStyles.printSection} ${apresentarStyles.divider}`}>
          <IconCrown className={apresentarStyles.dividerCrown} />
          <div className={apresentarStyles.dividerBrand}>
            {agency.logoPath ? <img src={commercialAssetUrl(agency.logoPath)} alt={agency.name} className={apresentarStyles.coverLogo} /> : null}
            <span className={apresentarStyles.dividerBrandName}>{agency.name}</span>
          </div>
          <span className={apresentarStyles.dividerKicker}>Agora,</span>
          <h2 className={apresentarStyles.dividerTitle}>a estratégia para a {proposal.clientName}.</h2>
          <p className={apresentarStyles.dividerText}>Com base no que apresentamos, organizamos a proposta comercial com os serviços e formatos disponíveis para a operação.</p>
          <span className={apresentarStyles.dividerBreadcrumb}>Apresentação › Proposta comercial</span>
        </section>

        {/* 7. Proposta */}
        <section className={apresentarStyles.printSection}>
          <PageHeader agency={agency} proposal={proposal} />
          <PropostaPricingSection
            proposal={proposal}
            agency={agency}
            showWhy={false}
            belowGrid={
              !proposalHasTraffic ? (
                <div className={apresentarStyles.upsellNote}>
                  <b>Tráfego Pago</b>
                  Pode ser incluído na proposta conforme o escopo definido para a campanha.
                </div>
              ) : undefined
            }
          />
        </section>
      </div>
    </div>
  );
}
