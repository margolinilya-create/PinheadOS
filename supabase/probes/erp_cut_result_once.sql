-- Пробы миграции C1 правок 19.10 (20261019110000_erp_cut_result_once): сдача закроя —
-- выпуск один раз таблицей, расход по рулонам без размеров, средний по материалу,
-- блокировка рулона, страж `erp_material_rolls`. Входы и итоги — те же, что
-- в `pinhead-react/src/erp/utils/cutUsage.examples.ts` (пример документа 3 × 50 м).
-- Только после применения C1 (или сухим прогоном вместе с ней), ВЛАДЕЛЕЦ в SQL Editor.
-- Гонку двух сессий одна транзакция не воспроизводит: вторая сдача на тот же рулон
-- идёт после первой и обязана увидеть её остаток (под блокировкой — так же).
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=41 {…}
--
-- Роли — профили боя: HEAD 9285888e-4401-4b1b-b523-a3e6a9b90e82 (production_head, сдаёт),
-- DIRECTOR 56ec3039-f326-42dd-b4de-870844b9468d (экономика), WORKER — профиль
-- cc9ed453-d3d7-4add-a361-8719a7701f97, внутри транзакции одобрен и заведён закройщиком.

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

-- ── Данные (суперпользователь) ───────────────────────────────────────────
select pg_temp.as_user(null);
create temp table fx (k text primary key, id uuid);
grant all on fx to authenticated;

update public.profiles set active = true, approved = true where id = 'cc9ed453-d3d7-4add-a361-8719a7701f97';
insert into public.erp_employees (full_name, role, department_id, profile_id)
values ('Проба закройщик', 'worker', (select id from public.erp_departments where code = 'cutting'),
        'cc9ed453-d3d7-4add-a361-8719a7701f97');

insert into public.erp_orders (title) values ('PROBE C1 закрой');
insert into fx values ('order', (select id from public.erp_orders where title = 'PROBE C1 закрой'));

-- Позиция + этап закроя «в работе» + материал «Футер · Чёрный» (основное полотно, принят)
create function pg_temp.mk_item(p_key text, p_qty int, p_grid jsonb) returns void
language plpgsql as $f$
declare v_item uuid; v_stage uuid; v_mat uuid;
begin
  insert into public.erp_order_items (order_id, product_type, qty, size_grid)
  values ((select id from fx where k = 'order'), 'PROBE худи', p_qty, p_grid) returning id into v_item;
  insert into public.erp_item_stages (item_id, department_id, status)
  values (v_item, (select id from public.erp_departments where code = 'cutting'), 'in_progress')
  returning id into v_stage;
  insert into public.erp_materials (order_id, item_id, kind, role, name, color, status, accept_status)
  values ((select id from fx where k = 'order'), v_item, 'fabric', 'main', 'Футер 3-нитка', 'Чёрный',
          'received', 'accepted_full') returning id into v_mat;
  insert into fx values (p_key || '.item', v_item), (p_key || '.stage', v_stage), (p_key || '.mat', v_mat);
end;
$f$;

create function pg_temp.mk_roll(p_key text, p_mat text, p_seq int, p_len numeric) returns void
language sql as $f$
  with r as (
    insert into public.erp_material_rolls
      (material_id, seq, label, length_m, length_left_m, length_source, price_per_m, status)
    values ((select id from fx where k = p_mat), p_seq, 'Рулон №' || p_seq, p_len, p_len, 'supplier', 400, 'in_stock')
    returning id)
  insert into fx select p_key, id from r;
$f$;

create function pg_temp.fx(p_key text) returns uuid language sql stable as $f$
  select id from fx where k = p_key;
$f$;

