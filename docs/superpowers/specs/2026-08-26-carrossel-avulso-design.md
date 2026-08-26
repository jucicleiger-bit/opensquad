# Carrossel avulso (aba nova por projeto, Content Central)

## Problem

Content Central hoje só produz post único por peça: 1 imagem por conteúdo
orgânico (feed/story), ou `combo` (2 ofertas na mesma arte,
`src/content-central.js:2476` região de `generateAdCreative` e o fluxo de
`nextSelectedOffer`/`buildComboOfferTopic`). Não existe nenhum caminho que
gere um post de **N imagens em sequência** (carrossel real de
Instagram/Facebook/WhatsApp feed).

## Goal

Uma aba nova, **por projeto** (Boss Pizzaria, Terço, King, ...), pra montar
carrossel avulso: usuário escreve um briefing + escolhe quantas folhas
(slides), a IA quebra o briefing em N partes e gera 1 imagem por parte,
usando marca/logo/referências do projeto já cadastradas. Cada slide pode
ser regenerado individualmente. **Sem calendário, sem aprovação, sem
publicação** — mesmo espírito de "Criativos de Anúncio"
(`content-central-app/src/pages/workspace/AdCreatives.tsx`): "separadas da
agenda orgânica: sem calendário, sem aprovação."

Publicar o carrossel de verdade (Instagram/Facebook feed multi-imagem,
WhatsApp) fica fora dessa etapa — é o objetivo final, mas não essa entrega.

## Modelo de referência: Ad Creatives

`AdCreative` (`src/content-central.js:2476-2621`) é o padrão mais próximo
já existente: 1 JSON por peça, fire-and-forget de geração de imagem em
background (`enqueueAdCreativeImageGeneration`), polling do front pra
progresso, regenerar sem mexer no resto. `Carousel` copia essa estrutura,
trocando "1 imagem" por "N imagens independentes, cada uma com seu próprio
estado de geração/erro/regeneração".

## Roteiro guiado pelos formatos do Opensquad

O passo de "quebrar o briefing em N slides" usa como referência de prompt
o conteúdo de `_opensquad/core/best-practices/instagram-feed.md` (já
existente no repo, usado hoje só por squads) — os 7 formatos de carrossel
(Editorial, Listicle, Tutorial, Mito vs Realidade, Antes e Depois,
Storytelling, Problema→Solução), a regra de duas camadas por slide
(headline + texto de apoio), e o slide de CTA no fim. O arquivo é **lido
do disco em tempo de execução** e injetado no prompt de IA — não é
copiado/duplicado no código, não é uma dependência de skill do Opensquad,
só texto de referência.

A IA escolhe sozinha o formato mais adequado ao briefing — sem pergunta
extra pro usuário nessa v1. `slideCount` do usuário é o número real de
slides gerados; a IA adapta o slide-flow do formato escolhido pra caber
nesse N (comprime ou expande as seções internas do formato).

## Data model

Novo diretório por projeto, paralelo a `adCreativesDir`
(`src/content-central.js:430`):

```
carouselsDir: join(projectDir, 'content', 'carousels')
```

1 arquivo `content/carousels/<carouselId>.json` por carrossel:

```
{
  schemaVersion: 1,
  carouselId, projectId,
  briefing: string,
  format: string,          // formato escolhido pela IA (ex: "listicle")
  slideCount: number,
  slides: [{
    slideId, order,
    slideText: string,     // headline + texto de apoio daquele slide
    role: string,          // "cover" | "content" | "cta"
    image: { localPath, prompt, references, aspectRatio, dimensions,
              generating, generatedSource, mimeType, version, previewDataUrl },
    imageGenerationError: string | null,
  }],
  outlineGenerationError: string | null,
  status: 'generating' | 'ready',
  createdAt, updatedAt,
  filePath,
}
```

Imagens em `content/carousels/images/<carouselId>-slide-<n>.svg`, mesmo
mecanismo de `writeGeneratedImage` já usado por ad creatives. Dimensão
fixa `instagram_feed` (1080x1080, via `imageDimensionsForChannel`/
`imageAspectRatioForChannel` já existentes) pra todo slide — carrossel
real do Instagram exige mesmo formato em todas as folhas.

## Geração — backend (`src/content-central.js`)

1. `buildCarouselOutlinePrompt({ project, briefing, slideCount })` —
   monta o prompt incluindo o texto relevante de `instagram-feed.md` +
   briefing do usuário + N. Mesmo padrão de `buildAdCopyPrompt`
   (`src/content-central-server.js:4056`, next ao uso de `callAiText`).

