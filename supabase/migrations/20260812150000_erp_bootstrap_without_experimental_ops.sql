-- ПОЧИНКА: `erp_bootstrap()` ссылалась на удалённую `erp_experimental_ops`.
--
-- Уборка старой модели ЭКС (20260812140000) сняла таблицу, но функция пакета
-- оболочки продолжала подтягивать её эмбедом `ops`. Пакет собирается при КАЖДОЙ
-- загрузке страницы, поэтому весь раздел «Производство» отвечал 42P01 — меню,
-- права и справочники не приезжали вовсе.
--
-- ПОЧЕМУ ЭТОГО НЕ ЗАМЕТИЛИ РАНЬШЕ. Удаляемую таблицу искали по клиентскому
-- коду: `grep` нашёл слайс, тип и подписку realtime — и всё выглядело убранным.
-- Тела функций БД живут в базе, а не в исходниках: последняя миграция, где
-- определён `erp_bootstrap`, лежит в репозитории с 03.08 и упоминания
-- `erp_experimental_ops` в изменённых файлах не было.
--
-- Ловится это одним запросом (`pg_get_functiondef` по всем функциям схемы),
-- и он теперь часть правила: удаляя объект, ищи его в ТЕЛАХ функций.
--
-- Заодно пакет отдаёт задачи разработки вместо операций: бейдж меню считает
-- активные по `outcome`, а экран грузит задачи своим запросом — держать рядом
-- половину данных незачем.

create or replace function public.erp_bootstrap()
returns jsonb
language sql
stable
security invoker
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
          'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order)
                             from erp_experimental_tasks t where t.experimental_id = e.id),
                            '[]'::jsonb),
          'order', (select jsonb_build_object('title', o.title, 'bitrix_id', o.bitrix_id)
                    from erp_orders o where o.id = e.order_id))
        order by e.created_at desc)
      from erp_experimental e
    ), '[]'::jsonb),
    'my_employee', (
      select jsonb_build_object('department_id', em.department_id, 'role', em.role)
      from erp_employees em
      where em.profile_id = (select auth.uid()) and em.active
      limit 1
    )
  );
$$;

grant execute on function public.erp_bootstrap() to authenticated;

comment on function public.erp_bootstrap() is
  'Пакет оболочки ERP одним запросом: цеха, права, справочники, подряд, разработки с задачами и цех вызывающего. SECURITY INVOKER — «одним запросом» не значит «мимо RLS».';
