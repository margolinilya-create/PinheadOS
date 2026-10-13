-- Единый источник сотрудников: профиль привязывается к одной цеховой записи.
-- Применено к pinhead-os-v2 через MCP apply_migration 2026-07-17.
create unique index if not exists erp_employees_profile_uniq
  on public.erp_employees (profile_id) where profile_id is not null;
