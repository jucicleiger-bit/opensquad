// Products for Oferta videos: prices (parsed, spoken, on screen), the
// product listing and per-video snapshot, product photos (classification and
// white-background cutout) and the narration placeholders that keep prices
// out of Claude's hands.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Jimp } from 'jimp';
import { getCentralPaths } from './content-central.js';

export const MAX_PRODUTOS = 10;
export const PRODUTOS_POR_DURACAO = { 15: 2, 30: 5, 45: 8, 60: 10 };
// ponytail: one number for every product; tune after the operator watches real VTs.
export const SEGUNDOS_POR_PRODUTO = 4;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function parsePreco(text) {
  const s = String(text ?? '').replace(/^\s*R\$\s*/i, '').trim();
  const m = s.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?$/);
  return m ? Number(m[1].replace(/\./g, '')) * 100 + Number(m[2] || 0) : null;
}

const UNIDADES_FALA = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(r < 20 ? UNIDADES_FALA[r] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES_FALA[r % 10]}` : ''));
  return partes.join(' e ');
}

function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes = [];
  if (mil) partes.push(mil === 1 ? 'mil' : `${ate999(mil)} mil`);
  if (resto) partes.push(ate999(resto));
  // "mil e cem", "mil e vinte", but "mil duzentos e trinta e quatro".
  return partes.join(mil && resto && (resto < 100 || resto % 100 === 0) ? ' e ' : ' ');
}

// VT convention: "treze e noventa e nove"; "reais" only for whole amounts.
export function precoPorExtenso(centavos) {
  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  if (!reais) return `${inteiroPorExtenso(cents)} centavos`;
  if (!cents) return `${inteiroPorExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`;
  return `${inteiroPorExtenso(reais)} e ${inteiroPorExtenso(cents)}`;
}

export function precoNaTela(centavos) {
  const reais = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${reais},${String(centavos % 100).padStart(2, '0')}`;
}

// Looks at the four corners: alpha means a cutout, near-white means a studio shot.
export async function classificarFoto(path) {
  const { bitmap } = await Jimp.read(path);
  const { width: w, height: h, data } = bitmap;
  const cantos = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => (Math.max(0, y) * w + Math.max(0, x)) * 4);
  if (cantos.some((i) => data[i + 3] < 20)) return 'transparente';
  if (cantos.every((i) => Math.min(data[i], data[i + 1], data[i + 2]) > 235)) return 'branco';
  return 'fundo';
}

