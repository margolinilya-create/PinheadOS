-- Правки заказчика 07.09: размер упаковки (п. 16), эффекты шелкографии (п. 10)
-- и тип изделия в вышивке (п. 11).
--
-- ПОЧЕМУ ОДНА МИГРАЦИЯ НА ТРИ ПУНКТА. Все три дописывают колонки в те же два
-- INSERT-а `erp_create_order`. Две миграции подряд означали бы два полных
-- пересоздания функции на 350 строк, и вторая переписывала бы первую —
-- расхождение между ними никто бы не заметил.
--
-- ТЕКСТ ФУНКЦИИ ПОДЛИННЫЙ. Сверено с боевой базой ДО правки: `prosrc` живой
-- функции и тело из `20260823150000_erp_create_order_notes.sql` совпадают
-- посимвольно после снятия комментариев и нормализации пробелов, кроме
-- ПОРЯДКА объявления `v_nt_idx` в блоке `declare` (в базе — после
-- `v_note_ids`, в файле — последним). Расхождение чисто текстовое.
-- md5 нормализованных тел: файл 52eb9b50…, база 1ab5f52d… — различие ровно
-- в этом переносе; побайтовое сравнение прочих 9366 символов дало равенство.

-- ── 1. Размер упаковки в миллиметрах (п. 16) ────────────────────────────────
--
-- «В блоке „Упаковка и доп.“ добавить размер выбранной упаковки. Нужны поля
-- ширина и высота в мм для БОПП-пакета, ZIP-пакета и варианта „Другое“».
--
-- ДВЕ ЧИСЛОВЫЕ КОЛОНКИ, А НЕ СТРОКА. У позиции с 16.08 есть свободный
-- `packaging_size`, и на боевой базе в нём лежит «25*30см», «25*33», «30*40» —
-- три записи, три разных написания. По такому полю нельзя ни отобрать пакеты
-- одного размера, ни посчитать закупку; строкой оно и осталось бы навсегда.
-- `packaging_size` НЕ УДАЛЯЕТСЯ: его несут три заведённые позиции, и читать
-- их по-прежнему нужно.
--
-- УПАКОВКА ЖИВЁТ НА ДВУХ УРОВНЯХ (правило 16.08: «своё у позиции → общее
-- по заказу», `utils/packaging.itemPackaging`), поэтому пара колонок заводится
-- у ОБОИХ: размер, заданный только на заказе, не ответил бы на вопрос
-- «а в чём эта позиция», когда у неё своя упаковка.
alter table public.erp_orders
  add column if not exists packaging_width_mm int,
  add column if not exists packaging_height_mm int;

comment on column public.erp_orders.packaging_width_mm is
  'Ширина упаковки заказа, мм (правки 07.09, п. 16). NULL — размер не задан.';
comment on column public.erp_orders.packaging_height_mm is
  'Высота упаковки заказа, мм (правки 07.09, п. 16). NULL — размер не задан.';

alter table public.erp_order_items
  add column if not exists packaging_width_mm int,
  add column if not exists packaging_height_mm int;

comment on column public.erp_order_items.packaging_width_mm is
  'Ширина упаковки позиции, мм. Пусто — берётся размер заказа (utils/packaging).';
comment on column public.erp_order_items.packaging_height_mm is
  'Высота упаковки позиции, мм. Пусто — берётся размер заказа (utils/packaging).';

-- ── 2. Тип изделия в вышивке (п. 11) ────────────────────────────────────────
--
-- «В вышивке добавить поле „Тип изделия“. Варианты: „Вышивка на крое
-- и полотне“, „Вышивка на готовых изделиях“, „Изготовление шевронов
-- (нашивок)“».
--
-- КОЛОНКА С CHECK, А НЕ СПРАВОЧНИК — в отличие от эффектов ниже. Это
-- классификация ТЕХНОЛОГИИ из трёх закрытых значений, и от неё в обозримом
-- будущем зависит маршрут: шеврон — отдельное изделие, а не нанесение
-- на чужом. Растущим перечнем такое не бывает, а `CHECK` даёт тайпчек
-- на сервере.
--
-- ОТДЕЛЬНАЯ КОЛОНКА, А НЕ ОБЩИЙ `subtype` ВМЕСТЕ С ЭФФЕКТОМ: «эффект
-- шелкографии» и «тип изделия вышивки» отвечают на разные вопросы, и общее
-- поле схлопнуло бы две величины в одну — ровно то, на чём проект уже ловился
-- (`qty_in_work` против `qty_sent` у подряда).
alter table public.erp_item_prints
  add column if not exists garment_kind text;

alter table public.erp_item_prints
  drop constraint if exists erp_item_prints_garment_kind_check;
