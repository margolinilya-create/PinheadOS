-- Разработку образцов гейтит право, заведённое ровно для неё.
--
-- Волна 3.6 завела `experimental.manage` и провела его до вставки этапа образца
-- (`erp_experimental_send_to_dept`), но САМИ таблицы разработки остались
-- открытыми любому участнику ERP: `erp_experimental` и `erp_experimental_ops`
-- принимали INSERT и UPDATE от кого угодно. То есть право существовало,
-- а половину своей области не закрывало.
--
-- Это второй вид декоративности: не «право ничего не выключает» (такое ловит
-- permissionsCoverage), а «право выключает одну дверь из трёх». Снаружи
-- выглядит работающим — до первого вопроса, кто переставил фазу образца.
--
-- Кто получает доступ: `director` и `technologist` — ровно те, у кого право
-- стоит в матрице. `production_head` и `dispatcher` его намеренно не имеют:
-- разработка не производственный поток, образцы ведёт технолог.
--
-- Клиент правится тем же коммитом: экран разработки не гейтился, и страж
-- в одиночку дал бы «кнопка есть, действие падает». Без права экран остаётся
-- на чтение — видеть, что делается с образцом, полезно и цеху, и менеджеру.
--
-- DELETE остаётся у `is_admin()`: удаление разработки стирает историю.

drop policy if exists erp_experimental_insert on public.erp_experimental;
create policy erp_experimental_insert on public.erp_experimental
  for insert to authenticated
  with check (public.erp_has_permission('experimental.manage'));

drop policy if exists erp_experimental_update on public.erp_experimental;
create policy erp_experimental_update on public.erp_experimental
  for update to authenticated
  using (public.erp_has_permission('experimental.manage'))
  with check (public.erp_has_permission('experimental.manage'));

drop policy if exists erp_experimental_ops_insert on public.erp_experimental_ops;
create policy erp_experimental_ops_insert on public.erp_experimental_ops
  for insert to authenticated
  with check (public.erp_has_permission('experimental.manage'));

drop policy if exists erp_experimental_ops_update on public.erp_experimental_ops;
create policy erp_experimental_ops_update on public.erp_experimental_ops
  for update to authenticated
  using (public.erp_has_permission('experimental.manage'))
  with check (public.erp_has_permission('experimental.manage'));

comment on table public.erp_experimental is
  'Разработка образцов. Ведение — под experimental.manage (director, technologist). Производственные фазы образца живут в erp_item_stages с origin=experimental.';
