-- Редактирование созданного заказа (правка заказчика 12.09, п. 7).
--
-- «После создания заказа его данные нельзя нормально отредактировать —
-- для изменения информации приходится обходить текущую логику или создавать
-- заказ заново… Сохранение должно обновлять текущий заказ, а не создавать
-- новый. ID/номер заказа не менять. Уже сохранённые производственные
-- результаты, история этапов и выполненные задачи при обычном редактировании
-- не удалять и не сбрасывать».
--
-- ПОЧЕМУ ОДНА RPC, А НЕ НАБОР UPDATE. Правка заказа — ОДНО решение человека:
-- он поменял срок, дописал цвет ткани и поправил размерную сетку, нажал
-- «Сохранить». Половина применённых секций хуже, чем неприменённая правка:
-- заказ оказался бы в состоянии, которого никто не выбирал, и понять, что
-- именно доехало, было бы неоткуда. Транзакция снимает вопрос целиком.
--
-- ЧЕГО ЭТА ФУНКЦИЯ НЕ ДЕЛАЕТ, И ЭТО ВАЖНЕЕ ТОГО, ЧТО ДЕЛАЕТ:
--
-- 1. НЕ ТРОГАЕТ ЭТАПЫ. Маршрут материализуется при создании и дальше правится
--    конструктором (`erp_route_apply`) — записанное правило проекта. Тронь
--    этапы здесь, и правка срока стёрла бы факт цеха: `qty_done`, журнал,
--    плановые даты, приоритет очереди. Смена `branding_methods` тоже НЕ
--    пересобирает маршрут; форма говорит это прямо.
-- 2. НЕ МЕНЯЕТ НОМЕР И АВТОРА. `bitrix_id` правится (это поле менеджера),
--    а `id`, `created_by` и `created_at` в списке колонок отсутствуют вовсе.
-- 3. НЕ ДОБАВЛЯЕТ И НЕ УДАЛЯЕТ ПОЗИЦИИ. Решение владельца: добавление
--    позиции заводит этапы, удаление — сносит их вместе с работой, и оба
--    случая просят отдельного разговора. Позиция, которой нет в payload,
--    просто не трогается.
--
-- ПОЗИЦИИ СОПОСТАВЛЯЮТСЯ ПО `id`, А НЕ ПО ИНДЕКСУ. Индекс сдвинулся бы
-- и техблок уехал бы к чужому изделию — та же ошибка, от которой в проекте
-- завели `print_key`/`label_key` вместо номеров строк.
--
-- ГЕЙТ — `order.manage`, как у `erp_route_apply`. Страж `erp_order_guard`
-- и так требует его на все поля заказа, но явная проверка называет причину
-- отказа словами, а не кодом 42501 из триггера.

