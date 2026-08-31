# Cloud Panel Core — Fase 3a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new, minimal React app — separate from the local `content-central-app` — that lets the user log in, see their projects, approve/reject/edit content, and view/reschedule the publish calendar, all talking directly to the real Supabase project (no custom backend).

**Architecture:** `cloud-panel-app/` (Vite + React 19 + TypeScript, sibling to `content-central-app/`, same tooling conventions) using `@supabase/supabase-js` in the browser with the anon key + the logged-in user's session. RLS (already in place from Fase 1) is the only access control — no server-side code in this phase. Three routes behind an auth guard: dashboard (project list), approval (per-project content review), calendar (per-project schedule view). Deployed to Vercel afterward (manual step, not part of this plan).

## Global Constraints

- No custom backend — every data call goes through `@supabase/supabase-js` directly from the browser, relying on RLS.
- No generation-triggering UI (no Regenerate/Animate/Test-post/Generate buttons) — those need the Fase 4 local agent, which doesn't exist yet. Not shown as disabled buttons; simply absent from this phase.
- Reject maps to `content_items.status = 'cancelled'` (soft, matches the existing status the Fase 1 migration already uses) — never a hard delete.
- Reschedule is only offered while `schedules.status = 'pending'` — an item already `'running'`/`'done'`/`'error'` has no reschedule action shown.
- `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are the only Supabase credentials this app ever holds — never the service_role/secret key (that's server-only, per Fase 1/2's rule).
- Pure logic (date grouping, caption-dirty check) gets `vitest` coverage, matching this repo's existing `content-central-app` test convention (`vitest`, `@testing-library/react` already used there). Live Supabase calls (auth, approve, reject, reschedule) are verified manually against the real project, not unit tested — same convention as every prior phase.

---

### Task 1: App scaffold + Supabase client

**Files:**
- Create: `cloud-panel-app/package.json`
- Create: `cloud-panel-app/vite.config.ts`
- Create: `cloud-panel-app/tsconfig.json`
- Create: `cloud-panel-app/tsconfig.app.json`
- Create: `cloud-panel-app/tsconfig.node.json`
- Create: `cloud-panel-app/index.html`
- Create: `cloud-panel-app/src/main.tsx`
- Create: `cloud-panel-app/src/App.tsx`
- Create: `cloud-panel-app/src/styles/global.css`
- Create: `cloud-panel-app/src/lib/supabaseClient.ts`
- Create: `cloud-panel-app/.env.example`
- Create: `cloud-panel-app/tests/setup.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `supabase` — a singleton `SupabaseClient` exported from `src/lib/supabaseClient.ts`, imported by every later task. `App()` — the root route component, initially rendering a placeholder, extended by Tasks 2-5.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "cloud-panel-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "2.106.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.6.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^22.14.0",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@vitejs/plugin-react": "^4.5.2",
    "jsdom": "^25.0.1",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vitest": "^3.0.9"
  }
}
```

`@supabase/supabase-js` is pinned to the exact version already proven Node-20-compatible in Fase 1 (`src/supabase-client.js`) — same reasoning, no unpinned `^` on this one dependency.

- [ ] **Step 2: `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(() => ({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5175,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    globals: true,
  },
}));
```

- [ ] **Step 3: TypeScript config**

```json
// tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

```json
// tsconfig.app.json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

```json
// tsconfig.node.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: `index.html` and app entrypoint**

```html
<!-- index.html -->
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Painel — Opensquad</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

```tsx
// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<div>Login placeholder — Task 2 replaces this</div>} />
    </Routes>
  );
}
```

- [ ] **Step 5: global stylesheet (minimal, utilitarian — this is an internal tool, not a marketing page)**

```css
/* src/styles/global.css */
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --surface: #ffffff;
  --border: #dde1e6;
  --text: #1a1d23;
  --text-dim: #6b7280;
  --accent: #2f6f4f;
  --accent-hover: #245a3f;
  --danger: #b3261e;
  --radius: 8px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.5;
}

