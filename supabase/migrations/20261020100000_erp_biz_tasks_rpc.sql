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
-- ДИАЛОГ ЗАДАЧИ И НАПОМИНАНИЯ — та же миграция, следующий шаг (T3): лимит
-- неприменённых миграций ≤ 5.
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
-- `task_status`): кто уже получил уведомление о событии, второго не получит
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

  insert into public.erp_notifications
    (user_id, kind, order_id, title, body, link, task_id, task_event_id)
  select distinct u, p_kind, v_order,
         left(p_title || ' — ' || v_title, 300),
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
                                     'Новая задача', null);

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
                                       'Задача ждёт проверки', v_text);
  end if;
  if p_action in ('start', 'pause', 'submit', 'complete', 'cancel') then
    perform public.erp_biz_task_notify(p_id, v_event, 'task_status', array[v_row.creator_id, v_manager],
      case p_action when 'start' then 'Задача взята в работу'
                    when 'pause' then 'Задача приостановлена'
                    when 'submit' then 'Результат сдан на проверку'
                    when 'complete' then 'Задача завершена'
                    else 'Задача отменена' end,
      v_text);
  end if;
  if p_action = 'return' then
    perform public.erp_biz_task_notify(p_id, v_event, 'task_returned', array[v_row.assignee_id],
                                       'Задача возвращена в работу', v_text);
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
                                       'Вам поручена задача', null);
    perform public.erp_biz_task_notify(p_id, v_event, 'task_unassigned', array[v_row.assignee_id],
                                       'Задача передана другому сотруднику', null);
    perform public.erp_biz_task_notify(p_id, v_event, 'task_status', array[v_row.creator_id],
                                       'Ответственный по задаче изменён', null);
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
-- новая, в работе или приостановлена (сданная на проверку — нет)
create or replace function public.erp_biz_task_counts(p_order_id uuid)
returns table(open int, overdue int, done int)
language sql
stable
set search_path = public
as $$
  select count(*) filter (where t.status in ('new', 'in_progress', 'paused', 'review'))::int,
         count(*) filter (where t.status in ('new', 'in_progress', 'paused') and t.due_at < now())::int,
         count(*) filter (where t.status = 'done')::int
    from public.erp_biz_tasks t
   where t.order_id = p_order_id;
$$;

revoke execute on function public.erp_biz_task_counts(uuid) from public, anon, authenticated;
grant execute on function public.erp_biz_task_counts(uuid) to authenticated;

notify pgrst, 'reload schema';
