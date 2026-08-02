# Design — Content Central

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
modern-minimal (internal dashboard / operator tool, Stripe/Linear school — not a marketing site)

## Macrostructure family
Single family: **Workbench** (fixed sidebar nav + scrollable content pane). Every
page in this app is a workbench page — there are no marketing or content pages
in this project. Pages vary only in their content layout (stat grid, form,
calendar grid, card list), never in the shell shape.

- App pages: Workbench, sidebar grouped by workflow phase (Configuração / Conteúdo / Conta)

## Theme
Custom, anchored on the project's existing brand hue (violet/indigo) — refined,
not replaced. The gradient + coloured-glow treatment is gone; the hue stays.

- `--color-paper`     oklch(9% 0.006 285)   /* was #07070a */
- `--color-paper-2`   oklch(12% 0.008 285)  /* was #0e0e12, panel/card surface */
- `--color-ink`       oklch(97% 0.006 290)  /* was #f8f7fb */
- `--color-ink-2`     oklch(70% 0.02 285)   /* was #94939f, muted text */
- `--color-rule`      rgba(255, 255, 255, 0.09)   /* hairline borders — alpha-over-dark, not a flat hex */
- `--color-accent`    oklch(66% 0.19 292)   /* solid violet-indigo, was the 3-stop gradient */
- `--color-accent-ink` oklch(99% 0 0)       /* text/icon color on top of accent fill */
- `--color-focus`     oklch(72% 0.17 292)   /* focus ring, same hue family as accent, brighter */

No gradients. No `--accent-2` / `--accent-3` (the pink/cyan siblings are removed
— one accent hue, used sparingly, is the whole point).

## Typography
- Display (section headings, page titles, stat numbers): Space Grotesk, weight 600, style normal
- Body / UI (labels, buttons, table text, nav): Inter, weight 400–650
- Mono: not used (no code/terminal surfaces in this app)
- Display tracking: -0.01em
- Headings stay roman. No italic anywhere (global rule, not just headings).

## Spacing
Existing 4pt-ish scale in `tokens.css` is kept as-is (`--space-*` not yet named
individually — this app uses ad hoc px values close to a 4pt grid). Out of
scope for this pass; named tokens can follow later.

## Motion
- Easing: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (already in tokens.css, keep)
- Button hover: ONE signal only — background lightens slightly (`filter: brightness(1.08)`).
  No `translateY`, no animated gradient position (there is no gradient to animate).
- Reduced-motion fallback: n/a today (app has no scroll-reveal or entrance
  animation to begin with — nothing to gate).

## Microinteractions stance
- Silent success on save actions already in place (toast only on error) — keep.
- Focus rings appear instantly, never transitioned — keep existing behavior, verify on redesign.

## CTA voice
- Primary button: solid `--color-accent` fill, `--color-accent-ink` text, no gradient, no glow shadow.
- Secondary button: `--color-paper-2` fill, `--color-rule` border — unchanged.
- Ghost button: transparent, `--color-rule` border — unchanged.
- Active nav link: solid `--color-accent` fill (not gradient), no glow shadow.

## Per-page allowances
- No page uses hero enrichment — this is a tool, function carries every screen.
- Glassmorphism (`backdrop-filter: blur`) is allowed ONLY on the sticky top bar
  (it floats over scrolling content — real justification). Removed from `.card`
  and everywhere else — cards get a flat tinted surface + hairline border instead.

## What pages MUST share
- The wordmark mark (logo chip), now solid `--color-accent`, no gradient/glow.
- The accent hue and its restrained placement (primary actions, active nav, focus rings only).
- The Space Grotesk / Inter pairing.
- The CTA voice (button shape, border-radius, padding rhythm) — unchanged shapes, changed fill.
- Sidebar nav grouped into three labelled clusters (Configuração / Conteúdo / Conta),
  with "Visão geral" standing alone above the groups as the workspace home.

## What pages MAY differ on
- Content layout inside the workbench pane (stat grid vs. form vs. calendar grid vs. card list) — already differs per page and stays that way.

## Exports

This project is plain CSS custom properties (no Tailwind, no shadcn) — only the
native format applies.

### tokens.css
```css
:root {
  --color-paper:      oklch(9% 0.006 285);
  --color-paper-2:    oklch(12% 0.008 285);
  --color-ink:        oklch(97% 0.006 290);
  --color-ink-2:      oklch(70% 0.02 285);
  --color-rule:       rgba(255, 255, 255, 0.09);
  --color-accent:     oklch(66% 0.19 292);
  --color-accent-ink: oklch(99% 0 0);
  --color-focus:      oklch(72% 0.17 292);

  --font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-body:    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 220ms;
  --radius-sm: 10px; --radius: 16px; --radius-lg: 24px;
}
```
