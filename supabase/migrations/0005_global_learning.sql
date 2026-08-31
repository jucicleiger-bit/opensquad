create table if not exists global_learning (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  segment_learnings jsonb not null default '{}'::jsonb,
  offer_type_learnings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table global_learning enable row level security;
create policy "owner full access" on global_learning
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists segment_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  segment_id text not null,
  label text not null,
  pieces jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, segment_id)
);
alter table segment_templates enable row level security;
create policy "owner full access" on segment_templates
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Rollback (manual, run by hand if needed — not auto-executed):
-- drop table if exists segment_templates;
-- drop table if exists global_learning;
