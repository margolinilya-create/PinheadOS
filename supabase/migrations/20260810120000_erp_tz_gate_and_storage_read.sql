-- ТЗ в PDF: гейт на сервере совпадает с гейтом в интерфейсе (правки заказчика 10.08).
--
-- Жалоба: «при загрузке PDF в блок „ТЗ в PDF для цехов“ файл не сохраняется»,
-- ошибки `new row violates row-level security policy` и `Load failed`. Разбор
-- на живом проде нашёл ДВЕ независимые причины; здесь закрывается вторая
-- (первая — авторизация, она во фронтенде).
--
-- ЧТО БЫЛО НЕ ТАК. Загрузка ТЗ — два шага, и они гейтились по-разному:
--   · файл в бакет   — `erp_is_member()`: любой активный одобренный профиль;
--   · строка в БД    — `erp_can_manage_tz()`: `profiles.role in (admin, director,
--     rop, manager)`, и про `erp_employees.role` эта функция не знает вовсе.
-- А интерфейс гейтит кнопку правом `tz.manage` из матрицы `erp_role_permissions`,
-- где оно есть и у диспетчера. Итог для диспетчера: кнопка есть, файл улетает
-- в бакет, строка падает с 42501, код убирает файл за собой и пишет «Файл
-- загружен, но не привязан к заказу». Это ровно то запрещённое правилами
-- «кнопка есть, а действие падает», от которого страж должен защищать.
--
-- Переводим политики на `erp_has_permission('tz.manage')` — тот же механизм,
-- которым уже гейтятся план и этапы, то есть ОДИН источник правды с клиентом
-- (`erp_role_of_caller()` — дословное зеркало `resolveErpRole`). Никого из тех,
-- кто мог грузить ТЗ раньше, это не отсекает: admin/director → роль `director`,
-- rop → `dispatcher`, manager → `manager`, и у всех трёх `tz.manage` в сиде есть.
--
-- Удаление документа остаётся у `is_admin()`: снести историю версий — не то же
-- самое, что загрузить новую.

drop policy if exists "erp_tz_documents_insert" on public.erp_tz_documents;
create policy "erp_tz_documents_insert" on public.erp_tz_documents
  for insert to authenticated
  with check (public.erp_has_permission('tz.manage'));

drop policy if exists "erp_tz_documents_update" on public.erp_tz_documents;
create policy "erp_tz_documents_update" on public.erp_tz_documents
  for update to authenticated
  using (public.erp_has_permission('tz.manage'))
  with check (public.erp_has_permission('tz.manage'));

-- Чтение файлов бакета `erp-attachments` роли `authenticated`.
--
-- SELECT-политики на `storage.objects` не было НИ ОДНОЙ. Публичное чтение по
-- ссылке от этого не страдало (бакет `public`, и раздача идёт мимо RLS), поэтому
-- дыры никто не замечал. Но клиентские операции ходят через RLS:
--   · `upsert: true` при повторной загрузке ТЗ — storage ищет существующий объект;
--   · `remove()` в `removeOrphanUpload` — уборка файла, который не привязался;
--   · `list()` — если когда-нибудь понадобится.
-- Без права видеть объект эти операции ведут себя не так, как ожидает код: отсюда
-- и старый комментарий «удалять его клиенту политика не даёт», из-за которого
-- сироты копились в бакете годами.
--
-- Новых данных это никому не открывает: содержимое бакета и так публично
-- по прямой ссылке, а предикат сужает видимость до участников ERP.

drop policy if exists "erp_att_read" on storage.objects;
create policy "erp_att_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'erp-attachments' and public.erp_is_member());
