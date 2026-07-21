-- Правки ПМ (волна 4.2), подряд: тип подряда выбирается при создании заказа и
-- авто-создаёт операцию подряда. Плюс расширенная стейт-машина статусов для
-- «готового изделия» от подрядчика (оплата → материалы → работа → отгрузка → поступление).

-- Метаданные подряда на позиции заказа (выбираются при создании; nullable для обычных)
alter table public.erp_order_items
  add column subcontract_kind text
    check (subcontract_kind in ('finished_product','operation')),
  add column material_source text
    check (material_source in ('pinhead','contractor'));

-- Расширяем статусы операций подряда жизненным циклом «готового изделия»
alter table public.erp_subcontracting
  drop constraint if exists erp_subcontracting_status_check;
alter table public.erp_subcontracting
  add constraint erp_subcontracting_status_check check (status in (
    -- операция (существующие)
    'planned','sent','in_progress','returned','delayed','cancelled',
    -- готовое изделие от подрядчика (новые)
    'awaiting_payment','awaiting_materials','started','ready_to_ship',
    'shipped_by_contractor','received_at_pinhead'
  ));
