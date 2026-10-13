-- ЗАВЕРШЕНИЕ РУЛОНА ОДНОЙ ТРАНЗАКЦИЕЙ (долг правки 05.10, п. 5)
--
-- «Завершить рулон» звал две функции подряд: уточнение метража замером
-- (`erp_material_roll_set_params`) и судьбу остатка (`erp_roll_set_leftover`).
-- Обрыв между вызовами оставлял рулон с записанным замером, но «в работе»
-- без решения — этап закроя не закрывался, а повтор видел другой остаток.
--
-- Новая функция вызывает обе внутри одной транзакции: отказ второй откатывает
-- первую. Проверки и тексты отказов остаются у самих функций; здесь —
-- право, «есть что делать» и причина расхождения при замере (зеркало
-- клиентского `rollFinishBlock`, QA 09.10).

create or replace function public.erp_roll_finish(
  p_roll_id uuid,
  p_kind text default null,
  p_item_id uuid default null,
  p_length_m numeric default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_refine jsonb;
  v_fate   jsonb;
begin
  if not (public.erp_has_permission('stage.progress') or public.erp_has_permission('stage.complete')) then
    raise exception 'erp_roll_finish: нужно право stage.progress или stage.complete' using errcode = '42501';
  end if;
  if p_kind is null and p_length_m is null then
    raise exception 'erp_roll_finish: нечего записать — нет ни замера, ни судьбы остатка' using errcode = '22023';
  end if;
  if p_length_m is not null and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Замер расходится с записанным расходом — укажите причину расхождения' using errcode = '22023';
  end if;

  if p_length_m is not null then
    v_refine := public.erp_material_roll_set_params(
      p_roll_id, null, null, p_length_m, 'measured', p_reason, null);
  end if;
  if p_kind is not null then
    v_fate := public.erp_roll_set_leftover(p_roll_id, p_kind, p_item_id);
  end if;

  return jsonb_build_object('roll_id', p_roll_id, 'refine', v_refine, 'fate', v_fate);
end $function$;

comment on function public.erp_roll_finish(uuid, text, uuid, numeric, text) is
  'Завершить рулон: замер остатка (уточнение метража) и судьба остатка одной транзакцией';

revoke execute on function public.erp_roll_finish(uuid, text, uuid, numeric, text) from public, anon;
grant execute on function public.erp_roll_finish(uuid, text, uuid, numeric, text) to authenticated;
