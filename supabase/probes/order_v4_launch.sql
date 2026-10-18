-- Пробы миграции J (20261018120000_order_v4_launch, веха 6+7): «Отправить в работу»,
-- оплата МС, проверка запуска и переход в production.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=162 {…}
--
-- До применения J — только сухим прогоном вместе с ней (1-dryrun-J.sql: предусловие, J,
-- этот файл). На схеме без J (B/F) файл обязан дать fails>0 — это «красный» прогон
-- задачи 1. Как запускать — supabase/probes/README.md.
--
-- Миграций здесь НЕТ. Заказы — только суперпользователем с явным order_number 'PROBE-J…'
-- (order_number_seq не тратится: последняя проба сверяет last_value до и после).
-- Объекты Storage вставляются строкой storage.objects внутри транзакции (откат уберёт).
-- Роли — существующие профили боя (SELECT 18.10); признаки, роль и должность ERP
-- меняются внутри транзакции (откат вернёт):
--   ADMIN  b9c3e42e-…  admin, строки erp_employees нет
--   DIR    36a4e89d-…  designer → director, строки erp_employees нет
--   SELLER 9285888e-…  manager → production, is_sales (продавец с ролью не manager);
--                      должность ERP production_head (как у всех 10 продавцов боя на 18.10:
--                      tz.manage и order.manage ЕСТЬ); раздел «Остаточный путь» понижает её
--                      до worker внутри транзакции (сценарий плана «продавец без tz.manage»)
--   OLDMGR e73bd7fd-…  manager без is_sales (автор старых черновиков)
--   MS1    f13c33f3-…  is_ms, должность ERP manager
--   MS2    05bbc552-…  is_ms, должность ERP production_head
--   MSW    72b71eba-…  is_ms, должность ERP worker (нет order.manage / tz.manage)
--   MSA    43a8021c-…  is_ms без is_sales, автор (created_by) своего заказа
--   ROP    22d22715-…  manager → rop
--   ROP2   64a22c1f-…  manager → rop
--   OFF    cc9ed453-…  отключён и не одобрен
-- Если профили на бою изменятся — пробы покажут FAIL: правьте данные пробы, а не ожидания.
-- Имя запускающего в отказах — живое имя профиля, поэтому ожидание — начало текста.
--
-- Разбор по разделам: автор, отправка (PDF и макеты в бакете, версия заказа), launch_check
-- (права ERP до метки, чужая метка 10 минут, продление, разделение обязанностей),
-- erp_create_order от имени МС, переход в production (p_erp_order_id, подлинность),
-- подделка связи с ERP, старая копия ТЗ, гонки обязанностей, гонка возврата, set_payment МС,
-- sales_set_staff, Storage у МС.
--
-- Storage у МС: запись в erp-attachments на бою гейтует политика erp_att_upload =
-- erp_is_member() (любой активный и одобренный). Продавец и МС с должностью worker туда
-- ПИШУТ (пробы фиксируют это как факт, К13); не пускает их launch_check (права ERP).
-- erp_has_permission у admin/director без строки ERP — роль 'director' (права есть),
-- erp_is_member — true: проверка запуска и запись в бакет дают один итог.
--
-- ОСТАТОЧНЫЙ ПУТЬ ПОДДЕЛКИ (известный факт, ревью задачи 1, раунды 1–2; закрыть внутри J без
-- правки ERP нельзя — erp_orders.created_by и erp_tz_documents.uploaded_by без умолчания,
-- аудит пишет только UPDATE): order_v4_erp_authentic сверяет ВЛАДЕЛЬЦА объекта Storage
-- (= launch_by) и то, что путь не привязан к другому заказу ERP (oldcopy_*: копия прошлого
-- запуска того же МС — не подлинная). Продавец с правом ERP tz.manage (на бою — должность
-- production_head) после метки МС вставляет свой erp_orders с tz_order_id, позицию
-- и erp_tz_documents с путём к НЕПРИВЯЗАННОЙ копии ТЗ этого МС — копии текущей попытки или
-- остатку неудачного запуска любого другого заказа (ключи видны любому члену ERP списком
-- бакета). Тогда launch_check отвечает already с поддельным erp_order_id, а
-- transition(production) проходит — пробы resid_* фиксируют это как OK.
-- Без tz.manage (должность worker) вставка документа ТЗ — 42501 (resid_worker_doc), запись
-- в бакет — OK (К13). Решение — за владельцем: снять у продавцов production_head, принять
-- риск или ослабить заморозку ERP (README, раздел «Остаточный путь подделки»).
--
-- РАЗДЕЛЕНИЕ ОБЯЗАННОСТЕЙ (находка 2, раунд 2): переход в production повторяет проверки
-- launch_check (race_*), set_payment не меняет оплату при свежей метке и созданном заказе
-- ERP, старую метку снимает (toctou_*).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

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

-- Ответ пробы как jsonb (для сверки updated_at ответа с orders.updated_at)
create function pg_temp.r(p_name text) returns jsonb language sql as $f$
  select substr(current_setting('probe.r.' || p_name, true), 4)::jsonb;
$f$;

-- ── Данные (суперпользователь, auth.uid() пуст — стражи пропускают) ──────
select pg_temp.as_user(null);
select set_config('probe.seq_before', (select last_value::text from public.order_number_seq), true);

