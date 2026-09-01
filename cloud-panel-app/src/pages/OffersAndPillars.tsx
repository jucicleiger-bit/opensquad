import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";

interface OfferGroup {
  id: string;
  name: string;
  comboChance: number;
  createdAt: string;
  updatedAt: string;
}

interface Offer {
  id: string;
  name: string;
  type: string;
  price: string;
  items: string;
  cta: string;
  notes: string;
  active: boolean;
  pillarId: string | null;
  groupId: string | null;
  [key: string]: unknown;
}

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

interface ContentStrategy {
  offers: Offer[];
  offerGroups: OfferGroup[];
  pillars: Pillar[];
}

const EMPTY_STRATEGY: ContentStrategy = { offers: [], offerGroups: [], pillars: [] };

const OFFER_TYPES: Array<[string, string]> = [
  ["offer", "Oferta direta"], ["service", "Serviço"], ["combo", "Combo / promoção"],
  ["rodizio", "Rodízio"], ["delivery", "Delivery"], ["product", "Produto destaque"],
  ["orientation", "Post de orientação"], ["desire", "Post de desejo"],
  ["urgency", "Urgência / hoje tem"], ["institutional", "Institucional"],
  ["social_proof", "Prova social"],
];

const PILLAR_ROLES: Array<[string, string]> = [
  ["ensina", "Ensina"], ["prova", "Prova"], ["posiciona", "Posiciona"], ["convida", "Convida"],
];

const PILLAR_VISUAL_TREATMENTS: Array<[string, string]> = [
  ["cru", "Cru"], ["leve", "Leve"], ["desenhado", "Desenhado"],
];

