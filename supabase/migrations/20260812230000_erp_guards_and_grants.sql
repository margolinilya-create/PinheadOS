-- Волна 4: таблицы без стража, лишние гранты, мёртвая функция, политика бакета.
--
-- Все находки подтверждены на боевой базе чтением pg_policies/pg_proc и
-- перепроверены независимо. Опровергнутое сюда НЕ вошло: потолок qty_rework
-- (решение записано в 20260810310000) и защита depends_on (живых нарушений
-- нет, а заявленное последствие инвертировано — висячая ссылка даёт fail-open,
-- а не вечное ожидание).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. erp_warehouse_ops: журнал складских операций пишет ЛЮБОЙ участник
--
-- INSERT стоял на erp_is_member() — то есть на «есть профиль, активен,
-- подтверждён». Соседняя erp_warehouse_tasks с сессии 29 требует
-- warehouse.manage, а журнал её операций остался открытым, и триггера-стража
-- у таблицы нет.
--
-- Право выбрано ПО ИНТЕРФЕЙСУ, а не по смыслу названия: экран склада
-- открывается по `warehouse.manage` ИЛИ `order.manage` (utils/screenAccess.ts:25),
-- и logWarehouseOp зовётся именно оттуда. Поставить только warehouse.manage
-- значило бы сделать стража строже кнопки — менеджер заказа видит экран
-- и получил бы 42501 на действии, которое интерфейс ему разрешает.
drop policy if exists erp_warehouse_ops_insert on public.erp_warehouse_ops;
create policy erp_warehouse_ops_insert on public.erp_warehouse_ops
  for insert to authenticated
  with check (
    public.erp_has_permission('warehouse.manage')
    or public.erp_has_permission('order.manage')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. erp_item_prints: нанесения ТЗ любого заказа правит ЛЮБОЙ участник
--
-- INSERT/UPDATE/DELETE стояли на erp_is_member(), стража нет. Нанесения —
-- часть технического задания позиции: зоны, pantone, размеры. Соседняя
-- erp_order_items гейтится триггером erp_order_item_guard, а эта таблица —
-- ничем.
--
-- Право: order.manage — то же, что гейтит создание и правку заказа
-- (screens/OrdersScreen.jsx:128). Проверено, что это не сломает создание
-- заказа: erp_create_order объявлена SECURITY INVOKER, то есть вставка
-- нанесений идёт от лица вызывающего, а вызывать её может только тот, кому
-- интерфейс показал кнопку «Новый заказ», — и это ровно order.manage.
drop policy if exists erp_item_prints_insert on public.erp_item_prints;
create policy erp_item_prints_insert on public.erp_item_prints
  for insert to authenticated
  with check (public.erp_has_permission('order.manage'));

drop policy if exists erp_item_prints_update on public.erp_item_prints;
create policy erp_item_prints_update on public.erp_item_prints
  for update to authenticated
  using (public.erp_has_permission('order.manage'))
  with check (public.erp_has_permission('order.manage'));

drop policy if exists erp_item_prints_delete on public.erp_item_prints;
create policy erp_item_prints_delete on public.erp_item_prints
  for delete to authenticated
  using (public.erp_has_permission('order.manage'));

-- Чтение не трогаем: нанесения обязан видеть цех, который их выполняет.

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Три функции исполняемы ролью anon через грант от PUBLIC
--
-- В proacl у них ведущий `=X/postgres` — это PUBLIC, и anon наследует право
-- оттуда. Ровно случай из CLAUDE.md: «revoke … from anon сам по себе НЕ
-- РАБОТАЕТ, отзывать нужно from public, anon и следом явно grant … to
-- authenticated — иначе отберёте доступ у самих политик».
--
-- Дыры сегодня нет: все три SECURITY INVOKER, и erp_create_order, вызванная
-- анонимом, упрётся в RLS и ничего не создаст. Но публично выставленная
-- write-RPC на анонимном ключе — постоянный шум адвизора, за которым теряется
-- настоящее.
revoke execute on function public.erp_create_order(jsonb) from public, anon;
grant  execute on function public.erp_create_order(jsonb) to authenticated;

-- Сигнатура сверена с pg_proc: параметр `date`, а не `uuid`. Написанная
-- по памяти сигнатура уронила бы миграцию на «function does not exist» —
-- ровно тот класс ошибки, ради которого в проекте заведён rpcContract.test.ts.
revoke execute on function public.erp_default_queue_position(date) from public, anon;
grant  execute on function public.erp_default_queue_position(date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. erp_can_manage_tz() — мёртвая функция, притворяющаяся живым гейтом
--
-- Ни одна политика (ни в public, ни в storage) её не использует: гейт ТЗ
-- переведён на erp_has_permission('tz.manage'). Но сама функция осталась,
-- исполняема анонимом, единственная в семействе БЕЗ security definer,
-- и по-прежнему считает права по profiles.role in (admin, director, rop,
-- manager) — то есть отвечает старым, разошедшимся с матрицей ответом.
-- Второй источник правды по правам, который однажды кто-нибудь позовёт.
drop function if exists public.erp_can_manage_tz();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. sku-photos без SELECT-политики
--
-- У бакета не было ни одной политики на чтение, тогда как у соседнего
-- erp-attachments она есть. Правило: «У бакета обязана быть SELECT-политика,
-- даже когда он публичный: публичная раздача идёт мимо RLS, а клиентские
-- upsert, remove и list — через неё». Без неё list() по бакету возвращает
-- пусто, а upsert существующего файла упирается.
drop policy if exists sku_photos_read on storage.objects;
create policy sku_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'sku-photos');

-- ─────────────────────────────────────────────────────────────────────────
-- 6. is_admin(): волатильность и обёртка auth.uid()
--
-- ЧЕГО ЭТА ПРАВКА НЕ ДЕЛАЕТ. Она НЕ ускоряет RLS. Первоначальный разбор
-- утверждал, что VOLATILE мешает вынести вызов в One-Time Filter и потому
-- profiles читается на каждую строку в 35 политиках. Это неверно, проверено
-- EXPLAIN'ом на этой же базе: предикат, пришедший из securityQuals,
-- вычисляется построчно при ЛЮБОЙ волатильности — STABLE-функция
-- erp_is_member() в том же RLS ведёт себя точно так же. Повторные вызовы
-- убирает обёртка МЕСТА ВЫЗОВА в политике — (select is_admin()), — а это
-- 35 политик и отдельная работа, не окупающаяся на нынешних объёмах.
--
-- ЗАЧЕМ ТОГДА. Две причины, обе про корректность:
--   1. STABLE здесь семантически точнее. Функция только читает profiles
--      и в пределах одного оператора обязана отвечать одинаково. С VOLATILE
--      Postgres вправе перечитывать её с обновлённым снимком, и UPDATE
--      по profiles, меняющий роль самого вызывающего, мог бы проверяться
--      по-разному для разных строк ОДНОГО оператора. Ровно так объявлены
--      erp_is_member() и erp_is_manager(), читающие ту же таблицу.
--      Расхождение было опечаткой, а не решением: ни baseline, ни правка
--      soft-delete volatility не проставили, и функция получила дефолт.
--   2. VOLATILE закрывает будущее: такую функцию нельзя использовать
--      в индексе, и планировщик не вправе переупорядочивать её относительно
--      других предикатов.
--
-- Текст взят из ПОДЛИННОГО последнего определения
-- (20260729100000_is_admin_respects_soft_delete.sql), а не написан по памяти.
-- Изменены ровно две вещи: добавлено `stable`, auth.uid() обёрнут в (select …).
-- Проверка soft-delete (active/approved) сохранена дословно — она и есть
-- смысл той миграции.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and active is true
      and approved is true
  );
$$;
