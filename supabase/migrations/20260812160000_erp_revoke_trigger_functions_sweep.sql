-- Триггерные функции закрываются для REST СПИСКОМ, а не поимённо.
--
-- ЧТО СЛУЧИЛОСЬ. Миграция `20260803250000` закрыла двенадцать триггерных
-- функций, перечислив их по именам. Сегодняшняя `erp_experimental_task_sync()`
-- в тот список, разумеется, не попала — и осталась единственной триггерной
-- функцией схемы, вызываемой ролью `authenticated` через
-- `/rest/v1/rpc/erp_experimental_task_sync`. Advisor это показал.
--
-- Прямой вызов и так падает («trigger functions can only be called as
-- triggers»), поэтому дыры здесь нет. Дефект в другом: перечисление по именам
-- НЕ ПЕРЕЖИВАЕТ добавления тринадцатой функции, а предупреждение адвизора,
-- которое висит всегда, — это шум, за которым теряется настоящее.
--
-- Поэтому отзыв делается ОБХОДОМ: всё, что возвращает `trigger`, клиенту
-- не нужно никогда — движок зовёт такие функции при DML, и EXECUTE при
-- срабатывании триггера не проверяется вовсе.
--
-- Отзыв идёт `from public, anon, authenticated` — правило проекта: `from anon`
-- в одиночку не работает, право приходит от PUBLIC (`=X/postgres` в ACL),
-- и `anon` его наследует.
--
-- ГРАНИЦА. Обход закрывает то, что есть СЕЙЧАС. Триггерную функцию, созданную
-- ПОЗЖЕ этой миграции, он не увидит — её обязана закрыть своя миграция,
-- и это сторожит `utils/triggerFunctionsRevoked.test.ts`.
--
-- Предикаты RLS (`is_admin`, `erp_is_manager`, `erp_is_member`,
-- `erp_has_permission`, `erp_role_of_caller`, `erp_can_act_in_dept`,
-- `erp_can_pack_ship`) обходом НЕ затрагиваются и остаются открытыми
-- осознанно: они возвращают `boolean`, а не `trigger`, стоят в предикатах
-- политик, и предикаты исполняются ОТ ЛИЦА ВЫЗЫВАЮЩЕГО — отзыв EXECUTE
-- сломал бы сами политики. Это записано в CLAUDE.md как «не чинить».

do $$
declare
  v_fn record;
  v_count int := 0;
begin
  for v_fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'pg_catalog.trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      v_fn.sig
    );
    v_count := v_count + 1;
  end loop;

  raise notice 'Закрыто триггерных функций: %', v_count;
end $$;

-- Проверка на месте: после обхода не должно остаться ни одной открытой.
do $$
declare
  v_left text;
begin
  select string_agg(p.proname, ', ')
    into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prorettype = 'pg_catalog.trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute');

  if v_left is not null then
    raise exception 'Триггерные функции остались открытыми для authenticated: %', v_left;
  end if;
end $$;
