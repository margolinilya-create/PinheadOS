-- Уборка старой модели экспериментального цеха и мёртвой таблицы ТЗ.
--
-- ── Почему СЕЙЧАС, а не вместе с новой моделью ──
--
-- Порядок выкладки в проекте — миграция → прод → фронтенд. Между миграцией
-- `20260812120000` и выкладкой нового экрана работал СТАРЫЙ бандл: он читал
-- `from('erp_experimental_ops')` и писал `insert { phase: 'patterns' }`.
-- Дропни колонки тогда — старый фронт получил бы 42703 на каждом создании
-- разработки. Новый экран выложен в прод и проверен, окно закрылось.
--
-- ── Что убираем и почему это точно мертво ──
--
-- 1. `erp_experimental.phase` — фазы заменены задачами. Состояние разработки
--    ВЫЧИСЛЯЕТСЯ (`utils/experimentalTasks.devState`), хранится только исход.
--    Данные перенесены: 6 открытых разработок получили по задаче, отражающей
--    прежнюю фазу, 3 закрытых — `outcome`.
--
-- 2. `final_outcome` → `outcome` (перенесено), `constructor_return_comment` →
--    комментарий задачи «Доработка лекал». «Возврат конструктору» перестал быть
--    фазой: это РЕЗУЛЬТАТ примерки, и он заводит новый круг задач.
--
-- 3. `erp_experimental_ops` — 2 строки перенесены в `erp_experimental_tasks`.
--    Её `kind` (`to_sewing`/`to_branding`) был частным случаем «задача, отданная
--    в цех», и отдельная машина состояний рядом с задачами — это ровно два
--    источника правды.
--
-- 4. `erp_experimental_send_to_dept(uuid,uuid,date)` — заменена на
--    `erp_experimental_task_send`, которая берёт позицию из разработки
--    и той же транзакцией привязывает `stage_id`. Живая функция с устаревшей
--    семантикой — приглашение вызвать её мимо задачи.
--
-- 5. `erp_tz_assignments` — поцеховое назначение ТЗ отменено правкой менеджера
--    2026-08-03. Таблица с тех пор ПУСТА (проверено: 0 строк), код её не читает
--    и не пишет, а `erp_create_order` принимает секцию `tz.assignments`, куда
--    клиент шлёт пустой массив. Пустая таблица с политиками и индексами —
--    это то, что при следующем чтении схемы примут за работающий механизм.
--
-- ── Чего НЕ трогаем ──
--
-- `erp_experimental.measurement_table` и `has_3d` остаются: это поля изделия,
-- а не фазовой машины, и заказчик от них не отказывался.

-- ── 1. Realtime: снять таблицу с публикации ДО удаления ──
alter publication supabase_realtime drop table public.erp_experimental_ops;

-- ── 2. RPC старой передачи в цех ──
drop function if exists public.erp_experimental_send_to_dept(uuid, uuid, date);

-- ── 3. Таблица операций разработки ──
drop table if exists public.erp_experimental_ops;

-- ── 4. Колонки фазовой модели ──
alter table public.erp_experimental
  drop column if exists phase,
  drop column if exists final_outcome,
  drop column if exists constructor_return_comment;

-- ── 5. `erp_create_order` без вставки в назначения ──
--
-- Функцию пересоздаём ПОДЛИННЫМ текстом прежней миграции (правило проекта:
-- «пересоздаёшь функцию целиком — бери исходный текст, а не пиши по памяти»),
-- удалён РОВНО один цикл и одна переменная — 19 строк, сверено построчно.
-- Секция `tz.assignments` в payload остаётся принимаемой и игнорируется:
-- клиент шлёт пустой массив, а падать на лишнем ключе значило бы сломать
-- старый бандл ради чистоты.

