# Clean Title Lettering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated artes stop carrying ticks/sparks around the headline and a drawn display letter by default; a drawn title becomes a per-offer opt-in; a structure model is treated as structure only.

**Architecture:** The final card brief gains a `LETRA DO TÍTULO` section built by `buildTitleLetteringLines(titleStyle, visualSystem)`; `titleStyle` travels offer → topic → `creativeSpec.title.style` exactly like `backgroundStyle`. The structure-only rule is stated in three places the model actually reads: the brief's `REFERÊNCIA PRINCIPAL`, the provider-agnostic wrapper (`buildAiImageGenerationPrompt`) and the Codex attachment manifest.

**Tech Stack:** Node (`node --test`), React + Vite + vitest (`content-central-app`).

Spec: `docs/superpowers/specs/2026-10-01-clean-title-lettering-design.md`

## Global Constraints

- Work only in the worktree `.claude/worktrees/sabores`, branch `worktree-sabores`. No commit, merge or push to master.
- `titleStyle` values: `'clean' | 'lettering'`; only `'lettering'` is an opt-in, everything else resolves to `'clean'`.
- Only offer-sourced topics (`topic.source === 'offer'`) can be `'lettering'`.
- The ornament ban ("nada ao redor do título") applies to every piece, in both title styles.
- A `visual_reference` keeps its role as a style reference; only `layout_model` is narrowed to structure.
- Git commands run through the PowerShell tool. Backend filter flag goes BEFORE the file: `node --test --test-name-pattern="…" tests/<file>`. Frontend type check is `npm run build`.

## File Structure

- `src/content-central.js` — `normalizeTitleStyle`, `buildTitleLetteringLines`, offer normalizer, topic, creative spec, brief sections, `SEGMENT_LAYOUT_REFERENCE_INSTRUCTION`.
- `src/content-central-server.js` — `buildAiImageGenerationPrompt`, `buildCodexAttachmentManifest`.
- `tests/content-central.test.js`, `tests/content-central-server.test.js`.
- `content-central-app/src/api/client.ts`, `content-central-app/src/pages/workspace/Offers.tsx` (+ `Offers.test.tsx`).

---

### Task 1: Title style on the offer, the topic and the creative spec

**Files:** Modify `src/content-central.js`; Test `tests/content-central.test.js`

**Interfaces:**
- Produces: `buildTitleLetteringLines(titleStyle, visualSystem) → string[]` (exported), `offer.titleStyle`, `topic.titleStyle`, `creativeSpec.title.style`.

- [ ] **Step 1: Failing tests** (append; add `buildTitleLetteringLines` and `buildCreativeSpec` to the import list if missing)

```js
test('buildTitleLetteringLines: clean by default, the brand typography when set, drawn only on request — ornaments banned in all three', () => {
  const clean = buildTitleLetteringLines(undefined).join('\n');
  assert.match(clean, /Letra do título: LIMPA — letra de fôrma sem serifa/);
  assert.match(clean, /em cor chapada; sem contorno, 3D, degradê/);
  assert.match(clean, /Nenhuma palavra do título em letra manuscrita/);
  assert.match(clean, /Nada ao redor do título: sem tracinhos, faíscas, gotas/);

  const branded = buildTitleLetteringLines('clean', { typography: 'commercial_condensed' }).join('\n');
  assert.match(branded, /tipografia da marca \(condensada comercial\)/);
  assert.doesNotMatch(branded, /sem serifa/, 'a serif brand must not be told "sem serifa"');

  const drawn = buildTitleLetteringLines('lettering', { typography: 'commercial_condensed' }).join('\n');
  assert.match(drawn, /Letra do título: DESENHADA/);
  assert.match(drawn, /Nada ao redor do título/);
  assert.doesNotMatch(drawn, /LIMPA/);
});

test('only an offer can ask for a drawn title — every other source resolves to clean', () => {
  const spec = (contentTopic) => buildCreativeSpec({ contentTopic }, {}, 'instagram_feed', []).title.style;
  assert.equal(spec({ source: 'offer', titleStyle: 'lettering' }), 'lettering');
  assert.equal(spec({ source: 'offer', titleStyle: 'qualquer coisa' }), 'clean');
  assert.equal(spec({ source: 'offer' }), 'clean');
  assert.equal(spec({ source: 'goal', titleStyle: 'lettering' }), 'clean');
  assert.equal(spec({ source: 'special_date', titleStyle: 'lettering' }), 'clean');
});

test('an offer keeps a valid titleStyle and drops an invalid one', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'letra-oferta', name: 'Letra Oferta' }, dir);
    const drawn = await saveProjectOffer('letra-oferta', { name: 'A', price: 'R$ 1,00', titleStyle: 'lettering' }, dir);
    assert.equal(drawn.offer.titleStyle, 'lettering');
    const invalid = await saveProjectOffer('letra-oferta', { name: 'B', price: 'R$ 1,00', titleStyle: 'neon' }, dir);
    assert.equal(invalid.offer.titleStyle, '');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test --test-name-pattern="buildTitleLetteringLines|drawn title|valid titleStyle" tests/content-central.test.js`

