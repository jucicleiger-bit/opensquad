# Trava de fundo (elaborado x simples) por oferta — Design

## Problema

Hoje o fundo/cenário de um criativo gerado por IA nunca é uma escolha explícita do operador — ele nasce livre do modelo (ex: "Mussarela fatiada" saiu com bar desfocado ao fundo, garrafas, tomates). Pra algumas linhas de produto isso é desejável (composição rica, tipo vitrine), mas pra outras o operador quer travar num fundo liso/simples usando só as cores da marca, sem cenário nem objetos de contexto — e hoje não existe nenhum campo que controle isso; o único jeito de mexer nisso é via `layoutStrength`/`layoutReference`, que controlam a estrutura (zonas, hierarquia), não o fundo.

## Estado atual (verificado)

- `content-central-app/src/pages/workspace/Offers.tsx:41,59,677-687` — campo "Tratamento do produto" (`productTreatment`), 4 opções, controla só como a foto do produto real é tratada (fiel/exata/redesenho), sem relação com o resto da peça.
- Mesmo arquivo, `:690-702` — campo "Obediência ao modelo" (`layoutStrength`: `strict`/`balanced`/`free`), só tem efeito quando existe `layoutReference` (estrutura de criativo cadastrada); controla o quanto a IA deve seguir zonas/hierarquia do template, não o fundo.
- `src/content-central.js:7149-7207` (`buildCreativeSpec`) monta `creativeSpec.product` e `creativeSpec.layout`, mas não tem noção nenhuma de "fundo".
- `src/content-central.js:7503-7514` (seção LIBERDADE CRIATIVA do prompt) é onde hoje a liberdade de fundo é decidida — sempre em texto livre tipo "Pode variar fundo, luz, tipografia..." — nunca um "não gerar cenário".
- Pipeline de leitura do campo (mapeado na conversa): `offer.productTreatment` → `offerToContentTopic()` (`:6545`) → `topic.productTreatment` → `normalizeProductTreatment()` (`:7110`) → `creativeSpec.product.treatment` (`:7185`). Novo campo replica exatamente esse caminho.
- Combo de 2 ofertas (`buildComboOfferTopic`, `:6589-6610`) já usa `a.productTreatment || b.productTreatment` — só a oferta primária do combo vale, a secundária é ignorada. Comportamento já estabelecido no código; o novo campo replica o mesmo padrão (não é bug novo, é consistência com o que já existe).

## Design

### Campo novo: `backgroundStyle`

Enum de 2 valores, salvo por oferta (mesmo nível de `productTreatment`):

```ts
type BackgroundStyle = "elaborate" | "simple_brand";
```

- **UI** (`Offers.tsx`, mesma linha/bloco de "Tratamento do produto" e "Obediência ao modelo", visível só quando `!isCatalog` — mesma condição dos outros dois): label "Fundo do criativo", opções "Elaborado (cenário/ambientação)" / "Simples (cores da marca)".
- **Default quando ausente/inválido**: `simple_brand` — vale tanto pra ofertas já cadastradas (sem esse campo salvo ainda) quanto pra entradas inválidas, decisão do operador pra não deixar nenhuma oferta existente "esquecida" no comportamento livre antigo.

### Pipeline (espelha `productTreatment`)

`offer.backgroundStyle` → `offerToContentTopic()` grava em `topic.backgroundStyle` → nova função `normalizeBackgroundStyle(value)` (mesmo formato de `normalizeProductTreatment`, sem o parâmetro de "tem referência" porque não depende de foto) → `creativeSpec.background.style` em `buildCreativeSpec()`.

Servidor valida contra a lista de 2 valores no mesmo ponto onde `productTreatment`/`layoutStrength` já são validados hoje (`content-central.js:9013-9018`).

Combo: `a.backgroundStyle || b.backgroundStyle` no mesmo objeto `merged` de `buildComboOfferTopic` — mesmo padrão já usado pra `productTreatment`/`layoutStrength` ali.

### Efeito no prompt

Em `buildChatGptFinalCardPrompt()`, nova linha condicional na seção LIBERDADE CRIATIVA (`:7503-7514`), **antes** das linhas condicionais de `productLockedToPhoto`/`layoutReference.strength` já existentes — ou seja, ela sempre entra, independente de template estrito estar ativo ou não (prioridade definida: fundo simples vence a estrutura estrita):

- `simple_brand`: "Fundo obrigatoriamente liso e simples, usando apenas as cores da marca — sem cenário, objetos de contexto, ambientação ou textura elaborada. Essa regra vale mesmo se o modelo estrutural ou o restante da instrução sugerir outro tipo de fundo."
- `elaborate`: nenhuma linha nova — mantém o texto livre que já existe hoje nesse bloco, sem mudança de comportamento.

Espelho em RESTRIÇÕES FINAIS (`:7515+`), só quando `simple_brand`: "Não criar cenário, ambientação ou objetos de contexto no fundo — fundo deve ser liso, só com cor da marca."

### Fora de escopo

- Consertar o `a.X || b.X` do combo pra considerar as duas ofertas — comportamento pré-existente, replicado por consistência, não é parte deste spec.
- Granularidade maior que 2 opções (ex: "neutro sem cor de marca") — descartado na conversa, YAGNI até aparecer caso real.
- Escolha por geração/projeto (em vez de por oferta) — descartado, decisão foi por oferta.

## Testes

- Oferta nova sem `backgroundStyle` preenchido gera `creativeSpec.background.style === 'simple_brand'` (default).
- Oferta com `backgroundStyle: 'elaborate'` não injeta as linhas novas de LIBERDADE CRIATIVA/RESTRIÇÕES FINAIS (prompt idêntico ao comportamento atual).
- Oferta com `backgroundStyle: 'simple_brand'` + `layoutReference` em modo `strict` ainda assim gera a linha "vale mesmo se o modelo estrutural sugerir outro tipo de fundo" (prioridade sobre o template).
- UI: campo "Fundo do criativo" só aparece quando `!isCatalog`, mesmo padrão dos outros dois campos.
