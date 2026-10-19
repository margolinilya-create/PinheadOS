-- Правки 19.10, п. 7 — «Бизнес-задачи» к заказам. Миграция T2: ПИСАТЕЛИ.
--
-- ЧТО ЭТО. Схема (T1, `20261020090000_erp_biz_tasks_schema`) отдаёт клиенту
-- задачи только на чтение. Здесь — единственный вход на запись: `security
-- definer` RPC, у каждой свой гейт, и событие истории с уведомлениями ложится
-- той же транзакцией, что и само изменение.
--
-- КТО ЕСТЬ КТО.
--   · Ворота любого писателя — `erp_biz_task_gate()`: активный одобренный
--     профиль (`erp_is_member()`) с активной записью `erp_employees`; admin
--     и director профиля допущены, как в прочих правах ERP. Продавец и
--     профиль `manager` без карточки сотрудника — 42501 (решение Р2).
--   · Постановщик — `creator_id`, ответственный — `assignee_id`, наблюдатели —
--     `erp_biz_task_watchers`.
--   · «Постановщик / manage» — постановщик или `erp_biz_task_can_manage()`:
--     право `biz_task.manage` ТОЛЬКО по должности из `erp_employees`
--     (ревизия безопасности B1): запасная роль профиля `manager` без карточки
--     сотрудника получает право в матрице, но управлять задачами не может.
--
-- ОШИБКИ. Неверный переход, неверные поля, лимиты — 22023; чужая роль — 42501;
-- устаревшая версия — P0001 «Задача изменена — обновите карточку»; задачи
-- нет — P0002. Ответ писателя — строка задачи с новым `updated_at`
-- (версия для следующего `p_expected_updated_at`).
--
-- УВЕДОМЛЕНИЯ пишет один помощник `erp_biz_task_notify`: адресаты — `distinct`,
-- без автора действия, только сотрудники ERP; уникальный ключ
-- `(user_id, task_event_id)` из T1 гарантирует одно уведомление человеку
-- на событие, сколько бы ролей у него ни было (постановщик = менеджер заказа).
--
-- ДИАЛОГ ЗАДАЧИ И НАПОМИНАНИЯ (T3) — вторая половина этого файла: лимит
-- неприменённых миграций ≤ 5. Пересоздаёт `erp_chat_send`/`erp_chat_page`
-- с параметром `p_task_id` (drop старой подписи в той же транзакции),
-- `erp_chat_edit`/`erp_chat_delete`; новые `erp_chat_unread_tasks`
-- и `erp_biz_task_reminders_run` + расписание `pg_cron`. Откат всей
-- миграции — `supabase/rollout/r1910b/20261020100000_erp_biz_tasks_rpc_rollback.sql`.
--
-- ПРИМЕНЕНИЕ — владелец в SQL Editor после T1: сухой прогон с пробой
-- `supabase/probes/erp_biz_tasks.sql`, затем применение и `notify pgrst`.

-- ── Помощники (EXECUTE никому) ────────────────────────────────────────────

-- Сотрудник ERP: активный одобренный профиль с активной карточкой
-- сотрудника. Проверяет ответственного, наблюдателей, менеджера заказа
-- и каждого адресата уведомления
create or replace function public.erp_profile_is_staff(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = p_user
       and p.active is true and p.approved is true
       and exists (select 1
                     from public.erp_employees e
                    where e.profile_id = p_user and e.active is true)
  );
$$;

revoke execute on function public.erp_profile_is_staff(uuid) from public, anon, authenticated;

-- Управлять чужими задачами (Р2 + ревизия B1): право по матрице И карточка
-- сотрудника; admin и director профиля — как в прочих правах ERP
create or replace function public.erp_biz_task_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.erp_has_permission('biz_task.manage')
     and (public.erp_profile_is_staff((select auth.uid()))
          or exists (select 1
                       from public.profiles p
                      where p.id = (select auth.uid())
                        and p.active is true and p.approved is true
                        and p.role in ('admin', 'director')));
$$;

revoke execute on function public.erp_biz_task_can_manage() from public, anon, authenticated;

-- Ворота писателя: возвращает вызывающего или отказывает 42501
create or replace function public.erp_biz_task_gate()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or not public.erp_is_member()
     or not (public.erp_profile_is_staff(v_me)
             or exists (select 1 from public.profiles p
                         where p.id = v_me and p.role in ('admin', 'director'))) then
    raise exception 'Бизнес-задачи доступны только сотрудникам ERP' using errcode = '42501';
  end if;
  return v_me;
end $$;

revoke execute on function public.erp_biz_task_gate() from public, anon, authenticated;

-- Участник задачи: постановщик, ответственный или наблюдатель
create or replace function public.erp_biz_task_is_participant(p_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.erp_biz_tasks t
                  where t.id = p_id and (t.creator_id = p_user or t.assignee_id = p_user))
      or exists (select 1 from public.erp_biz_task_watchers w
                  where w.task_id = p_id and w.user_id = p_user);
$$;

revoke execute on function public.erp_biz_task_is_participant(uuid, uuid) from public, anon, authenticated;

