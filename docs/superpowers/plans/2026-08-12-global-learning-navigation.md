# Aprendizado Fora do Projeto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move "Aprendizado de segmento" and "Aprendizado por tipo de oferta" out of any specific project's navigation into two standalone pages reachable from the Dashboard, since both store data shared across every project/segment, not data that belongs to one client.

**Architecture:** Backend routes for these two features move from `/api/projects/:id/segment-learnings/*` and `/api/projects/:id/offer-type-learnings` to root-level `/api/segment-learnings/*` and `/api/offer-type-learnings`, dropping the now-meaningless `projectId` parameter from the underlying functions. Uploaded learning-reference images move from per-project storage to a new global `_opensquad/content-central/assets/learning/` directory with its own serving route, mirroring the existing `segment-templates` pattern. `LearningGallery` (built generic in an earlier plan) needs zero behavior change beyond dropping its now-unused `projectId` prop. Two new top-level React pages replace the old per-project `SegmentLearning.tsx` and the "Aprendizado por tipo" panel inside `Offers.tsx`.

**Tech Stack:** Node (`node:test`/`node:assert` backend, raw `http.createServer` router), React + TypeScript + Vitest + Testing Library frontend, `react-router-dom`.

## Global Constraints

- Backend has no framework: non-project routes are matched by exact `route === '/api/...'` or `route.startsWith('/api/...')` checks BEFORE the project-scoped dispatcher's `parts[0] !== 'api' || parts[1] !== 'projects'` gate (`src/content-central-server.js:458`) — see the existing `/api/segment-templates/*` block (`:371-385`) for the pattern to copy.
- Frontend API calls are thin `api<T>(path, options)` wrappers in `content-central-app/src/api/client.ts` — no other HTTP client.
- Frontend tests render the real `<App/>` inside `<MemoryRouter initialEntries={[...]}>` and stub `global.fetch` with a canned response sequence (`stubFetchSequence`) — never mock the page component in isolation.
- Backend tests use `withTempProject(async (dir) => {...})` from `tests/content-central.test.js`, call server functions directly (not HTTP) unless the test's whole point is to prove an HTTP route works (as in the existing `tests/content-central-server.test.js`, which uses a `withServer` helper — check that file for the exact pattern before writing an HTTP-level test).
- Run backend tests with `npm test` (repo root). Run frontend tests with `cd content-central-app && npm test`.
- `LearningGallery.tsx` must keep its generic `scope`/`groupKey`/`entries`/`onEntriesChange` contract — only its `projectId` prop is removed in this plan, nothing else about its interface changes.
- The 3-level Setor→Nicho→Especialidade inheritance logic, the tagged node-path scheme (`group:`/`category:`/`specialty:`), and the global lock (`GLOBAL_LEARNING_LOCK_ID`) are all unchanged by this plan — only how the data is reached (route path, function signature) changes, never the storage format or inheritance behavior.

---

## File Structure

**Backend**
- Modify: `src/content-central.js` — `segmentNodePaths`/`segmentNodeLabel` split into pure field-based helpers + thin project wrappers; new `loadSegmentLearningNodesForSelection`; `analyzeLearningImage`/`saveLearningEntry`/`deleteLearningEntry` drop `projectId`, image storage moves to `paths.root`.
- Modify: `src/content-central-server.js` — 5 new root-level API routes + 1 new asset-serving route (`sendLearningAsset`), old nested routes for these removed.
- Modify: `tests/content-central.test.js`, `tests/content-central-server.test.js` — signatures/routes updated.

**Frontend**
- Modify: `content-central-app/src/api/client.ts` — `SEGMENT_TREE` moved here (exported) from `Company.tsx`; `analyzeLearningImage`/`saveLearningEntry`/`deleteLearningEntry`/`getOfferTypeLearnings`/`saveOfferTypeBaseInstruction` drop `projectId` param, hit new root URLs.
- Modify: `content-central-app/src/pages/workspace/Company.tsx` — imports `SEGMENT_TREE` from `client.ts` instead of a local const.
- Modify: `content-central-app/src/components/LearningGallery.tsx` — drops `projectId` prop, builds thumbnail URL from the new global asset route.
- Create: `content-central-app/src/pages/AprendizadoSegmento.tsx`, `content-central-app/src/pages/AprendizadoSegmento.test.tsx`.
- Create: `content-central-app/src/pages/AprendizadoTipoOferta.tsx`, `content-central-app/src/pages/AprendizadoTipoOferta.test.tsx`.
- Delete: `content-central-app/src/pages/workspace/SegmentLearning.tsx`, `content-central-app/src/pages/workspace/SegmentLearning.test.tsx`.
- Modify: `content-central-app/src/pages/workspace/Offers.tsx`, `Offers.test.tsx` — "Aprendizado por tipo" panel and its tests removed.
- Modify: `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx` — `aprendizado-segmento` `SECTIONS` entry removed.
- Modify: `content-central-app/src/App.tsx` — nested `aprendizado-segmento` route removed, 2 new top-level routes added.
- Modify: `content-central-app/src/pages/Dashboard.tsx` — 2 new links added.

---

### Task 1: Pure field-based segment-path helpers + selection-based node loader

**Files:**
- Modify: `src/content-central.js:3479-3524` (`segmentNodePaths`, `segmentNodeLabel`)
- Modify: `src/content-central.js:3676-3684` (`loadSegmentLearningNodes`) — add a sibling function right after it
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `segmentNodePathsFromFields(rawGroup, rawCategory, rawSpecialty)` → `string[]` (same tagged-path logic `segmentNodePaths` has today, just taking 3 raw strings instead of a `project`).
- Produces: `segmentNodeLabelFromFields(rawGroup, rawCategory, rawSpecialty, level)` → `string`.
- Produces: `segmentNodePaths(project)` / `segmentNodeLabel(project, level)` — same signatures as today, now thin wrappers that extract the 3 raw fields from `project` and call the two functions above. No behavior change for any existing caller.
- Produces: `export async function loadSegmentLearningNodesForSelection(paths, { segmentGroup, segmentCategory, segmentSpecialty })` → same return shape as `loadSegmentLearningNodes` (`Array<{ path, label, level, entries }>`), built the same way but from explicit fields instead of a project.

- [ ] **Step 1: Write the failing test**

