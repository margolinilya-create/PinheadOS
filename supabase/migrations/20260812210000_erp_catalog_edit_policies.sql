-- Справочники и цеха: политика спрашивает ПРАВО МАТРИЦЫ, а не роль профиля.
--
-- Найдено прогоном 12.08. Гейт интерфейса и политика базы стояли на разных
-- проверках, и расхождение было молчаливым:
--
--   вкладка «Цеха»        — needs: 'catalog.edit'   ↔  is_admin()
--   вкладка «Справочники» — needs: 'catalog.edit'   ↔  is_admin()
--
-- `is_admin()` — это `profiles.role = 'admin'`, а `catalog.edit` есть у erp-роли
-- `director` (к ней приводятся профили admin И director) и у `production_head`
-- по решению заказчика. То есть директор видел обе вкладки, редактировал их —
-- и ничего не сохранялось. Молча: RLS запрещает UPDATE через `USING`, это
-- «0 строк», а не ошибка. При этом соседняя кнопка «Добавить» падала громко
-- (её ловит `WITH CHECK`), и человек делал вывод «добавление сломано,
-- а правка работает».
--
-- Правило раздела: гейт, не спрашивающий матрицу, — декоративное право.
-- `catalog.edit` был декоративен вдвойне: ни одна политика на него не смотрела.
--
-- Что это меняет по доступу: писать в справочники и цеха смогут держатели
-- `catalog.edit` — сегодня это `director` и `production_head`. Ровно те, кому
-- интерфейс уже показывает эти вкладки с активными полями. Право снимается
-- галочкой в матрице, и теперь снятие действительно закрывает запись.
--
-- `erp_employees` НАМЕРЕННО не трогаем: управление учётными записями и ролями
-- остаётся под `is_admin()`. Там расхождение закрыто с другой стороны —
-- вкладка «Пользователи» в интерфейсе гейтится `access.isAdmin` тем же
-- коммитом. Отдельного права матрицы под это заводить не стали: это решение
-- о составе прав, а не о починке дефекта.

-- ── Справочники ──────────────────────────────────────────────────────────
drop policy if exists erp_dictionaries_insert on public.erp_dictionaries;
create policy erp_dictionaries_insert on public.erp_dictionaries
  for insert to authenticated
  with check (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_dictionaries_update on public.erp_dictionaries;
create policy erp_dictionaries_update on public.erp_dictionaries
  for update to authenticated
  using (public.erp_has_permission('catalog.edit'))
  with check (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_dictionaries_delete on public.erp_dictionaries;
create policy erp_dictionaries_delete on public.erp_dictionaries
  for delete to authenticated
  using (public.erp_has_permission('catalog.edit'));

-- ── Цеха ─────────────────────────────────────────────────────────────────
-- Через эту же таблицу правится `gate_material_kinds` — материальный гейт
-- участка — и `result_fields`. Обе настройки принадлежат производству,
-- а не администратору учётных записей.
drop policy if exists erp_departments_insert on public.erp_departments;
create policy erp_departments_insert on public.erp_departments
  for insert to authenticated
  with check (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_departments_update on public.erp_departments;
create policy erp_departments_update on public.erp_departments
  for update to authenticated
  using (public.erp_has_permission('catalog.edit'))
  with check (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_departments_delete on public.erp_departments;
create policy erp_departments_delete on public.erp_departments
  for delete to authenticated
  using (public.erp_has_permission('catalog.edit'));

comment on table public.erp_dictionaries is
  'Справочники админки. Запись — под правом матрицы catalog.edit (не is_admin()): им же гейтится вкладка в интерфейсе, иначе право декоративно, а правка молча не сохраняется.';

comment on table public.erp_departments is
  'Участки производства. Запись — под правом матрицы catalog.edit: через эту таблицу правятся материальный гейт (gate_material_kinds) и схема отчёта участка (result_fields), это решения производства.';
