import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { deleteContent, getProjectContent, publishContent, type ContentItem } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { addMonths, buildMonthGrid, monthLabel, startOfMonth, toDateKey, weekdayLabels } from "./calendarUtils";
import { ContentPipeline } from "./ContentPipeline";
import { bucketForItem, channelLabel, imageSource, isFeedChannel, statusMeta } from "./contentDisplay";
import styles from "./Calendar.module.css";

interface ActionState {
  busy: boolean;
  error: string | null;
  message: string | null;
}

const IDLE_ACTION_STATE: ActionState = { busy: false, error: null, message: null };

export function Calendar() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>(IDLE_ACTION_STATE);

  const refresh = useCallback(async () => {
    try {
      const data = await getProjectContent(project.projectId);
      setItems(data.content);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [project.projectId]);

  useEffect(() => {
    setItems(null);
    setSelectedContentId(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!items?.some((item) => item.image?.generating)) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [items, refresh]);

  // The calendar is the agenda of what's actually scheduled/posted — items
  // still awaiting approval live on their own "Aguardando aprovação" page
  // and only show up here once approved.
  const scheduledItems = useMemo(() => (items || []).filter((item) => bucketForItem(item) === "aprovado"), [items]);

  const byDate = useMemo(() => {
    const map = new Map<string, ContentItem[]>();
    scheduledItems.forEach((item) => {
      const list = map.get(item.scheduledDate) || [];
      list.push(item);
      map.set(item.scheduledDate, list);
    });
    return map;
  }, [scheduledItems]);

  const gridDays = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const todayKey = toDateKey(new Date());
  const selectedItem = scheduledItems.find((item) => item.contentId === selectedContentId) ?? null;

  function selectItem(item: ContentItem) {
    setSelectedContentId(item.contentId);
    setActionState(IDLE_ACTION_STATE);
  }

  async function handlePublish(item: ContentItem) {
    setActionState({ busy: true, error: null, message: null });
    try {
      await publishContent(project.projectId, item.contentId, item.batchId);
      await refresh();
      setActionState({ busy: false, error: null, message: "Publicado no Instagram." });
    } catch (err) {
      setActionState({ busy: false, error: (err as Error).message, message: null });
    }
  }

  async function handleDelete(item: ContentItem) {
    const reason = prompt(
      "Apagar este conteúdo gerado? Se quiser, diga o motivo (ajuda o sistema a evitar isso nas próximas gerações) — deixe em branco pra apagar sem motivo.",
    );
    if (reason === null) return;
    setActionState({ busy: true, error: null, message: null });
    try {
      await deleteContent(project.projectId, item.contentId, item.batchId, reason || undefined);
      setSelectedContentId(null);
      await refresh();
    } catch (err) {
      setActionState({ busy: false, error: (err as Error).message, message: null });
    }
  }

  if (error) {
    return <EmptyState title="Não foi possível carregar o calendário" description={error} />;
  }

  if (!items) {
    return <Skeleton height={360} />;
  }

  return (
    <div>
      <div className={styles.header}>
        <h2 style={{ margin: 0 }}>Calendário</h2>
        <div className={styles.monthNav}>
          <Button variant="secondary" className={styles.navButton} onClick={() => setCursor((c) => addMonths(c, -1))}>
            ←
          </Button>
          <span className={styles.monthLabel}>{monthLabel(cursor)}</span>
          <Button variant="secondary" className={styles.navButton} onClick={() => setCursor((c) => addMonths(c, 1))}>
            →
          </Button>
        </div>
      </div>

      <div className={styles.grid}>
        {weekdayLabels().map((label) => (
          <div key={label} className={styles.weekday}>
            {label}
          </div>
        ))}
        {gridDays.map((day) => {
          const key = toDateKey(day);
          const dayItems = byDate.get(key) || [];
          const isOutside = day.getMonth() !== cursor.getMonth();
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`${styles.day} ${isOutside ? styles.dayOutside : ""} ${isToday ? styles.dayToday : ""}`.trim()}
            >
              <span className={styles.dayNumber}>{day.getDate()}</span>
              <div className={styles.chips}>
                {dayItems.map((item) => {
                  const meta = statusMeta(item);
                  return (
                    <button
                      key={item.contentId}
                      type="button"
                      className={`${styles.chip} ${item.contentId === selectedContentId ? styles.chipSelected : ""}`.trim()}
                      onClick={() => selectItem(item)}
                    >
                      <span className={`${styles.dot} ${styles[meta.dotClass]}`} />
                      {channelLabel(item.channel)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selectedItem ? (
        <Card className={styles.detail}>
          <div className={`${styles.phone} ${isFeedChannel(selectedItem.channel) ? styles.phoneFeed : styles.phoneTall}`}>
            {imageSource(selectedItem) ? (
              <img src={imageSource(selectedItem)} alt={selectedItem.formatLabel || channelLabel(selectedItem.channel)} />
            ) : selectedItem.image?.generating ? (
              <span>Gerando imagem com IA...</span>
            ) : (
              <span>Sem imagem de prévia ainda</span>
            )}
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>
                {selectedItem.scheduledDate} · {selectedItem.scheduledTime || ""}
              </h3>
              <span className="pill">{selectedItem.formatLabel || channelLabel(selectedItem.channel)}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <span className="pill">{statusMeta(selectedItem).label}</span>
            </div>
            <ContentPipeline item={selectedItem} />
            <div className={styles.caption}>{selectedItem.caption?.text || "Sem legenda"}</div>
            <div className={styles.actions}>
              {!selectedItem.publish?.realPublished ? (
                <Button disabled={actionState.busy} onClick={() => handlePublish(selectedItem)}>
                  {actionState.busy ? "Publicando..." : selectedItem.publish?.error ? "Tentar publicar de novo" : "Publicar agora"}
                </Button>
              ) : null}
              <Button variant="ghost" disabled={actionState.busy} onClick={() => handleDelete(selectedItem)}>
                Apagar
              </Button>
            </div>
            {actionState.error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{actionState.error}</div> : null}
            {actionState.message ? <div className={`${styles.feedback} ${styles.feedbackOk}`}>{actionState.message}</div> : null}
          </div>
        </Card>
      ) : (
        <div style={{ marginTop: 20 }}>
          <EmptyState title="Selecione um post no calendário" description="Clique em um card de um dia para ver a prévia completa e as ações." />
        </div>
      )}
    </div>
  );
}
