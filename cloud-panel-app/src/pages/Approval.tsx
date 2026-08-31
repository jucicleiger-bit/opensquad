// src/pages/Approval.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { groupByDay } from "@/lib/groupByDay";

interface ContentItem {
  id: string;
  channel: string;
  status: string;
  copy: string | null;
  media_url: string | null;
  content_id: string | null;
  schedules: { run_at: string }[] | { run_at: string } | null;
}

function scheduledDate(item: ContentItem): string | null {
  const schedule = Array.isArray(item.schedules) ? item.schedules[0] : item.schedules;
  return schedule ? schedule.run_at.slice(0, 10) : null;
}

export function Approval() {
  const { projectId } = useParams<{ projectId: string }>();
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("content_items")
      .select("id, channel, status, copy, media_url, content_id, schedules(run_at)")
      .eq("project_id", projectId)
      .in("status", ["draft", "approved"]);
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setItems(data as ContentItem[]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function ensureSignedUrl(item: ContentItem) {
    if (!item.media_url || signedUrls[item.id]) return;
    const { data } = await supabase.storage.from("content-media").createSignedUrl(item.media_url, 300);
    if (data) setSignedUrls((prev) => ({ ...prev, [item.id]: data.signedUrl }));
  }

  async function approve(item: ContentItem) {
    setBusyId(item.id);
    await supabase.from("content_items").update({ status: "approved" }).eq("id", item.id);
    await load();
    setBusyId(null);
  }

  async function reject(item: ContentItem) {
    setBusyId(item.id);
    await supabase.from("content_items").update({ status: "cancelled" }).eq("id", item.id);
    await load();
    setBusyId(null);
  }

  async function saveCaption(item: ContentItem) {
    const text = drafts[item.id];
    if (text === undefined || text === (item.copy || "")) return;
    setBusyId(item.id);
    await supabase.from("content_items").update({ copy: text }).eq("id", item.id);
    await load();
    setBusyId(null);
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!items) return <div className="card">Carregando...</div>;

  const groups = groupByDay(items, scheduledDate);

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Aprovação</h1>
      {groups.length === 0 ? <p>Nada aguardando aprovação.</p> : null}
      {groups.map((group) => (
        <section key={group.day}>
          <h2>{group.day}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {group.items.map((item) => {
              const draft = drafts[item.id] ?? item.copy ?? "";
              const dirty = draft !== (item.copy || "");
              return (
                <div key={item.id} className="card">
                  <p>
                    <strong>{item.channel}</strong> — {item.status}
                  </p>
                  {item.media_url ? (
                    signedUrls[item.id] ? (
                      <img
                        src={signedUrls[item.id]}
                        alt={item.content_id || item.id}
                        style={{ maxWidth: "100%", borderRadius: 8 }}
                      />
                    ) : (
                      <button type="button" onClick={() => ensureSignedUrl(item)}>
                        Ver imagem
                      </button>
                    )
                  ) : null}
                  <textarea
                    rows={4}
                    value={draft}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    {dirty ? (
                      <button type="button" onClick={() => saveCaption(item)} disabled={busyId === item.id}>
                        Salvar legenda
                      </button>
                    ) : null}
                    {item.status !== "approved" ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => approve(item)}
                        disabled={busyId === item.id}
                      >
                        Aprovar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="danger"
                      onClick={() => reject(item)}
                      disabled={busyId === item.id}
                    >
                      Rejeitar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