2. `generateCarousel(projectId, { briefing, slideCount })`:
   - Chama a IA de texto (`callAiText`, injetado como em
     `writeAdCopyVariationsWithHermes`) com o prompt acima, espera um
     array JSON de `slideCount` itens (`slideText`, `role`).
   - Cria o registro `Carousel` com todos os slides `image.generating:
     true`, `status: 'generating'`, salva, retorna rápido pra rota HTTP
     responder (mesmo fire-and-forget de `enqueueAdCreativeImageGeneration`).
   - Falha na chamada de roteiro → `outlineGenerationError` preenchido,
     carrossel salvo com 0 slides, sem lançar erro pra rota (mesmo padrão
     de `copyGenerationError` em `writeAdCopyVariations`).

3. `enqueueCarouselImageGeneration(projectId, carousel, options)`:
   dispara em background, gera 1 imagem real por slide em paralelo
   limitado (`mapWithConcurrency`, mesmo teto de `BATCH_IMAGE_CONCURRENCY
   = 3` já usado no batch orgânico), via `generateAiImageWithReviewLoop`
   — prompt de cada slide usa `slideText` + marca/logo/referências do
   projeto (`buildImagePrompt`, `getProjectLogoReference`,
   `buildImageReferencePayload`, iguais aos de `generateAdCreative`).
   Erro de um slide fica isolado nele (`imageGenerationError`); os demais
   seguem normalmente — mesmo comportamento de
   `enrichBatchItemsWithRealImages` pra falhas por item.
   Quando todos os slides terminam (sucesso ou erro), `status: 'ready'`.

4. `regenerateCarouselSlide(projectId, carouselId, slideId)`: refaz só a
   imagem daquele slide (mesmo "regenerar só a imagem" de
   `regenerateAdCreative`), roteiro e outros slides intactos.

5. `listCarousels` / `deleteCarousel`: iguais ao padrão de
   `listAdCreatives`/`deleteAdCreative` (ler todos os `.json` do
   diretório / apagar 1 arquivo por id).

## API (`src/content-central-server.js`)

Mesmo formato de rota de `ad-creatives` (`content-central-server.js:715,
1106, 1138, 1146`):

- `GET /api/projects/:id/carousels` → `listCarousels`
- `POST /api/projects/:id/carousels` → `{ briefing, slideCount }`, cria +
  enfileira geração de roteiro e imagens
- `POST /api/projects/:id/carousels-regenerate-slide/:carouselId/:slideId`
- `POST /api/projects/:id/carousels-delete/:carouselId`

## Frontend

- `content-central-app/src/pages/workspace/Carousels.tsx`, mesmo
  esqueleto de `AdCreatives.tsx`: form (briefing + input numérico de
  quantidade de slides) → grid de slides (placeholder enquanto
  `generating: true`, polling via `listCarousels`), cada slide com botão
  "Regenerar esse slide".
- Nova rota `carrossel` em `App.tsx` (ao lado de `anuncios`, linha ~54).
- Novo item de nav em `ProjectWorkspaceLayout.tsx`
  (`{ to: "carrossel", label: "Carrossel", group: "Conteúdo" }`, ao lado
  da entrada de `anuncios` na linha 24).
- Novas funções em `content-central-app/src/api/client.ts`:
  `listCarousels`, `generateCarousel`, `regenerateCarouselSlide`,
  `deleteCarousel` — mesmo padrão de `listAdCreatives`/
  `regenerateAdCreative`.

## Testing

- `generateCarousel`: roteiro com exatamente `slideCount` partes; falha
  da IA de texto → `outlineGenerationError` preenchido, rota não quebra.
- Geração de imagem: 1 imagem por slide; falha em 1 slide isolada, outros
  seguem OK (mesmo padrão do batch orgânico existente).
- `regenerateCarouselSlide`: só o slide alvo muda; roteiro e outros
  slides do carrossel intactos.
- `listCarousels`/`deleteCarousel`: espelham os testes já existentes de
  ad creatives.

## Out of scope

- Publicar o carrossel de verdade (Instagram/Facebook feed multi-imagem,
  WhatsApp) — próxima etapa, feita à parte; pode reaproveitar
  `skills/instagram-publisher` do Opensquad ou replicar a lógica dele,
  decisão de quando essa etapa for desenhada.
- Entrar no fluxo de agenda/aprovação de conteúdo orgânico.
- Upload manual de imagem — só geração por IA nessa v1.
- Escolha manual de formato (Listicle/Tutorial/etc) pelo usuário — a IA
  escolhe sozinha; virar opção do usuário fica pra depois se pedirem.
- Qualquer mudança nos squads do Opensquad ou em
  `skills/instagram-publisher` — essa entrega só lê
  `instagram-feed.md` como referência de texto, não toca no sistema de
  squads.
