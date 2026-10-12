# Regras para criar um vídeo

## Princípio

Cada vídeo nasce do zero a partir do assunto e da narrativa. Não se reaproveita nada de um vídeo anterior: estrutura, cenas, metáforas, objetos, animações, transições, fundo, tipografia, estilo de legenda e jeito de fechar.

As cenas de cada vídeo ficam em `cenas.js` na pasta do vídeo (veja os exemplos em `exemplos/`) e os objetos em `objetos/`. O motor (`src/video-motor/`) só cuida da parte técnica: o tempo preso às palavras da fala (`A('palavra')`), a voz (`python tts.py <pasta>`), a legenda, os efeitos sonoros e o render (`node render.mjs <pasta> --stills …`).

## Fixo da marca

Vem do cadastro e do Raio-X do projeto:
- **Logo e WhatsApp.**
- **Identidade visual.** No caso da King: preto e branco como base, #FFD100 só em destaques e CTA, tipografia forte e legível, sem poluição visual.
- **Tom do Raio-X, quando fizer sentido.** No caso da King: claro, direto e educativo, perguntas que geram reflexão, CTA para conversa ou diagnóstico, nunca prometer resultado.

## Objetivo do vídeo (perguntar sempre antes do roteiro)

- **Reels de alcance:** o objetivo é ser visto e ganhar seguidor. Fecha com uma **enquete**, uma pergunta com opções que puxa comentário, mais o convite para seguir. Tom de identificação e reflexão, conteúdo que vale salvar. Entre 20 e 45 segundos.
- **Anúncio:** o objetivo é converter e gerar conversa no WhatsApp. Segue dor, solução, prova e oferta. Fecha com CTA direto: WhatsApp com número. A prova real (antes e depois de cliente) é essencial. Entre 15 e 30 segundos.

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