-- Пример документа: 3 × 50 м, «черный» M 60 / L 40
select pg_temp.mk_item('doc', 200, '[{"color":"Чёрный","sizes":{"M":100,"L":100}}]');
select pg_temp.mk_roll('doc.r1', 'doc.mat', 1, 50);
select pg_temp.mk_roll('doc.r2', 'doc.mat', 2, 50);
select pg_temp.mk_roll('doc.r3', 'doc.mat', 3, 50);
-- То же со списанием остатка
select pg_temp.mk_item('scrap', 200, '[{"color":"Чёрный","sizes":{"M":100,"L":100}}]');
select pg_temp.mk_roll('scrap.r1', 'scrap.mat', 1, 50);
select pg_temp.mk_roll('scrap.r2', 'scrap.mat', 2, 50);
-- Два отчёта: 50 м / 100 и 30 м / 20
select pg_temp.mk_item('two', 300, '[{"color":"Чёрный","sizes":{"M":300}}]');
select pg_temp.mk_roll('two.r1', 'two.mat', 1, 50);
select pg_temp.mk_roll('two.r2', 'two.mat', 2, 50);
-- Полотно + рибана (рибана — отделка, в средний полотна не входит)
select pg_temp.mk_item('rib', 200, '[{"color":"Чёрный","sizes":{"M":100,"L":100}}]');
select pg_temp.mk_roll('rib.r1', 'rib.mat', 1, 50);
insert into public.erp_materials (order_id, item_id, kind, role, name, color, status, accept_status)
values (pg_temp.fx('order'), pg_temp.fx('rib.item'), 'fabric', 'trim', 'Рибана', 'Чёрный', 'received', 'accepted_full');
insert into fx select 'rib.ribmat', id from public.erp_materials where item_id = pg_temp.fx('rib.item') and role = 'trim';
select pg_temp.mk_roll('rib.r2', 'rib.ribmat', 1, 10);
-- Старый формат + новый на одной позиции
select pg_temp.mk_item('mix', 300, '[{"color":"Чёрный","sizes":{"M":300}}]');
select pg_temp.mk_roll('mix.r1', 'mix.mat', 1, 50);
select pg_temp.mk_roll('mix.r2', 'mix.mat', 2, 50);
-- Двухцветная позиция: материал «Белый» вторым
select pg_temp.mk_item('duo', 300, '[{"color":"Чёрный","sizes":{"M":100}},{"color":"Белый","sizes":{"M":100}}]');
insert into public.erp_materials (order_id, item_id, kind, role, name, color, status, accept_status)
values (pg_temp.fx('order'), pg_temp.fx('duo.item'), 'fabric', 'main', 'Футер 3-нитка', 'Белый', 'received', 'accepted_full');
insert into fx select 'duo.white', id from public.erp_materials where item_id = pg_temp.fx('duo.item') and color = 'Белый';
select pg_temp.mk_roll('duo.r1', 'duo.mat', 1, 50);
select pg_temp.mk_roll('duo.r2', 'duo.white', 1, 50);
-- Без рулонов: сверх плана и брак скаляром; швейная строка с браком
select pg_temp.mk_item('norolls', 80, '[{"color":"Чёрный","sizes":{"M":40,"L":40}}]');
select pg_temp.mk_item('sew', 100, '[{"color":"Чёрный","sizes":{"M":100}}]');
update public.erp_item_stages set department_id = (select id from public.erp_departments where code = 'sewing')
 where id = pg_temp.fx('sew.stage');
-- Отказы и гонка
select pg_temp.mk_item('bad', 200, '[{"color":"Чёрный","sizes":{"M":200}}]');
select pg_temp.mk_roll('bad.r1', 'bad.mat', 1, 50);
-- Чужой рулон: другой заказ, без пригодного остатка
insert into public.erp_orders (title) values ('PROBE C1 чужой');
insert into public.erp_materials (order_id, kind, role, name, color, status, accept_status)
values ((select id from public.erp_orders where title = 'PROBE C1 чужой'), 'fabric', 'main', 'Футер', 'Чёрный', 'received', 'accepted_full');
insert into fx select 'alien.mat', m.id from public.erp_materials m join public.erp_orders o on o.id = m.order_id where o.title = 'PROBE C1 чужой';
select pg_temp.mk_roll('alien.r1', 'alien.mat', 1, 50);

-- ── HEAD сдаёт закрой ────────────────────────────────────────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;

