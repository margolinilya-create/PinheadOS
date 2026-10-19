-- Пробы миграции T2 правок 19.10, часть B (20261020100000_erp_biz_tasks_rpc):
-- писатели бизнес-задач — ворота сотрудника ERP, матрица переходов (действие ×
-- статус × роль), создание (белый список, повтор client_key, лимиты Р8,
-- наблюдатели), правка (срок с причиной, смена ответственного), чек-лист,
-- файлы, результат, «видел», уведомления (одно на событие человеку).
-- Только после применения T1 и T2 (или сухим прогоном вместе с ними), ВЛАДЕЛЕЦ в SQL Editor.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=407 {…}
--
-- Матрица переходов — блок между маркерами, вывод `node supabase/probes/gen-biz-task-matrix.mjs`
-- (источник — BIZ_TASK_TRANSITIONS; паритет сторожит `bizTasksRpc.test.ts`).
--
-- Роли — профили боя (как в `order_v4_launch.sql`); признаки, роль профиля и карточка
-- сотрудника ERP выставляются внутри транзакции (откат вернёт):
--   CREATOR  e73bd7fd-…  постановщик, сотрудник worker; менеджер заказа ORDER
--   ASSIGNEE 72b71eba-…  ответственный, сотрудник worker
--   WATCHER  43a8021c-…  наблюдатель, сотрудник worker
--   MANAGE   f13c33f3-…  должность ERP manager (biz_task.manage), не постановщик
--   OUTSIDER 64a22c1f-…  сотрудник worker, к задаче отношения не имеет
--   STAFF2   05bbc552-…  сотрудник worker; менеджер заказа ORDER2
--   NOEMP    22d22715-…  профиль manager БЕЗ активной карточки erp_employees
--   SELLER   9285888e-…  продавец (production, is_sales), карточка снята
--   OFF      cc9ed453-…  отключённый профиль
-- Если профили на бою изменятся — пробы покажут FAIL: правьте данные пробы, а не ожидания.
--
-- Проверено локально (19.10): PostgreSQL 16 с заглушкой схемы Supabase + T1 + T2 —
-- fails=0 total=407; мутация «снять проверку роли у complete» — fails=59.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Проба: SQL выполняется от имени p_uid (authenticated + JWT), 'anon' или суперпользователем
create function pg_temp.p(p_name text, p_expect text, p_sql text, p_uid text default null) returns void
language plpgsql as $f$
declare v text; n bigint;
begin
  begin
    if p_uid = 'anon' then
      execute 'set local role anon';
    elsif p_uid is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
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
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('probe.r.' || p_name, v, true);
  perform set_config('probe.e.' || p_name, p_expect, true);
  perform set_config('probe.names', coalesce(nullif(current_setting('probe.names', true), ''), '') || p_name || ',', true);
end;
$f$;

-- ── Данные (суперпользователь) ───────────────────────────────────────────
create temp table who (k text primary key, id uuid);
insert into who values
  ('creator',  'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26'),
  ('assignee', '72b71eba-f8a3-493d-aab5-25d7b7bb87dc'),
  ('watcher',  '43a8021c-6ddc-4a25-88f6-62e13b46c1c5'),
  ('manage',   'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9'),
  ('outsider', '64a22c1f-35b6-4e90-9cc1-cd6e04cc94b6'),
  ('staff2',   '05bbc552-bca2-490d-b275-46a3084dca7c'),
  ('noemp',    '22d22715-1487-480a-aea1-53a7bd52df2d'),
  ('seller',   '9285888e-4401-4b1b-b523-a3e6a9b90e82'),
  ('off',      'cc9ed453-d3d7-4add-a361-8719a7701f97');
create function pg_temp.uid(p_k text) returns text language sql stable as $f$
  select id::text from who where k = p_k;
$f$;

create temp table fx (k text primary key, id uuid);
create function pg_temp.fx(p_k text) returns uuid language sql stable as $f$
  select id from fx where k = p_k;
$f$;

update public.profiles set active = true, approved = true, role = 'manager', is_sales = false, is_ms = false
 where id in (select id from who where k in ('creator', 'assignee', 'watcher', 'manage', 'outsider', 'staff2', 'noemp'));
update public.profiles set active = true, approved = true, role = 'production', is_sales = true
 where id = pg_temp.uid('seller')::uuid;
update public.profiles set active = false where id = pg_temp.uid('off')::uuid;

insert into public.erp_employees (full_name, role, profile_id)
select 'Проба T2 ' || k, case k when 'manage' then 'manager' else 'worker' end, id
  from who where k in ('creator', 'assignee', 'watcher', 'manage', 'outsider', 'staff2')
on conflict (profile_id) where profile_id is not null
  do update set role = excluded.role, active = true;
update public.erp_employees set active = false
 where profile_id in (select id from who where k in ('noemp', 'seller', 'off'));

insert into public.erp_orders (title, manager_id) values ('PROBE T2 заказ', pg_temp.uid('creator')::uuid);
insert into fx values ('order', (select id from public.erp_orders where title = 'PROBE T2 заказ'));
insert into public.erp_orders (title, manager_id) values ('PROBE T2 заказ 2', pg_temp.uid('staff2')::uuid);
insert into fx values ('order2', (select id from public.erp_orders where title = 'PROBE T2 заказ 2'));
insert into public.erp_orders (title, status) values ('PROBE T2 сданный', 'done_on_time');
insert into fx values ('order_done', (select id from public.erp_orders where title = 'PROBE T2 сданный'));

-- Задачи матрицы: постановщик CREATOR, ответственный ASSIGNEE, наблюдатель WATCHER
insert into public.erp_biz_tasks (order_id, title, kind, assignee_id, creator_id, due_at, review_required)
values (pg_temp.fx('order'), 'PROBE T2 с проверкой', 'delivery', pg_temp.uid('assignee')::uuid,
        pg_temp.uid('creator')::uuid, now() + interval '2 days', true),
       (pg_temp.fx('order'), 'PROBE T2 без проверки', 'purchase', pg_temp.uid('assignee')::uuid,
        pg_temp.uid('creator')::uuid, now() + interval '2 days', false);
insert into fx values ('task_rev', (select id from public.erp_biz_tasks where title = 'PROBE T2 с проверкой'));
insert into fx values ('task_norev', (select id from public.erp_biz_tasks where title = 'PROBE T2 без проверки'));
insert into public.erp_biz_task_watchers (task_id, user_id)
values (pg_temp.fx('task_rev'), pg_temp.uid('watcher')::uuid),
       (pg_temp.fx('task_norev'), pg_temp.uid('watcher')::uuid);
insert into public.erp_biz_task_checklist (task_id, text) values (pg_temp.fx('task_norev'), 'Чужой пункт');
insert into fx values ('foreign_item', (select id from public.erp_biz_task_checklist where text = 'Чужой пункт'
                                          and task_id = pg_temp.fx('task_norev')));

-- Случай матрицы: задача в нужном статусе, вызов перехода с её свежей версией
create function pg_temp.mx(p_action text, p_status text, p_review boolean) returns text
language plpgsql as $f$
declare v_task uuid := pg_temp.fx(case when p_review then 'task_rev' else 'task_norev' end);
        v_ver timestamptz;
