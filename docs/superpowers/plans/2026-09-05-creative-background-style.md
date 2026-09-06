# Trava de fundo (elaborado x simples) por oferta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um campo `backgroundStyle` por oferta (`"elaborate"` | `"simple_brand"`) que trava o fundo do criativo gerado em "só cores da marca, sem cenário", independente da estrutura de layout escolhida.

**Architecture:** Novo enum de 2 valores, salvo por oferta, seguindo o pipeline exato já usado por `productTreatment`: normalização com default → `offerToContentTopic`/`buildComboOfferTopic` → `buildCreativeSpec` → 2 linhas condicionais novas no prompt final (LIBERDADE CRIATIVA + RESTRIÇÕES FINAIS). Front-end: mesmo `<select>` ao lado dos dois campos já existentes em `Offers.tsx`.

**Tech Stack:** Node.js (backend `src/content-central.js`), React + TypeScript (`content-central-app`), `node:test` (backend), Vitest + Testing Library (frontend).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-creative-background-style-design.md`
- Default quando `backgroundStyle` ausente/inválido: `simple_brand` (runtime default em `buildCreativeSpec`, não no storage — storage guarda `''` como os outros campos).
- Fundo simples sempre vence estrutura estrita: a linha de "simple_brand" entra sempre, mesmo com `layoutReference` em modo `strict`.
- Campo só aparece na UI quando `!isCatalog`, mesmo padrão de "Tratamento do produto"/"Obediência ao modelo".
- Combo (`buildComboOfferTopic`): `a.backgroundStyle || b.backgroundStyle`, mesmo padrão já usado pra `productTreatment`/`layoutStrength` ali — não é bug a corrigir aqui.
- Sem terceira opção de fundo (YAGNI) e sem escolha por geração/projeto — só por oferta, 2 valores.

---

### Task 1: Normalização + `buildCreativeSpec` + persistência do campo na oferta

**Files:**
- Modify: `src/content-central.js:7114-7135` (novas funções perto de `normalizeProductTreatment`/`normalizeLayoutStrength`)
- Modify: `src/content-central.js:7149-7207` (`buildCreativeSpec` — adicionar `background`)
- Modify: `src/content-central.js:9017-9022` (`normalizeProjectOffer` — validar `backgroundStyle` ao salvar)
- Test: `tests/content-central.test.js`

**Interfaces:**
- Produces: `normalizeBackgroundStyle(value)` → retorna `'elaborate'` ou `'simple_brand'` (string), default `'simple_brand'` pra qualquer valor não reconhecido.
- Produces: `creativeSpec.background.style` (string, um dos dois valores acima), disponível em qualquer `content.creativeSpec` retornado por `buildCreativeSpec`.
- Produces: `offer.backgroundStyle` persistido como `'elaborate'`, `'simple_brand'` ou `''` (igual ao padrão de `productTreatment`).

- [ ] **Step 1: Escrever o teste de normalização/campo salvo (falhando)**

Adicionar ao final de `tests/content-central.test.js` (mesmo arquivo, perto dos testes de `productTreatment` por volta da linha 5156):

```js
test('background style defaults to simple_brand when missing and is validated on save', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'fundo-simples-produto',
      name: 'Cliente Frios',
      handle: '@clientefrios',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const offer = await saveProjectOffer('fundo-simples-produto', {
      name: 'Mussarela Fatiada',
      type: 'offer',
      backgroundStyle: 'not-a-real-value',
      active: true,
    }, dir, new Date('2026-09-05T12:00:00.000Z'));

    // Invalid input is stored as '' (same pattern as productTreatment), the
    // 'simple_brand' default is applied at generation time, not at storage.
    assert.equal(offer.backgroundStyle, '');
  });
});

