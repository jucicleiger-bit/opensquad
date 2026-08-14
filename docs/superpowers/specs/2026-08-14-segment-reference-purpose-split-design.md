# Referência de Produto vs Referência de Estrutura de Criativo — Design

## Problema

O Aprendizado de Segmento (spec [2026-08-13-segment-layout-references-design.md](2026-08-13-segment-layout-references-design.md)) já usa imagens aprovadas como referência visual real de composição (`role: 'layout_model'`) na geração por IA. Mas hoje só existe UM tipo de imagem: qualquer upload vira automaticamente "modelo de composição", mesmo quando a intenção do operador é outra — ensinar como um alimento/produto real do segmento realmente se parece (textura, montagem, plausibilidade), não como o post é estruturado visualmente.

Além disso, se o operador compilar várias fotos reais de pizza/esfiha/salgado (da internet ou próprias) com a intenção de "ensinar o produto", usar o mesmo tratamento estrito de referência única e fixa faria a IA travar sempre na mesma foto — ruim para quem posta muitos Stories seguidos.

## Estado atual (verificado)

- `content-central-app/src/api/client.ts:162-176` (`SegmentLearningEntry`): `kind: "text" | "image"`, sem nenhum campo de "intenção"/propósito da imagem.
- `content-central-app/src/pages/AprendizadoSegmento.tsx` + `content-central-app/src/components/LearningGallery.tsx`: uma única caixa "Adicionar imagem de referência" por nó (Setor/Nicho/Especialidade), sem distinção de tipo.
- `src/content-central.js:6678-6710` (`buildSegmentLayoutReferences`, `MAX_SEGMENT_LAYOUT_REFERENCES = 1`): pega a imagem aprovada MAIS RECENTE entre os nós aplicáveis do projeto, sempre com `role: 'layout_model'` e a mesma instrução fixa de composição.
- `src/content-central-server.js:1320` (`selectOpenAiImageEditReferences`) e `~2106` (`selectImageReferencesForCodex`): tratam qualquer referência `role: 'layout_model'` como especial — nunca vira a única/imagem-líder de uma edição (`/v1/images/edits`), sempre reserva exatamente 1 vaga dentro do orçamento de referências do provedor, em vez de perder por posição no array pra referências próprias do projeto (logo, foto de produto).
- Essa proteção (nunca virar canvas de edição sozinha, vaga reservada) foi construída e testada especificamente pra `layout_model` — é exatamente a proteção que uma nova "referência de produto" também precisa, pelo mesmo motivo (poderia vir de outro projeto do mesmo segmento).

## Design

### Reaproveitar o papel `layout_model`, diferenciar só por instrução e origem

Referência de Produto usa o **mesmo `role: 'layout_model'`** já protegido nos dois seletores de provedor — evita duplicar a lógica "nunca vira canvas sozinha, reserva vaga" pra um papel novo. A única mudança nesses dois seletores é generalizar de "reserva exatamente 1 vaga `layout_model`" pra "reserva até 2 vagas `layout_model`" (1 de estrutura de criativo + 1 de produto, quando ambas existirem).

### Novo campo `purpose` na entrada

`SegmentLearningEntry` ganha `purpose?: "product" | "creative"`, só relevante pra `kind: "image"`. Entrada sem o campo (toda imagem já aprovada hoje) é tratada como `"creative"` — comportamento atual, sem mudança de efeito prático nas imagens já aprovadas.

### Seleção diferente por tipo

`buildSegmentLayoutReferences` passa a montar até 2 referências, não 1:
- **Criativo** (como já é hoje): a mais recente aprovada com `purpose !== 'product'`, instrução de composição existente, inalterada.
- **Produto** (novo): sorteada aleatoriamente entre todas as aprovadas com `purpose === 'product'` nos nós aplicáveis — a cada geração pode sair uma foto diferente do pool, em vez de travar sempre na mesma. Instrução fixa nova: *"Referência de produto real aprovada no aprendizado de segmento: use como inspiração de como esse alimento/produto realmente se parece (textura, montagem, plausibilidade) — não copie esta foto específica, o prato, o fundo ou a marca dela."*

Se só um dos dois tipos tiver imagem aprovada, entra só esse (sem exigir os dois juntos). Se nenhum, comportamento igual a hoje sem segmento configurado — nenhuma referência extra.

### Interface

Em `AprendizadoSegmento.tsx`/`LearningGallery.tsx`: a caixa única "Adicionar imagem de referência" vira duas, lado a lado ou empilhadas — **"Referência de produto"** e **"Referência de estrutura de criativo"** — cada upload já salva com o `purpose` certo. A lista de imagens já aprovadas mostra a marcação (ex: uma etiqueta pequena "Produto" ou "Criativo" ao lado da miniatura), sem misturar visualmente os dois tipos.

`LearningGallery` é componente compartilhado com `AprendizadoTipoOferta` — o novo comportamento (duas caixas, campo `purpose`) só aparece quando o consumidor pedir (prop nova opcional); `AprendizadoTipoOferta` não passa essa prop e continua exatamente como está, uma caixa só, sem `purpose`.

### Fora de escopo

- Sugestão automática de regras a partir de padrões de posts aprovados — descartado agora, aprendizado continua sendo "o pool cresce conforme eu uso" (confirmado pelo usuário).
- Aprendizado por Tipo de Oferta não ganha essa separação (confirmado pelo usuário) — sem mudança nessa tela/rota.
- Editar uma entrada já salva (só existe apagar+recriar hoje) — problema pré-existente, fora do escopo desta mudança.

## Testes

- Uma imagem aprovada como `purpose: 'product'` e outra como `purpose: 'creative'` (ou sem `purpose`, legado) no mesmo nó: `buildSegmentLayoutReferences` retorna as duas, com instruções diferentes.
- Múltiplas imagens `purpose: 'product'` aprovadas: chamadas repetidas de `buildSegmentLayoutReferences` eventualmente retornam fotos diferentes (não sempre a mesma) — teste determinístico via injeção de uma função de sorteio substituível, não `Math.random()` direto.
- `selectOpenAiImageEditReferences`/`selectImageReferencesForCodex` com 2 referências `layout_model` simultâneas (produto + criativo) e um projeto sem nenhuma referência própria: nenhuma das duas vira canvas de edição sozinha — mesmo comportamento de proteção que já existe pra 1, agora validado pra 2.
- Entrada de imagem sem `purpose` (legada) continua sendo tratada como criativo, sem regressão nos testes já existentes da spec anterior.
