# Sistema de Aprendizado de Imagem (Segmento + Tipo de Oferta) — Design

## Problema

O gerador de imagem do Content Central tem pontos cegos de qualidade recorrentes no ramo alimentício (esfiha vem retangular em vez de redonda, sabores repetem, resultado "parece IA"). Hoje não existe onde registrar e reaproveitar esse tipo de correção:

- A aba **Referências e imagem** virou depósito único de tudo — logo, foto real de produto e inspiração visual competem no mesmo grid com categoria/função/prioridade, e a foto anexada numa oferta também vaza pra lá (mesmo array `project.brand.references`).
- Já existe aprendizado automático por segmento (`segment-learnings.json`, na raiz, fora de qualquer projeto), mas é 100% automático — populado só quando um post é aprovado/rejeitado — sem tela pra ler, editar ou alimentar manualmente, e só guarda texto, nunca imagem.
- Já existe instrução fixa por tipo de oferta (`offerObjective()` em `src/content-central.js:4086`), mas só 4 dos 10 tipos (`combo`, `rodizio`, `delivery`, `orientation`) têm texto real — os outros 6 caem num genérico — e o texto inteiro é hardcoded, invisível e não editável pelo usuário.

Objetivo: dar ao usuário acesso de leitura/edição a esse conhecimento (por segmento e por tipo de oferta), e um jeito de alimentá-lo com imagem, sem duplicar a aba Referências.

## Estado atual (verificado)

- `content-central-app/src/pages/workspace/References.tsx` — upload de logo, "direção visual"/"regras técnicas" em texto livre, pesquisa online (`researchOnline`, já é o padrão IA-analisa→funde-achados→preserva-texto-manual que este design reaproveita), e biblioteca de referências com `referenceCategory` (3 valores) × `usageRoles` (5 valores, multi-select) × `weight` (`low/medium/high`).
- `content-central-app/src/pages/workspace/Offers.tsx` — form de oferta já tem upload de foto de produto (`photoReferenceIds`), que hoje entra em `project.brand.references` (mesmo array da galeria geral) via `saveAsset({ kind: 'reference', ... })` (`src/content-central.js:933-962`).
- `content-central-app/src/pages/workspace/Company.tsx` — já tem hierarquia de segmento em 3 níveis: `segmentGroup` (Setor, ex. Alimentício) → `segmentCategory` (Nicho, ex. Pizzaria) → `segmentSpecialty` (Especialidade/subsegmento). Já tem campo `avoid` por projeto ("O que a IA nunca deve mencionar/sugerir") — fica como está, não faz parte deste design.
- `src/content-central.js`:
  - `projectSegmentKey()` (L3519) junta os 3 níveis numa string só e usa como chave achatada — sem herança entre níveis.
  - `segment-learnings.json` (raiz, `paths.segmentLearningsPath`) guarda `{ segments: { [key]: { approved: [], avoid: [], technical: [] } } }`, só texto, alimentado automaticamente por `addSegmentLearning()` (L3534) quando um post é aprovado (L2877) ou rejeitado (L3295).
  - `offerObjective(offer)` (L4086) retorna string fixa por `offer.type`; usado em `formatContentTopicLines()` (L4094) que monta o prompt de imagem.
  - `buildManual()` (L3681) e `buildImagePrompt()` (L3697) são os dois pontos que já leem `segmentLearnings`/`imageRules`/`references` pra montar o prompt final — este design estende os dois, não cria um terceiro caminho.

## Design

### A. Referências — encolhe

`References.tsx` passa a ter só duas coisas:
1. Upload de logo (mantém extração de cor, já existe).
2. Campo de direção visual consolidada (mantém `visualStyle`/`imageRules`/`researchOnline`, já existem).

Remove: biblioteca de referências com categoria/função/prioridade. A galeria inteira (`USAGE_ROLE_OPTIONS`, `REFERENCE_CATEGORY_LABELS` na UI de upload manual, cards com prioridade) some da tela — a função dela é assumida pelas peças B e C.

**Conserta o vazamento**: upload de foto dentro de `Offers.tsx` (`kind: 'reference'`, hoje cai em `project.brand.references`) passa a gravar num campo próprio da oferta (ex. `offer.photos`, fora do array geral de `references`), sem aparecer em nenhuma galeria compartilhada. `saveAsset()` no servidor ganha um modo que não escreve em `project.brand.references` quando a origem é uma oferta.

### B. Aprendizado de segmento — tela nova, hierárquica

Nova seção (dentro de Empresa/Raio-X, como sub-aba, já que é onde a hierarquia de segmento já é definida hoje).