-- Пример документа: рулон 1 полностью, рулон 2 частично (остаток 12 пригоден), рулон 3 не тронут
select pg_temp.p('doc_submit', 'OK', format($q$select (public.erp_stage_submit_report(
  p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"черный","size":"M","qty_good":60},{"color":"черный","size":"L","qty_good":40}]'::jsonb,
  p_rolls => jsonb_build_array(
    jsonb_build_object('roll_id', %L, 'material_id', %L, 'length_used_m', 50, 'finished', true),
    jsonb_build_object('roll_id', %L, 'material_id', gen_random_uuid(), 'length_used_m', 38, 'finished', true,
                       'leftover', 'usable', 'leftover_measured_m', null)),
  p_client_key => '00000000-0000-4000-8000-0000000000c1'))).id::text$q$,
  pg_temp.fx('doc.stage'), pg_temp.fx('doc.r1'), pg_temp.fx('doc.mat'), pg_temp.fx('doc.r2')));
select pg_temp.p('doc_good', 'OK 100', format($q$select sum(qty_good)::text from public.erp_stage_reports where stage_id = %L$q$, pg_temp.fx('doc.stage')));
select pg_temp.p('doc_size_rows', 'OK 2/0', format($q$select count(*) || '/' || count(z.report_roll_id) from public.erp_stage_report_sizes z join public.erp_stage_reports r on r.id = z.report_id where r.stage_id = %L$q$, pg_temp.fx('doc.stage')));
select pg_temp.p('doc_roll_rows', 'OK 38,50', format($q$select string_agg(rr.length_used_m::int::text, ',' order by rr.length_used_m) from public.erp_stage_report_rolls rr join public.erp_stage_reports r on r.id = rr.report_id where r.stage_id = %L$q$, pg_temp.fx('doc.stage')));
-- material_id строки — из рулона, а не случайный клиентский
select pg_temp.p('doc_material_from_roll', 'OK 2', format($q$select count(*)::text from public.erp_stage_report_rolls rr join public.erp_stage_reports r on r.id = rr.report_id where r.stage_id = %L and rr.material_id = %L$q$, pg_temp.fx('doc.stage'), pg_temp.fx('doc.mat')));
select pg_temp.p('doc_r2_left', 'OK 12.00 usable', format($q$select round(length_left_m, 2) || ' ' || leftover_kind from public.erp_material_rolls where id = %L$q$, pg_temp.fx('doc.r2')));
select pg_temp.p('doc_r3_untouched', 'OK 50.00 in_stock', format($q$select round(length_left_m, 2) || ' ' || status from public.erp_material_rolls where id = %L$q$, pg_temp.fx('doc.r3')));
-- Повтор той же попытки — отчётов 1
select pg_temp.p('doc_repeat', 'OK', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"черный","size":"M","qty_good":60}]'::jsonb,
  p_client_key => '00000000-0000-4000-8000-0000000000c1')).id::text$q$, pg_temp.fx('doc.stage')));
select pg_temp.p('doc_reports_1', 'OK 1', format($q$select count(*)::text from public.erp_stage_reports where stage_id = %L$q$, pg_temp.fx('doc.stage')));

-- Списание остатка 12 м
select pg_temp.p('scrap_submit', 'OK', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":100}]'::jsonb,
  p_rolls => jsonb_build_array(
    jsonb_build_object('roll_id', %L, 'length_used_m', 50, 'finished', true),
    jsonb_build_object('roll_id', %L, 'length_used_m', 38, 'finished', true, 'leftover', 'scrap')))).id::text$q$,
  pg_temp.fx('scrap.stage'), pg_temp.fx('scrap.r1'), pg_temp.fx('scrap.r2')));
select pg_temp.p('scrap_writeoff', 'OK 12.00', format($q$select round(sum(before_m), 2)::text from public.erp_material_roll_adjustments where kind = 'scrap_writeoff' and roll_id = %L$q$, pg_temp.fx('scrap.r2')));

-- Два отчёта: 50 м / 100 и 30 м / 20
select pg_temp.p('two_a', 'OK', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":100}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 50, 'finished', true)))).id::text$q$,
  pg_temp.fx('two.stage'), pg_temp.fx('two.r1')));
select pg_temp.p('two_b', 'OK', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":20}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 30, 'finished', true, 'leftover', 'usable')))).id::text$q$,
  pg_temp.fx('two.stage'), pg_temp.fx('two.r2')));

