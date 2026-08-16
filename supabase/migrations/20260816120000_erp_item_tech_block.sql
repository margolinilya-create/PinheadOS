-- Технический блок изделия и упаковка НА ПОЗИЦИЮ (правки заказчика 16.08, блок 1).
--
-- ЧТО ПРОСИЛ ЗАКАЗЧИК. «Упаковка должна задаваться именно на уровне изделия,
-- а не одной общей настройкой на весь заказ»: у разных изделий внутри одной
-- сделки отличаются тип и размер пакета, расположение стикера и маркировки.
-- Плюс отдельный технический блок по изделию — отделочное полотно, комментарии
-- по раскрою и пошиву, бирки — и поле «Крой» (Free Fit / Oversize / Regular).
--
-- ПОЧЕМУ КОЛОНКИ ЗАКАЗА ОСТАЮТСЯ. `erp_orders.packaging/packaging_note/
-- stickers/stickers_note` не переносятся и не удаляются: их несут десять уже
-- заведённых заказов, и их печатает карточка. Позиция получает СВОИ поля,
-- а «своё → общее по заказу» резолвит одна чистая функция на клиенте
-- (`erp/utils/packaging.ts`) — тем же приёмом, что `utils/tz.itemTzDocument`
-- разрешает «ТЗ позиции → общее ТЗ заказа». Две колонки без резолюции стали бы
-- вторым источником правды, а перенос данных — необратимой потерей заказов,
-- у которых упаковка задана на весь заказ осознанно.
--
-- ПОЧЕМУ CHECK У ПОЗИЦИИ МЯГЧЕ, ЧЕМ У ЗАКАЗА. `erp_orders.packaging` ограничен
-- списком `none|bopp|zip|other`, и это ограничение остаётся. У позиции добавлено
-- значение `inherit` — «как в заказе», и оно же значение по умолчанию: иначе
-- каждая позиция каждого заказа обязана была бы повторить общую настройку,
-- а забытая позиция молча получила бы «без упаковки» вместо «как у заказа».

alter table public.erp_order_items
  -- Крой изделия: Free Fit / Oversize / Regular и любые другие. Свободный текст
  -- с подсказками справочника — не перечисление: у каждого заказчика свои лекала,
  -- и CHECK здесь означал бы миграцию на каждое новое название.
  add column if not exists fit text,
  -- Технический блок: отделочное полотно, контрастный/дополнительный материал
  add column if not exists trim_material text,
  add column if not exists cutting_note text,
  add column if not exists sewing_note text,
  -- Бирки: какие, где расположены, как притачиваются
  add column if not exists labels_note text,
  -- Упаковка позиции. `inherit` = брать из заказа (см. выше)
  add column if not exists packaging text not null default 'inherit'
    check (packaging in ('inherit', 'none', 'bopp', 'zip', 'other')),
  add column if not exists packaging_note text;

comment on column public.erp_order_items.fit is
  'Крой изделия (Free Fit / Oversize / Regular / своё). Свободный текст с подсказками справочника.';
comment on column public.erp_order_items.trim_material is
  'Отделочное полотно / контрастный / дополнительный материал.';
comment on column public.erp_order_items.cutting_note is
  'Особенности раскроя изделия.';
comment on column public.erp_order_items.sewing_note is
  'Особенности сборки и пошива.';
comment on column public.erp_order_items.labels_note is
  'Бирки: какие используются, где располагаются, как притачиваются.';
comment on column public.erp_order_items.packaging is
  'Упаковка позиции. inherit = как в заказе (erp_orders.packaging); резолюция — erp/utils/packaging.ts.';

-- Вложения получают ПОЗИЦИЮ и вид.
--
-- Заказчик просит несколько файлов и в блоке упаковки, и в техническом блоке,
-- и в листе закупки — «вариант упаковки, расположение стикера, схема узла,
-- пример раскроя, фотография материала». Заводить три таблицы вложений незачем:
-- у заказа уже есть `erp_order_attachments`, ему не хватало только адресата
-- (позиция) и признака, к какому блоку файл относится.
--
-- `item_id` необязателен: файл, заведённый на весь заказ, по-прежнему имеет
-- NULL и касается всех позиций — то же правило, что у `erp_materials.item_id`
-- и `erp_tz_documents.item_id`. `on delete cascade`, потому что вложение
-- позиции без позиции не имеет смысла.
alter table public.erp_order_attachments
  add column if not exists item_id uuid references public.erp_order_items(id) on delete cascade;

create index if not exists erp_order_attachments_item_idx
  on public.erp_order_attachments (item_id);

-- Вид вложения. Прежние два значения сохранены дословно: `preview` — макет
-- заказа, `attachment` — просто файл. Новые три отвечают на вопрос «в каком
-- блоке карточки этот файл показывать», без него все они свалились бы
-- в общую вкладку «Файлы» вперемешку.
alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;
alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase'));

comment on column public.erp_order_attachments.item_id is
  'Позиция, к которой относится файл. NULL — файл всего заказа (как у erp_materials и erp_tz_documents).';
comment on column public.erp_order_attachments.kind is
  'preview — макет заказа; attachment — прочее; packaging/tech/purchase — блок карточки, в котором файл показывается.';

