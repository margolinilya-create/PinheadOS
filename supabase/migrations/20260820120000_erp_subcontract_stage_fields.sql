-- Поля подрядного этапа заполняются в маршруте (правки заказчика 20.08).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Если при построении маршрута менеджер выбирает этап
-- "Подряд", внутри этапа открываются дополнительные поля: Операция ·
-- Подрядчик · Количество · Плановая дата передачи · Плановая дата возврата ·
-- Ответственный Pinhead · Что передаём подрядчику · Комментарий · ТЗ/файлы».
--
-- Из девяти полей в модели было четыре, и три отсутствовали в схеме вовсе.
-- Добавляются:
--   · `send_plan_date` — плановая дата ПЕРЕДАЧИ. `planned_date` в этой таблице
--     означает возврат (так её читают экран и расчёт просрочки), и подмешивать
--     туда второй смысл нельзя;
--   · `responsible` — ответственный со стороны Pinhead. Не `assignee` этапа:
--     тот исполнитель работы, а здесь тот, кто ведёт передачу;
--   · `comment` — свободный комментарий к подряду. Существующий `delay_comment`
--     занят под «почему задержка», и писать в него «Stone Wash» значит
--     объявить заказ задержанным.
-- «Что передаём» — это `materials_note`, поле уже есть и означает ровно это.
--
-- ОБА ПИСАТЕЛЯ СПУТНИКА ПРАВЯТСЯ ОДНИМ КОММИТОМ. Строку `erp_subcontracting`
-- заводят `erp_create_order` и `erp_route_apply`, тем же оператором, что и сам
-- этап; третьего писателя связи `stage_id` быть не должно — именно её
-- отсутствие когда-то сделало раздел «Подряд» тупиком. Значит новые поля
-- принимают обе функции, иначе половина заполненного молча пропадала бы
-- в зависимости от того, создан заказ или отредактирован.
--
-- Функции пересозданы ПОДЛИННЫМ ДЕЙСТВУЮЩИМ текстом, и это здесь не формальность.
-- Репозиторий отставал от базы: 18.08 к проду применили три миграции, которых
-- в `supabase/migrations/` не было (восстановлены рядом), и действующая
-- `erp_create_order` пишет ещё две колонки — `tz_order_id` и `tz_number`,
-- связь заказа с ТЗ. Возьми я текст из репозитория, пересоздание молча
-- ВЫБРОСИЛО БЫ эту связь: заказы, созданные из ТЗ, перестали бы к нему
-- привязываться, и ни одна проверка этого бы не заметила.
--
-- КОЛИЧЕСТВО. Раньше в спутник уезжал весь тираж позиции. Документ требует
-- частичных партий («первые 200 из 500 уходят на варку»), поэтому количество
-- берётся из шага маршрута, а тираж остаётся запасным значением.

alter table public.erp_subcontracting
  add column if not exists send_plan_date date,
  add column if not exists responsible    text,
  add column if not exists comment        text;

comment on column public.erp_subcontracting.send_plan_date is
  'Плановая дата передачи подрядчику. Возврат — planned_date.';
comment on column public.erp_subcontracting.responsible is
  'Ответственный Pinhead за передачу и возврат (не исполнитель этапа).';
comment on column public.erp_subcontracting.comment is
  'Комментарий к подрядной операции. delay_comment — только про задержку.';

