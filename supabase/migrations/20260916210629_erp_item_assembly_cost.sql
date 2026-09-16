-- ФАКТИЧЕСКАЯ СТОИМОСТЬ СБОРКИ ПОЗИЦИИ (правка заказчика 16.09, п. 6).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Добавить обязательное поле „Стоимость сборки
-- за единицу, ₽". Значение мастер швейного цеха указывает ОДИН РАЗ НА ВСЮ
-- ПОЗИЦИЮ, а не отдельно по размерам. Стоимость сборки сохранять как
-- фактическую стоимость конкретной позиции конкретного заказа для
-- дальнейшей аналитики и сравнения с нормативной стоимостью из калькулятора».
--
-- ПОЧЕМУ У ПОЗИЦИИ, А НЕ У ЭТАПА И НЕ В ОТЧЁТЕ. «Один раз на позицию» там
-- просто не держится: у этапа их бывает несколько (возврат брака заводит
-- второй швейный этап со своим `cycle`), у отчёта — сколько угодно, потому
-- что цех сдаёт работу частями. Аналитика к тому же режет себестоимость
-- по модели, а связь «позиция → `sku_card_id`» короче на один джойн.
--
-- ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ — `erp_stage_submit_report`. Прямой путь закрыт:
-- страж `erp_order_item_guard` требует `order.manage` на любую правку
-- позиции, а у швеи его нет и быть не должно — это право на заказ целиком
-- (срок, менеджер, состав позиций).
--
-- ПРОПУСК УСТРОЕН КАК У РОЛЛАПА ОТГРУЗКИ (`erp.shipment_rollup`,
-- миграция 20260830140000) и ровно так же УЗКО: метка ставится внутри RPC
-- вокруг своего `update`, и ветка проверяет, что изменились ТОЛЬКО три
-- колонки стоимости. Без этой проверки метка стала бы дырой на всю позицию:
-- цех менял бы тираж и сроки.
--
-- Проверено на живой базе от лица цеховой роли (`set local role
-- authenticated` + jwt сотрудника цеха вышивки): стоимость под меткой
-- записывается, а `update ... set qty = qty + 1` под той же меткой
-- отвергается стражем с 42501.

alter table public.erp_order_items
  add column if not exists assembly_cost_per_unit numeric
    check (assembly_cost_per_unit is null or assembly_cost_per_unit >= 0),
  add column if not exists assembly_cost_set_at timestamptz,
  add column if not exists assembly_cost_by uuid;

comment on column public.erp_order_items.assembly_cost_per_unit is
  'Фактическая стоимость сборки за единицу (правка 16.09, п. 6). Единственный писатель — erp_stage_submit_report';

create or replace function public.erp_order_item_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if coalesce(current_setting('erp.shipment_rollup', true), '') = 'on'
     and public.erp_has_permission('warehouse.manage')
  then
    return new;
  end if;

  -- Узкая ветка стоимости сборки: право цеха + метка RPC + изменились
  -- ТОЛЬКО три колонки стоимости (и служебная `updated_at`)
  if tg_op = 'UPDATE'
     and coalesce(current_setting('erp.assembly_cost', true), '') = 'on'
     and (public.erp_has_permission('stage.progress')
          or public.erp_has_permission('stage.complete'))
     and (to_jsonb(new) - 'assembly_cost_per_unit' - 'assembly_cost_set_at'
          - 'assembly_cost_by' - 'updated_at')
       = (to_jsonb(old) - 'assembly_cost_per_unit' - 'assembly_cost_set_at'
          - 'assembly_cost_by' - 'updated_at')
  then
    return new;
  end if;

  if not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_item_guard: правка позиции заказа требует права order.manage'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function public.erp_order_item_guard() is
  'Страж позиции заказа: order.manage, узкие ветки для роллапа отгрузки и стоимости сборки';
