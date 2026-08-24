-- Файл у задачи разработки. Правка заказчика 24.08, п. 4.4.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Для задачи достаточно следующих полей: название,
-- уточнение или комментарий, ответственный, срок, статус и ФАЙЛ ПРИ
-- НЕОБХОДИМОСТИ». Всё остальное из перечня у задачи уже есть — не хватало
-- только файла.
--
-- ПРИВЯЗКА К ЗАДАЧЕ, А НЕ К РАЗРАБОТКЕ. Задач у разработки десяток, и файл
-- «фото пробного нанесения» относится к одной из них: сложенные в общую кучу
-- вложения разработки перестали бы отвечать на вопрос «что здесь про эту
-- работу». `experimental_id` при этом заполняется тоже — по нему работают
-- политики и уборка файлов при удалении разработки.
--
-- ВИД ВЛОЖЕНИЯ ЗАВОДИТСЯ В ДВУХ МЕСТАХ ОДНИМ КОММИТОМ: здесь, в CHECK,
-- и в `ErpAttachmentKind` на клиенте. 22.08 три вида завели только в типе —
-- типы сходились сами с собой, весь unit-набор был зелёным, а первая же
-- попытка приложить файл отвечала 23514 и роняла создание заказа целиком.
-- Сторожит `erp/utils/attachmentKinds.test.ts`.

alter table public.erp_order_attachments
  add column if not exists task_id uuid
    references public.erp_experimental_tasks(id) on delete cascade;

create index if not exists erp_att_task_idx
  on public.erp_order_attachments (task_id)
  where task_id is not null;

comment on column public.erp_order_attachments.task_id is
  'Задача разработки, к которой приложен файл (п. 4.4). Заполняется вместе с experimental_id: по нему работают политики и уборка.';

alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;
alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase',
                  'purchase_list', 'subcontract',
                  'print', 'label', 'note',
                  'dev_pattern', 'dev_passport', 'dev_photo', 'dev_task'));

-- ── Снять файл может тот, кто ведёт разработку ───────────────────────────────
--
-- Расширяем существующую политику видов `dev_*`, а не заводим вторую: у файла
-- задачи ровно та же судьба, что у файлов пакета — его меняют по ходу работы,
-- и «поменять через администратора» означает, что менять не будут вовсе.
drop policy if exists erp_att_delete_dev on public.erp_order_attachments;
create policy erp_att_delete_dev on public.erp_order_attachments
  for delete to authenticated
  using (
    experimental_id is not null
    and kind in ('dev_pattern', 'dev_passport', 'dev_photo', 'dev_task')
    and public.erp_has_permission('experimental.manage')
  );
