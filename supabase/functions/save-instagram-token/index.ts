// supabase/functions/save-instagram-token/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
  }

  // Verify the caller is the authenticated owner (not just any request with
  // the anon key) using a client scoped to their JWT — this call fails if
  // the JWT is invalid/expired, before any Vault write happens.
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { projectId, token, expiresAt, account } = body || {};
  if (!projectId || !token) {
    return new Response(JSON.stringify({ error: 'projectId and token are required' }), { status: 400 });
  }

  // Verify the caller owns this project using RLS on the user-scoped client.
  // The `projects` table has a policy owner_id = auth.uid(), so a SELECT
  // through userClient returns nothing if the caller doesn't own this project.
  const { data: ownedProject, error: ownershipError } = await userClient
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();
  if (ownershipError || !ownedProject) {
    return new Response(JSON.stringify({ error: 'Project not found or not owned by the authenticated user' }), { status: 403 });
  }

  // Service-role client — the only one allowed to call set_instagram_token
  // (EXECUTE is revoked from anon/authenticated in the migration).
  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (account) {
    const { error: accountError } = await adminClient
      .from('projects')
      .update({ instagram_account: account })
      .eq('id', projectId);
    if (accountError) {
      return new Response(JSON.stringify({ error: `failed to save Instagram account info: ${accountError.message}` }), { status: 500 });
    }
  }

  const { error: rpcError } = await adminClient.rpc('set_instagram_token', {
    p_project_id: projectId,
    p_token: token,
    p_expires_at: expiresAt || null,
  });
  if (rpcError) {
    return new Response(JSON.stringify({ error: `failed to save token: ${rpcError.message}` }), { status: 500 });
  }

  const status = !expiresAt ? 'valido' : (new Date(expiresAt).getTime() - Date.now()) <= 0 ? 'expirado'
    : (new Date(expiresAt).getTime() - Date.now()) <= 10 * 24 * 60 * 60 * 1000 ? 'vence_em_breve' : 'valido';

  return new Response(JSON.stringify({ ok: true, expiresAt: expiresAt || null, status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
