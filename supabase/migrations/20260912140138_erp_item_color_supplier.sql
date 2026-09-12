-- Поле «Цвет / поставщик» в техническом блоке позиции (правка 12.09, п. 3).
--
-- «В техническом блоке изделия сейчас нет отдельного поля, где можно указать
-- цвет материала и поставщика».
--
-- ЭТО НЕ ТРЕТЬЕ МЕСТО ПРО ЦВЕТ, и разделение названо вслух, потому что
-- спутать легко. Цвет ИЗДЕЛИЯ живёт в `variant` («Худи · чёрное») и в строках
-- `size_grid`, где определяет раскладку по размерам. Здесь — цвет МАТЕРИАЛА
-- вместе с тем, у кого он берётся: закупка называет эту пару одной строкой
-- («футер 320 пыльная роза, Атлас»), и разносить её по двум полям значило бы
-- заставлять человека делить то, что он и так пишет вместе.
--
-- Поле свободное: справочника поставщиков у позиции нет (он есть у строки
-- закупки, `erp_material_suppliers`), и заводить второй здесь незачем —
-- на момент создания заказа поставщик часто ещё предположение.

alter table public.erp_order_items
  add column if not exists color_supplier text;

comment on column public.erp_order_items.color_supplier is
  'Цвет материала и поставщик одной строкой (правка 12.09). НЕ цвет изделия: тот в variant и в size_grid.';

-- ── Создание заказа пишет новое поле ────────────────────────────────────────
--
-- ФУНКЦИЯ ПЕРЕСОБИРАЕТСЯ ИЗ ЕЁ ЖЕ ОПРЕДЕЛЕНИЯ (`pg_get_functiondef`), а не
-- переписывается по памяти: `erp_create_order` — 350 строк с девятью секциями,
-- и подлинный текст здесь тот, что В БАЗЕ. Правило записано после 20.08, когда
-- пересоздание «по тексту прежней миграции» едва не выбросило молча связь
-- заказа с ТЗ, применённую к проду мимо репозитория.
--
-- КАЖДАЯ ЗАМЕНА ПРОВЕРЯЕТСЯ: не сработавшая подстановка оставила бы функцию
-- прежней МОЛЧА, и поле просто не доезжало бы до базы — ровно тот отказ,
-- который ищут потом в клиенте.
do $migration$
declare
  v_def text;
  v_cols_old constant text := '       fit, main_fabric, trim_material, cutting_note, sewing_note, labels_note,';
  v_cols_new constant text := '       fit, main_fabric, color_supplier, trim_material, cutting_note, sewing_note, labels_note,';
  v_vals_old constant text := '       v_item->>''main_fabric'',';
  v_vals_new constant text := '       v_item->>''main_fabric'',' || E'\n' || '       v_item->>''color_supplier'',';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'erp_create_order';

  if v_def is null then
    raise exception 'erp_create_order не найдена — пересобирать нечего';
  end if;

  -- Обе строки обязаны встречаться РОВНО ОДИН раз: вторая точка вставки
  -- означала бы, что замена уедет не туда, и заметить это было бы нечем.
  if (length(v_def) - length(replace(v_def, v_cols_old, ''))) / length(v_cols_old) <> 1 then
    raise exception 'список колонок позиции не найден или неоднозначен';
  end if;
  if (length(v_def) - length(replace(v_def, v_vals_old, ''))) / length(v_vals_old) <> 1 then
    raise exception 'вставка значения main_fabric не найдена или неоднозначна';
  end if;

  v_def := replace(v_def, v_cols_old, v_cols_new);
  v_def := replace(v_def, v_vals_old, v_vals_new);

  if position('color_supplier' in v_def) = 0 then
    raise exception 'замена не сработала: color_supplier отсутствует в новом определении';
  end if;

  execute v_def;
end
$migration$;
