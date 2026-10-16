-- Order v4: сохранение заказа и дней срочности ОДНОЙ транзакцией (16.10).
--
-- Клиент звал два RPC подряд: order_v4_save, затем order_v4_set_urgent_days.
-- Это две транзакции, и сбой второго оставлял первый записанным: новый заказ
-- создавался, но клиент считал сохранение неудачным и терял его id — повтор
-- «Новый заказ» плодил пустые заказы-сироты; у существующего флажок urgent
-- уже стоял, а дни — старые, и price_total в базе расходился с карточкой.
--
-- Обёртка вызывает обе функции внутри одной: исключение во второй откатывает
-- и первую. Большую order_v4_save не пересоздаём — её текст остаётся
-- единственным, обёртка только добавляет дни. Security invoker, как у обеих:
-- работает RLS вызывающего.
create or replace function public.order_v4_save_full(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saved jsonb;
begin
  v_saved := public.order_v4_save(p_order);
  if jsonb_typeof(p_order->'urgent_days') = 'number' then
    perform public.order_v4_set_urgent_days(
      (v_saved->>'id')::uuid,
      (p_order->>'urgent_days')::smallint
    );
  end if;
  return v_saved;
end;
$$;

revoke execute on function public.order_v4_save_full(jsonb) from public, anon;
grant execute on function public.order_v4_save_full(jsonb) to authenticated;
