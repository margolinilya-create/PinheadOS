-- Order v4, веха 8 единого потока, миграция K (18.10): код зоны у нанесения
-- (`order_item_prints.zone_id`) и «Комментарий для цехов» (`orders.notes`) в сохранении;
-- ревизия клиента 4.
--
-- План: docs/superpowers/plans/2026-10-18-order-flow-m8-polish-enable.md, задача 2
-- (решение К5). ВЫКАТКА: L (20261018150000) → фронт с SALES_CLIENT_REV = 4 → K
-- не позже 30 минут после появления новой сборки в /version.json. Фронт ревизии 4
-- со старым сервером работает: поле комментария он показывает, только когда ответ
-- сохранения несёт ключ `notes` (его добавляет K). ОТКАТ ФРОНТА ⇒ СНАЧАЛА откат функций K
-- (supabase/rollout/m8/3-rollback-K-functions.sql: тело `order_v4_save_full` до K,
-- порог ревизии 3), затем фронт. Колонку `zone_id` откат функций оставляет
-- (nullable, безвредна); её снимает файл владельца 3b-drop-zone-id.sql по желанию.
--
-- Тело `order_v4_save_full` — подлинный текст миграции D (20261017101513_order_v4_client_rev,
-- md5 `prosrc` на бою — литерал задачи 0); правки — блоки
--   -- K:begin <метка> … [-- K:was|<строка D дословно>] … -- K:end <метка>
-- Обратная замена даёт тело D побайтно (сторож orderV4M8.test.ts).
--
-- Почему меняется только обёртка (решение задачи 2, отступление от текста плана):
-- в теле `order_v4_save` есть операторы удаления строк позиций, нанесений, бирок
-- и карточек — с ними файл нельзя применить через MCP `execute_sql` (он ждёт
-- подтверждения), и откат функций K перестал бы быть «без подтверждения». Поэтому
-- `order_v4_save` K не пересоздаёт: проверку формата, запись `zone_id` и `notes`
-- и порог ревизии 4 несёт `order_v4_save_full` — ровно её зовёт клиент
-- (`api/salesOrders.ts`). Прямой вызов `order_v4_save` в обход обёртки (ревизия ≥ 3)
-- не знает новых полей и сотрёт `zone_id` нанесений СВОЕГО черновика — это порча своих
-- данных, а не права (права держат RLS и стражи, как в D).
-- `order_v4_child_guard` K тоже не меняет: страж строк заказа не перечисляет колонки,
-- он пускает любую правку только у черновика — `zone_id` им покрыт (проба zn_sent).
-- `order_v4_guard` и CHECK `orders_notes_len` — миграция L.
--
-- Регулярка кода зоны — ровно `ZONE_ID_RE.source` из
-- pinhead-react/src/orderstudio/catalog/tzRows.ts (тот же ключ, что у справочника зон
-- в `catalog_value_check`; сторож orderV4M8.test.ts). Таблицы `erp_*` миграция не трогает.

-- ── 1. Код зоны у нанесения ──────────────────────────────────────────────
alter table public.order_item_prints
  add column if not exists zone_id text null
  constraint order_item_prints_zone_id_check
  check (zone_id is null or zone_id ~ '^[a-z0-9][a-z0-9_-]{0,62}$');

-- ── 2. Сохранение: ревизия 4, проверка и запись zone_id и notes ──────────
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
  -- K:begin decl
  v_updated timestamptz;
  v_notes text;
  -- K:end decl
begin
  -- K:begin rev
  -- K:was|  if coalesce((p_order->>'client_rev')::int, 0) < 3 then
  if coalesce((p_order->>'client_rev')::int, 0) < 4 then
  -- K:end rev
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

  -- K:begin validate
  -- Понятный отказ до записи: нарушение CHECK внутри сохранения откатило бы его
  -- целиком без внятного текста. Длину держит и таблица (CHECK orders_notes_len, L),
  -- формат кода зоны — CHECK order_item_prints_zone_id_check
  if p_order ? 'notes' and (jsonb_typeof(p_order->'notes') not in ('string', 'null')
     or char_length(coalesce(p_order->>'notes', '')) > 2000) then
    raise exception using errcode = '22023',
      message = 'Комментарий для цехов — не длиннее 2000 знаков';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(case when jsonb_typeof(p_order->'items') = 'array'
                                     then p_order->'items' else '[]'::jsonb end) as it(v)
     cross join lateral jsonb_array_elements(case when jsonb_typeof(it.v->'prints') = 'array'
                                                  then it.v->'prints' else '[]'::jsonb end) as pr(v)
     where pr.v ? 'zone_id'
       and (jsonb_typeof(pr.v->'zone_id') not in ('string', 'null')
            or (pr.v->>'zone_id') !~ '^[a-z0-9][a-z0-9_-]{0,62}$')) then
    raise exception using errcode = '22023', message = 'Неверный код зоны нанесения';
  end if;
  -- K:end validate
  v_saved := public.order_v4_save(p_order);
  if jsonb_typeof(p_order->'urgent_days') = 'number' then
    perform public.order_v4_set_urgent_days(
      (v_saved->>'id')::uuid,
      (p_order->>'urgent_days')::smallint
    );
  end if;
  -- K:begin write
  -- `order_v4_save` пишет нанесения заново (порядок — sort_order позиции и нанесения),
  -- код зоны и комментарий дописываются здесь, в той же транзакции; страж строк
  -- заказа пускает правку только черновика. Нет ключа `notes` — комментарий не трогается
  v_id := (v_saved->>'id')::uuid;
  if p_order ? 'notes' then
    update public.orders set notes = nullif(p_order->>'notes', '')
     where id = v_id and schema_version = 4;
  end if;
  update public.order_item_prints as p
     set zone_id = z.zone_id
    from (select i.id as item_id, (pr.n - 1)::integer as sort_order,
                 nullif(pr.v->>'zone_id', '') as zone_id
            from jsonb_array_elements(coalesce(p_order->'items', '[]'::jsonb)) with ordinality as it(v, n)
            join public.order_items i on i.order_id = v_id and i.sort_order = it.n - 1
           cross join lateral jsonb_array_elements(coalesce(it.v->'prints', '[]'::jsonb))
                 with ordinality as pr(v, n)) as z
   where p.item_id = z.item_id and p.sort_order = z.sort_order
     and p.zone_id is distinct from z.zone_id;
  -- Ответ: новый updated_at и комментарий — по ключу `notes` клиент узнаёт,
  -- что сервер знает поле (окно «фронт ревизии 4 → K», К5)
  select o.updated_at, o.notes into v_updated, v_notes from public.orders o where o.id = v_id;
  return v_saved || jsonb_build_object('updated_at', v_updated, 'notes', coalesce(v_notes, ''));
  -- K:was|  return v_saved;
  -- K:end write
end;
$$;

revoke execute on function public.order_v4_save_full(jsonb) from public, anon;
grant execute on function public.order_v4_save_full(jsonb) to authenticated;

notify pgrst, 'reload schema';
