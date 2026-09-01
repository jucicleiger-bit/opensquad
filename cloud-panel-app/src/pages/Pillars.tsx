import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

interface Pillar {
  id: string;
  name: string;
  role: string;
  objective: string;
  visualTreatment: string;
  color: string;
  weight: number;
  active: boolean;
  [key: string]: unknown;
}

const PILLAR_ROLES: Array<[string, string]> = [
  ["ensina", "Ensina"], ["prova", "Prova"], ["posiciona", "Posiciona"], ["convida", "Convida"],
];

const PILLAR_VISUAL_TREATMENTS: Array<[string, string]> = [
  ["cru", "Cru"], ["leve", "Leve"], ["desenhado", "Desenhado"],
];

export function Pillars() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pillarDraft, setPillarDraft] = useState<Pillar | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("content_strategy")
      .eq("id", project.id)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    const raw = data.content_strategy;
    setPillars(Array.isArray(raw?.pillars) ? raw.pillars : []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function persist(nextPillars: Pillar[]): Promise<boolean> {
    setBusy(true);
    const { data: current, error: fetchError } = await supabase
      .from("projects")
      .select("content_strategy")
      .eq("id", project.id)
      .single();
    if (fetchError) {
      setError(fetchError.message);
      setBusy(false);
      return false;
    }
    const nextStrategy = { ...(current.content_strategy || {}), pillars: nextPillars };
    const { error: updateError } = await supabase.from("projects").update({ content_strategy: nextStrategy }).eq("id", project.id);
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return false;
    }
    setPillars(nextPillars);
    setBusy(false);
    return true;
  }

  function newPillarDraft(): Pillar {
    return {
      id: crypto.randomUUID(), name: "", role: "ensina", objective: "",
      visualTreatment: "leve", color: "#7C7C7C", weight: 1, active: true,
    };
  }

  async function savePillar(e: FormEvent) {
    e.preventDefault();
    if (!pillarDraft || !pillarDraft.name.trim()) return;
    const ok = await persist(upsertById(pillars, pillarDraft));
    if (ok) setPillarDraft(null);
  }

  async function deletePillar(id: string) {
    await persist(removeById(pillars, id));
  }

  if (error) return <Card style={{ padding: 20 }}>Erro: {error}</Card>;
  if (!loaded) return <Card style={{ padding: 20 }}>Carregando...</Card>;

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Pilares</h2>

      <Card style={{ padding: 20 }}>
        {pillars.map((pillar) => (
          <div key={pillar.id} className="field-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: pillar.color, marginRight: 6 }} />
              {pillar.name} ({pillar.role}) {pillar.active ? "" : "— inativo"}
            </span>
            <div className="button-row" style={{ margin: 0 }}>
              <Button variant="secondary" type="button" onClick={() => setPillarDraft(pillar)}>Editar</Button>
              <Button variant="ghost" type="button" onClick={() => deletePillar(pillar.id)} disabled={busy}>Apagar</Button>
            </div>
          </div>
        ))}
        {pillarDraft ? (
          <form onSubmit={savePillar} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="text" placeholder="Nome" value={pillarDraft.name} onChange={(e) => setPillarDraft({ ...pillarDraft, name: e.target.value })} required />
            <select value={pillarDraft.role} onChange={(e) => setPillarDraft({ ...pillarDraft, role: e.target.value })}>
              {PILLAR_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="text" placeholder="Objetivo" value={pillarDraft.objective} onChange={(e) => setPillarDraft({ ...pillarDraft, objective: e.target.value })} />
            <select value={pillarDraft.visualTreatment} onChange={(e) => setPillarDraft({ ...pillarDraft, visualTreatment: e.target.value })}>
              {PILLAR_VISUAL_TREATMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label>
              Cor
              <input type="color" value={pillarDraft.color} onChange={(e) => setPillarDraft({ ...pillarDraft, color: e.target.value })} />
            </label>
            <label>
              Peso
              <input type="number" min={1} value={pillarDraft.weight} onChange={(e) => setPillarDraft({ ...pillarDraft, weight: Math.max(1, Number(e.target.value)) })} />
            </label>
            <label>
              <input type="checkbox" checked={pillarDraft.active} onChange={(e) => setPillarDraft({ ...pillarDraft, active: e.target.checked })} /> Ativo
            </label>
            <div className="button-row">
              <Button type="submit" disabled={busy}>Salvar</Button>
              <Button variant="ghost" type="button" onClick={() => setPillarDraft(null)}>Cancelar</Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" type="button" onClick={() => setPillarDraft(newPillarDraft())}>+ Novo pilar</Button>
        )}
      </Card>
    </div>
  );
}