- [ ] **Step 3: Implement**

After `normalizeBackgroundStyle`:

```js
// Same shape as normalizeBackgroundStyle: only 'lettering' is a real opt-in,
// every other value (missing, invalid, already 'clean') is the clean title.
function normalizeTitleStyle(value) {
  return String(value || '').trim().toLowerCase() === 'lettering' ? 'lettering' : 'clean';
}
```

After `formatBrandVisualSystemLines`:

```js
// What the operator calls "cara de IA" on a headline is two separate things:
// the ticks/sparks/droplets drawn around it, and a display letter that is
// outlined, extruded, gradient-filled or hand-lettered. The ornaments are
// banned on every piece; the drawn letter is a per-offer opt-in (see
// normalizeTitleStyle). Written as a positive spec with a closed list because
// neither softer signal held: "evitar visual genérico de IA" names nothing,
// and a brand's "Tipografia fixa" label on its own was ignored — a project
// set to condensada comercial with very subtle shadows still got rounded
// gradient letters with ticks.
// Kept short on purpose: the brief has a length budget (a long prompt dilutes
// every rule in it), so each line names things once.
const TITLE_ORNAMENT_LINE = 'Nada ao redor do título: sem tracinhos, faíscas, gotas, raios, estrelas, brilhos ou sublinhado em pincelada — só as palavras.';

export function buildTitleLetteringLines(titleStyle, visualSystem = {}) {
  if (titleStyle === 'lettering') {
    return [
      'Letra do título: DESENHADA — nesta oferta o operador pediu letra com personalidade (lettering, pincel ou manuscrita) no título; subtítulo, benefícios e preço seguem em letra de fôrma limpa.',
      TITLE_ORNAMENT_LINE,
    ];
  }
  const brandTypography = brandVisualLabel(BRAND_VISUAL_TYPOGRAPHY_LABELS, normalizeBrandVisualSystem(visualSystem).typography);
  return [
    `Letra do título: LIMPA — letra de fôrma ${brandTypography ? `na tipografia da marca (${brandTypography})` : 'sem serifa, pesada'}, em cor chapada; sem contorno, 3D, degradê, brilho ou sombra pesada.`,
    'Nenhuma palavra do título em letra manuscrita, cursiva, de pincel ou cartoon.',
    TITLE_ORNAMENT_LINE,
  ];
}
```

(The first draft of these lines was longer and pushed the brief past the
length budget pinned by "AI final prompt is compiled into concise creative
brief and limited references"; they were cut to this, and that budget moves
from 7500 to 8000 with the reason recorded next to it.)

`normalizeProjectOffer`, after `backgroundStyle`:

```js
    // A drawn/hand-lettered title is an explicit per-offer opt-in; anything
    // else is the default clean title (see buildTitleLetteringLines).
    titleStyle: ['clean', 'lettering'].includes(String(input?.titleStyle || '').trim())
      ? String(input.titleStyle).trim()
      : '',
```

`offerToContentTopic`: `titleStyle: offer.titleStyle,` next to `backgroundStyle`. `buildComboOfferTopic`: `titleStyle: a.titleStyle || b.titleStyle,`.

`buildCreativeSpec`, next to `background`:

```js
    // The drawn title is an offer-form opt-in; every other source has no UI
    // for it and always gets the clean title.
    title: {
      style: topic.source === 'offer' ? normalizeTitleStyle(topic.titleStyle) : 'clean',
    },
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(content-central): a title style on the offer, clean unless the operator asks for a drawn one`

---

### Task 2: The brief fixes the title letter and narrows the structure model

**Files:** Modify `src/content-central.js`; Test `tests/content-central.test.js`

**Interfaces:** Consumes `buildTitleLetteringLines`, `creativeSpec.title.style`.

- [ ] **Step 1: Failing test**

