-- Order v4, веха 6+7 единого потока, миграция J (18.10): «Отправить в работу»,
-- оплата МС и запуск в производство.
--
-- План: docs/superpowers/plans/2026-10-18-order-flow-m67-tz-launch.md, задача 1
-- (решения К14–К21, «Проверка безопасности» 1–12).
--
-- Тела функций — подлинный текст миграций B (20261017062110_order_v4_rights)
-- и F (20261017142210_sales_ms_flag); каждая правка — блок
--   -- J:begin <метка> … [-- J:was|<строка B/F дословно>] … -- J:end <метка>
-- Обратная замена блоков даёт тело B/F побайтно (сторож
-- pinhead-react/src/orderstudio/orderV4Launch.test.ts); по меткам генератор
-- supabase/probes/mutations/make-mutations.mjs строит мутации SQL.
--
-- Что меняется:
--   · автор заказа — `sales_is_seller() and created_by = auth.uid()` (признак
--     «Ведёт заказы»), а не роль профиля `manager`: в transition, set_payment
--     и в видимости launch_check (К20);
--   · ответы всех трёх RPC дополнены `updated_at` (transition — ещё `sent_at`,
--     set_payment — `status`, launch_check — `launched`): после перехода
--     и оплаты клиент не ловит ложный «изменён в другой вкладке» (К19);
--   · `order_v4_transition(p_id, p_to, p_reason, p_expected_updated_at,
--     p_erp_order_id)` — прежняя сигнатура снята (новый параметр в
--     `create or replace` не добавить), новые параметры с умолчанием;
--     `draft → ready_to_launch`: первой проверкой — версия заказа, затем
--     PDF ТЗ у каждой позиции и макет у каждого нанесения кроме «прочее» —
--     объектом в бакете `order-artworks` (К18); возврат во время чужого
--     свежего запуска запрещён (К17); `production` — только заказ ERP,
--     id которого вернул createOrder этого запуска, с документами ТЗ из
--     объектов, загруженных тем, кто ставил метку (находка 1);
--   · launch_check: права ERP (`erp_is_member`, `order.manage`, `tz.manage`)
--     до метки (К14), чужая метка 10 минут от последнего продления (К15),
--     разделение обязанностей (К16), подлинность сироты (находка 1);
--   · set_payment: МС отмечает `prepaid`/`full` в `ready_to_launch` —
--     с правом ERP `order.manage` и не на своём заказе (К16);
--   · sales_set_staff: свой признак и признак МС профилю rop — только
--     admin и director (К21);
--   · новый хелпер `order_v4_erp_authentic(uuid, uuid)` — зовут только
--     функции J (execute отозван у всех клиентских ролей).
--
-- ERP не меняется: в теле только чтение `erp_*` и `storage.objects`, вызов
-- `erp_has_permission`/`erp_is_member`; DDL по таблицам и функциям ERP нет.
-- Таблиц, колонок и политик J не заводит.
--
-- ВЫКАТКА: после H (20261017185435) и I (20261018090000), ДО фронта 6+7
-- (ответы только дополнены, параметры с умолчанием), при выключенном флаге
-- `orderStudio` (окно PGRST202 между commit и перезагрузкой кэша схемы).
-- Файлы выкатки (предусловие «H и I + md5 тел B/F», сухие прогоны, мутации,
-- откат) готовит контроллер. Прототип запуска вехи 2 после J зовёт
-- `transition(production)` без `p_erp_order_id` и получает отказ — флаг
-- выключен, МС нет (риск записан в плане).
--
-- Откат: реверт фронта 6+7 → выкладка Vercel (`/version.json`) →
-- `3-rollback-J.sql`: `drop function order_v4_transition(uuid, text, text,
-- timestamptz, uuid)` и `order_v4_erp_authentic(uuid, uuid)`, тела B/F
-- четырёх функций, гранты как в B/F, запись журнала, `notify pgrst`.