test('offer with explicit elaborate background style is stored and read back unchanged', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'fundo-elaborado-produto',
      name: 'Cliente Frios',
      handle: '@clientefrios',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const offer = await saveProjectOffer('fundo-elaborado-produto', {
      name: 'Mussarela Fatiada',
      type: 'offer',
      backgroundStyle: 'elaborate',
      active: true,
    }, dir, new Date('2026-09-05T12:00:00.000Z'));

    assert.equal(offer.backgroundStyle, 'elaborate');
  });
});
```

- [ ] **Step 2: Rodar os testes novos e confirmar que falham**

Run: `node --test tests/content-central.test.js --test-name-pattern="background style"`
Expected: FAIL — `offer.backgroundStyle` é `undefined` (campo ainda não existe em `normalizeProjectOffer`).

- [ ] **Step 3: Implementar `normalizeBackgroundStyle` e wiring em `buildCreativeSpec`**

Em `src/content-central.js`, logo depois de `normalizeLayoutStrength` (linha 7135):

```js
// Only 'elaborate' is a real opt-in; every other value (missing, invalid,
// or already 'simple_brand') defaults to simple_brand per spec — no need
// for a synonym list like normalizeProductTreatment's, this field has no
// legacy data to map from.
function normalizeBackgroundStyle(value) {
  return String(value || '').trim().toLowerCase() === 'elaborate' ? 'elaborate' : 'simple_brand';
}
```

Em `buildCreativeSpec` (linha ~7161, logo após `const layoutStrength = normalizeLayoutStrength(...)`):

```js
  const backgroundStyle = normalizeBackgroundStyle(topic.backgroundStyle);
```

E no objeto retornado (logo depois do bloco `layout: { ... }`, antes de `references:`):

```js
    background: {
      style: backgroundStyle,
    },
```

- [ ] **Step 4: Validar `backgroundStyle` em `normalizeProjectOffer`**

Em `src/content-central.js:9017-9022`, logo depois do campo `layoutStrength`:

```js
    layoutStrength: ['strict', 'balanced', 'free'].includes(String(input?.layoutStrength || '').trim())
      ? String(input.layoutStrength).trim()
      : '',
    backgroundStyle: ['elaborate', 'simple_brand'].includes(String(input?.backgroundStyle || '').trim())
      ? String(input.backgroundStyle).trim()
      : '',
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `node --test tests/content-central.test.js --test-name-pattern="background style"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): add backgroundStyle field with simple_brand default

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014j4fAkA6QMvf3q8qijHZz7"
```

---

### Task 2: Puxar `backgroundStyle` pro tópico (incluindo combo) e injetar no prompt final

**Files:**
- Modify: `src/content-central.js:6522-6552` (`offerToContentTopic`)
- Modify: `src/content-central.js:6589-6610` (`buildComboOfferTopic`)
- Modify: `src/content-central.js:7507-7533` (seções LIBERDADE CRIATIVA / RESTRIÇÕES FINAIS do prompt)
- Test: `tests/content-central.test.js`

**Depends-on:** Task 1 (usa `normalizeBackgroundStyle` e `creativeSpec.background.style` de lá).

**Interfaces:**
- Consumes: `normalizeBackgroundStyle(value)`, `creativeSpec.background.style` (de Task 1).
- Produces: `topic.backgroundStyle` (string) disponível em qualquer `content.contentTopic` construído a partir de uma oferta ou combo.

- [ ] **Step 1: Escrever o teste de ponta a ponta (falhando)**

Adicionar em `tests/content-central.test.js`, logo depois do teste `'photographic integration treatment keeps product faithful...'` (por volta da linha 4423):

