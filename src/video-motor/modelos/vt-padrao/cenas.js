/* global window */
// VT padrão: the chosen frame (window.MOLDURA, loaded by the player from
// roteiro.moldura) assembled as is. Every price comes from produtos.json
// through the kit; Claude writes only the lines. Scenes: abertura, produto × N, fechamento.
window.VIDEO = { estrelas: false, tipos: window.MOLDURA.tipos, transicao: window.MOLDURA.transicao };
