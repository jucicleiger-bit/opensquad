import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAdminClient } from '../src/supabase-client.js';

test('throws when SUPABASE_URL is missing', () => {
  assert.throws(
    () => createSupabaseAdminClient({ SUPABASE_SERVICE_ROLE_KEY: 'x' }),
    /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/
  );
});

test('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
  assert.throws(
    () => createSupabaseAdminClient({ SUPABASE_URL: 'https://x.supabase.co' }),
    /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/
  );
});

test('returns a client when both env vars are set', () => {
  const client = createSupabaseAdminClient({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  });
  assert.equal(typeof client.from, 'function');
});
