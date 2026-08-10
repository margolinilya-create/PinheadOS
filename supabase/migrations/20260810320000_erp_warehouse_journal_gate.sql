-- Складская запись в журнале — под `warehouse.manage`.
--
-- ЧТО ИЗМЕНИЛОСЬ В САМОМ ЖУРНАЛЕ. Заказчик подтвердил 10.08, что журналы
-- остаются открытыми любому участнику, и для ЭТАПОВ это по-прежнему верно:
-- строка с якорем `stage_id` ничего не решает, а настоящее решение — счётчики
-- этапа — проверяет `erp_stage_guard` (количество под `stage.progress`,
-- брак под `stage.defect`).
--
-- Но у СКЛАДСКОЙ строки такого гейта нет, и с этого дня она перестала быть
-- просто записью: `erp_warehouse_submit_report` закрывает приёмку готовой
-- продукции по накопленной сумме журнала, а закрытая приёмка открывает
-- упаковку. То есть запись в журнал стала производственным переходом —
-- и обходила `warehouse.manage`, введённое тем же днём.
--
-- Швея могла записать «принято 100» по чужому заказу и тем самым открыть
-- упаковку непересчитанной продукции. Ровно то, ради чего право заводили.
--
-- Разделение проведено ПО ЯКОРЮ, а не по таблице: одна политика на оба вида
-- строк не может отличить журнал от перехода, а две таблицы означали бы
-- «сколько изделий приняли» в двух местах с разными правилами — то, чего
-- волна 3.4 избегала намеренно.

drop policy if exists "erp_stage_reports_insert" on public.erp_stage_reports;
create policy "erp_stage_reports_insert" on public.erp_stage_reports
  for insert to authenticated
  with check (
    case
      -- Складская строка закрывает задачу приёмки → это действие склада
      when warehouse_task_id is not null then public.erp_has_permission('warehouse.manage')
      -- Строка этапа — журнал; решение гейтит erp_stage_guard на счётчиках
      else public.erp_is_member()
    end
  );

comment on table public.erp_stage_reports is
  'Журнал результатов: этапы и складские задачи. Строка этапа — запись (решение гейтит erp_stage_guard на счётчиках), строка склада — переход: она закрывает приёмку ГП по накопленной сумме и тем открывает упаковку, поэтому требует warehouse.manage.';

-- RPC складского отчёта SECURITY INVOKER, поэтому политика выше действует
-- и на него. Но `update` статуса задачи внутри него идёт от того же лица —
-- проверяем право явно, чтобы отказ назывался своим именем, а не приходил
-- из политики соседней таблицы.
create or replace function public.erp_warehouse_submit_report(
  p_task_id uuid,
  p_qty_in int,
  p_qty_good int,
  p_qty_defect int default 0,
  p_comment text default null,
  p_extra jsonb default '{}'::jsonb
)
returns public.erp_warehouse_tasks
language plpgsql security invoker set search_path = public as $$
declare
  v_row public.erp_warehouse_tasks;
  v_expected int;
  v_accepted int;
begin
  if not public.erp_has_permission('warehouse.manage') then
    raise exception 'erp_warehouse_submit_report: приёмка склада требует права warehouse.manage'
      using errcode = '42501';
  end if;

  insert into public.erp_stage_reports
    (warehouse_task_id, qty_in, qty_good, qty_defect, comment, extra, author, author_id)
  values
    (p_task_id, p_qty_in, coalesce(p_qty_good, 0), coalesce(p_qty_defect, 0),
     nullif(btrim(p_comment), ''), coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid);

  select * into v_row from public.erp_warehouse_tasks where id = p_task_id;

  -- Приёмка ГП закрывается, когда НАКОПЛЕННАЯ приёмка добрала тираж.
  -- Брак в зачёт не идёт: он объясняет расхождение, а не заменяет недостающее.
  if v_row.task_type = 'fg_receipt' and v_row.status <> 'accepted' then
    select coalesce(sum(it.qty), 0) into v_expected
      from public.erp_order_items it where it.order_id = v_row.order_id;

    select coalesce(sum(r.qty_good), 0) into v_accepted
      from public.erp_stage_reports r where r.warehouse_task_id = p_task_id;

    if v_expected > 0 and v_accepted >= v_expected then
      update public.erp_warehouse_tasks set status = 'accepted' where id = p_task_id
      returning * into v_row;
    end if;
  end if;

  return v_row;
end $$;

revoke execute on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb)
  from public, anon;
grant execute on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb)
  to authenticated;

comment on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb) is
  'Отчёт склада: строка журнала с якорем warehouse_task_id плюс закрытие приёмки ГП по накопленной сумме. Требует warehouse.manage — запись стала производственным переходом (закрытая приёмка открывает упаковку).';