alter table public.erp_item_prints
  add constraint erp_item_prints_garment_kind_check
  check (garment_kind is null or garment_kind in ('cut', 'finished', 'chevron'));

comment on column public.erp_item_prints.garment_kind is
  'Тип изделия для вышивки (правки 07.09, п. 11): cut — на крое и полотне, finished — на готовых изделиях, chevron — изготовление шевронов. NULL у прочих техник.';

-- ── 3. Эффекты шелкографии (п. 10) ──────────────────────────────────────────
--
-- «В шелкографии добавить поле „Эффекты“. Варианты: без эффектов, каменная
-- база, Puff-эффект, металлик, флюор, вытравка».
--
-- КОЛОНКА УЖЕ ЕСТЬ: `erp_item_prints.special` заведена 17.07 вместе с самой
-- таблицей («Спецэффекты» страницы ТЗ) и с тех пор ПУСТА у всех 54 нанесений —
-- ни форма, ни `erp_create_order` её не писали. Заводить рядом вторую значило
-- бы держать две колонки одного смысла.
--
-- ЗНАЧЕНИЯ — СПРАВОЧНИК, а не CHECK: набор эффектов у типографии растёт
-- (глиттер, флок, 3D), заказчик назвал шесть из открытого множества, и на
-- маршрут они не влияют. Правило раздела — «справочник это подсказка, а не
-- ограничение»: `datalist` поверх свободного ввода, значения отключаются,
-- а не удаляются.
--
-- ВИД СПРАВОЧНИКА ЖИВЁТ В ЧЕТЫРЁХ МЕСТАХ (CHECK базы, `DictionaryKind`,
-- подписи, `KINDS` в админке) — пропуск последнего даёт молча отсутствующую
-- вкладку, и это уже случалось с единицами измерения.
alter table public.erp_dictionaries
  drop constraint if exists erp_dictionaries_kind_check;
alter table public.erp_dictionaries
  add constraint erp_dictionaries_kind_check
  check (kind in (
    'block_reason', 'problem_type', 'product_type', 'supplier', 'unit',
    'experimental_task_type', 'route_operation', 'label_type', 'print_effect'
  ));

insert into public.erp_dictionaries (kind, code, name, sort_order, active)
values
  ('print_effect', 'none',       'Без эффектов',  10, true),
  ('print_effect', 'stone_base', 'Каменная база', 20, true),
  ('print_effect', 'puff',       'Puff-эффект',   30, true),
  ('print_effect', 'metallic',   'Металлик',      40, true),
  ('print_effect', 'fluor',      'Флюор',         50, true),
  ('print_effect', 'discharge',  'Вытравка',      60, true)
on conflict do nothing;

-- ── 4. Страж заказа видит новые колонки ─────────────────────────────────────
--
-- `erp_order_guard` разбирает изменение ПОИМЁННО, и колонка, не вписанная
-- в `v_fields`, не охраняется вообще ничем — то же правило, что у `v_guarded`
-- в страже этапов. Текст функции подлинный: взят из
-- `20260810330000_erp_order_guard_shipping.sql`, добавлены две строки.
--
-- `erp_order_item_guard` не трогаем: он гейтит СТРОКУ целиком под
-- `order.manage`, и новые колонки позиции покрыты им по построению.
create or replace function public.erp_order_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields boolean;
  v_ship boolean;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.is_demo is distinct from old.is_demo and not public.is_admin() then
    raise exception 'erp_order_guard: пометка «тестовый» доступна только администратору'
      using errcode = '42501';
  end if;

  v_fields :=
       new.bitrix_id       is distinct from old.bitrix_id
    or new.title           is distinct from old.title
    or new.customer        is distinct from old.customer
    or new.manager         is distinct from old.manager
    or new.launch_date     is distinct from old.launch_date
    or new.due_date        is distinct from old.due_date
    or new.buffer_days     is distinct from old.buffer_days
    or new.priority        is distinct from old.priority
    or new.notes           is distinct from old.notes
    or new.packaging       is distinct from old.packaging
    or new.packaging_note  is distinct from old.packaging_note
    or new.packaging_width_mm  is distinct from old.packaging_width_mm
    or new.packaging_height_mm is distinct from old.packaging_height_mm
    or new.stickers        is distinct from old.stickers
    or new.stickers_note   is distinct from old.stickers_note
    or new.no_chestny_znak is distinct from old.no_chestny_znak
    or new.tz_required     is distinct from old.tz_required
    or new.created_by      is distinct from old.created_by;

  if v_fields and not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_guard: правка полей заказа требует права order.manage'
      using errcode = '42501';
  end if;

  -- ── Отгрузка и закрытие заказа ──
  v_ship :=
       new.status          is distinct from old.status
    or new.shipped_status  is distinct from old.shipped_status
    or new.shipped_at      is distinct from old.shipped_at
    or new.shipped_by      is distinct from old.shipped_by;

  if v_ship
     and not (public.erp_has_permission('warehouse.manage')
              or public.erp_has_permission('order.manage')) then
    raise exception 'erp_order_guard: отгрузка и закрытие заказа требуют права warehouse.manage или order.manage'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.erp_order_guard() is
  'Разбирает изменение заказа по колонкам: поля заказа (включая размер упаковки в мм, правки 07.09) — под order.manage, пометка «тестовый» — только админ, отгрузка и закрытие (status/shipped_*) — под warehouse.manage либо order.manage.';

