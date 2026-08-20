import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteCommercialProposal, getCommercialProposal, type CommercialProposal } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import styles from "./ComercialPropostaVer.module.css";

export function ComercialPropostaVer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<CommercialProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    getCommercialProposal(id)
      .then((res) => setProposal(res.proposal))
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function handleDelete() {
    if (!id || !confirm("Apagar esta proposta?")) return;
    setDeleting(true);
    try {
      await deleteCommercialProposal(id);
      navigate("/comercial/propostas");
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  if (error) return <EmptyState title="Não foi possível carregar a proposta" description={error} />;
  if (!proposal) return null;

  return (
    <div className={styles.wrap}>
      <div className="page-head">
        <div>
          <h1>{proposal.clientName}</h1>
          <p>{new Date(proposal.createdAt).toLocaleDateString("pt-BR")}</p>
        </div>
        <div className="actions-row">
          <Link to={`/comercial/propostas/${proposal.id}/imprimir`} target="_blank" rel="noreferrer">
            <Button type="button">Imprimir / Baixar PDF</Button>
          </Link>
          <Link to={`/comercial/propostas/${proposal.id}/apresentar`} target="_blank" rel="noreferrer">
            <Button type="button" variant="secondary">Apresentar</Button>
          </Link>
          <Link to={`/comercial/propostas/${proposal.id}/editar`}>
            <Button type="button" variant="secondary">Editar</Button>
          </Link>
          <Button type="button" variant="secondary" disabled={deleting} onClick={handleDelete}>
            {deleting ? "Apagando..." : "Apagar"}
          </Button>
        </div>
      </div>

      <div className="stack-lg">
        {proposal.sections.map((section) => (
          <Card key={section.category} style={{ padding: "var(--space-lg)" }}>
            <b>{section.category}</b>
            <div className={styles.itemsGrid}>
              {section.items.map((item, index) => (
                <div key={index} className={styles.itemCard}>
                  <b>{item.name}</b>
                  <p className="muted">{item.description}</p>
                  <p style={{ fontWeight: 700 }}>
                    {item.billingType === "mensal"
                      ? `R$ ${item.price}/mês`
                      : item.discountedPrice < item.fullPrice
                        ? `De R$ ${item.fullPrice} por R$ ${item.discountedPrice}`
                        : `R$ ${item.fullPrice}`}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
