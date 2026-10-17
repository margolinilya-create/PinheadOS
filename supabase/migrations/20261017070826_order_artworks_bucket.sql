-- Закрытое хранилище файлов заказа v4: бакет `order-artworks` (веха 2, миграция C).
--
-- ЗАЧЕМ. Макеты клиента (логотипы), технические рисунки, ТЗ в PDF, бирки,
-- стикеры и картинки заметок — коммерческая тайна клиента. Публичный бакет
-- (как `erp-attachments`) даёт вечную неотзываемую ссылку любому, кому она
-- попала в руки. Поэтому бакет ПРИВАТНЫЙ: чтение — только подписанной ссылкой
-- (клиент выдаёт её по требованию, живёт ≤ 10 минут), а сама подпись выдаётся
-- только тому, кому виден заказ (политика SELECT ниже).
--
-- ПУТИ. `orders/<uuid заказа>/<вид>/<uuid>-<ascii-имя>`, строго ASCII
-- (правило проекта «ключ объекта в Storage — ASCII»). Привязку пути к заказу
-- держит хелпер миграции A `order_artwork_path_ok(uuid, text)` — тот же, что
-- проверяет пути в `order_v4_save` и в стражах (миграции A и B).
--
-- КТО ЧТО МОЖЕТ (RLS `orders` из миграции B решает, виден ли заказ):
--   · читать — всякий, кому виден заказ v4: автор, руководство (admin,
--     director, rop), МС — заказы в `ready_to_launch`, `production`, `done`;
--   · писать (новый ключ) и удалять — автор-менеджер или руководство,
--     и ТОЛЬКО пока заказ в `draft` (после «Отправить в работу» файлы
--     заморожены вместе со строками заказа). МС только читает.
--   · UPDATE (перезапись, move внутрь и наружу) — никто: restrictive
--     `order_artworks_no_update` ниже. `copy` — это INSERT: внутрь бакета его
--     судит политика записи; наружу — политика бакета-получателя (читающий
--     может скопировать видимый ему файл туда, куда и так может загрузить).
-- Цеху ссылки на этот бакет не даются: при запуске (веха 6–7) макеты и PDF
-- копируются в `erp-attachments` через `tz.documents`.
--
-- ПОЧЕМУ ХЕЛПЕР ВМЕСТО `(storage.foldername(name))[2]::uuid`. Политики
-- `storage.objects` вычисляются для строк ВСЕХ бакетов, которые попали в
-- запрос, а порядок вычисления условий в AND Postgres не гарантирует. Голое
-- `::uuid` на ключе вида `att/new/...` из `erp-attachments` падает с 22P02 —
-- и ломает чтение чужого бакета. `order_artwork_order_id` возвращает uuid
-- только для пути `orders/<uuid>/…`, иначе null — без исключения.
--
-- `objects.name` в подзапросах квалифицирован явно: без этого колонка
-- `name`, появись она когда-нибудь в `orders`, молча подменила бы ключ файла.

-- ── Бакет ────────────────────────────────────────────────────────────────
-- 25 МБ: исходники логотипов (AI/PDF/EPS) бывают тяжёлыми; лимит на бакете
-- действует, даже если клиент проверку обошёл.
--
-- Типы — то, в чём клиент присылает логотип и в чём мы сами делаем файлы:
--   image/png, image/jpeg, image/webp, image/svg+xml — растр и вектор для веба;
--   application/pdf — ТЗ, тех. рисунки, «сохранить как PDF» из Illustrator;
--   application/postscript — .ai и .eps (так их называют mime-db, Chrome и
--     Firefox на Windows/macOS);
--   application/illustrator — .ai в Linux (shared-mime-info);
--   image/vnd.adobe.photoshop — .psd, image/tiff — .tif/.tiff: исходники
--     из Photoshop и растр под печать (решение владельца 17.10). Тип браузера
--     у них тоже зависит от ОС (у .psd часто пустой) — клиент берёт его
--     по расширению, как у .ai.
-- SVG принят, но он может нести скрипт: открытый по подписанной ссылке
-- напрямую, он выполнился бы в origin Storage. Поэтому показ — только
-- `<img>`, а «открыть в новой вкладке» — только ссылкой на скачивание
-- (`artworkDownloadUrl`, `download=`); правило — docs/rules
-- `pravila-hranilishcha-faylov-zakaza-veha-2-17-10.md`.
-- application/octet-stream НЕ разрешён. supabase-js 2.98 грузит File через
-- FormData, и Storage берёт тип из части формы — то есть из `File.type`,
-- а опцию `contentType` для File игнорирует. У файла, которого браузер не
-- знает, `File.type` пустой, и в форму уходит octet-stream. Поэтому клиент
-- (`orderstudio/api/artworks.ts`, `artworkContentType`) сам назначает тип по
-- расширению из этого же списка и пересобирает Blob — .ai с пустым типом
-- уходит как application/postscript. Открыть octet-stream значило бы
-- принимать что угодно под видом макета.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-artworks', 'order-artworks', false, 26214400, array[
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
  'application/pdf', 'application/postscript', 'application/illustrator',
  'image/vnd.adobe.photoshop', 'image/tiff'
])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── Хелпер: id заказа из ключа объекта ───────────────────────────────────
-- Только путь `orders/<uuid в нижнем регистре>/…`, иначе null. Без обращения
-- к таблицам, поэтому immutable. CASE ленивый: приведение `::uuid` выполняется
-- только после совпадения с регуляркой, которая гарантирует формат uuid.
create or replace function public.order_artwork_order_id(p_name text)
returns uuid
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when p_name ~ '^orders/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    then split_part(p_name, '/', 2)::uuid
  end;