export function OffersAndPillars() {
  const { projectId } = useParams<{ projectId: string }>();
  const [strategy, setStrategy] = useState<ContentStrategy>(EMPTY_STRATEGY);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const [offerDraft, setOfferDraft] = useState<Offer | null>(null);
  const [pillarDraft, setPillarDraft] = useState<Pillar | null>(null);
  const [groupDraft, setGroupDraft] = useState<OfferGroup | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("content_strategy")
      .eq("id", projectId)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    const raw = data.content_strategy;
    setStrategy({
      offers: Array.isArray(raw?.offers) ? raw.offers : [],
      offerGroups: Array.isArray(raw?.offerGroups) ? raw.offerGroups : [],
      pillars: Array.isArray(raw?.pillars) ? raw.pillars : [],
    });
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function persist(next: ContentStrategy): Promise<boolean> {
    setBusy(true);
    const { error: updateError } = await supabase.from("projects").update({ content_strategy: next }).eq("id", projectId);
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return false;
    }
    setStrategy(next);
    setBusy(false);
    return true;
  }

  function newOfferDraft(): Offer {
    return {
      id: crypto.randomUUID(), name: "", type: "offer", price: "", items: "",
      cta: "", notes: "", active: true, pillarId: null, groupId: null,
    };
  }
  function newPillarDraft(): Pillar {
    return {
      id: crypto.randomUUID(), name: "", role: "ensina", objective: "",
      visualTreatment: "leve", color: "#7C7C7C", weight: 1, active: true,
    };
  }
  function newGroupDraft(): OfferGroup {
    return { id: crypto.randomUUID(), name: "", comboChance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  async function saveOffer(e: FormEvent) {
    e.preventDefault();
    if (!offerDraft || !offerDraft.name.trim()) return;
    const ok = await persist({ ...strategy, offers: upsertById(strategy.offers, offerDraft) });
    if (ok) setOfferDraft(null);
  }
  async function savePillar(e: FormEvent) {
    e.preventDefault();
    if (!pillarDraft || !pillarDraft.name.trim()) return;
    const ok = await persist({ ...strategy, pillars: upsertById(strategy.pillars, pillarDraft) });
    if (ok) setPillarDraft(null);
  }
  async function saveGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupDraft || !groupDraft.name.trim()) return;
    const ok = await persist({ ...strategy, offerGroups: upsertById(strategy.offerGroups, { ...groupDraft, updatedAt: new Date().toISOString() }) });
    if (ok) setGroupDraft(null);
  }

  async function deleteOffer(id: string) {
    await persist({ ...strategy, offers: removeById(strategy.offers, id) });
  }
  async function deletePillar(id: string) {
    await persist({ ...strategy, pillars: removeById(strategy.pillars, id) });
  }
  async function deleteGroup(id: string) {
    await persist({ ...strategy, offerGroups: removeById(strategy.offerGroups, id) });
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!loaded) return <div className="card">Carregando...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Ofertas e Pilares</h2>
        <span className="step">assuntos</span>
      </div>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Grupos de ofertas</h2>
        {strategy.offerGroups.map((group) => (
          <div key={group.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{group.name} — combo {group.comboChance}%</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setGroupDraft(group)}>Editar</button>
              <button type="button" className="danger" onClick={() => deleteGroup(group.id)} disabled={busy}>Apagar</button>
            </div>
          </div>
        ))}
        {groupDraft ? (
          <form onSubmit={saveGroup} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="text" placeholder="Nome do grupo" value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} required />
            <label>
              Chance de combo (%)
              <input type="number" min={0} max={100} value={groupDraft.comboChance} onChange={(e) => setGroupDraft({ ...groupDraft, comboChance: Number(e.target.value) })} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="primary" disabled={busy}>Salvar</button>
              <button type="button" onClick={() => setGroupDraft(null)}>Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setGroupDraft(newGroupDraft())}>+ Novo grupo</button>
        )}
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Ofertas</h2>
        {strategy.offers.map((offer) => (
          <div key={offer.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{offer.name} ({offer.type}) {offer.active ? "" : "— inativa"}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setOfferDraft(offer)}>Editar</button>
              <button type="button" className="danger" onClick={() => deleteOffer(offer.id)} disabled={busy}>Apagar</button>
            </div>
          </div>
        ))}
        {offerDraft ? (
          <form onSubmit={saveOffer} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="text" placeholder="Nome" value={offerDraft.name} onChange={(e) => setOfferDraft({ ...offerDraft, name: e.target.value })} required />
            <select value={offerDraft.type} onChange={(e) => setOfferDraft({ ...offerDraft, type: e.target.value })}>
              {OFFER_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="text" placeholder="Preço" value={offerDraft.price} onChange={(e) => setOfferDraft({ ...offerDraft, price: e.target.value })} />
            <input type="text" placeholder="Itens" value={offerDraft.items} onChange={(e) => setOfferDraft({ ...offerDraft, items: e.target.value })} />
            <input type="text" placeholder="CTA" value={offerDraft.cta} onChange={(e) => setOfferDraft({ ...offerDraft, cta: e.target.value })} />
            <textarea placeholder="Notas" value={offerDraft.notes} onChange={(e) => setOfferDraft({ ...offerDraft, notes: e.target.value })} />
            <select value={offerDraft.groupId || ""} onChange={(e) => setOfferDraft({ ...offerDraft, groupId: e.target.value || null })}>
              <option value="">Sem grupo</option>
              {strategy.offerGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={offerDraft.pillarId || ""} onChange={(e) => setOfferDraft({ ...offerDraft, pillarId: e.target.value || null })}>
              <option value="">Sem pilar</option>
              {strategy.pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label>
              <input type="checkbox" checked={offerDraft.active} onChange={(e) => setOfferDraft({ ...offerDraft, active: e.target.checked })} /> Ativa
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="primary" disabled={busy}>Salvar</button>
              <button type="button" onClick={() => setOfferDraft(null)}>Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setOfferDraft(newOfferDraft())}>+ Nova oferta</button>
        )}
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Pilares</h2>
        {strategy.pillars.map((pillar) => (
          <div key={pillar.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: pillar.color, marginRight: 6 }} />
              {pillar.name} ({pillar.role}) {pillar.active ? "" : "— inativo"}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setPillarDraft(pillar)}>Editar</button>
              <button type="button" className="danger" onClick={() => deletePillar(pillar.id)} disabled={busy}>Apagar</button>
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
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="primary" disabled={busy}>Salvar</button>
              <button type="button" onClick={() => setPillarDraft(null)}>Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setPillarDraft(newPillarDraft())}>+ Novo pilar</button>
        )}
      </section>
    </div>
  );
}
