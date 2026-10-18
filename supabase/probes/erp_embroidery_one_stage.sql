-- Пробы миграции 20261019100000_erp_embroidery_one_stage (правки 19.10, п. 1; план A, Task 1):
-- вышивка одной строкой — фаза «Разработка программы вышивки» → «Вышивка».
-- До применения миграции — только сухим прогоном вместе с ней (миграция, затем этот файл
-- в одной транзакции). Боевую базу файл не меняет: всё откатывается исключением итога.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=34 {…}
--
-- Роли — профили боя (как в order_v3_readonly.sql), внутри транзакции:
--   W_EMB  05bbc552-bca2-490d-b275-46a3084dca7c  production, сотрудник ERP worker цеха вышивки
--   W_CUT  9285888e-4401-4b1b-b523-a3e6a9b90e82  production, сотрудник ERP worker закройного цеха
--   MGR    22d22715-1487-480a-aea1-53a7bd52df2d  manager без строки сотрудника → роль ERP manager (order.manage)
--   DIR    b9c3e42e-9e07-44c2-8b15-839ce327c40c  admin → роль ERP director (stage.force_complete)
-- Данные: заказ ERP с тремя позициями —
--   A  крой → вышивка (одна строка, фаза программы) → пошив;
--   L  крой → вышивка последним этапом (фаза программы);
--   B  старая пара: отдельная программа (вне цепочки) и вышивка после кроя.

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

-- ── Данные (суперпользователь, auth.uid() пуст — служебный доступ) ───────
select pg_temp.as_user(null);
update public.profiles set role = 'production', active = true, approved = true
 where id in ('05bbc552-bca2-490d-b275-46a3084dca7c', '9285888e-4401-4b1b-b523-a3e6a9b90e82');
update public.profiles set role = 'manager', active = true, approved = true
 where id = '22d22715-1487-480a-aea1-53a7bd52df2d';
update public.erp_employees set role = 'worker', active = true,
       department_id = (select id from public.erp_departments where code = 'embroidery')
 where profile_id = '05bbc552-bca2-490d-b275-46a3084dca7c';
update public.erp_employees set role = 'worker', active = true,
       department_id = (select id from public.erp_departments where code = 'cutting')
 where profile_id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
update public.erp_employees set active = false
 where profile_id = '22d22715-1487-480a-aea1-53a7bd52df2d';

insert into public.erp_orders (id, title)
values ('00000000-0000-4000-8000-000019100000', 'PROBE вышивка одной задачей');

insert into public.erp_order_items (id, order_id, product_type, qty, branding_methods)
values
  ('00000000-0000-4000-8000-0000191000a1', '00000000-0000-4000-8000-000019100000', 'PROBE', 10, '{embroidery}'),
  ('00000000-0000-4000-8000-0000191000c1', '00000000-0000-4000-8000-000019100000', 'PROBE', 10, '{embroidery}'),
  ('00000000-0000-4000-8000-0000191000b1', '00000000-0000-4000-8000-000019100000', 'PROBE', 10, '{embroidery}');

