import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

const CHANNEL_LABELS: Record<string, string> = {
  instagram_feed: "Feed",
  instagram_story: "Story",
  instagram_reels: "Reels",
  facebook_feed: "FB Feed",
  facebook_story: "FB Story",
  whatsapp_status: "Status (beta)",
};

interface FormatState {
  channel: string;
  enabled: boolean;
  postsPerDay: string;
  everyDays: string;
  startTime: string;
  intervalMinutes: string;
}

// Mirrors content-central-app/src/pages/workspace/GenerateContent.tsx's
// DEFAULT_FORMATS verbatim — same defaults, same channel set, so a
// remote-triggered generation behaves the same as a local one out of the
// box.
const DEFAULT_FORMATS: FormatState[] = [
  { channel: "instagram_story", enabled: true, postsPerDay: "3", everyDays: "1", startTime: "09:00", intervalMinutes: "240" },
  { channel: "instagram_feed", enabled: true, postsPerDay: "1", everyDays: "2", startTime: "12:00", intervalMinutes: "0" },
  { channel: "instagram_reels", enabled: false, postsPerDay: "1", everyDays: "1", startTime: "18:00", intervalMinutes: "0" },
  { channel: "facebook_feed", enabled: false, postsPerDay: "1", everyDays: "2", startTime: "12:00", intervalMinutes: "0" },
  { channel: "facebook_story", enabled: false, postsPerDay: "1", everyDays: "1", startTime: "09:00", intervalMinutes: "240" },
  { channel: "whatsapp_status", enabled: false, postsPerDay: "1", everyDays: "1", startTime: "09:00", intervalMinutes: "0" },
];

interface OfferGroup {
  id: string;
  name: string;
}

interface PlannedContentSlot {
  id: string;
  dayNumber: number;
  date: string;
  scheduledTime: string;
  channel: string;
  channelLabel: string;
  slotNumber: number;
  kind: string;
  source: string;
  label: string;
  offerId?: string | null;
  offerName?: string;
  reason?: string;
  extra?: boolean;
}

interface PlannedContentDay {
  dayNumber: number;
  date: string;
  regular: PlannedContentSlot[];
  extras: PlannedContentSlot[];
}

interface PlannedContentSchedule {
  projectId: string;
  projectName: string;
  startDate: string;
  days: number;
  regularCount: number;
  extraCount: number;
  summary: string;
  dayPlans: PlannedContentDay[];
  rules: { groupIds: string[]; offersOnly: boolean; usesBrandXray: boolean; extraDatesDoNotConsumeDailyQuota: boolean };
}

interface JobResult {
  itemCount: number;
  syncedCount: number;
  errors: Array<{ contentId?: string | null; error: string }>;
}

type Stage = "form" | "waiting-preview" | "preview" | "waiting-generate" | "done" | "error";

interface JobRequestFields {
  projectSlug: string;
  days: number;
  startDate: string;
  formats: Array<Omit<FormatState, "enabled">>;
  contentRules: string;
  groupIds: string[];
  offersOnly: boolean;
  carouselsPerWeek: string;
  maxCarouselSlides: string;
}

