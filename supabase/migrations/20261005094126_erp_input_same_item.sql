-- Пятая находка ревью безопасности (05.10): обход входа этапа
-- (`erp_stage_input_qty_d`) шёл по `depends_on`, не проверяя позицию
-- предшественника. Прозрачному этапу (закупка, склад) потолок факта
-- не ставится, и подменённая у него ссылка на чужой этап завышала вход
-- всем, кто за ним. Теперь в обходе — только этапы той же позиции
-- (клиентское зеркало и так видит лишь `item.stages`).
create or replace function public.erp_stage_input_qty_d(p_stage_id uuid, p_depth int)
returns int
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_total int;
  v_item  uuid;
  v_deps  uuid[];
  v_min   int;
  v_out   int;
  p       record;
begin
  select greatest(coalesce(i.qty, 0), 0), s.depends_on, s.item_id
    into v_total, v_deps, v_item
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
   where s.id = p_stage_id;
  if v_total is null then
    return null;
  end if;
  -- Первый этап маршрута — тираж позиции. Петля в графе (кривые данные) —
  -- тоже тираж: fail-open, заниженный вход запретил бы сдать сделанное
  if v_deps is null or cardinality(v_deps) = 0 or p_depth > 32 then
    return v_total;
  end if;

  for p in
    select s.id, s.status, s.qty_done, s.qty_passthrough
      from public.erp_item_stages s
     where s.id = any (v_deps)
       -- Только этапы ТОЙ ЖЕ позиции (ревью безопасности 05.10): ссылка
       -- на чужой этап иначе подменяла вход через прозрачный этап
       and s.item_id = v_item
  loop
    if p.status = 'skipped' or p.qty_passthrough then
      v_out := public.erp_stage_input_qty_d(p.id, p_depth + 1);
    else
      v_out := greatest(coalesce(p.qty_done, 0), 0);
    end if;
    v_min := least(coalesce(v_min, v_out), v_out);
  end loop;

  -- Зависимости есть, а этапов нет — тираж (как у клиента)
  return coalesce(v_min, v_total);
end $$;

revoke execute on function public.erp_stage_input_qty_d(uuid, int) from public, anon, authenticated;