```js
test('simple_brand background style locks the prompt to brand-only background, overriding a strict layout template', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'fundo-simples-mussarela',
      name: 'Cliente Frios',
      handle: '@clientefrios',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const dataUrl = `data:image/png;base64,${Buffer.from('mussarela').toString('base64')}`;
    const offerPhoto = await saveProjectAsset('fundo-simples-mussarela', {
      kind: 'reference',
      filename: 'mussarela-fatiada.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Foto real da mussarela fatiada.',
    }, dir);

    await saveProjectOffer('fundo-simples-mussarela', {
      name: 'Mussarela Fatiada',
      type: 'offer',
      price: 'R$ 39,90',
      photoReferenceIds: [offerPhoto.metadata.id],
      productTreatment: 'faithful_enhance',
      backgroundStyle: 'simple_brand',
      active: true,
    }, dir, new Date('2026-09-05T12:00:00.000Z'));
    await updateProjectBrandInput('fundo-simples-mussarela', {
      segmentGroup: 'Varejo',
      segmentCategory: 'Supermercado',
    }, dir);
    await registerCreativeTemplate('group:varejo/category:supermercado', 'offer', 'feed', dir);

    const generatorCalls = [];
    const content = await simulateTestPost('fundo-simples-mussarela', {
      channel: 'instagram_feed',
      testSeed: 'fundo-simples-mussarela',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/mussarela.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-09-05T12:05:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    assert.equal(content.creativeSpec.background.style, 'simple_brand');
    assert.match(prompt, /Fundo obrigatoriamente liso e simples, usando apenas as cores da marca/i);
    assert.match(prompt, /vale mesmo se o modelo estrutural/i);
    assert.match(prompt, /Não criar cenário, ambientação ou objetos de contexto no fundo/i);
  });
});

test('elaborate background style leaves the free-form background prompt unchanged', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'fundo-elaborado-mussarela',
      name: 'Cliente Frios',
      handle: '@clientefrios',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    await saveProjectOffer('fundo-elaborado-mussarela', {
      name: 'Mussarela Fatiada',
      type: 'offer',
      price: 'R$ 39,90',
      backgroundStyle: 'elaborate',
      active: true,
    }, dir, new Date('2026-09-05T12:00:00.000Z'));
    await updateProjectBrandInput('fundo-elaborado-mussarela', {
      segmentGroup: 'Varejo',
      segmentCategory: 'Supermercado',
    }, dir);
    await registerCreativeTemplate('group:varejo/category:supermercado', 'offer', 'feed', dir);

    const generatorCalls = [];
    const content = await simulateTestPost('fundo-elaborado-mussarela', {
      channel: 'instagram_feed',
      testSeed: 'fundo-elaborado-mussarela',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/mussarela.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-09-05T12:05:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    assert.equal(content.creativeSpec.background.style, 'elaborate');
    assert.doesNotMatch(prompt, /Fundo obrigatoriamente liso e simples/i);
    assert.doesNotMatch(prompt, /Não criar cenário, ambientação ou objetos de contexto no fundo/i);
  });
});
```

- [ ] **Step 2: Rodar os testes novos e confirmar que falham**

Run: `node --test tests/content-central.test.js --test-name-pattern="background style"`
Expected: FAIL — as duas primeiras (Task 1) passam, as duas novas falham porque `topic.backgroundStyle` nunca chega no prompt.

- [ ] **Step 3: Puxar `backgroundStyle` em `offerToContentTopic` e `buildComboOfferTopic`**

Em `src/content-central.js:6545`, logo depois de `productTreatment: offer.productTreatment,`:

```js
    backgroundStyle: offer.backgroundStyle,
```

Em `src/content-central.js:6604`, logo depois de `productTreatment: a.productTreatment || b.productTreatment,`:

```js
    backgroundStyle: a.backgroundStyle || b.backgroundStyle,
```

- [ ] **Step 4: Injetar as duas linhas condicionais no prompt final**

Em `src/content-central.js`, dentro de `buildChatGptFinalCardPrompt`, seção `LIBERDADE CRIATIVA` (linha ~7507-7518), adicionar a nova linha como **primeiro item do array**, antes da linha condicional de `productLockedToPhoto`:

```js
    section('LIBERDADE CRIATIVA', [
      creativeSpec.background.style === 'simple_brand'
        ? 'Fundo obrigatoriamente liso e simples, usando apenas as cores da marca — sem cenário, objetos de contexto, ambientação ou textura elaborada. Essa regra vale mesmo se o modelo estrutural ou o restante da instrução sugerir outro tipo de fundo.'
        : '',
      productLockedToPhoto && layoutReference && creativeSpec.layout.strength === 'strict'
        ? 'Pode variar fundo, luz, tipografia e acabamento apenas como apoio simples; não pode criar cenário grande, produto secundário dominante nem mudar as zonas, a ordem de leitura ou a hierarquia do modelo estrutural.'
        : productLockedToPhoto
          ? 'Pode variar enquadramento, fundo, luz e tipografia apenas para valorizar o produto real; manter fundo simples, limpo e guiado pelas cores da marca.'
        : layoutReference && creativeSpec.layout.strength === 'strict'
        ? 'Pode variar fundo, luz, tipografia e acabamento, mas não pode mudar as zonas, a ordem de leitura nem a hierarquia do modelo estrutural.'
        : 'Pode variar enquadramento, fundo, luz, tipografia e elementos coerentes com o segmento.',
      variation.length
        ? `Variação desejada: ${variation.join(' ')}`
        : 'Composição distinta da anterior: mudar ângulo, fundo ou detalhe visual sem contrariar a estrutura obrigatória.',
    ]),
```

