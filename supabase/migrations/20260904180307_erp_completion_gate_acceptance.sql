-- Гейт завершения этапа спрашивает ВЕРДИКТ СКЛАДА, а не только статус строки.
--
-- ЧТО БЫЛО СЛОМАНО. «Материал на месте» в проекте считался ДВУМЯ формулами.
-- Гейт ЗАПУСКА цеха (`utils/routes.isMaterialPending`) с 22.07 спрашивает
-- вердикт приёмки: пришедший закупочный материал годен только при
-- `accepted_full`/`accepted_partial`. Гейт ЗАВЕРШЕНИЯ этапа — и клиентский
-- `utils/supply.isMaterialSettled`, и это его зеркало — спрашивали одну
-- колонку: `status in ('received','reserved','not_needed')`. А приёмка
-- (`erp_material_accept`) ставит `received` при ЛЮБОМ исходе, включая
-- недостачу, пересорт и отказ.
--
-- ЦЕНА НА ЖИВОЙ БАЗЕ (проверено 04.09). Шесть позиций стоят `received`
-- без годной приёмки — среди них «Кулирка 100хб 250гр» с недостачей
-- (принято 40 из 42), — и у всех шести закупка уже закрыта: автозакрытие
-- (`maybeCloseSupply`) считает готовность той же формулой. На заказе 60448
-- закрой закрыт целиком (75/75, 50/50, 75/75) при трёх непринятых позициях:
-- этап, который тот же цех не смог бы ВЗЯТЬ в работу, он смог ЗАКРЫТЬ,
-- открыв швейке тираж на материале, которого склад не принял.
--
-- Правило 30.08 «гейт на входе не заменяет гейта на выходе» соблюдено —
-- гейт на выходе стоял. Сломала его ВТОРАЯ КОПИЯ правила: две формулы
-- отвечали на один вопрос и разошлись ровно там, ради чего вторая писалась.
-- Клиент теперь выводит `isMaterialSettled` из `isMaterialPending`
-- (одна формула), а здесь повторено то же условие — гейт и страж
-- одним коммитом, как требует правило проекта.
--
-- ТЕКСТ ОТКАЗА ИЗМЕНЁН ВМЕСТЕ С КЛИЕНТСКИМ: «придут или будут взяты
-- со склада» описывало только половину условия, и человек, у которого
-- материал ПРИШЁЛ, читал бы отказ как ошибку системы.

create or replace function public.erp_stage_completion_block(
  p_stage_id uuid,
  p_added_good int default 0
)
returns text
language sql
stable
set search_path = public as $$
  with ctx as (
    select s.id, s.qty_done, s.department_id, i.id as item_id, i.qty as item_qty,
           i.order_id, d.gate_material_kinds
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
      left join public.erp_departments d on d.id = s.department_id
     where s.id = p_stage_id
  ),
  gate as (
    select ctx.*,
           -- Снятие действует, пока проверку не вернули; глобальное (order_id
           -- is null) — на все заказы, узкое — на свой
           exists (
             select 1 from public.erp_bypasses b
              where b.kind = 'material_gate'
                and b.restored_at is null
                and (b.order_id is null or b.order_id = ctx.order_id)
           ) as bypassed
      from ctx
  ),
  blocking as (
    select m.name
      from gate g
      join public.erp_materials m on m.order_id = g.order_id
     where coalesce(cardinality(g.gate_material_kinds), 0) > 0
       and not g.bypassed
       -- Запись реально добирает тираж? Частичная сдача при неприехавшем
       -- материале законна — цех отчитывается за то, что сделал.
       and coalesce(g.qty_done, 0) + coalesce(p_added_good, 0) >= g.item_qty
       and (m.item_id is null or m.item_id = g.item_id)
       -- Дословное зеркало `routes.materialPending`: со склада и «не требуется»
       -- годны без приёмки, пришедшее закупочное — только после неё
       and coalesce(m.status, '') not in ('reserved', 'not_needed')
       and (coalesce(m.status, '') <> 'received'
            or coalesce(m.accept_status, '') not in ('accepted_full', 'accepted_partial'))
  )
  select case when count(*) = 0 then null else
    'Закупка не завершена: '
    || string_agg(name, ', ' order by name)
    || '. Этап можно закрыть, когда материалы придут и склад их примет.'
  end
  from blocking;
$$;

comment on function public.erp_stage_completion_block(uuid, int) is
  'Почему этап нельзя закрыть по закупке, или NULL. Зеркало клиентского utils/supply.materialsBlockingCompletion; «на месте» означает reserved/not_needed либо received с приёмкой accepted_full/accepted_partial — то же правило, что у гейта запуска (routes.isMaterialPending).';