button {
  font: inherit;
  cursor: pointer;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  padding: 8px 14px;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
button.primary:hover { background: var(--accent-hover); }

button.danger {
  color: var(--danger);
  border-color: var(--danger);
}

button:disabled { opacity: 0.5; cursor: not-allowed; }

input, textarea {
  font: inherit;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  width: 100%;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
```

- [ ] **Step 6: Supabase client + env example**

```ts
// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required");
}

export const supabase = createClient(url, anonKey);
```

```
# cloud-panel-app/.env.example
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Step 7: test setup file**

```ts
// tests/setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 8: install and verify it builds**

Run: `cd cloud-panel-app && npm install && npm run build`
Expected: build succeeds (no tests exist yet — that's fine, later tasks add them and this task's job is just a working scaffold).

- [ ] **Step 9: commit**

```bash
git add cloud-panel-app/
git commit -m "feat: scaffold cloud-panel-app (Fase 3a)"
```

---

### Task 2: Auth — login, MFA challenge, session guard

**Files:**
- Create: `cloud-panel-app/src/pages/Login.tsx`
- Create: `cloud-panel-app/src/lib/useSession.ts`
- Create: `cloud-panel-app/src/components/RequireAuth.tsx`
- Modify: `cloud-panel-app/src/App.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 1).
- Produces: `useSession()` — a hook returning `{ session: Session | null, loading: boolean }`, tracking `supabase.auth.onAuthStateChange`. `<RequireAuth>` — a route wrapper redirecting to `/login` when there's no session or the session's AAL is below what MFA requires. Tasks 3-5 wrap their routes in `<RequireAuth>`.

- [ ] **Step 1: session hook**

```ts
// src/lib/useSession.ts
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
```

- [ ] **Step 2: route guard**

```tsx
// src/components/RequireAuth.tsx
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "@/lib/useSession";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <div className="card">Carregando...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

Note: this guard only checks that *a* session exists — it doesn't itself check AAL. That's fine here: the Login page below (Step 3) always completes the MFA challenge before it ever navigates to `/`, so by the time `RequireAuth` sees a session it's already AAL2. Separately, this repo's RLS today checks `auth.uid()` only, not `aal` (a known follow-up noted in the Fase 1 design) — this task doesn't touch RLS, just the frontend's own login flow.

- [ ] **Step 3: login page with MFA challenge**

```tsx
// src/pages/Login.tsx
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

type Step = "credentials" | "mfa";

