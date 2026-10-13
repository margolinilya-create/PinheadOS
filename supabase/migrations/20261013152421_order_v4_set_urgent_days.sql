-- Срочный пошив по дням для Order v4 (правка CRM 13.10, п. 6) — отдельным RPC.
-- order_v4_save пишет только флажок `urgent`; дни (0/5/10/15) клиент сохраняет
-- этим вызовом сразу после него. Security invoker: RLS вызывающего, как у save.
-- Флажок синхронизируется: urgent = дней больше нуля.
create or replace function public.order_v4_set_urgent_days(p_order_id uuid, p_days smallint)
returns smallint
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Нужен вход в систему' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (0, 5, 10, 15) then
    raise exception 'Срочность: 0, 5, 10 или 15 дней' using errcode = '22023';
  end if;
  update public.orders
     set urgent_days = p_days, urgent = p_days > 0
   where id = p_order_id and schema_version = 4;
  if not found then
    raise exception 'Заказ не найден или недоступен' using errcode = '42501';
  end if;
  return p_days;
end;
$$;

revoke execute on function public.order_v4_set_urgent_days(uuid, smallint) from public, anon;
grant execute on function public.order_v4_set_urgent_days(uuid, smallint) to authenticated;
