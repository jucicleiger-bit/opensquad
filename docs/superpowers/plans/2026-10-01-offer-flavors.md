# Offer Flavors / Variations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offer can list up to 6 flavors/variations, each with its own photo, and its arte shows all of them side by side under one title and one price.

**Architecture:** `offer.flavors = [{ name, photoReferenceId }]` is normalized with the offer and carried onto the content topic by `offerToContentTopic` (the single offer → topic funnel). The image prompt, the reference selection and the Codex attachment manifest branch on `topic.flavors?.length`; the three duplicated 2-photo caps collapse into one `productPhotoLimitFor(topic)`.

**Tech Stack:** Node (`node --test`), React + Vite + vitest (`content-central-app`).

Spec: `docs/superpowers/specs/2026-10-01-offer-flavors-design.md`

## Global Constraints

- Work only in the worktree `.claude/worktrees/sabores`, branch `worktree-sabores`. No commit, merge or push to master.
- `MAX_OFFER_FLAVORS = 6`.
- Offers without flavors must behave exactly as before (non-regression: full suites stay green).
- One price for the whole piece; flavors never carry their own price.
- Git commands run through the PowerShell tool (the Bash hook rewrites `git` and the worktree guard refuses it).
- Backend filter: `node --test --test-name-pattern="<pattern>" tests/<file>` — the pattern flag goes BEFORE the file.
- Frontend type check is `npm run build` in `content-central-app` (`tsc --noEmit` checks nothing here).

## File Structure

- `src/content-central.js` — normalizer, topic, photo limit, combo guard, prompt.
- `src/content-central-server.js` — Codex photo cap and attachment manifest.
- `tests/content-central.test.js`, `tests/content-central-server.test.js` — backend tests.
- `content-central-app/src/api/client.ts` — `OfferFlavor` type.
- `content-central-app/src/pages/workspace/Offers.tsx` (+ `Offers.test.tsx`) — form section.

---

### Task 1: Flavors on the offer and the topic

