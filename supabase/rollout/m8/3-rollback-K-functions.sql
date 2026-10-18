-- ОТКАТ функций K (КОНТРОЛЛЕР) — СНАЧАЛА он, потом откат фронта (Instant Rollback Vercel).
-- Обёртка order_v4_save_full возвращается к телу D (порог ревизии 3, без zone_id и notes).
-- Стражи L не трогаются: запись v3 остаётся закрытой. Колонка zone_id и запись журнала K
-- остаются (nullable, безвредны); колонку снимает 3b-drop-zone-id.sql (владелец, по желанию).
-- Ожидание: commit без ошибок; последний select — 't'.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── Предусловие отката: K применена, обёртка — тело K ──
do $pre$
declare v text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261018160000') then
    raise exception 'K в журнале нет — откатывать нечего';
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_save_full(jsonb)');
  if v is distinct from 'c9eeabed217ddcefb685211b016b1116' then
    raise exception 'Обёртка на бою не равна K — откат сверить вручную: order_v4_save_full(jsonb) (md5 %)', v;
  end if;
end;
$pre$;

-- ── Откат функций K: обёртка — тело D (порог ревизии 3); колонка zone_id остаётся ──
create or replace function public.order_v4_save_full(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saved jsonb;
  v_id uuid;
  v_expected timestamptz;
  v_current timestamptz;
  v_status text;
begin
  if coalesce((p_order->>'client_rev')::int, 0) < 3 then
    raise exception using errcode = 'P0001',
      message = 'Вышло обновление — обновите страницу, правка не сохранена';
  end if;

  -- Конкурентная правка: строка существующего заказа берётся FOR UPDATE —
  -- параллельное сохранение из второй вкладки ждёт и видит уже новый updated_at
  v_id := nullif(p_order->>'id', '')::uuid;
  v_expected := nullif(p_order->>'expected_updated_at', '')::timestamptz;
  if v_id is not null and v_expected is not null then
    select updated_at, status into v_current, v_status
      from public.orders
     where id = v_id and schema_version = 4
       for update;
    -- Не черновик — сверку пропускаем: правку закрывает страж «правка закрыта»
    -- (42501), и вкладка узнаёт настоящую причину, а не «изменён в другой вкладке»
    if found and v_status = 'draft' and v_current is distinct from v_expected then
      raise exception using errcode = 'P0001',
        message = 'Заказ изменён в другой вкладке — обновите страницу';
    end if;
  end if;

  v_saved := public.order_v4_save(p_order);
  if jsonb_typeof(p_order->'urgent_days') = 'number' then
    perform public.order_v4_set_urgent_days(
      (v_saved->>'id')::uuid,
      (p_order->>'urgent_days')::smallint
    );
  end if;
  return v_saved;
end;
$$;

revoke execute on function public.order_v4_save_full(jsonb) from public, anon;
grant execute on function public.order_v4_save_full(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ── Сверка отката: обёртка = тело D ──
do $chk$
declare v text;
begin
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_save_full(jsonb)');
  if v is distinct from '6be40fb03b7eec70b76bf5de08b57c83' then
    raise exception 'ОТКАТ: обёртка не равна телу D: order_v4_save_full(jsonb) (md5 %)', v;
  end if;
end;
$chk$;

commit;

select md5(prosrc) = '6be40fb03b7eec70b76bf5de08b57c83' as d_body from pg_proc where oid = to_regprocedure('public.order_v4_save_full(jsonb)');