export function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.currentLevel === aal.nextLevel) {
      // No MFA factor enrolled, or already at the required level.
      navigate("/", { replace: true });
      return;
    }
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    const totpFactor = factors?.totp?.[0];
    if (factorsError || !totpFactor) {
      setError(factorsError?.message || "Nenhum fator MFA encontrado para este usuário.");
      setBusy(false);
      return;
    }
    setFactorId(totpFactor.id);
    setStep("mfa");
    setBusy(false);
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setBusy(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setError(challengeError.message);
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) {
      setError(verifyError.message);
      setBusy(false);
      return;
    }
    navigate("/", { replace: true });
  }

  if (step === "mfa") {
    return (
      <form className="card" style={{ maxWidth: 360, margin: "80px auto" }} onSubmit={handleMfa}>
        <h1>Código do autenticador</h1>
        <input
          type="text"
          inputMode="numeric"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Verificando..." : "Confirmar"}
        </button>
      </form>
    );
  }

  return (
    <form className="card" style={{ maxWidth: 360, margin: "80px auto" }} onSubmit={handleCredentials}>
      <h1>Entrar</h1>
      <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input
        type="password"
        placeholder="Senha"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: wire the route**

```tsx
// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { Login } from "@/pages/Login";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <div>Dashboard placeholder — Task 3 replaces this</div>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
```

- [ ] **Step 5: build check**

Run: `cd cloud-panel-app && npm run build`
Expected: succeeds, no type errors.

- [ ] **Step 6: commit**

```bash
git add cloud-panel-app/src
git commit -m "feat: add login with MFA challenge and session guard"
```

---

### Task 3: Dashboard — project list

**Files:**
- Create: `cloud-panel-app/src/pages/Dashboard.tsx`
- Modify: `cloud-panel-app/src/App.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 1), `RequireAuth` (Task 2).
- Produces: the `/` route rendering a project list; each project links to `/projects/:projectId/aprovacao` (Task 4 defines that route).

- [ ] **Step 1: Dashboard page**

```tsx
// src/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

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

  if (error) return <div className="card">Erro ao carregar projetos: {error}</div>;
  if (!projects) return <div className="card">Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 12 }}>
      <h1>Projetos</h1>
      {projects.length === 0 ? <p>Nenhum projeto ainda.</p> : null}
      {projects.map((project) => (
        <Link
          key={project.id}
          to={`/projects/${project.id}/aprovacao`}
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <strong>{project.name}</strong>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: wire the route**

```tsx
// src/App.tsx
import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
```

- [ ] **Step 3: build check**

Run: `cd cloud-panel-app && npm run build`
Expected: succeeds.

- [ ] **Step 4: commit**

```bash
git add cloud-panel-app/src
git commit -m "feat: add dashboard project list"
```

---

### Task 4: Approval page

**Files:**
- Create: `cloud-panel-app/src/lib/groupByDay.ts`
- Create: `cloud-panel-app/tests/groupByDay.test.ts`
- Create: `cloud-panel-app/src/pages/Approval.tsx`
- Modify: `cloud-panel-app/src/App.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 1), `RequireAuth` (Task 2).
- Produces: `groupByDay<T>(items: T[], getDate: (item: T) => string | null) => Array<{ day: string; items: T[] }>` — pure grouping helper, sorted by day ascending, items with no date grouped under `"Sem data"` last. Task 5 (Calendar) reuses this same function. The `/projects/:projectId/aprovacao` route.

- [ ] **Step 1: write the failing test for the pure grouping helper**

```ts
// tests/groupByDay.test.ts
import { describe, it, expect } from "vitest";
import { groupByDay } from "../src/lib/groupByDay";

interface Item {
  id: string;
  date: string | null;
}

describe("groupByDay", () => {
  it("groups items by day, sorted ascending", () => {
    const items: Item[] = [
      { id: "b", date: "2026-09-02" },
      { id: "a", date: "2026-09-01" },
      { id: "c", date: "2026-09-01" },
    ];
    const result = groupByDay(items, (i) => i.date);
    expect(result.map((g) => g.day)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(result[0].items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("groups items with no date under 'Sem data', placed last", () => {
    const items: Item[] = [
      { id: "a", date: null },
      { id: "b", date: "2026-09-01" },
    ];
    const result = groupByDay(items, (i) => i.date);
    expect(result.map((g) => g.day)).toEqual(["2026-09-01", "Sem data"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupByDay<Item>([], (i) => i.date)).toEqual([]);
  });
});
```

- [ ] **Step 2: run test to verify it fails**

Run: `cd cloud-panel-app && npx vitest run tests/groupByDay.test.ts`
Expected: FAIL — `groupByDay` module doesn't exist.

- [ ] **Step 3: implement the helper**

```ts
// src/lib/groupByDay.ts
export interface DayGroup<T> {
  day: string;
  items: T[];
}

const NO_DATE_LABEL = "Sem data";

export function groupByDay<T>(items: T[], getDate: (item: T) => string | null): DayGroup<T>[] {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const day = getDate(item) || NO_DATE_LABEL;
    const existing = byDay.get(day);
    if (existing) existing.push(item);
    else byDay.set(day, [item]);
  }
  const days = [...byDay.keys()].filter((d) => d !== NO_DATE_LABEL).sort();
  if (byDay.has(NO_DATE_LABEL)) days.push(NO_DATE_LABEL);
  return days.map((day) => ({ day, items: byDay.get(day)! }));
}
```

- [ ] **Step 4: run test to verify it passes**

Run: `cd cloud-panel-app && npx vitest run tests/groupByDay.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Approval page**

```tsx
// src/pages/Approval.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { groupByDay } from "@/lib/groupByDay";

interface ContentItem {
  id: string;
  channel: string;
  status: string;
  copy: string | null;
  media_url: string | null;
  content_id: string | null;
  schedules: { run_at: string }[] | { run_at: string } | null;
}

function scheduledDate(item: ContentItem): string | null {
  const schedule = Array.isArray(item.schedules) ? item.schedules[0] : item.schedules;
  return schedule ? schedule.run_at.slice(0, 10) : null;
}

export function Approval() {
  const { projectId } = useParams<{ projectId: string }>();
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("content_items")
      .select("id, channel, status, copy, media_url, content_id, schedules(run_at)")
      .eq("project_id", projectId)
      .in("status", ["draft", "approved"]);
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setItems(data as ContentItem[]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function ensureSignedUrl(item: ContentItem) {
    if (!item.media_url || signedUrls[item.id]) return;
    const { data } = await supabase.storage.from("content-media").createSignedUrl(item.media_url, 300);
    if (data) setSignedUrls((prev) => ({ ...prev, [item.id]: data.signedUrl }));
  }

  async function approve(item: ContentItem) {
    setBusyId(item.id);
    await supabase.from("content_items").update({ status: "approved" }).eq("id", item.id);
    await load();
    setBusyId(null);
  }

  async function reject(item: ContentItem) {
    setBusyId(item.id);
    await supabase.from("content_items").update({ status: "cancelled" }).eq("id", item.id);
    await load();
    setBusyId(null);
  }

  async function saveCaption(item: ContentItem) {
    const text = drafts[item.id];
    if (text === undefined || text === (item.copy || "")) return;
    setBusyId(item.id);
    await supabase.from("content_items").update({ copy: text }).eq("id", item.id);
    await load();
    setBusyId(null);
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!items) return <div className="card">Carregando...</div>;

  const groups = groupByDay(items, scheduledDate);

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Aprovação</h1>
      {groups.length === 0 ? <p>Nada aguardando aprovação.</p> : null}
      {groups.map((group) => (
        <section key={group.day}>
          <h2>{group.day}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {group.items.map((item) => {
              const draft = drafts[item.id] ?? item.copy ?? "";
              const dirty = draft !== (item.copy || "");
              return (
                <div key={item.id} className="card">
                  <p>
                    <strong>{item.channel}</strong> — {item.status}
                  </p>
                  {item.media_url ? (
                    signedUrls[item.id] ? (
                      <img
                        src={signedUrls[item.id]}
                        alt={item.content_id || item.id}
                        style={{ maxWidth: "100%", borderRadius: 8 }}
                      />
                    ) : (
                      <button type="button" onClick={() => ensureSignedUrl(item)}>
                        Ver imagem
                      </button>
                    )
                  ) : null}
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
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: wire the route**

```tsx
// src/App.tsx
import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Approval } from "@/pages/Approval";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/aprovacao"
        element={
          <RequireAuth>
            <Approval />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
```

- [ ] **Step 7: run full test suite + build**

Run: `cd cloud-panel-app && npm test && npm run build`
Expected: tests pass, build succeeds.

- [ ] **Step 8: commit**

```bash
git add cloud-panel-app/src cloud-panel-app/tests
git commit -m "feat: add approval page (approve, reject, edit caption, view image)"
```

---

### Task 5: Calendar page

**Files:**
- Create: `cloud-panel-app/src/pages/Calendar.tsx`
- Modify: `cloud-panel-app/src/App.tsx`
- Modify: `cloud-panel-app/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 1), `RequireAuth` (Task 2), `groupByDay` (Task 4).
- Produces: the `/projects/:projectId/calendario` route. Dashboard project links go to a small project menu instead of straight to Approval, so both pages are reachable.

- [ ] **Step 1: Calendar page**

```tsx
// src/pages/Calendar.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { groupByDay } from "@/lib/groupByDay";

interface ScheduleRow {
  id: string;
  run_at: string;
  status: string;
  content_items: { id: string; channel: string; status: string; content_id: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Agendado",
  running: "Publicando...",
  done: "Publicado",
  error: "Erro",
};

export function CalendarPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data, error: queryError } = await supabase
      .from("schedules")
      .select("id, run_at, status, content_items!inner(id, channel, status, content_id)")
      .eq("content_items.project_id", projectId)
      .order("run_at");
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setRows(data as unknown as ScheduleRow[]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function reschedule(row: ScheduleRow, newDate: string) {
    if (!newDate) return;
    const currentTime = row.run_at.slice(11, 16);
    const newRunAt = new Date(`${newDate}T${currentTime}:00`).toISOString();
    setBusyId(row.id);
    await supabase.from("schedules").update({ run_at: newRunAt }).eq("id", row.id);
    await load();
    setBusyId(null);
  }

  if (error) return <div className="card">Erro: {error}</div>;
  if (!rows) return <div className="card">Carregando...</div>;

  const groups = groupByDay(rows, (row) => row.run_at.slice(0, 10));

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Calendário</h1>
      {groups.length === 0 ? <p>Nada agendado.</p> : null}
      {groups.map((group) => (
        <section key={group.day}>
          <h2>{group.day}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {group.items.map((row) => (
              <div key={row.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{row.content_items?.channel}</strong> — {STATUS_LABEL[row.status] || row.status}
                  <br />
                  <span style={{ color: "var(--text-dim)" }}>{row.run_at.slice(11, 16)}</span>
                </div>
                {row.status === "pending" ? (
                  <input
                    type="date"
                    defaultValue={row.run_at.slice(0, 10)}
                    disabled={busyId === row.id}
                    onChange={(e) => reschedule(row, e.target.value)}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: give the Dashboard a small per-project menu instead of a single Approval link**

```tsx
// src/pages/Dashboard.tsx — replace the per-project <Link> block with:
{projects.map((project) => (
  <div key={project.id} className="card">
    <strong>{project.name}</strong>
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <Link to={`/projects/${project.id}/aprovacao`}>Aprovação</Link>
      <Link to={`/projects/${project.id}/calendario`}>Calendário</Link>
    </div>
  </div>
))}
```

- [ ] **Step 3: wire the route**

```tsx
// src/App.tsx
import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Approval } from "@/pages/Approval";
import { CalendarPage } from "@/pages/Calendar";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/aprovacao"
        element={
          <RequireAuth>
            <Approval />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/calendario"
        element={
          <RequireAuth>
            <CalendarPage />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
```

- [ ] **Step 4: run full test suite + build**

Run: `cd cloud-panel-app && npm test && npm run build`
Expected: tests pass (3, unchanged from Task 4 — this task adds no new pure logic), build succeeds.

- [ ] **Step 5: commit**

```bash
git add cloud-panel-app/src
git commit -m "feat: add calendar page with reschedule"
```

---

## Out of scope / next

- Deploying `cloud-panel-app` to Vercel (manual, controller-run — needs the user's Vercel account, same pattern as the Supabase manual steps in earlier phases).
- Fase 3b (empresa/marca/referências/ofertas/pilares/aprendizado) and Fase 3c (comercial/CRM) — each needs its own schema-expansion spec + plan first.
- A "publish now" button — blocked on giving `publish-sweep` a user-JWT auth path (noted in the Fase 3a design spec).
