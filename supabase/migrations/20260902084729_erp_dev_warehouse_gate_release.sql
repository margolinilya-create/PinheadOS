-- Гейт складских задач получает ВТОРОГО ПИСАТЕЛЯ.
-- Правки заказчика 02.09, п. 2 — вторая половина.
--
-- ЧЕГО НЕ ХВАТАЛО ПЕРВОЙ ПОЛОВИНЕ (`20260902084052`). Гейт «пока у заказа есть
-- разработка с `outcome is null`, приёмки ГП не заводим» стоял ВНУТРИ
-- `erp_warehouse_task_derive`, а тот висит на смене статуса ЭТАПА. Снимается
-- же гейт закрытием РАЗРАБОТКИ — события, которого этот триггер не видит вовсе.
--
-- Для разработки, закрытой «готово к серии», дыры нет: `erp_dev_handoff_to_warehouse`
-- заводит приёмку ГП сам. А вот у любого ДРУГОГО исхода («Отменено», «Нужна
-- доработка», «Передано в основной цех» — все три кнопки живые) писателя
-- не осталось бы ни одного: этапы к этому моменту закрыты, новых переходов
-- не будет, и заказ повис бы без приёмки ГП НАВСЕГДА. То есть гейт превратился
-- бы из починки в тупик — ровно та причина, по которой 10.08 завели
-- `erp_warehouse_fg_accepted`.
--
-- ── РЕШЕНИЕ: ОДНО ВЫРАЖЕНИЕ, ДВА ПИСАТЕЛЯ ──────────────────────────────────
--
-- Условие «работа заказа кончилась — заводим задачи готовой продукции»
-- переезжает в `erp_ensure_order_finish_tasks(order_id)`, и её зовут ОБА:
--   · `erp_warehouse_task_derive` — когда закрылся этап;
--   · `erp_dev_warehouse_gate_release` — когда закрылась разработка.
-- Две копии условия разошлись бы, причём обе «работая»: у каждой свой повод
-- сработать, и заметить расхождение можно только на заказе, попавшем ровно
-- в разницу.
--
-- Предикат «у заказа есть незавершённая разработка» тоже вынесен
-- (`erp_order_has_open_dev`) — его спрашивают и сервер, и клиент
-- (`utils/stageUi.openDevelopments`), и граница обязана совпадать значением:
-- расхождение здесь означает «кнопка есть, действие падает».
--
-- ГЕЙТ СТОИТ РАННИМ ВЫХОДОМ, а не условием у каждой вставки: упаковка
-- и приёмка ГП отвечают на один вопрос — «готовая продукция у заказа есть?»,
-- — и разводить их двумя одинаковыми условиями значит завести два места,
-- где это можно забыть.
--
-- ── ПОЧЕМУ ТРИГГЕР `AFTER`, А НЕ `BEFORE` ─────────────────────────────────
--
-- `erp_dev_handoff_to_warehouse` — BEFORE UPDATE, и внутри него `select outcome
-- from erp_experimental` вернул бы ещё СТАРОЕ значение: предикат счёл бы
-- разработку открытой и отказал в приёмке ровно в тот момент, ради которого
-- гейт снимается. AFTER видит строку уже записанной.
--
-- Страж пакета (`erp_dev_package_guard`) — тоже BEFORE, то есть отрабатывает
-- раньше любого AFTER: неполный финальный пакет отклоняется до того, как здесь
-- что-то заведётся. (Абзац в `20260830130000` объясняет это алфавитным
-- порядком имён триггеров и ошибается: `erp_dev_handoff_to_warehouse_trg` идёт
-- РАНЬШЕ `erp_dev_package_guard`. Поведение верное — страж бросает исключение,
-- и транзакция откатывается целиком, — а объяснение неверное.)
--
-- ── БЭКФИЛЛА НЕТ ──────────────────────────────────────────────────────────
--
-- Триггер ловит ПЕРЕХОД. Разработки, закрытые до этой миграции, задним числом
-- не разбираются: склад этих заказов не ждёт (то же решение, что 30.08).

create or replace function public.erp_order_has_open_dev(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.erp_experimental e
     where e.order_id = p_order_id and e.outcome is null)
$$;

-- Через REST не вызывается и в предикатах RLS не участвует, поэтому отзыв
-- полный: право приходит от PUBLIC, и `anon` наследует его молча.
revoke execute on function public.erp_order_has_open_dev(uuid)
  from public, anon, authenticated;

comment on function public.erp_order_has_open_dev(uuid) is
  'Есть ли у заказа незавершённая разработка образца (outcome is null). Граница дословно совпадает с клиентской utils/stageUi.openDevelopments (правки 02.09, п. 2).';

