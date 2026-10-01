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
drop policy if exists erp_att_delete_dev on public.erp_order_attachments;
drop policy if exists erp_order_attachments_delete on public.erp_order_attachments;

create policy erp_order_attachments_delete on public.erp_order_attachments
  for delete to authenticated
  using (
    (select public.is_admin())
    or (
      experimental_id is not null
      and kind = any (array['dev_pattern', 'dev_passport', 'dev_photo', 'dev_task'])
      and (select public.erp_has_permission('experimental.manage'))
    )
    or (
      stage_id is not null
      and kind = 'subcontract'
      and (select public.erp_has_permission('order.manage'))
    )
    or (
      kind = any (array['attachment', 'production', 'print', 'label'])
      and (select public.erp_has_permission('files.manage'))
    )
    or (
      kind = any (array['attachment', 'purchase_list', 'purchase', 'packaging', 'tech', 'note', 'preview'])
      and (select public.erp_has_permission('order.manage'))
    )
  );

comment on policy erp_order_attachments_delete on public.erp_order_attachments is
  'Удаление вложения: админ; файлы разработки — experimental.manage; ТЗ подрядного этапа — order.manage; рабочие файлы и макеты — files.manage; файлы формы заказа (лист закупки, упаковка, техблок, заметки, превью, вложения) — order.manage (правка 01.10, п. 6).';

-- Объект бакета при удалении строки клиент убирает сам, если может
-- (`erp_att_delete_own`: автор либо админ). Чужой объект остаётся «ничьим»
-- и уходит с `storage-gc` по общим правилам (носителей нет, возраст больше
-- суток) — удалять его здесь `security definer`-ом значило бы завести
-- второго уборщика рядом с проверкой носителей (`freeOfSkuCards`).

-- ── 2. Снять ТЗ с заказа ──────────────────────────────────────────────────
-- Документ ТЗ — группа версий (`group_id`), ровно одна из них `is_current`
-- (уникальный частичный индекс `erp_tz_documents_current_idx`). «Удалить ТЗ»
-- в форме правки — снять флаг со ВСЕЙ группы: история версий остаётся
-- (DELETE строки — по-прежнему только `is_admin()`), а группа без актуальной
-- версии больше не показывается и не закрывает гейт ТЗ — клиентский
-- `utils/tz.currentVersion` с этой правки читает «нет `is_current`» как
-- «документ снят», а не как сбой.
--
-- Файл в бакете НЕ удаляется: на него ссылаются строки истории, то есть он
-- не «ничей», и `storage-gc` его не тронет.
--
-- ПОЧЕМУ RPC, А НЕ UPDATE С КЛИЕНТА. UPDATE-политика у `tz.manage` есть,
-- но она пускает правку любой колонки строки; функция пишет ровно один
-- переход `is_current → false` и отвечает внятным отказом.
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

comment on function public.erp_tz_document_remove(uuid) is
  'Снять документ ТЗ с заказа: is_current = false у всей группы версий, история остаётся (правка 01.10, п. 6). Право tz.manage.';

revoke execute on function public.erp_tz_document_remove(uuid) from public, anon;
grant execute on function public.erp_tz_document_remove(uuid) to authenticated;
