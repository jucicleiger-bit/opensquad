# Sabores / variações numa oferta — design

Data: 2026-10-01
Branch: `worktree-sabores` (isolado; nada vai para o master sem pedido explícito)

## Problema

Uma oferta como "Treto" existe em vários sabores (chocolate, morango, coco).
O operador quer uma única arte que mostre todos os sabores juntos, com um
preço só, para divulgar quais sabores existem.

Hoje o campo "Foto(s) real(is) do produto" já aceita várias fotos, mas o
sistema trata todas como ângulos do mesmo produto:

- só 2 fotos por oferta chegam ao modelo numa arte comum — o terceiro sabor
  some;
- nada diz ao modelo que cada foto é um sabor diferente, então ele mistura,
  escolhe uma só, ou funde tudo num produto inventado;
- no combo automático só a primeira foto de cada oferta é usada.

## Comportamento desejado

### Cadastro

- Nova seção **"Sabores / variações"** no formulário de oferta (nome
  genérico porque em outros segmentos é cor ou modelo).
- Cada linha: nome do sabor + uma foto (opcional) + botão remover.
- Botão "+ adicionar sabor", desabilitado ao chegar em **6 sabores**.
- Linhas com nome vazio são descartadas ao salvar.
- O campo "Foto(s) real(is) do produto" continua existindo para ofertas sem
  sabores.
- Em projeto catálogo, a validação "Cadastre pelo menos uma foto real do
  produto" também aceita uma foto de sabor.

### Arte gerada (oferta com ao menos 1 sabor)

- Título: o nome da oferta, como hoje.
- Centro: todos os sabores lado a lado, com o mesmo destaque, cada um com o
  nome do sabor legível embaixo. Vale para Feed e Story.
- Preço: um selo único (o preço da oferta), valendo para todos os sabores.
  Não é combo nem kit.
- Cada foto de sabor chega ao modelo rotulada com o sabor a que pertence.
- Sabor sem foto: aparece só pelo nome; o modelo é instruído a não desenhar
  embalagem inventada para ele.
- Quando a oferta tem sabores, a arte usa as fotos dos sabores, não as do
  campo geral.

### Efeitos colaterais

- Oferta com sabores nunca entra no combo automático (nem como principal,
  nem como parceira).
- A trava de "no máximo 2 fotos de produto por arte" passa a ser a
  quantidade de sabores (até 6) para essas ofertas.

## Design técnico

### Dado

```js
offer.flavors = [{ name: 'Chocolate', photoReferenceId: 'ref-123' }, ...]
```

- Novo `normalizeOfferFlavors(value)` em `src/content-central.js`, chamado
  pelo normalizador de oferta: aceita array, faz trim do nome, descarta nome
  vazio, `photoReferenceId` vazio vira `null`, corta em
  `MAX_OFFER_FLAVORS = 6`. Ausente → `[]` (ofertas existentes não mudam).
- `flavors` fica separado de `photoReferenceIds` — o campo geral continua
  significando "fotos deste produto", sem mistura.

### Do cadastro ao tópico

- Em `offerToContentTopic` (funil único: todo caminho oferta → tópico passa
  por ele):
  - `topic.flavors = offer.flavors`;
  - `topic.photoReferenceIds` = ids das fotos dos sabores (na ordem dos
    sabores) quando há sabores; senão o `photoReferenceIds` da oferta, como
    hoje.
- `buildPrimaryAiImageReferences`: `claimedByOtherOffers` passa a incluir as
  fotos dos sabores das outras ofertas, para nenhuma outra oferta pegar a
  foto de um sabor como fallback.

### Limite de fotos — um lugar só

Hoje o limite está duplicado em três lugares (`buildPrimaryAiImageReferences`,
`buildChatGptFinalCardPrompt`, `selectImageReferencesForCodex`). Vira um
helper exportado:

```js
export function productPhotoLimitFor(topic) {
  if (topic?.source === 'flyer') return MAX_FLYER_PRODUCTS;
  return topic?.flavors?.length ? Math.min(topic.flavors.length, MAX_OFFER_FLAVORS) : 2;
}
```

usado nos três pontos.

