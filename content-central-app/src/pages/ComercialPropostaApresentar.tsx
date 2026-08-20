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
import { IconBadge, IconCheck, IconContent, IconTarget, PropostaPricingSection } from "./PropostaPricingSection";
import styles from "./ComercialPropostaImprimir.module.css";
import apresentarStyles from "./ComercialPropostaApresentar.module.css";

const FIXED_CATEGORIES = new Set(["Criação de Conteúdo", "Tráfego Pago"]);

const DEFAULT_ABOUT = "A King Assessoria de Mkt ajuda empresas a manterem suas redes sociais ativas, organizadas e profissionais sem depender da rotina interna para criar, pensar e publicar conteúdo.";

const CONTENT_FLOW = [
  { number: "01", title: "Entendemos", text: "Produtos, serviços, público, promoções e necessidades." },
  { number: "02", title: "Planejamos", text: "Definimos o que comunicar e organizamos os conteúdos." },
  { number: "03", title: "Criamos", text: "Produzimos as artes e materiais de acordo com a identidade da empresa." },
  { number: "04", title: "Publicamos", text: "Organizamos e programamos as publicações." },
  { number: "05", title: "Você acompanha", text: "Você acompanha o que está acontecendo sem precisar cuidar da operação." },
];

const TRAFFIC_FLOW = [
  { number: "01", title: "Definimos o objetivo", text: "Seguidores, alcance, mensagens, divulgação de produto ou campanha." },
  { number: "02", title: "Configuramos a campanha", text: "Público, região, orçamento e estratégia." },
  { number: "03", title: "Criamos os anúncios", text: "Criativos e mensagens alinhados ao objetivo da campanha." },
  { number: "04", title: "Acompanhamos", text: "Monitoramos o desempenho e fazemos ajustes quando necessário." },
  { number: "05", title: "Apresentamos os resultados", text: "Você acompanha o desempenho das campanhas." },
];

