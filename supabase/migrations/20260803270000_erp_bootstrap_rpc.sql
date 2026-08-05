-- Две функции против болтливости клиента.
--
-- Замер 03.08.2026: загрузка ERP и открытие карточки заказа = 11 REST-запросов
-- плюс два WebSocket-канала. Семь из одиннадцати уходят при монтировании
-- оболочки (`ErpLayout`), и шесть из этих семи — мелкие справочные выборки
-- ради бейджей в меню. Каждая едет отдельным round-trip, и на цеховом Wi-Fi
-- это заметно сильнее, чем их суммарный размер.
--
-- Здесь ровно две функции, отдающие готовые «пакеты страницы»:
--   · erp_bootstrap()          — 6 запросов оболочки в один
--   · erp_order_detail(uuid)   — 3 запроса-спутника карточки в один
-- Списочный запрос заказов и loadOne остаются на PostgREST: у них свои
-- фильтры и вложенные эмбеды, ради которых PostgREST и нужен.
--
-- SECURITY INVOKER (по умолчанию): функции читают те же таблицы от лица
-- вызывающего, и RLS работает как раньше. Права НЕ обходятся — это важно:
-- «одним запросом» не должно означать «мимо политик».

create or replace function public.erp_bootstrap()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.sort_order)
      from erp_departments d
    ), '[]'::jsonb),

    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', p.role, 'permission', p.permission, 'allowed', p.allowed))
      from erp_role_permissions p
    ), '[]'::jsonb),

    'dictionaries', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.kind, x.sort_order)
      from erp_dictionaries x
    ), '[]'::jsonb),

    -- Подряд и эксперим. цех нужны бейджам меню на ЛЮБОМ экране, поэтому
    -- едут в бутстрапе, а не лениво по заходу в свой раздел.
    'subcontracting', coalesce((
      select jsonb_agg(
        to_jsonb(s) || jsonb_build_object(
          'order', (select jsonb_build_object('title', o.title, 'bitrix_id', o.bitrix_id)
                    from erp_orders o where o.id = s.order_id))
        order by s.created_at desc)
      from erp_subcontracting s
    ), '[]'::jsonb),

    'experimental', coalesce((
      select jsonb_agg(
        to_jsonb(e) || jsonb_build_object(
          'ops', coalesce((select jsonb_agg(to_jsonb(op) order by op.created_at)
                           from erp_experimental_ops op where op.experimental_id = e.id),
                          '[]'::jsonb),
          'order', (select jsonb_build_object('title', o.title, 'bitrix_id', o.bitrix_id)
                    from erp_orders o where o.id = e.order_id))
        order by e.created_at desc)
      from erp_experimental e
    ), '[]'::jsonb),

    -- Цех и роль вызывающего: раньше отдельным запросом по profile_id,
    -- который клиент брал из своей сессии. auth.uid() надёжнее — подменить
    -- чужой profile_id в запросе было нечем помешать.
    'my_employee', (
      select jsonb_build_object('department_id', em.department_id, 'role', em.role)
      from erp_employees em
      where em.profile_id = (select auth.uid()) and em.active
      limit 1
    )
  );
$$;

comment on function public.erp_bootstrap() is
  'Пакет данных оболочки ERP одним запросом: цеха, матрица прав, справочники, подряд, эксперим. цех, цех вызывающего.';

-- Спутники карточки заказа: история этапов, лог правок, комментарии.
-- Лимиты те же, что были на клиенте (100/100/200) — менять их здесь значило бы
-- тихо поменять поведение экрана заодно с числом запросов.
create or replace function public.erp_order_detail(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (select * from erp_stage_events
            where order_id = p_order_id
            order by created_at desc limit 100) e
    ), '[]'::jsonb),

    'audit', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.changed_at desc)
      from (select * from erp_order_audit
            where order_id = p_order_id
            order by changed_at desc limit 100) a
    ), '[]'::jsonb),

    'comments', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from (select * from erp_order_comments
            where order_id = p_order_id
            order by created_at limit 200) c
    ), '[]'::jsonb)
  );
$$;

comment on function public.erp_order_detail(uuid) is
  'История этапов, лог правок и комментарии заказа одним запросом (лимиты 100/100/200, как на клиенте).';

-- Явный grant: без него PostgREST не покажет функцию в /rest/v1/rpc.
-- anon не даём — оба пакета имеют смысл только для вошедшего сотрудника.
grant execute on function public.erp_bootstrap() to authenticated;
grant execute on function public.erp_order_detail(uuid) to authenticated;
revoke execute on function public.erp_bootstrap() from anon, public;
revoke execute on function public.erp_order_detail(uuid) from anon, public;
