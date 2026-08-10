# Design — Central de Conteúdo (Content Central)

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

**Reconstructed 2026-08-07.** `tokens.css` already carried a Hallmark stamp
(`genre: modern-minimal · macrostructure: Workbench · designed-as-app`) from an
earlier pass, but this file had gone missing and the identity was never
consistently applied — pages leaned on hundreds of one-off inline `style={{}}`
objects instead of the token system, which is why the app still read as
unfinished despite already having a real palette and type pairing.

**Round 1** of this reconstruction (spacing scale + card shadow) was too
subtle to actually register as "redesigned" — confirmed directly by the
operator ("pra mim tá do mesmo jeito"). **Round 2** (same day) went
considerably bolder: a real type scale with a genuine display size for the
one true page h1, a signature two-color gradient used deliberately in three
places (primary buttons, brand mark, nothing else), deeper surface contrast
so a `.card` is unmistakably a separate layer, a soft ambient glow behind
page content, and a larger spacing scale. The violet/dark palette itself is
unchanged (kept by request) — everything else about how it's *expressed* is
new.

## Product shape

Content Central is a 100% internal operator tool — a social-media content
pipeline for an agency managing multiple client Instagram/Facebook accounts.
There are no marketing pages, no public landing page, no anonymous visitors.
Every screen is post-login, task-focused, data-dense. The Hallmark
macrostructure catalog (hero → feature grid → CTA) is built for marketing
pages and doesn't map cleanly onto this kind of interface — instead of forcing
a mismatched macrostructure, this file defines a concrete **app-shell
discipline** below, which is what actually governs every page.

The operational pipeline is documented in `docs/content-central-flow.md`. UI
pages that show generated content should make the real production path visible
instead of hiding it behind a generic status pill: copy → Direct Response →
creative direction → image → review. The shipped reusable component for that is
`content-central-app/src/pages/workspace/ContentPipeline.tsx`; it derives status
from the persisted `ContentItem` only, never from invented UI-only state.

## Genre
modern-minimal (Stripe/Linear/ElevenLabs school — dense, dark, restrained,
functional over decorative)

## Layout family — "App shell" (the whole product is one family)

Every page (Dashboard + all 12 workspace pages) follows the same shell:

- **Page head:** `<h1>` title (--text-2xl, --font-display) + one-line `<p>`
  subtitle in `--muted`, with primary/secondary actions right-aligned on the
  same row. Wraps to a stacked column under 720px. No eyebrow/kicker label —
  these are operator screens, not editorial pages.
- **Body:** a vertical stack of `.card` sections (title + content), each
  using the spacing scale below for internal padding and inter-card gaps.
  Forms use the existing two-column `.row` grid (collapses to 1 column under
  720px). Lists/tables use consistent row height and a hover state on
  interactive rows.
- **Actions:** primary action = filled accent button, secondary = tinted
  surface button, ghost = transparent/text button. Destructive actions (Apagar)
  get a dedicated hover state (red-tinted), never a fourth button color.
- **Empty/loading states:** `EmptyState` / `Skeleton` components, already
  built — every page must use them instead of ad-hoc "carregando..." text.
- **Enrichment:** none anywhere. This is a utility app; no hero art, no
  illustration, no decorative motion. Restraint is the aesthetic.

## Theme (palette unchanged from the existing tokens.css — kept by request;
depth and identity are new)

- `--bg` #07070a / `--bg-soft` #0a0a0d / `--panel` #17161f / `--panel-2`
  #1d1c28 — panel was widened from the original #0e0e12 (barely distinguishable
  from `--bg`) so a `.card` reads as a real separate surface, not a hairline
  around the same black.
- `--surface` / `--surface-2` / `--surface-3` — translucent white overlays for
  raised/hovered/active states, not separate flat colors
- `--line` / `--line-strong` — hairline borders
- `--text` #f8f7fb / `--soft` #d6d4e0 / `--muted` #9796a3 / `--faint` #6c6a7c
- `--accent` oklch(66% 0.19 292) — the one violet brand hue, used for text/
  focus rings/active states
- `--accent-strong` oklch(72% 0.17 292) · `--accent-ink` oklch(99% 0 0)
- `--accent-2` oklch(70% 0.15 230) — a cooler companion hue. Only ever
  appears combined with `--accent` inside `--gradient-brand`, never alone.
- `--gradient-brand` — `linear-gradient(135deg, var(--accent), var(--accent-2))`.
  The signature identity move. Used in exactly three places: primary button
  fill, the header brand mark, the active nav item. Not a wash over
  backgrounds or cards — it stays a deliberate, scarce signal.
