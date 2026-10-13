-- Одна DELETE-политика вместо трёх (правило проекта, найдено адвизором).
--
-- ЧТО СЛУЧИЛОСЬ. Волна ЭКС добавила `erp_att_delete_dev` (файлы финального
-- пакета), правки подряда — `erp_att_delete_stage` (ТЗ подрядного этапа),
-- и обе встали РЯДОМ с `erp_order_attachments_delete` (админ). Три
-- пермиссивные политики на одну команду означают, что Postgres исполняет
-- их ВСЕ на каждую удаляемую строку — тот самый `multiple_permissive_policies`,
-- про который в CLAUDE.md написано прямо.
--
-- ПРАВА НЕ МЕНЯЮТСЯ НИ НА ЙОТУ: три предиката соединены через OR ровно
-- в том виде, в каком они действуют сейчас (снято `pg_policies.qual`
-- с боевой базы). Это перепись формы, а не решения:
--   · админ — по-прежнему всё;
--   · `experimental.manage` — только виды `dev_*` и только у файла разработки;
--   · `order.manage` — только вид `subcontract` и только у файла этапа.
--
-- Политика автора (`erp_att_delete_own`) не трогается: она для роли, которая
-- убирает СВОЙ неприкреплённый файл, и объединять её с этими значило бы
-- смешать два разных решения. Если адвизор укажет и на неё — это отдельная
-- правка с отдельной проверкой.

drop policy if exists erp_att_delete_dev on public.erp_order_attachments;
drop policy if exists erp_att_delete_stage on public.erp_order_attachments;
drop policy if exists erp_order_attachments_delete on public.erp_order_attachments;

create policy erp_order_attachments_delete on public.erp_order_attachments
  for delete to authenticated
  using (
    public.is_admin()
    or (
      experimental_id is not null
      and kind = any (array['dev_pattern', 'dev_passport', 'dev_photo'])
      and public.erp_has_permission('experimental.manage')
    )
    or (
      stage_id is not null
      and kind = 'subcontract'
      and public.erp_has_permission('order.manage')
    )
  );

comment on policy erp_order_attachments_delete on public.erp_order_attachments is
  'Удаление вложения: админ; файлы финального пакета — под experimental.manage; ТЗ подрядного этапа — под order.manage. ОДНА политика на команду: три пермиссивные исполнялись бы все на каждую строку.';