// Flood-fills near-white from the borders only, so white inside the product
// (labels, packaging) stays; softens the 1px rim and crops to the product.
export async function recortarFundoBranco(src, dst) {
  const im = await Jimp.read(src);
  const { width: w, height: h, data } = im.bitmap;
  const branco = (k) => {
    const i = k * 4;
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    return data[i + 3] > 0 && min >= 232 && Math.max(data[i], data[i + 1], data[i + 2]) - min <= 18;
  };
  const fora = new Uint8Array(w * h);
  const pilha = [];
  for (let x = 0; x < w; x++) pilha.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) pilha.push(y * w, y * w + w - 1);
  while (pilha.length) {
    const k = pilha.pop();
    if (fora[k] || !branco(k)) continue;
    fora[k] = 1;
    const x = k % w;
    if (x > 0) pilha.push(k - 1);
    if (x < w - 1) pilha.push(k + 1);
    if (k >= w) pilha.push(k - w);
    if (k < w * (h - 1)) pilha.push(k + w);
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let k = 0; k < w * h; k++) {
    const x = k % w;
    const y = (k - x) / w;
    if (fora[k]) { data[k * 4 + 3] = 0; continue; }
    const borda = (x > 0 && fora[k - 1]) || (x < w - 1 && fora[k + 1]) || (y > 0 && fora[k - w]) || (y < h - 1 && fora[k + w]);
    if (borda) data[k * 4 + 3] = Math.min(data[k * 4 + 3], 170);
    if (data[k * 4 + 3] > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  if (x1 >= x0) im.crop({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  await im.write(dst);
}

// Every active registered offer, with why it can't go in a video (if so).
export async function listarProdutosVideo(project, targetDir) {
  const base = getCentralPaths(targetDir, project.projectId).projectDir;
  const assets = new Map((project.offerAssets || []).map((a) => [a.id, a]));
  const out = [];
  for (const o of project.contentStrategy?.offers || []) {
    if (o.active === false || (o.type && o.type !== 'offer')) continue;
    const preco = parsePreco(o.price);
    const de = parsePreco(o.originalPrice);
    const asset = (o.photoReferenceIds || []).map((id) => assets.get(id)).find((a) => a?.relativePath && existsSync(join(base, a.relativePath)));
    let motivo = !String(o.price || '').trim() ? 'sem preço' : preco == null ? 'preço inválido' : !asset ? 'sem foto' : null;
    let fotoTipo = null;
    if (!motivo) {
      // An unreadable file (webp, avif, corrupt) only disqualifies its own product.
      try { fotoTipo = await classificarFoto(join(base, asset.relativePath)); } catch { motivo = 'sem foto'; }
    }
    const precoDe = preco != null && de != null && de > preco ? de : null;
    out.push({
      id: o.id, nome: o.name, preco, precoDe,
      precoTela: preco != null ? precoNaTela(preco) : '', precoDeTela: precoDe ? precoNaTela(precoDe) : '',
      unidade: o.priceUnit || '', validoAte: o.validUntil || '', previewUrl: asset?.previewUrl || '',
      foto: asset?.relativePath || null,
      fotoTipo,
      motivo,
    });
  }
  return out;
}

export function normalizeOferta(input, disponiveis, duracao) {
  const lista = Array.isArray(input?.produtos) ? input.produtos : [];
  if (!lista.length) throw httpError(400, 'Escolha pelo menos um produto.');
  if (lista.length > MAX_PRODUTOS) throw httpError(400, `No máximo ${MAX_PRODUTOS} produtos por vídeo.`);
  if (duracao !== 'auto' && lista.length > PRODUTOS_POR_DURACAO[duracao]) throw httpError(400, `${duracao}s cabe até ${PRODUTOS_POR_DURACAO[duracao]} produtos.`);
  const porId = new Map(disponiveis.map((p) => [p.id, p]));
  const vistos = new Set();
  const produtos = lista.map((item) => {
    const p = porId.get(String(item?.id));
    if (!p) throw httpError(400, `Produto não encontrado: ${item?.id}`);
    if (p.motivo) throw httpError(400, `${p.nome}: ${p.motivo}.`);
    if (vistos.has(p.id)) throw httpError(400, `${p.nome} foi escolhido duas vezes.`);
    vistos.add(p.id);
    // A real background is never faked as a cutout; white backgrounds follow the operator's toggle.
    const fotoTipo = p.fotoTipo === 'transparente' ? 'transparente' : p.fotoTipo === 'fundo' || item.foto === 'moldura' ? 'moldura' : 'recorte';
    return { id: p.id, nome: p.nome, preco: p.preco, precoDe: p.precoDe, unidade: p.unidade, fotoOrigem: p.foto, fotoTipo };
  });
  return {
    produtos,
    validoAte: /^\d{4}-\d{2}-\d{2}$/.test(String(input?.validoAte || '')) ? input.validoAte : '',
    criacao: input?.criacao === 'padrao' ? 'padrao' : 'nova',
    precosEm: new Date().toISOString().slice(0, 10),
  };
}

const MARCADOR = /\{(\w+)\}/g;
const PERMITIDOS = new Set(['preco', 'precoDe', 'unidade', 'validade']);
const cenasDe = (roteiro) => (Array.isArray(roteiro?.cenas) ? roteiro.cenas : []).filter((c) => c && typeof c === 'object');

export function validateRoteiroOferta(roteiro, oferta) {
  const erros = [];
  const cenas = cenasDe(roteiro);
  const porId = new Map(oferta.produtos.map((p) => [p.id, p]));
  cenas.forEach((c, i) => {
    const fala = String(c.fala || '');
    const p = c.produto != null ? porId.get(String(c.produto)) : null;
    if (c.produto != null && !p) erros.push(`Cena ${i + 1}: produto desconhecido "${c.produto}".`);
    if (/\d/.test(fala)) erros.push(`Cena ${i + 1}: sem dígitos na fala; use {preco} para preços e escreva o resto por extenso (número).`);
    for (const [, nome] of fala.matchAll(MARCADOR)) {
      if (!PERMITIDOS.has(nome)) erros.push(`Cena ${i + 1}: marcador desconhecido {${nome}}.`);
      else if (nome === 'validade') { if (!oferta.validoAte) erros.push(`Cena ${i + 1}: {validade} sem data de validade.`); }
      else if (!p) erros.push(`Cena ${i + 1}: {${nome}} fora de uma cena de produto.`);
      else if (nome === 'precoDe' && !p.precoDe) erros.push(`Cena ${i + 1}: ${p.nome} não tem preço "de".`);
      else if (nome === 'unidade' && !p.unidade) erros.push(`Cena ${i + 1}: ${p.nome} não tem unidade.`);
    }
  });
  for (const p of oferta.produtos) {
    if (!cenas.some((c) => String(c.produto) === p.id && /\{preco\}/.test(String(c.fala || '')))) erros.push(`Falta a cena de ${p.nome} com {preco}.`);
  }
  if (oferta.criacao === 'padrao') {
    const esperado = ['abertura', ...oferta.produtos.map((p) => `produto:${p.id}`), 'fechamento'];
    const atual = cenas.map((c) => (c.tipo === 'produto' ? `produto:${c.produto}` : c.tipo));
    if (JSON.stringify(atual) !== JSON.stringify(esperado)) erros.push(`VT padrão: as cenas devem ser ${esperado.join(', ')}.`);
  }
  return erros;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export function validadePorExtenso(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${DIAS[d.getDay()]}, dia ${d.getDate()}`;
}

const UNIDADE_FALA = {
  kg: 'o quilo', g: 'a grama', '100g': 'os cem gramas', un: 'a unidade', L: 'o litro', 'dúzia': 'a dúzia', pacote: 'o pacote',
  caixa: 'a caixa', fardo: 'o fardo', bandeja: 'a bandeja', 'maço': 'o maço', lata: 'a lata', garrafa: 'a garrafa',
};

function expandirFala(fala, produto, validoAte) {
  return String(fala).replace(MARCADOR, (m, nome) => {
    if (nome === 'validade') return validoAte ? validadePorExtenso(validoAte) : m;
    if (!produto) return m;
    if (nome === 'preco') return precoPorExtenso(produto.preco);
    if (nome === 'precoDe') return produto.precoDe ? precoPorExtenso(produto.precoDe) : m;
    if (nome === 'unidade') return UNIDADE_FALA[produto.unidade] || produto.unidade || '';
    return m;
  });
}

export function expandirRoteiro(roteiro, oferta) {
  const porId = new Map(oferta.produtos.map((p) => [p.id, p]));
  return { ...roteiro, cenas: cenasDe(roteiro).map((c) => ({ ...c, fala: expandirFala(c.fala, porId.get(String(c.produto)), oferta.validoAte) })) };
}

// The review screen edits spoken text: every product scene must still say its price.
export function precosMantidos(cenas, oferta) {
  return oferta.produtos.flatMap((p) => {
    const falado = precoPorExtenso(p.preco);
    return cenasDe({ cenas }).some((c) => String(c.produto) === p.id && String(c.fala || '').includes(falado))
      ? [] : [`A fala de ${p.nome} precisa manter o preço "${falado}".`];
  });
}

export function legendaPostOferta(oferta, loja = {}) {
  const linhas = oferta.produtos.map((p) => `• ${p.nome}: ${p.precoDe ? `de ${precoNaTela(p.precoDe)} por ` : ''}${precoNaTela(p.preco)}`);
  const [, mes, dia] = (oferta.validoAte || '').split('-');
  return [
    `🛒 Ofertas${loja.nome ? ` no ${loja.nome}` : ''}!`, '', ...linhas, '',
    ...(oferta.validoAte ? [`Válido até ${dia}/${mes} ou enquanto durarem os estoques.`] : []),
    ...(loja.endereco ? [`📍 ${loja.endereco}`] : []),
    ...(loja.whatsapp ? [`📲 WhatsApp: ${loja.whatsapp}`] : []),
    '', '#ofertas #promoção #mercado #economia',
  ].join('\n');
}
