-- Подряд гейтится матрицей прав, а не ролью профиля.
--
-- ЧТО БЫЛО. RLS таблицы `erp_subcontracting` стояла на `erp_is_manager()`:
--
--   select exists (select 1 from public.profiles
--                   where id = auth.uid() and active and approved
--                     and role in ('admin','director'));
--
-- Функция ничего не знает про `erp_employees.role` и про матрицу прав. Это
-- ровно тот класс, который в проекте уже чинили у `erp_can_manage_tz()`:
-- диспетчер и руководитель производства держат `order.manage`, видят экран
-- подряда со всеми кнопками — и получают 42501 на каждое действие.
--
-- Расхождение внутри одной функции было и вовсе неприличным: журнал
-- перемещений `erp_subcontract_moves` (волна 3.5) гейтится `order.manage`,
-- а карточка, к которой он относится, — ролью профиля. Половина операции
-- разрешена одному кругу лиц, половина другому.
--
-- ПОЧЕМУ `order.manage`, а не своё право. Подряд — решение по маршруту заказа
-- («эту операцию делаем не у себя»), тем же правом гейтятся остальные решения
-- такого рода. Отдельное право пришлось бы раздать ровно тем же ролям, то есть
-- оно ничего не выключало бы — а декоративных прав в матрице быть не должно.
--
-- КЛИЕНТ ПРАВИТСЯ ТЕМ ЖЕ КОММИТОМ. Экран подряда не гейтился вовсе; страж
-- в одиночку дал бы запрещённое «кнопка есть, действие падает» — только теперь
-- у всех, кроме admin/director. Правило проекта: сперва проверь, закрыта ли
-- дыра в интерфейсе.
--
-- DELETE остаётся у `is_admin()`: удаление строки подряда — не рядовое
-- решение по маршруту, а стирание истории, и расширять его повода нет.

drop policy if exists erp_subcontracting_insert on public.erp_subcontracting;
create policy erp_subcontracting_insert on public.erp_subcontracting
  for insert to authenticated
  with check (public.erp_has_permission('order.manage'));

drop policy if exists erp_subcontracting_update on public.erp_subcontracting;
create policy erp_subcontracting_update on public.erp_subcontracting
  for update to authenticated
  using (public.erp_has_permission('order.manage'))
  with check (public.erp_has_permission('order.manage'));

comment on table public.erp_subcontracting is
  'Операции у внешних подрядчиков. Ведение — под order.manage (решение по маршруту заказа), тем же правом, что и журнал erp_subcontract_moves. Двигает операцию колонка phase; status — устаревшее зеркало.';
