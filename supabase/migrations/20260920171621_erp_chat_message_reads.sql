-- ПРОЧТЕНИЕ НА КАЖДОЕ СООБЩЕНИЕ (правка заказчика 20.09, п. 4).
--
-- ЭТО ПЕРЕСМОТР РЕШЕНИЯ 14.09, И СКАЗАТЬ ОБ ЭТОМ НАДО ПРЯМО. Миграция
-- `20260914221959` отвергла эту модель словами «N×M строк на растущую ленту
-- и вторая формула счётчика» и выбрала водяную отметку на тред.
--
-- Документ 20.09 требует именно поштучной: «прочтение хранить отдельно для
-- каждого пользователя и сообщения… автоматически считать сообщение
-- прочитанным, когда оно действительно попало в видимую область открытого
-- чата». Водяной отметкой это невыразимо в принципе: «Прочитали N с именами
-- и временем» и «отметить непрочитанным с этого сообщения» — вопросы
-- К СООБЩЕНИЮ, а отметка знает только момент. Довод про объём при этом
-- никуда не делся: строки пишутся пачками по видимой области, а не на каждое
-- сообщение ленты, и чистятся вместе с сообщением (`on delete cascade`).
--
-- ВОДЯНАЯ ОТМЕТКА ОСТАЁТСЯ. Во-первых, по ней считаются все текущие счётчики,
-- и снести её тем же коммитом значило бы обнулить их у всех. Во-вторых,
-- на момент выката строк прочтения нет НИ ОДНОЙ: формула «нет строки =
-- не прочитано» вывалила бы цеху всю историю переписки как непрочитанную
-- в первое же утро. Поэтому непрочитанное = «позже отметки И без строки».

create table if not exists public.erp_chat_message_reads (
  message_id uuid not null references public.erp_chat_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

comment on table public.erp_chat_message_reads is
  'Кто и когда увидел конкретное сообщение (правка 20.09, п. 4). Пишется пачкой по видимой области открытого чата; своё сообщение автор не «прочитывает».';

-- Индекс под вопрос «что из этого я уже видел»: ходят именно так —
-- по человеку и списку сообщений страницы
create index if not exists erp_chat_message_reads_user_idx
  on public.erp_chat_message_reads (user_id, message_id);

alter table public.erp_chat_message_reads enable row level security;

/*
  ЧИТАЮТ УЧАСТНИКИ, А НЕ ТОЛЬКО ВЛАДЕЛЕЦ СТРОКИ: «после прочтения другим
  сотрудником показывать „Прочитали N", по нажатию — имена и время». Видимость
  переписки в разделе уже решена как «кто видит сделку, тот видит разговор»,
  и прочтение — часть того же разговора.

  Политика НА КОМАНДУ (правило раздела): `for select` отдельно, `for insert`
  отдельно — `for all` рядом с select заставил бы Postgres проверять обе
  на каждом чтении.
*/
drop policy if exists erp_chat_message_reads_read on public.erp_chat_message_reads;
create policy erp_chat_message_reads_read on public.erp_chat_message_reads
  for select to authenticated
  using (public.erp_is_member());

/*
  Пишет человек ТОЛЬКО ЗА СЕБЯ. Отметить прочтение за другого — значит
  соврать отправителю в «Прочитали N», а это единственное, ради чего
  строка и существует.
*/
drop policy if exists erp_chat_message_reads_insert on public.erp_chat_message_reads;
create policy erp_chat_message_reads_insert on public.erp_chat_message_reads
  for insert to authenticated
  with check (user_id = (select auth.uid()));

/*
  UPDATE и DELETE не заводятся: отметка ставится один раз и назад не едет.
  Единственное место, где прочитанность отменяется, — «отметить непрочитанным
  с этого сообщения»; это отдельное действие отдельной функции, и пусть оно
  останется единственным.
*/

-- ── Отметить показанные сообщения прочитанными ───────────────────────────
--
-- ПАЧКОЙ, А НЕ ПО ОДНОМУ. Видимая область открытого чата — это десяток
-- сообщений сразу, и запрос на каждое превратил бы прокрутку в поток
-- запросов с планшета цеха.
create or replace function public.erp_chat_mark_seen(p_message_ids uuid[])
returns int
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_me  uuid := (select auth.uid());
  v_ins int := 0;
begin
  if v_me is null or p_message_ids is null or cardinality(p_message_ids) = 0 then
    return 0;
  end if;

  -- Своё сообщение автор не «прочитывает»: иначе «Прочитали 1» появилось бы
  -- у каждого отправленного, и число перестало бы значить что-либо
  insert into public.erp_chat_message_reads (message_id, user_id)
  select m.id, v_me
    from public.erp_chat_messages m
   where m.id = any(p_message_ids)
     and m.author_id is distinct from v_me
  on conflict do nothing;

  get diagnostics v_ins = row_count;
  return v_ins;
end $$;

comment on function public.erp_chat_mark_seen(uuid[]) is
  'Отметить показанные сообщения прочитанными (правка 20.09, п. 4). Пачкой: видимая область — это десяток сообщений сразу.';

-- ── Кто прочитал эти сообщения ───────────────────────────────────────────
--
-- Имена берутся ТЕМ ЖЕ способом, что в `erp_chat_directory`: второй источник
-- имён разошёлся бы с лентой, где автор подписан по справочнику.
create or replace function public.erp_chat_read_receipts(p_message_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', x.message_id,
    'user_id', x.user_id,
    'name', x.name,
    'read_at', x.read_at
  ) order by x.read_at), '[]'::jsonb)
  from (
    select
      r.message_id,
      r.user_id,
      coalesce(e.full_name, p.name, p.email) as name,
      r.read_at
      from public.erp_chat_message_reads r
      join public.profiles p on p.id = r.user_id
      left join lateral (
        select e2.full_name from public.erp_employees e2
         where e2.profile_id = r.user_id and e2.active
         order by e2.created_at limit 1
      ) e on true
     where r.message_id = any(coalesce(p_message_ids, '{}'::uuid[]))
       and public.erp_is_member()
  ) x;
$$;

comment on function public.erp_chat_read_receipts(uuid[]) is
  'Кто и когда прочитал сообщения (правка 20.09, п. 4) — для «Прочитали N». Definer: profiles_select показывает участнику только свою строку, поэтому имена собираются здесь, как в erp_chat_directory. Доступ ограничен erp_is_member() внутри.';

revoke execute on function public.erp_chat_mark_seen(uuid[]) from public, anon;
revoke execute on function public.erp_chat_read_receipts(uuid[]) from public, anon;
grant execute on function public.erp_chat_mark_seen(uuid[]) to authenticated;
grant execute on function public.erp_chat_read_receipts(uuid[]) to authenticated;
