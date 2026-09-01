# Cloud Panel Parity — Page-Body Structure (Fase 3c-ii) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap the Fase 3c final review found: 4 pages
(`Company`, `References`, `Approval`, `OffersAndPillars`) already have the
right colors/fonts/buttons (Fase 3c's CSS swap) but still use ad-hoc
`style={{display:"flex",...}}` row layouts instead of the local
dashboard's actual content-level classes (`.field-card`/`.grid`,
`.reference-gallery`/`.reference-card`, `.content-card`/`.content-preview`)
that the Fase 3c design spec already called out but Fase 3c's plan under-
scoped. This plan finishes that mapping — no new design decisions, this is
executing what the already-approved spec already specified.

**Architecture:** Body-only rewrites. Every data function
(`load`/`save*`/`delete*`/`persist`/state hooks) stays byte-for-byte
unchanged in every file — only the JSX inside each `return (...)` changes,
to use classes the CSS (from Fase 3c) already defines.

**Tech Stack:** Unchanged (React 19 + TypeScript + Vitest).

## Global Constraints

- No logic changes anywhere. Every function signature, every state
  variable, every Supabase call stays exactly as it is today. If a step
  here looks like it's changing behavior, that's a plan defect — flag it,
  don't guess.
- Reuse only classes that already exist in
  `cloud-panel-app/src/styles/global.css` (copied verbatim from the local
  dashboard in Fase 3c) — do not invent new classes or add new CSS.
- `npm run build` is this project's real type-check — always use it.

---

### Task 1: Company, OffersAndPillars — field-card/grid layout

**Files:**
- Modify: `cloud-panel-app/src/pages/Company.tsx`
- Modify: `cloud-panel-app/src/pages/OffersAndPillars.tsx`

**Interfaces:** No change — same exported component names, same props
(none), same internal function signatures.

- [ ] **Step 1: `Company.tsx` — wrap fields in `.field-card`, group short fields into a `.grid`**

In `cloud-panel-app/src/pages/Company.tsx`, replace the `<section
className="card" ...>Perfil...</section>` block (everything from
`<section className="card" style={{ display: "flex", flexDirection:
"column", gap: 12 }}>` through its matching `</section>`) with:

```tsx
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ margin: 0 }}>Perfil</h2>
        <div className="field-card">
          <label>Foco comercial</label>
          <select value={profile.audienceType} onChange={(e) => updateField("audienceType", e.target.value)}>
            {AUDIENCE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="grid">
          {PROFILE_FIELDS.filter(({ multiline }) => !multiline).map(({ key, label }) => (
            <div key={key} className="field-card">
              <label htmlFor={`field-${key}`}>{label}</label>
              <input
                id={`field-${key}`}
                type="text"
                value={profile[key] as string}
                onChange={(e) => updateField(key, e.target.value)}
              />
            </div>
          ))}
        </div>
        {PROFILE_FIELDS.filter(({ multiline }) => multiline).map(({ key, label }) => (
          <div key={key} className="field-card">
            <label htmlFor={`field-${key}`}>{label}</label>
            <textarea
              id={`field-${key}`}
              rows={3}
              value={profile[key] as string}
              onChange={(e) => updateField(key, e.target.value)}
            />
          </div>
        ))}
        <div className="grid">
          <div className="field-card">
            <label htmlFor="field-tone">Tom de voz (separado por vírgula)</label>
            <input id="field-tone" type="text" value={profile.tone.join(", ")} onChange={(e) => updateField("tone", e.target.value)} />
          </div>
          <div className="field-card">
            <label htmlFor="field-contentGoals">Interesses / objetivos das postagens (separado por vírgula)</label>
            <input
              id="field-contentGoals"
              type="text"
              value={profile.contentGoals.join(", ")}
              onChange={(e) => updateField("contentGoals", e.target.value)}
            />
          </div>
        </div>
        <button type="button" className="primary" onClick={saveProfile} disabled={busy}>
          Salvar perfil
        </button>
      </section>
```

Nothing else in this file changes — `updateField`, `saveProfile`,
`PROFILE_FIELDS`, `AUDIENCE_TYPE_OPTIONS`, `BrandDocumentSection`, and
both `<BrandDocumentSection .../>` calls stay exactly as they are.

- [ ] **Step 2: `OffersAndPillars.tsx` — wrap each list row in `.field-card`**

In `cloud-panel-app/src/pages/OffersAndPillars.tsx`, there are 3 list-row
`<div>`s to convert — one each for groups, offers, and pillars. Each
currently looks like:

```tsx
          <div key={group.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
```

Change all 3 occurrences of this pattern (`group.id`, `offer.id`,
`pillar.id`) from:

```tsx
          <div key={group.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
```

to:

```tsx
          <div key={group.id} className="field-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
```

```tsx
          <div key={offer.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
```

to:

```tsx
          <div key={offer.id} className="field-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
```

```tsx
          <div key={pillar.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
```

to:

```tsx
          <div key={pillar.id} className="field-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
```

Nothing else in this file changes — the inline `style` stays alongside
the new `className` (both apply; the inline style keeps the
space-between/center alignment, `.field-card` adds the local dashboard's
card background/border/padding treatment).

- [ ] **Step 3: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as before (no test files touched).

- [ ] **Step 4: Commit**

```bash
git add cloud-panel-app/src/pages/Company.tsx cloud-panel-app/src/pages/OffersAndPillars.tsx
git commit -m "feat(cloud-panel): apply local dashboard's field-card/grid layout to Company, OffersAndPillars"
```