-- ── 1. Подлинность заказа ERP ────────────────────────────────────────────
-- Истина, если у заказа ERP есть позиции и у КАЖДОЙ позиции есть документ ТЗ
-- из копии запуска (`tz/v4-…`), объект которой в `erp-attachments` загрузил
-- `p_launch_by` (тот, кто ставил метку запуска). Вставка `erp_tz_documents`
-- требует `tz.manage`, владельца объекта ставит Storage по JWT — payload его
-- не меняет. Заказ ERP без позиций подлинным не считается: иначе прямая
-- вставка пустого `erp_orders` с `tz_order_id` прошла бы проверку «у каждой».
-- `owner` Storage помечает устаревшей — первой читается `owner_id`.

create or replace function public.order_v4_erp_authentic(p_erp uuid, p_launch_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_erp is not null and p_launch_by is not null
     and exists (select 1 from public.erp_order_items i where i.order_id = p_erp)
     and not exists (
       select 1 from public.erp_order_items i
        where i.order_id = p_erp
          and not exists (
            select 1 from public.erp_tz_documents d
              join storage.objects o
                on o.bucket_id = 'erp-attachments' and o.name = d.file_path
             where d.order_id = p_erp and d.item_id = i.id
               and d.file_path like 'tz/v4-%'
               and coalesce(o.owner_id, o.owner::text) = p_launch_by::text));
$$;

revoke execute on function public.order_v4_erp_authentic(uuid, uuid) from public, anon, authenticated;

-- ── 2. Переход статуса ───────────────────────────────────────────────────
-- Новые параметры (`p_expected_updated_at`, `p_erp_order_id`) с умолчанием:
-- старый клиент зовёт тремя именованными аргументами. Добавить параметр
-- в `create or replace` нельзя — прежняя сигнатура снимается.

drop function public.order_v4_transition(uuid, text, text);

create or replace function public.order_v4_transition(
  p_id uuid, p_to text, p_reason text default null,
  p_expected_updated_at timestamptz default null, p_erp_order_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_hidden constant text := 'Заказ не найден или недоступен';
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ms boolean;
  v_lead boolean;
  v_boss boolean;
  v_author boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.orders%rowtype;
  v_from text;
  v_erp uuid;
  -- J:begin decl
  v_launcher text;
  -- J:end decl
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Нужен вход в систему';
  end if;
  if p_to is null or p_to not in ('ready_to_launch', 'draft', 'production', 'done', 'archived') then
    raise exception using errcode = '22023', message = 'Неизвестный статус заказа';
  end if;
  if length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'Причина — не длиннее 500 символов';
  end if;

  select p.role into v_role from public.profiles p
   where p.id = v_uid and p.active is true and p.approved is true;
  v_role := coalesce(v_role, '');                -- нет профиля / отключён — никто
  v_ms := public.sales_is_ms();
  v_lead := v_role in ('admin', 'director', 'rop');
  v_boss := v_role in ('admin', 'director');

  select * into v_row from public.orders where id = p_id and schema_version = 4 for update;
  if not found then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  v_from := v_row.status;
  -- J:begin author
  v_author := coalesce(public.sales_is_seller() and v_row.created_by = v_uid, false);
  -- J:was|  v_author := v_role = 'manager' and v_row.created_by = v_uid;
  -- J:end author
  -- Видимость — правила RLS orders_select, повторённые явно
  if not (coalesce(v_lead, false) or coalesce(v_author, false)
          or (v_ms and v_row.status in ('ready_to_launch', 'production', 'done'))) then
    raise exception using errcode = '42501', message = c_hidden;
  end if;

  -- Повтор запуска после сбоя ответа: уже в производстве — ответ тот же
  if p_to = 'production' and v_row.status = 'production' and (v_ms or coalesce(v_boss, false)) then
    -- J:begin resp_repeat
    return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'erp_order_id', v_row.erp_order_id,
                              'updated_at', v_row.updated_at, 'sent_at', v_row.sent_at);
    -- J:was|    return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'erp_order_id', v_row.erp_order_id);
    -- J:end resp_repeat
  end if;

  if v_row.status = 'draft' and p_to = 'ready_to_launch' then
    -- J:begin expected
    -- Первой проверкой ветки: конфликт вкладки побеждает сообщения валидации
    if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'P0001', message = 'Заказ изменён в другой вкладке — обновите страницу';
    end if;
    -- J:end expected
    if not (coalesce(v_author, false) or coalesce(v_lead, false)) then
      raise exception using errcode = '42501', message = 'Отправить в работу может автор заказа или руководитель';
    end if;
    if coalesce(btrim(v_row.customer), '') = '' then
      raise exception using errcode = 'P0001', message = 'Не указан клиент';
    end if;
    if v_row.due_date is null then
      raise exception using errcode = 'P0001', message = 'Не указан срок';
    end if;
    if not exists (select 1 from public.order_items i where i.order_id = p_id) then
      raise exception using errcode = 'P0001', message = 'В заказе нет позиций';
    end if;
    -- J:begin tz_pdf
    -- PDF ТЗ у каждой позиции: путь этого заказа в папке tz/ и объект в бакете
    -- (есть, тип application/pdf, не больше 8 МБ). Функция security definer —
    -- storage.objects читается без политик клиента
    if exists (select 1 from public.order_items i
                where i.order_id = v_row.id
                  and (coalesce(i.tz_pdf_path, '') not like 'orders/' || v_row.id || '/tz/%'
                       or not public.order_artwork_path_ok(v_row.id, i.tz_pdf_path)
                       or not exists (select 1 from storage.objects o
                                       where o.bucket_id = 'order-artworks' and o.name = i.tz_pdf_path
                                         and o.metadata->>'mimetype' = 'application/pdf'
                                         and (o.metadata->>'size')::bigint <= 8388608))) then
      raise exception using errcode = 'P0001', message = 'Сформируйте ТЗ — PDF позиции не найден в хранилище';
    end if;
    -- J:end tz_pdf
    -- J:begin artwork
    -- Макет у каждого нанесения, кроме «прочее»: объект в бакете с типом из белого
    -- списка бакета order-artworks (миграция C)
    if exists (select 1 from public.order_item_prints p
                 join public.order_items i on i.id = p.item_id
                where i.order_id = v_row.id and p.method <> 'other'
                  and (coalesce(p.artwork_path, '') = ''
                       or not exists (select 1 from storage.objects o
                                       where o.bucket_id = 'order-artworks' and o.name = p.artwork_path
                                         and o.metadata->>'mimetype' = any (array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
                                               'application/pdf', 'application/postscript', 'application/illustrator',
                                               'image/vnd.adobe.photoshop', 'image/tiff'])))) then
      raise exception using errcode = 'P0001', message = 'У нанесения нет макета';
    end if;
    -- J:end artwork
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders set status = 'ready_to_launch', sent_at = now(), updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  elsif v_row.status = 'ready_to_launch' and p_to = 'draft' then
    if not (v_ms or coalesce(v_boss, false)) then
      raise exception using errcode = '42501', message = 'Вернуть заказ может МС или руководитель производства';
    end if;
    if v_reason is null then
      raise exception using errcode = 'P0001', message = 'Укажите причину возврата';
    end if;
    -- J:begin return_race
    -- Чужой свежий запуск (метка моложе 10 минут от последнего продления): возврат
    -- оставил бы заказ ERP смотреть на черновик, который продавец уже правит
    if v_row.launch_started_at > now() - interval '10 minutes'
       and v_row.launch_by is distinct from v_uid then
      select coalesce(nullif(btrim(p.name), ''), p.email) into v_launcher
        from public.profiles p where p.id = v_row.launch_by;
      raise exception using errcode = 'P0001',
        message = 'Заказ сейчас запускает ' || coalesce(v_launcher, 'другой сотрудник')
                  || ' — дождитесь итога или обновите карточку';
    end if;
    -- J:end return_race
    -- Заказ ERP уже создан (сбой между созданием и переходом) — возврат
    -- оставил бы его сиротой с занятой связью
    if exists (select 1 from public.erp_orders e
                where e.tz_order_id = p_id and e.status <> 'cancelled') then
      raise exception using errcode = 'P0001',
        message = 'Заказ уже создан в производстве — сначала завершите запуск';
    end if;
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders set status = 'draft', launch_started_at = null, launch_by = null, updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  elsif v_row.status = 'ready_to_launch' and p_to = 'production' then
    if not (v_ms or coalesce(v_boss, false)) then
      raise exception using errcode = '42501', message = 'Запустить заказ может МС или руководитель производства';
    end if;
    if v_row.launch_started_at is null then
      raise exception using errcode = 'P0001', message = 'Сначала проверка запуска';
    end if;
    if v_row.paid_at is null and v_row.paid_override_reason is null then
      raise exception using errcode = 'P0001', message = 'Нет отметки оплаты';
    end if;
    select e.id into v_erp from public.erp_orders e
     where e.tz_order_id = p_id
       and e.created_at >= v_row.launch_started_at
       and e.tz_number = v_row.order_number
       and e.status <> 'cancelled'
     order by e.created_at desc
     limit 1;
    if v_erp is null then
      raise exception using errcode = 'P0001', message = 'Заказ ERP этого запуска не найден';
    end if;
    -- J:begin erp_link
    -- Связь — только с заказом ERP, id которого вернул createOrder этого запуска
    if p_erp_order_id is null or p_erp_order_id is distinct from v_erp then
      raise exception using errcode = 'P0001', message = 'Заказ ERP с этой связью создан не этим запуском';
    end if;
    -- J:end erp_link
    -- J:begin erp_authentic
    -- Подлинность: документы ТЗ каждой позиции — из объектов, загруженных тем, кто ставил метку
    if not public.order_v4_erp_authentic(v_erp, v_row.launch_by) then
      raise exception using errcode = 'P0001', message = 'Заказ ERP с этой связью создан не этим запуском';
    end if;
    -- J:end erp_authentic
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders
       set status = 'production', erp_order_id = v_erp, launched_at = now(), launched_by = v_uid,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  elsif v_row.status = 'production' and p_to = 'done' then
    if not (v_ms or coalesce(v_boss, false)) then
      raise exception using errcode = '42501', message = 'Завершить заказ может МС или руководитель производства';
    end if;
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders set status = 'done', updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  elsif v_row.status = 'draft' and p_to = 'archived' then
    if not (coalesce(v_author, false) or v_role = 'admin') then
      raise exception using errcode = '42501', message = 'В архив черновик убирает автор или администратор';
    end if;
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders set status = 'archived', archived_at = now(), updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  else
    raise exception using errcode = 'P0001', message = 'Такой переход статуса недоступен';
  end if;

  insert into public.order_events (order_id, kind, from_status, to_status, reason, actor)
  values (p_id, 'status', v_from, p_to, v_reason, v_uid);

  -- J:begin resp
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'erp_order_id', v_row.erp_order_id,
                            'updated_at', v_row.updated_at, 'sent_at', v_row.sent_at);
  -- J:was|  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'erp_order_id', v_row.erp_order_id);
  -- J:end resp
