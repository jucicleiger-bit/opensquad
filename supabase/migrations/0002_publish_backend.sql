-- supabase/migrations/0002_publish_backend.sql

alter table projects add column instagram_account jsonb not null default '{}'::jsonb;
alter table projects add column instagram_token_secret_id uuid;
alter table projects add column instagram_token_expires_at timestamptz;

create table alert_notifications (
  key text primary key,
  last_sent_at timestamptz not null
);
alter table alert_notifications enable row level security;
-- No policies on purpose: only the service-role client (used exclusively
-- inside the publish-sweep Edge Function) touches this table. RLS with zero
-- policies denies anon/authenticated entirely — there is no panel surface
-- for this table, matching the design spec.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Stores/rotates a project's Instagram token in Vault. SECURITY DEFINER so
-- it can write to the vault schema; EXECUTE is revoked from anon/authenticated
-- below so only the service-role client (inside the save-instagram-token
-- Edge Function) can ever call this.
create or replace function set_instagram_token(p_project_id uuid, p_token text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select instagram_token_secret_id into v_secret_id from projects where id = p_project_id;
  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, p_token);
  else
    v_secret_id := vault.create_secret(p_token, 'instagram_token_' || p_project_id::text);
    update projects set instagram_token_secret_id = v_secret_id where id = p_project_id;
  end if;
  update projects set instagram_token_expires_at = p_expires_at where id = p_project_id;
end;
$$;
revoke execute on function set_instagram_token(uuid, text, timestamptz) from public, anon, authenticated;

-- Reads back the decrypted token for the publish-sweep Edge Function.
-- Same SECURITY DEFINER + revoked-grant pattern — nothing but the
-- service-role client can ever call this.
create or replace function get_instagram_token(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_token text;
begin
  select instagram_token_secret_id into v_secret_id from projects where id = p_project_id;
  if v_secret_id is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id;
  return v_token;
end;
$$;
revoke execute on function get_instagram_token(uuid) from public, anon, authenticated;
