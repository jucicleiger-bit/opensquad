import { useEffect, useState } from "react";
import { OFFER_TYPE_LABELS, getOfferTypeLearnings, saveOfferTypeBaseInstruction, type OfferTypeLearning } from "@/api/client";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { LearningGallery } from "@/components/LearningGallery";

export function AprendizadoTipoOferta() {
  const [typeLearnings, setTypeLearnings] = useState<OfferTypeLearning[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingInstruction, setEditingInstruction] = useState<Record<string, string>>({});
  const [savingType, setSavingType] = useState<string | null>(null);
  const [typeLearningError, setTypeLearningError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTypeLearningError(null);
      try {
        const result = await getOfferTypeLearnings();
        if (cancelled) return;
        setTypeLearnings(result.types);
        setEditingInstruction(Object.fromEntries(result.types.map((t) => [t.type, t.baseInstruction])));
      } catch (err) {
        if (!cancelled) setTypeLearningError((err as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveTypeInstruction(type: string) {
    setSavingType(type);
    setTypeLearningError(null);
    try {
      await saveOfferTypeBaseInstruction(type, editingInstruction[type]);
      setTypeLearnings((current) =>
        current.map((t) => (t.type === type ? { ...t, baseInstruction: editingInstruction[type], hasOverride: true } : t)),
      );
    } catch (err) {
      setTypeLearningError((err as Error).message);
    } finally {
      setSavingType(null);
    }
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 var(--space-2xs)" }}>Aprendizado por tipo de oferta</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Vale pra todo projeto, não só um cliente. Instrução base é o que a IA sempre lê pra esse tipo; a galeria abaixo acumula exemplos de estrutura/composição que você aprovar.
      </p>
      {typeLearningError ? <div className="pill bad" style={{ marginBottom: 12 }}>{typeLearningError}</div> : null}
      {!loaded ? null : (
        <div style={{ display: "grid", gap: 16 }}>
          {typeLearnings.map((learning) => (
            <Card key={learning.type} style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <b>{OFFER_TYPE_LABELS[learning.type] || learning.type}</b>
                <span className="pill" style={{ opacity: learning.hasOverride ? 1 : 0.7 }}>
                  {learning.hasOverride ? "personalizado" : "usando padrão"}
                </span>
              </div>
              {!learning.hasOverride ? (
                <p className="muted" style={{ margin: "4px 0", fontSize: 12 }}>
                  Prévia genérica do texto padrão. O texto real usado pela IA encaixa o nome da oferta no meio da frase — não é exatamente o que está escrito abaixo até você salvar uma versão personalizada.
                </p>
              ) : null}
              <textarea
                value={editingInstruction[learning.type] || ""}
                onChange={(e) => setEditingInstruction((current) => ({ ...current, [learning.type]: e.target.value }))}
              />
              <Button disabled={savingType === learning.type} onClick={() => handleSaveTypeInstruction(learning.type)}>
                {savingType === learning.type ? "Salvando..." : "Salvar"}
              </Button>
              <LearningGallery
                scope="offerType"
                groupKey={learning.type}
                entries={learning.entries}
                onEntriesChange={(entries) => setTypeLearnings((current) => current.map((t) => (t.type === learning.type ? { ...t, entries } : t)))}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