end;
$$;

revoke execute on function public.order_v4_transition(uuid, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.order_v4_transition(uuid, text, text, timestamptz, uuid) to authenticated;

-- ── 3. Проверка запуска ──────────────────────────────────────────────────

create or replace function public.order_v4_launch_check(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_hidden constant text := 'Заказ не найден или недоступен';
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ms boolean;
  v_lead boolean;
  v_boss boolean;
  v_row public.orders%rowtype;
  v_erp_row record;
  -- J:begin decl
  v_launcher text;
  v_override_by uuid;
  -- J:end decl
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Нужен вход в систему';
  end if;
  select p.role into v_role from public.profiles p
   where p.id = v_uid and p.active is true and p.approved is true;
  v_role := coalesce(v_role, '');                -- нет профиля / отключён — никто
  v_ms := public.sales_is_ms();
  v_lead := v_role in ('admin', 'director', 'rop');
  v_boss := v_role in ('admin', 'director');

  select * into v_row from public.orders where id = p_id and schema_version = 4 for update;
  if not found then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  if not (coalesce(v_lead, false)
          -- J:begin author_vis
          or (public.sales_is_seller() and v_row.created_by = v_uid)
          -- J:was|          or (v_role = 'manager' and v_row.created_by = v_uid)
          -- J:end author_vis
          or (v_ms and v_row.status in ('ready_to_launch', 'production', 'done'))) then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  if not (v_ms or coalesce(v_boss, false)) then
    raise exception using errcode = '42501', message = 'Запустить заказ может МС или руководитель производства';
  end if;

  if v_row.erp_order_id is not null then
    -- J:begin resp_already
    return jsonb_build_object('ok', true, 'already', true, 'launched', true, 'erp_order_id', v_row.erp_order_id,
                              'updated_at', v_row.updated_at);
    -- J:was|    return jsonb_build_object('ok', true, 'already', true, 'erp_order_id', v_row.erp_order_id);
    -- J:end resp_already
  end if;
  -- J:begin erp_rights
  -- Права ERP — ДО метки: erp_create_order (security invoker) требует order.manage
  -- и tz.manage, запись в erp-attachments — erp_is_member()
  if not (public.erp_is_member() and public.erp_has_permission('order.manage')
          and public.erp_has_permission('tz.manage')) then
    return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at, 'reason',
      'Нет прав производства на создание заказа и ТЗ — попросите администратора выдать должность в производстве (диспетчер, менеджер, начальник производства)');
  end if;
  -- J:end erp_rights
  -- J:begin duty_own
  -- Разделение обязанностей: свой заказ запускает другой сотрудник
  if v_row.created_by = v_uid and not coalesce(v_boss, false) then
    return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at, 'reason',
      'Свой заказ запускает другой МС или руководитель производства');
  end if;
  -- J:end duty_own
  -- J:begin duty_override
  -- «Запуск без оплаты», разрешённый вызывающим, запускает другой сотрудник
  if v_row.paid_kind is null and v_row.paid_override_reason is not null then
    select e.actor into v_override_by from public.order_events e
     where e.order_id = p_id and e.kind = 'payment' and e.reason is not null
     order by e.at desc, e.id desc
     limit 1;
    if v_override_by = v_uid then
      return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at, 'reason',
        'Запуск без оплаты разрешили вы — запустить должен другой сотрудник');
    end if;
  end if;
  -- J:end duty_override
  if v_row.status is distinct from 'ready_to_launch' then
    -- J:begin resp_status
    return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at,
                              'reason', 'Заказ не ожидает запуска');
    -- J:was|    return jsonb_build_object('ok', false, 'reason', 'Заказ не ожидает запуска');
    -- J:end resp_status
  end if;
  if v_row.paid_at is null and v_row.paid_override_reason is null then
    -- J:begin resp_unpaid
    return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at,
                              'reason', 'Нет отметки оплаты');
    -- J:was|    return jsonb_build_object('ok', false, 'reason', 'Нет отметки оплаты');
    -- J:end resp_unpaid
  end if;
  if not exists (select 1 from public.order_items i where i.order_id = p_id) then
    -- J:begin resp_no_items
    return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at,
                              'reason', 'В заказе нет позиций');
    -- J:was|    return jsonb_build_object('ok', false, 'reason', 'В заказе нет позиций');
    -- J:end resp_no_items
  end if;

  -- Заказ ERP с этой связью уже есть (связь уникальна: erp_orders_tz_order_uniq)
  select e.id, e.status, e.created_at, e.tz_number into v_erp_row
    from public.erp_orders e
   where e.tz_order_id = p_id;
  if found then
    if v_erp_row.status = 'cancelled' then
      -- J:begin resp_cancelled
      return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at, 'reason',
        'Прежний заказ ERP отменён — удалите его в ERP, чтобы запустить заново');
      -- J:was|      return jsonb_build_object('ok', false, 'reason',
      -- J:was|        'Прежний заказ ERP отменён — удалите его в ERP, чтобы запустить заново');
      -- J:end resp_cancelled
    end if;
    if v_row.launch_started_at is not null
       and v_erp_row.created_at >= v_row.launch_started_at
       and v_erp_row.tz_number = v_row.order_number then
      -- Сирота прошлой попытки: заказ ERP этого запуска есть, переход не прошёл
      -- J:begin orphan
      -- Подлинность сироты: документы ТЗ из объектов того, кто ставил метку
      if not public.order_v4_erp_authentic(v_erp_row.id, v_row.launch_by) then
        return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at, 'reason',
          'Заказ ERP с этой связью создан не этим запуском — обратитесь к администратору');
      end if;
      return jsonb_build_object('ok', true, 'already', true, 'launched', false, 'erp_order_id', v_erp_row.id,
                                'launch_started_at', v_row.launch_started_at, 'updated_at', v_row.updated_at);
      -- J:was|      return jsonb_build_object('ok', true, 'already', true, 'erp_order_id', v_erp_row.id,
      -- J:was|                                'launch_started_at', v_row.launch_started_at);
      -- J:end orphan
    end if;
    -- J:begin resp_foreign_erp
    return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at, 'reason',
      'Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства');
    -- J:was|    return jsonb_build_object('ok', false, 'reason',
    -- J:was|      'Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства');
    -- J:end resp_foreign_erp
  end if;

  -- J:begin foreign_label
  -- Чужая свежая метка (моложе 10 минут от последнего продления) — ждать; своя
  -- (шаг recheck) — продлевается ниже
  if v_row.launch_started_at > now() - interval '10 minutes'
     and v_row.launch_by is distinct from v_uid then
    select coalesce(nullif(btrim(p.name), ''), p.email) into v_launcher
      from public.profiles p where p.id = v_row.launch_by;
    return jsonb_build_object('ok', false, 'launched', false, 'updated_at', v_row.updated_at, 'reason',
      'Заказ сейчас запускает ' || coalesce(v_launcher, 'другой сотрудник')
      || ' — подождите или попросите коллегу закрыть экран запуска, затем обновите карточку');
  end if;
  -- J:end foreign_label
  perform set_config('order_v4.rpc', 'on', true);
  update public.orders set launch_started_at = now(), launch_by = v_uid
   where id = p_id returning * into v_row;
  perform set_config('order_v4.rpc', 'off', true);

  -- J:begin resp_label
  return jsonb_build_object('ok', true, 'already', false, 'launched', false,
                            'launch_started_at', v_row.launch_started_at, 'updated_at', v_row.updated_at);
  -- J:was|  return jsonb_build_object('ok', true, 'already', false, 'launch_started_at', v_row.launch_started_at);
  -- J:end resp_label
