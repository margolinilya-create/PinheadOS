-- РЕЗУЛЬТАТ ЭТАПА «РАЗРАБОТКА ПРОГРАММЫ ВЫШИВКИ» — ФАЙЛ, А НЕ ШТУКИ
-- (правка заказчика 12.09, вторая порция, баг 02).
--
-- Документ: «дополнительная задача на разработку программы вышивки создаётся
-- как обычная производственная задача вышивки: в ней требуется указывать
-- „Вышито, шт" и „Брак, шт". Для разработки программы это неверный тип
-- результата… сделать отдельный результат: загрузка файла программы вышивки».
--
-- ПОЧЕМУ КОЛОНКА, А НЕ ОПОЗНАНИЕ ПО ИМЕНИ ОПЕРАЦИИ. Схема отчёта живёт
-- у УЧАСТКА (`erp_departments.result_fields`), и у цеха вышивки это «Вышито»
-- и «Брак» — то есть оба его этапа, разработка программы и сама вышивка,
-- получают одну форму. Различить их можно было бы по `operation`, но это
-- свободный текст: в справочнике `route_operation` такой операции нет вовсе,
-- человек правит имя в конструкторе маршрута, и опознание по строке
-- перестало бы работать от первого переименования — МОЛЧА, вернув цеху поля
-- количества.
--
-- ВИД ВЛОЖЕНИЯ ЗАВОДИТСЯ В ДВУХ МЕСТАХ ОДНИМ КОММИТОМ — здесь и в типе
-- `ErpAttachmentKind`. Виды `print`/`label`/`note` 22.08 завели только в типе:
-- весь unit-набор был зелёным, а первая же попытка приложить файл отвечала
-- 23514 и роняла создание заказа целиком.

alter table public.erp_item_stages
  add column if not exists result_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'erp_item_stages_result_kind_check'
  ) then
    alter table public.erp_item_stages
      add constraint erp_item_stages_result_kind_check
      check (result_kind is null or result_kind in ('embroidery_program'));
  end if;
end $$;

comment on column public.erp_item_stages.result_kind is
  'Чем отчитывается этап, когда схема участка не подходит. NULL — числами по erp_departments.result_fields; embroidery_program — файлом программы вышивки (правка 12.09, баг 02).';

alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;
alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase',
                  'purchase_list', 'subcontract',
                  'print', 'label', 'note',
                  'dev_pattern', 'dev_passport', 'dev_photo', 'dev_task',
                  -- Результат этапа маршрута: файл, который цех СДАЁТ,
                  -- в отличие от `subcontract` — файлов, которые подрядчику
                  -- ОТДАЮТ. Адресуется тем же `stage_id`.
                  'stage_result'));

-- ── Колонка едет от расчёта до базы ───────────────────────────────────────
-- ПИСАТЕЛЕЙ ЭТАПОВ ДВА, и пропуск второго даёт «доезжает только со второго
-- сохранения» — проект на этом уже ловился (20.08, подрядные поля этапа).
--
-- Функции пересобираются из ИХ ЖЕ определения: это 350 строк и девять секций,
-- по памяти такое не пишут, а подлинный текст — тот, что в БАЗЕ. Цена приёма
-- названа вслух: `latestDefining` их после этого не видит и читает прежнюю
-- редакцию. Поэтому КАЖДАЯ вставка проверяется на единственность попадания
-- и на факт замены — не сработавшая замена оставила бы функцию прежней молча.
do $migration$
declare
  v_def text;
  v_hits int;
  v_cols_old constant text :=
    '        (item_id, department_id, sort_order, depends_on, queue_position,'
    || E'\n' || '         executor, contractor, operation, cycle)';
  v_cols_new constant text :=
    '        (item_id, department_id, sort_order, depends_on, queue_position,'
    || E'\n' || '         executor, contractor, operation, cycle, result_kind)';
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

  v_hits := (length(v_def) - length(replace(v_def, 'coalesce((v_stage->>''cycle'')::int, 0))', '')))
            / length('coalesce((v_stage->>''cycle'')::int, 0))');
  if v_hits <> 1 then
    raise exception 'erp_create_order: вставка значения cycle найдена % раз', v_hits;
  end if;
  v_def := replace(
    v_def,
    'coalesce((v_stage->>''cycle'')::int, 0))',
    'coalesce((v_stage->>''cycle'')::int, 0),' || E'\n' || '         v_stage->>''result_kind'')');

  if position('result_kind' in v_def) = 0 then
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

  v_hits := (length(v_def) - length(replace(v_def, v_cols_old, ''))) / length(v_cols_old);
  if v_hits <> 1 then
    raise exception 'erp_route_apply: список колонок этапа найден % раз', v_hits;
  end if;
  v_def := replace(v_def, v_cols_old, v_cols_new);

  v_hits := (length(v_def) - length(replace(v_def, 'coalesce((v_step->>''cycle'')::int, 0))', '')))
            / length('coalesce((v_step->>''cycle'')::int, 0))');
  if v_hits <> 1 then
    raise exception 'erp_route_apply: вставка значения cycle найдена % раз', v_hits;
  end if;
  v_def := replace(
    v_def,
    'coalesce((v_step->>''cycle'')::int, 0))',
    'coalesce((v_step->>''cycle'')::int, 0),' || E'\n' || '         v_step->>''result_kind'')');

  if position('result_kind' in v_def) = 0 then
    raise exception 'erp_route_apply: замена не сработала';
  end if;
  execute v_def;
end
$migration$;

-- ── Страж этапов видит новую колонку ──────────────────────────────────────
-- Колонка, не вписанная в `v_guarded`, не проверяется ВООБЩЕ ничем: ранний
-- выход стража стоит выше проверки прав и проверки цеха.
do $guard$
declare
  v_def text;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'erp_stage_guard';
  if v_def is null then
    raise exception 'erp_stage_guard не найдена';
  end if;

  v_hits := (length(v_def) - length(replace(v_def, 'new.operation       is distinct from old.operation', '')))
            / length('new.operation       is distinct from old.operation');
  if v_hits <> 1 then
    raise exception 'erp_stage_guard: строка operation найдена % раз', v_hits;
  end if;
  v_def := replace(
    v_def,
    'new.operation       is distinct from old.operation',
    'new.operation       is distinct from old.operation'
      || E'\n' || '    or new.result_kind     is distinct from old.result_kind');

  if position('result_kind' in v_def) = 0 then
    raise exception 'erp_stage_guard: замена не сработала';
  end if;
  execute v_def;
end
$guard$;
