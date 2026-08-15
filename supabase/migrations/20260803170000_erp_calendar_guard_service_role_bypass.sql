-- ВОССТАНОВЛЕНО 15.08.2026 из боевой базы (`supabase_migrations.schema_migrations`,
-- имя `erp_calendar_guard_service_role_bypass`).
--
-- Миграция применена на проде, её файл в git не попал. Тело ниже — дословно то,
-- что исполнила база, и это ДЕЙСТВУЮЩЕЕ определение `erp_calendar_guard`
-- (проверено `pg_get_functiondef` на проде 15.08).
--
-- Почему важно: последним определением стража плана в репозитории оставалась
-- версия из `20260803160000_erp_permissions_server_side.sql` — БЕЗ раннего
-- выхода для `service_role`. То есть восстановление схемы из репозитория
-- запирало починку через SQL: `auth.uid()` у service_role пуст, а страж
-- требовал права и валился на любой сервисной правке плана.
--
-- Правило (записано в CLAUDE.md): пустой `auth.uid()` в страже — это
-- service_role, его пропускаем. Он и так минует RLS, и запирать починку
-- через SQL нельзя.
--
-- ВНИМАНИЕ, известная дыра (P0-3 в docs/2026-08-15-erp-consilium.md):
-- этот страж НЕ проверяет принадлежность цеху, тогда как интерфейс требует
-- `plan.fact` И свой цех. Значит любой держатель `plan.fact` (десять ролей)
-- правит факт, брак и «проблему» в чужом участке через REST. Чинить нужно
-- отдельной миграцией — вместе с гейтом в интерфейсе, одним коммитом.

create or replace function public.erp_calendar_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.erp_has_permission('plan.manage') then
    return new;
  end if;

  if new.department_id is distinct from old.department_id
     or new.stage_id      is distinct from old.stage_id
     or new.work_date     is distinct from old.work_date
     or new.qty_planned   is distinct from old.qty_planned
     or new.priority      is distinct from old.priority
     or new.sort_order    is distinct from old.sort_order
     or new.comment       is distinct from old.comment
     or new.created_by    is distinct from old.created_by
  then
    raise exception 'erp_calendar_guard: изменение плана требует права plan.manage'
      using errcode = '42501';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    raise exception 'erp_calendar_guard: снятие задачи из плана требует права plan.manage'
      using errcode = '42501';
  end if;

  return new;
end $$;
