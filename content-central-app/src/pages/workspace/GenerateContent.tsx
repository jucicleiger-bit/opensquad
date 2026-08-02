import { useState, type FormEvent } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { generateCatalogContent, generateContent, type GenerateFormatInput } from "@/api/client";
import { channelFullLabel, FEED_CREATIVE_CHANNELS, VERTICAL_CREATIVE_CHANNELS } from "./contentDisplay";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import styles from "./GenerateContent.module.css";

// Catalog (venda direta) projects have no formats/channels matrix to
// configure — every slot is the same thing (next product in stock, posted
// to Instagram Story), so the whole "Agenda e geração" form collapses to
// how many days, how many stories a day, and when the first one goes out.
function GenerateCatalogContent() {
  const { project } = useOutletContext<WorkspaceContext>();
  const navigate = useNavigate();
  const [days, setDays] = useState("7");
  const [startDate, setStartDate] = useState("");
  const [storiesPerDay, setStoriesPerDay] = useState("3");
  const [startTime, setStartTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProductCount = (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false).length;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await generateCatalogContent(project.projectId, { days, startDate, storiesPerDay, startTime });
      navigate(`/projects/${project.projectId}/calendario`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 16px" }}>Agenda e geração</h2>

      <Card style={{ padding: 20 }}>
        <form onSubmit={handleSubmit}>
          <div className="row">
            <div>
              <label htmlFor="gen-days">Dias</label>
              <input id="gen-days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div>
              <label htmlFor="gen-start-date">Data inicial</label>
              <input id="gen-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>

          <div className="row">
            <div>
              <label htmlFor="gen-stories-per-day">Stories por dia</label>
              <input
                id="gen-stories-per-day"
                type="number"
                min={1}
                max={20}
                value={storiesPerDay}
                onChange={(e) => setStoriesPerDay(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="gen-start-time">Horário inicial</label>
              <input id="gen-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>

          {activeProductCount === 0 ? (
            <div className="notice" style={{ marginTop: 10, borderColor: "rgba(245,158,11,.5)" }}>
              <b>Nenhum produto em estoque cadastrado.</b>
              <br />
              <span className="muted">
                Vá em “Produtos” e cadastre pelo menos um produto com foto real e marque como “em estoque”.
              </span>
            </div>
          ) : null}

          <div className="notice" style={{ marginTop: 10 }}>
            <b>Sem geração por IA na imagem: usa a foto real de cada produto.</b>
            <br />
            <span className="muted">
              O sistema faz o rodízio dos produtos em estoque no Instagram Story, compondo a foto real com nome e preço —
              a legenda continua sendo escrita por IA a partir do que foi cadastrado. Quando um produto sair do estoque,
              basta marcar “inativo” (ou apagar) no cadastro dele em “Produtos”.
            </span>
          </div>

          <Button type="submit" className="full-width" style={{ marginTop: 10 }} disabled={busy}>
            {busy ? "Organizando agenda..." : "Gerar conteúdos"}
          </Button>
        </form>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>
    </div>
  );
}

interface FormatState {
  channel: string;
  enabled: boolean;
  postsPerDay: string;
  everyDays: string;
  startTime: string;
  intervalMinutes: string;
}

const DEFAULT_FORMATS: FormatState[] = [
  { channel: "instagram_story", enabled: true, postsPerDay: "3", everyDays: "1", startTime: "09:00", intervalMinutes: "240" },
  { channel: "instagram_feed", enabled: true, postsPerDay: "1", everyDays: "2", startTime: "12:00", intervalMinutes: "0" },
  { channel: "instagram_reels", enabled: false, postsPerDay: "1", everyDays: "1", startTime: "18:00", intervalMinutes: "0" },
  { channel: "facebook_feed", enabled: false, postsPerDay: "1", everyDays: "2", startTime: "12:00", intervalMinutes: "0" },
  { channel: "facebook_story", enabled: false, postsPerDay: "1", everyDays: "1", startTime: "09:00", intervalMinutes: "240" },
];

export function GenerateContent() {
  const { project } = useOutletContext<WorkspaceContext>();
  return project.projectType === "catalog" ? <GenerateCatalogContent /> : <GenerateMarketingContent />;
}

// Split into its own component (rather than an early-return inside
// GenerateContent) so each mode's hooks aren't conditionally skipped —
// GenerateContent itself only ever calls useOutletContext.
function GenerateMarketingContent() {
  const { project } = useOutletContext<WorkspaceContext>();
  const navigate = useNavigate();
  const [days, setDays] = useState("7");
  const [startDate, setStartDate] = useState("");
  const [formats, setFormats] = useState<FormatState[]>(DEFAULT_FORMATS);
  const [contentRules, setContentRules] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeOfferCount = (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false).length;

  function updateFormat(channel: string, patch: Partial<FormatState>) {
    setFormats((current) => current.map((f) => (f.channel === channel ? { ...f, ...patch } : f)));
  }

  function enableGroup(channels: string[]) {
    setFormats((current) => current.map((f) => (channels.includes(f.channel) ? { ...f, enabled: true } : f)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const enabled = formats.filter((f) => f.enabled);
    if (!enabled.length) {
      setError("Marque pelo menos um formato.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payloadFormats: GenerateFormatInput[] = enabled.map((f) => ({
        channel: f.channel,
        postsPerDay: f.postsPerDay,
        everyDays: f.everyDays,
        startTime: f.startTime,
        intervalMinutes: f.intervalMinutes,
      }));
      await generateContent(project.projectId, { days, startDate, formats: payloadFormats, contentRules });
      navigate(`/projects/${project.projectId}/calendario`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 16px" }}>Agenda e geração</h2>

      <Card style={{ padding: 20 }}>
        <form onSubmit={handleSubmit}>
          <div className="row">
            <div>
              <label htmlFor="gen-days">Dias</label>
              <input id="gen-days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div>
              <label htmlFor="gen-start-date">Data inicial</label>
              <input id="gen-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>

          <h3 className="section-heading">Organizar por formato</h3>
          <p className="muted">
            Configure quantas vezes por dia e o intervalo. Use “Dia sim/dia não” no Feed colocando A cada 2 dias.
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <Button type="button" variant="secondary" onClick={() => enableGroup(VERTICAL_CREATIVE_CHANNELS)}>
              Marcar todos os Stories
            </Button>
            <Button type="button" variant="secondary" onClick={() => enableGroup(FEED_CREATIVE_CHANNELS)}>
              Marcar Feed + Facebook Feed
            </Button>
          </div>

          <div className={styles.formatGrid}>
            {formats.map((format) => (
              <div key={format.channel} className={`${styles.formatCard} ${format.enabled ? styles.formatCardEnabled : ""}`.trim()}>
                <label className={styles.formatCheckbox}>
                  <input
                    type="checkbox"
                    checked={format.enabled}
                    onChange={(e) => updateFormat(format.channel, { enabled: e.target.checked })}
                  />
                  {channelFullLabel(format.channel)}
                </label>
                <div className="row">
                  <div>
                    <label htmlFor={`${format.channel}-count`}>Vezes por dia</label>
                    <input
                      id={`${format.channel}-count`}
                      type="number"
                      min={1}
                      max={12}
                      value={format.postsPerDay}
                      onChange={(e) => updateFormat(format.channel, { postsPerDay: e.target.value })}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${format.channel}-every`}>A cada quantos dias</label>
                    <input
                      id={`${format.channel}-every`}
                      type="number"
                      min={1}
                      max={30}
                      value={format.everyDays}
                      onChange={(e) => updateFormat(format.channel, { everyDays: e.target.value })}
                    />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <label htmlFor={`${format.channel}-time`}>Horário inicial</label>
                    <input
                      id={`${format.channel}-time`}
                      type="time"
                      value={format.startTime}
                      onChange={(e) => updateFormat(format.channel, { startTime: e.target.value })}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${format.channel}-interval`}>Intervalo em minutos</label>
                    <input
                      id={`${format.channel}-interval`}
                      type="number"
                      min={0}
                      max={1440}
                      value={format.intervalMinutes}
                      onChange={(e) => updateFormat(format.channel, { intervalMinutes: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <label htmlFor="gen-content-rules">Regra só deste lote</label>
          <textarea
            id="gen-content-rules"
            placeholder="Ex: tom mais emocional, foco em autoridade..."
            value={contentRules}
            onChange={(e) => setContentRules(e.target.value)}
          />

          {activeOfferCount === 0 ? (
            <div className="notice" style={{ marginTop: 10, borderColor: "rgba(245,158,11,.5)" }}>
              <b>Nenhum assunto/oferta cadastrado para este projeto.</b>
              <br />
              <span className="muted">
                Sem isso, o conteúdo sai genérico (a IA improvisa um tipo de post padrão, tipo “urgência do dia”, que pode não
                fazer sentido pro seu negócio). Vá em “Ofertas e assuntos” e cadastre pelo menos um — se a empresa não tem
                oferta com preço, use os tipos “Institucional”, “Prova social”, “Produto/serviço destaque” ou “Post de
                orientação”.
              </span>
            </div>
          ) : null}

          <div className="notice" style={{ marginTop: 10 }}>
            <b>Isso já gera a imagem final com IA para cada card.</b>
            <br />
            <span className="muted">
              Cada imagem leva de ~30s a alguns minutos, então um lote com vários dias/formatos pode demorar — a tela fica
              ocupada até terminar. Se algum card não gostar, dá pra regenerar só a imagem dele depois, sem refazer o lote
              inteiro. Formatos do mesmo tamanho marcados juntos (Instagram Stories + Reels + Facebook Story, ou Instagram
              Feed + Facebook Feed) usam automaticamente o mesmo criativo, sem gerar imagem repetida — regenerar um card
              desses individualmente só afeta aquele card.
            </span>
          </div>

          <Button type="submit" className="full-width" style={{ marginTop: 10 }} disabled={busy}>
            {busy ? "Organizando agenda..." : "Gerar conteúdos"}
          </Button>
        </form>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>
    </div>
  );
}