- Status colors (`--ok` / `--bad` / `--warn` / `--status-published`) are
  semantic, never used as decoration

## Typography

- Display: Space Grotesk — h1 750/`--text-display` (44px), h2 650/`--text-xl`
  (22px), h3 650/`--text-lg` (18px). There is exactly one h1 per screen (the
  page title); everything else is h2/h3. This was previously all three
  levels at ~15–16px with no real distinction.
- Body: Inter 400/650/750
- Full scale: `--text-xs` 12 · `--text-sm` 13 · `--text-md` 15 · `--text-lg` 18
  · `--text-xl` 22 · `--text-2xl` 28 · `--text-3xl` 36 · `--text-display` 44
- Display tracking: -0.025em on h1, -0.015em on h2, -0.01em on h3
- No italic headers, ever (already respected)

## Identity — the one deliberate signature

A dark, competently-executed palette with zero distinguishing marks still
reads as generic. Three intentional, restrained touches:

1. `--gradient-brand` on primary actions + brand mark + active nav (never
   more than that — it stays meaningful because it stays rare).
2. A soft radial glow (`--accent` at 10% opacity, anchored top-center,
   fixed) behind every page's content — real atmosphere, not a pattern that
   repeats per-card or competes with data density.
3. Primary buttons lift 1px + gain a soft accent-tinted shadow on hover —
   secondary/ghost buttons deliberately do not, so the glow stays a
   primary-action signal instead of decorating every click target.

## Spacing — NEW: a real 4-pt scale (this was missing)

The single biggest source of "grosseiro": no named spacing scale, so every
page invented its own pixel values inline (`gap: 16`, `marginTop: 12`,
`padding: 20`, all slightly different for the same visual role). Added to
`tokens.css`:

```
--space-3xs: 2px;   --space-2xs: 4px;   --space-xs: 8px;
--space-sm:  12px;  --space-md:  18px;  --space-lg: 24px;
--space-xl:  32px;  --space-2xl: 48px;  --space-3xl: 64px;
```

(Bumped up once from an initial 16/20/28/40/56 pass — the first round fixed
*consistency* but the app still read as cramped; this round adds real room.)

Pages must reference these by name (via CSS module classes), not raw pixel
values in `style={{}}`.

## Motion

- Easing: `--ease` cubic-bezier(0.16, 1, 0.3, 1) — the only easing curve
- One hover signal per element (brightness shift on buttons, background
  shift on cards/rows) — never combine 3+ simultaneous hover effects
- `prefers-reduced-motion` respected wherever transitions exist
- No page-load reveal animations — data-dense operator screens read instantly

## Microinteractions stance

- Silent success on save actions (no celebratory toasts) — a state change
  in the UI (pill color, updated value) is the confirmation
- Destructive actions (Apagar) always confirm via native `confirm()`
  (already the pattern) — no custom modal needed for this app's stakes
- Loading states disable the trigger + relabel it ("Salvando...", "Gerando...")
  rather than a separate spinner overlay

## CTA voice

- Primary: filled `--accent`, `--accent-ink` text, 750 weight, `border-radius: 12px`
- Secondary: `--surface-2` fill, `--soft` text, `--line` border
- Ghost: transparent, `--soft` text, `--line` border — used for low-emphasis
  toggles (e.g. "Ver como PC")
- Destructive: ghost by default, red-tinted only on hover/focus (never a
  permanently red button sitting in a list)

## Per-page allowances

- No page may introduce enrichment, gradients beyond the existing avatar
  gradient, or a second accent hue.
- No page may hardcode a pixel spacing value that isn't one of the 9 scale
  steps above.
- Every page's primary heading is `--text-2xl` / Space Grotesk 600 — no page
  invents its own heading size.

## What pages MUST share

- The app-shell page-head pattern (title + subtitle + right-aligned actions).
- The accent hue and its restrained use (buttons, focus rings, active states
  only — never large fills).
- The Space Grotesk/Inter pairing.
- The spacing scale.
- Button/card/pill/form base styles from `tokens.css` (never re-implemented
  locally).

## What pages MAY differ on

- Internal content shape (a calendar grid vs. a form vs. a card list) — the
  shell wraps different content per page's job, that's expected.
- Number of cards / sections.

## Exports

### tokens.css
See the real file at `content-central-app/src/styles/tokens.css` — this
project's token system lives in the actual stylesheet, not duplicated here,
so it can never drift out of sync with what's shipping.
