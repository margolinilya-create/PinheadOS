-- Маршрут передаёт ЦИКЛ этапа (правка заказчика 12.09, п. 2).
--
-- ЗАЧЕМ. Правка просит отдельную задачу «Разработка программы вышивки»,
-- создаваемую сразу при создании заказа и независимо от кроя. Задача — это
-- ЭТАП (документ просит «ту же механику»: статус, план, проблема, завершение,
-- фиксация результата — всё это уже живёт на этапе). Значит у позиции с
-- вышивкой этапов цеха «Вышивка» становится ДВА: подготовка и сама вышивка.
--
-- А уникальность наших этапов — частичный индекс
-- `erp_item_stages_item_dept_cycle_key (item_id, department_id, cycle)
--  where coalesce(executor,'internal') = 'internal'` (20260816160000).
-- Оба писателя этапов — `erp_create_order` и `erp_route_apply` — `cycle`
-- не передавали вовсе, оставляя дефолт 0. То есть без этой миграции второй
-- этап вышивки падает 23505, и НЕ СОЗДАЁТСЯ ВЕСЬ ЗАКАЗ: позиции, нанесения,
-- ТЗ и материалы вставляет та же транзакция.
--
-- Колонка `cycle` заведена 20260810180000 ради повторных заходов образца
-- («сшили → примерили → переделали → сшили снова»). Смысл не меняется:
-- это по-прежнему «какой по счёту проход позиции через этот цех».
--
-- ЦИКЛ У СУЩЕСТВУЮЩЕГО ЭТАПА НЕ ТРОГАЕТСЯ. В `erp_route_apply` он попадает
-- только в ветку INSERT: смена цикла у живого этапа означала бы перевесить
-- его на другой проход — то есть переписать историю работы цеха. Правка
-- маршрута такого не делает и делать не должна.
--
-- Обе функции пересобираются ИЗ ИХ ЖЕ ОПРЕДЕЛЕНИЙ (`pg_get_functiondef`):
-- `erp_create_order` — 350 строк с девятью секциями, и по памяти такое
-- не переписывают. Каждая замена проверяется на однозначность: не сработавшая
-- подстановка оставила бы функцию прежней МОЛЧА, и заказ с вышивкой перестал
-- бы создаваться вообще — ровно тот отказ, который ищут потом в клиенте.

do $migration$
declare
  v_def text;
  -- Список колонок и значение — одна пара на обе функции: вставка этапа
  -- у них написана одинаково, и это не совпадение, а следствие правила
  -- «оба писателя этапов пишут одним выражением»
  v_cols_old constant text :=
    '        (item_id, department_id, sort_order, depends_on, queue_position,'
    || E'\n' || '         executor, contractor, operation)';
  v_cols_new constant text :=
    '        (item_id, department_id, sort_order, depends_on, queue_position,'
    || E'\n' || '         executor, contractor, operation, cycle)';
  v_hits int;
begin
  -- ── erp_create_order ──
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'erp_create_order';
  if v_def is null then
    raise exception 'erp_create_order не найдена';
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_cols_old, ''))) / length(v_cols_old);
  if v_hits <> 1 then
    raise exception 'erp_create_order: список колонок этапа найден % раз', v_hits;
  end if;
  v_def := replace(v_def, v_cols_old, v_cols_new);

  v_hits := (length(v_def) - length(replace(v_def, '         v_stage->>''operation'')', '')))
            / length('         v_stage->>''operation'')');
  if v_hits <> 1 then
    raise exception 'erp_create_order: вставка значения operation найдена % раз', v_hits;
  end if;
  v_def := replace(
    v_def,
    '         v_stage->>''operation'')',
    '         v_stage->>''operation'','
      || E'\n' || '         coalesce((v_stage->>''cycle'')::int, 0))');

  if position('cycle' in v_def) = 0 then
    raise exception 'erp_create_order: замена не сработала';
  end if;
  execute v_def;

  -- ── erp_route_apply ──
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'erp_route_apply';
  if v_def is null then
    raise exception 'erp_route_apply не найдена';
  end if;

  -- Здесь список колонок с ДРУГИМ отступом (вставка вложена глубже)
  v_hits := (length(v_def) - length(replace(v_def, v_cols_old, ''))) / length(v_cols_old);
  if v_hits <> 1 then
    raise exception 'erp_route_apply: список колонок этапа найден % раз', v_hits;
  end if;
  v_def := replace(v_def, v_cols_old, v_cols_new);

  v_hits := (length(v_def) - length(replace(v_def, '         v_step->>''operation'')', '')))
            / length('         v_step->>''operation'')');
  if v_hits <> 1 then
    raise exception 'erp_route_apply: вставка значения operation найдена % раз', v_hits;
  end if;
  v_def := replace(
    v_def,
    '         v_step->>''operation'')',
    '         v_step->>''operation'','
      || E'\n' || '         coalesce((v_step->>''cycle'')::int, 0))');

  if position('cycle' in v_def) = 0 then
    raise exception 'erp_route_apply: замена не сработала';
  end if;
  execute v_def;
end
$migration$;