-- ── Лист закупки: поля менеджера и поля закупщика разделены ──────────────────
--
-- Документ (пп. 6, 10–12): «менеджер сопровождения формирует потребность при
-- создании заказа, закупщик получает готовую задачу и заполняет свою часть»,
-- и «один показатель не должен заменять другой».
--
-- Что уже было и НЕ дублируется: `qty_expected` — плановая потребность,
-- `qty_received` — фактический приход (её ведёт триггер журнала приёмок,
-- клиент только читает), `supplier`, `price_per_unit`, `eta_date` — план прихода,
-- `received_at` — факт прихода, `role` — вид материала, где `trim` и есть
-- «отделочный материал» из документа. Заводить под них вторые колонки нельзя.
--
-- Чего не хватало ровно три:
alter table public.erp_materials
  -- Комментарий МЕНЕДЖЕРА, отдельно от `notes` закупщика. Раньше поле было одно,
  -- и требование «визуально разделить исходный запрос и данные закупщика»
  -- выполнить было нечем: обе роли писали в одну строку и затирали друг друга.
  add column if not exists manager_note text,
  -- Сколько закупщик ФАКТИЧЕСКИ заказал. Это не план (`qty_expected`) и не приход
  -- (`qty_received`): «нужно было 100 м → закупили 110 м» — пример из документа,
  -- и он про разницу между первым и этим.
  add column if not exists qty_ordered numeric,
  -- Когда разместил заказ у поставщика
  add column if not exists ordered_on date;

comment on column public.erp_materials.manager_note is
  'Комментарий менеджера сопровождения к позиции закупки (заполняется при создании заказа). Комментарий закупщика — notes.';
comment on column public.erp_materials.qty_ordered is
  'Сколько фактически заказано у поставщика. План — qty_expected, приход — qty_received (её ведёт триггер).';
comment on column public.erp_materials.ordered_on is
  'Дата размещения заказа у поставщика.';

-- ── Приём новых полей в erp_create_order ────────────────────────────────────
--
-- Текст функции взят ПОДЛИННЫМ из последней определяющей миграции
-- (20260812140000_erp_drop_legacy_experimental.sql) и дополнен, а не написан
-- по памяти: правило проекта, и оно уже спасало стража этапов от потери шести
-- охраняемых колонок.
--
-- Добавлено ровно три вещи:
--   1. поля технического блока и упаковки позиции;
--   2. `materials[].item_index` — лист закупки заводится ПРИ СОЗДАНИИ ЗАКАЗА
--      и адресуется позиции; плюс `unit` и `manager_note`. Секцию `materials`
--      функция принимала и раньше, но клиент всегда слал пустой массив, и
--      закупщик заводил те же строки заново руками — ровно то, на что жалуется
--      документ («закупщик не должен повторно переносить информацию»);
--   3. `attachments[]` — файлы упаковки, техблока и листа закупки приезжают
--      той же транзакцией, что заказ.
--
-- Все три секции НЕОБЯЗАТЕЛЬНЫ: старый бандл, не знающий о них, создаёт заказ
-- ровно как раньше. Это и позволяет выложить миграцию до фронтенда.

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
       subcontract_kind, material_source,
       fit, trim_material, cutting_note, sewing_note, labels_note,
       packaging, packaging_note)
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
       v_mat->>'manager_note');
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
      (order_id, item_id, file_path, file_name, kind, uploaded_by)
    values
      (v_order_id,
       case
         when jsonb_typeof(v_att->'item_index') = 'number'
         then v_item_ids[(v_att->>'item_index')::int + 1]
       end,
       v_att->>'file_path',
       v_att->>'file_name',
       coalesce(v_att->>'kind', 'attachment'),
       v_att->>'uploaded_by');
  end loop;

  return v_order_id;
end $$;

grant execute on function public.erp_create_order(jsonb) to authenticated;

-- ── Справочник «Крой» ────────────────────────────────────────────────────────
--
-- Free Fit / Oversize / Regular — примеры из документа, а не закрытый список:
-- CHECK здесь означал бы миграцию на каждое новое лекало. Поэтому крой — обычный
-- справочник-подсказка поверх свободного ввода, как типы изделий.
--
-- ВИД СПРАВОЧНИКА ЖИВЁТ В ЧЕТЫРЁХ МЕСТАХ (правило проекта): этот CHECK,
-- `DictionaryKind` в erp/types.ts, подпись с подсказкой там же и `KINDS`
-- в `screens/admin/DictionariesTab.jsx`. Пропуск последнего ничего не роняет —
-- он даёт молчаливо отсутствующую вкладку в админке; так уже случилось
-- с единицами измерения. Сторожит `dictionaryKinds.test.ts`.
alter table public.erp_dictionaries
  drop constraint if exists erp_dictionaries_kind_check;
alter table public.erp_dictionaries
  add constraint erp_dictionaries_kind_check
  check (kind in ('block_reason', 'problem_type', 'product_type', 'supplier',
                  'unit', 'experimental_task_type', 'fit'));

-- `code` в справочнике NOT NULL — это его машинное имя рядом с человеческим
insert into public.erp_dictionaries (kind, code, name, sort_order, active)
select 'fit', v.code, v.name, v.ord, true
from (values ('regular', 'Regular', 10),
             ('oversize', 'Oversize', 20),
             ('free_fit', 'Free Fit', 30)) as v(code, name, ord)
where not exists (
  select 1 from public.erp_dictionaries d where d.kind = 'fit' and d.code = v.code);