insert into public.erp_item_stages (id, item_id, department_id, depends_on, status, sort_order, operation, result_kind)
values
  -- A: крой → вышивка (фаза программы) → пошив
  ('00000000-0000-4000-8000-0000191000a2', '00000000-0000-4000-8000-0000191000a1',
   (select id from public.erp_departments where code = 'cutting'), '{}', 'waiting', 1, null, null),
  ('00000000-0000-4000-8000-0000191000a3', '00000000-0000-4000-8000-0000191000a1',
   (select id from public.erp_departments where code = 'embroidery'),
   '{00000000-0000-4000-8000-0000191000a2}', 'waiting', 2, 'Разработка программы вышивки', 'embroidery_program'),
  ('00000000-0000-4000-8000-0000191000a4', '00000000-0000-4000-8000-0000191000a1',
   (select id from public.erp_departments where code = 'sewing'),
   '{00000000-0000-4000-8000-0000191000a3}', 'waiting', 3, null, null),
  -- L: крой → вышивка последним этапом
  ('00000000-0000-4000-8000-0000191000c2', '00000000-0000-4000-8000-0000191000c1',
   (select id from public.erp_departments where code = 'cutting'), '{}', 'waiting', 1, null, null),
  ('00000000-0000-4000-8000-0000191000c3', '00000000-0000-4000-8000-0000191000c1',
   (select id from public.erp_departments where code = 'embroidery'),
   '{00000000-0000-4000-8000-0000191000c2}', 'waiting', 2, 'Разработка программы вышивки', 'embroidery_program'),
  -- B: старая пара строк
  ('00000000-0000-4000-8000-0000191000b2', '00000000-0000-4000-8000-0000191000b1',
   (select id from public.erp_departments where code = 'cutting'), '{}', 'waiting', 1, null, null),
  ('00000000-0000-4000-8000-0000191000b3', '00000000-0000-4000-8000-0000191000b1',
   (select id from public.erp_departments where code = 'embroidery'), '{}', 'waiting', 2,
   'Разработка программы вышивки', 'embroidery_program'),
  ('00000000-0000-4000-8000-0000191000b4', '00000000-0000-4000-8000-0000191000b1',
   (select id from public.erp_departments where code = 'embroidery'),
   '{00000000-0000-4000-8000-0000191000b2}', 'waiting', 3, null, null);

select pg_temp.p('pass_phase', 'OK false', $q$select qty_passthrough::text from public.erp_item_stages where id = '00000000-0000-4000-8000-0000191000a3'$q$);
select pg_temp.p('pass_old_program', 'OK true', $q$select qty_passthrough::text from public.erp_item_stages where id = '00000000-0000-4000-8000-0000191000b3'$q$);
select pg_temp.p('phase_single', 'OK true', $q$select public.erp_embroidery_is_phased('00000000-0000-4000-8000-0000191000a3')::text$q$);
select pg_temp.p('phase_old_pair', 'OK false', $q$select public.erp_embroidery_is_phased('00000000-0000-4000-8000-0000191000b3')::text$q$);

-- ── W_EMB: фаза программы не ждёт кроя, но не закрывается ────────────────
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('w_take_phase', 'OK rows=1', $q$update public.erp_item_stages set status = 'in_progress', started_at = now() where id = '00000000-0000-4000-8000-0000191000a3'$q$);
select pg_temp.p('w_finish_nofile', '23514 Приложите файл программы', $q$select (public.erp_embroidery_program_finish('00000000-0000-4000-8000-0000191000a3')).id::text$q$);
select pg_temp.p('w_patch_kind', '42501 erp_stage_guard: тип результата этапа требует права order.manage', $q$update public.erp_item_stages set result_kind = null where id = '00000000-0000-4000-8000-0000191000a3'$q$);
select pg_temp.p('w_done_phase', '23514 Сначала сдайте программу', $q$update public.erp_item_stages set status = 'done', finished_at = now() where id = '00000000-0000-4000-8000-0000191000a3'$q$);
select pg_temp.p('w_qty_phase', '23514', $q$update public.erp_item_stages set qty_done = 5 where id = '00000000-0000-4000-8000-0000191000a3'$q$);
select pg_temp.p('w_block_phase', 'OK Сначала сдайте программу', $q$select public.erp_stage_completion_block('00000000-0000-4000-8000-0000191000a3', 0, false)$q$);
reset role;

-- «Пустышка»: строка вложения без объекта в бакете
select pg_temp.as_user(null);
insert into public.erp_order_attachments (order_id, item_id, stage_id, file_path, file_name, kind)
values ('00000000-0000-4000-8000-000019100000', '00000000-0000-4000-8000-0000191000a1',
        '00000000-0000-4000-8000-0000191000a3', 'probe/embroidery-1910/none.dst', 'none.dst', 'stage_result');