Add to `tests/content-central.test.js`:

```js
test('loadSegmentLearningNodesForSelection returns the same nodes as loadSegmentLearningNodes for an equivalent project', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sel-test', name: 'Sel Test', handle: '@sel', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sel-test', {
      brandName: 'Sel Test',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segmentSpecialty: 'napolitana',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);
    const badBatch = await generateContentBatch('sel-test', { days: 1, startDate: '2026-07-20' }, dir);
    await deleteProjectContent('sel-test', badBatch.items[0].contentId, dir, badBatch.batchId, 'esfiha vindo retangular, tem que ser redonda');

    const paths = getCentralPaths(dir, 'sel-test');
    const project = await loadProjectForTest('sel-test', dir);
    const fromProject = await loadSegmentLearningNodes(paths, project);
    const fromSelection = await loadSegmentLearningNodesForSelection(paths, {
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segmentSpecialty: 'napolitana',
    });

    assert.deepEqual(fromSelection.map((n) => n.path), fromProject.map((n) => n.path));
    assert.deepEqual(fromSelection.map((n) => n.label), fromProject.map((n) => n.label));
    const napolitanaNode = fromSelection.find((n) => n.level === 'especialidade');
    assert.ok(napolitanaNode.entries.some((e) => e.text.includes('esfiha vindo retangular')));
  });
});
```

