# Vídeo animado v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Vídeo animado tab with:
- five objectives;
- a Reels or Story/Status format;
- an optional style;
- automatic duration;
- a "Locutor de VT" voice;
- an **Oferta** objective that turns several registered offers into a supermarket VT with locked prices, created either fresh by Claude (✨ nova) or from a fixed template (⚡ padrão).

**Architecture:**
- A new pure-ish module, `src/content-central-video-produtos.js`, owns prices, product photos, placeholders and their validation.
- `content-central-video.js` (the briefing and the video state) and `content-central-video-jobs.js` (the stages) consume it.
- The player loads an optional `produtos.json` into `window.PRODUTOS` and `window.LOJA`.
- The fixed VT is a template `cenas.js` under `src/video-motor/modelos/vt-padrao/`. Its stage 2 runs the TTS and stills mechanically, without Claude.

**Tech Stack:**
- Node ESM, run with `node --test`.
- Jimp v1 (`import { Jimp } from 'jimp'`).
- React + Vite + vitest in `content-central-app`.
- Python `tts.py`, unchanged except that stage 2 of the padrão mode calls it.

**Spec:** `docs/superpowers/specs/2026-10-12-video-animado-v2-design.md`. Read its "Plan-time adjustments" section first; it overrides the sections below it where they differ.

## Global Constraints

- **Objectives:** `alcance`, `anuncio`, `oferta`, `institucional`, `aviso`.
- **Formats:** `reels` (default), `status`.
- **Styles:** `livre` (default), `dinamico`, `mercado`, `premium`, `informativo`.
- **Durations:** `15`, `30`, `45`, `60`, `'auto'`.
- **Tones:** `criador`, `vendedor`, `locutor`.
- **Oferta products:** 1 to 10 (`MAX_PRODUTOS = 10`). `PRODUTOS_POR_DURACAO = { 15: 2, 30: 5, 45: 8, 60: 10 }`. `SEGUNDOS_POR_PRODUTO = 4`, a single constant that will be tuned later.
- **Placeholders** allowed in an Oferta fala: `{preco}`, `{precoDe}`, `{unidade}`, `{validade}`. No digits at all in an Oferta fala.
- **Prices:**
  - on screen they come only from `PRODUTOS[i].precoTela` and `PRODUTOS[i].precoDeTela`;
  - spoken, they are `precoPorExtenso`: 1399 → "treze e noventa e nove", 99 → "noventa e nove centavos", 29700 → "duzentos e noventa e sete reais", 123450 → "mil duzentos e trinta e quatro e cinquenta", 100 → "um real".
- **Snapshot:** a video keeps the products and prices of the day it was created (`briefing.oferta`, with `precosEm: 'YYYY-MM-DD'`).
- **VT padrão scene tipos**, in order: `abertura`, then `produto` × N in the picked order, then `fechamento`.
- **Locutor direction** (the exact text, used in `DIRECOES.locutor` and for the sample): `Leia em português do Brasil, como locutor de comercial de supermercado na TV e no rádio: muita energia, sorriso na voz, ritmo rápido, ênfase forte nos nomes dos produtos e nos preços, como quem anuncia uma oferta imperdível. Leia exatamente o texto abaixo, sem acrescentar nada:`
- **Language:** user-facing text is Portuguese; code comments are English, matching the surrounding code.
- **Commands:**
  - Server tests: `node --test <files>`. Pass `--test-name-pattern` only BEFORE the file argument.
  - App: `cd content-central-app && npx vitest run <file>` and `npm run build`. `tsc --noEmit` checks nothing here.
- **Never** restart the production server on port 3333.

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `src/content-central-video-produtos.js` (new) | Price parsing and speech, product listing and snapshot, photo classification and white cutout, placeholder validation and expansion, padrão post caption | 3 |
| `tests/content-central-video-produtos.test.js` (new) | Unit tests for the module above | 3 |
| `src/content-central-video.js` | Briefing (new fields; Oferta through the produtos module), `validateRoteiro` closings and auto duration, Oferta-aware `saveRoteiroCenas` and `readVideoState` | 1, 4 |
| `src/content-central-video-jobs.js` | `DIRECOES.locutor`, prompt lines, `prepareFolder` writing `produtos.json` and photos, stage 1 validation, expansion and a single retry, mechanical padrão stage 2 | 1, 4, 6 |
| `src/content-central-server.js` | `GET .../videos/produtos`; 400 on a visual ajuste in padrão | 4, 6 |
| `src/video-motor/player.html` | Load the optional `produtos.json` into `window.PRODUTOS` and `window.LOJA` | 4 |
| `src/video-motor/REGRAS.md`, `PEDIDO-roteiro.md`, `PEDIDO-producao.md` | Rules and prompts | 1, 4 |
| `src/video-motor/modelos/vt-padrao/cenas.js` (new) | Fixed VT template | 6 |
| `tests/content-central-video*.test.js`, `tests/video-motor.test.js` | Tests | 1, 4, 6 |
| `content-central-app/src/api/client.ts` | Types and `listVideoProdutos` | 2, 5 |
| `content-central-app/src/pages/workspace/VideoAnimado.tsx`, `.module.css`, `.test.tsx` | Form, picker, review | 2, 5 |
| `content-central-app/public/video-vozes/locutor.mp3` (new) | Voice sample | 2 |

## Waves (per `.claude/rules/parallel-subagent-driven-development.md`)

| Task | Files | Depends-on |
|---|---|---|
| 1 | `src/content-central-video.js`, `src/content-central-video-jobs.js`, `src/video-motor/REGRAS.md`, `tests/content-central-video.test.js`, `tests/content-central-video-jobs.test.js` | none |
| 2 | `content-central-app/src/api/client.ts`, `content-central-app/src/pages/workspace/VideoAnimado.*`, `content-central-app/public/video-vozes/locutor.mp3` | none (it codes against the values in Global Constraints) |
| 3 | `src/content-central-video-produtos.js`, `tests/content-central-video-produtos.test.js` | none |
| 4 | `src/content-central-video.js`, `src/content-central-video-jobs.js`, `src/content-central-server.js`, `src/video-motor/player.html`, `src/video-motor/REGRAS.md`, `src/video-motor/PEDIDO-roteiro.md`, `src/video-motor/PEDIDO-producao.md`, `tests/content-central-video.test.js`, `tests/content-central-video-jobs.test.js`, `tests/content-central-video-server.test.js`, `tests/video-motor.test.js` | 1, 3 |
| 5 | `content-central-app/src/api/client.ts`, `content-central-app/src/pages/workspace/VideoAnimado.*` | 2, 4 |
| 6 | `src/content-central-video-jobs.js`, `src/content-central-server.js`, `src/video-motor/modelos/vt-padrao/cenas.js`, `tests/content-central-video-jobs.test.js`, `tests/content-central-video-server.test.js`, `tests/video-motor.test.js`, `tests/fixtures/vt-padrao/**` | 4 |
| 7 | E2E with the operator, plus tuning `SEGUNDOS_POR_PRODUTO` | 5, 6 |

- **Wave 1:** Tasks 1, 2 and 3. Their file sets are disjoint and none depends on another.
- **Wave 2:** Task 4.
- **Wave 3:** Tasks 5 and 6. Their file sets are disjoint.
- **Wave 4:** Task 7.

Implementers never commit; the controller commits per task.

---

### Task 1: Base briefing (objectives, format, style, auto duration, locutor) and rules

**Files:**
- Modify: `src/content-central-video.js` (constants at :18-22, `normalizeBriefing` :55-67, `validateRoteiro` :109-126)
- Modify: `src/content-central-video-jobs.js` (`DIRECOES` :20-23, `stagePrompt` :101-110)
- Modify: `src/video-motor/REGRAS.md` (§ Objetivo do vídeo; add § Formato and § Estilo)
- Test: `tests/content-central-video.test.js`, `tests/content-central-video-jobs.test.js`

**Interfaces:**
- **Produces:**
  - `normalizeBriefing(input, produtosDisponiveis = null)`, which returns `{ assunto, objetivo, formato, estilo, duracao, tom, legenda, observacao }` where `duracao` is a number or `'auto'`.
    - When `objetivo === 'oferta'` and `produtosDisponiveis` is null, it throws 400 `'Oferta precisa dos produtos cadastrados.'`.
    - Task 4 fills in the Oferta branch.
  - `DIRECOES.locutor`.
  - `duracaoAlvo(briefing)`, exported from `content-central-video.js`: a number of seconds, or `null` for auto.
- **Consumes:** nothing new.

- [ ] **Step 1: Write failing tests** (append to `tests/content-central-video.test.js`)

```js
test('briefing accepts the v2 objectives, format, style, auto duration and locutor', () => {
  const b = normalizeBriefing({ ...briefing, objetivo: 'aviso', formato: 'status', estilo: 'premium', duracao: 'auto', tom: 'locutor' });
  assert.deepEqual([b.objetivo, b.formato, b.estilo, b.duracao, b.tom], ['aviso', 'status', 'premium', 'auto', 'locutor']);
  const padrao = normalizeBriefing(briefing);
  assert.deepEqual([padrao.formato, padrao.estilo], ['reels', 'livre']);
  assert.throws(() => normalizeBriefing({ ...briefing, formato: 'tv' }), (err) => err.status === 400);
  assert.throws(() => normalizeBriefing({ ...briefing, estilo: 'cinematografico' }), (err) => err.status === 400);
  assert.throws(() => normalizeBriefing({ ...briefing, objetivo: 'oferta' }), (err) => err.status === 400 && /produtos/.test(err.message));
});

test('validateRoteiro: auto duration has no time warning; alcance may close with salva/compartilha', () => {
  const cenas = [{ tipo: 'a', fala: 'Dica rápida de hoje.', descricao: 'x' }, { tipo: 'b', fala: 'Salva pra não esquecer e segue a gente.', descricao: 'y' }];
  assert.deepEqual(validateRoteiro({ cenas }, { objetivo: 'alcance', duracao: 'auto', formato: 'reels' }).avisos, []);
  assert.deepEqual(validateRoteiro({ cenas }, { objetivo: 'institucional', duracao: 'auto', formato: 'reels' }).avisos, []);
  const status = validateRoteiro({ cenas }, { objetivo: 'aviso', duracao: 'auto', formato: 'status' }).avisos;
  assert.ok(status.some((a) => /WhatsApp/.test(a)));
});

test('duracaoAlvo is the number of seconds, or null for auto', () => {
  assert.equal(duracaoAlvo({ duracao: 30 }), 30);
  assert.equal(duracaoAlvo({ duracao: 'auto' }), null);
});
```

Add `duracaoAlvo` to the import list at the top of the test file.

Append to `tests/content-central-video-jobs.test.js`:

```js
test('DIRECOES has the locutor direction', () => {
  assert.match(DIRECOES.locutor, /^Leia em português do Brasil, como locutor de comercial de supermercado/);
});

test('stage 1 prompt carries format, style and auto duration', async () => {
  await withProject(async (dir) => {
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner(calls), renderer: async () => ({}) });
    const video = await createVideo('king', { ...briefing, formato: 'status', estilo: 'premium', duracao: 'auto' }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.match(calls[0].prompt, /Formato: Story\/Status/);
    assert.match(calls[0].prompt, /Estilo: premium/);
    assert.match(calls[0].prompt, /Duração alvo: automática/);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/content-central-video.test.js tests/content-central-video-jobs.test.js`
Expected: FAIL (`duracaoAlvo` is not exported, `formato` is undefined, `DIRECOES.locutor` is undefined).

- [ ] **Step 3: Implement in `src/content-central-video.js`**

Replace the constants at :18-21:

```js
const OBJETIVOS = new Set(['alcance', 'anuncio', 'oferta', 'institucional', 'aviso']);
const FORMATOS = new Set(['reels', 'status']);
const ESTILOS = new Set(['livre', 'dinamico', 'mercado', 'premium', 'informativo']);
const DURACOES = new Set([15, 30, 45, 60]);
const TONS = new Set(['criador', 'vendedor', 'locutor']);
```

Replace `normalizeBriefing`:

```js
export function normalizeBriefing(input = {}, produtosDisponiveis = null) {
  const assunto = String(input.assunto || '').trim();
  if (!assunto) throw httpError(400, 'Informe o assunto do vídeo.');
  const objetivo = String(input.objetivo || '');
  if (!OBJETIVOS.has(objetivo)) throw httpError(400, 'Objetivo deve ser alcance, anúncio, oferta, institucional ou aviso.');
  const formato = String(input.formato || 'reels');
  if (!FORMATOS.has(formato)) throw httpError(400, 'Formato deve ser reels ou status.');
  const estilo = String(input.estilo || 'livre');
  if (!ESTILOS.has(estilo)) throw httpError(400, 'Estilo desconhecido.');
  const duracao = input.duracao === 'auto' ? 'auto' : Number(input.duracao);
  if (duracao !== 'auto' && !DURACOES.has(duracao)) throw httpError(400, 'Duração deve ser 15, 30, 45, 60 segundos ou automática.');
  const tom = String(input.tom || 'criador');
  if (!TONS.has(tom)) throw httpError(400, 'Tom deve ser criador, vendedor ou locutor.');
  const legenda = String(input.legenda || 'do-video');
  if (!LEGENDAS.has(legenda)) throw httpError(400, 'Modelo de legenda desconhecido.');
  const briefing = { assunto, objetivo, formato, estilo, duracao, tom, legenda, observacao: String(input.observacao || '').trim() };
  if (objetivo === 'oferta' && !produtosDisponiveis) throw httpError(400, 'Oferta precisa dos produtos cadastrados.');
  return briefing;
}

export const duracaoAlvo = (briefing) => (briefing?.duracao === 'auto' ? null : Number(briefing?.duracao) || null);
```

