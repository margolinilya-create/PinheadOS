-- Отзыв EXECUTE у `authenticated` на `erp_ensure_subcontract_send`.
--
-- ЧТО БЫЛО. Миграция 20260824191611 завела функцию `security definer`, и это
-- верно по существу: задачу передачи порождает закрытие этапа ЦЕХОМ, а вставка
-- в `erp_warehouse_tasks` гейтится `warehouse.manage`/`order.manage`, которых
-- у рабочего нет. С `invoker` цех получал бы 42501 на закрытии собственного
-- этапа — правка сломала бы производство ради складского учёта.
--
-- Рядом там же встала пара строк по шаблону правила проекта:
--     revoke execute … from public, anon;
--     grant  execute … to authenticated;
--
-- Шаблон верен для функций, СТОЯЩИХ В ПРЕДИКАТАХ RLS (`is_admin`,
-- `erp_has_permission`, `erp_is_member`): выражения политик исполняются от лица
-- вызывающего, и отзыв у `authenticated` сломал бы сами политики. Эта функция
-- в предикатах не стоит — её зовут два триггера. Грант оказался не нужен,
-- а дыру открыл: `security definer` без внутренней проверки прав, вызываемая
-- любым вошедшим через `/rest/v1/rpc/erp_ensure_subcontract_send`.
--
-- ПРОВЕРЕНО НА ЖИВОЙ БАЗЕ 04.09 по шаблону `docs/erp/permission-check.sql`
-- (временный сотрудник, `set local role authenticated`, откат исключением):
--
--     РОЛЬ=worker | склад/заказ права=[НЕТ]
--     прямая вставка задачи склада      → отказ 42501
--     через erp_ensure_subcontract_send → ЗАДАЧА СОЗДАНА
--
-- То есть гейт вставки работает, и обходится по имени функции.
--
-- ПОЧЕМУ ОТЗЫВ, А НЕ ГЕЙТ ВНУТРИ ФУНКЦИИ. Внутренняя проверка
-- `erp_has_permission` закрыла бы REST и вместе с ним цеховой путь — ровно тот
-- отказ, ради предотвращения которого функция и сделана `definer`. Оба
-- вызывающих триггера (`erp_warehouse_task_derive`,
-- `erp_subcontract_send_on_insert`) сами `security definer` с владельцем
-- `postgres`: при их вызове `current_user` — владелец функции, и отзыв
-- у `authenticated` их не касается. Сверено с `pg_proc.prosecdef` на боевой
-- базе, оба вернули `true`.
--
-- `public, anon` повторяются намеренно: право приходит от PUBLIC (`=X/postgres`
-- в ACL), и отзыв только у роли его не снимает — правило проекта, на котором
-- уже ловились. Обратного `grant … to authenticated` здесь НЕТ, и это вся суть
-- правки: единственные законные вызывающие — триггеры, а им грант не нужен.

revoke execute on function public.erp_ensure_subcontract_send(uuid)
  from public, anon, authenticated;

comment on function public.erp_ensure_subcontract_send(uuid) is
  'Заводит задачу склада «Передача подрядчику» для готового подрядного этапа (п. 3). Единственный писатель этой задачи; зовут её оба триггера, оба security definer. EXECUTE отозван у authenticated 04.09.2026: через REST функция обходила гейт warehouse.manage/order.manage, а триггерам грант не нужен.';
