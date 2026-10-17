-- Пробы бакета order-artworks: миграция C (20261017070826_order_artworks_bucket),
-- применена на бою 17.10. Миграции A и B — тоже на бою; их пробы —
-- supabase/probes/order_v4_rights.sql.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=67 {…}
--
-- Как запускать — supabase/probes/README.md. Коротко: вставить файл ЦЕЛИКОМ
-- в SQL Editor и выполнить, в тихое время. Файл сам открывает транзакцию,
-- последний DO бросает исключение 'PROBE_RESULT …' — откатывается всё:
-- заказы, строки storage.objects и временная политика tmp_probe_any_update
-- (пробы x_broad_* проверяют, что restrictive-политика держит и против широкой
-- permissive; политика снимается в том же файле и в любом случае уходит с откатом).
--
-- Строки storage.objects вставляются НАПРЯМУЮ (минуя Storage API): так
-- проверяются ровно политики RLS. Удаление — с `storage.allow_delete_query`
-- = 'true' (иначе триггер боя `protect_objects_delete` отвечает 42501 ещё до
-- политик). ВНИМАНИЕ: в файле есть `delete` и `update` — MCP execute_sql ждёт
-- подтверждения; прогон — через SQL Editor владельцем.
--
-- Заказы вставляются ТОЛЬКО суперпользователем с явным order_number 'PROBE-…'
-- ДО `set local role` (страж B пропускает служебный доступ; последовательность
-- не тратится). Роли — существующие профили боя:
--   ADMIN   b9c3e42e-9e07-44c2-8b15-839ce327c40c  admin
--   SELLER  9285888e-4401-4b1b-b523-a3e6a9b90e82  manager
--   SELLER2 e73bd7fd-92a4-4b7b-b62d-ce9462d77f26  manager
--   MS      f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9  manager; его строка erp_employees
--           внутри транзакции получает role = 'manager' (откат вернёт)
-- Заказы: f1 (SELLER, draft v4), f2 (SELLER2, draft v4), f3 (SELLER, ready_to_launch),
-- f4 (SELLER, v3 draft).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function pg_temp.p(p_name text, p_expect text, p_sql text) returns void
language plpgsql as $f$
declare v text; n bigint;
begin
  begin
    if p_sql ~* '^\s*(select|with)\M' then
      execute p_sql into v;
      v := 'OK ' || coalesce(v, 'null');
    else
      execute p_sql;
      get diagnostics n = row_count;
      v := 'OK rows=' || n;
    end if;
  exception when others then
    v := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('probe.r.' || p_name, v, true);
  perform set_config('probe.e.' || p_name, p_expect, true);
  perform set_config('probe.names', coalesce(nullif(current_setting('probe.names', true), ''), '') || p_name || ',', true);
end;
$f$;

