import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function carregarKit() {
  const ctx = { window: {}, Math, String, Number, Array, Object, JSON };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(await readFile(new URL('../src/video-motor/vt/kit.js', import.meta.url), 'utf8'), ctx);
  return ctx.VT;
}

test('precoPartes splits reais and centavos, thousands kept', async () => {
  const VT = await carregarKit();
  assert.deepEqual({ ...VT.precoPartes('R$ 13,99') }, { moeda: 'R$', reais: '13', centavos: '99' });
  assert.deepEqual({ ...VT.precoPartes('R$ 0,99') }, { moeda: 'R$', reais: '0', centavos: '99' });
  assert.deepEqual({ ...VT.precoPartes('R$ 1.299,90') }, { moeda: 'R$', reais: '1.299', centavos: '90' });
});

test('precoHtml marks preco and reais, shows the unit; deHtml only with a de price', async () => {
  const VT = await carregarKit();
  const html = VT.precoHtml({ precoTela: 'R$ 13,99', unidade: 'un' });
  assert.match(html, /data-papel="preco"/);
  assert.match(html, /data-papel="reais"[^>]*>13</);
  assert.match(html, /99/);
  assert.match(html, /a unidade/);
  assert.equal(VT.deHtml({ precoTela: 'R$ 13,99', precoDeTela: '' }), '');
  assert.match(VT.deHtml({ precoTela: 'R$ 13,99', precoDeTela: 'R$ 16,99' }), /data-papel="de"[\s\S]*R\$ 16,99/);
});

test('carimbo: hidden before t0, 3.5x at t0, lands at 1 by t0+0.4', async () => {
  const VT = await carregarKit();
  assert.equal(VT.carimbo(0.9, 1).visivel, false);
  const a = VT.carimbo(1, 1);
  assert.equal(a.visivel, true);
  assert.ok(Math.abs(a.scale - 3.5) < 1e-9);
  assert.ok(Math.abs(VT.carimbo(1.4, 1).scale - 1) < 0.01);
  assert.ok(VT.carimbo(1.1, 1).shake > 0);
  assert.equal(VT.carimbo(2, 1).shake, 0);
});

test('contagem is empty before t0, monotonic, and lands exactly on the target', async () => {
  const VT = await carregarKit();
  assert.equal(VT.contagem(0.5, 1, 'R$ 13,99'), '');
  assert.equal(VT.contagem(1.5, 1, 'R$ 13,99'), 'R$ 13,99');
  assert.equal(VT.contagem(9, 1, 'R$ 1.299,90'), 'R$ 1.299,90');
  const cents = (s) => Number(s.replace(/\D/g, ''));
  let prev = -1;
  for (let t = 1; t <= 1.5; t += 1 / 30) {
    const v = cents(VT.contagem(t, 1, 'R$ 13,99'));
    assert.ok(v >= prev, `not monotonic at ${t}`);
    prev = v;
  }
});

test('eases start at 0 and end at 1; snapSettle is mostly done early', async () => {
  const VT = await carregarKit();
  for (const [nome, f] of Object.entries(VT.ease)) {
    assert.ok(Math.abs(f(0)) < 1e-6, `${nome}(0)`);
    assert.ok(Math.abs(f(1) - 1) < 1e-6, `${nome}(1)`);
  }
  assert.ok(VT.ease.snapSettle(0.1) > 0.5);
  assert.ok(VT.ease.accelExit(0.5) < 0.2);
  const po = VT.ease.popOver;
  let pico = 0, tPico = 0;
  for (let i = 0; i <= 100; i += 1) { const v = po(i / 100); if (v > pico) { pico = v; tPico = i / 100; } }
  assert.ok(pico >= 1.06 && pico <= 1.10, `popOver peak ${pico}`);
  assert.ok(tPico >= 0.65 && tPico <= 0.80, `popOver peak at ${tPico}`);
  assert.ok(po(0.25) >= 0.40 && po(0.25) <= 0.52, `popOver(0.25) ${po(0.25)}`);
});

test('momentoPreco takes the last mention of the first spoken price word', async () => {
  const VT = await carregarKit();
  const ditas = { treze: [2.0, 3.5] };
  const A = (w, n = 1) => { const h = ditas[w]; if (!h || !h[n - 1]) throw new Error('não'); return h[n - 1]; };
  assert.equal(VT.momentoPreco(A, { precoFalado: 'treze e noventa e nove' }, 9), 3.5);
  assert.equal(VT.momentoPreco(A, { precoFalado: 'dez e noventa' }, 9), 9);
});
