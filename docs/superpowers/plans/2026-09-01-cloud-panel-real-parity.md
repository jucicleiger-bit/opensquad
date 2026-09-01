# Cloud Panel Real Parity (Fase 3c redo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prior (wrong-target) Fase 3c visual work with a
correct match to the real official local panel, `content-central-app/` —
its `tokens.css`, its two-tier layout (`RootLayout` + nested
`ProjectWorkspaceLayout`), its small shared components
(`Button`/`Card`/`EmptyState`/`Skeleton`), and its real per-page headings/
grouping where a local equivalent exists.

**Architecture:** `cloud-panel-app` adopts the exact same layout-route
pattern `content-central-app` already uses (both are React 19 + Vite +
react-router-dom 7 — same stack, straightforward port). No data-fetching
logic changes anywhere in this plan — every `load`/`save`/`persist`
function in every existing page stays byte-for-byte identical; only the
render markup and file organization (the Offers/Pillars split) change.

**Tech Stack:** Unchanged (React 19 + TypeScript + Vitest). No new
dependencies — `react-router-dom` is already at the same major version as
`content-central-app`.

## Global Constraints

- Every CSS value copied from `content-central-app/src/styles/tokens.css`
  or its `.module.css` files must be copied verbatim — no renamed
  variables, no adjusted colors/spacing, no "improvements." This is a
  literal match, not an approximation.
- No data-fetching/business logic changes anywhere in this plan (except
  Task 3's Offers/Pillars split, which is a pure file reorganization —
  every Supabase call, every state shape, stays the same, just spread
  across 2 files instead of 1).
- `EmptyState`'s `className="empty-state"` has no matching CSS rule
  anywhere in the real `content-central-app` either — this is copied
  as-is (a real, pre-existing gap in the app being matched, not something
  to invent a fix for here).
- `npm run build` is this project's real type-check — always use it.
- Pages with no real local equivalent (`References.tsx`, the 3
  `Aprendizado` pages) keep their own existing layout shape, restyled to
  use `tokens.css`'s shared classes (`.card`, `.field-card`, `.grid`,
  `.row`, `.pill`, buttons) instead of inventing new CSS — there is
  nothing local to copy structurally for these, only the design system
  itself.

---

### Task 1: tokens.css, shared components, two-tier layout, routing

**Files:**
- Modify: `cloud-panel-app/src/styles/global.css` (full replace)
- Create: `cloud-panel-app/src/components/Button.tsx`
- Create: `cloud-panel-app/src/components/Card.tsx`
- Create: `cloud-panel-app/src/components/EmptyState.tsx`
- Create: `cloud-panel-app/src/components/Skeleton.tsx`
- Create: `cloud-panel-app/src/layouts/RootLayout.tsx`
- Create: `cloud-panel-app/src/layouts/RootLayout.module.css`
- Create: `cloud-panel-app/src/layouts/ProjectWorkspaceLayout.tsx`
- Create: `cloud-panel-app/src/layouts/ProjectWorkspaceLayout.module.css`
- Modify: `cloud-panel-app/src/App.tsx` (full rewrite)
- Modify: `cloud-panel-app/src/pages/Dashboard.tsx` (full rewrite)
- Delete: `cloud-panel-app/src/components/AppShell.tsx` (replaced by the
  2 layouts above)

**Interfaces:**
- Produces: `RootLayout` (no props, layout route rendering `<Outlet/>`),
  `ProjectWorkspaceLayout` (no props, layout route reading `projectId`
  from the URL, rendering `<Outlet context={{ project, refreshProject }}
  satisfies WorkspaceContext />`), `WorkspaceContext` interface (`{
  project: { id: string; name: string; slug: string }; refreshProject:
  () => Promise<void> }`) — every later task's page that needs the current
  project reads it via `useOutletContext<WorkspaceContext>()` instead of
  its own separate Supabase query for the project row's name/slug (pages
  that need OTHER project columns, like `company_profile`, still query
  those themselves — `WorkspaceContext` only carries `id`/`name`/`slug`).
  `Button`, `Card`, `EmptyState`, `Skeleton` — same signatures as the real
  ones (see Step 2).

- [ ] **Step 1: Replace `global.css` with the real `tokens.css`**

Replace the entire content of `cloud-panel-app/src/styles/global.css`
with this (copied verbatim from `content-central-app/src/styles/tokens.css`):