end;
$$;

revoke execute on function public.order_v4_launch_check(uuid) from public, anon;
grant execute on function public.order_v4_launch_check(uuid) to authenticated;

-- ── 4. Оплата ────────────────────────────────────────────────────────────

create or replace function public.order_v4_set_payment(
  p_id uuid, p_kind text, p_override_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_hidden constant text := 'Заказ не найден или недоступен';
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ms boolean;
  v_lead boolean;
  v_author boolean;
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_row public.orders%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Нужен вход в систему';
  end if;
  if p_kind is not null and p_kind not in ('prepaid', 'full') then
    raise exception using errcode = '22023', message = 'Вид оплаты: prepaid или full';
  end if;
  if length(p_override_reason) > 500 then
    raise exception using errcode = '22023', message = 'Причина — не длиннее 500 символов';
  end if;
  select p.role into v_role from public.profiles p
   where p.id = v_uid and p.active is true and p.approved is true;
  v_role := coalesce(v_role, '');                -- нет профиля / отключён — никто
  v_ms := public.sales_is_ms();
  v_lead := coalesce(v_role in ('admin', 'director', 'rop'), false);

  select * into v_row from public.orders where id = p_id and schema_version = 4 for update;
  if not found then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  -- J:begin author
  v_author := coalesce(public.sales_is_seller() and v_row.created_by = v_uid, false);
  -- J:was|  v_author := coalesce(v_role = 'manager' and v_row.created_by = v_uid, false);
  -- J:end author
  if not (v_lead or v_author
          or (v_ms and v_row.status in ('ready_to_launch', 'production', 'done'))) then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  -- J:begin ms_pay
  if not (v_lead or v_author) then
    -- МС отмечает предоплату или полную оплату перед запуском: с правом ERP
    -- order.manage и не на своём заказе. Снять отметку и «без оплаты» — руководство
    if not (v_ms and v_row.status = 'ready_to_launch') then
      raise exception using errcode = '42501', message = 'Оплату отмечает автор заказа или руководитель';
    end if;
    if p_kind is null or v_reason is not null then
      raise exception using errcode = '42501', message = 'Снять отметку или запустить без оплаты может только руководитель';
    end if;
    if v_row.created_by is not distinct from v_uid then
      raise exception using errcode = '42501', message = 'Оплату своего заказа отмечает другой сотрудник';
    end if;
    if not public.erp_has_permission('order.manage') then
      raise exception using errcode = '42501', message = 'Нет прав производства на отметку оплаты';
    end if;
  end if;
  -- J:was|  if not (v_lead or v_author) then
  -- J:was|    raise exception using errcode = '42501', message = 'Оплату отмечает автор заказа или руководитель';
  -- J:was|  end if;
  -- J:end ms_pay
  if v_row.status not in ('draft', 'ready_to_launch') then
    raise exception using errcode = 'P0001', message = 'Оплату отмечают до запуска';
  end if;
  if v_reason is not null and not v_lead then
    raise exception using errcode = '42501', message = 'Запуск без оплаты разрешает только руководитель';
  end if;

  perform set_config('order_v4.rpc', 'on', true);
  update public.orders
     set paid_at = case when p_kind is null then null else now() end,
         paid_kind = p_kind,
         paid_override_reason = case
           when v_reason is not null then v_reason
           when p_kind is null and v_lead then null
           else paid_override_reason end,
         updated_at = now()
   where id = p_id returning * into v_row;
  perform set_config('order_v4.rpc', 'off', true);

  insert into public.order_events (order_id, kind, payment_kind, reason, actor)
  values (p_id, 'payment', p_kind, v_reason, v_uid);

  return jsonb_build_object(
    'id', v_row.id,
    'paid_at', v_row.paid_at,
    'paid_kind', v_row.paid_kind,
    -- J:begin resp
    'paid_override_reason', v_row.paid_override_reason,
    'status', v_row.status,
    'updated_at', v_row.updated_at);
    -- J:was|    'paid_override_reason', v_row.paid_override_reason);
    -- J:end resp
