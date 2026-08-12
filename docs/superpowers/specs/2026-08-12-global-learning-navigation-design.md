# Aprendizado de Segmento e por Tipo de Oferta — Fora do Projeto — Design

## Problema

`Aprendizado de segmento` e `Aprendizado por tipo de oferta` (construídos na spec [2026-08-11-image-learning-system-design.md](2026-08-11-image-learning-system-design.md)) guardam dado **global** — compartilhado entre todos os projetos do mesmo segmento, ou entre todo tipo de oferta de qualquer projeto — mas hoje só são acessíveis de dentro do sidebar de um projeto específico (`aprendizado-segmento` dentro de `/projects/:projectId/...`, painel "Aprendizado por tipo" dentro de `/projects/:projectId/ofertas`). Isso confunde: parece que o aprendizado pertence só àquele cliente, quando na verdade vale pra todo mundo do mesmo segmento/tipo.

## Estado atual (verificado)

- `content-central-app/src/App.tsx`: `/` (Dashboard) e `/projects/:projectId/*` são rotas irmãs sob `RootLayout` — dá pra adicionar rota nova fora de `/projects/:projectId` sem mexer na estrutura existente.
- `content-central-app/src/pages/Dashboard.tsx` (593 linhas): tela "Seus projetos", já grande — a área nova vira página própria, com um link a partir do Dashboard, não conteúdo embutido nele.
- `content-central-app/src/pages/workspace/Company.tsx:22`: `SEGMENT_TREE` (6 setores + categorias) é uma constante privada do arquivo — vira exportada de `client.ts` (mesmo padrão de `OFFER_TYPE_LABELS`), reaproveitada tal como está, sem editor/taxonomia nova.
- `src/content-central.js:3479-3513` (`segmentNodePaths`) deriva `rawGroup/rawCategory/rawSpecialty` de `project.companyProfile`/`project.brandInput`, monta os caminhos com tag por campo (`group:`/`category:`/`specialty:`), e `:3515` (`segmentNodeLabel`) monta o rótulo. A lógica central (dado os 3 textos crus) não depende de `project` — só a extração inicial depende.
- `src/content-central.js:3676` (`loadSegmentLearningNodes(paths, project)`) monta os 3 painéis (Setor/Nicho/Especialidade) a partir de um projeto.
- Rotas de aprendizado hoje vivem em `/api/projects/:id/segment-learnings/*` e `/api/projects/:id/offer-type-learnings` — o `:id` só é usado hoje pra (a) enriquecer o prompt de análise de imagem com contexto e (b) decidir em qual pasta de projeto salvar o arquivo de imagem enviado (`analyzeLearningImage` grava em `paths.projectDir`).
- `content-central-app/src/components/LearningGallery.tsx` recebe `projectId` como prop obrigatória e repassa pra `analyzeLearningImage`/`saveLearningEntry`/`deleteLearningEntry`.

## Design

### A. Duas páginas novas, fora de projeto

- `/aprendizado-segmento` (novo, fora de `/projects/:projectId`): tela com um seletor Setor → Nicho → Especialidade usando `SEGMENT_TREE` (mesma lista de hoje, sem "+"/taxonomia nova — Especialidade continua texto livre, como já é em Empresa/Raio-X). Ao escolher, mostra os mesmos 3 painéis que `SegmentLearning.tsx` já mostra hoje (reaproveita `LearningGallery` sem mudança de props/lógica interna).
- `/aprendizado-tipo-oferta` (novo, fora de `/projects/:projectId`): lista os 10 tipos de oferta com instrução base editável + `LearningGallery`, exatamente o painel que hoje mora dentro de `Ofertas.tsx` — só muda de tela, comportamento idêntico.
- `Dashboard.tsx` ganha só um link/botão pra cada uma (ex. ao lado de "+ Novo projeto"), sem conteúdo novo embutido na própria tela.
- Removido: item `aprendizado-segmento` do `SECTIONS` de `ProjectWorkspaceLayout.tsx` e sua rota aninhada; painel "Aprendizado por tipo" de dentro de `Offers.tsx`.

### B. Backend: aprendizado sai da URL de projeto

Como as duas páginas novas não têm projeto selecionado, as rotas HTTP precisam existir fora de `/api/projects/:id/...`:

- Novas rotas de nível raiz: `POST /api/segment-learnings/analyze-image`, `POST /api/segment-learnings/entries`, `POST /api/segment-learnings/entries-delete`, `GET /api/offer-type-learnings`, `POST /api/offer-type-learnings`. Mesmas funções de `content-central.js` por trás (`analyzeLearningImage`, `saveLearningEntry`, `deleteLearningEntry`, `loadOfferTypeLearning`, `saveOfferTypeBaseInstruction`) — só o dispatcher HTTP muda, a lógica de negócio não.
- `analyzeLearningImage` salva o arquivo enviado em `paths.projectDir` hoje — isso pressupõe um projeto. Sem tela de projeto na frente, não tem `projectDir` pra usar. Passa a salvar num diretório global (`_opensquad/content-central/assets/learning/...`, irmão de `projects/`, mesmo nível de `segment-learnings.json`) em vez de dentro de um projeto — resolve também a tensão já conhecida (imagem presa a projeto, dado global) apontada na revisão final da spec anterior.
- `segmentNodePaths(project)`/`segmentNodeLabel(project, level)` viram wrappers finos em cima de uma função pura nova (`segmentNodePathsFromFields(rawGroup, rawCategory, rawSpecialty)`/`segmentNodeLabelFromFields(...)`), reaproveitada por um novo `loadSegmentLearningNodesForSelection(paths, { segmentGroup, segmentCategory, segmentSpecialty })` — mesma lógica de `loadSegmentLearningNodes`, sem precisar de projeto.
- `LearningGallery` perde a dependência de vir de dentro de um projeto: `projectId` continua existindo como prop (usado hoje pra montar a URL da rota e o link da miniatura), mas passa a ser opcional — quando ausente, os componentes chamam as novas rotas de nível raiz em vez das aninhadas em `/api/projects/:id/...`.

### Fora de escopo

- Taxonomia editável de Setor/Nicho (botão "+", lista persistida e crescível) — descartado por enquanto a pedido do usuário, fica pra depois se precisar.
- Método de copy (AIDA e afins) por tipo de oferta — parte B, spec separada, depois desta.
- Qualquer mudança em como o aprendizado é somado/herdado entre Setor→Nicho→Especialidade — comportamento intocado, só a navegação e a rota HTTP mudam.

## Testes

- Backend: as 5 rotas novas de nível raiz fazem o mesmo que as aninhadas faziam (reuso de teste existente, adaptado pra bater na rota nova); `analyzeLearningImage` sem projeto grava no diretório global e o arquivo é servido corretamente por uma rota de assets também global.
- Frontend: as duas páginas novas renderizam fora de `/projects/:projectId`, seletor de segmento funciona com `SEGMENT_TREE`, `LearningGallery` funciona idêntico sem `projectId` vindo de contexto de projeto.
