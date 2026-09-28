-- ОБЩИЙ ГЕЙТ ЗАВЕРШЕНИЯ ЭТАПА — И НА ПРЯМОМ ПЕРЕХОДЕ В `done`
-- (правки заказчика 27.09, пп. 2, 3, 7).
--
-- ЧТО БЫЛО. `erp_stage_completion_block` (гейт закупки, 30.08/04.09) звали
-- только две RPC — сдача результата и частичная готовность. Прямой
-- `update erp_item_stages set status = 'done'` (кнопка «Завершить этап»,
-- дорожка «Завершено» на канбане, чип производственного плана) серверного
-- зеркала не имел: клиент гейтил, сервер — нет. Правила 27.09 добавили три
-- новых условия закрытия, и все они закрывались бы через REST.
--
-- ЧТО ТЕПЕРЬ. Функция получает третий аргумент `p_final` («это закрытие
-- этапа, а не частичная сдача») и четыре ветки в одном порядке с клиентом
-- (`stageGates.completionBlockFor` → `stageCompletionBlock`):
--   1. программа вышивки — `erp_stage_program_block` (п. 3), без оглядки
--      на тираж;
--   2. `p_final`: судьба остатков рулонов — `erp_stage_rolls_fate_block` (п. 2);
--   3. `p_final`: не учтённые изделия у ПРОИЗВОДСТВЕННОГО участка с формой
--      результата — `erp_stage_unaccounted` (п. 7). Непроизводственные
--      (склад, закупка) тоже носят `result_fields`, но их этапы закрывают
--      складские задачи и отгрузка, а не сдача изделий;
--   4. закупка — подлинное условие 04.09, слова прежние.
-- Триггер `erp_stage_done_gate` зовёт её на переходе в `done` от лица
-- человека и пропускает переходы под метками транзакции: принудительное
-- завершение, перенос между цехами, приёмка подряда, автозакрытие закупки —
-- у каждого свой путь и свои проверки. Service role (пустой `auth.uid()`)
-- проходит, как у всех стражей: починку через SQL запирать нельзя.
--
-- Прежняя сигнатура `(uuid, int)` снимается: с параметром по умолчанию
-- рядом с ней вызов `f(id, n)` стал бы неоднозначным.

drop function if exists public.erp_stage_completion_block(uuid, int);

create or replace function public.erp_stage_completion_block(
  p_stage_id uuid,
  p_added_good int default 0,
  p_final boolean default false
)
returns text
language plpgsql
stable
set search_path = public as $$
declare
  v_stage  record;
  v_block  text;
  v_names  text;
  v_unacc  int;