**Files:**
- Modify: `src/content-central.js` (near `MAX_FLYER_PRODUCTS`, `normalizeProjectOffer`, `offerToContentTopic`, `pickComboPartner`, `buildPrimaryAiImageReferences`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `MAX_OFFER_FLAVORS`, `normalizeOfferFlavors(value) → [{name, photoReferenceId|null}]`, `productPhotoLimitFor(topic) → number` (all exported); `offer.flavors`; `topic.flavors`; `topic.photoReferenceIds` = flavor photo ids when flavors exist.

- [ ] **Step 1: Failing tests** (append to `tests/content-central.test.js`; add the three new names to the import from `../src/content-central.js`)

```js
test('normalizeOfferFlavors trims names, drops unnamed rows, nulls an empty photo and caps at 6', () => {
  assert.deepEqual(normalizeOfferFlavors(undefined), []);
  assert.deepEqual(
    normalizeOfferFlavors([{ name: ' Chocolate ', photoReferenceId: ' ref-1 ' }, { name: '  ', photoReferenceId: 'ref-2' }, { name: 'Coco' }]),
    [{ name: 'Chocolate', photoReferenceId: 'ref-1' }, { name: 'Coco', photoReferenceId: null }],
  );
  assert.equal(normalizeOfferFlavors(Array.from({ length: 9 }, (_, i) => ({ name: `S${i}` }))).length, MAX_OFFER_FLAVORS);
});

test('productPhotoLimitFor: flyer takes every product, a flavored offer one photo per flavor, anything else 2', () => {
  assert.equal(productPhotoLimitFor({ source: 'flyer' }), MAX_FLYER_PRODUCTS);
  assert.equal(productPhotoLimitFor({ source: 'offer', flavors: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }), 3);
  assert.equal(productPhotoLimitFor({ source: 'offer' }), 2);
  assert.equal(productPhotoLimitFor(undefined), 2);
});

test('an offer with flavors is saved with them and is never paired into an automatic combo, in either role', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sabores-combo', name: 'Sabores Combo' }, dir);
    const { group } = await saveProjectOfferGroup('sabores-combo', { name: 'Doces', comboChance: 100 }, dir);
    const { offer } = await saveProjectOffer('sabores-combo', {
      name: 'Trento', price: 'R$ 3,99', groupId: group.id,
      flavors: [{ name: 'Chocolate' }, { name: 'Morango' }],
    }, dir);
    assert.deepEqual(offer.flavors, [{ name: 'Chocolate', photoReferenceId: null }, { name: 'Morango', photoReferenceId: null }]);
    await saveProjectOffer('sabores-combo', { name: 'Bala', price: 'R$ 1,00', groupId: group.id }, dir);

    const batch = await generateContentBatch('sabores-combo', {
      days: 2, startDate: '2026-08-03', channel: 'instagram_feed', groupIds: [group.id], offersOnly: true,
    }, dir);
    assert.ok(batch.items.every((item) => item.contentTopic.type !== 'combo'));
    const trento = batch.items.find((item) => item.contentTopic.offerName === 'Trento');
    assert.deepEqual(trento.contentTopic.flavors.map((flavor) => flavor.name), ['Chocolate', 'Morango']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test --test-name-pattern="normalizeOfferFlavors|productPhotoLimitFor|offer with flavors" tests/content-central.test.js` (import error: names not exported).

- [ ] **Step 3: Implement**

Next to `MAX_FLYER_PRODUCTS`:

```js
// One arte showing every flavor/variation of a single offer side by side
// under one price. Six is where a single feed piece stops being legible.
export const MAX_OFFER_FLAVORS = 6;

export function normalizeOfferFlavors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((flavor) => ({
      name: String(flavor?.name || '').trim(),
      photoReferenceId: String(flavor?.photoReferenceId || '').trim() || null,
    }))
    .filter((flavor) => flavor.name)
    .slice(0, MAX_OFFER_FLAVORS);
}

// The one place that says how many product photos a piece may carry — it
// used to be repeated in buildPrimaryAiImageReferences,
// buildChatGptFinalCardPrompt and selectImageReferencesForCodex, and a cap
// left behind in any one of them silently drops photos.
export function productPhotoLimitFor(topic) {
  if (topic?.source === 'flyer') return MAX_FLYER_PRODUCTS;
  return topic?.flavors?.length || 2;
}
```

In `normalizeProjectOffer`, after `photoReferenceIds`:

```js
    // Flavors/variations of this one product (same price for all), each
    // with its own photo — the arte shows them all side by side.
    flavors: normalizeOfferFlavors(input?.flavors),
```

In `offerToContentTopic`: compute `const flavors = normalizeOfferFlavors(offer.flavors);` at the top and replace the `photoReferenceIds` line with:

```js
    flavors,
    // With flavors, the piece is built from the flavor photos, not the
    // offer's general "angles of the product" photos.
    photoReferenceIds: flavors.length
      ? flavors.map((flavor) => flavor.photoReferenceId).filter(Boolean)
      : Array.isArray(offer.photoReferenceIds) ? offer.photoReferenceIds : [],
```

In `pickComboPartner`: add `|| primary.flavors?.length` to the early return and `&& !offer.flavors?.length` to the candidates filter.

In `buildPrimaryAiImageReferences`:
- `claimedByOtherOffers` flatMap becomes `[...(offer.photoReferenceIds || []), ...(offer.flavors || []).map((flavor) => flavor.photoReferenceId)]`;
- `const productPhotoLimit = productPhotoLimitFor(options.topic);`
- the no-pool-fallback condition gains `|| options.topic?.flavors?.length` (a flavored offer with no flavor photo must not borrow unrelated pool photos).

- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Commit** — `feat(content-central): flavors on an offer, carried onto its topic`

---

### Task 2: Prompt shows every flavor under one price

**Files:**
- Modify: `src/content-central.js` (`creativeLayoutZones`, `buildCreativeSpec` call, `formatContentTopicLines`, `detectCreativeProductFocus`, `buildCreativeQuantityRules`, `buildChatGptFinalCardPrompt`, new `buildFlavorProductFocus`, new `productPhotoLabelFor`)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Consumes: `topic.flavors`, `productPhotoLimitFor`.
- Produces: `productPhotoLabelFor(topic, reference) → string` (exported; used by Task 3).

- [ ] **Step 1: Failing test**

```js
test('an offer with 3 flavors sends all 3 labeled photos and a side-by-side, single-price brief to the image model', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'sabores-arte', name: 'Sabores Arte', handle: '@saboresarte', approvalEmail: 'aprovacao@example.com',
    }, dir);
    // An 'offer' post type needs a registered creative template, or generation is skipped.
    await updateProjectBrandInput('sabores-arte', { segmentGroup: 'Negocios locais e lojas', segmentCategory: 'Mercado' }, dir);
    await registerCreativeTemplate('group:negocios-locais-e-lojas/category:mercado', 'offer', 'feed', dir);
    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    const photos = [];
    for (const flavor of ['chocolate', 'morango', 'coco']) {
      photos.push(await saveProjectAsset('sabores-arte', {
        kind: 'reference', filename: `trento-${flavor}.jpg`, dataUrl, role: 'product_photo',
        usageRoles: ['product_photo'], referenceCategory: 'real_product', weight: 'high',
        instruction: `Foto real do produto: Trento — sabor ${flavor}`,
      }, dir));
    }
    await saveProjectOffer('sabores-arte', {
      name: 'Trento', price: 'R$ 3,99',
      flavors: [
        { name: 'Chocolate', photoReferenceId: photos[0].metadata.id },
        { name: 'Morango', photoReferenceId: photos[1].metadata.id },
        { name: 'Coco', photoReferenceId: photos[2].metadata.id },
        { name: 'Limão' },
      ],
    }, dir);

    const batch = await generateContentBatch('sabores-arte', {
      days: 1, startDate: '2026-08-03', channel: 'instagram_feed', offersOnly: true,
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'sabores-arte');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'sabores-arte', {
      imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/sabores.png', mimeType: 'image/png' }; },
    }, getCentralPaths(dir, 'sabores-arte'));

    const image = calls[0].content.image;
    assert.deepEqual(
      image.references.filter((reference) => reference.role === 'product_photo').map((reference) => reference.id).sort(),
      photos.map((photo) => photo.metadata.id).sort(),
      'all three flavor photos must reach the model, not just two',
    );
    const prompt = image.prompt;
    assert.match(prompt, /Chocolate, Morango, Coco, Limão/);
    assert.match(prompt, /lado a lado/);
    assert.match(prompt, /preço único/);
    assert.match(prompt, /Preço exato: R\$ 3,99/);
    assert.match(prompt, /Foto do sabor\/variação "Chocolate": assets\/references\/trento-chocolate\.jpg/);
    assert.match(prompt, /Foto do sabor\/variação "Coco": assets\/references\/trento-coco\.jpg/);
    assert.match(prompt, /Sem foto real anexada: Limão/);
    assert.doesNotMatch(prompt, /Foto selecionada:/);
    assert.doesNotMatch(prompt, /em destaque como produto principal/);
    assert.doesNotMatch(prompt, /O produto deve ser o protagonista visual/);
    assert.doesNotMatch(prompt, /produto\/benefício como protagonista/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test --test-name-pattern="offer with 3 flavors" tests/content-central.test.js`

- [ ] **Step 3: Implement**

Next to `flyerProductLabelFor`:

```js
// Same reason as flyerProductLabelFor: the photos arrive in
// reference-registration order, so without a name on each one the model
// can't tell which flavor a photo is.
export function productPhotoLabelFor(topic = {}, reference = {}) {
  if (hasProductList(topic)) return flyerProductLabelFor(topic, reference);
  const flavor = (topic.flavors || []).find((entry) => entry.photoReferenceId === reference.id);
  return flavor
    ? `Foto do sabor/variação "${flavor.name}": ${reference.relativePath}`
    : `Foto selecionada: ${reference.relativePath}`;
}

// One product in several flavors/variations, one price for all. Unlike a
// paired offer or a flyer, the headline and the price seal stay the offer's
// own — only the "single hero product" framing gives way to the full set.
function buildFlavorProductFocus(topic = {}) {
  const flavors = topic.flavors || [];
  const names = flavors.map((flavor) => flavor.name).join(', ');
  const missingPhoto = flavors.filter((flavor) => !flavor.photoReferenceId).map((flavor) => flavor.name);
  return {
    heroLine: `1. Os ${flavors.length} sabores/variações de ${topic.offerName} lado a lado, com o mesmo destaque, cada um com o seu nome legível embaixo: ${names}. É o mesmo produto em versões diferentes, com um preço único para todos — não é combo nem kit.`,
    assetLines: [
      missingPhoto.length < flavors.length
        ? 'Usar a foto real anexada de cada sabor/variação — cada foto vem rotulada com o nome a que pertence. Não trocar a foto de um pela de outro.'
        : '',
      missingPhoto.length
        ? `Sem foto real anexada: ${missingPhoto.join(', ')} — mostrar só o nome escrito, sem desenhar embalagem inventada.`
        : '',
    ].filter(Boolean),
    visualLines: [`A peça mostra todos os ${flavors.length} sabores/variações, nenhum em destaque exclusivo sobre os outros.`],
    restrictionLines: [
      'Não omitir nenhum sabor/variação da lista e não acrescentar nenhum que não esteja nela.',
      'O preço aparece uma única vez, valendo para todos — não repetir nem somar preço por sabor/variação.',
    ],
  };
}
```

- `detectCreativeProductFocus`: after the `hasProductList` line add `if (topic.flavors?.length) return buildFlavorProductFocus(topic);`
- `buildCreativeQuantityRules`: the empty-rules guard becomes `if (topic.flavors?.length || !quantity || quantity < 2)`.
- `creativeLayoutZones(channel, isFlyer = false, hasFlavors = false)`: `centerLabel` gains the middle branch `hasFlavors ? 'todos os sabores/variações lado a lado, com o mesmo destaque, nenhum isolado como protagonista'`; the call in `buildCreativeSpec` passes `Boolean(topic.flavors?.length)` as third argument.
- `formatContentTopicLines`: after the price line add
  `topic.flavors?.length ? \`Sabores/variações disponíveis, todos pelo mesmo preço: ${topic.flavors.map((flavor) => flavor.name).join(', ')}.\` : '',`
- `buildChatGptFinalCardPrompt`:
  - `productReferences` slice uses `productPhotoLimitFor(topic)`;
  - add `const hasFlavors = Boolean(topic.flavors?.length);`
  - photo label map becomes `productReferences.map((reference) => productPhotoLabelFor(topic, reference))`;
  - when `!productReferences.length && hasFlavors`, the PRODUTOS OU FOTOS REAIS section is `productFocus.assetLines` (new branch after the `hasProductList` one);
  - both "Centro:" lines (Story and Feed) get the branch `hasFlavors ? \`Centro: todos os ${topic.flavors.length} sabores/variações lado a lado, com o mesmo destaque, cada um com o nome legível — nenhum isolado como protagonista.\``;
  - HIERARQUIA last-but-one line gets the branch `hasFlavors ? 'Nenhum sabor/variação é protagonista sozinho: o conjunto lado a lado é o elemento central da peça.'`.

- [ ] **Step 4: Run, expect PASS**; then the whole file `node --test tests/content-central.test.js` — expect 0 failures.
- [ ] **Step 5: Commit** — `feat(content-central): brief the image model on an offer's flavors, side by side under one price`

---

### Task 3: Codex forwards and names every flavor photo

**Files:**
- Modify: `src/content-central-server.js` (`buildCodexAttachmentManifest`, `selectImageReferencesForCodex`, import)
- Test: `tests/content-central-server.test.js`

**Interfaces:**
- Consumes: `productPhotoLimitFor`, `productPhotoLabelFor` from `./content-central.js`.

- [ ] **Step 1: Failing tests**

```js
test('selectImageReferencesForCodex forwards one photo per flavor for an offer with flavors', () => {
  const brand = { role: 'brand_asset', absolutePath: '/brand.png' };
  const photos = Array.from({ length: 4 }, (_, index) => ({ role: 'product_photo', absolutePath: `/sabor${index + 1}.png` }));
  const topic = { source: 'offer', flavors: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
  assert.deepEqual(selectImageReferencesForCodex([brand, ...photos], topic), [brand, photos[0], photos[1], photos[2]]);
});

test('buildCodexAttachmentManifest names the flavor each attached photo belongs to', () => {
  const brand = { id: 'logo', role: 'brand_asset', relativePath: 'assets/logo.png' };
  const chocolate = { id: 'ref-choc', role: 'product_photo', relativePath: 'assets/references/chocolate.png' };
  const morango = { id: 'ref-mor', role: 'product_photo', relativePath: 'assets/references/morango.png' };
  const topic = {
    source: 'offer',
    offerName: 'Trento',
    flavors: [{ name: 'Chocolate', photoReferenceId: 'ref-choc' }, { name: 'Morango', photoReferenceId: 'ref-mor' }],
  };
  const manifest = buildCodexAttachmentManifest([brand, chocolate, morango], topic, 0);
  assert.match(manifest, /Anexo 2:.*sabor\/variação "Chocolate"/);
  assert.match(manifest, /Anexo 3:.*sabor\/variação "Morango"/);
  assert.doesNotMatch(manifest, /grade/, 'a flavored offer is not a flyer grid');
  assert.equal(buildCodexAttachmentManifest([brand, chocolate], { source: 'offer' }, 0), '', 'plain offers still get no manifest');
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test --test-name-pattern="per flavor|names the flavor" tests/content-central-server.test.js`

- [ ] **Step 3: Implement**

```js
export function buildCodexAttachmentManifest(references, topic = {}, offset = 0) {
  const hasFlavors = Boolean(topic?.flavors?.length);
  if (!hasProductList(topic) && !hasFlavors) return '';
  const lines = references.map((reference, index) => {
    const position = index + offset + 1;
    return reference.role === 'product_photo'
      ? `Anexo ${position}: ${productPhotoLabelFor(topic, reference)}`
      : `Anexo ${position}: ${reference.role} — ${reference.relativePath || reference.filename || reference.id || 'referência'}.`;
  });
  if (!lines.length) return '';
  return [
    'Os anexos desta mensagem estão nesta ordem exata:',
    ...lines,
    hasFlavors
      ? 'Cada foto de produto acima pertence ao sabor/variação nomeado nela. Mostrar cada um preservando a embalagem, o rótulo e a marca reais da foto. Não trocar a foto de um pela de outro e não substituir nenhuma delas por um produto genérico desenhado do zero.'
      : 'Cada foto de produto acima pertence ao produto nomeado nela. Colocar cada uma no espaço da grade daquele produto, preservando a embalagem, o rótulo e a marca reais da foto. Não trocar a foto de um produto pela de outro e não substituir nenhuma delas por um produto genérico desenhado do zero.',
  ].join('\n');
}

export function selectImageReferencesForCodex(imageReferences, topic = {}) {
  return [
    ...imageReferences.filter((reference) => reference.role === 'brand_asset').slice(0, 1),
    ...imageReferences.filter((reference) => reference.role === 'product_photo').slice(0, productPhotoLimitFor(topic)),
    ...imageReferences.filter((reference) => reference.role === 'layout_model').slice(0, 2),
  ];
}
```

Add `productPhotoLimitFor` and `productPhotoLabelFor` to the server's import from `./content-central.js`; drop `flyerProductLabelFor`/`MAX_FLYER_PRODUCTS` from that import if nothing else in the file uses them.

- [ ] **Step 4: Run, expect PASS**; then `node --test tests/content-central-server.test.js` — expect 0 failures.
- [ ] **Step 5: Commit** — `feat(content-central): forward and name every flavor photo for Codex`

---

### Task 4: "Sabores / variações" in the offer form

**Files:**
- Modify: `content-central-app/src/api/client.ts` (offer type ~106, `SaveOfferInput` ~1151)
- Modify: `content-central-app/src/pages/workspace/Offers.tsx`
- Test: `content-central-app/src/pages/workspace/Offers.test.tsx`

**Interfaces:**
- Consumes: backend `offer.flavors`.
- Produces: `export type OfferFlavor = { name: string; photoReferenceId: string | null }` in `client.ts`.

- [ ] **Step 1: Failing test** (inside the existing `describe`, modeled on the photo-upload test)

```tsx
  it("saves an offer's flavors, uploading each flavor's photo and linking it to the flavor", async () => {
    const saved = { id: "trento", name: "Trento", type: "offer", price: "R$ 3,99" };
    stubFetchSequence([
      { body: { projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [] } }], globalRules: {} } },
      { body: { asset: { kind: "reference", metadata: { id: "foto-chocolate" } } } },
      { body: { project: {}, offer: saved } },
      { body: { projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers: [saved] } }], globalRules: {} } },
    ]);
    renderOffers();

    await userEvent.click(await screen.findByRole("button", { name: "+ Nova oferta / assunto" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Trento");
    await userEvent.click(screen.getByRole("button", { name: "+ Adicionar sabor" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Adicionar sabor" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Adicionar sabor" }));
    await userEvent.type(screen.getByLabelText("Nome do sabor 1"), "Chocolate");
    await userEvent.upload(screen.getByLabelText("Foto do sabor 1"), new File(["x"], "chocolate.png", { type: "image/png" }));
    await userEvent.type(screen.getByLabelText("Nome do sabor 2"), "Morango");
    await userEvent.click(screen.getByRole("button", { name: "Remover sabor 3" }));
    expect(screen.queryByLabelText("Nome do sabor 3")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Salvar/ }));

    await screen.findByText("Trento");
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[1][0]).toBe("/api/projects/boss-pizzaria/assets");
    expect(JSON.parse(calls[2][1].body as string).flavors).toEqual([
      { name: "Chocolate", photoReferenceId: "foto-chocolate" },
      { name: "Morango", photoReferenceId: null },
    ]);
  });
```

(Adjust the open-form button name and group expansion to whatever the neighboring marketing-mode tests in this file use.)

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/pages/workspace/Offers.test.tsx -t "flavors"`

- [ ] **Step 3: Implement**

`client.ts`: `export type OfferFlavor = { name: string; photoReferenceId: string | null };` and `flavors?: OfferFlavor[];` on both offer shapes.

`Offers.tsx`:

```tsx
const MAX_OFFER_FLAVORS = 6;
type FlavorRow = OfferFlavor & { file?: File };
// EMPTY_FORM
  flavors: [] as FlavorRow[],
// edit loader
  flavors: (offer.flavors || []).map((flavor) => ({ ...flavor })),
```

```tsx
  function updateFlavor(index: number, patch: Partial<FlavorRow>) {
    setForm((current) => ({
      ...current,
      flavors: current.flavors.map((flavor, i) => (i === index ? { ...flavor, ...patch } : flavor)),
    }));
  }
```

In `handleSubmit`: the catalog photo validation also passes when some flavor has a `file` or `photoReferenceId`; after the general photo uploads:

```tsx
      const flavors: OfferFlavor[] = [];
      for (const { file, ...flavor } of form.flavors) {
        if (!flavor.name.trim()) continue;
        let photoReferenceId = flavor.photoReferenceId;
        if (file) {
          const uploaded = await saveAsset(project.projectId, {
            kind: "reference",
            filename: file.name,
            dataUrl: await fileToDataUrl(file),
            role: "product_photo",
            usageRoles: ["product_photo"],
            referenceCategory: "real_product",
            useInNextGeneration: true,
            scope: "offer",
            instruction: `Foto real do produto: ${form.name} — sabor ${flavor.name.trim()}`,
          });
          photoReferenceId = uploaded.asset.metadata?.id || photoReferenceId;
        }
        flavors.push({ name: flavor.name.trim(), photoReferenceId });
      }
      const payload = { ...form, photoReferenceIds: [...form.photoReferenceIds, ...uploadedIds], flavors };
```

Form section, right after the general photo block:

```tsx
            <label>Sabores / variações (opcional)</label>
            <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12 }}>
              Quando o mesmo produto existe em vários sabores, cores ou modelos pelo mesmo preço: cadastre cada um com a
              sua foto e a arte mostra todos juntos, lado a lado. Até {MAX_OFFER_FLAVORS}.
            </p>
            {form.flavors.map((flavor, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                {flavor.photoReferenceId && photoPreviewUrl(flavor.photoReferenceId) ? (
                  <div style={thumbStyle}>
                    <img src={photoPreviewUrl(flavor.photoReferenceId)!} alt={flavor.name || "Foto do sabor"} style={thumbImgStyle} loading="lazy" />
                  </div>
                ) : null}
                <input
                  aria-label={`Nome do sabor ${index + 1}`}
                  placeholder="Ex: Chocolate"
                  value={flavor.name}
                  onChange={(e) => updateFlavor(index, { name: e.target.value })}
                  style={{ flex: "1 1 160px" }}
                />
                <input
                  type="file"
                  accept="image/*"
                  aria-label={`Foto do sabor ${index + 1}`}
                  onChange={(e) => updateFlavor(index, { file: e.target.files?.[0] })}
                  style={{ flex: "1 1 220px" }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remover sabor ${index + 1}`}
                  onClick={() => setForm((current) => ({ ...current, flavors: current.flavors.filter((_, i) => i !== index) }))}
                >
                  Remover
                </Button>
              </div>
            ))}
            {form.flavors.length < MAX_OFFER_FLAVORS ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm((current) => ({ ...current, flavors: [...current.flavors, { name: "", photoReferenceId: null }] }))}
              >
                + Adicionar sabor
              </Button>
            ) : null}
```

- [ ] **Step 4: Run, expect PASS**; then `npx vitest run` (whole app) and `npm run build` — expect 0 failures, clean build.
- [ ] **Step 5: Commit** — `feat(content-central-app): flavors/variations section in the offer form`

---

### Task 5: Full verification and live validation

- [ ] `npm test` at the worktree root — expect 0 failures.
- [ ] `npx vitest run` and `npm run build` in `content-central-app` — expect 0 failures.
- [ ] `graphify update .`
- [ ] Live: copy one project into the worktree's `_opensquad/content-central/`, start server + app on a non-production port with no publishing `.env`, register "Trento" with 3 flavors + photos, generate one arte, operator reviews it.