```css
/* src/styles/global.css — copied verbatim from content-central-app/src/styles/tokens.css, the real official local panel's design system. Do not hand-edit values here. */
:root {
  color-scheme: dark;
  --bg: #07070a;
  --bg-soft: #0a0a0d;
  --panel: #17161f;
  --panel-2: #1d1c28;
  --surface: rgba(255, 255, 255, 0.045);
  --surface-2: rgba(255, 255, 255, 0.07);
  --surface-3: rgba(255, 255, 255, 0.1);
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
  --muted: #9796a3;
  --text: #f8f7fb;
  --soft: #d6d4e0;
  --accent: oklch(66% 0.19 292);
  --accent-strong: oklch(72% 0.17 292);
  --accent-ink: oklch(99% 0 0);
  --accent-warm: #facc15;
  --accent-2: oklch(70% 0.15 230);
  --gradient-brand: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
  --status-published: oklch(74% 0.12 220);
  --ok: #22c55e;
  --bad: #ef4444;
  --bad-soft: #fecaca;
  --warn: #f59e0b;
  --warn-soft: #fde68a;
  --radius-sm: 10px;
  --radius: 16px;
  --radius-lg: 24px;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --shadow-card: 0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 16px 40px rgba(0, 0, 0, 0.38);
  --button-h: 44px;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-body: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;

  --space-3xs: 2px;
  --space-2xs: 4px;
  --space-xs: 8px;
  --space-sm: 12px;
  --space-md: 18px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --space-3xl: 64px;

  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 15px;
  --text-lg: 18px;
  --text-xl: 22px;
  --text-2xl: 28px;
  --text-3xl: 36px;
  --text-display: 44px;
}

h1,
h2,
h3 {
  font-family: var(--font-display);
  font-style: normal;
  margin: 0;
}

h1 {
  font-size: var(--text-3xl);
  font-weight: 700;
  letter-spacing: -0.025em;
}

h2 {
  font-size: var(--text-xl);
  font-weight: 650;
  letter-spacing: -0.015em;
}

h3 {
  font-size: var(--text-lg);
  font-weight: 650;
  letter-spacing: -0.01em;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.55;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  min-height: var(--button-h);
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--gradient-brand);
  color: var(--accent-ink);
  font-weight: 750;
  padding: 0 18px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 8px 20px -8px oklch(from var(--accent) l c h / 55%);
  transition: background 0.2s var(--ease), filter 0.2s ease, box-shadow 0.2s var(--ease), transform 0.2s var(--ease);
}

button:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 10px 24px -8px oklch(from var(--accent) l c h / 65%);
}

button:active {
  filter: brightness(0.96);
  transform: translateY(0);
}

button:disabled {
  opacity: 0.6;
  cursor: wait;
  transform: none;
}

button.secondary,
button.ghost {
  box-shadow: none;
}

button.secondary:hover,
button.ghost:hover {
  box-shadow: none;
}

button.secondary {
  background: var(--surface-2);
  color: var(--soft);
  border-color: var(--line);
}

button.secondary:hover {
  background: var(--surface-3);
  transform: translateY(-1px);
}

button.ghost {
  background: transparent;
  color: var(--soft);
  border-color: var(--line);
  box-shadow: none;
}

button.ghost:hover {
  background: var(--surface);
  box-shadow: none;
}

.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 9px;
  color: var(--soft);
  font-size: 12px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.035);
  line-height: 1.2;
}

.pill.ok {
  color: #86efac;
  border-color: rgba(34, 197, 94, 0.35);
}

.pill.warn {
  color: var(--warn-soft);
  border-color: rgba(245, 158, 11, 0.4);
}

.pill.muted {
  color: var(--muted);
}

.muted {
  color: var(--muted);
}

label {
  display: block;
  color: var(--soft);
  font-weight: 680;
  font-size: 13px;
  margin: 12px 0 6px;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.035);
  color: var(--text);
  border-radius: 12px;
  padding: 11px 12px;
  outline: none;
  min-height: 44px;
}

input[type="checkbox"] {
  width: 16px;
  min-height: 0;
  height: 16px;
  padding: 0;
  flex: 0 0 auto;
}

select option {
  background-color: var(--panel);
  color: var(--text);
}

textarea {
  min-height: 118px;
  resize: vertical;
  line-height: 1.55;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 4px oklch(from var(--accent) l c h / 16%);
}

button:focus-visible,
a:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--accent-strong);
  outline-offset: 2px;
}

input::placeholder,
textarea::placeholder {
  color: #6f7480;
}

.field-card {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: var(--space-md);
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-md);
}

.row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
}

.notice {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.035);
  border-radius: 18px;
  padding: var(--space-md);
  line-height: 1.65;
}

.button-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-xs);
  align-items: center;
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
  flex-wrap: wrap;
  margin-bottom: var(--space-xl);
}

.page-head h1 {
  font-size: var(--text-display);
  font-weight: 750;
  letter-spacing: -0.03em;
  margin: 0 0 var(--space-2xs);
}

.page-head p {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-md);
}

.actions-row {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.stack-sm > * + * {
  margin-top: var(--space-sm);
}

.stack-md > * + * {
  margin-top: var(--space-md);
}

.stack-lg > * + * {
  margin-top: var(--space-lg);
}

.pill.bad {
  color: var(--bad-soft);
  border-color: rgba(239, 68, 68, 0.34);
}

.full-width {
  width: 100%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 720px) {
  .grid,
  .row {
    grid-template-columns: 1fr;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Create the 4 shared components**

Create `cloud-panel-app/src/components/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  const variantClass = variant === "primary" ? "" : variant;
  return <button className={`${variantClass} ${className}`.trim()} {...rest} />;
}
```

Create `cloud-panel-app/src/components/Card.tsx`:

```tsx
import type { HTMLAttributes } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`.trim()} {...rest} />;
}
```

Create `cloud-panel-app/src/components/EmptyState.tsx`:

```tsx
interface EmptyStateProps {
  title: string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p style={{ margin: 0, fontWeight: 700, color: "var(--soft)" }}>{title}</p>
      {description ? <p style={{ margin: "6px 0 0" }}>{description}</p> : null}
    </div>
  );
}
```

