-- supabase/migrations/0004_content_strategy.sql

alter table projects add column if not exists content_strategy jsonb not null default '{}'::jsonb;

-- Rollback (manual, run by hand if needed — not auto-executed):
-- alter table projects drop column if exists content_strategy;