```js
test('the image brief fixes a clean title, bans ornaments around it and treats the structure model as structure only — a drawn title only when the offer asks', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'letra-limpa', name: 'Letra Limpa', handle: '@letralimpa', approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('letra-limpa', { segmentGroup: 'Negocios locais e lojas', segmentCategory: 'Mercado' }, dir);
    await registerCreativeTemplate('group:negocios-locais-e-lojas/category:mercado', 'offer', 'vertical', dir);
    const { offer } = await saveProjectOffer('letra-limpa', { name: 'Mussarela fatiada', price: 'R$ 44,90' }, dir);

    const promptFor = async (startDate) => {
      const batch = await generateContentBatch('letra-limpa', {
        days: 1, startDate, channel: 'instagram_story', offersOnly: true,
      }, dir);
      const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'letra-limpa');
      const calls = [];
      await enrichBatchItemsWithRealImages(batch, project, 'letra-limpa', {
        imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/letra.png', mimeType: 'image/png' }; },
      }, getCentralPaths(dir, 'letra-limpa'));
      return calls[0].content;
    };

    const clean = await promptFor('2026-08-03');
    assert.equal(clean.creativeSpec.title.style, 'clean');
    assert.match(clean.image.prompt, /LETRA DO TÍTULO/);
    assert.match(clean.image.prompt, /Letra do título: LIMPA/);
    assert.match(clean.image.prompt, /Nada ao redor do título: sem tracinhos, faíscas, gotas/);
    assert.match(clean.image.prompt, /O modelo serve só para a estrutura: posição, tamanho, ordem e proporção dos blocos/);
    assert.doesNotMatch(clean.image.prompt, /Pode variar[^\n]*tipografia/, 'typography is no longer handed to the model as free');

    await saveProjectOffer('letra-limpa', { ...offer, titleStyle: 'lettering' }, dir);
    const drawn = await promptFor('2026-08-04');
    assert.equal(drawn.creativeSpec.title.style, 'lettering');
    assert.match(drawn.image.prompt, /Letra do título: DESENHADA/);
    assert.match(drawn.image.prompt, /Nada ao redor do título/, 'the ornament ban holds for a drawn title too');
    assert.doesNotMatch(drawn.image.prompt, /Letra do título: LIMPA/);
  });
});
```

Also update the pinned literal in the existing `buildSegmentLayoutReferences` test (`references[0].instruction`) to the new sentence.

- [ ] **Step 2: Run, expect FAIL** — `node --test --test-name-pattern="fixes a clean title" tests/content-central.test.js`

- [ ] **Step 3: Implement** in `buildChatGptFinalCardPrompt`:

- after the `ESTRUTURA VERTICAL/FEED OBRIGATÓRIA` section:
  `section('LETRA DO TÍTULO', buildTitleLetteringLines(creativeSpec.title?.style, project.brand?.visualSystem)),`
- `REFERÊNCIA PRINCIPAL`, right after the `Força estrutural` line:

```js
      // The operator registers these structures for where things go, never
      // for how they look — and half of them are finished AI-made ads with
      // drawn lettering and ticks around the headline. "Não copiar cores"
      // alone left the model free to lift exactly that.
      'O modelo serve só para a estrutura: posição, tamanho, ordem e proporção dos blocos. Não copiar dele as letras, os enfeites do título, texturas, fundo nem acabamento.',
```

- the `Regra de níveis` line ends `…apenas para integrar; hierarquia, margens e a posição de título, preço, logo e CTA continuam controlados pelo template.`
- `LIBERDADE CRIATIVA`: drop the word "tipografia" from all seven "Pode variar…" literals (`luz, tipografia e acabamento` → `luz e acabamento`; `fundo, luz, tipografia e acabamento` → `fundo, luz e acabamento`; `enquadramento, luz e tipografia` → `enquadramento e luz`; `enquadramento, fundo, luz e tipografia` → `enquadramento, fundo e luz`; `enquadramento, luz, tipografia e elementos` → `enquadramento, luz e elementos`; `enquadramento, fundo, luz, tipografia e elementos` → `enquadramento, fundo, luz e elementos`).
- `SEGMENT_LAYOUT_REFERENCE_INSTRUCTION` ends `…Não copiar marca, produto, cores, estilo das letras nem enfeites da imagem de referência.`

- [ ] **Step 4: Run, expect PASS**; then `node --test tests/content-central.test.js` — 0 failures.
- [ ] **Step 5: Commit** — `feat(content-central): brief a clean title and keep the structure model to structure`

---

### Task 3: The wrapper and the Codex manifest stop presenting the structure as a style reference