Create `cloud-panel-app/src/components/Skeleton.tsx`:

```tsx
interface SkeletonProps {
  height?: number;
  width?: string | number;
}

export function Skeleton({ height = 16, width = "100%" }: SkeletonProps) {
  return (
    <div
      style={{
        height,
        width,
        borderRadius: 8,
        background: "var(--surface-2)",
        animation: "pulse 1.4s ease-in-out infinite",
      }}
    />
  );
}
```

Delete `cloud-panel-app/src/components/AppShell.tsx` (replaced by the 2
layouts in Steps 3-4 below).

- [ ] **Step 3: Create `RootLayout`**

Create `cloud-panel-app/src/layouts/RootLayout.module.css`:

```css
.topbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--line);
  background: rgba(6, 6, 9, 0.66);
  backdrop-filter: blur(22px) saturate(140%);
  position: sticky;
  top: 0;
  z-index: 20;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  text-decoration: none;
}

.brandMark {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  flex: 0 0 auto;
  background: var(--gradient-brand);
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 14px;
  color: var(--accent-ink);
  box-shadow: 0 4px 14px -4px oklch(from var(--accent) l c h / 60%);
}

.brandName {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: var(--text);
}

.content {
  min-height: calc(100vh - 63px);
  background:
    radial-gradient(760px 420px at 50% -120px, oklch(from var(--accent) l c h / 10%), transparent 70%),
    var(--bg);
}
```

Create `cloud-panel-app/src/layouts/RootLayout.tsx`:

```tsx
import { Link, Outlet } from "react-router-dom";
import styles from "./RootLayout.module.css";

export function RootLayout() {
  return (
    <div>
      <header className={styles.topbar}>
        <Link to="/" className={styles.brand}>
          <div className={styles.brandMark}>CC</div>
          <span className={styles.brandName}>Central de Conteúdo</span>
        </Link>
        <div style={{ marginLeft: "auto" }}>
          <Link to="/conta" className="muted" style={{ fontSize: 13 }}>
            Conta / MFA
          </Link>
        </div>
      </header>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
```

(The extra "Conta / MFA" link in the topbar is a cloud-only addition —
local doesn't need it in the topbar because its own "Conta e token" is a
per-project sidebar entry with no global-account equivalent; the cloud
panel's `/conta` route is genuinely global (MFA), so it needs a way in
from every page, not just from inside a project.)

- [ ] **Step 4: Create `ProjectWorkspaceLayout`**

Create `cloud-panel-app/src/layouts/ProjectWorkspaceLayout.module.css`
(copied verbatim from `content-central-app/src/layouts/ProjectWorkspaceLayout.module.css`):

```css
.shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: calc(100vh - 63px);
}

.sidebar {
  border-right: 1px solid var(--line);
  background: var(--bg-soft);
  padding: var(--space-lg) var(--space-sm);
  position: sticky;
  top: 63px;
  align-self: start;
  height: calc(100vh - 63px);
  overflow-y: auto;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--muted);
  text-decoration: none;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: var(--space-sm);
}

.back:hover {
  color: var(--soft);
}

.projectName {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: var(--space-md);
  overflow-wrap: anywhere;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
}

.navLink {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: var(--space-xs) var(--space-sm);
  border-radius: 12px;
  color: var(--muted);
  text-decoration: none;
  font-weight: 650;
  font-size: 13px;
  transition: color 0.2s var(--ease), background 0.2s var(--ease);
}

.navLink:hover {
  color: var(--soft);
  background: var(--surface);
}

.navLinkActive {
  color: var(--accent-ink);
  background: var(--accent);
}

.navGroupLabel {
  padding: var(--space-md) var(--space-sm) var(--space-2xs);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.navGroupLabel:first-child {
  padding-top: var(--space-2xs);
}

.content {
  padding: var(--space-xl) var(--space-2xl) 60px;
  min-width: 0;
}

@media (max-width: 900px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: none;
    border-bottom: 1px solid var(--line);
    position: static;
    height: auto;
    overflow-y: visible;
  }

  .nav {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
```

Create `cloud-panel-app/src/layouts/ProjectWorkspaceLayout.tsx` — adapted
from the real one: same shell/nav mechanics, but `SECTIONS` trimmed to
only what the cloud panel actually has (no catalog-mode
show/hide — that's a local-only concept tied to AI generation config the
cloud doesn't manage), and the current project is fetched directly (the
cloud has no single `getState()` call that returns every project with
nested data the way local does — a plain Supabase `.single()` query on
`id/name/slug` is enough here, since pages that need more, like
`company_profile`, already query that themselves):

