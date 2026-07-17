-- P0.2: зачистка старого ERP (redesign/v2) перед новым ERP.
-- Применено к pinhead-os-v2 (glhwbktsokphgksdvcxj) 2026-07-16 через MCP apply_migration.
-- Бэкап данных (76 строк, все demo/UAT) снят и передан заказчику:
--   erp-v2-backup-2026-07-16.json (в git не кладём — репозиторий публичный).
-- Таблицы создания заказов (profiles, orders, order_comments, order_audit,
-- app_config, catalog_config, order_templates) и функции is_admin,
-- log_order_changes НЕ затрагиваются — их политики проверены на независимость.

-- 1. Снять cron-джоб диспетчера событий (guard: на свежей preview-ветке
-- pg_cron/джоба может не быть — реплей не должен падать)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'dispatch-domain-events') then
    perform cron.unschedule('dispatch-domain-events');
  end if;
end $$;

-- 2. Таблицы (в порядке зависимостей; CASCADE снимет их политики/триггеры/индексы)
drop table if exists public.piecework_entries cascade;
drop table if exists public.piecework_batches cascade;
drop table if exists public.order_tech_operations cascade;
drop table if exists public.order_tech_cards cascade;
drop table if exists public.sku_tech_template_items cascade;
drop table if exists public.sku_tech_templates cascade;
drop table if exists public.operation_types cascade;
drop table if exists public.workers cascade;
drop table if exists public.notifications cascade;
drop table if exists public.domain_events cascade; -- партиции 2026_04..07 уходят вместе с родителем
drop table if exists public.sections cascade;

-- 3. Функции старого ERP
drop function if exists public.auth_is_foreman_of(uuid);
drop function if exists public.auth_is_hr();
drop function if exists public.auth_is_production();
drop function if exists public.auth_is_qc_operator();
drop function if exists public.auth_is_senior_foreman();
drop function if exists public.auth_is_technologist();
drop function if exists public.auth_is_admin_or_director();
drop function if exists public.domain_events_create_next_partition();
drop function if exists public.piecework_forbid_update_if_paid();
drop function if exists public.tech_operation_order_id_consistent();

-- Осталось вручную (MCP не умеет удалять edge-функции):
--   edge-функция domain-events-dispatcher — удалить в Dashboard → Edge Functions.
--   Безвредна: cron снят, таблиц нет, сама не вызывается.
