-- supabase/migrations/0001_init.sql

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null,
  slug text not null unique,
  brand_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  channel text not null,
  -- draft | approved | scheduled | posted | error | cancelled
  -- (cancelled mirrors the local content/cancelled/ directory today)
  status text not null default 'draft',
  copy text,
  media_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_project_status_idx on content_items(project_id, status);

create table schedules (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  run_at timestamptz not null,
  -- pending | done | error
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index schedules_run_at_status_idx on schedules(run_at, status);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  -- 'art_generation' | 'whatsapp_send'
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  -- pending | running | done | error
  status text not null default 'pending',
  result_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_created_idx on jobs(status, created_at);

-- RLS: single-owner access only. jobs has no owner_id of its own (it's a
-- personal task queue, not per-project) so it's scoped to any
-- authenticated user — fine since this is a single-user system.
alter table projects enable row level security;
alter table content_items enable row level security;
alter table schedules enable row level security;
alter table jobs enable row level security;

create policy "owner full access" on projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner full access" on content_items
  for all using (
    project_id in (select id from projects where owner_id = auth.uid())
  ) with check (
    project_id in (select id from projects where owner_id = auth.uid())
  );

create policy "owner full access" on schedules
  for all using (
    content_item_id in (
      select ci.id from content_items ci
      join projects p on p.id = ci.project_id
      where p.owner_id = auth.uid()
    )
  ) with check (
    content_item_id in (
      select ci.id from content_items ci
      join projects p on p.id = ci.project_id
      where p.owner_id = auth.uid()
    )
  );

create policy "authenticated full access" on jobs
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

insert into storage.buckets (id, name, public)
values ('content-media', 'content-media', false)
on conflict (id) do nothing;

-- Storage objects have no per-owner metadata of their own here, so this
-- is scoped to any authenticated user — fine since this is a single-user
-- system, same reasoning as the jobs policy above.
create policy "authenticated full access" on storage.objects
  for all using (
    bucket_id = 'content-media' and auth.uid() is not null
  ) with check (
    bucket_id = 'content-media' and auth.uid() is not null
  );