In `validateRoteiro`, replace the `if (!erros.length && briefing) { … }` block:

```js
  if (!erros.length && briefing) {
    const alvo = duracaoAlvo(briefing);
    const est = estimateSeconds(cenas);
    if (alvo && Math.abs(est - alvo) > alvo * 0.15) avisos.push(`Tempo estimado ${est}s, a meta é ${alvo}s.`);
    const fim = cenas.slice(-2).map((c) => String(c.fala || '')).join(' ');
    const status = briefing.formato === 'status';
    if (briefing.objetivo === 'alcance' && !status && !/\?|salv|compartilh/i.test(fim)) avisos.push('Vídeo de alcance deve fechar com uma enquete ou pedindo para salvar/compartilhar.');
    if ((briefing.objetivo === 'anuncio' || status) && !/whats/i.test(fim)) avisos.push('Este vídeo deve fechar chamando no WhatsApp.');
  }
```

- [ ] **Step 4: Implement in `src/content-central-video-jobs.js`**

Add to `DIRECOES` (the exact text is in Global Constraints):

```js
  locutor: 'Leia em português do Brasil, como locutor de comercial de supermercado na TV e no rádio: muita energia, sorriso na voz, ritmo rápido, ênfase forte nos nomes dos produtos e nos preços, como quem anuncia uma oferta imperdível. Leia exatamente o texto abaixo, sem acrescentar nada:',
```

Replace `stagePrompt`:

```js
const ESTILO_TEXTO = { dinamico: 'dinamico', mercado: 'mercado', premium: 'premium', informativo: 'informativo' };

// Task 4 adds the Oferta line (product count drives the automatic target).
function duracaoTexto(b) {
  if (b.duracao !== 'auto') return `${b.duracao}s`;
  return b.formato === 'status' ? 'automática (15 a 30s)' : 'automática (20 a 45s, o que o assunto pedir)';
}

function stagePrompt(nome, video, temLogo, erroAnterior) {
  const b = video.briefing;
  return [
    `Leia e siga ${MOTOR_PROMPT}/${nome}. Onde ele diz <MOTOR>, use: ${MOTOR_PROMPT}`,
    `Assunto: ${b.assunto}. Objetivo: ${b.objetivo}. Duração alvo: ${duracaoTexto(b)}.${b.observacao ? ` Observação do operador: ${b.observacao}` : ''}`,
    `Formato: ${b.formato === 'status' ? 'Story/Status do WhatsApp (REGRAS.md § Formato)' : 'Reels'}.`,
    ...(ESTILO_TEXTO[b.estilo] ? [`Estilo: ${ESTILO_TEXTO[b.estilo]} (REGRAS.md § Estilo).`] : []),
    LEGENDA_TEXTO[b.legenda] || `Legendas na tela: modelo "${b.legenda}" (já definido, não mude).`,
    temLogo ? 'O logo da marca está em fotos/logo.png.' : 'Esta marca não tem logo cadastrado; não use logo.',
    ...(erroAnterior ? [`A tentativa anterior falhou com: ${erroAnterior}`] : []),
  ].join('\n');
}
```

`forcarRoteiro` already uses `DIRECOES[briefing.tom]`, so locutor works with no other change.

- [ ] **Step 5: Update `src/video-motor/REGRAS.md`**

Replace the "## Objetivo do vídeo" section with:

```markdown
## Objetivo do vídeo (vem do briefing)

- **Alcance:** ser visto e ganhar seguidor. Fecha com uma **enquete** (pergunta com opções que puxa comentário) **ou** pedindo para salvar/compartilhar, quando o vídeo for dica, receita ou lista; sempre com o convite para seguir. Entre 20 e 45 segundos.
- **Anúncio:** converter e gerar conversa no WhatsApp. Dor, solução, prova e oferta. Fecha com CTA direto: WhatsApp com número. Entre 15 e 30 segundos.
- **Oferta:** VT de mercado com os produtos de `produtos.json` (veja § Oferta). Fecha com validade, endereço e WhatsApp.
- **Institucional:** apresenta a empresa (história, bastidores, diferencial). Sem preço e sem venda dura. Fecha com a marca e o convite para seguir.
- **Aviso:** comunicado curto (feriado, novo horário, chegou mercadoria). Direto, sem venda e sem enquete. Fecha com o horário ou o endereço. Cerca de 15 segundos.

## Formato

- **Reels:** o padrão. A interface do Instagram cobre a faixa de baixo e a lateral direita.
- **Story/Status do WhatsApp:** mais curto (15 a 30 s), fecha sempre chamando no WhatsApp, nunca usa enquete (no Status ninguém comenta). Sem os botões do Reels por cima: a legenda pode ficar mais baixa.

## Estilo (direção opcional; "livre" = você decide)

- **dinamico:** cortes rápidos, muito movimento, energia de Reels viral.
- **mercado:** cara de encarte animado: preço grande, amarelo e vermelho, explosões e selos de oferta.
- **premium:** calmo e elegante: fundo escuro ou neutro, tipografia fina, movimentos lentos, muito respiro.
- **informativo:** claro e didático: tópicos numerados, ícones simples, texto de apoio legível.
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `node --test tests/content-central-video.test.js tests/content-central-video-jobs.test.js tests/content-central-video-server.test.js`
Expected: PASS, with every earlier test still green. An earlier test that asserted the old error text `'Objetivo deve ser alcance ou anúncio.'` must be updated to the new text.

- [ ] **Step 7: Lint**

Run: `npx eslint src/content-central-video.js src/content-central-video-jobs.js tests/content-central-video.test.js tests/content-central-video-jobs.test.js`
Expected: no issues.

---

### Task 2: UI base (objectives, format, style, auto duration, locutor with sample)

**Files:**
- Modify: `content-central-app/src/api/client.ts` (`VideoBriefing`, about :1920)
- Modify: `content-central-app/src/pages/workspace/VideoAnimado.tsx` (constants :38-51, `NovoVideo` :216-351, the list chip :185, the detail chips :420)
- Modify: `content-central-app/src/pages/workspace/VideoAnimado.module.css` (reuse the existing classes; add only `.options5` and `.chipsRow` if needed)
- Modify: `content-central-app/src/pages/workspace/VideoAnimado.test.tsx`
- Create: `content-central-app/public/video-vozes/locutor.mp3`

**Interfaces:**
- **Produces** these types in `client.ts`:

```ts
export type VideoObjetivo = "alcance" | "anuncio" | "oferta" | "institucional" | "aviso";
export interface VideoOfertaInput { produtos: Array<{ id: string; foto?: "recorte" | "moldura" }>; validoAte: string; criacao: "nova" | "padrao" }
export interface VideoOfertaSnapshot { produtos: Array<{ id: string; nome: string; preco: number; precoDe: number | null; unidade: string; fotoOrigem: string; fotoTipo: "transparente" | "recorte" | "moldura" }>; validoAte: string; criacao: "nova" | "padrao"; precosEm: string }
export interface VideoBriefing {
  assunto: string; objetivo: VideoObjetivo; formato?: "reels" | "status"; estilo?: "livre" | "dinamico" | "mercado" | "premium" | "informativo";
  duracao: 15 | 30 | 45 | 60 | "auto"; tom: "criador" | "vendedor" | "locutor";
  legenda: "simples" | "karaoke" | "pop" | "destaque" | "caixa" | "do-video" | "sem"; observacao?: string;
  oferta?: VideoOfertaInput | VideoOfertaSnapshot;
}
```

- **Produces** `nomeObjetivo(o)`, which covers all five objectives.
- **Consumes:** the server values in Global Constraints.

- [ ] **Step 1: Write failing tests** (append to `VideoAnimado.test.tsx`; reuse its helpers `project`, `renderPage`, the fetch stubs and the media stubs)

```tsx
it("offers the five objectives, the format, auto duration, three voices and the style", async () => {
  // open the form the same way the existing creation test does
  const objetivo = screen.getByRole("radiogroup", { name: "Objetivo" });
  for (const n of ["Alcance", "Anúncio", "Oferta", "Institucional", "Aviso"]) expect(within(objetivo).getByRole("radio", { name: n })).toBeInTheDocument();
  expect(within(screen.getByRole("radiogroup", { name: "Formato" })).getByRole("radio", { name: "Story/Status" })).toBeInTheDocument();
  expect(within(screen.getByRole("radiogroup", { name: "Duração" })).getByRole("radio", { name: "Automático" })).toBeInTheDocument();
  expect(within(screen.getByRole("radiogroup", { name: "Voz" })).getByRole("radio", { name: "Locutor de VT" })).toBeInTheDocument();
  expect(within(screen.getByRole("radiogroup", { name: "Estilo" })).getByRole("radio", { name: "Livre" })).toBeChecked();
});

