alter table projects add column if not exists company_profile jsonb not null default '{}'::jsonb;
alter table projects add column if not exists brand_xray jsonb not null default '{}'::jsonb;
alter table projects add column if not exists brand_briefing jsonb not null default '{}'::jsonb;

-- Rollback (manual, run by hand if needed — not auto-executed):
-- alter table projects drop column if exists brand_briefing;
-- alter table projects drop column if exists brand_xray;
-- alter table projects drop column if exists company_profile;