**Files:** Modify `src/content-central-server.js`; Test `tests/content-central-server.test.js`

- [ ] **Step 1: Failing tests**

```js
test('the generation prompt narrows a layout model to structure, and leaves other references as style direction', () => {
  const content = (references) => ({
    channel: 'instagram_story',
    formatLabel: 'Instagram Stories',
    image: { aspectRatio: 'portrait', dimensions: { width: 1080, height: 1920 }, prompt: 'FORMATO\n- Story vertical 9:16.', references },
  });
  const logo = { absolutePath: 'C:/tmp/logo.png', role: 'brand_asset', weight: 'high', instruction: 'Logo oficial', mimeType: 'image/png' };
  const layout = { absolutePath: 'C:/tmp/im-9.png', role: 'layout_model', weight: 'medium', instruction: 'Modelo', mimeType: 'image/png' };

  const withLayout = buildAiImageGenerationPrompt({ content: content([logo, layout]), note: '' });
  assert.match(withLayout, /O modelo de layout \(layout_model\) acima serve só para a estrutura/);
  assert.match(withLayout, /menos o modelo de layout, que é só estrutura/);
  assert.match(withLayout, /enfeites decorativos em volta do título/);

  const withoutLayout = buildAiImageGenerationPrompt({ content: content([logo]), note: '' });
  assert.doesNotMatch(withoutLayout, /modelo de layout/);
  assert.match(withoutLayout, /Use as referências como direção visual\/produto\/estilo, mas não copie/);
  assert.match(withoutLayout, /enfeites decorativos em volta do título/);
});

test('buildCodexAttachmentManifest labels a structure model as structure-only for an ordinary offer', () => {
  const brand = { id: 'logo', role: 'brand_asset', relativePath: 'assets/logo.png' };
  const photo = { id: 'p1', role: 'product_photo', relativePath: 'assets/references/p1.png' };
  const layout = { id: 'layout', role: 'layout_model', relativePath: 'segment/im-9.png' };

  const manifest = buildCodexAttachmentManifest([brand, photo, layout], { source: 'offer' }, 0);
  assert.match(manifest, /Anexo 2: Foto selecionada: assets\/references\/p1\.png/);
  assert.match(manifest, /Anexo 3: modelo de estrutura — segment\/im-9\.png\. Usar só para posição, tamanho e ordem dos blocos/);
  assert.doesNotMatch(manifest, /grade/, 'the flyer sentence must not leak into an ordinary offer');
  assert.equal(buildCodexAttachmentManifest([brand, photo], { source: 'offer' }, 0), '', 'no structure model, no manifest — as before');
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test --test-name-pattern="narrows a layout model|structure-only for an ordinary offer" tests/content-central-server.test.js`

- [ ] **Step 3: Implement**

`buildAiImageGenerationPrompt`: compute `references` (the image references, as today), `referencePaths` from it, and `const hasLayoutModel = references.some((reference) => reference.role === 'layout_model');`. Right after the reference list line:

```js
    // A structure model is a finished ad sitting among the references, and
    // the line above calls every reference a "base visual" — which is how
    // its lettering and the ticks around its headline ended up on new pieces.
    hasLayoutModel ? 'O modelo de layout (layout_model) acima serve só para a estrutura: posição, tamanho, ordem e proporção dos blocos. Não é referência de estilo — não copiar dele o desenho das letras, os enfeites ao redor do título, as cores, o fundo, as texturas, o produto nem os textos.' : '',
```

The style line becomes:

```js
    hasLayoutModel
      ? 'Use as referências como direção visual/produto/estilo — menos o modelo de layout, que é só estrutura —, mas não copie textos, preços, logos ou marcas das referências.'
      : 'Use as referências como direção visual/produto/estilo, mas não copie textos, preços, logos ou marcas das referências.',
```

The "Detalhes que denunciam IA" line ends `…saturação exagerada, luz de estúdio genérica sem contexto real e enfeites decorativos em volta do título (tracinhos, faíscas, gotas, raios).`

`buildCodexAttachmentManifest`:

