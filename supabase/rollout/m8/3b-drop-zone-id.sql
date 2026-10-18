-- ВЛАДЕЛЕЦ, по желанию и позже: снять колонку order_item_prints.zone_id после отката функций K.
-- Только если обёртка уже вернулась к телу D (3-rollback-K-functions.sql) — иначе отказ.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── Предусловие: функции K откачены ──
do $pre$
declare v text;
begin
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_save_full(jsonb)');
  if v is distinct from '6be40fb03b7eec70b76bf5de08b57c83' then
    raise exception 'Обёртка не равна телу D — сначала 3-rollback-K-functions.sql: order_v4_save_full(jsonb) (md5 %)', v;
  end if;
end;
$pre$;

alter table public.order_item_prints drop column if exists zone_id;

notify pgrst, 'reload schema';

commit;
