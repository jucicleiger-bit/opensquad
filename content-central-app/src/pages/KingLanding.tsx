import kingLogo from "@/assets/king-logo.jpg";
import portfolioAlho from "@/assets/king-portfolio-alho.webp";
import portfolioBrocolis from "@/assets/king-portfolio-brocolis.webp";
import portfolioCouveFlor from "@/assets/king-portfolio-couve-flor.webp";
import styles from "./KingLanding.module.css";

const whatsappUrl =
  "https://wa.me/5565981086707?text=Quero%20saber%20como%20funciona%20o%20marketing%20di%C3%A1rio%20da%20King";

const deliverables = [
  "Posts prontos para redes sociais",
  "Artes no padrão da marca",
  "Legendas e chamadas comerciais",
  "Calendário com publicações diárias",
  "Conteúdos sobre ofertas, produtos e serviços",
  "Materiais para datas especiais",
  "Publicação nos canais combinados",
];

const portfolioSamples = [
  {
    src: portfolioBrocolis,
    alt: "Criativo promocional de produto congelado com preço e chamada de compra",
  },
  {
    src: portfolioAlho,
    alt: "Criativo promocional de alho congelado com produto em destaque",
  },
  {
    src: portfolioCouveFlor,
    alt: "Criativo promocional de couve-flor congelada com preço e benefícios",
  },
];

const workflow = [
  {
    step: "1.0",
    title: "Entendemos o negócio",
    text: "A King levanta marca, produtos, serviços, ofertas e datas importantes para transformar isso em conteúdo comercial.",
    visual: ["Marca", "Ofertas", "Canais"],
  },
  {
    step: "2.0",
    title: "Montamos o calendário",
    text: "Cada dia recebe um tema, um objetivo e um canal. A empresa para de depender de ideia de última hora.",
    visual: ["Seg", "Ter", "Qua", "Qui", "Sex"],
  },
  {
    step: "3.0",
    title: "Criamos as peças",
    text: "As artes, legendas e chamadas saem alinhadas com o visual da empresa e com o que ela precisa vender.",
    visual: ["Arte", "Legenda", "CTA"],
  },
  {
    step: "4.0",
    title: "Aprovamos e publicamos",
    text: "Depois da aprovação, a King posta nos canais que geram venda: Instagram, WhatsApp e Facebook.",
    visual: ["Instagram", "WhatsApp", "Facebook"],
  },
];

const faqs = [
  {
    question: "Preciso aprovar antes de postar?",
    answer:
      "Sim. A rotina pode passar pela sua aprovação antes de ir para os canais combinados.",
  },
  {
    question: "O conteúdo segue minha marca?",
    answer:
      "Sim. A King parte da identidade, das ofertas, dos produtos e das regras visuais da empresa.",
  },
  {
    question: "É só arte ou também tem texto?",
    answer:
      "Tem arte, legenda, chamada comercial e direção do que será publicado em cada dia.",
  },
];

