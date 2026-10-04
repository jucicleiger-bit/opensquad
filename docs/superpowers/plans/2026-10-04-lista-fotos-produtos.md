# Adiantar fotos a partir de uma lista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a catalog project, the operator pastes a list of products (name + optional price); each line becomes a draft with 4 photos found on the internet, and the operator reviews each draft in the normal product form, which opens pre-filled with name, price and the chosen photo.

**Architecture:** Drafts live in `project.contentStrategy.offerDrafts`, a list separate from `offers`, so nothing that reads offers (generation, rotation, flyer, cerebro) sees them. The server parses the list, searches Bing Images per line, and stores the drafts. Photos are downloaded only when a product is saved: the existing asset upload route learns to accept a `sourceUrl` (with a `fallbackSourceUrl`) instead of a `dataUrl`.

**Tech Stack:** Node ESM server (`node:test`), React + Vite + Vitest client (`content-central-app`).

Spec: `docs/superpowers/specs/2026-10-04-lista-fotos-produtos-design.md`

## Global Constraints

- Work only in the worktree `.claude/worktrees/fotos-lista` (branch `worktree-fotos-lista`). Never touch master or the production server on port 3333.
- In this worktree, run git through the **PowerShell** tool, not Bash (the Bash rewrite hook refuses it). `docs/` is gitignored: use `git add -f` for docs.
- Running one server test: `node --test --test-name-pattern="<name>" tests/<file>.test.js` — the pattern flag must come **before** the file, or the whole 2.5-minute suite runs.
- Client type errors: `npm run build` in `content-central-app` (`tsc --noEmit` checks nothing here).
- Max 40 lines per list; max 4 photo candidates per product; download max 10 MB, 20 s timeout, http/https only, must answer `image/*`.
- Drafts never go into `contentStrategy.offers`.
- User-facing text is Brazilian Portuguese.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Drafts in the project (core)

**Files:**
- Modify: `src/content-central.js` (add `randomUUID` import at the top; add the three functions right after `deleteProjectOffer`, around line 1412)
- Test: `tests/content-central.test.js` (add imports to the existing import block from `../src/content-central.js`; add tests at the end)

**Interfaces:**
- Produces:
  - `parseOfferDraftLines(text: string): Array<{ name: string, price: string }>` — throws `Error` with message starting `No máximo 40 produtos por vez` when more than 40 non-empty lines.
  - `saveProjectOfferDrafts(projectId, drafts: Array<{ name, price, candidates: Array<{ imageUrl, thumbUrl }> }>, targetDir, now?) → Promise<{ project, drafts: OfferDraft[] }>`
  - `deleteProjectOfferDraft(projectId, draftId, targetDir) → Promise<{ deleted: boolean, project }>` — idempotent, never throws for an unknown id.
  - `OfferDraft = { id: string, name: string, price: string, candidates: Array<{ imageUrl: string, thumbUrl: string }>, createdAt: string }`

- [ ] **Step 1: Write the failing tests**

Add `parseOfferDraftLines, saveProjectOfferDrafts, deleteProjectOfferDraft` to the import list at the top of `tests/content-central.test.js`, then append:

```js
test('parseOfferDraftLines splits name and trailing price, one product per line', () => {
  assert.deepEqual(parseOfferDraftLines([
    'Coca-Cola 2L - 9,99',
    '',
    'Arroz Tio João 5kg R$ 27.90',
    'Leite Ninho 400g 19,90',
    'TV 50 polegadas - R$ 2.499,00',
    'Sabão em pó Omo 1,6kg',
    '  Detergente Ypê  ',
  ].join('\n')), [
    { name: 'Coca-Cola 2L', price: 'R$ 9,99' },
    { name: 'Arroz Tio João 5kg', price: 'R$ 27,90' },
    { name: 'Leite Ninho 400g', price: 'R$ 19,90' },
    { name: 'TV 50 polegadas', price: 'R$ 2.499,00' },
    { name: 'Sabão em pó Omo 1,6kg', price: '' },
    { name: 'Detergente Ypê', price: '' },
  ]);
});

test('parseOfferDraftLines refuses more than 40 products at once', () => {
  const text = Array.from({ length: 41 }, (_, i) => `Produto ${i + 1}`).join('\n');
  assert.throws(() => parseOfferDraftLines(text), /No máximo 40 produtos por vez/);
  assert.equal(parseOfferDraftLines(text.split('\n').slice(0, 40).join('\n')).length, 40);
});

test('offer drafts are stored apart from offers and can be removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-offer-drafts-'));
  try {
    await createCentralProject({ projectId: 'mercado-teste', name: 'Mercado Teste' }, dir);
    const { drafts } = await saveProjectOfferDrafts('mercado-teste', [
      { name: 'Coca-Cola 2L', price: 'R$ 9,99', candidates: [
        { imageUrl: 'https://img.test/1.jpg', thumbUrl: 'https://img.test/1t.jpg' },
        { imageUrl: 'https://img.test/2.jpg', thumbUrl: 'https://img.test/2t.jpg' },
        { imageUrl: 'https://img.test/3.jpg', thumbUrl: 'https://img.test/3t.jpg' },
        { imageUrl: 'https://img.test/4.jpg', thumbUrl: 'https://img.test/4t.jpg' },
        { imageUrl: 'https://img.test/5.jpg', thumbUrl: 'https://img.test/5t.jpg' },
      ] },
      { name: 'Arroz 5kg', price: '', candidates: [] },
    ], dir, new Date('2026-10-04T12:00:00.000Z'));

    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].candidates.length, 4);
    assert.ok(drafts[0].id && drafts[0].id !== drafts[1].id);
    assert.equal(drafts[0].createdAt, '2026-10-04T12:00:00.000Z');

    const stored = await loadProjectForTest('mercado-teste', dir);
    assert.equal(stored.contentStrategy.offers.length, 0);
    assert.deepEqual(stored.contentStrategy.offerDrafts.map((draft) => draft.name), ['Coca-Cola 2L', 'Arroz 5kg']);

    const removed = await deleteProjectOfferDraft('mercado-teste', drafts[0].id, dir);
    assert.equal(removed.deleted, true);
    assert.deepEqual(removed.project.contentStrategy.offerDrafts.map((draft) => draft.name), ['Arroz 5kg']);

    const again = await deleteProjectOfferDraft('mercado-teste', drafts[0].id, dir);
    assert.equal(again.deleted, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Check that `loadProjectForTest` is already imported in that file (it is used at line ~217); if not, add it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="offer draft|parseOfferDraftLines" tests/content-central.test.js`
