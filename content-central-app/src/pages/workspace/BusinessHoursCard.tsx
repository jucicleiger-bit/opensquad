import { useState } from "react";
import { saveBusinessHours, type BusinessHours, type BusinessPeriod, type ProjectSummary } from "@/api/client";
import { Button } from "@/components/Button";

type Day = keyof BusinessHours;

const DAYS: Array<[Day, string]> = [
  ["mon", "segunda"], ["tue", "terça"], ["wed", "quarta"], ["thu", "quinta"], ["fri", "sexta"], ["sat", "sábado"], ["sun", "domingo"],
];
const CLOSED: BusinessHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

interface Props {
  project: ProjectSummary;
  refreshProject: () => Promise<void>;
}

// The cérebro only plans posts while the shop is open; "Agenda e geração"
// only warns. Up to two periods a day (e.g. a lunch break).
export function BusinessHoursCard({ project, refreshProject }: Props) {
  const [hours, setHours] = useState<BusinessHours>(project.businessHours || CLOSED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setDay(day: Day, periods: BusinessPeriod[]) {
    setSaved(false);
    setHours((current) => ({ ...current, [day]: periods }));
  }

  function setPeriod(day: Day, index: number, field: keyof BusinessPeriod, value: string) {
    setDay(day, hours[day].map((period, i) => (i === index ? { ...period, [field]: value } : period)));
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveBusinessHours(project.projectId, hours);
      await refreshProject();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-card" style={{ marginTop: 14 }}>
      <b>Horário de funcionamento</b>
      <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
        O cérebro só programa posts nos horários em que a loja está aberta. Dia sem período fica fechado.
        {project.businessHours ? null : " Ainda não configurado."}
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {DAYS.map(([day, label]) => (
          <div key={day} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ width: 72, textTransform: "capitalize" }}>{label}</span>
            {hours[day].length === 0 ? <span className="muted">Fechado</span> : null}
            {hours[day].map((period, index) => (
              <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input type="time" aria-label={`${label}, período ${index + 1}, abre`} value={period.from} onChange={(e) => setPeriod(day, index, "from", e.target.value)} />
                <span className="muted">às</span>
                <input type="time" aria-label={`${label}, período ${index + 1}, fecha`} value={period.to} onChange={(e) => setPeriod(day, index, "to", e.target.value)} />
                <Button type="button" variant="secondary" aria-label={`Tirar período ${index + 1} de ${label}`} onClick={() => setDay(day, hours[day].filter((_, i) => i !== index))}>
                  ×
                </Button>
              </span>
            ))}
            {hours[day].length < 2 ? (
              <Button
                type="button"
                variant="secondary"
                aria-label={hours[day].length ? `Mais um período na ${label}` : `Abrir ${label}`}
                onClick={() => setDay(day, [...hours[day], hours[day].length ? { from: "13:00", to: "18:00" } : { from: "08:00", to: "18:00" }])}
              >
                {hours[day].length ? "+ período" : "Abrir"}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
      {saved ? <p className="muted" style={{ marginTop: 10 }}>Horário salvo.</p> : null}
      <Button type="button" style={{ marginTop: 10 }} disabled={busy} onClick={() => void handleSave()}>
        Salvar horário
      </Button>
    </div>
  );
}
