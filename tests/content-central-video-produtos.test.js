import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Jimp } from 'jimp';
import {
  parsePreco, precoPorExtenso, precoNaTela, classificarFoto, recortarFundoBranco, listarProdutosVideo, normalizeOferta,
  validateRoteiroOferta, expandirRoteiro, precosMantidos, legendaPostOferta, validadePorExtenso, PRODUTOS_POR_DURACAO,
} from '../src/content-central-video-produtos.js';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'video-produtos-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

// A 40x40 image: background color everywhere, a dark 20x20 square in the middle.
async function imagem(path, fundo) {
  const im = new Jimp({ width: 40, height: 40, color: fundo });
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) im.setPixelColor(0x202020ff, x, y);
  await im.write(path);
}

test('parsePreco reads Brazilian prices into cents', () => {
  assert.equal(parsePreco('R$ 13,99'), 1399);
  assert.equal(parsePreco('4,49'), 449);
  assert.equal(parsePreco('R$ 1.234,50'), 123450);
  assert.equal(parsePreco('R$ 10'), 1000);
  for (const bad of ['R297', '', null, 'grátis', '13,9']) assert.equal(parsePreco(bad), null, String(bad));
});

test('precoPorExtenso speaks prices the way a VT does', () => {
  assert.equal(precoPorExtenso(1399), 'treze e noventa e nove');
  assert.equal(precoPorExtenso(99), 'noventa e nove centavos');
  assert.equal(precoPorExtenso(29700), 'duzentos e noventa e sete reais');
  assert.equal(precoPorExtenso(123450), 'mil duzentos e trinta e quatro e cinquenta');
  assert.equal(precoPorExtenso(100), 'um real');
  assert.equal(precoPorExtenso(449), 'quatro e quarenta e nove');
  assert.equal(precoPorExtenso(10000), 'cem reais');
  assert.equal(precoPorExtenso(110050), 'mil e cem e cinquenta');
});

test('precoNaTela formats with thousands and two decimals', () => {
  assert.equal(precoNaTela(1399), 'R$ 13,99');
  assert.equal(precoNaTela(123450), 'R$ 1.234,50');
  assert.equal(precoNaTela(99), 'R$ 0,99');
});

test('classificarFoto tells transparent, white and real backgrounds apart', async () => {
  await withDir(async (dir) => {
    await imagem(join(dir, 'b.png'), 0xffffffff);
    await imagem(join(dir, 't.png'), 0x00000000);
    await imagem(join(dir, 'f.png'), 0x3366aaff);
    assert.equal(await classificarFoto(join(dir, 'b.png')), 'branco');
    assert.equal(await classificarFoto(join(dir, 't.png')), 'transparente');
    assert.equal(await classificarFoto(join(dir, 'f.png')), 'fundo');
  });
});

test('recortarFundoBranco clears the white around the product, keeps the product and crops', async () => {
  await withDir(async (dir) => {
    await imagem(join(dir, 'b.png'), 0xffffffff);
    await recortarFundoBranco(join(dir, 'b.png'), join(dir, 'out.png'));
    const out = await Jimp.read(join(dir, 'out.png'));
    assert.ok(out.bitmap.width <= 22 && out.bitmap.width >= 20, `width ${out.bitmap.width}`);
    const centro = out.getPixelColor(Math.floor(out.bitmap.width / 2), Math.floor(out.bitmap.height / 2));
    assert.equal(centro & 0xff, 0xff, 'center stays opaque');
  });
});

function projeto(dir, offers, assets) {
  return { projectId: 'p', contentStrategy: { offers }, offerAssets: assets };
}

test('listarProdutosVideo marks unusable offers with the reason', async () => {
  await withDir(async (dir) => {
    const proj = join(dir, '_opensquad', 'content-central', 'projects', 'p');
    await mkdir(join(proj, 'assets', 'references'), { recursive: true });
    await imagem(join(proj, 'assets', 'references', 'a.png'), 0xffffffff);
    const assets = [{ id: 'fa', relativePath: 'assets/references/a.png', previewUrl: '/x/a.png' }];
    const offers = [
      { id: 'ok', name: 'Fralda', type: 'offer', price: 'R$ 13,99', originalPrice: 'R$ 16,99', priceUnit: 'un', validUntil: '2026-10-19', photoReferenceIds: ['fa'] },
      { id: 'semp', name: 'Sem preço', type: 'offer', price: '', photoReferenceIds: ['fa'] },
      { id: 'inv', name: 'Inválido', type: 'offer', price: 'R297', photoReferenceIds: ['fa'] },
      { id: 'semf', name: 'Sem foto', type: 'offer', price: 'R$ 2,00', photoReferenceIds: [] },
      { id: 'inst', name: 'Institucional', type: 'institutional', price: '' },
      { id: 'off', name: 'Desligada', type: 'offer', price: 'R$ 1,00', active: false, photoReferenceIds: ['fa'] },
    ];
    const lista = await listarProdutosVideo(projeto(dir, offers, assets), dir);
    assert.deepEqual(lista.map((p) => [p.id, p.motivo]), [['ok', null], ['semp', 'sem preço'], ['inv', 'preço inválido'], ['semf', 'sem foto']]);
    const ok = lista[0];
    assert.deepEqual([ok.preco, ok.precoDe, ok.precoTela, ok.precoDeTela, ok.fotoTipo, ok.foto, ok.validoAte], [1399, 1699, 'R$ 13,99', 'R$ 16,99', 'branco', 'assets/references/a.png', '2026-10-19']);
  });
});

