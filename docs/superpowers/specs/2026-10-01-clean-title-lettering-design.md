# Letra limpa no título e estrutura só como estrutura — design

Data: 2026-10-01
Branch: `worktree-sabores` (ambiente de teste; nada vai para o master sem pedido explícito)

## Problema

As artes geradas saem com "cara de IA" no título. O operador nomeou dois
sinais:

- **pinguinhos**: tracinhos, faíscas, gotas e raios desenhados em volta do
  título — em quase toda arte;
- **letra desenhada**: título em letra de pincel, cursiva, cartoon, com
  contorno, 3D ou degradê — usada sempre, quando deveria aparecer só de vez
  em quando, nas artes em que faz sentido.

## Causas encontradas (lendo os prompts e as imagens reais)

1. **O briefing não diz como é a letra do título.** Todas as variantes de
   LIBERDADE CRIATIVA dizem "pode variar… tipografia". Nenhuma regra proíbe
   enfeite em volta do título (o Feed proíbe só faixa/ribbon/selo; o Story,
   nada). O único aviso é o genérico "evitar visual genérico de IA".
2. **A tipografia do cadastro da marca é ignorada.** O projeto
   `arthur-frios` tem "condensada comercial, título bold, sombras muito
   sutis"; a arte da Batata saiu com letra arredondada em degradê e
   pinguinhos.
3. **A estrutura anexada é tratada como referência de estilo.** A instrução
   geral que envolve o briefing diz "use as imagens de referência como base
   visual real" e "use as referências como direção visual/produto/estilo",
   sem separar a estrutura das outras referências. Cinco das dez estruturas
   de oferta de mercado / casa de frios / casa de embalagem são anúncios
   prontos, feitos em IA, com exatamente esses pinguinhos e letra de pincel
   (PRODUTO GIGANTE, PRODUTO + PREÇO GIGANTE, SELO PROMOCIONAL, PROBLEMA →
   SOLUÇÃO → PRODUTO, PRODUTO DE UM LADO / INFORMAÇÕES DO OUTRO). O briefing
   manda não copiar cor, logo e produto da estrutura — e não fala da letra
   nem dos enfeites. No modo "integração fotográfica" ele chega a dizer que a
   tipografia é "controlada pelo template".

A intenção do operador ao cadastrar as estruturas sempre foi só a estrutura:
onde fica cada bloco, tamanho e ordem.

## Comportamento desejado

### Em toda arte (qualquer tipo, Story e Feed)

- Nada em volta do título: sem tracinhos, faíscas, gotas, respingos, raios,
  estrelas, brilhos ou sublinhado em pincelada.
- A estrutura anexada vale só para posição, tamanho, ordem e proporção dos
  blocos. Não se copia dela o desenho das letras, os enfeites, texturas,
  fundo nem acabamento.

### Letra do título

- **Limpa (padrão):** letra de fôrma, pesada, cor chapada; sem contorno, 3D,
  relevo, degradê, brilho ou sombra pesada; nenhuma palavra em letra
  manuscrita, cursiva, de pincel ou cartoon. Quando a marca tem tipografia
  no cadastro, é ela que vale.
- **Desenhada (opcional):** só quando o operador escolhe, na oferta. Vale
  para o título; subtítulo, benefícios e preço continuam limpos. Os
  pinguinhos continuam proibidos.

### Quem escolhe

- Campo novo na oferta: **"Letra do título"** — "Limpa (padrão)" ou
  "Desenhada" —, ao lado de "Fundo do criativo".
- Arte sem oferta (data comemorativa, conteúdo, encarte, carrossel,
  anúncio) é sempre limpa.

## Design técnico

### Dado

- `offer.titleStyle`: `'clean' | 'lettering' | ''` — normalizado como
  `backgroundStyle` (valor fora da lista vira `''`).
- `offerToContentTopic` copia `titleStyle` para o tópico;
  `buildComboOfferTopic` usa `a.titleStyle || b.titleStyle`, como já faz com
  `backgroundStyle`.
- `buildCreativeSpec` ganha `title.style`: `normalizeTitleStyle(topic.titleStyle)`
  quando `topic.source === 'offer'`; `'clean'` para qualquer outra origem.
  Só `'lettering'` é opt-in; todo o resto é `'clean'`.

### Briefing (`buildChatGptFinalCardPrompt`)

