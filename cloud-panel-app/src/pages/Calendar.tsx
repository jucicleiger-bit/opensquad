// src/pages/Calendar.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { groupByDay } from "@/lib/groupByDay";

interface ScheduleRow {
  id: string;
  run_at: string;
  status: string;
  content_items: { id: string; channel: string; status: string; content_id: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Agendado",
  running: "Publicando...",
  done: "Publicado",
  error: "Erro",
};

export function CalendarPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("schedules")
      .select("id, run_at, status, content_items!inner(id, channel, status, content_id)")
      .eq("content_items.project_id", projectId)
      .order("run_at");
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setRows(data as unknown as ScheduleRow[]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function reschedule(row: ScheduleRow, newDate: string) {
    if (!newDate) return;
    const currentTime = row.run_at.slice(11, 16);
    const newRunAt = new Date(`${newDate}T${currentTime}:00`).toISOString();
    setBusyId(row.id);
    await supabase.from("schedules").update({ run_at: newRunAt }).eq("id", row.id);
    await load();
    setBusyId(null);
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!rows) return <div className="card">Carregando...</div>;

  const groups = groupByDay(rows, (row) => row.run_at.slice(0, 10));

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Calendário</h1>
      {groups.length === 0 ? <p>Nada agendado.</p> : null}
      {groups.map((group) => (
        <section key={group.day}>
          <h2>{group.day}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {group.items.map((row) => (
              <div key={row.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{row.content_items?.channel}</strong> — {STATUS_LABEL[row.status] || row.status}
                  <br />
                  <span style={{ color: "var(--text-dim)" }}>{row.run_at.slice(11, 16)}</span>
                </div>
                {row.status === "pending" ? (
                  <input
                    type="date"
                    defaultValue={row.run_at.slice(0, 10)}
                    disabled={busyId === row.id}
                    onChange={(e) => reschedule(row, e.target.value)}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