export function KingLanding() {
  return (
    <main className={styles.page}>
      {/* THESIS: King vende rotina diaria de marketing, nao posts avulsos; a pagina recusa o template de agencia com promessas vagas.
          OWN-WORLD: preto quente, ouro de coroa, paineis operacionais e linhas de calendario; controles retos, densos e comerciais.
          STORY: o cliente entende que todo dia recebe arte, legenda, calendario e publicacao nos canais de venda.
          FIRST VIEWPORT: logo real da King no canto, CTA de WhatsApp, frase grande a esquerda e calendario vivo a direita.
          FORM: Narrative Workflow, first choice for a service sold as rotina; nav N9, footer Ft5.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. */}
      <header className={styles.nav}>
        <a className={styles.brand} href="#inicio" aria-label="Voltar ao início">
          <img src={kingLogo} width="40" height="40" alt="" decoding="async" fetchPriority="high" />
          <span>King Assessoria de MKT</span>
        </a>
        <a
          className={styles.navCta}
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Falar no WhatsApp"
        >
          WhatsApp
        </a>
      </header>

      <section id="inicio" className={styles.hero} aria-labelledby="king-hero-title">
        <div className={styles.heroCopy}>
          <div className={styles.heroMark} aria-hidden="true">
            <img src={kingLogo} width="72" height="72" alt="" decoding="async" />
            <div>
              <strong>KING</strong>
              <span>Assessoria de MKT</span>
            </div>
          </div>
          <div className={styles.mobileProofStrip} aria-hidden="true">
            {portfolioSamples.map((sample) => (
              <img src={sample.src} alt="" decoding="async" key={sample.alt} />
            ))}
          </div>
          <h1 id="king-hero-title">Todo dia, sua empresa aparece vendendo.</h1>
          <p className={styles.lede}>
            Marketing diário para negócios locais: a King cria os posts, as artes, as legendas e
            publica nos seus principais canais de venda.
          </p>
          <div className={styles.heroActions} role="group" aria-label="Ações principais">
            <a className={styles.primaryCta} href={whatsappUrl} target="_blank" rel="noreferrer">
              Quero conteúdo diário
            </a>
            <a className={styles.secondaryCta} href="#entregas">
              Ver entregas
            </a>
          </div>
          <div className={styles.signalStrip} aria-hidden="true">
            <span>arte</span>
            <span>legenda</span>
            <span>calendário</span>
            <span>publicação</span>
          </div>
          <p className={styles.signatureLine}>
            Produto no centro, preço legível, chamada de pedido e postagem no canal certo.
          </p>
        </div>

        <aside className={styles.portfolioShowcase} aria-label="Exemplos reais de criativos da King">
          <div className={styles.showcaseSeal}>
            <img src={kingLogo} width="52" height="52" alt="" decoding="async" />
            <div>
              <span>portfólio king</span>
              <strong>peças que vendem</strong>
            </div>
          </div>
          <div className={styles.portfolioStack}>
            {portfolioSamples.map((sample, index) => (
              <figure className={styles.sampleCard} key={sample.alt} data-slot={index + 1}>
                <img src={sample.src} alt={sample.alt} decoding="async" />
              </figure>
            ))}
          </div>
          <div className={styles.routineTape} aria-hidden="true">
            <span>produto</span>
            <span>preço</span>
            <span>oferta</span>
            <span>pedido</span>
          </div>
        </aside>
      </section>

      <section id="entregas" className={styles.deliverables}>
        <div className={styles.sectionCopy}>
          <h2>Você recebe a rotina inteira pronta.</h2>
          <p>
            Não é apenas uma arte. É um fluxo contínuo para manter a empresa ativa, bonita e presente
            onde o cliente decide comprar.
          </p>
        </div>
        <div className={styles.deliveryBoard}>
          {deliverables.map((item) => (
            <div className={styles.deliveryRow} key={item}>
              <span aria-hidden="true" />
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.channelBand} aria-label="Canais atendidos">
        <p>Publicamos nos canais que importam para venda direta.</p>
        <div>
          <span>Instagram</span>
          <span>WhatsApp</span>
          <span>Facebook</span>
        </div>
      </section>

      <section className={styles.workflow} aria-labelledby="workflow-title">
        <h2 id="workflow-title">Como a operação roda</h2>
        <ol>
          {workflow.map((item) => (
            <li className={styles.stage} key={item.step}>
              <div className={styles.stageNumber}>{item.step}</div>
              <div className={styles.stageCopy}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
              <div className={styles.stageVisual} aria-hidden="true">
                {item.visual.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.fit}>
        <h2>Feito para empresa que precisa vender sem parar a operação.</h2>
        <p>
          Comércio local, clínica, loja, restaurante ou prestador de serviço: a King cuida da presença
          diária enquanto sua equipe atende, vende e entrega.
        </p>
        <a className={styles.primaryCta} href={whatsappUrl} target="_blank" rel="noreferrer">
          Chamar a King
        </a>
      </section>

      <section className={styles.faq} aria-labelledby="faq-title">
        <h2 id="faq-title">Perguntas antes de começar</h2>
        <div className={styles.faqList}>
          {faqs.map((item) => (
            <details className={styles.faqItem} key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <p>Suas redes não precisam ficar paradas entre uma venda e outra.</p>
        <div>
          <span>King Assessoria de MKT</span>
          <a href="https://www.instagram.com/king.assessoriamkt" target="_blank" rel="noreferrer">
            @king.assessoriamkt
          </a>
          <a href={whatsappUrl} target="_blank" rel="noreferrer">
            65 98108-6707
          </a>
        </div>
      </footer>
    </main>
  );
}