const disponiveis = [
  { id: 'a', nome: 'Fralda', preco: 1399, precoDe: 1699, unidade: 'un', foto: 'r/a.png', fotoTipo: 'branco', motivo: null },
  { id: 'b', nome: 'Café', preco: 1299, precoDe: null, unidade: '', foto: 'r/b.jpg', fotoTipo: 'fundo', motivo: null },
  { id: 'c', nome: 'Galão', preco: 1099, precoDe: null, unidade: 'un', foto: 'r/c.png', fotoTipo: 'transparente', motivo: null },
  { id: 'x', nome: 'Ruim', preco: null, precoDe: null, unidade: '', foto: null, fotoTipo: null, motivo: 'preço inválido' },
];

test('normalizeOferta snapshots products and enforces the limits', () => {
  const o = normalizeOferta({ produtos: [{ id: 'a', foto: 'moldura' }, { id: 'b', foto: 'recorte' }, { id: 'c' }], validoAte: '2026-10-19', criacao: 'padrao' }, disponiveis, 30);
  assert.deepEqual(o.produtos.map((p) => [p.id, p.fotoTipo, p.fotoOrigem]), [['a', 'moldura'], ['b', 'moldura'], ['c', 'transparente']].map(([id, t]) => [id, t, `r/${id}.${id === 'b' ? 'jpg' : 'png'}`]));
  assert.equal(o.criacao, 'padrao');
  assert.match(o.precosEm, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(normalizeOferta({ produtos: [{ id: 'a' }] }, disponiveis, 'auto').produtos[0].fotoTipo, 'recorte');
  const erro = (input, dur, re) => assert.throws(() => normalizeOferta(input, disponiveis, dur), (e) => e.status === 400 && re.test(e.message));
  erro({ produtos: [] }, 30, /pelo menos um/);
  erro({ produtos: [{ id: 'zz' }] }, 30, /não encontrado/);
  erro({ produtos: [{ id: 'x' }] }, 30, /preço inválido/);
  erro({ produtos: [{ id: 'a' }, { id: 'a' }] }, 30, /duas vezes/);
  erro({ produtos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, 15, /cabe até 2/);
  assert.equal(PRODUTOS_POR_DURACAO[60], 10);
});

const oferta = { produtos: [{ id: 'a', nome: 'Fralda', preco: 1399, precoDe: 1699, unidade: 'un' }, { id: 'b', nome: 'Café', preco: 1299, precoDe: null, unidade: '' }], validoAte: '2026-10-18', criacao: 'nova' };

test('validateRoteiroOferta checks every product, placeholder and digit', () => {
  const ok = { cenas: [
    { tipo: 'abre', fala: 'Olha só as ofertas!' },
    { tipo: 'p', produto: 'a', fala: 'Fralda IsaBaby, de {precoDe} por {preco}!' },
    { tipo: 'p', produto: 'b', fala: 'Café Mapagi’s por {preco}!' },
    { tipo: 'fim', fala: 'Só até {validade}!' },
  ] };
  assert.deepEqual(validateRoteiroOferta(ok, oferta), []);
  const ruim = { cenas: [
    { tipo: 'p', produto: 'a', fala: 'Fralda por 13,99 e {brinde}' },
    { tipo: 'p', produto: 'b', fala: 'Café de {precoDe} por {preco}' },
    { tipo: 'p', produto: 'zz', fala: 'Outro {preco}' },
    { tipo: 'fim', fala: 'Corre {preco}' },
  ] };
  const erros = validateRoteiroOferta(ruim, oferta).join(' | ');
  for (const re of [/dígitos|número/, /\{brinde\}/, /Café não tem preço "de"/, /produto desconhecido "zz"/, /\{preco\} fora de uma cena de produto/, /Falta a cena de Fralda/]) assert.match(erros, re);
});

test('VT padrão requires abertura, one produto per product in order, fechamento', () => {
  const padrao = { ...oferta, criacao: 'padrao' };
  const bom = { cenas: [
    { tipo: 'abertura', fala: 'Ofertas da semana!' },
    { tipo: 'produto', produto: 'a', fala: 'Fralda por {preco}!' },
    { tipo: 'produto', produto: 'b', fala: 'Café por {preco}!' },
    { tipo: 'fechamento', fala: 'Corre pra cá!' },
  ] };
  assert.deepEqual(validateRoteiroOferta(bom, padrao), []);
  const fora = { cenas: [bom.cenas[0], bom.cenas[2], bom.cenas[1], bom.cenas[3]] };
  assert.match(validateRoteiroOferta(fora, padrao).join(' '), /VT padrão/);
});

test('expandirRoteiro speaks prices and the validity; precosMantidos guards edits', () => {
  const r = expandirRoteiro({ cenas: [
    { tipo: 'p', produto: 'a', fala: 'Fralda de {precoDe} por {preco}, {unidade}!' },
    { tipo: 'fim', fala: 'Só até {validade}!' },
  ] }, oferta);
  assert.equal(r.cenas[0].fala, 'Fralda de dezesseis e noventa e nove por treze e noventa e nove, a unidade!');
  assert.equal(r.cenas[1].fala, `Só até ${validadePorExtenso('2026-10-18')}!`);
  assert.equal(validadePorExtenso('2026-10-18'), 'domingo, dia 18');
  assert.deepEqual(precosMantidos(r.cenas, { ...oferta, produtos: [oferta.produtos[0]] }), []);
  const editada = [{ ...r.cenas[0], fala: 'Fralda baratinha!' }];
  assert.match(precosMantidos(editada, { ...oferta, produtos: [oferta.produtos[0]] }).join(' '), /Fralda.*treze e noventa e nove/);
});

test('legendaPostOferta lists products with screen prices', () => {
  const txt = legendaPostOferta(oferta, { nome: 'Mercado Carvalho', endereco: 'Rua 58, 19', whatsapp: '65 99311-8774' });
  assert.match(txt, /Fralda: de R\$ 16,99 por R\$ 13,99/);
  assert.match(txt, /Café: R\$ 12,99/);
  assert.match(txt, /18\/10/);
  assert.match(txt, /Rua 58, 19/);
  assert.match(txt, /#ofertas/);
});

test('listarProdutosVideo survives an unreadable photo', async () => {
  await withDir(async (dir) => {
    const proj = join(dir, '_opensquad', 'content-central', 'projects', 'p');
    await mkdir(join(proj, 'assets', 'references'), { recursive: true });
    await imagem(join(proj, 'assets', 'references', 'a.png'), 0xffffffff);
    await writeFile(join(proj, 'assets', 'references', 'x.png'), 'nao sou imagem');
    const assets = [
      { id: 'fa', relativePath: 'assets/references/a.png', previewUrl: '/x/a.png' },
      { id: 'fx', relativePath: 'assets/references/x.png', previewUrl: '/x/x.png' },
    ];
    const offers = [
      { id: 'ruim', name: 'Ruim', type: 'offer', price: 'R$ 2,00', photoReferenceIds: ['fx'] },
      { id: 'ok', name: 'Ok', type: 'offer', price: 'R$ 3,00', photoReferenceIds: ['fa'] },
    ];
    const lista = await listarProdutosVideo(projeto(dir, offers, assets), dir);
    assert.deepEqual(lista.map((p) => [p.id, p.motivo, p.fotoTipo]), [['ruim', 'sem foto', null], ['ok', null, 'branco']]);
  });
});

test('{unidade} speaks every registered unit and is refused without a unit', () => {
  const um = (unidade) => ({ produtos: [{ id: 'a', nome: 'Água', preco: 500, precoDe: null, unidade }], validoAte: '', criacao: 'nova' });
  const cenas = [{ tipo: 'p', produto: 'a', fala: '{preco}, {unidade}!' }];
  assert.equal(expandirRoteiro({ cenas }, um('L')).cenas[0].fala, 'cinco reais, o litro!');
  assert.equal(expandirRoteiro({ cenas }, um('dúzia')).cenas[0].fala, 'cinco reais, a dúzia!');
  assert.match(validateRoteiroOferta({ cenas }, um('')).join(' '), /Cena 1: Água não tem unidade\./);
  assert.deepEqual(validateRoteiroOferta({ cenas }, um('L')), []);
});
