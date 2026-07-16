-- Мощности цехов не используются: план сроков вписывается вручную (решение 2026-07-16).
-- Применено к pinhead-os-v2 через MCP apply_migration.
alter table public.erp_departments drop column if exists capacity_per_day;
alter table public.erp_departments drop column if exists target_load_per_day;