-- Полотно + рибана: годные 100, не 200
select pg_temp.p('rib_submit', 'OK 100', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":60},{"color":"Чёрный","size":"L","qty_good":40}]'::jsonb,
  p_rolls => jsonb_build_array(
    jsonb_build_object('roll_id', %L, 'length_used_m', 50, 'finished', true),
    jsonb_build_object('roll_id', %L, 'length_used_m', 4, 'finished', true, 'leftover', 'usable')))).qty_done::text$q$,
  pg_temp.fx('rib.stage'), pg_temp.fx('rib.r1'), pg_temp.fx('rib.r2')));

-- Старый формат (размеры на рулоне) проходит; затем новый на той же позиции
select pg_temp.p('mix_old', 'OK 20', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 20, 'finished', false,
    'sizes', '[{"color":"Чёрный","size":"M","qty_good":20}]'::jsonb)))).qty_done::text$q$,
  pg_temp.fx('mix.stage'), pg_temp.fx('mix.r1')));
select pg_temp.p('mix_old_roll_rows', 'OK 1', format($q$select count(*)::text from public.erp_stage_report_sizes z join public.erp_stage_reports r on r.id = z.report_id where r.stage_id = %L and z.report_roll_id is not null$q$, pg_temp.fx('mix.stage')));
select pg_temp.p('mix_new', 'OK 100', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":80}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 40, 'finished', true, 'leftover', 'usable')))).qty_done::text$q$,
  pg_temp.fx('mix.stage'), pg_temp.fx('mix.r2')));

-- Двухцветная позиция: каждый материал — своим цветом
select pg_temp.p('duo_submit', 'OK 150', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":100},{"color":"Белый","size":"M","qty_good":50}]'::jsonb,
  p_rolls => jsonb_build_array(
    jsonb_build_object('roll_id', %L, 'length_used_m', 40, 'finished', true, 'leftover', 'usable'),
    jsonb_build_object('roll_id', %L, 'length_used_m', 25, 'finished', true, 'leftover', 'usable')))).qty_done::text$q$,
  pg_temp.fx('duo.stage'), pg_temp.fx('duo.r1'), pg_temp.fx('duo.r2')));

-- Без рулонов сверх плана (L 40 + 10): плюс посчитан; брак и переделка — скалярами
select pg_temp.p('norolls_submit', 'OK', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_qty_defect => 2, p_qty_rework => 1,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":40},{"color":"Чёрный","size":"L","qty_good":50}]'::jsonb)).id::text$q$,
  pg_temp.fx('norolls.stage')));
select pg_temp.p('norolls_extra', 'OK 90/2/1/10', format($q$select qty_good || '/' || qty_defect || '/' || qty_rework || '/' || qty_extra from public.erp_stage_reports where stage_id = %L$q$, pg_temp.fx('norolls.stage')));
select pg_temp.p('norolls_rows_extra', 'OK 10', format($q$select sum(z.qty_extra)::text from public.erp_stage_report_sizes z join public.erp_stage_reports r on r.id = z.report_id where r.stage_id = %L and z.report_roll_id is null$q$, pg_temp.fx('norolls.stage')));

-- Швейка: строки несут брак (нулём) — скаляр p_qty_defect 5 не действует
select pg_temp.p('sew_submit', 'OK', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_qty_defect => 5,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":10,"qty_defect":0,"qty_rework":0}]'::jsonb)).id::text$q$,
  pg_temp.fx('sew.stage')));
select pg_temp.p('sew_defect_rows', 'OK 0', format($q$select qty_defect::text from public.erp_stage_reports where stage_id = %L$q$, pg_temp.fx('sew.stage')));

-- Отказы
select pg_temp.p('bad_dup_roll', '22023', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":10}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 10),
                               jsonb_build_object('roll_id', %L, 'length_used_m', 10)))).id::text$q$,
  pg_temp.fx('bad.stage'), pg_temp.fx('bad.r1'), pg_temp.fx('bad.r1')));
select pg_temp.p('bad_negative', '22023', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":-5}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 10)))).id::text$q$,
  pg_temp.fx('bad.stage'), pg_temp.fx('bad.r1')));
select pg_temp.p('bad_alien_roll', '22023', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":10}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 10)))).id::text$q$,
  pg_temp.fx('bad.stage'), pg_temp.fx('alien.r1')));
