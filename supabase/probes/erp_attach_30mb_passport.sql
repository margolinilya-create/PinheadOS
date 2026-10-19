-- Пробы миграции 20261019090000_erp_attach_30mb_passport_optional (правки 19.10, пп. 4 и 5;
-- план A, Task 6): бакет erp-attachments принимает 30 МБ, финальный пакет разработки
-- завершается без техпаспорта, но не без фото образца.
-- До применения миграции — только сухим прогоном вместе с ней (миграция, затем этот файл
-- в одной транзакции). Боевую базу файл не меняет: всё откатывается исключением итога.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=8 {…}
--
-- КАК ИЗОЛИРОВАН СТРАЖ. На erp_experimental висят ещё три триггера перехода в
-- «Готово к серии» (склад, карточка SKU, гейт склада) — проба про ОДИН страж, и
-- их побочные действия ей не нужны. Поэтому функция erp_dev_package_guard() вешается
-- на временную таблицу с теми же колонками; вложения — настоящие строки
-- erp_order_attachments у настоящей (временной, без заказа) разработки, id которой
-- совпадает с id строки временной таблицы. Страж пропускает пустой auth.uid()
-- (service_role) — поэтому переход делается от имени пользователя (любой uuid: страж
-- читает только auth.uid() is null).

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

-- ── Лимит бакета ─────────────────────────────────────────────────────────
select pg_temp.p('bucket_30mb', 'OK 31457280',
  $q$select file_size_limit::text from storage.buckets where id = 'erp-attachments'$q$);
select pg_temp.p('sku_photos_untouched', 'OK 15728640',
  $q$select file_size_limit::text from storage.buckets where id = 'sku-photos'$q$);

-- ── Данные (служебный доступ) ────────────────────────────────────────────
select pg_temp.as_user(null);
insert into public.erp_experimental (id)
values ('00000000-0000-4000-8000-000019109001'),   -- фото есть, паспорта нет
       ('00000000-0000-4000-8000-000019109002');   -- паспорт есть, фото нет
insert into public.erp_order_attachments (experimental_id, kind, file_path, file_name)
values
  ('00000000-0000-4000-8000-000019109001', 'dev_photo',    'probe/19109001/photo.jpg', 'photo.jpg'),
  ('00000000-0000-4000-8000-000019109002', 'dev_passport', 'probe/19109002/passport.pdf', 'passport.pdf');

create temp table probe_dev (
  id uuid primary key,
  outcome text,
  pattern_tech_name text,
  pattern_version text,
  final_package jsonb not null default '{}'::jsonb,
  price_min numeric,
  price_max numeric
);
create trigger probe_dev_guard before update on probe_dev
  for each row execute function public.erp_dev_package_guard();
insert into probe_dev (id, pattern_tech_name, pattern_version)
values ('00000000-0000-4000-8000-000019109001', 'PH-PROBE-01', 'v1'),
       ('00000000-0000-4000-8000-000019109002', 'PH-PROBE-02', 'v1'),
       ('00000000-0000-4000-8000-000019109003', null, null);   -- пустой пакет, вложений нет

-- ── Страж от имени пользователя ──────────────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');

-- Без техпаспорта, с фото и лекалами — завершается
select pg_temp.p('ready_without_passport', 'OK rows=1',
  $q$update probe_dev set outcome = 'ready_for_serial' where id = '00000000-0000-4000-8000-000019109001'$q$);
-- Без фото — 23514, и в перечне ровно фото, без паспорта
select pg_temp.p('no_photo_refused', '23514 Не заполнен финальный пакет: Фото образца',
  $q$update probe_dev set outcome = 'ready_for_serial' where id = '00000000-0000-4000-8000-000019109002'$q$);
-- Пустой пакет: перечень без «Технический паспорт»
select pg_temp.p('empty_list', '23514 Не заполнен финальный пакет: Техническое название лекал, Версия лекал, Фото образца',
  $q$update probe_dev set outcome = 'ready_for_serial' where id = '00000000-0000-4000-8000-000019109003'$q$);
-- Переход не в «Готово к серии» стража не касается
select pg_temp.p('other_outcome_free', 'OK rows=1',
  $q$update probe_dev set outcome = 'needs_rework' where id = '00000000-0000-4000-8000-000019109003'$q$);

-- ── Права на функцию ─────────────────────────────────────────────────────
select pg_temp.as_user(null);
select pg_temp.p('guard_fn_closed_auth', 'OK false',
  $q$select has_function_privilege('authenticated', 'public.erp_dev_package_guard()', 'execute')::text$q$);
select pg_temp.p('guard_fn_closed_anon', 'OK false',
  $q$select has_function_privilege('anon', 'public.erp_dev_package_guard()', 'execute')::text$q$);

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
