import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifySocialSellingOperator } from '../src/social-selling-notify.js';

test('notifySocialSellingOperator no-ops without throwing when WAHA or notification config is missing', async () => {
  delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
  delete process.env.OPENSQUAD_WAHA_APIKEY;
  await assert.doesNotReject(() => notifySocialSellingOperator('test', { notifications: {} }));
});

test('notifySocialSellingOperator posts to WAHA sendText with the configured session and chat', async () => {
  process.env.OPENSQUAD_WAHA_ADMIN_URL = 'http://localhost:9999';
  process.env.OPENSQUAD_WAHA_APIKEY = 'test-key';
  const originalFetch = global.fetch;
  let capturedUrl;
  let capturedBody;
  global.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    return { ok: true, text: async () => '' };
  };
  try {
    await notifySocialSellingOperator('pausado', { notifications: { wahaSessionName: 'ops', operatorChatId: '5511999990000@c.us' } });
    assert.equal(capturedUrl, 'http://localhost:9999/api/sendText');
    assert.deepEqual(capturedBody, { session: 'ops', chatId: '5511999990000@c.us', text: 'pausado' });
  } finally {
    global.fetch = originalFetch;
    delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
    delete process.env.OPENSQUAD_WAHA_APIKEY;
  }
});