E na seção `RESTRIÇÕES FINAIS` (linha ~7519-7533), adicionar logo após a linha `productLockedToPhoto ? 'Não criar cenário grande de uso/segmento...' : '',`:

```js
      creativeSpec.background.style === 'simple_brand'
        ? 'Não criar cenário, ambientação ou objetos de contexto no fundo — fundo deve ser liso, só com cor da marca.'
        : '',
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `node --test tests/content-central.test.js --test-name-pattern="background style"`
Expected: PASS (4 testes: os 2 de Task 1 + os 2 novos)

- [ ] **Step 6: Rodar a suíte completa do arquivo pra garantir que nada quebrou**

Run: `node --test tests/content-central.test.js`
Expected: todos os testes existentes continuam passando (a nova linha só aparece quando `backgroundStyle === 'simple_brand'`; ofertas antigas sem o campo agora default pra `simple_brand` — os testes existentes que fazem `assert.match`/`assert.doesNotMatch` no texto do prompt não devem colidir com a frase nova, mas confirme rodando).

- [ ] **Step 7: Commit**

```bash
git add src/content-central.js tests/content-central.test.js
git commit -m "feat(content-central): thread backgroundStyle into prompt, overriding strict layout

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014j4fAkA6QMvf3q8qijHZz7"
```

---

### Task 3: Tipos de API + campo na UI de Ofertas

**Files:**
- Modify: `content-central-app/src/api/client.ts:86-107` (`ProjectOffer`), `content-central-app/src/api/client.ts:1095-1116` (`SaveOfferInput`)
- Modify: `content-central-app/src/pages/workspace/Offers.tsx:41-61` (tipo local + `EMPTY_FORM`), `:386-392` (`handleEdit`), `:674-702` (JSX)
- Test: `content-central-app/src/pages/workspace/Offers.test.tsx`

**Depends-on:** none (arquivos totalmente disjuntos dos das Tasks 1-2; testes de UI usam `fetch` mockado, não o backend real — pode rodar em paralelo com Task 1/2).

**Interfaces:**
- Consumes: nenhum símbolo das Tasks 1-2 (o nome do campo `backgroundStyle` é só uma convenção de payload JSON compartilhada, não uma importação).
- Produces: `form.backgroundStyle` (`"elaborate" | "simple_brand"`) no estado do formulário de `Offers.tsx`, enviado como `payload.backgroundStyle` no `saveOffer`.

- [ ] **Step 1: Escrever o teste de UI (falhando)**

Adicionar em `content-central-app/src/pages/workspace/Offers.test.tsx`, logo depois do teste `"sends the photographic integration product treatment when selected"` (por volta da linha 132):

```tsx
it("defaults the background style field to simple_brand and sends the elaborate option when selected", async () => {
  stubFetchSequence([
    { body: projectState() },
    { body: { project: {}, offer: { ...RODIZIO_OFFER, backgroundStyle: "elaborate" } } },
    { body: projectState([{ ...RODIZIO_OFFER, backgroundStyle: "elaborate" }]) },
  ]);
  renderOffers();

  await screen.findByText("Nenhuma oferta/assunto cadastrado ainda");
  await userEvent.click(screen.getByRole("button", { name: "+ Nova oferta/assunto" }));
  expect(screen.getByLabelText("Fundo do criativo")).toHaveValue("simple_brand");

  await userEvent.type(screen.getByLabelText("Nome"), "Mussarela fatiada");
  await userEvent.selectOptions(screen.getByLabelText("Fundo do criativo"), "elaborate");
  await userEvent.click(screen.getByRole("button", { name: "Salvar oferta/assunto" }));

  const saveCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1];
  const payload = JSON.parse(saveCall[1].body as string);
  expect(payload.backgroundStyle).toBe("elaborate");
});
```

- [ ] **Step 2: Rodar o teste novo e confirmar que falha**

Run: `npx vitest run src/pages/workspace/Offers.test.tsx -t "background style"` (rodar de dentro de `content-central-app/`)
Expected: FAIL — `screen.getByLabelText("Fundo do criativo")` não encontra o elemento (campo ainda não existe).

- [ ] **Step 3: Adicionar o tipo nos dois lugares de `client.ts`**

Em `content-central-app/src/api/client.ts:104` (dentro de `ProjectOffer`), logo depois de `productTreatment?: ...`:

```ts
  backgroundStyle?: "elaborate" | "simple_brand" | "";
