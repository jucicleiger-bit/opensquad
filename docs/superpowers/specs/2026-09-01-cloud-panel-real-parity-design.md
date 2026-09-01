# Divisão nuvem/local — Fase 3c (corrigida): painel da nuvem no alvo certo

## Contexto — correção de rota

A Fase 3c anterior (commits já mergeados em `master`) copiou o CSS de
`src/content-central-server.js`'s `renderApp()` — que, como um comentário
no próprio arquivo deixa claro (`src/content-central-server.js:441-446`),
é o **painel legado, só acessível em `/classic`**. O painel oficial que
carrega em `/` localmente é outro app React inteiro:
`content-central-app/`, com sistema de design próprio documentado em
`content-central-app/design.md` e `content-central-app/src/styles/tokens.css`.
Essa fase substitui o trabalho anterior pelo alvo certo.

**O que NÃO muda de novo**: geração de conteúdo por IA continua fora de
escopo. Páginas locais reais como `workspace/Company.tsx` têm recursos
extras (análise de site por IA, sugestões de Raio-X) que **não são
replicados** — isso é Fase 4, igual sempre foi. Esta fase é só visual/
estrutural: mesmo sistema de cor/tipografia/espaçamento, mesma casca de
navegação, mesmos componentes base (`Button`/`Card`/`EmptyState`/
`Skeleton`), sem mexer em nenhuma lógica de dado já existente no painel
nuvem.

## Escopo desta fase

### 1. CSS real

Substitui `cloud-panel-app/src/styles/global.css` pelo conteúdo literal
de `content-central-app/src/styles/tokens.css` — cópia byte a byte, mesmo
princípio da fase anterior, dessa vez no arquivo certo (já é um `.css`
limpo, sem precisar extrair de template string).

### 2. Casca em duas camadas (não mais 3 colunas numa peça só)

- **`RootLayout`**: barra superior só com marca (`CC`/nome), sem lista de
  projeto ali — espelha `content-central-app/src/layouts/RootLayout.tsx`.
  Envolve TODA rota autenticada.
- **`ProjectWorkspaceLayout`**: rota-layout aninhada, só ativa dentro de
  `/projects/:id/*` — barra lateral (240px) com "← Todos os projetos",
  nome do projeto, nav agrupada (Configuração / Conteúdo / Conta) —
  espelha `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`.
  Fora de um projeto (Dashboard, páginas globais de Aprendizado, Conta)
  não tem barra lateral de projeto — só o `RootLayout`.
- Componentes pequenos, copiados como estão (são triviais, ver arquivos
  reais em `content-central-app/src/components/`): `Button` (prop
  `variant`: primary/secondary/ghost), `Card`, `EmptyState`, `Skeleton`.

### 3. Nav real (rótulos e agrupamento exatos onde existe equivalente local)

Baseado em `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`'s
`SECTIONS`, só as entradas que a nuvem já tem:

```
Visão geral               (sem grupo)
Empresa / Raio-X          Configuração
Imagem e identidade visual Configuração   ← nome exato de lá
Ofertas e assuntos        Configuração
Pilares                   Configuração   ← PÁGINA SEPARADA de Ofertas
Aguardando aprovação      Conteúdo       ← renomeia de "Conteúdos gerados"
Calendário                Conteúdo
Aprendizado               Conteúdo       ← só existe na nuvem, sem equivalente local direto
Conta e token             Conta
```

Rota `/projects/:id/aprovacao` renomeia pra `/projects/:id/aguardando`
(bate com o nome real da seção local).

### 4. Onde existe equivalente local claro → bate a cara real

- **Empresa** (`workspace/Company.tsx` real): usa `Card`+`.row`/`.grid`
  pro formulário, `page-head`-style título+subtítulo. **Não** replica o
  assistente de importar site por IA nem sugestões de Raio-X — só os
  campos que a nuvem já edita hoje, com o wrapper certo.
- **Ofertas** e **Pilares**: viram **duas páginas separadas**
  (`Offers.tsx`, `Pillars.tsx`), espelhando a separação real
  (`workspace/Offers.tsx`, `workspace/Pillars.tsx`). Cada uma lê o
  `content_strategy` inteiro, edita só seu pedaço, escreve de volta
  preservando o resto (mesmo padrão de sempre) — `Offers.tsx` ainda lê
  `pillars` (só leitura, pro dropdown de vínculo).
- **Aguardando aprovação** (era "Aprovação"): título renomeado. As classes
  `.content-card`/`.content-preview`/`.reference-gallery` da fase anterior
  **não existem** em `tokens.css` — confirmado, eram só do painel legado.
  O sistema real usa **CSS Modules por página** pra layout específico
  (`tokens.css` só define o que é genuinely compartilhado: `.card`,
  `.field-card`, `.grid`, `.row`, `.pill`, botões). Segue o padrão real de
  `content-central-app/src/pages/workspace/PendingApproval.module.css`:
  grid de 2 colunas (preview 160-220px | detalhes), classe local `.phone`
  pro preview de imagem (proporção 4:5 feed / 9:16 story conforme canal),
  `.caption`, `.actions`. `Approval.tsx` ganha seu próprio
  `Approval.module.css` espelhando essas classes (nomes iguais, cores/
  espaçamento de `tokens.css`).
- **Calendário**, **Conta**: só troca wrapper/classes, mesma lógica.

### 5. Onde NÃO existe equivalente local direto → mantém estrutura própria, mesmo sistema visual

- **Imagem e identidade visual**: a página real nesse nome faz outra
  coisa (logo + direção visual textual + pesquisa por IA) — não gerencia
  galeria de imagens de referência individuais. A galeria que a nuvem já
  tem (`References.tsx`, upload+categoria+peso+instrução por item) **não
  tem equivalente visual local pra copiar** — continua com layout próprio
  (grade de cards), só trocando pro sistema de design real (`Card`,
  `.field-card`, `.grid`, cores/tipografia de `tokens.css`) em vez de
  inventar visual novo.
- **Aprendizado** (3 páginas: Segmento, Tipo de Oferta, Templates): sem
  equivalente na nav real — mesma decisão, mesmo sistema visual, layout
  próprio.
- **Login**: fora da casca (não autenticado) — só cores/tipografia do
  sistema novo, mesmo tratamento da fase anterior.

## O que NÃO muda

- Nenhuma chamada Supabase, nenhuma lógica de negócio, nenhum schema.
- Convenção de teste igual: Vitest só cobre função pura; sem teste de
  componente (mesmo padrão de sempre).

## Testes

- Nenhum teste novo de lógica pura além do que a divisão Offers/Pillars
  possa precisar (se alguma função pura for extraída na separação).
- Verificação: `npm run build` limpo + conferência visual manual
  comparando com `content-central-app` rodando localmente.

## Fora de escopo / próximas fases

- Geração de conteúdo por IA (Fase 4).
- Assistente de importar site / sugestões de Raio-X.
- Qualquer recurso que a nuvem ainda não tinha antes desta fase.