begin
  update public.erp_biz_tasks set status = p_status where id = v_task returning updated_at into v_ver;
  return format($q$select (public.erp_biz_task_transition(%L, %L, 'Проба', %L)).status$q$, v_task, p_action, v_ver);
end;
$f$;

-- Тело задачи для create: литерал jsonb
create function pg_temp.tj(p_order uuid, p_assignee text, p_extra jsonb default '{}'::jsonb) returns text
language sql stable as $f$
  select format('%L::jsonb', (jsonb_build_object('order_id', p_order, 'title', 'PROBE T2 создание', 'kind', 'delivery',
    'assignee_id', p_assignee, 'due_at', now() + interval '3 days') || p_extra)::text);
$f$;

-- Версия задачи сейчас (для p_expected_updated_at)
create function pg_temp.ver(p_task uuid) returns text language sql stable as $f$
  select quote_literal(updated_at::text) from public.erp_biz_tasks where id = p_task;
$f$;

-- >>> матрица переходов (gen-biz-task-matrix.mjs)
select pg_temp.p('m_start_new_assignee', 'OK in_progress', pg_temp.mx('start', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_start_new_creator', '42501', pg_temp.mx('start', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_start_new_manage', '42501', pg_temp.mx('start', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_start_new_watcher', '42501', pg_temp.mx('start', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_start_new_outsider', '42501', pg_temp.mx('start', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_start_in_progress_assignee', '22023', pg_temp.mx('start', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_start_in_progress_creator', '42501', pg_temp.mx('start', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_start_in_progress_manage', '42501', pg_temp.mx('start', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_start_in_progress_watcher', '42501', pg_temp.mx('start', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_start_in_progress_outsider', '42501', pg_temp.mx('start', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_start_paused_assignee', '22023', pg_temp.mx('start', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_start_paused_creator', '42501', pg_temp.mx('start', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_start_paused_manage', '42501', pg_temp.mx('start', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_start_paused_watcher', '42501', pg_temp.mx('start', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_start_paused_outsider', '42501', pg_temp.mx('start', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_start_review_assignee', '22023', pg_temp.mx('start', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_start_review_creator', '42501', pg_temp.mx('start', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_start_review_manage', '42501', pg_temp.mx('start', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_start_review_watcher', '42501', pg_temp.mx('start', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_start_review_outsider', '42501', pg_temp.mx('start', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_start_done_assignee', '22023', pg_temp.mx('start', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_start_done_creator', '42501', pg_temp.mx('start', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_start_done_manage', '42501', pg_temp.mx('start', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_start_done_watcher', '42501', pg_temp.mx('start', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_start_done_outsider', '42501', pg_temp.mx('start', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_start_cancelled_assignee', '22023', pg_temp.mx('start', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_start_cancelled_creator', '42501', pg_temp.mx('start', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_start_cancelled_manage', '42501', pg_temp.mx('start', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_start_cancelled_watcher', '42501', pg_temp.mx('start', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_start_cancelled_outsider', '42501', pg_temp.mx('start', 'cancelled', false), pg_temp.uid('outsider'));
select pg_temp.p('m_pause_new_assignee', '22023', pg_temp.mx('pause', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_pause_new_creator', '42501', pg_temp.mx('pause', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_pause_new_manage', '42501', pg_temp.mx('pause', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_pause_new_watcher', '42501', pg_temp.mx('pause', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_pause_new_outsider', '42501', pg_temp.mx('pause', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_pause_in_progress_assignee', 'OK paused', pg_temp.mx('pause', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_pause_in_progress_creator', '42501', pg_temp.mx('pause', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_pause_in_progress_manage', '42501', pg_temp.mx('pause', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_pause_in_progress_watcher', '42501', pg_temp.mx('pause', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_pause_in_progress_outsider', '42501', pg_temp.mx('pause', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_pause_paused_assignee', '22023', pg_temp.mx('pause', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_pause_paused_creator', '42501', pg_temp.mx('pause', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_pause_paused_manage', '42501', pg_temp.mx('pause', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_pause_paused_watcher', '42501', pg_temp.mx('pause', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_pause_paused_outsider', '42501', pg_temp.mx('pause', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_pause_review_assignee', '22023', pg_temp.mx('pause', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_pause_review_creator', '42501', pg_temp.mx('pause', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_pause_review_manage', '42501', pg_temp.mx('pause', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_pause_review_watcher', '42501', pg_temp.mx('pause', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_pause_review_outsider', '42501', pg_temp.mx('pause', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_pause_done_assignee', '22023', pg_temp.mx('pause', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_pause_done_creator', '42501', pg_temp.mx('pause', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_pause_done_manage', '42501', pg_temp.mx('pause', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_pause_done_watcher', '42501', pg_temp.mx('pause', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_pause_done_outsider', '42501', pg_temp.mx('pause', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_pause_cancelled_assignee', '22023', pg_temp.mx('pause', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_pause_cancelled_creator', '42501', pg_temp.mx('pause', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_pause_cancelled_manage', '42501', pg_temp.mx('pause', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_pause_cancelled_watcher', '42501', pg_temp.mx('pause', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_pause_cancelled_outsider', '42501', pg_temp.mx('pause', 'cancelled', false), pg_temp.uid('outsider'));
select pg_temp.p('m_resume_new_assignee', '22023', pg_temp.mx('resume', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_resume_new_creator', '42501', pg_temp.mx('resume', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_resume_new_manage', '42501', pg_temp.mx('resume', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_resume_new_watcher', '42501', pg_temp.mx('resume', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_resume_new_outsider', '42501', pg_temp.mx('resume', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_resume_in_progress_assignee', '22023', pg_temp.mx('resume', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_resume_in_progress_creator', '42501', pg_temp.mx('resume', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_resume_in_progress_manage', '42501', pg_temp.mx('resume', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_resume_in_progress_watcher', '42501', pg_temp.mx('resume', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_resume_in_progress_outsider', '42501', pg_temp.mx('resume', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_resume_paused_assignee', 'OK in_progress', pg_temp.mx('resume', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_resume_paused_creator', '42501', pg_temp.mx('resume', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_resume_paused_manage', '42501', pg_temp.mx('resume', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_resume_paused_watcher', '42501', pg_temp.mx('resume', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_resume_paused_outsider', '42501', pg_temp.mx('resume', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_resume_review_assignee', '22023', pg_temp.mx('resume', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_resume_review_creator', '42501', pg_temp.mx('resume', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_resume_review_manage', '42501', pg_temp.mx('resume', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_resume_review_watcher', '42501', pg_temp.mx('resume', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_resume_review_outsider', '42501', pg_temp.mx('resume', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_resume_done_assignee', '22023', pg_temp.mx('resume', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_resume_done_creator', '42501', pg_temp.mx('resume', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_resume_done_manage', '42501', pg_temp.mx('resume', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_resume_done_watcher', '42501', pg_temp.mx('resume', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_resume_done_outsider', '42501', pg_temp.mx('resume', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_resume_cancelled_assignee', '22023', pg_temp.mx('resume', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_resume_cancelled_creator', '42501', pg_temp.mx('resume', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_resume_cancelled_manage', '42501', pg_temp.mx('resume', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_resume_cancelled_watcher', '42501', pg_temp.mx('resume', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_resume_cancelled_outsider', '42501', pg_temp.mx('resume', 'cancelled', false), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_new_assignee_rev', '22023', pg_temp.mx('submit', 'new', true), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_new_assignee_norev', '22023', pg_temp.mx('submit', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_new_creator_rev', '42501', pg_temp.mx('submit', 'new', true), pg_temp.uid('creator'));
select pg_temp.p('m_submit_new_creator_norev', '42501', pg_temp.mx('submit', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_submit_new_manage_rev', '42501', pg_temp.mx('submit', 'new', true), pg_temp.uid('manage'));
select pg_temp.p('m_submit_new_manage_norev', '42501', pg_temp.mx('submit', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_submit_new_watcher_rev', '42501', pg_temp.mx('submit', 'new', true), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_new_watcher_norev', '42501', pg_temp.mx('submit', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_new_outsider_rev', '42501', pg_temp.mx('submit', 'new', true), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_new_outsider_norev', '42501', pg_temp.mx('submit', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_in_progress_assignee_rev', 'OK review', pg_temp.mx('submit', 'in_progress', true), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_in_progress_assignee_norev', '22023', pg_temp.mx('submit', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_in_progress_creator_rev', '42501', pg_temp.mx('submit', 'in_progress', true), pg_temp.uid('creator'));
select pg_temp.p('m_submit_in_progress_creator_norev', '42501', pg_temp.mx('submit', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_submit_in_progress_manage_rev', '42501', pg_temp.mx('submit', 'in_progress', true), pg_temp.uid('manage'));
select pg_temp.p('m_submit_in_progress_manage_norev', '42501', pg_temp.mx('submit', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_submit_in_progress_watcher_rev', '42501', pg_temp.mx('submit', 'in_progress', true), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_in_progress_watcher_norev', '42501', pg_temp.mx('submit', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_in_progress_outsider_rev', '42501', pg_temp.mx('submit', 'in_progress', true), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_in_progress_outsider_norev', '42501', pg_temp.mx('submit', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_paused_assignee_rev', '22023', pg_temp.mx('submit', 'paused', true), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_paused_assignee_norev', '22023', pg_temp.mx('submit', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_paused_creator_rev', '42501', pg_temp.mx('submit', 'paused', true), pg_temp.uid('creator'));
select pg_temp.p('m_submit_paused_creator_norev', '42501', pg_temp.mx('submit', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_submit_paused_manage_rev', '42501', pg_temp.mx('submit', 'paused', true), pg_temp.uid('manage'));
select pg_temp.p('m_submit_paused_manage_norev', '42501', pg_temp.mx('submit', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_submit_paused_watcher_rev', '42501', pg_temp.mx('submit', 'paused', true), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_paused_watcher_norev', '42501', pg_temp.mx('submit', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_paused_outsider_rev', '42501', pg_temp.mx('submit', 'paused', true), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_paused_outsider_norev', '42501', pg_temp.mx('submit', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_review_assignee_rev', '22023', pg_temp.mx('submit', 'review', true), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_review_assignee_norev', '22023', pg_temp.mx('submit', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_review_creator_rev', '42501', pg_temp.mx('submit', 'review', true), pg_temp.uid('creator'));
select pg_temp.p('m_submit_review_creator_norev', '42501', pg_temp.mx('submit', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_submit_review_manage_rev', '42501', pg_temp.mx('submit', 'review', true), pg_temp.uid('manage'));
select pg_temp.p('m_submit_review_manage_norev', '42501', pg_temp.mx('submit', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_submit_review_watcher_rev', '42501', pg_temp.mx('submit', 'review', true), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_review_watcher_norev', '42501', pg_temp.mx('submit', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_review_outsider_rev', '42501', pg_temp.mx('submit', 'review', true), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_review_outsider_norev', '42501', pg_temp.mx('submit', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_done_assignee_rev', '22023', pg_temp.mx('submit', 'done', true), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_done_assignee_norev', '22023', pg_temp.mx('submit', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_done_creator_rev', '42501', pg_temp.mx('submit', 'done', true), pg_temp.uid('creator'));
select pg_temp.p('m_submit_done_creator_norev', '42501', pg_temp.mx('submit', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_submit_done_manage_rev', '42501', pg_temp.mx('submit', 'done', true), pg_temp.uid('manage'));
select pg_temp.p('m_submit_done_manage_norev', '42501', pg_temp.mx('submit', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_submit_done_watcher_rev', '42501', pg_temp.mx('submit', 'done', true), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_done_watcher_norev', '42501', pg_temp.mx('submit', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_done_outsider_rev', '42501', pg_temp.mx('submit', 'done', true), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_done_outsider_norev', '42501', pg_temp.mx('submit', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_cancelled_assignee_rev', '22023', pg_temp.mx('submit', 'cancelled', true), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_cancelled_assignee_norev', '22023', pg_temp.mx('submit', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_submit_cancelled_creator_rev', '42501', pg_temp.mx('submit', 'cancelled', true), pg_temp.uid('creator'));
select pg_temp.p('m_submit_cancelled_creator_norev', '42501', pg_temp.mx('submit', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_submit_cancelled_manage_rev', '42501', pg_temp.mx('submit', 'cancelled', true), pg_temp.uid('manage'));
select pg_temp.p('m_submit_cancelled_manage_norev', '42501', pg_temp.mx('submit', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_submit_cancelled_watcher_rev', '42501', pg_temp.mx('submit', 'cancelled', true), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_cancelled_watcher_norev', '42501', pg_temp.mx('submit', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_submit_cancelled_outsider_rev', '42501', pg_temp.mx('submit', 'cancelled', true), pg_temp.uid('outsider'));
select pg_temp.p('m_submit_cancelled_outsider_norev', '42501', pg_temp.mx('submit', 'cancelled', false), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_new_assignee_rev', '22023', pg_temp.mx('complete', 'new', true), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_new_assignee_norev', '22023', pg_temp.mx('complete', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_new_creator_rev', '42501', pg_temp.mx('complete', 'new', true), pg_temp.uid('creator'));
select pg_temp.p('m_complete_new_creator_norev', '42501', pg_temp.mx('complete', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_complete_new_manage_rev', '42501', pg_temp.mx('complete', 'new', true), pg_temp.uid('manage'));
select pg_temp.p('m_complete_new_manage_norev', '42501', pg_temp.mx('complete', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_complete_new_watcher_rev', '42501', pg_temp.mx('complete', 'new', true), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_new_watcher_norev', '42501', pg_temp.mx('complete', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_new_outsider_rev', '42501', pg_temp.mx('complete', 'new', true), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_new_outsider_norev', '42501', pg_temp.mx('complete', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_in_progress_assignee_rev', '22023', pg_temp.mx('complete', 'in_progress', true), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_in_progress_assignee_norev', 'OK done', pg_temp.mx('complete', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_in_progress_creator_rev', '42501', pg_temp.mx('complete', 'in_progress', true), pg_temp.uid('creator'));
select pg_temp.p('m_complete_in_progress_creator_norev', '42501', pg_temp.mx('complete', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_complete_in_progress_manage_rev', '42501', pg_temp.mx('complete', 'in_progress', true), pg_temp.uid('manage'));
select pg_temp.p('m_complete_in_progress_manage_norev', '42501', pg_temp.mx('complete', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_complete_in_progress_watcher_rev', '42501', pg_temp.mx('complete', 'in_progress', true), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_in_progress_watcher_norev', '42501', pg_temp.mx('complete', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_in_progress_outsider_rev', '42501', pg_temp.mx('complete', 'in_progress', true), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_in_progress_outsider_norev', '42501', pg_temp.mx('complete', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_paused_assignee_rev', '22023', pg_temp.mx('complete', 'paused', true), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_paused_assignee_norev', '22023', pg_temp.mx('complete', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_paused_creator_rev', '42501', pg_temp.mx('complete', 'paused', true), pg_temp.uid('creator'));
select pg_temp.p('m_complete_paused_creator_norev', '42501', pg_temp.mx('complete', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_complete_paused_manage_rev', '42501', pg_temp.mx('complete', 'paused', true), pg_temp.uid('manage'));
select pg_temp.p('m_complete_paused_manage_norev', '42501', pg_temp.mx('complete', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_complete_paused_watcher_rev', '42501', pg_temp.mx('complete', 'paused', true), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_paused_watcher_norev', '42501', pg_temp.mx('complete', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_paused_outsider_rev', '42501', pg_temp.mx('complete', 'paused', true), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_paused_outsider_norev', '42501', pg_temp.mx('complete', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_review_assignee_rev', '22023', pg_temp.mx('complete', 'review', true), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_review_assignee_norev', '22023', pg_temp.mx('complete', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_review_creator_rev', '42501', pg_temp.mx('complete', 'review', true), pg_temp.uid('creator'));
select pg_temp.p('m_complete_review_creator_norev', '42501', pg_temp.mx('complete', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_complete_review_manage_rev', '42501', pg_temp.mx('complete', 'review', true), pg_temp.uid('manage'));
select pg_temp.p('m_complete_review_manage_norev', '42501', pg_temp.mx('complete', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_complete_review_watcher_rev', '42501', pg_temp.mx('complete', 'review', true), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_review_watcher_norev', '42501', pg_temp.mx('complete', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_review_outsider_rev', '42501', pg_temp.mx('complete', 'review', true), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_review_outsider_norev', '42501', pg_temp.mx('complete', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_done_assignee_rev', '22023', pg_temp.mx('complete', 'done', true), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_done_assignee_norev', '22023', pg_temp.mx('complete', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_done_creator_rev', '42501', pg_temp.mx('complete', 'done', true), pg_temp.uid('creator'));
select pg_temp.p('m_complete_done_creator_norev', '42501', pg_temp.mx('complete', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_complete_done_manage_rev', '42501', pg_temp.mx('complete', 'done', true), pg_temp.uid('manage'));
select pg_temp.p('m_complete_done_manage_norev', '42501', pg_temp.mx('complete', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_complete_done_watcher_rev', '42501', pg_temp.mx('complete', 'done', true), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_done_watcher_norev', '42501', pg_temp.mx('complete', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_done_outsider_rev', '42501', pg_temp.mx('complete', 'done', true), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_done_outsider_norev', '42501', pg_temp.mx('complete', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_cancelled_assignee_rev', '22023', pg_temp.mx('complete', 'cancelled', true), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_cancelled_assignee_norev', '22023', pg_temp.mx('complete', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_complete_cancelled_creator_rev', '42501', pg_temp.mx('complete', 'cancelled', true), pg_temp.uid('creator'));
select pg_temp.p('m_complete_cancelled_creator_norev', '42501', pg_temp.mx('complete', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_complete_cancelled_manage_rev', '42501', pg_temp.mx('complete', 'cancelled', true), pg_temp.uid('manage'));
select pg_temp.p('m_complete_cancelled_manage_norev', '42501', pg_temp.mx('complete', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_complete_cancelled_watcher_rev', '42501', pg_temp.mx('complete', 'cancelled', true), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_cancelled_watcher_norev', '42501', pg_temp.mx('complete', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_complete_cancelled_outsider_rev', '42501', pg_temp.mx('complete', 'cancelled', true), pg_temp.uid('outsider'));
select pg_temp.p('m_complete_cancelled_outsider_norev', '42501', pg_temp.mx('complete', 'cancelled', false), pg_temp.uid('outsider'));
select pg_temp.p('m_accept_new_assignee', '42501', pg_temp.mx('accept', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_accept_new_creator', '22023', pg_temp.mx('accept', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_accept_new_manage', '22023', pg_temp.mx('accept', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_accept_new_watcher', '42501', pg_temp.mx('accept', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_accept_new_outsider', '42501', pg_temp.mx('accept', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_accept_in_progress_assignee', '42501', pg_temp.mx('accept', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_accept_in_progress_creator', '22023', pg_temp.mx('accept', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_accept_in_progress_manage', '22023', pg_temp.mx('accept', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_accept_in_progress_watcher', '42501', pg_temp.mx('accept', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_accept_in_progress_outsider', '42501', pg_temp.mx('accept', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_accept_paused_assignee', '42501', pg_temp.mx('accept', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_accept_paused_creator', '22023', pg_temp.mx('accept', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_accept_paused_manage', '22023', pg_temp.mx('accept', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_accept_paused_watcher', '42501', pg_temp.mx('accept', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_accept_paused_outsider', '42501', pg_temp.mx('accept', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_accept_review_assignee', '42501', pg_temp.mx('accept', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_accept_review_creator', 'OK done', pg_temp.mx('accept', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_accept_review_manage', 'OK done', pg_temp.mx('accept', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_accept_review_watcher', '42501', pg_temp.mx('accept', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_accept_review_outsider', '42501', pg_temp.mx('accept', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_accept_done_assignee', '42501', pg_temp.mx('accept', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_accept_done_creator', '22023', pg_temp.mx('accept', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_accept_done_manage', '22023', pg_temp.mx('accept', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_accept_done_watcher', '42501', pg_temp.mx('accept', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_accept_done_outsider', '42501', pg_temp.mx('accept', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_accept_cancelled_assignee', '42501', pg_temp.mx('accept', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_accept_cancelled_creator', '22023', pg_temp.mx('accept', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_accept_cancelled_manage', '22023', pg_temp.mx('accept', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_accept_cancelled_watcher', '42501', pg_temp.mx('accept', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_accept_cancelled_outsider', '42501', pg_temp.mx('accept', 'cancelled', false), pg_temp.uid('outsider'));
select pg_temp.p('m_return_new_assignee', '42501', pg_temp.mx('return', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_return_new_creator', '22023', pg_temp.mx('return', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_return_new_manage', '22023', pg_temp.mx('return', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_return_new_watcher', '42501', pg_temp.mx('return', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_return_new_outsider', '42501', pg_temp.mx('return', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_return_in_progress_assignee', '42501', pg_temp.mx('return', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_return_in_progress_creator', '22023', pg_temp.mx('return', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_return_in_progress_manage', '22023', pg_temp.mx('return', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_return_in_progress_watcher', '42501', pg_temp.mx('return', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_return_in_progress_outsider', '42501', pg_temp.mx('return', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_return_paused_assignee', '42501', pg_temp.mx('return', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_return_paused_creator', '22023', pg_temp.mx('return', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_return_paused_manage', '22023', pg_temp.mx('return', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_return_paused_watcher', '42501', pg_temp.mx('return', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_return_paused_outsider', '42501', pg_temp.mx('return', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_return_review_assignee', '42501', pg_temp.mx('return', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_return_review_creator', 'OK in_progress', pg_temp.mx('return', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_return_review_manage', 'OK in_progress', pg_temp.mx('return', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_return_review_watcher', '42501', pg_temp.mx('return', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_return_review_outsider', '42501', pg_temp.mx('return', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_return_done_assignee', '42501', pg_temp.mx('return', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_return_done_creator', 'OK in_progress', pg_temp.mx('return', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_return_done_manage', 'OK in_progress', pg_temp.mx('return', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_return_done_watcher', '42501', pg_temp.mx('return', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_return_done_outsider', '42501', pg_temp.mx('return', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_return_cancelled_assignee', '42501', pg_temp.mx('return', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_return_cancelled_creator', '22023', pg_temp.mx('return', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_return_cancelled_manage', '22023', pg_temp.mx('return', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_return_cancelled_watcher', '42501', pg_temp.mx('return', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_return_cancelled_outsider', '42501', pg_temp.mx('return', 'cancelled', false), pg_temp.uid('outsider'));
select pg_temp.p('m_cancel_new_assignee', '42501', pg_temp.mx('cancel', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_cancel_new_creator', 'OK cancelled', pg_temp.mx('cancel', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_cancel_new_manage', 'OK cancelled', pg_temp.mx('cancel', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_cancel_new_watcher', '42501', pg_temp.mx('cancel', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_cancel_new_outsider', '42501', pg_temp.mx('cancel', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_cancel_in_progress_assignee', '42501', pg_temp.mx('cancel', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_cancel_in_progress_creator', 'OK cancelled', pg_temp.mx('cancel', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_cancel_in_progress_manage', 'OK cancelled', pg_temp.mx('cancel', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_cancel_in_progress_watcher', '42501', pg_temp.mx('cancel', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_cancel_in_progress_outsider', '42501', pg_temp.mx('cancel', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_cancel_paused_assignee', '42501', pg_temp.mx('cancel', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_cancel_paused_creator', 'OK cancelled', pg_temp.mx('cancel', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_cancel_paused_manage', 'OK cancelled', pg_temp.mx('cancel', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_cancel_paused_watcher', '42501', pg_temp.mx('cancel', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_cancel_paused_outsider', '42501', pg_temp.mx('cancel', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_cancel_review_assignee', '42501', pg_temp.mx('cancel', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_cancel_review_creator', 'OK cancelled', pg_temp.mx('cancel', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_cancel_review_manage', 'OK cancelled', pg_temp.mx('cancel', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_cancel_review_watcher', '42501', pg_temp.mx('cancel', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_cancel_review_outsider', '42501', pg_temp.mx('cancel', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_cancel_done_assignee', '42501', pg_temp.mx('cancel', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_cancel_done_creator', '22023', pg_temp.mx('cancel', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_cancel_done_manage', '22023', pg_temp.mx('cancel', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_cancel_done_watcher', '42501', pg_temp.mx('cancel', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_cancel_done_outsider', '42501', pg_temp.mx('cancel', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_cancel_cancelled_assignee', '42501', pg_temp.mx('cancel', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_cancel_cancelled_creator', '22023', pg_temp.mx('cancel', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_cancel_cancelled_manage', '22023', pg_temp.mx('cancel', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_cancel_cancelled_watcher', '42501', pg_temp.mx('cancel', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_cancel_cancelled_outsider', '42501', pg_temp.mx('cancel', 'cancelled', false), pg_temp.uid('outsider'));
select pg_temp.p('m_reopen_new_assignee', '42501', pg_temp.mx('reopen', 'new', false), pg_temp.uid('assignee'));
select pg_temp.p('m_reopen_new_creator', '22023', pg_temp.mx('reopen', 'new', false), pg_temp.uid('creator'));
select pg_temp.p('m_reopen_new_manage', '22023', pg_temp.mx('reopen', 'new', false), pg_temp.uid('manage'));
select pg_temp.p('m_reopen_new_watcher', '42501', pg_temp.mx('reopen', 'new', false), pg_temp.uid('watcher'));
select pg_temp.p('m_reopen_new_outsider', '42501', pg_temp.mx('reopen', 'new', false), pg_temp.uid('outsider'));
select pg_temp.p('m_reopen_in_progress_assignee', '42501', pg_temp.mx('reopen', 'in_progress', false), pg_temp.uid('assignee'));
select pg_temp.p('m_reopen_in_progress_creator', '22023', pg_temp.mx('reopen', 'in_progress', false), pg_temp.uid('creator'));
select pg_temp.p('m_reopen_in_progress_manage', '22023', pg_temp.mx('reopen', 'in_progress', false), pg_temp.uid('manage'));
select pg_temp.p('m_reopen_in_progress_watcher', '42501', pg_temp.mx('reopen', 'in_progress', false), pg_temp.uid('watcher'));
select pg_temp.p('m_reopen_in_progress_outsider', '42501', pg_temp.mx('reopen', 'in_progress', false), pg_temp.uid('outsider'));
select pg_temp.p('m_reopen_paused_assignee', '42501', pg_temp.mx('reopen', 'paused', false), pg_temp.uid('assignee'));
select pg_temp.p('m_reopen_paused_creator', '22023', pg_temp.mx('reopen', 'paused', false), pg_temp.uid('creator'));
select pg_temp.p('m_reopen_paused_manage', '22023', pg_temp.mx('reopen', 'paused', false), pg_temp.uid('manage'));
select pg_temp.p('m_reopen_paused_watcher', '42501', pg_temp.mx('reopen', 'paused', false), pg_temp.uid('watcher'));
select pg_temp.p('m_reopen_paused_outsider', '42501', pg_temp.mx('reopen', 'paused', false), pg_temp.uid('outsider'));
select pg_temp.p('m_reopen_review_assignee', '42501', pg_temp.mx('reopen', 'review', false), pg_temp.uid('assignee'));
select pg_temp.p('m_reopen_review_creator', '22023', pg_temp.mx('reopen', 'review', false), pg_temp.uid('creator'));
select pg_temp.p('m_reopen_review_manage', '22023', pg_temp.mx('reopen', 'review', false), pg_temp.uid('manage'));
select pg_temp.p('m_reopen_review_watcher', '42501', pg_temp.mx('reopen', 'review', false), pg_temp.uid('watcher'));
select pg_temp.p('m_reopen_review_outsider', '42501', pg_temp.mx('reopen', 'review', false), pg_temp.uid('outsider'));
select pg_temp.p('m_reopen_done_assignee', '42501', pg_temp.mx('reopen', 'done', false), pg_temp.uid('assignee'));
select pg_temp.p('m_reopen_done_creator', '22023', pg_temp.mx('reopen', 'done', false), pg_temp.uid('creator'));
select pg_temp.p('m_reopen_done_manage', '22023', pg_temp.mx('reopen', 'done', false), pg_temp.uid('manage'));
select pg_temp.p('m_reopen_done_watcher', '42501', pg_temp.mx('reopen', 'done', false), pg_temp.uid('watcher'));
select pg_temp.p('m_reopen_done_outsider', '42501', pg_temp.mx('reopen', 'done', false), pg_temp.uid('outsider'));
select pg_temp.p('m_reopen_cancelled_assignee', '42501', pg_temp.mx('reopen', 'cancelled', false), pg_temp.uid('assignee'));
select pg_temp.p('m_reopen_cancelled_creator', 'OK in_progress', pg_temp.mx('reopen', 'cancelled', false), pg_temp.uid('creator'));
select pg_temp.p('m_reopen_cancelled_manage', 'OK in_progress', pg_temp.mx('reopen', 'cancelled', false), pg_temp.uid('manage'));
select pg_temp.p('m_reopen_cancelled_watcher', '42501', pg_temp.mx('reopen', 'cancelled', false), pg_temp.uid('watcher'));
select pg_temp.p('m_reopen_cancelled_outsider', '42501', pg_temp.mx('reopen', 'cancelled', false), pg_temp.uid('outsider'));
-- <<< матрица переходов

-- Сдача на проверку: постановщик (он же менеджер заказа) — одно уведомление, вида task_review
select pg_temp.p('m_submit_one_notice', 'OK 0', format($q$select count(*)::text from (
  select e.id from public.erp_biz_task_events e
    left join public.erp_notifications n on n.task_event_id = e.id and n.user_id = %L
   where e.task_id = %L and e.kind = 'submitted' group by e.id having count(n.id) <> 1) x$q$,
  pg_temp.uid('creator'), pg_temp.fx('task_rev')));
select pg_temp.p('m_submit_review_kind', 'OK task_review', format($q$select string_agg(distinct n.kind, ',')
  from public.erp_notifications n join public.erp_biz_task_events e on e.id = n.task_event_id
 where e.task_id = %L and e.kind = 'submitted' and n.user_id = %L$q$, pg_temp.fx('task_rev'), pg_temp.uid('creator')));

-- ── Создание ─────────────────────────────────────────────────────────────
select pg_temp.p('create_ok', 'OK new', format($q$select (public.erp_biz_task_create(%s, '00000000-0000-4000-8000-0000b2000001')).status$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'), jsonb_build_object(
    'watchers', jsonb_build_array(pg_temp.uid('watcher'), pg_temp.uid('watcher'), pg_temp.uid('creator')),
    'checklist', jsonb_build_array('Позвонить', jsonb_build_object('text', 'Забрать'))))), pg_temp.uid('creator'));
insert into fx values ('t1', (select id from public.erp_biz_tasks where client_key = '00000000-0000-4000-8000-0000b2000001'));
select pg_temp.p('create_repeat_same_row', 'OK true', format($q$select ((public.erp_biz_task_create(%s, '00000000-0000-4000-8000-0000b2000001')).id = %L)::text$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee')), pg_temp.fx('t1')), pg_temp.uid('creator'));
select pg_temp.p('create_repeat_one_row', 'OK 1', $q$select count(*)::text from public.erp_biz_tasks where client_key = '00000000-0000-4000-8000-0000b2000001'$q$);
select pg_temp.p('create_repeat_foreign_key', '22023', format($q$select public.erp_biz_task_create(%s, '00000000-0000-4000-8000-0000b2000001')$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'))), pg_temp.uid('outsider'));
-- Менеджер заказа = постановщик: наблюдатель один (WATCHER), без постановщика
select pg_temp.p('create_watchers_once', 'OK 1', format($q$select count(*)::text from public.erp_biz_task_watchers where task_id = %L$q$, pg_temp.fx('t1')));
select pg_temp.p('create_checklist', 'OK Позвонить,Забрать', format($q$select string_agg(text, ',' order by sort) from public.erp_biz_task_checklist where task_id = %L$q$, pg_temp.fx('t1')));
select pg_temp.p('create_assigned_notice', 'OK 1', format($q$select count(*)::text from public.erp_notifications where task_id = %L and kind = 'task_assigned' and user_id = %L$q$,
  pg_temp.fx('t1'), pg_temp.uid('assignee')));
select pg_temp.p('create_event', 'OK created', format($q$select string_agg(kind, ',') from public.erp_biz_task_events where task_id = %L$q$, pg_temp.fx('t1')));
select pg_temp.p('create_creator_id', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'), jsonb_build_object('creator_id', pg_temp.uid('watcher')))), pg_temp.uid('creator'));
select pg_temp.p('create_status_key', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'), '{"status": "done"}'::jsonb)), pg_temp.uid('creator'));
select pg_temp.p('create_inactive_assignee', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('off'))), pg_temp.uid('creator'));
select pg_temp.p('create_noemp_assignee', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('noemp'))), pg_temp.uid('creator'));
select pg_temp.p('create_done_order', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order_done'), pg_temp.uid('assignee'))), pg_temp.uid('creator'));
select pg_temp.p('create_bad_kind', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'), '{"kind": "meeting"}'::jsonb)), pg_temp.uid('creator'));
select pg_temp.p('create_no_due', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'), '{"due_at": null}'::jsonb)), pg_temp.uid('creator'));
select pg_temp.p('create_21_watchers', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'), jsonb_build_object('watchers',
    (select jsonb_agg(gen_random_uuid()) from generate_series(1, 21))))), pg_temp.uid('creator'));
select pg_temp.p('create_101_items', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'), jsonb_build_object('checklist',
    (select jsonb_agg('п' || g) from generate_series(1, 101) g)))), pg_temp.uid('creator'));
select pg_temp.p('create_watcher_off', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'), jsonb_build_object('watchers', jsonb_build_array(pg_temp.uid('off'))))), pg_temp.uid('creator'));
select pg_temp.p('create_seller', '42501', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'))), pg_temp.uid('seller'));
select pg_temp.p('create_noemp', '42501', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'))), pg_temp.uid('noemp'));
select pg_temp.p('create_off', '42501', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'))), pg_temp.uid('off'));
-- Менеджер заказа ORDER2 (STAFF2) — наблюдатель сам собой
select pg_temp.p('create_manager_watcher', 'OK new', format($q$select (public.erp_biz_task_create(%s, '00000000-0000-4000-8000-0000b2000002')).status$q$,
  pg_temp.tj(pg_temp.fx('order2'), pg_temp.uid('assignee'))), pg_temp.uid('creator'));
insert into fx values ('t2', (select id from public.erp_biz_tasks where client_key = '00000000-0000-4000-8000-0000b2000002'));
select pg_temp.p('create_manager_is_watcher', 'OK 1', format($q$select count(*)::text from public.erp_biz_task_watchers where task_id = %L and user_id = %L$q$,
  pg_temp.fx('t2'), pg_temp.uid('staff2')));
-- Р8: 30 задач в час на постановщика, 31-я — отказ
select pg_temp.p('rate_30', 'OK', format($q$select count(public.erp_biz_task_create(%s, gen_random_uuid()))::text
  from generate_series(1, 30 - (select count(*) from public.erp_biz_tasks where creator_id = %L and created_at > now() - interval '1 hour')::int)$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee')), pg_temp.uid('manage')), pg_temp.uid('manage'));
select pg_temp.p('rate_31', '22023', format($q$select public.erp_biz_task_create(%s, gen_random_uuid())$q$,
  pg_temp.tj(pg_temp.fx('order'), pg_temp.uid('assignee'))), pg_temp.uid('manage'));

-- ── Уведомление о старте: постановщик = менеджер заказа — одно ───────────
select pg_temp.p('start_t1', 'OK in_progress', format($q$select (public.erp_biz_task_transition(%L, 'start', null, %s)).status$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('assignee'));
select pg_temp.p('start_one_notice', 'OK 1', format($q$select count(*)::text from public.erp_notifications n
  join public.erp_biz_task_events e on e.id = n.task_event_id where e.task_id = %L and e.kind = 'started' and n.user_id = %L$q$,
  pg_temp.fx('t1'), pg_temp.uid('creator')));
select pg_temp.p('start_author_silent', 'OK 0', format($q$select count(*)::text from public.erp_notifications n
  join public.erp_biz_task_events e on e.id = n.task_event_id where e.task_id = %L and e.kind = 'started' and n.user_id = %L$q$,
  pg_temp.fx('t1'), pg_temp.uid('assignee')));

-- ── Наблюдатель, посторонний, профиль без карточки ───────────────────────
select pg_temp.p('watcher_complete', '42501', format($q$select public.erp_biz_task_transition(%L, 'complete', 'готово', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('watcher'));
select pg_temp.p('watcher_update_due', '42501', format($q$select public.erp_biz_task_update(%L, '{"due_at": "2030-01-01T10:00:00+03", "due_reason": "x"}', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('watcher'));
select pg_temp.p('watcher_update_assignee', '42501', format($q$select public.erp_biz_task_update(%L, jsonb_build_object('assignee_id', %L), %s)$q$,
  pg_temp.fx('t1'), pg_temp.uid('watcher'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('watcher'));
select pg_temp.p('noemp_cancel', '42501', format($q$select public.erp_biz_task_transition(%L, 'cancel', 'не нужно', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('noemp'));
select pg_temp.p('noemp_update', '42501', format($q$select public.erp_biz_task_update(%L, '{"title": "чужое"}', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('noemp'));
select pg_temp.p('outsider_update', '42501', format($q$select public.erp_biz_task_update(%L, '{"title": "чужое"}', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('outsider'));
select pg_temp.p('stale_version', 'P0001', format($q$select public.erp_biz_task_update(%L, '{"title": "новое"}', (%s::timestamptz - interval '1 second'))$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('creator'));
select pg_temp.p('no_version', 'P0001', format($q$select public.erp_biz_task_transition(%L, 'pause', 'ждём', null)$q$,
  pg_temp.fx('t1')), pg_temp.uid('assignee'));
select pg_temp.p('unknown_action', '22023', format($q$select public.erp_biz_task_transition(%L, 'archive', null, %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('creator'));
select pg_temp.p('pause_no_reason', '22023', format($q$select public.erp_biz_task_transition(%L, 'pause', '  ', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('assignee'));

-- ── Правка постановщиком и manage ────────────────────────────────────────
select pg_temp.p('update_extra_key', '22023', format($q$select public.erp_biz_task_update(%L, '{"status": "done"}', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('creator'));
select pg_temp.p('due_no_reason', '22023', format($q$select public.erp_biz_task_update(%L, '{"due_at": "2030-01-01T10:00:00+03"}', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('creator'));
select pg_temp.p('due_with_reason', 'OK 2030-01-01', format($q$select ((public.erp_biz_task_update(%L, '{"due_at": "2030-01-01T10:00:00+03", "due_reason": "Поставщик задержал"}', %s)).due_at at time zone 'Europe/Moscow')::date::text$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('creator'));
select pg_temp.p('due_event', 'OK Поставщик задержал', format($q$select payload->>'reason' from public.erp_biz_task_events where task_id = %L and kind = 'due_changed' and payload ? 'from' and payload ? 'to'$q$,
  pg_temp.fx('t1')));
select pg_temp.p('update_watcher_off', '22023', format($q$select public.erp_biz_task_update(%L, jsonb_build_object('watchers', jsonb_build_array(%L)), %s)$q$,
  pg_temp.fx('t1'), pg_temp.uid('off'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('creator'));
-- Смена ответственного руководителем: новому, прежнему и постановщику — по одному
select pg_temp.p('assignee_by_manage', 'OK', format($q$select (public.erp_biz_task_update(%L, jsonb_build_object('assignee_id', %L), %s)).assignee_id::text$q$,
  pg_temp.fx('t2'), pg_temp.uid('watcher'), pg_temp.ver(pg_temp.fx('t2'))), pg_temp.uid('manage'));
select pg_temp.p('assignee_notices', 'OK task_assigned:43a8021c,task_status:e73bd7fd,task_unassigned:72b71eba', format($q$select string_agg(n.kind || ':' || left(n.user_id::text, 8), ',' order by n.kind)
  from public.erp_notifications n join public.erp_biz_task_events e on e.id = n.task_event_id
 where e.task_id = %L and e.kind = 'assignee_changed'$q$, pg_temp.fx('t2')));
select pg_temp.p('watcher_change_by_manage', 'OK', format($q$select public.erp_biz_task_update(%L, jsonb_build_object('watchers', jsonb_build_array(%L, %L)), %s)::text$q$,
  pg_temp.fx('t2'), pg_temp.uid('staff2'), pg_temp.uid('outsider'), pg_temp.ver(pg_temp.fx('t2'))), pg_temp.uid('manage'));
select pg_temp.p('watcher_change_event', 'OK 1', format($q$select count(*)::text from public.erp_biz_task_events where task_id = %L and kind = 'watchers_changed'$q$, pg_temp.fx('t2')));

-- ── Чек-лист ─────────────────────────────────────────────────────────────
select pg_temp.p('toggle_own', 'OK', format($q$select public.erp_biz_task_checklist_op(%L, 'toggle', jsonb_build_object('id', (select id from public.erp_biz_task_checklist where task_id = %L order by sort limit 1), 'done', true))::text$q$,
  pg_temp.fx('t1'), pg_temp.fx('t1')), pg_temp.uid('assignee'));
select pg_temp.p('toggle_foreign_item', '22023', format($q$select public.erp_biz_task_checklist_op(%L, 'toggle', jsonb_build_object('id', %L))$q$,
  pg_temp.fx('t1'), pg_temp.fx('foreign_item')), pg_temp.uid('assignee'));
select pg_temp.p('add_by_watcher', '42501', format($q$select public.erp_biz_task_checklist_op(%L, 'add', '{"text": "ещё"}')$q$,
  pg_temp.fx('t1')), pg_temp.uid('watcher'));
select pg_temp.p('toggle_by_watcher', '42501', format($q$select public.erp_biz_task_checklist_op(%L, 'toggle', jsonb_build_object('id', (select id from public.erp_biz_task_checklist where task_id = %L order by sort limit 1)))$q$,
  pg_temp.fx('t1'), pg_temp.fx('t1')), pg_temp.uid('watcher'));
select pg_temp.p('add_by_creator', 'OK in_progress', format($q$select (public.erp_biz_task_checklist_op(%L, 'add', '{"text": "Отчитаться"}')).status$q$,
  pg_temp.fx('t1')), pg_temp.uid('creator'));
select pg_temp.p('add_appended', 'OK Позвонить,Забрать,Отчитаться', format($q$select string_agg(text, ',' order by sort) from public.erp_biz_task_checklist where task_id = %L$q$, pg_temp.fx('t1')));
select pg_temp.p('toggle_done_by', 'OK 72b71eba', format($q$select left(done_by::text, 8) from public.erp_biz_task_checklist where task_id = %L and done$q$, pg_temp.fx('t1')));

-- ── Файлы ────────────────────────────────────────────────────────────────
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('erp-attachments', format('att/%s/biz_task/probe-own.pdf', pg_temp.fx('order')), pg_temp.uid('watcher')::uuid, pg_temp.uid('watcher')),
  ('erp-attachments', format('att/%s/biz_task/probe-foreign.pdf', pg_temp.fx('order')), pg_temp.uid('creator')::uuid, pg_temp.uid('creator')),
  ('erp-attachments', format('att/%s/chat/probe-chat.pdf', pg_temp.fx('order')), pg_temp.uid('watcher')::uuid, pg_temp.uid('watcher'));
select pg_temp.p('attach_own', 'OK', format($q$select public.erp_biz_task_attach(%L, jsonb_build_array(jsonb_build_object('file_path', %L, 'file_name', 'накладная.pdf')))::text$q$,
  pg_temp.fx('t1'), format('att/%s/biz_task/probe-own.pdf', pg_temp.fx('order'))), pg_temp.uid('watcher'));
select pg_temp.p('attach_row', 'OK 1', format($q$select count(*)::text from public.erp_order_attachments where biz_task_id = %L and kind = 'biz_task' and order_id = %L$q$,
  pg_temp.fx('t1'), pg_temp.fx('order')));
select pg_temp.p('attach_foreign_owner', '42501', format($q$select public.erp_biz_task_attach(%L, jsonb_build_array(jsonb_build_object('file_path', %L)))$q$,
  pg_temp.fx('t1'), format('att/%s/biz_task/probe-foreign.pdf', pg_temp.fx('order'))), pg_temp.uid('watcher'));
select pg_temp.p('attach_foreign_folder', '42501', format($q$select public.erp_biz_task_attach(%L, jsonb_build_array(jsonb_build_object('file_path', %L)))$q$,
  pg_temp.fx('t1'), format('att/%s/chat/probe-chat.pdf', pg_temp.fx('order'))), pg_temp.uid('watcher'));
select pg_temp.p('attach_outsider', '42501', format($q$select public.erp_biz_task_attach(%L, jsonb_build_array(jsonb_build_object('file_path', %L)))$q$,
  pg_temp.fx('t1'), format('att/%s/biz_task/probe-own.pdf', pg_temp.fx('order'))), pg_temp.uid('outsider'));

-- ── Результат и «видел» ──────────────────────────────────────────────────
insert into public.erp_chat_threads (task_id) values (pg_temp.fx('t1'));
insert into public.erp_chat_messages (thread_id, author_id, body)
select t.id, pg_temp.uid('assignee')::uuid, 'Ткань забрана, лежит на складе' from public.erp_chat_threads t where t.task_id = pg_temp.fx('t1');
insert into public.erp_chat_messages (thread_id, author_id, body)
select t.id, pg_temp.uid('creator')::uuid, 'Спасибо' from public.erp_chat_threads t where t.task_id = pg_temp.fx('t1');
insert into fx values ('msg_own', (select m.id from public.erp_chat_messages m join public.erp_chat_threads t on t.id = m.thread_id
                                     where t.task_id = pg_temp.fx('t1') and m.author_id = pg_temp.uid('assignee')::uuid));
insert into fx values ('msg_creator', (select m.id from public.erp_chat_messages m join public.erp_chat_threads t on t.id = m.thread_id
                                         where t.task_id = pg_temp.fx('t1') and m.author_id = pg_temp.uid('creator')::uuid));
select pg_temp.p('result_from_message', 'OK Ткань забрана, лежит на складе', format($q$select (public.erp_biz_task_set_result(%L, null, %L)).result_text$q$,
  pg_temp.fx('t1'), pg_temp.fx('msg_own')), pg_temp.uid('assignee'));
select pg_temp.p('result_foreign_message', '22023', format($q$select public.erp_biz_task_set_result(%L, null, %L)$q$,
  pg_temp.fx('t1'), pg_temp.fx('msg_creator')), pg_temp.uid('assignee'));
select pg_temp.p('result_by_creator', '42501', format($q$select public.erp_biz_task_set_result(%L, 'итог', null)$q$,
  pg_temp.fx('t1')), pg_temp.uid('creator'));
select pg_temp.p('result_event', 'OK 1', format($q$select count(*)::text from public.erp_biz_task_events where task_id = %L and kind = 'result_changed'$q$, pg_temp.fx('t1')));
select pg_temp.p('seen_keeps_status', 'OK in_progress', format($q$select (public.erp_biz_task_mark_seen(%L)).status$q$, pg_temp.fx('t1')), pg_temp.uid('assignee'));
select pg_temp.p('seen_by_creator', 'OK true', format($q$select (public.erp_biz_task_seen_by(%L) is not null)::text$q$, pg_temp.fx('t1')), pg_temp.uid('creator'));
select pg_temp.p('seen_by_outsider', '42501', format($q$select public.erp_biz_task_seen_by(%L)$q$, pg_temp.fx('t1')), pg_temp.uid('outsider'));
select pg_temp.p('seen_rows_own_only', 'OK 0', $q$select count(*)::text from public.erp_biz_task_seen$q$, pg_temp.uid('creator'));

-- ── Завершение и возврат: время сдачи стирается, ответственному — task_returned ─
select pg_temp.p('complete_t1', 'OK done', format($q$select (public.erp_biz_task_transition(%L, 'complete', 'Доставлено на склад', %s)).status$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('assignee'));
select pg_temp.p('done_update_title', '22023', format($q$select public.erp_biz_task_update(%L, '{"title": "после"}', %s)$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('creator'));
select pg_temp.p('return_t1', 'OK in_progress true', format($q$select r.status || ' ' || (r.completed_at is null and r.submitted_at is null)::text
  from public.erp_biz_task_transition(%L, 'return', 'Нет накладной', %s) r$q$,
  pg_temp.fx('t1'), pg_temp.ver(pg_temp.fx('t1'))), pg_temp.uid('creator'));
select pg_temp.p('return_notice', 'OK task_returned', format($q$select string_agg(n.kind, ',') from public.erp_notifications n
  join public.erp_biz_task_events e on e.id = n.task_event_id where e.task_id = %L and e.kind = 'returned' and n.user_id = %L$q$,
  pg_temp.fx('t1'), pg_temp.uid('assignee')));

-- ── Счётчики и права на вызов ────────────────────────────────────────────
select pg_temp.p('counts', 'OK true', format($q$select (open >= 1 and overdue >= 0 and done >= 0)::text from public.erp_biz_task_counts(%L)$q$,
  pg_temp.fx('order')), pg_temp.uid('watcher'));
select pg_temp.p('helper_closed', '42501', format($q$select public.erp_profile_is_staff(%L)$q$, pg_temp.uid('watcher')), pg_temp.uid('watcher'));
select pg_temp.p('helper_notify_closed', '42501', format($q$select public.erp_biz_task_notify(%L, 1, 'task_status', array[%L]::uuid[], 'x', null)$q$,
  pg_temp.fx('t1'), pg_temp.uid('watcher')), pg_temp.uid('watcher'));
select pg_temp.p('anon_closed', '42501', format($q$select public.erp_biz_task_mark_seen(%L)$q$, pg_temp.fx('t1')), 'anon');

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
