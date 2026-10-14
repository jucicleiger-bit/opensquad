# Regras para criar um vídeo

## Princípio

Cada vídeo nasce do zero a partir do assunto e da narrativa. Não se reaproveita nada de um vídeo anterior: estrutura, cenas, metáforas, objetos, animações, transições, fundo, tipografia, estilo de legenda e jeito de fechar.

As cenas de cada vídeo ficam em `cenas.js` na pasta do vídeo (veja os exemplos em `exemplos/`) e os objetos em `objetos/`. O motor (`src/video-motor/`) só cuida da parte técnica: o tempo preso às palavras da fala (`A('palavra')`), a voz (`python tts.py <pasta>`), a legenda, os efeitos sonoros e o render (`node render.mjs <pasta> --stills …`).

## Fixo da marca

Vem do cadastro e do Raio-X do projeto:
- **Logo e WhatsApp.**
- **Identidade visual.** No caso da King: preto e branco como base, #FFD100 só em destaques e CTA, tipografia forte e legível, sem poluição visual.
- **Tom do Raio-X, quando fizer sentido.** No caso da King: claro, direto e educativo, perguntas que geram reflexão, CTA para conversa ou diagnóstico, nunca prometer resultado.

## Objetivo do vídeo (vem do briefing)

- **Alcance:** ser visto e ganhar seguidor. Fecha com uma **enquete** (pergunta com opções que puxa comentário) **ou** pedindo para salvar/compartilhar, quando o vídeo for dica, receita ou lista; sempre com o convite para seguir. Entre 20 e 45 segundos.
- **Anúncio:** converter e gerar conversa no WhatsApp. Dor, solução, prova e oferta. Fecha com CTA direto: WhatsApp com número. Entre 15 e 30 segundos.
- **Oferta:** VT de mercado com os produtos de `produtos.json` (veja § Oferta). Fecha com validade, endereço e WhatsApp.
- **Institucional:** apresenta a empresa (história, bastidores, diferencial). Sem preço e sem venda dura. Fecha com a marca e o convite para seguir.
- **Aviso:** comunicado curto (feriado, novo horário, chegou mercadoria). Direto, sem venda e sem enquete. Fecha com o horário ou o endereço. Cerca de 15 segundos.

## Formato

- **Reels:** o padrão. A interface do Instagram cobre a faixa de baixo e a lateral direita.
- **Story/Status do WhatsApp:** mais curto (15 a 30 s), fecha sempre chamando no WhatsApp, nunca usa enquete (no Status ninguém comenta). Sem os botões do Reels por cima: a legenda pode ficar mais baixa.

## Estilo (direção opcional; "livre" = você decide)

- **dinamico:** cortes rápidos, muito movimento, energia de Reels viral.
- **mercado:** cara de encarte animado: preço grande, amarelo e vermelho, explosões e selos de oferta.
- **premium:** calmo e elegante: fundo escuro ou neutro, tipografia fina, movimentos lentos, muito respiro.
- **informativo:** claro e didático: tópicos numerados, ícones simples, texto de apoio legível.

## Voz

- **Padrão: `"voz": "gemini:Puck"`** (Gemini TTS, plano grátis). A direção vai em `"direcao"`. Padrão: criador de conteúdo animado. Para anúncio, use "vendedor simpático de loja de bairro". O Whisper (`alinhar.py`) marca o tempo das palavras.
- Ordem automática quando algo falha: **Gemini TTS** (10 pedidos/dia e 3 por minuto no grátis) → **Gemini Live** `gemini-2.5-flash-native-audio-latest` (sem limite diário; mesma voz e direção; aprovado pelo operador como plano B) → **Brian** (Edge). O motor avisa qual voz usou.
- **Escreva a fala como se fala no Reels:** frases curtas, perguntas, exclamações, "ó", "aí", "bora", "prontinho". A pontuação muda a entonação, mesmo nas vozes grátis.

## Legenda

Escolha um modelo em `roteiro.json` com `"legenda": "<nome>"`: `simples`, `karaoke`, `pop`, `destaque` ou `caixa`. Para testar sem mexer no roteiro, use `render.mjs <pasta> --legenda <nome>`. Sem modelo, vale a legenda própria do vídeo (`VIDEO.legenda` no `cenas.js`). A cor de destaque vem de `marca.cor` e, por padrão, é o amarelo da King.

## Quem escreve

Os vídeos são escritos pelo Claude (decisão de 2026-10-10). O Codex ficou para as imagens, porque a cota da assinatura ChatGPT acaba rápido.

## Qualidade (vale para todo vídeo; acrescente cada lição nova aqui)

