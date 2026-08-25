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
import { IconContent, IconTarget, IconCheck } from "./PropostaPricingSection";
import { PropostaBody } from "./ComercialPropostaImprimir";
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

const BENEFITS = [
  { title: "Presença constante", text: "Sua empresa ativa nas redes sociais com conteúdo relevante e frequência." },
  { title: "Mais alcance e visibilidade", text: "Campanhas pensadas para aumentar o alcance da sua marca e atrair o público certo." },
  { title: "Mais contatos e oportunidades", text: "Conteúdo e anúncios pensados para gerar mais contatos e novas oportunidades." },
  { title: "Fortalecimento da marca", text: "Comunicação mais profissional, transmitindo confiança e fortalecendo sua marca." },
  { title: "Comodidade e economia de tempo", text: "Nós cuidamos da operação para você focar no que realmente importa: seu negócio." },
];

const OVERVIEW_STEPS = [
  { number: "01", title: "Alinhamento", text: "Entendemos seu negócio, objetivos e prioridades." },
  { number: "02", title: "Planejamento", text: "Definimos o que comunicar e organizamos as ações." },
  { number: "03", title: "Criação", text: "Produzimos conteúdos alinhados à sua marca." },
  { number: "04", title: "Publicação", text: "Organizamos e publicamos nos canais definidos." },
  { number: "05", title: "Tráfego pago", text: "Criamos campanhas para ampliar o alcance." },
  { number: "06", title: "Acompanhamento", text: "Monitoramos os resultados e fazemos ajustes." },
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

function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 10h16M8 3.5v3M16 3.5v3" />
    </svg>
  );
}

function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M19.5 19.5l-4.3-4.3" />
    </svg>
  );
}

function IconPencil(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 4.5l4.5 4.5L8 20.5H3.5V16z" />
      <path d="M13 6.5l4.5 4.5" />
    </svg>
  );
}

function IconSend(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20.5 3.5L10.5 13.5" />
      <path d="M20.5 3.5L14 20.5l-3.5-7-7-3.5z" />
    </svg>
  );
}

function IconEye(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconBulb(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.4 10.9c.6.4.9 1.1.9 1.8V16h5v-.3c0-.7.3-1.4.9-1.8A6 6 0 0 0 12 3z" />
    </svg>
  );
}

const CONTENT_FLOW_ICONS = [IconSearch, IconCalendar, IconPencil, IconSend];

function IconPeople(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M2.5 19c0-3 2.7-5 6-5s6 2 6 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M14.8 12.2c2.4.3 4.2 2 4.2 4.3" />
    </svg>
  );
}

function IconMegaphone(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 10v4h3l6 4V6L6 10H3z" />
      <path d="M14 9.5a3 3 0 0 1 0 5" />
      <path d="M17 7.5a6 6 0 0 1 0 9" />
    </svg>
  );
}

const TRAFFIC_STEPS_ICONS = [IconTarget, IconPeople, IconMegaphone, IconChart];

const CHANNELS = [
  { icon: IconContent, label: "Feed", text: "Aparece no feed do Instagram e Facebook." },
  { icon: IconPhone, label: "Stories", text: "Entre os stories que o público já consome." },
  { icon: IconTarget, label: "Anúncio", text: "Post patrocinado com oferta ou promoção." },
  { icon: IconChat, label: "Mensagens", text: "Cliente inicia conversa direto com a empresa." },
  { icon: IconChart, label: "Acompanhamento", text: "Resultados e métricas da campanha." },
];

function IconMedal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 3l1.8 6M16 3l-1.8 6" />
      <circle cx="12" cy="14" r="6" />
      <path d="M12 11.3l1 2h2l-1.6 1.3.6 2-2-1.3-2 1.3.6-2L9 13.3h2z" />
    </svg>
  );
}

function IconClock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function IconClipboard(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="4.5" width="14" height="16" rx="2" />
      <path d="M9 4V3.3A1.3 1.3 0 0 1 10.3 2h3.4A1.3 1.3 0 0 1 15 3.3V4" />
      <path d="M8.5 10.5h7M8.5 14h7M8.5 17.5h4.5" />
    </svg>
  );
}

const BENEFIT_ICONS = [IconTarget, IconPeople, IconChat, IconMedal, IconClock];

