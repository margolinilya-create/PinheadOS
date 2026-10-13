-- Складские задачи образца ждут кнопку «Завершить разработку».
-- Правки заказчика 02.09, пп. 2 и 4.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Завершение пошива образца не должно закрывать
-- разработку и не должно автоматически отправлять образец на склад…
-- Только нажатие „Завершить разработку“ на финальном этапе должно закрывать
-- разработку образца и запускать дальнейшую уже реализованную складскую
-- логику… Завершение пошива само по себе не должно создавать складские
-- задачи».
--
-- ── ОТКУДА БРАЛИСЬ ЗАДАЧИ РАНЬШЕ СРОКА ──────────────────────────────────────
--
-- Ни одного специального «образцового» пути тут не было: маршрут образца
-- заводил НАСТОЯЩИЕ этапы `cutting` и `sewing` обычных цехов, а этот триггер
-- смотрит только на этапы и `origin` не читает вовсе. Отсюда обе задачи
-- со скриншотов:
--   · «Маркировка» — ветка `sewing → in_progress`;
--   · «Приёмка готовой продукции» — закрытие ПОСЛЕДНЕГО этапа заказа, которым
--     и оказывался пошив образца (его закрывает перенос карточки по доске ЭКС).
-- На проде это видно дословно: заказ «Тест экс цех 2» имеет `board_stage =
-- 'sewing'` и `outcome = null` — то есть разработка идёт, — а сам заказ уже
-- `done`, `fg_receipt:accepted`, `pack_ship:shipped`.
--
-- Маршрут образца правится отдельно (`BASE_CHAIN.samples`), но одной правкой
-- клиента здесь не обойтись, и вот почему: у образца остаётся этап закупки,
-- и после его закрытия «этапов вне done/skipped» у заказа не остаётся —
-- то есть приёмка ГП завелась бы СРАЗУ ПОСЛЕ ЗАКУПКИ, ещё раньше, чем сейчас.
-- Гейт обязателен.
--
-- ── РЕШЕНИЕ 1: ГЕЙТ ПО `outcome`, А НЕ ПО `handed_to_warehouse_at` ──────────
--
-- Разработка, закрытая не «готово к серии» (забракована), на склад НЕ
-- передаётся: `erp_dev_handoff_to_warehouse` реагирует только на переход
-- в `ready_for_serial`. Гейт по факту передачи запер бы такой заказ навсегда —
-- складская задача не завелась бы ни этим триггером, ни тем. Поэтому условие
-- «разработка ещё идёт» = `outcome is null`.
--
-- Заказ без разработки ведёт себя ровно как раньше: `exists` пуст, гейт открыт.
-- Это fail-open по построению — правило проекта.
--
-- ── РЕШЕНИЕ 2: ГЕЙТ НА ОБЕИХ ЗАДАЧАХ ГОТОВОЙ ПРОДУКЦИИ ─────────────────────
--
-- `pack_ship` и без гейта не завёлся бы раньше времени: `erp_can_pack_ship`
-- требует ПРИНЯТОЙ приёмки ГП. Но полагаться на это значит выражать правило
-- через чужую функцию: поменяется она — гейт исчезнет молча. Условие стоит
-- явно у обеих вставок.
--
-- `material_receipt` НЕ гейтится, и это не пропуск: приёмка закупленного —
-- шаг 3 эталонного маршрута образца («закупленные материалы поступают на склад
-- на приёмку»), она идёт ПРИ открытой разработке и обязана идти.
--
-- Ветка `erp_ensure_subcontract_send` тоже вне гейта: она про маршрут
-- (следующий этап подрядчика), а не про готовую продукцию.
--
-- ── РЕШЕНИЕ 3: МАРКИРОВКИ У ОБРАЗЦА НЕТ ВОВСЕ (решение владельца) ──────────
--
-- Отбор по `production_type` позиции, а не по `origin` этапа: вопрос
-- «нужна ли маркировка» решает вид работы (образец или тираж), а не то, каким
-- механизмом заведён этап. `v_prod_type` берётся ТЕМ ЖЕ `select`, что и
-- `v_order_id`, — второго запроса не появляется.
--
-- У смешанного заказа «образец + серия» маркировку по-прежнему заводит швейка
-- серийной позиции: задача принадлежит ЗАКАЗУ и дедуплицируется по нему же.
--
-- ── ПОДЛИННОСТЬ ТЕКСТА ─────────────────────────────────────────────────────
--
-- Основа — текст `20260824191611`, сверенный с боевой базой машиной, а не
-- глазами: md5 тела из файла со снятыми строками-комментариев совпал с md5
-- `pg_proc.prosrc`, обработанным так же (`2448e363…`, 2214 символов с обеих
-- сторон). Расходились только тексты комментариев — их снял путь применения.

create or replace function public.erp_warehouse_task_derive()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order_id  uuid;
  v_prod_type text;
  v_code      text;
  v_next      uuid;
  v_dev_open  boolean;
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
    -- Разработка образца ещё идёт: готовой продукции у заказа нет,
    -- и складу её отдаст только «Завершить разработку» (правки 02.09, п. 2)
    v_dev_open := exists (
      select 1 from erp_experimental e
       where e.order_id = v_order_id and e.outcome is null);

    if not v_dev_open and not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      select v_order_id, 'fg_receipt', 'awaiting'
      where not exists (
        select 1 from erp_warehouse_tasks t
         where t.order_id = v_order_id and t.task_type = 'fg_receipt'
           and t.stage_id is null);
    end if;

    -- erp_can_pack_ship уже требует принятой приёмки ГП, поэтому задача
    -- заводится сразу «На упаковке»: ждать здесь нечего
    if not v_dev_open and public.erp_can_pack_ship(v_order_id) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      select v_order_id, 'pack_ship', 'packing'
      where not exists (
        select 1 from erp_warehouse_tasks t
         where t.order_id = v_order_id and t.task_type = 'pack_ship'
           and t.stage_id is null);
    end if;

    -- Правка 24.08, п. 3: закрытый этап открывает дорогу подрядным, которые
    -- его ждали, — и каждый такой выход идёт через складскую передачу.
    -- Перебираем ВСЕХ зависящих: у позиции бывает несколько подрядных этапов.
    -- Гейт разработки сюда НЕ распространяется: это маршрут, а не готовая
    -- продукция.
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
  'Складские задачи по движению этапов. Приёмка ГП и упаковка не заводятся, пока у заказа есть разработка с outcome is null: образец отдаёт складу только «Завершить разработку» (правки 02.09, п. 2). Маркировка не заводится позициям production_type = samples (решение владельца 02.09).';