-- ── 5. Создание заказа пишет новые поля ─────────────────────────────────────
--
-- Функция пересоздана ЦЕЛИКОМ по подлинному тексту (см. шапку). Добавлены
-- ровно шесть вставок: две колонки упаковки в `erp_orders`, две в
-- `erp_order_items`, и `special` + `garment_kind` в `erp_item_prints`.
-- Каждая замена проверена на однозначность при сборке файла: не сработавшая
-- подстановка оставила бы функцию прежней МОЛЧА.

create or replace function public.erp_create_order(payload jsonb)
returns uuid
language plpgsql
set search_path to 'public'
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
  v_print_id uuid;
  v_label jsonb;
  v_label_id uuid;
  v_note jsonb;
  v_note_id uuid;
  v_note_ids uuid[] := '{}';
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
  -- Файлы подрядного этапа: этап адресуется парой «позиция:этап»
  v_stage_all uuid[] := '{}';
  v_stage_keys text[] := '{}';
  -- Макеты нанесений и бирок — тем же приёмом, парой «позиция:номер»
  v_print_all uuid[] := '{}';
  v_print_keys text[] := '{}';
  v_label_all uuid[] := '{}';
  v_label_keys text[] := '{}';
  v_item_idx int := 0;
  v_st_idx int;
  v_pr_idx int;
  v_lb_idx int;
  v_at int;
  v_ap int;
  v_al int;
  v_nt_idx int := 0;