### Prompt (`buildChatGptFinalCardPrompt`)

Quando `topic.flavors?.length`:

- Linha de protagonista (HIERARQUIA e Centro das estruturas Feed/Story):
  "Os N sabores de {nome} lado a lado, com o mesmo destaque, cada um com o
  nome do sabor legível embaixo: A, B, C. É o mesmo produto em sabores
  diferentes, com um preço único para todos — não é combo nem kit, não
  somar nem repetir preço por sabor."
- Esta linha substitui as linhas de quantidade/foco de produto único que
  hoje dizem "produto principal como protagonista" — não podem coexistir
  com regras de "um único produto/uma unidade". Verificar
  `buildCreativeQuantityRules` e `detectCreativeProductFocus` durante a
  implementação e suprimir o que contradiz.
- Título exato e selo de preço exato continuam como hoje.
- Rótulo por foto: `Foto do sabor "Chocolate": <path>` no lugar de
  `Foto selecionada: <path>`.
- Sabores sem foto: uma linha "Sabores sem foto real (X, Y): mostrar só o
  nome, sem desenhar embalagem inventada."

### Manifesto de anexos do Codex (`buildCodexAttachmentManifest`)

Hoje só roda para `hasProductList(topic)`. Passa a rodar também quando
`topic.flavors?.length`, rotulando cada foto com o sabor dela ("Anexo 2:
Foto do sabor "Chocolate""). A função de rótulo ganha o ramo de sabores ao
lado do ramo de produtos (`flyerProductLabelFor`).

### Combo automático (`pickComboPartner`)

Retorna `null` se a oferta principal tem sabores; candidatos com sabores são
filtrados fora.

### Frontend

- `content-central-app/src/api/client.ts`: tipo da oferta ganha
  `flavors?: { name: string; photoReferenceId: string | null }[]`.
- `content-central-app/src/pages/workspace/Offers.tsx`:
  - `EMPTY_FORM.flavors = []`; edição carrega `offer.flavors`;
  - seção "Sabores / variações" com linhas nome + input de arquivo
    (1 foto) + miniatura da foto já salva + remover;
  - no submit, cada linha com arquivo novo faz upload pelo mesmo
    `saveAsset` (role `product_photo`, instrução "Foto real do produto:
    {nome} — sabor {sabor}") e grava o id em `photoReferenceId`.

## Fora de escopo

- Preço diferente por sabor.
- Encarte usando fotos de sabores (o encarte continua usando o campo geral).
- Escolher só alguns sabores por arte / rotação entre posts.
- Telas de sugestão de direção que leem `offer.photoReferenceIds`
  (`src/content-central-server.js` ~3245/3483/3621) — continuam lendo o
  campo geral.

## Testes

Backend (`node --test`):

1. `normalizeOfferFlavors`: trim, descarta nome vazio, corta em 6, ausente
   vira `[]`.
2. Prompt de oferta com 3 sabores: contém os 3 nomes, a linha "preço único",
   o preço exato uma vez, um rótulo de foto por sabor; não contém a linha de
   "produto principal como protagonista".
3. `productPhotoLimitFor`: flyer 12, 3 sabores 3, sem sabores 2;
   `selectImageReferencesForCodex` deixa passar as 3 fotos.
4. `buildCodexAttachmentManifest` rotula fotos de sabores.
5. `pickComboPartner` não pareia oferta com sabores (principal ou
   candidata).

Frontend (`vitest`):

6. Adicionar e remover sabor; botão some/desabilita em 6; salvar envia
   `flavors` com o id da foto enviada.

Validação real (ambiente de teste):

- Copiar um projeto para `_opensquad/content-central/` dentro do worktree
  (dados gitignored; o original não é tocado), subir servidor e app em
  porta diferente da de produção, sem `.env` de publicação.
- Cadastrar "Treto" com 3 sabores + fotos, gerar uma arte, operador avalia.

## Isolamento

- Todo código, teste e este spec vivem na branch `worktree-sabores`, no
  worktree `.claude/worktrees/sabores`.
- Nenhum commit, merge ou push no master sem pedido explícito.
- Sem tokens de publicação no ambiente de teste — impossível postar por
  acidente.
