import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startContentCentralServer } from '../src/content-central-server.js';
import { createCentralProject, saveProjectOffer } from '../src/content-central.js';

const realFetch = globalThis.fetch;

async function withServer(fn, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-brain-server-'));
  await createCentralProject({ projectId: 'loja', name: 'Loja' }, dir);
  const server = await startContentCentralServer({ targetDir: dir, port: 0, openBrowser: false, ...options });
  try {
    return await fn(dir, server);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function call(server, path, body) {
  const response = await realFetch(`${server.url}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('a message runs the cérebro, stores both sides and reuses the session', async () => {
  const calls = [];
  const brainRunner = async (input) => {
    calls.push(input);
    return { sessionId: 'sessao-1', text: `ok ${calls.length}` };
  };
  await withServer(async (_dir, server) => {
    await call(server, '/api/projects/loja/brain/messages', { text: 'oi' });
    const second = await call(server, '/api/projects/loja/brain/messages', { text: 'de novo' });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.chat.messages.map((m) => [m.role, m.text]), [['user', 'oi'], ['assistant', 'ok 1'], ['user', 'de novo'], ['assistant', 'ok 2']]);
    assert.equal(calls[0].sessionId, null);
    assert.equal(calls[1].sessionId, 'sessao-1');
    assert.match(calls[0].prompt, /Projeto Loja/);
    assert.doesNotMatch(calls[1].prompt, /Projeto Loja/);
    assert.match(calls[0].systemPrompt, /cerebro\.js/);
  }, { brainRunner });
});

test('a second message while the first runs gets 409', async () => {
  let release;
  const brainRunner = () => new Promise((resolve) => { release = () => resolve({ sessionId: 's', text: 'pronto' }); });
  await withServer(async (_dir, server) => {
    const first = call(server, '/api/projects/loja/brain/messages', { text: 'um' });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await call(server, '/api/projects/loja/brain/messages', { text: 'dois' });
    assert.equal(second.status, 409);
    release();
    assert.equal((await first).status, 200);
  }, { brainRunner });
});

test('a runner failure is shown in the chat and keeps the session', async () => {
  const brainRunner = async () => { throw new Error('claude não está logado'); };
  await withServer(async (_dir, server) => {
    const result = await call(server, '/api/projects/loja/brain/messages', { text: 'oi' });
    assert.equal(result.status, 502);
    assert.equal(result.body.chat.messages.at(-1).role, 'error');
    assert.match(result.body.chat.messages.at(-1).text, /não está logado/);
  }, { brainRunner });
});

test('the cerebro CLI saves a plan and a proposal through the server', async () => {
  await withServer(async (dir, server) => {
    const { offer } = await saveProjectOffer('loja', { name: 'Arroz', type: 'offer' }, dir);
    const run = (...args) => promisify(execFile)(process.execPath, ['bin/cerebro.js', ...args], { env: { ...process.env, CONTENT_CENTRAL_URL: server.url } });
    const formats = [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }];
    const planOut = await run('plan', 'loja', JSON.stringify({ startDate: '2026-10-05', days: 1, formats, slots: [{ id: '2026-10-05-instagram_story-01', offerIds: [offer.id] }] }));
    assert.match(planOut.stdout, /Venda — Arroz/);
    const propOut = await run('propose', 'loja', JSON.stringify({ summary: 'Setor', changes: [{ kind: 'offer', offerId: offer.id, field: 'sector', after: 'Mercearia' }] }));
    assert.match(propOut.stdout, /Proposta criada/);
    const state = await call(server, '/api/projects/loja/brain');
    assert.equal(state.body.proposals[0].status, 'pending');
    const applied = await call(server, `/api/projects/loja/brain/proposals/${state.body.proposals[0].id}/apply`, {});
    assert.equal(applied.body.proposal.status, 'applied');
    await assert.rejects(run('plan', 'loja', '{"startDate":"2026-10-05","days":1,"formats":[]}'), /formato/);
  });
});