const OVERVIEW_ICONS = [IconClipboard, IconCalendar, IconPencil, IconSend, IconMegaphone, IconChart];

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
    <div className={apresentarStyles.examplesBlock}>
      <p className={apresentarStyles.exampleKicker}>Exemplos de conteúdo</p>
      <div className={apresentarStyles.portfolioGrid}>
        {images.map((image) => (
          <figure key={image.id} className={apresentarStyles.portfolioItem}>
            <img src={commercialAssetUrl(image.imagePath)} alt={image.caption || category} />
            {image.caption ? <figcaption>{image.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
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
            <span className={apresentarStyles.coverIconCircle}><IconChat width={19} height={19} /></span>
            <span className={apresentarStyles.coverIconDivider} />
            <span className={apresentarStyles.coverIconCircle}><IconPhone width={19} height={19} /></span>
            <span className={apresentarStyles.coverIconDivider} />
            <span className={apresentarStyles.coverIconCircle}><IconChart width={19} height={19} /></span>
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
        <section className={`${apresentarStyles.printSection} ${apresentarStyles.filledPage}`}>
          <PageHeader agency={agency} proposal={proposal} />
          <h2 className={`${apresentarStyles.pageTitle} ${apresentarStyles.pageTitleLarge}`}>
            A gente cuida da presença digital.<br />
            <span className={apresentarStyles.pageTitleAccent}>Você cuida do seu negócio.</span>
          </h2>
          <p className={apresentarStyles.pageIntro}>{agency.about || DEFAULT_ABOUT}</p>
          <div className={apresentarStyles.cardGrid}>
            <div className={apresentarStyles.miniCard}>
              <span className={apresentarStyles.miniCardIcon}><IconContent width={24} height={24} /></span>
              <p className={apresentarStyles.miniCardTitle}>Conteúdo</p>
              <p className={apresentarStyles.miniCardText}>Materiais pensados para produtos, ofertas, campanhas e necessidades do negócio.</p>
              <p className={apresentarStyles.miniCardFooter}>Conteúdo alinhado ao que você precisa comunicar.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <span className={apresentarStyles.miniCardIcon}><IconCalendar width={24} height={24} /></span>
              <p className={apresentarStyles.miniCardTitle}>Publicação</p>
              <p className={apresentarStyles.miniCardText}>Organização e programação do conteúdo para manter a marca presente com frequência.</p>
              <p className={apresentarStyles.miniCardFooter}>Menos preocupação com a rotina de postagem.</p>
            </div>
            <div className={apresentarStyles.miniCard}>
              <span className={apresentarStyles.miniCardIcon}><IconChart width={24} height={24} /></span>
              <p className={apresentarStyles.miniCardTitle}>Tráfego Pago</p>
              <p className={apresentarStyles.miniCardText}>Campanhas para ampliar alcance, atrair público e gerar novas oportunidades.</p>
              <p className={apresentarStyles.miniCardFooter}>Mais pessoas certas vendo sua marca.</p>
            </div>
          </div>
          <div className={apresentarStyles.calloutBox}>
            <IconCrown className={apresentarStyles.calloutCrown} />
            <span className={apresentarStyles.calloutKicker}>O que entregamos de verdade</span>
            <h3 className={apresentarStyles.calloutTitle}>Presença digital sem ocupar sua rotina.</h3>
            <p className={apresentarStyles.calloutText}>A estratégia acontece com processo, frequência e acompanhamento — sem você precisar lembrar todos os dias do que publicar ou anunciar.</p>
          </div>
        </section>

        {/* 3. Criação de Conteúdo */}
        <section className={`${apresentarStyles.printSection} ${apresentarStyles.filledPage}`}>
          <PageHeader agency={agency} proposal={proposal} />
          <h2 className={apresentarStyles.pageTitle}>Seu conteúdo sem virar mais uma tarefa pra você</h2>
          <p className={apresentarStyles.pageIntro}>Nós cuidamos do processo de conteúdo do planejamento à publicação.</p>
          <div className={apresentarStyles.flow}>
            {CONTENT_FLOW.map((step, i) => {
              const Icon = CONTENT_FLOW_ICONS[i];
              return (
                <Fragment key={step.number}>
                  <div className={apresentarStyles.flowStep}>
                    <span className={apresentarStyles.flowIconWrap}>
                      <Icon className={apresentarStyles.flowIcon} width={22} height={22} />
                      <span className={apresentarStyles.flowNumber}>{step.number}</span>
                    </span>
                    <p className={apresentarStyles.flowTitle}>{step.title}</p>
                    <p className={apresentarStyles.flowText}>{step.text}</p>
                  </div>
                  {i < CONTENT_FLOW.length - 1 ? <span className={apresentarStyles.flowArrow}>→</span> : null}
                </Fragment>
              );
            })}
          </div>
          <div className={apresentarStyles.flowHighlight}>
            <IconCrown className={apresentarStyles.calloutCrown} />
            <span className={apresentarStyles.flowIconWrap}>
              <IconEye className={apresentarStyles.flowIcon} width={20} height={20} />
              <span className={apresentarStyles.flowNumber}>05</span>
            </span>
            <div className={apresentarStyles.flowHighlightBody}>
              <p className={apresentarStyles.flowHighlightTitle}>Você acompanha</p>
              <p className={apresentarStyles.flowHighlightText}>Clareza sobre o que está sendo produzido e publicado, sem precisar cuidar da operação todos os dias.</p>
            </div>
          </div>
          <PortfolioGallery images={contentImages} category="Criação de Conteúdo" />
          <div className={apresentarStyles.footerBanner}>
            <span className={apresentarStyles.footerBannerIcon}><IconBulb width={20} height={20} /></span>
            <p className={apresentarStyles.footerBannerText}>
              Nossa operação cuida de todo o processo para que você tenha uma presença digital ativa, profissional e consistente — <span className={apresentarStyles.footerBannerAccent}>sem virar mais uma tarefa da sua rotina.</span>
            </p>
          </div>
        </section>

        {/* 4. Tráfego Pago */}
        <section className={`${apresentarStyles.printSection} ${apresentarStyles.filledPage}`}>
          <PageHeader agency={agency} proposal={proposal} />
          <div className={apresentarStyles.trafficLayout}>
            <div className={apresentarStyles.trafficStepsCol}>
              <h2 className={`${apresentarStyles.pageTitle} ${apresentarStyles.pageTitleLarge}`}>
                Tráfego pago para<br />
                <span className={apresentarStyles.pageTitleAccent}>ampliar seu alcance</span>
              </h2>
              <p className={apresentarStyles.pageIntro}>
                Colocamos sua empresa na frente de novas pessoas com<br />
                campanhas planejadas de acordo com o objetivo do negócio.
              </p>
              <p className={apresentarStyles.exampleKicker}>Nosso processo de tráfego pago</p>
              <div className={apresentarStyles.trafficSteps}>
                {TRAFFIC_STEPS.map((step, i) => {
                  const Icon = TRAFFIC_STEPS_ICONS[i];
                  return (
                    <div key={step.number} className={apresentarStyles.trafficStep}>
                      <span className={apresentarStyles.trafficStepNumber}>{step.number}</span>
                      <span className={apresentarStyles.trafficStepIcon}><Icon width={22} height={22} /></span>
                      <div className={apresentarStyles.trafficStepBody}>
                        <p className={apresentarStyles.trafficStepTitle}>{step.title}</p>
                        <p className={apresentarStyles.trafficStepText}>{step.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className={apresentarStyles.trafficPanels}>
              <div className={apresentarStyles.calloutBoxDark}>
                <div className={apresentarStyles.trafficCardHead}>
                  <span className={apresentarStyles.trafficCardIcon}><IconTarget width={13} height={13} /></span>
                  <span className={apresentarStyles.trafficCardKicker}>Mais alcance</span>
                </div>
                <h3 className={apresentarStyles.calloutTitle}>A campanha tem um objetivo claro.</h3>
                <p className={apresentarStyles.calloutText}>Nada de anunciar por anunciar. O investimento é direcionado conforme o objetivo definido para cada campanha.</p>
              </div>
              <div className={apresentarStyles.calloutBox}>
                <div className={apresentarStyles.trafficCardHead}>
                  <span className={apresentarStyles.trafficCardIcon}>$</span>
                  <span className={apresentarStyles.trafficCardKicker}>Investimento em mídia</span>
                </div>
                <h3 className={apresentarStyles.calloutTitle}>Você decide quanto quer investir.</h3>
                <p className={apresentarStyles.calloutText}>A verba dos anúncios é paga diretamente à Meta e fica separada do valor da nossa gestão.</p>
              </div>
              <div className={apresentarStyles.calloutBox}>
                <div className={apresentarStyles.trafficCardHead}>
                  <IconCheck className={apresentarStyles.trafficCardCheck} width={24} height={24} />
                  <span className={apresentarStyles.trafficCardKicker}>Transparência</span>
                </div>
                <h3 className={apresentarStyles.calloutTitle}>Gestão com clareza e responsabilidade.</h3>
                <p className={apresentarStyles.calloutText}>Você acompanha os resultados e entende onde seu investimento está sendo aplicado.</p>
              </div>
            </div>
          </div>
          <div className={apresentarStyles.channelsBlock}>
            <p className={apresentarStyles.exampleKicker}>Como sua campanha aparece para o cliente</p>
            <div className={apresentarStyles.channelsRow}>
              {CHANNELS.map((channel, i) => (
                <Fragment key={channel.label}>
                  <div className={apresentarStyles.channelCard}>
                    <span className={apresentarStyles.flowIconWrap}>
                      <channel.icon className={apresentarStyles.flowIcon} width={20} height={20} />
                    </span>
                    <p className={apresentarStyles.channelLabel}>{channel.label}</p>
                    <p className={apresentarStyles.channelText}>{channel.text}</p>
                  </div>
                  {i < CHANNELS.length - 1 ? <span className={apresentarStyles.flowArrow}>→</span> : null}
                </Fragment>
              ))}
            </div>
          </div>
          <div className={apresentarStyles.footerBanner}>
            <span className={apresentarStyles.footerBannerIcon}><IconTarget width={16} height={16} /></span>
            <p className={apresentarStyles.footerBannerText}>
              Estratégia, criatividade e acompanhamento trabalhando juntos — <span className={apresentarStyles.footerBannerAccent}>para gerar mais alcance, mais oportunidades e mais resultados.</span>
            </p>
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
        <section className={`${apresentarStyles.printSection} ${apresentarStyles.filledPage}`}>
          <PageHeader agency={agency} proposal={proposal} />
          <div className={apresentarStyles.page5Body}>
          <div className={apresentarStyles.missionLayout}>
            <div>
              <h2 className={apresentarStyles.missionHeadline}>
                Mais que posts e anúncios:<br />
                <span className={apresentarStyles.pageTitleAccent}>uma operação completa</span><br />
                para o seu negócio.
              </h2>
              <hr className={apresentarStyles.coverRule} />
              <p className={apresentarStyles.pageIntro}>Unimos estratégia, conteúdo e tráfego em uma operação organizada para manter sua empresa presente, fortalecer sua marca e gerar novas oportunidades.</p>
            </div>
            <div className={apresentarStyles.missionCard}>
              <IconCrown className={apresentarStyles.missionCrown} />
              <span className={apresentarStyles.calloutKicker}>Nossa missão</span>
              <hr className={apresentarStyles.missionRule} />
              <p className={apresentarStyles.missionText}>Simplificar o marketing para negócios locais com uma operação que gera presença, organização e resultados sem complicação.</p>
            </div>
          </div>

          <p className={apresentarStyles.sectionDivider}>O que você ganha com a King</p>
          <div className={apresentarStyles.benefitsRow}>
            {BENEFITS.map((benefit, i) => {
              const Icon = BENEFIT_ICONS[i];
              return (
                <div key={benefit.title} className={apresentarStyles.benefitItem}>
                  <span className={apresentarStyles.benefitIcon}><Icon width={26} height={26} /></span>
                  <p className={apresentarStyles.benefitTitle}>{benefit.title}</p>
                  <p className={apresentarStyles.benefitText}>{benefit.text}</p>
                </div>
              );
            })}
          </div>

          <p className={apresentarStyles.sectionDivider}>Como funciona a nossa operação no dia a dia</p>
          <div className={apresentarStyles.overviewGrid}>
            {[OVERVIEW_STEPS.slice(0, 3), OVERVIEW_STEPS.slice(3, 6)].map((row, rowIndex) => (
              <div key={rowIndex} className={apresentarStyles.overviewRow}>
                {row.map((step, i) => {
                  const Icon = OVERVIEW_ICONS[rowIndex * 3 + i];
                  return (
                    <Fragment key={step.number}>
                      <div className={apresentarStyles.overviewStep}>
                        <span className={apresentarStyles.overviewIconWrap}>
                          <Icon className={apresentarStyles.overviewIcon} width={22} height={22} />
                          <span className={apresentarStyles.overviewNumber}>{step.number}</span>
                        </span>
                        <p className={apresentarStyles.overviewTitle}>{step.title}</p>
                        <p className={apresentarStyles.overviewText}>{step.text}</p>
                      </div>
                      {i < row.length - 1 ? <span className={apresentarStyles.flowArrow}>→</span> : null}
                    </Fragment>
                  );
                })}
              </div>
            ))}
          </div>
          </div>

          <div className={apresentarStyles.closingBanner}>
            <IconCrown className={apresentarStyles.closingCrown} />
            <p className={apresentarStyles.closingText}>
              Você cuida do seu negócio.<br />
              <span className={apresentarStyles.closingAccent}>A King cuida da sua presença.</span>
            </p>
          </div>
        </section>

        {/* 6. Proposta */}
        <section className={apresentarStyles.printSection}>
          <PropostaBody proposal={proposal} agency={agency} showWhy={false} />
        </section>
      </div>
    </div>
  );
}