---

### Task 2: References, Approval — gallery/content-card layout

**Files:**
- Modify: `cloud-panel-app/src/pages/References.tsx`
- Modify: `cloud-panel-app/src/pages/Approval.tsx`

**Interfaces:** No change — same exported component names, same internal
function signatures.

- [ ] **Step 1: `References.tsx` — convert the list to `.reference-gallery`/`.reference-card`**

In `cloud-panel-app/src/pages/References.tsx`, replace the first `<section
className="card" ...>` block (the one containing the `references.map(...)`
list and the `editDraft` form — everything from `<section className="card"
style={{ display: "flex", flexDirection: "column", gap: 12 }}>` right
after the section-title, through its matching `</section>`) with:

```tsx
      <section className="card">
        <div className="reference-gallery">
          {references.map((reference) => (
            <div key={reference.id} className="reference-card">
              <div className="reference-thumb">
                {reference.mimeType.startsWith("image/") && signedUrls[reference.id] ? (
                  <img src={signedUrls[reference.id]} alt={reference.filename} />
                ) : (
                  <span>{reference.storagePath ? reference.filename : "arquivo indisponível"}</span>
                )}
              </div>
              <div className="reference-body">
                <div className="reference-name">{reference.filename}</div>
                <div className="reference-meta">
                  <span className="pill">{reference.referenceCategory}</span>
                  <span className="pill">peso {reference.weight}</span>
                </div>
                <p className="reference-note">{reference.instruction || "Sem observação."}</p>
                <div className="card-actions">
                  <button type="button" onClick={() => setEditDraft(draftFromReference(reference))}>Editar</button>
                  <button type="button" className="danger" onClick={() => deleteReference(reference)} disabled={busy}>Apagar</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {editDraft ? (
          <form onSubmit={saveEdit} className="reference-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <select value={editDraft.referenceCategory} onChange={(e) => setEditDraft({ ...editDraft, referenceCategory: e.target.value })}>
              {REFERENCE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={editDraft.weight} onChange={(e) => setEditDraft({ ...editDraft, weight: e.target.value })}>
              {REFERENCE_WEIGHTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <textarea placeholder="Instrução" value={editDraft.instruction} onChange={(e) => setEditDraft({ ...editDraft, instruction: e.target.value })} />
            <label>
              <input type="checkbox" checked={editDraft.useInNextGeneration} onChange={(e) => setEditDraft({ ...editDraft, useInNextGeneration: e.target.checked })} /> Usar na próxima geração
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="primary" disabled={busy}>Salvar</button>
              <button type="button" onClick={() => setEditDraft(null)}>Cancelar</button>
            </div>
          </form>
        ) : null}
      </section>
```

(the `editDraft` form's fields are unchanged from before — only the
`.reference-gallery`/`.reference-card` list markup and the form's
`className="reference-panel"` addition are new.)

Leave the second `<section className="card">Adicionar referência...
</section>` block exactly as it is — its form doesn't map cleanly onto
`.reference-toolbar`'s fixed 3-column grid (different field count/order),
so it stays as the existing plain flex form.

- [ ] **Step 2: `Approval.tsx` — convert each item to `.content-card`/`.content-preview`**

In `cloud-panel-app/src/pages/Approval.tsx`, replace the item-rendering
block (the whole `<div key={item.id} className="card">...</div>`,
including everything inside it) with:

```tsx
                <div key={item.id} className="content-card">
                  <div className={`content-preview channel-${item.channel}${!item.media_url ? " empty" : ""}`}>
                    {item.media_url ? (
                      signedUrls[item.id] ? (
                        <img src={signedUrls[item.id]} alt={item.content_id || item.id} />
                      ) : (
                        <button type="button" onClick={() => ensureSignedUrl(item)}>
                          Ver imagem
                        </button>
                      )
                    ) : (
                      <span>Sem imagem</span>
                    )}
                  </div>
                  <div>
                    <div className="content-meta">
                      <span className="pill">{item.channel}</span>
                      <span className="pill">{item.status}</span>
                    </div>
                    <textarea
                      rows={4}
                      value={draft}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      {dirty ? (
                        <button type="button" onClick={() => saveCaption(item)} disabled={busyId === item.id}>
                          Salvar legenda
                        </button>
                      ) : null}
                      {item.status !== "approved" ? (
                        <button
                          type="button"
                          className="primary"
                          onClick={() => approve(item)}
                          disabled={busyId === item.id}
                        >
                          Aprovar
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="danger"
                        onClick={() => reject(item)}
                        disabled={busyId === item.id}
                      >
                        Rejeitar
                      </button>
                    </div>
                  </div>
                </div>
```

- [ ] **Step 3: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as before.

- [ ] **Step 4: Commit**

```bash
git add cloud-panel-app/src/pages/References.tsx cloud-panel-app/src/pages/Approval.tsx
git commit -m "feat(cloud-panel): apply local dashboard's gallery/content-card layout to References, Approval"
```

---

## Post-plan (controller, not a subagent task)

After both tasks land and the final review is clean:

1. Deploy `cloud-panel-app` to Vercel (`npx vercel --yes --prod`).
2. Open the deployed URL side-by-side with the local dashboard and
   manually confirm: References shows a real image gallery (not a thin
   row list), Approval's content cards show a large preview image next to
   the caption/actions (not a small stacked image), Company's form fields
   are visually grouped into cards, Offers/Pillars/Groups rows read as
   cards.
