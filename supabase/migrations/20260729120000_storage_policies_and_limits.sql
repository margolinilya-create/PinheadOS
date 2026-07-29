-- Политики и лимиты бакетов: запись была открыта всем, замена и удаление не работали.
--
-- Что было (выгружено из pg_policies по схеме storage — всего ТРИ политики на два бакета):
--
--   erp_att_upload              INSERT  with check (bucket_id = 'erp-attachments')
--   sku_photos_authenticated_write INSERT with check (bucket_id = 'sku-photos')
--   erp_att_delete              DELETE  using (bucket_id = 'erp-attachments' and is_admin())
--
-- Отсюда три отдельные проблемы:
--
-- 1. Записывать мог ЛЮБОЙ авторизованный, включая неодобренного: в предикате нет ни
--    `erp_is_member()`, ни ограничения на тип и размер файла (на самих бакетах
--    `file_size_limit` и `allowed_mime_types` были null). Клиентские проверки есть
--    только для ТЗ (`checkFile` в tzSlice) и обходятся прямым вызовом Storage API.
--    Итог: хостинг произвольного контента под доменом компании и неограниченный счёт.
--
-- 2. UPDATE-политики не было НИ ОДНОЙ, значит `upsert: true` в `lib/storage.ts:153`
--    и в `CreateOrderModal` при перезаписи существующего объекта отклонялся RLS.
--    А комментарий в форме описывает повторный сабмит после сбоя как рабочий путь —
--    по политикам он таковым не был.
--
-- 3. DELETE для `sku-photos` не существовало вовсе, поэтому `deleteSkuPhotoByUrl`
--    всегда возвращал false: удалённые из каталога фото оставались публично
--    доступными навсегда.
--
-- Чего эта миграция НЕ делает: не переводит `erp-attachments` в приватный режим.
-- Публичный бакет означает вечную неотзываемую ссылку на ТЗ-PDF и вложения заказа —
-- это верно и это стоит чинить, но перевод на `createSignedUrl` меняет четыре точки
-- в коде (превью канбана, вложения карточки, TzViewer, задание цеха) и требует
-- отдельного решения по TTL. Вынесено в следующую волну.

-- ── Лимиты на самих бакетах: работают, даже если политика пропустила ──
-- 15 МБ = TZ_MAX_BYTES из erp/types.ts; image/* оставлен шире точного списка
-- намеренно: телефон в цеху отдаёт HEIC, и жёсткий перечень сломал бы фото брака.
update storage.buckets
   set file_size_limit = 15728640,
       allowed_mime_types = array['application/pdf', 'image/*']
 where id = 'erp-attachments';

update storage.buckets
   set file_size_limit = 15728640,
       allowed_mime_types = array['image/*']
 where id = 'sku-photos';

-- ── Запись: только член ERP (активный и одобренный профиль) ──
drop policy if exists "erp_att_upload" on storage.objects;
create policy "erp_att_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'erp-attachments' and public.erp_is_member());

drop policy if exists "sku_photos_authenticated_write" on storage.objects;
create policy "sku_photos_authenticated_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sku-photos' and public.erp_is_member());

-- ── Перезапись: без неё upsert:true не работает ──
-- USING и WITH CHECK оба обязательны: первый решает, какую строку можно взять,
-- второй — какой она станет.
drop policy if exists "erp_att_update" on storage.objects;
create policy "erp_att_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'erp-attachments' and public.erp_is_member())
  with check (bucket_id = 'erp-attachments' and public.erp_is_member());

drop policy if exists "sku_photos_update" on storage.objects;
create policy "sku_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'sku-photos' and public.erp_is_member())
  with check (bucket_id = 'sku-photos' and public.erp_is_member());

-- ── Удаление фото SKU: редактор каталога открыт admin и director ──
-- Поэтому `erp_is_manager()` (admin|director + active + approved), а не `is_admin()`:
-- последний вернул бы false директору, и кнопка удаления снова была бы декоративной.
drop policy if exists "sku_photos_delete" on storage.objects;
create policy "sku_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'sku-photos' and public.erp_is_manager());
