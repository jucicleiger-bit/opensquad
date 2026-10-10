# Etapa 2: produção do vídeo aprovado

O `roteiro.json` desta pasta foi aprovado pelo operador. Não mude as falas nem a ordem das cenas (pode acrescentar `"segura"` se uma cena precisar de mais tempo de imagem).

1. Se o roteiro declara `objetos`, rode `node <MOTOR>/gen-images.mjs .` uma vez. Se falhar por limite, siga sem aquele objeto e anote no NOTAS.md.
2. Rode `python <MOTOR>/tts.py .` UMA vez (gera `voz/tempos.json`; a voz já está configurada no roteiro). Com `ajuste.txt`, não rode o tts de novo, a não ser que o ajuste peça mudança na voz.
3. Escreva `cenas.js` com as cenas só deste vídeo, seguindo `REGRAS.md` e o contrato do motor (`<MOTOR>/player.html`: helpers `st, p, eo, eio, back, lerp, flick, esc, asset, obj, R, S`; `A('palavra')` dá o instante da palavra na fala da própria cena). Use as fotos de `fotos/` com `asset('fotos/<arquivo>')`.
4. Confira: `node <MOTOR>/render.mjs . --stills 0.05,<vários instantes>` e olhe as imagens em `stills/`. Compare com as regras de qualidade 1 a 10 e corrija o `cenas.js` até todas valerem.
5. Escreva `legenda-post.txt` (legenda do post para o Instagram, com 3 a 6 hashtags) e atualize `NOTAS.md` (conceito, o que você conferiu, qualquer limitação).

Só escreva nesta pasta; não altere nada em `<MOTOR>` (player, render, regras, exemplos). Se aprender uma lição nova, anote no `NOTAS.md` deste vídeo. Em `roteiro.json` só o campo `"segura"` pode mudar (as falas, a ordem e a voz são fixas).

Não rode o render completo. Se houver `ajuste.txt`, ele traz o pedido de ajuste do operador sobre a prévia atual: aplique-o.