Expected: FAIL — `parseOfferDraftLines` is not exported (SyntaxError on import).

- [ ] **Step 3: Implement**

At the top of `src/content-central.js` add:

```js
import { randomUUID } from 'node:crypto';
```

After `deleteProjectOffer` add:

```js
// "Adiantar fotos (lista)": the operator pastes one product per line and each
// line becomes a draft with photo candidates found online. Drafts live apart
// from `offers`, so generation, rotation and the flyer never see them until
// the operator reviews one in the normal form and saves it as a product.
const MAX_OFFER_DRAFT_LINES = 40;
const MAX_OFFER_DRAFT_CANDIDATES = 4;
const OFFER_DRAFT_PRICE_PATTERN = /(?:\s+-\s+|\s+)(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{2})\s*$/i;

export function parseOfferDraftLines(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_OFFER_DRAFT_LINES) {
    throw new Error(`No máximo ${MAX_OFFER_DRAFT_LINES} produtos por vez — essa lista tem ${lines.length}.`);
  }
  return lines.map((line) => {
    const match = OFFER_DRAFT_PRICE_PATTERN.exec(line);
    const name = match ? line.slice(0, match.index).trim() : '';
    if (!match || !name) return { name: line, price: '' };
    const raw = match[1];
    return { name, price: `R$ ${raw.includes(',') ? raw : raw.replace('.', ',')}` };
  });
}

export async function saveProjectOfferDrafts(projectId, drafts, targetDir = process.cwd(), now = new Date()) {
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const created = (drafts || []).map((draft) => ({
      id: randomUUID(),
      name: String(draft?.name || '').trim(),
      price: String(draft?.price || '').trim(),
      candidates: (draft?.candidates || []).slice(0, MAX_OFFER_DRAFT_CANDIDATES).map((candidate) => ({
        imageUrl: String(candidate.imageUrl),
        thumbUrl: String(candidate.thumbUrl || candidate.imageUrl),
      })),
      createdAt: now.toISOString(),
    }));
    project.contentStrategy = {
      ...(project.contentStrategy || {}),
      offerDrafts: [...(project.contentStrategy?.offerDrafts || []), ...created],
    };
    project.updatedAt = now.toISOString();
    await writeJson(paths.projectPath, project);
    return { project, drafts: created };
  });
}

// Idempotent: the client removes the draft right after saving its product,
// and a double click must not turn a successful save into an error.
export async function deleteProjectOfferDraft(projectId, draftId, targetDir = process.cwd()) {
  const id = String(draftId || '').trim();
  const paths = getCentralPaths(targetDir, projectId);
  return withProjectLock(targetDir, projectId, async () => {
    const project = await loadProject(paths);
    const drafts = project.contentStrategy?.offerDrafts || [];
    const nextDrafts = drafts.filter((draft) => draft.id !== id);
    if (nextDrafts.length === drafts.length) return { deleted: false, project };
    project.contentStrategy = { ...(project.contentStrategy || {}), offerDrafts: nextDrafts };
    project.updatedAt = new Date().toISOString();
    await writeJson(paths.projectPath, project);
    return { deleted: true, project };
  });
}
```

Note: the price pattern's first alternative requires at least one thousands group (`2.499,00`); plain `27.90` / `9,99` go through the second alternative. `1,6kg` does not match because the line does not end in the number.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern="offer draft|parseOfferDraftLines" tests/content-central.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit (PowerShell)**

```powershell
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): offer drafts stored apart from offers`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server — image search, draft routes, photo download by URL