select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('w_finish_dummy', '23514 Приложите файл программы', $q$select (public.erp_embroidery_program_finish('00000000-0000-4000-8000-0000191000a3')).id::text$q$);
reset role;

-- ── Чужой цех, менеджер, принудительное завершение ───────────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('cut_finish', '42501', $q$select (public.erp_embroidery_program_finish('00000000-0000-4000-8000-0000191000a3')).id::text$q$);
reset role;

select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
select pg_temp.p('m_skip_status_phase', '23514 Сначала сдайте программу', $q$update public.erp_item_stages set status = 'skipped' where id = '00000000-0000-4000-8000-0000191000a3'$q$);
reset role;

select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('d_force_phase', '23514 Сначала сдайте программу', $q$select (public.erp_stage_force_complete('00000000-0000-4000-8000-0000191000a3', 'проба 19.10')).id::text$q$);
reset role;

-- Настоящий файл программы: объект в бакете и вложение этапа
select pg_temp.as_user(null);
insert into storage.objects (bucket_id, name, owner)
values ('erp-attachments', 'probe/embroidery-1910/program.dst', '05bbc552-bca2-490d-b275-46a3084dca7c');
insert into public.erp_order_attachments (order_id, item_id, stage_id, file_path, file_name, kind)
values ('00000000-0000-4000-8000-000019100000', '00000000-0000-4000-8000-0000191000a1',
        '00000000-0000-4000-8000-0000191000a3', 'probe/embroidery-1910/program.dst', 'program.dst', 'stage_result');

-- ── Переход фазы ─────────────────────────────────────────────────────────
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('w_finish', 'OK 00000000-0000-4000-8000-0000191000a3', $q$select (public.erp_embroidery_program_finish('00000000-0000-4000-8000-0000191000a3')).id::text$q$);
select pg_temp.p('w_after_finish', 'OK null/null/waiting/0/null/null/false', $q$select coalesce(result_kind, 'null') || '/' || coalesce(operation, 'null') || '/' || status || '/' || qty_done || '/' || coalesce(started_at::text, 'null') || '/' || coalesce(assignee, 'null') || '/' || qty_passthrough from public.erp_item_stages where id = '00000000-0000-4000-8000-0000191000a3'$q$);
select pg_temp.p('w_files_kept', 'OK 2', $q$select count(*)::text from public.erp_order_attachments where stage_id = '00000000-0000-4000-8000-0000191000a3'$q$);
select pg_temp.p('w_event', 'OK in_progress/waiting/Программа вышивки готова', $q$select from_status || '/' || to_status || '/' || comment from public.erp_stage_events where stage_id = '00000000-0000-4000-8000-0000191000a3' order by created_at desc limit 1$q$);
select pg_temp.p('w_finish_again', '22023 Программа уже сдана', $q$select (public.erp_embroidery_program_finish('00000000-0000-4000-8000-0000191000a3')).id::text$q$);
-- Фаза вышивки ждёт крой
select pg_temp.p('w_take_before_cut', '23514 Вышивку можно начать после этапа «Закройный цех»', $q$update public.erp_item_stages set status = 'in_progress', started_at = now() where id = '00000000-0000-4000-8000-0000191000a3'$q$);
reset role;

select pg_temp.as_user(null);
update public.erp_item_stages set status = 'done', qty_done = 10, finished_at = now()
 where id in ('00000000-0000-4000-8000-0000191000a2', '00000000-0000-4000-8000-0000191000b2',
              '00000000-0000-4000-8000-0000191000c2');

select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('w_take_after_cut', 'OK rows=1', $q$update public.erp_item_stages set status = 'in_progress', started_at = now() where id = '00000000-0000-4000-8000-0000191000a3'$q$);
select pg_temp.p('w_qty_after_cut', 'OK rows=1', $q$update public.erp_item_stages set qty_done = 4 where id = '00000000-0000-4000-8000-0000191000a3'$q$);
-- Вышивка последним этапом в фазе программы: выпуск 0, а не тираж
select pg_temp.p('produced_phase_last', 'OK 0', $q$select public.erp_item_produced_qty('00000000-0000-4000-8000-0000191000c1')::text$q$);

