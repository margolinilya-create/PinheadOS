-- ПАПКА «ФАЙЛЫ ПРОИЗВОДСТВА»: ВИД ВЛОЖЕНИЯ, ПРАВО, РОЛЬ ДИЗАЙНЕРА
-- (правка заказчика 14.09, п. 3).
--
-- Документ: «внутри сделки создать отдельную папку „Файлы производства"
-- для рабочих файлов… Дизайнеры загружают туда файлы для DTF, шелкографии
-- и других нанесений… Сделать возможность удалять и заменять файлы внутри
-- карточки „файлы" и перемещать между папок… дизайнеры могут поддерживать
-- эту папку без обращения к администратору».
--
-- ПОЧЕМУ ЭТО ТРИ ВЕЩИ СРАЗУ, А НЕ ТОЛЬКО ВИД ВЛОЖЕНИЯ. Проверка на бое 14.09:
-- удалить вложение сегодня может ТОЛЬКО админ (кроме файлов разработки
-- и подрядного этапа), а UPDATE-политики у таблицы нет вовсе — то есть
-- «перемещать между папок» невозможно в принципе, и «без обращения
-- к администратору» тоже. Роли «дизайнер» в ERP нет: два профиля-дизайнера
-- резолвятся в `worker`, и выдать право этой роли значило бы выдать его всем
-- рабочим цеха.

-- ── 1. Вид вложения ───────────────────────────────────────────────────────
-- Заводится В ДВУХ МЕСТАХ ОДНИМ КОММИТОМ (правило проекта): CHECK и тип
-- `ErpAttachmentKind`. Виды `print`/`label`/`note` однажды завели только
-- в типе — весь unit-набор был зелёным, а первая же попытка приложить макет
-- отвечала 23514 и роняла СОЗДАНИЕ ЗАКАЗА целиком.
alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;

alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase',
                  'purchase_list', 'subcontract',
                  'print', 'label', 'note',
                  'dev_pattern', 'dev_passport', 'dev_photo', 'dev_task',
                  'stage_result',
                  -- Рабочий файл производства: цветопробы, раскладки,
                  -- исходники. У `print`/`label` есть адресат (нанесение,
                  -- бирка) и они видны цеху в задании; у этого адресата нет.
                  'production'));

-- ── 2. Право ──────────────────────────────────────────────────────────────
-- Отдельное от `order.manage`: тот про заказ целиком (срок, менеджер, состав
-- позиций), и выдавать его дизайнеру значит отдать ему заказ.
insert into public.erp_role_permissions (role, permission, allowed) values
  ('director',        'files.manage', true),
  ('production_head', 'files.manage', true),
  ('dispatcher',      'files.manage', true),
  ('manager',         'files.manage', true),
  ('designer',        'files.manage', true),
  ('technologist',    'files.manage', false),
  ('foreman',         'files.manage', false),
  ('worker',          'files.manage', false),
  ('dtf',             'files.manage', false),
  ('silkscreen',      'files.manage', false),
  ('embroidery',      'files.manage', false),
  ('purchaser',       'files.manage', false),
  ('storekeeper',     'files.manage', false),
  ('hr',              'files.manage', false),
  ('pending',         'files.manage', false)
on conflict (role, permission) do nothing;

-- ── 3. Роль дизайнера ─────────────────────────────────────────────────────
-- В `DEPT_BOUND_ROLES` она НЕ входит (клиентская половина — utils/permissions):
-- дизайнер не принадлежит участку, и привязка заперла бы ему работу целиком.
alter table public.erp_employees
  drop constraint if exists erp_employees_role_check;

alter table public.erp_employees
  add constraint erp_employees_role_check
  check (role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head', 'technologist',
    'dtf', 'silkscreen', 'embroidery', 'designer', 'pending'
  ));

alter table public.erp_invites
  drop constraint if exists erp_invites_employee_role_check;

alter table public.erp_invites
  add constraint erp_invites_employee_role_check
  check (employee_role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head', 'technologist',
    'dtf', 'silkscreen', 'embroidery', 'designer', 'pending'
  ));