begin
  select s.id, s.qty_done, s.result_kind,
         i.id as item_id, i.qty as item_qty, i.order_id,
         d.gate_material_kinds, d.result_fields, d.is_production
    into v_stage
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
    left join public.erp_departments d on d.id = s.department_id
   where s.id = p_stage_id;
  if v_stage.id is null then
    return null;
  end if;

  -- 1. Программа вышивки раньше вышивки (п. 3)
  v_block := public.erp_stage_program_block(p_stage_id);
  if v_block is not null then
    return v_block;
  end if;

  if p_final then
    -- 2. Судьба остатков рулонов (п. 2)
    v_block := public.erp_stage_rolls_fate_block(p_stage_id);
    if v_block is not null then
      return v_block;
    end if;

    -- 3. Не учтённые изделия (п. 7): производственный участок с формой
    --    результата; файловый результат изделий не имеет
    if coalesce(v_stage.is_production, false)
       and jsonb_typeof(v_stage.result_fields) = 'array'
       and jsonb_array_length(v_stage.result_fields) > 0
       and v_stage.result_kind is null
    then
      v_unacc := public.erp_stage_unaccounted(p_stage_id, p_added_good, 0);
      if coalesce(v_unacc, 0) > 0 then
        -- Число и предмет разведены: склонение в SQL не заводится
        return 'Нельзя завершить этап: не учтено изделий — ' || v_unacc
          || '. Сдайте оставшиеся изделия или укажите окончательный брак.';
      end if;
    end if;
  end if;

  -- 4. Закупка (подлинное условие 20260904180307). Только у участка
  --    с материальным гейтом и только когда запись реально добирает тираж:
  --    частичная сдача при неприехавшем материале законна
  if coalesce(cardinality(v_stage.gate_material_kinds), 0) = 0 then
    return null;
  end if;
  if coalesce(v_stage.qty_done, 0) + coalesce(p_added_good, 0) < v_stage.item_qty then
    return null;
  end if;
  -- Снятие действует, пока проверку не вернули; глобальное (order_id
  -- is null) — на все заказы, узкое — на свой
  if exists (
    select 1 from public.erp_bypasses b
     where b.kind = 'material_gate'
       and b.restored_at is null
       and (b.order_id is null or b.order_id = v_stage.order_id)
  ) then
    return null;
  end if;
  -- Дословное зеркало `routes.materialPending`: со склада и «не требуется»
  -- годны без приёмки, пришедшее закупочное — только после неё
  select string_agg(m.name, ', ' order by m.name)
    into v_names
    from public.erp_materials m
   where m.order_id = v_stage.order_id
     and (m.item_id is null or m.item_id = v_stage.item_id)
     and coalesce(m.status, '') not in ('reserved', 'not_needed')
     and (coalesce(m.status, '') <> 'received'
          or coalesce(m.accept_status, '') not in ('accepted_full', 'accepted_partial'));
  if v_names is null then
    return null;
  end if;
  return 'Закупка не завершена: ' || v_names
    || '. Этап можно закрыть, когда материалы придут и склад их примет.';
end $$;

comment on function public.erp_stage_completion_block(uuid, int, boolean) is
  'Почему этап нельзя закрыть, или NULL: программа вышивки (п. 3); при p_final — судьба остатков рулонов (п. 2) и не учтённые изделия у производственного участка с формой (п. 7); закупка (04.09: reserved/not_needed либо received с приёмкой accepted_full/accepted_partial). Зеркало клиентского stageGates.completionBlockFor + stageDone.stageCompletionBlock; правки 27.09.';

revoke execute on function public.erp_stage_completion_block(uuid, int, boolean) from public, anon;
grant execute on function public.erp_stage_completion_block(uuid, int, boolean) to authenticated;

-- ── Триггер: прямой переход в done проходит тот же гейт ──
create or replace function public.erp_stage_done_gate()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_block text;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.status = 'done' and old.status is distinct from 'done'
     and coalesce(current_setting('erp.force_complete', true), '') <> 'on'
     and coalesce(current_setting('erp.moving', true), '') <> 'on'
     and coalesce(current_setting('erp.subcontract_rollup', true), '') <> 'on'
     and coalesce(current_setting('erp.supply_autoclose', true), '') <> 'on'
  then
    v_block := public.erp_stage_completion_block(
      new.id,
      greatest(coalesce(new.qty_done, 0) - coalesce(old.qty_done, 0), 0),
      true);
    if v_block is not null then
      raise exception '%', v_block using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

comment on function public.erp_stage_done_gate() is
  'Переход этапа в done проходит erp_stage_completion_block(p_final) — тот же гейт, что у сдачи результата, теперь и у кнопки, канбана и чипа плана. Пропуск: service role и метки erp.force_complete / erp.moving / erp.subcontract_rollup / erp.supply_autoclose (правки 27.09, пп. 2, 3, 7).';

revoke execute on function public.erp_stage_done_gate() from anon, authenticated, public;

drop trigger if exists erp_item_stages_done_gate on public.erp_item_stages;
create trigger erp_item_stages_done_gate
  before update of status on public.erp_item_stages
  for each row execute function public.erp_stage_done_gate();