export function GenerateContent() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [days, setDays] = useState("7");
  const [startDate, setStartDate] = useState("");
  const [formats, setFormats] = useState<FormatState[]>(DEFAULT_FORMATS);
  const [contentRules, setContentRules] = useState("");
  const [offerGroups, setOfferGroups] = useState<OfferGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [offersOnly, setOffersOnly] = useState(false);
  const [carouselsPerWeek, setCarouselsPerWeek] = useState("0");
  const [maxCarouselSlides, setMaxCarouselSlides] = useState("6");

  const [stage, setStage] = useState<Stage>("form");
  const [plan, setPlan] = useState<PlannedContentSchedule | null>(null);
  const [editedSlots, setEditedSlots] = useState<Record<string, { label: string; reason: string }>>({});
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("projects").select("content_strategy").eq("id", project.id).single().then(({ data }) => {
      const groups = data?.content_strategy?.offerGroups;
      setOfferGroups(Array.isArray(groups) ? groups.map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })) : []);
    });
  }, [project.id]);

  function toggleFormat(channel: string) {
    setFormats((prev) => prev.map((format) => (format.channel === channel ? { ...format, enabled: !format.enabled } : format)));
  }
  function updateFormat(channel: string, field: keyof FormatState, value: string) {
    setFormats((prev) => prev.map((format) => (format.channel === channel ? { ...format, [field]: value } : format)));
  }

  function requestFields(): JobRequestFields {
    return {
      projectSlug: project.slug,
      days: Number(days),
      startDate,
      formats: formats.filter((format) => format.enabled).map(({ channel, postsPerDay, everyDays, startTime, intervalMinutes }) => ({ channel, postsPerDay, everyDays, startTime, intervalMinutes })),
      contentRules,
      groupIds: selectedGroupIds,
      offersOnly,
      carouselsPerWeek,
      maxCarouselSlides,
    };
  }

  async function pollJob(id: string, onDone: (payload: Record<string, unknown>) => void) {
    const { data, error: queryError } = await supabase.from("jobs").select("status, payload, error_message").eq("id", id).single();
    if (queryError) {
      setError(queryError.message);
      setStage("error");
      return;
    }
    if (data.status === "done") {
      onDone(data.payload as Record<string, unknown>);
      return;
    }
    if (data.status === "error") {
      setError(data.error_message || "Falha na geração.");
      setStage("error");
      return;
    }
    setTimeout(() => pollJob(id, onDone), 3000);
  }

  async function submitPreview(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const payload = { mode: "preview", ...requestFields() };
    const { data, error: insertError } = await supabase.from("jobs").insert([{ type: "art_generation", payload }]).select("id").single();
    if (insertError) {
      setError(insertError.message);
      setStage("error");
      return;
    }
    setStage("waiting-preview");
    pollJob(data.id, (donePayload) => {
      setPlan(donePayload.plan as PlannedContentSchedule);
      setEditedSlots({});
      setStage("preview");
    });
  }

  async function approvePlan() {
    if (!plan) return;
    setError(null);
    const approvedPlan = {
      ...plan,
      dayPlans: plan.dayPlans.map((day) => ({
        ...day,
        regular: day.regular.map((slot) => ({ ...slot, ...editedSlots[slot.id] })),
      })),
    };
    const payload = { mode: "generate", ...requestFields(), approvedPlan };
    const { data, error: insertError } = await supabase.from("jobs").insert([{ type: "art_generation", payload }]).select("id").single();
    if (insertError) {
      setError(insertError.message);
      setStage("error");
      return;
    }
    setStage("waiting-generate");
    pollJob(data.id, (donePayload) => {
      setResult(donePayload.result as JobResult);
      setStage("done");
    });
  }

  if (stage === "waiting-preview" || stage === "waiting-generate") {
    return (
      <Card style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 var(--space-sm)" }}>Gerar conteúdo</h2>
        <p className="muted">
          {stage === "waiting-preview" ? "Montando a prévia no seu PC..." : "Gerando o conteúdo no seu PC (pode levar alguns minutos)..."}
        </p>
      </Card>
    );
  }

  if (stage === "error") {
    return (
      <Card style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 var(--space-sm)" }}>Gerar conteúdo</h2>
        <p style={{ color: "var(--bad)" }}>{error}</p>
        <Button variant="secondary" onClick={() => setStage("form")}>Tentar de novo</Button>
      </Card>
    );
  }

  if (stage === "done") {
    return (
      <Card style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 var(--space-sm)" }}>Gerar conteúdo</h2>
        <p>{result?.itemCount ?? 0} peças geradas, {result?.syncedCount ?? 0} sincronizadas.</p>
        {result?.errors?.length ? (
          <ul>
            {result.errors.map((err, index) => <li key={index} className="muted">{err.error}</li>)}
          </ul>
        ) : null}
        <a href={`/projects/${project.id}/aguardando`}>Ver em Aguardando aprovação</a>
      </Card>
    );
  }

  if (stage === "preview" && plan) {
    return (
      <div>
        <h2 style={{ margin: "0 0 var(--space-lg)" }}>Gerar conteúdo — prévia</h2>
        <p className="muted">{plan.summary}</p>
        {plan.dayPlans.map((day) => (
          <Card key={day.dayNumber} style={{ padding: 20, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{day.date}</h3>
            {[...day.regular, ...day.extras].map((slot) => (
              <div key={slot.id} className="field-card" style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="muted">{slot.channelLabel} · {slot.scheduledTime}</div>
                <input
                  type="text"
                  value={editedSlots[slot.id]?.label ?? slot.label}
                  onChange={(e) => setEditedSlots((prev) => ({ ...prev, [slot.id]: { label: e.target.value, reason: prev[slot.id]?.reason ?? slot.reason ?? "" } }))}
                />
                <textarea
                  placeholder="Orientação (opcional)"
                  value={editedSlots[slot.id]?.reason ?? slot.reason ?? ""}
                  onChange={(e) => setEditedSlots((prev) => ({ ...prev, [slot.id]: { label: prev[slot.id]?.label ?? slot.label, reason: e.target.value } }))}
                />
              </div>
            ))}
          </Card>
        ))}
        <div className="button-row">
          <Button onClick={approvePlan}>Aprovar e gerar</Button>
          <Button variant="secondary" onClick={() => setStage("form")}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Gerar conteúdo</h2>
      <Card style={{ padding: 20 }}>
        <form onSubmit={submitPreview} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label>
              Dias
              <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <label>
              Data inicial
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
          </div>

          <div>
            <strong>Formatos</strong>
            {formats.map((format) => (
              <div key={format.channel} className="field-card" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={format.enabled} onChange={() => toggleFormat(format.channel)} />
                  {CHANNEL_LABELS[format.channel] || format.channel}
                </label>
                {format.enabled ? (
                  <>
                    <input type="number" min={1} value={format.postsPerDay} onChange={(e) => updateFormat(format.channel, "postsPerDay", e.target.value)} title="Posts por dia" style={{ width: 60 }} />
                    <input type="number" min={1} value={format.everyDays} onChange={(e) => updateFormat(format.channel, "everyDays", e.target.value)} title="A cada N dias" style={{ width: 60 }} />
                    <input type="time" value={format.startTime} onChange={(e) => updateFormat(format.channel, "startTime", e.target.value)} />
                    <input type="number" min={0} value={format.intervalMinutes} onChange={(e) => updateFormat(format.channel, "intervalMinutes", e.target.value)} title="Intervalo (min)" style={{ width: 70 }} />
                  </>
                ) : null}
              </div>
            ))}
          </div>

          <label>
            Regras de conteúdo
            <textarea value={contentRules} onChange={(e) => setContentRules(e.target.value)} />
          </label>

          {offerGroups.length ? (
            <div>
              <strong>Grupos de oferta</strong>
              {offerGroups.map((group) => (
                <label key={group.id} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={(e) => setSelectedGroupIds((prev) => (e.target.checked ? [...prev, group.id] : prev.filter((id) => id !== group.id)))}
                  />
                  {group.name}
                </label>
              ))}
              <label>
                <input type="checkbox" checked={offersOnly} onChange={(e) => setOffersOnly(e.target.checked)} /> Só ofertas selecionadas (sem posts de autoridade/engajamento)
              </label>
            </div>
          ) : null}

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label>
              Carrosséis por semana
              <input type="number" min={0} value={carouselsPerWeek} onChange={(e) => setCarouselsPerWeek(e.target.value)} />
            </label>
            <label>
              Máx. slides por carrossel
              <input type="number" min={2} max={10} value={maxCarouselSlides} onChange={(e) => setMaxCarouselSlides(e.target.value)} />
            </label>
          </div>

          <Button type="submit">Ver prévia</Button>
        </form>
      </Card>
    </div>
  );
}