- Nova seção **LETRA DO TÍTULO**, logo depois de ESTRUTURA … OBRIGATÓRIA,
  montada por `buildTitleLetteringLines(titleStyle, visualSystem)`
  (exportada, testável sozinha):
  - limpa: linha da letra (com a tipografia da marca quando houver), linha
    do preenchimento chapado, linha "nenhuma palavra manuscrita…", linha dos
    enfeites;
  - desenhada: linha liberando o lettering só no título, linha dos enfeites.
- LIBERDADE CRIATIVA: sai a palavra "tipografia" de todas as listas "pode
  variar…".
- REFERÊNCIA PRINCIPAL: linha nova, logo após "Força estrutural", dizendo
  que o modelo serve só para a estrutura. A "Regra de níveis" deixa de dizer
  que a tipografia é controlada pelo template.
- `SEGMENT_LAYOUT_REFERENCE_INSTRUCTION` passa a incluir "estilo das letras
  nem enfeites" no que não se copia.

### Instrução geral (`buildAiImageGenerationPrompt`, no servidor)

- "Use as referências como direção visual/produto/estilo…" ganha a exceção:
  o modelo de layout é só estrutura, nunca referência de estilo, letras ou
  enfeites. Referências visuais de verdade (`visual_reference`) continuam
  valendo como estilo.
- Quando há modelo de layout entre as referências, uma linha logo após a
  lista delas repete a regra.
- A lista "detalhes que denunciam IA" ganha os enfeites em volta do título.

### Manifesto de anexos do Codex (`buildCodexAttachmentManifest`)

Hoje só existe para encarte e oferta com sabores. Passa a existir também
quando há modelo de estrutura entre os anexos, e a linha dele diz para que
serve: "modelo de estrutura — usar só para posição, tamanho e ordem dos
blocos; não copiar letras, enfeites, cores, fundo, produto nem textos
dele". Sem isso o modelo recebe um anúncio pronto entre os anexos, sem
rótulo, e o lê como referência de estilo.

### Frontend

- `client.ts`: `titleStyle?: "clean" | "lettering" | ""` nos dois tipos de
  oferta.
- `Offers.tsx`: `EMPTY_FORM.titleStyle = "clean"`; a edição carrega
  `"lettering"` só quando a oferta tem esse valor; select "Letra do título"
  na mesma linha de "Fundo do criativo" (a linha tem 3 campos numa grade de
  2 colunas — o quarto preenche o espaço vazio).

## Fora de escopo

- Trocar as cinco estruturas "contaminadas" por versões limpas — é
  recadastro de imagem pelo operador, sem código. Fica como próximo passo se
  alguma ainda puxar os pinguinhos depois desta mudança.
- Letra desenhada automática por tipo de post ou por marca.
- Outros vícios de IA (selo de preço 3D, ondas no rodapé, fileira de
  ícones).
- A edição pontual ("Pedido de alteração"), que preserva a arte existente.

## Testes

Backend (`node --test`):

1. `buildTitleLetteringLines`: limpa sem marca; limpa com tipografia da
   marca; desenhada — e a linha dos enfeites presente nas três.
2. Oferta padrão em Story: briefing tem a seção LETRA DO TÍTULO limpa, a
   linha "serve só para a estrutura" e nenhuma lista "pode variar" com
   "tipografia".
3. Oferta com `titleStyle: 'lettering'`: briefing libera a letra desenhada,
   mantém a proibição de enfeites; `creativeSpec.title.style === 'lettering'`.
4. Tópico sem oferta com `titleStyle: 'lettering'` continua limpo.
5. `saveProjectOffer` guarda `titleStyle` válido e descarta inválido.
6. `buildAiImageGenerationPrompt`: com modelo de layout, traz a regra de
   "só estrutura"; sem ele, não.
7. `buildCodexAttachmentManifest`: oferta comum com modelo de estrutura
   ganha manifesto rotulando-o; sem modelo, continua vazio.

Frontend (`vitest`):

8. Campo "Letra do título" começa em "clean" e envia "lettering" quando
   escolhido.

Validação real (ambiente de teste): regenerar a arte do Treto (Story, com a
estrutura SELO PROMOCIONAL) e comparar com a anterior. A IA de imagem não
obedece 100%; o critério é a diferença visível antes/depois em algumas
artes.
