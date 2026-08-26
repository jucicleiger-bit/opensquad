# Combo offer pairing (variação de arte com 2 produtos)

## Problem

`nextSelectedOffer` (`src/content-central.js:5671`) faz a fila girar entre
as ofertas ativas de um grupo (ex: 40 produtos de um catálogo), uma por
vez, em sequência round-robin via `createSelectedOfferRotator`/cursor
persistido. Cada geração agendada sempre produz **um produto por arte**.

Com um catálogo grande e homogêneo (ex: 40 sabores de pizza, todos tipo
`offer`/`product`), a saída fica repetitiva: sempre "1 produto, 1 arte".
Não existe hoje nenhum caminho que combine 2 produtos parecidos na mesma
peça — `combo` já existe como `type` de oferta, mas é 100% cadastro manual
do operador (nome/preço/fotos próprios); nada gera pareamentos
automaticamente a partir de ofertas já existentes.

## Goal

Fazer a fila, ocasionalmente e de forma aleatória, sortear **2 ofertas do
mesmo grupo** e gerar uma única arte combo pra elas — sem tirar a rotação
normal de produto único do lugar, e sem exigir nenhum cadastro extra por
oferta.

## Similaridade = mesmo `groupId`

Não existe (nem será criado) campo de categoria/tag por oferta.
"Parecido" = já estar no mesmo grupo de ofertas (`offer.groupId`), o
agrupamento que o operador já usa pra organizar o catálogo (ex: "Pizzas",
"Bebidas"). Zero campo novo em `Offer`.

## Data model

Novo campo no grupo de ofertas (`normalizeProjectOfferGroup`,
`src/content-central.js:7928`):

```
project.contentStrategy.offerGroups[].comboChance: number  // 0–100, default 0
```

`0` (padrão) = comportamento atual, sem mudança pra quem não configurar.
Validado/normalizado como os demais campos do grupo — fora do intervalo
0–100 é clampado, não é um erro de save.

`saveOfferGroup` (`content-central-app/src/api/client.ts:1004`) e o
endpoint correspondente passam a aceitar `comboChance` no input, igual já
aceitam `name`.

## Seleção — dentro de `nextSelectedOffer`

`nextSelectedOffer(rotator, weekday, targetDir)` ganha um parâmetro a mais
(`project`, ou a lista de grupos já normalizada) só pra ler o
`comboChance` do grupo da oferta sorteada. Depois de escolher a oferta
primária do jeito que já funciona (cursor avança normal, filtro de dia da
semana normal — a rotação principal continua idêntica):

1. Se `offer.type === 'combo'` (é uma combo manual do operador), não faz
   nada — não combina uma combo com outra.
2. Resolve `comboChance` do grupo da oferta primária (`offer.groupId`).
   Sem grupo ou `comboChance <= 0` → segue fluxo atual, sem sorteio.
3. Sorteia `Math.random() * 100 < comboChance`.
4. Se sim: monta o pool de candidatas = `rotator.offers` filtradas por
   `groupId` igual ao da primária, `id` diferente, `type !== 'combo'`.
   Pool vazio → cai pro post único (sem erro, sem log de falha).
5. Escolhe 1 candidata aleatória do pool (`Math.random()`, sem consumir/
   avançar o cursor principal — a segunda oferta é um bônus de variedade,
   não deve bagunçar a justiça do rodízio da oferta primária).
6. Retorna `buildComboOfferTopic(primária, candidata, targetDir)` no lugar
   do topic normal.

Se o sorteio falhar em qualquer passo (sem grupo, chance zero, pool vazio),
o retorno é exatamente `offerToContentTopic(offer, targetDir)` de hoje —
o caminho novo é estritamente aditivo.

Escopo: só `nextSelectedOffer`. `buildTopicPool`/`buildContentTopic` (usado
por metas/pilares e pela simulação sem grupo selecionado) não mudam.

## Merge de dados — `buildComboOfferTopic(a, b, targetDir)`

Nova função. Constrói uma "oferta sintética" combinando `a` e `b` e delega
pro `offerToContentTopic` já existente (nenhuma mudança nele):