```

Em `content-central-app/src/api/client.ts:1113` (dentro de `SaveOfferInput`), mesma linha adicionada logo depois de `productTreatment?: ...`:

```ts
  backgroundStyle?: "elaborate" | "simple_brand" | "";
```

- [ ] **Step 4: Adicionar o campo no formulário de `Offers.tsx`**

Tipo local, logo depois de `type ProductTreatment = ...` (linha 41):

```tsx
type BackgroundStyle = "elaborate" | "simple_brand";
```

Em `EMPTY_FORM` (linha 59-60), logo depois de `layoutStrength: "strict" as "strict" | "balanced" | "free",`:

```tsx
  backgroundStyle: "simple_brand" as BackgroundStyle,
```

Em `handleEdit` (linha 391), logo depois da linha de `layoutStrength`:

```tsx
      backgroundStyle: offer.backgroundStyle === "elaborate" ? offer.backgroundStyle : "simple_brand",
```

No JSX (`:674-702`), dentro do mesmo `<div className="row">` que já tem "Tratamento do produto" e "Obediência ao modelo", como terceira coluna:

```tsx
                <div>
                  <label htmlFor="offer-background-style">Fundo do criativo</label>
                  <select
                    id="offer-background-style"
                    value={form.backgroundStyle}
                    onChange={(e) => setForm({ ...form, backgroundStyle: e.target.value as BackgroundStyle })}
                  >
                    <option value="simple_brand">Simples (cores da marca)</option>
                    <option value="elaborate">Elaborado (cenário/ambientação)</option>
                  </select>
                </div>
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/pages/workspace/Offers.test.tsx -t "background style"` (de dentro de `content-central-app/`)
Expected: PASS

- [ ] **Step 6: Rodar a suíte completa do arquivo pra garantir que nada quebrou**

Run: `npx vitest run src/pages/workspace/Offers.test.tsx` (de dentro de `content-central-app/`)
Expected: todos os testes existentes continuam passando.

- [ ] **Step 7: Commit**

```bash
git add content-central-app/src/api/client.ts content-central-app/src/pages/workspace/Offers.tsx content-central-app/src/pages/workspace/Offers.test.tsx
git commit -m "feat(offers-ui): add background style field defaulting to simple_brand

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014j4fAkA6QMvf3q8qijHZz7"
```

---

### Task 4: Build final + verificação de tipos do front-end

**Files:**
- None (verificação apenas)

**Depends-on:** Task 3 (precisa do TypeScript compilando com o campo novo).

- [ ] **Step 1: Rodar o build do front-end**

Run: `cd content-central-app && npm run build`
Expected: build passa sem erro de tipo (lembrete: `tsc --noEmit` sozinho não pega erro real aqui — usar `npm run build`, ver `content_central_tsc_noemit_gotcha` na memória do projeto).

- [ ] **Step 2: Rodar a suíte de testes inteira do back-end**

Run: `node --test tests/content-central.test.js`
Expected: PASS, sem regressão.

- [ ] **Step 3: Rodar a suíte de testes inteira do front-end**

Run: `cd content-central-app && npx vitest run`
Expected: PASS, sem regressão.
