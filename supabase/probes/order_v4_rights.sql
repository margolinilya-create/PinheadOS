-- Пробы прав Order v4: миграции A (20261017053703_order_v4_tz_fields)
-- и B (20261017062110_order_v4_rights), обе применены на бою 17.10, и миграция E
-- (20261017093841_sales_staff_flag, признак «Менеджер продаж» — до применения
-- на бою запускать сухим прогоном вместе с ней в одной транзакции), и миграция D
-- (20261017101513_order_v4_client_rev: ревизия клиента и конкурентная правка
-- в order_v4_save / order_v4_save_full — до применения так же, сухим прогоном).
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=119 {…}
--
-- Как запускать — supabase/probes/README.md. Коротко: вставить файл ЦЕЛИКОМ
-- в SQL Editor и выполнить, в тихое время. Файл сам открывает транзакцию,
-- а последний DO бросает исключение 'PROBE_RESULT …' — всё откатывается,
-- в базе ничего не остаётся. fails = число проб, чей ответ не начинается
-- с ожидаемого префикса; карта name → ответ — в тексте той же ошибки
-- (проваленные — с ключом «FAIL имя», got/want).
--
-- Миграций здесь НЕТ: пробы идут против уже применённой схемы.
-- Заказы вставляются ТОЛЬКО суперпользователем с явным order_number 'PROBE-…'
-- (последовательность order_number_seq не тратится; это держит сторож
-- pinhead-react/src/orderstudio/probesFiles.test.ts). Роли — существующие
-- профили боя:
--   ADMIN   b9c3e42e-9e07-44c2-8b15-839ce327c40c  profiles.role = admin
--   SELLER  9285888e-4401-4b1b-b523-a3e6a9b90e82  profiles.role = manager (ERP production_head);
--           внутри транзакции получает is_sales = true (откат вернёт)
--   SELLER2 e73bd7fd-92a4-4b7b-b62d-ce9462d77f26  то же, что SELLER
--   HEAD    05bbc552-bca2-490d-b275-46a3084dca7c  profiles.role = manager (ERP production_head),
--           БЕЗ is_sales — начальник цеха: заказы продаж ему закрыты
--   PENDING cc9ed453-d3d7-4add-a361-8719a7701f97  profiles.role = manager, отключён и не одобрен;
--           внутри транзакции: active = true, is_sales = true, approved остаётся false
--   MS      f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9  profiles.role = manager; внутри транзакции
--           его строка erp_employees получает role = 'manager' (откат вернёт)
-- Заказы: a1 (SELLER, draft, к отправке), a2 (SELLER2, draft), a3 (SELLER, ready_to_launch),
-- a4 (SELLER, v3), a5 (SELLER, draft, на удаление), a6 (SELLER, ready_to_launch, захват
-- связи ERP до запуска), a7 (SELLER, ready_to_launch, возврат МС), a8 (отменённый
-- заказ ERP держит связь), a9 (черновик, уже связанный с ERP), a10 (SELLER, draft,
-- позиция b10 с поставщиком — сохранение без ревизии клиента и из «другой вкладки»).
-- Если профили выше на бою изменятся (роль, active) — пробы покажут FAIL, правьте шапку и данные.
--
-- Вставка заказа v4 клиентом (успешная или отклонённая RLS) проходит страж B,
-- а он выдаёт номер из order_number_seq ДО проверки RLS — на бою это трата
-- номера. Поэтому «может ли вставить» проверяется v3-вставкой (та же политика
-- orders_insert, страж v3 не трогает); v4-вставки — в локальном прогоне.

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

-- ── Данные (суперпользователь, auth.uid() пуст — стражи пропускают) ──────
select pg_temp.as_user(null);

update public.erp_employees set role = 'manager'
 where profile_id = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9';