-- ── Старый заказ с парой строк: прежние правила ──────────────────────────
select pg_temp.p('old_prog_take', 'OK rows=1', $q$update public.erp_item_stages set status = 'in_progress', started_at = now() where id = '00000000-0000-4000-8000-0000191000b3'$q$);
select pg_temp.p('old_emb_take', 'OK rows=1', $q$update public.erp_item_stages set status = 'in_progress', started_at = now() where id = '00000000-0000-4000-8000-0000191000b4'$q$);
select pg_temp.p('old_emb_done_blocked', 'P0001 Сначала завершите задачу', $q$update public.erp_item_stages set status = 'done', qty_done = 10, finished_at = now() where id = '00000000-0000-4000-8000-0000191000b4'$q$);
select pg_temp.p('old_prog_finish', '22023 Задача не в фазе разработки программы', $q$select (public.erp_embroidery_program_finish('00000000-0000-4000-8000-0000191000b3')).id::text$q$);
select pg_temp.p('old_prog_done', 'OK rows=1', $q$update public.erp_item_stages set status = 'done', finished_at = now() where id = '00000000-0000-4000-8000-0000191000b3'$q$);
-- «Без программы» — только менеджер заказа
select pg_temp.p('w_skip_rpc', '42501', $q$select (public.erp_embroidery_program_skip('00000000-0000-4000-8000-0000191000c3', 'нет файла')).id::text$q$);
reset role;

select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
select pg_temp.p('m_skip_no_reason', '22023', $q$select (public.erp_embroidery_program_skip('00000000-0000-4000-8000-0000191000c3', '  ')).id::text$q$);
select pg_temp.p('m_skip_rpc', 'OK 00000000-0000-4000-8000-0000191000c3', $q$select (public.erp_embroidery_program_skip('00000000-0000-4000-8000-0000191000c3', 'программа клиента')).id::text$q$);
select pg_temp.p('m_skip_event', 'OK Без программы: программа клиента', $q$select comment from public.erp_stage_events where stage_id = '00000000-0000-4000-8000-0000191000c3' order by created_at desc limit 1$q$);
select pg_temp.p('m_skip_state', 'OK null/waiting/false', $q$select coalesce(result_kind, 'null') || '/' || status || '/' || public.erp_embroidery_is_phased(id) from public.erp_item_stages where id = '00000000-0000-4000-8000-0000191000c3'$q$);
reset role;

-- ── Права на функции ─────────────────────────────────────────────────────
select pg_temp.p('gate_fn_closed', 'OK false', $q$select has_function_privilege('authenticated', 'public.erp_item_stages_embroidery_route_gate()', 'execute')::text$q$);

-- ── Итог ─────────────────────────────────────────────────────────────────
do $$
declare
  v_names text[] := string_to_array(trim(trailing ',' from current_setting('probe.names', true)), ',');
  v_name text;
  v_got text;
  v_want text;
  v_fails int := 0;
  v_map jsonb := '{}'::jsonb;
begin
  foreach v_name in array v_names loop
    v_got := current_setting('probe.r.' || v_name, true);
    v_want := current_setting('probe.e.' || v_name, true);
    if v_got like v_want || '%' then
      v_map := v_map || jsonb_build_object(v_name, v_got);
    else
      v_fails := v_fails + 1;
      v_map := v_map || jsonb_build_object('FAIL ' || v_name, jsonb_build_object('got', v_got, 'want', v_want));
    end if;
  end loop;
  raise exception 'PROBE_RESULT fails=% total=% %', v_fails, array_length(v_names, 1), v_map::text;
end;
$$;

-- Сюда исполнение не доходит: исключение выше откатывает всё. Строка — для клиента,
-- который продолжает после ошибки (psql без ON_ERROR_STOP).
rollback;
