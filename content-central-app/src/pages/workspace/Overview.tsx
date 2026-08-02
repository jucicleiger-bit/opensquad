import { useEffect, useState, type CSSProperties } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { getProjectContent, type ContentItem } from "@/api/client";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { toDateKey } from "./calendarUtils";
import { bucketForItem, channelLabel, statusMeta } from "./contentDisplay";
import { tokenExpiryMeta } from "./tokenDisplay";
import styles from "./Overview.module.css";

function formatDayLabel(dateStr: string): string {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  const weekday = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][parsed.getDay()];
  return `${weekday} · ${dateStr}`;
}

function PostRow({ item }: { item: ContentItem }) {
  const meta = statusMeta(item);
  return (
    <div className={styles.postRow}>
      <span style={dotStyle(meta.dotClass)} />
      <div className={styles.postMeta}>
        <div className={styles.postTitle}>
          {channelLabel(item.channel)} · {item.scheduledTime || "--:--"}
        </div>
        <div className={styles.postSub}>{item.formatLabel || item.channel}</div>
      </div>
      <span className="pill">{meta.label}</span>
    </div>
  );
}

function dotStyle(dotClass: string): CSSProperties {
  const colors: Record<string, string> = {
    dotAguardando: "var(--accent-warm)",
    dotAprovado: "var(--ok)",
    dotPublicado: "var(--status-published)",
    dotErro: "var(--bad)",
  };
  return { display: "inline-block", width: 8, height: 8, borderRadius: 999, flex: "0 0 auto", background: colors[dotClass] };
}

export function Overview() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    getProjectContent(project.projectId)
      .then((data) => {
        if (!cancelled) setItems(data.content);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectId]);

  const base = `/projects/${project.projectId}`;
  const offerCount = (project.contentStrategy?.offers || []).length;
  const referenceCount = project.brand?.references?.length || 0;
  const xrayApproved = project.brandXray?.status === "approved" || project.brandXray?.status === "aprovado";

  const todayKey = toDateKey(new Date());
  const todayItems = (items || []).filter((item) => item.scheduledDate === todayKey);
  const aguardando = (items || []).filter((item) => bucketForItem(item) === "aguardando");
  const aprovadoPendente = (items || []).filter((item) => bucketForItem(item) === "aprovado" && !item.publish?.realPublished);
  const publicado = (items || []).filter((item) => item.publish?.realPublished);
  const upcomingByDate = new Map<string, ContentItem[]>();
  (items || [])
    .filter((item) => item.scheduledDate > todayKey && !item.publish?.realPublished)
    .sort((a, b) => (a.scheduledDate + (a.scheduledTime || "")).localeCompare(b.scheduledDate + (b.scheduledTime || "")))
    .slice(0, 6)
    .forEach((item) => {
      const list = upcomingByDate.get(item.scheduledDate) || [];
      list.push(item);
      upcomingByDate.set(item.scheduledDate, list);
    });

  const checklist = [
    { done: xrayApproved, title: "Raio-X da marca", desc: xrayApproved ? "Aprovado" : "Ainda não aprovado", to: `${base}/empresa` },
    { done: referenceCount > 0, title: "Referências visuais", desc: referenceCount > 0 ? `${referenceCount} enviada(s)` : "Nenhuma referência enviada", to: `${base}/referencias` },
    { done: offerCount > 0, title: "Ofertas e assuntos", desc: offerCount > 0 ? `${offerCount} cadastrado(s)` : "Nenhuma oferta cadastrada", to: `${base}/ofertas` },
    { done: project.token?.configured === true, title: "Token do Instagram", desc: project.token?.configured ? tokenExpiryMeta(project.token).label : "Ainda não cadastrado", to: `${base}/conta` },
    { done: (items?.length || 0) > 0, title: "Primeiro conteúdo gerado", desc: items?.length ? `${items.length} card(s) no total` : "Nenhum conteúdo gerado ainda", to: `${base}/gerar` },
  ];

  return (
    <div>
      <h2 style={{ margin: "0 0 4px" }}>{project.name}</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>{project.projectId}</p>

      {error ? <EmptyState title="Não foi possível carregar o conteúdo" description={error} /> : null}

      {!items && !error ? (
        <Skeleton height={100} />
      ) : (
        <>
          <div className={styles.statGrid}>
            <Card className={styles.statCard}>
              <b>{todayItems.length}</b>
              <span>Pra postar hoje</span>
            </Card>
            <Card className={styles.statCard}>
              <b>{aguardando.length}</b>
              <span>Aguardando aprovação</span>
            </Card>
            <Card className={styles.statCard}>
              <b>{aprovadoPendente.length}</b>
              <span>Aprovados, não publicados</span>
            </Card>
            <Card className={styles.statCard}>
              <b>{publicado.length}</b>
              <span>Já publicados</span>
            </Card>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeading}>
              <h3>O que tem pra postar hoje</h3>
              <Link to={`${base}/calendario`} className="muted" style={{ fontSize: 13 }}>
                Ver calendário →
              </Link>
            </div>
            {todayItems.length === 0 ? (
              <EmptyState title="Nada agendado para hoje" />
            ) : (
              <div>
                {todayItems
                  .slice()
                  .sort((a, b) => (a.scheduledTime || "").localeCompare(b.scheduledTime || ""))
                  .map((item) => (
                    <PostRow key={item.contentId} item={item} />
                  ))}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeading}>
              <h3>Próximos posts programados</h3>
            </div>
            {upcomingByDate.size === 0 ? (
              <EmptyState title="Nada programado além de hoje" />
            ) : (
              <div>
                {[...upcomingByDate.entries()].map(([date, dateItems]) => (
                  <div key={date} style={{ marginBottom: 10 }}>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 700, margin: "10px 0 6px" }}>
                      {formatDayLabel(date)}
                    </div>
                    {dateItems.map((item) => (
                      <PostRow key={item.contentId} item={item} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className={styles.section}>
        <h3 style={{ marginBottom: 10 }}>Checklist do projeto</h3>
        <div className={styles.checklist}>
          {checklist.map((step) => (
            <Link
              key={step.title}
              to={step.to}
              className={`${styles.checklistItem} ${step.done ? styles.checklistItemDone : ""}`.trim()}
            >
              <span className={styles.checkIcon}>{step.done ? "✓" : ""}</span>
              <span>
                <span className={styles.checkTitle}>{step.title}</span>
                <span className={styles.checkDesc}> · {step.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
