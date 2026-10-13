-- СВЯЗЬ ПОЗИЦИИ ЗАКАЗА С КАРТОЧКОЙ МОДЕЛИ (правка заказчика 14.09, п. 6).
--
-- Колонка `erp_order_items.sku_card_id` заведена миграцией 20260915030910,
-- но НИ ОДИН писатель её не заполнял: оба — `erp_create_order`
-- и `erp_update_order` — перечисляют колонки поимённо. Без этой миграции
-- «Использовать в заказе» писало бы в пустоту, а статистика модели
-- (`erp_sku_card_stats` считает РОВНО по `sku_card_id`) навсегда показывала
-- бы ноль заказов. Колонка, доехавшая до базы, обязана доехать и обратно.
--
-- ССЫЛКА, А НЕ ЗАМЕНА ПОЛЕЙ. Позиция продолжает хранить собственные
-- `product_type`, `fit`, ткань и размерную сетку — это СНИМОК на момент
-- заказа. Правка карточки задним числом не имеет права переписать
-- действующий заказ (прямой запрет документа), и одной ссылкой это
-- не выражается.
--
-- ФУНКЦИИ ПЕРЕСОБИРАЮТСЯ ИЗ СОБСТВЕННОГО ОПРЕДЕЛЕНИЯ (`pg_get_functiondef`
-- + текстовые вставки) — приём проекта для длинных функций: `erp_create_order`
-- это 350 строк и девять секций, по памяти такое не пишут. КАЖДАЯ вставка
-- проверяется: не сработавшая замена оставила бы функцию прежней МОЛЧА,
-- и правка выглядела бы применённой.
--
-- ⚠️ Оборотная сторона приёма записана в правилах проекта: пересобранная
-- функция ПРЯЧЕТСЯ от сторожей, читающих `create or replace function
-- public.<имя>(` в миграциях. Здесь это принято сознательно (обе функции
-- уже пересобирались так же), и сторож связи привязан не к тексту функции,
-- а к самой колонке — `skuCardOrderLink.test.ts` читает эту миграцию.

do $mig$
declare
  v_src text;
  v_new text;
begin
  -- ── 1. Создание заказа: колонка в перечне и значение в values ────────────
  select pg_get_functiondef(oid) into v_src
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'erp_create_order';

  v_new := replace(v_src,
    'packaging_width_mm, packaging_height_mm, garment_source)',
    'packaging_width_mm, packaging_height_mm, garment_source, sku_card_id)');
  if v_new = v_src then
    raise exception 'вставка 1 не сработала: перечень колонок erp_order_items не найден';
  end if;
  v_src := v_new;

  /**
   * `nullif(…, '')::uuid`, а не голый `::uuid`: форма шлёт пустую строку,
   * когда модель не выбрана, и приведение пустой строки к uuid отвечает
   * 22P02 — то есть заказ не создавался бы ВООБЩЕ. Тот же приём, что
   * у `created_by` и `tz_order_id` парой десятков строк выше.
   */
  v_new := replace(v_src,
    E'v_item->>\'garment_source\')\n    returning id into v_item_id;',
    E'v_item->>\'garment_source\',\n       nullif(v_item->>\'sku_card_id\', \'\')::uuid)\n    returning id into v_item_id;');
  if v_new = v_src then
    raise exception 'вставка 2 не сработала: список значений позиции не найден';
  end if;
  execute v_new;

  -- ── 2. Правка заказа ────────────────────────────────────────────────────
  select pg_get_functiondef(oid) into v_src
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'erp_update_order';

  /**
   * ПРОВЕРЯЕТСЯ НАЛИЧИЕ КЛЮЧА, А НЕ ЕГО ЗНАЧЕНИЕ (`v_item ? 'sku_card_id'`).
   *
   * Голое присваивание отвязывало бы модель у любого, кто правит заказ
   * из ОТКРЫТОЙ СТАРОЙ ВКЛАДКИ: прежний бандл ключа не шлёт, `->>`
   * отдаёт null, и связь исчезала бы МОЛЧА — заказы переставали бы
   * считаться в статистике модели. А `coalesce` сделал бы связь
   * неразрываемой: снять ошибочно выбранную модель стало бы нечем.
   * Ключ есть — пишем что прислали (пустое значение отвязывает), ключа
   * нет — не трогаем вовсе.
   */
  v_new := replace(v_src,
    E'garment_source      = coalesce(v_item->>\'garment_source\', garment_source),',
    E'garment_source      = coalesce(v_item->>\'garment_source\', garment_source),\n'
    || E'      sku_card_id         = case when v_item ? \'sku_card_id\'\n'
    || E'                                 then nullif(v_item->>\'sku_card_id\', \'\')::uuid\n'
    || E'                                 else sku_card_id end,');
  if v_new = v_src then
    raise exception 'вставка 3 не сработала: блок update erp_order_items не найден';
  end if;
  execute v_new;
end $mig$;

/**
 * СТРАЖ ПОЗИЦИИ ЭТУ КОЛОНКУ УЖЕ ЗАКРЫВАЕТ — проверено базой, а не памятью:
 * `erp_order_item_guard` требует `order.manage` на ЛЮБУЮ правку позиции
 * (единственное исключение — помеченная транзакция роллапа отгрузки).
 * Дописывать перечисление колонок ради одной значило бы СУЗИТЬ страж: всё,
 * что в перечень не попало, стало бы разрешённым.
 */