end;
$$;

revoke execute on function public.order_v4_set_payment(uuid, text, text) from public, anon;
grant execute on function public.order_v4_set_payment(uuid, text, text) to authenticated;

-- ── 5. Признаки сотрудников продаж ───────────────────────────────────────

create or replace function public.sales_set_staff(p_profile uuid, p_kind text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows bigint;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true
       and p.role in ('admin', 'director', 'rop')) then
    raise exception using errcode = '42501',
      message = 'Отмечать сотрудников продаж может администратор, директор или РОП';
  end if;
  -- J:begin self_flag
  -- Свой признак — только admin и director: rop не отмечает себя МС
  if p_profile = (select auth.uid()) and not exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true
       and p.role in ('admin', 'director')) then
    raise exception using errcode = '42501', message = 'Свой признак меняет администратор или директор';
  end if;
  -- J:end self_flag
  -- J:begin rop_ms
  -- Признак МС профилю с ролью rop — только admin и director (разделение обязанностей)
  if p_kind = 'ms' and p_on is true
     and exists (select 1 from public.profiles t where t.id = p_profile and t.role = 'rop')
     and not exists (
       select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.active is true and p.approved is true
          and p.role in ('admin', 'director')) then
    raise exception using errcode = '42501', message = 'Признак МС руководителю продаж ставит администратор или директор';
  end if;
  -- J:end rop_ms
  if p_profile is null or p_on is null then
    raise exception using errcode = '22023', message = 'Не указан профиль или признак';
  end if;

  -- Вид признака — статическими ветками, без склейки имени колонки
  if p_kind = 'sales' then
    perform set_config('sales.rpc', 'on', true);
    update public.profiles set is_sales = p_on where id = p_profile;
    get diagnostics v_rows = row_count;
    perform set_config('sales.rpc', 'off', true);
  elsif p_kind = 'ms' then
    perform set_config('sales.rpc', 'on', true);
    update public.profiles set is_ms = p_on where id = p_profile;
    get diagnostics v_rows = row_count;
    perform set_config('sales.rpc', 'off', true);
  else
    raise exception using errcode = '22023', message = 'Неизвестный признак: ожидается sales или ms';
  end if;

  if v_rows = 0 then
    raise exception using errcode = 'P0002', message = 'Профиль не найден';
  end if;
end;
$$;

revoke execute on function public.sales_set_staff(uuid, text, boolean) from public, anon;
grant execute on function public.sales_set_staff(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
