-- Откат миграции P (20261026090000_order_templates_layouts): прежние политики «свои»
-- и права authenticated на select / insert / delete. Права anon и TRUNCATE НЕ
-- возвращаются — это была дыра, а не поведение. Таблица раскладок: строки остаются.
begin;
alter table public.order_templates drop constraint if exists order_templates_layout_check;
alter table public.order_templates drop constraint if exists order_templates_name_check;
alter table public.order_templates alter column created_by drop not null;
alter policy order_templates_select on public.order_templates using ((select auth.uid()) = created_by);
alter policy order_templates_insert on public.order_templates with check ((select auth.uid()) = created_by);
alter policy order_templates_delete on public.order_templates using ((select auth.uid()) = created_by);
commit;
