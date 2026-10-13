-- Лист закупки — ФАЙЛ менеджера, а не строки (правки заказчика 20.08).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Лист закупки должен формироваться менеджером
-- сопровождения ДО создания заказа в ERP и загружаться в заказ готовым файлом.
-- Менеджер сопровождения не заводит вручную материалы, количество,
-- поставщиков, цены и сроки прихода в ERP… При создании заказа должно быть
-- обязательно выполнено одно из двух условий: загружен лист закупки; явно
-- отмечено "Закупка не требуется". Если не выполнено ни одно условие — заказ
-- создать нельзя».
--
-- ДВЕ ВЕЩИ В СХЕМЕ:
--
-- 1. `erp_orders.purchase_required` — отметка «закупка не требуется».
--    Хранится, а не выводится из отсутствия материалов: «менеджер решил, что
--    закупать нечего» и «менеджер ещё не дошёл до закупки» — разные состояния,
--    и второе не должно молча закрывать заказу путь к закупщику.
--    По умолчанию `true`: у всех заведённых заказов закупка была.
--
-- 2. Вид вложения `purchase_list` — сам файл. ОТДЕЛЬНО от `purchase`,
--    и это не педантизм: вид `purchase` занят СГЕНЕРИРОВАННЫМ PDF
--    (`att/<order>/purchase/purchase-list.pdf`), а edge-функция при пересборке
--    УДАЛЯЕТ строку вложения с этим путём. Положи файл менеджера тем же видом —
--    и первая же пересборка PDF снесла бы исходный лист.
--
-- Маршрут: этап `supply` заводится только когда закупка требуется. Правило
-- живёт в `utils/routes.buildItemRoute` (клиент считает маршрут, сервер его
-- материализует) — это же снимает «автоматическую связь Подряд → Закупка»,
-- о которой документ просит отдельно: закупка появляется не потому, что
-- маршрут такой, а потому что менеджер приложил лист.

alter table public.erp_orders
  add column if not exists purchase_required boolean not null default true;

comment on column public.erp_orders.purchase_required is
  'Требуется ли закупка. false — менеджер явно отметил «Закупка не требуется»: этап supply в маршрут не заводится, задача закупщику не создаётся.';

alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;
alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase', 'purchase_list'));

-- ── Создание заказа принимает отметку ────────────────────────────────────────
--
-- Функция пересоздана ПОДЛИННЫМ действующим текстом (20260820120000).
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
     status, created_by, tz_required, tz_order_id, tz_number, purchase_required)
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
     v_order->>'tz_number',
     -- «Закупка не требуется» — ЯВНАЯ отметка менеджера. По умолчанию true:
     -- у заказа, заведённого до этой правки, закупка была, и молчаливое
     -- false вывело бы его из очереди закупщика задним числом
     coalesce((v_order->>'purchase_required')::boolean, true))
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