```tsx
import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import styles from "./ProjectWorkspaceLayout.module.css";

interface Project {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceContext {
  project: Project;
  refreshProject: () => Promise<void>;
}

// Mirrors content-central-app/src/layouts/ProjectWorkspaceLayout.tsx's
// SECTIONS — trimmed to what the cloud panel actually has. "Aprendizado"
// has no equivalent in the real local nav (kept grouped under Conteúdo as
// the most sensible placement for a cloud-only addition).
const SECTIONS = [
  { to: "visao-geral", label: "Visão geral", group: null as string | null },
  { to: "empresa", label: "Empresa / Raio-X", group: "Configuração" },
  { to: "referencias", label: "Imagem e identidade visual", group: "Configuração" },
  { to: "ofertas", label: "Ofertas e assuntos", group: "Configuração" },
  { to: "pilares", label: "Pilares", group: "Configuração" },
  { to: "aguardando", label: "Aguardando aprovação", group: "Conteúdo" },
  { to: "calendario", label: "Calendário", group: "Conteúdo" },
  { to: "aprendizado", label: "Aprendizado", group: "Conteúdo" },
];

export function ProjectWorkspaceLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function refreshProject() {
    const { data, error: queryError } = await supabase
      .from("projects")
      .select("id, name, slug")
      .eq("id", projectId)
      .single();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setProject(data);
    setError(null);
  }

  useEffect(() => {
    setProject(undefined);
    refreshProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (error) {
    return (
      <div style={{ padding: "var(--space-xl)" }}>
        <EmptyState title="Não foi possível carregar o projeto" description={error} />
      </div>
    );
  }

  if (project === undefined) {
    return (
      <div style={{ padding: "var(--space-xl)" }}>
        <Skeleton height={140} />
      </div>
    );
  }

  if (project === null) {
    return (
      <div style={{ padding: "var(--space-xl)" }}>
        <EmptyState title="Projeto não encontrado" description={`Não existe projeto com o id "${projectId}".`} />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <NavLink to="/" className={styles.back}>
          ← Todos os projetos
        </NavLink>
        <div className={styles.projectName}>{project.name}</div>
        <nav className={styles.nav}>
          {SECTIONS.map((section, index) => {
            const showGroupLabel = section.group && section.group !== SECTIONS[index - 1]?.group;
            return (
              <div key={section.to}>
                {showGroupLabel ? <div className={styles.navGroupLabel}>{section.group}</div> : null}
                <NavLink
                  to={section.to}
                  className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`.trim()}
                >
                  {section.label}
                </NavLink>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className={styles.content}>
        <Outlet context={{ project, refreshProject } satisfies WorkspaceContext} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `App.tsx` with the 2-tier nested routing**

Replace the full content of `cloud-panel-app/src/App.tsx` with:

```tsx
import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Overview } from "@/pages/Overview";
import { Approval } from "@/pages/Approval";
import { CalendarPage } from "@/pages/Calendar";
import { Company } from "@/pages/Company";
import { Offers } from "@/pages/Offers";
import { Pillars } from "@/pages/Pillars";
import { References } from "@/pages/References";
import { SegmentLearning } from "@/pages/SegmentLearning";
import { OfferTypeLearning } from "@/pages/OfferTypeLearning";
import { SegmentTemplates } from "@/pages/SegmentTemplates";
import { Account } from "@/pages/Account";
import { RootLayout } from "@/layouts/RootLayout";
import { ProjectWorkspaceLayout } from "@/layouts/ProjectWorkspaceLayout";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <RootLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/conta" element={<Account />} />
        <Route path="/aprendizado/tipos-de-oferta" element={<OfferTypeLearning />} />
        <Route path="/aprendizado/templates" element={<SegmentTemplates />} />
        <Route path="/projects/:projectId" element={<ProjectWorkspaceLayout />}>
          <Route path="visao-geral" element={<Overview />} />
          <Route path="empresa" element={<Company />} />
          <Route path="referencias" element={<References />} />
          <Route path="ofertas" element={<Offers />} />
          <Route path="pilares" element={<Pillars />} />
          <Route path="aguardando" element={<Approval />} />
          <Route path="calendario" element={<CalendarPage />} />
          <Route path="aprendizado" element={<SegmentLearning />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

Note the URL shape change: project pages are now `/projects/:projectId/empresa`
etc. (unchanged) but nested under a parent `/projects/:projectId` route
that renders `ProjectWorkspaceLayout` — react-router resolves this
correctly as long as the child `path` values have no leading slash (as
above).

- [ ] **Step 6: Rewrite `Dashboard.tsx`**

Replace the full content of `cloud-panel-app/src/pages/Dashboard.tsx`
with:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

interface Project {
  id: string;
  name: string;
  slug: string;
}

export function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id, name, slug")
      .order("name")
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message);
        else setProjects(data);
      });
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "var(--space-xl) var(--space-2xl)" }}>
      <div className="page-head">
        <div>
          <h1>Seus projetos</h1>
          <p>Selecione um projeto para acompanhar e aprovar conteúdo.</p>
        </div>
        <div className="actions-row">
          <Link to="/aprendizado/tipos-de-oferta" className="muted" style={{ fontSize: 13 }}>
            Tipos de Oferta
          </Link>
          <Link to="/aprendizado/templates" className="muted" style={{ fontSize: 13 }}>
            Templates de Segmento
          </Link>
        </div>
      </div>

      {error ? <EmptyState title="Não foi possível carregar os projetos" description={error} /> : null}
      {!projects && !error ? <Skeleton height={100} /> : null}
      {projects && projects.length === 0 ? <EmptyState title="Nenhum projeto ainda" /> : null}

      <div style={{ display: "grid", gap: "var(--space-sm)" }}>
        {(projects || []).map((project) => (
          <Link key={project.id} to={`/projects/${project.id}/visao-geral`} style={{ textDecoration: "none", color: "inherit" }}>
            <Card style={{ padding: "var(--space-md)" }}>
              <strong>{project.name}</strong>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: fails — Tasks 3-6 haven't created `Offers.tsx`/`Pillars.tsx` yet
and haven't updated the pages that still expect the old `AppShell`. This
is expected mid-plan; the build only needs to be clean once every task
lands. For THIS task alone, confirm the failure is only "module not
found" for `@/pages/Offers`, `@/pages/Pillars` (not yet created) and nothing
else — that isolates this task's own code as otherwise correct.

Run: `npx vitest run`
Expected: PASS, same test count as before (no test files touched).

- [ ] **Step 8: Commit**

```bash
git add cloud-panel-app/src/styles/global.css cloud-panel-app/src/components/Button.tsx cloud-panel-app/src/components/Card.tsx cloud-panel-app/src/components/EmptyState.tsx cloud-panel-app/src/components/Skeleton.tsx cloud-panel-app/src/layouts cloud-panel-app/src/App.tsx cloud-panel-app/src/pages/Dashboard.tsx
git rm cloud-panel-app/src/components/AppShell.tsx
git commit -m "feat(cloud-panel): adopt content-central-app's real tokens.css, layouts, and shared components"
```

---

### Task 2: Overview

**Files:**
- Modify: `cloud-panel-app/src/pages/Overview.tsx`

**Interfaces:** Consumes `WorkspaceContext` from
`@/layouts/ProjectWorkspaceLayout` (Task 1) via `useOutletContext()`
instead of `useParams()` for the project id — `project.id` replaces the
old `projectId` param throughout.

- [ ] **Step 1: Rewrite `Overview.tsx`**

Replace the full content of `cloud-panel-app/src/pages/Overview.tsx`
with:

```tsx
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/Card";