create or replace function public.erp_update_order(p_order_id uuid, p_payload jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_order   jsonb := p_payload->'order';
  v_item    jsonb;
  v_item_id uuid;
  v_print   jsonb;
  v_label   jsonb;
  v_qty     int;
  v_done    int;
  v_exists  boolean;
begin
  if not public.erp_has_permission('order.manage') then
    raise exception 'erp_update_order: правка заказа требует права order.manage'
      using errcode = '42501';
  end if;

  select true into v_exists from erp_orders where id = p_order_id;
  if v_exists is null then
    raise exception 'erp_update_order: заказ не найден' using errcode = 'P0002';
  end if;

  -- ── Поля заказа ──
  -- `coalesce(…, старое)` нет намеренно: секция приходит целиком, и NULL
  -- в ней означает «человек стёр значение». Умолчания расставляет форма.
  if v_order is not null then
    update erp_orders set
      bitrix_id           = v_order->>'bitrix_id',
      title               = coalesce(v_order->>'title', title),
      customer            = v_order->>'customer',
      manager             = v_order->>'manager',
      launch_date         = (v_order->>'launch_date')::date,
      due_date            = (v_order->>'due_date')::date,
      notes               = v_order->>'notes',
      packaging           = coalesce(v_order->>'packaging', packaging),
      packaging_note      = v_order->>'packaging_note',
      packaging_width_mm  = (v_order->>'packaging_width_mm')::int,
      packaging_height_mm = (v_order->>'packaging_height_mm')::int,
      stickers            = coalesce(v_order->>'stickers', stickers),
      stickers_note       = v_order->>'stickers_note',
      no_chestny_znak     = coalesce((v_order->>'no_chestny_znak')::boolean, no_chestny_znak),
      purchase_required   = coalesce((v_order->>'purchase_required')::boolean, purchase_required),
      tz_required         = coalesce((v_order->>'tz_required')::boolean, tz_required)
    where id = p_order_id;
  end if;

  -- ── Позиции ──
  for v_item in
    select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_item_id := (v_item->>'id')::uuid;
    if v_item_id is null then
      continue;  -- новая позиция: добавление вне этой правки
    end if;

    /**
     * ТИРАЖ НЕЛЬЗЯ ОПУСТИТЬ НИЖЕ УЖЕ СДЕЛАННОГО.
     *
     * Правка количества законна — заказчик просит править то же, что вводил.
     * Но `qty` это знаменатель прогресса, готовности этапа и гейта отгрузки:
     * опустив его ниже факта, мы задним числом объявили бы цех сделавшим
     * больше, чем заказано, и заказ мог бы «закрыться» сам. Отказ называет
     * число, чтобы человек понял, на что ориентироваться.
     */
    v_qty := (v_item->>'qty')::int;
    if v_qty is not null then
      select max(s.qty_done) into v_done
        from erp_item_stages s where s.item_id = v_item_id;
      if v_done is not null and v_qty < v_done then
        raise exception
          'erp_update_order: тираж % меньше уже сделанного (%). Уменьшите после сверки с цехом',
          v_qty, v_done using errcode = 'check_violation';
      end if;
    end if;

    update erp_order_items set
      product_type        = coalesce(v_item->>'product_type', product_type),
      variant             = v_item->>'variant',
      qty                 = coalesce(v_qty, qty),
      production_type     = coalesce(v_item->>'production_type', production_type),
      branding_on         = coalesce(v_item->>'branding_on', branding_on),
      garment_source      = coalesce(v_item->>'garment_source', garment_source),
      notes               = v_item->>'notes',
      size_grid           = case when jsonb_typeof(v_item->'size_grid') = 'array'
                                 then v_item->'size_grid' end,
      fit                 = v_item->>'fit',
      main_fabric         = v_item->>'main_fabric',
      color_supplier      = v_item->>'color_supplier',
      trim_material       = v_item->>'trim_material',
      cutting_note        = v_item->>'cutting_note',
      sewing_note         = v_item->>'sewing_note',
      labels_note         = v_item->>'labels_note',
      packaging           = coalesce(v_item->>'packaging', packaging),
      packaging_size      = v_item->>'packaging_size',
      sticker_place       = v_item->>'sticker_place',
      marking_place       = v_item->>'marking_place',
      packaging_note      = v_item->>'packaging_note',
      packaging_width_mm  = (v_item->>'packaging_width_mm')::int,
      packaging_height_mm = (v_item->>'packaging_height_mm')::int
    where id = v_item_id and order_id = p_order_id;

    if not found then
      raise exception 'erp_update_order: позиция % не принадлежит заказу', v_item_id
        using errcode = '22023';
    end if;

    -- ── Нанесения позиции ──
    -- Строка с `id` обновляется, без `id` — вставляется. Снятые строки
    -- не удаляются: этап нанесения уже заведён маршрутом, и молча оставить
    -- цех без описания работы хуже, чем лишняя строка в карточке.
    for v_print in
      select * from jsonb_array_elements(coalesce(v_item->'prints', '[]'::jsonb))
    loop
      if (v_print->>'id') is null then
        insert into erp_item_prints
          (item_id, seq, method, zone, width_mm, height_mm, offset_note,
           pantone, special, garment_kind, comment)
        values
          (v_item_id,
           coalesce((select max(seq) + 1 from erp_item_prints where item_id = v_item_id), 1),
           coalesce(v_print->>'method', 'other'),
           v_print->>'zone',
           (v_print->>'width_mm')::int,
           (v_print->>'height_mm')::int,
           v_print->>'offset_note',
           v_print->>'pantone',
           v_print->>'special',
           v_print->>'garment_kind',
           v_print->>'comment');
      else
        update erp_item_prints set
          method       = coalesce(v_print->>'method', method),
          zone         = v_print->>'zone',
          width_mm     = (v_print->>'width_mm')::int,
          height_mm    = (v_print->>'height_mm')::int,
          offset_note  = v_print->>'offset_note',
          pantone      = v_print->>'pantone',
          special      = v_print->>'special',
          garment_kind = v_print->>'garment_kind',
          comment      = v_print->>'comment'
        where id = (v_print->>'id')::uuid and item_id = v_item_id;
      end if;
    end loop;

    -- ── Бирки позиции ──
    for v_label in
      select * from jsonb_array_elements(coalesce(v_item->'labels', '[]'::jsonb))
    loop
      if (v_label->>'id') is null then
        insert into erp_item_labels (item_id, seq, label_type, place, size, comment)
        values
          (v_item_id,
           coalesce((select max(seq) + 1 from erp_item_labels where item_id = v_item_id), 1),
           v_label->>'label_type',
           v_label->>'place',
           v_label->>'size',
           v_label->>'comment');
      else
        update erp_item_labels set
          label_type = v_label->>'label_type',
          place      = v_label->>'place',
          size       = v_label->>'size',
          comment    = v_label->>'comment'
        where id = (v_label->>'id')::uuid and item_id = v_item_id;
      end if;
    end loop;
  end loop;

  return p_order_id;
end $$;

comment on function public.erp_update_order(uuid, jsonb) is
  'Правка созданного заказа одной транзакцией (правка 12.09, п. 7): поля заказа, позиции, нанесения и бирки. Этапы НЕ трогает — маршрут правится erp_route_apply, иначе правка срока стёрла бы факт цеха. Позиции сопоставляются по id. Тираж нельзя опустить ниже уже сделанного. Гейт — order.manage.';

-- Функция SECURITY INVOKER (по умолчанию): страж `erp_order_guard`
-- и политики RLS обязаны сработать от лица вызывающего. «Одной транзакцией»
-- не означает «мимо RLS» — правило проекта, записанное при вводе
-- `erp_bootstrap` и `erp_order_detail`.
revoke execute on function public.erp_update_order(uuid, jsonb) from public, anon;
grant execute on function public.erp_update_order(uuid, jsonb) to authenticated;