-- Событие истории: автор — вызывающий
create or replace function public.erp_biz_task_log(p_id uuid, p_kind text, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.erp_biz_task_events (task_id, kind, actor, payload)
  values (p_id, p_kind, (select auth.uid()), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.erp_biz_task_log(uuid, text, jsonb) from public, anon, authenticated;

-- ЕДИНСТВЕННЫЙ писатель уведомлений задачи. Адресаты — `distinct`, без автора
-- действия, только сотрудники ERP; повтор адресата на том же событии (вторая
-- роль того же человека, второй вид уведомления) гасит уникальный ключ.
-- Поэтому вызывающий зовёт более точный вид первым (`task_review` раньше
-- `task_status`): кто уже получил уведомление о событии, второго не получит.
-- `p_title` — ШАБЛОН заголовка: `{task}` заменяется названием задачи в
-- «ёлочках», `{order}` — номером заказа (PH-…). Заголовки заморожены здесь,
-- клиент показывает `title` как есть (план, Task 9): «Вам поручена задача
-- «…» · PH-1234», «До срока задачи «…» меньше 24 часов», «Задача «…»
-- просрочена». Шаблон без `{task}` — ошибка писателя, а не молчаливый текст
create or replace function public.erp_biz_task_notify(
  p_id uuid, p_event bigint, p_kind text, p_users uuid[], p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid;
  v_label text;
  v_title text;
begin
  select t.order_id, coalesce(nullif(btrim(o.bitrix_id), ''), o.title), t.title
    into v_order, v_label, v_title
    from public.erp_biz_tasks t
    join public.erp_orders o on o.id = t.order_id
   where t.id = p_id;

  if position('{task}' in coalesce(p_title, '')) = 0 then
    raise exception 'Шаблон уведомления задачи без {task}' using errcode = '22023';
  end if;

  insert into public.erp_notifications
    (user_id, kind, order_id, title, body, link, task_id, task_event_id)
  select distinct u, p_kind, v_order,
         left(replace(replace(p_title, '{task}', '«' || coalesce(v_title, '') || '»'),
                      '{order}', coalesce(nullif(btrim(v_label), ''), 'заказ')), 300),
         left('Заказ ' || coalesce(v_label, '') || coalesce(' · ' || nullif(btrim(p_body), ''), ''), 300),
         '/biz-tasks/' || p_id::text || '?event=' || p_event::text,
         p_id, p_event
    from unnest(coalesce(p_users, '{}'::uuid[])) u
   where u is not null
     and u is distinct from (select auth.uid())
     and public.erp_profile_is_staff(u)
  on conflict (user_id, task_event_id) where task_event_id is not null do nothing;
end $$;

revoke execute on function public.erp_biz_task_notify(uuid, bigint, text, uuid[], text, text) from public, anon, authenticated;

-- ── Создание ──────────────────────────────────────────────────────────────
--
-- Белый список ключей: всё прочее (`creator_id`, `status`, `id`, `result_*`…)
-- — 22023, а не молчаливый пропуск: клиент, приславший постановщика, должен
-- узнать, что сервер его не взял. Постановщик — всегда вызывающий.
-- Повтор той же попытки (`client_key`) возвращает прежнюю строку.
create or replace function public.erp_biz_task_create(p_task jsonb, p_client_key uuid)
returns public.erp_biz_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.erp_biz_task_gate();
  v_allowed constant text[] := array['order_id', 'title', 'kind', 'description', 'assignee_id', 'due_at',
                                     'review_required', 'watchers', 'checklist'];
  v_extra text[];
  v_row public.erp_biz_tasks;
  v_order uuid;
  v_order_status text;
  v_manager uuid;
  v_title text;
  v_kind text;
  v_descr text;
  v_assignee uuid;
  v_due timestamptz;
  v_review boolean;
  v_watchers uuid[];
  v_items text[];
  v_id uuid;
  v_event bigint;
begin
  if p_client_key is null then
    raise exception 'Не передан ключ попытки' using errcode = '22023';
  end if;
  if p_task is null or jsonb_typeof(p_task) <> 'object' then
    raise exception 'Задача передана не объектом' using errcode = '22023';
  end if;

  -- Повтор «Создать задачу» (двойной клик, оборванный ответ): та же строка
  select t.* into v_row from public.erp_biz_tasks t where t.client_key = p_client_key;
  if found then
    if v_row.creator_id is distinct from v_me then
      raise exception 'Ключ попытки уже использован' using errcode = '22023';
    end if;
    return v_row;
  end if;

  select array_agg(k order by k) into v_extra
    from jsonb_object_keys(p_task) k
   where not (k = any (v_allowed));
  if v_extra is not null then
    raise exception 'Задача: недопустимые поля %', array_to_string(v_extra, ', ') using errcode = '22023';
  end if;

  -- Заказ: есть, не сдан и не отменён
  begin
    v_order := nullif(p_task->>'order_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Неверный заказ' using errcode = '22023';
  end;
  select o.status, o.manager_id into v_order_status, v_manager
    from public.erp_orders o where o.id = v_order;
  if not found then
    raise exception 'Заказ не найден' using errcode = '22023';
  end if;
  if v_order_status like 'done%' or v_order_status = 'cancelled' then
    raise exception 'Заказ закрыт — новые задачи к нему не ставятся' using errcode = '22023';
  end if;

  v_title := btrim(coalesce(p_task->>'title', ''));
  if char_length(v_title) not between 1 and 200 then
    raise exception 'Название — от 1 до 200 символов' using errcode = '22023';
  end if;

  v_kind := p_task->>'kind';
  if v_kind is null or v_kind not in ('delivery', 'purchase', 'other') then
    raise exception 'Неверный тип задачи' using errcode = '22023';
  end if;

  v_descr := nullif(btrim(coalesce(p_task->>'description', '')), '');
  if char_length(v_descr) > 10000 then
    raise exception 'Описание длиннее 10000 символов' using errcode = '22023';
  end if;

  begin
    v_assignee := nullif(p_task->>'assignee_id', '')::uuid;
    v_due := nullif(p_task->>'due_at', '')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Неверный ответственный или срок' using errcode = '22023';
  end;
  if v_assignee is null or not public.erp_profile_is_staff(v_assignee) then
    raise exception 'Ответственный — не активный сотрудник ERP' using errcode = '22023';
  end if;
  if v_due is null then
    raise exception 'Не указан срок' using errcode = '22023';
  end if;

  if p_task ? 'review_required' and jsonb_typeof(p_task->'review_required') <> 'boolean' then
    raise exception 'Проверка постановщиком — да или нет' using errcode = '22023';
  end if;
  v_review := coalesce((p_task->>'review_required')::boolean, false);

  -- Наблюдатели (Р8: ≤ 20) — только сотрудники ERP
  if p_task ? 'watchers' and jsonb_typeof(p_task->'watchers') <> 'array' then
    raise exception 'Наблюдатели — списком' using errcode = '22023';
  end if;
  begin
    select coalesce(array_agg(distinct w::uuid), '{}'::uuid[]) into v_watchers
      from jsonb_array_elements_text(coalesce(p_task->'watchers', '[]'::jsonb)) w;
  exception when invalid_text_representation then
    raise exception 'Неверный наблюдатель' using errcode = '22023';
  end;
  if cardinality(v_watchers) > 20 then
    raise exception 'Наблюдателей больше 20' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_watchers) w where not public.erp_profile_is_staff(w)) then
    raise exception 'Наблюдатель — не активный сотрудник ERP' using errcode = '22023';
  end if;
  -- Менеджер заказа — наблюдатель (Р3), если он сотрудник ERP; постановщик
  -- и ответственный наблюдателями не бывают: одна запись на человека
  if v_manager is not null and public.erp_profile_is_staff(v_manager) then
    v_watchers := v_watchers || v_manager;
  end if;
  select coalesce(array_agg(distinct w), '{}'::uuid[]) into v_watchers
    from unnest(v_watchers) w
   where w is distinct from v_me and w is distinct from v_assignee;

  -- Чек-лист (Р8: ≤ 100): строки или объекты `{text}`
  if p_task ? 'checklist' and jsonb_typeof(p_task->'checklist') <> 'array' then
    raise exception 'Чек-лист — списком' using errcode = '22023';
  end if;
  select coalesce(array_agg(btrim(case when jsonb_typeof(c) = 'string' then c #>> '{}' else c->>'text' end)
                            order by n), '{}'::text[])
    into v_items
    from jsonb_array_elements(coalesce(p_task->'checklist', '[]'::jsonb)) with ordinality as x(c, n);
  if cardinality(v_items) > 100 then
    raise exception 'Пунктов чек-листа больше 100' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_items) i where i is null or char_length(i) not between 1 and 500) then
    raise exception 'Пункт чек-листа — от 1 до 500 символов' using errcode = '22023';
  end if;

  -- Р8: не больше 30 задач в час на постановщика
  if (select count(*) from public.erp_biz_tasks t
       where t.creator_id = v_me and t.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Не больше 30 задач в час' using errcode = '22023';
  end if;

  insert into public.erp_biz_tasks
    (order_id, title, kind, description, assignee_id, creator_id, due_at, review_required, client_key)
  values
    (v_order, v_title, v_kind, v_descr, v_assignee, v_me, v_due, v_review, p_client_key)
  on conflict (client_key) do nothing
  returning id into v_id;

  -- Гонка двух одинаковых попыток: вторая получает строку первой
  if v_id is null then
    select t.* into v_row from public.erp_biz_tasks t where t.client_key = p_client_key;
    if v_row.creator_id is distinct from v_me then
      raise exception 'Ключ попытки уже использован' using errcode = '22023';
    end if;
    return v_row;
  end if;

  insert into public.erp_biz_task_watchers (task_id, user_id, added_by)
  select v_id, w, v_me from unnest(v_watchers) w;

  insert into public.erp_biz_task_checklist (task_id, text, sort)
  select v_id, i, n::int from unnest(v_items) with ordinality as x(i, n);

  v_event := public.erp_biz_task_log(v_id, 'created', '{}'::jsonb);
  perform public.erp_biz_task_notify(v_id, v_event, 'task_assigned', array[v_assignee],
                                     'Вам поручена задача {task} · {order}', null);

  select t.* into v_row from public.erp_biz_tasks t where t.id = v_id;
  return v_row;
end $$;

revoke execute on function public.erp_biz_task_create(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.erp_biz_task_create(jsonb, uuid) to authenticated;

-- ── Переход статуса ───────────────────────────────────────────────────────
--
-- Таблица переходов — дословно `BIZ_TASK_TRANSITIONS` клиента (сторож
-- `bizTasksRpc.test.ts`; матрица пробы строится из неё же генератором).
-- `who`: `assignee` — ответственный; `creator` — постановщик или manage.
-- Порядок отказов: версия (P0001) → действие (22023) → роль (42501) →
-- статус (22023) → проверка постановщиком (22023) → текст (22023).
create or replace function public.erp_biz_task_transition(
  p_id uuid, p_action text, p_text text, p_expected_updated_at timestamptz)
returns public.erp_biz_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.erp_biz_task_gate();
  v_row public.erp_biz_tasks;
  v_from text[];
  v_to text;
  v_who text;
  v_txt text;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_manager uuid;
  v_event bigint;
  v_kind text;
  v_old text;
begin
  select t.* into v_row from public.erp_biz_tasks t where t.id = p_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Задача изменена — обновите карточку' using errcode = 'P0001';
  end if;

  select t.from_s, t.to_s, t.who, t.txt
    into v_from, v_to, v_who, v_txt
    from (values
      ('start',    '{new}'::text[],                         'in_progress', 'assignee', null::text),
      ('pause',    '{in_progress}'::text[],                 'paused',      'assignee', 'reason'),
      ('resume',   '{paused}'::text[],                      'in_progress', 'assignee', null::text),
      ('submit',   '{in_progress}'::text[],                 'review',      'assignee', 'result'),
      ('complete', '{in_progress}'::text[],                 'done',        'assignee', 'result'),
      ('accept',   '{review}'::text[],                      'done',        'creator',  null::text),
      ('return',   '{review,done}'::text[],                 'in_progress', 'creator',  'fix'),
      ('cancel',   '{new,in_progress,paused,review}'::text[], 'cancelled', 'creator',  'reason'),
      ('reopen',   '{cancelled}'::text[],                   'in_progress', 'creator',  'fix')
    ) as t(action, from_s, to_s, who, txt)
   where t.action = p_action;
  if not found then
    raise exception 'Задача: неизвестное действие %', p_action using errcode = '22023';
  end if;

  if v_who = 'assignee' then
    if v_me is distinct from v_row.assignee_id then
      raise exception 'Это действие — для ответственного' using errcode = '42501';
    end if;
  elsif not (v_me = v_row.creator_id or public.erp_biz_task_can_manage()) then
    raise exception 'Это действие — для постановщика или руководителя' using errcode = '42501';
  end if;

  if not (v_row.status = any (v_from)) then
    raise exception 'Из статуса «%» это действие недоступно', v_row.status using errcode = '22023';
  end if;
  if p_action = 'submit' and not v_row.review_required then
    raise exception 'Проверка постановщиком выключена — завершите задачу' using errcode = '22023';
  end if;
  if p_action = 'complete' and v_row.review_required then
    raise exception 'Задача с проверкой — сдайте результат на проверку' using errcode = '22023';
  end if;
  if v_txt is not null and v_text is null then
    raise exception 'Нужен текст: %', case v_txt when 'reason' then 'причина'
                                             when 'result' then 'результат'
                                             else 'что исправить' end using errcode = '22023';
  end if;
  if char_length(v_text) > (case when v_txt = 'result' then 10000 else 2000 end) then
    raise exception 'Текст слишком длинный' using errcode = '22023';
  end if;

  v_old := v_row.status;
  update public.erp_biz_tasks t set
    status        = v_to,
    pause_reason  = case when p_action = 'pause' then v_text
                         when p_action = 'resume' then null else t.pause_reason end,
    result_text   = case when p_action in ('submit', 'complete') then v_text else t.result_text end,
    -- Отмеченное сообщение-результат остаётся, пока текст результата тот же
    result_message_id = case when p_action in ('submit', 'complete') and v_text is distinct from t.result_text
                             then null else t.result_message_id end,
    -- Время сдачи — по нему судят, успел ли исполнитель; возврат его стирает,
    -- и задача с истёкшим сроком снова «Просрочена»
    submitted_at  = case when p_action = 'submit' then now()
                         when p_action = 'return' then null else t.submitted_at end,
    reviewed_at   = case when p_action = 'accept' then now()
                         when p_action = 'return' and t.status = 'review' then now()
                         else t.reviewed_at end,
    completed_at  = case when v_to = 'done' then now()
                         when p_action = 'return' then null else t.completed_at end,
    return_reason = case when p_action = 'return' then v_text else t.return_reason end,
    cancel_reason = case when p_action = 'cancel' then v_text
                         when p_action = 'reopen' then null else t.cancel_reason end,
    cancelled_at  = case when p_action = 'cancel' then now()
                         when p_action = 'reopen' then null else t.cancelled_at end,
    updated_at    = now()
  where t.id = p_id
  returning t.* into v_row;

  v_kind := case p_action
    when 'start' then 'started' when 'pause' then 'paused' when 'resume' then 'resumed'
    when 'submit' then 'submitted' when 'complete' then 'completed' when 'accept' then 'accepted'
    when 'return' then 'returned' when 'cancel' then 'cancelled' else 'reopened' end;
  v_event := public.erp_biz_task_log(p_id, v_kind,
    jsonb_strip_nulls(jsonb_build_object('from', v_old, 'to', v_to, 'text', v_text)));

  select o.manager_id into v_manager from public.erp_orders o where o.id = v_row.order_id;

  -- Сдача на проверку: постановщику — «ждёт проверки» (точнее «статуса»);
  -- его же в «статусе» гасит уникальный ключ события
  if p_action = 'submit' then
    perform public.erp_biz_task_notify(p_id, v_event, 'task_review', array[v_row.creator_id],
                                       'Задача {task} ждёт проверки', v_text);
  end if;
  if p_action in ('start', 'pause', 'submit', 'complete', 'cancel') then
    perform public.erp_biz_task_notify(p_id, v_event, 'task_status', array[v_row.creator_id, v_manager],
      case p_action when 'start' then 'Задача {task} взята в работу'
                    when 'pause' then 'Задача {task} приостановлена'
                    when 'submit' then 'Результат задачи {task} сдан на проверку'
                    when 'complete' then 'Задача {task} завершена'
                    else 'Задача {task} отменена' end,
      v_text);
  end if;
  if p_action = 'return' then
    perform public.erp_biz_task_notify(p_id, v_event, 'task_returned', array[v_row.assignee_id],
                                       'Задача {task} возвращена в работу', v_text);
  end if;

  return v_row;
end $$;

revoke execute on function public.erp_biz_task_transition(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.erp_biz_task_transition(uuid, text, text, timestamptz) to authenticated;

-- ── Правка ────────────────────────────────────────────────────────────────
--
-- Постановщик или manage. У завершённой и отменённой — только наблюдатели.
-- Смена ответственного: `task_assigned` новому, `task_unassigned` прежнему,
-- `task_status` постановщику. Перенос срока — только с причиной; история
-- хранит прежнее и новое значение.
create or replace function public.erp_biz_task_update(
  p_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
returns public.erp_biz_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.erp_biz_task_gate();
  v_allowed constant text[] := array['title', 'description', 'kind', 'assignee_id', 'due_at', 'due_reason', 'watchers'];
  v_extra text[];
  v_row public.erp_biz_tasks;
  v_title text;
  v_descr text;
  v_kind text;
  v_assignee uuid;
  v_due timestamptz;
  v_reason text;
  v_watchers uuid[];
  v_old_watchers uuid[];
  v_edited text[] := '{}';
  v_event bigint;
  v_changed boolean := false;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Правка передана не объектом' using errcode = '22023';
  end if;

  select t.* into v_row from public.erp_biz_tasks t where t.id = p_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Задача изменена — обновите карточку' using errcode = 'P0001';
  end if;
  if not (v_me = v_row.creator_id or public.erp_biz_task_can_manage()) then
    raise exception 'Менять задачу может постановщик или руководитель' using errcode = '42501';
  end if;

  select array_agg(k order by k) into v_extra
    from jsonb_object_keys(p_patch) k
   where not (k = any (v_allowed));
  if v_extra is not null then
    raise exception 'Правка: недопустимые поля %', array_to_string(v_extra, ', ') using errcode = '22023';
  end if;
  if v_row.status in ('done', 'cancelled')
     and exists (select 1 from jsonb_object_keys(p_patch) k where k <> 'watchers') then
    raise exception 'У завершённой или отменённой задачи меняются только наблюдатели' using errcode = '22023';
  end if;

  v_title := v_row.title;
  if p_patch ? 'title' then
    v_title := btrim(coalesce(p_patch->>'title', ''));
    if char_length(v_title) not between 1 and 200 then
      raise exception 'Название — от 1 до 200 символов' using errcode = '22023';
    end if;
    if v_title is distinct from v_row.title then v_edited := v_edited || 'title'::text; end if;
  end if;

  v_descr := v_row.description;
  if p_patch ? 'description' then
    v_descr := nullif(btrim(coalesce(p_patch->>'description', '')), '');
    if char_length(v_descr) > 10000 then
      raise exception 'Описание длиннее 10000 символов' using errcode = '22023';
    end if;
    if v_descr is distinct from v_row.description then v_edited := v_edited || 'description'::text; end if;
  end if;

  v_kind := v_row.kind;
  if p_patch ? 'kind' then
    v_kind := p_patch->>'kind';
    if v_kind is null or v_kind not in ('delivery', 'purchase', 'other') then
      raise exception 'Неверный тип задачи' using errcode = '22023';
    end if;
    if v_kind is distinct from v_row.kind then v_edited := v_edited || 'kind'::text; end if;
  end if;

  begin
    v_assignee := case when p_patch ? 'assignee_id' then nullif(p_patch->>'assignee_id', '')::uuid
                       else v_row.assignee_id end;
    v_due := case when p_patch ? 'due_at' then nullif(p_patch->>'due_at', '')::timestamptz
                  else v_row.due_at end;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Неверный ответственный или срок' using errcode = '22023';
  end;
  if v_assignee is distinct from v_row.assignee_id
     and (v_assignee is null or not public.erp_profile_is_staff(v_assignee)) then
    raise exception 'Ответственный — не активный сотрудник ERP' using errcode = '22023';
  end if;
  if v_due is null then
    raise exception 'Не указан срок' using errcode = '22023';
  end if;
  v_reason := nullif(btrim(coalesce(p_patch->>'due_reason', '')), '');
  if v_due is distinct from v_row.due_at and v_reason is null then
    raise exception 'Перенос срока — с причиной' using errcode = '22023';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'Причина длиннее 2000 символов' using errcode = '22023';
  end if;

  if array_length(v_edited, 1) > 0 then
    update public.erp_biz_tasks t
       set title = v_title, description = v_descr, kind = v_kind
     where t.id = p_id;
    v_event := public.erp_biz_task_log(p_id, 'edited', jsonb_build_object('fields', to_jsonb(v_edited)));
    v_changed := true;
  end if;

  if v_due is distinct from v_row.due_at then
    update public.erp_biz_tasks t set due_at = v_due where t.id = p_id;
    v_event := public.erp_biz_task_log(p_id, 'due_changed',
      jsonb_build_object('from', v_row.due_at, 'to', v_due, 'reason', v_reason));
    v_changed := true;
  end if;

  if v_assignee is distinct from v_row.assignee_id then
    update public.erp_biz_tasks t set assignee_id = v_assignee where t.id = p_id;
    -- Ответственный наблюдателем не бывает: одна запись на человека
    delete from public.erp_biz_task_watchers w where w.task_id = p_id and w.user_id = v_assignee;
    v_event := public.erp_biz_task_log(p_id, 'assignee_changed',
      jsonb_build_object('from', v_row.assignee_id, 'to', v_assignee));
    perform public.erp_biz_task_notify(p_id, v_event, 'task_assigned', array[v_assignee],
                                       'Вам поручена задача {task} · {order}', null);
    perform public.erp_biz_task_notify(p_id, v_event, 'task_unassigned', array[v_row.assignee_id],
                                       'Задача {task} передана другому сотруднику', null);
    perform public.erp_biz_task_notify(p_id, v_event, 'task_status', array[v_row.creator_id],
                                       'Ответственный по задаче {task} изменён', null);
    v_changed := true;
  end if;

  if p_patch ? 'watchers' then
    if jsonb_typeof(p_patch->'watchers') <> 'array' then
      raise exception 'Наблюдатели — списком' using errcode = '22023';
    end if;
    begin
      select coalesce(array_agg(distinct w::uuid), '{}'::uuid[]) into v_watchers
        from jsonb_array_elements_text(p_patch->'watchers') w;
    exception when invalid_text_representation then
      raise exception 'Неверный наблюдатель' using errcode = '22023';
    end;
    if cardinality(v_watchers) > 20 then
      raise exception 'Наблюдателей больше 20' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct w), '{}'::uuid[]) into v_watchers
      from unnest(v_watchers) w
     where w is distinct from v_row.creator_id and w is distinct from v_assignee;
    select coalesce(array_agg(w.user_id), '{}'::uuid[]) into v_old_watchers
      from public.erp_biz_task_watchers w where w.task_id = p_id;
    -- Новые — только сотрудники ERP; уже стоящих не проверяем: снять
    -- уволенного наблюдателя должно быть можно
    if exists (select 1 from unnest(v_watchers) w
                where not (w = any (v_old_watchers)) and not public.erp_profile_is_staff(w)) then
      raise exception 'Наблюдатель — не активный сотрудник ERP' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_watchers) w where not (w = any (v_old_watchers)))
       or exists (select 1 from unnest(v_old_watchers) w where not (w = any (v_watchers))) then
      delete from public.erp_biz_task_watchers w
       where w.task_id = p_id and not (w.user_id = any (v_watchers));
      insert into public.erp_biz_task_watchers (task_id, user_id, added_by)
      select p_id, w, v_me from unnest(v_watchers) w
      on conflict (task_id, user_id) do nothing;
      v_event := public.erp_biz_task_log(p_id, 'watchers_changed', jsonb_build_object(
        'added', (select coalesce(jsonb_agg(w), '[]'::jsonb) from unnest(v_watchers) w
                   where not (w = any (v_old_watchers))),
        'removed', (select coalesce(jsonb_agg(w), '[]'::jsonb) from unnest(v_old_watchers) w
                     where not (w = any (v_watchers)))));
      v_changed := true;
    end if;
  end if;

  if v_changed then
    update public.erp_biz_tasks t set updated_at = now() where t.id = p_id;
  end if;

  select t.* into v_row from public.erp_biz_tasks t where t.id = p_id;
  return v_row;
end $$;

revoke execute on function public.erp_biz_task_update(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.erp_biz_task_update(uuid, jsonb, timestamptz) to authenticated;

-- ── Результат ─────────────────────────────────────────────────────────────
--
-- Ответственный в «В работе» или «На проверке». Сообщение-результат — из треда
-- ЭТОЙ задачи, своё и не удалённое; его текст копируется в `result_text`,
-- поэтому удаление сообщения результат не стирает.
create or replace function public.erp_biz_task_set_result(p_id uuid, p_text text, p_message_id uuid)
returns public.erp_biz_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.erp_biz_task_gate();
  v_row public.erp_biz_tasks;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_body text;
begin
  select t.* into v_row from public.erp_biz_tasks t where t.id = p_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if v_me is distinct from v_row.assignee_id then
    raise exception 'Результат фиксирует ответственный' using errcode = '42501';
  end if;
  if v_row.status not in ('in_progress', 'review') then
    raise exception 'Результат фиксируется в работе или на проверке' using errcode = '22023';
  end if;

  if p_message_id is not null then
    select m.body into v_body
      from public.erp_chat_messages m
      join public.erp_chat_threads t on t.id = m.thread_id
     where m.id = p_message_id
       and t.task_id = p_id
       and m.author_id = v_me
       and m.deleted_at is null;
    if not found then
      raise exception 'Результатом отмечается своё сообщение из обсуждения этой задачи' using errcode = '22023';
    end if;
    v_text := coalesce(v_text, nullif(btrim(v_body), ''));
  end if;

  if v_text is null then
    raise exception 'Нужен текст результата' using errcode = '22023';
  end if;
  if char_length(v_text) > 10000 then
    raise exception 'Результат длиннее 10000 символов' using errcode = '22023';
  end if;

  perform public.erp_biz_task_log(p_id, 'result_changed', jsonb_build_object(
    'from', v_row.result_text, 'to', v_text, 'message_id', p_message_id));

  update public.erp_biz_tasks t
     set result_text = v_text, result_message_id = p_message_id, updated_at = now()
   where t.id = p_id
  returning t.* into v_row;
  return v_row;
end $$;

revoke execute on function public.erp_biz_task_set_result(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.erp_biz_task_set_result(uuid, text, uuid) to authenticated;

-- ── Чек-лист ──────────────────────────────────────────────────────────────
--
-- add / remove / rename — постановщик или manage; toggle — ещё и ответственный.
-- Пункт обязан принадлежать этой задаче (иначе через свою задачу отмечали бы
-- пункты чужой).
create or replace function public.erp_biz_task_checklist_op(p_id uuid, p_op text, p_item jsonb)
returns public.erp_biz_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.erp_biz_task_gate();
  v_row public.erp_biz_tasks;
  v_item uuid;
  v_text text;
  v_done boolean;
begin
  select t.* into v_row from public.erp_biz_tasks t where t.id = p_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if p_op is null or p_op not in ('add', 'toggle', 'remove', 'rename') then
    raise exception 'Чек-лист: неизвестное действие %', p_op using errcode = '22023';
  end if;
  if p_op = 'toggle' then
    if not (v_me = v_row.assignee_id or v_me = v_row.creator_id or public.erp_biz_task_can_manage()) then
      raise exception 'Отмечать пункты может ответственный, постановщик или руководитель' using errcode = '42501';
    end if;
  elsif not (v_me = v_row.creator_id or public.erp_biz_task_can_manage()) then
    raise exception 'Менять чек-лист может постановщик или руководитель' using errcode = '42501';
  end if;
  if v_row.status in ('done', 'cancelled') then
    raise exception 'Чек-лист закрытой задачи не меняется' using errcode = '22023';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'Пункт передан не объектом' using errcode = '22023';
  end if;

  if p_op <> 'add' then
    begin
      v_item := nullif(p_item->>'id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Неверный пункт' using errcode = '22023';
    end;
    if not exists (select 1 from public.erp_biz_task_checklist c
                    where c.id = v_item and c.task_id = p_id) then
      raise exception 'Пункт не из этой задачи' using errcode = '22023';
    end if;
  end if;

  if p_op in ('add', 'rename') then
    v_text := btrim(coalesce(p_item->>'text', ''));
    if char_length(v_text) not between 1 and 500 then
      raise exception 'Пункт чек-листа — от 1 до 500 символов' using errcode = '22023';
    end if;
  end if;

  if p_op = 'add' then
    if (select count(*) from public.erp_biz_task_checklist c where c.task_id = p_id) >= 100 then
      raise exception 'Пунктов чек-листа больше 100' using errcode = '22023';
    end if;
    insert into public.erp_biz_task_checklist (task_id, text, sort)
    values (p_id, v_text,
            coalesce((select max(c.sort) from public.erp_biz_task_checklist c where c.task_id = p_id), 0) + 1)
    returning id into v_item;
  elsif p_op = 'rename' then
    update public.erp_biz_task_checklist c set text = v_text where c.id = v_item;
  elsif p_op = 'remove' then
    delete from public.erp_biz_task_checklist c where c.id = v_item;
  else
    if p_item ? 'done' and jsonb_typeof(p_item->'done') <> 'boolean' then
      raise exception 'Отметка пункта — да или нет' using errcode = '22023';
    end if;
    update public.erp_biz_task_checklist c
       set done = coalesce((p_item->>'done')::boolean, not c.done),
           done_by = case when coalesce((p_item->>'done')::boolean, not c.done) then v_me end,
           done_at = case when coalesce((p_item->>'done')::boolean, not c.done) then now() end
     where c.id = v_item
    returning c.done into v_done;
  end if;

  perform public.erp_biz_task_log(p_id, 'checklist_changed',
    jsonb_strip_nulls(jsonb_build_object('op', p_op, 'item_id', v_item, 'text', v_text, 'done', v_done)));

  update public.erp_biz_tasks t set updated_at = now() where t.id = p_id returning t.* into v_row;
  return v_row;
end $$;

revoke execute on function public.erp_biz_task_checklist_op(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.erp_biz_task_checklist_op(uuid, text, jsonb) to authenticated;

-- ── Файлы ─────────────────────────────────────────────────────────────────
--
-- Участник или manage. Файл уже в бакете (загрузка при выборе — правило
-- проекта); здесь — строка-носитель. Каждый путь — объект `erp-attachments`,
-- загруженный ВЫЗЫВАЮЩИМ, под `att/<заказ задачи>/biz_task/`: чужой объект
-- или чужая папка — 42501 (иначе к задаче цепляли бы чужие файлы).
create or replace function public.erp_biz_task_attach(p_id uuid, p_files jsonb)
returns public.erp_biz_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.erp_biz_task_gate();
  v_row public.erp_biz_tasks;
  v_prefix text;
  v_name text;
  v_file jsonb;
  v_path text;
begin
  select t.* into v_row from public.erp_biz_tasks t where t.id = p_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if not (public.erp_biz_task_is_participant(p_id, v_me) or public.erp_biz_task_can_manage()) then
    raise exception 'Файлы прикладывают участники задачи' using errcode = '42501';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) not between 1 and 20 then
    raise exception 'Файлы — списком от 1 до 20' using errcode = '22023';
  end if;

  v_prefix := 'att/' || v_row.order_id::text || '/biz_task/';
  for v_file in select * from jsonb_array_elements(p_files) loop
    v_path := btrim(coalesce(v_file->>'file_path', ''));
    if v_path = '' or v_path like '%..%'
       or left(v_path, char_length(v_prefix)) <> v_prefix
       or not exists (select 1 from storage.objects o
                       where o.bucket_id = 'erp-attachments'
                         and o.name = v_path
                         and coalesce(o.owner_id, o.owner::text) = v_me::text) then
      raise exception 'Файл не загружен вами в папку этой задачи' using errcode = '42501';
    end if;
  end loop;

  select p.name into v_name from public.profiles p where p.id = v_me;

  insert into public.erp_order_attachments (order_id, file_path, file_name, kind, biz_task_id, uploaded_by)
  select v_row.order_id,
         btrim(f->>'file_path'),
         nullif(btrim(coalesce(f->>'file_name', '')), ''),
         'biz_task',
         p_id,
         v_name
    from jsonb_array_elements(p_files) f
   where not exists (select 1 from public.erp_order_attachments a
                      where a.biz_task_id = p_id and a.file_path = btrim(f->>'file_path'));

  update public.erp_biz_tasks t set updated_at = now() where t.id = p_id returning t.* into v_row;
  return v_row;
end $$;

revoke execute on function public.erp_biz_task_attach(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.erp_biz_task_attach(uuid, jsonb) to authenticated;

-- ── «Видел» ───────────────────────────────────────────────────────────────
-- Открытие карточки — не «Взять в работу»: статус не трогается
create or replace function public.erp_biz_task_mark_seen(p_id uuid)
returns public.erp_biz_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.erp_biz_task_gate();
  v_row public.erp_biz_tasks;
begin
  select t.* into v_row from public.erp_biz_tasks t where t.id = p_id;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  insert into public.erp_biz_task_seen (task_id, user_id)
  values (p_id, v_me)
  on conflict (task_id, user_id) do nothing;
  return v_row;
end $$;

revoke execute on function public.erp_biz_task_mark_seen(uuid) from public, anon, authenticated;
grant execute on function public.erp_biz_task_mark_seen(uuid) to authenticated;

-- Когда ответственный впервые открыл задачу — участникам и manage
-- (отметки «видел» личные, политика T1 читает только свою строку)
create or replace function public.erp_biz_task_seen_by(p_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.erp_biz_task_gate();
  v_at timestamptz;
begin
  if not exists (select 1 from public.erp_biz_tasks t where t.id = p_id) then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
  if not (public.erp_biz_task_is_participant(p_id, v_me) or public.erp_biz_task_can_manage()) then
    raise exception 'Прочтение видят участники задачи' using errcode = '42501';
  end if;
  select s.first_seen_at into v_at
    from public.erp_biz_task_seen s
    join public.erp_biz_tasks t on t.id = s.task_id and t.assignee_id = s.user_id
   where s.task_id = p_id;
  return v_at;
end $$;

revoke execute on function public.erp_biz_task_seen_by(uuid) from public, anon, authenticated;
grant execute on function public.erp_biz_task_seen_by(uuid) to authenticated;

-- ── Счётчики вкладки заказа ───────────────────────────────────────────────
-- Invoker: читает под RLS вызывающего. «Просрочена» — срок истёк, а задача
-- новая, в работе или приостановлена; сданная на проверку — если сдана после срока
-- (правило клиентского isOverdue); завершённая в «просрочено» не входит
create or replace function public.erp_biz_task_counts(p_order_id uuid)
returns table(open int, overdue int, done int)
language sql
stable
set search_path = public
as $$
  select count(*) filter (where t.status in ('new', 'in_progress', 'paused', 'review'))::int,
         count(*) filter (where (t.status in ('new', 'in_progress', 'paused') and t.due_at < now())
                             or (t.status = 'review' and t.submitted_at > t.due_at))::int,
         count(*) filter (where t.status = 'done')::int
    from public.erp_biz_tasks t
   where t.order_id = p_order_id;
$$;

revoke execute on function public.erp_biz_task_counts(uuid) from public, anon, authenticated;
grant execute on function public.erp_biz_task_counts(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- T3. ДИАЛОГ ЗАДАЧИ И НАПОМИНАНИЯ ПО СРОКУ
-- ══════════════════════════════════════════════════════════════════════════
--
-- Диалог задачи — тред существующего чата с якорем `task_id` и ПУСТЫМ
-- `order_id` (T1, `erp_chat_thread_anchor`): тред задачи не попадает ни в один
-- поиск треда сделки (`t.order_id = p_order_id`), счётчики сделки не смешиваются.
--
--   · Читать — любой `erp_is_member()` (решение Р1, как чат сделки): лента
--     `erp_chat_page` — invoker под политикой сообщений.
--   · Писать — участник задачи (постановщик, ответственный, наблюдатель) или
--     `erp_biz_task_can_manage()`; посторонний — 42501.
--   · Позвать (@) — только участника; прочие отбрасываются и не попадают
--     в ответ (`mentioned` — кого позвали на самом деле).
--   · Уведомления — только `task_mention` (Р4): ни `chat_message`, ни
--     `chat_reply`; новое сообщение даёт участникам лишь счётчик
--     непрочитанного (`erp_chat_unread_tasks`).
--   · Файлы — только свои объекты `erp-attachments` под `att/<заказ>/chat/`.
--
-- ПЕРЕСОЗДАНИЕ С НОВЫМ ПАРАМЕТРОМ. `create or replace` с лишним аргументом
-- завёл бы ВТОРУЮ перегрузку, и PostgREST ответил бы старому клиенту
-- неоднозначным вызовом (PGRST203). Поэтому старая подпись снимается `drop`
-- в той же транзакции; новый параметр — последним и со значением по умолчанию,
-- так что прежний вызов с 9 именованными аргументами работает без правок.
-- Тела — подлинные с прода (`pg_get_functiondef`, сверено 19.10: совпадают
-- с последними миграциями), изменена только ветка задачи.

-- ── Отправка ──────────────────────────────────────────────────────────────
drop function if exists public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb);

create or replace function public.erp_chat_send(
  p_order_id uuid,
  p_body text,
  p_client_key uuid,
  p_item_id uuid default null::uuid,
  p_stage_id uuid default null::uuid,
  p_experimental_id uuid default null::uuid,
  p_reply_to uuid default null::uuid,
  p_mentions uuid[] default '{}'::uuid[],
  p_attachments jsonb default '[]'::jsonb,
  p_task_id uuid default null::uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me       uuid := (select auth.uid());
  v_body     text := btrim(coalesce(p_body, ''));
  v_files    int  := coalesce(jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)), 0);
  v_order    uuid;
  v_task     text;
  v_thread   uuid;
  v_id       uuid;
  v_rows     int;
  v_mentions uuid[];
  v_replyto  uuid;
  v_label    text;
  v_link     text;
  v_snippet  text;
  v_prefix   text;
  v_file     jsonb;
  v_path     text;
begin
  if v_me is null or not public.erp_is_member() then
    raise exception 'erp_chat_send: писать в обсуждение может только участник'
      using errcode = '42501';
  end if;

  -- Ключ попытки обязателен: без него повтор отправки после оборванного
  -- ответа создаёт второе сообщение и второе уведомление
  if p_client_key is null then
    raise exception 'erp_chat_send: не передан ключ попытки отправки'
      using errcode = '22023';
  end if;

  -- Тред задачи — без сделки: заказ берётся из задачи, а не из запроса
  if p_task_id is not null and (p_order_id is not null or p_experimental_id is not null) then
    raise exception 'erp_chat_send: сообщение задачи не адресуется сделке или разработке'
      using errcode = '22023';
  end if;

  if p_task_id is null then
    v_order := p_order_id;
    select coalesce(nullif(btrim(o.bitrix_id), ''), o.title) into v_label
      from public.erp_orders o where o.id = p_order_id;
    if not found then
      raise exception 'erp_chat_send: сделка не найдена' using errcode = 'P0002';
    end if;
  else
    select t.order_id, t.title, coalesce(nullif(btrim(o.bitrix_id), ''), o.title)
      into v_order, v_task, v_label
      from public.erp_biz_tasks t
      join public.erp_orders o on o.id = t.order_id
     where t.id = p_task_id;
    if not found then
      raise exception 'erp_chat_send: задача не найдена' using errcode = 'P0002';
    end if;
    -- Писать — только действующий сотрудник ERP (как прочие писатели задач):
    -- у бывшего участника без карточки сотрудника тред закрыт
    perform public.erp_biz_task_gate();
    -- Читать диалог может любой участник раздела (Р1), писать — участник
    -- задачи или руководитель с `biz_task.manage`
    if not (public.erp_biz_task_is_participant(p_task_id, v_me)
            or public.erp_biz_task_can_manage()) then
      raise exception 'erp_chat_send: писать могут участники задачи'
        using errcode = '42501';
    end if;
  end if;

  -- Пустое сообщение без файла — не сообщение. Файл без текста — сообщение
  if v_body = '' and v_files = 0 then
    raise exception 'erp_chat_send: сообщение пустое' using errcode = '22023';
  end if;
  if char_length(v_body) > 10000 then
    raise exception 'erp_chat_send: сообщение длиннее 10000 символов' using errcode = '22023';
  end if;

  -- КОНТЕКСТ ОБЯЗАН ПРИНАДЛЕЖАТЬ ЭТОЙ СДЕЛКЕ (у задачи — её заказу)
  if p_item_id is not null and not exists (
       select 1 from public.erp_order_items i
        where i.id = p_item_id and i.order_id = v_order) then
    raise exception 'erp_chat_send: позиция не из этой сделки' using errcode = '22023';
  end if;
  if p_stage_id is not null and not exists (
       select 1 from public.erp_item_stages s
         join public.erp_order_items i on i.id = s.item_id
        where s.id = p_stage_id and i.order_id = v_order) then
    raise exception 'erp_chat_send: этап не из этой сделки' using errcode = '22023';
  end if;
  if p_experimental_id is not null and not exists (
       select 1 from public.erp_experimental e
        where e.id = p_experimental_id and e.order_id = v_order) then
    raise exception 'erp_chat_send: разработка не из этой сделки' using errcode = '22023';
  end if;

  -- Файл треда задачи — только свой объект под папкой чата заказа задачи:
  -- иначе к задаче цепляли бы чужие файлы заказа (Р1: документы заказа
  -- задачей не открываются)
  if p_task_id is not null then
    v_prefix := 'att/' || v_order::text || '/chat/';
    for v_file in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
      v_path := btrim(coalesce(v_file->>'file_path', ''));
      continue when v_path = '';
      if v_path like '%..%'
         or left(v_path, char_length(v_prefix)) <> v_prefix
         or not exists (select 1 from storage.objects o
                         where o.bucket_id = 'erp-attachments'
                           and o.name = v_path
                           and coalesce(o.owner_id, o.owner::text) = v_me::text) then
        raise exception 'erp_chat_send: файл не загружен вами в папку чата этого заказа'
          using errcode = '42501';
      end if;
    end loop;
  end if;

  -- Тред заводится первым сообщением; `on conflict` — двое, открывшие чат
  -- одновременно, иначе завели бы два обсуждения
  if p_task_id is null then
    select t.id into v_thread from public.erp_chat_threads t where t.order_id = p_order_id;
    if v_thread is null then
      insert into public.erp_chat_threads (order_id) values (p_order_id)
        on conflict (order_id) where order_id is not null do nothing
        returning id into v_thread;
      if v_thread is null then
        select t.id into v_thread from public.erp_chat_threads t where t.order_id = p_order_id;
      end if;
    end if;
  else
    select t.id into v_thread from public.erp_chat_threads t where t.task_id = p_task_id;
    if v_thread is null then
      insert into public.erp_chat_threads (task_id) values (p_task_id)
        on conflict (task_id) where task_id is not null do nothing
        returning id into v_thread;
      if v_thread is null then
        select t.id into v_thread from public.erp_chat_threads t where t.task_id = p_task_id;
      end if;
    end if;
  end if;

  -- Цитировать можно только сообщение ЭТОГО обсуждения
  if p_reply_to is not null then
    select m.author_id into v_replyto
      from public.erp_chat_messages m
     where m.id = p_reply_to and m.thread_id = v_thread;
    if not found then
      raise exception 'erp_chat_send: ответ на сообщение из другого обсуждения'
        using errcode = '22023';
    end if;
  end if;

  -- УПОМИНАНИЯ ФИЛЬТРУЕТ СЕРВЕР; в треде задачи — только участники задачи.
  -- Отфильтрованные не попадают в `mentioned` ответа: интерфейс скажет,
  -- что человек не позван
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
    into v_mentions
    from public.profiles p
   where p.id = any (coalesce(p_mentions, '{}'::uuid[]))
     and p.active is true and p.approved is true
     and p.id <> v_me
     and (p_task_id is null or public.erp_biz_task_is_participant(p_task_id, p.id));

  insert into public.erp_chat_messages
    (thread_id, author_id, body, item_id, stage_id, experimental_id, reply_to, client_key)
  values
    (v_thread, v_me, v_body, p_item_id, p_stage_id, p_experimental_id, p_reply_to, p_client_key)
  on conflict (author_id, client_key) do nothing
  returning id into v_id;
  get diagnostics v_rows = row_count;

  -- Повтор той же попытки: ни второго сообщения, ни второго уведомления
  if v_rows = 0 then
    select m.id into v_id from public.erp_chat_messages m
     where m.author_id = v_me and m.client_key = p_client_key;
    return jsonb_build_object(
      'message_id', v_id, 'thread_id', v_thread, 'duplicate', true,
      'mentioned', coalesce((select jsonb_agg(x.user_id) from public.erp_chat_mentions x
                              where x.message_id = v_id), '[]'::jsonb));
  end if;

  insert into public.erp_chat_mentions (message_id, user_id)
  select v_id, u from unnest(v_mentions) u;

  -- АВТОПОДПИСКА «Все сообщения» — только у сделки: сообщения задачи
  -- уведомлений не дают (Р4), подписка там ничего бы не значила
  if p_task_id is null then
    insert into public.erp_chat_subscriptions (thread_id, user_id, mode)
    values (v_thread, v_me, 'all')
    on conflict (thread_id, user_id) do nothing;
  end if;

  -- Носитель файла заводится вместе с сообщением (иначе файл «ничей»);
  -- у треда задачи носитель знает и задачу — для вкладки «Файлы» карточки
  insert into public.erp_order_attachments
    (order_id, file_path, file_name, kind, item_id, stage_id, message_id, biz_task_id)
  select v_order,
         btrim(a->>'file_path'),
         nullif(btrim(coalesce(a->>'file_name', '')), ''),
         'chat',
         p_item_id,
         p_stage_id,
         v_id,
         p_task_id
    from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) a
   where nullif(btrim(coalesce(a->>'file_path', '')), '') is not null;

  v_link    := '/orders/' || coalesce(p_order_id::text, '') || '?tab=chat&msg=' || v_id::text;
  v_snippet := left(coalesce(nullif(v_body, ''), 'Файл в обсуждении'), 200);

  -- Сделка: упомянутые ∪ автор цитируемого ∪ подписчики «Все сообщения»,
  -- минус автор (рассылка 01.10 без изменений)
  if p_task_id is null then
    insert into public.erp_notifications (user_id, kind, order_id, title, body, link, message_id)
    select u, 'chat_mention', p_order_id,
           'Вас упомянули — сделка ' || v_label, v_snippet, v_link, v_id
      from unnest(v_mentions) u
     where u is distinct from v_me
    union all
    select v_replyto, 'chat_reply', p_order_id,
           'Ответ на ваше сообщение — сделка ' || v_label, v_snippet, v_link, v_id
     where v_replyto is not null
       and v_replyto is distinct from v_me
       and not (v_replyto = any (v_mentions))
    union all
    select s.user_id, 'chat_message', p_order_id,
           'Новое сообщение — сделка ' || v_label, v_snippet, v_link, v_id
      from public.erp_chat_subscriptions s
     where s.thread_id = v_thread
       and s.mode = 'all'
       and s.user_id is distinct from v_me
       and not (s.user_id = any (v_mentions))
       and s.user_id is distinct from v_replyto
    on conflict (user_id, message_id) where message_id is not null do nothing;
  else
    -- Задача: только адресное @упоминание (Р4) — ответ на ваше сообщение
    -- и новое сообщение дают лишь счётчик непрочитанного
    insert into public.erp_notifications (user_id, kind, order_id, title, body, link, message_id, task_id)
    select u, 'task_mention', v_order,
           left('Вас упомянули в задаче «' || v_task || '» — заказ ' || coalesce(v_label, ''), 300),
           v_snippet,
           '/biz-tasks/' || p_task_id::text || '?msg=' || v_id::text,
           v_id, p_task_id
      from unnest(v_mentions) u
     where u is distinct from v_me
    on conflict (user_id, message_id) where message_id is not null do nothing;
  end if;

  return jsonb_build_object(
    'message_id', v_id,
    'thread_id',  v_thread,
    'duplicate',  false,
    'mentioned',  to_jsonb(v_mentions));
end $function$;

revoke execute on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb, uuid) from public, anon, authenticated;
grant execute on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb, uuid) to authenticated;

-- ── Лента ─────────────────────────────────────────────────────────────────
-- Тело подлинное (20260920184144, сверено с продом). Изменены только треды:
-- без `p_task_id` — тред сделки и её разработок (как было), с ним — ровно
-- тред задачи. Тред задачи без `order_id`, поэтому в ленту сделки не попадает
drop function if exists public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer);

create or replace function public.erp_chat_page(
  p_order_id uuid,
  p_stage_id uuid default null::uuid,
  p_item_id uuid default null::uuid,
  p_experimental_id uuid default null::uuid,
  p_before_at timestamp with time zone default null::timestamp with time zone,
  p_before_id uuid default null::uuid,
  p_limit integer default 50,
  p_task_id uuid default null::uuid
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
  with lim as (
    select least(greatest(coalesce(p_limit, 50), 1), 200) as n
  ),
  th as (
    select t.id from public.erp_chat_threads t
     where p_task_id is null and t.order_id = p_order_id
    union
    select t.id from public.erp_chat_threads t
      join public.erp_experimental e on e.id = t.experimental_id
     where p_task_id is null and e.order_id = p_order_id
    union
    select t.id from public.erp_chat_threads t
     where p_task_id is not null and t.task_id = p_task_id
  ),
  picked as (
    select m.*
      from public.erp_chat_messages m
     where m.thread_id in (select id from th)
       and (p_stage_id is null or m.stage_id = p_stage_id)
       and (p_item_id is null or m.item_id = p_item_id)
       and (p_experimental_id is null or m.experimental_id = p_experimental_id)
       -- Курсор по паре (момент, id): `created_at` не уникален
       and (p_before_at is null
            or (m.created_at, m.id)
                 < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
     order by m.created_at desc, m.id desc
     limit (select n + 1 from lim)
  ),
  page as (
    select * from picked order by created_at desc, id desc limit (select n from lim)
  )
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',              p.id,
        'thread_id',       p.thread_id,
        'author_id',       p.author_id,
        'body',            p.body,
        'item_id',         p.item_id,
        'stage_id',        p.stage_id,
        'experimental_id', p.experimental_id,
        'reply_to',        p.reply_to,
        'created_at',      p.created_at,
        'edited_at',       p.edited_at,
        'deleted_at',      p.deleted_at,
        'mentions', coalesce((
          select jsonb_agg(x.user_id) from public.erp_chat_mentions x
           where x.message_id = p.id), '[]'::jsonb),
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name)
                 order by a.created_at)
            from public.erp_order_attachments a
           where a.message_id = p.id), '[]'::jsonb),
        -- Цитата короткая и снимается здесь: исходное может быть выше страницы
        'reply', (
          select jsonb_build_object('id', r.id, 'author_id', r.author_id,
                                    'body', left(r.body, 140),
                                    'deleted', r.deleted_at is not null)
            from public.erp_chat_messages r where r.id = p.reply_to),
        'read_count', (select count(*) from public.erp_chat_message_reads rr
                        where rr.message_id = p.id),
        'reactions', coalesce((
          select jsonb_agg(jsonb_build_object('emoji', g.emoji, 'count', g.n, 'mine', g.mine)
                 order by g.n desc, g.emoji)
            from (
              select rx.emoji,
                     count(*) as n,
                     bool_or(rx.user_id = (select auth.uid())) as mine
                from public.erp_chat_reactions rx
               where rx.message_id = p.id
               group by rx.emoji) g), '[]'::jsonb)
      ) order by p.created_at, p.id)
      from page p), '[]'::jsonb),
    'has_more', (select count(*) from picked) > (select n from lim)
  );
