import { useState } from "react";
import { refreshTopicIdeas, type ProjectSummary, type TopicIdeasBank as TopicIdeasBankData } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

interface Props {
  project: ProjectSummary;
  refreshProject: () => Promise<void>;
}

export function TopicIdeasBank({ project, refreshProject }: Props) {
  const [bank, setBank] = useState<TopicIdeasBankData | null>(project.contentStrategy?.topicIdeas || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goals = Object.entries(bank?.goals || {}).filter(([, goal]) => (goal.items || []).length > 0);

  async function handleRefresh() {
    setBusy(true);
    setError(null);
    try {
      const result = await refreshTopicIdeas(project.projectId);
      if (!result.topicIdeas) {
        setError("Selecione ao menos um objetivo compatível (Gerar autoridade, Aumentar reconhecimento da marca, Criar relacionamento, Aumentar engajamento ou Educar o público) no Raio-X da marca para criar o banco de assuntos.");
      } else {
        setBank(result.topicIdeas);
      }
      await refreshProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 20, marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h3 className="section-heading" style={{ marginTop: 0 }}>Banco de assuntos</h3>
          <p className="muted" style={{ margin: 0 }}>
            Atualizado em: {formatDateTime(bank?.generatedAt)} · Próxima atualização: {formatDateTime(bank?.nextRefreshAt)}
          </p>
        </div>
        <Button type="button" variant="secondary" disabled={busy} onClick={handleRefresh}>
          {busy ? "Atualizando..." : "Atualizar agora"}
        </Button>
      </div>

      {bank?.warning ? <div className="notice" style={{ marginTop: 12, borderColor: "rgba(245,158,11,.5)" }}>{bank.warning}</div> : null}
      {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}

      {goals.length ? (
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {goals.map(([goalKey, goal]) => (
            <div key={goalKey} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
              <strong>{goal.label || goalKey}</strong>
              <ol style={{ margin: "8px 0 0", paddingLeft: 22 }}>
                {(goal.items || []).slice(0, 10).map((item) => (
                  <li key={item.id || item.title} style={{ marginBottom: 6 }}>
                    {item.title}
                    {item.detail ? <span className="muted"> — {item.detail}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>Banco ainda não criado. Ele será criado na próxima geração/agenda ou ao clicar em atualizar.</p>
      )}
    </Card>
  );
}
