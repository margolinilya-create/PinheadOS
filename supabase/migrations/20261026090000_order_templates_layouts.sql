-- =============================================================
-- Веха 5в, Э8 — «Мои раскладки» на сервере (миграция P)
-- =============================================================
-- `order_templates` с вехи 5в хранит раскладки позиции (`data.kind = 'layout'`,
-- пишет только клиентский модуль `api/layoutTemplates.ts`). До этой миграции:
--   · права — умолчания Supabase: у `anon` и `authenticated` ВСЁ, включая TRUNCATE
--     (обходит RLS — любой с публичным ключом мог очистить таблицу) и UPDATE;
--   · политики «свои» без `active/approved` и без признака продаж — писал любой
--     вошедший, в том числе неодобренный;
--   · ни имя, ни размер данных не ограничены — пределы были только в интерфейсе.
-- Таблица на бою пуста (сверка 26.10: 0 строк), прежних шаблонов визарда нет.
--
-- Что делает:
--   1. revoke всего у public, anon, authenticated; grant select, insert, delete —
--      authenticated (UPDATE раскладки нет: правка = удалить и сохранить заново);
--   2. NOT NULL у created_by; CHECK имени 1…60 знаков без пробелов по краям,
--      данных — объект `kind = 'layout'`, `v = 1`, массив `prints` 1…20, текст ≤ 16 КБ;
--   3. политики — свои строки И продавец или руководство продаж (`sales_is_seller()`
--      / `sales_is_lead()`: active + approved) — зеркало `canCreateOrders` клиента.
-- Политики меняются `alter policy` (имена прежние, `drop` не нужен).
--
-- Порядок выкатки: независим от фронта (боевой фронт таблицу не читает; новый —
-- только «Мои раскладки»). ERP не затрагивается. Проба — supabase/probes/order_templates.sql.

revoke all on table public.order_templates from public, anon, authenticated;
grant select, insert, delete on table public.order_templates to authenticated;

alter table public.order_templates alter column created_by set not null;

alter table public.order_templates
  add constraint order_templates_name_check
    check (char_length(name) between 1 and 60 and name = btrim(name));

alter table public.order_templates
  add constraint order_templates_layout_check
    -- coalesce: без ключа `kind`/`v`/`prints` сравнение даёт NULL, а NULL CHECK пропускает (поймала проба tp_kind)
    check (coalesce(
      jsonb_typeof(data) = 'object'
      and data->>'kind' = 'layout'
      and data->>'v' = '1'
      and jsonb_typeof(data->'prints') = 'array'
      and jsonb_array_length(data->'prints') between 1 and 20
      and octet_length(data::text) <= 16384,
      false));

alter policy order_templates_select on public.order_templates
  using (
    (select auth.uid()) = created_by
    and ((select public.sales_is_seller()) or (select public.sales_is_lead()))
  );

alter policy order_templates_insert on public.order_templates
  with check (
    (select auth.uid()) = created_by
    and ((select public.sales_is_seller()) or (select public.sales_is_lead()))
  );

alter policy order_templates_delete on public.order_templates
  using (
    (select auth.uid()) = created_by
    and ((select public.sales_is_seller()) or (select public.sales_is_lead()))
  );