1. Tem algo na tela desde o primeiro quadro, nunca uma abertura vazia.
2. O momento-chave de cada cena fica pelo menos 1 segundo visível antes do corte.
3. Nunca passa mais de 1 segundo com a fala andando e a tela parada esperando.
4. A legenda precisa ser legível no fundo da cena. Em fundo claro, use texto escuro.
5. Nada importante embaixo da faixa da legenda.
6. O clímax do vídeo (a virada, a revelação, o "acender") fica pelo menos 2 segundos na tela antes do fechamento. Se a fala for curta, use `"segura": N` na cena: a imagem continua N segundos enquanto a narração já segue.
7. Quando um objeto some (desfaz, sai de cena), algo novo ocupa o lugar em até meio segundo. Nunca fique mais de 1 segundo só com texto parado onde antes havia imagem.
8. A narração é contínua, sem buracos de voz muda. O motor grava tudo de uma vez e encurta silêncios. Para dar respiro, segure a imagem, nunca a voz.
9. O logo precisa de contraste. O da King tem o K branco: em fundo claro, coloque-o sobre uma placa escura.
10. Material real (fotos de clientes, Stories aprovados) vale mais do que exemplo inventado. Procure no projeto antes de gerar imagem.


## Oferta (VT de mercado)

- Os produtos estão em `produtos.json` (na ordem escolhida pelo operador) e as fotos em `fotos/produto-<id>.*`. Os dados da loja (nome, endereço, WhatsApp, horário, validade) estão em `produtos.json` → `loja`.
- **Preço nunca é digitado.** Na fala, use `{preco}` (e `{precoDe}` só para produto com preço "de"); o sistema troca pelo preço por extenso do cadastro. `{unidade}` vira "a unidade", "o quilo"…; `{validade}` vira "domingo, dia 19" (só se houver validade). A fala de uma Oferta **não pode ter nenhum dígito**: escreva nomes e quantidades por extenso ("Omo de setecentos gramas").
- Cada produto tem uma cena com `"produto": "<id>"` e `{preco}` na fala. Ritmo de locutor: frases curtas e exclamações, nome do produto, preço, próximo.
- **Na tela**, preços só de `PRODUTOS[i].precoTela` e `PRODUTOS[i].precoDeTela` (risque o "de"). Nunca escreva um valor à mão no `cenas.js`.
- `fotoTipo`: `recorte` e `transparente` já vêm sem fundo (pode fazer o produto voar, girar, crescer); `moldura` é foto com fundo real: mostre dentro de um cartão ou moldura, nunca como recorte.
- **Layout de cada cena de produto** (palco de 540×960; vale também para a criação nova — a animação é livre, o tamanho não):
  - **Produto é o herói:** a foto ocupa pelo menos 432 px de altura (45% do palco) ou 432 px de largura (80%) — a própria imagem do produto, marcada `data-papel="produto"` —, centrada. Nunca um produto pequeno no alto com a tela vazia embaixo.
  - **Preço gigante:** `precoTela` num selo de encarte (explosão, estrela ou etiqueta amarela com borda/sombra), com os números em pelo menos 72 px de altura, colado ou sobreposto a um canto do produto. Ele entra no máximo quando a primeira palavra do preço é falada e fica **parado, inteiro e legível até o fim da cena** (pelo menos 1,5 s). Pode pulsar, mas nunca sai nem gira a ponto de dificultar a leitura. Vale para todo selo com texto ("BARATINHO", "OFERTA"): balança no máximo uns 20°, nunca gira sem parar (fica de cabeça para baixo).
  - **Preço "de"** (`precoDeTela`): riscado, pelo menos 34 px, logo acima ou ao lado do selo.
  - **Nome do produto:** faixa no topo, pelo menos 30 px.
  - **Área segura do Reels:** tudo que importa fica entre x 24 e 460 e entre y 110 e 800 (a lateral direita e a faixa de baixo ficam sob os botões e a legenda do Instagram). Nada cortado na borda.
  - **Sem legenda palavra por palavra:** numa Oferta, o texto da tela é o nome e o preço (o formulário já escolhe "Sem legenda").
  - **Confira nos stills:** um still por produto logo depois da fala do preço. O produto precisa estar grande e o preço inteiro e legível. Se não estiver, corrija antes de entregar.
- **Moldura** (`roteiro.moldura`): o player carrega `vt/kit.js` (`window.VT`) e `vt/molduras/<id>/moldura.js` (`window.MOLDURA`) antes do `cenas.js` e desenha sozinho a camada fixa (logo, selo da campanha, validade, rodapé). Você não remove nem cobre essa camada. Pode reaproveitar `MOLDURA.tipos` e `MOLDURA.transicao` ou criar os seus tipos por cima, mas:
  - o preço é sempre `VT.precoHtml(produto)` (e o "de" `VT.deHtml(produto)`), entrando com `VT.carimbo` ou `VT.contagem` no `VT.momentoPreco(A, produto, …)`;
  - a imagem do produto leva `data-papel="produto"`; faixas de nome `data-papel="nome"`; selos com texto `data-papel="selo"`;
  - as curvas de movimento estão em `VT.ease` (medidas em filmes profissionais): chegada desacelera (`softLand`, `snapSettle`), saída acelera (`accelExit`), nada nasce do zero — chega de um tamanho maior e assenta.
  - Antes de entregar: `node <MOTOR>/checar.mjs .` tem que imprimir `ok`.
- Fecho: validade (se houver), endereço e WhatsApp.
- **VT padrão** (`criacao: padrao`): as cenas são exatamente `abertura`, uma `produto` por produto na ordem de `produtos.json`, e `fechamento`. O visual é o modelo fixo; escreva só as falas.
