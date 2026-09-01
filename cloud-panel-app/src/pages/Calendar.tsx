// src/pages/Calendar.tsx
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { groupByDay } from "@/lib/groupByDay";
import { Card } from "@/components/Card";

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
  const { project } = useOutletContext<WorkspaceContext>();
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("schedules")
      .select("id, run_at, status, content_items!inner(id, channel, status, content_id)")
      .eq("content_items.project_id", project.id)
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
  }, [project.id]);

  async function reschedule(row: ScheduleRow, newDate: string) {
    if (!newDate) return;
    const currentTime = row.run_at.slice(11, 16);
    const newRunAt = new Date(`${newDate}T${currentTime}:00`).toISOString();
    setBusyId(row.id);
    await supabase.from("schedules").update({ run_at: newRunAt }).eq("id", row.id);
    await load();
    setBusyId(null);
  }

  if (error) return <Card style={{ padding: 20 }}>Erro: {error}</Card>;
  if (!rows) return <Card style={{ padding: 20 }}>Carregando...</Card>;

  const groups = groupByDay(rows, (row) => row.run_at.slice(0, 10));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ margin: 0 }}>Calendário</h2>
      </div>
      {groups.length === 0 ? <p>Nada agendado.</p> : null}
      {groups.map((group) => (
        <section key={group.day}>
          <h2>{group.day}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {group.items.map((row) => (
              <Card key={row.id} style={{ padding: 14 }}>
                <div>
                  <strong>{row.content_items?.channel}</strong> — {STATUS_LABEL[row.status] || row.status}
                  <br />
                  <span style={{ color: "var(--muted)" }}>{row.run_at.slice(11, 16)}</span>
                </div>
                {row.status === "pending" ? (
                  <input
                    type="date"
                    defaultValue={row.run_at.slice(0, 10)}
                    disabled={busyId === row.id}
                    onChange={(e) => reschedule(row, e.target.value)}
                  />
                ) : null}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