**Files:**
- Modify: `src/content-central-server.js`
  - import block from `./content-central.js` (around line 122): add `parseOfferDraftLines, saveProjectOfferDrafts, deleteProjectOfferDraft`
  - `startContentCentralServer` options (around line 408): add `productImageSearcher = null`
  - context object (around line 431): add `productImageSearcher: productImageSearcher || searchProductImages,`
  - assets route (line ~1056): resolve `sourceUrl` before `normalizeUploadedImageAsset`
  - after the `offer-groups-delete` route (line ~1165): add the two draft routes
  - after `searchDuckDuckGo` (line ~4235): add `extractBingImageResults`, `searchProductImages`, `downloadImageAsDataUrl`, `resolveAssetSourceUrl`
- Test: `tests/content-central-server.test.js` (add `extractBingImageResults` to the `../src/content-central-server.js` import; tests at the end)

**Interfaces:**
- Consumes: `parseOfferDraftLines`, `saveProjectOfferDrafts`, `deleteProjectOfferDraft` from Task 1.
- Produces:
  - `POST /api/projects/:projectId/offer-drafts` body `{ text }` → `201 { project, drafts: OfferDraft[] }`; error → `400 { error }`
  - `POST /api/projects/:projectId/offer-drafts-delete` body `{ draftId }` → `200 { deleted, project }`
  - `POST /api/projects/:projectId/assets` also accepts `{ sourceUrl, fallbackSourceUrl? }` instead of `dataUrl`; the server sets the filename extension from the downloaded content type.
  - `export function extractBingImageResults(html: string, limit = 4): Array<{ imageUrl, thumbUrl }>`
  - server option `productImageSearcher: (query: string) => Promise<Array<{ imageUrl, thumbUrl }>>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/content-central-server.test.js` (it already has `withServer`, `request`, `withMockedFetch` and imports `createCentralProject`; add `extractBingImageResults` to the server import):

```js
test('extractBingImageResults reads full and thumb URLs from Bing Images markup', () => {
  const entry = (murl, turl) => `<a class="iusc" style="x" m="{&quot;murl&quot;:&quot;${murl}&quot;,&quot;turl&quot;:&quot;${turl}&quot;}" href="#">`;
  const html = [
    entry('https://cdn.test/coca.jpg?v=1&amp;w=2', 'https://ts1.mm.bing.net/th?id=A&amp;pid=15.1'),
    '<a class="iusc" m="{broken json">',
    entry('ftp://nope.test/x.jpg', 'https://ts1.mm.bing.net/th?id=B'),
    entry('https://cdn.test/2.jpg', 'https://ts1.mm.bing.net/th?id=C'),
    entry('https://cdn.test/3.jpg', 'https://ts1.mm.bing.net/th?id=D'),
    entry('https://cdn.test/4.jpg', 'https://ts1.mm.bing.net/th?id=E'),
    entry('https://cdn.test/5.jpg', 'https://ts1.mm.bing.net/th?id=F'),
  ].join('\n');
  const results = extractBingImageResults(html);
  assert.equal(results.length, 4);
  assert.deepEqual(results[0], { imageUrl: 'https://cdn.test/coca.jpg?v=1&w=2', thumbUrl: 'https://ts1.mm.bing.net/th?id=A&pid=15.1' });
  assert.equal(results[3].imageUrl, 'https://cdn.test/5.jpg');
  assert.deepEqual(extractBingImageResults('<html>no results</html>'), []);
});

test('offer-drafts route searches photos per line and keeps going when one search fails', async () => {
  const searched = [];
  await withServer(async (dir, server) => {
    await createCentralProject({ projectId: 'mercado-drafts', name: 'Mercado Drafts', projectType: 'catalog' }, dir);
    const created = await request(server, '/api/projects/mercado-drafts/offer-drafts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Coca-Cola 2L - 9,99\nArroz 5kg' }),
    });
    assert.equal(created.response.status, 201);
    assert.deepEqual(searched, ['Coca-Cola 2L', 'Arroz 5kg']);
    assert.equal(created.body.drafts.length, 2);
    assert.equal(created.body.drafts[0].price, 'R$ 9,99');
    assert.equal(created.body.drafts[0].candidates[0].imageUrl, 'https://img.test/coca.jpg');
    assert.deepEqual(created.body.drafts[1].candidates, []);
    assert.equal(created.body.project.contentStrategy.offers.length, 0);

    const removed = await request(server, '/api/projects/mercado-drafts/offer-drafts-delete', {
      method: 'POST',
      body: JSON.stringify({ draftId: created.body.drafts[0].id }),
    });
    assert.equal(removed.response.status, 200);
    assert.deepEqual(removed.body.project.contentStrategy.offerDrafts.map((draft) => draft.name), ['Arroz 5kg']);

    const tooMany = await request(server, '/api/projects/mercado-drafts/offer-drafts', {
      method: 'POST',
      body: JSON.stringify({ text: Array.from({ length: 41 }, (_, i) => `P${i}`).join('\n') }),
    });
    assert.equal(tooMany.response.status, 400);
    assert.match(tooMany.body.error, /No máximo 40 produtos/);
  }, {
    productImageSearcher: async (query) => {
      searched.push(query);
      if (query.startsWith('Coca')) return [{ imageUrl: 'https://img.test/coca.jpg', thumbUrl: 'https://img.test/coca-t.jpg' }];
      throw new Error('bloqueado');
    },
  });
});

test('assets route downloads a sourceUrl, falling back to fallbackSourceUrl', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await withServer(async (dir, server) => {
    await createCentralProject({ projectId: 'mercado-fotos', name: 'Mercado Fotos', projectType: 'catalog' }, dir);
    await withMockedFetch(async (url) => {
      if (String(url) === 'https://img.test/ok.png') return new Response(png, { headers: { 'content-type': 'image/png' } });
      if (String(url) === 'https://img.test/page') return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
      return new Response('nope', { status: 404 });
    }, async () => {
      const saved = await request(server, '/api/projects/mercado-fotos/assets', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'reference',
          filename: 'Coca-Cola 2L',
          sourceUrl: 'https://img.test/broken.jpg',
          fallbackSourceUrl: 'https://img.test/ok.png',
          role: 'product_photo',
          usageRoles: ['product_photo'],
          scope: 'offer',
        }),
      });
      assert.equal(saved.response.status, 201);
      assert.ok(saved.body.asset.metadata.id);
      assert.match(saved.body.asset.relativePath, /\.png$/);

      const notImage = await request(server, '/api/projects/mercado-fotos/assets', {
        method: 'POST',
        body: JSON.stringify({ kind: 'reference', filename: 'x', sourceUrl: 'https://img.test/page', scope: 'offer' }),
      });
      assert.equal(notImage.response.status, 400);
      assert.match(notImage.body.error, /Não consegui baixar essa foto/);

      const badProtocol = await request(server, '/api/projects/mercado-fotos/assets', {
        method: 'POST',
        body: JSON.stringify({ kind: 'reference', filename: 'x', sourceUrl: 'file:///etc/passwd', scope: 'offer' }),
      });
      assert.equal(badProtocol.response.status, 400);
    });
  });
});
```