interface Stats {
  total: number;
  draft: number;
  approved: number;
}

interface ChecklistItem {
  label: string;
  done: boolean;
}

export function Overview() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [stats, setStats] = useState<Stats | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [itemsResult, projectResult] = await Promise.all([
        supabase.from("content_items").select("status").eq("project_id", project.id),
        supabase.from("projects").select("company_profile, content_strategy, brand_profile").eq("id", project.id).single(),
      ]);
      if (itemsResult.error) {
        setError(itemsResult.error.message);
        return;
      }
      if (projectResult.error) {
        setError(projectResult.error.message);
        return;
      }
      const rows = itemsResult.data || [];
      setStats({
        total: rows.length,
        draft: rows.filter((r) => r.status === "draft").length,
        approved: rows.filter((r) => r.status === "approved").length,
      });
      const profile = (projectResult.data.company_profile || {}) as Record<string, unknown>;
      const strategy = (projectResult.data.content_strategy || {}) as { offers?: unknown[] };
      const brand = (projectResult.data.brand_profile || {}) as { references?: unknown[] };
      setChecklist([
        { label: "Perfil da empresa preenchido", done: Boolean(profile.segment || profile.description) },
        { label: "Pelo menos 1 oferta cadastrada", done: Array.isArray(strategy.offers) && strategy.offers.length > 0 },
        { label: "Pelo menos 1 referência enviada", done: Array.isArray(brand.references) && brand.references.length > 0 },
      ]);
    }
    load();
  }, [project.id]);

  if (error) return <Card style={{ padding: 20 }}>Erro: {error}</Card>;
  if (!stats || !checklist) return <Card style={{ padding: 20 }}>Carregando...</Card>;

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-2xs)" }}>{project.name}</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>{project.slug}</p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Card style={{ padding: "var(--space-md)" }}>
          <b style={{ display: "block", fontSize: "var(--text-2xl)" }}>{stats.total}</b>
          <span className="muted">conteúdos</span>
        </Card>
        <Card style={{ padding: "var(--space-md)" }}>
          <b style={{ display: "block", fontSize: "var(--text-2xl)" }}>{stats.draft}</b>
          <span className="muted">aguardando aprovação</span>
        </Card>
        <Card style={{ padding: "var(--space-md)" }}>
          <b style={{ display: "block", fontSize: "var(--text-2xl)" }}>{stats.approved}</b>
          <span className="muted">aprovados</span>
        </Card>
      </div>

      <h3 style={{ margin: "var(--space-lg) 0 var(--space-sm)" }}>Checklist do projeto</h3>
      <div style={{ display: "grid", gap: "var(--space-xs)" }}>
        {checklist.map((item) => (
          <div key={item.label} className="field-card" style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <span style={{ width: 20 }}>{item.done ? "✓" : "•"}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: still fails on missing `Offers`/`Pillars` (Task 3 not landed
yet, if running this task in isolation) — confirm no OTHER errors
reference `Overview.tsx`.

Run: `npx vitest run`
Expected: PASS, same test count as before.

- [ ] **Step 3: Commit**

```bash
git add cloud-panel-app/src/pages/Overview.tsx
git commit -m "feat(cloud-panel): restyle Overview to use WorkspaceContext and real design tokens"
```

---

### Task 3: split Offers/Pillars

**Files:**
- Create: `cloud-panel-app/src/pages/Offers.tsx`
- Create: `cloud-panel-app/src/pages/Pillars.tsx`
- Delete: `cloud-panel-app/src/pages/OffersAndPillars.tsx`

**Interfaces:** Both consume `WorkspaceContext` for `project.id`. Both
still import `upsertById`/`removeById` from `@/lib/contentStrategy`
(unchanged). `Offers.tsx` reads `content_strategy.pillars` (read-only, for
the offer→pillar link dropdown) but never writes it.

- [ ] **Step 1: Create `Offers.tsx`**

Create `cloud-panel-app/src/pages/Offers.tsx` — this is
`OffersAndPillars.tsx`'s existing offers+offerGroups logic, unchanged,
with `pillars` kept read-only for the dropdown, `projectId` replaced by
`project.id` from context, and restyled with `Card`/`Button`:

```tsx
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
```

- [ ] **Step 2: Create `Pillars.tsx`**

Create `cloud-panel-app/src/pages/Pillars.tsx` — the pillars slice of the
old file, unchanged logic, `project.id` from context:

```tsx
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
```

Note: `Pillars.tsx`'s `persist` re-fetches `content_strategy` fresh before
writing (unlike `Offers.tsx`, which already holds the whole object in
state) — this is necessary because `Pillars.tsx` never loads
`offers`/`offerGroups` into its own state, so it must read the CURRENT
value of those sibling fields immediately before the write to avoid
clobbering them with stale/absent data. This is the same
read-modify-write discipline used everywhere else in this project, just
applied at write-time instead of load-time since this page only cares
about one slice.

- [ ] **Step 3: Delete the old combined file**

```bash
git rm cloud-panel-app/src/pages/OffersAndPillars.tsx
```

- [ ] **Step 4: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: still fails only on other not-yet-landed tasks' pages if run in
isolation — confirm no error references `Offers.tsx`, `Pillars.tsx`, or
`OffersAndPillars`.

Run: `npx vitest run`
Expected: PASS, same test count as before.

- [ ] **Step 5: Commit**

```bash
git add cloud-panel-app/src/pages/Offers.tsx cloud-panel-app/src/pages/Pillars.tsx
git commit -m "feat(cloud-panel): split Offers and Pillars into separate pages, matching the real local nav"
```

---

### Task 4: Company, Account

**Files:**
- Modify: `cloud-panel-app/src/pages/Company.tsx`
- Modify: `cloud-panel-app/src/pages/Account.tsx`

**Interfaces:** Both switch from `useParams()` to
`useOutletContext<WorkspaceContext>()` for the project id (`Account.tsx`
doesn't use a project id at all today — no change needed there beyond the
wrapper/component swap).

- [ ] **Step 1: `Company.tsx`**

In `cloud-panel-app/src/pages/Company.tsx`:

1. Change the import line from:
   ```tsx
   import { useEffect, useState } from "react";
   import { useParams } from "react-router-dom";
   import { supabase } from "@/lib/supabaseClient";
   import { approveBrandDocument, type BrandDocument } from "@/lib/approveBrandDocument";
   ```
   to:
   ```tsx
   import { useEffect, useState } from "react";
   import { useOutletContext } from "react-router-dom";
   import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
   import { supabase } from "@/lib/supabaseClient";
   import { approveBrandDocument, type BrandDocument } from "@/lib/approveBrandDocument";
   import { Card } from "@/components/Card";
   import { Button } from "@/components/Button";
   ```
2. Change `const { projectId } = useParams<{ projectId: string }>();` to
   `const { project } = useOutletContext<WorkspaceContext>();` and replace
   every other use of `projectId` in this file with `project.id`.
3. In `BrandDocumentSection`, change the outer `<section className="card" style={{...}}>` to `<Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>` (closing `</section>` → `</Card>`), and change its `<button type="button" className="primary" ...>` to `<Button type="button" onClick={onApprove} disabled={busy}>` (drop the now-redundant `className="primary"`, `Button` defaults to primary).
4. Replace the page's outer return wrapper — change:
   ```tsx
     return (
       <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
         <div className="section-title">
           <h2>Empresa</h2>
           <span className="step">coleta rápida</span>
         </div>
   ```
   to:
   ```tsx
     return (
       <div>
         <h2 style={{ margin: "0 0 var(--space-2xs)" }}>Empresa / Raio-X</h2>
         <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
           Cadastre os fatos da empresa. A identidade visual fica na aba Imagem e identidade visual.
         </p>
   ```
   (title text now matches the real local heading verbatim; the
   `<section className="card">Perfil</section>` block right after becomes
   `<Card style={{ padding: 20 }}>` / `</Card>` — same field-card/grid
   content from the prior phase inside, unchanged.)
5. Replace every remaining bare `<button type="button" className="primary" ...>` /
   `className="danger"` in this file with `<Button ...>` /
   `<Button variant="ghost" ...>` (drop the `className` prop, `Button`
   handles variants).

- [ ] **Step 2: `Account.tsx`**

In `cloud-panel-app/src/pages/Account.tsx`, this page has no project
context (MFA is account-wide) — only wrap it with `Card`/`Button` instead
of raw `className="card"`/`className="primary"`:

Change:
```tsx
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
```
to:
```tsx
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
```

Change the outer wrapper:
```tsx
    <div className="card">
      <div className="section-title">
        <h2>Autenticação em duas etapas</h2>
        <span className="step">segurança</span>
      </div>
```
to:
```tsx
    <Card style={{ padding: 20, maxWidth: 480, margin: "40px auto" }}>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Conta e token</h2>
```

(closing `</div>` at the end of the component → `</Card>`.) Replace every
`<button type="button" className="primary" ...>` with `<Button ...>`
(drop `className`).

- [ ] **Step 3: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: still fails only on other not-yet-landed tasks if run in
isolation — confirm no error references `Company.tsx`/`Account.tsx`.

Run: `npx vitest run`
Expected: PASS, same test count as before.

- [ ] **Step 4: Commit**

```bash
git add cloud-panel-app/src/pages/Company.tsx cloud-panel-app/src/pages/Account.tsx
git commit -m "feat(cloud-panel): restyle Company, Account with real components and WorkspaceContext"
```

---

### Task 5: References, Approval (rename to Aguardando), Calendar

**Files:**
- Modify: `cloud-panel-app/src/pages/References.tsx`
- Modify: `cloud-panel-app/src/pages/Approval.tsx`
- Create: `cloud-panel-app/src/pages/Approval.module.css`
- Modify: `cloud-panel-app/src/pages/Calendar.tsx`

**Interfaces:** All 3 switch `useParams()` → `useOutletContext<WorkspaceContext>()`.

- [ ] **Step 1: `References.tsx`**

Same treatment as Company.tsx Steps 1-2 above (swap `useParams` for
`useOutletContext`, `projectId` → `project.id`, `<Card>`/`<Button>`
instead of raw classes). No real local page to structurally mirror (see
Global Constraints) — keep the existing gallery-of-cards layout, just:

1. Import swap (same pattern as Company.tsx Step 1, plus `Card`/`Button`).
2. `useParams` → `useOutletContext<WorkspaceContext>()`, `projectId` →
   `project.id`.
3. Title: change
   ```tsx
       <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
         <div className="section-title">
           <h2>Referências</h2>
           <span className="step">identidade visual</span>
         </div>
   ```
   to:
   ```tsx
       <div>
         <h2 style={{ margin: "0 0 var(--space-2xs)" }}>Imagem e identidade visual</h2>
         <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
           Referências visuais usadas para orientar a geração de conteúdo.
         </p>
   ```
4. Replace `<section className="card">...</section>` wrappers with
   `<Card style={{ padding: 20 }}>...</Card>`. Replace the gallery grid's
   own inline styles with `className="grid"` where it's a 2-up layout
   already, or leave the per-reference-card flex row as-is (it's a list,
   not a 2-column grid) but wrap each row in `className="field-card"`
   instead of a bare `<div>`.
5. Replace bare `<button type="button">`/`className="danger"` with
   `<Button variant="secondary">`/`<Button variant="ghost">`.

- [ ] **Step 2: `Approval.tsx` — rename to "Aguardando aprovação", own module.css**

Create `cloud-panel-app/src/pages/Approval.module.css` (copied verbatim
from `content-central-app/src/pages/workspace/PendingApproval.module.css`,
trimmed to only the classes this simpler page actually uses):

```css
.list {
  display: grid;
  gap: 14px;
}

.card {
  padding: 18px;
  display: grid;
  grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
  gap: 20px;
}

.phone {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #050506;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.phone img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.caption {
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 13px;
  color: var(--soft);
  line-height: 1.6;
  margin: 12px 0;
  min-height: 120px;
  resize: vertical;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .card {
    grid-template-columns: 1fr;
  }
}
```

In `cloud-panel-app/src/pages/Approval.tsx`:

1. Change the import line from:
   ```tsx
   import { useEffect, useState } from "react";
   import { useParams } from "react-router-dom";
   import { supabase } from "@/lib/supabaseClient";
   import { groupByDay } from "@/lib/groupByDay";
   ```
   to:
   ```tsx
   import { useEffect, useState } from "react";
   import { useOutletContext } from "react-router-dom";
   import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
   import { supabase } from "@/lib/supabaseClient";
   import { groupByDay } from "@/lib/groupByDay";
   import { Card } from "@/components/Card";
   import { Button } from "@/components/Button";
   import styles from "./Approval.module.css";
   ```
2. `useParams` → `useOutletContext<WorkspaceContext>()`, `projectId` →
   `project.id`.
3. Change the title block:
   ```tsx
       <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
         <div className="section-title">
           <h2>Conteúdos gerados</h2>
           <span className="step">revisão</span>
         </div>
   ```
   to:
   ```tsx
       <div>
         <h2 style={{ margin: "0 0 var(--space-lg)" }}>Aguardando aprovação</h2>
   ```
4. Replace the per-item `<div key={item.id} className="card">...</div>`
   block with `<Card key={item.id} className={styles.card}>` (closing
   `</div>` → `</Card>`); wrap the image/placeholder in
   `<div className={styles.phone}>...</div>` (the "Ver imagem" button
   stays a plain `<Button variant="secondary">` inside it, sized by the
   `.phone` container); the caption `<textarea>` gets
   `className={styles.caption}` added (keep its existing `rows`/`value`/
   `onChange`); the action-button row's wrapping `<div>` gets
   `className={styles.actions}` instead of its inline flex style; every
   `<button>` in the row becomes `<Button>`/`<Button variant="ghost">`
   (drop `className="primary"`/`className="danger"`).
5. Wrap each day-group's item list (the `<div style={{display:"flex",
   flexDirection:"column", gap:12}}>` around `group.items.map(...)`) with
   `className={styles.list}` instead of the inline style.

- [ ] **Step 3: `Calendar.tsx`**

Same treatment: `useParams` → `useOutletContext<WorkspaceContext>()`,
`projectId` → `project.id`, title becomes:
```tsx
      <h2 style={{ margin: 0 }}>Calendário</h2>
```
(no subtitle in the real page), wrap each schedule row in `<Card
style={{ padding: 14 }}>` instead of `<div className="card">`, drop the
now-unneeded `var(--muted)` inline color override on the time span (it's
already the base text color inherited correctly, but if kept, it's
already correct as `var(--muted)` — no change needed there, that variable
still exists in the new tokens.css).

- [ ] **Step 4: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean IF this is the last task landing; otherwise still fails
only on other not-yet-landed tasks.

Run: `npx vitest run`
Expected: PASS, same test count as before.

- [ ] **Step 5: Commit**

```bash
git add cloud-panel-app/src/pages/References.tsx cloud-panel-app/src/pages/Approval.tsx cloud-panel-app/src/pages/Approval.module.css cloud-panel-app/src/pages/Calendar.tsx
git commit -m "feat(cloud-panel): restyle References, Calendar, rename Approval to Aguardando aprovação"
```

---

### Task 6: SegmentLearning, OfferTypeLearning, SegmentTemplates, Login

**Files:**
- Modify: `cloud-panel-app/src/pages/SegmentLearning.tsx`
- Modify: `cloud-panel-app/src/pages/OfferTypeLearning.tsx`
- Modify: `cloud-panel-app/src/pages/SegmentTemplates.tsx`
- Modify: `cloud-panel-app/src/pages/Login.tsx`

**Interfaces:** `SegmentLearning.tsx` switches `useParams()` →
`useOutletContext<WorkspaceContext>()` (it's the only one of these 3
nested under `/projects/:projectId`). `OfferTypeLearning.tsx` and
`SegmentTemplates.tsx` are global routes (no project context) — no params
change, only component/class swaps. `Login.tsx` stays outside every
layout — only class/variable swaps.

- [ ] **Step 1: `SegmentLearning.tsx`**

Same pattern as Company.tsx Step 1-2: `useParams` →
`useOutletContext<WorkspaceContext>()`, `projectId` → `project.id`, import
`Card`/`Button`, title block becomes:
```tsx
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Aprendizado do Segmento</h2>
```
Wrap each `<section className="card">` with `<Card style={{ padding: 20 }}>`,
each list-row `<div>` with `className="field-card"`, buttons with
`<Button>`/`<Button variant="ghost">`.

- [ ] **Step 2: `OfferTypeLearning.tsx`**

No `useParams`/`useOutletContext` change (already global, no project id
used). Import `Card`/`Button`. Title block becomes:
```tsx
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Aprendizado por Tipo de Oferta</h2>
```
Same `<section className="card">` → `<Card>`, button → `<Button>` swaps
as the other pages.

- [ ] **Step 3: `SegmentTemplates.tsx`**

Same treatment, no project context. Title block becomes:
```tsx
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Templates de Segmento</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>Somente leitura — criar/editar template continua via script local.</p>
```
(restores the full explanatory sentence — the earlier phase's shortened
version is no longer needed since this page has its own subtitle line
here instead of relying on a `.step` badge, which doesn't exist in the
real design system). `<section className="card">` → `<Card>` around each
template's piece grid.

- [ ] **Step 4: `Login.tsx`**

Stays outside every layout (unauthenticated) — no structural change, just
confirm it still reads correctly against the new `tokens.css` (its
`className="card"` and `className="primary"` already resolve correctly
against the new stylesheet with no changes needed — verify by inspection,
don't edit unless the build/visual check surfaces a real problem).

- [ ] **Step 5: Build and verify — the whole app**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean now that every task has landed (this is the last task in
the plan).

Run: `npx vitest run`
Expected: PASS, same test count as before (no test files touched by this
whole plan).

- [ ] **Step 6: Commit**

```bash
git add cloud-panel-app/src/pages/SegmentLearning.tsx cloud-panel-app/src/pages/OfferTypeLearning.tsx cloud-panel-app/src/pages/SegmentTemplates.tsx cloud-panel-app/src/pages/Login.tsx
git commit -m "feat(cloud-panel): restyle SegmentLearning, OfferTypeLearning, SegmentTemplates with real components"
```

---

## Post-plan (controller, not a subagent task)

After all 6 tasks land and the final review is clean:

1. Deploy `cloud-panel-app` to Vercel (`npx vercel --yes --prod`).
2. Open the deployed URL side-by-side with `content-central-app` running
   locally (`npm run dev` in that folder) and manually confirm: same
   colors/typography/spacing, same 2-tier layout (topbar, then per-project
   sidebar with the same grouped labels), Ofertas and Pilares are separate
   pages, Approval reads "Aguardando aprovação" with the phone-style
   preview layout.
3. Report to the user any place the comparison reveals a real visual gap
   the plan didn't anticipate.