-- Миграция E: продавцы — по признаку (служебный доступ страж пропускает).
-- HEAD и ADMIN — явно без признака: владелец мог отметить их на бою
update public.profiles set is_sales = false
 where id in ('05bbc552-bca2-490d-b275-46a3084dca7c', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c');
update public.profiles set is_sales = true
 where id in ('9285888e-4401-4b1b-b523-a3e6a9b90e82', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
update public.profiles set active = true, is_sales = true
 where id = 'cc9ed453-d3d7-4add-a361-8719a7701f97';

insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date)
values
  ('00000000-0000-4000-8000-0000000000a1', 'PROBE-1', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-0000000000a2', 'PROBE-2', 4, 'draft', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', '{}', 'Клиент 2', current_date + 10),
  ('00000000-0000-4000-8000-0000000000a3', 'PROBE-3', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент 3', current_date + 10),
  ('00000000-0000-4000-8000-0000000000a4', 'PROBE-4', 3, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"x":1}', null, null),
  ('00000000-0000-4000-8000-0000000000a5', 'PROBE-5', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент 5', null),
  ('00000000-0000-4000-8000-0000000000a6', 'PROBE-6', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент 6', current_date + 10),
  ('00000000-0000-4000-8000-0000000000a7', 'PROBE-7', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент 7', current_date + 10),
  ('00000000-0000-4000-8000-0000000000a8', 'PROBE-8', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент 8', current_date + 10),
  ('00000000-0000-4000-8000-0000000000a9', 'PROBE-9', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент 9', null),
  ('00000000-0000-4000-8000-000000000a10', 'PROBE-10', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент 10', null);
update public.orders set paid_at = now(), paid_kind = 'full'
 where id in ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000a8');
-- a3 (отправлен) — потомок черновика a5: удаление a5 обнуляет parent_id отправленного заказа
update public.orders set parent_id = '00000000-0000-4000-8000-0000000000a5'
 where id = '00000000-0000-4000-8000-0000000000a3';

insert into public.order_items (id, order_id) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a3'),
  ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000a5'),
  ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000a6'),
  ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000a7'),
  ('00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-0000000000a8');
insert into public.order_items (id, order_id, supplier) values
  ('00000000-0000-4000-8000-000000000b10', '00000000-0000-4000-8000-000000000a10', 'Поставщик-проба');
insert into public.order_item_prints (id, item_id, method) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'dtf');
insert into public.order_item_labels (id, item_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1');
insert into public.order_notes_cards (id, order_id, caption) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'карточка');

-- Захват связи ДО запуска: заказ ERP с tz_order_id = a6, созданный раньше проверки запуска
insert into public.erp_orders (title, tz_order_id, tz_number, created_at)
values ('PROBE захват', '00000000-0000-4000-8000-0000000000a6', 'PROBE-6', now() - interval '1 minute');
-- Отменённый прежний заказ ERP держит связь a8; черновик a9 уже связан с ERP
insert into public.erp_orders (title, tz_order_id, tz_number, status)
values ('PROBE отменён', '00000000-0000-4000-8000-0000000000a8', 'PROBE-8', 'cancelled'),
       ('PROBE связь черновика', '00000000-0000-4000-8000-0000000000a9', 'PROBE-9', 'active');

-- ── SELLER (автор, профиль manager) ─────────────────────────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;

select pg_temp.p('s_sees_own', 'OK PROBE-1,PROBE-10,PROBE-3,PROBE-4,PROBE-5,PROBE-6,PROBE-7,PROBE-8,PROBE-9',
  $q$select string_agg(order_number, ',' order by order_number) from public.orders where order_number like 'PROBE-%'$q$);
select pg_temp.p('s_is_seller', 'OK true', $q$select public.sales_is_seller()::text$q$);
-- признак меняет только admin/director через RPC; прямой UPDATE своего профиля режет RLS
select pg_temp.p('seller_set_staff', '42501 Отмечать', $q$select public.sales_set_staff('9285888e-4401-4b1b-b523-a3e6a9b90e82', false)$q$);
select pg_temp.p('seller_list_staff', '42501 Список', $q$select count(*)::text from public.sales_staff_list()$q$);
select pg_temp.p('s_self_set_sales', 'OK rows=0', $q$update public.profiles set is_sales = false where id = '9285888e-4401-4b1b-b523-a3e6a9b90e82'$q$);
select pg_temp.p('s_status_direct', '42501', $q$update public.orders set status = 'production' where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_paid_direct', '42501', $q$update public.orders set paid_kind = 'full', paid_at = now() where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_erp_link_direct', '42501', $q$update public.orders set erp_order_id = gen_random_uuid() where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_title_ok', 'OK rows=1', $q$update public.orders set title = 'проба' where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_title_sent', '42501', $q$update public.orders set title = 'проба' where id = '00000000-0000-4000-8000-0000000000a3'$q$);
select pg_temp.p('s_item_sent', '42501', $q$update public.order_items set tz_comment = 'x' where id = '00000000-0000-4000-8000-0000000000b3'$q$);
select pg_temp.p('s_item_ins_sent', '42501', $q$insert into public.order_items (order_id) values ('00000000-0000-4000-8000-0000000000a3')$q$);
select pg_temp.p('s_insert_production', '42501', $q$insert into public.orders (order_number, schema_version, status, created_by) values ('PROBE-X1', 4, 'production', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
-- белый список INSERT: служебное и «чужое» поле — отказ ДО выдачи номера (последовательность не тратится)
select pg_temp.p('s_insert_notes', '42501 Новый заказ', $q$insert into public.orders (order_number, schema_version, status, created_by, notes) values ('PROBE-X2', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', 'x')$q$);
select pg_temp.p('s_insert_erp_link', '42501 Новый заказ', $q$insert into public.orders (order_number, schema_version, status, created_by, erp_order_id) values ('PROBE-X3', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', gen_random_uuid())$q$);
select pg_temp.p('s_insert_total_sum', '42501 Новый заказ', $q$insert into public.orders (order_number, schema_version, status, created_by, total_sum) values ('PROBE-X4', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', 5)$q$);
-- номер уникален (v3 мимо стража, явный дубль)
select pg_temp.p('s_number_dup', '23505', $q$insert into public.orders (order_number, created_by, data) values ('PROBE-1', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}')$q$);
select pg_temp.p('s_v4_to_v3', '42501', $q$update public.orders set schema_version = 3 where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_v3_to_v4', '42501', $q$update public.orders set schema_version = 4 where id = '00000000-0000-4000-8000-0000000000a4'$q$);
-- родитель: невидимый, сам себе, свой видимый
select pg_temp.p('s_parent_hidden', '42501', $q$update public.orders set parent_id = '00000000-0000-4000-8000-0000000000a2' where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_parent_self', '42501', $q$update public.orders set parent_id = id where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_parent_ok', 'OK rows=1', $q$update public.orders set parent_id = '00000000-0000-4000-8000-0000000000a5' where id = '00000000-0000-4000-8000-0000000000a1'$q$);
-- пути файлов при прямой записи
select pg_temp.p('s_path_sticker_foreign', '22023', $q$update public.orders set sticker_preview_path = 'orders/00000000-0000-4000-8000-0000000000a2/s.png' where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_path_sticker_ok', 'OK rows=1', $q$update public.orders set sticker_preview_path = 'orders/00000000-0000-4000-8000-0000000000a1/s.png' where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_path_tz_pdf', '22023', $q$update public.order_items set tz_pdf_path = 'orders/00000000-0000-4000-8000-0000000000a2/tz.pdf' where id = '00000000-0000-4000-8000-0000000000b1'$q$);
select pg_temp.p('s_path_tz_pdf_ok', 'OK rows=1', $q$update public.order_items set tz_pdf_path = 'orders/00000000-0000-4000-8000-0000000000a1/tz.pdf' where id = '00000000-0000-4000-8000-0000000000b1'$q$);
select pg_temp.p('s_path_artwork', '22023', $q$insert into public.order_item_prints (item_id, method, artwork_path) values ('00000000-0000-4000-8000-0000000000b1', 'dtf', 'orders/00000000-0000-4000-8000-0000000000a2/a.png')$q$);
select pg_temp.p('s_path_artwork_dotdot', '22023', $q$update public.order_item_prints set artwork_path = 'orders/00000000-0000-4000-8000-0000000000a1/../x.png' where id = '00000000-0000-4000-8000-0000000000c1'$q$);
select pg_temp.p('s_path_attach', '22023', $q$update public.order_item_labels set attach_image_path = 'orders/00000000-0000-4000-8000-0000000000a2/l.png' where id = '00000000-0000-4000-8000-0000000000d1'$q$);
select pg_temp.p('s_path_preview', '22023', $q$update public.order_item_labels set preview_paths = array['orders/00000000-0000-4000-8000-0000000000a1/ok.png', 'orders/00000000-0000-4000-8000-0000000000a2/p.png'] where id = '00000000-0000-4000-8000-0000000000d1'$q$);
select pg_temp.p('s_path_preview_empty', '22023', $q$update public.order_item_labels set preview_paths = array[''] where id = '00000000-0000-4000-8000-0000000000d1'$q$);
select pg_temp.p('s_path_preview_ok', 'OK rows=1', $q$update public.order_item_labels set preview_paths = array['orders/00000000-0000-4000-8000-0000000000a1/ok.png'] where id = '00000000-0000-4000-8000-0000000000d1'$q$);
select pg_temp.p('s_path_card', '22023', $q$update public.order_notes_cards set image_path = 'orders/00000000-0000-4000-8000-0000000000a2/n.png' where id = '00000000-0000-4000-8000-0000000000e1'$q$);
-- перенос строки в другой заказ / позицию
select pg_temp.p('s_move_print', '42501', $q$update public.order_item_prints set item_id = '00000000-0000-4000-8000-0000000000b5' where id = '00000000-0000-4000-8000-0000000000c1'$q$);
select pg_temp.p('s_move_card', '42501', $q$update public.order_notes_cards set order_id = '00000000-0000-4000-8000-0000000000a5' where id = '00000000-0000-4000-8000-0000000000e1'$q$);
-- удаление
select pg_temp.p('s_delete_sent', '42501', $q$delete from public.orders where id = '00000000-0000-4000-8000-0000000000a3'$q$);
select pg_temp.p('s_delete_draft_erp', '42501 Удалить можно только черновик', $q$delete from public.orders where id = '00000000-0000-4000-8000-0000000000a9'$q$);
select pg_temp.p('s_delete_draft', 'OK rows=1', $q$delete from public.orders where id = '00000000-0000-4000-8000-0000000000a5'$q$);
select pg_temp.p('s_parent_deleted', 'OK true', $q$select (parent_id is null)::text from public.orders where id = '00000000-0000-4000-8000-0000000000a3'$q$);
-- журнал: прямой записи нет
select pg_temp.p('s_events_insert', '42501', $q$insert into public.order_events (order_id, kind) values ('00000000-0000-4000-8000-0000000000a1', 'status')$q$);
select pg_temp.p('s_events_update', '42501', $q$update public.order_events set reason = 'x'$q$);
-- RPC
select pg_temp.p('s_tr_bad', 'P0001', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a1', 'production')$q$);
select pg_temp.p('s_tr_bad_status', '22023', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a1', 'hacked')$q$);
select pg_temp.p('s_tr_foreign', '42501 Заказ не найден или недоступен', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a2', 'ready_to_launch')$q$);
select pg_temp.p('s_tr_missing', '42501 Заказ не найден или недоступен', $q$select public.order_v4_transition(gen_random_uuid(), 'ready_to_launch')$q$);
select pg_temp.p('s_send', 'OK {"id": "00000000-0000-4000-8000-0000000000a1", "status": "ready_to_launch"', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a1', 'ready_to_launch')::text$q$);
select pg_temp.p('s_sent_at', 'OK true', $q$select (sent_at is not null)::text from public.orders where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('s_pay', 'OK {"id": "00000000-0000-4000-8000-0000000000a1", "paid_at": "', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-0000000000a1', 'prepaid')::text$q$);
select pg_temp.p('s_pay_override', '42501', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-0000000000a1', null, 'без оплаты')$q$);
select pg_temp.p('s_pay_bad_kind', '22023', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-0000000000a1', 'partial')$q$);
select pg_temp.p('s_launch_check', '42501', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-0000000000a3')$q$);
-- Миграция D: ревизия клиента — в ОБЕИХ функциях; позиция без поля supplier
-- в аргументе (клиент до вехи 3) стёрла бы поставщика — отказ до записи
select pg_temp.p('s_save_no_rev', 'P0001 Вышло обновление', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000a10", "items": [{"key": "00000000-0000-4000-8000-000000000b10"}]}'::jsonb)$q$);
select pg_temp.p('s_save_no_rev_kept', 'OK Поставщик-проба', $q$select supplier from public.order_items where id = '00000000-0000-4000-8000-000000000b10'$q$);
select pg_temp.p('s_save_rev_2', 'P0001 Вышло обновление', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000a10", "client_rev": 2, "items": [{"key": "00000000-0000-4000-8000-000000000b10"}]}'::jsonb)$q$);
select pg_temp.p('s_save_inner_no_rev', 'P0001 Вышло обновление', $q$select public.order_v4_save('{"id": "00000000-0000-4000-8000-000000000a10", "items": [{"key": "00000000-0000-4000-8000-000000000b10"}]}'::jsonb)$q$);
select pg_temp.p('s_save_inner_kept', 'OK Поставщик-проба', $q$select supplier from public.order_items where id = '00000000-0000-4000-8000-000000000b10'$q$);
-- конкурентная правка: версия не та — отказ; та — запись
select pg_temp.p('s_save_stale', 'P0001 Заказ изменён в другой вкладке', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000a10", "client_rev": 3, "expected_updated_at": "2000-01-01T00:00:00Z", "title": "из старой вкладки", "items": [{"key": "00000000-0000-4000-8000-000000000b10", "supplier": "Поставщик-проба"}]}'::jsonb)$q$);
select pg_temp.p('s_save_stale_kept', 'OK true', $q$select (title is distinct from 'из старой вкладки')::text from public.orders where id = '00000000-0000-4000-8000-000000000a10'$q$);
select pg_temp.p('s_save_ok', 'OK {"id": "00000000-0000-4000-8000-000000000a10"', $q$select public.order_v4_save_full(jsonb_build_object(
    'id', '00000000-0000-4000-8000-000000000a10', 'client_rev', 3, 'title', 'проба D',
    'expected_updated_at', (select updated_at from public.orders where id = '00000000-0000-4000-8000-000000000a10'),
    'items', jsonb_build_array(jsonb_build_object('key', '00000000-0000-4000-8000-000000000b10', 'supplier', 'Поставщик-проба'))))::text$q$);
select pg_temp.p('s_save_ok_effect', 'OK проба D/Поставщик-проба', $q$select o.title || '/' || i.supplier from public.orders o join public.order_items i on i.order_id = o.id where o.id = '00000000-0000-4000-8000-000000000a10'$q$);
-- без версии (прямой вызов, клиент без ключа) — сверки нет, запись проходит
select pg_temp.p('s_save_no_expected', 'OK {"id": "00000000-0000-4000-8000-000000000a10"', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000a10", "client_rev": 3, "title": "проба D", "items": [{"key": "00000000-0000-4000-8000-000000000b10", "supplier": "Поставщик-проба"}]}'::jsonb)::text$q$);
-- отправленный заказ: правку закрывает страж, текст «правка закрыта» (клиент: locked)
select pg_temp.p('s_save_sent', '42501 Заказ отправлен в работу — правка закрыта', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-0000000000a6", "client_rev": 3, "items": [{"key": "00000000-0000-4000-8000-0000000000b6"}]}'::jsonb)$q$);
-- v3 как раньше
select pg_temp.p('s_v3_update', 'OK rows=1', $q$update public.orders set data = '{"x":2}' where id = '00000000-0000-4000-8000-0000000000a4'$q$);
select pg_temp.p('s_v3_insert', 'OK rows=1', $q$insert into public.orders (order_number, created_by, data) values ('PROBE-V3', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}')$q$);
select pg_temp.p('s_v3_status', 'OK rows=1', $q$update public.orders set status = 'review' where id = '00000000-0000-4000-8000-0000000000a4'$q$);
reset role;

-- ── SELLER2: начальник цеха с профилем manager — чужие не видит ──────────
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('s2_sees', 'OK PROBE-2', $q$select string_agg(order_number, ',' order by order_number) from public.orders where order_number like 'PROBE-%'$q$);
select pg_temp.p('s2_foreign_update', 'OK rows=0', $q$update public.orders set title = 'x' where id = '00000000-0000-4000-8000-0000000000a1'$q$);
-- чужой заказ с неверной версией: отказ «не найден», а не «изменён» — сверка
-- версии не выдаёт существование невидимого заказа
select pg_temp.p('s2_save_foreign_stale', '42501 Заказ не найден или недоступен', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000a10", "client_rev": 3, "expected_updated_at": "2000-01-01T00:00:00Z"}'::jsonb)$q$);
reset role;

-- ── HEAD: начальник цеха с профилем manager, без признака ────────────────
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('head_not_seller', 'OK false', $q$select public.sales_is_seller()::text$q$);
select pg_temp.p('head_sees', 'OK null', $q$select string_agg(order_number, ',') from public.orders where order_number like 'PROBE-%'$q$);
select pg_temp.p('head_insert', '42501', $q$insert into public.orders (order_number, created_by, data) values ('PROBE-H1', '05bbc552-bca2-490d-b275-46a3084dca7c', '{}')$q$);
select pg_temp.p('head_update_foreign', 'OK rows=0', $q$update public.orders set title = 'x' where id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('head_self_set_sales', 'OK rows=0', $q$update public.profiles set is_sales = true where id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
select pg_temp.p('head_set_staff', '42501 Отмечать', $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', true)$q$);
reset role;

-- ── PENDING: признак есть, профиль не одобрен ────────────────────────────
select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;
select pg_temp.p('pending_not_seller', 'OK false', $q$select public.sales_is_seller()::text$q$);
select pg_temp.p('pending_save', '42501', $q$insert into public.orders (order_number, created_by, data) values ('PROBE-P1', 'cc9ed453-d3d7-4add-a361-8719a7701f97', '{}')$q$);
reset role;

-- ── ADMIN: признак продавца ─────────────────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
-- прямая запись признака — отказ стража даже у админа (политика profiles_update его пускает)
select pg_temp.p('self_set_sales', '42501 Признак «Менеджер продаж»', $q$update public.profiles set is_sales = true where id = 'b9c3e42e-9e07-44c2-8b15-839ce327c40c'$q$);
select pg_temp.p('admin_direct_sales', '42501 Признак «Менеджер продаж»', $q$update public.profiles set is_sales = true where id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
select pg_temp.p('admin_insert_sales', '42501 Признак «Менеджер продаж»', $q$insert into public.profiles (id, name, role, is_sales) values (gen_random_uuid(), 'проба', 'manager', true)$q$);
-- остальные колонки профиля админ правит как раньше
select pg_temp.p('admin_other_columns', 'OK rows=1', $q$update public.profiles set name = name where id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
select pg_temp.p('admin_list_staff', 'OK true', $q$select bool_or(id = '05bbc552-bca2-490d-b275-46a3084dca7c' and not is_sales)::text from public.sales_staff_list()$q$);
select pg_temp.p('admin_set_staff_missing', 'P0002', $q$select public.sales_set_staff(gen_random_uuid(), true)$q$);
select pg_temp.p('admin_set_staff_null', '22023', $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', null)$q$);
select pg_temp.p('admin_set_staff', 'OK', $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', true)$q$);
select pg_temp.p('admin_set_staff_effect', 'OK true', $q$select is_sales::text from public.profiles where id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
reset role;
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('head_now_seller', 'OK true', $q$select public.sales_is_seller()::text$q$);
reset role;
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('admin_unset_staff', 'OK', $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', false)$q$);
reset role;
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('head_seller_again_off', 'OK false', $q$select public.sales_is_seller()::text$q$);
reset role;

-- ── MS ──────────────────────────────────────────────────────────────────
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms_is_ms', 'OK true', $q$select public.sales_is_ms()::text$q$);
select pg_temp.p('ms_sees', 'OK PROBE-1,PROBE-3,PROBE-6,PROBE-7,PROBE-8', $q$select string_agg(order_number, ',' order by order_number) from public.orders where order_number like 'PROBE-%'$q$);
select pg_temp.p('ms_direct_update', 'OK rows=0', $q$update public.orders set title = 'x' where id = '00000000-0000-4000-8000-0000000000a3'$q$);
select pg_temp.p('ms_item_update', '42501', $q$update public.order_items set tz_comment = 'x' where id = '00000000-0000-4000-8000-0000000000b3'$q$);
select pg_temp.p('ms_draft_hidden', '42501 Заказ не найден или недоступен', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a2', 'ready_to_launch')$q$);
select pg_temp.p('ms_back_no_reason', 'P0001 Укажите причину', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a3', 'draft')$q$);
select pg_temp.p('ms_prod_no_check', 'P0001 Сначала проверка запуска', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a3', 'production')$q$);
select pg_temp.p('ms_check_unpaid', 'OK {"ok": false, "reason": "Нет отметки оплаты"}', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-0000000000a3')::text$q$);
select pg_temp.p('ms_pay', '42501', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-0000000000a3', 'full')$q$);
select pg_temp.p('ms_capture_conflict', 'OK {"ok": false, "reason": "Заказ ERP с этой связью создан не этим запуском', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-0000000000a6')::text$q$);
select pg_temp.p('ms_back_with_erp', 'P0001 Заказ уже создан в производстве', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a6', 'draft', 'правка')$q$);
select pg_temp.p('ms_cancelled_erp', 'OK {"ok": false, "reason": "Прежний заказ ERP отменён', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-0000000000a8')::text$q$);
select pg_temp.p('ms_back_ok', 'OK {"id": "00000000-0000-4000-8000-0000000000a7", "status": "draft"', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a7', 'draft', 'нет размеров')::text$q$);
reset role;

-- ── ADMIN: запуск без оплаты — причина руководителя ─────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('a_override', 'OK {"id": "00000000-0000-4000-8000-0000000000a3", "paid_at": null, "paid_kind": null, "paid_override_reason": "постоянный клиент"}', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-0000000000a3', null, 'постоянный клиент')::text$q$);
select pg_temp.p('a_archive_foreign', 'OK {"id": "00000000-0000-4000-8000-0000000000a2", "status": "archived"', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a2', 'archived')::text$q$);
reset role;

-- ── MS: проверка запуска, заказ ERP, переход; сирота при повторе ──────────
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms_check_ok', 'OK {"ok": true, "already": false, "launch_started_at": "', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-0000000000a3')::text$q$);
select pg_temp.p('ms_prod_no_erp', 'P0001 Заказ ERP этого запуска не найден', $q$select public.order_v4_transition('00000000-0000-4000-8000-0000000000a3', 'production')$q$);
reset role;
select pg_temp.as_user(null);
insert into public.erp_orders (title, tz_order_id, tz_number)
values ('PROBE запуск 3', '00000000-0000-4000-8000-0000000000a3', 'PROBE-3');
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms_prod_ok', 'OK production', $q$select (public.order_v4_transition('00000000-0000-4000-8000-0000000000a3', 'production'))->>'status'$q$);
select pg_temp.p('ms_prod_link', 'OK true', $q$select (erp_order_id = (select id from public.erp_orders where tz_order_id = '00000000-0000-4000-8000-0000000000a3') and launched_by is not null)::text from public.orders where id = '00000000-0000-4000-8000-0000000000a3'$q$);
select pg_temp.p('ms_prod_repeat', 'OK production', $q$select (public.order_v4_transition('00000000-0000-4000-8000-0000000000a3', 'production'))->>'status'$q$);
select pg_temp.p('ms_check_after', 'OK {"ok": true, "already": true', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-0000000000a3')::text$q$);
select pg_temp.p('ms_item_after_launch', '42501', $q$delete from public.order_items where id = '00000000-0000-4000-8000-0000000000b3'$q$);
select pg_temp.p('ms_done', 'OK done', $q$select (public.order_v4_transition('00000000-0000-4000-8000-0000000000a3', 'done'))->>'status'$q$);
reset role;

-- a1: проверка, затем заказ ERP, переход «потерян» — повтор проверки и перехода
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms_check_a1', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-0000000000a1')::text$q$);
reset role;
select pg_temp.as_user(null);
insert into public.erp_orders (title, tz_order_id, tz_number)
values ('PROBE сирота 1', '00000000-0000-4000-8000-0000000000a1', 'PROBE-1');
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms_orphan_retry_check', 'OK {"ok": true, "already": true', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-0000000000a1')::text$q$);
select pg_temp.p('ms_orphan_retry_prod', 'OK production', $q$select (public.order_v4_transition('00000000-0000-4000-8000-0000000000a1', 'production'))->>'status'$q$);
reset role;

-- ── ERP удаляет свой заказ: заказ v4 в production теряет только ссылку ──
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('a_erp_delete', 'OK rows=1', $q$delete from public.erp_orders where tz_order_id = '00000000-0000-4000-8000-0000000000a1'$q$);
select pg_temp.p('a_erp_delete_effect', 'OK production/null', $q$select status || '/' || coalesce(erp_order_id::text, 'null') from public.orders where id = '00000000-0000-4000-8000-0000000000a1'$q$);
reset role;

-- ── Отключённый профиль ничего не видит ─────────────────────────────────
select pg_temp.as_user(null);
update public.profiles set active = false where id = 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26';
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('off_sees', 'OK null', $q$select string_agg(order_number, ',') from public.orders where order_number like 'PROBE-%'$q$);
reset role;

-- ── Журнал (как ADMIN) ──────────────────────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('a_events', 'OK a1:payment:prepaid,a1:status:draft>ready_to_launch,a1:status:ready_to_launch>production,a2:status:draft>archived,a3:payment:-,a3:status:production>done,a3:status:ready_to_launch>production,a7:status:ready_to_launch>draft',
  $q$select string_agg(right(o.id::text, 2) || ':' || e.kind || ':' ||
       case e.kind when 'status' then e.from_status || '>' || e.to_status else coalesce(e.payment_kind, '-') end, ','
       order by right(o.id::text, 2), e.kind, e.from_status, e.payment_kind)
     from public.order_events e join public.orders o on o.id = e.order_id
    where o.order_number like 'PROBE-%'$q$);
select pg_temp.p('a_events_actor', 'OK 0', $q$select count(*)::text from public.order_events e join public.orders o on o.id = e.order_id where o.order_number like 'PROBE-%' and e.actor is null$q$);
reset role;
select pg_temp.as_user(null);

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
