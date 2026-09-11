# Endpoint /api/projects/:id Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /api/projects/:id` endpoint that returns just one project's summary (no alerts, no scan of the other projects), and switch `ProjectWorkspaceLayout` to use it instead of the full `GET /api/state`.

**Architecture:** New backend function `getCentralProjectSummary(projectId, targetDir)` reads one `project.json` and reuses the existing `toProjectSummary()` transform (no duplicated logic). New route handler returns it as `{ project }` or 404. Frontend gets a matching `getProject(projectId)` client function; `ProjectWorkspaceLayout` swaps its `getState()` call for it. Dashboard and Aprendizado de Segmento are untouched — they legitimately need the full project list.

**Tech Stack:** Node.js (`src/content-central.js`, `src/content-central-server.js`), React + TypeScript (`content-central-app`), `node:test` (backend), Vitest + Testing Library (frontend).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-09-project-scoped-state-endpoint-design.md`
- New endpoint does NOT compute alerts or `globalRules` — only reads the one requested project's `project.json`.
- 404 response body: exactly `{ error: 'Project not found' }` (matches the existing convention already used elsewhere in `content-central-server.js`, e.g. the `/briefing` route).
- Visible behavior for the end user must not change at all: same loading skeleton, same "Projeto não encontrado" empty state, same error state. Only the network call underneath changes.
- `Dashboard.tsx` and `AprendizadoSegmento.tsx` keep using `GET /api/state` unchanged — out of scope.

---

### Task 1: Backend — project-scoped summary function + route

**Files:**
- Modify: `src/content-central.js:4629-4642` (add new function right after `listCentralProjects`)
- Modify: `src/content-central-server.js:88` (import), `src/content-central-server.js:729-738` (add route)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Produces: `getCentralProjectSummary(projectId, targetDir = process.cwd())` — exported async function in `content-central.js`, returns the same shape as one item of `listCentralProjects()`'s array, or `null` if the project doesn't exist on disk.
- Produces: `GET /api/projects/:id` (bare, no sub-path) — `200 { project: ProjectSummary }` or `404 { error: 'Project not found' }`.

- [ ] **Step 1: Write the failing backend tests**

Add to `tests/content-central-server.test.js`. First, add `getCentralProjectSummary` is NOT needed in the test file's own imports — the test only hits the HTTP route via `request()`, already imported helpers (`withServer`, `request`, `createCentralProject`) are enough. Append near the other `/api/projects/:id` tests:

```js
test('GET /api/projects/:id returns just that project, not the full state', async () => {
  await withServer(async (dir, server) => {
    await createCentralProject({ projectId: 'boss-pizzaria', name: 'Boss Pizzaria' }, dir);
    await createCentralProject({ projectId: 'outro-projeto', name: 'Outro Projeto' }, dir);

    const { response, body } = await request(server, '/api/projects/boss-pizzaria');

    assert.equal(response.status, 200);
    assert.equal(body.project.projectId, 'boss-pizzaria');
    assert.equal(body.project.name, 'Boss Pizzaria');
    // Proof of scope: the response has no trace of the other registered
    // project and no top-level `projects`/`alerts`/`globalRules` keys.
    assert.equal(body.projects, undefined);
    assert.equal(body.alerts, undefined);
    assert.equal(JSON.stringify(body).includes('outro-projeto'), false);
  });
});

test('GET /api/projects/:id returns 404 for an id that does not exist on disk', async () => {
  await withServer(async (_dir, server) => {
    const { response, body } = await request(server, '/api/projects/nao-existe');

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: 'Project not found' });
  });
});