| Campo | Valor |
|---|---|
| `id` | `` `${a.id}+${b.id}` `` |
| `name` | `` `${a.name} + ${b.name}` `` |
| `type` | `'combo'` |
| `price` | `null` (nunca soma nem escolhe 1 dos 2 — ver abaixo) |
| `items` | `a.items` e `b.items` concatenados (vazio ignorado) |
| `notes` | `` `${a.name} - ${priceLabel(a)} | ${b.name} - ${priceLabel(b)}` `` na frente, seguido das `notes` originais de `a`/`b` se existirem |
| `photoReferenceIds` | `[...a.photoReferenceIds, ...b.photoReferenceIds]` |
| `productTreatment` | `a.productTreatment \|\| b.productTreatment` |
| `layoutStrength` | `a.layoutStrength` |
| `pillarId` | `a.pillarId` |
| `cta` / `autoGenerateCta` | vazio / `true` — deixa o CTA genérico de combo (já existe) decidir |

`priceLabel(offer)` = helper simples que formata o preço já normalizado
(`normalizeCreativePrice`) como texto, ou string vazia se sem preço — não é
função nova de domínio, só formatação pro texto de `notes`.

Preços **sempre aparecem separados** no texto (decisão do usuário — nunca
soma, nunca esconde um dos dois), porque uma paridade automática de 2
ofertas não tem preço de pacote real: inventar um combo price seria
sugerir um desconto que não existe.

Como o `type` resultante é `'combo'`, `offerObjective`/`legacyOfferObjective`
e o aprendizado por tipo (`loadOfferTypeLearning(targetDir, 'combo')`) já
funcionam sem nenhuma mudança — o texto gerado ("Criar oferta de combo
para Pizza A + Pizza B...") já fica correto porque o `name` combinado já
carrega os dois nomes.

## Geração de imagem — nenhuma mudança de código

- `buildPrimaryAiImageReferences` (`src/content-central.js:6787`) já
  limita fotos de produto a no máximo 2
  (`prioritizeReferencesByTopic(...).slice(0, 2)` e o caminho de
  `linkedPhotoIds`) — as 2 `photoReferenceIds` do combo sintético já
  entram nesse teto existente sem precisar tocar o código.
- `combo` já está em `CREATIVE_TEMPLATE_REQUIRED_POST_TYPES`
  (`src/content-central.js:42`) — se o segmento não tiver um modelo
  (`layout_model` / `referenceKind: 'segment_structure'`) cadastrado com
  `postType: 'combo'`, a geração já bloqueia com o erro padrão existente
  ("Nenhum modelo de criativo cadastrado para..."). Nenhuma regra nova.

## Frontend

`content-central-app/src/pages/workspace/Offers.tsx`, na seção "Grupos de
ofertas" (por volta da linha 446), ao lado do campo de nome de cada grupo:
um input numérico (0–100, sufixo "%") ligado a `comboChance`, salvo pelo
mesmo botão/fluxo que já salva o rename do grupo (`handleSaveGroupName` /
`saveOfferGroup`). Default exibido: `0` ("desligado"). Sem grupos
cadastrados → nada aparece (mesmo padrão de hoje, onde a seção de grupos
só existe se houver grupo).

## Testing

- `nextSelectedOffer`: com `comboChance = 0` (ou grupo ausente), saída
  idêntica à atual (nenhuma regressão). Com `comboChance = 100` e 2+
  ofertas elegíveis no grupo, sempre retorna um topic `type: 'combo'` com
  2 `photoReferenceIds`. Com pool de candidatas vazio (grupo com só 1
  oferta ativa), cai pro post único mesmo com `comboChance = 100`. Oferta
  primária já `type: 'combo'` nunca é repareada.
- `buildComboOfferTopic`: `notes` contém os dois nomes e os dois preços
  formatados separadamente; `price` sai `null`; `items`/`photoReferenceIds`
  das duas ofertas aparecem combinados.
- Integração com `buildPrimaryAiImageReferences`/`buildCreativeSpec`: um
  topic combo sintético sem modelo `combo` cadastrado no segmento lança o
  mesmo erro de template obrigatório já coberto pelos testes existentes.
- `normalizeProjectOfferGroup`: `comboChance` fora de 0–100 é clampado;
  ausente normaliza pra `0`.

## Out of scope

- Combinar 3+ ofertas por arte (usuário pediu sempre 2 — já cabe no teto
  de fotos existente).
- Similaridade por texto/categoria além do `groupId` já existente.
- Aplicar o sorteio combo em `buildTopicPool` (fluxo de metas/pilares) —
  só a fila de ofertas selecionadas (`nextSelectedOffer`) muda.
- Preço de combo calculado/editável — sempre os 2 preços originais lado a
  lado.
