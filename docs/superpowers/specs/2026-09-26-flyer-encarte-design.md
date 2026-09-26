# Flyer / encarte — design

Data: 2026-09-26
Branch: `worktree-flyer-encarte`

## Problema

O Content Central hoje gera conteúdo por agenda: o operador configura dias,
canais e formatos, o sistema roda o rodízio de ofertas/pilares e cada peça
sai com **um produto protagonista**. Isso atende restaurante, engenharia,
estética — mas não atende mercado/mercearia, cujo material principal é o
**encarte de ofertas**: uma arte só, com vários produtos e seus preços.

Encarte não cabe na agenda por três motivos:

1. Ele não é recorrente por rodízio — sai quando o mercado define a
   campanha da semana, com os produtos daquela campanha.
2. Ele carrega N produtos numa peça, e todo o caminho criativo atual é
   construído em torno de um herói único.
3. O operador quer escolher os produtos na hora, por grupo ou avulsos.

## Escopo

Uma aba nova, `Flyer`, dentro do workspace do projeto. O operador seleciona
produtos já cadastrados, escolhe canais e data, gera, e a peça cai no
Aguardando aprovação como qualquer outro card.

Fora de escopo nesta entrega:

- Agendamento futuro (gerar depois, na data). Aqui é gerar agora, com data
  de publicação anotada.
- Uma arte por produto. O flyer é sempre uma arte só com vários produtos.
- Template HTML renderizado. Fica registrado como plano B na seção de
  riscos, não é construído agora.

## O que já existe e será reaproveitado

O sistema já tem quase todas as peças. Esta entrega monta o que falta em
cima delas, sem duplicar conceito:

| Necessidade | Já existe |
|---|---|
| Modelo de layout por segmento | "Estruturas de criativo" em Aprendizado de segmento, por Setor/Nicho/Especialidade |
| Produto com preço e unidade | `ProjectOffer` com `price`, `priceUnit` (kg/g/pacote/caixa), `photoReferenceIds` |
| Agrupar produtos | `OfferGroup` + `ProjectOffer.groupId` |
| Peça avulsa com data, fora do rodízio | `generateSpecialDateContent` (`src/content-central.js:2045`) |
| Uma arte por formato, compartilhada entre canais de mesmo formato | `creativeGroupKey` + `creativeShapeGroupForChannel` |
| Fila de aprovação | `PendingApproval` — lista qualquer item com status aguardando |
| Revisão automática com regeneração | `generateAiImageWithReviewLoop` |

## Fluxo do operador

### 1. Cadastrar o modelo

Aprendizado de segmento → Estruturas de criativo → seleciona o Nicho (ex.
`Negócios locais e lojas / Mercado / mercearia`) → sobe a arte modelo e a
marca com o tipo de post **"Flyer / encarte"**.

`flyer` é um valor novo em `CREATIVE_POST_TYPE_LABELS`
(`src/content-central.js:8017`) e no select correspondente de
`LearningGallery.tsx`, ao lado de `special_date` e `ad_creative`, que já
seguem exatamente esse padrão.

A quantidade de produtos que o layout comporta vai no título e na instrução
da própria estrutura (ex.: "Encarte 12 produtos, grade 4x3"). Esse texto já
viaja para o prompt hoje via `buildSegmentLayoutReferences`; não precisa de
campo novo.

O 12 aparece em dois lugares com papéis distintos: é **teto rígido** na
validação (endpoint e formulário recusam mais que isso) e é **orientação ao
modelo** quando escrito na estrutura. Uma estrutura que diga "8 produtos"
não reduz o teto do formulário — ela só orienta a composição.

### 2. Cadastrar os produtos

Aba Ofertas, sem mudança: nome, preço, unidade, foto e grupo. O grupo é o
que permite selecionar a campanha inteira de uma vez na aba Flyer.

### 3. Gerar o flyer

Aba nova `Flyer` (`/projects/:projectId/flyer`), com um formulário:

- **Produtos** — escolher um `OfferGroup` inteiro ou marcar ofertas
  avulsas. Teto de 12, com contador visível. Ofertas sem preço aparecem
  marcadas como tal (viram aviso, não bloqueio).
- **Canais** — checkboxes, mesma lista da agenda. Canais de mesmo formato
  compartilham uma arte; formatos diferentes (Feed 1:1 vs Story 9:16)
  geram artes próprias.
- **Data** e **hora** de publicação.
- Botão **Gerar flyer**.

Abaixo do formulário, a lista dos flyers já gerados com status, no mesmo
padrão da aba Carrossel.

O flyer **não** consome cota do plano de conteúdo nem move o cursor do
rodízio de ofertas/pilares — mesma garantia que `generateSpecialDateContent`
já dá hoje.

## Arquitetura

### Princípio de isolamento

Todo o trabalho vive no worktree `worktree-flyer-encarte`; a master segue
rodando intocada até o flyer ser aprovado na prática.

Dentro do código, o flyer entra como **caminho paralelo**: em cada função
compartilhada, um desvio no topo (`se o tópico for flyer, caminho novo`)
seguido do corpo atual inalterado. Nenhuma linha do caminho que a agenda
percorre hoje muda de comportamento. Se a lógica de flyer quebrar, a agenda
não percebe.