-- ── 4. Удаление вложения ──────────────────────────────────────────────────
-- ОДНА политика на команду (правило проекта: несколько пермиссивных
-- исполнялись бы все на каждую строку). Ниже — действующий предикат плюс
-- свободные файлы заказа под `files.manage`.
--
-- Под право попадают ТОЛЬКО свободные виды (`attachment`, `production`)
-- и макеты нанесений с бирками (`print`, `label`) — то, что дизайнер и ведёт.
-- Лист закупки, ТЗ подрядчику, результат этапа и файлы разработки остаются
-- там, где были: у каждого свой хозяин и своё право.
-- `erp_att_delete_dev` снимается ПОВТОРНО, хотя её нет с 04.09. Это не
-- перестраховка: миграция 20260824185639 однажды воскресила её ради нового
-- вида файла, и предикаты разошлись — ужесточение сводной политики не
-- ужесточало ничего, потому что вторая продолжала разрешать. Сторож
-- `attachmentKinds.test.ts` требует этот drop от КАЖДОЙ миграции, трогающей
-- удаление вложений, и требует справедливо.
drop policy if exists erp_att_delete_dev on public.erp_order_attachments;
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
    or (
      kind = any (array['attachment', 'production', 'print', 'label'])
      and public.erp_has_permission('files.manage')
    )
  );

comment on policy erp_order_attachments_delete on public.erp_order_attachments is
  'Удаление вложения: админ; файлы разработки — под experimental.manage; ТЗ подрядного этапа — под order.manage; рабочие файлы заказа и макеты — под files.manage (правка 14.09, п. 3).';

-- ── 5. Перемещение между папками ──────────────────────────────────────────
-- UPDATE-политики у таблицы не было вовсе, и это осознанно: «замена файла»
-- в проекте выражается новой строкой, а не правкой пути (на объект уже могут
-- быть ссылки). Перемещение между папками — другое: меняется ТОЛЬКО `kind`.
--
-- Разделение по колонкам делает СТРАЖ, а не политика: RLS работает на уровне
-- строки и «какие поля изменились» не видит. Без стража это право на правку
-- любой колонки — включая `order_id` и `file_path`, то есть на подмену файла
-- в чужом заказе.
create policy erp_order_attachments_update on public.erp_order_attachments
  for update to authenticated
  using (public.erp_has_permission('files.manage'))
  with check (public.erp_has_permission('files.manage'));

create or replace function public.erp_attachment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Пустой auth.uid() — это service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя (правило проекта).
  if (select auth.uid()) is null then
    return new;
  end if;

  -- Меняться вправе РОВНО `kind`, и только между свободными папками.
  -- Перекладывать макет нанесения нельзя: у него есть адресат (`print_id`),
  -- и смена вида оторвала бы его от нанесения — цех перестал бы видеть макет
  -- в своём задании.
  if new.kind is distinct from old.kind then
    if not (old.kind = any (array['attachment', 'production'])
            and new.kind = any (array['attachment', 'production'])) then
      raise exception 'erp_attachment_guard: между папками перекладываются только свободные файлы (attachment, production)'
        using errcode = '42501';
    end if;
    if not public.erp_has_permission('files.manage') then
      raise exception 'erp_attachment_guard: перемещение файла требует права files.manage'
        using errcode = '42501';
    end if;
  end if;

  if new.id is distinct from old.id
     or new.order_id is distinct from old.order_id
     or new.file_path is distinct from old.file_path
     or new.file_name is distinct from old.file_name
     or new.item_id is distinct from old.item_id
     or new.material_id is distinct from old.material_id
     or new.experimental_id is distinct from old.experimental_id
     or new.stage_id is distinct from old.stage_id
     or new.print_id is distinct from old.print_id
     or new.label_id is distinct from old.label_id
     or new.note_id is distinct from old.note_id
     or new.task_id is distinct from old.task_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'erp_attachment_guard: у вложения правится только папка (kind); файл заменяется новой строкой'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.erp_attachment_guard() is
  'UPDATE erp_order_attachments: меняется только kind и только между attachment и production, под files.manage. Прочие колонки неизменны — замена файла это новая строка, а не правка пути.';

drop trigger if exists erp_order_attachments_guard on public.erp_order_attachments;
create trigger erp_order_attachments_guard
  before update on public.erp_order_attachments
  for each row execute function public.erp_attachment_guard();

-- Функции-триггеры клиенту не нужны никогда (правило миграции 20260803250000)
revoke execute on function public.erp_attachment_guard() from anon, authenticated, public;