begin
  if v_order is null or coalesce(v_order->>'title', '') = '' then
    raise exception 'erp_create_order: order.title is required';
  end if;

  v_due := (v_order->>'due_date')::date;
  v_queue_pos := public.erp_default_queue_position(v_due);

  insert into erp_orders
    (bitrix_id, title, customer, manager, launch_date, due_date, buffer_days, notes,
     packaging, packaging_note, packaging_width_mm, packaging_height_mm,
     stickers, stickers_note, no_chestny_znak,
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
     (v_order->>'packaging_width_mm')::int,
     (v_order->>'packaging_height_mm')::int,
     coalesce(v_order->>'stickers', 'none'),
     v_order->>'stickers_note',
     coalesce((v_order->>'no_chestny_znak')::boolean, false),
     coalesce(v_order->>'status', 'active'),
     nullif(v_order->>'created_by', '')::uuid,
     coalesce((v_order->>'tz_required')::boolean, true),
     nullif(v_order->>'tz_order_id', '')::uuid,
     v_order->>'tz_number',
     coalesce((v_order->>'purchase_required')::boolean, true))
  returning id into v_order_id;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into erp_order_items
      (order_id, product_type, variant, qty, production_type,
       branding_methods, branding_on, notes, size_grid, sort_order,
       subcontract_kind, material_source,
       fit, main_fabric, trim_material, cutting_note, sewing_note, labels_note,
       packaging, packaging_size, sticker_place, marking_place, packaging_note,
       packaging_width_mm, packaging_height_mm)
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
       v_item->>'main_fabric',
       v_item->>'trim_material',
       v_item->>'cutting_note',
       v_item->>'sewing_note',
       v_item->>'labels_note',
       coalesce(v_item->>'packaging', 'inherit'),
       v_item->>'packaging_size',
       v_item->>'sticker_place',
       v_item->>'marking_place',
       v_item->>'packaging_note',
       (v_item->>'packaging_width_mm')::int,
       (v_item->>'packaging_height_mm')::int)
    returning id into v_item_id;

    v_item_ids := v_item_ids || v_item_id;

    v_pr_idx := 0;
    for v_print in
      select * from jsonb_array_elements(coalesce(v_item->'prints', '[]'::jsonb))
    loop
      insert into erp_item_prints
        (item_id, seq, method, fabric, zone, width_mm, height_mm,
         offset_note, pantone, comment, special, garment_kind)
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
         v_print->>'comment',
         v_print->>'special',
         v_print->>'garment_kind')
      returning id into v_print_id;

      v_print_all := v_print_all || v_print_id;
      v_print_keys := v_print_keys || (v_item_idx::text || ':' || v_pr_idx::text);
      v_pr_idx := v_pr_idx + 1;
    end loop;

    -- Бирки позиции (п. 5.3). Одно текстовое поле `labels_note` осталось
    -- в схеме: его несут заведённые заказы, и переносить свободный текст
    -- в поля может только человек
    v_lb_idx := 0;
    for v_label in
      select * from jsonb_array_elements(coalesce(v_item->'labels', '[]'::jsonb))
    loop
      insert into erp_item_labels
        (item_id, seq, label_type, place, size, comment)
      values
        (v_item_id,
         coalesce((v_label->>'seq')::int, v_lb_idx + 1),
         v_label->>'label_type',
         v_label->>'place',
         v_label->>'size',
         v_label->>'comment')
      returning id into v_label_id;

      v_label_all := v_label_all || v_label_id;
      v_label_keys := v_label_keys || (v_item_idx::text || ':' || v_lb_idx::text);
      v_lb_idx := v_lb_idx + 1;
    end loop;

    v_stage_ids := '{}';
    v_st_idx := 0;
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

      if coalesce(v_stage->>'executor', 'internal') = 'contractor' then
        insert into erp_subcontracting
          (order_id, item_id, stage_id, operation, contractor, qty, material_source,
           send_plan_date, planned_date, responsible, materials_note, comment)
        select v_order_id, v_item_id, v_stage_id,
               coalesce(nullif(btrim(coalesce(v_stage->>'operation', '')), ''), d.name),
               v_stage->>'contractor',
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
      v_stage_all := v_stage_all || v_stage_id;
      v_stage_keys := v_stage_keys || (v_item_idx::text || ':' || v_st_idx::text);
      v_st_idx := v_st_idx + 1;
    end loop;

    v_item_idx := v_item_idx + 1;
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

    v_mat_ids := v_mat_ids || v_mat_id;
  end loop;

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

  -- Заметки к заказу (правка 22.08, п. 5.8): то, что нельзя разложить
  -- по структурным полям. Принадлежат ЗАКАЗУ, а не позиции; порядок хранится,
  -- потому что документ требует уметь его менять
  v_nt_idx := 0;
  for v_note in
    select * from jsonb_array_elements(coalesce(payload->'notes', '[]'::jsonb))
  loop
    insert into erp_order_notes (order_id, seq, text, author)
    values
      (v_order_id,
       coalesce((v_note->>'seq')::int, v_nt_idx + 1),
       v_note->>'text',
       v_note->>'author')
    returning id into v_note_id;

    v_note_ids := v_note_ids || v_note_id;
    v_nt_idx := v_nt_idx + 1;
  end loop;

  for v_att in
    select * from jsonb_array_elements(coalesce(payload->'attachments', '[]'::jsonb))
  loop
    v_at := case
      when jsonb_typeof(v_att->'stage_index') = 'number'
       and jsonb_typeof(v_att->'item_index') = 'number'
      then array_position(v_stage_keys,
             (v_att->>'item_index') || ':' || (v_att->>'stage_index'))
    end;
    -- Отсутствие ключа читается как «файл не нанесения», а не как ошибка:
    -- секцию шлют и старые сборки клиента
    v_ap := case
      when jsonb_typeof(v_att->'print_index') = 'number'
       and jsonb_typeof(v_att->'item_index') = 'number'
      then array_position(v_print_keys,
             (v_att->>'item_index') || ':' || (v_att->>'print_index'))
    end;
    v_al := case
      when jsonb_typeof(v_att->'label_index') = 'number'
       and jsonb_typeof(v_att->'item_index') = 'number'
      then array_position(v_label_keys,
             (v_att->>'item_index') || ':' || (v_att->>'label_index'))
    end;

    insert into erp_order_attachments
      (order_id, item_id, material_id, stage_id, print_id, label_id, note_id,
       file_path, file_name, kind, uploaded_by)
    values
      (v_order_id,
       case
         when jsonb_typeof(v_att->'item_index') = 'number'
         then v_item_ids[(v_att->>'item_index')::int + 1]
       end,
       case
         when jsonb_typeof(v_att->'material_index') = 'number'
         then v_mat_ids[(v_att->>'material_index')::int + 1]
       end,
       case when v_at is not null then v_stage_all[v_at] end,
       case when v_ap is not null then v_print_all[v_ap] end,
       case when v_al is not null then v_label_all[v_al] end,
       -- Заметка адресуется НОМЕРОМ: заметки заказа общие, разводить их
       -- по позициям не нужно (в отличие от нанесений)
       case
         when jsonb_typeof(v_att->'note_index') = 'number'
         then v_note_ids[(v_att->>'note_index')::int + 1]
       end,
       v_att->>'file_path',
       v_att->>'file_name',
       coalesce(v_att->>'kind', 'attachment'),
       v_att->>'uploaded_by');
  end loop;

  return v_order_id;
end $$;
