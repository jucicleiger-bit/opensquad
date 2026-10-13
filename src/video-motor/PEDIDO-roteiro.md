# Etapa 1: roteiro de um vídeo vertical (Reels)

Você está na pasta do vídeo. Leia `briefing.json` (assunto, objetivo, duração, tom, observação), `marca.json` (marca e identidade do cliente) e `material.json` (material real disponível: artes de Stories aprovados e fotos cruas, com o caminho absoluto).

Leia também `REGRAS.md` e os exemplos em `exemplos/` (são de formato; NÃO copie o visual nem a estrutura deles: cada vídeo é novo).

Entregue só nesta pasta:
1. `roteiro.json` no formato `{ "cenas": [ { "tipo": "<nome-curto-da-cena>", "fala": "<texto falado>", "descricao": "<o que aparece na tela, em uma ou duas frases>", "segura": <segundos, opcional> } ], "objetos": { opcional, prompts em inglês }, "estilo_imagens": "opcional" }`. Escreva a fala no estilo Reels (frases curtas, perguntas, exclamações). Tamanho: cerca de 2,6 palavras por segundo para caber na duração do briefing. Feche de acordo com o objetivo (REGRAS.md § Objetivo do vídeo).
2. Copie para `fotos/` as imagens do `material.json` que você vai usar (o pedido que você recebeu diz se a marca tem logo em `fotos/logo.png`).
3. `NOTAS.md` com o conceito visual em 3 a 6 linhas.

Só escreva nesta pasta; não altere nada em `<MOTOR>` (player, render, regras, exemplos). Se aprender uma lição nova, anote no `NOTAS.md` deste vídeo.

Não gere voz, não gere imagens, não renderize. Se houver `ajuste.txt`, ele traz o pedido de ajuste do operador sobre o roteiro atual: aplique-o.

**Oferta:** se o briefing tiver `oferta`, leia `produtos.json` e REGRAS.md § Oferta antes de escrever. Se existir `roteiro-modelo.json`, parta dele; se não existir, parta do `roteiro.json` atual (que pode ter edições do operador) e devolva com marcadores no lugar dos preços.