it("choosing Oferta preselects the locutor voice, and leaving it restores the creator", async () => {
  await user.click(screen.getByRole("radio", { name: "Oferta" }));
  expect(screen.getByRole("radio", { name: "Locutor de VT" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Alcance" }));
  expect(screen.getByRole("radio", { name: "Criador de conteúdo" })).toBeChecked();
});

it("posts formato, estilo and duracao auto", async () => {
  // fill assunto, click "Story/Status", "Automático", "Premium", then "Gerar roteiro";
  // assert the POST body contains { formato: "status", duracao: "auto", estilo: "premium" }
});
```

The third test follows the existing creation test's pattern: fill the subject, click the options, submit, then read the captured POST body.

- [ ] **Step 2: Run and confirm they fail**

Run: `cd content-central-app && npx vitest run src/pages/workspace/VideoAnimado.test.tsx`
Expected: FAIL (there is no "Oferta" radio).

- [ ] **Step 3: Implement**

In `client.ts`, replace the `VideoBriefing` line with the types listed under Interfaces.

In `VideoAnimado.tsx`, replace `OBJETIVOS`, `TONS` and `nomeObjetivo`, and add `FORMATOS`/`ESTILOS`:

```tsx
const OBJETIVOS = [
  { v: "alcance", nome: "Alcance", ajuda: "Ganhar seguidores · fecha com enquete ou “salva e compartilha”", ideal: [20, 45] },
  { v: "anuncio", nome: "Anúncio", ajuda: "Converter no WhatsApp · fecha com chamada direta", ideal: [15, 30] },
  { v: "oferta", nome: "Oferta", ajuda: "VT de mercado com vários produtos e preços", ideal: [15, 60] },
  { v: "institucional", nome: "Institucional", ajuda: "Apresenta a empresa · fecha com a marca", ideal: [20, 45] },
  { v: "aviso", nome: "Aviso", ajuda: "Feriado, horário, novidade · curto e direto", ideal: [15, 15] },
] as const;
const TONS = [
  { v: "criador", nome: "Criador de conteúdo", curto: "Criador", ajuda: "Animado, sorrindo" },
  { v: "vendedor", nome: "Vendedor de bairro", curto: "Vendedor", ajuda: "Próximo, confiante" },
  { v: "locutor", nome: "Locutor de VT", curto: "Locutor", ajuda: "Propaganda de mercado, energia lá em cima" },
] as const;
const FORMATOS = [
  { v: "reels", nome: "Reels", ajuda: "Feed e Reels do Instagram" },
  { v: "status", nome: "Story/Status", ajuda: "Mais curto, fecha no WhatsApp" },
] as const;
const ESTILOS = [
  { v: "livre", nome: "Livre" }, { v: "dinamico", nome: "🔥 Dinâmico" }, { v: "mercado", nome: "🛒 Promoção de mercado" },
  { v: "premium", nome: "✨ Premium" }, { v: "informativo", nome: "📰 Informativo" },
] as const;
const NOMES_OBJETIVO: Record<string, string> = { alcance: "Alcance", anuncio: "Anúncio", oferta: "Oferta", institucional: "Institucional", aviso: "Aviso" };
const nomeObjetivo = (o: string) => NOMES_OBJETIVO[o] || o;
const nomeDuracao = (d: number | "auto") => (d === "auto" ? "Automático" : `${d}s`);
```

`ESTILOS` radios use an accessible name without the emoji. Write `aria-label={e.nome.replace(/^\S+\s/, "")}` for every entry except Livre, which has no emoji, so the names are "Dinâmico", "Promoção de mercado", "Premium" and "Informativo".

In `NovoVideo`:
- Initial state: `{ assunto: "", objetivo: "alcance", formato: "reels", estilo: "livre", duracao: 30, tom: "criador", legenda: "do-video", observacao: "" }`.
- An objective change also sets the tone:

```tsx
function escolherObjetivo(v: VideoBriefing["objetivo"]) {
  setB((prev) => ({ ...prev, objetivo: v, tom: v === "oferta" ? "locutor" : prev.tom === "locutor" ? "criador" : prev.tom }));
}
```

Render order:
1. Assunto
2. Objetivo (5 cards, `className={styles.options5}`)
3. Formato (2 cards, a radiogroup labelled "Formato")
4. Duração: the segmented 15/30/45/60 plus an `Automático ✨` segment, whose radio has `aria-label="Automático"`.
5. Voz: 3 cards, each keeping its sample button.
6. Estilo: chips in a radiogroup labelled "Estilo".
7. Legenda
8. Observação

The section numbers follow that order. Give the radiogroups `aria-labelledby` pointing at the `Secao` heading ids, as today, so their names are "Objetivo", "Formato", "Duração", "Voz" and "Estilo".

The hint for the auto duration: `Automático: o roteiro escolhe o tempo pelo conteúdo.` and `foraDoIdeal = b.duracao !== "auto" && (…)`.

The summary: `[objetivo.nome, nomeDuracao(b.duracao), FORMATOS.find(...)!.nome, TONS.find(...)!.curto, legenda]`.

In the list card (:185) and the detail chips (:420), show `nomeDuracao(v.duracao)` where they show `${v.duracao}s`, because `VideoSummary.duracao` can now be `"auto"`. Type it as `number | "auto"` in `client.ts`.

- [ ] **Step 4: Make the voice sample**

Generate the locutor sample from the worktree root. `tts.py` finds the Gemini key in the nearest `.env` up the tree.

```bash
S=$(mktemp -d)
cat > "$S/roteiro.json" <<'EOF'
{ "voz": "gemini:Puck", "velocidade": "+6%",
  "direcao": "Leia em português do Brasil, como locutor de comercial de supermercado na TV e no rádio: muita energia, sorriso na voz, ritmo rápido, ênfase forte nos nomes dos produtos e nos preços, como quem anuncia uma oferta imperdível. Leia exatamente o texto abaixo, sem acrescentar nada:",
  "cenas": [{ "tipo": "a", "fala": "Olha só que oferta! Fralda IsaBaby, de dezesseis e noventa e nove por apenas treze e noventa e nove! Corre, que é só até domingo!", "descricao": "x" }] }
EOF
python src/video-motor/tts.py "$S"
ffmpeg -v error -y -i "$S/voz/narracao.mp3" -t 10 -ac 1 -b:a 64k content-central-app/public/video-vozes/locutor.mp3
```

Expected: `ok 1 cenas, …` printed, and `locutor.mp3` around 80 KB.

If the output says the voice used was `en-US-BrianMultilingualNeural`, then both Gemini calls failed. Report it as a concern rather than shipping the Brian sample.

- [ ] **Step 5: Run the tests and the build**

Run: `cd content-central-app && npx vitest run src/pages/workspace/VideoAnimado.test.tsx && npx vitest run && npm run build`
Expected: all pass, and the build is OK.

---

### Task 3: Products module (prices, listing, snapshot, photos, placeholders)

**Files:**
- Create: `src/content-central-video-produtos.js`
- Test: `tests/content-central-video-produtos.test.js`

**Interfaces:**
- **Consumes:**
  - `getCentralPaths(targetDir, projectId).projectDir` from `./content-central.js`;
  - Jimp v1 (`Jimp.read`, `image.bitmap`, `image.crop({x,y,w,h})`, `await image.write(path)`).
- **Produces** these exports:
  - `MAX_PRODUTOS = 10`, `PRODUTOS_POR_DURACAO`, `SEGUNDOS_POR_PRODUTO = 4`
  - `parsePreco(text) -> number|null` (cents)
  - `precoPorExtenso(cents) -> string`
  - `precoNaTela(cents) -> "R$ 13,99"`
  - `classificarFoto(absPath) -> Promise<'transparente'|'branco'|'fundo'>`
  - `recortarFundoBranco(srcAbs, dstAbs) -> Promise<void>`
  - `listarProdutosVideo(project, targetDir) -> Promise<Produto[]>`, where `Produto = { id, nome, preco, precoDe, precoTela, precoDeTela, unidade, validoAte, previewUrl, foto, fotoTipo, motivo }`
    - `foto` is project-relative.
    - `fotoTipo` is null when `motivo` is set.
    - `motivo` is `'sem preço'|'preço inválido'|'sem foto'|null`.
  - `normalizeOferta(input, disponiveis, duracao) -> { produtos: Snapshot[], validoAte, criacao, precosEm }`
    - `Snapshot = { id, nome, preco, precoDe, unidade, fotoOrigem, fotoTipo: 'transparente'|'recorte'|'moldura' }`
  - `validateRoteiroOferta(roteiro, oferta) -> string[]` (errors)
  - `expandirRoteiro(roteiro, oferta) -> roteiro`
  - `precosMantidos(cenas, oferta) -> string[]` (errors)
  - `legendaPostOferta(oferta, loja) -> string`
  - `validadePorExtenso(iso) -> "domingo, dia 19"`

- [ ] **Step 1: Write failing tests** in `tests/content-central-video-produtos.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Jimp } from 'jimp';
import {
  parsePreco, precoPorExtenso, precoNaTela, classificarFoto, recortarFundoBranco, listarProdutosVideo, normalizeOferta,
  validateRoteiroOferta, expandirRoteiro, precosMantidos, legendaPostOferta, validadePorExtenso, PRODUTOS_POR_DURACAO,
} from '../src/content-central-video-produtos.js';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'video-produtos-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

// A 40x40 image: background color everywhere, a dark 20x20 square in the middle.
async function imagem(path, fundo) {
  const im = new Jimp({ width: 40, height: 40, color: fundo });
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) im.setPixelColor(0x202020ff, x, y);
  await im.write(path);
}

test('parsePreco reads Brazilian prices into cents', () => {
  assert.equal(parsePreco('R$ 13,99'), 1399);
  assert.equal(parsePreco('4,49'), 449);
  assert.equal(parsePreco('R$ 1.234,50'), 123450);
  assert.equal(parsePreco('R$ 10'), 1000);
  for (const bad of ['R297', '', null, 'grátis', '13,9']) assert.equal(parsePreco(bad), null, String(bad));
});

test('precoPorExtenso speaks prices the way a VT does', () => {
  assert.equal(precoPorExtenso(1399), 'treze e noventa e nove');
  assert.equal(precoPorExtenso(99), 'noventa e nove centavos');
  assert.equal(precoPorExtenso(29700), 'duzentos e noventa e sete reais');
  assert.equal(precoPorExtenso(123450), 'mil duzentos e trinta e quatro e cinquenta');
  assert.equal(precoPorExtenso(100), 'um real');
  assert.equal(precoPorExtenso(449), 'quatro e quarenta e nove');
  assert.equal(precoPorExtenso(10000), 'cem reais');
  assert.equal(precoPorExtenso(110050), 'mil e cem e cinquenta');
});

test('precoNaTela formats with thousands and two decimals', () => {
  assert.equal(precoNaTela(1399), 'R$ 13,99');
  assert.equal(precoNaTela(123450), 'R$ 1.234,50');
  assert.equal(precoNaTela(99), 'R$ 0,99');
});

test('classificarFoto tells transparent, white and real backgrounds apart', async () => {
  await withDir(async (dir) => {
    await imagem(join(dir, 'b.png'), 0xffffffff);
    await imagem(join(dir, 't.png'), 0x00000000);
    await imagem(join(dir, 'f.png'), 0x3366aaff);
    assert.equal(await classificarFoto(join(dir, 'b.png')), 'branco');
    assert.equal(await classificarFoto(join(dir, 't.png')), 'transparente');
    assert.equal(await classificarFoto(join(dir, 'f.png')), 'fundo');
  });
});

test('recortarFundoBranco clears the white around the product, keeps the product and crops', async () => {
  await withDir(async (dir) => {
    await imagem(join(dir, 'b.png'), 0xffffffff);
    await recortarFundoBranco(join(dir, 'b.png'), join(dir, 'out.png'));
    const out = await Jimp.read(join(dir, 'out.png'));
    assert.ok(out.bitmap.width <= 22 && out.bitmap.width >= 20, `width ${out.bitmap.width}`);
    const centro = out.getPixelColor(Math.floor(out.bitmap.width / 2), Math.floor(out.bitmap.height / 2));
    assert.equal(centro & 0xff, 0xff, 'center stays opaque');
  });
});

function projeto(dir, offers, assets) {
  return { projectId: 'p', contentStrategy: { offers }, offerAssets: assets };
}

test('listarProdutosVideo marks unusable offers with the reason', async () => {
  await withDir(async (dir) => {
    const proj = join(dir, '_opensquad', 'content-central', 'projects', 'p');
    await mkdir(join(proj, 'assets', 'references'), { recursive: true });
    await imagem(join(proj, 'assets', 'references', 'a.png'), 0xffffffff);
    const assets = [{ id: 'fa', relativePath: 'assets/references/a.png', previewUrl: '/x/a.png' }];
    const offers = [
      { id: 'ok', name: 'Fralda', type: 'offer', price: 'R$ 13,99', originalPrice: 'R$ 16,99', priceUnit: 'un', validUntil: '2026-10-19', photoReferenceIds: ['fa'] },
      { id: 'semp', name: 'Sem preço', type: 'offer', price: '', photoReferenceIds: ['fa'] },
      { id: 'inv', name: 'Inválido', type: 'offer', price: 'R297', photoReferenceIds: ['fa'] },
      { id: 'semf', name: 'Sem foto', type: 'offer', price: 'R$ 2,00', photoReferenceIds: [] },
      { id: 'inst', name: 'Institucional', type: 'institutional', price: '' },
      { id: 'off', name: 'Desligada', type: 'offer', price: 'R$ 1,00', active: false, photoReferenceIds: ['fa'] },
    ];
    const lista = await listarProdutosVideo(projeto(dir, offers, assets), dir);
    assert.deepEqual(lista.map((p) => [p.id, p.motivo]), [['ok', null], ['semp', 'sem preço'], ['inv', 'preço inválido'], ['semf', 'sem foto']]);
    const ok = lista[0];
    assert.deepEqual([ok.preco, ok.precoDe, ok.precoTela, ok.precoDeTela, ok.fotoTipo, ok.foto, ok.validoAte], [1399, 1699, 'R$ 13,99', 'R$ 16,99', 'branco', 'assets/references/a.png', '2026-10-19']);
  });
});

const disponiveis = [
  { id: 'a', nome: 'Fralda', preco: 1399, precoDe: 1699, unidade: 'un', foto: 'r/a.png', fotoTipo: 'branco', motivo: null },
  { id: 'b', nome: 'Café', preco: 1299, precoDe: null, unidade: '', foto: 'r/b.jpg', fotoTipo: 'fundo', motivo: null },
  { id: 'c', nome: 'Galão', preco: 1099, precoDe: null, unidade: 'un', foto: 'r/c.png', fotoTipo: 'transparente', motivo: null },
  { id: 'x', nome: 'Ruim', preco: null, precoDe: null, unidade: '', foto: null, fotoTipo: null, motivo: 'preço inválido' },
];

test('normalizeOferta snapshots products and enforces the limits', () => {
  const o = normalizeOferta({ produtos: [{ id: 'a', foto: 'moldura' }, { id: 'b', foto: 'recorte' }, { id: 'c' }], validoAte: '2026-10-19', criacao: 'padrao' }, disponiveis, 30);
  assert.deepEqual(o.produtos.map((p) => [p.id, p.fotoTipo, p.fotoOrigem]), [['a', 'moldura'], ['b', 'moldura'], ['c', 'transparente']].map(([id, t]) => [id, t, `r/${id}.${id === 'b' ? 'jpg' : 'png'}`]));
  assert.equal(o.criacao, 'padrao');
  assert.match(o.precosEm, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(normalizeOferta({ produtos: [{ id: 'a' }] }, disponiveis, 'auto').produtos[0].fotoTipo, 'recorte');
  const erro = (input, dur, re) => assert.throws(() => normalizeOferta(input, disponiveis, dur), (e) => e.status === 400 && re.test(e.message));
  erro({ produtos: [] }, 30, /pelo menos um/);
  erro({ produtos: [{ id: 'zz' }] }, 30, /não encontrado/);
  erro({ produtos: [{ id: 'x' }] }, 30, /preço inválido/);
  erro({ produtos: [{ id: 'a' }, { id: 'a' }] }, 30, /duas vezes/);
  erro({ produtos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, 15, /cabe até 2/);
  assert.equal(PRODUTOS_POR_DURACAO[60], 10);
});

const oferta = { produtos: [{ id: 'a', nome: 'Fralda', preco: 1399, precoDe: 1699, unidade: 'un' }, { id: 'b', nome: 'Café', preco: 1299, precoDe: null, unidade: '' }], validoAte: '2026-10-18', criacao: 'nova' };

test('validateRoteiroOferta checks every product, placeholder and digit', () => {
  const ok = { cenas: [
    { tipo: 'abre', fala: 'Olha só as ofertas!' },
    { tipo: 'p', produto: 'a', fala: 'Fralda IsaBaby, de {precoDe} por {preco}!' },
    { tipo: 'p', produto: 'b', fala: 'Café Mapagi’s por {preco}!' },
    { tipo: 'fim', fala: 'Só até {validade}!' },
  ] };
  assert.deepEqual(validateRoteiroOferta(ok, oferta), []);
  const ruim = { cenas: [
    { tipo: 'p', produto: 'a', fala: 'Fralda por 13,99 e {brinde}' },
    { tipo: 'p', produto: 'b', fala: 'Café de {precoDe} por {preco}' },
    { tipo: 'p', produto: 'zz', fala: 'Outro {preco}' },
    { tipo: 'fim', fala: 'Corre {preco}' },
  ] };
  const erros = validateRoteiroOferta(ruim, oferta).join(' | ');
  for (const re of [/dígitos|número/, /\{brinde\}/, /Café não tem preço "de"/, /produto desconhecido "zz"/, /\{preco\} fora de uma cena de produto/, /Falta a cena de Fralda/]) assert.match(erros, re);
});

test('VT padrão requires abertura, one produto per product in order, fechamento', () => {
  const padrao = { ...oferta, criacao: 'padrao' };
  const bom = { cenas: [
    { tipo: 'abertura', fala: 'Ofertas da semana!' },
    { tipo: 'produto', produto: 'a', fala: 'Fralda por {preco}!' },
    { tipo: 'produto', produto: 'b', fala: 'Café por {preco}!' },
    { tipo: 'fechamento', fala: 'Corre pra cá!' },
  ] };
  assert.deepEqual(validateRoteiroOferta(bom, padrao), []);
  const fora = { cenas: [bom.cenas[0], bom.cenas[2], bom.cenas[1], bom.cenas[3]] };
  assert.match(validateRoteiroOferta(fora, padrao).join(' '), /VT padrão/);
});

test('expandirRoteiro speaks prices and the validity; precosMantidos guards edits', () => {
  const r = expandirRoteiro({ cenas: [
    { tipo: 'p', produto: 'a', fala: 'Fralda de {precoDe} por {preco}, {unidade}!' },
    { tipo: 'fim', fala: 'Só até {validade}!' },
  ] }, oferta);
  assert.equal(r.cenas[0].fala, 'Fralda de dezesseis e noventa e nove por treze e noventa e nove, a unidade!');
  assert.equal(r.cenas[1].fala, `Só até ${validadePorExtenso('2026-10-18')}!`);
  assert.equal(validadePorExtenso('2026-10-18'), 'domingo, dia 18');
  assert.deepEqual(precosMantidos(r.cenas, { ...oferta, produtos: [oferta.produtos[0]] }), []);
  const editada = [{ ...r.cenas[0], fala: 'Fralda baratinha!' }];
  assert.match(precosMantidos(editada, { ...oferta, produtos: [oferta.produtos[0]] }).join(' '), /Fralda.*treze e noventa e nove/);
});

test('legendaPostOferta lists products with screen prices', () => {
  const txt = legendaPostOferta(oferta, { nome: 'Mercado Carvalho', endereco: 'Rua 58, 19', whatsapp: '65 99311-8774' });
  assert.match(txt, /Fralda: de R\$ 16,99 por R\$ 13,99/);
  assert.match(txt, /Café: R\$ 12,99/);
  assert.match(txt, /18\/10/);
  assert.match(txt, /Rua 58, 19/);
  assert.match(txt, /#ofertas/);
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `node --test tests/content-central-video-produtos.test.js`
Expected: FAIL (the module is missing).

- [ ] **Step 3: Implement `src/content-central-video-produtos.js`**

```js
// Products for Oferta videos: prices (parsed, spoken, on screen), the
// product listing and per-video snapshot, product photos (classification and
// white-background cutout) and the narration placeholders that keep prices
// out of Claude's hands.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Jimp } from 'jimp';
import { getCentralPaths } from './content-central.js';

export const MAX_PRODUTOS = 10;
export const PRODUTOS_POR_DURACAO = { 15: 2, 30: 5, 45: 8, 60: 10 };
// ponytail: one number for every product; tune after the operator watches real VTs.
export const SEGUNDOS_POR_PRODUTO = 4;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function parsePreco(text) {
  const s = String(text ?? '').replace(/^\s*R\$\s*/i, '').trim();
  const m = s.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?$/);
  return m ? Number(m[1].replace(/\./g, '')) * 100 + Number(m[2] || 0) : null;
}

const UNIDADES_FALA = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(r < 20 ? UNIDADES_FALA[r] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES_FALA[r % 10]}` : ''));
  return partes.join(' e ');
}

function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes = [];
  if (mil) partes.push(mil === 1 ? 'mil' : `${ate999(mil)} mil`);
  if (resto) partes.push(ate999(resto));
  // "mil e cem", "mil e vinte", but "mil duzentos e trinta e quatro".
  return partes.join(mil && resto && (resto < 100 || resto % 100 === 0) ? ' e ' : ' ');
}

// VT convention: "treze e noventa e nove"; "reais" only for whole amounts.
export function precoPorExtenso(centavos) {
  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  if (!reais) return `${inteiroPorExtenso(cents)} centavos`;
  if (!cents) return `${inteiroPorExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`;
  return `${inteiroPorExtenso(reais)} e ${inteiroPorExtenso(cents)}`;
}

export function precoNaTela(centavos) {
  const reais = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${reais},${String(centavos % 100).padStart(2, '0')}`;
}

// Looks at the four corners: alpha means a cutout, near-white means a studio shot.
export async function classificarFoto(path) {
  const { bitmap } = await Jimp.read(path);
  const { width: w, height: h, data } = bitmap;
  const cantos = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => (Math.max(0, y) * w + Math.max(0, x)) * 4);
  if (cantos.some((i) => data[i + 3] < 20)) return 'transparente';
  if (cantos.every((i) => Math.min(data[i], data[i + 1], data[i + 2]) > 235)) return 'branco';
  return 'fundo';
}

// Flood-fills near-white from the borders only, so white inside the product
// (labels, packaging) stays; softens the 1px rim and crops to the product.
export async function recortarFundoBranco(src, dst) {
  const im = await Jimp.read(src);
  const { width: w, height: h, data } = im.bitmap;
  const branco = (k) => {
    const i = k * 4;
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    return data[i + 3] > 0 && min >= 232 && Math.max(data[i], data[i + 1], data[i + 2]) - min <= 18;
  };
  const fora = new Uint8Array(w * h);
  const pilha = [];
  for (let x = 0; x < w; x++) pilha.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) pilha.push(y * w, y * w + w - 1);
  while (pilha.length) {
    const k = pilha.pop();
    if (fora[k] || !branco(k)) continue;
    fora[k] = 1;
    const x = k % w;
    if (x > 0) pilha.push(k - 1);
    if (x < w - 1) pilha.push(k + 1);
    if (k >= w) pilha.push(k - w);
    if (k < w * (h - 1)) pilha.push(k + w);
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let k = 0; k < w * h; k++) {
    const x = k % w;
    const y = (k - x) / w;
    if (fora[k]) { data[k * 4 + 3] = 0; continue; }
    const borda = (x > 0 && fora[k - 1]) || (x < w - 1 && fora[k + 1]) || (y > 0 && fora[k - w]) || (y < h - 1 && fora[k + w]);
    if (borda) data[k * 4 + 3] = Math.min(data[k * 4 + 3], 170);
    if (data[k * 4 + 3] > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  if (x1 >= x0) im.crop({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  await im.write(dst);
}

// Every active registered offer, with why it can't go in a video (if so).
export async function listarProdutosVideo(project, targetDir) {
  const base = getCentralPaths(targetDir, project.projectId).projectDir;
  const assets = new Map((project.offerAssets || []).map((a) => [a.id, a]));
  const out = [];
  for (const o of project.contentStrategy?.offers || []) {
    if (o.active === false || (o.type && o.type !== 'offer')) continue;
    const preco = parsePreco(o.price);
    const de = parsePreco(o.originalPrice);
    const asset = (o.photoReferenceIds || []).map((id) => assets.get(id)).find((a) => a?.relativePath && existsSync(join(base, a.relativePath)));
    const motivo = !String(o.price || '').trim() ? 'sem preço' : preco == null ? 'preço inválido' : !asset ? 'sem foto' : null;
    const precoDe = preco != null && de != null && de > preco ? de : null;
    out.push({
      id: o.id, nome: o.name, preco, precoDe,
      precoTela: preco != null ? precoNaTela(preco) : '', precoDeTela: precoDe ? precoNaTela(precoDe) : '',
      unidade: o.priceUnit || '', validoAte: o.validUntil || '', previewUrl: asset?.previewUrl || '',
      foto: asset?.relativePath || null,
      fotoTipo: motivo ? null : await classificarFoto(join(base, asset.relativePath)),
      motivo,
    });
  }
  return out;
}

export function normalizeOferta(input, disponiveis, duracao) {
  const lista = Array.isArray(input?.produtos) ? input.produtos : [];
  if (!lista.length) throw httpError(400, 'Escolha pelo menos um produto.');
  if (lista.length > MAX_PRODUTOS) throw httpError(400, `No máximo ${MAX_PRODUTOS} produtos por vídeo.`);
  if (duracao !== 'auto' && lista.length > PRODUTOS_POR_DURACAO[duracao]) throw httpError(400, `${duracao}s cabe até ${PRODUTOS_POR_DURACAO[duracao]} produtos.`);
  const porId = new Map(disponiveis.map((p) => [p.id, p]));
  const vistos = new Set();
  const produtos = lista.map((item) => {
    const p = porId.get(String(item?.id));
    if (!p) throw httpError(400, `Produto não encontrado: ${item?.id}`);
    if (p.motivo) throw httpError(400, `${p.nome}: ${p.motivo}.`);
    if (vistos.has(p.id)) throw httpError(400, `${p.nome} foi escolhido duas vezes.`);
    vistos.add(p.id);
    // A real background is never faked as a cutout; white backgrounds follow the operator's toggle.
    const fotoTipo = p.fotoTipo === 'transparente' ? 'transparente' : p.fotoTipo === 'fundo' || item.foto === 'moldura' ? 'moldura' : 'recorte';
    return { id: p.id, nome: p.nome, preco: p.preco, precoDe: p.precoDe, unidade: p.unidade, fotoOrigem: p.foto, fotoTipo };
  });
  return {
    produtos,
    validoAte: /^\d{4}-\d{2}-\d{2}$/.test(String(input?.validoAte || '')) ? input.validoAte : '',
    criacao: input?.criacao === 'padrao' ? 'padrao' : 'nova',
    precosEm: new Date().toISOString().slice(0, 10),
  };
}

const MARCADOR = /\{(\w+)\}/g;
const PERMITIDOS = new Set(['preco', 'precoDe', 'unidade', 'validade']);
const cenasDe = (roteiro) => (Array.isArray(roteiro?.cenas) ? roteiro.cenas : []).filter((c) => c && typeof c === 'object');

export function validateRoteiroOferta(roteiro, oferta) {
  const erros = [];
  const cenas = cenasDe(roteiro);
  const porId = new Map(oferta.produtos.map((p) => [p.id, p]));
  cenas.forEach((c, i) => {
    const fala = String(c.fala || '');
    const p = c.produto != null ? porId.get(String(c.produto)) : null;
    if (c.produto != null && !p) erros.push(`Cena ${i + 1}: produto desconhecido "${c.produto}".`);
    if (/\d/.test(fala)) erros.push(`Cena ${i + 1}: sem dígitos na fala; use {preco} para preços e escreva o resto por extenso (número).`);
    for (const [, nome] of fala.matchAll(MARCADOR)) {
      if (!PERMITIDOS.has(nome)) erros.push(`Cena ${i + 1}: marcador desconhecido {${nome}}.`);
      else if (nome === 'validade') { if (!oferta.validoAte) erros.push(`Cena ${i + 1}: {validade} sem data de validade.`); }
      else if (!p) erros.push(`Cena ${i + 1}: {${nome}} fora de uma cena de produto.`);
      else if (nome === 'precoDe' && !p.precoDe) erros.push(`Cena ${i + 1}: ${p.nome} não tem preço "de".`);
    }
  });
  for (const p of oferta.produtos) {
    if (!cenas.some((c) => String(c.produto) === p.id && /\{preco\}/.test(String(c.fala || '')))) erros.push(`Falta a cena de ${p.nome} com {preco}.`);
  }
  if (oferta.criacao === 'padrao') {
    const esperado = ['abertura', ...oferta.produtos.map((p) => `produto:${p.id}`), 'fechamento'];
    const atual = cenas.map((c) => (c.tipo === 'produto' ? `produto:${c.produto}` : c.tipo));
    if (JSON.stringify(atual) !== JSON.stringify(esperado)) erros.push(`VT padrão: as cenas devem ser ${esperado.join(', ')}.`);
  }
  return erros;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export function validadePorExtenso(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${DIAS[d.getDay()]}, dia ${d.getDate()}`;
}

const UNIDADE_FALA = { kg: 'o quilo', g: 'a grama', '100g': 'os cem gramas', un: 'a unidade', pacote: 'o pacote' };

function expandirFala(fala, produto, validoAte) {
  return String(fala).replace(MARCADOR, (m, nome) => {
    if (nome === 'validade') return validoAte ? validadePorExtenso(validoAte) : m;
    if (!produto) return m;
    if (nome === 'preco') return precoPorExtenso(produto.preco);
    if (nome === 'precoDe') return produto.precoDe ? precoPorExtenso(produto.precoDe) : m;
    if (nome === 'unidade') return UNIDADE_FALA[produto.unidade] || produto.unidade || '';
    return m;
  });
}

export function expandirRoteiro(roteiro, oferta) {
  const porId = new Map(oferta.produtos.map((p) => [p.id, p]));
  return { ...roteiro, cenas: cenasDe(roteiro).map((c) => ({ ...c, fala: expandirFala(c.fala, porId.get(String(c.produto)), oferta.validoAte) })) };
}

// The review screen edits spoken text: every product scene must still say its price.
export function precosMantidos(cenas, oferta) {
  return oferta.produtos.flatMap((p) => {
    const falado = precoPorExtenso(p.preco);
    return cenasDe({ cenas }).some((c) => String(c.produto) === p.id && String(c.fala || '').includes(falado))
      ? [] : [`A fala de ${p.nome} precisa manter o preço "${falado}".`];
  });
}

export function legendaPostOferta(oferta, loja = {}) {
  const linhas = oferta.produtos.map((p) => `• ${p.nome}: ${p.precoDe ? `de ${precoNaTela(p.precoDe)} por ` : ''}${precoNaTela(p.preco)}`);
  const [, mes, dia] = (oferta.validoAte || '').split('-');
  return [
    `🛒 Ofertas${loja.nome ? ` no ${loja.nome}` : ''}!`, '', ...linhas, '',
    ...(oferta.validoAte ? [`Válido até ${dia}/${mes} ou enquanto durarem os estoques.`] : []),
    ...(loja.endereco ? [`📍 ${loja.endereco}`] : []),
    ...(loja.whatsapp ? [`📲 WhatsApp: ${loja.whatsapp}`] : []),
    '', '#ofertas #promoção #mercado #economia',
  ].join('\n');
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `node --test tests/content-central-video-produtos.test.js`
Expected: PASS.

If the `precoPorExtenso(110050)` assertion (`'mil e cem e cinquenta'`) fails, fix the join rule in `inteiroPorExtenso`, not the test.

- [ ] **Step 5: Lint**

Run: `npx eslint src/content-central-video-produtos.js tests/content-central-video-produtos.test.js`

---

### Task 4: Oferta in the backend (briefing, folder, stage 1, review, player, prompts, route)

**Files:**
- Modify: `src/content-central-video.js` (`normalizeBriefing` Oferta branch, `createVideo`, `saveRoteiroCenas`, `readVideoState`)
- Modify: `src/content-central-video-jobs.js` (`prepareFolder`, `duracaoTexto`, `stagePrompt`, `etapaRoteiro`)
- Modify: `src/content-central-server.js` (the videos block at :922; add `GET .../videos/produtos` before the `parts.length === 5` GET)
- Modify: `src/video-motor/player.html` (`window.ready`, :211-216)
- Modify: `src/video-motor/REGRAS.md` (add § Oferta), `src/video-motor/PEDIDO-roteiro.md`, `src/video-motor/PEDIDO-producao.md`
- Test: `tests/content-central-video.test.js`, `tests/content-central-video-jobs.test.js`, `tests/content-central-video-server.test.js`

**Interfaces:**
- **Consumes:** every export of Task 3, plus Task 1's `normalizeBriefing(input, produtosDisponiveis)` and `duracaoAlvo`.
- **Produces:**
  - Video folder files, for Oferta only:
    - `produtos.json` = `{ produtos: [{ id, nome, preco, precoDe, precoTela, precoDeTela, unidade, foto: 'fotos/produto-<id>.<png|jpg>', fotoTipo }], loja: { nome, endereco, whatsapp, horario, validoAte, validade } }`;
    - `roteiro-modelo.json`.
  - `readVideoState(...)` gains `produtos: Array<{ id, nome, precoTela, precoDeTela, foto, fotoTipo }>` (an empty array when there is no Oferta).
  - `GET /api/projects/:id/videos/produtos` → `{ produtos: Produto[] }`, with the Task 3 shape minus `preco`/`precoDe` cents.
  - In the player, `window.PRODUTOS` and `window.LOJA` (defaults `[]` and `{}`).

- [ ] **Step 1: Write failing tests**

**`tests/content-central-video.test.js`.**

Add this helper. It writes one offer and one white-background asset into the test project:

```js
import { Jimp } from 'jimp';
async function comOferta(dir, projectId = 'king') {
  const paths = getCentralPaths(dir, projectId);
  await mkdir(join(paths.projectDir, 'assets', 'references'), { recursive: true });
  const im = new Jimp({ width: 40, height: 40, color: 0xffffffff });
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) im.setPixelColor(0x202020ff, x, y);
  await im.write(join(paths.projectDir, 'assets', 'references', 'fralda.png'));
  const project = JSON.parse(await readFile(paths.projectPath, 'utf8'));
  project.offerAssets = [{ id: 'f1', relativePath: 'assets/references/fralda.png', previewUrl: '/p/fralda.png' }];
  project.contentStrategy = { ...(project.contentStrategy || {}), offers: [{ id: 'fralda', name: 'Fralda IsaBaby', type: 'offer', price: 'R$ 13,99', originalPrice: 'R$ 16,99', priceUnit: 'un', photoReferenceIds: ['f1'] }] };
  await writeFile(paths.projectPath, JSON.stringify(project));
}
const ofertaBriefing = { ...briefing, objetivo: 'oferta', tom: 'locutor', oferta: { produtos: [{ id: 'fralda' }], validoAte: '2026-10-18', criacao: 'nova' } };
```

Then the tests:

```js
test('createVideo snapshots the Oferta products', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await comOferta(dir);
    const video = await createVideo('king', ofertaBriefing, dir);
    assert.deepEqual(video.briefing.oferta.produtos.map((p) => [p.id, p.preco, p.precoDe, p.fotoTipo]), [['fralda', 1399, 1699, 'recorte']]);
    await assert.rejects(createVideo('king', { ...ofertaBriefing, oferta: { produtos: [{ id: 'nao' }] } }, dir), (e) => e.status === 400);
  });
});

test('saveRoteiroCenas on an Oferta keeps the spoken prices', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await comOferta(dir);
    const video = await createVideo('king', ofertaBriefing, dir);
    await updateVideo('king', video.id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    const cenas = [{ tipo: 'p', produto: 'fralda', fala: 'Fralda por treze e noventa e nove!', descricao: 'x' }];
    await saveRoteiroCenas('king', video.id, cenas, dir);
    await assert.rejects(saveRoteiroCenas('king', video.id, [{ ...cenas[0], fala: 'Fralda baratinha!' }], dir), (e) => e.status === 400 && /treze e noventa e nove/.test(e.message));
  });
});
```

**`tests/content-central-video-jobs.test.js`.**

Copy the `comOferta` helper and `ofertaBriefing` into this file. They are kept per file because these tests don't share helpers. Then add a runner that writes an Oferta roteiro:

```js
function ofertaRunner(calls, falas) {
  let n = 0;
  return async ({ prompt, cwd }) => {
    calls.push({ prompt, cwd });
    const fala = falas[Math.min(n++, falas.length - 1)];
    await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'abre', fala: 'Olha as ofertas!', descricao: 'a' }, { tipo: 'p', produto: 'fralda', fala, descricao: 'b' }, { tipo: 'fim', fala: 'Só até {validade}, chama no WhatsApp!', descricao: 'c' }] }));
    return { text: 'ok' };
  };
}

test('Oferta stage 1 writes produtos.json, the cutout photo, the template and the expanded roteiro', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda de {precoDe} por {preco}!']), renderer: async () => ({}) });
    const video = await createVideo('king', ofertaBriefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const vdir = videoDir(dir, 'king', video.id);
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.ROTEIRO_PRONTO);
    const produtos = JSON.parse(await readFile(join(vdir, 'produtos.json'), 'utf8'));
    assert.equal(produtos.produtos[0].precoTela, 'R$ 13,99');
    assert.equal(produtos.produtos[0].foto, 'fotos/produto-fralda.png');
    assert.ok(existsSync(join(vdir, 'fotos', 'produto-fralda.png')));
    assert.match(JSON.parse(await readFile(join(vdir, 'roteiro-modelo.json'), 'utf8')).cenas[1].fala, /\{preco\}/);
    assert.equal(JSON.parse(await readFile(join(vdir, 'roteiro.json'), 'utf8')).cenas[1].fala, 'Fralda de dezesseis e noventa e nove por treze e noventa e nove!');
    assert.match(calls[0].prompt, /Oferta: 1 produto/);
  });
});

test('Oferta stage 1 retries once with the validation error, then fails', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por 13,99!', 'Fralda por 13,99!']), renderer: async () => ({}) });
    const video = await createVideo('king', ofertaBriefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.equal(calls.length, 2);
    assert.match(calls[1].prompt, /A tentativa anterior falhou com: .*dígitos/);
    const final = await readVideo('king', video.id, dir);
    assert.equal(final.status, STATUS.ERRO);
    assert.match(final.erro, /dígitos/);
  });
});

test('Oferta stage 1 retry succeeds when Claude fixes the roteiro', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: ofertaRunner(calls, ['Fralda por 13,99!', 'Fralda por {preco}!']), renderer: async () => ({}) });
    const video = await createVideo('king', ofertaBriefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.ROTEIRO_PRONTO);
  });
});
```

**`tests/content-central-video-server.test.js`.**

```js
test('GET videos/produtos lists the offers with their usable state', async () => {
  await withServer(async (dir, server) => {
    // write one valid and one invalid-price offer as in the helpers above
    const r = await call(server, '/api/projects/king/videos/produtos');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.produtos.map((p) => [p.id, p.motivo]), [['fralda', null], ['ruim', 'preço inválido']]);
    assert.equal(r.body.produtos[0].precoTela, 'R$ 13,99');
  });
});
```

Inside this test, write the offers into `project.json` before the call, following how `withServer` already edits `project.json`.

**Player check.** Add to `tests/video-motor.test.js`:

```js
test('the player exposes produtos.json as window.PRODUTOS', async () => {
  await withFixture(async (dir) => {
    await writeFile(join(dir, 'produtos.json'), JSON.stringify({ produtos: [{ id: 'a', precoTela: 'R$ 1,00' }], loja: { nome: 'X' } }));
    const cenas = (await readFile(join(dir, 'cenas.js'), 'utf8')).replace("'OLÁ'", "window.PRODUTOS[0].precoTela");
    await writeFile(join(dir, 'cenas.js'), cenas);
    await renderVideo({ videoDir: dir, stills: [0.05] });
  });
});
```

The fixture's html string is `'<div …>OLÁ</div>'`. Change the replace so it builds `` `<div …>${window.PRODUTOS[0].precoTela}</div>` ``, which proves the global exists; a missing global throws inside `html()` and fails the render.


- [ ] **Step 2: Run and confirm they fail**

Run: `node --test tests/content-central-video.test.js tests/content-central-video-jobs.test.js tests/content-central-video-server.test.js tests/video-motor.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: `src/content-central-video.js`**

```js
import { listarProdutosVideo, normalizeOferta, precosMantidos, precoNaTela } from './content-central-video-produtos.js';
```

At the end of `normalizeBriefing`, replace the Task 1 throw with:

```js
  if (objetivo === 'oferta') {
    if (!produtosDisponiveis) throw httpError(400, 'Oferta precisa dos produtos cadastrados.');
    briefing.oferta = normalizeOferta(input.oferta, produtosDisponiveis, duracao);
  }
  return briefing;
```

In `createVideo`:

```js
export async function createVideo(projectId, input, targetDir) {
  const project = await requireVideoProject(projectId, targetDir);
  const briefing = normalizeBriefing(input, input?.objetivo === 'oferta' ? await listarProdutosVideo(project, targetDir) : null);
  // …rest unchanged
```

In `saveRoteiroCenas`, after the `erros` check:

```js
  if (video.briefing.oferta) {
    const faltando = precosMantidos(limpas, video.briefing.oferta);
    if (faltando.length) throw httpError(400, faltando.join(' '));
  }
```

In `readVideoState`, add `produtos` to the returned object:

```js
  const lidos = await readJson(join(dir, 'produtos.json'), null);
  const produtos = (lidos?.produtos || []).map(({ id, nome, precoTela, precoDeTela, foto, fotoTipo }) => ({ id, nome, precoTela, precoDeTela, foto, fotoTipo }));
```

Before `prepareFolder` has run, fall back to the snapshot, so the UI shows the products during `roteiro_gerando`:

```js
  const produtosFinal = produtos.length ? produtos : (video.briefing.oferta?.produtos || []).map((p) => ({ id: p.id, nome: p.nome, precoTela: precoNaTela(p.preco), precoDeTela: p.precoDe ? precoNaTela(p.precoDe) : '', foto: '', fotoTipo: p.fotoTipo }));
```

Return `produtos: produtosFinal`.

- [ ] **Step 4: `src/content-central-video-jobs.js`**

```js
import { extname } from 'node:path';
import {
  SEGUNDOS_POR_PRODUTO, precoNaTela, precoPorExtenso, recortarFundoBranco, validateRoteiroOferta, expandirRoteiro, validadePorExtenso,
} from './content-central-video-produtos.js';
```

`join` is already imported from `node:path`; extend that import with `extname`.

Inside `prepareFolder`, after the logo copy:

```js
  const oferta = video.briefing.oferta;
  if (oferta) {
    const base = getCentralPaths(targetDir, project.projectId).projectDir;
    const produtos = [];
    for (const p of oferta.produtos) {
      const origem = join(base, p.fotoOrigem || '');
      if (!p.fotoOrigem || !existsSync(origem)) throw new Error(`A foto de ${p.nome} não foi encontrada no cadastro.`);
      const foto = `fotos/produto-${p.id}${p.fotoTipo === 'recorte' ? '.png' : extname(origem).toLowerCase()}`;
      if (p.fotoTipo === 'recorte') await recortarFundoBranco(origem, join(dir, foto));
      else await copyFile(origem, join(dir, foto));
      produtos.push({ id: p.id, nome: p.nome, preco: p.preco, precoDe: p.precoDe, precoTela: precoNaTela(p.preco), precoDeTela: p.precoDe ? precoNaTela(p.precoDe) : '', precoFalado: precoPorExtenso(p.preco), unidade: p.unidade, foto, fotoTipo: p.fotoTipo });
    }
    const empresa = project.companyProfile || {};
    await writeJson(join(dir, 'produtos.json'), {
      produtos,
      loja: { nome: marca.nome, endereco: empresa.address || '', whatsapp: marca.whatsapp, horario: resumoHorario(project.businessHours), validoAte: oferta.validoAte, validade: oferta.validoAte ? validadePorExtenso(oferta.validoAte) : '' },
    });
  }
```

Add `resumoHorario` near the top of the jobs file:

```js
const DIAS_CURTOS = { mon: 'seg', tue: 'ter', wed: 'qua', thu: 'qui', fri: 'sex', sat: 'sáb', sun: 'dom' };
// "seg a sex 08:00–18:00 · sáb 08:00–12:00": days with the same hours are grouped.
function resumoHorario(hours) {
  if (!hours || typeof hours !== 'object') return '';
  const grupos = [];
  for (const [dia, curto] of Object.entries(DIAS_CURTOS)) {
    const faixa = (hours[dia] || []).map((f) => `${f.from}–${f.to}`).join(', ');
    if (!faixa) continue;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.faixa === faixa) ultimo.ate = curto; else grupos.push({ de: curto, ate: curto, faixa });
  }
  return grupos.map((g) => `${g.de === g.ate ? g.de : `${g.de} a ${g.ate}`} ${g.faixa}`).join(' · ');
}
```

In `duracaoTexto`, before the status line:

```js
  if (b.oferta) {
    const n = b.oferta.produtos.length;
    return `automática (cerca de ${SEGUNDOS_POR_PRODUTO}s por produto × ${n} + uns 8s de abertura e fechamento ≈ ${n * SEGUNDOS_POR_PRODUTO + 8}s)`;
  }
```

In `stagePrompt`, after the Formato line:

```js
    ...(b.oferta ? [`Oferta: ${b.oferta.produtos.length} produto${b.oferta.produtos.length > 1 ? 's' : ''} em produtos.json, criação ${b.oferta.criacao === 'padrao' ? 'VT padrão' : 'nova'} (REGRAS.md § Oferta).`] : []),
```

Replace `etapaRoteiro`'s body from `await runner(...)` on:

```js
    const rodar = async (erro, desde) => {
      await runner({ prompt: `# Etapa 1
${stagePrompt('PEDIDO-roteiro.md', video, temLogo, erro)}`, cwd: dir, addDirs });
      if (!await escritoDepois(join(dir, 'roteiro.json'), desde)) throw new Error('O Claude não escreveu o roteiro.json.');
      const lido = await readJson(join(dir, 'roteiro.json'), null);
      if (!lido) throw new Error('O Claude não escreveu o roteiro.json.');
      return lido;
    };
    const oferta = video.briefing.oferta;
    let roteiro = await rodar(erroAnterior, inicio);
    // Oferta: prices only through placeholders. One automatic retry with the
    // problems spelled out, then the operator sees the error.
    if (oferta) {
      let problemas = validateRoteiroOferta(roteiro, oferta);
      if (problemas.length) {
        roteiro = await rodar(problemas.join(' '), Date.now());
        problemas = validateRoteiroOferta(roteiro, oferta);
        if (problemas.length) throw new Error(problemas.join(' '));
      }
    }
    forcarRoteiro(roteiro, video.briefing, marca);
    const { erros } = validateRoteiro(roteiro, video.briefing);
    if (erros.length) throw new Error(erros.join(' '));
    if (oferta) {
      await writeJson(join(dir, 'roteiro-modelo.json'), roteiro);
      roteiro = expandirRoteiro(roteiro, oferta);
    }
    await writeJson(join(dir, 'roteiro.json'), roteiro);
    return STATUS.ROTEIRO_PRONTO;
```

- [ ] **Step 5: Server route.** In `src/content-central-server.js`, inside the videos block, right after `const vid = parts[4];`:

```js
      if (method === 'GET' && parts.length === 5 && vid === 'produtos') {
        const project = await requireVideoProject(projectId, targetDir);
        const produtos = (await listarProdutosVideo(project, targetDir)).map(({ preco, precoDe, ...p }) => p);
        return sendJson(res, 200, { produtos });
      }
```

Import `listarProdutosVideo` from `./content-central-video-produtos.js`. The existing `await requireVideoProject` at the top of the block already returns the project, so reuse its value instead of calling it twice: change that line to `const videoProject = await requireVideoProject(projectId, targetDir);`.

- [ ] **Step 6: Player.** In `src/video-motor/player.html`'s `window.ready`, right after `R = await …roteiro.json…`:

```js
  // Oferta videos bring products and store data; on-screen prices come only from here.
  const prod = await fetch(asset('produtos.json'));
  const dados = prod.ok ? await prod.json() : {};
  window.PRODUTOS = dados.produtos || [];
  window.LOJA = dados.loja || {};
```

- [ ] **Step 7: Prompts and rules.**

Append to `REGRAS.md`:

```markdown
## Oferta (VT de mercado)

- Os produtos estão em `produtos.json` (na ordem escolhida pelo operador) e as fotos em `fotos/produto-<id>.*`. Os dados da loja (nome, endereço, WhatsApp, horário, validade) estão em `produtos.json` → `loja`.
- **Preço nunca é digitado.** Na fala, use `{preco}` (e `{precoDe}` só para produto com preço "de"); o sistema troca pelo preço por extenso do cadastro. `{unidade}` vira "a unidade", "o quilo"…; `{validade}` vira "domingo, dia 19" (só se houver validade). A fala de uma Oferta **não pode ter nenhum dígito**: escreva nomes e quantidades por extenso ("Omo de setecentos gramas").
- Cada produto tem uma cena com `"produto": "<id>"` e `{preco}` na fala. Ritmo de locutor: frases curtas e exclamações, nome do produto, preço, próximo.
- **Na tela**, preços só de `PRODUTOS[i].precoTela` e `PRODUTOS[i].precoDeTela` (risque o "de"). Nunca escreva um valor à mão no `cenas.js`.
- `fotoTipo`: `recorte` e `transparente` já vêm sem fundo (pode fazer o produto voar, girar, crescer); `moldura` é foto com fundo real: mostre dentro de um cartão ou moldura, nunca como recorte.
- Fecho: validade (se houver), endereço e WhatsApp.
- **VT padrão** (`criacao: padrao`): as cenas são exatamente `abertura`, uma `produto` por produto na ordem de `produtos.json`, e `fechamento`. O visual é o modelo fixo; escreva só as falas.
```

Append to `PEDIDO-roteiro.md`:

```markdown
**Oferta:** se o briefing tiver `oferta`, leia `produtos.json` e REGRAS.md § Oferta antes de escrever. Se existir `roteiro-modelo.json`, ele é a versão com marcadores do roteiro atual: num ajuste, parta dele e devolva `roteiro.json` também com marcadores.
```

Append to `PEDIDO-producao.md`:

```markdown
**Oferta:** `window.PRODUTOS` e `window.LOJA` já estão carregados no player (vêm de `produtos.json`). Preço na tela só de `PRODUTOS[i].precoTela`/`precoDeTela`; foto de `asset(PRODUTOS[i].foto)`; respeite o `fotoTipo` (REGRAS.md § Oferta).
```

- [ ] **Step 8: Run all the video tests and the full suite**

Run: `node --test tests/content-central-video.test.js tests/content-central-video-jobs.test.js tests/content-central-video-server.test.js tests/content-central-video-produtos.test.js tests/video-motor.test.js`, then `npm test`.
Expected: all PASS.

- [ ] **Step 9: Lint** the changed JS files with `npx eslint`.

---

### Task 5: UI for Oferta (picker, validity, creation mode, review)

**Files:**
- Modify: `content-central-app/src/api/client.ts`
- Modify: `content-central-app/src/pages/workspace/VideoAnimado.tsx`, `.module.css`, `.test.tsx`

**Interfaces:**
- **Consumes:**
  - `GET /api/projects/:id/videos/produtos` → `{ produtos: VideoProduto[] }`;
  - `VideoState.produtos`;
  - `briefing.oferta` as a `VideoOfertaSnapshot` on records.
- **Produces:**

```ts
export interface VideoProduto { id: string; nome: string; precoTela: string; precoDeTela: string; unidade: string; validoAte: string; previewUrl: string; foto: string | null; fotoTipo: "transparente" | "branco" | "fundo" | null; motivo: "sem preço" | "preço inválido" | "sem foto" | null }
export function listVideoProdutos(projectId: string): Promise<{ produtos: VideoProduto[] }> { return api(videosPath(projectId, "/produtos")); }
// VideoState gains: produtos: Array<{ id: string; nome: string; precoTela: string; precoDeTela: string; foto: string; fotoTipo: string }>
```

- [ ] **Step 1: Write failing tests** in `VideoAnimado.test.tsx`

Stub `listVideoProdutos`'s fetch with three products:
- `a`: `fotoTipo: "branco"`, `precoTela: "R$ 13,99"`, `precoDeTela: "R$ 16,99"`, `validoAte: "2026-10-19"`;
- `b`: `fotoTipo: "fundo"`, `validoAte: "2026-10-18"`;
- `x`: `motivo: "preço inválido"`.

```tsx
it("Oferta shows the product picker with reasons, the moldura note and the validity", async () => {
  await user.click(screen.getByRole("radio", { name: "Oferta" }));
  const lista = await screen.findByRole("group", { name: "Produtos" });
  expect(within(lista).getByRole("checkbox", { name: /Ruim/ })).toBeDisabled();
  expect(within(lista).getByText("preço inválido")).toBeInTheDocument();
  expect(within(lista).getByText("vai em moldura")).toBeInTheDocument();
  await user.click(within(lista).getByRole("checkbox", { name: /Fralda/ }));
  await user.click(within(lista).getByRole("checkbox", { name: /Café/ }));
  expect(screen.getByLabelText("Válido até")).toHaveValue("2026-10-18");
  expect(screen.getByRole("radio", { name: "Recortar" })).toBeChecked(); // the white-background product's toggle
});

it("blocks more products than the duration fits and posts the oferta body", async () => {
  // pick 3 products, choose 15s: the counter shows "3 de 2" and "Gerar roteiro" is disabled;
  // choose Automático: enabled; submit; the POST body has
  // oferta: { produtos: [{ id: "a", foto: "recorte" }, ...], validoAte: "2026-10-18", criacao: "nova" }
});

it("VT padrão hides the style section", async () => {
  await user.click(screen.getByRole("radio", { name: "Oferta" }));
  await user.click(screen.getByRole("radio", { name: "VT padrão" }));
  expect(screen.queryByRole("radiogroup", { name: "Estilo" })).not.toBeInTheDocument();
});

it("review shows product thumbnails and prices for product scenes, and padrão has no visual ajuste", async () => {
  // stub getVideo with status previa_pronta, briefing.oferta.criacao "padrao", produtos [{ id: "a", nome: "Fralda", precoTela: "R$ 13,99", foto: "fotos/produto-a.png" }]
  // expect the text "VT padrão: para mudar o visual, use Criação nova" and no textbox named "Pedir ajuste" in the prévia
});
```

Write the last two tests in full, using the file's existing fetch-sequence stub helpers.

- [ ] **Step 2: Run and confirm they fail.** Run `cd content-central-app && npx vitest run src/pages/workspace/VideoAnimado.test.tsx`.

- [ ] **Step 3: Implement**

**`client.ts`:** add `VideoProduto` and `listVideoProdutos`, and add `produtos` to `VideoState`.

**`VideoAnimado.tsx`**, in `NovoVideo`:

```tsx
const LIMITE: Record<string, number> = { "15": 2, "30": 5, "45": 8, "60": 10, auto: 10 };
const [produtos, setProdutos] = useState<VideoProduto[] | null>(null);
const [escolhidos, setEscolhidos] = useState<Array<{ id: string; foto: "recorte" | "moldura" }>>([]);
const [validoAte, setValidoAte] = useState("");
const [validadeMexida, setValidadeMexida] = useState(false);
const [criacao, setCriacao] = useState<"nova" | "padrao">("nova");
useEffect(() => {
  if (b.objetivo !== "oferta" || produtos) return;
  listVideoProdutos(project.projectId).then((r) => setProdutos(r.produtos)).catch((e) => setError((e as Error).message));
}, [b.objetivo, produtos, project.projectId]);
// "Válido até" follows the earliest validity among the picked products until the operator edits it.
useEffect(() => {
  if (validadeMexida || !produtos) return;
  const datas = escolhidos.map((e) => produtos.find((p) => p.id === e.id)?.validoAte).filter(Boolean).sort() as string[];
  setValidoAte(datas[0] || "");
}, [escolhidos, produtos, validadeMexida]);
const limite = LIMITE[String(b.duracao)];
const excedeu = b.objetivo === "oferta" && escolhidos.length > limite;
const faltaProduto = b.objetivo === "oferta" && escolhidos.length === 0;
```

The **Oferta block** is a `Secao` titled "Produtos da oferta", shown right after Objetivo when `b.objetivo === "oferta"`. It contains:

1. `<div role="group" aria-label="Produtos">`, with one card per product:
   - a checkbox labelled with `p.nome` (`aria-label={`${p.nome} ${p.precoTela}`}`), disabled when `p.motivo`, so tests can match it by name;
   - the thumbnail `<img src={p.previewUrl} alt="">`;
   - the name, `precoDeTela` struck through (when present) and `precoTela`;
   - the `p.motivo` text when set;
   - `fotoTipo === "fundo"`: the text "vai em moldura";
   - `fotoTipo === "branco"` and checked: a small radiogroup labelled `Foto de ${p.nome}`, with radios "Recortar" and "Moldura" that update `escolhidos[i].foto`.
   
   The order of `escolhidos` is the click order. Show the position number on picked cards.
2. A counter: `${escolhidos.length} de ${limite}`, with `data-fora={excedeu}`. When `excedeu` is true, the hint says `${nomeDuracao(b.duracao)} cabe até ${limite} produtos.`
3. `<label>Válido até<input type="date" value={validoAte} onChange={(e) => { setValidadeMexida(true); setValidoAte(e.target.value); }} /></label>`.
4. A radiogroup "Criação" with the cards "Criação nova" ("O Claude cria um VT único · ~15 min") and "VT padrão" ("Modelo fixo nas cores da marca · ~5 min"). The radio accessible names are exactly "Criação nova" and "VT padrão".

**Assunto prefill:** when the objective becomes Oferta and `assunto` is empty, set it to "Ofertas da semana".

**Estilo:** render only when `!(b.objetivo === "oferta" && criacao === "padrao")`.

**Submit body:**

```tsx
const body: VideoBriefing = b.objetivo === "oferta"
  ? { ...b, estilo: criacao === "padrao" ? "livre" : b.estilo, oferta: { produtos: escolhidos, validoAte, criacao } }
  : b;
```

The **"Gerar roteiro" button** is disabled when `busy || !b.assunto.trim() || excedeu || faltaProduto`.

The **summary** includes `${escolhidos.length} produtos` and "VT padrão" when they apply.

In `VideoDetalhe`:
- On roteiro review, a scene with `c.produto` shows a thumbnail `videoFileUrl(projectId, videoId, prod.foto)` (when `prod.foto`) and the price chip `prod.precoTela`, where `prod = state.produtos.find((p) => p.id === c.produto)`. Add `produto?: string` to `VideoCena`.
- The header chips include `preços de DD/MM` from `video.briefing.oferta?.precosEm` when it is an Oferta, plus "VT padrão" when `criacao === "padrao"`.
- On the prévia, when `video.briefing.oferta?.criacao === "padrao"`, hide the ajuste textarea and its button. Show instead `<p className={styles.hint}>VT padrão: para mudar o visual, use Criação nova.</p>`.

**CSS:** add a product grid (`grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`), product cards (a 1:1 thumbnail with `object-fit: contain` on a checkerboard background, the selected state as an accent ring, the disabled state dimmed), and a struck "de" price (`text-decoration: line-through; color: var(--muted)`). Use the existing tokens only.

- [ ] **Step 4: Run tests and build.** Run `cd content-central-app && npx vitest run src/pages/workspace/VideoAnimado.test.tsx && npx vitest run && npm run build`. Expected: PASS, build OK.

- [ ] **Step 5: Visual check.**
  - Build, then serve the worktree on the bench port: `node bin/opensquad.js content serve 3399` from the main checkout root, pointing at the worktree's `bin`, as in the earlier bench.
  - Screenshot the form with Oferta selected for `mercado-carvalho` (`/projects/mercado-carvalho/video`). Save it as `.superpowers/sdd/2026-10-12-video-animado-v2/t5-oferta.png`, look at it, and fix anything broken.
  - Say in the report what you changed.

---

### Task 6: VT padrão (template and mechanical stage 2)

**Files:**
- Create: `src/video-motor/modelos/vt-padrao/cenas.js`
- Create: `tests/fixtures/vt-padrao/roteiro.json`, `tests/fixtures/vt-padrao/produtos.json`, `tests/fixtures/vt-padrao/voz/tempos.json`
- Modify: `src/content-central-video-jobs.js` (`createVideoJobs` signature, `etapaProducao`)
- Modify: `src/content-central-server.js` (the ajuste route)
- Test: `tests/content-central-video-jobs.test.js`, `tests/content-central-video-server.test.js`, `tests/video-motor.test.js`

**Interfaces:**
- **Consumes:** Task 4's `produtos.json`, `window.PRODUTOS`/`window.LOJA`, and `legendaPostOferta` (Task 3).
- **Produces:**
  - `createVideoJobs({ targetDir, runner, renderer, narrador })`. `narrador(dir) -> Promise<void>` defaults to running `python <MOTOR>/tts.py <dir>`.
  - `src/video-motor/modelos/vt-padrao/cenas.js`, which defines `window.VIDEO` with the tipos `abertura`, `produto` and `fechamento`.

- [ ] **Step 1: Fixture files**

`tests/fixtures/vt-padrao/roteiro.json`:

```json
{
  "marca": { "nome": "Mercado Teste", "logo": "", "whatsapp": "65 0000-0000", "instagram": "@teste", "cor": "#E11D2E" },
  "voz": "gemini:Puck",
  "cenas": [
    { "tipo": "abertura", "fala": "Olha só as ofertas da semana!", "descricao": "abertura" },
    { "tipo": "produto", "produto": "a", "fala": "Fralda de dezesseis e noventa e nove por treze e noventa e nove!", "descricao": "produto" },
    { "tipo": "fechamento", "fala": "Só até domingo, chama no WhatsApp!", "descricao": "fecho" }
  ]
}
```

`tests/fixtures/vt-padrao/produtos.json`:

```json
{ "produtos": [{ "id": "a", "nome": "Fralda", "precoTela": "R$ 13,99", "precoDeTela": "R$ 16,99", "precoFalado": "treze e noventa e nove", "unidade": "un", "foto": "fotos/produto-a.png", "fotoTipo": "recorte" }],
  "loja": { "nome": "Mercado Teste", "endereco": "Rua 1, 2", "whatsapp": "65 0000-0000", "horario": "seg a sáb 08:00–18:00", "validoAte": "2026-10-18", "validade": "domingo, dia 18" } }
```

`tests/fixtures/vt-padrao/voz/tempos.json` gives one word list per scene. Spread the words evenly: abertura 0.05–2.0 s, produto 2.4–6.4 s, fechamento 6.8–9.0 s. Each word is `{ "w": "<word as in the fala>", "t": <start>, "d": 0.25, "fim": <true on the last word of a sentence> }`, and the words must match the falas exactly in order (`olha`, `só`, …). Write it out fully, with no generator.

The test writes the product photo into the temp copy with Jimp, as in Task 3's helper, saved to `fotos/produto-a.png`.

- [ ] **Step 2: Write failing tests**

Append to `tests/video-motor.test.js`:

```js
test('the vt-padrao template renders a small VT without page errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vt-padrao-'));
  try {
    await cp('tests/fixtures/vt-padrao', dir, { recursive: true });
    await cp(join(MOTOR_DIR, 'modelos', 'vt-padrao', 'cenas.js'), join(dir, 'cenas.js'));
    await mkdir(join(dir, 'fotos'), { recursive: true });
    const im = new Jimp({ width: 200, height: 200, color: 0x00000000 });
    for (let y = 40; y < 160; y++) for (let x = 40; x < 160; x++) im.setPixelColor(0x2266ccff, x, y);
    await im.write(join(dir, 'fotos', 'produto-a.png'));
    const r = await renderVideo({ videoDir: dir, stills: [0.05, 3, 5.5, 8] });
    assert.equal(r.stills.length, 4);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
```

Append to `tests/content-central-video-jobs.test.js`. It uses Task 4's `comOferta` and `ofertaBriefing` with `criacao: 'padrao'`.

```js
test('VT padrão stage 2 never calls Claude: it narrates, copies the template, writes the caption and stills', async () => {
  await withProject(async (dir) => {
    await comOferta(dir);
    const calls = [];
    const narrados = [];
    const renders = [];
    const runner = async ({ prompt, cwd }) => {
      calls.push(prompt);
      await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'abertura', fala: 'Ofertas!', descricao: 'a' }, { tipo: 'produto', produto: 'fralda', fala: 'Fralda por {preco}!', descricao: 'b' }, { tipo: 'fechamento', fala: 'Chama no WhatsApp!', descricao: 'c' }] }));
      return { text: 'ok' };
    };
    const narrador = async (vdir) => {
      narrados.push(vdir);
      await mkdir(join(vdir, 'voz'), { recursive: true });
      await writeFile(join(vdir, 'voz', 'tempos.json'), JSON.stringify({ cenas: [{ words: [{ w: 'Ofertas', t: 0.05, d: 0.3 }] }, { words: [{ w: 'Fralda', t: 1, d: 0.3 }] }, { words: [{ w: 'Chama', t: 3, d: 0.3 }] }] }));
    };
    const jobs = createVideoJobs({ targetDir: dir, runner, narrador, renderer: async (o) => { renders.push(o); return {}; } });
    const video = await createVideo('king', { ...ofertaBriefing, oferta: { ...ofertaBriefing.oferta, criacao: 'padrao' } }, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
    await jobs.enqueue('king', video.id, 'producao');
    await jobs.idle();
    const vdir = videoDir(dir, 'king', video.id);
    assert.equal(calls.length, 1, 'only stage 1 called Claude');
    assert.deepEqual(narrados, [vdir]);
    assert.equal(await readFile(join(vdir, 'cenas.js'), 'utf8'), await readFile(new URL('../src/video-motor/modelos/vt-padrao/cenas.js', import.meta.url), 'utf8'));
    assert.match(await readFile(join(vdir, 'legenda-post.txt'), 'utf8'), /R\$ 13,99/);
    assert.ok(renders[0].stills.length >= 2);
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.PREVIA_PRONTA);
  });
});
```

Append to `tests/content-central-video-server.test.js`:

```js
test('a visual ajuste on a VT padrão prévia is refused', async () => {
  // create a video record directly with briefing.oferta.criacao 'padrao' and status previa_pronta
  // (write video.json via createVideo + updateVideo like the other route tests), then:
  const r = await call(server, `/api/projects/king/videos/${id}/ajuste`, { etapa: 'producao', pedido: 'muda a cor' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Criação nova/);
});
```

Write it fully with the file's `withServer`/`call` helpers. Check how the server returns errors (`error` or `erro`) and match that.

- [ ] **Step 3: Run and confirm they fail.**

- [ ] **Step 4: Implement the jobs changes**

```js
import { legendaPostOferta } from './content-central-video-produtos.js';

// Runs the motor's TTS directly (VT padrão has no Claude in stage 2).
function narrarComTts(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_BIN || 'python', [join(MOTOR_DIR, 'tts.py'), dir], { cwd: dir, windowsHide: true });
    let saida = '';
    child.stdout.on('data', (c) => { saida += c; });
    child.stderr.on('data', (c) => { saida += c; });
    child.on('error', (err) => reject(new Error(`Não consegui gerar a voz: ${err.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(saida.trim().slice(-600) || `A voz saiu com código ${code}.`))));
  });
}
```

Change the signature to `createVideoJobs({ targetDir, runner = runClaudeCode, renderer = defaultRenderer, narrador = narrarComTts })`.

In `etapaProducao`, replace the block from `await writeAjuste(dir, ajuste);` to the `tempos.json` freshness check with:

```js
    await writeAjuste(dir, ajuste);
    const oferta = video.briefing.oferta;
    if (oferta?.criacao === 'padrao') {
      // Fixed template: narration and stills are mechanical, no Claude.
      await narrador(dir);
      await copyFile(join(MOTOR_DIR, 'modelos', 'vt-padrao', 'cenas.js'), join(dir, 'cenas.js'));
      const { loja } = await readJson(join(dir, 'produtos.json'), { loja: {} });
      await writeFile(join(dir, 'legenda-post.txt'), legendaPostOferta(oferta, loja));
    } else {
      const temLogo = existsSync(join(dir, 'fotos', 'logo.png'));
      await runner({ prompt: `# Etapa 2
${stagePrompt('PEDIDO-producao.md', video, temLogo, erroAnterior)}`, cwd: dir, addDirs: [MOTOR_DIR] });
      if (!await escritoDepois(join(dir, 'cenas.js'), inicio)) throw new Error('A produção não gerou cenas.js.');
    }
    const temposPath = join(dir, 'voz', 'tempos.json');
    if (ajuste ? !existsSync(temposPath) : !await escritoDepois(temposPath, inicio)) throw new Error('A produção não gerou voz/tempos.json.');
```

The rest is unchanged: the roteiro lock check, then the stills.

**Server:** in the ajuste route, before the `producao` `iniciar`:

```js
            if (body.etapa === 'producao' && video.briefing.oferta?.criacao === 'padrao') throw Object.assign(new Error('VT padrão: para mudar o visual, use Criação nova.'), { status: 400 });
```

- [ ] **Step 5: Implement the template** `src/video-motor/modelos/vt-padrao/cenas.js`

```js
// VT padrão: the fixed supermarket VT. Reads window.PRODUTOS / window.LOJA
// (produtos.json) and R.marca (roteiro.json); every price on screen comes
// from the data, never from text. Scenes: abertura, produto × N, fechamento.
(() => {
  const cor = (R.marca && R.marca.cor) || '#E11D2E';
  const produto = (c) => window.PRODUTOS.find((p) => p.id === c.produto) || {};
  // The new price pops on its last mention (the "de" price is usually said first).
  const ultimaVez = (A, w, fallback) => {
    try { let n = 1; for (;;) { try { A(w, n + 1); n += 1; } catch { return A(w, n); } } } catch { return fallback; }
  };
  const primeira = (s) => String(s || '').split(' ')[0];

  window.VIDEO = {
    estrelas: false,
    fontes: 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@700;900&display=swap',
    // The stage is 540×960 CSS px (rendered at 2×). The caption band starts at
    // top 612px, so prices and the WhatsApp button stay above ~600px.
    css: `
      #stage { background: radial-gradient(circle at 50% 35%, ${cor} 0%, #120406 78%); }
      .vt-faixa { position:absolute; left:-30px; right:-30px; height:75px; background:#FFD100; transform:rotate(-6deg); box-shadow:0 6px 0 rgba(0,0,0,.25); }
      .vt-titulo { position:absolute; left:0; right:0; text-align:center; font:400 75px/0.95 Anton, sans-serif; color:#fff; text-transform:uppercase; text-shadow:0 5px 0 rgba(0,0,0,.35); }
      .vt-sub { position:absolute; left:0; right:0; text-align:center; font:900 27px Inter, sans-serif; color:#120406; text-transform:uppercase; }
      .vt-logo { position:absolute; left:50%; width:140px; height:140px; margin-left:-70px; border-radius:50%; background:#fff; display:grid; place-items:center; box-shadow:0 9px 20px rgba(0,0,0,.4); }
      .vt-logo img { max-width:78%; max-height:78%; }
      .vt-foto { position:absolute; left:50%; top:140px; width:320px; height:300px; margin-left:-160px; display:grid; place-items:center; }
      .vt-foto img { max-width:100%; max-height:100%; filter:drop-shadow(0 15px 20px rgba(0,0,0,.45)); }
      .vt-foto.moldura { background:#fff; border-radius:24px; padding:16px; box-shadow:0 15px 30px rgba(0,0,0,.45); }
      .vt-foto.moldura img { border-radius:12px; filter:none; }
      .vt-nome { position:absolute; left:30px; right:30px; top:56px; text-align:center; font:900 36px/1.05 Inter, sans-serif; color:#fff; text-transform:uppercase; text-shadow:0 3px 0 rgba(0,0,0,.35); }
      .vt-de { position:absolute; left:0; right:0; top:450px; text-align:center; font:900 30px Inter, sans-serif; color:#fff; opacity:.85; }
      .vt-de s { text-decoration-thickness:4px; text-decoration-color:#FFD100; }
      .vt-preco { position:absolute; left:50%; top:488px; transform-origin:50% 50%; padding:8px 24px; margin-left:-160px; width:320px; border-radius:18px; background:#FFD100; color:#120406; text-align:center; font:400 78px/1 Anton, sans-serif; box-shadow:0 8px 0 rgba(0,0,0,.3); }
      .vt-preco small { font:900 18px Inter, sans-serif; display:block; margin-top:2px; }
      .vt-info { position:absolute; left:35px; right:35px; text-align:center; font:900 26px/1.25 Inter, sans-serif; color:#fff; }
      .vt-whats { position:absolute; left:50%; top:500px; margin-left:-180px; width:360px; padding:14px; border-radius:999px; background:#25D366; color:#fff; text-align:center; font:900 30px Inter, sans-serif; }
    `,
    tipos: {
      abertura: {
        html: () => `
          ${R.marca && R.marca.logo ? `<div class="vt-logo" data-k="logo" style="top:110px"><img src="${asset(R.marca.logo)}"></div>` : ''}
          <div class="vt-faixa" data-k="faixa" style="top:300px"></div>
          <div class="vt-sub" data-k="sub" style="top:322px">${esc((window.LOJA && window.LOJA.nome) || (R.marca && R.marca.nome) || '')}</div>
          <div class="vt-titulo" data-k="tit" style="top:420px">Ofertas<br>da semana</div>`,
        frame(t, c, q, A, s) {
          const k = p(t, s.start, s.start + 0.5);
          if (q('logo')) st(q('logo'), k, `scale(${back(k)})`);
          st(q('faixa'), 1, `rotate(-6deg) translateX(${lerp(-600, 0, eo(p(t, s.start + 0.1, s.start + 0.45)))}px)`);
          st(q('sub'), p(t, s.start + 0.3, s.start + 0.5));
          const kt = p(t, s.start + 0.35, s.start + 0.8);
          st(q('tit'), kt, `scale(${lerp(1.6, 1, eo(kt)) + Math.sin(t * 6) * 0.01})`);
          return { flash: Math.max(0, 1 - Math.abs(t - (s.start + 0.4)) * 6) * 0.5 };
        },
        sfx: (c, A, s) => [{ t: s.start + 0.1, s: 'whoosh' }, { t: s.start + 0.4, s: 'impact' }],
      },
      produto: {
        html: (c) => {
          const pr = produto(c);
          return `
            <div class="vt-nome" data-k="nome">${esc(pr.nome)}</div>
            <div class="vt-foto ${pr.fotoTipo === 'moldura' ? 'moldura' : ''}" data-k="foto"><img src="${asset(pr.foto)}"></div>
            ${pr.precoDeTela ? `<div class="vt-de" data-k="de">de <s>${esc(pr.precoDeTela)}</s> por</div>` : ''}
            <div class="vt-preco" data-k="preco">${esc(pr.precoTela)}${pr.unidade ? `<small>${esc(pr.unidade === 'un' ? 'a unidade' : pr.unidade === 'kg' ? 'o quilo' : pr.unidade)}</small>` : ''}</div>`;
        },
        frame(t, c, q, A, s) {
          const pr = produto(c);
          const kf = eo(p(t, s.start, s.start + 0.45));
          st(q('foto'), kf, `translateY(${lerp(250, 0, kf)}px) rotate(${lerp(-12, 0, kf)}deg) scale(${1 + Math.sin(t * 2.2) * 0.015})`);
          st(q('nome'), p(t, s.start + 0.1, s.start + 0.35), `translateY(${lerp(-20, 0, eo(p(t, s.start + 0.1, s.start + 0.35)))}px)`);
          const tPreco = ultimaVez(A, primeira(pr.precoFalado), s.start + 1.2);
          if (q('de')) st(q('de'), p(t, s.start + 0.5, s.start + 0.7));
          const kp = p(t, tPreco - 0.05, tPreco + 0.3);
          st(q('preco'), kp ? 1 : 0, `scale(${kp ? back(kp) * (1 + Math.sin(t * 7) * 0.02) : 0.2}) rotate(-3deg)`);
          return { shake: Math.max(0, 1 - Math.abs(t - tPreco) * 5) * 0.6 };
        },
        sfx: (c, A, s) => {
          const pr = produto(c);
          return [{ t: s.start + 0.05, s: 'whoosh' }, { t: ultimaVez(A, primeira(pr.precoFalado), s.start + 1.2), s: 'impact' }];
        },
      },
      fechamento: {
        html: () => {
          const l = window.LOJA || {};
          return `
            <div class="vt-titulo" data-k="tit" style="top:110px;font-size:60px">${l.validade ? 'Só até<br>' + esc(l.validade) : 'Corre pra cá!'}</div>
            <div class="vt-info" data-k="end" style="top:330px">${esc(l.endereco || '')}${l.horario ? `<br><span style="font-size:20px;opacity:.85">${esc(l.horario)}</span>` : ''}</div>
            ${l.whatsapp ? `<div class="vt-whats" data-k="wa">WhatsApp ${esc(l.whatsapp)}</div>` : ''}`;
        },
        frame(t, c, q, A, s) {
          const k = eo(p(t, s.start, s.start + 0.4));
          st(q('tit'), k, `scale(${lerp(0.6, 1, k)})`);
          st(q('end'), p(t, s.start + 0.4, s.start + 0.7));
          if (q('wa')) { const kw = p(t, s.start + 0.7, s.start + 1); st(q('wa'), kw, `scale(${kw ? back(kw) * (1 + Math.sin(t * 5) * 0.02) : 0.5})`); }
        },
        sfx: (c, A, s) => [{ t: s.start + 0.05, s: 'whoosh' }, { t: s.start + 0.75, s: 'ding' }],
      },
    },
  };
})();
```

**The player contract** (verified in `src/video-motor/player.html`):
- `#stage` is 540×960 CSS px, rendered at 2×; the template's CSS sets its background;
- every `.scene` fills the stage (`position:absolute; inset:0`);
- the caption `#cap` sits at top 612px, so keep prices and buttons above about 600px.

Compare with an approved example (`src/video-motor/exemplos/king-vitrine-apagada/cenas.js`) if anything renders off.

- [ ] **Step 6: Visual check of the template.**
  - Render stills of the fixture to a scratch folder: `node src/video-motor/render.mjs <tempcopy> --stills 0.5,3,4.5,6,8.5`.
  - Look at them; iterate until the VT reads as a supermarket ad (big readable price, product dominant, no overlap with the caption band at the bottom).
  - Copy the final stills to `.superpowers/sdd/2026-10-12-video-animado-v2/t6-*.jpg`.

- [ ] **Step 7: Run tests.**

Run: `node --test tests/content-central-video-jobs.test.js tests/content-central-video-server.test.js tests/video-motor.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 8: Lint** the changed JS files.

---

### Task 7: E2E with the operator and tuning (controller-led, not a subagent)

- [ ] **Step 1:** Restart the bench server on 3399 so it serves the worktree build. Ask the operator for permission first, if a video is running there.
- [ ] **Step 2:** The operator makes a **VT padrão** for Mercado Carvalho with 4–5 products (Automático). Check:
  - the prices on screen and in the voice;
  - the cutouts;
  - the time per product.
- [ ] **Step 3:** The operator makes a **Criação nova** for Frios Modelo (`arthur-frios`). Check the same things.
- [ ] **Step 4:** If the products drag, lower `SEGUNDOS_POR_PRODUTO` in `src/content-central-video-produtos.js` (for example to 3). This also changes the padrão prompt text, through `duracaoTexto`. Re-run `node --test tests/content-central-video-produtos.test.js tests/content-central-video-jobs.test.js`.
- [ ] **Step 5:** Run the final whole-branch review, then merge to master and push only when the operator asks. The operator restarts 3333.
