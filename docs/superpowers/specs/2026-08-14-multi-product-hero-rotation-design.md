# Destaque visual rotativo entre os produtos da própria oferta — Design

## Problema

`detectCreativeProductFocus` (`src/content-central.js:5314`) decide qual produto vira o "destaque visual" do criativo checando, nessa ordem fixa, se o texto da oferta (nome+itens+label+objetivo) contém `'esfiha'` e só depois `'pizza'`. Qualquer oferta cujo texto mencione as duas palavras — como o Rodízio da Boss (`items: "pizza salgado, pizza doce, batata frita, esfiha e frango frito"`) — trava **sempre** em "esfiha em destaque, evitar pizza", mesmo com pizza listada primeiro. O prompt de imagem chega a instruir explicitamente "O foco visual desta peça são esfihas, não pizzas" e "Evitar aparência de pizza grande, fatia de pizza ou mini pizza genérica" — contrariando a regra que o operador já aprovou no Aprendizado de Segmento ("sempre deixa a pizza como destaque na criação do rodizio").

Além do destaque errado, toda peça do Rodízio sai com a mesma composição (mesmos produtos, mesmo enquadramento) — ruim para quem posta o mesmo rodízio várias vezes por semana.

Existe uma função irmã com o mesmo problema: `detectReferenceTopicFocus` (`src/content-central.js:5296`), usada por `prioritizeReferencesByTopic` para priorizar qual foto de referência usar — mesma ordem fixa esfiha-antes-de-pizza.

## Estado atual (verificado)

- `detectCreativeProductFocus(topic, hasLinkedProductPhoto)` — único call site em `src/content-central.js:5068`, dentro da função que monta o prompt de imagem (`topic` = `contentTopic`, já contém `topic.sequence`, número sequencial do post dentro do lote, disponível nesse ponto).
- `detectReferenceTopicFocus(topic)` — único call site em `src/content-central.js:5493`, usado por `prioritizeReferencesByTopic` para reordenar `image.references` favorecendo fotos cujo nome/instrução batem com o produto em foco.
- `hashString(value)` (`src/content-central.js:7006`) — hash determinístico simples já usado em `buildTestCreativeVariation` (linha ~4370) para escolher de forma reprodutível entre variações, via `ARRAY[hashString(seed) % ARRAY.length]`. Mesmo padrão serve aqui.
- Cadastro de ofertas: o Rodízio da Boss já foi corrigido pelo operador para `type: 'rodizio'` (era `'offer'`); esse tipo não é usado hoje por nenhuma das duas funções de detecção (elas só olham texto, não `topic.type`).

## Design

### Sortear o destaque entre TODOS os produtos que já estão na oferta — sem campo novo, sem tela nova

Importante: o operador quer rotação entre **todos** os itens do rodízio (pizza, batata frita, frango, pizza doce, esfiha — 5 produtos), não só entre as 2 palavras hoje hardcoded (pizza/esfiha). A correção não amplia o vocabulário fixo — ela **abandona o vocabulário fixo** para o caso de oferta com vários produtos, e passa a usar a lista de itens de verdade, exatamente como o operador escreveu.

**Quando `topic.items` tem 2 ou mais produtos** (quebra simples por vírgula, e a última parte por " e "/"&" — ex: "pizza salgado, pizza doce, batata frita, esfiha e frango frito" vira 5 itens: `["pizza salgado", "pizza doce", "batata frita", "esfiha", "frango frito"]`):
- Escolhe **um** desses itens como destaque desta geração específica, de forma determinística (não `Math.random()` puro, para o teste ficar reprodutível) — usando `hashString` (já existe no arquivo, mesmo padrão de `buildTestCreativeVariation`) sobre um identificador estável do post (`topic.offerId` + `topic.sequence`) módulo a quantidade de itens.
- Monta as linhas de hero/composição/restrição de forma genérica, plugando o texto do item escolhido (ex: `1. Batata frita real em destaque como produto principal.` / `O foco visual desta peça é batata frita.`) — não usa mais os textos específicos de "esfihas abertas"/"pizza com queijo" para esse caso.

**Quando `topic.items` tem só 1 produto (ou está vazio)** — oferta de produto único, ex: "Esfihas Salgadas" — nada muda: mantém os branches hoje existentes (`text.includes('esfiha')`/`text.includes('pizza')`), com os textos específicos e detalhados de hoje intactos (são mais ricos que uma linha genérica, vale preservar pro caso comum de 1 produto só).

Isso resolve os dois problemas do operador ao mesmo tempo:
- **Pizza (e qualquer outro item) deixa de ser sistematicamente ignorado** — cada geração tem chance real de destacar qualquer produto listado, não trava mais em esfiha.
- **Variedade entre posts do mesmo rodízio** — como o seed muda por post (`sequence` diferente), rodízios gerados em dias diferentes tendem a destacar produtos diferentes, evitando a composição repetida.

`detectReferenceTopicFocus` segue a mesma regra (mesmo cálculo de item escolhido, mesmo `topic.offerId`+`topic.sequence`) — garante que a foto de referência priorizada bate com o produto que a composição está destacando, nunca um mismatch (composição de batata frita usando prioritariamente foto de esfiha).

### Fora de escopo

- Campo de configuração novo tipo "produto em destaque" no Aprendizado de Segmento — descartado explicitamente pelo operador ("não quero mais um trem pra configurar"); a lista de produtos já escrita no campo Itens da oferta é a única fonte usada.
- Ler/parsear o texto livre do Aprendizado de Segmento como regra estruturada — descartado; a correção usa só o que já está no cadastro da oferta.
- Textos de composição genéricos por item ("real em destaque como produto principal") não tentam replicar o nível de detalhe gastronômico que os branches hardcoded de pizza/esfiha têm hoje (textura, "esfihas abertas", etc.) — aceito como troca razoável, já que o problema era a escolha errada do produto, não a qualidade do texto de um produto específico.
- Corrigir/usar o campo `topic.type === 'rodizio'` recém-cadastrado — não é necessário para esta correção (a decisão é só por texto+seed), fica registrado como já corrigido no cadastro mas não é consumido por este código.

## Testes

- Oferta com `items` de 5 produtos (igual ao Rodízio da Boss), gerada com sequências diferentes (`topic.sequence` 1 a 5): confirma que o destaque varia entre os 5 produtos ao longo das sequências (não trava sempre no mesmo, e cada um dos 5 aparece pelo menos uma vez num range de sequências suficiente).
- Mesma oferta, mesma sequência, chamado duas vezes: resultado idêntico (determinístico, testável sem mocks de aleatoriedade).
- `detectCreativeProductFocus` e `detectReferenceTopicFocus` chamados com o mesmo `topic`: sempre escolhem o mesmo item (consistência entre composição e priorização de referência).
- Oferta com `items` de 1 produto só (ex: "Esfihas Salgadas", sem vírgula) ou `items` vazio: comportamento igual ao atual (branches hardcoded pizza/esfiha preservados), sem regressão nos testes já existentes dessas duas funções.
- Quebra de itens lida com "e" antes do último item e com item único sem vírgula nenhuma (ex: `items: "Esfihas Salgadas"` → 1 item, não quebra a palavra ao meio).
