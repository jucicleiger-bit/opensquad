# Imagens do Aprendizado de Segmento viram referência visual real na geração — Design

## Problema

Criativos gerados por IA (ex: Casa de Embalagem — papel alumínio, pote, pano de microfibra) ficam visualmente "mortos": título + uma linha de benefício solta, sem composição. O operador tem uma referência de mercado (anúncio da UpPro — blocos de benefício com ícone, selo de qualidade, hierarquia de título, rodapé com garantias) que gostaria que a IA usasse como modelo de composição.

Hoje o sistema só tem **texto** pra guiar a composição visual (observação da oferta + instrução base do tipo de oferta, ambas em `content-central.js`). Não existe caminho pra dizer "componha que nem ESSA imagem" — texto é um sinal bem mais fraco que uma imagem de referência real pra um gerador de imagem.

## Estado atual (verificado)

- `src/content-central.js:6503` (`buildImageReferencePayload(project, paths)`) monta a lista de referências passadas pro gerador de imagem — hoje só a partir de `project.brand.references` + `project.offerAssets` (referências do próprio projeto: logo, cor, direção visual, fotos de produto).
- O papel `layout_model` já existe e já funciona ponta a ponta (`REFERENCE_ROLES`, `referenceRoleLabel` → "Modelo de layout", seleção/priorização em `buildImagePrompt` por volta de `content-central.js:4838-5447`) — uma referência marcada `layout_model` já é tratada pela IA como "copiar composição/distribuição dos elementos", sem instrução adicional necessária.
- `content-central-app/src/pages/workspace/References.tsx` hoje só permite subir `role: "brand_asset"` (logo/cor/direção visual) — o caminho de UI que antes permitia marcar uma imagem como `layout_model` foi removido na spec anterior (2026-08-11, redução do escopo de Referências). Não existe hoje nenhum caminho de UI pra anexar uma imagem como modelo de composição.
- `AprendizadoSegmento.tsx` (spec 2026-08-12) já tem upload de imagem funcionando (`LearningGallery`, scope `segment`) — mas hoje essas imagens só contribuem com o **texto** da descrição da IA (`analyzeLearningImage`) pro prompt (`content-central.js:4454`: `learningEntries: ... .map((entry) => entry.text)`); o arquivo de imagem em si nunca é passado como referência real pro gerador.
- Primeira ideia (usar o Aprendizado por TIPO de oferta como fonte) foi descartada: esse aprendizado é global cruzando segmentos — uma imagem aprovada de "oferta direta" de qualquer cliente (ex: Casa de Embalagem) poderia vazar como referência de composição pra uma pizzaria, o que não faz sentido visualmente. O Aprendizado de Segmento já resolve exatamente esse tipo de vazamento pro aprendizado em texto (Setor/Nicho/Especialidade) — a mesma partição serve pra imagem.

## Design

### Fonte: Aprendizado de Segmento, não tipo de oferta

`buildImageReferencePayload` passa a (também) puxar as entradas `bucket: 'approved'`, `kind: 'image'` dos nós de segmento aplicáveis ao projeto (os mesmos nós cumulativos — Setor, Setor+Nicho, Setor+Nicho+Especialidade — que `loadSegmentLearningsForProject` já usa pro aprendizado em texto). Isso reaproveita a partição que já existe: pizzaria só vê imagens aprovadas em Alimentício/Pizzaria; Casa de Embalagem só vê as do seu próprio Setor/Nicho.

### Como entra na geração

- Pega até as **3 imagens mais recentes** aprovadas (somando os níveis aplicáveis) — ponytail: teto fixo, sem toggle por imagem por enquanto; se o corte automático pegar a imagem errada, o próximo passo natural é um toggle "usar como referência" por entrada, não um sistema novo.
- Cada uma entra na lista de referências com `role: 'layout_model'`, `weight: 'medium'` (mesmo padrão já usado por outras referências desse papel) e a instrução fixa já usada hoje pra esse papel ("usar como modelo de composição/distribuição dos elementos — não copiar marca, produto ou cores da referência").
- O arquivo físico vem do diretório global de aprendizado (`paths.root/assets/learning/...`, ver spec 2026-08-12), não do diretório do projeto — `buildImageReferencePayload` precisa resolver o caminho absoluto de forma diferente pra essas entradas (hoje ele assume `join(paths.projectDir, reference.relativePath)` pra tudo).
- `buildImageReferencePayload` passa a ser assíncrona (precisa ler o store global de segmento) — ondulação mecânica pelos ~7 pontos que já chamam essa função em `content-central.js` (marcar `await`), mesmo padrão de ondulação já feito antes pra `offerObjective` (spec 2026-08-11).

### Fora de escopo

- "Tom automático por grupo de ofertas" pra copy (a ideia original desta conversa, público food service vs limpeza/escritório) — fica registrada pra um spec separado, depois deste.
- Toggle manual por imagem pra incluir/excluir da lista de referência — não entra agora; o corte automático (3 mais recentes) resolve o caso comum.
- Projetos em modo catálogo (venda direta) — não usam geração de imagem por IA de jeito nenhum (compõem a foto real sem IA), então essa mudança não afeta esse modo.
- Cruzar tipo de oferta com segmento (a alternativa "manter tipo de oferta, mas só dentro do mesmo Setor") — descartada em favor de usar direto o Aprendizado de Segmento, que já resolve o mesmo problema sem precisar marcar Setor em cada entrada de tipo de oferta.

## Testes

- Duas ofertas do mesmo tipo em segmentos diferentes (ex: pizzaria vs Casa de Embalagem) geram `image.references` com `layout_model` diferentes, nunca cruzando.
- Projeto sem Setor/Nicho preenchido gera normal, sem nenhum `layout_model` extra (comportamento inalterado).
- Nó de segmento com mais de 3 imagens aprovadas só contribui com as 3 mais recentes.
- Entrada de imagem aprovada cujo arquivo não existe mais em disco é ignorada, sem derrubar a geração.
