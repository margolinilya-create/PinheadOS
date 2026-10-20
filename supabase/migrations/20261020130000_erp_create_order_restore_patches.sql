-- erp_create_order: вернуть четыре правки, потерянные при пересоздании в T1
-- (ошибка с боя 20.10, заказ 48626 «Дикси балаклавы и сумки»).
--
-- T1 (`20261020090000_erp_biz_tasks_schema`) пересоздал `erp_create_order`
-- по ПОСЛЕДНЕМУ ПОЛНОМУ ТЕКСТУ в миграциях — `20260907203932_erp_garment_source`.
-- Но четыре правки после него вносились подстановкой в живое определение
-- (`pg_get_functiondef` + `replace`), и полного текста с ними в миграциях нет.
-- T1 их молча откатил:
--   1. `20260912140138_erp_item_color_supplier` — `color_supplier` позиции;
--   2. `20260912143920_erp_stage_cycle_from_route` — `cycle` этапа: без него
--      повторный проход нашего цеха (склад дважды) — 23505
--      `erp_item_stages_item_dept_cycle_key`, заказ не создаётся вовсе;
--   3. `20260912234725_erp_stage_result_kind` — `result_kind` этапа: без него
--      «Разработка программы вышивки» создаётся обычной вышивкой;
--   4. `20260915034723_erp_order_sku_card_link` — `sku_card_id` позиции.
--
-- Здесь — те же подстановки, в том же порядке, в живое определение (то есть
-- поверх T1: ветка менеджера заказа сохраняется). Каждая строка поиска
-- обязана встретиться РОВНО ОДИН раз, иначе исключение и ничего не меняется:
-- не сработавшая замена оставила бы функцию прежней молча.
-- `erp_route_apply` и `erp_update_order` правки 19.10 не пересоздавали —
-- их не трогаем.
--
-- Откат — не нужен: функция возвращается к поведению до T1 плюс менеджер
-- заказа T1. Сторож — `src/erp/utils/createOrderPatches.test.ts`.

-- Подстановка «ровно один раз» (временная функция живёт до конца сессии)
create function pg_temp.erp_restore_replace_once(p_def text, p_old text, p_new text, p_what text)
returns text language plpgsql as $f$
declare v_hits int;
begin
  v_hits := (length(p_def) - length(replace(p_def, p_old, ''))) / length(p_old);
  if v_hits <> 1 then
    raise exception 'erp_create_order, правка %: строка найдена % раз', p_what, v_hits;
  end if;
  return replace(p_def, p_old, p_new);
end
$f$;

