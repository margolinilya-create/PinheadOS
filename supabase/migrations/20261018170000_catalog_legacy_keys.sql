-- Справочники заказа, веха 8 единого потока, миграция M (18.10): старые ключи
-- `catalog_config` (`prices`, `labels`, `extras`, `fabrics`) удаляются.
--
-- План: docs/superpowers/plans/2026-10-18-order-flow-m8-polish-enable.md, задача 2
-- (решение К7). Значения сняты задачей 0 в репозиторий:
-- supabase/snapshots/catalog_config_legacy_2026-10-18.json (md5 `value::text`).
-- Последняя правка ключей — 11.05.2026; новые экраны их не читают (справочники
-- вехи 4 живут в `app_config` и `catalog_config.suppliers`).
--
-- ПРИМЕНЯЕТ ВЛАДЕЛЕЦ в SQL Editor (файлы supabase/rollout/m8/*-M.sql): MCP `execute_sql`
-- на операторе удаления ждёт подтверждения. Порядок с фронтом любой: клиент вехи 8
-- ключи не читает.
--
-- Предусловие — в самой миграции: строка с таким ключом, чьё значение разошлось
-- со снимком, — отказ «значения изменились — переснимите» (удалять несохранённое
-- нельзя). Строки нет — нечего сверять (`supabase db reset` локально).
--
-- Политика чтения G теряет ветку «старый `prices` — только руководству продаж»:
-- имя сохраняется (`alter policy`), обёртка `(select …)` — как в G.
-- Откат: supabase/rollout/m8/3-rollback-M.sql (вставка значений снимка, прежнее условие).

do $pre$
declare
  v_row record;
  c_md5 constant jsonb := '{
    "extras":  "378d803d6883ca5644155b6f8a853ea6",
    "fabrics": "7d939c429d033c13a986a9cb5a35a425",
    "labels":  "bcbc3031a827cf03b261ef40d349c362",
    "prices":  "15d6c08d3234d4d342748aa7c5a3e655"
  }'::jsonb;
begin
  for v_row in
    select key, md5(value::text) as h from public.catalog_config
     where key in ('prices', 'labels', 'extras', 'fabrics')
  loop
    if v_row.h is distinct from c_md5 ->> v_row.key then
      raise exception 'Значения catalog_config.% изменились после снимка (md5 %) — переснимите supabase/snapshots/catalog_config_legacy_2026-10-18.json',
        v_row.key, v_row.h;
    end if;
  end loop;
end;
$pre$;

delete from public.catalog_config where key in ('prices', 'labels', 'extras', 'fabrics');

alter policy catalog_config_select on public.catalog_config
  using ((select public.catalog_reader()));

notify pgrst, 'reload schema';
