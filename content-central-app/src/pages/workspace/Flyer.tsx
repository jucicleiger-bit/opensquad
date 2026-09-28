import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { generateFlyer } from "@/api/client";
import { CHANNEL_LABELS, channelFullLabel } from "./contentDisplay";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChannelCheckboxGroup } from "@/components/ChannelCheckboxGroup";
import styles from "./Flyer.module.css";

const MAX_FLYER_PRODUCTS = 12;
// Offer the same channel set the rest of the app offers for a single piece
// (mirrors CHANNEL_CODES in GenerateContent.tsx) — the backend accepts any,
// so nothing here is a real restriction, just parity with the other tabs.
const CHANNEL_CODES = Object.keys(CHANNEL_LABELS);

export function Flyer() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [selected, setSelected] = useState<string[]>([]);
  const [channels, setChannels] = useState<Set<string>>(new Set());
  const [date, setDate] = useState("");
  // contentSettings.defaultPostTime is a real per-project field every other
  // generation flow (generateContent, generateSpecialDateContent, etc. in
  // content-central.js) falls back to before its own hardcoded default — it
  // isn't in the ProjectSummary.contentSettings type, just carried through
  // its index signature (unknown), same as Offers.tsx's catalogGeneralInfo
  // read, so it needs a cast here.
  const [postTime, setPostTime] = useState(
    (project.contentSettings?.defaultPostTime as string | undefined) || "09:00",
  );
  // All four are optional. Blank campaign hands the headline back to the
  // model; blank dates and note mean the art carries neither, never that
  // something plausible gets invented in their place.
  const [campaign, setCampaign] = useState("");
  const [promoStart, setPromoStart] = useState("");
  const [promoEnd, setPromoEnd] = useState("");
  const [footerNote, setFooterNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const offers = useMemo(
    () => (project.contentStrategy?.offers || []).filter((offer) => offer.active !== false),
    [project],
  );
  const groups = project.contentStrategy?.offerGroups || [];
  const full = selected.length >= MAX_FLYER_PRODUCTS;

  // Products are shown under the group they were registered in, not as one
  // flat list with the group checkboxes floating above it — a client with
  // twenty offers across two groups otherwise reads as an undifferentiated
  // wall, right where the grouping matters most. Groups with no products are
  // skipped; products with no group get a section of their own so they stay
  // reachable rather than disappearing with their heading.
  const sections = useMemo(() => {
    const grouped = groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        offers: offers.filter((offer) => offer.groupId === group.id),
      }))
      .filter((section) => section.offers.length > 0);
    const claimed = new Set(grouped.flatMap((section) => section.offers.map((offer) => offer.id)));
    const loose = offers.filter((offer) => !claimed.has(offer.id));
    return loose.length
      ? [...grouped, { id: "none", name: "Sem grupo", offers: loose }]
      : grouped;
  }, [groups, offers]);

  // A group checkbox is a bulk toggle over its own offers, nothing more —
  // the request always travels as an explicit offerIds list, so a group
  // edited later never silently changes a flyer already generated.
  function toggleGroup(groupId: string) {
    const ids = offers.filter((offer) => offer.groupId === groupId).map((offer) => offer.id);
    const allIn = ids.every((id) => selected.includes(id));
    setSelected((current) => {
      if (allIn) return current.filter((id) => !ids.includes(id));
      const merged = [...current];
      for (const id of ids) {
        if (!merged.includes(id) && merged.length < MAX_FLYER_PRODUCTS) merged.push(id);
      }
      return merged;
    });
  }

  function toggleOffer(offerId: string) {
    setSelected((current) => {
      if (current.includes(offerId)) return current.filter((id) => id !== offerId);
      if (current.length >= MAX_FLYER_PRODUCTS) return current;
      return [...current, offerId];
    });
  }

  function toggleChannel(channel: string) {
    setChannels((current) => {
      const next = new Set(current);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      await generateFlyer(project.projectId, {
        offerIds: selected,
        date,
        channels: [...channels],
        postTime,
        campaign,
        promoStart,
        promoEnd,
        footerNote,
      });
      setDone(true);
      setSelected([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A disabled button with no explanation is a dead end — the operator can
  // see it is off but not which of the three requirements is missing, and
  // two of them live in a different card further down the page.
  const missing = [
    selected.length === 0 ? "escolha ao menos um produto" : "",
    channels.size === 0 ? "marque um canal" : "",
    date ? "" : "informe a data de publicação",
  ].filter(Boolean);
  const canGenerate = missing.length === 0 && !busy;

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-xs)" }}>Flyer</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        Monte um encarte com até {MAX_FLYER_PRODUCTS} produtos já cadastrados em Ofertas. Ele vai direto para
        Aguardando aprovação.
      </p>

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Produtos</h3>
        <p className={styles.counter}>
          {selected.length} de {MAX_FLYER_PRODUCTS} produtos selecionados
        </p>

        {sections.map((section) => (
          <div key={section.id} className={styles.section} data-testid={`flyer-group-${section.id}`}>
            {section.id === "none" ? (
              <p className={styles.sectionTitle}>{section.name}</p>
            ) : (
              <label className={styles.group}>
                <input
                  type="checkbox"
                  checked={section.offers.every((offer) => selected.includes(offer.id))}
                  onChange={() => toggleGroup(section.id)}
                  aria-label={section.name}
                />
                {section.name}
              </label>
            )}

            {section.offers.map((offer) => (
              <label key={offer.id} className={styles.offer}>
                <input
                  type="checkbox"
                  checked={selected.includes(offer.id)}
                  disabled={full && !selected.includes(offer.id)}
                  onChange={() => toggleOffer(offer.id)}
                  aria-label={`Produto ${offer.name}`}
                />
                <span>{offer.name}</span>
                <span className="muted">
                  {offer.price || "sem preço"}
                  {offer.priceUnit ? ` / ${offer.priceUnit}` : ""}
                  {(offer.photoReferenceIds || []).length ? "" : " · sem foto"}
                </span>
              </label>
            ))}
          </div>
        ))}
      </Card>

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Publicação</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <ChannelCheckboxGroup
            channels={CHANNEL_CODES}
            selected={channels}
            onToggle={toggleChannel}
            ariaLabel={(channel) => channelFullLabel(channel)}
          />
        </div>
        <label htmlFor="flyer-date">Data de publicação</label>
        <input id="flyer-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <label htmlFor="flyer-time" style={{ marginTop: 12 }}>
          Horário
        </label>
        <input id="flyer-time" type="time" value={postTime} onChange={(event) => setPostTime(event.target.value)} />
      </Card>

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Campanha</h3>
        <label htmlFor="flyer-campaign">Campanha / tema do flyer</label>
        <input
          id="flyer-campaign"
          value={campaign}
          placeholder="QUINTA DOS FRIOS"
          onChange={(event) => setCampaign(event.target.value)}
        />
        <p className="muted" style={{ marginTop: 4 }}>
          É a chamada do topo, escrita exatamente assim na arte. Em branco, a IA escreve uma.
        </p>

        <div className="row" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="flyer-promo-start">Promoção começa</label>
            <input
              id="flyer-promo-start"
              type="date"
              value={promoStart}
              onChange={(event) => setPromoStart(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="flyer-promo-end">Promoção termina</label>
            <input
              id="flyer-promo-end"
              type="date"
              value={promoEnd}
              onChange={(event) => setPromoEnd(event.target.value)}
            />
          </div>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Em branco, a peça sai sem prazo nenhum — nada de &quot;válido até domingo&quot; inventado.
        </p>

        <label htmlFor="flyer-footer-note" style={{ marginTop: 12 }}>
          Observação no rodapé
        </label>
        <textarea
          id="flyer-footer-note"
          value={footerNote}
          rows={2}
          placeholder="Ofertas válidas enquanto durar o estoque. Entregamos acima de R$ 150."
          onChange={(event) => setFooterNote(event.target.value)}
        />
        <p className="muted" style={{ marginTop: 4 }}>
          {project.brandInput?.address || project.brandInput?.contact
            ? "O endereço e o telefone do rodapé vêm do Raio-X."
            : "Sem endereço no Raio-X: o rodapé sai sem endereço e sem telefone. Cadastre na aba Empresa."}
        </p>
      </Card>

      {error ? <div className="pill bad" style={{ marginTop: 12 }}>{error}</div> : null}
      {done ? <p className="muted">Flyer gerado. Ele está em Aguardando aprovação.</p> : null}
      {missing.length > 0 && !busy ? (
        <p className="muted" style={{ marginBottom: 8 }}>
          Para gerar: {missing.join(", ")}.
        </p>
      ) : null}
      <Button type="button" className="full-width" disabled={!canGenerate} onClick={handleGenerate}>
        {busy ? "Gerando..." : "Gerar flyer"}
      </Button>
    </div>
  );
}