```js
export function buildCodexAttachmentManifest(references, topic = {}, offset = 0) {
  // An offer with flavors has the same problem as a flyer: several product
  // photos that only mean something once each is tied to its flavor's name.
  const hasFlavors = Boolean(topic?.flavors?.length);
  const namesProducts = hasProductList(topic) || hasFlavors;
  // A structure model is a finished ad; unlabeled among the attachments it
  // reads as a style reference. Saying which attachment it is, and what it
  // is for, is what keeps its lettering and ornaments off the new piece.
  const hasLayoutModel = references.some((reference) => reference.role === 'layout_model');
  if (!namesProducts && !hasLayoutModel) return '';
  const lines = references.map((reference, index) => {
    const position = index + offset + 1;
    const path = reference.relativePath || reference.filename || reference.id || 'referência';
    if (reference.role === 'product_photo') return `Anexo ${position}: ${productPhotoLabelFor(topic, reference)}`;
    if (reference.role === 'layout_model') return `Anexo ${position}: modelo de estrutura — ${path}. Usar só para posição, tamanho e ordem dos blocos; não copiar letras, enfeites, cores, fundo, produto nem textos dele.`;
    return `Anexo ${position}: ${reference.role} — ${path}.`;
  });
  if (!lines.length) return '';
  return [
    'Os anexos desta mensagem estão nesta ordem exata:',
    ...lines,
    !namesProducts
      ? ''
      : hasFlavors
        ? 'Cada foto de produto acima pertence ao sabor/variação nomeado nela. Mostrar cada um preservando a embalagem, o rótulo e a marca reais da foto. Não trocar a foto de um pela de outro e não substituir nenhuma delas por um produto genérico desenhado do zero.'
        : 'Cada foto de produto acima pertence ao produto nomeado nela. Colocar cada uma no espaço da grade daquele produto, preservando a embalagem, o rótulo e a marca reais da foto. Não trocar a foto de um produto pela de outro e não substituir nenhuma delas por um produto genérico desenhado do zero.',
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Run, expect PASS**; then `node --test tests/content-central-server.test.js` — 0 failures.
- [ ] **Step 5: Commit** — `feat(content-central): present the structure model to the image model as structure only`

---

### Task 4: "Letra do título" in the offer form

**Files:** Modify `content-central-app/src/api/client.ts`, `content-central-app/src/pages/workspace/Offers.tsx`; Test `Offers.test.tsx`

- [ ] **Step 1: Failing test** (next to the background-style test)

```tsx
  it("defaults the title letter to clean and sends the drawn option when selected", async () => {
    stubFetchSequence([
      { body: projectState() },
      { body: { project: {}, offer: { ...RODIZIO_OFFER, titleStyle: "lettering" } } },
      { body: projectState([{ ...RODIZIO_OFFER, titleStyle: "lettering" }]) },
    ]);
    renderOffers();

    await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
    await userEvent.click(screen.getByRole("button", { name: "+ Nova oferta/assunto" }));
    expect(screen.getByLabelText("Letra do título")).toHaveValue("clean");

    await userEvent.type(screen.getByLabelText("Nome"), "Mussarela fatiada");
    await userEvent.selectOptions(screen.getByLabelText("Letra do título"), "lettering");
    await userEvent.click(screen.getByRole("button", { name: "Salvar oferta/assunto" }));

    const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
    expect(JSON.parse(saveCall[1].body as string).titleStyle).toBe("lettering");
  });
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/pages/workspace/Offers.test.tsx -t "title letter"`

- [ ] **Step 3: Implement**

`client.ts`: `titleStyle?: "clean" | "lettering" | "";` on both offer shapes (next to `backgroundStyle`).

`Offers.tsx`: `type TitleStyle = "clean" | "lettering";`; `EMPTY_FORM.titleStyle: "clean" as TitleStyle`; edit loader `titleStyle: offer.titleStyle === "lettering" ? "lettering" : "clean",`; after the "Fundo do criativo" block, inside the same `.row`:

```tsx
                <div>
                  <label htmlFor="offer-title-style">Letra do título</label>
                  <select
                    id="offer-title-style"
                    value={form.titleStyle}
                    onChange={(e) => setForm({ ...form, titleStyle: e.target.value as TitleStyle })}
                  >
                    <option value="clean">Limpa (padrão)</option>
                    <option value="lettering">Desenhada</option>
                  </select>
                </div>
```

- [ ] **Step 4: Run, expect PASS**; then `npx vitest run` and `npm run build` — 0 failures, clean build.
- [ ] **Step 5: Commit** — `feat(content-central-app): let an offer ask for a drawn title letter`

---

### Task 5: Full verification and live comparison

- [ ] `npm test` at the worktree root — 0 failures.
- [ ] `npx vitest run` and `npm run build` in `content-central-app` — 0 failures.
- [ ] Restart the test server (port 3399) so it loads the new code.
- [ ] Live: regenerate the Treto Story (structure SELO PROMOCIONAL) in the test environment and compare with the previous image — operator judges.
