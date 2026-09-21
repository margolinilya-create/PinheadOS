-- Склейка повторяющихся строк размерной сетки (правка заказчика 21.09, п. 8).
--
-- ЧТО СЛОМАЛОСЬ. Сетка хранится как `[{color, sizes}]`, и ВСЯ система адресует
-- ячейку парой «цвет × размер»: таблица закупки, приёмка склада, раскрой,
-- размерный результат пошива. Форма заказа при этом позволяла завести второй
-- ряд с тем же цветом — и делала это по умолчанию, потому что цвет у новой
-- строки ПУСТ (читается как «—»). На бою 21.09 такие позиции есть:
-- «тест готовое 2» — [{«—», 3XS:100}, {«—», 3XS:122}], «тест закрой 1» —
-- [{«—», XS:50}, {«—», XS:150}].
--
-- Две строки с одним ключом давали таблицу, где оба поля ввода читают одно
-- значение, а обратная сборка (`cellsToGrid`) их складывает: каждое нажатие
-- клавиши удваивало введённое число. Заказчик описал это как «вместо
-- введённого количества появляются значения вида 336842, а общий итог
-- пересчитывается в 673684» (673684 = 2 × 336842 — те самые две строки).
-- Там же и вторая половина п. 3: «в заказе XS 50» показывало ПЕРВУЮ строку,
-- хотя в заказе 200.
--
-- ПОЧЕМУ СУММА, А НЕ «ПОБЕЖДАЕТ ПОСЛЕДНЯЯ». Тираж позиции считается
-- `erp_size_grid_total`, а она суммирует ВСЕ строки сетки без оглядки на
-- повторы. Значит, 100 и 122 уже сегодня живут в системе как 222 — и склейка
-- суммой ничего не меняет ни в одном числе. Любой другой выбор изменил бы
-- тираж действующих заказов миграцией, чего делать нельзя.
--
-- Клиент чинится тем же правилом: `gridCells` схлопывает повтор при чтении
-- (лечит то, что уже записано), `gridToPayload` собирает payload сразу по
-- цветам, а `SizeGridEditor` не даёт завести безымянный второй ряд.

create or replace function public.erp_size_grid_merge(p_grid jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  with rows_in as (
    select
      t.ordinality                                                       as ord,
      coalesce(nullif(btrim(coalesce(t.elem->>'color', '')), ''), '—')   as color,
      t.elem->'sizes'                                                    as sizes
      from jsonb_array_elements(
             case when jsonb_typeof(p_grid) = 'array' then p_grid else '[]'::jsonb end
           ) with ordinality as t(elem, ordinality)
  ), cells as (
    select r.ord, r.color, s.key as size,
           -- Нечисловое количество читается нулём: сетка приезжает и из
           -- старых заказов, и падать на ней миграции нельзя
           case when jsonb_typeof(s.value) = 'number'
                then (s.value #>> '{}')::numeric else 0 end as qty
      from rows_in r
      join lateral jsonb_each(
             case when jsonb_typeof(r.sizes) = 'object' then r.sizes else '{}'::jsonb end
           ) s on true
     where btrim(s.key) <> ''
  ), summed as (
    select color, size, sum(qty) as qty, min(ord) as ord
      from cells group by color, size
  ), by_color as (
    select color, min(ord) as ord, jsonb_object_agg(size, qty) as sizes
      from summed group by color
  )
  -- Сетки без единой ячейки (пустой массив, мусор) возвращаются КАК ЕСТЬ:
  -- миграция чинит повторы, а не переписывает то, чего не понимает
  select coalesce(
           (select jsonb_agg(jsonb_build_object('color', color, 'sizes', sizes) order by ord)
              from by_color),
           p_grid);
$$;

comment on function public.erp_size_grid_merge(jsonb) is
  'Сетка [{color,sizes}] без повторяющихся пар «цвет × размер»: повтор складывается. Зеркало клиентских gridCells/gridToPayload (правка 21.09, п. 8)';

-- Уже записанное. Условие `is distinct from` трогает только реально изменённые
-- строки: у сетки без повторов результат побайтово тот же
update public.erp_order_items
   set size_grid = public.erp_size_grid_merge(size_grid)
 where size_grid is not null
   and public.erp_size_grid_merge(size_grid) is distinct from size_grid;

update public.erp_materials
   set size_grid = public.erp_size_grid_merge(size_grid)
 where size_grid is not null
   and public.erp_size_grid_merge(size_grid) is distinct from size_grid;

update public.erp_materials
   set size_grid_ordered = public.erp_size_grid_merge(size_grid_ordered)
 where size_grid_ordered is not null
   and public.erp_size_grid_merge(size_grid_ordered) is distinct from size_grid_ordered;

update public.erp_material_receipts
   set size_grid = public.erp_size_grid_merge(size_grid)
 where size_grid is not null
   and public.erp_size_grid_merge(size_grid) is distinct from size_grid;