$fn$;

revoke execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer, uuid) to authenticated;

-- ── Непрочитанное по списку задач ─────────────────────────────────────────
-- Своя функция, а не ветка `erp_chat_unread_many`: та отвечает по заказам,
-- и тред задачи (без `order_id`) в её счёт не входит и входить не должен.
-- Непрочитано — как у сделки: не своё, не удалённое, позже отметки треда
-- и без строки просмотра. Открытие списка ничего не отмечает
create or replace function public.erp_chat_unread_tasks(p_task_ids uuid[])
returns table(task_id uuid, unread int)
language sql
stable
security invoker
set search_path = public
as $fn$
  with src as (
    select t.id as thread_id, t.task_id as tid
      from public.erp_chat_threads t
     where t.task_id = any(coalesce(p_task_ids, '{}'::uuid[]))
  ),
  wm as (
    select r.thread_id, r.last_read_at from public.erp_chat_reads r
     where r.user_id = (select auth.uid()) and r.stage_id is null
  )
  select s.tid, count(m.id)::int
    from src s
    join public.erp_chat_messages m on m.thread_id = s.thread_id
    left join wm on wm.thread_id = s.thread_id
   where m.author_id is distinct from (select auth.uid())
     and m.deleted_at is null
     and m.created_at > coalesce(wm.last_read_at, '-infinity'::timestamptz)
     and not exists (
       select 1 from public.erp_chat_message_reads rr
        where rr.message_id = m.id and rr.user_id = (select auth.uid()))
   group by s.tid;
