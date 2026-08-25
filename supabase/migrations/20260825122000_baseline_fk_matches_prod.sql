-- Реплей baseline-схемы должен давать ТУ систему, что в проде.
--
-- ЧТО НАШЛА РЕВИЗИЯ 25.08. Файл `20260101000000_baseline_order_studio.sql`
-- описывает две связи, которых на боевой схеме нет:
--
--   1. `profiles.id uuid primary key references auth.users(id) on delete cascade`
--      — на проде у `profiles` НЕТ НИ ОДНОГО исходящего внешнего ключа
--      (проверено запросом по `pg_constraint`). Именно на этом построена
--      edge-функция `admin-users`: она убирает строку профиля ЯВНО, потому
--      что каскада нет. Совпало бы наоборот — и в репозитории жила бы схема,
--      где удаление учётной записи чистит профиль само, а комментарий рядом
--      объяснял бы обратное.
--
--   2. `orders.created_by uuid references auth.users(id)` — на проде этот
--      ключ смотрит на `public.profiles` (`orders_created_by_fkey`,
--      `on delete no action`). Разница не косметическая: от неё зависит,
--      что именно держит удаление, и та же функция считает заказы ДО
--      попытки, чтобы назвать причину человеку.
--
-- Baseline применялся ДО того, как завели журнал миграций (см.
-- `preJournalNote` в APPLIED.json), поэтому переписывать сам файл нельзя:
-- он остаётся свидетельством того, что и когда выполнялось. Расхождение
-- снимается миграцией — так, чтобы на проде она была НИ ЧЕМ (проверяет
-- фактическое состояние и ничего не делает), а на чистом окружении
-- приводила схему к боевой.
--
-- Почему это вообще важно, написано в `supabase/migrations/README.md`:
-- реплей на превью-ветку или восстановление из бэкапа воспроизводит НЕ ту
-- систему, а сторожевые тесты при этом остаются зелёными.

do $$
begin
  -- 1. Лишняя связь профиля с `auth.users`: на проде её нет
  if exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'profiles' and c.contype = 'f'
  ) then
    execute (
      select string_agg(
        format('alter table public.profiles drop constraint %I', c.conname), '; ')
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace nn on nn.oid = t.relnamespace
      where nn.nspname = 'public' and t.relname = 'profiles' and c.contype = 'f'
    );
    raise notice 'baseline_fk: снята связь profiles → auth.users (на проде её нет)';
  end if;

  -- 2. Автор заказа Order Studio: цель ключа — `profiles`, а не `auth.users`
  if exists (
    select 1 from pg_constraint c
    join pg_class t  on t.oid = c.conrelid
    join pg_class rt on rt.oid = c.confrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'orders'
      and c.contype = 'f' and c.conname = 'orders_created_by_fkey'
      and rt.relname <> 'profiles'
  ) then
    alter table public.orders drop constraint orders_created_by_fkey;
    alter table public.orders
      add constraint orders_created_by_fkey
      foreign key (created_by) references public.profiles(id);
    raise notice 'baseline_fk: orders.created_by переведён на profiles (как в проде)';
  end if;
end $$;

comment on table public.profiles is
  'Профили пользователей. Внешнего ключа на auth.users НЕТ намеренно: строку '
  'профиля убирает edge-функция admin-users явно, а удаление учётной записи '
  'закрывает вход первым. Расхождение с baseline-файлом снято миграцией '
  '20260825122000.';
