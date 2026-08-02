import { useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  PILLAR_ROLE_LABELS,
  PILLAR_TREATMENT_LABELS,
  deletePillar,
  savePillar,
  suggestPillars,
  type ProjectPillar,
  type SuggestedPillar,
  type SuggestPillarsResult,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";

const EMPTY_FORM = {
  name: "",
  role: "ensina",
  objective: "",
  visualTreatment: "leve",
  color: "#7C7C7C",
  weight: 2,
  requiresEvidence: false,
};

export function Pillars() {
  const { project, refreshProject } = useOutletContext<WorkspaceContext>();
  const pillars = project.contentStrategy?.pillars || [];
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestPillarsResult | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [extraContext, setExtraContext] = useState("");
  const [applying, setApplying] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  async function handleSuggest() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const result = await suggestPillars(project.projectId, { extraContext: extraContext.trim() || undefined });
      setSuggestion(result);
      setSelectedSuggestions(new Set(result.pillars.map((p) => p.id)));
    } catch (err) {
      setSuggestError((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  function toggleSuggestion(id: string) {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function dismissSuggestion() {
    setSuggestion(null);
    setSelectedSuggestions(new Set());
    setSuggestError(null);
  }

  async function handleApplySuggestions() {
    if (!suggestion) return;
    const toApply = suggestion.pillars.filter((p) => selectedSuggestions.has(p.id));
    if (!toApply.length) return;
    setApplying(true);
    setSuggestError(null);
    try {
      for (const pillar of toApply) {
        await savePillar(project.projectId, {
          name: pillar.name,
          role: pillar.role,
          objective: pillar.objective,
          visualTreatment: pillar.visualTreatment,
          color: pillar.color,
          weight: pillar.weight,
          requiresEvidence: pillar.requiresEvidence,
        });
      }
      await refreshProject();
      dismissSuggestion();
    } catch (err) {
      setSuggestError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Nome do pilar é obrigatório.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await savePillar(project.projectId, editingId ? { ...form, id: editingId } : form);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await refreshProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleEdit(pillar: ProjectPillar) {
    setEditingId(pillar.id);
    setForm({
      name: pillar.name,
      role: pillar.role,
      objective: pillar.objective || "",
      visualTreatment: pillar.visualTreatment,
      color: pillar.color,
      weight: pillar.weight,
      requiresEvidence: pillar.requiresEvidence,
    });
    setError(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function handleDelete(pillar: ProjectPillar) {
    if (!confirm(`Apagar o pilar "${pillar.name}"? Ele não vai mais entrar na rotação de conteúdo.`)) return;
    setDeletingId(pillar.id);
    setError(null);
    try {
      await deletePillar(project.projectId, pillar.id);
      if (editingId === pillar.id) handleCancelEdit();
      await refreshProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 16px" }}>Pilares</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Defina o norte estratégico deste projeto. Cada pilar governa uma fatia da rotação de conteúdo, o CTA e o
        tratamento visual do criativo — sem pilares configurados, a geração segue a rotação automática padrão.
      </p>

      <Card style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <b>Sugerir pilares com IA</b>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Usa o Raio-X e as ofertas já cadastradas deste projeto pra propor pilares prontos — você revisa e escolhe
              quais aplicar.
            </p>
          </div>
          <Button variant="secondary" disabled={suggesting} onClick={handleSuggest}>
            {suggesting ? "Analisando..." : "Sugerir pilares com IA"}
          </Button>
        </div>

        {suggestion ? (
          <div className="field-card" style={{ marginTop: 14 }}>
            <b>Pilares sugeridos</b>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {suggestion.pillars.map((pillar: SuggestedPillar) => (
                <label
                  key={pillar.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "start",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedSuggestions.has(pillar.id)}
                    onChange={() => toggleSuggestion(pillar.id)}
                    style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto", marginTop: 3 }}
                  />
                  <span style={{ lineHeight: 1.5 }}>
                    <b>{pillar.name}</b> — {PILLAR_ROLE_LABELS[pillar.role] || pillar.role}
                    {pillar.objective ? `: ${pillar.objective}` : ""}
                  </span>
                </label>
              ))}
            </div>

            {suggestion.clarifyingQuestions.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <b>Perguntas da IA antes de fechar isso</b>
                <ul className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                  {suggestion.clarifyingQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
                <label htmlFor="pillar-extra-context">Contexto adicional (opcional)</label>
                <textarea
                  id="pillar-extra-context"
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  placeholder="Responda aqui o que ajudar a IA a refinar os pilares..."
                />
                <Button type="button" variant="secondary" style={{ marginTop: 8 }} disabled={suggesting} onClick={handleSuggest}>
                  {suggesting ? "Analisando..." : "Sugerir de novo com esse contexto"}
                </Button>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Button disabled={applying || selectedSuggestions.size === 0} onClick={handleApplySuggestions}>
                {applying ? "Aplicando..." : `Aplicar selecionados (${selectedSuggestions.size})`}
              </Button>
              <Button type="button" variant="ghost" disabled={applying} onClick={dismissSuggestion}>
                Descartar
              </Button>
            </div>
          </div>
        ) : null}
        {suggestError ? <div className="pill bad" style={{ marginTop: 12 }}>{suggestError}</div> : null}
      </Card>

      {pillars.length === 0 ? (
        <EmptyState title="Nenhum pilar cadastrado ainda" description="Cadastre abaixo o primeiro." />
      ) : (
        <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
          {pillars.map((pillar) => (
            <Card key={pillar.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      aria-hidden
                      style={{ width: 12, height: 12, borderRadius: "50%", background: pillar.color, display: "inline-block" }}
                    />
                    <span style={{ fontWeight: 800 }}>{pillar.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <span className="pill">{PILLAR_ROLE_LABELS[pillar.role] || pillar.role}</span>
                    <span className="pill">{PILLAR_TREATMENT_LABELS[pillar.visualTreatment] || pillar.visualTreatment}</span>
                    <span className="pill">peso {pillar.weight}</span>
                    {pillar.requiresEvidence ? <span className="pill">exige evidência</span> : null}
                    <span className="pill">{pillar.active === false ? "inativo" : "ativo"}</span>
                  </div>
                  {pillar.objective ? <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>{pillar.objective}</div> : null}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" onClick={() => handleEdit(pillar)}>
                    Editar
                  </Button>
                  <Button variant="ghost" onClick={() => handleDelete(pillar)} disabled={deletingId === pillar.id}>
                    {deletingId === pillar.id ? "Apagando..." : "Apagar"}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card style={{ padding: 20 }}>
        <b>{editingId ? "Editar pilar" : "Novo pilar"}</b>
        <form onSubmit={handleSubmit}>
          <label htmlFor="pillar-name">Nome</label>
          <input id="pillar-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

          <div className="row">
            <div>
              <label htmlFor="pillar-role">Papel do pilar</label>
              <select id="pillar-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(PILLAR_ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pillar-weight">Peso na distribuição</label>
              <input
                id="pillar-weight"
                type="number"
                min={1}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: Number(e.target.value) || 1 })}
              />
            </div>
          </div>

          <label htmlFor="pillar-objective">Objetivo</label>
          <input id="pillar-objective" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />

          <div className="row">
            <div>
              <label htmlFor="pillar-treatment">Tratamento visual</label>
              <select
                id="pillar-treatment"
                value={form.visualTreatment}
                onChange={(e) => setForm({ ...form, visualTreatment: e.target.value })}
              >
                {Object.entries(PILLAR_TREATMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pillar-color">Cor de identificação</label>
              <input
                id="pillar-color"
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                style={{ height: 40, padding: 4 }}
              />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <input
              type="checkbox"
              checked={form.requiresEvidence}
              onChange={(e) => setForm({ ...form, requiresEvidence: e.target.checked })}
              style={{ width: 16, height: 16, minHeight: 0, flex: "0 0 auto" }}
            />
            Exige evidência real (nunca inventar número/resultado neste pilar)
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button type="submit" className="full-width" disabled={busy}>
              {busy ? "Salvando..." : editingId ? "Salvar edição" : "Salvar pilar"}
            </Button>
            {editingId ? (
              <Button type="button" variant="secondary" onClick={handleCancelEdit}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </form>
        {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      </Card>
    </div>
  );
}