do $restore$
declare
  v_def text;

  -- 1. color_supplier (дословно из 20260912140138)
  v_c1_cols_old constant text := '       fit, main_fabric, trim_material, cutting_note, sewing_note, labels_note,';
  v_c1_cols_new constant text := '       fit, main_fabric, color_supplier, trim_material, cutting_note, sewing_note, labels_note,';
  v_c1_vals_old constant text := '       v_item->>''main_fabric'',';
  v_c1_vals_new constant text := '       v_item->>''main_fabric'',' || E'\n' || '       v_item->>''color_supplier'',';

  -- 2. cycle (дословно из 20260912143920)
  v_c2_cols_old constant text :=
    '        (item_id, department_id, sort_order, depends_on, queue_position,'
    || E'\n' || '         executor, contractor, operation)';
  v_c2_cols_new constant text :=
    '        (item_id, department_id, sort_order, depends_on, queue_position,'
    || E'\n' || '         executor, contractor, operation, cycle)';
  v_c2_vals_old constant text := '         v_stage->>''operation'')';
  v_c2_vals_new constant text := '         v_stage->>''operation'','
    || E'\n' || '         coalesce((v_stage->>''cycle'')::int, 0))';

  -- 3. result_kind (дословно из 20260912234725)
  v_c3_cols_old constant text := v_c2_cols_new;
  v_c3_cols_new constant text :=
    '        (item_id, department_id, sort_order, depends_on, queue_position,'
    || E'\n' || '         executor, contractor, operation, cycle, result_kind)';
  v_c3_vals_old constant text := 'coalesce((v_stage->>''cycle'')::int, 0))';
  v_c3_vals_new constant text := 'coalesce((v_stage->>''cycle'')::int, 0),'
    || E'\n' || '         v_stage->>''result_kind'')';

  -- 4. sku_card_id (дословно из 20260915034723)
  v_c4_cols_old constant text := 'packaging_width_mm, packaging_height_mm, garment_source)';
  v_c4_cols_new constant text := 'packaging_width_mm, packaging_height_mm, garment_source, sku_card_id)';
  v_c4_vals_old constant text := E'v_item->>\'garment_source\')\n    returning id into v_item_id;';
  v_c4_vals_new constant text := E'v_item->>\'garment_source\',\n       nullif(v_item->>\'sku_card_id\', \'\')::uuid)\n    returning id into v_item_id;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'erp_create_order';
  if v_def is null then
    raise exception 'erp_create_order не найдена';
  end if;
  if position('color_supplier' in v_def) > 0 or position('result_kind' in v_def) > 0
     or position('sku_card_id' in v_def) > 0 or position('''cycle''' in v_def) > 0 then
    raise exception 'erp_create_order уже несёт часть правок — разобрать руками, не подставлять вслепую';
  end if;

  v_def := pg_temp.erp_restore_replace_once(v_def, v_c1_cols_old, v_c1_cols_new, '1 color_supplier: колонки');
  v_def := pg_temp.erp_restore_replace_once(v_def, v_c1_vals_old, v_c1_vals_new, '1 color_supplier: значения');
  v_def := pg_temp.erp_restore_replace_once(v_def, v_c2_cols_old, v_c2_cols_new, '2 cycle: колонки');
  v_def := pg_temp.erp_restore_replace_once(v_def, v_c2_vals_old, v_c2_vals_new, '2 cycle: значения');
  v_def := pg_temp.erp_restore_replace_once(v_def, v_c3_cols_old, v_c3_cols_new, '3 result_kind: колонки');
  v_def := pg_temp.erp_restore_replace_once(v_def, v_c3_vals_old, v_c3_vals_new, '3 result_kind: значения');
  v_def := pg_temp.erp_restore_replace_once(v_def, v_c4_cols_old, v_c4_cols_new, '4 sku_card_id: колонки');
  v_def := pg_temp.erp_restore_replace_once(v_def, v_c4_vals_old, v_c4_vals_new, '4 sku_card_id: значения');

  if position('manager_id' in v_def) = 0 then
    raise exception 'ветка менеджера заказа T1 пропала — стоп';
  end if;
  execute v_def;
end
$restore$;

-- Данные: этапы «Разработка программы вышивки», созданные без `result_kind`
-- за время поломки (заказы после применения T1, 19.10 ≈ 19:33 UTC). На 20.10
-- таких 10 — «Фреш Фитнес март 2026» (7) и «Для студии_БЮРО_вышивка» (3),
-- все в ожидании. Только одиночная строка вышивки позиции (фаза программы
-- E1) и только не начатая: начатую разбирают с цехом, а не скриптом
update public.erp_item_stages s
   set result_kind = 'embroidery_program'
  from public.erp_order_items i, public.erp_orders o, public.erp_departments d
 where i.id = s.item_id and o.id = i.order_id and d.id = s.department_id
   and d.code = 'embroidery'
   and o.created_at > '2026-10-19 19:30:00+00'
   and s.result_kind is null
   and s.operation = 'Разработка программы вышивки'
   and s.status = 'waiting'
   and coalesce(s.executor, 'internal') = 'internal'
   and not exists (select 1 from public.erp_item_stages n
                     join public.erp_departments nd on nd.id = n.department_id
                    where n.item_id = s.item_id and n.id <> s.id and nd.code = 'embroidery');