-- ── Создание заказа ──────────────────────────────────────────────────────────
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
  v_mat_id uuid;
  v_mat_ids uuid[] := '{}';
  v_doc jsonb;
  v_att jsonb;
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
     status, created_by, tz_required, tz_order_id, tz_number)
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
     coalesce((v_order->>'tz_required')::boolean, true),
     nullif(v_order->>'tz_order_id', '')::uuid,
     v_order->>'tz_number')
  returning id into v_order_id;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into erp_order_items
      (order_id, product_type, variant, qty, production_type,
       branding_methods, branding_on, notes, size_grid, sort_order,
       subcontract_kind, material_source,
       fit, trim_material, cutting_note, sewing_note, labels_note,
       packaging, packaging_size, sticker_place, marking_place, packaging_note)
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
       v_item->>'material_source',
       v_item->>'fit',
       v_item->>'trim_material',
       v_item->>'cutting_note',
       v_item->>'sewing_note',
       v_item->>'labels_note',
       coalesce(v_item->>'packaging', 'inherit'),
       v_item->>'packaging_size',
       v_item->>'sticker_place',
       v_item->>'marking_place',
       v_item->>'packaging_note')
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

      insert into erp_item_stages
        (item_id, department_id, sort_order, depends_on, queue_position,
         executor, contractor, operation)
      values
        (v_item_id,
         (v_stage->>'department_id')::uuid,
         coalesce((v_stage->>'sort_order')::int, 0),
         coalesce(v_depends, '{}'),
         v_queue_pos,
         coalesce(v_stage->>'executor', 'internal'),
         v_stage->>'contractor',
         v_stage->>'operation')
      returning id into v_stage_id;

      -- Карточка подрядчика заводится ВМЕСТЕ с подрядным этапом — тем же
      -- правилом, что в `erp_route_apply`. Второго писателя связи `stage_id`
      -- быть не должно: именно её отсутствие и делало раздел «Подряд» тупиком.
      if coalesce(v_stage->>'executor', 'internal') = 'contractor' then
        insert into erp_subcontracting
          (order_id, item_id, stage_id, operation, contractor, qty, material_source,
           send_plan_date, planned_date, responsible, materials_note, comment)
        select v_order_id, v_item_id, v_stage_id,
               coalesce(nullif(btrim(coalesce(v_stage->>'operation', '')), ''), d.name),
               v_stage->>'contractor',
               -- Количество подряда: сколько отдаём НА ЭТОМ этапе. Документ
               -- требует частичных партий («первые 200 из 500 уходят на варку»),
               -- и молчаливая подстановка всего тиража сделала бы плановое
               -- число неправдой ещё до первой передачи
               coalesce((v_stage->>'qty')::int, (v_item->>'qty')::int, 0),
               coalesce(v_item->>'material_source', 'pinhead'),
               (v_stage->>'send_plan_date')::date,
               (v_stage->>'planned_date')::date,
               v_stage->>'responsible',
               v_stage->>'materials_note',
               v_stage->>'comment'
          from erp_departments d
         where d.id = (v_stage->>'department_id')::uuid;
      end if;

      v_stage_ids := v_stage_ids || v_stage_id;
    end loop;
  end loop;

  v_mat_ids := '{}';
  for v_mat in
    select * from jsonb_array_elements(coalesce(payload->'materials', '[]'::jsonb))
  loop
    insert into erp_materials
      (order_id, item_id, kind, name, source, qty, status, eta_date, notes,
       role, color, article, supplier, qty_expected, unit, manager_note)
    values
      (v_order_id,
       case
         when jsonb_typeof(v_mat->'item_index') = 'number'
         then v_item_ids[(v_mat->>'item_index')::int + 1]
       end,
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
       (v_mat->>'qty_expected')::numeric,
       v_mat->>'unit',
       v_mat->>'manager_note')
    returning id into v_mat_id;

    -- Строки закупки нумеруются в порядке payload — по этому индексу к ним
    -- адресуются файлы (`material_index`), ровно как ТЗ к позициям
    v_mat_ids := v_mat_ids || v_mat_id;
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


  -- Вложения (упаковка, техблок, лист закупки). Файлы уже в бакете — грузятся
  -- при выборе, как ТЗ: форма не должна показывать приложенным то, чего
  -- в Storage нет. `item_index = null` — файл всего заказа.
  for v_att in
    select * from jsonb_array_elements(coalesce(payload->'attachments', '[]'::jsonb))
  loop
    insert into erp_order_attachments
      (order_id, item_id, material_id, file_path, file_name, kind, uploaded_by)
    values
      (v_order_id,
       case
         when jsonb_typeof(v_att->'item_index') = 'number'
         then v_item_ids[(v_att->>'item_index')::int + 1]
       end,
       -- Файл строки листа закупки: «фотография материала, скрин позиции
       -- поставщика, референс» (п. 14 документа) относится к КОНКРЕТНОЙ строке,
       -- а не к заказу целиком — иначе закупщик получает кучу картинок без
       -- ответа на вопрос, к чему они
       case
         when jsonb_typeof(v_att->'material_index') = 'number'
         then v_mat_ids[(v_att->>'material_index')::int + 1]
       end,
       v_att->>'file_path',
       v_att->>'file_name',
       coalesce(v_att->>'kind', 'attachment'),
       v_att->>'uploaded_by');
  end loop;

  return v_order_id;