$$;

revoke execute on function public.order_artwork_order_id(text) from public, anon;
grant execute on function public.order_artwork_order_id(text) to authenticated;

-- ── Политики storage.objects — на команду ────────────────────────────────
-- Чтение: заказ v4 виден вызывающему по RLS `orders` (подзапрос идёт под его
-- правами: активный и одобренный профиль, автор / руководство / МС).
drop policy if exists "order_artworks_select" on storage.objects;
create policy "order_artworks_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'order-artworks'
    and exists (
      select 1 from public.orders o
       where o.id = public.order_artwork_order_id(objects.name)
         and o.schema_version = 4
    )
  );

-- Запись: путь принадлежит заказу (ASCII, без `..`), заказ виден, это черновик
-- v4, и пишет автор-менеджер или руководство. МС не пишет.
drop policy if exists "order_artworks_insert" on storage.objects;
create policy "order_artworks_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'order-artworks'
    and public.order_artwork_path_ok(public.order_artwork_order_id(name), name)
    and exists (
      select 1 from public.orders o
       where o.id = public.order_artwork_order_id(objects.name)
         and o.schema_version = 4
         and o.status = 'draft'
         and ((select public.sales_is_lead())
              or (o.created_by = (select auth.uid()) and (select public.sales_is_seller())))
    )
  );

-- UPDATE ЗАПРЕЩЁН ВСЕМ — restrictive-политикой. Клиенту он не нужен:
-- загрузка без upsert (INSERT), новый файл — новый ключ, замена — загрузка
-- нового + удаление старого; move/copy клиент не зовёт.
-- Почему не permissive «как у записи»: permissive-политики складываются
-- через OR — и по USING (какую строку взять), и по WITH CHECK (какой она
-- станет). WITH CHECK соседних `erp_att_update` (owner = uid и член ERP)
-- и `sku_photos_update` (owner = uid) пропускает новую строку своего
-- бакета, и `move` выносил бы файл из `order-artworks` в чужой бакет МИМО
-- лимитов типа и размера бакета-получателя (SVG/PDF — в публичный
-- `sku-photos`). Restrictive складывается через AND с каждой permissive:
-- строку `order-artworks` не взять на UPDATE и не сделать ею строку другого
-- бакета (перенос внутрь) — ни владельцу, ни руководству. Политики ERP
-- (заморожены) не трогаются.
drop policy if exists "order_artworks_no_update" on storage.objects;
create policy "order_artworks_no_update" on storage.objects
  as restrictive
  for update to authenticated
  using (bucket_id <> 'order-artworks')
  with check (bucket_id <> 'order-artworks');

-- Удаление: как запись — только черновик, автор или руководство.
drop policy if exists "order_artworks_delete" on storage.objects;
create policy "order_artworks_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'order-artworks'
    and public.order_artwork_path_ok(public.order_artwork_order_id(name), name)
    and exists (
      select 1 from public.orders o
       where o.id = public.order_artwork_order_id(objects.name)
         and o.schema_version = 4
         and o.status = 'draft'
         and ((select public.sales_is_lead())
              or (o.created_by = (select auth.uid()) and (select public.sales_is_seller())))
    )
  );