select pg_temp.p('bad_kg_zero', '22023', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":10}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'qty_used', 0)))).id::text$q$,
  pg_temp.fx('bad.stage'), pg_temp.fx('bad.r1')));
-- «Две сессии» на один рулон по 50: первая проходит, вторая видит её остаток
select pg_temp.p('race_first', 'OK', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":50}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 50, 'finished', false)))).id::text$q$,
  pg_temp.fx('bad.stage'), pg_temp.fx('bad.r1')));
select pg_temp.p('race_second', '22023', format($q$select (public.erp_stage_submit_report(p_stage_id => %L, p_qty_in => null, p_qty_good => 0,
  p_sizes => '[{"color":"Чёрный","size":"M","qty_good":50}]'::jsonb,
  p_rolls => jsonb_build_array(jsonb_build_object('roll_id', %L, 'length_used_m', 50, 'finished', false)))).id::text$q$,
  pg_temp.fx('bad.stage'), pg_temp.fx('bad.r1')));

-- Уточнение метража не трогает прошлые операции и пишет length_refine
select pg_temp.p('refine', 'OK', format($q$select public.erp_material_roll_set_params(p_roll_id => %L, p_length_m => 55, p_length_source => 'measured', p_reason => 'Замер пробы')::text$q$, pg_temp.fx('bad.r1')));
select pg_temp.p('refine_ops_kept', 'OK 50.00', format($q$select round(sum(length_used_m), 2)::text from public.erp_stage_report_rolls where roll_id = %L$q$, pg_temp.fx('bad.r1')));
select pg_temp.p('refine_logged', 'OK 1', format($q$select count(*)::text from public.erp_material_roll_adjustments where kind = 'length_refine' and roll_id = %L$q$, pg_temp.fx('bad.r1')));
reset role;

-- ── WORKER: прямой PATCH рулона — отказ стража ───────────────────────────
select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;
select pg_temp.p('worker_patch_left', '42501', format($q$update public.erp_material_rolls set length_left_m = 999 where id = %L$q$, pg_temp.fx('doc.r3')));
select pg_temp.p('worker_patch_status', '42501', format($q$update public.erp_material_rolls set status = 'used' where id = %L$q$, pg_temp.fx('doc.r3')));
reset role;

-- ── DIRECTOR: экономика позиции ───────────────────────────────────────────
select pg_temp.as_user('56ec3039-f326-42dd-b4de-870844b9468d');
set local role authenticated;
select pg_temp.p('eco_doc', 'OK 0.8800', format($q$select public.erp_item_economics(%L)->'fabric'->>'avg_m_per_cut'$q$, pg_temp.fx('doc.item')));
select pg_temp.p('eco_doc_scope', 'OK color', format($q$select public.erp_item_economics(%L)->'fabric'->'by_material'->0->>'scope'$q$, pg_temp.fx('doc.item')));
select pg_temp.p('eco_scrap', 'OK 1.0000', format($q$select public.erp_item_economics(%L)->'fabric'->>'avg_m_per_cut'$q$, pg_temp.fx('scrap.item')));
select pg_temp.p('eco_two', 'OK 0.6667', format($q$select public.erp_item_economics(%L)->'fabric'->>'avg_m_per_cut'$q$, pg_temp.fx('two.item')));
select pg_temp.p('eco_rib', 'OK 0.5000', format($q$select public.erp_item_economics(%L)->'fabric'->>'avg_m_per_cut'$q$, pg_temp.fx('rib.item')));
-- Старый (20 м / 20) + новый (40 м / 80): Σ/Σ = 60 / 100
select pg_temp.p('eco_mix', 'OK 0.6000', format($q$select public.erp_item_economics(%L)->'fabric'->>'avg_m_per_cut'$q$, pg_temp.fx('mix.item')));
-- Двухцветная: чёрный 40 / 100, белый 25 / 50
select pg_temp.p('eco_duo', 'OK 0.4000,0.5000', format($q$select string_agg(e->>'avg_m_per_cut', ',' order by e->>'avg_m_per_cut') from jsonb_array_elements(public.erp_item_economics(%L)->'fabric'->'by_material') e$q$, pg_temp.fx('duo.item')));
reset role;
select pg_temp.as_user(null);

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

-- Сюда исполнение не доходит: исключение выше откатывает всё.
rollback;