test('GET /api/projects/:id works with only that one project registered — no dependency on other projects existing', async () => {
  await withServer(async (dir, server) => {
    await createCentralProject({ projectId: 'projeto-solo', name: 'Projeto Solo' }, dir);

    const { response, body } = await request(server, '/api/projects/projeto-solo');

    assert.equal(response.status, 200);
    assert.equal(body.project.projectId, 'projeto-solo');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/content-central-server.test.js --test-name-pattern="GET /api/projects/:id"`
Expected: FAIL — all three 404 (route doesn't exist yet, falls through to the generic `parts[0] !== 'api' ...` 404 or the bare-`parts.length===3` case isn't handled, so the request either 404s with the wrong body shape or hits a different unrelated route). The first test's `body.project` access will throw or be `undefined`.

- [ ] **Step 3: Implement `getCentralProjectSummary` in `content-central.js`**

Insert right after `listCentralProjects` (after line 4642's closing `}`, before the blank line and the `listSystemAlerts` comment block):

```js
// Single-project counterpart to listCentralProjects() — reads only the one
// requested project.json instead of scanning every project on disk, and
// never runs listSystemAlerts' full per-project content-history scan.
// Used by ProjectWorkspaceLayout, which only ever needs one project's data.
export async function getCentralProjectSummary(projectId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir);
  const project = await readJson(join(paths.projectsDir, projectId, 'project.json'), null);
  if (!project) return null;
  return toProjectSummary(project, paths);
}
```

- [ ] **Step 4: Add the import and the route handler in `content-central-server.js`**

In the import block, add `getCentralProjectSummary,` right next to `getCentralPaths,` (currently line 88):

```js
  getCentralPaths,
  getCentralProjectSummary,
  getGlobalRules,
```

In the route-dispatch block, right after `const projectId = parts[2];` (currently line 734) and before the existing `if (method === 'GET' && parts.length === 4 && parts[3] === 'content')` check (currently line 735), add:

```js
  if (method === 'GET' && parts.length === 3) {
    const project = await getCentralProjectSummary(projectId, targetDir);
    if (!project) return sendJson(res, 404, { error: 'Project not found' });
    return sendJson(res, 200, { project });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/content-central-server.test.js --test-name-pattern="GET /api/projects/:id"`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `node --test tests/content-central-server.test.js`
Expected: all tests pass. Note: `POST /api/projects/:id` (delete project) already matches `parts.length === 3` further down (`:798`, gated behind `if (method !== 'POST') return sendJson(res, 405, ...)` at `:796`) — since the new handler only returns for `method === 'GET'`, it falls through untouched for POST and doesn't collide. No existing test hits a bare `GET /api/projects/:id` today, so nothing else should need updating.

- [ ] **Step 7: Commit**

```bash
git add src/content-central.js src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat(content-central): add GET /api/projects/:id for a single project's summary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014j4fAkA6QMvf3q8qijHZz7"
```

---

### Task 2: Frontend — `getProject()` client function + `ProjectWorkspaceLayout` switch

**Files:**
- Modify: `content-central-app/src/api/client.ts` (add `getProject`, near `getState`)
- Modify: `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx:42-50`
- Test: `content-central-app/src/layouts/ProjectWorkspaceLayout.test.tsx`

**Depends-on:** Task 1 (consumes the real `/api/projects/:id` contract; also the two shared behaviors — same 200/404 shape — must match exactly).

**Interfaces:**
- Consumes: `GET /api/projects/:id` → `200 { project: ProjectSummary }` | `404 { error: 'Project not found' }` (Task 1).
- Produces: `getProject(projectId: string): Promise<{ project: ProjectSummary }>` in `client.ts`, thrown `ApiError` on any non-200 (including the 404 case — its `.message` is exactly `'Project not found'` for that case, since `api()` throws `new ApiError(body.error || "Erro")`).

- [ ] **Step 1: Write the failing frontend tests**

Rewrite `content-central-app/src/layouts/ProjectWorkspaceLayout.test.tsx` in full — every test's first stubbed response changes shape from `{ projects: [...], globalRules: {} }` to `{ project: {...} }` (unwrapped, no array), and the not-found test now stubs an actual 404:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchSequence(responses: Array<{ body: unknown; ok?: boolean }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve({
        ok: response.ok !== false,
        text: async () => JSON.stringify(response.body),
      });
    }),
  );
}

describe("ProjectWorkspaceLayout", () => {
  it("shows the section nav and redirects to the real project overview by default", async () => {
    const expiresAt = new Date(Date.now() + 61 * 86400000).toISOString();
    stubFetchSequence([
      {
        body: {
          project: {
            projectId: "boss-pizzaria",
            name: "Boss Pizzaria",
            token: { configured: true, expiresAt },
            brandXray: { status: "generated" },
          },
        },
      },
      { body: { content: [] } },
    ]);

    render(
      <MemoryRouter initialEntries={["/projects/boss-pizzaria"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: /Token do Instagram/ })).toHaveTextContent("Expira em 61 dias");
    expect(screen.getByRole("link", { name: /Raio-X da marca/ })).toHaveTextContent("Ainda não aprovado");
    expect(screen.getAllByText("Boss Pizzaria").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Calendário" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Todos os projetos" })).toBeInTheDocument();
  });

  it("hides Empresa/Raio-X and Pilares and relabels Ofertas as Produtos for a catalog project", async () => {
    stubFetchSequence([
      {
        body: {
          project: {
            projectId: "loja-celulares",
            name: "Loja de Celulares",
            projectType: "catalog",
            token: { configured: true, expiresAt: new Date(Date.now() + 61 * 86400000).toISOString() },
          },
        },
      },
      { body: { content: [] } },
    ]);

    render(
      <MemoryRouter initialEntries={["/projects/loja-celulares"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "Produtos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Empresa / Raio-X" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pilares" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ofertas e assuntos" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Calendário" })).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown project id", async () => {
    stubFetchSequence([{ body: { error: "Project not found" }, ok: false }]);

    render(
      <MemoryRouter initialEntries={["/projects/does-not-exist"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Projeto não encontrado")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/layouts/ProjectWorkspaceLayout.test.tsx` (from inside `content-central-app/`)
Expected: FAIL — `ProjectWorkspaceLayout` still calls `getState()` and looks for `state.projects.find(...)`, which doesn't exist on the new stubbed body shape, so `project` ends up `null` for every test (breaking the first two) and the third test's 404 stub gets treated as a thrown generic error instead of the not-found `EmptyState`.

- [ ] **Step 3: Add `getProject()` to `client.ts`**

Add right after `getState()`'s definition (`content-central-app/src/api/client.ts:439-441`):

```ts
export function getProject(projectId: string): Promise<{ project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}`);
}
```

- [ ] **Step 4: Switch `ProjectWorkspaceLayout.tsx` to use it**

Replace the import at the top (`content-central-app/src/layouts/ProjectWorkspaceLayout.tsx:3`):

```tsx
import { getProject, type ProjectSummary } from "@/api/client";
```

Replace `refreshProject` (currently lines 42-50):

```tsx
  const refreshProject = useCallback(async () => {
    try {
      const { project } = await getProject(projectId!);
      setProject(project);
      setError(null);
    } catch (err) {
      if ((err as Error).message === "Project not found") {
        setProject(null);
      } else {
        setError((err as Error).message);
      }
    }
  }, [projectId]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/layouts/ProjectWorkspaceLayout.test.tsx` (from inside `content-central-app/`)
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add content-central-app/src/api/client.ts content-central-app/src/layouts/ProjectWorkspaceLayout.tsx content-central-app/src/layouts/ProjectWorkspaceLayout.test.tsx
git commit -m "feat(project-workspace): fetch only the opened project instead of full state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014j4fAkA6QMvf3q8qijHZz7"
```

**Note for the controller:** after this task lands, running the FULL frontend suite (`npx vitest run`) will show failures in 12 other workspace test files (`Account`, `AdCreatives`, `Calendar`, `Carousels`, `Company`, `GenerateContent`, `Offers`, `Overview`, `PendingApproval`, `Pillars`, `References`, `TestPost`) — this is expected collateral breakage from this task's change, and Task 3 fixes it. Do not treat it as a Task 2 regression; do not run the full suite as this task's own verification gate, only the targeted file in Step 5/6.

---

### Task 3: Migrate the other 12 workspace test files' project-state fixtures

**Files:**
- Modify: `content-central-app/src/pages/workspace/Account.test.tsx:26-31`
- Modify: `content-central-app/src/pages/workspace/AdCreatives.test.tsx:26-31`
- Modify: `content-central-app/src/pages/workspace/Calendar.test.tsx:54-72`
- Modify: `content-central-app/src/pages/workspace/Carousels.test.tsx:26-31`
- Modify: `content-central-app/src/pages/workspace/Company.test.tsx:26-31`
- Modify: `content-central-app/src/pages/workspace/GenerateContent.test.tsx:26-56`
- Modify: `content-central-app/src/pages/workspace/Offers.test.tsx:26-31`
- Modify: `content-central-app/src/pages/workspace/Overview.test.tsx:40-52`
- Modify: `content-central-app/src/pages/workspace/PendingApproval.test.tsx:58-61`
- Modify: `content-central-app/src/pages/workspace/Pillars.test.tsx:26-31`
- Modify: `content-central-app/src/pages/workspace/References.test.tsx:26-39`
- Modify: `content-central-app/src/pages/workspace/TestPost.test.tsx:26-29`

**Depends-on:** Task 2 (these files' fixtures only need to change because `ProjectWorkspaceLayout` now expects the new response shape).

**Interfaces:**
- Consumes: the `{ project: ProjectSummary }` response shape from Task 2 — no new exports, purely a test-fixture reshape. Each file's helper is called by that file's own tests only; nothing outside each file depends on these helpers.

Every edit below is the same mechanical transform: `{ projects: [ {...} ], globalRules: {} }` → `{ project: {...} }` (drop the array wrapper and `globalRules`, since `ProjectWorkspaceLayout` no longer reads either). Each file's helper is called many times within that file by name, so editing the one function/const definition fixes every call site automatically — do not touch the call sites.

- [ ] **Step 1: Run the full frontend suite to see the current (expected) failures from Task 2**

Run: `npx vitest run` (from inside `content-central-app/`)
Expected: FAIL in exactly the 12 files listed above (and PASS everywhere else, including `ProjectWorkspaceLayout.test.tsx`, `Dashboard.test.tsx`, `AprendizadoSegmento.test.tsx`).

- [ ] **Step 2: Account.test.tsx**

```ts
// Before
function projectState(overrides: Record<string, unknown> = {}) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", instagram: { handle: "@boss" }, token: null, ...overrides }],
    globalRules: {},
  };
}

// After
function projectState(overrides: Record<string, unknown> = {}) {
  return {
    project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", instagram: { handle: "@boss" }, token: null, ...overrides },
  };
}
```

- [ ] **Step 3: AdCreatives.test.tsx**

```ts
// Before
function projectState(offers: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers } }],
    globalRules: {},
  };
}

// After
function projectState(offers: unknown[] = []) {
  return {
    project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers } },
  };
}
```

- [ ] **Step 4: Calendar.test.tsx (two constants)**

```ts
// Before
const PROJECT_STATE = {
  projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", token: { daysRemaining: 61 }, brandXray: { status: "pendente" } }],
  globalRules: {},
};

const PROJECT_STATE_WITH_TOPICS = {
  projects: [{
    projectId: "boss-pizzaria",
    name: "Boss Pizzaria",
    contentStrategy: {
      topicIdeas: {
        generatedAt: "2026-08-01T10:00:00.000Z",
        nextRefreshAt: "2026-08-16T10:00:00.000Z",
        goals: { education: { label: "Educação", items: [{ id: "e1", title: "Como escolher melhor antes de comprar" }] } },
      },
    },
  }],
  globalRules: {},
};

// After
const PROJECT_STATE = {
  project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", token: { daysRemaining: 61 }, brandXray: { status: "pendente" } },
};

const PROJECT_STATE_WITH_TOPICS = {
  project: {
    projectId: "boss-pizzaria",
    name: "Boss Pizzaria",
    contentStrategy: {
      topicIdeas: {
        generatedAt: "2026-08-01T10:00:00.000Z",
        nextRefreshAt: "2026-08-16T10:00:00.000Z",
        goals: { education: { label: "Educação", items: [{ id: "e1", title: "Como escolher melhor antes de comprar" }] } },
      },
    },
  },
};
```

- [ ] **Step 5: Carousels.test.tsx**

```ts
// Before
function projectState() {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [] } }],
    globalRules: {},
  };
}

// After
function projectState() {
  return {
    project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [] } },
  };
}
```

- [ ] **Step 6: Company.test.tsx**

```ts
// Before
function projectState(overrides: Record<string, unknown> = {}) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", brandInput: {}, brandXray: { status: "empty", blocks: {} }, ...overrides }],
    globalRules: {},
  };
}

// After
function projectState(overrides: Record<string, unknown> = {}) {
  return {
    project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", brandInput: {}, brandXray: { status: "empty", blocks: {} }, ...overrides },
  };
}
```

- [ ] **Step 7: GenerateContent.test.tsx (three helpers)**

```ts
// Before
function projectState(offers: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers } }],
    globalRules: {},
  };
}

function projectStateWithTopicIdeas(title = "Site bonito não vende sozinho") {
  return {
    projects: [{
      projectId: "boss-pizzaria",
      name: "Boss Pizzaria",
      contentStrategy: {
        offers: [{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }],
        topicIdeas: {
          generatedAt: "2026-08-01T10:00:00.000Z",
          nextRefreshAt: "2026-08-16T10:00:00.000Z",
          goals: { authority: { label: "Autoridade", items: [{ id: "a1", title }] } },
        },
      },
    }],
    globalRules: {},
  };
}

function catalogProjectState(offers: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", projectType: "catalog", contentStrategy: { offers } }],
    globalRules: {},
  };
}

// After
function projectState(offers: unknown[] = []) {
  return {
    project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers } },
  };
}

function projectStateWithTopicIdeas(title = "Site bonito não vende sozinho") {
  return {
    project: {
      projectId: "boss-pizzaria",
      name: "Boss Pizzaria",
      contentStrategy: {
        offers: [{ id: "rodizio", name: "Rodízio", type: "rodizio", active: true }],
        topicIdeas: {
          generatedAt: "2026-08-01T10:00:00.000Z",
          nextRefreshAt: "2026-08-16T10:00:00.000Z",
          goals: { authority: { label: "Autoridade", items: [{ id: "a1", title }] } },
        },
      },
    },
  };
}

function catalogProjectState(offers: unknown[] = []) {
  return {
    project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", projectType: "catalog", contentStrategy: { offers } },
  };
}
```

- [ ] **Step 8: Offers.test.tsx**

```ts
// Before
function projectState(offers: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers } }],
    globalRules: {},
  };
}

// After
function projectState(offers: unknown[] = []) {
  return {
    project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers } },
  };
}
```

- [ ] **Step 9: Overview.test.tsx**

```ts
// Before
const PROJECT_STATE = {
  projects: [
    {
      projectId: "boss-pizzaria",
      name: "Boss Pizzaria",
      token: { configured: true, expiresAt: new Date(Date.now() + 61 * 86400000).toISOString() },
      brandXray: { status: "approved" },
      brand: { references: [{ id: "r1" }] },
      contentStrategy: { offers: [{ id: "o1" }, { id: "o2" }] },
    },
  ],
  globalRules: {},
};

// After
const PROJECT_STATE = {
  project: {
    projectId: "boss-pizzaria",
    name: "Boss Pizzaria",
    token: { configured: true, expiresAt: new Date(Date.now() + 61 * 86400000).toISOString() },
    brandXray: { status: "approved" },
    brand: { references: [{ id: "r1" }] },
    contentStrategy: { offers: [{ id: "o1" }, { id: "o2" }] },
  },
};
```

- [ ] **Step 10: PendingApproval.test.tsx**

```ts
// Before
const PROJECT_STATE = {
  projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria" }],
  globalRules: {},
};

// After
const PROJECT_STATE = {
  project: { projectId: "boss-pizzaria", name: "Boss Pizzaria" },
};
```

- [ ] **Step 11: Pillars.test.tsx**

```ts
// Before
function projectState(pillars: unknown[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [], pillars } }],
    globalRules: {},
  };
}

// After
function projectState(pillars: unknown[] = []) {
  return {
    project: { projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [], pillars } },
  };
}
```

- [ ] **Step 12: References.test.tsx**

```ts
// Before
function projectState(overrides: Record<string, unknown> = {}) {
  return {
    projects: [
      {
        projectId: "boss-pizzaria",
        name: "Boss Pizzaria",
        brand: { references: [], visualStyle: "", imageRules: [], visualSystem: {} },
        brandIdentity: {},
        ...overrides,
      },
    ],
    globalRules: {},
  };
}

// After
function projectState(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      projectId: "boss-pizzaria",
      name: "Boss Pizzaria",
      brand: { references: [], visualStyle: "", imageRules: [], visualSystem: {} },
      brandIdentity: {},
      ...overrides,
    },
  };
}
```

- [ ] **Step 13: TestPost.test.tsx**

```ts
// Before
const PROJECT_STATE = {
  projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria" }],
  globalRules: {},
};

// After
const PROJECT_STATE = {
  project: { projectId: "boss-pizzaria", name: "Boss Pizzaria" },
};
```

- [ ] **Step 14: Run the full frontend suite to verify everything passes**

Run: `npx vitest run` (from inside `content-central-app/`)
Expected: PASS across every file (aside from any already-known pre-existing 5000ms-timeout flakes unrelated to this work — if a test fails with `Test timed out in 5000ms`, re-run just that file once to confirm it's the known flake, not a real regression from this change).

- [ ] **Step 15: Commit**

```bash
git add content-central-app/src/pages/workspace/Account.test.tsx content-central-app/src/pages/workspace/AdCreatives.test.tsx content-central-app/src/pages/workspace/Calendar.test.tsx content-central-app/src/pages/workspace/Carousels.test.tsx content-central-app/src/pages/workspace/Company.test.tsx content-central-app/src/pages/workspace/GenerateContent.test.tsx content-central-app/src/pages/workspace/Offers.test.tsx content-central-app/src/pages/workspace/Overview.test.tsx content-central-app/src/pages/workspace/PendingApproval.test.tsx content-central-app/src/pages/workspace/Pillars.test.tsx content-central-app/src/pages/workspace/References.test.tsx content-central-app/src/pages/workspace/TestPost.test.tsx
git commit -m "test(workspace): migrate project-state fixtures to the single-project endpoint shape

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014j4fAkA6QMvf3q8qijHZz7"
```

---

### Task 4: Final verification

**Files:** None (verification only).

**Depends-on:** Task 3.

- [ ] **Step 1: Run the full backend suite**

Run: `node --test tests/*.test.js` (from the repo root)
Expected: PASS, aside from the one already-known pre-existing unrelated failure ("topic idea agent creates 10 subjects per selected organic goal and feeds generation").

- [ ] **Step 2: Run the full frontend suite**

Run: `npx vitest run` (from inside `content-central-app/`)
Expected: PASS across every file, aside from known environment timeout flakes (different file each run, `Test timed out in 5000ms`).

- [ ] **Step 3: Run the frontend build**

Run: `npm run build` (from inside `content-central-app/`)
Expected: clean, no type errors.
