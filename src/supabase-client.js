import { createClient } from '@supabase/supabase-js';

export function createSupabaseAdminClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  // Service-role key bypasses RLS — this client is for server-side/script
  // use only, never sent to a frontend.
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
