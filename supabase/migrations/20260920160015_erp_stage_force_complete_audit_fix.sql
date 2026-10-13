-- ПРИНУДИТЕЛЬНОЕ ЗАВЕРШЕНИЕ НЕ ПИШЕТ АУДИТ ЗАКАЗА РУКАМИ (правка 20.09, п. 5;
-- исправление к 20260920155451, найдено живой проверкой от лица директора).
--
-- Что показала проверка. Директор получал
--   42501 new row violates row-level security policy for table "erp_order_audit"
-- на совершенно правильном действии: право есть, страж пропустил, этап
-- обновился — и всё откатилось на записи в аудит.
--
-- ПОЧЕМУ ТАК И ПОЧЕМУ ЭТО НЕ НАДО «ЧИНИТЬ ПОЛИТИКОЙ». У `erp_order_audit`
-- есть только политика SELECT, и это НАМЕРЕННО: в проекте аудит заказа пишут
-- исключительно триггеры (`erp_log_changes`, `erp_log_order_changes`,
-- `erp_log_stage_plan_changes`), все `security definer`. Журнал, в который
-- может дописать прикладная функция, перестаёт быть независимым
-- свидетельством: запись о действии должна появляться ОТ САМОГО ИЗМЕНЕНИЯ
-- данных, а не от доброй воли того, кто это изменение сделал. Добавить сюда
-- INSERT-политику значило бы открыть журнал на запись всему, что работает
-- от лица участника.
--
-- А ЗАПИСЬ В АУДИТЕ ПРИ ЭТОМ ЕСТЬ. Триггер `erp_stages_audit` уже
-- перечисляет `status` среди отслеживаемых колонок, то есть переход этапа
-- в `done` попадает в аудит заказа сам, без единой строки здесь. Ручная
-- вставка была не просто невозможной — она была ВТОРОЙ записью об одном
-- событии.
--
-- Причина принудительного завершения не теряется: она уходит
-- в `erp_stage_events.comment` (история этапа, у неё INSERT-политика есть)
-- и в `erp_item_stages.notes`, который виден в самом задании.
--
-- Вывод для следующего раза: проверка «от лица роли» (`set local role
-- authenticated` + `request.jwt.claims`) обязательна не только для отказов,
-- но и для успешного пути. Сторожевой тест читает текст миграции и про RLS
-- чужой таблицы ничего не знает — он был зелёным.

create or replace function public.erp_stage_force_complete(
  p_stage_id uuid,
  p_reason text
)
returns public.erp_item_stages
language plpgsql security invoker set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_stage  public.erp_item_stages;
  v_order  uuid;
  v_actor  text;
begin
  if not public.erp_has_permission('stage.force_complete') then
    raise exception 'erp_stage_force_complete: нужно право stage.force_complete'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'erp_stage_force_complete: нужна причина принудительного завершения'
      using errcode = '22023';
  end if;

  select s.* into v_stage from public.erp_item_stages s where s.id = p_stage_id;
  if not found then
    raise exception 'erp_stage_force_complete: этап не найден' using errcode = 'P0002';
  end if;

  -- ТОЛЬКО ТЕКУЩИЙ НЕЗАВЕРШЁННЫЙ (документ). Закрытый этап закрывать нечем,
  -- а пропущенный закрывать незачем — и молчаливый успех в обоих случаях
  -- выглядел бы как выполненное действие.
  if v_stage.status in ('done', 'skipped') then
    raise exception 'erp_stage_force_complete: этап уже закрыт (%)', v_stage.status
      using errcode = 'P0001';
  end if;

  select i.order_id into v_order
    from public.erp_order_items i where i.id = v_stage.item_id;

  v_actor := coalesce(
    current_setting('request.jwt.claims', true)::jsonb->>'email', 'system');

  -- Метка живёт ровно одну транзакцию и снимается сразу после UPDATE:
  -- оставленная включённой, она превратила бы право в пропуск для всего,
  -- что эта транзакция сделает с этапами дальше.
  perform set_config('erp.force_complete', 'on', true);

  update public.erp_item_stages
     set status = 'done',
         finished_at = coalesce(finished_at, now()),
         -- Количество НЕ трогаем: сколько сдано, столько и останется.
         notes = case
           when coalesce(btrim(notes), '') = '' then 'Завершено принудительно: ' || v_reason
           else notes || E'\n' || 'Завершено принудительно: ' || v_reason
         end
   where id = p_stage_id
   returning * into v_stage;

  perform set_config('erp.force_complete', 'off', true);

  -- История этапа — здесь. Аудит заказа пишет триггер `erp_stages_audit`
  -- от самого перехода статуса (см. шапку файла).
  insert into public.erp_stage_events
    (stage_id, order_id, actor, actor_id, from_status, to_status, qty_done, qty_rework, comment)
  values (
    p_stage_id, v_order, v_actor,
    nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid,
    null, 'done', v_stage.qty_done, v_stage.qty_rework,
    'Принудительное завершение: ' || v_reason
  );

  return v_stage;
end $$;

comment on function public.erp_stage_force_complete(uuid, text) is
  'Закрывает ОДИН заблокированный этап без обычных условий завершения (правка 20.09, п. 5). Право stage.force_complete проверяется на сервере, причина обязательна, количество не меняется, последующие этапы не пропускаются. Историю пишет событие этапа; аудит заказа ведёт триггер erp_stages_audit, у erp_order_audit INSERT-политики нет намеренно.';

revoke execute on function public.erp_stage_force_complete(uuid, text) from public, anon;
grant execute on function public.erp_stage_force_complete(uuid, text) to authenticated;