update public.profiles set is_sales = false, is_ms = false
 where id in ('b9c3e42e-9e07-44c2-8b15-839ce327c40c', '36a4e89d-3012-4a7c-9386-224a42b661db', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', '22d22715-1487-480a-aea1-53a7bd52df2d', '64a22c1f-35b6-4e90-9cc1-cd6e04cc94b6');
update public.profiles set role = 'director' where id = '36a4e89d-3012-4a7c-9386-224a42b661db';
update public.profiles set role = 'production', is_sales = true, is_ms = false where id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
update public.profiles set is_ms = true, is_sales = false where id in ('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', '05bbc552-bca2-490d-b275-46a3084dca7c', '72b71eba-f8a3-493d-aab5-25d7b7bb87dc', '43a8021c-6ddc-4a25-88f6-62e13b46c1c5');
update public.profiles set role = 'rop' where id in ('22d22715-1487-480a-aea1-53a7bd52df2d', '64a22c1f-35b6-4e90-9cc1-cd6e04cc94b6');
update public.erp_employees set role = 'manager' where profile_id = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9';
update public.erp_employees set role = 'worker' where profile_id = '72b71eba-f8a3-493d-aab5-25d7b7bb87dc';

insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date)
values
  ('00000000-0000-4000-8000-000067010001',  'PROBE-J1',  4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010002',  'PROBE-J2',  4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010003',  'PROBE-J3',  4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010004',  'PROBE-J4',  4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010005',  'PROBE-J5',  4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010007',  'PROBE-J7',  4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010008',  'PROBE-J8',  4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010009',  'PROBE-J9',  4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010010', 'PROBE-J10', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010011', 'PROBE-J11', 4, 'draft', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010012', 'PROBE-J12', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067010013', 'PROBE-J13', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', null, current_date + 10),
  ('00000000-0000-4000-8000-000067010014', 'PROBE-J14', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', null),
  ('00000000-0000-4000-8000-000067010015', 'PROBE-J15', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020001',  'PROBE-J21', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020002',  'PROBE-J22', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020003',  'PROBE-J23', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020004',  'PROBE-J24', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020005',  'PROBE-J25', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020007',  'PROBE-J27', 4, 'ready_to_launch', '43a8021c-6ddc-4a25-88f6-62e13b46c1c5',    '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020008',  'PROBE-J28', 4, 'ready_to_launch', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c',  '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020009',  'PROBE-J29', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020010', 'PROBE-J30', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020011', 'PROBE-J31', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020012', 'PROBE-J32', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020013', 'PROBE-J33', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020014', 'PROBE-J34', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020015', 'PROBE-J35', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020016', 'PROBE-J36', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020017', 'PROBE-J37', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020018', 'PROBE-J38', 4, 'ready_to_launch', '43a8021c-6ddc-4a25-88f6-62e13b46c1c5',    '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000067020019', 'PROBE-J39', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10);
update public.orders set paid_at = now(), paid_kind = 'full'
 where id in ('00000000-0000-4000-8000-000067020001', '00000000-0000-4000-8000-000067020002', '00000000-0000-4000-8000-000067020003', '00000000-0000-4000-8000-000067020004', '00000000-0000-4000-8000-000067020005', '00000000-0000-4000-8000-000067020007', '00000000-0000-4000-8000-000067020008', '00000000-0000-4000-8000-000067020009', '00000000-0000-4000-8000-000067020013', '00000000-0000-4000-8000-000067020014', '00000000-0000-4000-8000-000067020015', '00000000-0000-4000-8000-000067020016', '00000000-0000-4000-8000-000067020018', '00000000-0000-4000-8000-000067020019');

-- Позиции: у L1 два нанесения (dtf с макетом и «прочее» без), у остальных черновиков — по одному
insert into public.order_items (id, order_id, tz_pdf_path) values
  ('00000000-0000-4000-8000-000067030001',  '00000000-0000-4000-8000-000067010001',  'orders/00000000-0000-4000-8000-000067010001/tz/t.pdf'),
  ('00000000-0000-4000-8000-000067030002',  '00000000-0000-4000-8000-000067010002',  ''),
  ('00000000-0000-4000-8000-000067030003',  '00000000-0000-4000-8000-000067010003',  'orders/00000000-0000-4000-8000-000067010003/tz/none.pdf'),
  ('00000000-0000-4000-8000-000067030004',  '00000000-0000-4000-8000-000067010004',  'orders/00000000-0000-4000-8000-000067010004/tz/x.pdf'),
  ('00000000-0000-4000-8000-000067030005',  '00000000-0000-4000-8000-000067010005',  'orders/00000000-0000-4000-8000-000067010005/tz/big.pdf'),
  ('00000000-0000-4000-8000-000067030007',  '00000000-0000-4000-8000-000067010007',  'orders/00000000-0000-4000-8000-000067010007/logo/x.pdf'),
  ('00000000-0000-4000-8000-000067030008',  '00000000-0000-4000-8000-000067010008',  'orders/00000000-0000-4000-8000-000067010008/tz/t.pdf'),
  ('00000000-0000-4000-8000-000067030009',  '00000000-0000-4000-8000-000067010009',  'orders/00000000-0000-4000-8000-000067010009/tz/t.pdf'),
  ('00000000-0000-4000-8000-000067030010', '00000000-0000-4000-8000-000067010010', 'orders/00000000-0000-4000-8000-000067010010/tz/t.pdf'),
  ('00000000-0000-4000-8000-000067030011', '00000000-0000-4000-8000-000067010011', 'orders/00000000-0000-4000-8000-000067010011/tz/t.pdf'),
  ('00000000-0000-4000-8000-000067030013', '00000000-0000-4000-8000-000067010013', 'orders/00000000-0000-4000-8000-000067010013/tz/t.pdf'),
  ('00000000-0000-4000-8000-000067030014', '00000000-0000-4000-8000-000067010014', 'orders/00000000-0000-4000-8000-000067010014/tz/t.pdf'),
  ('00000000-0000-4000-8000-000067040001', '00000000-0000-4000-8000-000067020001', ''), ('00000000-0000-4000-8000-000067040002', '00000000-0000-4000-8000-000067020002', ''), ('00000000-0000-4000-8000-000067040003', '00000000-0000-4000-8000-000067020003', ''), ('00000000-0000-4000-8000-000067040004', '00000000-0000-4000-8000-000067020004', ''),
  ('00000000-0000-4000-8000-000067040005', '00000000-0000-4000-8000-000067020005', ''), ('00000000-0000-4000-8000-000067040007', '00000000-0000-4000-8000-000067020007', ''), ('00000000-0000-4000-8000-000067040008', '00000000-0000-4000-8000-000067020008', ''), ('00000000-0000-4000-8000-000067040009', '00000000-0000-4000-8000-000067020009', ''),
  ('00000000-0000-4000-8000-000067040010', '00000000-0000-4000-8000-000067020010', ''), ('00000000-0000-4000-8000-000067040011', '00000000-0000-4000-8000-000067020011', ''), ('00000000-0000-4000-8000-000067040012', '00000000-0000-4000-8000-000067020012', ''), ('00000000-0000-4000-8000-000067040014', '00000000-0000-4000-8000-000067020014', ''),
  ('00000000-0000-4000-8000-000067040015', '00000000-0000-4000-8000-000067020015', ''), ('00000000-0000-4000-8000-000067040016', '00000000-0000-4000-8000-000067020016', ''), ('00000000-0000-4000-8000-000067040017', '00000000-0000-4000-8000-000067020017', ''), ('00000000-0000-4000-8000-000067040018', '00000000-0000-4000-8000-000067020018', ''), ('00000000-0000-4000-8000-000067040019', '00000000-0000-4000-8000-000067020019', '');
insert into public.order_item_prints (item_id, method, artwork_path) values
  ('00000000-0000-4000-8000-000067030001', 'dtf', 'orders/00000000-0000-4000-8000-000067010001/a.png'),
  ('00000000-0000-4000-8000-000067030001', 'other', ''),
  ('00000000-0000-4000-8000-000067030008', 'dtf', ''),
  ('00000000-0000-4000-8000-000067030009', 'dtf', 'orders/00000000-0000-4000-8000-000067010009/none.png'),
  ('00000000-0000-4000-8000-000067030010', 'silkscreen', 'orders/00000000-0000-4000-8000-000067010010/a.pdf');
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010001/tz/t.pdf',  '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "application/pdf", "size": 120000}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010001/a.png',     '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "image/png", "size": 5000}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010004/tz/x.pdf',  '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "image/svg+xml", "size": 500}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010005/tz/big.pdf', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "application/pdf", "size": 8388609}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010007/logo/x.pdf', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "application/pdf", "size": 1000}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010008/tz/t.pdf',  '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "application/pdf", "size": 1000}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010009/tz/t.pdf',  '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "application/pdf", "size": 1000}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010010/tz/t.pdf', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "application/pdf", "size": 8388608}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010010/a.pdf',    '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"mimetype": "application/pdf", "size": 1000}'),
  ('order-artworks', 'orders/00000000-0000-4000-8000-000067010011/tz/t.pdf', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', '{"mimetype": "application/pdf", "size": 1000}');

-- R12: метка стоит, оплаты нет (переход отвечает «Нет отметки оплаты»)
update public.orders set launch_started_at = now() - interval '20 minutes', launch_by = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9' where id = '00000000-0000-4000-8000-000067020012';
-- R39: метка МС1 старше 10 минут, заказ ERP этого запуска уже есть — оплату не сменить
update public.orders set launch_started_at = now() - interval '11 minutes', launch_by = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9' where id = '00000000-0000-4000-8000-000067020019';
insert into public.erp_orders (id, title, tz_order_id, tz_number) values ('00000000-0000-4000-8000-000067050019', 'PROBE запуск J39', '00000000-0000-4000-8000-000067020019', 'PROBE-J39');
-- R5: метка МС1 старше 10 минут — возврат другим МС разрешён
update public.orders set launch_started_at = now() - interval '11 minutes', launch_by = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9' where id = '00000000-0000-4000-8000-000067020005';

-- ── Без входа ───────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.p('anon_tr', '42501 Нужен вход в систему', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010001', 'ready_to_launch')$q$);
select pg_temp.p('anon_check', '42501 Нужен вход в систему', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')$q$);
select pg_temp.p('anon_pay', '42501 Нужен вход в систему', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020001', 'full')$q$);
-- хелпер подлинности клиенту закрыт
select pg_temp.p('helper_closed', 'OK false', $q$select has_function_privilege('authenticated', 'public.order_v4_erp_authentic(uuid, uuid)', 'execute')::text$q$);
reset role;

-- ── SELLER: автор по is_sales (роль профиля production) ─────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('s_is_seller', 'OK true', $q$select public.sales_is_seller()::text$q$);
-- путь чужого заказа в tz_pdf_path не записать вовсе (страж B); сервер при отправке проверяет и сам
select pg_temp.p('s_foreign_tz_path', '22023 Путь файла не принадлежит заказу', $q$update public.order_items set tz_pdf_path = 'orders/00000000-0000-4000-8000-000067010002/tz/t.pdf' where id = '00000000-0000-4000-8000-000067030001'$q$);
select pg_temp.p('s_bad_status', '22023 Неизвестный статус заказа', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010001', 'hacked')$q$);
select pg_temp.p('s_long_reason', '22023 Причина — не длиннее 500 символов', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010001', 'archived', repeat('x', 501))$q$);
select pg_temp.p('s_pay_bad_kind', '22023 Вид оплаты: prepaid или full', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067010001', 'partial')$q$);
select pg_temp.p('s_pay_long', '22023 Причина — не длиннее 500 символов', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067010001', 'full', repeat('x', 501))$q$);
select pg_temp.p('s_pay_override', '42501 Запуск без оплаты разрешает только руководитель', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067010001', null, 'без оплаты')$q$);
select pg_temp.p('s_pay', 'OK {"id": "00000000-0000-4000-8000-000067010001", "status": "draft", "paid_at": "', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067010001', 'prepaid')::text$q$);
select pg_temp.p('s_pay_updated_at', 'OK true', $q$select ((pg_temp.r('s_pay')->>'updated_at')::timestamptz = updated_at)::text from public.orders where id = '00000000-0000-4000-8000-000067010001'$q$);
-- отправка: версия заказа — первой проверкой (даже при пустом PDF)
select pg_temp.p('s_send_stale_no_pdf', 'P0001 Заказ изменён в другой вкладке — обновите страницу', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010002', 'ready_to_launch', p_expected_updated_at => '2000-01-01T00:00:00Z')$q$);
select pg_temp.p('s_send_no_pdf', 'P0001 Сформируйте ТЗ — PDF позиции не найден в хранилище', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010002', 'ready_to_launch')$q$);
select pg_temp.p('s_send_no_object', 'P0001 Сформируйте ТЗ', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010003', 'ready_to_launch')$q$);
select pg_temp.p('s_send_svg_as_pdf', 'P0001 Сформируйте ТЗ', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010004', 'ready_to_launch')$q$);
select pg_temp.p('s_send_pdf_8mb', 'P0001 Сформируйте ТЗ', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010005', 'ready_to_launch')$q$);
select pg_temp.p('s_send_not_tz_dir', 'P0001 Сформируйте ТЗ', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010007', 'ready_to_launch')$q$);
select pg_temp.p('s_send_no_artwork', 'P0001 У нанесения нет макета', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010008', 'ready_to_launch')$q$);
select pg_temp.p('s_send_artwork_no_object', 'P0001 У нанесения нет макета', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010009', 'ready_to_launch')$q$);
select pg_temp.p('s_send_no_customer', 'P0001 Не указан клиент', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010013', 'ready_to_launch')$q$);
select pg_temp.p('s_send_no_due', 'P0001 Не указан срок', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010014', 'ready_to_launch')$q$);
select pg_temp.p('s_send_no_items', 'P0001 В заказе нет позиций', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010015', 'ready_to_launch')$q$);
select pg_temp.p('s_send_stale', 'P0001 Заказ изменён в другой вкладке', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010001', 'ready_to_launch', p_expected_updated_at => '2000-01-01T00:00:00Z')$q$);
select pg_temp.p('s_send_ok', 'OK {"id": "00000000-0000-4000-8000-000067010001", "status": "ready_to_launch", "sent_at": "', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010001', 'ready_to_launch',
    p_expected_updated_at => (select updated_at from public.orders where id = '00000000-0000-4000-8000-000067010001'))::text$q$);
select pg_temp.p('s_send_updated_at', 'OK true', $q$select ((pg_temp.r('s_send_ok')->>'updated_at')::timestamptz = updated_at)::text from public.orders where id = '00000000-0000-4000-8000-000067010001'$q$);
-- старый клиент (без версии): PDF 8 МБ ровно и макет PDF — проходят
select pg_temp.p('s_send_old_client', 'OK {"id": "00000000-0000-4000-8000-000067010010", "status": "ready_to_launch"', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010010', 'ready_to_launch')::text$q$);
select pg_temp.p('s_archive', 'OK {"id": "00000000-0000-4000-8000-000067010012", "status": "archived"', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010012', 'archived')::text$q$);
select pg_temp.p('s_launch_check', '42501 Запустить заказ может МС или руководитель производства', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')$q$);
select pg_temp.p('s_done_ready', 'P0001 Такой переход статуса недоступен', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020001', 'done')$q$);
reset role;

-- ── OLDMGR: роль manager без is_sales — свой старый черновик больше не его ──
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('old_send', '42501 Заказ не найден или недоступен', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010011', 'ready_to_launch')$q$);
select pg_temp.p('old_pay', '42501 Заказ не найден или недоступен', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067010011', 'prepaid')$q$);
select pg_temp.p('old_check', '42501 Заказ не найден или недоступен', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067010011')$q$);
reset role;

-- ── MSW: МС с должностью worker — отказ до метки ────────────────────────
select pg_temp.as_user('72b71eba-f8a3-493d-aab5-25d7b7bb87dc');
set local role authenticated;
select pg_temp.p('msw_check', 'OK {"ok": false, "reason": "Нет прав производства на создание заказа и ТЗ — попросите администратора', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')::text$q$);
select pg_temp.p('msw_no_label', 'OK true', $q$select (launch_started_at is null)::text from public.orders where id = '00000000-0000-4000-8000-000067020001'$q$);
select pg_temp.p('msw_pay', '42501 Нет прав производства на отметку оплаты', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020011', 'prepaid')$q$);
select pg_temp.p('msw_create', '42501', $q$select public.erp_create_order(jsonb_build_object(
    'order', jsonb_build_object('title', 'PROBE worker'),
    'items', jsonb_build_array(jsonb_build_object('product_type', 'Футболка', 'qty', 1,
      'stages', jsonb_build_array(jsonb_build_object('department_id', (select id from public.erp_departments where active limit 1))))),
    'tz', jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('group_id', gen_random_uuid(), 'item_index', 0,
      'file_path', 'tz/v4-00000000-0000-4000-8000-000000000000/g/v1-tz.pdf', 'mime_type', 'application/pdf')))))::text$q$);
-- Storage: бакет erp-attachments пускает любого одобренного (erp_is_member) — гейт МС в launch_check
select pg_temp.p('msw_storage', 'OK rows=1', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070009/w/v1-tz.pdf', '72b71eba-f8a3-493d-aab5-25d7b7bb87dc', '72b71eba-f8a3-493d-aab5-25d7b7bb87dc')$q$);
reset role;

-- ── MS1: проверка запуска, метка, продление; MS2 — чужая метка ──────────
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms1_perm', 'OK true/true/true', $q$select public.erp_is_member()::text || '/' || public.erp_has_permission('order.manage')::text || '/' || public.erp_has_permission('tz.manage')::text$q$);
select pg_temp.p('ms1_check', 'OK {"ok": true, "already": false, "launched": false, "updated_at": "', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')::text$q$);
select pg_temp.p('ms1_label', 'OK true', $q$select (launch_by = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9' and launch_started_at is not null)::text from public.orders where id = '00000000-0000-4000-8000-000067020001'$q$);
select pg_temp.p('ms1_check_updated_at', 'OK true', $q$select ((pg_temp.r('ms1_check')->>'updated_at')::timestamptz = updated_at)::text from public.orders where id = '00000000-0000-4000-8000-000067020001'$q$);
reset role;
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('ms2_foreign_label', 'OK {"ok": false, "reason": "Заказ сейчас запускает ', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')::text$q$);
select pg_temp.p('ms2_label_kept', 'OK true', $q$select (launch_by = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9')::text from public.orders where id = '00000000-0000-4000-8000-000067020001'$q$);
select pg_temp.p('ms2_return_race', 'P0001 Заказ сейчас запускает ', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020001', 'draft', 'правка')$q$);
reset role;
-- метка МС1 «три минуты назад»: чужой МС всё ещё ждёт, сам МС1 продлевает
select pg_temp.as_user(null);
update public.orders set launch_started_at = now() - interval '3 minutes' where id = '00000000-0000-4000-8000-000067020001';
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('ms2_after_3min', 'OK {"ok": false, "reason": "Заказ сейчас запускает ', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')::text$q$);
reset role;
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms1_renew', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')::text$q$);
select pg_temp.p('ms1_renewed', 'OK true', $q$select (launch_started_at = now() and launch_by = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9')::text from public.orders where id = '00000000-0000-4000-8000-000067020001'$q$);
select pg_temp.p('ms1_repeat', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')::text$q$);
-- файлы запуска: копия ТЗ в erp-attachments под МС1 (владельца ставит Storage по JWT)
select pg_temp.p('ms1_storage', 'OK rows=1', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070001/00000000-0000-4000-8000-000067070002/v1-tz.pdf', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', '{"mimetype": "application/pdf", "size": 1000}')$q$);
select pg_temp.p('ms1_create', 'OK ', $q$select public.erp_create_order(jsonb_build_object(
    'order', jsonb_build_object('title', 'PROBE запуск J21', 'tz_order_id', '00000000-0000-4000-8000-000067020001', 'tz_number', 'PROBE-J21'),
    'items', jsonb_build_array(jsonb_build_object('product_type', 'Футболка', 'qty', 10,
      'stages', jsonb_build_array(jsonb_build_object('department_id', (select id from public.erp_departments where active limit 1))))),
    'tz', jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('group_id', '00000000-0000-4000-8000-000067070002', 'item_index', 0,
      'file_path', 'tz/v4-00000000-0000-4000-8000-000067070001/00000000-0000-4000-8000-000067070002/v1-tz.pdf', 'file_name', 'PROBE-J21-tz.pdf', 'mime_type', 'application/pdf',
      'size_bytes', 1000, 'uploaded_by', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9'))),
    'attachments', jsonb_build_array(jsonb_build_object('item_index', 0, 'material_index', null,
      'file_path', 'att/v4-00000000-0000-4000-8000-000067070001/print/00000000-0000-4000-8000-000067070003.png', 'file_name', 'PROBE-J21-1.png', 'kind', 'print'))))::text$q$);
select pg_temp.p('ms1_tz_doc_item', 'OK 1', $q$select count(*)::text from public.erp_tz_documents d join public.erp_orders e on e.id = d.order_id where e.tz_order_id = '00000000-0000-4000-8000-000067020001' and d.item_id is not null$q$);
select pg_temp.p('ms1_prod_no_id', 'P0001 Заказ ERP с этой связью создан не этим запуском', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020001', 'production')$q$);
select pg_temp.p('ms1_prod_foreign_id', 'P0001 Заказ ERP с этой связью создан не этим запуском', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020001', 'production', p_erp_order_id => gen_random_uuid())$q$);
select pg_temp.p('ms1_prod_ok', 'OK {"id": "00000000-0000-4000-8000-000067020001", "status": "production", "sent_at": ', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020001', 'production',
    p_erp_order_id => (select id from public.erp_orders where tz_order_id = '00000000-0000-4000-8000-000067020001'))::text$q$);
select pg_temp.p('ms1_prod_link', 'OK true', $q$select (erp_order_id = (select id from public.erp_orders where tz_order_id = '00000000-0000-4000-8000-000067020001')
    and (pg_temp.r('ms1_prod_ok')->>'erp_order_id')::uuid = erp_order_id
    and (pg_temp.r('ms1_prod_ok')->>'updated_at')::timestamptz = updated_at)::text from public.orders where id = '00000000-0000-4000-8000-000067020001'$q$);
select pg_temp.p('ms1_prod_repeat', 'OK production', $q$select (public.order_v4_transition('00000000-0000-4000-8000-000067020001', 'production'))->>'status'$q$);
select pg_temp.p('ms1_check_launched', 'OK {"ok": true, "already": true, "launched": true', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020001')::text$q$);
select pg_temp.p('ms1_return_launched', 'P0001 Такой переход статуса недоступен', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020001', 'draft', 'x')$q$);
reset role;

-- ── Подделка связи с ERP: продавец сам вставляет заказ ERP после метки ──
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms1_check_r2', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020002')::text$q$);
select pg_temp.p('ms1_check_r3', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020003')::text$q$);
reset role;
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('fake_order', 'OK rows=1', $q$insert into public.erp_orders (id, title, tz_order_id, tz_number) values ('00000000-0000-4000-8000-000067050002', 'PROBE подделка', '00000000-0000-4000-8000-000067020002', 'PROBE-J22')$q$);
select pg_temp.p('fake_item', 'OK rows=1', $q$insert into public.erp_order_items (id, order_id, product_type, qty) values ('00000000-0000-4000-8000-000067060002', '00000000-0000-4000-8000-000067050002', 'Футболка', 1)$q$);
select pg_temp.p('fake_object', 'OK rows=1', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070004/g/v1-tz.pdf', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('fake_doc', 'OK rows=1', $q$insert into public.erp_tz_documents (order_id, item_id, group_id, file_path) values ('00000000-0000-4000-8000-000067050002', '00000000-0000-4000-8000-000067060002', '00000000-0000-4000-8000-000067070004', 'tz/v4-00000000-0000-4000-8000-000067070004/g/v1-tz.pdf')$q$);
-- пустой заказ ERP (без позиций) — «у каждой позиции» не должно пройти пустым множеством
select pg_temp.p('fake_empty', 'OK rows=1', $q$insert into public.erp_orders (id, title, tz_order_id, tz_number) values ('00000000-0000-4000-8000-000067050003', 'PROBE пустой', '00000000-0000-4000-8000-000067020003', 'PROBE-J23')$q$);
reset role;
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('fake_check', 'OK {"ok": false, "reason": "Заказ ERP с этой связью создан не этим запуском — обратитесь к администратору"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020002')::text$q$);
select pg_temp.p('fake_prod', 'P0001 Заказ ERP с этой связью создан не этим запуском', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020002', 'production', p_erp_order_id => '00000000-0000-4000-8000-000067050002')$q$);
select pg_temp.p('fake_empty_check', 'OK {"ok": false, "reason": "Заказ ERP с этой связью создан не этим запуском — обратитесь к администратору"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020003')::text$q$);
select pg_temp.p('fake_empty_prod', 'P0001 Заказ ERP с этой связью создан не этим запуском', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020003', 'production', p_erp_order_id => '00000000-0000-4000-8000-000067050003')$q$);
select pg_temp.p('fake_kept', 'OK ready_to_launch/ready_to_launch', $q$select string_agg(status, '/' order by order_number) from public.orders where id in ('00000000-0000-4000-8000-000067020002', '00000000-0000-4000-8000-000067020003')$q$);
reset role;

-- ── Остаточный путь подделки (известный факт, не закрыт J — см. шапку) ───
-- Продавец с должностью ERP production_head ссылается на объект, загруженный МС (launch_by):
-- order_v4_erp_authentic смотрит только на владельца объекта и отвечает true.
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('resid_seller_perm', 'OK true/true', $q$select public.erp_has_permission('order.manage')::text || '/' || public.erp_has_permission('tz.manage')::text$q$);
reset role;
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('resid_ms1_check', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020014')::text$q$);
-- копия ТЗ под МС1 на шаге files; erp_create_order затем отказал (заказ ERP уже вставлен продавцом)
select pg_temp.p('resid_ms1_object', 'OK rows=1', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070010/00000000-0000-4000-8000-000067070011/v1-tz.pdf', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', '{"mimetype": "application/pdf", "size": 1000}')$q$);
reset role;
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('resid_order', 'OK rows=1', $q$insert into public.erp_orders (id, title, tz_order_id, tz_number) values ('00000000-0000-4000-8000-000067050004', 'PROBE остаточный путь', '00000000-0000-4000-8000-000067020014', 'PROBE-J34')$q$);
select pg_temp.p('resid_item', 'OK rows=1', $q$insert into public.erp_order_items (id, order_id, product_type, qty) values ('00000000-0000-4000-8000-000067060004', '00000000-0000-4000-8000-000067050004', 'Футболка', 1)$q$);
select pg_temp.p('resid_doc', 'OK rows=1', $q$insert into public.erp_tz_documents (order_id, item_id, group_id, file_path) values ('00000000-0000-4000-8000-000067050004', '00000000-0000-4000-8000-000067060004', '00000000-0000-4000-8000-000067070011', 'tz/v4-00000000-0000-4000-8000-000067070010/00000000-0000-4000-8000-000067070011/v1-tz.pdf')$q$);
reset role;
-- сценарий плана: продавец без tz.manage (должность worker) документ ТЗ не вставит, в бакет пишет
select pg_temp.as_user(null);
select set_config('probe.seller_erp_role', (select role from public.erp_employees where profile_id = '9285888e-4401-4b1b-b523-a3e6a9b90e82'), true);
update public.erp_employees set role = 'worker' where profile_id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('resid_worker_doc', '42501', $q$insert into public.erp_tz_documents (order_id, item_id, group_id, file_path) values ('00000000-0000-4000-8000-000067050004', '00000000-0000-4000-8000-000067060004', '00000000-0000-4000-8000-000067070012', 'tz/v4-00000000-0000-4000-8000-000067070010/00000000-0000-4000-8000-000067070011/v1-tz.pdf')$q$);
select pg_temp.p('resid_worker_storage', 'OK rows=1', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070012/g/v1-tz.pdf', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
reset role;
select pg_temp.as_user(null);
update public.erp_employees set role = current_setting('probe.seller_erp_role') where profile_id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('resid_check', 'OK {"ok": true, "already": true, "launched": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020014')::text$q$);
select pg_temp.p('resid_check_id', 'OK 00000000-0000-4000-8000-000067050004', $q$select pg_temp.r('resid_check')->>'erp_order_id'$q$);
select pg_temp.p('resid_prod', 'OK {"id": "00000000-0000-4000-8000-000067020014", "status": "production"', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020014', 'production', p_erp_order_id => '00000000-0000-4000-8000-000067050004')::text$q$);
select pg_temp.p('resid_linked', 'OK 00000000-0000-4000-8000-000067050004', $q$select erp_order_id::text from public.orders where id = '00000000-0000-4000-8000-000067020014'$q$);
reset role;

-- ── Старая копия ТЗ того же МС (находка 1, раунд 2): путь уже у другого заказа ERP ──
-- Копия ТЗ запуска J21 (владелец МС1, ключ виден списком бакета) привязана к заказу ERP J21.
-- Продавец ссылается на неё из своего заказа ERP для J35 после метки МС1 — не подлинный.
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('oldcopy_ms1_check', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020015')::text$q$);
reset role;
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('oldcopy_order', 'OK rows=1', $q$insert into public.erp_orders (id, title, tz_order_id, tz_number) values ('00000000-0000-4000-8000-000067050015', 'PROBE старая копия', '00000000-0000-4000-8000-000067020015', 'PROBE-J35')$q$);
select pg_temp.p('oldcopy_item', 'OK rows=1', $q$insert into public.erp_order_items (id, order_id, product_type, qty) values ('00000000-0000-4000-8000-000067060015', '00000000-0000-4000-8000-000067050015', 'Футболка', 1)$q$);
select pg_temp.p('oldcopy_doc', 'OK rows=1', $q$insert into public.erp_tz_documents (order_id, item_id, group_id, file_path) values ('00000000-0000-4000-8000-000067050015', '00000000-0000-4000-8000-000067060015', '00000000-0000-4000-8000-000067070025', 'tz/v4-00000000-0000-4000-8000-000067070001/00000000-0000-4000-8000-000067070002/v1-tz.pdf')$q$);
select pg_temp.p('oldcopy_linked', 'OK 1', $q$select count(distinct d.order_id)::text from public.erp_tz_documents d where d.file_path = 'tz/v4-00000000-0000-4000-8000-000067070001/00000000-0000-4000-8000-000067070002/v1-tz.pdf' and d.order_id <> '00000000-0000-4000-8000-000067050015'$q$);
reset role;
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('oldcopy_check', 'OK {"ok": false, "reason": "Заказ ERP с этой связью создан не этим запуском — обратитесь к администратору"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020015')::text$q$);
select pg_temp.p('oldcopy_prod', 'P0001 Заказ ERP с этой связью создан не этим запуском', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020015', 'production', p_erp_order_id => '00000000-0000-4000-8000-000067050015')$q$);
reset role;

-- ── Гонки разделения обязанностей (находка 2, раунд 2) ───────────────────
-- rop с признаком МС (признак ставит admin) — и руководитель, и МС
select pg_temp.as_user(null);
update public.profiles set is_ms = true where id = '22d22715-1487-480a-aea1-53a7bd52df2d';
-- Гонка 1: сменили оплату после проверки запуска. Свежая метка — смена запрещена;
-- старая метка снимается сменой, и «без оплаты» своего разрешения rop уже не запустит.
select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
select pg_temp.p('toctou_check', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020016')::text$q$);
select pg_temp.p('toctou_pay_fresh', 'P0001 Заказ сейчас запускает ', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020016', null)$q$);
select pg_temp.p('toctou_override_fresh', 'P0001 Заказ сейчас запускает ', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020016', null, 'постоянный клиент')$q$);
select pg_temp.p('toctou_paid_kept', 'OK full/true', $q$select paid_kind || '/' || (launch_by = '22d22715-1487-480a-aea1-53a7bd52df2d')::text from public.orders where id = '00000000-0000-4000-8000-000067020016'$q$);
reset role;
select pg_temp.as_user(null);
update public.orders set launch_started_at = now() - interval '11 minutes' where id = '00000000-0000-4000-8000-000067020016';
select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
select pg_temp.p('toctou_pay_stale', 'OK {"id": "00000000-0000-4000-8000-000067020016", "status": "ready_to_launch", "paid_at": null', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020016', null)::text$q$);
select pg_temp.p('toctou_label_cleared', 'OK true', $q$select (launch_started_at is null and launch_by is null)::text from public.orders where id = '00000000-0000-4000-8000-000067020016'$q$);
select pg_temp.p('toctou_override', 'OK {"id": "00000000-0000-4000-8000-000067020016", "status": "ready_to_launch", "paid_at": null', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020016', null, 'постоянный клиент')::text$q$);
select pg_temp.p('toctou_prod', 'P0001 Сначала проверка запуска', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020016', 'production')$q$);
select pg_temp.p('toctou_recheck', 'OK {"ok": false, "reason": "Запуск без оплаты разрешили вы — запустить должен другой сотрудник"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020016')::text$q$);
-- старая метка, но заказ ERP этого запуска уже создан — смена оплаты запрещена
select pg_temp.p('toctou_pay_erp', 'P0001 Заказ уже создан в производстве — сначала завершите запуск', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020019', null, 'постоянный клиент')$q$);
-- Гонка 2: rop сам разрешил «без оплаты» (J37), МС1 прошёл проверку и создал заказ ERP;
-- rop зовёт переход напрямую. То же — МС-автор своего заказа (J38)
select pg_temp.p('race_override', 'OK {"id": "00000000-0000-4000-8000-000067020017", "status": "ready_to_launch", "paid_at": null', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020017', null, 'постоянный клиент')::text$q$);
reset role;
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('race_ms1_check_override', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020017')::text$q$);
select pg_temp.p('race_ms1_check_own', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020018')::text$q$);
reset role;
-- заказы ERP этих запусков — как после шагов files и createOrder МС1 (копии ТЗ под МС1)
select pg_temp.as_user(null);
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070017/00000000-0000-4000-8000-000067070027/v1-tz.pdf', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', '{"mimetype": "application/pdf", "size": 1000}'),
  ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070018/00000000-0000-4000-8000-000067070028/v1-tz.pdf', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', '{"mimetype": "application/pdf", "size": 1000}');
insert into public.erp_orders (id, title, tz_order_id, tz_number) values
  ('00000000-0000-4000-8000-000067050017', 'PROBE запуск J37', '00000000-0000-4000-8000-000067020017', 'PROBE-J37'),
  ('00000000-0000-4000-8000-000067050018', 'PROBE запуск J38', '00000000-0000-4000-8000-000067020018', 'PROBE-J38');
insert into public.erp_order_items (id, order_id, product_type, qty) values
  ('00000000-0000-4000-8000-000067060017', '00000000-0000-4000-8000-000067050017', 'Футболка', 1),
  ('00000000-0000-4000-8000-000067060018', '00000000-0000-4000-8000-000067050018', 'Футболка', 1);
insert into public.erp_tz_documents (order_id, item_id, group_id, file_path) values
  ('00000000-0000-4000-8000-000067050017', '00000000-0000-4000-8000-000067060017', '00000000-0000-4000-8000-000067070027', 'tz/v4-00000000-0000-4000-8000-000067070017/00000000-0000-4000-8000-000067070027/v1-tz.pdf'),
  ('00000000-0000-4000-8000-000067050018', '00000000-0000-4000-8000-000067060018', '00000000-0000-4000-8000-000067070028', 'tz/v4-00000000-0000-4000-8000-000067070018/00000000-0000-4000-8000-000067070028/v1-tz.pdf');
select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
select pg_temp.p('race_override_prod', '42501 Запуск без оплаты разрешили вы — запустить должен другой сотрудник', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020017', 'production', p_erp_order_id => '00000000-0000-4000-8000-000067050017')$q$);
reset role;
select pg_temp.as_user('43a8021c-6ddc-4a25-88f6-62e13b46c1c5');
set local role authenticated;
select pg_temp.p('race_own_prod', '42501 Свой заказ запускает другой МС или руководитель производства', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020018', 'production', p_erp_order_id => '00000000-0000-4000-8000-000067050018')$q$);
reset role;
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('race_ms1_prod_override', 'OK {"id": "00000000-0000-4000-8000-000067020017", "status": "production"', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020017', 'production', p_erp_order_id => '00000000-0000-4000-8000-000067050017')::text$q$);
select pg_temp.p('race_ms1_prod_own', 'OK {"id": "00000000-0000-4000-8000-000067020018", "status": "production"', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020018', 'production', p_erp_order_id => '00000000-0000-4000-8000-000067050018')::text$q$);
reset role;
select pg_temp.as_user(null);
update public.profiles set is_ms = false where id = '22d22715-1487-480a-aea1-53a7bd52df2d';

-- ── Гонка возврата: свой возврат и старая метка — можно ──────────────────
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms1_check_r4', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020004')::text$q$);
select pg_temp.p('ms1_return_own', 'OK {"id": "00000000-0000-4000-8000-000067020004", "status": "draft"', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020004', 'draft', 'нет размеров')::text$q$);
reset role;
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('ms2_return_old_label', 'OK {"id": "00000000-0000-4000-8000-000067020005", "status": "draft"', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020005', 'draft', 'правка')::text$q$);
select pg_temp.p('ms2_return_no_reason', 'P0001 Укажите причину возврата', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020009', 'draft')$q$);
reset role;

-- ── Разделение обязанностей ─────────────────────────────────────────────
select pg_temp.as_user('43a8021c-6ddc-4a25-88f6-62e13b46c1c5');
set local role authenticated;
select pg_temp.p('msa_own_check', 'OK {"ok": false, "reason": "Свой заказ запускает другой МС или руководитель производства"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020007')::text$q$);
select pg_temp.p('msa_own_no_label', 'OK true', $q$select (launch_started_at is null)::text from public.orders where id = '00000000-0000-4000-8000-000067020007'$q$);
select pg_temp.p('msa_own_pay', '42501 Оплату своего заказа отмечает другой сотрудник', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020007', 'prepaid')$q$);
reset role;
-- admin и director без строки ERP: права ERP есть (роль director), свой заказ admin запускает сам
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('admin_perm', 'OK true/true/true', $q$select public.erp_is_member()::text || '/' || public.erp_has_permission('order.manage')::text || '/' || public.erp_has_permission('tz.manage')::text$q$);
select pg_temp.p('admin_own_check', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020008')::text$q$);
select pg_temp.p('admin_storage', 'OK rows=1', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070005/g/v1-tz.pdf', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_check_draft', 'OK {"ok": false, "reason": "Заказ не ожидает запуска"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067010002')::text$q$);
select pg_temp.p('admin_check_no_items', 'OK {"ok": false, "reason": "В заказе нет позиций"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020013')::text$q$);
reset role;
select pg_temp.as_user('36a4e89d-3012-4a7c-9386-224a42b661db');
set local role authenticated;
select pg_temp.p('dir_perm', 'OK true/true/true', $q$select public.erp_is_member()::text || '/' || public.erp_has_permission('order.manage')::text || '/' || public.erp_has_permission('tz.manage')::text$q$);
select pg_temp.p('dir_check', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020009')::text$q$);
select pg_temp.p('dir_storage', 'OK rows=1', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070006/g/v1-tz.pdf', '36a4e89d-3012-4a7c-9386-224a42b661db', '36a4e89d-3012-4a7c-9386-224a42b661db')$q$);
reset role;
-- rop с признаком МС сам разрешил «без оплаты» — запускает другой
select pg_temp.as_user(null);
update public.profiles set is_ms = true where id = '22d22715-1487-480a-aea1-53a7bd52df2d';
select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
select pg_temp.p('rop_override', 'OK {"id": "00000000-0000-4000-8000-000067020010", "status": "ready_to_launch", "paid_at": null, "paid_kind": null, "updated_at": "', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020010', null, 'постоянный клиент')::text$q$);
select pg_temp.p('rop_override_self_check', 'OK {"ok": false, "reason": "Запуск без оплаты разрешили вы — запустить должен другой сотрудник"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020010')::text$q$);
reset role;
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms1_override_check', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020010')::text$q$);
reset role;
select pg_temp.as_user(null);
update public.profiles set is_ms = false where id = '22d22715-1487-480a-aea1-53a7bd52df2d';

-- ── set_payment у МС ────────────────────────────────────────────────────
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms1_pay', 'OK {"id": "00000000-0000-4000-8000-000067020011", "status": "ready_to_launch", "paid_at": "', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020011', 'prepaid')::text$q$);
select pg_temp.p('ms1_pay_updated_at', 'OK true', $q$select ((pg_temp.r('ms1_pay')->>'updated_at')::timestamptz = updated_at)::text from public.orders where id = '00000000-0000-4000-8000-000067020011'$q$);
select pg_temp.p('ms1_pay_null', '42501 Снять отметку или запустить без оплаты может только руководитель', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020011', null)$q$);
select pg_temp.p('ms1_pay_reason', '42501 Снять отметку или запустить без оплаты может только руководитель', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020011', 'full', 'по звонку')$q$);
select pg_temp.p('ms1_pay_draft', '42501 Заказ не найден или недоступен', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067010002', 'prepaid')$q$);
select pg_temp.p('ms1_pay_production', '42501 Оплату отмечает автор заказа или руководитель', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020001', 'full')$q$);
-- переход: без метки, без оплаты при метке, без заказа ERP
select pg_temp.p('ms1_prod_no_check', 'P0001 Сначала проверка запуска', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020013', 'production')$q$);
select pg_temp.p('ms1_prod_unpaid', 'P0001 Нет отметки оплаты', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020012', 'production')$q$);
select pg_temp.p('ms1_check_unpaid', 'OK {"ok": false, "reason": "Нет отметки оплаты"', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020012')::text$q$);
select pg_temp.p('ms1_check_r11', 'OK {"ok": true, "already": false', $q$select public.order_v4_launch_check('00000000-0000-4000-8000-000067020011')::text$q$);
select pg_temp.p('ms1_prod_no_erp', 'P0001 Заказ ERP этого запуска не найден', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020011', 'production', p_erp_order_id => gen_random_uuid())$q$);
reset role;
select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
-- метка МС1 (ms1_check_r11) свежая — «без оплаты» во время запуска не поставить (находка 2)
select pg_temp.p('rop_pay_reason', 'P0001 Заказ сейчас запускает ', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020011', null, 'по договору')::text$q$);
-- К17: rop не возвращает, не запускает и не завершает
select pg_temp.p('rop_return', '42501 Вернуть заказ может МС или руководитель производства', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020009', 'draft', 'правка')$q$);
select pg_temp.p('rop_launch', '42501 Запустить заказ может МС или руководитель производства', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020009', 'production')$q$);
select pg_temp.p('rop_done', '42501 Завершить заказ может МС или руководитель производства', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067020001', 'done')$q$);
select pg_temp.p('rop_pay_production', 'P0001 Оплату отмечают до запуска', $q$select public.order_v4_set_payment('00000000-0000-4000-8000-000067020001', 'full')$q$);
select pg_temp.p('rop_archive', '42501 В архив черновик убирает автор или администратор', $q$select public.order_v4_transition('00000000-0000-4000-8000-000067010003', 'archived')$q$);
reset role;

-- ── sales_set_staff: свой признак и МС для rop ───────────────────────────
select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
select pg_temp.p('rop_self_ms', '42501 Свой признак меняет администратор или директор', $q$select public.sales_set_staff('22d22715-1487-480a-aea1-53a7bd52df2d', 'ms', true)$q$);
select pg_temp.p('rop_self_sales', '42501 Свой признак меняет администратор или директор', $q$select public.sales_set_staff('22d22715-1487-480a-aea1-53a7bd52df2d', 'sales', true)$q$);
select pg_temp.p('rop_other_ms', 'OK', $q$select public.sales_set_staff('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', 'ms', true)$q$);
select pg_temp.p('rop_other_ms_off', 'OK', $q$select public.sales_set_staff('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', 'ms', false)$q$);
select pg_temp.p('rop_rop2_ms', '42501 Признак МС руководителю продаж ставит администратор или директор', $q$select public.sales_set_staff('64a22c1f-35b6-4e90-9cc1-cd6e04cc94b6', 'ms', true)$q$);
select pg_temp.p('rop_rop2_ms_off', 'OK', $q$select public.sales_set_staff('64a22c1f-35b6-4e90-9cc1-cd6e04cc94b6', 'ms', false)$q$);
select pg_temp.p('rop_missing', 'P0002 Профиль не найден', $q$select public.sales_set_staff(gen_random_uuid(), 'sales', true)$q$);
select pg_temp.p('rop_null', '22023 Не указан профиль или признак', $q$select public.sales_set_staff('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', 'sales', null)$q$);
select pg_temp.p('rop_kind', '22023 Неизвестный признак: ожидается sales или ms', $q$select public.sales_set_staff('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', 'role', true)$q$);
reset role;
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms1_set_staff', '42501 Отмечать сотрудников продаж может администратор, директор или РОП', $q$select public.sales_set_staff('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', 'ms', false)$q$);
reset role;
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('admin_rop2_ms', 'OK', $q$select public.sales_set_staff('64a22c1f-35b6-4e90-9cc1-cd6e04cc94b6', 'ms', true)$q$);
select pg_temp.p('admin_self_sales', 'OK', $q$select public.sales_set_staff('b9c3e42e-9e07-44c2-8b15-839ce327c40c', 'sales', true)$q$);
select pg_temp.p('admin_self_sales_off', 'OK', $q$select public.sales_set_staff('b9c3e42e-9e07-44c2-8b15-839ce327c40c', 'sales', false)$q$);
reset role;
select pg_temp.as_user('36a4e89d-3012-4a7c-9386-224a42b661db');
set local role authenticated;
select pg_temp.p('dir_self_ms', 'OK', $q$select public.sales_set_staff('36a4e89d-3012-4a7c-9386-224a42b661db', 'ms', true)$q$);
reset role;

-- ── Отключённый профиль: в бакет ERP не пишет ───────────────────────────
select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;
select pg_temp.p('off_storage', '42501', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070007/g/v1-tz.pdf', 'cc9ed453-d3d7-4add-a361-8719a7701f97', 'cc9ed453-d3d7-4add-a361-8719a7701f97')$q$);
reset role;
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('seller_storage', 'OK rows=1', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('erp-attachments', 'tz/v4-00000000-0000-4000-8000-000067070008/g/v1-tz.pdf', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
reset role;

-- ── Журнал и побочные эффекты ───────────────────────────────────────────
select pg_temp.as_user(null);
select pg_temp.p('events_actor', 'OK 0', $q$select count(*)::text from public.order_events e join public.orders o on o.id = e.order_id where o.order_number like 'PROBE-J%' and e.actor is null$q$);
select pg_temp.p('events_l1', 'OK payment:prepaid,status:draft>ready_to_launch', $q$select string_agg(e.kind || ':' || case e.kind when 'status' then e.from_status || '>' || e.to_status else coalesce(e.payment_kind, '-') end, ',' order by e.kind) from public.order_events e where e.order_id = '00000000-0000-4000-8000-000067010001'$q$);
select pg_temp.p('seq_unchanged', 'OK true', $q$select (last_value::text = current_setting('probe.seq_before', true))::text from public.order_number_seq$q$);

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

-- Сюда исполнение не доходит: исключение выше откатывает всё.
rollback;