**Estrutura de dados** (substitui a chave achatada por 3 buckets encadeados):

```
segment-learnings.json
{
  schemaVersion: 2,
  nodes: {
    "alimenticio": { label, entries: [ {id, kind: 'text'|'image', text, imagePath?, source: 'manual'|'auto', createdAt} ] },
    "alimenticio/pizzaria": { label, entries: [...] },
    "alimenticio/pizzaria/napolitana": { label, entries: [...] }
  }
}
```

Cada nível guarda só as próprias entradas. Montagem do prompt para um projeto soma as entradas do próprio nó **mais** as de todo ancestral (Especialidade herda de Nicho que herda de Setor) — implementado como um novo `resolveSegmentLearningChain(project)` que troca o uso direto de `loadSegmentLearningsForProject()` em `buildManual()`/`buildImagePrompt()`.

**Tela**: lista os 3 níveis do projeto atual (Setor / Nicho / Especialidade), cada um mostrando suas entradas hoje acumuladas (pré-preenchido com o que já existe, incluindo o que a migração do schema v1→v2 herdar) — texto editável/apagável, mais botão "adicionar" (texto ou upload de imagem). Upload de imagem roda o mesmo fluxo de `researchOnline`: IA descreve o que vê (ex. "esfiha redonda, borda dourada, sem recheio exposto") → usuário edita a descrição antes de salvar (não fica achado bruto de IA) → confirma → vira entrada `kind: 'image'`.

Migração: entradas existentes em `segment-learnings.json` v1 (chave achatada por projeto) migram pra dentro do nó de Nicho correspondente (nível 2), preservando o texto; nenhum dado se perde.

### C. Aprendizado por tipo de oferta — global, cross-segmento

Novo arquivo `offer-type-learnings.json` (raiz, mesmo padrão de `segment-learnings.json`, sem hierarquia — 10 buckets fixos, um por `OFFER_TYPE_LABELS`):

```
{
  schemaVersion: 1,
  types: {
    combo: { baseInstruction: "...", entries: [ {id, kind:'image', text, imagePath, createdAt} ] },
    ...
  }
}
```

`baseInstruction` por tipo é pré-preenchido com o texto hoje hardcoded em `offerObjective()` (os 4 tipos que já têm texto ganham ele; os outros 6 ganham o genérico atual como ponto de partida) — e passa a ser lido de `offer-type-learnings.json` em vez do `if/return` fixo no código.

Nova tela (dentro de Ofertas, ex. botão "Aprendizado por tipo" que abre um painel por tipo de oferta — reaproveita o padrão de seção recolhível já usado em `Offers.tsx` pra grupos): mostra o `baseInstruction` editável, mais galeria de imagens de estrutura/formato com o mesmo fluxo IA-analisa→edita→confirma de B. Diferença de foco na instrução dada à IA na hora de analisar a imagem: em B o objetivo é "isso é real/verdadeiro sobre o produto" (aparência), em C é "isso é uma estrutura/composição que funciona" (layout, hierarquia, onde fica o CTA) — mesmo componente de UI, prompt de análise diferente por contexto.

`formatContentTopicLines()` (L4094) passa a incluir as entradas aprovadas do tipo da oferta atual, junto com `offerObjective()` reescrito pra ler de `offer-type-learnings.json`.

### Componente compartilhado

B e C usam o mesmo componente de UI (`LearningGallery`): lista de entradas texto/imagem + form de "adicionar" (texto direto, ou upload → chama endpoint de análise → mostra resultado editável → confirma). Só muda: a chave de agrupamento (nó de segmento vs. tipo de oferta) e o prompt de análise enviado pra IA ao processar upload.

## Fora de escopo

- Campo `avoid` do Raio-X (Company.tsx) — já existe, não muda.
- Reorganização visual do resto do app (cards/botões/design system) — coberta por `.hermes/reports/content-central-ui-audit.md`, não faz parte deste design.
- Analytics/performance de anúncio ("como funciona" no sentido de métrica de resultado) — o que foi pedido é aprendizado de composição/estrutura visual, não dashboard de performance.

## Testes

- `saveAsset` com origem oferta não deve aparecer em `project.brand.references` (teste de regressão pro vazamento corrigido).
- `resolveSegmentLearningChain`: nó de Especialidade deve incluir entradas do Nicho e do Setor ancestrais; nó de Setor sozinho não deve incluir nada de baixo.
- Migração v1→v2 de `segment-learnings.json`: entrada antiga aparece no nó de Nicho correto após migração.
- `offerObjective`/leitura de `offer-type-learnings.json`: tipo sem `baseInstruction` customizado cai no genérico atual (comportamento hoje preservado).
