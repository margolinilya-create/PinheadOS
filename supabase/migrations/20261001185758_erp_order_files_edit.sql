-- Файлы заказа правятся в форме правки (правка заказчика 01.10, п. 6).
--
-- Документ: «при редактировании заказа должна быть возможность изменять
-- загруженные файлы: удалять ранее загруженные, загружать новые взамен
-- старых; для всех файлов заказа — ТЗ, листов закупки и других вложений;
-- после сохранения в заказе отображаются актуальные версии».
--
-- Форму правки открывает `order.manage` (карточка заказа, «Редактировать»).
-- До этой миграции менеджер мог файл ЗАГРУЗИТЬ, но снять — только свободные
-- виды под `files.manage`; лист закупки, файлы упаковки и техблока, заметки
-- и превью удалял лишь администратор. В интерфейсе это было бы «кнопка есть,
-- действие падает», поэтому право расширяется здесь, а клиентский гейт
-- (`utils/attachmentRights.canRemoveOrderAttachment`) повторяет предикат
-- дословно — сторож `attachmentRights.test.ts` читает эту миграцию.
--
-- ── 1. DELETE вложений заказа ─────────────────────────────────────────────
-- Действующий предикат — миграция 20260914211947 (правка 14.09, п. 3) —
-- перенесён без изменений, добавлена одна ветка: виды, которые заводит
-- ФОРМА ЗАКАЗА (лист закупки, файлы строк закупки, упаковка, техблок,
-- изображения заметок, превью) и свободный `attachment`, — под `order.manage`.
-- Макеты нанесений и бирок (`print`, `label`) остаются под `files.manage`:
-- их ведёт дизайнер. `chat`, `stage_result`, `dev_*` сюда не входят — у них
-- свой хозяин (сообщение, сдавший цех, разработка).
--
-- Вызовы функций в предикате обёрнуты в `(select …)` (правило 24.09:
-- InitPlan один раз на запрос, а не Filter на строку).
--
-- `erp_att_delete_dev` снимается повторно — этого требует сторож
-- `attachmentKinds.test.ts` от каждой миграции, трогающей удаление вложений.
-- Применено к pinhead-os-v2 01.10 именно так: `drop policy` + `create policy`
-- на бою зависал (таймаут без ожидания блокировки в pg_stat_activity),
-- `alter policy` прошёл сразу. Отдельной политики `erp_att_delete_dev`
-- на бою нет (проверено перед применением), снимать её нечего.
alter policy erp_order_attachments_delete on public.erp_order_attachments
  using (
    (select public.is_admin())
    or (experimental_id is not null and kind = any (array['dev_pattern', 'dev_passport', 'dev_photo', 'dev_task']) and (select public.erp_has_permission('experimental.manage')))
    or (stage_id is not null and kind = 'subcontract' and (select public.erp_has_permission('order.manage')))
    or (kind = any (array['attachment', 'production', 'print', 'label']) and (select public.erp_has_permission('files.manage')))
    or (kind = any (array['attachment', 'purchase_list', 'purchase', 'packaging', 'tech', 'note', 'preview']) and (select public.erp_has_permission('order.manage')))
  );

create or replace function public.erp_tz_document_remove(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.erp_has_permission('tz.manage') then
    raise exception 'Нет права менять ТЗ заказа' using errcode = '42501';
  end if;
  if not exists (select 1 from public.erp_tz_documents where group_id = p_group_id) then
    raise exception 'Документ ТЗ не найден' using errcode = 'P0002';
  end if;
  update public.erp_tz_documents
     set is_current = false
   where group_id = p_group_id
     and is_current;
  get diagnostics v_count = row_count;
  -- 0 — группа уже снята (повтор нажатия, вторая вкладка): не ошибка
  return v_count;
end;
$$;

revoke execute on function public.erp_tz_document_remove(uuid) from public, anon;
grant execute on function public.erp_tz_document_remove(uuid) to authenticated;