Add `loadSegmentLearningNodesForSelection` to the test file's import list from `../src/content-central.js`.

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test`. Expected: FAIL — `loadSegmentLearningNodesForSelection` is not exported yet.

- [ ] **Step 3: Extract the pure helpers and add the new loader**

Replace `segmentNodePaths` and `segmentNodeLabel` (`src/content-central.js:3479-3524`, keep every comment — they document real bugs this logic already fixed) with:

```js
function segmentNodePathsFromFields(rawGroupInput, rawCategoryInput, rawSpecialtyInput) {
  const rawGroup = cleanText(rawGroupInput || '');
  const rawCategory = cleanText(rawCategoryInput || '');
  const rawSpecialty = cleanText(rawSpecialtyInput || '');
  const parts = [
    rawGroup ? `group:${slugify(rawGroup)}` : '',
    rawCategory ? `category:${slugify(rawCategory)}` : '',
    rawSpecialty ? `specialty:${slugify(rawSpecialty)}` : '',
  ].filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function segmentNodeLabelFromFields(rawGroupInput, rawCategoryInput, rawSpecialtyInput, level) {
  const group = cleanText(rawGroupInput || '');
  const category = cleanText(rawCategoryInput || '');
  const specialty = cleanText(rawSpecialtyInput || '');
  if (level === 'setor') return group;
  if (level === 'nicho') return [group, category].filter(Boolean).join(' / ');
  return [group, category, specialty].filter(Boolean).join(' / ');
}

function segmentFieldsFromProject(project) {
  const profile = normalizeCompanyProfile(project.companyProfile);
  const brandInput = normalizeBrandInput(project.brandInput || companyProfileToBrandInput(profile, project.name));
  return {
    segmentGroup: profile.segmentGroup || brandInput.segmentGroup || '',
    segmentCategory: profile.segmentCategory || brandInput.segmentCategory || '',
    segmentSpecialty: profile.segmentSpecialty || brandInput.segmentSpecialty || '',
  };
}

function segmentNodePaths(project) {
  const fields = segmentFieldsFromProject(project);
  return segmentNodePathsFromFields(fields.segmentGroup, fields.segmentCategory, fields.segmentSpecialty);
}

function segmentNodeLabel(project, level) {
  const fields = segmentFieldsFromProject(project);
  return segmentNodeLabelFromFields(fields.segmentGroup, fields.segmentCategory, fields.segmentSpecialty, level);
}
```

Add right after `loadSegmentLearningNodes` (`src/content-central.js:3684`):

```js
export async function loadSegmentLearningNodesForSelection(paths, { segmentGroup, segmentCategory, segmentSpecialty } = {}) {
  const store = await readSegmentLearningStore(paths);
  return segmentNodePathsFromFields(segmentGroup, segmentCategory, segmentSpecialty).map((path, index) => ({
    path,
    label: segmentNodeLabelFromFields(segmentGroup, segmentCategory, segmentSpecialty, SEGMENT_LEVELS[index]),
    level: SEGMENT_LEVELS[index],
    entries: (store.nodes[path]?.entries || []).map(normalizeSegmentLearningEntry),
  }));
}
```

If `loadProjectForTest` isn't already exported (check the bottom of the file near other test-only exports), export it the same way Task B2 of the previous plan did.

- [ ] **Step 4: Run the test again**

Run: `npm test`. Expected: PASS, and the full 424-test suite stays green (this is a pure refactor of `segmentNodePaths`/`segmentNodeLabel` — every existing caller keeps working unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "refactor(content-central): extract segment-path logic into field-based helpers, add selection-based node loader"
```

---

### Task 2: Drop `projectId` from the learning-entry functions, move image storage to a global directory

**Files:**
- Modify: `src/content-central.js:3712-3782` (`analyzeLearningImage`, `saveLearningEntry`, `deleteLearningEntry`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `export async function analyzeLearningImage(input, targetDir = process.cwd(), now = new Date(), options = {})` — same `input`/return shape as before (`{ imagePath, suggestedText }`), minus the `projectId` first argument. `imagePath` is now relative to the new global learning-assets root, not a project directory: `${scope === 'segment' ? 'segment' : 'offer-type'}/${groupSlug}/${filename}`.
- Produces: `export async function saveLearningEntry(input, targetDir = process.cwd(), now = new Date())` — same shape minus `projectId`. No longer sets `sourceProjectId` on the entry (there's no project to record).
- Produces: `export async function deleteLearningEntry(input, targetDir = process.cwd())` — same shape minus `projectId`.
- Consumes: `paths.root` (`src/content-central.js:292`, already unconditionally present from `getCentralPaths(targetDir)` with no project id — confirmed by Task 8 of the previous plan, which already uses this exact call shape for `loadOfferTypeLearning`).

- [ ] **Step 1: Write the failing test**

Replace the existing `saveLearningEntry`/`analyzeLearningImage`/`deleteLearningEntry` test in `tests/content-central.test.js` (search for `'analyzeLearningImage saves the file and returns a suggested description'`) with:

```js
test('analyzeLearningImage/saveLearningEntry/deleteLearningEntry work without a project, storing images under the global assets/learning directory', async () => {
  await withTempProject(async (dir) => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const fakeAnalyzer = async () => 'Esfiha redonda, borda dourada natural, sem formato retangular.';

    const analyzed = await analyzeLearningImage({
      scope: 'segment',
      groupKey: 'group:alimenticio/category:pizzaria',
      dataUrl,
      filename: 'esfiha-redonda.png',
    }, dir, new Date(), { learningImageAnalyzer: fakeAnalyzer });

    assert.match(analyzed.imagePath, /^segment\/group-alimenticio-category-pizzaria\/esfiha-redonda\.png$/);
    assert.equal(analyzed.suggestedText, 'Esfiha redonda, borda dourada natural, sem formato retangular.');

    const paths = getCentralPaths(dir);
    const fileOnDisk = join(paths.root, 'assets', 'learning', analyzed.imagePath);
    await access(fileOnDisk);

    const saved = await saveLearningEntry({
      scope: 'segment',
      groupKey: 'group:alimenticio/category:pizzaria',
      bucket: 'approved',
      kind: 'image',
      text: analyzed.suggestedText,
      imagePath: analyzed.imagePath,
    }, dir, new Date());

    assert.equal(saved.length, 1);
    assert.equal(saved[0].imagePath, analyzed.imagePath);
    assert.equal(saved[0].sourceProjectId, undefined);

    await deleteLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', entryId: saved[0].id }, dir);
    const nodes = await loadSegmentLearningNodesForSelection(paths, { segmentGroup: 'Alimentício', segmentCategory: 'Pizzaria' });
    assert.equal(nodes.find((n) => n.path === 'group:alimenticio/category:pizzaria').entries.length, 0);
  });
});
```

Import `access` from `node:fs/promises` at the top of the test file if it isn't already imported.

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test`. Expected: FAIL — the three functions still require a `projectId` first argument, so calling them with `input` as the first argument passes the wrong type.

- [ ] **Step 3: Update the three functions**

Replace `analyzeLearningImage` (`src/content-central.js:3712-3731`):

```js
export async function analyzeLearningImage(input, targetDir = process.cwd(), now = new Date(), options = {}) {
  const paths = getCentralPaths(targetDir);
  const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
  const groupSlug = slugify(input?.groupKey || '');
  const filename = sanitizeFilename(input?.filename || 'referencia.bin');
  const buffer = decodeDataUrl(input?.dataUrl);
  const relativePath = `${scope === 'segment' ? 'segment' : 'offer-type'}/${groupSlug}/${filename}`;
  const destination = join(paths.root, 'assets', 'learning', relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, buffer);

  const analyzer = typeof options.learningImageAnalyzer === 'function' ? options.learningImageAnalyzer : defaultLearningImageAnalyzer;
  const context = scope === 'segment'
    ? `segmento "${input.groupKey}"`
    : `tipo de oferta "${input.groupKey}"`;
  const suggestedText = await analyzer(destination, context);

  return { imagePath: relativePath, suggestedText: cleanText(suggestedText || '') };
}
```

Replace `saveLearningEntry` (`src/content-central.js:3744-3766`):

```js
export async function saveLearningEntry(input, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir);
  return withProjectLock(targetDir, GLOBAL_LEARNING_LOCK_ID, async () => {
    const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
    const store = scope === 'segment' ? await readSegmentLearningStore(paths) : await readLearningStore(paths, scope);
    const nodesKey = learningStoreNodesKey(scope);
    const groupKey = scope === 'segment' ? String(input.groupKey || '') : slugify(input.groupKey || '');
    const node = store[nodesKey][groupKey] || { label: input.groupKey, entries: [] };
    const entry = normalizeSegmentLearningEntry({
      bucket: input.bucket,
      kind: input.kind,
      text: input.text,
      imagePath: input.imagePath,
      source: 'manual',
    });
    node.entries = [entry, ...node.entries].slice(0, MAX_SEGMENT_LEARNING_ENTRIES);
    store[nodesKey] = { ...store[nodesKey], [groupKey]: node };
    store.schemaVersion = scope === 'segment' ? 2 : 1;
    await writeLearningStore(paths, scope, store);
    return node.entries;
  });
}
```

Replace `deleteLearningEntry` (`src/content-central.js:3768-3782`):

```js
export async function deleteLearningEntry(input, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir);
  return withProjectLock(targetDir, GLOBAL_LEARNING_LOCK_ID, async () => {
    const scope = input?.scope === 'offerType' ? 'offerType' : 'segment';
    const store = scope === 'segment' ? await readSegmentLearningStore(paths) : await readLearningStore(paths, scope);
    const nodesKey = learningStoreNodesKey(scope);
    const groupKey = scope === 'segment' ? String(input.groupKey || '') : slugify(input.groupKey || '');
    const node = store[nodesKey][groupKey];
    if (!node) return [];
    node.entries = node.entries.filter((entry) => entry.id !== input.entryId);
    store[nodesKey] = { ...store[nodesKey], [groupKey]: node };
    await writeLearningStore(paths, scope, store);
    return node.entries;
  });
}
```

Note `normalizeSegmentLearningEntry` already tolerates a missing `sourceProjectId` (it was always optional on read) — no change needed there.

- [ ] **Step 4: Run the test again**

Run: `npm test`. Expected: PASS, full suite green. This changes 3 public function signatures — search the whole file (`grep -n "analyzeLearningImage(\|saveLearningEntry(\|deleteLearningEntry("`) for every remaining caller (should only be in `content-central-server.js`, addressed in Task 3) and confirm no other caller in `content-central.js` itself still passes a `projectId` first argument.

- [ ] **Step 5: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "refactor(content-central): drop projectId from learning-entry functions, store images globally"
```

---

### Task 3: Root-level routes + global asset-serving route, remove old nested routes

**Files:**
- Modify: `src/content-central-server.js`
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Produces: `POST /api/segment-learnings/analyze-image`, `POST /api/segment-learnings/entries`, `POST /api/segment-learnings/entries-delete`, `GET /api/offer-type-learnings`, `POST /api/offer-type-learnings`, `GET /api/learning-assets/*` — all root-level, none nested under `/api/projects/:id/...`.
- Consumes: `analyzeLearningImage(input, targetDir, now, options)`, `saveLearningEntry(input, targetDir, now)`, `deleteLearningEntry(input, targetDir)` (Task 2's new signatures), `loadOfferTypeLearning`/`saveOfferTypeBaseInstruction` (already projectId-free, unchanged), `OFFER_TYPES` (already exported).
- Removes: the old nested routes at `/api/projects/:id/segment-learnings/*` and `/api/projects/:id/offer-type-learnings` (search for `'segment-learnings'` and `'offer-type-learnings'` in the route dispatcher — there are 5 blocks to delete, all inside the project-scoped dispatcher section after `src/content-central-server.js:458`).

- [ ] **Step 1: Write the failing test**

Add to `tests/content-central-server.test.js` (check its top-of-file imports and the `withServer`/`request` helper pattern used by neighboring tests before writing this — follow that exact style):

```js
test('root-level segment-learnings and offer-type-learnings routes work with no project in the URL', async () => {
  await withServer(async ({ request }) => {
    const analyzeResponse = await request('POST', '/api/segment-learnings/analyze-image', {
      scope: 'segment',
      groupKey: 'group:alimenticio/category:pizzaria',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      filename: 'teste.png',
    });
    assert.equal(analyzeResponse.status, 501); // enableAiImages is off by default in tests, matches every sibling AI route's behavior

    const offerTypesResponse = await request('GET', '/api/offer-type-learnings');
    assert.equal(offerTypesResponse.status, 200);
    assert.ok(Array.isArray(offerTypesResponse.body.types));
    assert.equal(offerTypesResponse.body.types.length, 10);

    const saveResponse = await request('POST', '/api/offer-type-learnings', { type: 'combo', baseInstruction: 'Combo: sempre mostrar caixa aberta.' });
    assert.equal(saveResponse.status, 200);
    assert.equal(saveResponse.body.baseInstruction, 'Combo: sempre mostrar caixa aberta.');
  });
});
```

Adjust the exact `request`/`withServer` call shape to match whatever the file's existing tests actually use (read 2-3 neighboring tests first) — the assertions above are what matters, not the literal helper syntax.

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test`. Expected: FAIL — 404s, none of these root routes exist yet.

- [ ] **Step 3: Add the asset-serving function and the 6 routes**

Add near `sendSegmentTemplateImage` (`src/content-central-server.js:1041-1056`), following its exact structure:

```js
async function sendLearningAsset(res, targetDir, relativePath) {
  const safeRelative = normalize(relativePath).replace(/^([/\\])+/, '');
  const learningRoot = resolve(targetDir, '_opensquad', 'content-central', 'assets', 'learning');
  const filePath = resolve(join(learningRoot, safeRelative));
  if (!filePath.startsWith(learningRoot)) return sendJson(res, 400, { error: 'Referência inválida' });
  let body;
  try {
    body = await readFile(filePath);
  } catch {
    return sendJson(res, 404, { error: 'Referência não encontrada' });
  }
  res.writeHead(200, { 'content-type': assetContentType(filePath), 'cache-control': 'no-store' });
  res.end(body);
}
```

Add the 6 routes right after the existing `/api/segment-templates/*` block (`src/content-central-server.js:385`, before the `POST /api/projects` block at `:387`):

```js
  if (method === 'GET' && route.startsWith('/api/learning-assets/')) {
    return sendLearningAsset(res, targetDir, decodeURIComponent(route.slice('/api/learning-assets/'.length)));
  }

  if (method === 'POST' && route === '/api/segment-learnings/analyze-image') {
    if (typeof context.learningImageAnalyzer !== 'function') {
      return sendJson(res, 501, { error: 'Análise de imagem por IA não está disponível neste servidor.' });
    }
    const body = await readBody(req);
    const result = await analyzeLearningImage({ ...body, scope: 'segment' }, targetDir, new Date(), { learningImageAnalyzer: context.learningImageAnalyzer });
    return sendJson(res, 200, result);
  }

  if (method === 'POST' && route === '/api/segment-learnings/entries') {
    const body = await readBody(req);
    const entries = await saveLearningEntry({ ...body, scope: body.scope === 'offerType' ? 'offerType' : 'segment' }, targetDir);
    return sendJson(res, 200, { entries });
  }

  if (method === 'POST' && route === '/api/segment-learnings/entries-delete') {
    const body = await readBody(req);
    const entries = await deleteLearningEntry({ ...body, scope: body.scope === 'offerType' ? 'offerType' : 'segment' }, targetDir);
    return sendJson(res, 200, { entries });
  }

  if (method === 'GET' && route === '/api/offer-type-learnings') {
    const types = await Promise.all([...OFFER_TYPES].map((type) => loadOfferTypeLearning(targetDir, type)));
    return sendJson(res, 200, { types });
  }

  if (method === 'POST' && route === '/api/offer-type-learnings') {
    const body = await readBody(req);
    await saveOfferTypeBaseInstruction(targetDir, body.type, body.baseInstruction);
    return sendJson(res, 200, { type: body.type, baseInstruction: body.baseInstruction });
  }
```

Note the `analyze-image`/`entries`/`entries-delete` bodies preserve `body.scope` when it's `'offerType'` (same fix Task 9 of the previous plan applied to the old nested routes) instead of hardcoding `'segment'` — these one set of routes now serves both scopes directly, since there's no project-scoped variant left to keep separate.

- [ ] **Step 4: Delete the old nested routes**

In `src/content-central-server.js`, find and delete the 5 blocks matching `parts[3] === 'segment-learnings'` (3 blocks: `analyze-image`, `entries`, `entries-delete`) and `parts[3] === 'offer-type-learnings'` (2 blocks: GET and POST) inside the project-scoped dispatcher (after line 458). Also remove `loadSegmentLearningNodes` from that section's imports if it was only used there — check first, it's still used elsewhere (Task 1 kept it for the per-project code path... actually Task 6 of this plan deletes the last per-project caller of it too, so leave the import alone here and let Task 6 clean it up if it becomes unused then).

- [ ] **Step 5: Run the test again**

Run: `npm test`. Expected: PASS, full suite green (424 backend + this new test).

- [ ] **Step 6: Commit**

```bash
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat(content-central): root-level routes for segment/offer-type learning, drop project-nested versions"
```

---

### Task 4: Client — export `SEGMENT_TREE`, update learning-entry wrapper signatures

**Files:**
- Modify: `content-central-app/src/api/client.ts`
- Modify: `content-central-app/src/pages/workspace/Company.tsx`

**Interfaces:**
- Produces: `export const SEGMENT_TREE = [...]` in `client.ts` (moved verbatim from `Company.tsx`).
- Produces: `analyzeLearningImage(input)`, `saveLearningEntry(input)`, `deleteLearningEntry(input)` — same `input` shape as before, minus the `projectId` first parameter; hit the new root URLs.
- Produces: `getOfferTypeLearnings()`, `saveOfferTypeBaseInstruction(type, baseInstruction)` — already didn't really need `projectId` (Task 9 of the previous plan only used it for the URL); URL becomes root-level too.

- [ ] **Step 1: Move `SEGMENT_TREE`**

In `content-central-app/src/pages/workspace/Company.tsx`, cut the `SEGMENT_TREE` constant (`:22` through its closing `];`) and remove it from this file.

In `content-central-app/src/api/client.ts`, add it near `OFFER_TYPE_LABELS` (`:1027` area):

```ts
export const SEGMENT_TREE = [
  // paste the exact array cut from Company.tsx here, unchanged
];
```

In `Company.tsx`, add `SEGMENT_TREE` to the existing `@/api/client` import block.

- [ ] **Step 2: Update the learning-entry wrappers**

In `content-central-app/src/api/client.ts`, replace the 3 functions (search for `export function analyzeLearningImage`):

```ts
export function analyzeLearningImage(
  input: { scope: "segment" | "offerType"; groupKey: string; dataUrl: string; filename: string },
): Promise<{ imagePath: string; suggestedText: string }> {
  return api(`/api/segment-learnings/analyze-image`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveLearningEntry(
  input: { scope: "segment" | "offerType"; groupKey: string; bucket: "technical" | "approved" | "avoid"; kind: "text" | "image"; text: string; imagePath?: string },
): Promise<{ entries: SegmentLearningEntry[] }> {
  return api(`/api/segment-learnings/entries`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteLearningEntry(
  input: { scope: "segment" | "offerType"; groupKey: string; entryId: string },
): Promise<{ entries: SegmentLearningEntry[] }> {
  return api(`/api/segment-learnings/entries-delete`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

Replace `getOfferTypeLearnings`/`saveOfferTypeBaseInstruction`:

```ts
export function getOfferTypeLearnings(): Promise<{ types: OfferTypeLearning[] }> {
  return api(`/api/offer-type-learnings`);
}

export function saveOfferTypeBaseInstruction(
  type: string,
  baseInstruction: string,
): Promise<{ type: string; baseInstruction: string }> {
  return api(`/api/offer-type-learnings`, {
    method: "POST",
    body: JSON.stringify({ type, baseInstruction }),
  });
}
```

Also remove `segmentLearningNodes?: SegmentLearningNode[]` from `ProjectSummary` if nothing reads it anymore after Task 6 — check at the end of Task 6 instead, since it's still used until that task lands; leave it for now.

- [ ] **Step 3: Verify with a TypeScript build**

Run: `cd content-central-app && npm run build`. Expected: FAIL at this point — `Offers.tsx`, `LearningGallery.tsx`, and `SegmentLearning.tsx` still call these functions with the old (projectId-first) signature. That's expected; Tasks 5-7 fix every call site. Do not try to fix those files in this task — just confirm the *type errors* are exactly the call sites this task's change should ripple into (a quick skim of the error list), not something unrelated.

- [ ] **Step 4: Commit**

```bash
git add content-central-app/src/api/client.ts content-central-app/src/pages/workspace/Company.tsx
git commit -m "refactor(content-central-app): move SEGMENT_TREE to client.ts, drop projectId from learning-entry wrappers"
```

(This commit intentionally leaves the frontend build red — the next 3 tasks fix every remaining call site. Do not skip committing; the plan's tasks are meant to be reviewed independently, and the build is checked green again at the end of Task 7.)

---

### Task 5: `LearningGallery` drops `projectId`, uses the global asset route

**Files:**
- Modify: `content-central-app/src/components/LearningGallery.tsx`

**Interfaces:**
- Produces: `LearningGallery({ scope, groupKey, entries, onEntriesChange })` — same as before minus `projectId`. Thumbnail `<img>` src becomes `` `/api/learning-assets/${entry.imagePath}` ``.
- Consumes: `analyzeLearningImage(input)`, `saveLearningEntry(input)`, `deleteLearningEntry(input)` (Task 4's new signatures, no `projectId` argument).

- [ ] **Step 1: Update the component**

In `content-central-app/src/components/LearningGallery.tsx`:
- Remove `projectId` from the props type and the destructured function parameters.
- Every call site inside the component that currently does `analyzeLearningImage(projectId, {...})` / `saveLearningEntry(projectId, {...})` / `deleteLearningEntry(projectId, {...})` drops the `projectId` argument — just `analyzeLearningImage({...})` etc.
- The thumbnail image tag (search for `src={` near the `entry.kind === "image"` check) changes from `` `/api/projects/${encodeURIComponent(projectId)}/assets/${entry.imagePath}` `` to `` `/api/learning-assets/${entry.imagePath}` ``.

- [ ] **Step 2: Run a build check**

Run: `cd content-central-app && npm run build`. Expected: `LearningGallery.tsx` itself now compiles clean against Task 4's new client signatures. Its two consumers (`SegmentLearning.tsx`, `Offers.tsx`) will still fail to compile because they still pass a `projectId` prop `LearningGallery` no longer accepts — that's expected, fixed in Tasks 6-7.

- [ ] **Step 3: Commit**

```bash
git add content-central-app/src/components/LearningGallery.tsx
git commit -m "refactor(content-central-app): LearningGallery drops projectId, uses the global learning-assets route"
```

---

### Task 6: New top-level "Aprendizado de segmento" page, remove the old per-project one

**Files:**
- Create: `content-central-app/src/pages/AprendizadoSegmento.tsx`
- Create: `content-central-app/src/pages/AprendizadoSegmento.test.tsx`
- Delete: `content-central-app/src/pages/workspace/SegmentLearning.tsx`, `content-central-app/src/pages/workspace/SegmentLearning.test.tsx`
- Modify: `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`
- Modify: `content-central-app/src/App.tsx`
- Modify: `content-central-app/src/pages/Dashboard.tsx`
- Modify: `content-central-app/src/api/client.ts` — add a client wrapper for the new selection-based node endpoint (see below); remove `segmentLearningNodes` from `ProjectSummary` and the corresponding backend field (see Step 5).

**Interfaces:**
- Produces: `getSegmentLearningNodes(segmentGroup: string, segmentCategory: string, segmentSpecialty: string): Promise<{ nodes: SegmentLearningNode[] }>` in `client.ts`.
- Consumes: `SEGMENT_TREE` (Task 4), `LearningGallery` (Task 5, no `projectId` prop).

- [ ] **Step 1: Add a route + client wrapper for selection-based node loading**

In `src/content-central-server.js`, add one more root-level route next to the ones from Task 3:

```js
  if (method === 'GET' && route.startsWith('/api/segment-learnings/nodes')) {
    const url = new URL(route, 'http://localhost');
    const nodes = await loadSegmentLearningNodesForSelection(getCentralPaths(targetDir), {
      segmentGroup: url.searchParams.get('segmentGroup') || '',
      segmentCategory: url.searchParams.get('segmentCategory') || '',
      segmentSpecialty: url.searchParams.get('segmentSpecialty') || '',
    });
    return sendJson(res, 200, { nodes });
  }
```

Import `loadSegmentLearningNodesForSelection` into `content-central-server.js`'s existing import block from `./content-central.js`.

In `content-central-app/src/api/client.ts`, add near the other segment-learning exports:

```ts
export function getSegmentLearningNodes(
  segmentGroup: string,
  segmentCategory: string,
  segmentSpecialty: string,
): Promise<{ nodes: SegmentLearningNode[] }> {
  const params = new URLSearchParams({ segmentGroup, segmentCategory, segmentSpecialty });
  return api(`/api/segment-learnings/nodes?${params.toString()}`);
}
```

- [ ] **Step 2: Write the failing test for the new page**

Create `content-central-app/src/pages/AprendizadoSegmento.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      return Promise.resolve({ ok: response.ok !== false, text: async () => JSON.stringify(response.body) });
    }),
  );
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/aprendizado-segmento"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("AprendizadoSegmento", () => {
  it("lets the operator pick Setor/Nicho/Especialidade and shows that combination's panels", async () => {
    stubFetchSequence([
      {
        body: {
          nodes: [
            { path: "group:alimenticio", label: "Alimentício", level: "setor", entries: [] },
            { path: "group:alimenticio/category:pizzaria", label: "Alimentício / Pizzaria", level: "nicho", entries: [{ id: "e1", bucket: "approved", kind: "text", text: "Esfiha tem que ser redonda", source: "manual", createdAt: "2026-08-01" }] },
          ],
        },
      },
    ]);
    renderPage();

    await userEvent.selectOptions(await screen.findByLabelText("Setor"), "Alimentício");
    await userEvent.selectOptions(screen.getByLabelText("Nicho"), "Pizzaria");
    await userEvent.click(screen.getByRole("button", { name: "Ver aprendizado" }));

    expect(await screen.findByText("Esfiha tem que ser redonda")).toBeInTheDocument();
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call[0]).toContain("segmentGroup=Alimenticio");
  });
});
```

`"Alimentício"` (with categories including `"Pizzaria"`) is confirmed already the first of the 6 groups in the current `SEGMENT_TREE` (`content-central-app/src/pages/workspace/Company.tsx:22`, moved verbatim to `client.ts` in Task 4) — the test above matches it as written, no adjustment needed unless Task 4 changed the array's order, which it should not.

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd content-central-app && npm test -- AprendizadoSegmento`. Expected: FAIL — page doesn't exist, route not registered.

- [ ] **Step 4: Build the page**

Create `content-central-app/src/pages/AprendizadoSegmento.tsx`:

```tsx
import { useState } from "react";
import { SEGMENT_TREE, getSegmentLearningNodes, type SegmentLearningNode } from "@/api/client";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { LearningGallery } from "@/components/LearningGallery";

export function AprendizadoSegmento() {
  const [group, setGroup] = useState("");
  const [category, setCategory] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [nodes, setNodes] = useState<SegmentLearningNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = SEGMENT_TREE.find((item) => item.group === group)?.categories || [];

  async function handleLoad() {
    setLoading(true);
    setError(null);
    try {
      const result = await getSegmentLearningNodes(group, category, specialty);
      setNodes(result.nodes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 var(--space-2xs)" }}>Aprendizado de segmento</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Vale pra todo cliente do mesmo segmento, não só um projeto. Setor vale pra todo o ramo; Nicho e Especialidade valem só pra esse recorte.
      </p>
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div className="row">
          <div>
            <label htmlFor="segmento-setor">Setor</label>
            <select id="segmento-setor" value={group} onChange={(e) => { setGroup(e.target.value); setCategory(""); }}>
              <option value="">Selecione</option>
              {SEGMENT_TREE.map((item) => (
                <option key={item.group} value={item.group}>{item.group}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="segmento-nicho">Nicho</label>
            <select id="segmento-nicho" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!group}>
              <option value="">Selecione</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="segmento-especialidade">Especialidade (opcional)</label>
            <input id="segmento-especialidade" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ex: napolitana" />
          </div>
        </div>
        <Button style={{ marginTop: 12 }} disabled={!group || loading} onClick={handleLoad}>
          {loading ? "Carregando..." : "Ver aprendizado"}
        </Button>
        {error ? <div className="pill bad" style={{ marginTop: 10 }}>{error}</div> : null}
      </Card>

      {nodes === null ? null : nodes.length === 0 ? (
        <EmptyState title="Nenhum nível disponível" description="Escolha pelo menos o Setor." />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {nodes.map((node) => (
            <Card key={node.path} style={{ padding: 16 }}>
              <b>{node.label}</b>
              <LearningGallery
                scope="segment"
                groupKey={node.path}
                entries={node.entries}
                onEntriesChange={(entries) => setNodes((current) => (current || []).map((n) => (n.path === node.path ? { ...n, entries } : n)))}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire the route, remove the old one, add the Dashboard link**

In `content-central-app/src/App.tsx`: remove the `<Route path="aprendizado-segmento" element={<SegmentLearning />} />` line and its `SegmentLearning` import; add `import { AprendizadoSegmento } from "@/pages/AprendizadoSegmento";` and `<Route path="/aprendizado-segmento" element={<AprendizadoSegmento />} />` as a sibling of the `/` and `/projects/:projectId` routes (inside `<Route element={<RootLayout />}>`, not nested under `/projects/:projectId`).

In `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`: remove the `{ to: "aprendizado-segmento", label: "Aprendizado de segmento", hideForCatalog: true, group: "Configuração" }` line from `SECTIONS`.

In `content-central-app/src/pages/Dashboard.tsx`: add a `<Link to="/aprendizado-segmento">Aprendizado de segmento</Link>` near the existing "+ Novo projeto" button (use the same `Link`/`Button` pattern already used elsewhere in that file for navigation).

Delete `content-central-app/src/pages/workspace/SegmentLearning.tsx` and `content-central-app/src/pages/workspace/SegmentLearning.test.tsx`.

In `content-central-app/src/api/client.ts`: remove `segmentLearningNodes?: SegmentLearningNode[];` from the `ProjectSummary` interface (no longer populated or consumed by anything now that the per-project page is gone).

In `src/content-central.js`'s `toProjectSummary` (search for `segmentLearningNodes: await loadSegmentLearningNodes(paths, project),`): remove that line. Also remove the now-unused `loadSegmentLearningNodes` import from `content-central-server.js` if nothing else there calls it (check with `grep -n loadSegmentLearningNodes src/content-central-server.js` — if only the import remains, delete the import too; `loadSegmentLearningNodes` itself in `content-central.js` stays, since Task 1's test still calls it directly).

- [ ] **Step 6: Run the test again, then the full frontend suite and build**

Run: `cd content-central-app && npm test -- AprendizadoSegmento`. Expected: PASS.
Run: `cd content-central-app && npm test` and `npm run build`. Expected: still red — `Offers.tsx` (Task 7) hasn't been fixed yet. Confirm the only remaining build errors are inside `Offers.tsx`/`Offers.test.tsx`.
Run: `npm test` (repo root). Expected: PASS (backend fully done as of Task 3; `toProjectSummary`'s changed return shape doesn't break any backend test — if it does, that test asserted on the now-removed `segmentLearningNodes` field and needs updating to drop that assertion).

- [ ] **Step 7: Commit**

```bash
git add content-central-app/src/pages/AprendizadoSegmento.tsx content-central-app/src/pages/AprendizadoSegmento.test.tsx content-central-app/src/App.tsx content-central-app/src/layouts/ProjectWorkspaceLayout.tsx content-central-app/src/pages/Dashboard.tsx content-central-app/src/api/client.ts src/content-central.js src/content-central-server.js
git add -u content-central-app/src/pages/workspace/SegmentLearning.tsx content-central-app/src/pages/workspace/SegmentLearning.test.tsx
git commit -m "feat(content-central-app): top-level Aprendizado de segmento page, remove the per-project one"
```

---

### Task 7: New top-level "Aprendizado por tipo de oferta" page, remove the panel from Offers.tsx

**Files:**
- Create: `content-central-app/src/pages/AprendizadoTipoOferta.tsx`
- Create: `content-central-app/src/pages/AprendizadoTipoOferta.test.tsx`
- Modify: `content-central-app/src/pages/workspace/Offers.tsx`, `content-central-app/src/pages/workspace/Offers.test.tsx`
- Modify: `content-central-app/src/App.tsx`
- Modify: `content-central-app/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `getOfferTypeLearnings()`, `saveOfferTypeBaseInstruction(type, baseInstruction)` (Task 4, no `projectId`), `LearningGallery` (Task 5, no `projectId` prop), `OFFER_TYPE_LABELS` (already exists in `client.ts`).

- [ ] **Step 1: Write the failing test**

Create `content-central-app/src/pages/AprendizadoTipoOferta.test.tsx`, adapted from the test currently in `Offers.test.tsx` (search for `"shows and edits the per-offer-type base instruction and learning gallery"` — copy its body, drop the "open panel" click since this is now the whole page, not a collapsible section, and update the request-index assertions since there's no longer an offers-list fetch ahead of it):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      return Promise.resolve({ ok: response.ok !== false, text: async () => JSON.stringify(response.body) });
    }),
  );
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/aprendizado-tipo-oferta"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("AprendizadoTipoOferta", () => {
  it("shows and edits the per-offer-type base instruction and learning gallery", async () => {
    stubFetchSequence([
      {
        body: {
          types: [
            { type: "combo", baseInstruction: "Combo: foco no produto, CTA de delivery claro.", hasOverride: false, entries: [] },
            { type: "offer", baseInstruction: "Criar post de Oferta direta.", hasOverride: false, entries: [] },
          ],
        },
      },
      { body: { type: "combo", baseInstruction: "Combo: sempre mostrar a caixa fechada e aberta lado a lado." } },
    ]);
    renderPage();

    expect(await screen.findByDisplayValue("Combo: foco no produto, CTA de delivery claro.")).toBeInTheDocument();

    const instructionField = screen.getByDisplayValue("Combo: foco no produto, CTA de delivery claro.");
    await userEvent.clear(instructionField);
    await userEvent.type(instructionField, "Combo: sempre mostrar a caixa fechada e aberta lado a lado.");
    await userEvent.click(screen.getAllByRole("button", { name: "Salvar" })[0]);

    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(call[0]).toBe("/api/offer-type-learnings");
    expect(JSON.parse(call[1].body as string).type).toBe("combo");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd content-central-app && npm test -- AprendizadoTipoOferta`. Expected: FAIL — page doesn't exist yet.

- [ ] **Step 3: Build the page from the panel currently in `Offers.tsx`**

In `content-central-app/src/pages/workspace/Offers.tsx`, find the whole "Aprendizado por tipo" block: the `typeLearningOpen`/`typeLearnings`/`typeLearningLoaded`/`editingInstruction`/`savingType`/`typeLearningError` state, `openTypeLearning`/`handleSaveTypeInstruction` handlers, the toggle button, and the `{typeLearningOpen ? (...) : null}` panel JSX. Cut all of it out of `Offers.tsx` (this page goes back to being just the offers list/form, no learning panel).

Create `content-central-app/src/pages/AprendizadoTipoOferta.tsx` using that cut code as the starting point, adapted to be a full page instead of a collapsible section (always loads on mount instead of on a toggle-button click; drop the `typeLearningOpen` toggle entirely) and calling the Task 4 signatures with no `projectId`:

```tsx
import { useEffect, useState } from "react";
import { OFFER_TYPE_LABELS, getOfferTypeLearnings, saveOfferTypeBaseInstruction, type OfferTypeLearning } from "@/api/client";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { LearningGallery } from "@/components/LearningGallery";

export function AprendizadoTipoOferta() {
  const [typeLearnings, setTypeLearnings] = useState<OfferTypeLearning[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingInstruction, setEditingInstruction] = useState<Record<string, string>>({});
  const [savingType, setSavingType] = useState<string | null>(null);
  const [typeLearningError, setTypeLearningError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await getOfferTypeLearnings();
        if (cancelled) return;
        setTypeLearnings(result.types);
        setEditingInstruction(Object.fromEntries(result.types.map((t) => [t.type, t.baseInstruction])));
      } catch (err) {
        if (!cancelled) setTypeLearningError((err as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function handleSaveTypeInstruction(type: string) {
    setSavingType(type);
    setTypeLearningError(null);
    try {
      await saveOfferTypeBaseInstruction(type, editingInstruction[type]);
      setTypeLearnings((current) => current.map((t) => (t.type === type ? { ...t, baseInstruction: editingInstruction[type], hasOverride: true } : t)));
    } catch (err) {
      setTypeLearningError((err as Error).message);
    } finally {
      setSavingType(null);
    }
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 var(--space-2xs)" }}>Aprendizado por tipo de oferta</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Vale pra todo projeto, não só um cliente. Instrução base é o que a IA sempre lê pra esse tipo; a galeria abaixo acumula exemplos de estrutura/composição que você aprovar.
      </p>
      {typeLearningError ? <div className="pill bad" style={{ marginBottom: 12 }}>{typeLearningError}</div> : null}
      {!loaded ? null : (
        <div style={{ display: "grid", gap: 16 }}>
          {typeLearnings.map((learning) => (
            <Card key={learning.type} style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <b>{OFFER_TYPE_LABELS[learning.type] || learning.type}</b>
                <span className="pill" style={{ opacity: learning.hasOverride ? 1 : 0.7 }}>
                  {learning.hasOverride ? "personalizado" : "usando padrão"}
                </span>
              </div>
              {!learning.hasOverride ? (
                <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                  O texto abaixo é só um ponto de partida — na geração real, esse tipo ainda usa a frase padrão do sistema com o nome da oferta embutido naturalmente.
                </p>
              ) : null}
              <textarea
                value={editingInstruction[learning.type] || ""}
                onChange={(e) => setEditingInstruction((current) => ({ ...current, [learning.type]: e.target.value }))}
              />
              <Button disabled={savingType === learning.type} onClick={() => handleSaveTypeInstruction(learning.type)}>
                {savingType === learning.type ? "Salvando..." : "Salvar"}
              </Button>
              <LearningGallery
                scope="offerType"
                groupKey={learning.type}
                entries={learning.entries}
                onEntriesChange={(entries) => setTypeLearnings((current) => current.map((t) => (t.type === learning.type ? { ...t, entries } : t)))}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

Check the exact "usando padrão" disclaimer text against what's currently in `Offers.tsx` before cutting it (Task 10 of the previous plan added this — copy its real wording rather than the paraphrase above if it differs).

- [ ] **Step 4: Remove the panel and its tests from Offers.tsx**

In `content-central-app/src/pages/workspace/Offers.tsx`: remove the "Aprendizado por tipo" toggle button from the toolbar, and confirm no remaining reference to `typeLearningOpen`/`typeLearnings`/etc (all cut in Step 3). Remove the now-unused imports (`getOfferTypeLearnings`, `saveOfferTypeBaseInstruction`, `type OfferTypeLearning`, `LearningGallery`) from `Offers.tsx` if nothing else in that file uses them.

In `content-central-app/src/pages/workspace/Offers.test.tsx`: delete the `"shows and edits the per-offer-type base instruction and learning gallery"` test (moved to `AprendizadoTipoOferta.test.tsx`).

- [ ] **Step 5: Wire the route and Dashboard link**

In `content-central-app/src/App.tsx`: add `import { AprendizadoTipoOferta } from "@/pages/AprendizadoTipoOferta";` and `<Route path="/aprendizado-tipo-oferta" element={<AprendizadoTipoOferta />} />` as another sibling route.

In `content-central-app/src/pages/Dashboard.tsx`: add a second `<Link to="/aprendizado-tipo-oferta">Aprendizado por tipo de oferta</Link>` next to the one from Task 6.

- [ ] **Step 6: Run everything**

Run: `cd content-central-app && npm test -- AprendizadoTipoOferta`. Expected: PASS.
Run: `cd content-central-app && npm test`. Expected: full suite PASS (this is the last frontend task — the build should be clean now).
Run: `cd content-central-app && npm run build`. Expected: PASS, clean TypeScript build.
Run: `npm test` (repo root). Expected: PASS, full 424+ backend suite.

- [ ] **Step 7: Commit**

```bash
git add content-central-app/src/pages/AprendizadoTipoOferta.tsx content-central-app/src/pages/AprendizadoTipoOferta.test.tsx content-central-app/src/pages/workspace/Offers.tsx content-central-app/src/pages/workspace/Offers.test.tsx content-central-app/src/App.tsx content-central-app/src/pages/Dashboard.tsx
git commit -m "feat(content-central-app): top-level Aprendizado por tipo de oferta page, remove the panel from Ofertas"
```

## Post-implementation check (all tasks)

- [ ] Run `npm test` (repo root) and `cd content-central-app && npm test` one final time, all green.
- [ ] Run `cd content-central-app && npm run build` — clean.
- [ ] Manually verify (dev server): "Seus projetos" shows 2 new links; each opens a page with no project selected; segment page lets you pick Setor/Nicho and shows learning panels; offer-type page shows all 10 types; uploading an image on either still works end-to-end (upload → AI suggests text → confirm → thumbnail renders via `/api/learning-assets/...`).