create function pg_temp.as_user(p_uid text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$f$;

-- ── Данные (суперпользователь) ──────────────────────────────────────────
select pg_temp.as_user(null);
select set_config('storage.allow_delete_query', 'true', true);

update public.erp_employees set role = 'manager'
 where profile_id = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9';

insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date)
values
  ('00000000-0000-4000-8000-0000000000f1', 'PROBE-F1', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-0000000000f2', 'PROBE-F2', 4, 'draft', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', '{}', 'Клиент 2', current_date + 10),
  ('00000000-0000-4000-8000-0000000000f3', 'PROBE-F3', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент 3', current_date + 10),
  ('00000000-0000-4000-8000-0000000000f4', 'PROBE-F4', 3, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"x":1}', null, null);

-- Файлы, уже лежащие в бакете (ключи — только ASCII)
insert into storage.objects (bucket_id, name, owner) values
  ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-a.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-del.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  -- отдельные объекты под перенос в соседние бакеты (не трогают probe-a и прочие)
  ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-move-out.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-move-sku.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f2/logo/probe-b.png', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f4/logo/probe-v3.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  -- соседний бакет: ключи, на которых голое ::uuid упало бы с 22P02
  ('erp-attachments', 'att/new/probe/not-a-uuid.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  ('erp-attachments', 'orders/not-a-uuid/probe.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  -- объект ERP автора — под попытку переноса В order-artworks
  ('erp-attachments', 'att/probe-move-in.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82');

-- ── Бакет и хелпер (суперпользователь) ──────────────────────────────────
select pg_temp.p('bucket_private', 'OK false/26214400/image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,application/postscript,application/illustrator,image/vnd.adobe.photoshop,image/tiff',
  $q$select public::text || '/' || file_size_limit || '/' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'order-artworks'$q$);
select pg_temp.p('helper_ok', 'OK 00000000-0000-4000-8000-0000000000f1',
  $q$select public.order_artwork_order_id('orders/00000000-0000-4000-8000-0000000000f1/logo/x.png')::text$q$);
select pg_temp.p('helper_bad_uuid', 'OK null', $q$select public.order_artwork_order_id('orders/not-a-uuid/x.png')::text$q$);
select pg_temp.p('helper_upper', 'OK null', $q$select public.order_artwork_order_id('orders/00000000-0000-4000-8000-0000000000F1/x.png')::text$q$);
select pg_temp.p('helper_no_tail', 'OK null', $q$select public.order_artwork_order_id('orders/00000000-0000-4000-8000-0000000000f1')::text$q$);
select pg_temp.p('helper_prefix', 'OK null', $q$select public.order_artwork_order_id('x/orders/00000000-0000-4000-8000-0000000000f1/a.png')::text$q$);
select pg_temp.p('helper_null', 'OK null', $q$select public.order_artwork_order_id(null)::text$q$);
select pg_temp.p('helper_volatility', 'OK i', $q$select provolatile::text from pg_proc where oid = 'public.order_artwork_order_id(text)'::regprocedure$q$);
select pg_temp.p('helper_anon', 'OK false', $q$select has_function_privilege('anon', 'public.order_artwork_order_id(text)', 'execute')::text$q$);
select pg_temp.p('helper_auth', 'OK true', $q$select has_function_privilege('authenticated', 'public.order_artwork_order_id(text)', 'execute')::text$q$);
select pg_temp.p('policies', 'OK order_artworks_delete:DELETE:PERMISSIVE,order_artworks_insert:INSERT:PERMISSIVE,order_artworks_no_update:UPDATE:RESTRICTIVE,order_artworks_select:SELECT:PERMISSIVE',
  $q$select string_agg(policyname || ':' || cmd || ':' || permissive, ',' order by policyname) from pg_policies where schemaname = 'storage' and policyname like 'order_artworks_%'$q$);
select pg_temp.p('no_update_expr', 'OK (bucket_id <> ''order-artworks''::text)|(bucket_id <> ''order-artworks''::text)',
  $q$select qual || '|' || with_check from pg_policies where schemaname = 'storage' and policyname = 'order_artworks_no_update'$q$);

-- ── SELLER (автор f1, f3, f4) ───────────────────────────────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;

select pg_temp.p('s_sees', 'OK probe-a.png,probe-c.png,probe-del.png,probe-move-out.png,probe-move-sku.png',
  $q$select string_agg(split_part(name, '/', 4), ',' order by split_part(name, '/', 4)) from storage.objects where bucket_id = 'order-artworks' and name like '%/probe-%'$q$);
-- соседний бакет с не-uuid ключами читается (наша политика не падает 22P02)
select pg_temp.p('s_other_bucket', 'OK 3',
  $q$select count(*)::text from storage.objects where bucket_id = 'erp-attachments' and name like '%probe%'$q$);
select pg_temp.p('s_all_buckets', 'OK 8',
  $q$select count(*)::text from storage.objects where name like '%probe%'$q$);
-- SELECT … FOR UPDATE под ролью пользователя применяет USING политик UPDATE:
-- строки order-artworks не видны (permissive update нет, restrictive режет).
-- Любой путь storage-api, который блокирует строку под ролью пользователя,
-- получит «не найдено».
select pg_temp.p('s_for_update', 'OK 0',
  $q$select count(*)::text from (select 1 from storage.objects where bucket_id = 'order-artworks' and name like '%probe-a.png' for update) t$q$);
select pg_temp.p('s_ins_own_draft', 'OK rows=1',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/1111-new.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_foreign', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f2/logo/x.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_sent', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f3/logo/x.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_v3', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f4/logo/x.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_no_prefix', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'logo/x.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_dotdot', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/../00000000-0000-4000-8000-0000000000f2/x.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_cyrillic', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/логотип.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_space', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/a b.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_upper_uuid', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000F1/logo/x.png', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('s_ins_bare_folder', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
-- UPDATE строки order-artworks запрещён всем (restrictive `order_artworks_no_update`):
-- USING не берёт строку → rows=0; перенос ВНУТРЬ — WITH CHECK → 42501
select pg_temp.p('s_move_foreign', 'OK rows=0',
  $q$update storage.objects set name = 'orders/00000000-0000-4000-8000-0000000000f2/logo/probe-a.png' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-a.png'$q$);
select pg_temp.p('s_move_sent', 'OK rows=0',
  $q$update storage.objects set name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-a.png' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-a.png'$q$);
-- Вынос СВОЕГО файла СВОЕГО черновика в соседний бакет. Без restrictive
-- WITH CHECK `erp_att_update` / `sku_photos_update` (owner = uid) пропустил бы
-- новую строку, и файл ушёл бы мимо лимитов типа и размера получателя.
select pg_temp.p('s_move_other_bucket', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'erp-attachments' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-move-out.png'$q$);
-- то же в ПУБЛИЧНЫЙ sku-photos
select pg_temp.p('s_move_sku_bucket', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'sku-photos' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-move-sku.png'$q$);
-- вынести файл ОТПРАВЛЕННОГО заказа нельзя: старую строку не берёт ни одна USING
select pg_temp.p('s_move_out_sent', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'erp-attachments' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png'$q$);
-- перенос ИЗ erp-attachments В order-artworks: даже в свой черновик — WITH CHECK restrictive
select pg_temp.p('s_move_in_own', '42501',
  $q$update storage.objects set bucket_id = 'order-artworks', name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/in.png' where bucket_id = 'erp-attachments' and name = 'att/probe-move-in.png'$q$);
select pg_temp.p('s_move_in_foreign', '42501',
  $q$update storage.objects set bucket_id = 'order-artworks', name = 'orders/00000000-0000-4000-8000-0000000000f2/logo/in.png' where bucket_id = 'erp-attachments' and name = 'att/probe-move-in.png'$q$);
select pg_temp.p('s_move_in_sent', '42501',
  $q$update storage.objects set bucket_id = 'order-artworks', name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/in.png' where bucket_id = 'erp-attachments' and name = 'att/probe-move-in.png'$q$);
select pg_temp.p('s_move_own', 'OK rows=0',
  $q$update storage.objects set name = 'orders/00000000-0000-4000-8000-0000000000f1/flat/probe-a.png' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-a.png'$q$);
-- перезапись метаданных — и своего черновика, и отправленного: строку не взять
select pg_temp.p('s_upd_own_meta', 'OK rows=0',
  $q$update storage.objects set metadata = '{"x":1}' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-a.png'$q$);
select pg_temp.p('s_upd_sent', 'OK rows=0',
  $q$update storage.objects set metadata = '{"x":1}' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png'$q$);
select pg_temp.p('s_upd_foreign', 'OK rows=0',
  $q$update storage.objects set metadata = '{"x":1}' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f2/logo/probe-b.png'$q$);
select pg_temp.p('s_del_sent', 'OK rows=0',
  $q$delete from storage.objects where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png'$q$);
select pg_temp.p('s_del_foreign', 'OK rows=0',
  $q$delete from storage.objects where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f2/logo/probe-b.png'$q$);
select pg_temp.p('s_del_own_draft', 'OK rows=1',
  $q$delete from storage.objects where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-del.png'$q$);
reset role;

-- ── SELLER2 (чужой менеджер) ────────────────────────────────────────────
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('s2_sees', 'OK probe-b.png',
  $q$select string_agg(split_part(name, '/', 4), ',' order by split_part(name, '/', 4)) from storage.objects where bucket_id = 'order-artworks' and name like '%/probe-%'$q$);
select pg_temp.p('s2_ins_foreign', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/x.png', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26')$q$);
-- перенос СВОЕГО файла в папку чужого заказа
-- вынести ЧУЖОЙ файл в соседний бакет — строку не взять
select pg_temp.p('s2_move_foreign_out', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'erp-attachments' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-a.png'$q$);
select pg_temp.p('s2_move_out', 'OK rows=0',
  $q$update storage.objects set name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-b.png' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f2/logo/probe-b.png'$q$);
reset role;

-- ── MS (менеджер сопровождения) ─────────────────────────────────────────
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms_is_ms', 'OK true', $q$select public.sales_is_ms()::text$q$);
select pg_temp.p('ms_sees', 'OK probe-c.png',
  $q$select string_agg(split_part(name, '/', 4), ',' order by split_part(name, '/', 4)) from storage.objects where bucket_id = 'order-artworks' and name like '%/probe-%'$q$);
select pg_temp.p('ms_ins_sent', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f3/logo/ms.png', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9')$q$);
select pg_temp.p('ms_upd', 'OK rows=0',
  $q$update storage.objects set metadata = '{"x":1}' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png'$q$);
select pg_temp.p('ms_move_out', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'erp-attachments' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png'$q$);
-- `copy` наружу = INSERT в бакет-получатель под его политикой. МС видит файл
-- отправленного заказа и, как член ERP, может вставить строку в публичный
-- erp-attachments (`erp_att_upload`, любой тип). Это «прочитал — опубликовал»,
-- которое МС и так может (скачать и загрузить); лимитов erp-attachments не
-- обходит (их нет). Зафиксировано, не закрывается (ERP заморожен).
select pg_temp.p('ms_copy_out', 'OK rows=1',
  $q$insert into storage.objects (bucket_id, name, owner) values ('erp-attachments', 'att/probe-ms-copy.png', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9')$q$);
-- copy ВНУТРЬ = INSERT в order-artworks: отправленный заказ — политика записи
select pg_temp.p('ms_copy_in_sent', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f3/logo/copy.png', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9')$q$);
select pg_temp.p('ms_del', 'OK rows=0',
  $q$delete from storage.objects where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png'$q$);
reset role;

-- ── ADMIN (руководство) ─────────────────────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('a_sees', 'OK probe-a.png,probe-b.png,probe-c.png,probe-move-out.png,probe-move-sku.png',
  $q$select string_agg(split_part(name, '/', 4), ',' order by split_part(name, '/', 4)) from storage.objects where bucket_id = 'order-artworks' and name like '%/probe-%'$q$);
select pg_temp.p('a_ins_foreign_draft', 'OK rows=1',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f2/logo/2222-admin.png', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('a_ins_sent', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f3/logo/x.png', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
-- руководство не переносит и черновик (restrictive — для всех ролей)
select pg_temp.p('a_move_draft', 'OK rows=0',
  $q$update storage.objects set name = 'orders/00000000-0000-4000-8000-0000000000f2/flat/probe-b.png' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f2/logo/probe-b.png'$q$);
-- руководство не выносит файл отправленного заказа (is_admin() не спасает: USING старой строки)
select pg_temp.p('a_move_out_sent', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'erp-attachments' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png'$q$);
select pg_temp.p('a_del_sent', 'OK rows=0',
  $q$delete from storage.objects where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f3/logo/probe-c.png'$q$);
reset role;

-- ── Отключённый профиль и аноним ────────────────────────────────────────
select pg_temp.as_user(null);
update public.profiles set active = false where id = 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26';
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('off_sees', 'OK null',
  $q$select string_agg(name, ',') from storage.objects where bucket_id = 'order-artworks' and name like '%/probe-%'$q$);
select pg_temp.p('off_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f2/logo/off.png', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26')$q$);
reset role;
select pg_temp.as_user(null);
set local role anon;
select pg_temp.p('anon_sees', 'OK 0',
  $q$select count(*)::text from storage.objects where bucket_id = 'order-artworks'$q$);
select pg_temp.p('anon_ins', '42501',
  $q$insert into storage.objects (bucket_id, name) values ('order-artworks', 'orders/00000000-0000-4000-8000-0000000000f1/logo/anon.png')$q$);
reset role;

-- ── Restrictive держит и против будущей широкой permissive ─────────────
-- Без restrictive вынос/внос и так упираются в отсутствие permissive USING/CHECK.
-- Здесь внутри транзакции заводится permissive «update всё» (та же роль, что
-- создаёт политики миграции C), проверяется, что restrictive режет, и политика
-- снимается; финальный raise откатит и это.
reset role;
select pg_temp.as_user(null);
create policy tmp_probe_any_update on storage.objects for update to authenticated using (true) with check (true);
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('x_broad_move_out', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'sku-photos' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-move-sku.png'$q$);
select pg_temp.p('x_broad_meta', 'OK rows=0',
  $q$update storage.objects set metadata = '{"y":1}' where bucket_id = 'order-artworks' and name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/probe-a.png'$q$);
select pg_temp.p('x_broad_move_in', '42501',
  $q$update storage.objects set bucket_id = 'order-artworks', name = 'orders/00000000-0000-4000-8000-0000000000f1/logo/in2.png' where bucket_id = 'erp-attachments' and name = 'att/probe-move-in.png'$q$);
select pg_temp.p('x_broad_other_ok', 'OK rows=1',
  $q$update storage.objects set metadata = '{"y":1}' where bucket_id = 'erp-attachments' and name = 'att/probe-move-in.png'$q$);
reset role;
select pg_temp.as_user(null);
drop policy tmp_probe_any_update on storage.objects;

do $$
declare
  v_names text[] := array_remove(string_to_array(current_setting('probe.names', true), ','), '');
  v_name text;
  v_fails int := 0;
  v_out jsonb := '{}'::jsonb;
  v_r text;
  v_e text;
begin
  foreach v_name in array v_names loop
    v_r := current_setting('probe.r.' || v_name, true);
    v_e := current_setting('probe.e.' || v_name, true);
    if v_r not like v_e || '%' then
      v_fails := v_fails + 1;
      v_out := v_out || jsonb_build_object('FAIL ' || v_name, jsonb_build_object('got', v_r, 'want', v_e));
    else
      v_out := v_out || jsonb_build_object(v_name, v_r);
    end if;
  end loop;
  raise exception 'PROBE_RESULT fails=% total=% %', v_fails, cardinality(v_names), v_out;
end;
$$;

-- Сюда исполнение не доходит: исключение выше откатывает всё. Строка — для клиента,
-- который продолжает после ошибки (psql без ON_ERROR_STOP).
rollback;
