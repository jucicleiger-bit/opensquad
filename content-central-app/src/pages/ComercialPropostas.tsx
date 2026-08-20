import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listCommercialProposals, type CommercialProposalSummary } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ComercialTabs } from "@/components/ComercialTabs";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./ComercialPropostas.module.css";

export function ComercialPropostas() {
  const [proposals, setProposals] = useState<CommercialProposalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCommercialProposals()
      .then((res) => setProposals(res.proposals))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className={styles.wrap}>
      <ComercialTabs />
      <div className="page-head">
        <div>
          <h1>Propostas</h1>
          <p>Histórico de propostas geradas.</p>
        </div>
        <div className="actions-row">
          <Link to="/comercial/propostas/nova">
            <Button type="button">+ Nova proposta</Button>
          </Link>
        </div>
      </div>

      {error ? (
        <EmptyState title="Não foi possível carregar as propostas" description={error} />
      ) : !proposals ? (
        <Skeleton height={80} />
      ) : proposals.length === 0 ? (
        <EmptyState title="Nenhuma proposta ainda" description='Clique em "+ Nova proposta" pra montar a primeira.' />
      ) : (
        <div className="stack-sm">
          {proposals.map((proposal) => (
            <Link key={proposal.id} to={`/comercial/propostas/${proposal.id}`} className={styles.row}>
              <Card style={{ padding: "var(--space-md)" }}>
                <div className={styles.rowHead}>
                  <b>{proposal.clientName}</b>
                  <span className="muted">{new Date(proposal.createdAt).toLocaleDateString("pt-BR")}</span>
                </div>
                <div className={styles.pills}>
                  {proposal.categories.map((category) => (
                    <span key={category} className="pill">{category}</span>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
