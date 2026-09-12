-- Снятие потолка факта, ПЕРВАЯ ПОПЫТКА — пересборка через `pg_get_functiondef`.
--
-- Применена к проду (журнал, 20260912144802) и сразу же заменена следующей
-- миграцией, 20260912145413. Файл заведён, потому что репозиторий обязан
-- описывать ТУ систему, что в проде: пропуск применённой версии — это ровно
-- тот отказ, который дважды ловили 13.08 и 18.08.
--
-- ЧЕМ ОНА ПЛОХА, И ЭТО СТОИТ ПОМНИТЬ. Функции здесь пересобирались
-- динамически: `pg_get_functiondef` → текстовая замена → `execute`. Для
-- `erp_create_order` (350 строк, девять секций) это верный приём — по памяти
-- такое не пишут. Но для коротких функций он делает их НЕВИДИМЫМИ для
-- сторожей репозитория: `latestDefining` ищет в миграциях
-- `create or replace function public.<имя>(`, не находит — и читает ПРЕЖНЮЮ
-- редакцию, то есть подтверждает снятый потолок как действующий.
-- Поймал это `stageQtyMath.test.ts`, оставшийся красным после применения.
--
-- Вывод, стоивший одной лишней миграции: приём выбирается не по «так короче»,
-- а по тому, останется ли правило видимым тому, кто его сторожит.

do $migration$
declare
  v_def text;
  v_hits int;
  v_clamp_old constant text :=
    'select greatest(least(coalesce(p_current, 0) + coalesce(p_delta, 0), p_total), 0)';
  v_clamp_new constant text :=
    'select greatest(coalesce(p_current, 0) + coalesce(p_delta, 0), 0)';
  v_trig_old constant text :=
    '    if new.qty_done > v_qty then new.qty_done := v_qty; end if;' || E'\n';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'erp_clamp_done';
  if v_def is null then
    raise exception 'erp_clamp_done не найдена';
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_clamp_old, ''))) / length(v_clamp_old);
  if v_hits <> 1 then
    raise exception 'erp_clamp_done: формула найдена % раз', v_hits;
  end if;
  execute replace(v_def, v_clamp_old, v_clamp_new);

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'erp_clamp_stage_qty';
  if v_def is null then
    raise exception 'erp_clamp_stage_qty не найдена';
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_trig_old, ''))) / length(v_trig_old);
  if v_hits <> 1 then
    raise exception 'erp_clamp_stage_qty: обрезка по тиражу найдена % раз', v_hits;
  end if;
  v_def := replace(v_def, v_trig_old, '');

  if position('> v_qty' in v_def) > 0 then
    raise exception 'erp_clamp_stage_qty: потолок остался';
  end if;
  if position('new.qty_done < 0' in v_def) = 0 then
    raise exception 'erp_clamp_stage_qty: потеряна обрезка снизу нулём';
  end if;
  execute v_def;
end
$migration$;

comment on function public.erp_clamp_done(int, int, int) is
  'Приращение qty_done: обрезка снизу нулём. ПОТОЛКА НЕТ с 12.09 (правка п. 5): факт сверх тиража сохраняется целиком, «плюс» считается как max(qty_done − qty, 0). Параметр p_total оставлен, чтобы не менять сигнатуру у пяти вызывающих, и больше не используется.';
