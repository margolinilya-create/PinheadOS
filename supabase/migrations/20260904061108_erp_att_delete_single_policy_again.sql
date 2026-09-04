-- Снова ОДНА DELETE-политика на `erp_order_attachments`.
--
-- ЧТО СЛУЧИЛОСЬ. 21.08 миграция `20260821100000_erp_att_delete_single_policy`
-- намеренно свела три пермиссивные политики в одну — с объяснением, что
-- Postgres исполняет их ВСЕ на каждую удаляемую строку (адвизор
-- `multiple_permissive_policies`, правило записано в CLAUDE.md).
--
-- 24.08 миграция `20260824185639_erp_dev_task_files` добавляла вид вложения
-- `dev_task` и СОЗДАЛА `erp_att_delete_dev` заново — вместо того чтобы дописать
-- вид в сводную политику. Решение трёхдневной давности откатилось молча:
-- ничего не сломалось, права остались верными (пермиссивные политики
-- объединяются через OR), адвизор снова горит.
--
-- ЧЕМ ЭТО ПЛОХО ПО СУЩЕСТВУ, а не только по адвизору: предикаты УЖЕ разошлись.
-- Снято с боевой базы 04.09:
--
--   erp_att_delete_dev            … kind in (dev_pattern, dev_passport,
--                                            dev_photo, dev_task)
--   erp_order_attachments_delete  … kind in (dev_pattern, dev_passport,
--                                            dev_photo)          ← без dev_task
--
-- Это две копии одного решения, и они уже отвечают по-разному. Попытка
-- ужесточить удаление dev-файлов правкой сводной политики НИЧЕГО не ужесточит:
-- воскресшая продолжит разрешать. Тот самый случай «две копии правила
-- разошлись бы, обе работая».
--
-- ПРАВА НЕ МЕНЯЮТСЯ: ниже ровно ОБЪЕДИНЕНИЕ двух действующих предикатов,
-- то есть то, что разрешено сегодня. Единственная содержательная разница
-- со сводной политикой 21.08 — добавлен вид `dev_task`, который до сих пор
-- держался отдельной политикой.
--
-- Политика автора (`erp_att_delete_own`) не трогается — по той же причине,
-- что и 21.08: она про роль, которая убирает СВОЙ неприкреплённый файл,
-- и объединять её с этими значило бы смешать два разных решения.

drop policy if exists erp_att_delete_dev on public.erp_order_attachments;
drop policy if exists erp_att_delete_stage on public.erp_order_attachments;
drop policy if exists erp_order_attachments_delete on public.erp_order_attachments;

create policy erp_order_attachments_delete on public.erp_order_attachments
  for delete to authenticated
  using (
    public.is_admin()
    or (
      experimental_id is not null
      and kind = any (array['dev_pattern', 'dev_passport', 'dev_photo', 'dev_task'])
      and public.erp_has_permission('experimental.manage')
    )
    or (
      stage_id is not null
      and kind = 'subcontract'
      and public.erp_has_permission('order.manage')
    )
  );

comment on policy erp_order_attachments_delete on public.erp_order_attachments is
  'Удаление вложения: админ; файлы разработки (включая dev_task) — под experimental.manage; ТЗ подрядного этапа — под order.manage. ОДНА политика на команду: несколько пермиссивных исполнялись бы все на каждую строку.';
