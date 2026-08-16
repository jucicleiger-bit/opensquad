import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  generateCatalogContent,
  generateContent,
  generateSpecialDateContent,
  listCommemorativeDates,
  previewContentPlan,
  type CommemorativeDate,
  type GenerateFormatInput,
  type GenerateContentInput,
  type PlannedContentSchedule,
} from "@/api/client";
import { channelFullLabel, FEED_CREATIVE_CHANNELS, VERTICAL_CREATIVE_CHANNELS } from "./contentDisplay";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChannelCheckboxGroup } from "@/components/ChannelCheckboxGroup";
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
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Agenda e geração</h2>

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

const PT_MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatCommemorativeDate(dateString: string): string {
  const [, month, day] = dateString.split("-").map(Number);
  return `${day} de ${PT_MONTH_NAMES[month - 1]}`;
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

// Datas comemorativas / data personalizada don't need the per-format
// count/interval/time fields the main agenda form does — just the plain
// list of channel codes to offer as checkboxes.
const CHANNEL_CODES = DEFAULT_FORMATS.map((format) => format.channel);

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
  const [plannedSchedule, setPlannedSchedule] = useState<PlannedContentSchedule | null>(null);
  const [plannedPayload, setPlannedPayload] = useState<GenerateContentInput | null>(null);

  const activeOfferCount = (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false).length;
  const offerGroups = project.contentStrategy?.offerGroups || [];
  // Empty selection = no filter, every active offer competes for a slot
  // (today's behavior). Selecting one or more groups scopes this specific
  // generation to just those groups' offers, without touching any offer's
  // `active` flag — e.g. a client wants this week focused only on the
  // "Black Friday" group.
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  // Only meaningful (and only shown) once at least one group is selected —
  // "gera só isso, não intercala com autoridade/engajamento etc." for a
  // batch that needs to be 100% e.g. "Promoção fim de semana".
  const [offersOnly, setOffersOnly] = useState(false);

  // Feriados nacionais + datas comerciais (Dia das Mães, Black Friday etc.)
  // pros próximos meses — uma arte avulsa pra qualquer uma delas roda
  // independente da fila normal de ofertas/pilares, não muda nada dela.
  const [commemorativeDates, setCommemorativeDates] = useState<CommemorativeDate[] | null>(null);
  const [specialDateChannels, setSpecialDateChannels] = useState<Record<string, Set<string>>>({});
  const [specialDateState, setSpecialDateState] = useState<Record<string, { busy: boolean; error: string | null }>>({});

  // Feriado regional/evento local não entra na lista automática (só temos o
  // calendário nacional) — esse formulário cobre exatamente isso: mesma
  // engine (generateSpecialDateContent), só que com data/hora/nome digitados
  // pelo operador em vez de vir da lista pronta.
  const [customLabel, setCustomLabel] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");
  const [customChannels, setCustomChannels] = useState<Set<string>>(new Set(["instagram_story"]));
  const [customState, setCustomState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  useEffect(() => {
    let cancelled = false;
    listCommemorativeDates(project.projectId, 3)
      .then((res) => {
        if (!cancelled) setCommemorativeDates(res.dates || []);
      })
      .catch(() => {
        if (!cancelled) setCommemorativeDates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectId]);

  function specialDateKey(entry: CommemorativeDate) {
    return `${entry.date}__${entry.label}`;
  }

  function channelsFor(key: string): Set<string> {
    return specialDateChannels[key] || new Set(["instagram_story"]);
  }

  function toggleSpecialDateChannel(key: string, channel: string) {
    setSpecialDateChannels((current) => {
      const next = new Set(channelsFor(key));
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return { ...current, [key]: next };
    });
  }

  // Shared by the list above and the custom-date form below — one card per
  // selected format (Story, Feed, Reels...), same "Ambos" idea already used
  // for criativos de anúncio. All selected formats go in a single call so
  // same-shape channels (Story/Reels/Facebook Story, or Feed/Facebook Feed)
  // share one generated creative on the backend instead of each format
  // paying for its own separate AI generation.
  async function createSpecialDateCards(date: string, label: string, channels: Set<string>, postTime?: string) {
    await generateSpecialDateContent(project.projectId, {
      date,
      label,
      channels: Array.from(channels),
      postTime: postTime || undefined,
    });
  }

  async function handleCreateSpecialDate(entry: CommemorativeDate) {
    const key = specialDateKey(entry);
    const channels = channelsFor(key);
    if (!channels.size) {
      setSpecialDateState((current) => ({ ...current, [key]: { busy: false, error: "Marque pelo menos um formato." } }));
      return;
    }
    setSpecialDateState((current) => ({ ...current, [key]: { busy: true, error: null } }));
    try {
      await createSpecialDateCards(entry.date, entry.label, channels);
      navigate(`/projects/${project.projectId}/calendario`);
    } catch (err) {
      setSpecialDateState((current) => ({ ...current, [key]: { busy: false, error: (err as Error).message } }));
    }
  }

  function toggleCustomChannel(channel: string) {
    setCustomChannels((current) => {
      const next = new Set(current);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  }

  async function handleCreateCustomDate() {
    if (!customLabel.trim() || !customDate) {
      setCustomState({ busy: false, error: "Preencha o nome e a data." });
      return;
    }
    if (!customChannels.size) {
      setCustomState({ busy: false, error: "Marque pelo menos um formato." });
      return;
    }
    setCustomState({ busy: true, error: null });
    try {
      await createSpecialDateCards(customDate, customLabel.trim(), customChannels, customTime || undefined);
      navigate(`/projects/${project.projectId}/calendario`);
    } catch (err) {
      setCustomState({ busy: false, error: (err as Error).message });
    }
  }

  function toggleGroupFilter(groupId: string) {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function updateFormat(channel: string, patch: Partial<FormatState>) {
    setFormats((current) => current.map((f) => (f.channel === channel ? { ...f, ...patch } : f)));
  }

  function enableGroup(channels: string[]) {
    setFormats((current) => current.map((f) => (channels.includes(f.channel) ? { ...f, enabled: true } : f)));
  }

  function buildGenerateInput(): GenerateContentInput | null {
    const enabled = formats.filter((f) => f.enabled);
    if (!enabled.length) {
      setError("Marque pelo menos um formato.");
      return null;
    }
    const payloadFormats: GenerateFormatInput[] = enabled.map((f) => ({
      channel: f.channel,
      postsPerDay: f.postsPerDay,
      everyDays: f.everyDays,
      startTime: f.startTime,
      intervalMinutes: f.intervalMinutes,
    }));
    return {
      days,
      startDate,
      formats: payloadFormats,
      contentRules,
      groupIds: selectedGroupIds.size ? [...selectedGroupIds] : undefined,
      offersOnly: selectedGroupIds.size > 0 && offersOnly,
    };
  }

  async function createCommemorativeExtrasFromPlan(plan: PlannedContentSchedule) {
    const byDateAndLabel = new Map<string, { date: string; label: string; channels: Set<string>; postTime?: string }>();
    for (const day of plan.dayPlans) {
      for (const extra of day.extras || []) {
        const label = (extra.label || "").replace(/^Extra —\s*/, "") || extra.specialDateLabel || "Data comemorativa";
        const key = `${extra.date}__${label}`;
        const entry = byDateAndLabel.get(key) || { date: extra.date, label, channels: new Set<string>(), postTime: extra.scheduledTime };
        entry.channels.add(extra.channel);
        byDateAndLabel.set(key, entry);
      }
    }
    for (const extra of byDateAndLabel.values()) {
      await generateSpecialDateContent(project.projectId, {
        date: extra.date,
        label: extra.label,
        channels: Array.from(extra.channels),
        postTime: extra.postTime,
      });
    }
  }

  async function generateFromPayload(payload: GenerateContentInput, plan?: PlannedContentSchedule | null) {
    await generateContent(project.projectId, payload);
    if (plan?.extraCount) await createCommemorativeExtrasFromPlan(plan);
    navigate(`/projects/${project.projectId}/calendario`);
  }

  async function handlePlanAgenda() {
    const payload = buildGenerateInput();
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      const { plan } = await previewContentPlan(project.projectId, payload);
      setPlannedSchedule(plan);
      setPlannedPayload(payload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updatePlannedSlot(dayIndex: number, section: "regular" | "extras", slotIndex: number, updates: { label?: string; reason?: string }) {
    setPlannedSchedule((current) => {
      if (!current) return current;
      return {
        ...current,
        dayPlans: current.dayPlans.map((day, index) => {
          if (index !== dayIndex) return day;
          return {
            ...day,
            [section]: day[section].map((slot, itemIndex) => (itemIndex === slotIndex ? { ...slot, ...updates } : slot)),
          };
        }),
      };
    });
  }

  async function handleGenerateApprovedPlan() {
    if (!plannedPayload || !plannedSchedule) return;
    setBusy(true);
    setError(null);
    try {
      await generateFromPayload({ ...plannedPayload, approvedPlan: plannedSchedule }, plannedSchedule);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const payload = buildGenerateInput();
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      await generateFromPayload(payload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Agenda e geração</h2>

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

          {offerGroups.length > 0 ? (
            <>
              <h3 className="section-heading">Grupos de oferta</h3>
              <p className="muted">
                Deixe tudo desmarcado pra usar todas as ofertas ativas (padrão). Marque um ou mais grupos pra gerar
                esse lote só com eles — os objetivos de conteúdo (engajamento, autoridade etc.) continuam funcionando
                normal, só as ofertas ficam filtradas.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {offerGroups.map((group) => (
                  <label key={group.id} className="pill" style={{ width: "max-content" }}>
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.has(group.id)}
                      onChange={() => toggleGroupFilter(group.id)}
                    />
                    {group.name}
                  </label>
                ))}
              </div>

              {selectedGroupIds.size > 0 ? (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <input type="checkbox" checked={offersOnly} onChange={(e) => setOffersOnly(e.target.checked)} />
                  Gerar só com esse grupo, sem misturar outros objetivos (autoridade, engajamento etc.)
                </label>
              ) : null}
            </>
          ) : null}

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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <Button type="button" className="full-width" style={{ flex: 1 }} disabled={busy} onClick={handlePlanAgenda}>
              {busy ? "Pensando agenda..." : "Planejar agenda"}
            </Button>
            <Button type="submit" variant="secondary" style={{ flex: 1 }} disabled={busy}>
              {busy ? "Organizando agenda..." : "Gerar conteúdos"}
            </Button>
          </div>
        </form>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>

      {plannedSchedule ? (
        <Card style={{ padding: 20, marginTop: 20 }}>
          <h3 className="section-heading" style={{ marginTop: 0 }}>Resumo do que será postado</h3>
          <p className="muted" style={{ marginTop: 0 }}>{plannedSchedule.summary}</p>
          {plannedSchedule.rules?.offersOnly ? (
            <div className="notice" style={{ marginBottom: 12 }}>
              Gerando apenas o(s) grupo(s) selecionado(s). Datas comemorativas entram como extras por fora da contagem.
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 12 }}>
            {plannedSchedule.dayPlans.map((day, dayIndex) => (
              <div key={day.date} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
                <h4 style={{ margin: "0 0 8px" }}>Dia {day.dayNumber} — {formatCommemorativeDate(day.date)}</h4>
                <div style={{ display: "grid", gap: 8 }}>
                  {day.regular.map((item, itemIndex) => (
                    <div key={item.id} style={{ display: "grid", gap: 6 }}>
                      <strong>{item.channelLabel}{item.price ? ` — ${item.price}` : ""}</strong>
                      <label>
                        Assunto
                        <input
                          aria-label={`Editar assunto ${item.id}`}
                          value={item.label || ""}
                          onChange={(event) => updatePlannedSlot(dayIndex, "regular", itemIndex, { label: event.target.value })}
                        />
                      </label>
                      <label>
                        Orientação para este card
                        <textarea
                          aria-label={`Editar orientação ${item.id}`}
                          value={item.reason || ""}
                          onChange={(event) => updatePlannedSlot(dayIndex, "regular", itemIndex, { reason: event.target.value })}
                          rows={2}
                        />
                      </label>
                    </div>
                  ))}
                  {day.extras.map((item, itemIndex) => (
                    <div key={item.id} className="notice" style={{ marginTop: 4 }}>
                      <strong>{item.channelLabel}: extra</strong>
                      <label>
                        Data comemorativa
                        <input
                          aria-label={`Editar extra ${item.id}`}
                          value={item.label || ""}
                          onChange={(event) => updatePlannedSlot(dayIndex, "extras", itemIndex, { label: event.target.value, reason: item.reason })}
                        />
                      </label>
                      <br />
                      <span className="muted">Extra de data comemorativa — não desconta dos posts normais do dia.</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button type="button" className="full-width" style={{ marginTop: 12 }} disabled={busy} onClick={handleGenerateApprovedPlan}>
            {busy ? "Gerando conteúdos..." : "Gerar conteúdos aprovados"}
          </Button>
        </Card>
      ) : null}

      <Card style={{ padding: 20, marginTop: 20 }}>
        <h3 className="section-heading" style={{ marginTop: 0 }}>Datas comemorativas</h3>
        <p className="muted">
          Feriados nacionais e datas comerciais dos próximos meses. Criar uma arte aqui roda por fora da agenda normal —
          não mexe nas ofertas, pilares nem no rodízio de conteúdo, é só pra movimentar o Instagram naquele período.
        </p>
        {commemorativeDates === null ? (
          <p className="muted">Carregando datas...</p>
        ) : commemorativeDates.length === 0 ? (
          <p className="muted">Nenhuma data nos próximos meses.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {commemorativeDates.map((entry) => {
              const key = specialDateKey(entry);
              const state = specialDateState[key] || { busy: false, error: null };
              const channels = channelsFor(key);
              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <span style={{ minWidth: 90, fontWeight: 700 }}>{formatCommemorativeDate(entry.date)}</span>
                  <span style={{ flex: 1, minWidth: 140 }}>{entry.label}</span>
                  <span className="pill">{entry.kind === "holiday" ? "Feriado" : "Comercial"}</span>
                  <ChannelCheckboxGroup
                    channels={CHANNEL_CODES}
                    selected={channels}
                    onToggle={(channel) => toggleSpecialDateChannel(key, channel)}
                    ariaLabel={(channel) => `${channelFullLabel(channel)} para ${entry.label}`}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={state.busy}
                    onClick={() => handleCreateSpecialDate(entry)}
                  >
                    {state.busy ? "Criando..." : "Criar arte pra essa data"}
                  </Button>
                  {state.error ? <div className="pill bad">{state.error}</div> : null}
                </div>
              );
            })}
          </div>
        )}

        <h4 style={{ marginTop: 20, marginBottom: 4 }}>Data personalizada</h4>
        <p className="muted" style={{ marginTop: 0 }}>
          Feriado regional, evento local ou qualquer outra data que não está na lista automática (que hoje cobre só o
          calendário nacional).
        </p>
        <div className="row">
          <div>
            <label htmlFor="custom-date-label">Nome da data</label>
            <input
              id="custom-date-label"
              placeholder="Ex: Aniversário da cidade"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="custom-date-date">Data</label>
            <input id="custom-date-date" type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="custom-date-time">Horário (opcional)</label>
            <input id="custom-date-time" type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <ChannelCheckboxGroup
            channels={CHANNEL_CODES}
            selected={customChannels}
            onToggle={toggleCustomChannel}
            ariaLabel={(channel) => `${channelFullLabel(channel)} (data personalizada)`}
          />
        </div>
        <Button type="button" variant="secondary" disabled={customState.busy} onClick={handleCreateCustomDate}>
          {customState.busy ? "Criando..." : "Criar arte pra essa data"}
        </Button>
        {customState.error ? <div className="pill bad" style={{ marginTop: 8 }}>{customState.error}</div> : null}
      </Card>
    </div>
  );
}