If `createCentralProject` rejects `projectType`, drop that field — the routes do not depend on it. If thrown route errors come back with a status other than 400, read the router's top-level `catch` (around line 986) and assert whatever status it uses for thrown `Error`s.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="extractBingImageResults|offer-drafts route|sourceUrl" tests/content-central-server.test.js`
Expected: FAIL — `extractBingImageResults` not exported.

- [ ] **Step 3: Implement the helpers** (after `searchDuckDuckGo`)

```js
// Product photo candidates for "Adiantar fotos (lista)". Bing Images needs no
// API key; each result is an <a class="iusc" m="{json}"> whose JSON holds the
// full image (murl) and Bing's own thumbnail (turl).
// ponytail: HTML scraping breaks if Bing changes its markup (drafts then come
// without photos); upgrade path is a keyed image API such as Brave Search.
export function extractBingImageResults(html, limit = 4) {
  const results = [];
  for (const match of String(html || '').matchAll(/class="iusc"[^>]*?\sm="([^"]+)"/g)) {
    try {
      const data = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      if (/^https?:\/\//i.test(data.murl || '')) {
        results.push({ imageUrl: data.murl, thumbUrl: /^https?:\/\//i.test(data.turl || '') ? data.turl : data.murl });
      }
    } catch {
      // A malformed entry is skipped; the rest of the page is still usable.
    }
    if (results.length >= limit) break;
  }
  return results;
}

async function searchProductImages(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&setmkt=pt-BR&cc=BR`;
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: SITE_FETCH_HEADERS });
  if (!response.ok) throw new Error(`Bing Imagens respondeu com status ${response.status}.`);
  return extractBingImageResults(await response.text());
}

const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;

async function downloadImageAsDataUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Endereço de foto inválido.');
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: SITE_FETCH_HEADERS });
  const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!response.ok || !mimeType.startsWith('image/')) throw new Error('Esse endereço não devolveu uma imagem.');
  // ponytail: reads the whole body before checking the size; stream with a
  // byte counter if huge images ever become a real problem.
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_SOURCE_IMAGE_BYTES) throw new Error('Foto grande demais (mais de 10 MB).');
  return { dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, mimeType };
}