function IconPublish(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9.5h16" />
      <path d="M8 3.5v3M16 3.5v3" />
      <path d="M8.5 13.5l2 2 4-4.2" />
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

function FlowSteps({ steps }: { steps: typeof CONTENT_FLOW }) {
  return (
    <div className={apresentarStyles.flow}>
      {steps.map((step, i) => (
        <Fragment key={step.number}>
          <div className={apresentarStyles.flowStep}>
            <span className={apresentarStyles.flowNumber}>{step.number}</span>
            <p className={apresentarStyles.flowTitle}>{step.title}</p>
            <p className={apresentarStyles.flowText}>{step.text}</p>
          </div>
          {i < steps.length - 1 ? <span className={apresentarStyles.flowArrow}>→</span> : null}
        </Fragment>
      ))}
    </div>
  );
}

function PortfolioGallery({ images, category }: { images: CommercialPortfolioItem[]; category: string }) {
  if (!images.length) return null;
  return (
    <div className={apresentarStyles.portfolioGrid}>
      {images.map((image) => (
        <figure key={image.id} className={apresentarStyles.portfolioItem}>
          <img src={commercialAssetUrl(image.imagePath)} alt={image.caption || category} />
          {image.caption ? <figcaption>{image.caption}</figcaption> : null}
        </figure>
      ))}
    </div>
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
  const hasContent = categories.includes("Criação de Conteúdo");
  const hasTraffic = categories.includes("Tráfego Pago");
  const fallbackCategories = categories.filter((category) => !FIXED_CATEGORIES.has(category));

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
          <div className={apresentarStyles.coverBrand}>
            {agency.logoPath ? <img src={commercialAssetUrl(agency.logoPath)} alt={agency.name} className={apresentarStyles.coverLogo} /> : null}
            <h1 className={apresentarStyles.coverName}>{agency.name}</h1>
          </div>
          <p className={apresentarStyles.coverTagline}>Marketing sem complicação para negócios locais</p>
          <p className={apresentarStyles.coverServices}>Conteúdo • Redes Sociais • Tráfego Pago</p>
          <div className={apresentarStyles.coverFooter}>
            <span className={apresentarStyles.coverFooterLabel}>Apresentação preparada para</span>
            <span className={apresentarStyles.coverClientName}>{proposal.clientName}</span>
          </div>
        </section>

        {/* 2. Quem somos */}
        <section className={apresentarStyles.printSection}>
          <PageHeader agency={agency} proposal={proposal} />
          <h2 className={apresentarStyles.pageTitle}>A gente cuida da presença digital. Você cuida do seu negócio.</h2>
          <p className={apresentarStyles.pageIntro}>{agency.about || DEFAULT_ABOUT}</p>
          <div className={apresentarStyles.cardGrid}>
            <div className={apresentarStyles.miniCard}>
              <IconBadge icon={IconContent} size={40} />
              <p className={apresentarStyles.miniCardTitle}>Conteúdo</p>
              <p className={apresentarStyles.miniCardText}>Criamos materiais pensados para os produtos, ofertas e necessidades do negócio.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <IconBadge icon={IconPublish} size={40} />
              <p className={apresentarStyles.miniCardTitle}>Publicação</p>
              <p className={apresentarStyles.miniCardText}>Organizamos e programamos o conteúdo para manter a empresa presente constantemente.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <IconBadge icon={IconTarget} size={40} />
              <p className={apresentarStyles.miniCardTitle}>Tráfego Pago</p>
              <p className={apresentarStyles.miniCardText}>Criamos e gerenciamos campanhas para aumentar alcance, atrair público e gerar oportunidades.</p>
            </div>
          </div>
        </section>

        {/* 3. Criação de Conteúdo */}
        {hasContent ? (
          <section className={apresentarStyles.printSection}>
            <PageHeader agency={agency} proposal={proposal} />
            <h2 className={apresentarStyles.pageTitle}>Seu conteúdo sem virar mais uma tarefa pra você</h2>
            <p className={apresentarStyles.pageIntro}>Nós cuidamos do processo de conteúdo do início à publicação.</p>
            <FlowSteps steps={CONTENT_FLOW} />
            <PortfolioGallery images={portfolio.filter((item) => item.category === "Criação de Conteúdo")} category="Criação de Conteúdo" />
          </section>
        ) : null}

        {/* 4. Tráfego Pago */}
        {hasTraffic ? (
          <section className={apresentarStyles.printSection}>
            <PageHeader agency={agency} proposal={proposal} />
            <h2 className={apresentarStyles.pageTitle}>Alcance as pessoas certas</h2>
            <p className={apresentarStyles.pageIntro}>
              Além de manter a empresa ativa organicamente, utilizamos tráfego pago para ampliar o alcance das campanhas e colocar a marca diante de novos potenciais clientes.
            </p>
            <FlowSteps steps={TRAFFIC_FLOW} />
            <p className={apresentarStyles.note}>A verba utilizada nos anúncios é definida com o cliente e paga diretamente à Meta.</p>
            <PortfolioGallery images={portfolio.filter((item) => item.category === "Tráfego Pago")} category="Tráfego Pago" />
          </section>
        ) : null}

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
              <PortfolioGallery images={images} category={category} />
            </section>
          );
        })}

        {/* 5. Por que a King */}
        <section className={apresentarStyles.printSection}>
          <PageHeader agency={agency} proposal={proposal} />
          <h2 className={apresentarStyles.pageTitle}>Por que escolher a King?</h2>
          <div className={apresentarStyles.cardGrid}>
            <div className={apresentarStyles.miniCard}>
              <IconBadge icon={IconCheck} size={40} />
              <p className={apresentarStyles.miniCardTitle}>Presença constante</p>
              <p className={apresentarStyles.miniCardText}>Sua empresa mantém uma comunicação ativa e profissional nas redes sociais.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <IconBadge icon={IconCheck} size={40} />
              <p className={apresentarStyles.miniCardTitle}>Conteúdo pensado para o seu negócio</p>
              <p className={apresentarStyles.miniCardText}>Cada conteúdo considera os produtos, ofertas, campanhas e necessidades da {proposal.clientName}.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <IconBadge icon={IconCheck} size={40} />
              <p className={apresentarStyles.miniCardTitle}>Mais comodidade</p>
              <p className={apresentarStyles.miniCardText}>Você não precisa parar sua operação para pensar no que publicar todos os dias.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <IconBadge icon={IconCheck} size={40} />
              <p className={apresentarStyles.miniCardTitle}>Conteúdo + tráfego no mesmo lugar</p>
              <p className={apresentarStyles.miniCardText}>Uma estratégia integrada entre presença orgânica e mídia paga.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <IconBadge icon={IconCheck} size={40} />
              <p className={apresentarStyles.miniCardTitle}>Acompanhamento simples</p>
              <p className={apresentarStyles.miniCardText}>Você sabe o que está sendo produzido e publicado sem processos complicados.</p>
            </div>
          </div>
        </section>

        {/* 6. Divisória */}
        <section className={`${apresentarStyles.printSection} ${apresentarStyles.divider}`}>
          <h2 className={apresentarStyles.dividerTitle}>Uma estratégia pensada para a {proposal.clientName}</h2>
          <p className={apresentarStyles.dividerText}>Agora que você conhece como trabalhamos, veja a solução que preparamos para sua empresa.</p>
        </section>

        {/* 7. Proposta */}
        <section className={apresentarStyles.printSection}>
          <PageHeader agency={agency} proposal={proposal} />
          <PropostaPricingSection proposal={proposal} agency={agency} showWhy={false} />
        </section>
      </div>
    </div>
  );
}
