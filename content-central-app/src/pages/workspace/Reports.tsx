import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { getReports, reportUrl, type ReportMonth } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

const STATUS_LABELS: Record<ReportMonth["status"], string> = {
  parcial: "Parcial — mês em andamento",
  fechando: "Fechando — números completos no dia 3",
  pronto: "Pronto",
};

export function Reports() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [months, setMonths] = useState<ReportMonth[] | null>(null);
  const [insightsEnabled, setInsightsEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReports(project.projectId)
      .then((result) => {
        if (cancelled) return;
        setMonths(result.months);
        setInsightsEnabled(result.insightsEnabled);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectId]);

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Relatórios</h2>

      {!insightsEnabled ? (
        <div className="notice" style={{ marginBottom: 20 }}>
          Este token não tem a permissão de alcance. O relatório sai sem visualizações. Veja Conta e token.
        </div>
      ) : null}

      {error ? (
        <div className="pill bad">{error}</div>
      ) : months === null ? (
        <Skeleton height={140} />
      ) : months.length === 0 ? (
        <EmptyState title="Nenhum relatório ainda" description="O relatório de um mês aparece aqui depois da primeira publicação." />
      ) : (
        <div className="stack-sm">
          {months.map((entry) => (
            <Card
              key={entry.month}
              style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
            >
              <div>
                <b>{entry.label}</b>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {`${entry.publications} ${entry.publications === 1 ? "publicação" : "publicações"}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className={`pill ${entry.status === "pronto" ? "ok" : ""}`}>{STATUS_LABELS[entry.status]}</span>
                <a href={reportUrl(project.projectId, entry.month)} target="_blank" rel="noreferrer">
                  <Button type="button" variant="secondary">
                    Abrir relatório
                  </Button>
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
