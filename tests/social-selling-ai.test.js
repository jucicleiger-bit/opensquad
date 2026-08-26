import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonResponse } from '../src/social-selling-ai.js';

test('parseJsonResponse extracts a JSON object embedded in surrounding text', () => {
  assert.deepEqual(parseJsonResponse('here you go: {"approved": true, "reason": "ok"} thanks'), { approved: true, reason: 'ok' });
});

test('parseJsonResponse returns null when there is no JSON object', () => {
  assert.equal(parseJsonResponse('sorry, no json here'), null);
});

test('parseJsonResponse returns null for malformed JSON', () => {
  assert.equal(parseJsonResponse('{"approved": true,}'), null);
});