create or replace function public.erp_create_order(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order jsonb := payload->'order';
  v_order_id uuid;
  v_due date;
  v_queue_pos numeric;
  v_item jsonb;
  v_item_id uuid;
  v_item_ids uuid[] := '{}';
  v_print jsonb;
  v_stage jsonb;
  v_stage_id uuid;
  v_stage_ids uuid[];
  v_depends uuid[];
  v_mat jsonb;
  v_doc jsonb;
  v_idx int;
begin
  if v_order is null or coalesce(v_order->>'title', '') = '' then
    raise exception 'erp_create_order: order.title is required';
  end if;

  v_due := (v_order->>'due_date')::date;
  v_queue_pos := public.erp_default_queue_position(v_due);

  insert into erp_orders
    (bitrix_id, title, customer, manager, launch_date, due_date, buffer_days, notes,
     packaging, packaging_note, stickers, stickers_note, no_chestny_znak,
     status, created_by, tz_required)
  values
    (v_order->>'bitrix_id',
     v_order->>'title',
     v_order->>'customer',
     v_order->>'manager',
     (v_order->>'launch_date')::date,
     v_due,
     coalesce((v_order->>'buffer_days')::int, 0),
     v_order->>'notes',
     coalesce(v_order->>'packaging', 'none'),
     v_order->>'packaging_note',
     coalesce(v_order->>'stickers', 'none'),
     v_order->>'stickers_note',
     coalesce((v_order->>'no_chestny_znak')::boolean, false),
     coalesce(v_order->>'status', 'active'),
     nullif(v_order->>'created_by', '')::uuid,
     coalesce((v_order->>'tz_required')::boolean, true))
  returning id into v_order_id;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into erp_order_items
      (order_id, product_type, variant, qty, production_type,
       branding_methods, branding_on, notes, size_grid, sort_order,
       subcontract_kind, material_source)
    values
      (v_order_id,
       v_item->>'product_type',
       v_item->>'variant',
       (v_item->>'qty')::int,
       coalesce(v_item->>'production_type', 'sewing'),
       coalesce(
         (select array_agg(t.x)
            from jsonb_array_elements_text(
              case when jsonb_typeof(v_item->'branding_methods') = 'array'
                   then v_item->'branding_methods' else '[]'::jsonb end) as t(x)),
         '{}'),
       coalesce(v_item->>'branding_on', 'cut'),
       v_item->>'notes',
       case when jsonb_typeof(v_item->'size_grid') = 'array'
            then v_item->'size_grid' end,
       coalesce((v_item->>'sort_order')::int, 0),
       v_item->>'subcontract_kind',
       v_item->>'material_source')
    returning id into v_item_id;

    -- Позиции нумеруются в порядке payload — по этому индексу адресуются назначения ТЗ
    v_item_ids := v_item_ids || v_item_id;

    for v_print in
      select * from jsonb_array_elements(coalesce(v_item->'prints', '[]'::jsonb))
    loop
      insert into erp_item_prints
        (item_id, seq, method, fabric, zone, width_mm, height_mm,
         offset_note, pantone, comment)
      values
        (v_item_id,
         coalesce((v_print->>'seq')::int, 1),
         v_print->>'method',
         v_print->>'fabric',
         v_print->>'zone',
         (v_print->>'width_mm')::int,
         (v_print->>'height_mm')::int,
         v_print->>'offset_note',
         v_print->>'pantone',
         v_print->>'comment');
    end loop;

    v_stage_ids := '{}';
    for v_stage in
      select * from jsonb_array_elements(coalesce(v_item->'stages', '[]'::jsonb))
    loop
      select coalesce(array_agg(v_stage_ids[(d.idx)::int + 1]), '{}')
        into v_depends
        from jsonb_array_elements_text(coalesce(v_stage->'depends_on', '[]'::jsonb)) as d(idx)
       where v_stage_ids[(d.idx)::int + 1] is not null;

      insert into erp_item_stages (item_id, department_id, sort_order, depends_on, queue_position)
      values
        (v_item_id,
         (v_stage->>'department_id')::uuid,
         coalesce((v_stage->>'sort_order')::int, 0),
         coalesce(v_depends, '{}'),
         v_queue_pos)
      returning id into v_stage_id;

      v_stage_ids := v_stage_ids || v_stage_id;
    end loop;
  end loop;

  for v_mat in
    select * from jsonb_array_elements(coalesce(payload->'materials', '[]'::jsonb))
  loop
    insert into erp_materials
      (order_id, kind, name, source, qty, status, eta_date, notes,
       role, color, article, supplier, qty_expected)
    values
      (v_order_id,
       coalesce(v_mat->>'kind', 'other'),
       v_mat->>'name',
       coalesce(v_mat->>'source', 'purchase'),
       v_mat->>'qty',
       coalesce(v_mat->>'status', 'pending'),
       (v_mat->>'eta_date')::date,
       v_mat->>'notes',
       v_mat->>'role',
       v_mat->>'color',
       v_mat->>'article',
       v_mat->>'supplier',
       (v_mat->>'qty_expected')::numeric);
  end loop;

  -- ТЗ: документы (файлы уже в бакете) и назначения на этапы.
  -- item_index = null → общее ТЗ заказа.
  for v_doc in
    select * from jsonb_array_elements(coalesce(payload#>'{tz,documents}', '[]'::jsonb))
  loop
    v_idx := (v_doc->>'item_index')::int;
    insert into erp_tz_documents
      (order_id, item_id, group_id, version, is_current,
       file_path, file_name, mime_type, size_bytes, note, uploaded_by)
    values
      (v_order_id,
       case when v_idx is null then null else v_item_ids[v_idx + 1] end,
       (v_doc->>'group_id')::uuid,
       1, true,
       v_doc->>'file_path',
       v_doc->>'file_name',
       v_doc->>'mime_type',
       (v_doc->>'size_bytes')::bigint,
       v_doc->>'note',
       v_doc->>'uploaded_by');
  end loop;


  return v_order_id;
end $$;

grant execute on function public.erp_create_order(jsonb) to authenticated;

-- ── 6. Мёртвая таблица назначений ТЗ ──
drop table if exists public.erp_tz_assignments;

comment on table public.erp_experimental is
  'Разработка изделия в экспериментальном цехе. Ведёт технолог (experimental.manage); ЗАВОДИТ её тот, кто создаёт заказ-образец (order.manage). Состояние «что происходит сейчас» вычисляется из erp_experimental_tasks — хранится только исход (outcome).';
