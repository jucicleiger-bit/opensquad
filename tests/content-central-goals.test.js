import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTENT_GOAL_LABELS, goalName, slotTag } from '../src/content-central-goals.js';
import { CONTENT_GOAL_LABELS as FROM_CENTRAL } from '../src/content-central.js';

test('goal names and slot tags read the same everywhere', () => {
  assert.equal(goalName('sales'), 'Venda');
  assert.equal(goalName('authority'), 'Gerar autoridade');
  assert.equal(slotTag({ source: 'offer' }), 'venda');
  assert.equal(slotTag({ source: 'goal', goalKey: 'relationship' }), 'Criar relacionamento');
  assert.equal(slotTag({ source: 'special_date' }), 'special_date');
  assert.equal(FROM_CENTRAL, CONTENT_GOAL_LABELS);
});

// The CLI runs on every cérebro action; importing content-central.js (and
// jimp through it) cost ~1.4 s per call.
test('the cérebro CLI imports only the dependency-free goals module', async () => {
  const cli = await readFile(new URL('../bin/cerebro.js', import.meta.url), 'utf-8');
  assert.deepEqual([...cli.matchAll(/from '([^']+)'/g)].map((match) => match[1]), ['../src/content-central-goals.js']);
  const goals = await readFile(new URL('../src/content-central-goals.js', import.meta.url), 'utf-8');
  assert.doesNotMatch(goals, /^import /m);
});