end $$;

grant execute on function public.erp_create_order(jsonb) to authenticated;

-- ── Правка маршрута ──────────────────────────────────────────────────────────
--
-- Поля подряда приходят В САМОМ ШАГЕ маршрута (`p_steps`), поэтому и заведение,
-- и обновление спутника читают их оттуда через `left join lateral` по
-- `stage_id`. `coalesce(новое, прежнее)` в обновлении означает «не присланное
-- поле не трогаем»: правка маршрута не должна стирать то, что раздел «Подряд»
-- заполнил после передачи.
create or replace function public.erp_route_apply(p_item_id uuid, p_steps jsonb)
returns setof public.erp_item_stages
language plpgsql
set search_path to 'public'
as $$
declare
  v_step      jsonb;
  v_ids       uuid[] := '{}';
  v_id        uuid;
  v_keep      uuid[] := '{}';
  v_depends   uuid[];
  v_queue     numeric;
  v_idx       int := 0;
  v_order_id  uuid;
  v_qty       int;
begin
  if not public.erp_has_permission('order.manage') then
    raise exception 'erp_route_apply: правка маршрута требует права order.manage'
      using errcode = '42501';
  end if;

  select i.order_id, i.qty into v_order_id, v_qty
    from public.erp_order_items i where i.id = p_item_id;
  if v_order_id is null then
    raise exception 'erp_route_apply: позиция не найдена' using errcode = 'P0002';
  end if;

  -- Приоритет новых этапов берём у соседей позиции: этап, попавший в очередь
  -- цеха с пустым queue_position, встал бы в её конец независимо от срока
  select coalesce(min(queue_position), public.erp_default_queue_position(
           (select o.due_date from public.erp_orders o where o.id = v_order_id)))
    into v_queue
    from public.erp_item_stages where item_id = p_item_id;

  -- ПРОХОД 1: вставляем новые и обновляем существующие, собирая их id по порядку.
  -- depends_on проставляем во втором проходе — этап может зависеть от другого
  -- НОВОГО этапа, которого в первый момент ещё нет.
  for v_step in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    if (v_step->>'stage_id') is null then
      insert into public.erp_item_stages
        (item_id, department_id, sort_order, depends_on, queue_position,
         executor, contractor, operation)
      values
        (p_item_id,
         (v_step->>'department_id')::uuid,
         (v_step->>'sort_order')::int,
         '{}',
         v_queue,
         coalesce(v_step->>'executor', 'internal'),
         v_step->>'contractor',
         v_step->>'operation')
      returning id into v_id;
    else
      v_id := (v_step->>'stage_id')::uuid;
      update public.erp_item_stages
         set department_id = (v_step->>'department_id')::uuid,
             sort_order    = (v_step->>'sort_order')::int,
             executor      = coalesce(v_step->>'executor', 'internal'),
             contractor    = v_step->>'contractor',
             operation     = v_step->>'operation'
       where id = v_id and item_id = p_item_id;
      if not found then
        raise exception 'erp_route_apply: этап % не принадлежит позиции', v_id
          using errcode = '22023';
      end if;
    end if;
    v_ids := v_ids || v_id;
    v_keep := v_keep || v_id;
  end loop;

  -- ПРОХОД 2: зависимости. В payload это ИНДЕКСЫ массива — тот же приём,
  -- что в erp_create_order и erp_experimental_add_tasks: у нового этапа
  -- идентификатора на момент сборки payload ещё нет.
  v_idx := 0;
  for v_step in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    select coalesce(array_agg(v_ids[(d.i)::int + 1]), '{}')
      into v_depends
      from jsonb_array_elements_text(coalesce(v_step->'depends_on', '[]'::jsonb)) as d(i)
     where v_ids[(d.i)::int + 1] is not null;

    update public.erp_item_stages
       set depends_on = coalesce(v_depends, '{}')
     where id = v_ids[v_idx];
  end loop;

  -- Спутники подряда у этапов, переставших быть подрядными, убираем ЯВНО:
  -- внешний ключ объявлен `on delete set null`, и каскад оставил бы строку
  -- подряда без этапа — то самое состояние, из-за которого раздел жил
  -- собственной жизнью.
  delete from public.erp_subcontracting sc
   where sc.stage_id = any (v_keep)
     and not exists (
       select 1 from public.erp_item_stages s
        where s.id = sc.stage_id and s.executor = 'contractor');

  -- Удаляем этапы, выпавшие из маршрута. Условие «без факта» повторяет
  -- RLS-политику: страж и гейт интерфейса обязаны совпадать значением.
  delete from public.erp_subcontracting
   where stage_id in (
     select id from public.erp_item_stages
      where item_id = p_item_id and not (id = any (v_keep)));

  delete from public.erp_item_stages
   where item_id = p_item_id
     and not (id = any (v_keep))
     and status in ('waiting', 'ready')
     and coalesce(qty_done, 0) = 0
     and coalesce(qty_rework, 0) = 0
     and started_at is null;

  -- Карточка подрядчика у каждого подрядного этапа. Имя подрядчика при правке
  -- маршрута ОБНОВЛЯЕТСЯ, а сроки, количества и оплата — нет: их ведёт раздел
  -- «Подряд», и правка маршрута не должна стирать факт передачи.
  insert into public.erp_subcontracting
    (order_id, item_id, stage_id, operation, contractor, qty, material_source,
     send_plan_date, planned_date, responsible, materials_note, comment)
  select v_order_id, p_item_id, s.id,
         coalesce(nullif(btrim(coalesce(s.operation, '')), ''), d.name),
         s.contractor,
         coalesce((st.step->>'qty')::int, v_qty),
         'pinhead',
         (st.step->>'send_plan_date')::date,
         (st.step->>'planned_date')::date,
         st.step->>'responsible',
         st.step->>'materials_note',
         st.step->>'comment'
    from public.erp_item_stages s
    join public.erp_departments d on d.id = s.department_id
    left join lateral (
      select e.value as step
        from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) as e(value)
       where (e.value->>'stage_id')::uuid = s.id
       limit 1
    ) st on true
   where s.item_id = p_item_id
     and s.executor = 'contractor'
     and not exists (
       select 1 from public.erp_subcontracting sc where sc.stage_id = s.id);

  update public.erp_subcontracting sc
     set contractor     = s.contractor,
         operation      = coalesce(nullif(btrim(coalesce(s.operation, '')), ''), sc.operation),
         qty            = coalesce((st.step->>'qty')::int, sc.qty),
         send_plan_date = coalesce((st.step->>'send_plan_date')::date, sc.send_plan_date),
         planned_date   = coalesce((st.step->>'planned_date')::date, sc.planned_date),
         responsible    = coalesce(st.step->>'responsible', sc.responsible),
         materials_note = coalesce(st.step->>'materials_note', sc.materials_note),
         comment        = coalesce(st.step->>'comment', sc.comment)
    from public.erp_item_stages s
    left join lateral (
      select e.value as step
        from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) as e(value)
       where (e.value->>'stage_id')::uuid = s.id
       limit 1
    ) st on true
   where sc.stage_id = s.id
     and s.item_id = p_item_id
     and s.executor = 'contractor';

  return query
    select * from public.erp_item_stages
     where item_id = p_item_id
     order by sort_order;
end $$;

grant execute on function public.erp_route_apply(uuid, jsonb) to authenticated;

comment on function public.erp_route_apply(uuid, jsonb) is
  'Сохранение маршрута позиции одной транзакцией: вставка новых этапов, обновление существующих, пересчёт depends_on по индексам, удаление выпавших без факта, заведение карточки подрядчика у подрядных этапов. Маршрут считает КЛИЕНТ (utils/routeDraft) — сервер отвечает за атомарность.';
