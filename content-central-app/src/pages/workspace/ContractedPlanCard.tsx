import { useState } from "react";
import { saveContractedPlan, type ContractedPlan, type ProjectSummary } from "@/api/client";
import { Button } from "@/components/Button";

const STORY_CHANNELS: Array<[string, string]> = [["instagram_story", "Instagram"], ["facebook_story", "Facebook"], ["whatsapp_status", "Status do WhatsApp"]];
const FEED_CHANNELS: Array<[string, string]> = [["instagram_feed", "Instagram"], ["facebook_feed", "Facebook"]];
const START: ContractedPlan = {
  storiesPerDay: 0, feedsPerWeek: 0, storyChannels: ["instagram_story", "facebook_story"], feedChannels: ["instagram_feed", "facebook_feed"], flyersPerMonth: 0,
};

interface Props {
  project: ProjectSummary;
  refreshProject: () => Promise<void>;
}

// What the client bought, filled in by hand. The cérebro plans exactly this;
// a story is one art on every channel checked.
export function ContractedPlanCard({ project, refreshProject }: Props) {
  const [plan, setPlan] = useState<ContractedPlan>(project.contractedPlan || START);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(next: Partial<ContractedPlan>) {
    setSaved(false);
    setPlan((current) => ({ ...current, ...next }));
  }

  function toggle(field: "storyChannels" | "feedChannels", channel: string, order: Array<[string, string]>) {
    const has = plan[field].includes(channel);
    const set = new Set(has ? plan[field].filter((entry) => entry !== channel) : [...plan[field], channel]);
    update({ [field]: order.map(([id]) => id).filter((id) => set.has(id)) });
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveContractedPlan(project.projectId, plan);
      await refreshProject();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const number = (label: string, field: "storiesPerDay" | "feedsPerWeek" | "flyersPerMonth", max: number) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 140 }}>{label}</span>
      <input type="number" aria-label={label} min={0} max={max} value={plan[field]} onChange={(e) => update({ [field]: Number(e.target.value) || 0 })} style={{ width: 80 }} />
    </label>
  );

  return (
    <div className="field-card" style={{ marginTop: 14 }}>
      <b>Plano contratado</b>
      <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
        O que o cliente comprou. O cérebro monta a semana exatamente assim. Encartes são feitos à mão: ele só lembra.
        {project.contractedPlan ? null : " Ainda não configurado."}
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {number("Stories por dia", "storiesPerDay", 10)}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {STORY_CHANNELS.map(([id, name]) => (
            <label key={id}>
              <input type="checkbox" aria-label={`Story no ${name}`} checked={plan.storyChannels.includes(id)} onChange={() => toggle("storyChannels", id, STORY_CHANNELS)} /> {name}
            </label>
          ))}
        </div>
        {number("Feed por semana", "feedsPerWeek", 14)}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {FEED_CHANNELS.map(([id, name]) => (
            <label key={id}>
              <input type="checkbox" aria-label={`Feed no ${name}`} checked={plan.feedChannels.includes(id)} onChange={() => toggle("feedChannels", id, FEED_CHANNELS)} /> {name}
            </label>
          ))}
        </div>
        {number("Encartes por mês", "flyersPerMonth", 31)}
      </div>
      {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
      {saved ? <p className="muted" style={{ marginTop: 10 }}>Plano salvo.</p> : null}
      <Button type="button" style={{ marginTop: 10 }} disabled={busy} onClick={() => void handleSave()}>
        Salvar plano contratado
      </Button>
    </div>
  );
}