$fn$;

revoke execute on function public.erp_chat_unread_tasks(uuid[]) from public, anon, authenticated;
grant execute on function public.erp_chat_unread_tasks(uuid[]) to authenticated;

-- ── Правка своего сообщения ───────────────────────────────────────────────
-- Тело подлинное (20260920182703, сверено с продом); добавлено одно: в треде
-- задачи упоминания пересобираются только по участникам задачи — правкой
-- нельзя позвать того, кого отправка не пустила бы
create or replace function public.erp_chat_edit(
  p_message_id uuid,
  p_body       text,
  p_mentions   uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me       uuid := (select auth.uid());
  v_body     text := btrim(coalesce(p_body, ''));
  v_row      public.erp_chat_messages%rowtype;
  v_files    int;
  v_mentions uuid[];
  v_task     uuid;
begin
  if v_me is null or not public.erp_is_member() then
    raise exception 'erp_chat_edit: править обсуждение может только участник'
      using errcode = '42501';
  end if;

  select * into v_row from public.erp_chat_messages m where m.id = p_message_id;
  if not found then
    raise exception 'erp_chat_edit: сообщение не найдено' using errcode = 'P0002';
  end if;

  -- Только своё: право «править чужое» не заводится даже директору
  if v_row.author_id <> v_me then
    raise exception 'erp_chat_edit: править можно только своё сообщение'
      using errcode = '42501';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'erp_chat_edit: сообщение удалено' using errcode = '22023';
  end if;

  select count(*) into v_files
    from public.erp_order_attachments a where a.message_id = p_message_id;

  if v_body = '' and v_files = 0 then
    raise exception 'erp_chat_edit: сообщение пустое' using errcode = '22023';
  end if;
  if char_length(v_body) > 10000 then
    raise exception 'erp_chat_edit: сообщение длиннее 10000 символов'
      using errcode = '22023';
  end if;

  -- Текст не изменился — «изменено» не ставим
  if v_body = v_row.body then
    return jsonb_build_object('message_id', p_message_id, 'changed', false);
  end if;

  update public.erp_chat_messages
     set body = v_body, edited_at = now()
   where id = p_message_id;

  select t.task_id into v_task
    from public.erp_chat_threads t
   where t.id = v_row.thread_id;

  -- Упоминания пересобираются по тексту; фильтр тот же, что у отправки
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
    into v_mentions
    from public.profiles p
   where p.id = any (coalesce(p_mentions, '{}'::uuid[]))
     and p.active is true and p.approved is true
     and p.id <> v_me
     and (v_task is null or public.erp_biz_task_is_participant(v_task, p.id));

  delete from public.erp_chat_mentions x
   where x.message_id = p_message_id
     and not (x.user_id = any (v_mentions));

  insert into public.erp_chat_mentions (message_id, user_id)
  select p_message_id, u from unnest(v_mentions) u
  on conflict (message_id, user_id) do nothing;

  -- Уведомлений правка не шлёт и не стирает (правило 20.09)

  return jsonb_build_object(
    'message_id', p_message_id,
    'changed',    true,
    'mentioned',  to_jsonb(v_mentions));
end $fn$;

revoke execute on function public.erp_chat_edit(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.erp_chat_edit(uuid, text, uuid[]) to authenticated;

-- ── Удаление своего сообщения ─────────────────────────────────────────────
-- Тело подлинное (20260920182703, сверено с продом). Сообщение, отмеченное
-- результатом задачи, удаляется как любое: текст затирается, файлы уходят.
-- Результат при этом НЕ исчезает: `erp_biz_tasks.result_text` — копия текста
-- (T2, `erp_biz_task_set_result`), событие `result_changed` в истории
-- остаётся, и рядом ложится ещё одно — «сообщение-результат удалено»
create or replace function public.erp_chat_delete(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me   uuid := (select auth.uid());
  v_row  public.erp_chat_messages%rowtype;
  v_task uuid;
begin
  if v_me is null or not public.erp_is_member() then
    raise exception 'erp_chat_delete: удалять в обсуждении может только участник'
      using errcode = '42501';
  end if;

  select * into v_row from public.erp_chat_messages m where m.id = p_message_id;
  if not found then
    raise exception 'erp_chat_delete: сообщение не найдено' using errcode = 'P0002';
  end if;
  if v_row.author_id <> v_me then
    raise exception 'erp_chat_delete: удалять можно только своё сообщение'
      using errcode = '42501';
  end if;
  if v_row.deleted_at is not null then
    return jsonb_build_object('message_id', p_message_id, 'deleted', true);
  end if;

  update public.erp_chat_messages
     set body = '', deleted_at = now()
   where id = p_message_id;

  -- След в истории задачи: результат остался, его сообщение удалено
  for v_task in
    select t.id from public.erp_biz_tasks t where t.result_message_id = p_message_id
  loop
    perform public.erp_biz_task_log(v_task, 'result_changed',
      jsonb_build_object('message_id', p_message_id, 'message_deleted', true));
  end loop;

  delete from public.erp_chat_mentions x where x.message_id = p_message_id;

  -- Файлы уходят вместе с сообщением; объект в бакете уберёт `storage-gc`
  delete from public.erp_order_attachments a where a.message_id = p_message_id;

  -- Уведомление о сообщении, которого больше нет, ведёт на пустое место
  delete from public.erp_notifications n where n.message_id = p_message_id;

  return jsonb_build_object('message_id', p_message_id, 'deleted', true);
end $fn$;

revoke execute on function public.erp_chat_delete(uuid) from public, anon, authenticated;
grant execute on function public.erp_chat_delete(uuid) to authenticated;

-- ── Напоминания по сроку ──────────────────────────────────────────────────
--
-- Зовёт только планировщик (`pg_cron`, раз в 15 минут — Р5) и service_role.
--   · «До срока меньше 24 часов» — ответственному: задача новая, в работе или
--     приостановлена, срок ещё не наступил и до него ≤ 24 ч, а создана задача
--     раньше этого окна (иначе напоминание пришло бы в момент постановки).
--   · «Просрочена» — один раз ответственному, постановщику и менеджеру заказа:
--     те же статусы (сданная на проверку, завершённая и отменённая — нет),
--     срок истёк.
-- ОДИН РАЗ — ключом базы: событие `(task_id, kind, due_at)` уникально (T1),
-- второй и параллельный прогоны получают `do nothing` и не уведомляют.
-- Возврат просроченной задачи в работу срок не меняет — ключ тот же, повтора
-- нет; перенос срока — новый ключ и новое право на напоминание.
-- Уведомления пишет тот же единственный помощник `erp_biz_task_notify`
-- (адресаты distinct, только сотрудники ERP, одно на событие).
create or replace function public.erp_biz_task_reminders_run()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_event   bigint;
  v_soon    int := 0;
  v_overdue int := 0;
begin
  for r in
    select t.id, t.assignee_id, t.due_at
      from public.erp_biz_tasks t
     where t.status in ('new', 'in_progress', 'paused')
       and t.due_at > now()
       and t.due_at - now() <= interval '24 hours'
       and t.created_at < t.due_at - interval '24 hours'
     order by t.due_at, t.id
  loop
    insert into public.erp_biz_task_events (task_id, kind, actor, payload, due_at)
    values (r.id, 'due_soon', null, jsonb_build_object('due_at', r.due_at), r.due_at)
    on conflict (task_id, kind, due_at) where kind in ('due_soon', 'overdue') do nothing
    returning id into v_event;
    continue when v_event is null;
    perform public.erp_biz_task_notify(r.id, v_event, 'task_due_soon', array[r.assignee_id],
                                       'До срока задачи {task} меньше 24 часов', null);
    v_soon := v_soon + 1;
  end loop;

  for r in
    select t.id, t.assignee_id, t.creator_id, t.due_at, o.manager_id
      from public.erp_biz_tasks t
      join public.erp_orders o on o.id = t.order_id
     where t.status in ('new', 'in_progress', 'paused')
       and t.due_at < now()
     order by t.due_at, t.id
  loop
    insert into public.erp_biz_task_events (task_id, kind, actor, payload, due_at)
    values (r.id, 'overdue', null, jsonb_build_object('due_at', r.due_at), r.due_at)
    on conflict (task_id, kind, due_at) where kind in ('due_soon', 'overdue') do nothing
    returning id into v_event;
    continue when v_event is null;
    perform public.erp_biz_task_notify(r.id, v_event, 'task_overdue', array[r.assignee_id, r.creator_id, r.manager_id],
                                       'Задача {task} просрочена', null);
    v_overdue := v_overdue + 1;
  end loop;

  return jsonb_build_object('due_soon', v_soon, 'overdue', v_overdue, 'at', now());
end $$;

revoke execute on function public.erp_biz_task_reminders_run() from public, anon, authenticated;
grant execute on function public.erp_biz_task_reminders_run() to service_role;

-- Раз в 15 минут (Р5: точность напоминания — до 15 минут). Повторное
-- применение файла не заводит второе расписание: прежнее снимается в `exists`
do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'erp-biz-task-reminders') then
    perform cron.unschedule('erp-biz-task-reminders');
  end if;
  perform cron.schedule('erp-biz-task-reminders', '*/15 * * * *',
                        'select public.erp_biz_task_reminders_run()');
end $cron$;

notify pgrst, 'reload schema';
