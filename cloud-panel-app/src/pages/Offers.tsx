import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { upsertById, removeById } from "@/lib/contentStrategy";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

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

export function Offers() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [strategy, setStrategy] = useState<ContentStrategy>(EMPTY_STRATEGY);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const [offerDraft, setOfferDraft] = useState<Offer | null>(null);
  const [groupDraft, setGroupDraft] = useState<OfferGroup | null>(null);

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
  }, [project.id]);

  async function persist(next: ContentStrategy): Promise<boolean> {
    setBusy(true);
    const { error: updateError } = await supabase.from("projects").update({ content_strategy: next }).eq("id", project.id);
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
  function newGroupDraft(): OfferGroup {
    return { id: crypto.randomUUID(), name: "", comboChance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  async function saveOffer(e: FormEvent) {
    e.preventDefault();
    if (!offerDraft || !offerDraft.name.trim()) return;
    const ok = await persist({ ...strategy, offers: upsertById(strategy.offers, offerDraft) });
    if (ok) setOfferDraft(null);
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
  async function deleteGroup(id: string) {
    await persist({ ...strategy, offerGroups: removeById(strategy.offerGroups, id) });
  }

  if (error) return <Card style={{ padding: 20 }}>Erro: {error}</Card>;
  if (!loaded) return <Card style={{ padding: 20 }}>Carregando...</Card>;

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Ofertas e assuntos</h2>

      <Card style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Grupos de ofertas</h3>
        {strategy.offerGroups.map((group) => (
          <div key={group.id} className="field-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span>{group.name} — combo {group.comboChance}%</span>
            <div className="button-row" style={{ margin: 0 }}>
              <Button variant="secondary" type="button" onClick={() => setGroupDraft(group)}>Editar</Button>
              <Button variant="ghost" type="button" onClick={() => deleteGroup(group.id)} disabled={busy}>Apagar</Button>
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
            <div className="button-row">
              <Button type="submit" disabled={busy}>Salvar</Button>
              <Button variant="ghost" type="button" onClick={() => setGroupDraft(null)}>Cancelar</Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" type="button" onClick={() => setGroupDraft(newGroupDraft())}>+ Novo grupo</Button>
        )}
      </Card>

      <Card style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Ofertas</h3>
        {strategy.offers.map((offer) => (
          <div key={offer.id} className="field-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span>{offer.name} ({offer.type}) {offer.active ? "" : "— inativa"}</span>
            <div className="button-row" style={{ margin: 0 }}>
              <Button variant="secondary" type="button" onClick={() => setOfferDraft(offer)}>Editar</Button>
              <Button variant="ghost" type="button" onClick={() => deleteOffer(offer.id)} disabled={busy}>Apagar</Button>
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
            <div className="button-row">
              <Button type="submit" disabled={busy}>Salvar</Button>
              <Button variant="ghost" type="button" onClick={() => setOfferDraft(null)}>Cancelar</Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" type="button" onClick={() => setOfferDraft(newOfferDraft())}>+ Nova oferta</Button>
        )}
      </Card>
    </div>
  );
}
