# Trava de efeito de pincelada (letras + selo) por oferta — Design

## Problema

Criativos gerados às vezes saem com título e selo de preço num visual "pincelado"/pintado à mão (ex: "Mussarela Fatiada" com textura de tinta, selo de preço com mancha de pincel atrás) — ver captura anexada na conversa. Não existe hoje nenhuma instrução no prompt que proíba ou libere esse efeito; a IA improvisa livremente tanto a forma do selo quanto a textura das letras. O operador quer decidir, por oferta, se autoriza esse efeito ou não.

## Estado atual (verificado)

- O selo de preço só é descrito como "selo compacto de alto contraste" (`src/content-central.js:7485`, seção `HIERARQUIA`, e equivalentes em `ESTRUTURA VERTICAL/FEED OBRIGATÓRIA`, `:7460`/`:7473`) — nunca especifica forma nem textura.
- O Sistema Visual da marca (`typography`/`titleWeight`/`bodyWeight`/`priceWeight`, mesclado recentemente) controla **família** de fonte (grotesca, condensada, serifada...), nunca **textura de renderização** (chapado sólido vs. pintado/pincelado). `formatBrandVisualSystemLines` (`:7082-7090`) não tem nenhuma linha sobre isso.
- Existe uma função legada `buildImagePrompt` (`:5858+`, usada só pelo painel clássico `/classic`) com sua própria menção solta a "selo de preço" — fora do caminho real de geração (`buildChatGptFinalCardPrompt`, chamado por `generateAiImageWithReviewLoop`) e fora de escopo deste spec.
- Pipeline de campo por oferta já estabelecido por `backgroundStyle` (spec 2026-09-05): `offer.X` → `offerToContentTopic()` (`:6550`) → `topic.X` → `buildCreativeSpec()` (`:7182-7223`) → linha condicional no prompt (`buildChatGptFinalCardPrompt`, seção `DIREÇÃO VISUAL` em `:7435-7456`).
- `normalizeProjectOffer` (`:9053-9055`) já valida `backgroundStyle` como string; campos booleanos simples (`uniqueProposal`, `autoGenerateCta`) usam o padrão `input?.X === true` (`:9028`, `:9015`), sem normalização à parte.

## Design

### Campo novo: `brushEffectAllowed` (boolean)

- **UI** (`Offers.tsx`, mesmo bloco `!isCatalog` de "Tratamento do produto"/"Fundo do criativo"/"Obediência ao modelo"): checkbox "Permitir efeito de pincelada/tinta (letras e selo)", **desmarcado por padrão** — mesmo padrão visual de `uniqueProposal`/`autoGenerateCta` (`:772-800`).
- **Storage**: `normalizeProjectOffer` grava `brushEffectAllowed: input?.brushEffectAllowed === true` — boolean direto, sem lista de valores válidos (não é enum, não precisa de função de normalização própria).
- **Default**: `false` (sólido/chapado) tanto pra ofertas novas quanto antigas sem o campo — não precisa de lógica de fallback especial em `buildCreativeSpec`, `undefined !== true` já resolve pra `false`.

### Pipeline

`offer.brushEffectAllowed` → `offerToContentTopic()` (`:6550`, ao lado de `backgroundStyle: offer.backgroundStyle,`) → `topic.brushEffectAllowed` → `buildCreativeSpec()` grava `creativeSpec.brushEffectAllowed = topic.brushEffectAllowed === true` (campo boolean direto no topo do objeto, sem sub-objeto — diferente de `background: { style }`, que agrupa porque already tinha mais de um campo relacionado; aqui é só 1 boolean, um wrapper seria complexidade sem uso).

**Combo (`buildComboOfferTopic`, `:6609-6611`):** diferente do padrão `a.X || b.X` usado por `productTreatment`/`backgroundStyle` — aquele padrão só funciona como "oferta primária vence" porque o default desses campos é sempre truthy (nunca cai pro `b`). Aqui o default é `false`, então `a.brushEffectAllowed || b.brushEffectAllowed` teria semântica diferente: uma oferta secundária com o campo marcado "vazaria" permissão pro combo mesmo com a primária desmarcada. Pra manter o mesmo princípio real ("oferta primária decide"), o merge deve ser `brushEffectAllowed: a.brushEffectAllowed`, sem `|| b...`.

**Sem gate por `topic.source === 'offer'`** (diferente de `backgroundStyle`, que tem esse gate): lá o motivo era não deixar um default *permissivo* (fundo elaborado livre) virar restrição em posts institucionais/carrossel sem UI pra desmarcar. Aqui o default é *restritivo* (sólido, sem pincelada) — aplicar essa mesma restrição em posts sem oferta vinculada não expande escopo nem quebra nada que já funcionava; é seguro e mais simples aplicar sempre, sem gate.

### Efeito no prompt

Em `buildChatGptFinalCardPrompt`, seção `DIREÇÃO VISUAL` (`:7435-7456`, sempre renderizada, não depende de `exactPrice`/`exactCta` — cobre tanto letras de título quanto selo de preço), nova linha logo após `...brandVisualSystemLines...` (`:7439`):

```js
creativeSpec.brushEffectAllowed
  ? ''
  : 'Título, preço e selo em cor sólida chapada — sem textura de pincel, tinta, rabisco ou efeito pintado à mão.',
```

Quando `brushEffectAllowed` é `true`, nenhuma linha nova entra — comportamento livre de hoje, sem mudança.

### Tipos (`client.ts`)

`brushEffectAllowed?: boolean;` adicionado em `ProjectOffer` e `SaveOfferInput`, ao lado de `uniqueProposal?: boolean;`.

### Fora de escopo

- `buildImagePrompt` (painel clássico `/classic`) — caminho legado, não é onde a geração real acontece hoje.
- Formato do selo (retângulo/círculo/pílula) — só a textura (chapado vs. pincelado) está em escopo; forma continua livre pra IA como já é hoje.
- Qualquer controle por modelo/estrutura de criativo — descartado na conversa em favor do campo por oferta.

## Testes

- Oferta nova sem `brushEffectAllowed` gera `creativeSpec.brushEffectAllowed === false` e o prompt contém a linha "cor sólida chapada... sem textura de pincel".
- Oferta com `brushEffectAllowed: true` não injeta essa linha — prompt idêntico ao comportamento sem o campo (antes desta feature).
- Combo de duas ofertas onde a primária tem `false` e a secundária tem `true`: resultado é `false` (primária vence, não vaza permissão da secundária) — prova a diferença deliberada do padrão `||`.
- UI: checkbox "Permitir efeito de pincelada/tinta (letras e selo)" só aparece quando `!isCatalog`, desmarcado por padrão, mesmo padrão dos outros campos booleanos do formulário.
