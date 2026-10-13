-- Календарная дата на сервере — дата ФАБРИКИ, а не Гринвича.
--
-- Хвост той же ошибки, из-за которой доска плана показывала неделю с субботы.
-- На клиенте она починена (`src/utils/date.ts`), но `current_date` в базе
-- отдаёт дату UTC: база Supabase живёт в UTC (`show TimeZone` → UTC), и с 00:00
-- до 03:00 по Москве `current_date` — это ВЧЕРА. Кладовщик, принимающий подряд
-- в ночную смену, получал возврат, датированный вчерашним числом.
--
-- Зона названа В ОДНОМ МЕСТЕ — `erp_local_date()`. Это тот же приём, что
-- `src/utils/date.ts` на клиенте: не «правильная дата», а одно место, где
-- сказано, чья дата считается правильной. Захотят перенести производство
-- в другой пояс — менять здесь и ровно здесь.
--
-- ПОЧЕМУ НЕ `set timezone = 'Europe/Moscow'` НА БАЗУ: это поменяло бы и печать
-- всех `timestamptz` (created_at, fact_at, shipped_at) во всех ответах API,
-- то есть поведение экранов, к правкам дат отношения не имеющих. Момент
-- времени по-прежнему хранится и отдаётся в UTC — это правильно; локальной
-- должна быть только КАЛЕНДАРНАЯ дата.

create or replace function public.erp_local_date()
returns date
language sql
stable
set search_path to 'public'
as $$
  select (now() at time zone 'Europe/Moscow')::date
$$;

comment on function public.erp_local_date() is
  'Календарная дата производства (пояс фабрики). Единственное место, где назван пояс: '
  'current_date в этой базе означает дату UTC и ночью расходится с датой цеха.';

-- Право приходит от PUBLIC, и `revoke … from anon` в одиночку ничего не даёт
-- (правило проекта). Функция вызывается из DEFAULT-выражений, то есть от лица
-- вставляющего, — поэтому `authenticated` право нужно явно.
revoke execute on function public.erp_local_date() from public, anon;
grant execute on function public.erp_local_date() to authenticated, service_role;

-- ── Штампы дат, которые видит человек ────────────────────────────────────────

alter table erp_material_receipts
  alter column received_on set default public.erp_local_date();

alter table erp_subcontract_moves
  alter column moved_on set default public.erp_local_date();

-- Приёмка подряда складом: дата возврата от подрядчика.
-- Текст функции взят ПОДЛИННЫЙ (pg_get_functiondef), заменено одно выражение —
-- правило проекта: пересоздаёшь функцию целиком, не пиши её по памяти.
create or replace function public.erp_warehouse_fg_accepted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status <> 'accepted' or old.status = 'accepted' then
    return new;
  end if;
  if new.task_type not in ('fg_receipt', 'subcontract_receipt') then
    return new;
  end if;

  if new.task_type = 'subcontract_receipt' then
    update erp_subcontracting
       set phase = 'accepted',
           status = 'received_at_pinhead',
           returned_date = coalesce(returned_date, public.erp_local_date())
     where order_id = new.order_id
       and op_type = 'finished_product'
       and phase not in ('accepted', 'closed');
  end if;

  if public.erp_can_pack_ship(new.order_id) then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    values (new.order_id, 'pack_ship', 'awaiting_receipt')
    on conflict (order_id, task_type) do nothing;
  end if;

  return new;
end;
$$;

-- Позиция в очереди при отсутствии срока: сутки здесь ни на что не влияют
-- (это числовой ключ сортировки, а не дата), но правило держится без
-- исключений — иначе сторож обрастает списком «здесь можно».
create or replace function public.erp_default_queue_position(p_due date)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select extract(epoch from (coalesce(p_due, public.erp_local_date() + 365))::timestamp)::numeric
$$;
