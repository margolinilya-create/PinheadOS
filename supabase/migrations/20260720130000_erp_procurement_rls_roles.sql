-- Аудит (security A4): admin-разделы «Закупка»/«Подряд» защищены только UI, RLS —
-- любой authenticated. Ужесточаем УПРАВЛЕНИЕ, не ломая создание задач рабочими цеха.
-- Модель:
--   erp_procurement_tasks: insert — любой authenticated (задачи создаёт цех через брак),
--                          select — authenticated, update/delete — только менеджеры (admin/director).
--   erp_subcontracting:    создаётся и ведётся в admin-экране → insert/update — только менеджеры,
--                          select — authenticated, delete — admin.

create or replace function public.erp_is_manager()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'director')
  );
$$;

-- Задачи закупки: ограничиваем только update (insert/select/delete оставляем как есть)
drop policy if exists erp_procurement_tasks_update on public.erp_procurement_tasks;
create policy erp_procurement_tasks_update on public.erp_procurement_tasks
  for update to authenticated
  using (public.erp_is_manager()) with check (public.erp_is_manager());

-- Подряд: создание и правки — только менеджеры
drop policy if exists erp_subcontracting_insert on public.erp_subcontracting;
create policy erp_subcontracting_insert on public.erp_subcontracting
  for insert to authenticated with check (public.erp_is_manager());
drop policy if exists erp_subcontracting_update on public.erp_subcontracting;
create policy erp_subcontracting_update on public.erp_subcontracting
  for update to authenticated
  using (public.erp_is_manager()) with check (public.erp_is_manager());