// Lets the asset upload take a photo chosen from a draft's online candidates:
// the server downloads it (the browser can't, because of CORS) and hands the
// rest of the route a normal dataUrl.
async function resolveAssetSourceUrl(body) {
  if (!body?.sourceUrl || body.dataUrl) return body;
  const { sourceUrl, fallbackSourceUrl, ...rest } = body;
  for (const url of [sourceUrl, fallbackSourceUrl].filter(Boolean)) {
    try {
      const { dataUrl, mimeType } = await downloadImageAsDataUrl(url);
      const extension = mimeType.split('/')[1].split('+')[0].replace('jpeg', 'jpg');
      const baseName = String(rest.filename || 'produto').replace(/\.[^./\\]+$/, '');
      return { ...rest, filename: `${baseName}.${extension}`, dataUrl };
    } catch {
      // Try the next URL (the thumbnail) before giving up.
    }
  }
  throw new Error('Não consegui baixar essa foto — escolha outra ou anexe do computador.');
}
```

- [ ] **Step 4: Wire the asset route, the options and the draft routes**

Assets route becomes:

```js
  if (parts.length === 4 && parts[3] === 'assets') {
    const body = await normalizeUploadedImageAsset(await resolveAssetSourceUrl(await readBody(req)));
```

Options: add `productImageSearcher = null,` after `offerDirectionSuggester = null,`. Context: add `productImageSearcher: productImageSearcher || searchProductImages,` after the `offerDirectionSuggester:` line.

After the `offer-groups-delete` route:

```js
  if (parts.length === 4 && parts[3] === 'offer-drafts') {
    const body = await readBody(req);
    const lines = parseOfferDraftLines(body.text);
    if (!lines.length) return sendJson(res, 400, { error: 'Escreva pelo menos um produto, um por linha.' });
    // One search at a time — firing 40 at once is how a keyless search gets
    // blocked. A failed search leaves that draft without photos instead of
    // failing the whole list.
    const drafts = [];
    for (const line of lines) {
      let candidates = [];
      try {
        candidates = await context.productImageSearcher(line.name);
      } catch (err) {
        console.error('[content-central] product photo search failed:', err.message);
      }
      drafts.push({ ...line, candidates });
    }
    const result = await saveProjectOfferDrafts(projectId, drafts, targetDir);
    return sendJson(res, 201, result);
  }

  if (parts.length === 4 && parts[3] === 'offer-drafts-delete') {
    const body = await readBody(req);
    const result = await deleteProjectOfferDraft(projectId, body.draftId, targetDir);
    return sendJson(res, 200, result);
  }
```

Add `parseOfferDraftLines, saveProjectOfferDrafts, deleteProjectOfferDraft,` to the import block next to `deleteProjectOfferGroup,`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --test-name-pattern="extractBingImageResults|offer-drafts route|sourceUrl" tests/content-central-server.test.js`
Expected: 3 tests PASS. Then `npm run lint` — no new errors.

- [ ] **Step 6: Commit (PowerShell)**

```powershell
git add src/content-central-server.js tests/content-central-server.test.js
git commit -m "feat(content-central): offer draft routes with online photo search and download by URL`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Client — list box, "Para revisar" queue, pre-filled form

**Files:**
- Modify: `content-central-app/src/api/client.ts` (types near `ProjectSummary.contentStrategy` line ~360 and `SaveAssetInput` line ~1369; functions after `deleteOfferGroup` line ~1312)
- Modify: `content-central-app/src/pages/workspace/Offers.tsx`
- Test: `content-central-app/src/pages/workspace/Offers.test.tsx`

**Interfaces:**
- Consumes: the routes from Task 2.
- Produces (client.ts):
  - `export interface OfferDraftCandidate { imageUrl: string; thumbUrl: string }`
  - `export interface OfferDraft { id: string; name: string; price: string; candidates: OfferDraftCandidate[]; createdAt: string }`
  - `createOfferDrafts(projectId: string, text: string): Promise<{ project: ProjectSummary; drafts: OfferDraft[] }>`
  - `deleteOfferDraft(projectId: string, draftId: string): Promise<{ deleted: boolean; project: ProjectSummary }>`
  - `SaveAssetInput.dataUrl` becomes optional; adds `sourceUrl?: string; fallbackSourceUrl?: string`
  - `contentStrategy.offerDrafts?: OfferDraft[]`

- [ ] **Step 1: Write the failing tests** (inside `describe("Offers", ...)`)

```tsx
  const CATALOG_DRAFT = {
    id: "draft-coca",
    name: "Coca-Cola 2L",
    price: "R$ 9,99",
    candidates: [
      { imageUrl: "https://img.test/coca-1.jpg", thumbUrl: "https://img.test/coca-1t.jpg" },
      { imageUrl: "https://img.test/coca-2.jpg", thumbUrl: "https://img.test/coca-2t.jpg" },
    ],
    createdAt: "2026-10-04T12:00:00.000Z",
  };

  function catalogState(offers: unknown[] = [], offerDrafts: unknown[] = []) {
    return {
      projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", projectType: "catalog", contentStrategy: { offers, offerDrafts } }],
      globalRules: {},
    };
  }

  it("sends a pasted product list to the drafts endpoint and shows the review queue", async () => {
    stubFetchSequence([
      { body: catalogState() },
      { body: { project: {}, drafts: [CATALOG_DRAFT] } },
      { body: catalogState([], [CATALOG_DRAFT]) },
    ]);
    renderOffers();

    await userEvent.click(await screen.findByRole("button", { name: "Adiantar fotos (lista)" }));
    await userEvent.type(screen.getByLabelText("Um produto por linha (nome e preço, se tiver)"), "Coca-Cola 2L - 9,99");
    await userEvent.click(screen.getByRole("button", { name: "Buscar fotos" }));

    expect(await screen.findByText("Para revisar (1)")).toBeInTheDocument();
    expect(screen.getByText("Coca-Cola 2L")).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/offer-drafts");
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ text: "Coca-Cola 2L - 9,99" });
  });

  it("hides the list box outside catalog projects", async () => {
    stubFetchSequence([{ body: projectState() }]);
    renderOffers();
    await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
    expect(screen.queryByRole("button", { name: "Adiantar fotos (lista)" })).not.toBeInTheDocument();
  });

  it("reviews a draft: form pre-filled, chosen online photo uploaded by URL, draft removed after saving", async () => {
    const savedProduct = { id: "coca", name: "Coca-Cola 2L", type: "offer", price: "R$ 9,99", photoReferenceIds: ["foto-coca"] };
    stubFetchSequence([
      { body: catalogState([], [CATALOG_DRAFT]) },
      { body: { asset: { kind: "reference", metadata: { id: "foto-coca" } } } },
      { body: { project: {}, offer: savedProduct } },
      { body: { deleted: true, project: {} } },
      { body: catalogState([savedProduct], []) },
    ]);
    renderOffers();

    await userEvent.click(await screen.findByRole("button", { name: "Revisar Coca-Cola 2L" }));
    expect(screen.getByLabelText("Nome do produto")).toHaveValue("Coca-Cola 2L");
    expect(screen.getByLabelText(/Preço/)).toHaveValue("R$ 9,99");
    expect(screen.getByRole("button", { name: "Usar foto 1" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Usar foto 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    await screen.findByRole("button", { name: /Sem grupo/ });
    expect(screen.queryByText(/Para revisar/)).not.toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/assets");
    const assetPayload = JSON.parse(calls[1][1].body as string);
    expect(assetPayload.sourceUrl).toBe("https://img.test/coca-2.jpg");
    expect(assetPayload.fallbackSourceUrl).toBe("https://img.test/coca-2t.jpg");
    expect(assetPayload.role).toBe("product_photo");
    expect(calls[2][0]).toBe("/api/projects/boss-pizzaria/offers");
    expect(JSON.parse(calls[2][1].body as string).photoReferenceIds).toEqual(["foto-coca"]);
    expect(calls[3][0]).toBe("/api/projects/boss-pizzaria/offer-drafts-delete");
    expect(JSON.parse(calls[3][1].body as string)).toEqual({ draftId: "draft-coca" });
  });

  it("discards a draft without downloading anything", async () => {
    stubFetchSequence([
      { body: catalogState([], [CATALOG_DRAFT]) },
      { body: { deleted: true, project: {} } },
      { body: catalogState() },
    ]);
    renderOffers();

    await userEvent.click(await screen.findByRole("button", { name: "Descartar Coca-Cola 2L" }));
    await screen.findByText("Nenhum produto cadastrado ainda");
    expect(screen.queryByText(/Para revisar/)).not.toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls.map((call) => call[0])).not.toContain("/api/projects/boss-pizzaria/assets");
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/offer-drafts-delete");
  });
```

Check the price input's label text in `Offers.tsx` (input `id="offer-price"`, line ~759) and use it exactly in `getByLabelText` if `/Preço/` matches more than one label.

- [ ] **Step 2: Run tests to verify they fail**

Run (in `content-central-app`): `npx vitest run src/pages/workspace/Offers.test.tsx`
Expected: the 4 new tests FAIL (no "Adiantar fotos (lista)" button); existing tests PASS.

- [ ] **Step 3: client.ts**

Add types and widen `contentStrategy`:

```ts
export interface OfferDraftCandidate {
  imageUrl: string;
  thumbUrl: string;
}

export interface OfferDraft {
  id: string;
  name: string;
  price: string;
  candidates: OfferDraftCandidate[];
  createdAt: string;
}
```

```ts
  contentStrategy?: { offers?: ProjectOffer[]; pillars?: ProjectPillar[]; offerGroups?: OfferGroup[]; offerDrafts?: OfferDraft[]; topicIdeas?: TopicIdeasBank; [key: string]: unknown };
```

In `SaveAssetInput`, replace `dataUrl: string;` with:

```ts
  dataUrl?: string;
  // A photo picked from a draft's online candidates — the server downloads
  // it (falling back to the thumbnail) instead of the browser sending bytes.
  sourceUrl?: string;
  fallbackSourceUrl?: string;
```

After `deleteOfferGroup`:

```ts
export function createOfferDrafts(projectId: string, text: string): Promise<{ project: ProjectSummary; drafts: OfferDraft[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offer-drafts`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function deleteOfferDraft(projectId: string, draftId: string): Promise<{ deleted: boolean; project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/offer-drafts-delete`, {
    method: "POST",
    body: JSON.stringify({ draftId }),
  });
}
```

- [ ] **Step 4: Offers.tsx — state and handlers**

Imports: add `createOfferDrafts`, `deleteOfferDraft`, `type OfferDraft` to the `@/api/client` import.

After the `importOpen` state:

```tsx
  // "Adiantar fotos (lista)" (catalog only): one product per line becomes a
  // draft with photos found online. Drafts wait in "Para revisar" until the
  // operator opens one in the normal form, completes it and saves.
  const offerDrafts = project.contentStrategy?.offerDrafts || [];
  const [draftListOpen, setDraftListOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [creatingDrafts, setCreatingDrafts] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [discardingDraftId, setDiscardingDraftId] = useState<string | null>(null);
  // The draft open in the form; `selected` is the candidate index that will be
  // downloaded on save (-1 = none, use only photos attached from disk).
  const [reviewingDraft, setReviewingDraft] = useState<{ draft: OfferDraft; selected: number } | null>(null);
```

Handlers (next to `handleAnalyzeText`):

```tsx
  async function handleCreateDrafts() {
    if (!draftText.trim()) {
      setDraftError("Escreva pelo menos um produto, um por linha.");
      return;
    }
    setCreatingDrafts(true);
    setDraftError(null);
    try {
      await createOfferDrafts(project.projectId, draftText);
      setDraftText("");
      setDraftListOpen(false);
      await refreshProject();
    } catch (err) {
      setDraftError((err as Error).message);
    } finally {
      setCreatingDrafts(false);
    }
  }

  function handleReviewDraft(draft: OfferDraft) {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, groupId: defaultGroupId, name: draft.name, price: draft.price });
    setReviewingDraft({ draft, selected: draft.candidates.length ? 0 : -1 });
    setError(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
    setFormOpen(true);
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDiscardDraft(draftId: string) {
    setDiscardingDraftId(draftId);
    setDraftError(null);
    try {
      await deleteOfferDraft(project.projectId, draftId);
      if (reviewingDraft?.draft.id === draftId) setReviewingDraft(null);
      await refreshProject();
    } catch (err) {
      setDraftError((err as Error).message);
    } finally {
      setDiscardingDraftId(null);
    }
  }
```

In `handleEdit` and `handleCancelEdit`, add `setReviewingDraft(null);` as the first line.

- [ ] **Step 5: Offers.tsx — submit**

In `handleSubmit`, replace the photo check with:

```tsx
    const photoFiles = Array.from(photoInputRef.current?.files || []);
    const hasFlavorPhoto = form.flavors.some((flavor) => flavor.file || flavor.photoReferenceId);
    const draftCandidate = reviewingDraft && reviewingDraft.selected >= 0
      ? reviewingDraft.draft.candidates[reviewingDraft.selected]
      : null;
    if (isCatalog && !photoFiles.length && !form.photoReferenceIds.length && !hasFlavorPhoto && !draftCandidate) {
      setError("Cadastre pelo menos uma foto real do produto.");
      return;
    }
```

Inside the `try`, right after `const uploadedIds: string[] = [];`:

```tsx
      if (draftCandidate) {
        const uploaded = await saveAsset(project.projectId, {
          kind: "reference",
          filename: form.name.trim() || "produto",
          sourceUrl: draftCandidate.imageUrl,
          fallbackSourceUrl: draftCandidate.thumbUrl,
          role: "product_photo",
          usageRoles: ["product_photo"],
          referenceCategory: "real_product",
          useInNextGeneration: true,
          scope: "offer",
          instruction: `Foto real do produto: ${form.name}`,
        });
        if (uploaded.asset.metadata?.id) uploadedIds.push(uploaded.asset.metadata.id);
      }
```

After `await saveOffer(...)` and before `setForm({ ...EMPTY_FORM, ... })`:

```tsx
      if (reviewingDraft) {
        await deleteOfferDraft(project.projectId, reviewingDraft.draft.id);
        setReviewingDraft(null);
      }
```

- [ ] **Step 6: Offers.tsx — markup**

Toolbar: after the `{!isCatalog ? (...importOpen button...) : null}` block:

```tsx
        {isCatalog ? (
          <Button type="button" variant="secondary" onClick={() => setDraftListOpen((current) => !current)}>
            {draftListOpen ? "Fechar" : "Adiantar fotos (lista)"}
          </Button>
        ) : null}
```

Right after the toolbar `</div>` (before `{groupsOpen ? (`):

```tsx
      {isCatalog && draftListOpen ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Adiantar fotos a partir de uma lista</b>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Cada linha vira um rascunho com fotos achadas na internet. Nada entra na geração até você revisar e salvar cada um.
            Até 40 produtos por vez — leva uns 2 segundos por produto.
          </p>
          <label htmlFor="offer-draft-list">Um produto por linha (nome e preço, se tiver)</label>
          <textarea
            id="offer-draft-list"
            placeholder={"Ex:\nCoca-Cola 2L - 9,99\nArroz Tio João 5kg - 27,90\nDetergente Ypê 500ml"}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={8}
          />
          <div className="button-row" style={{ marginTop: 10 }}>
            <Button type="button" disabled={creatingDrafts} onClick={handleCreateDrafts}>
              {creatingDrafts ? "Buscando fotos..." : "Buscar fotos"}
            </Button>
          </div>
          {draftError ? <div className="pill bad" style={{ marginTop: 12 }}>{draftError}</div> : null}
        </Card>
      ) : null}

      {isCatalog && offerDrafts.length ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <b>Para revisar ({offerDrafts.length})</b>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Rascunhos da lista — não entram na geração. Abra cada um, complete o cadastro e salve.
          </p>
          {offerDrafts.map((draft) => (
            <div key={draft.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <div style={thumbStyle}>
                {draft.candidates[0] ? (
                  <img src={draft.candidates[0].thumbUrl} alt="" style={thumbImgStyle} loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span>sem foto</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{draft.name}</div>
                {draft.price ? <div className="muted" style={{ fontSize: 13 }}>{draft.price}</div> : null}
                {!draft.candidates.length ? (
                  <div className="muted" style={{ fontSize: 12 }}>sem foto encontrada — anexe na revisão</div>
                ) : null}
              </div>
              <Button type="button" aria-label={`Revisar ${draft.name}`} onClick={() => handleReviewDraft(draft)}>
                Revisar
              </Button>
              <Button
                type="button"
                variant="secondary"
                aria-label={`Descartar ${draft.name}`}
                disabled={discardingDraftId === draft.id}
                onClick={() => handleDiscardDraft(draft.id)}
              >
                Descartar
              </Button>
            </div>
          ))}
          {draftError && !draftListOpen ? <div className="pill bad" style={{ marginTop: 12 }}>{draftError}</div> : null}
        </Card>
      ) : null}
```

In the form, right after the photo input's help `<p className="muted" ...>` (line ~632):

```tsx
            {reviewingDraft ? (
              <div style={{ marginTop: 8 }}>
                {reviewingDraft.draft.candidates.length ? (
                  <>
                    <p className="muted" style={{ margin: "0 0 6px", fontSize: 12 }}>
                      Fotos achadas na internet — a marcada é a que vai ser salva. Clique em outra pra trocar, ou na marcada pra não usar nenhuma.
                    </p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {reviewingDraft.draft.candidates.map((candidate, index) => {
                        const selected = reviewingDraft.selected === index;
                        return (
                          <button
                            key={candidate.imageUrl}
                            type="button"
                            aria-label={`Usar foto ${index + 1}`}
                            aria-pressed={selected}
                            onClick={() => setReviewingDraft({ ...reviewingDraft, selected: selected ? -1 : index })}
                            style={{
                              width: 88,
                              height: 88,
                              padding: 0,
                              borderRadius: 8,
                              overflow: "hidden",
                              cursor: "pointer",
                              background: "var(--bg-soft)",
                              border: selected ? "3px solid var(--accent)" : "1px solid var(--line)",
                            }}
                          >
                            <img src={candidate.thumbUrl} alt="" style={thumbImgStyle} loading="lazy" referrerPolicy="no-referrer" />
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    Nenhuma foto achada na internet pra esse nome — anexe uma do computador.
                  </p>
                )}
              </div>
            ) : null}
```

- [ ] **Step 7: Run tests and build**

Run (in `content-central-app`): `npx vitest run src/pages/workspace/Offers.test.tsx` — expected all PASS.
Run: `npm run build` — expected no type errors.

- [ ] **Step 8: Commit (PowerShell)**

```powershell
git add content-central-app/src/api/client.ts content-central-app/src/pages/workspace/Offers.tsx content-central-app/src/pages/workspace/Offers.test.tsx
git commit -m "feat(content-central-app): paste a product list, review drafts with online photos`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Test bench on port 3399 and real-list check

**Files:** none committed (`_opensquad/content-central/` and `.env` are local test data).

**Interfaces:** Consumes Tasks 1–3.

- [ ] **Step 1: Copy the bench data from the `sabores` worktree** (no `secrets/`, `approvals/` or `content/` — nothing can publish)

```powershell
$src = "..\sabores\_opensquad\content-central"
$dst = "_opensquad\content-central"
New-Item -ItemType Directory -Force $dst | Out-Null
robocopy $src $dst /E /XD secrets approvals content /NFL /NDL /NJH /NJS
Copy-Item ..\sabores\.env .env
Get-ChildItem $dst -Recurse -Directory -Filter secrets
```

Expected: the last command prints nothing (no `secrets` folder copied). `.env` holds only `OPENSQUAD_IMAGE_PROVIDER=codex-agent` and `TZ`.

- [ ] **Step 2: Install, build and full server suite**

```powershell
npm ci
npm ci --prefix content-central-app
npm run build --prefix content-central-app
npm test
```

Expected: full server suite PASS (same failures as master, if any — compare before blaming this branch).

- [ ] **Step 3: Serve on 3399** (background task; it dies after 2 hours — tell the operator)

Check the port is free first (`Get-NetTCPConnection -LocalPort 3399 -ErrorAction SilentlyContinue`); if the `sabores` server holds it, stop that one. Then, as a background task: `node bin/opensquad.js content serve 3399`.

- [ ] **Step 4: Real-list check with the operator**

On `http://localhost:3399`, project `mercado-carvalho` → Produtos → "Adiantar fotos (lista)", paste ~10 real products. Check: the queue appears, photos are mostly right, "Revisar" fills name/price, switching photos works, saving creates the product with the photo and removes the draft, "Descartar" works. Report which products got wrong or no photos.

- [ ] **Step 5: Stop**

Nothing merges to master. Wait for the operator's word.