create or replace function public.erp_ensure_order_finish_tasks(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Разработка образца ещё идёт: готовой продукции у заказа нет, и складу
  -- её отдаст только «Завершить разработку»
  if public.erp_order_has_open_dev(p_order_id) then
    return;
  end if;

  if not exists (
    select 1 from erp_item_stages s
    join erp_order_items i on i.id = s.item_id
    where i.order_id = p_order_id and s.status not in ('done','skipped')
  ) then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select p_order_id, 'fg_receipt', 'awaiting'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = p_order_id and t.task_type = 'fg_receipt'
         and t.stage_id is null);
  end if;

  -- erp_can_pack_ship уже требует принятой приёмки ГП, поэтому задача
  -- заводится сразу «На упаковке»: ждать здесь нечего
  if public.erp_can_pack_ship(p_order_id) then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select p_order_id, 'pack_ship', 'packing'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = p_order_id and t.task_type = 'pack_ship'
         and t.stage_id is null);
  end if;
end $$;

revoke execute on function public.erp_ensure_order_finish_tasks(uuid)
  from public, anon, authenticated;

comment on function public.erp_ensure_order_finish_tasks(uuid) is
  'Задачи готовой продукции заказа (приёмка ГП + упаковка), если работа кончилась и разработка образца закрыта. Одно выражение на двух писателей: erp_warehouse_task_derive (закрылся этап) и erp_dev_warehouse_gate_release (закрылась разработка).';

-- Подлинный текст `20260902084052` с одной заменой: блок приёмки ГП и упаковки
-- уехал в общую функцию. Ветки `material_receipt` и `marking`, а также цикл
-- `erp_ensure_subcontract_send` остаются здесь и гейтом НЕ накрываются: первая
-- обязана идти при открытой разработке (шаг 3 эталонного маршрута), вторая
-- у образца не заводится вовсе, третья — про маршрут, а не про готовую
-- продукцию.
create or replace function public.erp_warehouse_task_derive()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order_id  uuid;
  v_prod_type text;
  v_code      text;
  v_next      uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select i.order_id, i.production_type
    into v_order_id, v_prod_type
    from erp_order_items i where i.id = new.item_id;
  if v_order_id is null then
    return new;
  end if;
  select d.code into v_code from erp_departments d where d.id = new.department_id;

  if v_code = 'supply' and new.status = 'done' then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select v_order_id, 'material_receipt', 'awaiting'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = v_order_id and t.task_type = 'material_receipt'
         and t.stage_id is null);
  end if;

  -- Образцу маркировка не заводится (правки 02.09, решение владельца)
  if v_code = 'sewing' and new.status = 'in_progress'
     and v_prod_type is distinct from 'samples' then
    insert into erp_warehouse_tasks (order_id, item_id, task_type, status)
    select v_order_id, new.item_id, 'marking', 'new'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = v_order_id and t.task_type = 'marking'
         and t.stage_id is null);
  end if;

  if new.status = 'done' then
    perform public.erp_ensure_order_finish_tasks(v_order_id);

    -- Правка 24.08, п. 3: закрытый этап открывает дорогу подрядным, которые
    -- его ждали, — и каждый такой выход идёт через складскую передачу.
    -- Перебираем ВСЕХ зависящих: у позиции бывает несколько подрядных этапов.
    for v_next in
      select s.id from erp_item_stages s
       where s.item_id = new.item_id
         and new.id = any (s.depends_on)
    loop
      perform public.erp_ensure_subcontract_send(v_next);
    end loop;
  end if;

  return new;
end $$;

comment on function public.erp_warehouse_task_derive() is
  'Складские задачи по движению этапов. Задачи готовой продукции делегированы erp_ensure_order_finish_tasks — она же зовётся при закрытии разработки. Маркировка не заводится позициям production_type = samples (решение владельца 02.09).';

create or replace function public.erp_dev_warehouse_gate_release()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Только переход из «разработка идёт» в «разработка закрыта», любым исходом
  if old.outcome is not null or new.outcome is null then
    return new;
  end if;
  perform public.erp_ensure_order_finish_tasks(new.order_id);
  return new;
end $$;

-- Триггерная функция через REST не вызывается: обход
-- `20260812160000_erp_revoke_trigger_functions_sweep` закрыл то, что было
-- НА ТОТ МОМЕНТ, а у заведённой позже обязан быть свой полный revoke.
-- Сторожит `triggerFunctionsRevoked.test.ts`.
revoke execute on function public.erp_dev_warehouse_gate_release()
  from public, anon, authenticated;

comment on function public.erp_dev_warehouse_gate_release() is
  'Закрытие разработки снимает гейт складских задач: этапы к этому моменту закрыты, и erp_warehouse_task_derive больше не сработает никогда (правки 02.09, п. 2).';

drop trigger if exists erp_dev_warehouse_gate_release on public.erp_experimental;

create trigger erp_dev_warehouse_gate_release
  after update of outcome on public.erp_experimental
  for each row execute function public.erp_dev_warehouse_gate_release();
