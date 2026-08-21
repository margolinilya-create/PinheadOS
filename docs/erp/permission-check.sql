-- ШАБЛОН ПРОВЕРКИ ПРАВ НА ЖИВОЙ БАЗЕ
--
-- Заведён после разбора 21.08: две ошибки метода дали зелёный результат там,
-- где ничего не проверялось, и скрыли неработающую приёмку подряда складом.
-- Правило из CLAUDE.md легко забыть, шаблон — нет: берите этот файл целиком
-- и меняйте только блок «ЧТО ПРОВЕРЯЕМ».
--
-- ТРИ ВЕЩИ, БЕЗ КОТОРЫХ ПРОВЕРКА ЛЖЁТ:
--
-- 1. `set local role authenticated`. `set_config('request.jwt.claims', …)`
--    подменяет только личность (`auth.uid()`). RLS не применяется к владельцу
--    таблицы вовсе: без смены роли блок исполняется от `postgres`, и ЛЮБОЕ
--    действие «проходит». Такая проверка опаснее отсутствующей.
--
-- 2. Роль ЗАВОДИТСЯ, а не подбирается. В `erp_employees` живут три человека
--    (директор и два менеджера) — проверить кладовщика на боевых данных нечем.
--    `profiles` не связан с `auth.users` внешним ключом, поэтому временный
--    сотрудник заводится прямо здесь и уезжает вместе с откатом.
--
-- 3. Финальный `raise exception`. `execute_sql` КОММИТИТ: без исключения
--    в конце проверка оставит следы на бое. Откат делает исключение,
--    а не намерение.
--
-- И ГЛАВНОЕ ПО СУЩЕСТВУ: право проверяется ПО ВСЕЙ ЦЕПОЧКЕ. Строку вставили —
-- дальше сработает триггер, а за ним страж, у которого свои требования.
-- Проверять надо конечный результат («этап закрылся»), а не первый шаг.

do $$
declare
  v_uid uuid := gen_random_uuid();
  -- ── ЧТО ПРОВЕРЯЕМ: роль и ожидание ────────────────────────────────────────
  v_role text := 'storekeeper';     -- worker · storekeeper · purchaser · manager · technologist · dispatcher · production_head
  v_result text;
begin
  -- ── 1. Данные, на которых проверяем (от владельца — это подготовка, не проверка)
  -- insert into public.erp_orders … returning id into v_order;

  -- ── 2. Временный сотрудник с нужной ролью
  insert into public.profiles (id, name, email, role, approved, active)
  values (v_uid, 'ВРЕМЕННО ' || v_role, v_role || '@tmp.test', 'production', true, true);
  insert into public.erp_employees (profile_id, full_name, role, active)
  values (v_uid, 'ВРЕМЕННО ' || v_role, v_role, true);
  -- Нужен цех? добавьте department_id: `canActInDept` на человеке без цеха
  -- работает fail-open, и проверка «чужой цех» без него ничего не покажет.

  -- ── 3. Личность И РОЛЬ
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ── 4. Действие. Ожидаемый отказ ловим, неожиданный — пусть падает
  begin
    -- insert into public.erp_subcontract_moves (…) values (…);
    v_result := 'прошло';
  exception when insufficient_privilege then
    v_result := 'отказ 42501';
  end;

  reset role;

  -- ── 5. Проверяем КОНЕЧНЫЙ результат, а не факт вставки
  -- select status into v_status from public.erp_item_stages where id = v_stage;

  -- ── 6. Откат. Без него проверка меняет боевые данные
  raise exception 'РЕЗУЛЬТАТ | роль=% | действие=%', v_role, v_result;
end $$;

-- ЧИТАТЬ МАТРИЦУ ПРАВ ТОЛЬКО С `allowed`: таблица хранит строку на каждую пару
-- «роль × право», в том числе со значением false, и запрос без фильтра
-- показывает у рабочего все шестнадцать прав.
--
--   select role, permission, allowed from public.erp_role_permissions
--    where permission = 'stage.progress' and allowed order by role;
