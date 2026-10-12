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
import {
  bucketForItem,
  channelFullLabel,
  channelLabel,
  groupSameCreativeItems,
  imageSource,
  isFeedChannel,
  statusMeta,
  type ContentGroup,
} from "./contentDisplay";
import styles from "./Calendar.module.css";

interface ActionState {
  busy: boolean;
  error: string | null;
  message: string | null;
}

const IDLE_ACTION_STATE: ActionState = { busy: false, error: null, message: null };

const itemKey = (item: ContentItem) => `${item.batchId || "__no_batch__"}::${item.contentId}`;

function groupLabel(group: ContentGroup): string {
  if (group.members.length === 1) return channelLabel(group.leader.channel);

  const hasStory = group.members.some((item) => item.channel.includes("story") || item.channel === "whatsapp_status");
  const hasReels = group.members.some((item) => item.channel.includes("reels"));
  const format = group.members.every((item) => isFeedChannel(item.channel))
    ? "Feed"
    : hasStory && hasReels
      ? "Story + Reels"
      : hasReels
        ? "Reels"
        : "Story";

  return `${format} · ${group.members.length} canais`;
}

function groupTime(group: ContentGroup): string {
  return group.leader.scheduledTime?.trim().slice(0, 5) || "";
}

function calendarGroupLabel(group: ContentGroup): string {
  const time = groupTime(group);
  return time ? `${time} · ${groupLabel(group)}` : groupLabel(group);
}

function visibleGroupLabel(group: ContentGroup): string {
  if (group.members.length === 1) return groupLabel(group);
  return `${groupLabel(group).replace(/ · \d+ canais$/, "")} ×${group.members.length}`;
}

function compactGroupLabel(group: ContentGroup): string {
  const prefix = group.members.every((item) => isFeedChannel(item.channel))
    ? "F"
    : group.members.some((item) => item.channel.includes("reels"))
      ? "R"
      : "S";
  const channelSummary = group.members.length > 1 ? `${prefix}${group.members.length}` : prefix;
  const hour = groupTime(group).slice(0, 2);
  return hour ? `${hour}${channelSummary}` : channelSummary;
}

function groupStatusItem(group: ContentGroup): ContentItem {
  return (
    group.members.find((item) => item.publish?.error) ||
    group.members.find((item) => item.image?.generating) ||
    group.members.find((item) => !item.publish?.realPublished) ||
    group.leader
  );
}

export function Calendar() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
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
    setSelectedItemKey(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    // A carousel item has no top-level image — its pixels are in slides[].
    if (!items?.some((item) => item.image?.generating || item.slides?.some((slide) => slide.image?.generating))) return;
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
  const selectedItem = scheduledItems.find((item) => itemKey(item) === selectedItemKey) ?? null;
  const selectedGroup = selectedItem
    ? groupSameCreativeItems(scheduledItems).find((group) => group.members.some((item) => itemKey(item) === selectedItemKey))
    : null;

  function selectItem(item: ContentItem) {
    setSelectedItemKey(itemKey(item));
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
      setSelectedItemKey(null);
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
          const dayGroups = groupSameCreativeItems(dayItems);
          const isOutside = day.getMonth() !== cursor.getMonth();
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`${styles.day} ${isOutside ? styles.dayOutside : ""} ${isToday ? styles.dayToday : ""}`.trim()}
            >
              <span className={styles.dayNumber}>{day.getDate()}</span>
              <div className={styles.chips}>
                {dayGroups.map((group) => {
                  const meta = statusMeta(groupStatusItem(group));
                  const isSelected = group.members.some((item) => itemKey(item) === selectedItemKey);
                  const fullChannels = group.members.map((item) => channelFullLabel(item.channel)).join(", ");
                  return (
                    <button
                      key={group.leader.creativeGroupKey || itemKey(group.leader)}
                      type="button"
                      className={`${styles.chip} ${meta.chipClass ? styles[meta.chipClass] : ""} ${isSelected ? styles.chipSelected : ""}`.trim()}
                      aria-label={`${calendarGroupLabel(group)}: ${fullChannels}`}
                      onClick={() => selectItem(group.leader)}
                    >
                      <span className={`${styles.dot} ${styles[meta.dotClass]}`} />
                      <span className={styles.chipLabel}>
                        {groupTime(group) ? <span className={styles.chipTime}>{groupTime(group)}</span> : null}
                        {groupTime(group) ? " · " : ""}{visibleGroupLabel(group)}
                      </span>
                      <span className={styles.chipCompact} aria-hidden="true">{compactGroupLabel(group)}</span>
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
              <img src={imageSource(selectedItem)} alt={selectedItem.formatLabel || channelLabel(selectedItem.channel)} loading="lazy" />
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
              {selectedGroup && selectedGroup.members.length > 1 ? (
                <div className={styles.channelTabs} aria-label="Canais desta publicação">
                  {selectedGroup.members.map((item) => {
                    const selected = itemKey(item) === selectedItemKey;
                    return (
                      <button
                        key={itemKey(item)}
                        type="button"
                        className={`${styles.channelTab} ${selected ? styles.channelTabSelected : ""}`.trim()}
                        aria-label={`Ver ${channelFullLabel(item.channel)}`}
                        aria-pressed={selected}
                        onClick={() => selectItem(item)}
                      >
                        {channelLabel(item.channel)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="pill">{selectedItem.formatLabel || channelLabel(selectedItem.channel)}</span>
              )}
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
