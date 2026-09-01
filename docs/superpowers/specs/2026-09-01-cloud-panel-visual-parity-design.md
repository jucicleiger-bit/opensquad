# Divisão nuvem/local — Fase 3c: painel da nuvem com a mesma cara e navegação do local

## Contexto

O painel local (`src/content-central-server.js`'s `renderApp()`) é um único
HTML com um bloco `<style>` inline (~19KB de CSS puro, sem framework) e uma
casca de 3 colunas: cabeçalho com métricas, barra lateral (`.sidebar`, lista
de projetos), menu de seções (`.section-nav`, 8 abas) e área de trabalho
(`.workspace-main`), trocando de aba via JS sem navegar (`switchTab()`).

O `cloud-panel-app` (React + react-router) foi construído fase a fase com
estilo próprio simples (`style={{...}}` inline por página, sem shell
compartilhado) — visualmente e estruturalmente diferente do local. O
usuário pediu explicitamente: igual **exatamente**, porque do jeito que
está no computador "tá 100% funcional".

## Decisão central

Reaproveitar o CSS do local **literal, byte a byte** — copiar o bloco
`<style>` inteiro de `renderApp()` pra um arquivo CSS novo no
`cloud-panel-app`, sem reescrever nem aproximar. Isso garante paridade
visual real (mesmas cores, cards, sombras, gradientes, animações), não uma
imitação.

Navegação: local troca de aba sem mudar URL (`switchTab()`, uma página
só). O painel da nuvem **mantém rotas do react-router** (uma URL por
página, já existente) mas o menu de seções usa exatamente as mesmas
classes CSS (`.section-nav`, `.tab-button`, `.tab-button.active`) — visual
idêntico, clique também não recarrega a página (react-router já não
recarrega), só a URL muda (isso ajuda a favoritar/compartilhar link, sem
piorar nada visualmente). Geração de conteúdo por IA (abas "Agenda e
geração" e "Teste seguro" do local) fica de fora — é Fase 4, sem
equivalente na nuvem ainda.

## Escopo desta fase

### 1. CSS compartilhado

- Novo arquivo `cloud-panel-app/src/styles/design-shell.css`: cópia
  literal do bloco `<style>` de `src/content-central-server.js`'s
  `renderApp()` (linhas 5510-5528 hoje). Importado uma vez em
  `cloud-panel-app/src/main.tsx`.
- Nenhuma classe renomeada, nenhuma cor ajustada. Se uma classe usada
  localmente não existir ainda pro que a nuvem precisa (não deveria
  acontecer — o CSS cobre `.field-card`, `.grid`, `.row`, `.pill`,
  `.step`, `.notice`, `.empty-state`, `.stat-grid`, `.checklist`,
  `.reference-gallery`, `.content-card` etc., tudo que as páginas atuais
  já usam em espírito), documentar e resolver caso a caso — não inventar
  classe nova sem necessidade.

### 2. Casca compartilhada (`AppShell`)

Novo componente `cloud-panel-app/src/components/AppShell.tsx`, usado por
toda página autenticada (substitui os `<div style={{maxWidth:720,...}}>`
soltos de cada página hoje):

```
<header><div class="hero">...métricas (projetos, selecionado)...</div></header>
<main class="wrap design-shell">
  <aside class="card sidebar"> lista de projetos (.projects/.project), clicável, mesmo visual do local </aside>
  <nav class="card section-nav"> um <Link> por página, estilizado .tab-button, .active via useLocation() </nav>
  <section class="workspace-main"> {children} </section>
</main>
```

Barra lateral (`.sidebar`): só a lista de projetos — **sem** o formulário
"Novo projeto" do local (criar projeto continua exclusivo do local, fora
de escopo da nuvem desde a Fase 1).

Menu de seções (`.section-nav`) muda de conteúdo conforme o contexto:
- **Dentro de um projeto** (`/projects/:id/...`): Visão geral, Empresa/
  Raio-X, Referências, Ofertas e Pilares, Conteúdos gerados (Aprovação),
  Calendário, Aprendizado, Conta.
- **Fora de projeto** (`/aprendizado/...`, `/conta`): Tipos de Oferta,
  Templates de Segmento, Conta — mesma barra lateral de projetos
  continua visível (clicar num projeto leva pra visão geral dele).

### 3. Mapeamento página↔aba (o que já existe, só reformatado)

| Aba local | Página cloud | Ação |
|---|---|---|
| Visão geral | **nova**: `Overview.tsx` | Criar — `.stat-grid` simples (projetos, itens aguardando aprovação) + atalhos, mesmo espírito do local, dados que a nuvem já tem |
| Empresa / Raio-X | `Company.tsx` | Reformatar pra `.field-card`/`.grid`/`.pill`, sem mudar lógica |
| Referências e imagem | `References.tsx` | Reformatar pra `.reference-gallery`/`.reference-card`, sem mudar lógica |
| Ofertas e assuntos | `OffersAndPillars.tsx` | Reformatar pra `.field-card`/`.format-grid`, sem mudar lógica |
| Conteúdos gerados | `Approval.tsx` | Reformatar pra `.content-card`/`.content-preview`, sem mudar lógica |
| (sem equivalente local) | `Calendar.tsx` | Reformatar pro mesmo visual de card, fica como aba extra da nuvem |
| (sem equivalente local, é novo) | `SegmentLearning.tsx` | Reformatar, vira aba "Aprendizado" dentro do projeto |
| Conta e token | `Account.tsx` | Reformatar pra `.field-card` |
| (fora de projeto) | `OfferTypeLearning.tsx`, `SegmentTemplates.tsx` | Reformatar, ficam nas abas globais |
| Agenda e geração, Teste seguro | — | Fora de escopo (Fase 4, geração por IA) |

`Login.tsx` fica fora da casca (`AppShell` exige projeto/sessão) — só
reaproveita cores/botões do CSS compartilhado num cartão centralizado
simples, mesmo tratamento visual sem o menu de 3 colunas.

### 4. O que NÃO muda

- Nenhuma lógica de dados, nenhuma chamada Supabase, nenhum schema.
  Puramente visual/estrutural — trocar `style={{...}}` inline por classes
  do CSS compartilhado, envolver em `AppShell`.
- Convenção de commit/teste continua igual (Vitest só testa lógica pura;
  páginas continuam sem teste de componente, mesmo padrão de sempre).

## Testes

- Nenhum teste novo de lógica (essa fase não mexe em lógica). Verificação
  é `npm run build` limpo + conferência visual manual (comparar lado a
  lado com o painel local rodando).

## Fora de escopo / próximas fases

- Geração de conteúdo por IA na nuvem (abas "Agenda e geração"/"Teste
  seguro") — Fase 4.
- Criar projeto pela nuvem — segue exclusivo do local.
- Wizard guiado de criação / tela de edição dedicada (visão mais distante
  já registrada em memória do usuário) — não é objetivo desta fase, que é
  só igualar ao que já existe local, não redesenhar além disso.