### Geração

`generateFlyerContent(projectId, options, targetDir)` em
`src/content-central.js`, modelada em `generateSpecialDateContent`, que já
resolve peça avulsa + data + múltiplos canais + entrada no Aguardando.

Diferenças:

- Recebe `offerIds: string[]` (1 a 12) em vez de um `offerId`.
- Monta um `contentTopic` com `type: 'flyer'` e um campo novo
  `products: Array<{ offerId, name, price, priceUnit, photoReferenceIds }>`
  com a lista completa, em vez de um produto só.
- `batchId` próprio com prefixo de flyer, para não colidir com batches da
  agenda nem de datas comemorativas.

Endpoint `POST /api/projects/:projectId/generate-flyer` em
`src/content-central-server.js`, espelhando `generate-special-date`:
valida entrada, chama `generateFlyerContent`, dispara
`enqueueBatchImageGeneration` e devolve 201.

### As três travas do prompt

Aqui está o trabalho real da entrega. Sem elas o modelo erra
sistematicamente com 12 produtos.

**1. Fotos — levantar o teto de 2.**
`buildPrimaryAiImageReferences` (`src/content-central.js:~8041`) hoje corta
fotos de produto em `.slice(0, 2)` (`:8081`, `:8095`). Para um tópico
`flyer`, enviar a foto de cada produto selecionado, **cada uma rotulada com
o nome e o preço do produto a que pertence**. O rótulo é obrigatório: sem
ele o modelo embaralha qual preço pertence a qual foto.

**2. Sem produto herói.**
`multiProductFocus` (`:7764`) e `detectCreativeProductFocus` (`:7802`) hoje
escolhem um item da lista como protagonista e emitem
`Não trocar {item} por outro produto listado na oferta` — instrução correta
para post de oferta, e exatamente errada para encarte. Para tópico `flyer`,
desviar para um bloco de grade: N slots, slot 1 = produto A por R$ X,
slot 2 = produto B por R$ Y, etc., com a instrução de que **todos** os
produtos aparecem, nenhum em destaque exclusivo.

**3. Preço literal.**
Cada preço entra no prompt como string exata, com regra explícita de não
arredondar, não omitir e não inventar preço para produto sem preço
cadastrado.

### Rede de segurança

`buildFlyerContentReview`, irmã de `buildCatalogContentReview`
(`src/content-central.js:3780`), roda no mesmo loop de revisão que já
existe (`generateAiImageWithReviewLoop`) e checa:

- todos os N produtos pedidos aparecem na arte;
- cada preço confere, dígito por dígito, com o cadastrado;
- nenhum produto que não foi selecionado apareceu.

Reprovou, o loop regenera sozinho — comportamento que já existe hoje, só
com uma checklist nova.

## Tratamento de erro

- Nenhum produto selecionado, ou mais de 12: erro de validação no endpoint,
  antes de gastar geração.
- Produto sem preço: gera, com aviso no `contentReview` e instrução de não
  inventar preço. Não bloqueia — mercado às vezes anuncia produto sem preço.
- Produto sem foto: gera, com aviso. O modelo desenha o produto a partir do
  nome.
- Falha na geração da imagem: mesmo caminho de erro que a agenda já tem
  (`imageGenerationError` no item, visível no Aguardando).

## Testes

- `generateFlyerContent` cria um item por formato, com a data e a hora
  pedidas, status aguardando aprovação, e canais de mesmo formato
  compartilhando `creativeGroupKey`.
- `generateFlyerContent` não move `nextScheduleTopicIndex` nem
  `nextPillarSequenceIndex`.
- Tópico `flyer` com 12 produtos envia 12 fotos de produto, cada uma com o
  rótulo do seu produto e preço.
- Tópico não-flyer continua cortando em 2 fotos — trava de não-regressão do
  caminho da agenda.
- Tópico `flyer` não emite a instrução de produto herói
  (`Não trocar ... por outro produto`).
- `buildFlyerContentReview` avisa em produto sem preço e em produto sem
  foto.
- Endpoint rejeita lista vazia e lista com mais de 12.
- A aba Flyer envia grupo e produtos avulsos corretamente e mostra a lista
  de flyers gerados.

## Riscos

**O modelo errar preço com 12 itens.** É o risco central e não é
eliminável: modelos de imagem renderizam texto numérico mal em densidade
alta. As três travas e o loop de revisão reduzem, não zeram. O operador
corrige pelo "regenerar com nota" que já existe na tela de aprovação.

**Plano B, se errar demais na prática:** renderizar a grade em HTML/CSS e
capturar com Playwright, que já é dependência do projeto (`playwright`,
`sharp` em `package.json`). Preço vira texto real, sempre exato, e a foto
real do produto entra sem passar por modelo generativo. Nada do que está
desenhado aqui é jogado fora nessa troca — muda só o produtor da imagem;
cadastro, seleção, canais, data e fila de aprovação continuam iguais.

**Custo de geração.** 12 fotos de referência por peça é bem acima das 2-3
de hoje. Vale medir o tempo e o custo por flyer antes de liberar para
vários clientes.
